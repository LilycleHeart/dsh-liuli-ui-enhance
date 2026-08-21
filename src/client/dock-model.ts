/**
 * Dockable Workspace 布局模型（纯逻辑，无 React/DOM 依赖）。
 *
 * 布局是一棵树：
 *  - TabsNode：一个面板组（标签页合并的载体），含若干面板实例 + 激活项；
 *  - SplitNode：水平（h = 左右并排）或垂直（v = 上下叠放）拆分，
 *    children ≥ 2，sizes 为比例数组（和 = 1）。
 * 浮动窗口（FloatWindow）不在树里，是独立的带坐标标签组。
 *
 * 所有操作都是纯函数：接收布局，返回新布局（structuredClone 语义，
 * 调用方可安全持有旧引用）。序列化产物可直接落 localStorage 做
 * Workspace 保存/恢复；parseDockLayout 对损坏数据做防御性归一。
 */

export type DockSide = 'left' | 'right' | 'top' | 'bottom'

/** 面板实例：类型来自面板注册表，state 由面板自行解释（随布局一起持久化）。 */
export interface PanelInstance {
  id: string
  type: string
  title?: string
  state?: Record<string, unknown>
}

export interface TabsNode {
  id: string
  kind: 'tabs'
  tabs: PanelInstance[]
  activeId: string | null
}

export interface SplitNode {
  id: string
  kind: 'split'
  /** h = 子级左右排布；v = 子级上下排布。 */
  dir: 'h' | 'v'
  /** 与 children 等长的比例数组，和恒为 1。 */
  sizes: number[]
  children: DockNode[]
}

export type DockNode = TabsNode | SplitNode

export interface FloatWindow {
  id: string
  x: number
  y: number
  w: number
  h: number
  tabs: PanelInstance[]
  activeId: string | null
}

export interface DockLayout {
  root: DockNode | null
  floats: FloatWindow[]
  /** id 自增种子（恢复后仍保持唯一）。 */
  seq: number
}

/** 拖放目标：合并进标签组 / 面板内拆分 / 工作区边缘停靠 / 抛出为浮动。 */
export type DropTarget =
  | { kind: 'tab'; nodeId: string; index: number }
  | { kind: 'split'; nodeId: string; side: DockSide }
  | { kind: 'edge'; side: DockSide }
  | { kind: 'float'; x: number; y: number }

/** split 子级最小比例（sash 缩放 clamp 用；拖拽直写 DOM 路径需复用同一常量）。 */
export const MIN_SIZE = 0.12

/* ── 基础构造 ── */

export function emptyLayout(): DockLayout {
  return { root: null, floats: [], seq: 1 }
}

export function nextId(layout: DockLayout, prefix: string): string {
  const id = `${prefix}${layout.seq}`
  layout.seq += 1
  return id
}

export function makeTabsNode(layout: DockLayout, tabs: PanelInstance[] = []): TabsNode {
  return { id: nextId(layout, 'n'), kind: 'tabs', tabs, activeId: tabs[0]?.id ?? null }
}

/** 归一 sizes：全部 ≥ MIN_SIZE 且和为 1（等比压缩）。 */
export function normalizeSizes(sizes: number[]): number[] {
  const clamped = sizes.map(s => Math.max(MIN_SIZE, Number.isFinite(s) ? s : MIN_SIZE))
  const sum = clamped.reduce((a, b) => a + b, 0)
  if (sum <= 0) return sizes.map(() => 1 / Math.max(1, sizes.length))
  return clamped.map(s => s / sum)
}

/* ── 查询 ── */

export function findNode(root: DockNode | null, id: string): DockNode | undefined {
  if (root === null) return undefined
  if (root.id === id) return root
  if (root.kind === 'split') {
    for (const child of root.children) {
      const hit = findNode(child, id)
      if (hit !== undefined) return hit
    }
  }
  return undefined
}

