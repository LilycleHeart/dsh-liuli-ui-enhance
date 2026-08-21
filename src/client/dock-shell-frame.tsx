/**
 * DockShellFrame：advanced 模式下接管 root slot 的「视觉零侵入」dockable 布局。
 *
 * 设计约束（用户要求）：不改动既有 UI 的样式与布局观感 ——
 *  - 复用桌面 advanced shell 自己的 DOM 结构与类名（.dshDesktopFrame /
 *    .dshDesktopWindowsCaptionRow / .dshDesktopSidebarSurface /
 *    .dshDesktopConversationSurface / .dshDesktopDetailsSurface /
 *    .dshDesktopOverlay / .dshDesktopResizeHandle），样式全部来自桌面插件
 *    注入的 ADVANCED_STYLES，默认状态与原生壳逐像素一致；
 *  - 无常驻工具栏：布局工作台（添加面板/保存/恢复/导出/导入/重置）收纳在
 *    悬浮球菜单事件（liuli:dock-menu-toggle，Ctrl+Alt+L）唤起的浮动卡片里；
 *  - 拖拽视觉（幽灵/落点指示/屏蔽层）只在实际拖拽时出现；
 *  - 单区域面板无任何附加 chrome；标签条仅在标签组合并 ≥2 个面板时出现。
 *
 * 布局能力：三大区域（侧边栏/会话/详情）+ 扩展面板可拖拽、四向拆分、
 * 边缘/面板内停靠、浮动窗口、标签页合并、sash 缩放；详情开合与宿主
 * layout 服务双向联动；dock 树自动保存/恢复（localStorage + 命名槽位 + 导出导入）。
 */
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  addPanel, collectTabsNodes, createPanel, MIN_SIZE, moveFloat, movePanel, panelCount,
  patchPanel, placePanel, removePanel, resizeSplitTo, setActivePanel, updateFloat,
  type DockLayout, type DockNode, type DropTarget, type FloatWindow, type PanelInstance, type SplitNode, type TabsNode,
} from './dock-model.ts'
import { DOCK_PANEL_DEFS, panelDef, panelTitle, type DockHostAccess } from './dock-panels.tsx'
import { markSideTabAccepted, parseSideTab, SIDE_TAB_MIME, sideTabToDockPanel, type SideTabDockPanel } from './side-tab-dock.ts'
import {
  createDockShellStore, exportDockJSON, findRegion, importDockJSON, isRegionPanel,
  listShellSlotNames, loadShellSlotByName, regionLabel, saveShellDock,
  saveShellSlotByName, withRegion,
  REGION_CONVERSATION, REGION_DETAILS, REGION_SIDEBAR,
  type HostLayoutFace,
} from './dock-shell.ts'
import css from './DockShellFrame.module.css'
import { HMR_MARKER } from './hmr-marker.ts'
import { beginResizePerf, endResizePerf } from './resize-perf.ts'

/* ── ctx 能力桥（index.ts 注入；纯组件不碰 cordis） ── */

let dockHostBridge: { addFileToChat?: (path: string) => void; openPath?: (path: string) => void } = {}

export function setDockHostBridge(bridge: { addFileToChat?: (path: string) => void; openPath?: (path: string) => void }): void {
  dockHostBridge = bridge
}

/** 悬浮球/快捷键唤起布局工作台菜单的事件名。 */
export const DOCK_MENU_TOGGLE_EVENT = 'liuli:dock-menu-toggle'

/* ── 组合 props ── */

export type DockShellHandle = ReturnType<ReturnType<typeof createDockShellStore>['create']>

export type DockShellFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & { dockShell: DockShellHandle; hostLayout: HostLayoutFace }

interface DragSource {
  kind: 'node' | 'float'
  containerId: string
  panelId?: string
}

interface DragState {
  source: DragSource
  title: string
  x: number
  y: number
  over: DropTarget | null
  overRect: { left: number; top: number; width: number; height: number } | null
}

const EDGE_STRIP = 14
const ZONE_RATIO = 0.26
const DRAG_THRESHOLD = 5

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

function platformOf(): 'win32' | 'darwin' | 'linux' {
  const p = new URLSearchParams(window.location.search).get('dsh-desktop-platform')
  return p === 'darwin' || p === 'linux' ? p : 'win32'
}

/** 桌面 shell 的区域表面类（样式来自桌面插件 ADVANCED_STYLES，观感与原生一致）。 */
function surfaceClass(type: string): string {
  switch (type) {
    case REGION_SIDEBAR: return 'dshDesktopSidebarSurface'
    case REGION_CONVERSATION: return 'dshDesktopConversationSurface'
    case REGION_DETAILS: return 'dshDesktopDetailsSurface'
    default: return ''
  }
}

