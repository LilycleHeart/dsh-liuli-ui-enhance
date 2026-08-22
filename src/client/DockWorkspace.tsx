/**
 * Dockable Workspace UI（琉璃工作台）：
 *  - 布局树渲染（split 递归 flex + 标签组面板）；
 *  - 面板拖拽（pointer 事件 + 命中判定）：标签页合并 / 面板内拆分 /
 *    工作区边缘停靠 / 抛出浮动窗口；
 *  - 浮动窗口（拖动/缩放/整组停靠回树/关闭）；
 *  - split 拖拽缩放；
 *  - 保存/恢复：自动落 localStorage + 命名槽位 + JSON 导出/导入。
 *
 * 全部交互带 data-testid，供无头浏览器自测（demo/verify-dock-gui.mjs）。
 */
import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { collectTabsNodes, findNode, MIN_SIZE, panelCount, type DockLayout, type DockNode, type DropTarget, type FloatWindow, type PanelInstance, type TabsNode } from './dock-model.ts'
import type { DockStore } from './dock-store.ts'
import { DOCK_PANEL_DEFS, panelDef, panelTitle, type DockHostAccess } from './dock-panels.tsx'
import { markSideTabAccepted, parseSideTab, SIDE_TAB_MIME, sideTabToDockPanel, type SideTabDockPanel } from './side-tab-dock.ts'
import css from './DockWorkspace.module.css'
import { beginResizePerf, endResizePerf } from './resize-perf.ts'

/** 工作台开合事件（header 按钮/快捷键/FloatBall 共用）。 */
export const DOCK_TOGGLE_EVENT = 'liuli:dock-toggle'

const DOCK_OPEN_KEY = 'liuli.dock.open'

/** 开合状态落 localStorage：HMR 重载/页面刷新后工作台保持原开合。 */
function readDockOpen(): boolean {
  try { return localStorage.getItem(DOCK_OPEN_KEY) === '1' } catch { return false }
}

function writeDockOpen(open: boolean): void {
  try { localStorage.setItem(DOCK_OPEN_KEY, open ? '1' : '0') } catch { /* ignore */ }
}

let dockOpen = readDockOpen()

export function isDockOpen(): boolean {
  return dockOpen
}

/** 切换工作台开合（派发事件，由 index.ts 的挂载 effect 响应重渲染）。 */
export function toggleDockOpen(): boolean {
  dockOpen = !dockOpen
  writeDockOpen(dockOpen)
  window.dispatchEvent(new CustomEvent(DOCK_TOGGLE_EVENT))
  return dockOpen
}

export function setDockOpen(open: boolean): void {
  if (dockOpen === open) return
  dockOpen = open
  writeDockOpen(dockOpen)
  window.dispatchEvent(new CustomEvent(DOCK_TOGGLE_EVENT))
}

/** 会话列表的最小可读面（ctx.sessions.list 同构）。 */
export interface DockSessionList {
  getSnapshot(): { current?: string | undefined }
  subscribe(listener: () => void): () => void
}

export interface DockWorkspaceProps {
  store: DockStore
  sessionList: DockSessionList | undefined
  addFileToChat?: (path: string) => void
  openPath?: (path: string) => void
  onClose: () => void
}

interface DragSource {
  kind: 'node' | 'float'
  containerId: string
  /** 浮动窗口拖整组（标题栏）时为空。 */
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

function basename(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] ?? path
}

