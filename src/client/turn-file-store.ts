/**
 * 上一轮文件更改（last-turn）的轻量共享存储。
 *
 * TurnFileCard 的 RoundSummaryCard 在渲染「本轮修改」卡片时，把聚合后的
 * 文件列表发布到这里；审查面板（FileReviewPanel）用它在「上一轮更改」
 * 源里展示与 参考实现 last-turn 语义一致的文件快照。
 */
import type { SidebarGitChange } from './right-sidebar-api.ts'

let lastTurnChanges: readonly SidebarGitChange[] = []
const listeners = new Set<() => void>()

/** 发布最新一轮的文件更改（路径为相对会话 cwd 的仓库内路径）。 */
export function setLastTurnChanges(changes: readonly SidebarGitChange[]): void {
  lastTurnChanges = changes
  for (const listener of listeners) listener()
}

/** 读取最新一轮的文件更改。 */
export function getLastTurnChanges(): readonly SidebarGitChange[] {
  return lastTurnChanges
}

/** 订阅最新一轮文件更改；返回退订函数。 */
export function subscribeLastTurnChanges(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
