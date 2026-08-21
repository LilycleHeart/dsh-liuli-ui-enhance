// dock-model 纯逻辑单元测试（node 直接跑 TS：类型剥离，无构建）。
// 运行：node demo/test-dock-model.ts
import {
  addPanel, collectTabsNodes, createPanel, defaultLayout, emptyLayout,
  findNode, findPanel, flattenSameDirSplits, makeTabsNode, moveFloat, movePanel, panelCount, parseDockLayout,
  placePanel, removePanel, resizeSplit, resizeSplitTo, serializeDockLayout, setActivePanel, updateFloat,
  type DockLayout, type SplitNode, type TabsNode,
} from '../src/client/dock-model.ts'

let pass = 0
let fail = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass += 1; console.log('PASS ' + name) }
  else { fail += 1; failures.push(name + (detail !== '' ? ' :: ' + detail : '')); console.log('FAIL ' + name + (detail !== '' ? ' :: ' + detail : '')) }
}

function withPanel(type: string): DockLayout {
  const layout = emptyLayout()
  const panel = createPanel(layout, type)
  return addPanel(layout, panel)
}

// M1 空布局添加面板 → 根标签组
{
  const layout = withPanel('files')
  check('M1 add to empty creates root tabs', layout.root !== null && layout.root.kind === 'tabs' && layout.root.tabs.length === 1)
}

// M2 连续添加落入同一标签组
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = addPanel(layout, p2)
  check('M2 second panel joins same group', layout.root !== null && layout.root.kind === 'tabs' && layout.root.tabs.length === 2 && layout.root.activeId === p2.id)
}

// M3 边缘停靠：左 → 根变 h-split，新组在左
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = addPanel(layout, p2)
  const p3 = createPanel(layout, 'wiki')
  layout = movePanel(layout, p3.id, { kind: 'edge', side: 'left' })
  // 注：p3 还没加入树，movePanel 找不到 → 不变。先加再移。
  check('M3a move unknown panel is no-op', panelCount(layout) === 2)
  layout = addPanel(layout, p3)
  layout = movePanel(layout, p3.id, { kind: 'edge', side: 'left' })
  const root = layout.root
  check('M3b edge-dock wraps root in split', root !== null && root.kind === 'split' && root.dir === 'h' && root.children.length === 2)
  if (root !== null && root.kind === 'split') {
    const first = root.children[0]
    check('M3c docked group is first child (left)', first !== undefined && first.kind === 'tabs' && first.tabs.some(p => p.id === p3.id))
  }
}

// M4 面板内拆分：bottom → 目标节点变 v-split，新组在下
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = addPanel(layout, p2)
  const nodeId = (layout.root as TabsNode).id
  const p3 = createPanel(layout, 'terminal')
  layout = addPanel(layout, p3)
  layout = movePanel(layout, p3.id, { kind: 'split', nodeId, side: 'bottom' })
  const root = layout.root
  check('M4 split wraps target node', root !== null && root.kind === 'split' && root.dir === 'v')
  if (root !== null && root.kind === 'split') {
    const second = root.children[1]
    check('M4b new group is bottom child', second !== undefined && second.kind === 'tabs' && second.tabs.some(p => p.id === p3.id))
    check('M4c sizes normalized', Math.abs(root.sizes.reduce((a, b) => a + b, 0) - 1) < 1e-9)
  }
}

// M5 标签页合并：拖入另一标签组
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = addPanel(layout, p2)
  // 右侧拆分出第二个组
  const nodeId = (layout.root as TabsNode).id
  layout = movePanel(layout, p2.id, { kind: 'split', nodeId, side: 'right' })
  check('M5 setup: two groups', collectTabsNodes(layout.root).length === 2)
  const groups = collectTabsNodes(layout.root)
  const left = groups.find(g => g.tabs.some(p => p.id !== p2.id))
  // 把 git 合并回 files 组（标签页合并）
  layout = movePanel(layout, p2.id, { kind: 'tab', nodeId: left!.id, index: 1 })
  const merged = collectTabsNodes(layout.root)
  check('M5b merged into one group', merged.length === 1 && merged[0]!.tabs.length === 2)
  check('M5c order respected', merged[0]!.tabs[1]?.id === p2.id)
  check('M5d split collapsed away', layout.root !== null && layout.root.kind === 'tabs')
}

