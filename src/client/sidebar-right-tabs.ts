/**
 * 琉璃主题 · 官方右侧栏扩展点接入。
 *
 * 背景：DSH Desktop 2.0.9 起客户端内置官方右侧栏
 * （`@deepseek-ai/dsh-client-ui-sidebar-right`，0.1.5-rc.1），它对外提供：
 *
 *  - `ctx.sidebarRight`：导航控制器（openResource/openTab/close/isExpanded/
 *    focus/split/float/dock）；
 *  - `ctx.sidebarRightTabs`：tab 类型注册表。`register({ id, kind, priority,
 *    patterns?, canOpen?, title, guide? })`，`priority: 'extension'` 档位高于
 *    官方 builtin，可接管同名 kind；`guide` 是**数组**且 title/description 为
 *    延迟读取的函数（实测形状错误会抛 "(definition.guide ?? []).map is not a function"）；
 *  - 正文席位 `sidebar.right.pane.tab`（keyed + session 作用域）与标题席位
 *    `sidebar.right.pane.tab.title`；正文组件经席位注入拿到 `sessionId` 等
 *    标准 props（官方 ui-sidebar-files / ui-sidebar-documentpreview 走的正是
 *    这条公开路径）。
 *
 * 本模块把琉璃既有的自包含面板逐个登记成官方 tab 类型，标签条/分栏/拖拽/
 * 浮窗/宽度/开合全部交还官方，面板正文仍复用既有组件（功能不变）。
 *
 * 兼容与安全：
 *  - **不用 `ctx.inject`**：那会把本插件挂进 cordis boot 依赖图，服务缺席或
 *    后置时同一 bundle 层依赖它的官方插件（ui-sidebar-files / -documentpreview
 *    都 inject 了 sidebarRightTabs）会一起加载失败，界面报
 *    "Failed to load plugins / loader fibers failed"（2026-09-13 实测）。这里
 *    改为非阻塞轮询 + `ctx.get`（不建立依赖），旧客户端自然永不注册。
 *  - 每个面板正文都用错误边界包住：单个面板抛错不会掀翻整个官方右栏。
 */
import type { Context } from '@deepseek-ai/cordis'
import { Component, createElement, useState, type ErrorInfo, type ReactElement, type ReactNode } from 'react'
import { consumePanelParams, type LiuliPanelKind, type LiuliPanelParams } from './panel-driver.ts'
import type { SidebarGitSourceId } from './right-sidebar-api.ts'
import { FileReviewPanel } from './FileReviewPanel.tsx'
import { FileTreePanel } from './RightSidebarPanels.tsx'
import {
  DeveloperToolsPanel, SideChatPanel, TerminalPanel,
  type SidePaneHostAccess,
} from './SidePaneExtraPanels.tsx'
import { BrowserPanel, CodeViewerPanel } from './PreviewPanel.tsx'
import {
  BugIcon, FileCodeCornerIcon, FileDiffIcon, FolderIcon, GlobeIcon,
  MessageSquareTextIcon, SquareTerminalIcon,
} from './SidePaneIcons.tsx'

/* ── 官方扩展点类型面（0.1.5-rc.1 公开面；内联声明，避免对可选包的编译期硬依赖） ── */

/** 官方 tab 类型定义。 */
export interface SidebarRightTabDefinition {
  id: string
  kind: string
  priority?: 'extension' | 'builtin' | 'fallback'
  patterns?: readonly string[]
  canOpen?: (address: string) => boolean
  title?: (address: string) => string
  /** 引导页入口胶囊列表（官方按数组展开；title/description 为延迟读取的函数）。 */
  guide?: readonly {
    order?: number
    title?: () => string
    description?: () => string
    icon?: unknown
  }[]
}

/** 官方 tab 类型注册表最小面（本插件只用到 register / entries）。 */
export interface SidebarRightTabsRegistry {
  register(definition: SidebarRightTabDefinition): () => void
  entries?: () => unknown[]
}

