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
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  addPanel, collectTabsNodes, createPanel, findNode, findParentSplit, findTabsContaining, MIN_SIZE, moveFloat, movePanel, panelCount,
  patchPanel, placePanel, removePanel, resizeSplitTo, setActivePanel, updateFloat,
  type DockLayout, type DockNode, type DropTarget, type FloatWindow, type PanelInstance, type SplitNode, type TabsNode,
} from './dock-model.ts'
import { DOCK_PANEL_DEFS, panelDef, panelTitle, type DockHostAccess } from './dock-panels.tsx'
import type { SidePaneHostAccess } from './SidePaneExtraPanels.tsx'
import { dockPanelToSideTab, markSideTabAccepted, openSidePaneTab, parseSideTab, reportDockPanelTypes, SIDE_TAB_MIME, sideTabToDockPanel, type SideTabDockPanel } from './side-tab-dock.ts'
import { REVIEW_DRIVE_EVENT, REVIEW_FILE_EVENT } from './review-bus.ts'
import {
  createDockShellStore, defaultShellLayout, exportDockJSON, findRegion, importDockJSON, isRegionPanel,
  listShellSlotNames, loadSavedDock, loadShellSlotByName, regionLabel, saveShellDock,
  saveShellSlotByName, stripRegionPanels, withRegion,
  CONVERSATION_HEADER_MIN_H, CONVERSATION_MIN, DETAILS_MAX_RATIO, DETAILS_MIN, REGION_CONVERSATION, REGION_CONVERSATION_HEADER, REGION_DETAILS, REGION_SIDEBAR, SIDEBAR_MAX, SIDEBAR_MIN,
  type HostLayoutFace,
} from './dock-shell.ts'
import { HEADER_HEIGHT_LS_KEY, HEADER_MAX_H, HEADER_MIN_H } from './HeaderEffects.tsx'
import { LIULI_LS_KEY, liuliSettingsOf } from '../liuli-settings.ts'
import css from './DockShellFrame.module.css'
import { HMR_MARKER } from './hmr-marker.ts'
import { tagConversationContainers } from './conversation-split.ts'
import { beginResizePerf, endResizePerf } from './resize-perf.ts'

/* ── 右侧边栏系列增强开关（与 client/index.ts 的 unofficial('sidebar') 同源） ──
 *  client/index.ts 在启动时按「总开关 && 右侧边栏组」写入 window.__liuliSidebarEnabled__；
 *  DockShellFrame 在其后挂载，直接读取即可；异常/降级时回退读 localStorage。
 *  开关变更页会整页重载（loadRemoteState），本组件无需响应式更新。 */
function isSidebarEnhancementEnabled(): boolean {
  const w = window as unknown as { __liuliSidebarEnabled__?: boolean }
  if (w.__liuliSidebarEnabled__ !== undefined) return w.__liuliSidebarEnabled__
  try {
    const raw = localStorage.getItem(LIULI_LS_KEY)
    if (raw === null || raw === '') return true
    const s = liuliSettingsOf(JSON.parse(raw))
    return s.unofficial_enabled && s.unofficial_sidebar
  } catch { return true }
}

/* ── ctx 能力桥（index.ts 注入；纯组件不碰 cordis） ── */

let dockHostBridge: {
  addFileToChat?: (path: string) => void
  openPath?: (path: string) => void
  sidePaneHost?: SidePaneHostAccess | undefined
} = {}

export function setDockHostBridge(bridge: {
  addFileToChat?: (path: string) => void
  openPath?: (path: string) => void
  sidePaneHost?: SidePaneHostAccess | undefined
}): void {
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

/** 非区域 dock 面板（拆出来的标签页）的最小宽/高：sash 拖到极限也不会更小。 */
const PANE_CARD_MIN_W = 240
const PANE_CARD_MIN_H = 160

/** 当前是否运行在 DSH Desktop advanced（无边框）壳内（URL 参数由桌面壳注入）。
 *  Web UI（兼容模式/纯浏览器）下琉璃帧渲染 data-shell-mode="web" 标记，
 *  WEB_DOCK_SHELL_CSS 据此提供桌面 ADVANCED_STYLES 缺位时的等价壳样式。 */
export function isAdvancedShell(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('dsh-desktop-mode') === 'advanced'
  } catch { return false }
}

/** 会话 header 的定位选择器：官方槽位容器（display:contents）直下 header，或 phase 直下 header。
 *  不要用 `div[data-phase] header` 全量匹配 —— 提问卡片（QuestionComposer/PlanReviewPanel）
 *  内部也是 <header> 标签，会被误认成会话 header 搬进页头面板（表现为提问弹出时
 *  页头显示提问卡的内容）。与 conversation-split.ts 的定位语义保持一致。 */
const CONVERSATION_HEADER_SELECTOR =
  'div[data-phase] > div[data-slot="conversation.session.header"] > header, div[data-phase] > header'

/** 直接子级的最小像素尺寸（会话列 640×160，普通面板 240×160）。
 *  渲染期换算 flexGrow 与 sash 拖拽 clamp 共用同一套最小尺寸语义。
 *  页头面板的 min 是 pane 卡片可视高度；shard 最小高度还需加 paneCard
 *  上下 margin（2×dockPad），所以这里用运行时 dockPad 换算。 */
function childMinPx(child: DockNode | undefined, dir: 'h' | 'v', dockPad: number): number {
  if (child === undefined) return 0
  if (child.kind === 'tabs' && child.tabs.length === 1 && child.tabs[0]?.type === REGION_CONVERSATION) {
    return dir === 'h' ? CONVERSATION_MIN : PANE_CARD_MIN_H
  }
  if (child.kind === 'tabs' && child.tabs.length === 1 && child.tabs[0]?.type === REGION_CONVERSATION_HEADER) {
    return dir === 'h' ? PANE_CARD_MIN_W : CONVERSATION_HEADER_MIN_H + dockPad * 2
  }
  return dir === 'h' ? PANE_CARD_MIN_W : PANE_CARD_MIN_H
}

/** 把页头面板当前实际高度写入 localStorage（继承原 HeaderEffects 拉伸手柄的
 *  高度记忆：现在由页头/正文之间的 sash 承担“拉伸 header”职责）。 */
function saveHeaderHeightFromSplit(splitNode: SplitNode, dividerIndex: number): void {
  const before = splitNode.children[dividerIndex - 1]
  const after = splitNode.children[dividerIndex]
  for (const child of [before, after]) {
    if (child === undefined || child.kind !== 'tabs' || child.tabs.length !== 1) continue
    if (child.tabs[0]?.type !== REGION_CONVERSATION_HEADER) continue
    const el = document.querySelector<HTMLElement>('[data-dock-node="' + child.id + '"]')
    if (el === null) continue
    const h = el.getBoundingClientRect().height
    if (!Number.isFinite(h) || h <= 0) continue
    const clamped = Math.round(Math.max(HEADER_MIN_H, Math.min(HEADER_MAX_H, h)))
    try { localStorage.setItem(HEADER_HEIGHT_LS_KEY, String(clamped)) } catch { /* 存储不可用则跳过 */ }
    return
  }
}

/** 判断节点是否单面板会话页头（用于 sash 像素 min 优先于 MIN_SIZE 比例）。 */
function isHeaderTabs(child: DockNode | undefined): boolean {
  return child !== undefined && child.kind === 'tabs' && child.tabs.length === 1 && child.tabs[0]?.type === REGION_CONVERSATION_HEADER
}

/** 从布局树/浮动窗口里按面板 id 找到面板实例。 */
function findPanelById(layout: DockLayout, panelId: string): PanelInstance | undefined {
  const hit = findTabsContaining(layout.root, panelId)
  if (hit !== undefined) return hit.node.tabs[hit.index]
  for (const float of layout.floats) {
    const panel = float.tabs.find(p => p.id === panelId)
    if (panel !== undefined) return panel
  }
  return undefined
}

/** 在布局树/浮动窗口里找指定类型的面板（返回容器 id、当前激活面板 id 与面板）。 */
function findPanelOfType(layout: DockLayout, type: string): { containerId: string; activeId: string | null; panel: PanelInstance } | undefined {
  for (const node of collectTabsNodes(layout.root)) {
    const panel = node.tabs.find(p => p.type === type)
    if (panel !== undefined) return { containerId: node.id, activeId: node.activeId, panel }
  }
  for (const float of layout.floats) {
    const panel = float.tabs.find(p => p.type === type)
    if (panel !== undefined) return { containerId: float.id, activeId: float.activeId, panel }
  }
  return undefined
}