// M6 同组重排
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  const p3 = createPanel(layout, 'wiki')
  layout = addPanel(layout, p2)
  layout = addPanel(layout, p3)
  const nodeId = (layout.root as TabsNode).id
  const filesId = (layout.root as TabsNode).tabs[0]!.id
  layout = movePanel(layout, p3.id, { kind: 'tab', nodeId, index: 0 })
  const tabs = (layout.root as TabsNode).tabs
  // [files, git, wiki] 中把 wiki 移到 0 位 → [wiki, files, git]
  check('M6 reorder within group', tabs[0]?.id === p3.id && tabs[1]?.id === filesId && tabs[2]?.id === p2.id)
}

// M7 浮动：拖出为浮动窗口
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = addPanel(layout, p2)
  layout = movePanel(layout, p2.id, { kind: 'float', x: 120, y: 90 })
  check('M7 float created', layout.floats.length === 1 && layout.floats[0]!.tabs[0]?.id === p2.id)
  check('M7b tree keeps rest', panelCount(layout) === 2 && layout.root !== null && layout.root.kind === 'tabs' && layout.root.tabs.length === 1)
  check('M7c float coords', layout.floats[0]!.x === 120 && layout.floats[0]!.y === 90)
}

// M8 浮动 → 停靠回边缘（整组）
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = addPanel(layout, p2)
  layout = movePanel(layout, p2.id, { kind: 'float', x: 10, y: 10 })
  const floatId = layout.floats[0]!.id
  layout = moveFloat(layout, floatId, { kind: 'edge', side: 'right' })
  check('M8 float docked back', layout.floats.length === 0 && layout.root !== null && layout.root.kind === 'split' && layout.root.dir === 'h')
  if (layout.root !== null && layout.root.kind === 'split') {
    const last = layout.root.children[layout.root.children.length - 1]
    check('M8b docked on right', last !== undefined && last.kind === 'tabs' && last.tabs.some(p => p.id === p2.id))
  }
}

// M9 浮动单标签合并进树内标签组
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  const p3 = createPanel(layout, 'wiki')
  layout = addPanel(layout, p2)
  layout = addPanel(layout, p3)
  layout = movePanel(layout, p2.id, { kind: 'float', x: 5, y: 5 })
  layout = movePanel(layout, p3.id, { kind: 'float', x: 60, y: 60 })
  check('M9 setup two floats', layout.floats.length === 2)
  const f3 = layout.floats.find(f => f.tabs.some(p => p.id === p3.id))!
  const treeGroup = collectTabsNodes(layout.root)[0]!
  layout = moveFloat(layout, f3.id, { kind: 'tab', nodeId: treeGroup.id, index: 1 }, p3.id)
  check('M9b single float tab merged', layout.floats.length === 1 && collectTabsNodes(layout.root)[0]!.tabs.length === 2)
}

// M10 关闭面板：split 折叠 + 空根
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = addPanel(layout, p2)
  const nodeId = (layout.root as TabsNode).id
  layout = movePanel(layout, p2.id, { kind: 'split', nodeId, side: 'right' })
  const gitPanel = findPanel(layout, p2.id)!
  layout = removePanel(layout, gitPanel.id)
  check('M10 split collapsed to single child', layout.root !== null && layout.root.kind === 'tabs')
  layout = removePanel(layout, layout.root!.kind === 'tabs' ? layout.root.tabs[0]!.id : 'x')
  check('M10b empty root becomes null', layout.root === null && panelCount(layout) === 0)
}

// M11 resizeSplit 与夹取
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = addPanel(layout, p2)
  const nodeId = (layout.root as TabsNode).id
  layout = movePanel(layout, p2.id, { kind: 'split', nodeId, side: 'right' })
  const splitId = (layout.root as SplitNode).id
  layout = resizeSplit(layout, splitId, 1, 0.25)
  let root = layout.root as SplitNode
  check('M11 resize adds delta', Math.abs((root.sizes[0] ?? 0) - 0.75) < 1e-9)
  layout = resizeSplit(layout, splitId, 1, 10)
  root = layout.root as SplitNode
  check('M11b clamped at min', (root.sizes[1] ?? 0) >= 0.12 - 1e-9 && (root.sizes[1] ?? 0) <= 0.88 + 1e-9)
}