/** 官方导航控制器最小面（迁移期只用到这几个）。 */
export interface SidebarRightController {
  openResource?: (address: string, options?: Record<string, unknown>) => void
  openTab?: (kind: string, options?: Record<string, unknown>) => void
  close?: (tabId: string) => void
  active?: () => unknown
  isExpanded?: () => boolean
  toggleExpanded?: () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 官方右侧栏 tab 类型注册表（客户端 < 2.0.9 时运行期缺席）。 */
    sidebarRightTabs: SidebarRightTabsRegistry
    /** 官方右侧栏导航控制器（客户端 < 2.0.9 时运行期缺席）。 */
    sidebarRight: SidebarRightController
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * 官方右侧栏的 tab 正文席位：keyed + session 作用域，由
     * `@deepseek-ai/dsh-client-ui-sidebar-right` 声明并在 `rightbar.session`
     * 之下对外开放。每个 tab 类型以自己的 `id` 作为 key 注册正文；会话身份
     * （sessionId 等）由席位框架按 `scope: 'session'` 自动注入。
     */
    'sidebar.right.pane.tab': {
      kind: 'keyed'
      scope: 'session'
      owner: SidebarRightPaneOwnerProps
    }
    /**
     * 官方右侧栏 tab 的**标题席位**：渲染 chip 里类型标签**前面**那枚 16px 图标
     * （文字本身由框架用 definition.title 绘制）。官方 ui-sidebar-files 就是用它
     * 放自己的文件夹图标的 —— 不注册该席位时官方会退化成默认占位图标。
     */
    'sidebar.right.pane.tab.title': {
      kind: 'keyed'
      scope: 'session'
      owner: SidebarRightPaneOwnerProps
    }
  }
}

/** 该席位没有额外 owner props：面板需要的一切都来自框架标准 props。 */
export interface SidebarRightPaneOwnerProps {}

/* ── 宿主能力与面板声明表 ── */

/** 官方右栏面板可用的宿主能力（由 index.ts 注入：与自研侧边栏共用同一份数据面）。 */
export interface LiuliSidebarHostAccess {
  /** 在系统编辑器中打开路径。 */
  openPath?: ((path: string) => void) | undefined
  /** 把文件加进当前会话输入框。 */
  addFileToChat?: ((path: string) => void) | undefined
  /** 宿主数据面（辅助对话 / 开发者工具需要）。 */
  sidePaneHost?: SidePaneHostAccess | undefined
}

/** 一个琉璃面板 → 官方 tab 类型的映射。 */
interface PanelSpec {
  /** tab 类型 kind（liuli- 前缀，不与官方 builtin 撞名）。 */
  kind: string
  /** tab 与引导页入口的标题。 */
  title: string
  /** 引导页入口排序。 */
  order: number
  /** 引导页入口描述。 */
  description: string
  /** 正文渲染：拿到席位注入的 sessionId、宿主能力与驱动参数后复用既有面板组件。 */
  render: (sessionId: string, host: LiuliSidebarHostAccess, params?: LiuliPanelParams) => ReactNode
  /** 是否依赖宿主数据面（缺失时跳过注册，避免给出永远空白的 tab）。 */
  needsSidePaneHost?: boolean
  /** 16px 图标（官方 tab chip 与引导页入口都用它）：path 取自 dock 面板图标集，
   *  不提供时官方会用默认占位图标，观感与自研侧边栏不一致。 */
  /** 面板图标组件：与自研侧边栏**同一套** Material Symbols（SidePaneIcons），
   *  官方 tab chip 与引导页入口都用它，避免「并入官方后图标换了一茬」。 */
  icon: (props: { size?: number }) => ReactElement
}

