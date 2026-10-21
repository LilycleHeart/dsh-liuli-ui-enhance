/**
 * Grouping rules for the left sidebar's Activity view.
 *
 * The panel is a flat "latest activity first" list, so the shape users read is
 * entirely decided here: sessions that still owe the user something stay pinned
 * on top, everything else is cut into natural days (今天 / 昨天 / 前天 / 日期).
 * Kept free of React and CSS so the ordering rules stay unit-testable.
 */

export type ActivityKind = 'attention' | 'running' | 'completed' | 'idle'

/** Minimum shape the grouping reads; the panel's rows carry more fields. */
export interface ActivityEntryLike {
  id: string
  updatedAt: number
  kind: ActivityKind
}

export interface ActivityGroup<T> {
  /** `active` for the pinned block, otherwise the local calendar day key. */
  key: string
  label: string
  items: T[]
}

/** Sessions still waiting on the user or still running float above every date group. */
export const activeKinds: ReadonlySet<ActivityKind> = new Set<ActivityKind>(['attention', 'running'])

/** Waiting on the user outranks running; ties fall back to the newest activity. */
const kindRank: Record<ActivityKind, number> = { attention: 0, running: 1, completed: 2, idle: 3 }

/** Local calendar day key (`YYYY-MM-DD`), never a UTC one. */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Whole-day index in the local calendar: groups are cut by date, never by elapsed hours. */
function dayIndex(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

export function dateGroupLabel(date: Date, today: Date): string {
  const offset = dayIndex(today) - dayIndex(date)
  if (offset === 0) return '今天'
  if (offset === 1) return '昨天'
  if (offset === 2) return '前天'
  if (date.getFullYear() !== today.getFullYear()) {
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
  }
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

function compareIds(left: { id: string }, right: { id: string }): number {
  return String(left.id).localeCompare(String(right.id))
}

/**
 * Build the panel's sections.
 *
 * - Active entries (需要处理 / 进行中) form one pinned group above the dates,
 *   ordered attention-first so the oldest unanswered turn is not buried.
 * - Everything else keeps the newest-first order and is cut into one group per
 *   local day, so an entry never leaks into a neighbouring date.
 */
export function groupActivities<T extends ActivityEntryLike>(entries: readonly T[], now: number = Date.now()): Array<ActivityGroup<T>> {
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt || compareIds(a, b))
  const active: T[] = []
  const settled: T[] = []
  for (const item of sorted) (activeKinds.has(item.kind) ? active : settled).push(item)
  active.sort((a, b) => kindRank[a.kind] - kindRank[b.kind] || b.updatedAt - a.updatedAt || compareIds(a, b))

  const today = new Date(now)
  const byDate = new Map<string, ActivityGroup<T>>()
  for (const item of settled) {
    const date = new Date(item.updatedAt)
    const key = localDateKey(date)
    let group = byDate.get(key)
    if (group === undefined) {
      group = { key, label: dateGroupLabel(date, today), items: [] }
      byDate.set(key, group)
    }
    group.items.push(item)
  }
  // settled is newest-first, so the date groups are already newest-first too.
  const groups: Array<ActivityGroup<T>> = [...byDate.values()]
  if (active.length > 0) groups.unshift({ key: 'active', label: '活跃', items: active })
  return groups
}
