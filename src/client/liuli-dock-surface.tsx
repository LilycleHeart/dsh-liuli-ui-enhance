/**
 * 琉璃主题 · 官方右侧栏的 dockable 布局（基于 @deepseek-ai/dsh-client-ui-dockkit）。
 *
 * ## 为什么有这个文件
 *
 * 官方右侧栏（`ui-sidebar-right`）本身就用 dockkit 渲染，但它把能力**收窄**成了
 * 「右栏内左右两格」：
 *
 * ```js
 * <DockSurface dropZones="horizontal" canSplit={... dockPaneIds(layout).length < 2 ...} />
 * ```
 *
 * 而 dockkit 引擎本身支持四边落区与 4 格（官方 README 原文：「Sidebar 使用 0.2 并在
 * 自己的 store 限制两格。**通用引擎仍保留原有树与其它分割方向。**」；常量
 * `MAX_DOCK_PANES = 4`、`dropZones?: 'edges' | 'horizontal'`、`DOCK_ZONES` 含
 * center/top/right/bottom/left）。
 *
 * 因此琉璃按官方 README 点明的「经由自己 store 路由的嵌入方」路径，**自己实现
 * DockIntents，把 DockSurface 接到自己的 DockController 上**，从而在官方外壳内
 * 拿回完整的 dockable 能力：
 *
 *  - `dropZones: 'edges'` → 四边落区；经典模式把栏内边缘投放转交整窗布局
 *  - 关闭「禁用右栏内部分栏」后可在栏内拆至 `MAX_DOCK_PANES`（4）格
 *  - `FloatLayer` → 浮窗（拖出停靠区即浮出）
 *  - 每会话一份布局，与官方 tab 状态一样按 session 存放
 *
 * ## 与官方的关系（并入 + 增强，不是替换官方）
 *
 * 官方 `rightbar` / `rightbar.session` 席位始终由官方组件挂载，保留导航服务。
 * 本组件由琉璃帧层在同一列渲染；新版客户端默认使用，设置中可切回旧实现。
 * tab 内容仍是琉璃既有的 7 个面板组件。
 *
 * ## 注意：dockkit 是官方标注的「内部引擎」
 *
 * 官方 README：本包导出「在任何版本都可能变化」。升级 DSH 后若本文件报类型错或
 * 行为异常，优先复核 `LayoutState` / `DockIntents` / planner 的形状。
 */
import type { Context } from '@deepseek-ai/cordis'
import { useSyncExternalStore } from 'react'
import { Component, createElement, useEffect, useRef, useState, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DockController,
  DockSurface,
  FloatLayer,
  MAX_DOCK_PANES,
  canSplit,
  dockPaneCount,
  planDropTab,
} from '@deepseek-ai/dsh-client-ui-dockkit'
import type { DockLabels, DockZone, LayoutState, PaneId, TabId, TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'
import { setPanelParams, type LiuliPanelParams } from './panel-driver.ts'
import {
  getOfficialSidebarController, OFFICIAL_SIDEBAR_NAVIGATION_EVENT,
  type OfficialSidebarNavigationDetail,
} from './sidebar-right-tabs.ts'
import { OfficialSidebarSeatPane } from './official-sidebar-seat.tsx'
import { FileReviewPanel } from './FileReviewPanel.tsx'
import { FileTreePanel } from './RightSidebarPanels.tsx'
import {
  DeveloperToolsPanel, SideChatPanel, TerminalPanel,
  type SidePaneHostAccess,
} from './SidePaneExtraPanels.tsx'
import { BrowserPanel, CodeViewerPanel, OpenFileDialog } from './PreviewPanel.tsx'
import { getDockHostBridge } from './dock-shell-frame.tsx'
import type { SidebarGitSourceId } from './right-sidebar-api.ts'
import css from './LiuliDockSurface.module.css'
import { LIULI_LS_KEY, liuliSettingsOf } from '../liuli-settings.ts'
import {
  BugIcon, FileCodeCornerIcon, FileDiffIcon, FolderIcon, GlobeIcon, MessageSquareTextIcon,
  PanelRightCloseIcon, PanelRightOpenIcon, PlusIcon, SquareTerminalIcon,
} from './SidePaneIcons.tsx'

const SIDEBAR_CONTROLS_EVENT = 'liuli:sidebar-controls-changed'
let lastDockPointer = { x: 0, y: 0 }

function innerSplitDisabled(): boolean {
  try {
    const raw = localStorage.getItem(LIULI_LS_KEY)
    return liuliSettingsOf(raw === null ? {} : JSON.parse(raw)).sidebar_disable_inner_split
  } catch { return true }
}

/** 官方 tab kind（liuli-*）→ 外层 dock 面板类型（dock-panels.tsx 的 type）。 */
const KIND_TO_DOCK_TYPE: Record<string, string> = {
  'liuli-review': 'git',
  'liuli-files': 'files',
  'liuli-terminal': 'terminal',
  'liuli-code': 'code',
  'liuli-browser': 'browser',
  'liuli-side-chat': 'side-chat',
  'liuli-developer-tools': 'developer-tools',
  // 本地 dock 表面用的 kind 是不带前缀的（见 LIULI_DOCK_PANELS）。
  review: 'git',
  files: 'files',
  terminal: 'terminal',
  code: 'code',
  browser: 'browser',
  'side-chat': 'side-chat',
  'developer-tools': 'developer-tools',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** 2.0.9 右栏停靠面宿主席位（root 作用域，官方 `RightbarRoot` 占位）。 */
    'rightbar': {
      kind: 'single'
      scope: 'root'
      owner: LiuliSeatOwnerProps
    }
    /** 官方会话作用域子席位；保持官方 RightbarSeat 挂载以维持服务绑定。 */
    'rightbar.session': {
      kind: 'single'
      scope: 'session'
      owner: LiuliSeatOwnerProps
    }
    /**
     * 会话 header 的角落席位（官方右侧栏的展开按钮就注册在这里）。
     * 琉璃在迁移模式下用**同款外观**的按钮在此驱动自己的 dock 控制器
     *（见 `LiuliRightbarExpandButton`）。
     */
    'conversation.session.header.corner': {
      kind: 'single'
      scope: 'session'
      owner: LiuliSeatOwnerProps
    }
  }
}

/** 这两个席位没有额外 owner props：需要的一切都来自框架标准 props。 */
export interface LiuliSeatOwnerProps {}

/* ── 面板声明表（与 sidebar-right-tabs.ts 的 PANEL_SPECS 对应，kind 去掉 liuli- 前缀） ── */

/** tab kind（dockkit 把它当不透明字符串，只有本文件的 renderTab 解释它）。 */
export type LiuliDockKind =
  | 'review' | 'files' | 'terminal' | 'code' | 'browser' | 'side-chat' | 'developer-tools'

type LiuliDockTabKind = LiuliDockKind | 'official'

interface DockPanelSpec {
  kind: LiuliDockTabKind
  title: string
  /** 正文渲染：拿到会话 id 与宿主能力后复用既有面板组件。 */
  render: (sessionId: string, host: LiuliSidebarHostAccess, params: LiuliPanelParams | undefined, tab: TabRecord) => ReactNode
  /** 是否依赖宿主数据面（缺失时跳过）。 */
  needsSidePaneHost?: boolean
}

/** 官方右栏面板可用的宿主能力（与自研侧边栏共用同一份数据面）。 */
export interface LiuliSidebarHostAccess {
  openPath?: ((path: string) => void) | undefined
  addFileToChat?: ((path: string) => void) | undefined
  sidePaneHost?: SidePaneHostAccess | undefined
  /** 宿主 details 列当前是否展开（「右栏是否打开」的权威状态）。 */
  detailsShown?: (() => boolean) | undefined
}