export function findTabsContaining(root: DockNode | null, panelId: string): { node: TabsNode; index: number } | undefined {
  if (root === null) return undefined
  if (root.kind === 'tabs') {
    const index = root.tabs.findIndex(p => p.id === panelId)
    return index === -1 ? undefined : { node: root, index }
  }
  for (const child of root.children) {
    const hit = findTabsContaining(child, panelId)
    if (hit !== undefined) return hit
  }
  return undefined
}

export function findPanel(layout: DockLayout, panelId: string): PanelInstance | undefined {
  const inTree = findTabsContaining(layout.root, panelId)
  if (inTree !== undefined) return inTree.node.tabs[inTree.index]
  for (const float of layout.floats) {
    const hit = float.tabs.find(p => p.id === panelId)
    if (hit !== undefined) return hit
  }
  return undefined
}

export function panelCount(layout: DockLayout): number {
  let count = 0
  const visit = (node: DockNode | null): void => {
    if (node === null) return
    if (node.kind === 'tabs') { count += node.tabs.length; return }
    node.children.forEach(visit)
  }
  visit(layout.root)
  for (const float of layout.floats) count += float.tabs.length
  return count
}

/** 深度优先收集所有 TabsNode（渲染/命中注册用）。 */
export function collectTabsNodes(root: DockNode | null): TabsNode[] {
  const out: TabsNode[] = []
  const visit = (node: DockNode | null): void => {
    if (node === null) return
    if (node.kind === 'tabs') { out.push(node); return }
    node.children.forEach(visit)
  }
  visit(root)
  return out
}

/** 深度优先最后一个 TabsNode（新面板默认落入处）。 */
export function lastTabsNode(root: DockNode | null): TabsNode | undefined {
  const nodes = collectTabsNodes(root)
  return nodes[nodes.length - 1]
}

export function findFloat(layout: DockLayout, floatId: string): FloatWindow | undefined {
  return layout.floats.find(f => f.id === floatId)
}

/* ── 树变换（不可变） ── */

/** 用 fn 的返回值替换 id 节点；fn 返回 null 表示删除该节点（父级折叠）。 */
function mapTree(node: DockNode | null, id: string, fn: (n: DockNode) => DockNode | null): DockNode | null {
  if (node === null) return null
  if (node.id === id) return fn(node)
  if (node.kind === 'tabs') return node
  const children = node.children.map(child => mapTree(child, id, fn))
  // 子级被删（null）→ 折叠 split。
  const kept: DockNode[] = []
  const sizes: number[] = []
  children.forEach((child, i) => {
    if (child !== null) { kept.push(child); sizes.push(node.sizes[i] ?? 1) }
  })
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0]!
  if (kept.length === node.children.length) {
    return { ...node, children: kept, sizes: node.sizes }
  }
  return { ...node, children: kept, sizes: normalizeSizes(sizes) }
}

function sideToSplit(side: DockSide): { dir: 'h' | 'v'; before: boolean } {
  switch (side) {
    case 'left': return { dir: 'h', before: true }
    case 'right': return { dir: 'h', before: false }
    case 'top': return { dir: 'v', before: true }
    default: return { dir: 'v', before: false }
  }
}

/* ── 面板操作 ── */

/** 新建一个面板实例（不放置）。 */
export function createPanel(layout: DockLayout, type: string, title?: string, state?: Record<string, unknown>): PanelInstance {
  const panel: PanelInstance = { id: nextId(layout, 'p'), type }
  if (title !== undefined) panel.title = title
  if (state !== undefined) panel.state = state
  return panel
}

/**
 * 添加面板：优先放入 targetNodeId 指定的标签组；否则放入深度优先最后一个
 * 标签组；树为空时创建根标签组。返回新布局与面板 id。
 */
export function addPanel(layout: DockLayout, panel: PanelInstance, targetNodeId?: string): DockLayout {
  const next = structuredClone(layout)
  let placed = false
  if (targetNodeId !== undefined) {
    const target = findNode(next.root, targetNodeId)
    if (target !== undefined && target.kind === 'tabs') {
      target.tabs.push(panel)
      target.activeId = panel.id
      placed = true
    }
  }
  if (!placed) {
    const last = lastTabsNode(next.root)
    if (last !== undefined) {
      last.tabs.push(panel)
      last.activeId = panel.id
      placed = true
    }
  }
  if (!placed) {
    next.root = { id: nextId(next, 'n'), kind: 'tabs', tabs: [panel], activeId: panel.id }
  }
  return next
}