const PANEL_SPECS: readonly PanelSpec[] = [
  {
    kind: 'review',
    icon: FileDiffIcon,
    title: '审查',
    order: 40,
    description: 'Git 变更与 diff 审查',
    render: (sessionId, host, params) => createElement(FileReviewPanel, {
      sessionId,
      ...(host.openPath === undefined ? {} : { onOpenPath: host.openPath }),
      // 驱动参数 → 审查请求：带 source 走「切源 + 展开目标」，否则走「定位文件」，
      // 与轮次卡片「审查」按钮 / LLM 活动自动展开在自研模式下的语义一致。
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
    icon: FolderIcon,
    title: '文件树',
    order: 41,
    description: '会话工作区文件树（搜索 / 仅变更 / Git 徽标）',
    render: (sessionId, host) => createElement(FileTreePanel, {
      sessionId,
      ...(host.addFileToChat === undefined ? {} : { onAddFileToChat: host.addFileToChat }),
      ...(host.openPath === undefined ? {} : { onOpenPath: host.openPath }),
    }),
  },
  {
    kind: 'terminal',
    icon: SquareTerminalIcon,
    title: '终端',
    order: 42,
    description: '会话工作目录终端',
    render: sessionId => createElement(TerminalPanel, { sessionId }),
  },
  {
    kind: 'code',
    icon: FileCodeCornerIcon,
    title: '代码查看',
    order: 43,
    description: '按路径查看文件内容',
    render: (sessionId, host, params) => createElement(CodeViewerPanel, {
      sessionId,
      rel: params?.rel ?? '',
      path: params?.absolutePath ?? '',
      ...(host.openPath === undefined ? {} : { onOpenPath: host.openPath }),
    }),
  },
  {
    kind: 'browser',
    icon: GlobeIcon,
    title: '浏览器',
    order: 44,
    description: '内嵌浏览器（Electron webview / Web iframe 双模）',
    render: (sessionId, host, params) => createElement(BrowserPanel, {
      tabId: 'liuli-official-rightbar-browser',
      sessionId,
      url: params?.url ?? 'about:blank',
      active: true,
      onNavigate: () => { /* 官方右栏 tab 不跟随页面标题，保持静态标题 */ },
      onTitleChange: () => { /* 同上 */ },
      insertElement: () => { /* 官方右栏浏览器暂无输入框插入通道 */ },
      getPaneEl: () => document.querySelector<HTMLElement>('[data-liuli-official-rightbar]'),
      ...(host.openPath === undefined ? {} : { onOpenPath: host.openPath }),
    }),
  },
  {
    kind: 'side-chat',
    icon: MessageSquareTextIcon,
    title: '辅助对话',
    order: 45,
    description: 'fork 一个子会话并行提问',
    needsSidePaneHost: true,
    render: (sessionId, host, params) => host.sidePaneHost === undefined
      ? null
      : createElement(SideChatPanel, {
        sessionId,
        host: host.sidePaneHost,
        onChildCreated: () => { /* 官方右栏 tab 不持久化子会话 id（随 tab 生命周期） */ },
        ...(params?.initialPrompt === undefined ? {} : { initialPrompt: params.initialPrompt }),
      }),
  },
  {
    kind: 'developer-tools',
    icon: BugIcon,
    title: '开发者工具',
    order: 46,
    description: 'DevTools 与元素检查',
    needsSidePaneHost: true,
    render: (sessionId, host) => host.sidePaneHost === undefined
      ? null
      : createElement(DeveloperToolsPanel, { sessionId, host: host.sidePaneHost }),
  },
]

/** 面板正文的错误边界：单个面板抛错只显示一条提示，不影响官方右栏其余部分。 */
class PanelBoundary extends Component<{ label: string; children?: ReactNode }, { error?: string }> {
  constructor(props: { label: string; children?: ReactNode }) {
    super(props)
    this.state = {}
  }

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn(`[liuli] 官方右栏面板「${this.props.label}」渲染失败:`, error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.error !== undefined) {
      return createElement('div', { style: { padding: '12px', fontSize: '13px', opacity: 0.8 } },
        `「${this.props.label}」渲染失败：${this.state.error}`)
    }
    return this.props.children
  }
}

/** 已就绪的官方导航控制器（供 panel-driver 把驱动入口接到官方 openTab）。 */
let officialSidebarController: SidebarRightController | undefined

/** 读取官方右栏控制器；未就绪（自研模式 / 旧客户端）时返回 undefined。 */
export function getOfficialSidebarController(): SidebarRightController | undefined {
  return officialSidebarController
}

/** 面板图标元素（官方 tab chip 与引导页入口共用同一枚，统一 16px）。 */
function panelIcon(spec: PanelSpec): ReactElement {
  return createElement(spec.icon, { size: 16 })
}

/** 标题席位正文：官方在 chip 的「类型标签前」渲染这枚图标（文字由框架绘制）。
 *  不注册该席位时官方会退化成默认占位图标 —— 那正是「icon 被替换」的原因。 */
function panelTitleBody(spec: PanelSpec): () => ReactElement {
  return function LiuliOfficialPanelTitle(): ReactElement {
    return panelIcon(spec)
  }
}

/** 生成某面板的正文组件（席位按 session scope 注入 sessionId）。 */
function panelBody(spec: PanelSpec, host: LiuliSidebarHostAccess): (props: { sessionId?: string }) => ReactElement | null {
  return function LiuliOfficialPanelBody(props: { sessionId?: string }): ReactElement | null {
    // 驱动层在 openTab 之前写入的待消费参数（审查定位 / 浏览器 URL / 代码路径…）。
    // 惰性 useState 只在挂载时取一次：既保持 hooks 顺序稳定，也避免渲染期副作用。
    const [params] = useState<LiuliPanelParams | undefined>(
      () => consumePanelParams(spec.kind as LiuliPanelKind),
    )
    const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
    if (sessionId === '') return null
    return createElement(PanelBoundary, { label: spec.title }, spec.render(sessionId, host, params))
  }
}

/* ── 运行期诊断钩子（与 __liuliDockShell__ 同风格；不参与任何业务流程） ── */

function publishProbe(payload: Record<string, unknown>): void {
  try {
    (window as unknown as { __liuliSidebarRightProbe__?: unknown }).__liuliSidebarRightProbe__ = {
      at: new Date().toISOString(),
      ...payload,
    }
  } catch { /* 诊断不应影响主流程 */ }
}

/** 正文席位注册的独立诊断键（不与类型注册的 probe 互相覆盖）。 */
function publishBodyProbe(payload: Record<string, unknown>): void {
  try {
    (window as unknown as { __liuliBodyProbe__?: unknown }).__liuliBodyProbe__ = {
      at: new Date().toISOString(),
      ...payload,
    }
  } catch { /* 诊断不应影响主流程 */ }
}

/**
 * 把琉璃面板接入官方右侧栏扩展点。
 *
 * @param ctx - 客户端插件上下文。
 * @param host - 宿主能力（自研面板与官方右栏面板共用）。
 */
export function startLiuliSidebarTabs(ctx: Context, host: LiuliSidebarHostAccess = {}): void {
  // —— 为什么不用 ctx.inject ——
  // 见文件头注释：那会让官方 files/documentpreview 一起加载失败。
  let poll: number | undefined
  const attempt = (): void => {
    const ctxGet = (ctx as unknown as { get?: (name: string) => unknown }).get
    if (typeof ctxGet !== 'function') return
    const registry = ctxGet.call(ctx, 'sidebarRightTabs') as SidebarRightTabsRegistry | undefined
    if (registry === undefined || typeof registry.register !== 'function') return
    if (poll !== undefined) { window.clearInterval(poll); poll = undefined }
    const controller = ctxGet.call(ctx, 'sidebarRight') as SidebarRightController | undefined
    registerPanels(ctx, registry, controller, host)
  }
  attempt()
  if (poll === undefined) poll = window.setInterval(attempt, 500)
  ctx.effect(
    () => () => { if (poll !== undefined) window.clearInterval(poll) },
    'dsh-liuli-ui-enhance: official sidebar-right tabs poll',
  )
}

/** 服务就绪后的实际注册：每个面板一个 tab 类型 + 一个正文席位。 */
function registerPanels(
  ctx: Context,
  tabs: SidebarRightTabsRegistry,
  controller: SidebarRightController | undefined,
  host: LiuliSidebarHostAccess,
): void {
  // 供 panel-driver 使用：官方模式下面板驱动入口走官方 openTab。
  officialSidebarController = controller
  /** 已注册的类型 id：兼容 entries() 返回「包装项」或「definition 本身」两种结构。 */
  const entryIds = (): string[] => {
    const entries = tabs.entries
    if (typeof entries !== 'function') return []
    try {
      return entries.call(tabs)
        .map((entry) => {
          const wrapped = (entry as { definition?: { id?: string } }).definition
          const direct = entry as { id?: string }
          return wrapped?.id ?? direct?.id
        })
        .filter((id): id is string => typeof id === 'string')
    } catch {
      return []
    }
  }
  const registrant = (): string => {
    try {
      const get = (ctx.slots as unknown as { entries?: (n: string) => unknown[] }).entries
      return typeof get === 'function' ? 'slots' : 'unknown'
    } catch { return 'unknown' }
  }

  /** 诊断：暴露官方导航控制器，供 CDP 核验与迁移期调试。 */
  if (controller !== undefined) {
    try {
      (window as unknown as { __liuliSidebarRight__?: unknown }).__liuliSidebarRight__ = {
        isExpanded: () => controller.isExpanded?.() === true,
        toggleExpanded: () => controller.toggleExpanded?.(),
        openTab: (kind: string, options?: Record<string, unknown>) => controller.openTab?.(kind, options),
        openResource: (address: string, options?: Record<string, unknown>) => controller.openResource?.(address, options),
        active: () => controller.active?.() ?? null,
      }
    } catch { /* 诊断不应影响主流程 */ }
  }

  const skipped: string[] = []
  const registered: string[] = []
  const bodies: string[] = []
  const disposers: (() => void)[] = []

  for (const spec of PANEL_SPECS) {
    if (spec.needsSidePaneHost === true && host.sidePaneHost === undefined) {
      skipped.push(`${spec.kind}（缺宿主数据面）`)
      continue
    }
    const id = `dsh-liuli-ui-enhance/${spec.kind}`
    const kind = `liuli-${spec.kind}`
    if (!entryIds().includes(id)) {
      try {
        disposers.push(ctx.effect(
          () => tabs.register({
            id,
            kind,
            priority: 'extension',
            title: () => spec.title,
            guide: [{
              order: spec.order,
              title: () => spec.title,
              description: () => spec.description,
              icon: () => panelIcon(spec),
            }],
          }),
          `dsh-liuli-ui-enhance: official sidebar-right ${kind} type`,
        ))
        registered.push(id)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // HMR 重跑 apply 时上一轮残留的注册会让 register 抛 "already registered"：等同已注册。
        if (!message.includes('already registered')) {
          skipped.push(`${id}（${message}）`)
          continue
        }
      }
    }
    try {
      disposers.push(ctx.effect(
        // priority -1：低于默认 0 —— keyed 席位「最低者渲染」，因此 HMR 重跑 apply
        // 时本轮的正文组件会覆盖上一轮残留的注册（否则会抛
        // "already has an entry for key ... register at a different priority to shadow it"）。
        () => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: id,
          priority: -1,
        }, panelBody(spec, host))),
        `dsh-liuli-ui-enhance: official sidebar-right ${kind} body`,
      ))
      bodies.push(id)
    } catch (error) {
      skipped.push(`${id} 正文（${error instanceof Error ? error.message : String(error)}）`)
    }
    // 标题席位：chip 里类型标签前的那枚图标（与自研侧边栏同一套图标）。
    try {
      disposers.push(ctx.effect(
        () => ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: id,
          priority: -1,
        }, panelTitleBody(spec))),
        `dsh-liuli-ui-enhance: official sidebar-right ${kind} title`,
      ))
    } catch (error) {
      skipped.push(`${id} 标题（${error instanceof Error ? error.message : String(error)}）`)
    }
  }

  publishProbe({
    phase: 'registered',
    build: PROBE_BUILD,
    registeredIds: entryIds(),
    registered,
    bodies,
    skipped,
    controllerAvailable: controller !== undefined,
    registrant: registrant(),
  })
  publishBodyProbe({ phase: 'armed', bodies })

  ctx.effect(
    () => () => { for (const dispose of disposers.reverse()) dispose() },
    'dsh-liuli-ui-enhance: official sidebar-right registrations',
  )
}

/** 自检标记：用于确认运行中的 bundle 是这一版（CDP 读取 probe 时核对）。 */
const PROBE_BUILD = 'panels-v1'