export const LIULI_DOCK_PANELS: readonly DockPanelSpec[] = [
  {
    kind: 'official',
    title: '官方侧栏',
    render: () => createElement(OfficialSidebarSeatPane, { onCollapse: collapseOfficialSeat }),
  },
  {
    kind: 'review',
    title: '审查',
    render: (sessionId, host, params) => createElement(FileReviewPanel, {
      sessionId,
      ...(host.openPath === undefined ? {} : { onOpenPath: host.openPath }),
      ...(params === undefined ? {} : {
        reviewRequest: params.source === undefined
          ? { nonce: params.nonce ?? 0, path: params.path ?? '' }
          : {
            nonce: params.nonce ?? 0,
            source: params.source as SidebarGitSourceId,
            ...(params.path === undefined ? {} : { path: params.path }),
          },
      }),
    }),
  },
  {
    kind: 'files',
    title: '文件树',
    render: (sessionId, host) => createElement(FileTreePanel, {
      sessionId,
      ...(host.addFileToChat === undefined ? {} : { onAddFileToChat: host.addFileToChat }),
      ...(host.openPath === undefined ? {} : { onOpenPath: host.openPath }),
    }),
  },
  {
    kind: 'terminal',
    title: '终端',
    render: sessionId => createElement(TerminalPanel, { sessionId }),
  },
  {
    kind: 'code',
    title: '代码查看',
    render: (sessionId, host, params) => createElement(CodeViewerPanel, {
      sessionId,
      rel: params?.rel ?? '',
      path: params?.absolutePath ?? '',
      ...(host.openPath === undefined ? {} : { onOpenPath: host.openPath }),
    }),
  },
  {
    kind: 'browser',
    title: '浏览器',
    render: (sessionId, host, params, tab) => createElement(BrowserPanel, {
      key: `liuli-dock:${sessionId}:${tab.id}`,
      tabId: `liuli-dock:${sessionId}:${tab.id}`,
      sessionId,
      url: params?.url ?? 'about:blank',
      active: true,
      onNavigate: (next: string) => { rememberBrowserUrl(sessionId, tab.contentId, next) },
      onTitleChange: () => { /* 同上 */ },
      onNewWindow: (next: string) => { openLiuliDockPanel(sessionId, 'browser', { url: next }, { newInstance: true }) },
      insertElement: () => { /* dock 浏览器暂无输入框插入通道 */ },
      getPaneEl: () => document.querySelector<HTMLElement>('[data-liuli-dock-surface]'),
      ...(host.openPath === undefined ? {} : { onOpenPath: host.openPath }),
    }),
  },
  {
    kind: 'side-chat',
    title: '辅助对话',
    needsSidePaneHost: true,
    render: (sessionId, host, params) => host.sidePaneHost === undefined
      ? null
      : createElement(SideChatPanel, {
        sessionId,
        host: host.sidePaneHost,
        onChildCreated: () => { /* dock tab 不持久化子会话 id */ },
        ...(params?.initialPrompt === undefined ? {} : { initialPrompt: params.initialPrompt }),
      }),
  },
  {
    kind: 'developer-tools',
    title: '开发者工具',
    needsSidePaneHost: true,
    render: (sessionId, host) => host.sidePaneHost === undefined
      ? null
      : createElement(DeveloperToolsPanel, { sessionId, host: host.sidePaneHost }),
  },
]

function collapseOfficialSeat(): void {
  setLiuliDockExpanded(false)
}

function specOf(kind: string): DockPanelSpec | undefined {
  return LIULI_DOCK_PANELS.find(spec => spec.kind === kind)
}

interface DockLauncherItem {
  id: string
  label: string
  icon: ReactNode
  run: () => void
}

/** 菜单与空状态共用的打开动作；终端和辅助对话沿用旧版的多实例语义。 */
function openDockChoice(sessionId: string, kind: LiuliDockTabKind): void {
  const spec = specOf(kind)
  if (spec === undefined) return
  const contentId = kind === 'terminal' || kind === 'side-chat'
    ? `sidebar://${kind}/${++panelParamSeq}`
    : `sidebar://${kind}`
  const controller = controllerFor(sessionId)
  controller.openContent({ kind, contentId, title: spec.title })
  controller.setExpanded(true)
  publishForceExpanded(true)
  window.dispatchEvent(new Event('liuli:ensure-details'))
}

/* ── 标签文案（dockkit 要求嵌入方提供全部本地化字符串） ── */

const DOCK_LABELS: DockLabels = {
  // 空格的正文由下方 LiuliDockEmptyLauncher 绘制，避免叠出引擎占位文字。
  emptyPane: '',
  splitPane: '向右分栏',
  splitPaneDisabled: '已达分栏上限',
  splitPaneNarrow: '当前宽度不足以再分栏',
  closeTab: '关闭标签',
  addTab: '新建标签',
  dockFloat: '放回停靠区',
  closeFloat: '关闭浮窗',
  dropZone: {
    center: '合并到此格',
    top: '向上分栏',
    right: '向右分栏',
    bottom: '向下分栏',
    left: '向左分栏',
  } as Readonly<Record<DockZone, string>>,
}

/* ── 每会话布局控制器 ── */

/** 会话 id → 该会话的 dock 控制器（与官方一样「每会话一个停靠面」）。 */
const controllers = new Map<string, DockController>()

/** 取得（必要时创建）某会话的控制器。
 *  @param hostDetailsShown - 可选初始展开态；未传时沿用帧层显式标记，
 *         新窗口默认收起，避免仅因组件挂载就弹出右栏。 */
function controllerFor(sessionId: string, hostDetailsShown?: boolean): DockController {
  const existing = controllers.get(sessionId)
  if (existing !== undefined) return existing
  const controller = new DockController({
    // 不预置标签：与旧版琉璃一致，初次展开显示「打开标签页」功能入口。
    // 新格仍给审查作为种子，供用户关闭内部分栏禁用项后继续使用。
    makePaneTab: (id) => ({ id, kind: 'review', contentId: `sidebar://review/${String(id)}`, title: '审查' }),
  })
  // 可见列宽由 __liuliForceExpanded__ 驱动；宿主官方轨道在此模式保持关闭。
  controller.setExpanded(hostDetailsShown ?? readForceExpanded() ?? false)
  controllers.set(sessionId, controller)
  return controller
}

/* ── 正文错误边界 ── */

class PanelBoundary extends Component<{ label: string; children?: ReactNode }, { error?: string }> {
  constructor(props: { label: string; children?: ReactNode }) {
    super(props)
    this.state = {}
  }

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(`[liuli] dock 面板「${this.props.label}」渲染失败:`, error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error !== undefined) {
      return createElement('div', { style: { padding: '12px', fontSize: '13px', opacity: 0.8 } },
        `「${this.props.label}」渲染失败：${this.state.error}`)
    }
    return this.props.children
  }
}

/* ── 主组件 ── */

/** 各面板最新一次「带参打开」的参数（覆盖式；正文渲染时读取）。
 *
 *  为什么不用 panel-driver 的 pending 消费表：那套「取走即删」只适合**挂载时消费一次**
 *  的场景；而 dock 里「再次打开已打开的面板」（例如对话页再点一个前端文件）不会重新
 *  挂载 tab，参数必须能**覆盖式更新**并触发正文重渲染。这里用版本号 + 订阅实现。 */
const latestPanelParams = new Map<string, LiuliPanelParams>()
let panelParamsVersion = 0
const panelParamsListeners = new Set<() => void>()

/** 写入某面板的最新参数并通知正文重渲染。 */
function setLatestPanelParams(kind: string, params: LiuliPanelParams): void {
  latestPanelParams.set(kind, params)
  panelParamsVersion += 1
  for (const listener of [...panelParamsListeners]) listener()
}

/** 读某面板的最新参数（渲染时调用）。 */
function getLatestPanelParams(kind: string): LiuliPanelParams | undefined {
  return latestPanelParams.get(kind)
}

/** 浏览器参数跟随会话和内容标签保存，避免不同会话/弹窗共用一个 URL。 */
function browserParamKey(sessionId: string, contentId: string): string {
  return `browser:${sessionId}\u0000${contentId}`
}

