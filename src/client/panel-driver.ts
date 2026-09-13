/**
 * 琉璃面板驱动适配层：把「打开某个面板」的意图路由到当前生效的右栏实现。
 *
 * 背景：自研模式下，面板驱动入口（轮次卡片「审查」按钮、产物链接、模型活动自动
 * 驱动浏览器、`/side` 命令、打开前端文件）都由 `PreviewDetailsPanel` 组件内部
 * 的监听器处理；官方右栏模式下该组件**不再注册**（让出 rightbar 席位），这些入口
 * 会整体失效（点了没反应）。本模块把它们接到官方控制器 `ctx.sidebarRight.openTab`
 * 上，使两种模式下面板行为一致。
 *
 * 参数传递：官方 `openTab` 的 `params` 需要正文侧读 `useTabInfo` 才能拿到，链路更长
 * 且依赖官方内部面；这里改用与 review-bus 同构的**模块级 pending 表** —— 打开前
 * 写入、正文挂载时消费，简单、可控，也不受同一 kind 多 tab 的影响（本插件的面板
 * 都是单实例语义）。
 */

/** 琉璃面板种类（与 sidebar-right-tabs 的 PANEL_SPECS 对齐）。 */
export type LiuliPanelKind =
  | 'review' | 'files' | 'terminal' | 'code' | 'browser' | 'side-chat' | 'developer-tools'

/** 面板打开参数（按面板种类取用其子集）。 */
export interface LiuliPanelParams {
  /** 审查：要定位的文件（相对会话 cwd）。 */
  path?: string
  /** 审查：强制切换到的来源（如 'last-turn'）。 */
  source?: string
  /** 浏览器：目标 URL。 */
  url?: string
  /** 代码查看：相对会话 cwd 的路径。 */
  rel?: string
  /** 代码查看：绝对路径（rel 为空时用）。 */
  absolutePath?: string
  /** 辅助对话：首条提示词。 */
  initialPrompt?: string
  /** 请求序号：同一文件的重复请求也要能被 React 识别为变化。 */
  nonce?: number
}

interface DriverDeps {
  /** 官方控制器（官方右栏模式生效时返回它；自研模式返回 undefined）。 */
  controller: () => {
    openTab?: (kind: string, options?: Record<string, unknown>) => void
  } | undefined
}

let deps: DriverDeps | undefined
/** 待消费参数：打开前写入，正文挂载时取走（取走即删除，避免下次误用）。 */
const pendingParams = new Map<LiuliPanelKind, LiuliPanelParams>()

let paramSeq = 0

/** 注册官方控制器来源（由 sidebar-right-tabs 在服务就绪时提供）。 */
export function initPanelDriver(next: DriverDeps): void {
  deps = next
}

/** 官方 tab kind（与 PANEL_SPECS 的 kind 命名一致）。 */
function officialKind(kind: LiuliPanelKind): string {
  return `liuli-${kind}`
}

/** 写入某面板的待消费参数（覆盖同 kind 上一次未消费的参数）。 */
export function setPanelParams(kind: LiuliPanelKind, params: LiuliPanelParams): void {
  pendingParams.set(kind, params)
}

/** 取走某面板的待消费参数。 */
export function consumePanelParams(kind: LiuliPanelKind): LiuliPanelParams | undefined {
  const value = pendingParams.get(kind)
  if (value !== undefined) pendingParams.delete(kind)
  return value
}

/**
 * 打开一个琉璃面板。
 *
 * @param kind - 面板种类。
 * @param params - 面板参数（写入 pending 表，供正文挂载时消费）。
 * @returns `true` 表示已交给官方右栏；`false` 表示官方模式未生效，
 *          调用方应回退到自研链路（派发事件给 PreviewDetailsPanel）。
 */
export function openLiuliPanel(kind: LiuliPanelKind, params: LiuliPanelParams = {}): boolean {
  const controller = deps?.controller()
  if (controller === undefined || typeof controller.openTab !== 'function') return false
  setPanelParams(kind, { ...params, nonce: params.nonce ?? ++paramSeq })
  try {
    controller.openTab(officialKind(kind))
    return true
  } catch (error) {
    // 停靠面未挂载等情况下退回自研链路，避免「点了完全没反应」。
    console.warn(`[liuli] 官方右栏打开「${kind}」失败，回退自研链路:`, error)
    return false
  }
}

/** 请求序号（供外部构造审查请求时复用同一自增序列）。 */
export function nextPanelNonce(): number {
  return ++paramSeq
}
