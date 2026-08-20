/**
 * 审查（文件审查）事件总线。
 *
 * 轮次结束卡片（TurnFileCard）的「审查」按钮与右侧边栏审查面板
 * （FileReviewPanel / PreviewDetailsPanel）之间的事件通道：
 * - 卡片 dispatch 事件，侧栏面板订阅并选中文件；
 * - 事件为一次性请求，面板晚挂载时经模块级 pending 兜底消费，
 *   避免「先发事件、后开面板」丢请求。
 */

/** 事件名：请求在审查面板里打开某个文件。 */
export const REVIEW_FILE_EVENT = 'liuli:review-file'

/** 事件载荷。 */
export interface ReviewFileDetail {
  /** 目标会话 id；缺省/不匹配时面板忽略。 */
  sessionId?: string
  /** 相对会话 cwd 的文件路径。 */
  path: string
}

interface PendingReview {
  readonly path: string
  readonly at: number
}

let pendingReview: PendingReview | null = null

/** 广播一次审查请求，并记录 pending 供晚挂载的面板消费。 */
export function requestReviewFile(detail: ReviewFileDetail): void {
  pendingReview = { path: detail.path, at: Date.now() }
  window.dispatchEvent(new CustomEvent(REVIEW_FILE_EVENT, { detail }))
}

/** 面板挂载时消费最近一次审查请求（拿到即视为已处理）。 */
export function consumeReviewRequest(): PendingReview | null {
  return pendingReview
}