/** 页内导航只更新记忆值；BrowserPanel 已维护自己的状态，无需触发整个 dock 重绘。 */
function rememberBrowserUrl(sessionId: string, contentId: string, url: string): void {
  const key = browserParamKey(sessionId, contentId)
  const previous = latestPanelParams.get(key)
  if (previous?.url === url) return
  latestPanelParams.set(key, { ...previous, url })
}

/** 订阅参数变化（surface 层用 useSyncExternalStore 接住，触发 renderTab 重渲染）。 */
function subscribePanelParams(listener: () => void): () => void {
  panelParamsListeners.add(listener)
  return () => { panelParamsListeners.delete(listener) }
}

function getPanelParamsVersion(): number {
  return panelParamsVersion
}

/** 渲染某 tab 的正文（dockkit 按 tab.kind 分发）。 */
function renderTabBody(tab: TabRecord, sessionId: string, host: LiuliSidebarHostAccess): ReactNode {
  const spec = specOf(tab.kind)
  if (spec === undefined) {
    return createElement('div', { style: { padding: '12px', fontSize: '13px', opacity: 0.7 } },
      `未知面板类型：${tab.kind}`)
  }
  if (spec.needsSidePaneHost === true && host.sidePaneHost === undefined) {
    return createElement('div', { style: { padding: '12px', fontSize: '13px', opacity: 0.7 } },
      `「${spec.title}」需要宿主数据面，当前不可用。`)
  }
  // 带参打开（审查定位/前端文件/浏览器 URL/辅助对话首词）经这里进入正文；
  // 未带参打开时为 undefined，正文按默认行为渲染。
  const paramKey = tab.kind === 'browser' ? browserParamKey(sessionId, tab.contentId) : tab.kind
  return createElement(PanelBoundary, { label: spec.title },
    spec.render(sessionId, host, getLatestPanelParams(paramKey), tab))
}

export interface LiuliDockSurfaceProps {
  /** 会话 id（席位按 session 作用域注入）。 */
  sessionId: string
  /** 宿主能力（与自研侧边栏共用）。 */
  host: LiuliSidebarHostAccess
}

/**
 * 琉璃 dockable 右栏：官方 rightbar 席位内的四边可拖拽布局。
 *
 * 与官方 `RightbarRoot` 的差异：
 *  - 默认把栏内边缘投放交给整窗 Dockable 布局；可选恢复栏内四边分栏
 *  - 栏内分栏上限 `MAX_DOCK_PANES = 4` 格（官方限制 2）
 *  - 其余（标签条、chip、右键菜单、浮窗、分隔条拖拽、键盘无障碍）都是 dockkit 原生
 */