/** 收集布局树 + 浮动窗口里出现的面板类型（侧边栏据此判断「标签已拆进布局」）。 */
function collectDockPanelTypes(layout: DockLayout): Set<string> {
  const types = new Set<string>()
  for (const node of collectTabsNodes(layout.root)) {
    for (const panel of node.tabs) types.add(panel.type)
  }
  for (const float of layout.floats) {
    for (const panel of float.tabs) types.add(panel.type)
  }
  return types
}

/** 目标标签组是否是「单面板详情区域」：拖回该组应还原为 SidePane 标签，而不是合并成 dock 标签组。 */
function isSingleDetailsTabs(layout: DockLayout, nodeId: string): boolean {
  const node = findNode(layout.root, nodeId)
  return node !== undefined
    && node.kind === 'tabs'
    && node.tabs.length === 1
    && node.tabs[0]?.type === REGION_DETAILS
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

function platformOf(): 'win32' | 'darwin' | 'linux' {
  const p = new URLSearchParams(window.location.search).get('dsh-desktop-platform')
  return p === 'darwin' || p === 'linux' ? p : 'win32'
}

/** 详情宽度 clamp：min 240；上限 = min(视口 88%, 视口 - 侧栏宽 - 会话最小宽 480)。
 *  拖动直写 flex-basis、localStorage 恢复、渲染兜底都走这里，保证详情列永不把
 *  会话列压过 480 或把右缘推出视口。 */
function clampDetailsWidth(n: number, viewport: number, sidebar: number): number {
  const maxByViewport = Math.round(viewport * DETAILS_MAX_RATIO)
  const maxByColumns = viewport - sidebar - CONVERSATION_MIN
  const maxW = Math.max(DETAILS_MIN, Math.min(maxByViewport, maxByColumns))
  return Math.min(maxW, Math.max(DETAILS_MIN, Math.round(n)))
}

/** 面板贴边标记（由渲染后实测几何得出，避免嵌套 split / 0 宽 shard 误判）。 */
interface PaneEdgeFlags {
  left: boolean
  right: boolean
  top: boolean
  bottom: boolean
  /** shard 是横向行（宽 ≥ 高）还是纵向列；上下贴边规则只对横向行生效。 */
  row: boolean
  /** 同一列下方还有相邻卡片（用于对话页等区域表面判断是否处于堆叠顶部/中部）。 */
  hasBelow: boolean
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
  // 布局槽位下拉（原生 select 的弹出列表无法被 CSS 主题化，换成插件下拉组件）
  const [selectedSlot, setSelectedSlot] = useState('')
  const [slotMenuOpen, setSlotMenuOpen] = useState(false)
  const [slotMenuPos, setSlotMenuPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const slotTriggerRef = useRef<HTMLButtonElement | null>(null)
  const slotMenuRef = useRef<HTMLDivElement | null>(null)

  /** 打开槽位下拉：按触发器实测定位（菜单用 CSS translateY(-100%) 向上展开，
   *  工作台卡片贴底，向上展开天然不溢出视口，无需实测菜单高度）。 */
  const openSlotMenu = (): void => {
    const el = slotTriggerRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    setSlotMenuPos({ left: r.left, top: r.top, width: r.width })
    setSlotMenuOpen(true)
  }

  // 槽位下拉是 body portal，不随工作台卡片隐藏：外点 / Esc 关闭
  useEffect(() => {
    if (!slotMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node
      if (slotMenuRef.current?.contains(t) === true) return
      if (slotTriggerRef.current?.contains(t) === true) return
      setSlotMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSlotMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [slotMenuOpen])
  const [modal, setModal] = useState<null | { kind: 'export' | 'import'; text: string }>(null)
  const [toast, setToast] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** 上次搬入页头面板 host 的 <header> 引用：页头面板被拆分/浮动时，header 会跟着
   *  旧 host 一起被 React 移出 DOM（detached），此时无法再从正文 phase 查到它；
   *  用这个引用把它「抢救」回新 host，否则页头面板出现空白。 */
  const headerRef = useRef<HTMLElement | null>(null)
  /** 页头高度恢复只应用一次（应用后用户拖拽 sash 会重新写入 localStorage）。 */
  const headerHeightAppliedRef = useRef(false)
  const dragRef = useRef<{ source: DragSource; title: string; sx: number; sy: number; active: boolean } | null>(null)
  /** HTML5 外部拖入（右侧标签面板标签）的落点指示。 */
  const [htmlDrop, setHtmlDrop] = useState<{ over: DropTarget | null; rect: DragState['overRect'] } | null>(null)
  const htmlDragActive = useRef(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shellRef = useRef(shell)
  shellRef.current = shell
  /** 用户把详情区域面板拖离原列（浮动/挪到其他位置）后，抑制宿主 openDetails 的自动补挂。 */
  const detailsTornOut = useRef(false)
  /** 当前会话 id 的上一次值：用于在会话切换时把旧布局写入旧会话、加载新会话布局。 */
  const lastDockSession = useRef<string | null | undefined>(undefined)

  // 按会话记忆 dock 布局：切换会话时先把当前布局写入旧会话，再加载新会话布局。
  useLayoutEffect(() => {
    const prev = lastDockSession.current
    lastDockSession.current = sessionId
    if (prev === sessionId) return
    detailsTornOut.current = false
    if (prev !== undefined && prev !== null && prev !== '') {
      saveShellDock(shellRef.current.dock, prev)
    }
    const saved = sessionId !== undefined && sessionId !== null && sessionId !== ''
      ? loadSavedDock(sessionId)
      : undefined
    const base = saved ?? defaultShellLayout()
    // 右侧边栏系列增强关闭时，dock 布局不保留 detail 区域（详情槽位未注册，
    // 留着只是一条空固定宽条）；默认布局里的 detail 区域一并剔除。
    const layout = isSidebarEnhancementEnabled() ? base : stripRegionPanels(base, REGION_DETAILS)
    actions.setDock(layout)
  }, [sessionId, actions])

  // 上报 dock 布局里的面板类型：侧边栏据此判断「审查标签已拆进布局」，
  // 收到审查请求时不再在侧边栏重开一份（避免同一面板开两处）。
  // 卸载（布局开关关闭等）时清空注册表，侧边栏回退默认行为。
  useEffect(() => {
    reportDockPanelTypes(collectDockPanelTypes(dock))
    return () => { reportDockPanelTypes(new Set()) }
  }, [dock])

  // 审查请求（轮次卡片「审查」/右键菜单）或驱动请求（LLM 活动自动展开）
  // 到达时，若 dock 里已有审查面板，激活其所在标签组——拆出后审查由 dock
  // 面板承接；多标签组里非激活的隐藏审查标签也借此挂载，从而消费 pending
  // 请求（见 FileReviewPanel 的 consumeReviewRequest/consumeReviewDrive）。
  useEffect(() => {
    const activateGitPanel = (): void => {
      const found = findPanelOfType(shellRef.current.dock, 'git')
      if (found === undefined || found.activeId === found.panel.id) return
      actions.setDock(setActivePanel(shellRef.current.dock, found.containerId, found.panel.id))
    }
    const sessionMatches = (sid: string | undefined): boolean =>
      sid === undefined || sid === sessionId
    const onReview = (e: Event): void => {
      const detail = (e as CustomEvent<{ sessionId?: string; path: string }>).detail
      if (detail === undefined || typeof detail.path !== 'string' || detail.path === '') return
      if (!sessionMatches(detail.sessionId)) return
      activateGitPanel()
    }
    const onDrive = (e: Event): void => {
      const detail = (e as CustomEvent<{ sessionId?: string }>).detail
      if (detail === undefined) return
      if (!sessionMatches(detail.sessionId)) return
      activateGitPanel()
    }
    window.addEventListener(REVIEW_FILE_EVENT, onReview)
    window.addEventListener(REVIEW_DRIVE_EVENT, onDrive)
    return () => {
      window.removeEventListener(REVIEW_FILE_EVENT, onReview)
      window.removeEventListener(REVIEW_DRIVE_EVENT, onDrive)
    }
  }, [sessionId, actions])

  /** 面板贴边标记（实测几何）：key = data-dock-node，避免嵌套 split / 0 宽 shard 误判。 */
  const [edgeMap, setEdgeMap] = useState<Record<string, PaneEdgeFlags>>({})

  /** 每个 split 盒主轴方向的实测像素（h→width / v→height）。
   *  渲染期把子级最小宽高换算成 flexGrow 用，保证 shard 永不溢出盖住相邻卡片。 */
  const [splitPxMap, setSplitPxMap] = useState<Record<string, number>>({})

  const recomputePaneEdges = useCallback(() => {
    const rootEl = rootRef.current
    if (rootEl === null) return
    const rootRect = rootEl.getBoundingClientRect()
    const next: Record<string, PaneEdgeFlags> = {}
    const EPS = 0.5
    const panes = Array.from(rootEl.querySelectorAll<HTMLElement>('[data-dock-node]'))
    const shardRects: Array<{ id: string; rect: DOMRect }> = []
    for (const pane of panes) {
      const id = pane.getAttribute('data-dock-node') ?? ''
      if (id === '') continue
      const shard = pane.parentElement
      const target = shard !== null && typeof css.shard === 'string' && shard.classList.contains(css.shard) ? shard : pane
      shardRects.push({ id, rect: target.getBoundingClientRect() })
    }
    for (const item of shardRects) {
      const r = item.rect
      const topFlush = r.top - rootRect.top <= EPS
      const leftFlush = r.left - rootRect.left <= EPS
      const rightFlush = rootRect.right - r.right <= EPS
      const bottomFlush = rootRect.bottom - r.bottom <= EPS
      const horizontalOverlap = (a: DOMRect, b: DOMRect): number =>
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      // 上下相邻判断用「水平有重叠 + 边缘贴合」，不要要求同列等宽：
      // 顶部行里的水平 split 子卡与底部整行卡的左右边缘可能不相等，但仍有上下关系。
      const hasAbove = shardRects.some(o => o.id !== item.id && Math.abs(o.rect.bottom - r.top) <= EPS && horizontalOverlap(o.rect, r) > 0)
      const hasBelow = shardRects.some(o => o.id !== item.id && Math.abs(o.rect.top - r.bottom) <= EPS && horizontalOverlap(o.rect, r) > 0)
      const region = panes.find(p => p.getAttribute('data-dock-node') === item.id)?.getAttribute('data-region-pane') ?? null
      if (region === 'region:sidebar') {
        // 侧边栏：只在左/右边缘时贴边；中间则四边留白。
        next[item.id] = {
          left: leftFlush && !rightFlush,
          right: rightFlush && !leftFlush,
          top: topFlush,
          bottom: false,
          row: r.width >= r.height,
          hasBelow,
        }
      } else if (region === 'region:details') {
        // 详细页：同侧边栏左右规则；下方没有卡片时底部触底。
        next[item.id] = {
          left: leftFlush && !rightFlush,
          right: rightFlush && !leftFlush,
          top: topFlush,
          bottom: bottomFlush && !hasBelow,
          row: r.width >= r.height,
          hasBelow,
        }
      } else if (region === 'region:conversation') {
        next[item.id] = { left: false, right: false, top: topFlush, bottom: false, row: r.width >= r.height, hasBelow }
      } else {
        // 普通 dock 面板：上下堆叠时，下方卡片底部触底；其余三边留白。左右不贴边。
        next[item.id] = {
          left: false,
          right: false,
          top: topFlush,
          bottom: bottomFlush && hasAbove,
          row: r.width >= r.height,
          hasBelow,
        }
      }
    }
    setEdgeMap(prev => {
      if (Object.keys(prev).length !== Object.keys(next).length) return next
      for (const id of Object.keys(next)) {
        const a = prev[id]
        const b = next[id] as PaneEdgeFlags
        if (a === undefined || a.left !== b.left || a.right !== b.right || a.top !== b.top || a.bottom !== b.bottom || a.row !== b.row || a.hasBelow !== b.hasBelow) return next
      }
      return prev
    })
  }, [css.shard])

  /** 实测每个 split 盒主轴像素（h→width / v→height），渲染期用。 */
  const recomputeSplitPx = useCallback(() => {
    const rootEl = rootRef.current
    if (rootEl === null) return
    const next: Record<string, number> = {}
    const splits = Array.from(rootEl.querySelectorAll<HTMLElement>('[data-dock-split]'))
    for (const splitEl of splits) {
      const id = splitEl.getAttribute('data-dock-split') ?? ''
      if (id === '') continue
      const dir: 'h' | 'v' = typeof css.splitH === 'string' && splitEl.classList.contains(css.splitH) ? 'h' : 'v'
      const rect = splitEl.getBoundingClientRect()
      next[id] = dir === 'h' ? rect.width : rect.height
    }
    setSplitPxMap(prev => {
      if (Object.keys(prev).length !== Object.keys(next).length) return next
      for (const id of Object.keys(next)) {
        const a = prev[id]
        const b = next[id]
        if (a === undefined || b === undefined || Math.abs(a - b) > 0.5) return next
      }
      return prev
    })
  }, [css.splitH])

  const recomputeGeometry = useCallback(() => {
    recomputePaneEdges()
    recomputeSplitPx()
  }, [recomputePaneEdges, recomputeSplitPx])

  /** 运行时 dock 留白（与 CSS 变量 --liuli-dock-padding 一致，不硬编码 16px）。
   *  变量由 liuli-runtime 异步设置在 body 上（首次渲染时可能还没写入），
   *  所以用 state + 观察者保持同步，不能只在首次渲染时读一次。 */
  const [dockPad, setDockPad] = useState(8)

  /** 读取 body 上的 --liuli-dock-padding 并同步到 state（异步设置项就绪后重渲染）。 */
  useLayoutEffect(() => {
    let cancelled = false
    let raf = 0
    const read = (): void => {
      if (cancelled) return
      try {
        const raw = getComputedStyle(document.body).getPropertyValue('--liuli-dock-padding').trim()
        const n = Number.parseFloat(raw)
        if (Number.isFinite(n) && n > 0) setDockPad(prev => prev === n ? prev : n)
      } catch { /* 保持默认 8 */ }
    }
    read()
    // 设置项异步加载，可能晚于首次渲染；rAF 重试 + body 属性观察双保险。
    let tries = 0
    const retry = (): void => {
      if (cancelled) return
      read()
      tries += 1
      if (tries < 10) raf = requestAnimationFrame(retry)
    }
    raf = requestAnimationFrame(retry)
    const mo = new MutationObserver(() => read())
    mo.observe(document.body, { attributes: true, attributeFilter: ['style'] })
    return () => {
      cancelled = true
      if (raf !== 0) cancelAnimationFrame(raf)
      mo.disconnect()
    }
  }, [])

  /* ── 会话页头 DOM 移植：把官方 ConversationRoot 渲染出的 <header> 搬入/搬回 ── */
  const syncConversationHeader = useCallback(() => {
    const rootEl = rootRef.current
    if (rootEl === null) return
    const conversationPane = rootEl.querySelector<HTMLElement>('[data-region-pane="region:conversation"]')
    const headerHost = rootEl.querySelector<HTMLElement>('[data-liuli-conversation-header-host]')
    if (headerHost === null) {
      // 没有页头面板（被拖成标签组/浮动窗口关闭）：把 header 放回会话面板的 slot 占位容器。
      if (conversationPane === null) return
      const slot = conversationPane.querySelector<HTMLElement>('div[data-slot="conversation.session.header"]')
      const phase = conversationPane.querySelector<HTMLElement>('div[data-phase]')
      for (const header of conversationPane.querySelectorAll<HTMLElement>(CONVERSATION_HEADER_SELECTOR)) {
        if (slot !== null && header.parentElement !== slot) slot.appendChild(header)
        else if (slot === null && phase !== null && header.parentElement !== phase) phase.insertBefore(header, phase.firstChild)
      }
      // 页头回到正文面板：清除独立面板模式下写入的 0px，交还 HeaderEffects 测量写入。
      if (phase !== null) phase.style.removeProperty('--dsh-header-height')
      return
    }
    // 页头面板存在：把会话面板里的 header 全部搬入 host（保留一个，其余是 React 重建的旧节点）。
    // 另收集多标签卡 tabStrip 顶部的残留 header（单区域 host → tabStrip 的原地复用遗留；
    // 排除浮动窗内的 tabStrip），一并纳入候选，避免「页头卡上半多一个 header」。
    const headers = [
      ...(conversationPane !== null ? Array.from(conversationPane.querySelectorAll<HTMLElement>(CONVERSATION_HEADER_SELECTOR)) : []),
      ...Array.from(rootEl.querySelectorAll<HTMLElement>('[data-testid="dock-tab-strip"] > header'))
        .filter(h => h.closest('[data-testid="dock-float"]') === null),
    ]
    if (headers.length === 0) {
      // 页头面板拆分/浮动时，header 跟着旧 host 被 React 移出 DOM（detached），
      // 正文 phase 已查不到它；用之前保存的引用抢救回新 host，避免页头空白。
      const saved = headerRef.current
      if (saved !== null && !saved.isConnected && headerHost.querySelector('header') === null) {
        headerHost.appendChild(saved)
        headerRef.current = saved
      }
      return
    }
    // React 重建会话根时可能残留多个 <header>（新旧节点并存）；优先保留「有内容」
    // 的节点（含标题行或任意子元素），避免把空的旧节点搬进页头面板、删掉真正有
    // 内容的新节点——表现为「header 拆分成独立面板后内容空白」。
    const first = headers.find(h => h.childElementCount > 0) ?? headers[0]
    if (first === undefined) return
    const existing = headerHost.querySelector<HTMLElement>('header')
    if (existing !== null && existing !== first) existing.remove()
    if (first.parentElement !== headerHost) headerHost.appendChild(first)
    // 记录当前页头 header 引用，供拆分/浮动后「抢救」detached 的 header 使用。
    headerRef.current = first
    // 删除除 first 外的所有残留 header（不能按下标 i>=1 删，否则 first 不是
    // headers[0] 时会把刚搬入面板的节点误删）。
    for (const h of headers) {
      if (h !== first) h.remove()
    }
    // 页头已独立：面板高度由 dock 布局控制，清除 HeaderEffects 旧逻辑写在
    // header 上的内联 min-height（否则 header/canvas 不会跟随 sash 缩放，
    // 而是被 min-height 钉住并被 host 裁剪）。
    first.style.removeProperty('min-height')
    // 页头已独立：正文面板内的 --dsh-header-height 归零，TurnRail/模糊 mask
    // 不再按“正文面板内还有 header”偏移。
    const phase = conversationPane?.querySelector<HTMLElement>('div[data-phase]')
    if (phase !== null && phase !== undefined) phase.style.setProperty('--dsh-header-height', '0px')
  }, [])

  /* ── 恢复页头高度：继承原 HeaderEffects 拉伸手柄的 localStorage 记忆。
     现在页头/正文是上下两个 dock 面板，页头高度由垂直 split 比例决定；
     初始化时读取保存高度，换算成比例写回布局（只应用一次，之后由 sash
     拖拽写回新值）。 ── */
  useLayoutEffect(() => {
    if (headerHeightAppliedRef.current) return
    let cancelled = false
    const tryApply = (attempt: number): void => {
      if (cancelled || headerHeightAppliedRef.current) return
      try {
        const saved = Number.parseFloat(localStorage.getItem(HEADER_HEIGHT_LS_KEY) ?? '')
        if (!Number.isFinite(saved) || saved < HEADER_MIN_H || saved > HEADER_MAX_H) {
          headerHeightAppliedRef.current = true
          return
        }
        const current = shellRef.current.dock
        const headerPanel = findRegion(current, REGION_CONVERSATION_HEADER)
        if (headerPanel === undefined || current.root === null) {
          headerHeightAppliedRef.current = true
          return
        }
        const containing = findTabsContaining(current.root, headerPanel.id)
        if (containing === undefined) {
          headerHeightAppliedRef.current = true
          return
        }
        const parent = findParentSplit(current.root, containing.node.id)
        if (parent === undefined || parent.parent.dir !== 'v') {
          headerHeightAppliedRef.current = true
          return
        }
        const splitEl = rootRef.current?.querySelector<HTMLElement>('[data-dock-split="' + parent.parent.id + '"]')
        if (splitEl === null || splitEl === undefined) {
          if (attempt < 6) { requestAnimationFrame(() => { tryApply(attempt + 1) }); return }
          headerHeightAppliedRef.current = true
          return
        }
        const total = splitEl.getBoundingClientRect().height
        if (total <= 0) {
          if (attempt < 6) { requestAnimationFrame(() => { tryApply(attempt + 1) }); return }
          headerHeightAppliedRef.current = true
          return
        }
        // 恢复高度依赖 dockPad；设置项异步加载，变量没就绪时等一下再应用，
        // 否则会按 fallback 8 多压/少压留白。
        const rawPad = getComputedStyle(document.body).getPropertyValue('--liuli-dock-padding').trim()
        const padNow = Number.parseFloat(rawPad)
        if (!Number.isFinite(padNow) || padNow <= 0) {
          if (attempt < 10) { requestAnimationFrame(() => { tryApply(attempt + 1) }); return }
        }
        headerHeightAppliedRef.current = true
        // saved 是页头卡片（pane）的可视高度；paneCard 上下 margin 各占 1 份
        // --liuli-dock-padding，所以 shard 高度 = pane 高度 + 2 份留白。
        const targetShardHeight = Math.max(HEADER_MIN_H, Math.min(HEADER_MAX_H, saved)) + (Number.isFinite(padNow) && padNow > 0 ? padNow : 8) * 2
        const ratio = targetShardHeight / total
        // dividerIndex 是分割线下标：header 面板在 v split 首位时是 1，
        // 在其它位置时调整它上方的分割线。
        const dividerIndex = parent.index === 0 ? 1 : parent.index
        // 页头高度可能小于 12% 比例下限（如 78px 在 885px 里只占 8.8%），
        // 必须绕过 resizeSplitTo 的 MIN_SIZE clamp 直接写 sizes，否则会被
        // 弹回 106px。
        const next = structuredClone(current)
        const node = findNode(next.root, parent.parent.id)
        if (node !== undefined && node.kind === 'split') {
          const sizesTotal = (node.sizes[dividerIndex - 1] ?? 0.5) + (node.sizes[dividerIndex] ?? 0.5)
          const na = Math.max(0, Math.min(sizesTotal, ratio * sizesTotal))
          node.sizes[dividerIndex - 1] = na
          node.sizes[dividerIndex] = sizesTotal - na
          actions.setDock(next)
        }
      } catch {
        headerHeightAppliedRef.current = true
      }
    }
    tryApply(0)
    return () => { cancelled = true }
  }, [actions])

  /* ── 页头面板内的垂直拉伸手柄（HeaderEffects resizer）在独立面板中继续工作：
     拖拽高度通过自定义事件广播，这里实时调整 v split 比例；localStorage 仍由
     resizer 自己写入，刷新后由上面的恢复逻辑读回。 ── */
  const resizeHeaderPaneTo = useCallback((height: number): void => {
    const current = shellRef.current.dock
    const headerPanel = findRegion(current, REGION_CONVERSATION_HEADER)
    if (headerPanel === undefined || current.root === null) return
    const containing = findTabsContaining(current.root, headerPanel.id)
    if (containing === undefined) return
    const parent = findParentSplit(current.root, containing.node.id)
    if (parent === undefined || parent.parent.dir !== 'v') return
    const splitEl = rootRef.current?.querySelector<HTMLElement>('[data-dock-split="' + parent.parent.id + '"]')
    if (splitEl === null || splitEl === undefined) return
    const total = splitEl.getBoundingClientRect().height
    if (total <= 0) return
    const targetShardHeight = Math.max(HEADER_MIN_H, Math.min(HEADER_MAX_H, height)) + dockPad * 2
    const ratio = targetShardHeight / total
    const dividerIndex = parent.index === 0 ? 1 : parent.index
    // 同恢复逻辑：页头高度可能小于 12% 比例下限，绕过 resizeSplitTo 直接写 sizes。
    const next = structuredClone(current)
    const node = findNode(next.root, parent.parent.id)
    if (node !== undefined && node.kind === 'split') {
      const sizesTotal = (node.sizes[dividerIndex - 1] ?? 0.5) + (node.sizes[dividerIndex] ?? 0.5)
      const na = Math.max(0, Math.min(sizesTotal, ratio * sizesTotal))
      node.sizes[dividerIndex - 1] = na
      node.sizes[dividerIndex] = sizesTotal - na
      actions.setDock(next)
    }
  }, [actions, dockPad])

  useEffect(() => {
    let raf = 0
    const onResizeDrag = (e: Event): void => {
      const detail = (e as CustomEvent<{ height: number }>).detail
      const h = detail !== null && typeof detail === 'object' ? detail.height : Number.NaN
      if (!Number.isFinite(h) || h <= 0) return
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        resizeHeaderPaneTo(h)
      })
    }
    window.addEventListener('liuli:header-resize-drag', onResizeDrag)
    return () => {
      window.removeEventListener('liuli:header-resize-drag', onResizeDrag)
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [resizeHeaderPaneTo])

  // 每次渲染后同步一次贴边标记与 split 像素（布局树 / 开合 / 缩放都会反映到几何上）。
  useLayoutEffect(() => {
    recomputeGeometry()
  })

  // 每次渲染后给 conversation 面板的会话根打双容器标记（header / 正文并列容器）。
  useLayoutEffect(() => {
    const rootEl = rootRef.current
    if (rootEl !== null) tagConversationContainers(rootEl)
  })

  // 每次渲染后同步页头 DOM（绘制前完成，避免页头闪烁/重复）。
  useLayoutEffect(() => {
    syncConversationHeader()
  })

  // 会话切换 / 面板增删 / 官方 slot 重挂时，MutationObserver 补同步（rAF 节流）。
  useEffect(() => {
    const rootEl = rootRef.current
    if (rootEl === null) return
    let raf = 0
    const sync = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        syncConversationHeader()
      })
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(rootEl, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [syncConversationHeader])

  useEffect(() => {
    const rootEl = rootRef.current
    if (rootEl === null) return
    const ro = new ResizeObserver(() => { recomputeGeometry() })
    ro.observe(rootEl)
    window.addEventListener('resize', recomputeGeometry)
    // shard 宽度/高度有 0.3s flex-basis/flex-grow 过渡；布局树切换（导入/恢复/重置）
    // 时 root 尺寸不变，RO 不会触发，必须在过渡结束后重算一次贴边标记。
    rootEl.addEventListener('transitionend', recomputeGeometry)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', recomputeGeometry)
      rootEl.removeEventListener('transitionend', recomputeGeometry)
    }
  }, [recomputeGeometry])

  /* ── 自动保存 dock 树（防抖 250ms）+ 卸载前落盘 ── */
  useEffect(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current)
    const snapshot = shell
    saveTimer.current = setTimeout(() => { saveShellDock(snapshot.dock, sessionId) }, 250)
    return () => { if (saveTimer.current !== null) clearTimeout(saveTimer.current) }
  }, [shell, sessionId])
  useEffect(() => () => { saveShellDock(shellRef.current.dock, lastDockSession.current ?? sessionId) }, [])

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
    // 用户主动把详情区域拖走（浮动/挪到其他位置）后，不再自动补挂到右缘；
    // 关闭宿主 details 列时清除标记，之后重新 openDetails 仍可补挂。
    if (hostPanels.details === 0) detailsTornOut.current = false
    if (prev === 0 && hostPanels.details > 0) {
      if (detailsTornOut.current) return
      // 右侧边栏系列增强关闭时不再补挂 detail 区域（详情槽位未注册，补挂只会是空面板）。
      if (!isSidebarEnhancementEnabled()) return
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

  // 详情区域宽度（liuli 自管，突破 desktop shell 的 clamp 300-520；上限 = 视口 88%，
  // 同时保证「侧栏 + 会话最小 480 + 详情」不超视口）。宿主开合（hostPanels.details 0↔w）仍驱动折叠。
  const [detailsWidth, setDetailsWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('liuli:details-width')
      const n = raw === null ? 0 : Number.parseFloat(raw)
      return Number.isFinite(n) && n > 0 ? clampDetailsWidth(n, window.innerWidth, sidebarWidth) : 360
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
        if (Number.isFinite(n) && n > 0) setDetailsWidth(clampDetailsWidth(n, window.innerWidth, sidebarWidth))
      } catch { /* 忽略损坏值 */ }
    }
    window.addEventListener('liuli:details-width-change', onWidthChange)
    return () => window.removeEventListener('liuli:details-width-change', onWidthChange)
  }, [sidebarWidth])

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => { setToast(null) }, 2600)
  }, [])

  /** 节点在 dir 方向上的固定像素宽度；不是固定宽则返回 undefined。
   *  - 单区域侧栏/详情：宿主宽度语义（详情关闭返回 0，保持挂载可过渡）；
   *    侧栏收起后若不在原生左缘，表面有 dock 留白 padding，shard 要在
   *    原生收起宽（56/90）基础上加上留白，否则内轨会被压成 40/48px，
   *    与原生收起宽度不一致。
   *  - 同向 split 的全部子级都固定：其宽度也固定（子级之和），这样
   *    [详情, 侧栏] 这类复合列在父级里不会再按 flexGrow 吃掉多余空间、
   *    收起后也不会在右缘留大段空白。垂直方向暂无固定高度区域。 */
  const childFixedWidth = (child: DockNode, dir: 'h' | 'v'): number | undefined => {
    if (dir !== 'h') return undefined
    if (child.kind === 'tabs') {
      if (child.tabs.length !== 1) return undefined
      const only = child.tabs[0]
      if (only === undefined) return undefined
      if (only.type === REGION_SIDEBAR) {
        if (sidebarCollapsed) {
          const edges = edgeMap[child.id]
          if (edges !== undefined && !edges.left) {
            return sidebarWidth + (edges.right ? dockPad : dockPad * 2)
          }
        }
        return sidebarWidth
      }
      if (only.type === REGION_DETAILS) return hostPanels.details === 0 ? 0 : clampDetailsWidth(detailsWidth, window.innerWidth, sidebarWidth)
      return undefined
    }
    if (child.kind === 'split') {
      if (child.dir !== dir) return undefined
      let sum = 0
      for (const c of child.children) {
        const fixed = childFixedWidth(c, dir)
        if (fixed === undefined) return undefined
        sum += fixed
      }
      return sum
    }
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

  /** 节点在指定方向上的最小像素尺寸（递归聚合子级，固定宽度子级按固定 px 计）。
   *  split 主轴 = 子级最小之和；交叉轴 = 子级最小最大值。渲染期分配与
   *  sash 拖拽 clamp 共用，保证「最小宽度」能沿嵌套层级向上传播。 */
  const nodeMinPx = (node: DockNode | undefined, dir: 'h' | 'v'): number => {
    if (node === undefined) return 0
    if (node.kind === 'tabs') {
      const fixed = childFixedWidth(node, dir)
      if (fixed !== undefined) {
        return dir === 'h' ? Math.max(fixed, 0) : childMinPx(node, dir, dockPad)
      }
      return childMinPx(node, dir, dockPad)
    }
    const childMins = node.children.map(child => nodeMinPx(child, dir))
    return node.dir === dir
      ? childMins.reduce((a, b) => a + b, 0)
      : childMins.reduce((a, b) => Math.max(a, b), 0)
  }

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
    sidePaneHost: dockHostBridge.sidePaneHost,
  }

  const renderPanelBody = (panel: PanelInstance): ReactNode => {
    switch (panel.type) {
      case REGION_SIDEBAR:
        return renderSlot('sidebar', { collapsed: sidebarCollapsed, width: sidebarWidth })
      case REGION_CONVERSATION:
        return renderSlot('conversation', {})
      case REGION_CONVERSATION_HEADER:
        // 页头面板只提供宿主容器；官方 ConversationRoot 渲染出的 <header>
        // 由 syncConversationHeader() 在 DOM 层搬入这里（React 仍持有节点引用，
        // 更新属性不受影响；搬入/搬回都在 useLayoutEffect + MutationObserver 中
        // 同步，避免绘制前出现空白或重复页头）。
        return <div className={css.conversationHeaderHost} data-liuli-conversation-header-host="" />
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
      // 只保留右侧标签面板「标签条」的内部排序语义：标签条内由 SidePane 自己的
      // chip dragover/drop 处理排序，dock 不接管；面板内容区/边缘都允许 dock 落点，
      // 否则从详细页标签直接拖出时，整个 side pane 矩形都被排除，无法选择
      // 「详情上方/下方/左侧/右侧」等落点（先拆成浮动窗口才能选）。
      if (e.target instanceof Element && e.target.closest('[data-side-pane-tabs-viewport]') !== null) return
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
      // 与 onDragOver 同范围排除：标签条内松手走 SidePane 内部排序，
      // 不被 dock 接管（drop 会冒泡到 root，不能只拦 dragover）。
      if (e.target instanceof Element && e.target.closest('[data-side-pane-tabs-viewport]') !== null) return
      e.preventDefault()
      htmlDragActive.current = false
      const raw = e.dataTransfer?.getData(SIDE_TAB_MIME) ?? ''
      const tab = parseSideTab(raw)
      const mapped: SideTabDockPanel | undefined = tab === undefined ? undefined : sideTabToDockPanel(tab)
      setHtmlDrop(null)
      if (tab === undefined || mapped === undefined) return
      const { target } = computeDrop(e.clientX, e.clientY)
      // 拖回详情页内容区（tab 目标命中单面板详情区域）＝回到 SidePane 原容器，
      // 不再走 dock 合并；源标签仍由 SidePane 保留（不 markSideTabAccepted）。
      if (target !== null && target.kind === 'tab' && isSingleDetailsTabs(shellRef.current.dock, target.nodeId)) {
        openSidePaneTab(tab)
        return
      }
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
      // 从详细页拆出的标签拖回详情页（tab 目标命中单面板详情区域）时，不要
      // 合并成 dock 标签组，而是还原为 SidePane 标签（回到原来的容器）。
      const movingPanel = info.source.panelId !== undefined ? findPanelById(current, info.source.panelId) : undefined
      const movingSideTab = movingPanel !== undefined ? dockPanelToSideTab(movingPanel) : undefined
      if (movingPanel !== undefined && movingSideTab !== undefined && target !== null
        && target.kind === 'tab' && isSingleDetailsTabs(current, target.nodeId)) {
        actions.setDock(removePanel(current, movingPanel.id))
        openSidePaneTab(movingSideTab)
        return
      }
      if (info.source.kind === 'node' && info.source.panelId !== undefined) {
        markDetailsTornOut(info.source.panelId)
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
    // 指针捕获：按下即把后续 pointermove/pointerup 全部收归 sash 元素
    // （再冒泡到 window 上的既有监听），指针扫进 iframe 文档也不会丢事件、
    // 不被内嵌页抢焦点。注意捕获只在本页面内有效——iframe 由 CSS 点击穿透
    // 兜底（body[data-liuli-resizing] iframe { pointer-events:none }，见
    // liuli-css）；<webview> guest 是独立渲染进程、CSS pointer-events 对它
    // 不可靠，resize-perf.ts 在缩放期挂全视口透明护盾
    // （data-liuli-resize-shield）盖住它拦截指针（guest 收不到 pointerdown、
    // 不吞 move），护盾透明故浏览器画面全程保持可见。
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* ignore */ }
    const container = (e.currentTarget as HTMLElement).parentElement
    const rect = container?.getBoundingClientRect()
    if (rect === undefined) return
    const total = dir === 'h' ? rect.width : rect.height
    if (total <= 0) return
    // 固定宽度区域（侧栏/详情）的 sash 走宿主 layout 服务（原生宽度语义 + clamp），
    // 其余 sash 按 split 比例缩放。锚定边在拖拽中不动，故按下时取一次面板 rect 即可。
    // 注意：只有水平 split 才存在「固定宽度区域」语义；垂直 split 里详情/侧栏与其他
    // 面板之间是可变高度比例，必须走下面的 variableShards 路径，否则点击垂直 sash
    // 松手时会把面板高度当作宽度写进 setDetailsWidth/hostLayout.setSidebar，布局横跳。
    const beforeChild = splitNode.children[dividerIndex - 1]
    const afterChild = splitNode.children[dividerIndex]
    const beforeType = dir === 'h' && beforeChild !== undefined ? fixedRegionType(beforeChild) : undefined
    const afterType = dir === 'h' && afterChild !== undefined ? fixedRegionType(afterChild) : undefined
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
    // 起始比例优先取 DOM 实测（渲染期做了像素 clamp，model sizes 可能与实际显示不一致），
    // 避免按下后第一帧跳到 model 比例。
    let startRatio = splitNode.sizes[dividerIndex - 1] ?? 0.5
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
    let variableShards: {
      before: HTMLElement
      after: HTMLElement
      growSum: number
      sizesTotal: number
      /** 相邻两个 shard 的最小尺寸换算成比例，防止把手柄拖过相邻卡片。 */
      minBeforeRatio: number
      minAfterRatio: number
      /** 相邻面板是会话页头时，像素最小高度优先于 12% 比例下限。 */
      beforeHeader: boolean
      afterHeader: boolean
    } | undefined
    /** 相邻任一侧是固定宽度节点（复合固定列等）时，比例拖拽无意义：固定侧
     *  flex-basis 不变、另一侧若只有它一个 grow 子级则 flexGrow 恒为 1。
     *  此时 sash 直接 no-op，避免把 flexGrow 写到固定 shard 上造成错乱。 */
    let sashNoop = false
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
          const fixedFlags = splitNode.children.map(child => childFixedWidth(child, dir) !== undefined)
          const beforeFixed = fixedFlags[dividerIndex - 1] === true
          const afterFixed = fixedFlags[dividerIndex] === true
          if (beforeFixed || afterFixed) {
            sashNoop = true
          } else {
            const growSum = splitNode.sizes.reduce((acc, s, i) => acc + (fixedFlags[i] === true ? 0 : (s ?? 1)), 0)
            const sizesTotal = (splitNode.sizes[dividerIndex - 1] ?? 0.5) + (splitNode.sizes[dividerIndex] ?? 0.5)
            const beforeRect = beforeEl.getBoundingClientRect()
            const afterRect = afterEl.getBoundingClientRect()
            const combined = dir === 'h' ? beforeRect.width + afterRect.width : beforeRect.height + afterRect.height
            if (combined > 0) {
              startRatio = (dir === 'h' ? beforeRect.width : beforeRect.height) / combined
            }
            const minBeforeRatio = combined > 0
              ? nodeMinPx(beforeChild, dir) / combined * sizesTotal
              : MIN_SIZE * sizesTotal
            const minAfterRatio = combined > 0
              ? nodeMinPx(afterChild, dir) / combined * sizesTotal
              : MIN_SIZE * sizesTotal
            if (growSum > 0) variableShards = {
              before: beforeEl,
              after: afterEl,
              growSum,
              sizesTotal,
              minBeforeRatio,
              minAfterRatio,
              beforeHeader: isHeaderTabs(beforeChild),
              afterHeader: isHeaderTabs(afterChild),
            }
          }
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
        // 该区域增大会挤压 split 内其他子级，必须先算出「其他子级至少需要多少像素」，
        // 否则手柄会把相邻卡片拖过最小宽/高（甚至盖上去）。
        const regionChild = isBefore ? beforeChild : afterChild
        const othersMin = splitNode.children.reduce((acc, child) => {
          if (child.id === regionChild?.id) return acc
          const fixed = childFixedWidth(child, dir)
          if (fixed !== undefined) return acc + fixed
          return acc + nodeMinPx(child, dir)
        }, 0)
        const maxSize = Math.max(0, total - othersMin)
        if (regionType === REGION_DETAILS) {
          // 详情区域宽度由 liuli 自管（上限 = 视口 88%，且不把会话压过 480/推出视口），
          // 再与「其他子级最小占用」取小，保证相邻卡片不被盖住。
          lastRegionSize = Math.min(clampDetailsWidth(newSize, window.innerWidth, sidebarWidth), maxSize)
        } else {
          // 侧栏宽度仍遵循宿主契约 264..420（onUp 经 hostLayout.setSidebar 提交），
          // 拖拽期间直写 flexBasis 也 clamp 到同范围，避免把侧栏拖成负值/超过容器。
          lastRegionSize = Math.min(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(newSize))), maxSize)
        }
        if (regionShardEl !== null) regionShardEl.style.flexBasis = String(Math.max(0, lastRegionSize)) + 'px'
        return
      }
      const pos = dir === 'h' ? ev.clientX : ev.clientY
      const ratio = startRatio + (pos - start) / total
      lastRatio = ratio
      if (variableShards !== undefined) {
        // 先满足相邻 shard 的像素最小宽/高（240/160，会话列 640，页头 80）；
        // 普通面板再叠加 12% 比例下限。会话页头面板的像素最小高度小于 12%，
        // 若仍用 MIN_SIZE 会把页头卡在 106px，无法缩到 tabs 按钮底部。
        const { growSum, sizesTotal, minBeforeRatio, minAfterRatio, beforeHeader, afterHeader } = variableShards
        const lo = beforeHeader ? minBeforeRatio : Math.max(MIN_SIZE * sizesTotal, minBeforeRatio)
        const hi = afterHeader ? sizesTotal - minAfterRatio : Math.min(sizesTotal - MIN_SIZE * sizesTotal, sizesTotal - minAfterRatio)
        let na = lo <= hi ? Math.max(lo, Math.min(hi, ratio * sizesTotal)) : sizesTotal / 2
        if (!Number.isFinite(na)) na = sizesTotal / 2
        // 提交用 lastRatio 必须与 DOM 直写一致（clamp 后的比例），否则松手回跳。
        lastRatio = sizesTotal > 0 ? na / sizesTotal : lastRatio
        variableShards.before.style.flexGrow = String(na / growSum)
        variableShards.after.style.flexGrow = String((sizesTotal - na) / growSum)
        return
      }
      if (sashNoop) return
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
        if (variableShards.beforeHeader || variableShards.afterHeader) {
          // 会话页头面板的像素最小高度小于 12% 比例下限，resizeSplitTo 的
          // MIN_SIZE clamp 会把页头弹回 106px。这里直接写 sizes 提交，绕过
          // MIN_SIZE，让页头能缩到 80px（tabs 按钮底部）。
          const next = structuredClone(shellRef.current.dock)
          const node = findNode(next.root, splitNode.id)
          if (node !== undefined && node.kind === 'split') {
            const sizesTotal = (node.sizes[dividerIndex - 1] ?? 0.5) + (node.sizes[dividerIndex] ?? 0.5)
            let na = lastRatio * sizesTotal
            if (!Number.isFinite(na)) na = sizesTotal / 2
            na = Math.max(0, Math.min(sizesTotal, na))
            node.sizes[dividerIndex - 1] = na
            node.sizes[dividerIndex] = sizesTotal - na
            actions.setDock(next)
          }
        } else {
          // 提交最终比例：重渲染写回的 flexGrow 与拖拽直写值同公式，无视觉跳变。
          actions.setDock(resizeSplitTo(shellRef.current.dock, splitNode.id, dividerIndex, lastRatio))
        }
      }
      // 页头/正文之间的垂直 sash 承担原 header 拉伸手柄职责：松手时把页头面板
      // 实际高度持久化到 liuli:header-height，刷新后恢复布局继续沿用。
      if (dir === 'v') saveHeaderHeightFromSplit(splitNode, dividerIndex)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [actions, hostLayout, sidebarWidth, detailsWidth, hostPanels.details, dockPad])

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
        {panel.type !== REGION_CONVERSATION && panel.type !== REGION_CONVERSATION_HEADER && panel.type !== REGION_SIDEBAR && (
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
  const markDetailsTornOut = (panelId: string): void => {
    if (findRegion(shellRef.current.dock, REGION_DETAILS)?.id === panelId) {
      detailsTornOut.current = true
    }
  }

  const floatPanelCentered = (panelId: string): void => {
    const x = Math.max(8, Math.round((window.innerWidth - 480) / 2))
    const y = Math.max(44, Math.round((window.innerHeight - 360) / 3))
    markDetailsTornOut(panelId)
    actions.setDock(movePanel(shellRef.current.dock, panelId, { kind: 'float', x, y }))
  }

  /** 悬停抓握簇：单标签面板的唯一交互入口（拖动/浮动/关闭），平时隐藏，hover 显形。
   *  - 区域面板：拖动 + ⧉ 浮动；
   *  - 非区域单标签卡（无标签条）：额外提供 × 关闭（closable）。 */
  const renderGrip = (node: TabsNode, closable = false): ReactNode => {
    const draggable = node.tabs[0]
    const title = draggable !== undefined
      ? (isRegionPanel(draggable.type) ? regionLabel(draggable.type) : panelTitle(draggable))
      : ''
    if (draggable === undefined || node.tabs.length > 1) return null
    return (
      <div className={css.gripCluster}>
        <div
          className={css.grip}
          data-testid="dock-grip"
          role="button"
          title="拖动以自定义布局"
          aria-label="拖动以自定义布局"
          onPointerDown={(e) => { beginDrag(e, { kind: 'node', containerId: node.id, panelId: draggable.id }, title) }}
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
        {closable && draggable.type !== REGION_CONVERSATION && draggable.type !== REGION_CONVERSATION_HEADER && draggable.type !== REGION_SIDEBAR && (
          <button
            type="button"
            className={css.gripClose}
            data-testid="dock-grip-close"
            title={'关闭 ' + title}
            aria-label={'关闭 ' + title}
            onClick={(e) => {
              e.stopPropagation()
              if (draggable.type === REGION_DETAILS) {
                hostLayout.closeDetails()
                return
              }
              actions.setDock(closePanelOf(shellRef.current.dock, draggable.id))
            }}
          >
            ×
          </button>
        )}
      </div>
    )
  }

  /** 用 split 盒实测像素把 sizes 换算成「不会溢出的子级像素」。
   *  - 容器放得下所有最小宽/高：先满足每个子级最小像素，剩余空间按 sizes 比例分；
   *  - 容器放不下（嵌套 split 太窄/太矮）：按 sizes 比例分可用空间（允许低于最小），
   *    但绝不溢出到相邻卡片（此前直接给 shard 写 minWidth/minHeight，flex 项硬性
   *    下限会让子级溢出 split 盒，盖到隔壁卡片上）。 */
  const splitChildPx = (split: SplitNode, totalPx: number): number[] | null => {
    if (!Number.isFinite(totalPx) || totalPx <= 0) return null
    const fixedFlags = split.children.map(child => childFixedWidth(child, split.dir) !== undefined)
    const fixedSum = split.children.reduce((acc, child, i) => acc + (fixedFlags[i] === true ? (childFixedWidth(child, split.dir) ?? 0) : 0), 0)
    const available = totalPx - fixedSum
    if (available <= 0) return null
    const mins = split.children.map((child, i) => fixedFlags[i] === true ? 0 : nodeMinPx(child, split.dir))
    const minSum = mins.reduce((a, b) => a + b, 0)
    const weights = split.children.map((_child, i) => {
      if (fixedFlags[i] === true) return 0
      const s = split.sizes[i]
      return Number.isFinite(s) && s! > 0 ? s! : 1
    })
    const weightSum = weights.reduce((a, b) => a + b, 0)
    const desired = weights.map(w => weightSum > 0 ? w / weightSum * available : 0)
    if (minSum > available) {
      // 容器太小：接受低于最小，但保持比例、和恰好等于可用空间。
      return desired
    }
    // 容器足够：抬到最小值后，把多占的空间从高于最小值的子级按富余量扣回。
    let px = desired.map((d, i) => fixedFlags[i] === true ? 0 : Math.max(mins[i]!, d))
    for (let iter = 0; iter < 12; iter += 1) {
      const sum = px.reduce((a, b) => a + b, 0)
      const over = sum - available
      if (Math.abs(over) < 0.5) break
      const reducible = px.reduce((acc, v, i) => fixedFlags[i] !== true && v > mins[i]! ? acc + (v - mins[i]!) : acc, 0)
      if (reducible <= 0) break
      px = px.map((v, i) => fixedFlags[i] !== true && v > mins[i]!
        ? v - over * ((v - mins[i]!) / reducible)
        : v)
    }
    const sum = px.reduce((a, b) => a + b, 0)
    if (sum > 0) px = px.map(v => v / sum * available)
    return px
  }

  const renderTabsNode = (node: TabsNode): ReactNode => {
    const active = node.tabs.find(p => p.id === node.activeId) ?? node.tabs[0]
    const only = node.tabs.length === 1 ? node.tabs[0] : undefined
    const regionType = only !== undefined && isRegionPanel(only.type) ? only.type : undefined
    const surface = regionType !== undefined ? surfaceClass(regionType) : ''
    const isHeaderRegion = regionType === REGION_CONVERSATION_HEADER
    // 单区域 = 原生表面直出（无附加 chrome）；多标签 = 表面 + 细标签条。
    // 会话页头没有原生表面，使用与扩展面板一致的亚克力卡片材质（paneCard）。
    if (only !== undefined && regionType !== undefined) {
      const regionEdges = edgeMap[node.id] ?? { left: false, right: false, top: false, bottom: false, row: false, hasBelow: false }
      const paneClass = isHeaderRegion
        ? css.pane + ' ' + css.paneCard + (regionEdges.bottom ? ' ' + css.edgeBottom : '')
        : surface + ' ' + css.pane
      return (
        <div
          className={paneClass}
          data-dock-node={node.id}
          data-testid="dock-pane"
          data-region-pane={regionType}
          data-edge-left={regionEdges.left || undefined}
          data-edge-right={regionEdges.right || undefined}
          data-edge-top={regionEdges.top || undefined}
          data-edge-bottom={regionEdges.bottom || undefined}
          data-row={regionEdges.row || undefined}
          data-has-below={regionEdges.hasBelow || undefined}
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
    // 单标签非区域面板：不渲染标签条（标题栏不该出现）。hover 抓握簇
    // （拖动 / ⧉ 浮动 / × 关闭）保持拆成单标签后的可用性。
    if (only !== undefined) {
      const soloEdges = edgeMap[node.id] ?? { left: false, right: false, top: false, bottom: false, row: false, hasBelow: false }
      return (
        <div
          className={css.pane + ' ' + css.paneCard + (soloEdges.bottom ? ' ' + css.edgeBottom : '')}
          data-dock-node={node.id}
          data-testid="dock-pane"
          data-edge-left={soloEdges.left || undefined}
          data-edge-right={soloEdges.right || undefined}
          data-edge-top={soloEdges.top || undefined}
          data-edge-bottom={soloEdges.bottom || undefined}
        >
          <div className={css.paneBody}>
            {active === undefined ? <div className={css.paneEmpty}>（空面板组）</div> : renderPanelBody(active)}
          </div>
          {renderGrip(node, true)}
        </div>
      )
    }
    const edges = edgeMap[node.id] ?? { left: false, right: false, top: false, bottom: false, row: false, hasBelow: false }
    const paneCardClass = css.pane
      + ' ' + css.paneCard
      + (edges.bottom ? ' ' + css.edgeBottom : '')
    // 页头面板并入多标签组（其他卡片拖进页头）时：
    // - 卡片补 data-region-pane，让 header 的填充/去边框/隐藏 resizer/拖窗等
    //   region 规则对组内 header 生效；
    // - 宿主常驻挂载（页头标签非激活时 display:none 不占位）：syncConversationHeader
    //   始终能找到 host，header 元素不会因「页头标签非激活时 host 不渲染」被打回
    //   会话面板（现象：页头卡内 header 空白/跑到正文里）。
    const hasHeaderTab = node.tabs.some(p => p.type === REGION_CONVERSATION_HEADER)
    const activeIsHeader = active?.type === REGION_CONVERSATION_HEADER
    // 子节点带 key：单区域页头卡（children[0]=host，含外来 header）变成多标签卡时，
    // 若 children[0] 原地复用为 tabStrip，旧 host 里的外来 header 会残留在 tabStrip
    // 顶部（表现为「页头卡上半多一个 header」）；带 key 让 React 建新节点、旧节点
    // 连同外来 header 一起摘除，由 syncConversationHeader 的抢救路径重挂。
    return (
      <div
        className={paneCardClass}
        data-dock-node={node.id}
        data-testid="dock-pane"
        data-region-pane={hasHeaderTab ? REGION_CONVERSATION_HEADER : undefined}
        data-edge-left={edges.left || undefined}
        data-edge-right={edges.right || undefined}
        data-edge-top={edges.top || undefined}
        data-edge-bottom={edges.bottom || undefined}
      >
        <div key="tab-strip" className={css.tabStrip} data-testid="dock-tab-strip">
          {node.tabs.map(p => renderTabChip(p, node.id, 'node'))}
          <div className={css.tabFiller} />
        </div>
        {hasHeaderTab && (
          <div
            key="header-host"
            className={css.conversationHeaderHost}
            data-liuli-conversation-header-host=""
            style={activeIsHeader ? undefined : { display: 'none' }}
          />
        )}
        {!activeIsHeader && (
          <div key="pane-body" className={css.paneBody}>
            {active === undefined ? <div className={css.paneEmpty}>（空面板组）</div> : renderPanelBody(active)}
          </div>
        )}
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
    const fixedFlags = split.children.map(child => childFixedWidth(child, split.dir) !== undefined)
    const growSum = split.sizes.reduce((acc, s, i) => acc + (fixedFlags[i] === true ? 0 : (s ?? 1)), 0)
    // 渲染期像素 clamp：实测 split 盒主轴像素后，把 min 宽/高换算成 flexGrow，
    // 避免直接给 shard 写 minWidth/minHeight 导致子级溢出 split 盒、盖住相邻卡片。
    const totalPx = splitPxMap[split.id]
    const effPx = totalPx !== undefined && totalPx > 0 ? splitChildPx(split, totalPx) : null
    const effGrowTotal = effPx !== null ? effPx.reduce((a, b) => a + b, 0) : 0
    return (
      <div className={(split.dir === 'h' ? css.splitH : css.splitV) + ' ' + css.splitBox} data-dock-split={split.id}>
        {split.children.map((child, i) => {
          const fixed = fixedFlags[i] === true ? childFixedWidth(child, split.dir) : undefined
          // 固定宽度 shard 用分属性（flexGrow/flexShrink/flexBasis）而非 flex 简写：
          // CSS 过渡按 flex-basis 插值（简写过渡在部分浏览器不稳定），开合动画即
          // 由此驱动；flex-basis 为 0 时保持挂载（详情收起），便于 0↔w 平滑过渡。
          const shardStyle = fixed !== undefined
            ? { flexGrow: 0, flexShrink: 0, flexBasis: String(fixed) + 'px' }
            : {
                flexGrow: effPx !== null && effGrowTotal > 0
                  ? effPx[i]! / effGrowTotal
                  : growSum > 0 ? (split.sizes[i] ?? 1) / growSum : 1,
                flexBasis: 0,
                flexShrink: 1,
              }
          // 收起态（固定宽度 0）的面板与相邻面板间不渲染 sash：官方 AppFrame 在
          // details 关闭时不渲染拖拽把手（cols.details > 0 才挂），避免窗口最右缘
          // 出现隐形的 col-resize 拖拽带。
          const collapsed = fixed !== undefined && fixed === 0
          // shard 上标记直接包含的单区域面板类型，供全局 CSS 在开始页等
          // 场景按区域隐藏整个 shard（只隐藏内部 pane 不够，shard 仍占 flex 空间）。
          const childRegion = child.kind === 'tabs' && child.tabs.length === 1 && child.tabs[0] !== undefined && isRegionPanel(child.tabs[0].type)
            ? child.tabs[0].type
            : undefined
          return (
            <Fragment key={child.id}>
              {i > 0 && !collapsed && (
                <div
                  className={split.dir === 'h' ? css.sashH : css.sashV}
                  data-testid="dock-sash"
                  data-side={
                    fixedRegionType(split.children[i - 1]!) === REGION_SIDEBAR || fixedRegionType(child) === REGION_SIDEBAR
                      ? 'sidebar'
                      : fixedRegionType(split.children[i - 1]!) === REGION_DETAILS || fixedRegionType(child) === REGION_DETAILS
                        ? 'details'
                        : 'split'
                  }
                  onPointerDown={(e) => { beginSash(e, split, i, split.dir) }}
                />
              )}
              <div className={css.shard} data-dock-shard="" data-shard-region={childRegion} style={shardStyle}>
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
      data-shell-mode={isAdvancedShell() ? undefined : 'web'}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={hostPanels.details === 0 || undefined}
      data-testid="dock-shell"
      data-hmr-marker={HMR_MARKER}
      data-panels={String(panelCount(dock))}
    >
      {/* win32 无边框：移除 caption 行，画布从第 1 行起占满（窗口拖拽由会话
          header 整体承担，见 index.ts DESKTOP_ADVANCED_CSS 的 header drag 规则；
          面板悬浮由 grip ⧉ 按钮承担）。
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
            <button type="button" className={css.tabClose} data-testid="dock-menu-close" aria-label="关闭布局菜单" onClick={() => { setMenuOpen(false); setSlotMenuOpen(false) }}>×</button>
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
                saveShellDock(shellRef.current.dock, sessionId)
                setSlotsVersion(v => v + 1)
                notify('已保存布局：' + name)
              }}>保存</button>
            </div>
            <div className={css.menuRow}>
              <button
                ref={slotTriggerRef}
                type="button"
                className={css.slotSelect}
                data-testid="dock-slot-select"
                aria-haspopup="listbox"
                aria-expanded={slotMenuOpen}
                onClick={() => { if (slotMenuOpen) setSlotMenuOpen(false); else openSlotMenu() }}
              >
                <span className={css.slotSelectLabel}>{selectedSlot === '' ? '选择布局…' : selectedSlot}</span>
                <span className={css.slotSelectChevron + (slotMenuOpen ? ' ' + css.slotSelectChevronOpen : '')}>
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
                </span>
              </button>
              <button type="button" className={css.menuBtn} data-testid="dock-restore-button" onClick={() => {
                setSlotMenuOpen(false)
                const name = selectedSlot
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
      {slotMenuOpen && slotMenuPos !== null && createPortal(
        <div ref={slotMenuRef} className={css.slotMenu} role="listbox" data-testid="dock-slot-menu" style={{ left: slotMenuPos.left, top: slotMenuPos.top, width: slotMenuPos.width }}>
          {slots.length === 0 && <div className={css.slotMenuEmpty}>暂无已保存布局</div>}
          {slots.map(slot => (
            <button
              key={slot.name}
              type="button"
              role="option"
              aria-selected={selectedSlot === slot.name}
              className={css.slotMenuItem + (selectedSlot === slot.name ? ' ' + css.slotMenuItemActive : '')}
              onClick={() => { setSelectedSlot(slot.name); setSlotMenuOpen(false) }}
            >
              <span className={css.slotMenuItemLabel}>{slot.name}</span>
              {selectedSlot === slot.name && (
                <span className={css.slotMenuCheck}>
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
                </span>
              )}
            </button>
          ))}
        </div>,
        document.body,
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
      {/* 浮动窗口标题栏已显示标题；仅 ≥2 个标签时才需要标签条切换 */}
      {float.tabs.length > 1 && (
        <div className={css.tabStrip}>
          {float.tabs.map(p => renderTabChip(p, float.id, 'float'))}
          <div className={css.tabFiller} />
        </div>
      )}
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