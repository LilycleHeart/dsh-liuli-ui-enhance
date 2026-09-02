/**
 * 琉璃主题 · 详细页自动展开（LLM 活动感知）。
 *
 * 当模型在对话流里执行「写/改文件」「git 操作」等动作时，自动展开右侧
 * 详细页并切到「审查文件」标签，让用户实时看到模型正在产出的内容。
 * 浏览器新标签/导航的自动展开由 PreviewPanel 既有逻辑承担
 * （PREVIEW_NAVIGATE_EVENT / webview new-tab，见 PreviewPanel.tsx）。
 *
 * 触发信号（对话流 DOM，宿主 dsh-client-ui-tool 标记）：
 * - `[data-tool="edit"]` / `[data-tool="write"]` / `[data-tool="write_file"]`：
 *   模型写/改文件；
 * - `[data-tool="git"]`：显式 git 工具；
 * - `[data-variant="bash"]`（bash/pwsh）行摘要含 git 子命令：经 shell 跑 git。
 *
 * 控制策略（用户确认）：
 * - 每轮只展开一次：新增**最新一条** user/steering 锚点（新一轮）时重置
 *   「本轮已展开」。历史批量挂载的旧 user 消息不是流内最后一条，不重置，
 *   避免上翻加载历史时把「已展开」标记清掉导致旧工具行再触发一次；
 * - 用户手动收起后本会话不再自动展开：PREVIEW_TOGGLE_EVENT 只由用户手动
 *   开合路径 dispatch（collapsePane/togglePane/header 按钮），自动展开不
 *   dispatch 它；收到后延迟读面板 rect：收起 → dismissed，展开 → 解除；
 * - 会话切换重置：宿主切换会话会重建 `[data-conversation-scroll]` 容器，
 *   观察到容器被替换即重置 expandedThisTurn 与 dismissed；
 * - 启动/会话切换后的 3s 稳定窗口内不触发，避开首屏与历史批量挂载
 *   （对齐 liuli-transition 的初始稳定窗口思路）。
 *
 * 展开动作：dispatch AUTO_OPEN_DETAILS_EVENT（detail: { tab }），由
 * PreviewPanel 监听并执行 openDetails + openSingleton(tab)（同 REVIEW_FILE_EVENT
 * 的桥接模式）。
 */
import type { SidePaneTabType } from './PreviewPanel.tsx'
import { getLastTurnChanges } from './turn-file-store.ts'

/** 请求展开详细页并激活指定标签的事件名。 */
export const AUTO_OPEN_DETAILS_EVENT = 'liuli:auto-open-details'

/** 展开请求载荷。 */
export interface AutoOpenDetailsDetail {
  /** 要激活的标签类型（当前固定 'git' 审查文件）。 */
  tab: SidePaneTabType
}

/** PreviewPanel 的手动开合事件名（字符串常量，避免循环依赖）。 */
const PREVIEW_TOGGLE_EVENT = 'liuli:preview-toggle'

/** 写/改文件类工具（宿主 data-tool 取值）。 */
const FILE_TOOL_SELECTOR = '[data-tool="edit"], [data-tool="write"], [data-tool="write_file"]'
/** 显式 git 工具。 */
const GIT_TOOL_SELECTOR = '[data-tool="git"]'
/** 经 shell 执行命令的工具行（bash/pwsh 均为 bash variant）。 */
const BASH_TOOL_SELECTOR = '[data-variant="bash"]'
/** git 子命令（bash 行摘要匹配用，避免任何含 "git" 的文本都触发）。 */
const GIT_COMMAND_RE = /(^|\s)git\s+(status|add|commit|push|pull|log|diff|checkout|branch|merge|clone|init|remote|stash|reset|restore|switch|fetch|tag|show|rm|mv|clean|rebase|apply|am)\b/i

/** 新一轮对应的消息锚点（一个用户消息/steering 算新一轮）。 */
const USER_TURN_SELECTOR = '[data-chat-anchor-key][data-chat-flow-kind="user"], [data-chat-anchor-key][data-chat-flow-kind="steering"]'
/** 对话滚动容器（会话切换时宿主重建）。 */
const SCROLL_SELECTOR = '[data-conversation-scroll]'
/** 启动/会话切换后的稳定窗口：期间不触发（避开历史批量挂载）。 */
const SETTLE_MS = 3000
/** 工具行触发后等待 last-turn 快照非空的最大重试次数（反应臂轮末发布延迟）。 */
const LAST_TURN_WAIT_MAX = 6

/** 本轮是否已自动展开过（检测到新一轮 user 消息时重置）。 */
let expandedThisTurn = false
/** 用户手动收起后置 true，直到用户手动打开或切换会话。 */
let dismissed = false
/** 模块启动时间（启动后 SETTLE_MS 内不触发）。 */
let startedAt = 0
/** 会话切换时间（重建滚动容器后 SETTLE_MS 内不触发）。 */
let sessionSettledAt = 0

/** 判断某工具行是否应该触发自动展开。 */
function shouldTriggerToolRow(row: HTMLElement): boolean {
  if (row.matches(FILE_TOOL_SELECTOR) || row.matches(GIT_TOOL_SELECTOR)) return true
  if (row.matches(BASH_TOOL_SELECTOR)) {
    const summary = row.querySelector<HTMLElement>('[class*="summary"]')?.textContent ?? row.textContent ?? ''
    if (GIT_COMMAND_RE.test(summary)) return true
  }
  const tool = row.getAttribute('data-tool') ?? ''
  return tool !== '' && /^(apply_patch|str_replace_editor)$/i.test(tool)
}