export function LiuliDockSurface({ sessionId, host }: LiuliDockSurfaceProps): ReactElement {
  const controller = controllerFor(sessionId)
  const [disableInnerSplit, setDisableInnerSplit] = useState(innerSplitDisabled)
  useEffect(() => {
    const update = (): void => { setDisableInnerSplit(innerSplitDisabled()) }
    window.addEventListener(SIDEBAR_CONTROLS_EVENT, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(SIDEBAR_CONTROLS_EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [])
  // dockkit 的控制器本身就是可订阅源（React-free，快照引用只在布局变化时改变）。
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [fileDialogOpen, setFileDialogOpen] = useState(false)
  const existingKinds = new Set(Object.values(snapshot.state.tabs).map(tab => tab.kind))
  const noDockedTabs = Object.values(snapshot.state.nodes).every(node =>
    node.kind !== 'pane' || node.host !== 'dock' || node.tabs.length === 0)
  // 与旧 PreviewDetailsPanel 同一组菜单项；空状态直接复用这些动作。
  const launcherItems: DockLauncherItem[] = [
    {
      id: 'official', label: '官方文件与预览', icon: createElement(FolderIcon, { size: 16 }),
      run: () => {
        try { getOfficialSidebarController()?.openTab?.('guide') } catch (error) {
          console.warn('[liuli] 打开官方侧栏引导页失败:', error)
        }
        openLiuliDockPanel(sessionId, 'official')
      },
    },
    ...(host.sidePaneHost === undefined ? [] : [{
      id: 'side-chat', label: '辅助对话', icon: createElement(MessageSquareTextIcon, { size: 16 }),
      run: () => { openDockChoice(sessionId, 'side-chat') },
    }]),
    ...(!existingKinds.has('review') ? [{
      id: 'git', label: '审查', icon: createElement(FileDiffIcon, { size: 16 }),
      run: () => { openDockChoice(sessionId, 'review') },
    }] : []),
    { id: 'terminal', label: '终端', icon: createElement(SquareTerminalIcon, { size: 16 }), run: () => { openDockChoice(sessionId, 'terminal') } },
    { id: 'browser', label: '浏览器', icon: createElement(GlobeIcon, { size: 16 }), run: () => { openDockChoice(sessionId, 'browser') } },
    ...(host.sidePaneHost === undefined || existingKinds.has('developer-tools') ? [] : [{
      id: 'developer-tools', label: '开发者工具', icon: createElement(BugIcon, { size: 16 }),
      run: () => { openDockChoice(sessionId, 'developer-tools') },
    }]),
    { id: 'open-file', label: '打开文件…', icon: createElement(FileCodeCornerIcon, { size: 16 }), run: () => { setFileDialogOpen(true) } },
  ]
  // 带参打开（审查定位/前端文件/浏览器 URL）会更新参数表 —— 订阅它让正文重渲染，
  // 否则「再次打开已打开的面板」时新参数进不去（tab 不重新挂载）。
  useSyncExternalStore(subscribePanelParams, getPanelParamsVersion)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  // 标签拖到右栏外时，用外层布局的落点指示器预览（与手柄拖拽同一套判定）。
  useOuterDropPreview(sessionId, surfaceRef, disableInnerSplit)
  // 注意：这里**不能**再让控制器跟随官方 `ctx.sidebarRight.isExpanded()` ——
  // 遮蔽官方 Seat 后它恒为 false，早前留下的同步轮询会每 150ms 把我们刚展开的
  // 控制器拉回收起（实测：openLiuliDockPanel 打开面板后列宽回到 0、surface 消失）。
  // 迁移模式下展开状态的唯一权威就是我们自己的控制器 + __liuliForceExpanded__ 标记。

  // 帧层需要知道"右栏当前是否展开"以决定这一列的宽度。迁移模式下展开状态住在
  // 这里的控制器里（官方 ctx.sidebarRight 不再参与），因此暴露一个查询钩子。
  // 同时暴露控制器本身，供驱动层（panel-driver / 工具入口）在 dock 布局里开面板，
  // 以及运行期自检（CDP）核验分栏能力。
  useEffect(() => {
    const w = window as unknown as {
      __liuliDockExpanded__?: () => boolean
      __liuliDock__?: {
        sessionId: string
        controller: DockController
        panes: () => number
        maxPanes: number
        split: () => boolean
      }
    }
    w.__liuliDockExpanded__ = () => isAnyLiuliDockExpanded()
    w.__liuliDock__ = {
      sessionId,
      controller,
      panes: () => dockPaneCount(controller.getSnapshot().state),
      maxPanes: MAX_DOCK_PANES,
      split: () => controller.splitPane(),
    }
    return () => {
      if (w.__liuliDockExpanded__ !== undefined) delete w.__liuliDockExpanded__
      if (w.__liuliDock__?.controller === controller) delete w.__liuliDock__
    }
  }, [controller, sessionId])

  return createElement('div', {
    ref: surfaceRef,
    className: 'liuli-dock-surface',
    'data-liuli-dock-surface': '',
    'data-liuli-disable-inner-split': disableInnerSplit || undefined,
    style: {
      display: 'flex',
      flexDirection: 'column',
      // 关键：必须限制高度，否则 dockkit 看到的 pane 高度会撑到内容高度
      // （实测 2574px 远超视口），落区几何（halvesFit / zoneAt）随之失真、
      // 拖拽分栏判定不成立。
      height: '100%',
      maxHeight: '100%',
      minHeight: 0,
      overflow: 'hidden',
      // 官方把右栏正文容器设成 display:contents 的包装链，宽度/高度都靠这层定。
      width: '100%',
      boxSizing: 'border-box',
    },
  },
    createElement('div', {
      // dockkit 的 `.surface` 是 flex 容器且不自带高度约束，它按内容/父级撑开。
      // 这一层必须给出**确定的**高度并允许收缩（minHeight:0 + overflow:hidden），
      // 否则 surface 会撑到内容高度（实测 2574px ≫ 视口），落区几何随之失真。
      style: {
        flex: '1 1 auto',
        minHeight: 0,
        height: '100%',
        maxHeight: '100%',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      },
    },
      createElement(DockSurface, {
        state: snapshot.state,
        // 'edges' = 四边（含上下）；官方用 'horizontal' 只给左右。
        dropZones: 'edges',
        // 上限交给引擎常量（MAX_DOCK_PANES = 4），不再像官方那样写死 2。
        // 经典模式仍让 dockkit 识别边缘落区，再由 intentsWithDropFix 转交
        // 外层 Dockable 布局；分栏按钮由 CSS 隐藏，不能把 canSplit 设为 false。
        canSplit: disableInnerSplit || (canSplit(snapshot.state) && dockPaneCount(snapshot.state) < MAX_DOCK_PANES),
        hideSplitWhenBlocked: false,
        // 琉璃旧侧栏只有一个「新增标签」入口；隐藏 dockkit 默认的每格 + 按钮。
        canAddTab: () => false,
        minPaneFraction: 0.2,
        intents: intentsWithDropFix(controller, disableInnerSplit),
        labels: DOCK_LABELS,
        renderTab: (tab: TabRecord) => renderTabBody(tab, sessionId, host),
        renderTabMenuItems: (tab: TabRecord, dismiss: () => void) => createElement(LiuliDockTabMenuItem, {
          tab,
          dismiss,
          sessionId,
        }),
        // 面板选择器：dockkit 把它画在右上格 tab 条的最末端。
        chrome: createElement(LiuliDockPanelPicker, { items: launcherItems }),
      }),
      createElement(LiuliDockEmptyLauncher, { items: launcherItems, visible: noDockedTabs }),
    ),
    createElement(FloatLayer, {
      state: snapshot.state,
      intents: intentsWithDropFix(controller, disableInnerSplit),
      labels: DOCK_LABELS,
      renderTab: (tab: TabRecord) => renderTabBody(tab, sessionId, host),
    }),
    fileDialogOpen && createPortal(createElement(OpenFileDialog, {
      sessionId,
      onClose: () => { setFileDialogOpen(false) },
      onOpenFile: (path: string, rel: string) => {
        setFileDialogOpen(false)
        openLiuliDockPanel(sessionId, 'code', { absolutePath: path, rel })
      },
    }), document.body),
  )
}

/** tab 右键菜单里的琉璃条目：在 dock 布局内直接打开某个面板 / 关闭其余标签。 */
function LiuliDockTabMenuItem(props: { tab: TabRecord; dismiss: () => void; sessionId: string }): ReactElement {
  const controller = controllerFor(props.sessionId)
  const openKind = (kind: LiuliDockTabKind): void => {
    const spec = specOf(kind)
    if (spec === undefined) return
    if (kind === 'official') {
      try { getOfficialSidebarController()?.openTab?.('guide') } catch { /* 服务暂不可用时仍可打开标签 */ }
    }
    // 通过控制器开内容：同内容已开则聚焦，否则在新格/当前格打开。
    controller.openContent({
      kind,
      contentId: `sidebar://${kind}`,
      title: spec.title,
    })
    props.dismiss()
  }
  const others = LIULI_DOCK_PANELS.filter(spec => spec.kind !== props.tab.kind
    && !(spec.needsSidePaneHost === true))
  return createElement('div', { role: 'group' },
    ...others.slice(0, 6).map(spec => createElement('button', {
      key: spec.kind,
      type: 'button',
      role: 'menuitem',
      onClick: () => { openKind(spec.kind) },
      style: {
        display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px',
        border: 0, background: 'transparent', color: 'inherit', font: 'inherit',
        cursor: 'pointer', borderRadius: '8px',
      },
    }, `在 dock 中打开「${spec.title}」`)),
  )
}

/** 关闭时保留节点完成退场；减少动态效果时当帧卸载。 */
function useExitPresence(visible: boolean, durationMs: number): boolean {
  const [present, setPresent] = useState(visible)
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  useEffect(() => {
    if (visible) { setPresent(true); return }
    if (reducedMotion) { setPresent(false); return }
    const timer = window.setTimeout(() => { setPresent(false) }, durationMs)
    return () => { window.clearTimeout(timer) }
  }, [visible, reducedMotion, durationMs])
  return visible || (present && !reducedMotion)
}

/** 旧版琉璃 `＋` 菜单：固定定位到 body，避免被右栏 overflow 裁掉。 */
function LiuliDockPanelPicker({ items }: { items: readonly DockLauncherItem[] }): ReactElement {
  const [open, setOpen] = useState(false)
  const present = useExitPresence(open, 160)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    const onResize = (): void => { setOpen(false) }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])
  const anchor = buttonRef.current?.getBoundingClientRect()
  return createElement('div', { className: css.pickerHost },
    createElement('button', {
      ref: buttonRef,
      type: 'button',
      title: '新增标签',
      'aria-label': '新增标签',
      'aria-expanded': open,
      'data-liuli-dock-picker': '',
      onClick: () => { setOpen(v => !v) },
      className: css.pickerButton + (open ? ' ' + css.pickerButtonActive : ''),
    }, createElement(PlusIcon, { size: 16 })),
    present && anchor !== undefined && createPortal(createElement('div', {
      ref: menuRef,
      role: 'menu',
      'data-liuli-pane-popover': '',
      'data-liuli-dock-menu': '',
      'data-closing': open ? undefined : '',
      className: css.pickerMenu,
      style: { top: anchor.bottom + 6, right: Math.max(8, window.innerWidth - anchor.right) },
    }, ...items.map(item => createElement('button', {
      key: item.id,
      type: 'button',
      role: 'menuitem',
      'data-side-pane-add-item': item.id,
      onClick: () => { item.run(); setOpen(false) },
      className: css.pickerItem,
    }, createElement('span', { className: css.pickerItemIcon }, item.icon), item.label))), document.body),
  )
}

/** 与旧 PreviewDetailsPanel 同款的无标签入口。 */
function LiuliDockEmptyLauncher({ items, visible }: { items: readonly DockLauncherItem[]; visible: boolean }): ReactElement | null {
  const present = useExitPresence(visible, 180)
  if (!present) return null
  return createElement('div', {
    className: css.emptyShell,
    'data-liuli-dock-empty': '',
    'data-closing': visible ? undefined : '',
  },
    createElement('div', { className: css.emptyContent },
      createElement('div', { className: css.emptyHead },
        createElement('h2', { className: css.emptyTitle }, '打开标签页'),
        createElement('p', { className: css.emptyDesc }, '选择要在侧边面板中打开的标签。')),
      createElement('div', { className: css.emptyList }, ...items.map(item => createElement('button', {
        key: item.id,
        type: 'button',
        className: css.emptyItem,
        'data-side-pane-open-tab-item': item.id,
        onClick: item.run,
      }, createElement('span', { className: css.emptyItemIcon }, item.icon),
      createElement('span', { className: css.emptyItemLabel }, item.label))))))
}

/** 供外部（驱动层 / 帧层宽度计算）查某会话 dock 是否展开。 */
export function isLiuliDockExpanded(sessionId: string): boolean {
  const controller = controllers.get(sessionId)
  if (controller === undefined) return false
  return controller.getSnapshot().state.expanded
}

/** 当前活动会话的 dock 展开状态（帧层不知道 sessionId，这里查"任一已展开"）。 */
export function isAnyLiuliDockExpanded(): boolean {
  for (const controller of controllers.values()) {
    if (controller.getSnapshot().state.expanded) return true
  }
  return false
}

/** 设置所有会话 dock 的展开状态（外层 shell 投放面板后收起右栏时调用，
 *  保证「宿主 details 状态」与「dock 控制器状态」同步，不会一边关一边开）。 */
export function setLiuliDockExpanded(expanded: boolean): void {
  for (const controller of controllers.values()) controller.setExpanded(expanded)
  publishForceExpanded(expanded)
}

/* ── header 展开按钮（官方样式，行为接我们的控制器）── */

/** 读帧层用的展开标记（surface 未挂载时它是唯一权威）。 */
function readForceExpanded(): boolean | undefined {
  try {
    return (window as unknown as { __liuliForceExpanded__?: boolean }).__liuliForceExpanded__
  } catch { return undefined }
}

/** 展开状态变化时统一落盘：控制器 + window 标记（帧层读后者，避免时序竞态）。 */
function publishForceExpanded(next: boolean): void {
  try {
    ;(window as unknown as { __liuliForceExpanded__?: boolean }).__liuliForceExpanded__ = next
  } catch { /* 忽略 */ }
}

/**
 * 会话 header 角落的「展开/收起右栏」按钮。
 *
 * ## 为什么需要它
 *
 * 官方 Seat 保持挂载，但它的展开态只驱动被隐藏的官方 surface。
 * 用户看见的琉璃 dock 有独立展开态，因此 header 按钮需驱动琉璃控制器。
 *
 * ## 为什么长得和官方一样
 *
 * 沿用旧 PreviewButton 的 panel-right 图标、26px 控件尺寸与品牌色展开态，
 * 但开合行为仍由新的琉璃 dock 控制器负责。
 *
 * 展开时官方原实现返回 null（按钮消失，由面板自己的折叠控件接管）。但迁移模式下
 * 官方面板（以及它自带的折叠控件）不在场，如果按钮也消失，用户就**没有任何收起
 * 入口**（实测反馈：「不能点击按钮开合侧边栏，收不起来」）。因此这里改为**常驻**：
 * 展开时图标镜像（指向收起的同一枚图标），点击即收起。
 */
export function LiuliRightbarExpandButton(): ReactElement {
  const [, force] = useState(0)
  // 展开状态有两个来源：控制器（surface 挂载时）与 window 标记（surface 未挂载时，
  // 例如收起后 RightbarSession 不渲染 —— 此时控制器可能还没创建）。
  const [expanded, setExpanded] = useState(() => readForceExpanded() ?? isAnyLiuliDockExpanded())
  useEffect(() => {
    // 控制器变化
    const dispose = subscribeLiuliDockAll(() => { force(n => n + 1) })
    // window 标记变化（收起/展开后 surface 卸载也要跟上）
    const timer = window.setInterval(() => {
      const next = readForceExpanded() ?? isAnyLiuliDockExpanded()
      setExpanded(prev => (prev === next ? prev : next))
    }, 150)
    return () => { dispose(); window.clearInterval(timer) }
  }, [])
  /** 把展开状态同时写到控制器与 window 标记（帧层优先读后者，避免时序竞态）。 */
  const apply = (next: boolean): void => {
    setLiuliDockExpanded(next)
    publishForceExpanded(next)
    setExpanded(next)
    if (next) window.dispatchEvent(new Event('liuli:ensure-details'))
    try {
      if (next) (window as unknown as { __liuliOpenDetails__?: () => void }).__liuliOpenDetails__?.()
      else (window as unknown as { __liuliCloseDetails__?: () => void }).__liuliCloseDetails__?.()
    } catch { /* 宿主入口不可用时忽略 */ }
    force(n => n + 1)
  }
  return createElement('button', {
    type: 'button',
    className: css.expandButton + (expanded ? ' ' + css.expandButtonActive : ''),
    'aria-label': expanded ? '收起右侧边栏' : '打开右侧边栏',
    'data-liuli-rightbar-expand': true,
    'data-liuli-rightbar-expanded': expanded || undefined,
    title: expanded ? '收起右侧边栏' : '打开右侧边栏',
    onClick: () => { apply(!expanded) },
  }, expanded
    ? createElement(PanelRightCloseIcon, { size: 16 })
    : createElement(PanelRightOpenIcon, { size: 16 }))
}

/** 订阅所有控制器的变化（帧层用它决定右栏列宽度何时重算）。 */
export function subscribeLiuliDockAll(listener: () => void): () => void {
  const disposers: (() => void)[] = []
  const attach = (controller: DockController): void => { disposers.push(controller.subscribe(listener)) }
  for (const controller of controllers.values()) attach(controller)
  // 新会话的控制器在首次渲染时创建：用一个轻量轮询兜底（1s，开销可忽略）。
  const timer = window.setInterval(() => {
    for (const controller of controllers.values()) {
      if (!attached.has(controller)) { attach(controller); attached.add(controller) }
    }
  }, 1000)
  const attached = new Set<DockController>(controllers.values())
  return () => {
    window.clearInterval(timer)
    for (const dispose of disposers) dispose()
  }
}

/* ── 意图包装：经典模式接入整窗布局；内部分栏模式修补唯一 tab 拖边缘 ── */

/**
 * 把一个 tab 拖到**自己所在格的边缘**时，dockkit 的 `planDropTab` 会放弃：
 *
 * ```js
 * const vacates = source.id === targetPaneId && source.tabs.length === 1;
 * if (vacates && makeTab === void 0) return NOTHING;   // ← 拖走唯一 tab 且无回填工厂
 * ```
 *
 * `DockSurface` 的拖拽释放路径调用 `intents.dropTab(tabId, paneId, zone)` 时**不传
 * `makeTab`**（只有 `splitPane` / `addTab` 会传），所以「格子里只有一个 tab 时把它
 * 拖到自己格子的上/下/左/右边缘」什么都不发生 —— 用户看到的就是「拖不动、只有
 * 左右分栏」。
 *
 * 这里包一层 `DockIntents`：命中该场景时改用 `splitPane(target)` 建出新格，再把
 * 被拖的 tab `placeTab` 过去，等效于「分栏并带着 tab 走」。其余意图原样转发给
 * 控制器。
 *
 * @param controller - 该会话的 dock 控制器。
 * @returns 满足 `DockIntents` 的包装对象。
 */
function intentsWithDropFix(controller: DockController, routeInnerEdgesToShell: boolean): DockController & {
  dropTab: (tabId: string, targetPaneId: string, zone: string) => boolean
} {
  const wrapped = Object.create(controller) as DockController & {
    dropTab: (tabId: string, targetPaneId: string, zone: string) => boolean
  }
  // 显式绑定：Object.create 得到的是原型链，方法里的 this 必须指向真实控制器。
  for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(controller))) {
    if (key === 'constructor') continue
    const value = (controller as unknown as Record<string, unknown>)[key]
    if (typeof value === 'function') {
      (wrapped as unknown as Record<string, unknown>)[key] = (value as (...args: unknown[]) => unknown).bind(controller)
    }
  }
  for (const key of Object.getOwnPropertyNames(controller)) {
    const value = (controller as unknown as Record<string, unknown>)[key]
    if (typeof value === 'function') {
      (wrapped as unknown as Record<string, unknown>)[key] = (value as (...args: unknown[]) => unknown).bind(controller)
    }
  }

  /**
   * 拖到右栏**外面**时：改投到外层 dock 布局（恢复「标签拆到任意区域」的原设计）。
   *
   * dockkit 的释放逻辑：落点不在自己的 surface 内 → 调用 `intents.floatTab`（浮窗）。
   * 琉璃原外壳里标签可以拆到左栏/会话区/页头/任意格，所以这里先问外层布局能否接收
   * 该落点（`getDockHostBridge().dropPanelAt`）：能就交给外层，不能才退回浮窗。
   */
  wrapped.floatTab = (tabId, rect) => {
    const tab = tabId as unknown as TabId
    const record = controller.getSnapshot().state.tabs[tab]
    const kind = typeof record?.kind === 'string' ? record.kind : undefined
    const dockType = kind === undefined ? undefined : KIND_TO_DOCK_TYPE[kind]
    // 释放点：dockkit 传入的 rect（视口坐标）中心；没有 rect 时退回视口中心。
    const x = rect === undefined ? window.innerWidth / 2 : rect.x + rect.width / 2
    const y = rect === undefined ? window.innerHeight / 3 : rect.y + 20
    if (dockType !== undefined) {
      const bridge = getDockHostBridge()
      if (typeof bridge.dropPanelAt === 'function') {
        try {
          if (bridge.dropPanelAt(dockType, x, y)) {
            // 外层已接住：把该 tab 从右栏关掉（等价于"移动"而非"复制"）。
            controller.closeTab(tab)
            return undefined as unknown as never
          }
        } catch (error) {
          console.warn('[liuli] 跨区域投放失败，退回浮窗:', error)
        }
      }
    }
    return controller.floatTab(tab, rect)
  }

  wrapped.dropTab = (tabId, targetPaneId, zone) => {
    // dockkit 的 id 是品牌类型（PaneId/TabId），而 DockIntents 的运行时形状是字符串；
    // 这里在边界处做一次断言，内部调用仍回到控制器的强类型签名。
    const tab = tabId as unknown as TabId
    const pane = targetPaneId as unknown as PaneId
    const state = controller.getSnapshot().state
    const source = findTabPaneOf(state, tabId)
    const isEdge = zone !== 'center'
    if (routeInnerEdgesToShell && isEdge) {
      const record = state.tabs[tab]
      const dockType = record === undefined ? undefined : KIND_TO_DOCK_TYPE[record.kind]
      const bridge = getDockHostBridge()
      if (dockType !== undefined && bridge.dropPanelAt !== undefined) {
        try {
          if (bridge.dropPanelAt(dockType, lastDockPointer.x, lastDockPointer.y, true)) {
            controller.closeTab(tab)
            return true
          }
        } catch (error) {
          console.warn('[liuli] 右栏投放到整窗布局失败:', error)
        }
      }
      // 禁用内部分栏时，外层未接住也不能回落为官方式拆格。
      return false
    }
    const vacates = source !== undefined && source.id === targetPaneId && source.tabs.length === 1
    if (isEdge && vacates) {
      // 用 planner 直接生成操作（保留 zone 决定的轴向：top/bottom → column，
      // left/right → row），并**带上 makeTab** 让引擎回填被腾空的原格。
      // 注意不能用 controller.splitPane()：它把 axis 写死成 'row'，上下分栏会变成左右。
      const c = controller as unknown as {
        state: LayoutState
        mint: (prefix: string) => unknown
        run: (ops: readonly unknown[]) => boolean
        makePaneTab?: (id: unknown) => TabRecord
      }
      const ops = planDropTab(
        c.state,
        c.mint.bind(controller) as never,
        tab,
        pane,
        zone as unknown as DockZone,
        c.makePaneTab as never,
      )
      if (ops.length > 0 && c.run(ops as never)) {
        // 让被拖的 tab 在新格里成为活动项（placeTab 已由 ops 表达，这里只补聚焦）。
        controller.focusTab(tab)
        return true
      }
    }
    return controller.dropTab(tab, pane, zone as unknown as DockZone)
  }
  return wrapped
}