/** 框架 root 占用者：视觉零侵入的 dockable 三区域 shell。 */
export function DockShellFrame({ dockShell, hostLayout, useSessions, renderSlot }: DockShellFrameProps) {
  const shell = useSyncExternalStore(dockShell.subscribe, dockShell.getSnapshot)
  const actions = dockShell.actions
  const dock = shell.dock
  const hostSubscribe = useCallback((fn: () => void) => hostLayout.subscribe(fn), [hostLayout])
  const hostGetSnapshot = useCallback(() => hostLayout.getSnapshot(), [hostLayout])
  const hostPanels = useSyncExternalStore(hostSubscribe, hostGetSnapshot)
  const platform = platformOf()
  const sessionId = useSessions(s => s.current)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })

  const [drag, setDrag] = useState<DragState | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [slotName, setSlotName] = useState('')
  const [slotsVersion, setSlotsVersion] = useState(0)
  const [modal, setModal] = useState<null | { kind: 'export' | 'import'; text: string }>(null)
  const [toast, setToast] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ source: DragSource; title: string; sx: number; sy: number; active: boolean } | null>(null)
  /** HTML5 外部拖入（右侧标签面板标签）的落点指示。 */
  const [htmlDrop, setHtmlDrop] = useState<{ over: DropTarget | null; rect: DragState['overRect'] } | null>(null)
  const htmlDragActive = useRef(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shellRef = useRef(shell)
  shellRef.current = shell

  // 详情区域宽度（liuli 自管，突破 desktop shell 的 clamp 300-520；上限 = 视口 88%，
  // 与 PreviewPanel 的 WIDTH_MAX_RATIO 一致）。宿主开合（hostPanels.details 0↔w）仍驱动折叠。
  const [detailsWidth, setDetailsWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('liuli:details-width')
      const n = raw === null ? 0 : Number.parseFloat(raw)
      return Number.isFinite(n) && n > 0 ? n : 360
    } catch { return 360 }
  })
  useEffect(() => {
    try { localStorage.setItem('liuli:details-width', String(detailsWidth)) } catch { /* 配额/隐私模式则放弃 */ }
  }, [detailsWidth])
  // 会话切换恢复宽度时，PreviewPanel 会写 liuli:details-width 并派发本事件。
  useEffect(() => {
    const onWidthChange = (): void => {
      try {
        const raw = localStorage.getItem('liuli:details-width')
        const n = raw === null ? 0 : Number.parseFloat(raw)
        if (Number.isFinite(n) && n > 0) setDetailsWidth(n)
      } catch { /* 忽略损坏值 */ }
    }
    window.addEventListener('liuli:details-width-change', onWidthChange)
    return () => window.removeEventListener('liuli:details-width-change', onWidthChange)
  }, [])

  /* ── 自动保存 dock 树（防抖 250ms）+ 卸载前落盘 ── */
  useEffect(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    const snapshot = shell
    saveTimer.current = setTimeout(() => { saveShellDock(snapshot.dock) }, 250)
    return () => { if (saveTimer.current !== null) clearTimeout(saveTimer.current) }
  }, [shell])
  useEffect(() => () => { saveShellDock(shellRef.current.dock) }, [])

  /* ── 会话切换关闭详情（官方 AppFrame 语义，经宿主 layout 服务） ──
     · 新会话若有「展开」存档（liuli:side-pane-session:<id>.open），保持展开，
       由 PreviewDetailsPanel 恢复；否则按官方语义收起。 ── */
  const lastSession = useRef(detailsSession)
  useEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      let wantOpen = false
      try {
        const raw = localStorage.getItem('liuli:side-pane-session:' + detailsSession)
        if (raw !== null && raw !== '') {
          const s = JSON.parse(raw) as { open?: boolean }
          wantOpen = s.open === true
        }
      } catch { /* 忽略 */ }
      if (!wantOpen) hostLayout.closeDetails()
    }
    lastSession.current = detailsSession
  }, [hostLayout, detailsSession])

  /* ── 详情区域与宿主状态同步：面板常驻树中（官方 DetailsColumn 语义：宽度
        0 保持挂载），开合只切换 shard 宽度（0 ↔ 详情宽），由 CSS 过渡驱动动画，
        会话列平滑补位；仅当面板被用户移出树（关闭标签/拖走/导入布局）后再次
        openDetails 时补挂面板。 ── */
  const prevDetails = useRef(hostPanels.details)
  useEffect(() => {
    const prev = prevDetails.current
    prevDetails.current = hostPanels.details
    if (prev === 0 && hostPanels.details > 0) {
      const current = shellRef.current.dock
      if (findRegion(current, REGION_DETAILS) === undefined) {
        actions.setDock(withRegion(current, REGION_DETAILS, 'right'))
      }
    }
  }, [hostPanels.details, actions])

  /* ── 布局工作台菜单：悬浮球事件 / Ctrl+Alt+L ── */
  useEffect(() => {
    const onToggle = (): void => { setMenuOpen(v => !v) }
    window.addEventListener(DOCK_MENU_TOGGLE_EVENT, onToggle)
    return () => { window.removeEventListener(DOCK_MENU_TOGGLE_EVENT, onToggle) }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.code !== 'KeyL') return
      e.preventDefault()
      setMenuOpen(v => !v)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [])

  const sidebarCollapsed = hostPanels.narrow ? !hostPanels.narrowExpanded : hostPanels.sidebar === 0
  const sidebarWidth = sidebarCollapsed ? (platform === 'darwin' ? 90 : 56) : hostPanels.sidebar

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => { setToast(null) }, 2600)
  }, [])

  /* ── 面板内容：区域 → renderSlot；扩展面板 → 注册表 ── */

  const openFileInDock = useCallback((path: string, rel: string): void => {
    const current = shellRef.current.dock
    const nodes = collectTabsNodes(current.root)
    for (const node of nodes) {
      const hit = node.tabs.find(p => p.type === 'code' && p.state?.rel === rel)
      if (hit !== undefined) { actions.setDock(setActivePanel(current, node.id, hit.id)); return }
    }
    for (const float of current.floats) {
      const hit = float.tabs.find(p => p.type === 'code' && p.state?.rel === rel)
      if (hit !== undefined) { actions.setDock(setActivePanel(current, float.id, hit.id)); return }
    }
    const next = structuredClone(current)
    const panel = { id: 'p' + String(next.seq++), type: 'code', title: baseName(rel), state: { rel, path } } as PanelInstance
    actions.setDock(addPanel(next, panel))
  }, [actions])

  const host: DockHostAccess = {
    sessionId,
    addFileToChat: dockHostBridge.addFileToChat,
    openPath: dockHostBridge.openPath,
    openFileInDock,
  }

  const renderPanelBody = (panel: PanelInstance): ReactNode => {
    switch (panel.type) {
      case REGION_SIDEBAR:
        return renderSlot('sidebar', { collapsed: sidebarCollapsed, width: sidebarWidth })
      case REGION_CONVERSATION:
        return renderSlot('conversation', {})
      case REGION_DETAILS:
        // 把会话 id 与宿主开合动作传给 details 面板（PreviewDetailsPanel），
        // 使其能感知会话切换并按会话记忆展开状态与宽度。
        return renderSlot('details', {
          sessionId: detailsSession,
          openDetails: () => hostLayout.openDetails(),
          closeDetails: () => hostLayout.closeDetails(),
        })
      default: {
        const def = panelDef(panel.type)
        if (def === undefined) return <div className={css.paneEmpty}>未知面板类型：{panel.type}</div>
        return def.render({ panel, host, onStatePatch: patch => { actions.setDock(patchPanel(shellRef.current.dock, panel.id, patch)) } })
      }
    }
  }

  /* ── 拖拽命中判定 ── */

  const computeDrop = useCallback((x: number, y: number): { target: DropTarget | null; rect: DragState['overRect'] } => {
    const rootEl = rootRef.current
    if (rootEl === null) return { target: null, rect: null }
    const rootRect = rootEl.getBoundingClientRect()
    if (x >= rootRect.left && x <= rootRect.right && y >= rootRect.top && y <= rootRect.bottom) {
      const dl = x - rootRect.left
      const dr = rootRect.right - x
      const dt = y - rootRect.top
      const db = rootRect.bottom - y
      const min = Math.min(dl, dr, dt, db)
      if (min <= EDGE_STRIP) {
        if (min === dl) return { target: { kind: 'edge', side: 'left' }, rect: { left: rootRect.left, top: rootRect.top, width: Math.max(48, rootRect.width * 0.25), height: rootRect.height } }
        if (min === dr) return { target: { kind: 'edge', side: 'right' }, rect: { left: rootRect.right - Math.max(48, rootRect.width * 0.25), top: rootRect.top, width: Math.max(48, rootRect.width * 0.25), height: rootRect.height } }
        if (min === dt) return { target: { kind: 'edge', side: 'top' }, rect: { left: rootRect.left, top: rootRect.top, width: rootRect.width, height: Math.max(48, rootRect.height * 0.25) } }
        return { target: { kind: 'edge', side: 'bottom' }, rect: { left: rootRect.left, top: rootRect.bottom - Math.max(48, rootRect.height * 0.25), width: rootRect.width, height: Math.max(48, rootRect.height * 0.25) } }
      }
    }
    const panes = Array.from(rootEl.querySelectorAll('[data-dock-node]')) as HTMLElement[]
    for (const pane of panes) {
      const rect = pane.getBoundingClientRect()
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue
      const nodeId = pane.getAttribute('data-dock-node') ?? ''
      const fx = (x - rect.left) / rect.width
      const fy = (y - rect.top) / rect.height
      const inLeft = fx < ZONE_RATIO
      const inRight = fx > 1 - ZONE_RATIO
      const inTop = fy < ZONE_RATIO
      const inBottom = fy > 1 - ZONE_RATIO
      if (inLeft || inRight || inTop || inBottom) {
        let side: 'left' | 'right' | 'top' | 'bottom'
        if ((inLeft || inRight) && (inTop || inBottom)) {
          const hx = inLeft ? fx : 1 - fx
          const hy = inTop ? fy : 1 - fy
          side = hx < hy ? (inLeft ? 'left' : 'right') : (inTop ? 'top' : 'bottom')
        } else if (inLeft) side = 'left'
        else if (inRight) side = 'right'
        else if (inTop) side = 'top'
        else side = 'bottom'
        const half = side === 'left' || side === 'right'
          ? { left: side === 'left' ? rect.left : rect.left + rect.width / 2, top: rect.top, width: rect.width / 2, height: rect.height }
          : { left: rect.left, top: side === 'top' ? rect.top : rect.top + rect.height / 2, width: rect.width, height: rect.height / 2 }
        return { target: { kind: 'split', nodeId, side }, rect: half }
      }
      const tabsCount = pane.querySelectorAll('[data-testid="dock-tab-chip"]').length
      return { target: { kind: 'tab', nodeId, index: tabsCount }, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }
    }
    return { target: null, rect: null }
  }, [])

  /* ── HTML5 外部拖入（右侧标签面板标签 → 布局落点） ── */

  useEffect(() => {
    const rootEl = rootRef.current
    if (rootEl === null) return
    const hasSideTab = (e: DragEvent): boolean =>
      Array.from(e.dataTransfer?.types ?? []).includes(SIDE_TAB_MIME)
    const onDragOver = (e: DragEvent): void => {
      if (!hasSideTab(e)) return
      // 拖到右侧标签面板自身内部（其 48px 标签条/内容区）不接管：
      // 那里保留 SidePane 自己的内部排序语义，不触发布局落点。
      if (e.target instanceof Element && e.target.closest('[data-liuli-side-pane]') !== null) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'move'
      htmlDragActive.current = true
      const { target, rect } = computeDrop(e.clientX, e.clientY)
      setHtmlDrop({ over: target, rect })
    }
    const onDragLeave = (e: DragEvent): void => {
      if (!htmlDragActive.current) return
      // 离开 root 自身才算离开（子元素间移动不算）。
      const next = e.relatedTarget instanceof Node ? e.relatedTarget : null
      if (!rootEl.contains(next)) {
        htmlDragActive.current = false
        setHtmlDrop(null)
      }
    }
    const onDrop = (e: DragEvent): void => {
      if (!hasSideTab(e)) return
      e.preventDefault()
      htmlDragActive.current = false
      const raw = e.dataTransfer?.getData(SIDE_TAB_MIME) ?? ''
      const tab = parseSideTab(raw)
      const mapped: SideTabDockPanel | undefined = tab === undefined ? undefined : sideTabToDockPanel(tab)
      setHtmlDrop(null)
      if (tab === undefined || mapped === undefined) return
      const { target } = computeDrop(e.clientX, e.clientY)
      markSideTabAccepted()
      const current = shellRef.current.dock
      const next = structuredClone(current)
      const panel = createPanel(next, mapped.type, mapped.title, mapped.state)
      actions.setDock(placePanel(next, panel, target ?? { kind: 'edge', side: 'right' }))
    }
    rootEl.addEventListener('dragover', onDragOver)
    rootEl.addEventListener('dragleave', onDragLeave)
    rootEl.addEventListener('drop', onDrop)
    return () => {
      rootEl.removeEventListener('dragover', onDragOver)
      rootEl.removeEventListener('dragleave', onDragLeave)
      rootEl.removeEventListener('drop', onDrop)
    }
  }, [computeDrop, actions])

  const beginDrag = useCallback((e: React.PointerEvent, source: DragSource, title: string): void => {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = { source, title, sx: e.clientX, sy: e.clientY, active: false }
    setDrag({ source, title, x: e.clientX, y: e.clientY, over: null, overRect: null })
    const onMove = (ev: PointerEvent): void => {
      const info = dragRef.current
      if (info === null) return
      if (!info.active) {
        if (Math.hypot(ev.clientX - info.sx, ev.clientY - info.sy) < DRAG_THRESHOLD) return
        info.active = true
      }
      const { target, rect } = computeDrop(ev.clientX, ev.clientY)
      setDrag({ source: info.source, title: info.title, x: ev.clientX, y: ev.clientY, over: target, overRect: rect })
    }
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      const info = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (info === null) return
      if (!info.active) {
        if (info.source.panelId !== undefined) actions.setDock(setActivePanel(shellRef.current.dock, info.source.containerId, info.source.panelId))
        return
      }
      const { target } = computeDrop(ev.clientX, ev.clientY)
      const rootEl = rootRef.current
      const rootRect = rootEl?.getBoundingClientRect()
      const floatAt = (): DropTarget => ({
        kind: 'float',
        x: Math.max(8, Math.min(ev.clientX - 120, (rootRect?.right ?? window.innerWidth) - 300)),
        y: Math.max(44, Math.min(ev.clientY - 16, (rootRect?.bottom ?? window.innerHeight) - 200)),
      })
      const current = shellRef.current.dock
      if (info.source.kind === 'node' && info.source.panelId !== undefined) {
        actions.setDock(movePanel(current, info.source.panelId, target ?? floatAt()))
      } else if (info.source.kind === 'float') {
        actions.setDock(moveFloat(current, info.source.containerId, target ?? floatAt(), info.source.panelId))
      }
    }
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('keydown', onKey)
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('keydown', onKey)
  }, [actions, computeDrop])

  /* ── sash 缩放（复用桌面 dshDesktopResizeHandle 外观） ── */

  const beginSash = useCallback((e: React.PointerEvent, splitNode: SplitNode, dividerIndex: number, dir: 'h' | 'v'): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const container = (e.currentTarget as HTMLElement).parentElement
    const rect = container?.getBoundingClientRect()
    if (rect === undefined) return
    const total = dir === 'h' ? rect.width : rect.height
    if (total <= 0) return
    // 固定宽度区域（侧栏/详情）的 sash 走宿主 layout 服务（原生宽度语义 + clamp），
    // 其余 sash 按 split 比例缩放。锚定边在拖拽中不动，故按下时取一次面板 rect 即可。
    const beforeChild = splitNode.children[dividerIndex - 1]
    const afterChild = splitNode.children[dividerIndex]
    const beforeType = beforeChild !== undefined ? fixedRegionType(beforeChild) : undefined
    const afterType = afterChild === undefined ? undefined : fixedRegionType(afterChild)
    const regionType = beforeType ?? afterType
    let regionPaneRect: DOMRect | undefined
    let regionShardEl: HTMLElement | null = null
    const regionNodeId = beforeType !== undefined && beforeChild !== undefined
      ? beforeChild.id
      : afterType !== undefined && afterChild !== undefined ? afterChild.id : undefined
    if (regionNodeId !== undefined) {
      const el = document.querySelector('[data-dock-node="' + regionNodeId + '"]')
      if (el instanceof HTMLElement) {
        regionPaneRect = el.getBoundingClientRect()
        regionShardEl = el.parentElement
      }
    }
    const start = dir === 'h' ? e.clientX : e.clientY
    const startRatio = splitNode.sizes[dividerIndex - 1] ?? 0.5
    // 拖拽期间禁用 shard 宽度过渡（flex-basis 每帧变化，过渡会滞后/跟手性差），
    // 对齐官方 AppFrame 的 [data-dragging] { transition: none }。
    const rootEl = rootRef.current
    rootEl?.setAttribute('data-resizing', '')
    // 缩放性能护栏：冻结宿主产物行 RO、关闭磨砂/过渡（body[data-liuli-resizing]）。
    beginResizePerf()
    // 可变 split 直写路径：拖拽期间直接把比例写进相邻两 shard 的 flexGrow，
    // 避免每帧 actions.setDock 触发整棵 dock 树重渲染；松开后一次性提交最终比例。
    // 语义对齐 renderNode：可变 shard 的 flexGrow = sizes[i]/growSum，且 resizeSplitTo
    // 保持两 shard 尺寸之和不变，故 growSum 拖拽中恒定，其余 shard 不受影响。
    let variableShards: { before: HTMLElement; after: HTMLElement; growSum: number; sizesTotal: number } | undefined
    if (regionType === undefined) {
      const splitEl = rootEl?.querySelector('[data-dock-split="' + splitNode.id + '"]') ?? null
      if (splitEl !== null) {
        // 直接子级里按 shard 类过滤出有序 shard 列（收起态子级不渲染 sash，
        // 不能用 2*i 下标推算），与 splitNode.children 一一对应。
        const shardEls = Array.from(splitEl.children)
          .filter((el): el is HTMLElement => el instanceof HTMLElement && css.shard !== undefined && el.classList.contains(css.shard))
        const beforeEl = shardEls[dividerIndex - 1]
        const afterEl = shardEls[dividerIndex]
        if (beforeEl !== undefined && afterEl !== undefined) {
          const fixedFlags = splitNode.children.map(child => childFixedWidth(child) !== undefined)
          const growSum = splitNode.sizes.reduce((acc, s, i) => acc + (fixedFlags[i] === true ? 0 : (s ?? 1)), 0)
          const sizesTotal = (splitNode.sizes[dividerIndex - 1] ?? 0.5) + (splitNode.sizes[dividerIndex] ?? 0.5)
          if (growSum > 0) variableShards = { before: beforeEl, after: afterEl, growSum, sizesTotal }
        }
      }
    }
    let lastRatio = startRatio
    // 固定区域（侧栏/详情）拖拽时直接写 shard 的 flex-basis，避免每帧触发
    // React 状态更新 / localStorage 写入导致的卡顿；松开后再提交最终宽度。
    let lastRegionSize = regionPaneRect !== undefined
      ? (dir === 'h' ? regionPaneRect.width : regionPaneRect.height)
      : 0
    const onMove = (ev: PointerEvent): void => {
      if (regionType !== undefined && regionPaneRect !== undefined) {
        const isBefore = beforeType !== undefined
        const newSize = dir === 'h'
          ? (isBefore ? ev.clientX - regionPaneRect.left : regionPaneRect.right - ev.clientX)
          : (isBefore ? ev.clientY - regionPaneRect.top : regionPaneRect.bottom - ev.clientY)
        if (regionType === REGION_DETAILS) {
          // 详情区域宽度由 liuli 自管（上限 = 视口 88%），不再走宿主 clamp 300-520。
          const maxW = Math.max(240, Math.round(window.innerWidth * 0.88))
          lastRegionSize = Math.min(maxW, Math.max(240, Math.round(newSize)))
        } else {
          lastRegionSize = newSize
        }
        if (regionShardEl !== null) regionShardEl.style.flexBasis = lastRegionSize + 'px'
        return
      }
      const pos = dir === 'h' ? ev.clientX : ev.clientY
      const ratio = startRatio + (pos - start) / total
      lastRatio = ratio
      if (variableShards !== undefined) {
        // clamp 语义与 dock-model resizeSplitTo 完全一致。
        const { growSum, sizesTotal } = variableShards
        let na = Math.max(MIN_SIZE * sizesTotal, Math.min(sizesTotal - MIN_SIZE * sizesTotal, ratio * sizesTotal))
        if (!Number.isFinite(na)) na = sizesTotal / 2
        variableShards.before.style.flexGrow = String(na / growSum)
        variableShards.after.style.flexGrow = String((sizesTotal - na) / growSum)
        return
      }
      actions.setDock(resizeSplitTo(shellRef.current.dock, splitNode.id, dividerIndex, ratio))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      rootEl?.removeAttribute('data-resizing')
      endResizePerf()
      if (regionType === REGION_SIDEBAR) {
        hostLayout.setSidebar(Math.round(lastRegionSize))
      } else if (regionType === REGION_DETAILS) {
        setDetailsWidth(Math.round(lastRegionSize))
      } else if (variableShards !== undefined) {
        // 提交最终比例：重渲染写回的 flexGrow 与拖拽直写值同公式，无视觉跳变。
        actions.setDock(resizeSplitTo(shellRef.current.dock, splitNode.id, dividerIndex, lastRatio))
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [actions, hostLayout])

  /* ── 渲染 ── */

  const renderTabChip = (panel: PanelInstance, containerId: string, sourceKind: 'node' | 'float'): ReactNode => {
    const region = isRegionPanel(panel.type)
    const title = region ? regionLabel(panel.type) : panelTitle(panel)
    const active = sourceKind === 'node'
      ? (collectTabsNodes(shellRef.current.dock.root).find(n => n.id === containerId)?.activeId === panel.id)
      : (dock.floats.find(f => f.id === containerId)?.activeId === panel.id)
    return (
      <div
        key={panel.id}
        className={css.tabChip + (active ? ' ' + css.tabChipActive : '')}
        data-testid="dock-tab-chip"
        data-panel-id={panel.id}
        data-region={region ? panel.type : undefined}
        data-active={active || undefined}
        title={title}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('[data-testid="dock-tab-close"], [data-testid="dock-tab-float"]') !== null) return
          beginDrag(e, { kind: sourceKind, containerId, panelId: panel.id }, title)
        }}
      >
        <span className={css.tabLabel}>{title}</span>
        {sourceKind === 'node' && (
          <button
            type="button"
            className={css.tabFloat}
            data-testid="dock-tab-float"
            title={'将 ' + title + ' 浮动为独立窗口'}
            aria-label={'将 ' + title + ' 浮动为独立窗口'}
            onPointerDown={(e) => { e.stopPropagation() }}
            onClick={(e) => {
              e.stopPropagation()
              floatPanelCentered(panel.id)
            }}
          >
            ⧉
          </button>
        )}
        {panel.type !== REGION_CONVERSATION && panel.type !== REGION_SIDEBAR && (
          <button
            type="button"
            className={css.tabClose}
            data-testid="dock-tab-close"
            aria-label={'关闭 ' + title}
            onPointerDown={(e) => { e.stopPropagation() }}
            onClick={(e) => {
              e.stopPropagation()
              if (panel.type === REGION_DETAILS) {
                hostLayout.closeDetails()
                return
              }
              actions.setDock(closePanelOf(shellRef.current.dock, panel.id))
            }}
          >
            ×
          </button>
        )}
      </div>
    )
  }

  /** 悬停抓握点：单区域面板的唯一拖拽入口（平时隐藏，hover 显形）。 */
  /** 一键浮动：无边框改造移除了 caption 拖拽悬浮区，单标签面板的抓握簇（⧉）
   *  与多标签 chip（⧉）都走这里——点击即把面板抽出为居中浮动窗口。 */
  const floatPanelCentered = (panelId: string): void => {
    const x = Math.max(8, Math.round((window.innerWidth - 480) / 2))
    const y = Math.max(44, Math.round((window.innerHeight - 360) / 3))
    actions.setDock(movePanel(shellRef.current.dock, panelId, { kind: 'float', x, y }))
  }

  const renderGrip = (node: TabsNode): ReactNode => {
    const draggable = node.tabs[0]
    if (draggable === undefined || node.tabs.length > 1) return null
    return (
      <div className={css.gripCluster}>
        <div
          className={css.grip}
          data-testid="dock-grip"
          role="button"
          title="拖动以自定义布局"
          aria-label="拖动以自定义布局"
          onPointerDown={(e) => { beginDrag(e, { kind: 'node', containerId: node.id, panelId: draggable.id }, isRegionPanel(draggable.type) ? regionLabel(draggable.type) : panelTitle(draggable)) }}
        />
        <button
          type="button"
          className={css.gripFloat}
          data-testid="dock-grip-float"
          title="将此面板浮动为独立窗口"
          aria-label="将此面板浮动为独立窗口"
          onClick={() => { floatPanelCentered(draggable.id) }}
        >
          ⧉
        </button>
      </div>
    )
  }

  /** 区域固定宽度（默认布局保真）：单区域侧栏/详情按宿主宽度语义，
   *  让 split 的对应 shard 用精确 px，而非会跟比例打架的 flex-grow。
   *  详情关闭时返回 0（而非 undefined）：面板常驻树中，宽度 0 保持挂载，
   *  开合由 flex-basis 过渡驱动，会话列平滑补位。 */
  const childFixedWidth = (child: DockNode): number | undefined => {
    if (child.kind !== 'tabs' || child.tabs.length !== 1) return undefined
    const only = child.tabs[0]
    if (only === undefined) return undefined
    if (only.type === REGION_SIDEBAR) return sidebarWidth
    if (only.type === REGION_DETAILS) return hostPanels.details === 0 ? 0 : detailsWidth
    return undefined
  }

  /** 单区域侧栏/详情面板的区域类型（用于把 sash 缩放到宿主 layout 服务）。 */
  const fixedRegionType = (child: DockNode): string | undefined => {
    if (child.kind !== 'tabs' || child.tabs.length !== 1) return undefined
    const only = child.tabs[0]
    if (only === undefined) return undefined
    if (only.type === REGION_SIDEBAR) return REGION_SIDEBAR
    if (only.type === REGION_DETAILS) return REGION_DETAILS
    return undefined
  }

  const renderTabsNode = (node: TabsNode): ReactNode => {
    const active = node.tabs.find(p => p.id === node.activeId) ?? node.tabs[0]
    const only = node.tabs.length === 1 ? node.tabs[0] : undefined
    const regionType = only !== undefined && isRegionPanel(only.type) ? only.type : undefined
    const surface = regionType !== undefined ? surfaceClass(regionType) : ''
    // 单区域 = 原生表面直出（无附加 chrome）；多标签 = 表面 + 细标签条
    if (only !== undefined && regionType !== undefined) {
      return (
        <div
          className={surface + ' ' + css.pane}
          data-dock-node={node.id}
          data-testid="dock-pane"
          data-region-pane={regionType}
        >
          {regionType === REGION_SIDEBAR
            ? <div className="dshDesktopUpstreamSidebar">{renderPanelBody(only)}</div>
            : renderPanelBody(only)}
          {renderGrip(node)}
          {/* 开始页（会话 header 隐藏）顶部拖动区：CSS 仅在 header[aria-hidden] 时激活 */}
          {regionType === REGION_CONVERSATION && <div className={css.paneTopDrag} data-liuli-pane-drag="" aria-hidden="true" />}
        </div>
      )
    }
    return (
      <div
        className={css.pane + (surface !== '' ? ' ' + surface : '')}
        data-dock-node={node.id}
        data-testid="dock-pane"
      >
        <div className={css.tabStrip} data-testid="dock-tab-strip">
          {node.tabs.map(p => renderTabChip(p, node.id, 'node'))}
          <div className={css.tabFiller} />
        </div>
        <div className={css.paneBody}>
          {active === undefined ? <div className={css.paneEmpty}>（空面板组）</div> : renderPanelBody(active)}
        </div>
      </div>
    )
  }

  const renderNode = (node: DockNode): ReactNode => {
    if (node.kind === 'tabs') return renderTabsNode(node)
    const split = node
    // 单区域侧栏/详情 → shard 用宿主宽度的精确 px（与原生壳一致）；其余按
    // split 比例分配剩余空间。flex-grow 总和 < 1 时浏览器只给出 free×grow
    // （留出空隙），故把「可伸缩子级」的 sizes 归一到和为 1，既保比例又吃满
    // 剩余空间。sash 作为 flex 成员恰好落在相邻面板的分界上。
    const fixedFlags = split.children.map(child => childFixedWidth(child) !== undefined)
    const growSum = split.sizes.reduce((acc, s, i) => acc + (fixedFlags[i] === true ? 0 : (s ?? 1)), 0)
    return (
      <div className={(split.dir === 'h' ? css.splitH : css.splitV) + ' ' + css.splitBox} data-dock-split={split.id}>
        {split.children.map((child, i) => {
          const fixed = fixedFlags[i] === true ? childFixedWidth(child) : undefined
          // 固定宽度 shard 用分属性（flexGrow/flexShrink/flexBasis）而非 flex 简写：
          // CSS 过渡按 flex-basis 插值（简写过渡在部分浏览器不稳定），开合动画即
          // 由此驱动；flex-basis 为 0 时保持挂载（详情收起），便于 0↔w 平滑过渡。
          const shardStyle = fixed !== undefined
            ? { flexGrow: 0, flexShrink: 0, flexBasis: String(fixed) + 'px' }
            : { flexGrow: growSum > 0 ? (split.sizes[i] ?? 1) / growSum : 1, flexBasis: 0, flexShrink: 1 }
          // 收起态（固定宽度 0）的面板与相邻面板间不渲染 sash：官方 AppFrame 在
          // details 关闭时不渲染拖拽把手（cols.details > 0 才挂），避免窗口最右缘
          // 出现隐形的 col-resize 拖拽带。
          const collapsed = fixed !== undefined && fixed === 0
          return (
            <Fragment key={child.id}>
              {i > 0 && !collapsed && (
                <div
                  className={split.dir === 'h' ? css.sashH : css.sashV}
                  data-testid="dock-sash"
                  data-side={split.dir === 'h' ? 'sidebar' : 'details'}
                  onPointerDown={(e) => { beginSash(e, split, i, split.dir) }}
                />
              )}
              <div className={css.shard} style={shardStyle}>
                {renderNode(child)}
              </div>
            </Fragment>
          )
        })}
      </div>
    )
  }

  const renderFloat = (float: FloatWindow): ReactNode => {
    const active = float.tabs.find(p => p.id === float.activeId) ?? float.tabs[0]
    return (
      <ShellFloatWindow
        key={float.id}
        float={float}
        active={active}
        renderTabChip={renderTabChip}
        renderPanelBody={renderPanelBody}
        onDockBack={() => {
          const side = float.x + float.w / 2 < window.innerWidth / 2 ? 'left' as const : 'right' as const
          actions.setDock(moveFloat(shellRef.current.dock, float.id, { kind: 'edge', side }))
        }}
        onCloseAll={() => {
          let next = shellRef.current.dock
          for (const tab of [...float.tabs]) next = closePanelOf(next, tab.id)
          actions.setDock(next)
        }}
        onMoveBox={(box) => { actions.setDock(updateFloat(shellRef.current.dock, float.id, box)) }}
      />
    )
  }

  const slots = listShellSlotNames()
  void slotsVersion

  return (
    <div
      className="dshDesktopFrame"
      data-desktop-platform={platform}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={hostPanels.details === 0 || undefined}
      data-testid="dock-shell"
      data-hmr-marker={HMR_MARKER}
      data-panels={String(panelCount(dock))}
    >
      {/* win32 无边框：移除 caption 行，画布从第 1 行起占满（窗口拖拽改由
          WindowControls 承担、面板悬浮改由 grip ⧉ 按钮承担）。
          macOS 保留 caption 行（红绿灯留白 + 窗口拖拽区）。 */}
      {platform === 'darwin' && <div className="dshDesktopMacCaptionRow" aria-hidden="true" />}
      <div
        className={css.dockBody}
        ref={rootRef}
        data-testid="dock-root"
        style={platform === 'darwin' ? { gridRow: '2 / -1' } : undefined}
      >
        {dock.root !== null && renderNode(dock.root)}
        {dock.floats.map(renderFloat)}
        {drag !== null && drag.overRect !== null && drag.over !== null && (
          <div
            className={css.dropIndicator}
            data-testid="dock-drop-indicator"
            data-kind={drag.over.kind}
            style={{ left: drag.overRect.left, top: drag.overRect.top, width: drag.overRect.width, height: drag.overRect.height }}
          />
        )}
        {htmlDrop !== null && htmlDrop.over !== null && htmlDrop.rect !== null && (
          <div
            className={css.dropIndicator}
            data-testid="dock-drop-indicator"
            data-kind={htmlDrop.over.kind}
            data-source="side-tab"
            style={{ left: htmlDrop.rect.left, top: htmlDrop.rect.top, width: htmlDrop.rect.width, height: htmlDrop.rect.height }}
          />
        )}
      </div>
      <div className="dshDesktopOverlay" data-shell-overlay="">
        {renderSlot('shell.overlay', {})}
      </div>
      {drag !== null && dragRef.current?.active === true && <div className={css.dragShield} data-testid="dock-drag-shield" />}
      {drag !== null && dragRef.current?.active === true && (
        <div className={css.dragGhost} data-testid="dock-drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>{drag.title}</div>
      )}
      {menuOpen && (
        <div className={css.menuCard} data-testid="dock-menu-card">
          <div className={css.menuHead}>
            <span className={css.menuTitle}>布局工作台</span>
            <button type="button" className={css.tabClose} data-testid="dock-menu-close" aria-label="关闭布局菜单" onClick={() => { setMenuOpen(false) }}>×</button>
          </div>
          <div className={css.menuSection}>
            <button type="button" className={css.menuBtn} data-testid="dock-add-button" onClick={() => { setAddOpen(v => !v) }}>＋ 添加面板</button>
            {addOpen && (
              <div className={css.addGrid} data-testid="dock-add-menu">
                {DOCK_PANEL_DEFS.map(def => (
                  <button
                    key={def.type}
                    type="button"
                    className={css.addMenuItem}
                    data-testid={'dock-add-' + def.type}
                    onClick={() => {
                      const next = structuredClone(shellRef.current.dock)
                      const panel = { id: 'p' + String(next.seq++), type: def.type } as PanelInstance
                      actions.setDock(addPanel(next, panel))
                      setAddOpen(false)
                      notify('已添加：' + def.label)
                    }}
                  >
                    {def.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={css.menuSection}>
            <div className={css.menuRow}>
              <input className={css.slotInput} data-testid="dock-slot-name" value={slotName} placeholder="布局名" onChange={(e) => { setSlotName(e.target.value) }} />
              <button type="button" className={css.menuBtn} data-testid="dock-save-button" onClick={() => {
                const name = slotName.trim() === '' ? '默认布局' : slotName.trim()
                saveShellSlotByName(name, shellRef.current.dock)
                saveShellDock(shellRef.current.dock)
                setSlotsVersion(v => v + 1)
                notify('已保存布局：' + name)
              }}>保存</button>
            </div>
            <div className={css.menuRow}>
              <select className={css.slotSelect} data-testid="dock-slot-select" defaultValue="">
                <option value="" disabled>选择布局…</option>
                {slots.map(slot => <option key={slot.name} value={slot.name}>{slot.name}</option>)}
              </select>
              <button type="button" className={css.menuBtn} data-testid="dock-restore-button" onClick={() => {
                const select = document.querySelector('[data-testid="dock-slot-select"]') as HTMLSelectElement | null
                const name = select?.value ?? ''
                if (name === '') { notify('请先选择要恢复的布局'); return }
                const loaded = loadShellSlotByName(name)
                if (loaded !== undefined) { actions.resetShell(); actions.setDock(loaded); notify('已恢复布局：' + name) }
                else notify('恢复失败：' + name)
              }}>恢复</button>
            </div>
            <div className={css.menuRow}>
              <button type="button" className={css.menuBtn} data-testid="dock-export-button" onClick={() => { setModal({ kind: 'export', text: exportDockJSON(shellRef.current.dock) }) }}>导出</button>
              <button type="button" className={css.menuBtn} data-testid="dock-import-button" onClick={() => { setModal({ kind: 'import', text: '' }) }}>导入</button>
              <button type="button" className={css.menuBtn} data-testid="dock-reset-button" onClick={() => { actions.resetShell(); notify('已重置为默认布局') }}>重置</button>
            </div>
          </div>
        </div>
      )}
      {modal !== null && (
        <div className={css.modalOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) setModal(null) }}>
          <div className={css.modalCard} data-testid="dock-modal">
            <div className={css.modalTitle}>{modal.kind === 'export' ? '导出 Workspace JSON' : '导入 Workspace JSON'}</div>
            <textarea
              className={css.modalText}
              data-testid="dock-modal-text"
              value={modal.text}
              readOnly={modal.kind === 'export'}
              onChange={(e) => { setModal({ ...modal, text: e.target.value }) }}
            />
            <div className={css.modalActions}>
              {modal.kind === 'export' && (
                <button type="button" className={css.menuBtn} data-testid="dock-modal-copy" onClick={() => { void navigator.clipboard?.writeText(modal.text).then(() => { notify('已复制到剪贴板') }).catch(() => { notify('复制失败') }) }}>复制</button>
              )}
              {modal.kind === 'import' && (
                <button type="button" className={css.menuBtn} data-testid="dock-modal-apply" onClick={() => {
                  const imported = importDockJSON(modal.text)
                  if (imported !== undefined) { actions.resetShell(); actions.setDock(imported); setModal(null); notify('导入成功') }
                  else notify('导入失败：JSON 无效或布局为空')
                }}>应用</button>
              )}
              <button type="button" className={css.menuBtn} data-testid="dock-modal-close" onClick={() => { setModal(null) }}>关闭</button>
            </div>
          </div>
        </div>
      )}
      {toast !== null && <div className={css.toast} data-testid="dock-toast">{toast}</div>}
      <div className={css.summary} data-testid="dock-summary" aria-hidden="true">
        {JSON.stringify({
          panels: panelCount(dock),
          groups: collectTabsNodes(dock.root).length,
          floats: dock.floats.length,
          rootKind: dock.root?.kind ?? 'empty',
          sidebar: hostPanels.sidebar,
          details: hostPanels.details,
        })}
      </div>
    </div>
  )
}

/* ── 辅助：面板关闭 ── */

function closePanelOf(layout: DockLayout, panelId: string): DockLayout {
  return removePanel(layout, panelId)
}

/* ── 浮动窗口 ── */

interface ShellFloatWindowProps {
  float: FloatWindow
  active: PanelInstance | undefined
  renderTabChip: (panel: PanelInstance, containerId: string, sourceKind: 'float') => ReactNode
  renderPanelBody: (panel: PanelInstance) => ReactNode
  onDockBack: () => void
  onCloseAll: () => void
  onMoveBox: (box: { x: number; y: number; w: number; h: number }) => void
}

function ShellFloatWindow({ float, active, renderTabChip, renderPanelBody, onDockBack, onCloseAll, onMoveBox }: ShellFloatWindowProps) {
  const [box, setBox] = useState({ x: float.x, y: float.y, w: float.w, h: float.h })
  const boxRef = useRef(box)
  boxRef.current = box
  const dragging = useRef<null | { mode: 'move' | 'resize'; sx: number; sy: number; box: { x: number; y: number; w: number; h: number } }>(null)

  useEffect(() => {
    setBox({ x: float.x, y: float.y, w: float.w, h: float.h })
  }, [float.x, float.y, float.w, float.h])

  const beginFloatDrag = (e: React.PointerEvent, mode: 'move' | 'resize'): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragging.current = { mode, sx: e.clientX, sy: e.clientY, box }
    const onMove = (ev: PointerEvent): void => {
      const info = dragging.current
      if (info === null) return
      const dx = ev.clientX - info.sx
      const dy = ev.clientY - info.sy
      if (info.mode === 'move') {
        const nx = Math.max(0, Math.min(info.box.x + dx, window.innerWidth - 60))
        const ny = Math.max(36, Math.min(info.box.y + dy, window.innerHeight - 40))
        setBox({ ...info.box, x: nx, y: ny })
      } else {
        const nw = Math.max(240, Math.min(info.box.w + dx, window.innerWidth - box.x))
        const nh = Math.max(160, Math.min(info.box.h + dy, window.innerHeight - box.y))
        setBox({ ...info.box, w: nw, h: nh })
      }
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const info = dragging.current
      dragging.current = null
      if (info === null) return
      onMoveBox(boxRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const title = active === undefined ? '浮动窗口' : isRegionPanel(active.type) ? regionLabel(active.type) : panelTitle(active)
  return (
    <div
      className={css.floatWindow}
      data-testid="dock-float"
      data-float-id={float.id}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      <div
        className={css.floatTitle}
        data-testid="dock-float-title"
        onPointerDown={(e) => { beginFloatDrag(e, 'move') }}
        onDoubleClick={onDockBack}
        title="拖动移动；双击停靠回布局"
      >
        <span className={css.floatGrip} aria-hidden="true">⠿</span>
        <span className={css.floatTitleText}>{title}</span>
        <button
          type="button"
          className={css.floatBtn}
          data-testid="dock-float-dock"
          aria-label="停靠回布局"
          title="停靠回布局"
          onPointerDown={(e) => { e.stopPropagation() }}
          onClick={onDockBack}
        >
          ⇦
        </button>
        <button
          type="button"
          className={css.floatBtn}
          data-testid="dock-float-close"
          aria-label="关闭浮动窗口"
          onPointerDown={(e) => { e.stopPropagation() }}
          onClick={onCloseAll}
        >
          ×
        </button>
      </div>
      <div className={css.tabStrip}>
        {float.tabs.map(p => renderTabChip(p, float.id, 'float'))}
        <div className={css.tabFiller} />
      </div>
      <div className={css.paneBody}>
        {active === undefined ? <div className={css.paneEmpty}>（空）</div> : renderPanelBody(active)}
      </div>
      <div
        className={css.floatResize}
        data-testid="dock-float-resize"
        onPointerDown={(e) => { beginFloatDrag(e, 'resize') }}
        aria-hidden="true"
      />
    </div>
  )
}