/**
 * 侧栏会话列表的日期分段（今天 / 昨天 / 前天 / 日期）—— 浏览器侧装饰，不改官方代码。
 *
 * 官方「视图选项 → 单列表 + 最近更新」本身就是一条按最后活动时间倒序的扁平列表，
 * 这里只在这条列表上补日期分隔标题；排序、置顶、右键菜单、行样式全部仍归官方。
 *
 * 注入节点是 React 之外的一次性 DOM（带 data-liuli-day-group）：官方重渲染把它清掉
 * 后补回，装饰本身幂等（内容没变就不写 DOM），避免 MutationObserver 自触发死循环。
 */
import type { ClientContext, SessionId } from './compat.ts'

const ROW_SELECTOR = '[role="treeitem"][data-row-key^="session:"]'
const GROUP_ATTR = 'data-liuli-day-group'

type Ctx = Pick<ClientContext, 'sessions' | 'workspaces'>

/** 分隔标题的内联样式：与官方分区标题同字号同色，不动行本身的排版。 */
const SEPARATOR_STYLE: Partial<CSSStyleDeclaration> = {
  margin: '6px 7px 2px',
  color: 'var(--dsw-alias-label-tertiary, #888)',
  fontSize: '11px',
  fontWeight: '600',
  lineHeight: '1.4',
  userSelect: 'none',
  pointerEvents: 'none',
}

function sessionIdOf(row: HTMLElement): string | undefined {
  const key = row.getAttribute('data-row-key')
  return key !== null && key.startsWith('session:') ? key.slice('session:'.length) : undefined
}

/** 本地自然日序号：按日历日切段，不按"距今多少小时"。 */
function dayIndex(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

function dayKey(updatedAt: number): string {
  const date = new Date(updatedAt)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayLabel(updatedAt: number, today: Date): string {
  const date = new Date(updatedAt)
  const offset = dayIndex(today) - dayIndex(date)
  if (offset === 0) return '今天'
  if (offset === 1) return '昨天'
  if (offset === 2) return '前天'
  if (date.getFullYear() !== today.getFullYear()) {
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
  }
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

/**
 * 只有按「最近更新」排的扁平列表才分段：跳过置顶行后，最后活动时间必须单调递减。
 * 手动排序或按工作区分组时时间序是乱的，此时保持原样、不插日期标题。
 */
function isTimeOrdered(
  rows: readonly HTMLElement[],
  updatedAtOf: (row: HTMLElement) => number | undefined,
  pinned: ReadonlySet<string>,
): boolean {
  let previous = Number.POSITIVE_INFINITY
  let compared = 0
  for (const row of rows) {
    const id = sessionIdOf(row)
    if (id === undefined || pinned.has(id)) continue
    const updatedAt = updatedAtOf(row)
    if (updatedAt === undefined) continue
    if (updatedAt > previous) return false
    previous = updatedAt
    compared += 1
  }
  return compared > 0
}

function decorate(ctx: Ctx): void {
  const sessions = ctx.sessions.list.getSnapshot()
  const pinned = new Set<string>(ctx.workspaces.list.getSnapshot().pinnedSessionIds.map(String))
  const today = new Date()
  const updatedAtOf = (row: HTMLElement): number | undefined => {
    const id = sessionIdOf(row)
    return id === undefined ? undefined : sessions.byId[id as SessionId]?.updatedAt
  }

  // 行的文档顺序就是官方列表顺序。不要按父容器切分：官方每一项各自包在容器里，
  // 按容器切会让每一行都变成自己那组的"第一行"，一天一个标题就退化成一行一个标题。
  const rows = Array.from(document.querySelectorAll<HTMLElement>(ROW_SELECTOR))
  const scope = rows[0]?.closest<HTMLElement>('[class*="_listArea"]') ?? document.body

  // 每行前面应该出现的分段标题；不在表里的行前面不应有标题。
  // 「单列表」下没有工作区行；按工作区分组的视图保持官方原样。
  const wanted = new Map<HTMLElement, { key: string; label: string }>()
  // 只看可见的工作区行：隐藏的分组节点不算「按工作区分组」。
  const groupedByWorkspace = Array.from(scope.querySelectorAll<HTMLElement>('[class*="_projectRow"]'))
    .some(element => element.getClientRects().length > 0)
  if (!groupedByWorkspace && isTimeOrdered(rows, updatedAtOf, pinned)) {
    let previousKey: string | undefined
    for (const row of rows) {
      const id = sessionIdOf(row)
      // 置顶区不属于时间序列：日期段从第一条普通会话开始，置顶行上方不插标题。
      if (id === undefined || pinned.has(id)) continue
      const updatedAt = updatedAtOf(row)
      if (updatedAt === undefined) continue
      const key = dayKey(updatedAt)
      if (key === previousKey) continue
      previousKey = key
      wanted.set(row, { key, label: dayLabel(updatedAt, today) })
    }
  }

  // 复用已有的分段标题（内容没变就不写 DOM），其余新建。
  const kept = new Set<HTMLElement>()
  for (const [row, spec] of wanted) {
    const previous = row.previousElementSibling
    if (previous instanceof HTMLElement && previous.getAttribute(GROUP_ATTR) === spec.key) {
      if (previous.textContent !== spec.label) previous.textContent = spec.label
      kept.add(previous)
      continue
    }
    const separator = document.createElement('div')
    separator.setAttribute(GROUP_ATTR, spec.key)
    separator.setAttribute('role', 'presentation')
    separator.textContent = spec.label
    Object.assign(separator.style, SEPARATOR_STYLE)
    row.before(separator)
    kept.add(separator)
  }
  // 不再需要的标题（日期变化、切回分组视图、列表清空）一并移除。
  for (const element of Array.from(document.querySelectorAll<HTMLElement>(`[${GROUP_ATTR}]`))) {
    if (!kept.has(element)) element.remove()
  }
}

/**
 * 启动侧栏会话日期分段。
 * @param ctx - 客户端 cordis 上下文（sessions 提供活动时间，workspaces 提供置顶集）。
 * @returns dispose。
 */
export function startSessionTimeGroups(ctx: Ctx): () => void {
  let frame = 0
  const schedule = (): void => {
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      decorate(ctx)
    })
  }
  const relevant = (node: Node): boolean => node instanceof Element
    && (node.matches(ROW_SELECTOR) || node.querySelector(ROW_SELECTOR) !== null || node.hasAttribute(GROUP_ATTR))
  const observer = new MutationObserver(records => {
    if (records.some(record =>
      Array.from(record.addedNodes).some(relevant)
      || Array.from(record.removedNodes).some(relevant)
      || (record.target instanceof Element && record.target.closest(ROW_SELECTOR) !== null))) schedule()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  const unsubscribeSessions = ctx.sessions.list.subscribe(schedule)
  const unsubscribeWorkspaces = ctx.workspaces.list.subscribe(schedule)
  schedule()
  return () => {
    observer.disconnect()
    unsubscribeSessions()
    unsubscribeWorkspaces()
    if (frame !== 0) cancelAnimationFrame(frame)
  }
}