/** 用 dockkit 的树工具查某 tab 所在的格（避免依赖未导出的内部函数）。 */
function findTabPaneOf(state: LayoutState, tabId: string): { id: string; tabs: readonly string[] } | undefined {
  for (const node of Object.values(state.nodes)) {
    if (node.kind !== 'pane') continue
    if ((node.tabs as readonly string[]).includes(tabId)) {
      return { id: node.id as unknown as string, tabs: node.tabs as unknown as readonly string[] }
    }
  }
  return undefined
}

/** 标签拖拽是否真的在进行中（dockkit 的可靠标记，而不是"鼠标按下"）。
 *
 *  为什么不能只看 pointerdown：早前用「任意 pointerdown 就算拖拽」判断，导致用户
 *  在页面**任意位置**按下鼠标都会触发外层的 dockable 落点指示器（实测反馈的 bug）。
 *  dockkit 真正进入拖拽态时会在自己的 DOM 上留下标记：
 *   · `[class*="_tabDragging"]` —— 被拖的 chip 带上 dragging 类
 *   · `[data-dockkit-drop-active]` / `[data-dockkit-dock-zone]` —— 落区提示层
 *  只有这些标记存在时才认为"正在拖标签"。 */
function isDockkitTabDragging(): boolean {
  if (typeof document === 'undefined') return false
  return document.querySelector('[class*="_tabDragging"]') !== null
    || document.querySelector('[data-dockkit-drop-active]') !== null
    || document.querySelector('[data-dockkit-dock-zone]') !== null
}