// M11c resizeSplitTo 幂等（拖拽期间重复调用不累计）
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = addPanel(layout, p2)
  const nodeId = (layout.root as TabsNode).id
  layout = movePanel(layout, p2.id, { kind: 'split', nodeId, side: 'right' })
  const splitId = (layout.root as SplitNode).id
  layout = resizeSplitTo(layout, splitId, 1, 0.6)
  layout = resizeSplitTo(layout, splitId, 1, 0.6)
  layout = resizeSplitTo(layout, splitId, 1, 0.6)
  const root = layout.root as SplitNode
  check('M11c resizeTo idempotent', Math.abs((root.sizes[0] ?? 0) - 0.6) < 1e-9, JSON.stringify(root.sizes))
}

// M12 激活切换 + 浮动窗口几何更新
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = addPanel(layout, p2)
  const nodeId = (layout.root as TabsNode).id
  const filesId = (layout.root as TabsNode).tabs[0]!.id
  layout = setActivePanel(layout, nodeId, filesId)
  check('M12 setActive', (layout.root as TabsNode).activeId === filesId)
  layout = movePanel(layout, p2.id, { kind: 'float', x: 1, y: 2 })
  const floatId = layout.floats[0]!.id
  layout = updateFloat(layout, floatId, { x: 50, y: 60, w: 400, h: 300 })
  check('M12b float box updated', layout.floats[0]!.w === 400 && layout.floats[0]!.x === 50)
}

// M13 序列化往返
{
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git', undefined, { branch: 'main' })
  layout = addPanel(layout, p2)
  const nodeId = (layout.root as TabsNode).id
  layout = movePanel(layout, p2.id, { kind: 'split', nodeId, side: 'bottom' })
  layout = movePanel(layout, p2.id, { kind: 'float', x: 33, y: 44 })
  const json = serializeDockLayout(layout)
  const restored = parseDockLayout(JSON.parse(json))
  check('M13 roundtrip panel count', panelCount(restored) === panelCount(layout))
  check('M13b roundtrip floats', restored.floats.length === 1 && restored.floats[0]!.tabs[0]?.state?.branch === 'main')
  check('M13c roundtrip root shape', restored.root !== null && restored.root.kind === 'tabs')
}

// M14 损坏数据防御
{
  const a = parseDockLayout({ root: { kind: 'split', dir: 'h', sizes: [0.5], children: [{ kind: 'tabs', tabs: [] }] }, floats: 'x' })
  check('M14 garbage falls back to default', panelCount(a) > 0)
  const b = parseDockLayout(JSON.parse('{"root":{"kind":"tabs","tabs":[{"type":"files"},{"id":"dup","type":"git"},{"id":"dup","type":"wiki"}]}}'))
  const ids = (b.root as TabsNode).tabs.map(p => p.id)
  check('M14b duplicate ids deduped', new Set(ids).size === ids.length, ids.join(','))
  const c = parseDockLayout(undefined)
  check('M14c undefined → default layout', panelCount(c) > 0)
}

// M15 默认布局形态
{
  const layout = defaultLayout()
  check('M15 default is h-split', layout.root !== null && layout.root.kind === 'split' && layout.root.dir === 'h' && layout.root.children.length === 2)
  check('M15b default panel count', panelCount(layout) === 3)
}

