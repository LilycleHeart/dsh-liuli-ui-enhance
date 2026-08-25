/**
 * Dockable Shell（高级模式）状态层：
 *  - 桌面 advanced shell（dsh-plugin-desktop）提供 `layout` 服务（sidebar/details
 *    宽度 + narrow 语义）并声明 root 子 slot；琉璃不重复提供服务，
 *    只托管 **dock 布局树**（区域面板 + 扩展面板 + 浮动窗口）；
 *  - 帧层（dock-shell-frame.tsx）以更低渲染优先级接管 root slot，
 *    订阅宿主 layout 状态驱动 sidebar 收起/详情开合，dock 树驱动面板停靠拓扑；
 *  - Workspace 保存/恢复：dock 树自动落 localStorage（防抖）+ 命名槽位 + 导出/导入。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  createPanel, emptyLayout, findParentSplit, findTabsContaining, flattenSameDirSplits, makeTabsNode, nextId, normalizeSizes, parseDockLayout, removePanel,
  type DockLayout, type PanelInstance,
} from './dock-model.ts'

/* ── 几何常量（对齐官方 ui-layout 契约，仅作文档参考） ── */

export const SIDEBAR_DEFAULT = 280
export const DETAILS_DEFAULT = 360

/**
 * 侧栏宽度契约（与宿主 dsh-client-ui-layout 的 setSidebar clamp 一致；
 * 0 语义由 toggleSidebar 处理）。dock-shell-frame 的 sash 拖拽直写
 * flex-basis 时复用同一 clamp，避免把侧栏拖到容器外/负值。
 */
export const SIDEBAR_MIN = 264
export const SIDEBAR_MAX = 420

/** 详情宽度下限（琉璃 advanced 模式突破宿主 300 下限到 240；上限为视口 88%）。 */
export const DETAILS_MIN = 240

/** 详情宽度上限比例（与 PreviewPanel 的 WIDTH_MAX_RATIO 一致）。 */
export const DETAILS_MAX_RATIO = 0.88

/** 会话列最小宽度（与 index.ts DESKTOP_ADVANCED_CSS 中的 min-width 同步；
 *  对齐宿主 computeColumns 的 640 参考宽度，避免详情 sash 把会话压得过窄）。 */
export const CONVERSATION_MIN = 640

/* ── 区域面板类型 ── */

export const REGION_SIDEBAR = 'region:sidebar'
export const REGION_CONVERSATION = 'region:conversation'
export const REGION_CONVERSATION_HEADER = 'region:conversation-header'
export const REGION_DETAILS = 'region:details'

/** 会话页头面板（pane 卡片）的最小可见高度：78px（用户元素拾取实测
 *  x=284 y=4 1257x78，tabs 按钮底部完整可见）。
 *  shard 最小高度 = 78 + 2×dockPad（paneCard 上下 margin 各一份留白），
 *  由 dock-shell-frame 的 childMinPx 在运行时用 --liuli-dock-padding 换算。 */
export const CONVERSATION_HEADER_MIN_H = 78

export function isRegionPanel(type: string): boolean {
  return type === REGION_SIDEBAR || type === REGION_CONVERSATION || type === REGION_CONVERSATION_HEADER || type === REGION_DETAILS
}

export function regionLabel(type: string): string {
  switch (type) {
    case REGION_SIDEBAR: return '侧边栏'
    case REGION_CONVERSATION: return '会话'
    case REGION_CONVERSATION_HEADER: return '会话页头'
    case REGION_DETAILS: return '详情'
    default: return type
  }
}

/* ── 宿主 layout 服务的可读面（桌面 DesktopLayoutState 同构） ── */

export interface HostLayoutSnapshot {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
}

export interface HostLayoutFace {
  subscribe(listener: () => void): () => void
  getSnapshot(): HostLayoutSnapshot
  toggleSidebar(): void
  openDetails(): void
  closeDetails(): void
  /** 侧栏宽度（宿主 clamp 264..420；0 语义由 toggleSidebar 处理）。 */
  setSidebar(width: number): void
  /** 详情宽度（宿主 clamp 300..520）。 */
  setDetails(width: number): void
}