/** 拖拽预览：dockkit 的标签手势是内部 pointer 实现，外层拿不到它的 move 回调。
 *
 *  难点 1：dockkit 用 `setPointerCapture` 捕获指针后，`pointermove` 只派发给捕获
 *  元素（及其祖先链），在 `document` 上挂捕获监听收不到 —— 因此用指针位置轮询兜底。
 *  难点 2（本函数修正的核心）：不能把"鼠标按下"当成"正在拖标签"，否则页面任意位置
 *  按下都会画外层指示器。判据改用 **dockkit 自己的拖拽标记**（见上）。 */
function useOuterDropPreview(sessionId: string, surfaceRef: { current: HTMLDivElement | null }, includeDetails: boolean): void {
  useEffect(() => {
    let pressing = false
    let lastX = 0
    let lastY = 0
    let activeType: string | undefined
    let raf = 0

    const dockTypeOf = (): string | undefined => {
      const controller = controllers.get(sessionId)
      const st = controller?.getSnapshot().state
      if (st === undefined) return undefined
      // 手势中"被拖的 tab"由 dockkit 内部持有；这里取活动 tab 作为近似
      //（dockkit 拖动时活动 tab 就是被拖的那个 chip）。
      const paneNode = Object.values(st.nodes).find(n => n.kind === 'pane' && n.id === st.activePaneId)
      const tabId = paneNode !== undefined && paneNode.kind === 'pane' ? paneNode.activeTabId : undefined
      const rec = tabId === undefined ? undefined : st.tabs[tabId]
      return rec === undefined ? undefined : KIND_TO_DOCK_TYPE[rec.kind]
    }

    const refresh = (): void => {
      if (!pressing) return
      const bridge = getDockHostBridge()
      if (!isDockkitTabDragging()) {
        bridge.clearPanelDrop?.()
        return
      }
      const el = surfaceRef.current
      if (el === null) return
      const r = el.getBoundingClientRect()
      const inside = lastX >= r.left && lastX <= r.right && lastY >= r.top && lastY <= r.bottom
      if (inside && !includeDetails) {
        bridge.clearPanelDrop?.()
        return
      }
      if (inside && includeDetails && el.querySelector(
        '[data-dockkit-dock-zone][data-dockkit-drop-active]:not([data-dockkit-dock-zone="center"])',
      ) === null) {
        bridge.clearPanelDrop?.()
        return
      }
      if (activeType === undefined) activeType = dockTypeOf()
      if (activeType === undefined) return
      bridge.previewPanelDrop?.(activeType, lastX, lastY, includeDetails)
    }
    const schedule = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => { raf = 0; refresh() })
    }

    const record = (e: PointerEvent): void => {
      if (e.buttons === 0) return
      lastX = e.clientX
      lastY = e.clientY
      lastDockPointer = { x: lastX, y: lastY }
      schedule()
    }
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      pressing = true
      activeType = undefined
      lastX = e.clientX
      lastY = e.clientY
      lastDockPointer = { x: lastX, y: lastY }
    }
    const onUp = (e: PointerEvent): void => {
      lastDockPointer = { x: e.clientX, y: e.clientY }
      if (raf !== 0) { cancelAnimationFrame(raf); raf = 0 }
      pressing = false
      activeType = undefined
      getDockHostBridge().clearPanelDrop?.()
    }
    const onMouseMove = (e: MouseEvent): void => {
      if (e.buttons === 0) return
      lastX = e.clientX
      lastY = e.clientY
      lastDockPointer = { x: lastX, y: lastY }
      schedule()
    }

    // 事件通道（能收到就用，收不到靠下面的轮询）
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointermove', record, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    window.addEventListener('mousemove', onMouseMove, true)

    // pointermove 到得了时每帧更新；capture 吃掉事件时 60ms 轮询兜底。
    const timer = window.setInterval(() => { if (pressing) schedule() }, 60)

    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointermove', record, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
      window.removeEventListener('mousemove', onMouseMove, true)
      window.clearInterval(timer)
      if (raf !== 0) cancelAnimationFrame(raf)
    }
  }, [sessionId, surfaceRef, includeDetails])
}

