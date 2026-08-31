/**
 * 审查（文件审查）事件总线。
 *
 * 轮次结束卡片（TurnFileCard）的「审查」按钮与右侧边栏审查面板
 * （FileReviewPanel / PreviewDetailsPanel）之间的事件通道：
 * - 卡片 dispatch 事件，侧栏面板订阅并选中文件；
 * - 事件为一次性请求，面板晚挂载时经模块级 pending 兜底消费，
 *   避免「先发事件、后开面板」丢请求。
 */

import type { SidebarGitSourceId } from './right-sidebar-api.ts'

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

/** 事件名：驱动审查面板切换来源并展开目标（LLM 活动自动展开 → dock 审查面板）。 */
export const REVIEW_DRIVE_EVENT = 'liuli:review-drive'

/** 驱动请求载荷。 */
export interface ReviewDriveDetail {
  /** 目标会话 id；缺省/不匹配时面板忽略。 */
  sessionId?: string
  /** 强制切换到的来源（auto-open-details 驱动时为 'last-turn' 上一轮更改）。 */
  source: SidebarGitSourceId
  /** 要展开的文件（相对会话 cwd）；缺省展开当前来源第一个修改文件。 */
  path?: string
}

interface PendingDrive {
  readonly sessionId: string | undefined
  readonly source: SidebarGitSourceId
  readonly path: string | undefined
  readonly at: number
}

/** 驱动请求的有效期：过期后（如很久之后才挂载的新面板）不再消费，避免误驱动。 */
const DRIVE_TTL_MS = 30_000

let pendingDrive: PendingDrive | null = null

/** 广播一次驱动请求，并记录 pending 供晚挂载的 dock 审查面板消费。 */
export function requestReviewDrive(detail: ReviewDriveDetail): void {
  pendingDrive = { sessionId: detail.sessionId, source: detail.source, path: detail.path, at: Date.now() }
  window.dispatchEvent(new CustomEvent<ReviewDriveDetail>(REVIEW_DRIVE_EVENT, { detail }))
}

/** 面板挂载时消费最近一次驱动请求（无记录/已过期时返回 null）。 */
export function consumeReviewDrive(): PendingDrive | null {
  if (pendingDrive === null) return null
  if (Date.now() - pendingDrive.at > DRIVE_TTL_MS) return null
  return pendingDrive
}
