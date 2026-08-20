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
  createPanel, emptyLayout, findTabsContaining, makeTabsNode, nextId, normalizeSizes,
  parseDockLayout, removePanel,
  type DockLayout, type DockNode, type PanelInstance,
} from './dock-model.ts'

/* ── 几何常量（对齐官方 ui-layout 契约，仅作文档参考） ── */

export const SIDEBAR_DEFAULT = 280
export const DETAILS_DEFAULT = 360

/* ── 区域面板类型 ── */

export const REGION_SIDEBAR = 'region:sidebar'
export const REGION_CONVERSATION = 'region:conversation'
/** 会话标题面板：渲染宿主的 conversation.session.header（与会话面板垂直拆分）。 */
export const REGION_CONVERSATION_HEADER = 'region:conversation-header'
export const REGION_DETAILS = 'region:details'

export function isRegionPanel(type: string): boolean {
  return type === REGION_SIDEBAR || type === REGION_CONVERSATION || type === REGION_CONVERSATION_HEADER || type === REGION_DETAILS
}

export function regionLabel(type: string): string {
  switch (type) {
    case REGION_SIDEBAR: return '侧边栏'
    case REGION_CONVERSATION: return '会话'
    case REGION_CONVERSATION_HEADER: return '会话标题'
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
  const header = createPanel(layout, REGION_CONVERSATION_HEADER)
  const conversation = createPanel(layout, REGION_CONVERSATION)
  const details = createPanel(layout, REGION_DETAILS)
  const left = makeTabsNode(layout, [sidebar])
  // 会话区域垂直拆分：上 = 会话标题面板，下 = 对话页面板
  const headerGroup = makeTabsNode(layout, [header])
  const convGroup = makeTabsNode(layout, [conversation])
  const middle = {
    id: nextId(layout, 's'),
    kind: 'split' as const,
    dir: 'v' as const,
    sizes: [0.14, 0.86],
    children: [headerGroup, convGroup],
  }
  const right = makeTabsNode(layout, [details])
  layout.root = {
    id: nextId(layout, 's'),
    kind: 'split',
    dir: 'h',
    sizes: [0.2, 0.75, 0.05],
    children: [left, middle, right],
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
  next.root = {
    id: nextId(next, 's'),
    kind: 'split',
    dir: 'h',
    sizes: before ? [0.2, 0.8] : [0.8, 0.2],
    children: before ? [group, next.root] : [next.root, group],
  }
  return next
}

/** 从布局里移除某区域面板（若存在）。 */
export function withoutRegion(layout: DockLayout, type: string): DockLayout {
  const panel = findRegion(layout, type)
  if (panel === undefined) return layout
  return removePanel(layout, panel.id)
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

/** 树内替换节点（dock-model 的 mapTree 未导出，此处按相同折叠语义实现）。 */
function mapTreeReplace(node: DockNode | null, targetId: string, fn: (n: DockNode) => DockNode | null): DockNode | null {
  if (node === null) return null
  if (node.id === targetId) return fn(node)
  if (node.kind === 'tabs') return node
  const children: DockNode[] = []
  const sizes: number[] = []
  node.children.forEach((child, i) => {
    const mapped = mapTreeReplace(child, targetId, fn)
    if (mapped !== null) { children.push(mapped); sizes.push(node.sizes[i] ?? 1) }
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0]!
  if (children.length === node.children.length) return { ...node, children, sizes: node.sizes }
  return { ...node, children, sizes: normalizeSizes(sizes) }
}

/** 布局恢复的会话标题面板保底：旧布局没有 header 面板时，把会话面板所在
 *  标签组垂直拆成 [header 面板 | 原标签组]（标题在上）。若 header 已在树中
 *  则原样返回。 */
export function ensureConversationHeader(layout: DockLayout): DockLayout {
  if (findRegion(layout, REGION_CONVERSATION_HEADER) !== undefined) return layout
  const conv = findRegion(layout, REGION_CONVERSATION)
  if (conv === undefined) return layout
  const hit = findTabsContaining(layout.root, conv.id)
  if (hit === undefined) {
    // 会话在浮动窗口（少见）：把 header 面板并入同一浮动标签组
    const next = structuredClone(layout)
    for (const float of next.floats) {
      if (float.tabs.some(p => p.id === conv.id)) {
        const header = createPanel(next, REGION_CONVERSATION_HEADER)
        float.tabs.splice(float.tabs.findIndex(p => p.id === conv.id), 0, header)
        float.activeId = header.id
        return next
      }
    }
    return layout
  }
  const next = structuredClone(layout)
  const header = createPanel(next, REGION_CONVERSATION_HEADER)
  const headerGroup = makeTabsNode(next, [header])
  const replacement: DockNode = {
    id: nextId(next, 's'),
    kind: 'split',
    dir: 'v',
    sizes: [0.14, 0.86],
    children: [headerGroup, hit.node],
  }
  next.root = mapTreeReplace(next.root, hit.node.id, () => replacement)
  return next
}

export function loadSavedDock(): DockLayout | undefined {
  try {
    const raw = localStorage.getItem(DOCK_SHELL_LS_KEY)
    if (raw === null || raw === '') return undefined
    const parsed = JSON.parse(raw) as { dock?: unknown } | undefined
    if (parsed === null || typeof parsed !== 'object') return undefined
    const payload = 'dock' in parsed ? parsed.dock : parsed
    if (payload === undefined || payload === null) return undefined
    let dock = parseDockLayout(payload)
    // 会话区域必须在树里（布局恢复的保底不变量）
    if (findRegion(dock, REGION_CONVERSATION) === undefined) {
      dock = withRegion(dock, REGION_CONVERSATION, 'right')
    }
    // 会话标题面板保底：旧布局无 header 面板时垂直拆分补挂（标题在上）
    dock = ensureConversationHeader(dock)
    // 详情面板常驻树中（宽 0 隐藏）：旧布局/外部布局缺详情时补挂，
    // 保证开合始终走宽度过渡而非整组挂卸。
    if (findRegion(dock, REGION_DETAILS) === undefined) {
      dock = withRegion(dock, REGION_DETAILS, 'right')
    }
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

/** 自动保存（帧层订阅 store 变化后调用，防抖在帧层）。 */
export function saveShellDock(dock: DockLayout): void {
  try {
    localStorage.setItem(DOCK_SHELL_LS_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), dock }))
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
    return layout
  } catch {
    return undefined
  }
}