export function DockWorkspace({ store, sessionList, addFileToChat, openPath, onClose }: DockWorkspaceProps) {
  const layout = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [sessionId, setSessionId] = useState<string | undefined>(() => sessionList?.getSnapshot().current)
  const [drag, setDrag] = useState<DragState | null>(null)
  /** HTML5 外部拖入（右侧标签面板标签）的落点指示。 */
  const [htmlDrop, setHtmlDrop] = useState<{ over: DropTarget | null; rect: DragState['overRect'] } | null>(null)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [slotName, setSlotName] = useState('')
  const [slotsVersion, setSlotsVersion] = useState(0)
  const [modal, setModal] = useState<null | { kind: 'export' | 'import'; text: string }>(null)
  const [toast, setToast] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ source: DragSource; title: string; sx: number; sy: number; active: boolean } | null>(null)
  const htmlDragActive = useRef(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (sessionList === undefined) return
    return sessionList.subscribe(() => { setSessionId(sessionList.getSnapshot().current) })
  }, [sessionList])

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => { setToast(null) }, 2600)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
  }, [])

  /* ── 面板打开/聚焦辅助 ── */

  const openFileInDock = useCallback((path: string, rel: string): void => {
    const current = store.getSnapshot()
    // 已打开同路径代码面板 → 激活；否则新建。
    const nodes = collectTabsNodes(current.root)
    for (const node of nodes) {
      const hit = node.tabs.find(p => p.type === 'code' && p.state?.rel === rel)
      if (hit !== undefined) {
        store.setActive(node.id, hit.id)
        return
      }
    }
    for (const float of current.floats) {
      const hit = float.tabs.find(p => p.type === 'code' && p.state?.rel === rel)
      if (hit !== undefined) {
        store.setActive(float.id, hit.id)
        return
      }
    }
    store.addPanel('code', basename(rel), { rel, path })
  }, [store])

  const host: DockHostAccess = {
    sessionId,
    addFileToChat,
    openPath,
    openFileInDock,
  }

  /* ── 拖拽：命中判定 ── */

  const computeDrop = useCallback((x: number, y: number): { target: DropTarget | null; rect: DragState['overRect'] } => {
    const rootEl = rootRef.current
    if (rootEl === null) return { target: null, rect: null }
    const rootRect = rootEl.getBoundingClientRect()
    // ① 工作区边缘停靠条
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
    // ② 面板区域：边缘带 = 拆分，中心 = 标签合并
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
        // 角落命中时取更贴近的一侧
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
    // ③ 空白处 → 浮动
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
      markSideTabAccepted()
      store.placePanel(mapped.type, mapped.title, mapped.state, target ?? { kind: 'edge', side: 'right' })
      notify('已加入布局：' + (mapped.title ?? panelDef(mapped.type)?.label ?? mapped.type))
    }
    rootEl.addEventListener('dragover', onDragOver)
    rootEl.addEventListener('dragleave', onDragLeave)
    rootEl.addEventListener('drop', onDrop)
    return () => {
      rootEl.removeEventListener('dragover', onDragOver)
      rootEl.removeEventListener('dragleave', onDragLeave)
      rootEl.removeEventListener('drop', onDrop)
    }
  }, [computeDrop, store, notify])

  /* ── 拖拽：起/移/落 ── */

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
        // 视为点击：激活所在面板
        if (info.source.panelId !== undefined) store.setActive(info.source.containerId, info.source.panelId)
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
      if (info.source.kind === 'node' && info.source.panelId !== undefined) {
        store.move(info.source.panelId, target ?? floatAt())
      } else if (info.source.kind === 'float') {
        store.moveFloat(info.source.containerId, target ?? floatAt(), info.source.panelId)
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
  }, [computeDrop, store])

  /* ── split 拖拽缩放 ── */

  const beginSash = useCallback((e: React.PointerEvent, splitId: string, dividerIndex: number, dir: 'h' | 'v'): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const splitBox = (e.currentTarget as HTMLElement).parentElement
    const rect = splitBox?.getBoundingClientRect()
    if (rect === undefined) return
    const start = dir === 'h' ? e.clientX : e.clientY
    const total = dir === 'h' ? rect.width : rect.height
    if (total <= 0) return
    // 捕获拖拽起点的比例；resizeTo 是绝对赋值，拖动期间幂等不累计。
    const startSizes = ((): number[] => {
      const node = findNode(store.getSnapshot().root, splitId)
      return node !== undefined && node.kind === 'split' ? node.sizes : []
    })()
    const startRatio = startSizes[dividerIndex - 1] ?? 0.5
    // 拖拽期间直接把比例写进相邻两 shard 的 flexGrow（renderNode 语义：
    // flexGrow = sizes[i]），避免每帧 store 提交触发整棵工作台重渲染；
    // 松开后再一次性提交最终比例。
    let shards: { before: HTMLElement; after: HTMLElement; sizesTotal: number } | undefined
    if (splitBox !== null) {
      const shardEls = Array.from(splitBox.children)
        .filter((el): el is HTMLElement => el instanceof HTMLElement && css.shard !== undefined && el.classList.contains(css.shard))
      const beforeEl = shardEls[dividerIndex - 1]
      const afterEl = shardEls[dividerIndex]
      if (beforeEl !== undefined && afterEl !== undefined) {
        shards = {
          before: beforeEl,
          after: afterEl,
          sizesTotal: (startSizes[dividerIndex - 1] ?? 0.5) + (startSizes[dividerIndex] ?? 0.5),
        }
      }
    }
    let lastRatio = startRatio
    beginResizePerf()
    const onMove = (ev: PointerEvent): void => {
      const pos = dir === 'h' ? ev.clientX : ev.clientY
      const ratio = startRatio + (pos - start) / total
      lastRatio = ratio
      if (shards !== undefined) {
        // clamp 语义与 dock-model resizeSplitTo 一致。
        let na = Math.max(MIN_SIZE * shards.sizesTotal, Math.min(shards.sizesTotal - MIN_SIZE * shards.sizesTotal, ratio * shards.sizesTotal))
        if (!Number.isFinite(na)) na = shards.sizesTotal / 2
        shards.before.style.flexGrow = String(na)
        shards.after.style.flexGrow = String(shards.sizesTotal - na)
        return
      }
      store.resizeTo(splitId, dividerIndex, ratio)
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      endResizePerf()
      if (shards !== undefined) store.resizeTo(splitId, dividerIndex, lastRatio)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [store])

  /* ── 渲染辅助 ── */

  const renderPanelBody = (panel: PanelInstance): ReactNode => {
    const def = panelDef(panel.type)
    if (def === undefined) {
      return <div className={css.paneEmpty}>未知面板类型：{panel.type}</div>
    }
    return def.render({
      panel,
      host,
      onStatePatch: patch => { store.patch(panel.id, patch) },
    })
  }

  const renderTabChip = (panel: PanelInstance, containerId: string, sourceKind: 'node' | 'float'): ReactNode => {
    const def = panelDef(panel.type)
    const active = sourceKind === 'node'
      ? (findNodeActive(layout, containerId) === panel.id)
      : (layout.floats.find(f => f.id === containerId)?.activeId === panel.id)
    return (
      <div
        key={panel.id}
        className={css.tabChip + (active ? ' ' + css.tabChipActive : '')}
        data-testid="dock-tab-chip"
        data-panel-id={panel.id}
        data-active={active || undefined}
        title={panelTitle(panel)}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('[data-testid="dock-tab-close"]') !== null) return
          beginDrag(e, { kind: sourceKind, containerId, panelId: panel.id }, panelTitle(panel))
        }}
      >
        <span className={css.tabIcon}>{def?.icon}</span>
        <span className={css.tabLabel}>{panelTitle(panel)}</span>
        <button
          type="button"
          className={css.tabClose}
          data-testid="dock-tab-close"
          aria-label={'关闭 ' + panelTitle(panel)}
          onPointerDown={(e) => { e.stopPropagation() }}
          onClick={(e) => { e.stopPropagation(); store.closePanel(panel.id) }}
        >
          ×
        </button>
      </div>
    )
  }

  const renderTabsNode = (node: TabsNode): ReactNode => {
    const active = node.tabs.find(p => p.id === node.activeId) ?? node.tabs[0]
    return (
      <div className={css.pane} data-dock-node={node.id} data-testid="dock-pane">
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
    return (
      <div className={split.dir === 'h' ? css.splitH : css.splitV} data-dock-split={split.id}>
        {split.children.map((child, i) => (
          <Fragment key={child.id}>
            {i > 0 && (
              <div
                className={css.sash + (split.dir === 'h' ? ' ' + css.sashH : ' ' + css.sashV)}
                data-testid="dock-sash"
                onPointerDown={(e) => { beginSash(e, split.id, i, split.dir) }}
              />
            )}
            <div className={css.shard} style={{ flexGrow: split.sizes[i] ?? 1, flexBasis: 0 }}>
              {renderNode(child)}
            </div>
          </Fragment>
        ))}
      </div>
    )
  }

  const renderFloat = (float: FloatWindow): ReactNode => {
    const active = float.tabs.find(p => p.id === float.activeId) ?? float.tabs[0]
    return (
      <FloatWindowView
        key={float.id}
        float={float}
        active={active}
        layout={layout}
        renderTabChip={renderTabChip}
        renderPanelBody={renderPanelBody}
        onActivate={panelId => { store.setActive(float.id, panelId) }}
        onDockBack={() => {
          const vw = window.innerWidth
          const side = float.x + float.w / 2 < vw / 2 ? 'left' : 'right'
          store.moveFloat(float.id, { kind: 'edge', side })
        }}
        onCloseAll={() => { for (const tab of [...float.tabs]) store.closePanel(tab.id) }}
        onMoveBox={box => { store.moveFloatBox(float.id, box) }}
      />
    )
  }

  const slots = store.listSlots()
  void slotsVersion

  return (
    <div className={css.layer} data-testid="dock-workspace" data-panels={String(panelCount(layout))}>
      <div className={css.topBar} data-testid="dock-topbar">
        <span className={css.brand}>
          <span className={css.brandDot} aria-hidden="true" />
          琉璃工作台
        </span>
        <div className={css.addWrap}>
          <button
            type="button"
            className={css.toolBtn}
            data-testid="dock-add-button"
            onClick={() => { setAddMenuOpen(v => !v) }}
          >
            ＋ 添加面板
          </button>
          {addMenuOpen && (
            <div className={css.addMenu} data-testid="dock-add-menu">
              {DOCK_PANEL_DEFS.map(def => (
                <button
                  key={def.type}
                  type="button"
                  className={css.addMenuItem}
                  data-testid={'dock-add-' + def.type}
                  onClick={() => { store.addPanel(def.type); setAddMenuOpen(false); notify('已添加：' + def.label) }}
                >
                  <span className={css.tabIcon}>{def.icon}</span>
                  {def.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={css.spacer} />
        <input
          className={css.slotInput}
          data-testid="dock-slot-name"
          value={slotName}
          placeholder="布局名"
          onChange={(e) => { setSlotName(e.target.value) }}
        />
        <button
          type="button"
          className={css.toolBtn}
          data-testid="dock-save-button"
          onClick={() => {
            const name = slotName.trim() === '' ? '默认布局' : slotName.trim()
            store.saveSlot(name)
            setSlotsVersion(v => v + 1)
            notify('已保存布局：' + name)
          }}
        >
          保存
        </button>
        <select
          className={css.slotSelect}
          data-testid="dock-slot-select"
          defaultValue=""
        >
          <option value="" disabled>选择布局…</option>
          {slots.map(slot => (
            <option key={slot.name} value={slot.name}>{slot.name}</option>
          ))}
        </select>
        <button
          type="button"
          className={css.toolBtn}
          data-testid="dock-restore-button"
          onClick={() => {
            const select = document.querySelector('[data-testid="dock-slot-select"]') as HTMLSelectElement | null
            const name = select?.value ?? ''
            if (name === '') { notify('请先选择要恢复的布局'); return }
            if (store.loadSlot(name)) notify('已恢复布局：' + name)
            else notify('恢复失败：' + name)
          }}
        >
          恢复
        </button>
        <button
          type="button"
          className={css.toolBtn}
          data-testid="dock-export-button"
          onClick={() => { setModal({ kind: 'export', text: store.exportJSON() }) }}
        >
          导出
        </button>
        <button
          type="button"
          className={css.toolBtn}
          data-testid="dock-import-button"
          onClick={() => { setModal({ kind: 'import', text: '' }) }}
        >
          导入
        </button>
        <button
          type="button"
          className={css.toolBtn}
          data-testid="dock-reset-button"
          onClick={() => { store.reset(); notify('已重置为默认布局') }}
        >
          重置
        </button>
        <button
          type="button"
          className={css.toolBtn + ' ' + css.closeBtn}
          data-testid="dock-close-button"
          aria-label="返回 DeepSeek Harness"
          onClick={onClose}
        >
          ✕ 返回
        </button>
      </div>
      <div className={css.body}>
        <div className={css.dockRoot} ref={rootRef} data-testid="dock-root">
          {layout.root === null && layout.floats.length === 0 && (
            <div className={css.emptyHint} data-testid="dock-empty">
              <p>工作台是空的</p>
              <button type="button" className={css.toolBtn} data-testid="dock-empty-add" onClick={() => { store.addPanel('files') }}>
                ＋ 添加第一个面板
              </button>
            </div>
          )}
          {layout.root !== null && renderNode(layout.root)}
          {layout.floats.map(renderFloat)}
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
      </div>
      {drag !== null && dragRef.current?.active === true && (
        <div className={css.dragShield} data-testid="dock-drag-shield" />
      )}
      {drag !== null && dragRef.current?.active === true && (
        <div className={css.dragGhost} data-testid="dock-drag-ghost" style={{ left: drag.x + 12, top: drag.y + 12 }}>
          {drag.title}
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
                <button
                  type="button"
                  className={css.toolBtn}
                  data-testid="dock-modal-copy"
                  onClick={() => { void navigator.clipboard?.writeText(modal.text).then(() => { notify('已复制到剪贴板') }).catch(() => { notify('复制失败，请手动选择文本') }) }}
                >
                  复制
                </button>
              )}
              {modal.kind === 'import' && (
                <button
                  type="button"
                  className={css.toolBtn}
                  data-testid="dock-modal-apply"
                  onClick={() => {
                    if (store.importJSON(modal.text)) { setModal(null); notify('导入成功') }
                    else notify('导入失败：JSON 无效或布局为空')
                  }}
                >
                  应用
                </button>
              )}
              <button type="button" className={css.toolBtn} data-testid="dock-modal-close" onClick={() => { setModal(null) }}>关闭</button>
            </div>
          </div>
        </div>
      )}
      {toast !== null && <div className={css.toast} data-testid="dock-toast">{toast}</div>}
      <div className={css.summary} data-testid="dock-summary" aria-hidden="true">
        {JSON.stringify({
          panels: panelCount(layout),
          groups: collectTabsNodes(layout.root).length,
          floats: layout.floats.length,
          rootKind: layout.root?.kind ?? 'empty',
        })}
      </div>
    </div>
  )
}

/** 读取某 tabs 节点的激活面板 id。 */
function findNodeActive(layout: DockLayout, nodeId: string): string | null {
  const nodes = collectTabsNodes(layout.root)
  const node = nodes.find(n => n.id === nodeId)
  return node?.activeId ?? null
}

/* ── header 入口按钮 ── */

export interface DockButtonProps {
  onToggle: () => void
}

/** Header utilities 里的工作台入口（Ctrl+Alt+W）。 */
export function DockButton({ onToggle }: DockButtonProps) {
  const [opened, setOpened] = useState(isDockOpen())
  useEffect(() => {
    const onToggleEvent = (): void => { setOpened(isDockOpen()) }
    window.addEventListener(DOCK_TOGGLE_EVENT, onToggleEvent)
    return () => { window.removeEventListener(DOCK_TOGGLE_EVENT, onToggleEvent) }
  }, [])
  return (
    <button
      type="button"
      className={css.headerBtn + (opened ? ' ' + css.headerBtnActive : '')}
      data-testid="dock-header-button"
      title="琉璃工作台 Dockable Workspace (Ctrl+Alt+W)"
      aria-label={opened ? '关闭琉璃工作台' : '打开琉璃工作台'}
      onClick={onToggle}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path fill="currentColor" d="M3 3h8v8H3V3zm2 2v4h4V5H5zm8-2h8v5h-8V3zm2 2v1h4V5h-4zm-2 4h8v12h-8V9zm2 2v8h4v-8h-4zM3 14h8v7H3v-7zm2 2v3h4v-3H5z" />
      </svg>
    </button>
  )
}

/* ── 浮动窗口 ── */

interface FloatWindowViewProps {
  float: FloatWindow
  active: PanelInstance | undefined
  layout: DockLayout
  renderTabChip: (panel: PanelInstance, containerId: string, sourceKind: 'float') => ReactNode
  renderPanelBody: (panel: PanelInstance) => ReactNode
  onActivate: (panelId: string) => void
  onDockBack: () => void
  onCloseAll: () => void
  onMoveBox: (box: { x: number; y: number; w: number; h: number }) => void
}

function FloatWindowView({ float, active, layout, renderTabChip, renderPanelBody, onActivate, onDockBack, onCloseAll, onMoveBox }: FloatWindowViewProps) {
  void layout
  void onActivate
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
        title="拖动移动；双击停靠回工作区"
      >
        <span className={css.floatGrip} aria-hidden="true">⠿</span>
        <span className={css.floatTitleText}>{active !== undefined ? panelTitle(active) : '浮动窗口'}</span>
        <button
          type="button"
          className={css.floatBtn}
          data-testid="dock-float-dock"
          aria-label="停靠回工作区"
          title="停靠回工作区"
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