/* ── 注册入口 ── */

/**
 * 启动官方右栏的会话绑定（**不再遮蔽官方 `rightbar.session` 席位**）。
 *
 * ## 架构修订（2.0.9 实测，重要）
 *
 * 早前这里以 `priority: -1` 遮蔽官方 `RightbarSeat`，让琉璃的 dock surface 占住该
 * 席位。**这会让官方 `ctx.sidebarRight` 彻底失效**：
 *
 * ```js
 * // 官方 client.js
 * bindService: (binding) => controller.bind(binding)   // ← 官方 RightbarSeat 挂载时调用
 * require() { if (this.binding === void 0) throw new Error("sidebarRight: no session surface is mounted") }
 * ```
 *
 * binding 只由官方 Seat 挂载时建立；遮蔽 Seat ⇒ binding 永远缺席 ⇒ 官方 controller
 * 的每个方法（openTab / openResource / isExpanded…）都抛
 * `sidebarRight: no session surface is mounted`，**官方插件随之失效** ——
 * 对话页的文件按钮（官方 `gemp6G_file`，点击调 `openResource`）点了毫无反应，
 * 且该错误文本会显示在界面上（用户实测反馈）。
 *
 * ## 现在的做法
 *
 * 官方 Seat **照常挂载**（binding 建立、官方 API 100% 可用），官方 surface 的视觉由
 * CSS 隐藏（`[data-liuli-official-rightbar-host]`，见 DockShellFrame.module.css），
 * 琉璃的 dock surface 由**帧层在同一张卡片里直接渲染**（dock-shell-frame.tsx 的
 * `REGION_DETAILS` 分支）—— 于是既有官方的完整 API，又有琉璃的四边分栏 / 4 格 /
 * 跨区域拖拽。
 *
 * 官方 API 打开的 tab（如文件预览）会落进官方 layout，用户看不到 —— 由下面的
 * 轮询桥把它们同步进琉璃的 dock 布局（`syncOfficialTabsToDock`）。
 *
 * @param ctx - 客户端插件上下文。
 * @param host - 宿主能力。
 * @returns 释放函数。
 */
export function registerLiuliDockSurface(
  _ctx: Context,
  _host: LiuliSidebarHostAccess,
): () => void {
  // 席位不再注册（见上）。保留函数签名供 index.ts 调用点表达意图；
  // 官方 tab → 琉璃 dock 的同步桥在帧层侧启动（需要 sessionId）。
  return () => {}
}

/** 官方 tab kind → 琉璃 dock 面板 kind（官方 API 打开的 tab 同步进琉璃布局时用）。 */
const OFFICIAL_KIND_TO_DOCK: Readonly<Record<string, LiuliDockKind>> = {
  'liuli-review': 'review',
  'liuli-files': 'files',
  'liuli-terminal': 'terminal',
  'liuli-code': 'code',
  'liuli-browser': 'browser',
  'liuli-side-chat': 'side-chat',
  'liuli-developer-tools': 'developer-tools',
}

/**
 * 从官方 tab 的 `contentId` 取出文件路径。
 *
 * 官方 `ui-chat` 常用 session 地址；工作区外绝对路径也可能放在同一
 * session 地址的 path 段里。另兼容官方文件地址的 absolute scope。
 *
 * @param contentId - 官方 tab 的 contentId。
 * @param sessionId - 期望的会话 id（不匹配时返回空串，避免跨会话误开）。
 * @returns 路径（相对或绝对）；无法解析时为空串。
 */