/** 从树中移除面板；空标签组删除并折叠父级。返回移除的面板（若有）。 */
function extractPanel(layout: DockLayout, panelId: string): { layout: DockLayout; panel: PanelInstance | undefined } {
  const next = structuredClone(layout)
  // 树内查找
  const hit = findTabsContaining(next.root, panelId)
  if (hit !== undefined) {
    const [panel] = hit.node.tabs.splice(hit.index, 1)
    if (hit.node.activeId === panelId) {
      hit.node.activeId = hit.node.tabs[hit.index]?.id ?? hit.node.tabs[hit.index - 1]?.id ?? null
    }
    if (hit.node.tabs.length === 0) {
      next.root = mapTree(next.root, hit.node.id, () => null)
    }
    return { layout: next, panel }
  }
  // 浮动窗口内查找
  for (let i = 0; i < next.floats.length; i += 1) {
    const float = next.floats[i]!
    const index = float.tabs.findIndex(p => p.id === panelId)
    if (index !== -1) {
      const [panel] = float.tabs.splice(index, 1)
      if (float.activeId === panelId) {
        float.activeId = float.tabs[index]?.id ?? float.tabs[index - 1]?.id ?? null
      }
      if (float.tabs.length === 0) next.floats.splice(i, 1)
      return { layout: next, panel }
    }
  }
  return { layout: next, panel: undefined }
}

/** 关闭面板。 */
export function removePanel(layout: DockLayout, panelId: string): DockLayout {
  return extractPanel(layout, panelId).layout
}

/** 插入一组面板到目标（tab 目标合并进标签组；split/edge 目标新建标签组）。 */
function insertPanels(layout: DockLayout, panels: PanelInstance[], activeId: string | null, target: Exclude<DropTarget, { kind: 'float'; x: number; y: number }>): DockLayout {
  if (panels.length === 0) return layout
  const next = structuredClone(layout)
  if (target.kind === 'tab') {
    const node = findNode(next.root, target.nodeId)
    if (node !== undefined && node.kind === 'tabs') {
      const index = Math.max(0, Math.min(target.index, node.tabs.length))
      node.tabs.splice(index, 0, ...panels)
      node.activeId = activeId ?? panels[0]?.id ?? node.activeId
      return next
    }
    // 目标节点已不存在 → 落到最后一个标签组或新建根。
    const last = lastTabsNode(next.root)
    if (last !== undefined) {
      last.tabs.push(...panels)
      last.activeId = activeId ?? panels[0]?.id ?? last.activeId
      return next
    }
    next.root = { id: nextId(next, 'n'), kind: 'tabs', tabs: panels, activeId: activeId ?? panels[0]?.id ?? null }
    return next
  }
  // split / edge：新建承载标签组
  const group: TabsNode = { id: nextId(next, 'n'), kind: 'tabs', tabs: panels, activeId: activeId ?? panels[0]?.id ?? null }
  if (target.kind === 'edge') {
    if (next.root === null) {
      next.root = group
    } else {
      const { dir, before } = sideToSplit(target.side)
      next.root = {
        id: nextId(next, 's'),
        kind: 'split',
        dir,
        sizes: [0.5, 0.5],
        children: before ? [group, next.root] : [next.root, group],
      }
    }
    return next
  }
  // target.kind === 'split'
  if (next.root === null) {
    next.root = group
    return next
  }
  const node = findNode(next.root, target.nodeId)
  if (node === undefined) {
    const last = lastTabsNode(next.root)
    if (last !== undefined) { last.tabs.push(...panels); last.activeId = group.activeId; return next }
    next.root = group
    return next
  }
  const { dir, before } = sideToSplit(target.side)
  const replacement: SplitNode = {
    id: nextId(next, 's'),
    kind: 'split',
    dir,
    sizes: [0.5, 0.5],
    children: before ? [group, node] : [node, group],
  }
  next.root = mapTree(next.root, target.nodeId, () => replacement)
  return next
}