/* ── 默认布局：[侧边栏 | 会话 | 详情] ──
   详情面板常驻树中（对齐官方 AppFrame 的 DetailsColumn 语义：关闭时宽度 0、
   子树保持挂载），开合只切换 shard 宽度（0 ↔ 详情宽），由帧层 CSS 过渡驱动
   平滑动画，会话列随之补位。sizes 中详情占比仅作会话列 grow 的归一参考。 ── */

export function defaultShellLayout(): DockLayout {
  const layout = emptyLayout()
  const sidebar = createPanel(layout, REGION_SIDEBAR)
  const conversationHeader = createPanel(layout, REGION_CONVERSATION_HEADER)
  const conversation = createPanel(layout, REGION_CONVERSATION)
  const details = createPanel(layout, REGION_DETAILS)
  const left = makeTabsNode(layout, [sidebar])
  const header = makeTabsNode(layout, [conversationHeader])
  const middle = makeTabsNode(layout, [conversation])
  const right = makeTabsNode(layout, [details])
  // 会话列 = 页头 / 正文上下两个独立面板（可拖拽、停靠、浮动）。
  const center = {
    id: nextId(layout, 's'),
    kind: 'split' as const,
    dir: 'v' as const,
    sizes: [0.16, 0.84],
    children: [header, middle],
  }
  layout.root = {
    id: nextId(layout, 's'),
    kind: 'split',
    dir: 'h',
    sizes: [0.2, 0.75, 0.05],
    children: [left, center, right],
  }
  return layout
}

/** 保证某区域面板在树里（缺失时加到指定边缘）。 */
export function withRegion(layout: DockLayout, type: string, side: 'left' | 'right'): DockLayout {
  if (findRegion(layout, type) !== undefined) return layout
  const next = structuredClone(layout)
  const panel = createPanel(next, type)
  const group = makeTabsNode(next, [panel])
  if (next.root === null) {
    next.root = group
    return next
  }
  const before = side === 'left'
  // 根已是横向 split 时直接作为兄弟插入，避免 [ [旧树], 区域 ] 的嵌套；
  // 否则才包一层新的横向 split。
  if (next.root.kind === 'split' && next.root.dir === 'h') {
    const index = before ? 0 : next.root.children.length
    next.root.children.splice(index, 0, group)
    next.root.sizes.splice(index, 0, 0.2)
    next.root.sizes = normalizeSizes(next.root.sizes)
    return next
  }
  next.root = {
    id: nextId(next, 's'),
    kind: 'split',
    dir: 'h',
    sizes: before ? [0.2, 0.8] : [0.8, 0.2],
    children: before ? [group, next.root] : [next.root, group],
  }
  return next
}

/**
 * 把区域面板补挂到目标区域面板的上方（垂直堆叠）。
 * 会话页头面板（conversation-header）缺失时用此函数补到会话面板上方；
 * 目标父级已是纵向 split 时按同向兄弟插入（避免同向嵌套），否则包一层纵向 split。
 */
export function withRegionAbove(layout: DockLayout, type: string, targetType: string): DockLayout {
  if (findRegion(layout, type) !== undefined) return layout
  const target = findRegion(layout, targetType)
  if (target === undefined) return layout
  const next = structuredClone(layout)
  const targetPanel = findRegion(next, targetType)
  if (targetPanel === undefined) return next
  const containing = findTabsContaining(next.root, targetPanel.id)
  if (containing === undefined) return next
  const panel = createPanel(next, type)
  const group = makeTabsNode(next, [panel])
  const parent = next.root !== null ? findParentSplit(next.root, containing.node.id) : undefined
  if (parent === undefined) {
    // 根就是 tabs（防御性）：包一层纵向 split。
    next.root = {
      id: nextId(next, 's'),
      kind: 'split',
      dir: 'v',
      sizes: [0.16, 0.84],
      children: [group, containing.node],
    }
    return next
  }
  if (parent.parent.dir === 'v') {
    // 同向 split：兄弟插入，避免 [ [页头, 会话], … ] 同向嵌套。
    parent.parent.children.splice(parent.index, 0, group)
    parent.parent.sizes.splice(parent.index, 0, 0.5)
    parent.parent.sizes = normalizeSizes(parent.parent.sizes)
  } else {
    // 父级是横向 split：把目标 tabs 包成纵向 split [页头, 目标]，份额由新 split 继承。
    const stacked = {
      id: nextId(next, 's'),
      kind: 'split' as const,
      dir: 'v' as const,
      sizes: [0.16, 0.84],
      children: [group, containing.node],
    }
    parent.parent.children[parent.index] = stacked
  }
  next.root = flattenSameDirSplits(next.root)
  return next
}