// M16 placePanel（外部拖入：右侧标签面板标签 → 布局落点）
{
  // 空布局 + split 目标 → 根为标签组
  let layout = emptyLayout()
  const p1 = createPanel(layout, 'browser', undefined, { url: 'https://example.com' })
  layout = placePanel(layout, p1, { kind: 'split', nodeId: 'missing', side: 'right' })
  check('M16 empty split target creates root tabs', layout.root !== null && layout.root.kind === 'tabs' && (layout.root as TabsNode).tabs[0]?.id === p1.id)

  // 已有布局 + edge 目标 → 根变 h-split，新组在目标侧
  layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = placePanel(layout, p2, { kind: 'edge', side: 'right' })
  check('M16b edge right splits root', layout.root !== null && layout.root.kind === 'split' && layout.root.dir === 'h' && layout.root.children.length === 2)
  const rightChild = layout.root.children[1]
  check('M16c new panel lands in right shard', rightChild !== undefined && rightChild.kind === 'tabs' && rightChild.tabs.some(p => p.id === p2.id), JSON.stringify(rightChild))

  // tab 目标 → 并入指定标签组
  layout = withPanel('files')
  const p3 = createPanel(layout, 'wiki')
  const rootId = (layout.root as TabsNode).id
  layout = placePanel(layout, p3, { kind: 'tab', nodeId: rootId, index: 0 })
  check('M16d tab target merges', layout.root !== null && layout.root.kind === 'tabs' && (layout.root as TabsNode).tabs.length === 2 && (layout.root as TabsNode).tabs[0]?.id === p3.id)

  // float 目标 → 新建浮动窗口
  layout = emptyLayout()
  const p4 = createPanel(layout, 'notes')
  layout = placePanel(layout, p4, { kind: 'float', x: 10, y: 20 })
  check('M16e float target creates float window', layout.floats.length === 1 && layout.floats[0]!.tabs[0]?.id === p4.id && layout.floats[0]!.x === 10)
  check('M16f float leaves root empty', layout.root === null)

  // 面板不重复进入（placePanel 只放不删源——外部新面板语义）
  const total = panelCount(layout)
  check('M16g panel count consistent', total === 1)
}

// M17 同向 split 兄弟插入：目标已处于同向 split 中时，新组应成为兄弟子级，
//     而不是再包一层嵌套 split（否则 [详情,侧栏] 会与对话页之间隔一层复合容器）。
{
  // 构造 h-split [files, git]
  let layout = withPanel('files')
  const p2 = createPanel(layout, 'git')
  layout = addPanel(layout, p2)
  const filesNode = (layout.root as TabsNode)
  layout = movePanel(layout, p2.id, { kind: 'split', nodeId: filesNode.id, side: 'right' })
  const root = layout.root
  check('M17 setup: two h groups', root !== null && root.kind === 'split' && root.dir === 'h' && root.children.length === 2)

  // 在 git 组左侧再拆一个 wiki：父 split 同向 → wiki 直接插到 git 左边，仍是 3 兄弟
  const groups = collectTabsNodes(layout.root)
  const git = groups.find(g => g.tabs.some(p => p.id === p2.id))!
  const p3 = createPanel(layout, 'wiki')
  layout = addPanel(layout, p3)
  layout = movePanel(layout, p3.id, { kind: 'split', nodeId: git.id, side: 'left' })
  const flat = layout.root
  check('M17b same-dir sibling insert keeps flat split', flat !== null && flat.kind === 'split' && flat.children.length === 3)
  if (flat !== null && flat.kind === 'split') {
    const beforeGit = flat.children[flat.children.findIndex(c => c.id === git.id) - 1]
    check('M17c new group is left of target', beforeGit !== undefined && beforeGit.kind === 'tabs' && beforeGit.tabs.some(p => p.id === p3.id))
    const sum = flat.sizes.reduce((a, b) => a + b, 0)
    check('M17d sizes total preserved', Math.abs(sum - 1) < 1e-9)
  }
}

// M18 flattenSameDirSplits：同向嵌套 split 被拍平，恢复相邻 sash。
{
  const layout = emptyLayout()
  const a = makeTabsNode(layout, [createPanel(layout, 'files')])
  const b = makeTabsNode(layout, [createPanel(layout, 'git')])
  const c = makeTabsNode(layout, [createPanel(layout, 'wiki')])
  // [ [a, b], c ]
  const nested: SplitNode = { id: 's1', kind: 'split', dir: 'h', sizes: [0.5, 0.5], children: [a, b] }
  const root: SplitNode = { id: 's2', kind: 'split', dir: 'h', sizes: [0.5, 0.5], children: [nested, c] }
  const flat = flattenSameDirSplits(root)
  check('M18 same-dir nesting flattened', flat !== null && flat.kind === 'split' && flat.children.length === 3)
  if (flat !== null && flat.kind === 'split') {
    check('M18b children promoted', flat.children[0]?.id === a.id && flat.children[1]?.id === b.id && flat.children[2]?.id === c.id)
    check('M18c sizes normalized', Math.abs(flat.sizes.reduce((x, y) => x + y, 0) - 1) < 1e-9)
  }
}

console.log('SUMMARY: ' + pass + '/' + (pass + fail) + ' passed')
if (failures.length > 0) {
  console.log('FAILED: ' + failures.join(' | '))
  process.exitCode = 1
}