/**
 * 移动面板到目标（拖拽语义）：
 *  - tab：合并进标签组（标签页合并/重排）；
 *  - split：在目标面板区域内拆分；
 *  - edge：停靠到工作区边缘；
 *  - float：抛出为浮动窗口。
 */
export function movePanel(layout: DockLayout, panelId: string, target: DropTarget): DockLayout {
  const source = findTabsContaining(layout.root, panelId)
  if (target.kind === 'float') {
    const extracted = extractPanel(layout, panelId)
    if (extracted.panel === undefined) return layout
    const next = extracted.layout
    const float: FloatWindow = {
      id: nextId(next, 'f'),
      x: target.x,
      y: target.y,
      w: 480,
      h: 360,
      tabs: [extracted.panel],
      activeId: extracted.panel.id,
    }
    next.floats.push(float)
    return next
  }
  // 同源标签组内重排：一次性完成，避免先删后插的索引漂移。
  if (target.kind === 'tab' && source !== undefined && source.node.id === target.nodeId) {
    const next = structuredClone(layout)
    const node = findNode(next.root, source.node.id)
    if (node === undefined || node.kind !== 'tabs') return layout
    const [panel] = node.tabs.splice(source.index, 1)
    if (panel === undefined) return layout
    const index = Math.max(0, Math.min(target.index, node.tabs.length))
    node.tabs.splice(index, 0, panel)
    node.activeId = panel.id
    return next
  }
  const extracted = extractPanel(layout, panelId)
  if (extracted.panel === undefined) return layout
  return insertPanels(extracted.layout, [extracted.panel], extracted.panel.id, target)
}

/**
 * 移动浮动窗口：tabId 为空 = 整组（拖标题栏），否则只移动单个标签。
 */
export function moveFloat(layout: DockLayout, floatId: string, target: DropTarget, tabId?: string): DockLayout {
  const float = layout.floats.find(f => f.id === floatId)
  if (float === undefined) return layout
  if (target.kind === 'float') {
    // 浮动窗口内部重排/移动坐标由 UI 层直接做；这里仅支持「浮动 → 浮动」的合并。
    return layout
  }
  const next = structuredClone(layout)
  const live = next.floats.find(f => f.id === floatId)
  if (live === undefined) return layout
  let moving: PanelInstance[]
  if (tabId === undefined) {
    moving = live.tabs
    next.floats = next.floats.filter(f => f.id !== floatId)
  } else {
    const index = live.tabs.findIndex(p => p.id === tabId)
    if (index === -1) return layout
    moving = live.tabs.splice(index, 1)
    if (live.activeId === tabId) live.activeId = live.tabs[0]?.id ?? null
    if (live.tabs.length === 0) next.floats = next.floats.filter(f => f.id !== floatId)
  }
  const activeId = moving.find(p => p.id === float.activeId)?.id ?? moving[0]?.id ?? null
  return insertPanels(next, moving, activeId, target)
}

/**
 * 把一个「不在布局树中」的新面板放入布局（外部拖入场景：右侧标签面板标签、
 * 文件系统文件等先构造面板实例，再落到目标）。与 movePanel 不同，不涉及
 * 先从布局中移除源面板；float 目标新建浮动窗口，其余目标并入/拆分。
 */
export function placePanel(layout: DockLayout, panel: PanelInstance, target: DropTarget): DockLayout {
  if (target.kind === 'float') {
    const next = structuredClone(layout)
    next.floats.push({
      id: nextId(next, 'f'),
      x: target.x,
      y: target.y,
      w: 480,
      h: 360,
      tabs: [panel],
      activeId: panel.id,
    })
    return next
  }
  return insertPanels(layout, [panel], panel.id, target)
}