/** 从布局里移除某区域面板（若存在）。 */
export function withoutRegion(layout: DockLayout, type: string): DockLayout {
  const panel = findRegion(layout, type)
  if (panel === undefined) return layout
  return removePanel(layout, panel.id)
}

/** 从布局里彻底移除某区域面板（含浮动窗口中的；多处出现时逐次清理，
 *  上限 8 次防御性兜底）。右侧边栏（unofficial_sidebar）关闭时，
 *  DockShellFrame 用它把 detail 区域从加载/默认布局中剔除。 */
export function stripRegionPanels(layout: DockLayout, type: string): DockLayout {
  let next = layout
  for (let i = 0; i < 8; i += 1) {
    if (findRegion(next, type) === undefined) return next
    next = withoutRegion(next, type)
  }
  return next
}

export function findRegion(layout: DockLayout, type: string): PanelInstance | undefined {
  if (layout.root !== null) {
    const hit = findRegionIn(layout.root, type)
    if (hit !== undefined) return hit
  }
  for (const float of layout.floats) {
    const panel = float.tabs.find(p => p.type === type)
    if (panel !== undefined) return panel
  }
  return undefined
}

function findRegionIn(node: NonNullable<DockLayout['root']>, type: string): PanelInstance | undefined {
  if (node.kind === 'tabs') return node.tabs.find(p => p.type === type)
  for (const child of node.children) {
    const hit = findRegionIn(child, type)
    if (hit !== undefined) return hit
  }
  return undefined
}

/* ── Shell dock 状态仓库（只托管 dock 树；宽度语义归宿主 layout 服务） ── */

export const DOCK_SHELL_LS_KEY = 'liuli.dockshell.v1'
export const DOCK_SHELL_SLOTS_KEY = 'liuli.dockshell.slots.v1'

export type DockShellState = {
  /** dockable 布局树（区域面板 + 扩展面板 + 浮动窗口）。 */
  dock: DockLayout
}

type DockShellActions = {
  /** 直接替换 dock 布局（帧层用纯模型函数算好后写回）。 */
  setDock: (draft: DockShellState, layout: DockLayout) => void
  resetShell: (draft: DockShellState) => void
}

/** 会话级 dock 布局存储 key：liuli.dockshell.v1.<sessionId>；空会话回退全局 key（兼容旧数据）。 */
function dockStorageKey(sessionId?: string | null): string {
  return sessionId !== undefined && sessionId !== null && sessionId !== ''
    ? DOCK_SHELL_LS_KEY + '.' + sessionId
    : DOCK_SHELL_LS_KEY
}

