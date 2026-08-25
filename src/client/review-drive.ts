/**
 * 审查驱动请求（auto-open-details → 审查文件面板）的纯逻辑。
 *
 * 宿主面板（PreviewDetailsPanel）驱动打开「审查文件」标签时，下发一个驱动请求：
 * 强制切换来源（上一轮更改）并展开目标文件。目标文件的解析逻辑抽成纯函数，
 * 便于 Node 直接跑单测（demo/test-auto-drive.ts）。
 */
import type { SidebarGitChange, SidebarGitSourceId } from './right-sidebar-api.ts'

/** 宿主面板驱动的审查请求（LLM 活动驱动）：强制切换来源并展开目标文件。 */
export interface ReviewDriveRequest {
  /** 请求序号（每次驱动递增，React 才能识别同一文件的重复请求）。 */
  nonce: number
  /** 强制切换到的来源（auto-open-details 驱动时为 'last-turn' 上一轮更改）。 */
  source: SidebarGitSourceId
  /** 要展开的文件（相对会话 cwd）；缺省时展开当前来源第一个修改文件。 */
  path?: string
}

/** 轮次卡片「审查」按钮的定位请求（无 source：由面板找包含该文件的源）。 */
export interface ReviewPathRequest {
  nonce: number
  /** 相对会话 cwd 的文件路径。 */
  path: string
}

/** 审查面板收到的宿主请求（可判别联合：有 source 走驱动分支，否则走定位分支）。 */
export type ReviewPanelRequest = ReviewDriveRequest | ReviewPathRequest

/** 驱动请求的目标文件解析：指定 path 且存在于快照时用 path，否则用第一个修改文件。 */
export function resolveDriveTarget(
  changes: readonly SidebarGitChange[],
  path: string | undefined,
): string | null {
  if (path !== undefined && changes.some(change => change.path === path)) return path
  return changes[0]?.path ?? null
}