/** 设置某标签组/浮动窗口的激活面板。 */
export function setActivePanel(layout: DockLayout, containerId: string, panelId: string): DockLayout {
  const next = structuredClone(layout)
  const node = findNode(next.root, containerId)
  if (node !== undefined && node.kind === 'tabs') {
    if (node.tabs.some(p => p.id === panelId)) node.activeId = panelId
    return next
  }
  const float = next.floats.find(f => f.id === containerId)
  if (float !== undefined && float.tabs.some(p => p.id === panelId)) float.activeId = panelId
  return next
}

/** 绝对版分割线调整：直接把第 dividerIndex-1 个子级的比例设为 ratio（拖拽期间幂等）。 */
export function resizeSplitTo(layout: DockLayout, nodeId: string, dividerIndex: number, ratio: number): DockLayout {
  const next = structuredClone(layout)
  const node = findNode(next.root, nodeId)
  if (node === undefined || node.kind !== 'split') return layout
  const i = dividerIndex
  if (i < 1 || i >= node.children.length) return layout
  const total = (node.sizes[i - 1] ?? 0.5) + (node.sizes[i] ?? 0.5)
  let na = Math.max(MIN_SIZE * total, Math.min(total - MIN_SIZE * total, ratio * total))
  if (!Number.isFinite(na)) na = total / 2
  node.sizes[i - 1] = na
  node.sizes[i] = total - na
  return next
}

/** 调整 split 节点第 dividerIndex 条分割线（左侧/上侧为 dividerIndex-1 子级）。 */
export function resizeSplit(layout: DockLayout, nodeId: string, dividerIndex: number, ratioDelta: number): DockLayout {
  const next = structuredClone(layout)
  const node = findNode(next.root, nodeId)
  if (node === undefined || node.kind !== 'split') return layout
  const i = dividerIndex
  if (i < 1 || i >= node.children.length) return layout
  const a = node.sizes[i - 1] ?? 0.5
  const b = node.sizes[i] ?? 0.5
  const total = a + b
  let na = a + ratioDelta * total
  na = Math.max(MIN_SIZE * total, Math.min(total - MIN_SIZE * total, na))
  node.sizes[i - 1] = na
  node.sizes[i] = total - na
  return next
}

/** 更新面板 state（浅合并），并可选改标题。 */
export function patchPanel(layout: DockLayout, panelId: string, statePatch: Record<string, unknown> | undefined, title?: string): DockLayout {
  const next = structuredClone(layout)
  const hit = findTabsContaining(next.root, panelId)
  const panel = hit !== undefined ? hit.node.tabs[hit.index] : next.floats.flatMap(f => f.tabs).find(p => p.id === panelId)
  if (panel === undefined) return layout
  if (statePatch !== undefined) panel.state = { ...(panel.state ?? {}), ...statePatch }
  if (title !== undefined) panel.title = title
  return next
}

/** 移动/缩放浮动窗口。 */
export function updateFloat(layout: DockLayout, floatId: string, box: { x: number; y: number; w: number; h: number }): DockLayout {
  const next = structuredClone(layout)
  const float = next.floats.find(f => f.id === floatId)
  if (float === undefined) return layout
  float.x = box.x
  float.y = box.y
  float.w = box.w
  float.h = box.h
  return next
}

/* ── 默认布局与序列化 ── */