export function loadSavedDock(sessionId?: string | null): DockLayout | undefined {
  try {
    const key = dockStorageKey(sessionId)
    let raw = localStorage.getItem(key)
    // 会话没有独立布局时，回退旧版全局布局一次（迁移旧数据；之后该会话会保存成自己的布局）。
    if (raw === null || raw === '' && key !== DOCK_SHELL_LS_KEY) {
      raw = localStorage.getItem(DOCK_SHELL_LS_KEY)
    }
    if (raw === null || raw === '') return undefined
    const parsed = JSON.parse(raw) as { dock?: unknown } | undefined
    if (parsed === null || typeof parsed !== 'object') return undefined
    const payload = 'dock' in parsed ? parsed.dock : parsed
    if (payload === undefined || payload === null) return undefined
    let dock = parseDockLayout(payload)
    dock.root = flattenSameDirSplits(dock.root)
    // 会话区域必须在树里（布局恢复的保底不变量）
    if (findRegion(dock, REGION_CONVERSATION) === undefined) {
      dock = withRegion(dock, REGION_CONVERSATION, 'right')
    }
    // 会话页头面板也常驻树中（默认拆在会话上方；用户可拖走但不会被删）。
    if (findRegion(dock, REGION_CONVERSATION_HEADER) === undefined) {
      dock = withRegionAbove(dock, REGION_CONVERSATION_HEADER, REGION_CONVERSATION)
    }
    // 详情面板常驻树中（宽 0 隐藏）：旧布局/外部布局缺详情时补挂，
    // 保证开合始终走宽度过渡而非整组挂卸。
    if (findRegion(dock, REGION_DETAILS) === undefined) {
      dock = withRegion(dock, REGION_DETAILS, 'right')
    }
    dock.root = flattenSameDirSplits(dock.root)
    return dock
  } catch {
    return undefined
  }
}

/** 创建 shell dock 状态仓库 handle（框架外直接 .create() 实例化）。 */
export function createDockShellStore(): EngineStoreHandle<DockShellState, DockShellActions> {
  return defineStore({
    init: (): DockShellState => {
      const saved = loadSavedDock()
      return { dock: saved ?? defaultShellLayout() }
    },
    actions: {
      setDock: (d, layout: DockLayout) => { d.dock = layout },
      resetShell: (d) => { d.dock = defaultShellLayout() },
    },
  })
}

/** 自动保存（帧层订阅 store 变化后调用，防抖在帧层）。
 *  传入 sessionId 时写入会话级布局；否则写入全局布局（兼容旧数据/无会话场景）。 */
export function saveShellDock(dock: DockLayout, sessionId?: string | null): void {
  try {
    localStorage.setItem(dockStorageKey(sessionId), JSON.stringify({ v: 1, savedAt: Date.now(), dock }))
  } catch { /* ignore */ }
}

/* ── 命名槽位 / 导出导入（帧层与自测钩子共用） ── */

function readSlotsMap(): Record<string, { dock: DockLayout; updatedAt: number }> {
  try {
    const raw = localStorage.getItem(DOCK_SHELL_SLOTS_KEY)
    if (raw === null || raw === '') return {}
    const parsed = JSON.parse(raw) as Record<string, { dock: DockLayout; updatedAt: number }>
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveShellSlotByName(name: string, dock: DockLayout): boolean {
  const key = name.trim()
  if (key === '') return false
  const slots = readSlotsMap()
  slots[key] = { dock, updatedAt: Date.now() }
  try { localStorage.setItem(DOCK_SHELL_SLOTS_KEY, JSON.stringify(slots)); return true } catch { return false }
}

export function listShellSlotNames(): Array<{ name: string; updatedAt: number }> {
  return Object.entries(readSlotsMap())
    .map(([name, entry]) => ({ name, updatedAt: entry.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadShellSlotByName(name: string): DockLayout | undefined {
  const entry = readSlotsMap()[name]
  if (entry === undefined) return undefined
  return parseDockSafe(entry.dock)
}

export function exportDockJSON(dock: DockLayout): string {
  return JSON.stringify({ v: 1, dock })
}

export function importDockJSON(text: string): DockLayout | undefined {
  let parsed: unknown
  try { parsed = JSON.parse(text) as unknown } catch { return undefined }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const dockRaw = (parsed as { dock?: unknown }).dock ?? parsed
  return parseDockSafe(dockRaw)
}

function parseDockSafe(raw: unknown): DockLayout | undefined {
  try {
    const layout = parseDockLayout(raw)
    if (layout.root === null && layout.floats.length === 0) return undefined
    layout.root = flattenSameDirSplits(layout.root)
    return layout
  } catch {
    return undefined
  }
}