/** 在新增节点子树里找工具行（含节点自身）。 */
function findToolRow(root: Node): HTMLElement | null {
  if (root instanceof HTMLElement) {
    if (shouldTriggerToolRow(root)) return root
    const inner = root.querySelector<HTMLElement>(
      FILE_TOOL_SELECTOR + ', ' + GIT_TOOL_SELECTOR + ', ' + BASH_TOOL_SELECTOR,
    )
    if (inner !== null && shouldTriggerToolRow(inner)) return inner
  }
  return null
}

/** 新增的 user 锚点是否消息流里的最后一条（最新一轮；历史批量挂载的不是）。 */
function isNewestAnchor(node: HTMLElement): boolean {
  const flow = node.parentElement
  if (flow === null || !flow.matches('[data-chat-flow]')) return false
  const anchors = flow.querySelectorAll<HTMLElement>(':scope > [data-chat-anchor-key]')
  const last = anchors[anchors.length - 1]
  return last === node
}

/** 发送展开请求。 */
function requestOpen(tab: SidePaneTabType): void {
  window.dispatchEvent(new CustomEvent<AutoOpenDetailsDetail>(AUTO_OPEN_DETAILS_EVENT, { detail: { tab } }))
}

/**
 * 启动对话流观察。
 * @returns 清理函数（卸载观察器与监听器）。
 */
export function startAutoOpenDetails(): () => void {
  startedAt = Date.now()

  let raf = 0
  let pending = false
  let scrollReplaced = false
  /** 当前 pending 等待 last-turn 快照非空的重试计数（每次 tool 行触发重置）。 */
  let lastTurnWaitTicks = 0

  const tick = (): void => {
    raf = 0
    const now = Date.now()
    // 稳定窗口内不触发（启动初期 / 会话切换后的历史批量挂载期）。
    if (now - startedAt < SETTLE_MS || now - sessionSettledAt < SETTLE_MS) return
    if (dismissed || expandedThisTurn) return
    if (pending) {
      // 只在实际产生了上一轮文件变更时才驱动：last-turn 快照为空说明
      // 本轮工具行没有落成任何文件写入（只 read/status/失败/撤销），不应
      // 展开审查。快照在轮末才发布，这里短间隔重试等待（最多 lastTurnWaitTicks
      // 次），到了为空则放弃本次 pending——不把「本轮已展开」标记掉，后续
      // 真有写入时仍可驱动。
      if (getLastTurnChanges().length === 0) {
        if (lastTurnWaitTicks < LAST_TURN_WAIT_MAX) {
          lastTurnWaitTicks += 1
          schedule()
        } else {
          lastTurnWaitTicks = 0
          pending = false
        }
        return
      }
      lastTurnWaitTicks = 0
      pending = false
      expandedThisTurn = true
      requestOpen('git')
    }
  }
  const schedule = (): void => {
    if (raf === 0) raf = requestAnimationFrame(tick)
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // 滚动容器被替换 → 会话切换（宿主重建消息列）：重置轮次与抑制。
      for (const node of mutation.removedNodes) {
        if (node instanceof HTMLElement && node.matches(SCROLL_SELECTOR)) scrollReplaced = true
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.matches(SCROLL_SELECTOR)) scrollReplaced = true
        // 最新一条 user/steering 锚点 = 新一轮：重置「本轮已展开」
        // （锚点可能在新增容器子树里——宿主整段对话流重挂时）。
        const userAnchor = node.matches(USER_TURN_SELECTOR)
          ? node
          : node.querySelector<HTMLElement>(USER_TURN_SELECTOR)
        if (userAnchor !== null && isNewestAnchor(userAnchor)) expandedThisTurn = false
        // 工具行 → 收集触发（新触发重置 last-turn 等待计数）。
        if (findToolRow(node) !== null) {
          pending = true
          lastTurnWaitTicks = 0
        }
      }
    }
    if (scrollReplaced) {
      scrollReplaced = false
      expandedThisTurn = false
      dismissed = false
      sessionSettledAt = Date.now()
      pending = false
      lastTurnWaitTicks = 0
    }
    if (pending || scrollReplaced) schedule()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // 用户手动开合（PREVIEW_TOGGLE_EVENT 只由手动路径 dispatch）：延迟读面板
  // rect 判断开/关（details 列带 ~200ms CSS 过渡，等过渡落定再判定）。
  let toggleTimer = 0
  const onToggle = (): void => {
    window.clearTimeout(toggleTimer)
    toggleTimer = window.setTimeout(() => {
      const panel = document.querySelector<HTMLElement>('[data-preview-panel]')
      const width = panel?.getBoundingClientRect().width ?? 0
      if (width > 1) dismissed = false
      else dismissed = true
    }, 250)
  }
  window.addEventListener(PREVIEW_TOGGLE_EVENT, onToggle)

  return () => {
    observer.disconnect()
    window.removeEventListener(PREVIEW_TOGGLE_EVENT, onToggle)
    window.clearTimeout(toggleTimer)
    if (raf !== 0) cancelAnimationFrame(raf)
  }
}