/** 首次打开的默认布局：左文件树 | 右（Git + Wiki 标签组）。 */
export function defaultLayout(): DockLayout {
  const layout = emptyLayout()
  const files = createPanel(layout, 'files')
  const git = createPanel(layout, 'git')
  const wiki = createPanel(layout, 'wiki')
  const left = makeTabsNode(layout, [files])
  const right = makeTabsNode(layout, [git, wiki])
  right.activeId = git.id
  layout.root = {
    id: nextId(layout, 's'),
    kind: 'split',
    dir: 'h',
    sizes: [0.34, 0.66],
    children: [left, right],
  }
  return layout
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parsePanel(value: unknown, seq: { n: number }): PanelInstance | undefined {
  if (!isRecord(value)) return undefined
  const type = typeof value.type === 'string' ? value.type : ''
  if (type === '') return undefined
  const panel: PanelInstance = {
    id: typeof value.id === 'string' && value.id !== '' ? value.id : `p${seq.n}`,
    type,
  }
  seq.n += 1
  if (typeof value.title === 'string') panel.title = value.title
  if (isRecord(value.state)) panel.state = value.state
  return panel
}

function parseNode(value: unknown, seq: { n: number }): DockNode | undefined {
  if (!isRecord(value)) return undefined
  if (value.kind === 'tabs') {
    const tabs = Array.isArray(value.tabs)
      ? value.tabs.map(t => parsePanel(t, seq)).filter((p): p is PanelInstance => p !== undefined)
      : []
    if (tabs.length === 0) return undefined
    const activeId = typeof value.activeId === 'string' && tabs.some(p => p.id === value.activeId)
      ? value.activeId
      : tabs[0]!.id
    return { id: typeof value.id === 'string' && value.id !== '' ? value.id : `n${seq.n++}`, kind: 'tabs', tabs, activeId }
  }
  if (value.kind === 'split') {
    const children = Array.isArray(value.children)
      ? value.children.map(c => parseNode(c, seq)).filter((c): c is DockNode => c !== undefined)
      : []
    if (children.length < 2) return children[0]
    const rawSizes = Array.isArray(value.sizes) ? value.sizes : []
    const sizes = normalizeSizes(children.map((_, i) => {
      const s = rawSizes[i]
      return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : 1
    }))
    const dir = value.dir === 'v' ? 'v' as const : 'h' as const
    return { id: typeof value.id === 'string' && value.id !== '' ? value.id : `s${seq.n++}`, kind: 'split', dir, sizes, children }
  }
  return undefined
}

/** 反序列化 + 防御性归一（损坏/缺失字段全部回落默认值）。 */
export function parseDockLayout(value: unknown): DockLayout {
  const seq = { n: 1 }
  if (!isRecord(value)) return defaultLayout()
  const root = parseNode(value.root, seq) ?? null
  const floats: FloatWindow[] = []
  if (Array.isArray(value.floats)) {
    for (const raw of value.floats) {
      if (!isRecord(raw)) continue
      const tabs = Array.isArray(raw.tabs)
        ? raw.tabs.map(t => parsePanel(t, seq)).filter((p): p is PanelInstance => p !== undefined)
        : []
      if (tabs.length === 0) continue
      const num = (v: unknown, fallback: number): number => typeof v === 'number' && Number.isFinite(v) ? v : fallback
      floats.push({
        id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `f${seq.n++}`,
        x: num(raw.x, 80),
        y: num(raw.y, 80),
        w: Math.max(220, num(raw.w, 480)),
        h: Math.max(160, num(raw.h, 360)),
        tabs,
        activeId: typeof raw.activeId === 'string' && tabs.some(p => p.id === raw.activeId) ? raw.activeId : tabs[0]!.id,
      })
    }
  }
  const layout: DockLayout = { root, floats, seq: seq.n + 100 }
  if (panelCount(layout) === 0) return defaultLayout()
  // id 唯一性兜底：发现重复则重编。
  const seen = new Set<string>()
  const dedup = (panel: PanelInstance): void => {
    if (seen.has(panel.id)) panel.id = `p${layout.seq++}`
    seen.add(panel.id)
  }
  const visit = (node: DockNode | null): void => {
    if (node === null) return
    if (seen.has(node.id)) node.id = `n${layout.seq++}`
    seen.add(node.id)
    if (node.kind === 'tabs') node.tabs.forEach(dedup)
    else node.children.forEach(visit)
  }
  visit(layout.root)
  for (const float of layout.floats) {
    if (seen.has(float.id)) float.id = `f${layout.seq++}`
    seen.add(float.id)
    float.tabs.forEach(dedup)
  }
  return layout
}

/** 序列化（localStorage / 导出共用）。 */
export function serializeDockLayout(layout: DockLayout): string {
  return JSON.stringify({ v: 1, root: layout.root, floats: layout.floats, seq: layout.seq })
}