function pathFromOfficialContentId(contentId: string, sessionId: string): string {
  try {
    // 与官方 parseFileAddress 一样忽略查询串与 fragment，按段解码路径。
    const end = contentId.search(/[?#]/)
    const address = end === -1 ? contentId : contentId.slice(0, end)
    const m = /^dsh-resource:\/\/file\/session\/([^/]+)\/(.*)$/.exec(address)
    if (m !== null) {
      const owner = decodeURIComponent(m[1] ?? '')
      if (owner !== '' && owner !== sessionId) return ''
      return (m[2] ?? '').split('/').map(decodeURIComponent).join('/')
    }
    const absolute = /^dsh-resource:\/\/file\/absolute\/(.*)$/.exec(address)
    if (absolute !== null) {
      const raw = absolute[1] ?? ''
      const unc = raw.startsWith('/')
      const segments = (unc ? raw.slice(1) : raw).split('/').map(decodeURIComponent)
      if (segments[0] === '') return ''
      if (unc) return `//${segments.join('/')}`
      return /^[A-Za-z]:$/.test(segments[0] ?? '') ? segments.join('/') : `/${segments.join('/')}`
    }
    if (address.startsWith('file://')) {
      const url = new URL(address)
      const path = decodeURIComponent(url.pathname)
      if (url.host !== '') return `//${url.host}${path}`
      return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
    }
  } catch { /* 解码失败按无法解析处理 */ }
  return ''
}

/** 官方 tab record 的宽松视图（官方 `active()` 的返回形状）。 */
interface OfficialTabLike {
  id?: string
  kind?: string
  contentId?: string
  title?: string
}

/**
 * 把**官方 controller 打开的 tab** 同步进琉璃的 dock 布局。
 *
 * 为什么需要：官方 API 可用后，官方插件（对话页文件按钮、官方引导页等）会把 tab 开进
 * **官方 layout**，而官方 surface 在迁移模式下是被 CSS 隐藏的 —— 用户看不到内容。
 * 这里轮询官方 `active()`（官方 controller 的公开方法）。琉璃自身的
 * `liuli-*` 面板仍映射回自己的 dock 类型；官方 guide/files/text 与未来新增的
 * 原生 tab 留在上游 Seat，由琉璃 dock 的 `official` 标签承载其完整正文和控件。
 *
 * 只做「新增」不做「关闭」：官方的关闭语义与琉璃 dock 的 tab 生命周期不一一对应，
 * 误关会吃掉用户手动打开的琉璃面板。
 *
 * @param sessionId - 目标会话（琉璃 dock 布局所属会话）。
 * @returns 释放函数。
 */
export function startOfficialTabBridge(sessionId: string): () => void {
  const seen = new Set<string>()
  // 每次轮询都记录官方 active ID，包括右栏收起时。琉璃面板展开不能把旧的
  // 官方 active 再次解释为一次导航，否则会每 320ms 抢回用户选中的标签。
  let lastObservedNativeTabId = ''
  let lastOfficialExpanded = false
  let explicitNativeUntil = 0
  let requestedFocus: { tabId: string; until: number } | undefined
  let navigationTimer: number | undefined
  let disposed = false
  const poll = (): void => {
    if (disposed) return
    try {
      const hook = (window as unknown as {
        __liuliSidebarRight__?: {
          active?: () => OfficialTabLike | null
          isExpanded?: () => boolean
          toggleExpanded?: () => void
        }
      }).__liuliSidebarRight__
      const active = hook?.active?.() ?? null
      if (active === null || typeof active.id !== 'string') return
      const nativeActiveChanged = active.id !== lastObservedNativeTabId
      const firstObservation = lastObservedNativeTabId === ''
      lastObservedNativeTabId = active.id
      const officialExpanded = hook?.isExpanded?.() === true
      const officialJustExpanded = officialExpanded && !lastOfficialExpanded
      lastOfficialExpanded = officialExpanded
      const kind = typeof active.kind === 'string' ? OFFICIAL_KIND_TO_DOCK[active.kind] : undefined
      const now = Date.now()
      const explicitNative = explicitNativeUntil > now
      const confirmedFocus = requestedFocus !== undefined && requestedFocus.until > now
        && requestedFocus.tabId === active.id
      if (requestedFocus !== undefined && (confirmedFocus || requestedFocus.until <= now)) requestedFocus = undefined
      if (kind === undefined) {
        // 官方 `text` 正文拥有 Markdown/code/PDF/image/HTML 渲染器、重新载入、
        // 换行和行号导航；转成琉璃 CodeViewer 会丢掉这些功能。因此保留
        // 上游 Tab 域，只把它的整个可见 Seat 放进琉璃的一枚 dock 标签。
        // 同一文件再次由官方 openResource 打开时 ID 不变；官方 Seat 在用户
        // 切离时会收起，新的 false→true 展开沿也代表一次显式导航。
        if (!officialExpanded || (!nativeActiveChanged && !officialJustExpanded && !explicitNative && !confirmedFocus)) return
        // 桥刚接通时，先前的官方活动文件可能只是恢复状态：只有琉璃尚无
        // 用户选中的 tab 才把它带进可见 dock。后续 ID 变化代表新的官方导航。
        if (firstObservation && !explicitNative && !confirmedFocus
          && Object.keys(controllerFor(sessionId).getSnapshot().state.tabs).length > 0) return
        explicitNativeUntil = 0
        openLiuliDockPanel(sessionId, 'official')
        return
      }
      // An explicit upstream resource navigation may commit on a later store
      // tick. Do not interpret the previous liuli-* active tab as its result.
      if (explicitNative) return
      // 对旧代码打开的 `liuli-*` tab 仍由琉璃面板负责。官方 Seat 为此
      // 产生的展开态不应占第二条轨道，也不需要保留重复正文。
      if (officialExpanded) hook.toggleExpanded?.()
      if (seen.has(active.id)) return
      // 从官方 contentId 取出文件路径喂给面板。
      // ⚠️ CodeViewerPanel 的两个入参语义不同：`rel` 是**相对会话 cwd**的路径
      //（面板自己拼绝对路径），`absolutePath` 才是绝对路径。早前把两者都塞同一个
      // 值，相对路径被当成绝对路径 → 面板报「文件不存在，可能已被移动或删除」。
      const params: LiuliPanelParams = {}
      const raw = typeof active.contentId === 'string' ? active.contentId : ''
      const path = pathFromOfficialContentId(raw, sessionId)
      if (path !== '') {
        const absolute = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\\\')
        if (absolute) params.absolutePath = path
        else params.rel = path
      }
      seen.add(active.id)
      openLiuliDockPanel(sessionId, kind, params)
    } catch { /* 桥接失败不应影响主流程 */ }
  }
  const onNavigation = (event: Event): void => {
    const detail = (event as CustomEvent<OfficialSidebarNavigationDetail>).detail
    if (detail === undefined || disposed) return
    if (detail.method === 'focus') {
      explicitNativeUntil = 0
      requestedFocus = { tabId: detail.tabId, until: Date.now() + 5000 }
    } else if ((typeof detail.kind === 'string' && detail.kind.startsWith('liuli-'))
      || (detail.method === 'openResource' && detail.kind === undefined)) {
      // A resource can resolve to a Liuli extension even without options.kind.
      // Never defer that panel behind an earlier native-navigation grace period.
      explicitNativeUntil = 0
      requestedFocus = undefined
    } else {
      explicitNativeUntil = Date.now() + 5000
      requestedFocus = undefined
    }
    if (navigationTimer !== undefined) window.clearTimeout(navigationTimer)
    navigationTimer = window.setTimeout(() => { navigationTimer = undefined; poll() }, 40)
  }
  window.addEventListener(OFFICIAL_SIDEBAR_NAVIGATION_EVENT, onNavigation)
  poll()
  const timer = window.setInterval(poll, 320)
  return () => {
    disposed = true
    window.clearInterval(timer)
    if (navigationTimer !== undefined) window.clearTimeout(navigationTimer)
    window.removeEventListener(OFFICIAL_SIDEBAR_NAVIGATION_EVENT, onNavigation)
  }
}

/** 供外部（驱动层）在 dock 布局里打开某面板。
 *
 *  这是「打开面板」意图在迁移模式下的**唯一入口**：对话页「打开」前端文件、轮次卡片
 *  「审查」、产物链接、`/side` 指令都汇到这里。早前它们走官方 `ctx.sidebarRight.openTab`，
 *  但遮蔽官方 Seat 后该控制器失去会话绑定（`no session surface is mounted`），入口
 *  全部失效 —— 现在直接驱动**我们自己的** DockController。
 *
 *  同时负责把右栏展开（列宽由帧层按 `__liuliForceExpanded__`/控制器状态给出）。 */
export function openLiuliDockPanel(
  sessionId: string,
  kind: LiuliDockTabKind,
  params?: LiuliPanelParams,
  options: { newInstance?: boolean } = {},
): void {
  const controller = controllerFor(sessionId)
  const spec = specOf(kind)
  if (spec === undefined) return
  // 参数进覆盖式表（正文渲染时读取；再次打开同一面板也能刷新参数）。
  // 顺序：先写参数再 openContent —— openContent 若触发挂载，首帧就要能读到。
  const nonce = params?.nonce ?? ++panelParamSeq
  const contentId = kind === 'browser' && options.newInstance === true
    ? `sidebar://browser/${nonce}`
    : `sidebar://${kind}`
  const paramKey = kind === 'browser' ? browserParamKey(sessionId, contentId) : kind
  const previous = kind === 'browser' ? getLatestPanelParams(paramKey) : undefined
  setLatestPanelParams(paramKey, { ...previous, ...params, nonce })
  // 兼容官方正文路径（panel-driver 的 pending 表）；官方正文在迁移模式下不在场，无副作用。
  if (kind !== 'official') setPanelParams(kind, { ...params, nonce })
  controller.openContent({
    kind,
    contentId,
    title: spec.title,
  })
  controller.setExpanded(true)
  // 展开状态同步给帧层与宿主（否则「面板开了但列宽还是 0」，用户看不见）。
  publishForceExpanded(true)
  window.dispatchEvent(new Event('liuli:ensure-details'))
  try {
    ;(window as unknown as { __liuliOpenDetails__?: () => void }).__liuliOpenDetails__?.()
  } catch { /* 宿主入口不可用时忽略 */ }
}

/** 面板打开请求的自增序号（同一面板重复打开也要让 React 识别为变化）。 */
let panelParamSeq = 0

/** 清理某会话的控制器（会话关闭/插件卸载时调用，避免 Map 无限增长）。 */
export function disposeLiuliDockSurface(sessionId?: string): void {
  if (sessionId === undefined) {
    controllers.clear()
    for (const key of latestPanelParams.keys()) if (key.startsWith('browser:')) latestPanelParams.delete(key)
    return
  }
  controllers.delete(sessionId)
  for (const key of latestPanelParams.keys()) {
    if (key.startsWith(`browser:${sessionId}\u0000`)) latestPanelParams.delete(key)
  }
}
