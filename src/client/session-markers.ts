/**
 * 会话标记（进行中 / 待办 / 已完成）—— 浏览器侧覆盖层，不改官方代码。
 *
 * marker 存 localStorage（key 与官方 session-markers 一致，数据互通）。
 * 图标经 MutationObserver + 订阅注入到会话行标题后：React 重渲染会清掉
 * 注入节点，故每次列表 / marker 变化后重新装饰（element-card 同款模式）。
 * 反查 sessionId 复用 session-rename.ts 的 resolveSessionId（标题匹配折中）。
 */
import type { ClientContext } from './compat.ts'
import { resolveSessionId, locateTitleSpan } from './session-rename.ts'
import { ICONS } from './menu-icons.ts'

export type SessionMarker = 'in-progress' | 'todo' | 'done'

const STORAGE_KEY = 'dsh:session-markers'
const MARKERS: readonly SessionMarker[] = ['in-progress', 'todo', 'done']

/** 本地化标签（liuli 主题面向中文；标题/菜单共用）。 */
export const MARKER_LABEL: Record<SessionMarker, string> = {
  'in-progress': '进行中',
  'todo': '待办',
  'done': '已完成',
}

export const MARKER_COLOR: Record<SessionMarker, string> = {
  'in-progress': 'var(--dsw-alias-brand-primary)',
  'todo': 'var(--dsw-alias-brand-primary)',
  'done': 'var(--dsw-alias-brand-primary)',
}

/** 菜单与行内装饰共用同一套图标，避免右键菜单预览与添加后的实际样式不一致。 */
export const MARKER_ICON: Record<SessionMarker, string> = {
  'in-progress': ICONS.loading,
  'todo': ICONS.checklist,
  'done': ICONS.check,
}

// ── marker store（localStorage，非 React） ──
let cache: Record<string, SessionMarker> | null = null
const listeners = new Set<() => void>()

function load(): Record<string, SessionMarker> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    const out: Record<string, SessionMarker> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if ((MARKERS as readonly string[]).includes(v as string)) out[k] = v as SessionMarker
    }
    return out
  } catch { return {} }
}

export function getSessionMarker(id: string): SessionMarker | undefined {
  if (cache === null) cache = load()
  return cache[id]
}

export function setSessionMarker(id: string, marker: SessionMarker): void {
  if (cache === null) cache = load()
  cache = { ...cache, [id]: marker }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)) } catch { /* 隐私模式 / 配额不足：内存态仍生效 */ }
  for (const fn of listeners) fn()
}

/** 读取全部标记（快照副本；Host 端同步 /liuli-settings 时使用）。 */
export function readAllSessionMarkers(): Record<string, SessionMarker> {
  if (cache === null) cache = load()
  return { ...cache }
}

/** 用 Host 端恢复的标记整体替换本地存储（过滤非法值，通知装饰刷新）。 */
export function hydrateSessionMarkers(map: Record<string, unknown>): void {
  const out: Record<string, SessionMarker> = {}
  for (const [k, v] of Object.entries(map)) {
    if ((MARKERS as readonly string[]).includes(v as string)) out[k] = v as SessionMarker
  }
  cache = out
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cache)) } catch { /* 同上 */ }
  for (const fn of listeners) fn()
}

export function subscribeSessionMarkers(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

// ── 图标装饰 ──
function applyMarkerIcon(row: HTMLElement, marker: SessionMarker | undefined, title: string): void {
  const existing = row.querySelector<HTMLElement>('[data-liuli-marker]')
  const existingMarker = existing?.getAttribute('data-liuli-marker')
  // 幂等：marker 未变则不动，避免注入本身触发 MutationObserver 造成循环。
  if (existingMarker === marker) return
  existing?.remove()
  if (marker === undefined) return
  const span = title !== '' ? locateTitleSpan(row, title) : null
  if (span === null) return
  const icon = document.createElement('span')
  icon.setAttribute('data-liuli-marker', marker)
  icon.setAttribute('aria-label', MARKER_LABEL[marker])
  icon.title = MARKER_LABEL[marker]
  // 时间列固定宽度后，标记插在时间左侧的位置就不会随时间文字长短变化，也不会和标题重叠。
  const timeEl = span.nextElementSibling as HTMLElement | null
  if (timeEl !== null) {
    timeEl.style.minWidth = '32px'
    timeEl.style.textAlign = 'right'
    timeEl.style.boxSizing = 'border-box'
  }
  Object.assign(icon.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: '6px',
    marginRight: '4px',
    flex: 'none',
    verticalAlign: 'middle',
    color: MARKER_COLOR[marker],
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>)
  icon.innerHTML = MARKER_ICON[marker]
  if (timeEl !== null) timeEl.before(icon)
  else span.after(icon)
}

function decorateAll(ctx: Pick<ClientContext, 'sessions'>): void {
  const snap = ctx.sessions.list.getSnapshot()
  const rows = document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-selected]')
  for (const row of Array.from(rows)) {
    const id = resolveSessionId(ctx, row)
    const marker = id === undefined ? undefined : getSessionMarker(id)
    const title = id !== undefined ? (snap.byId[id]?.displayTitle ?? '') : ''
    applyMarkerIcon(row, marker, title)
  }
}

/**
 * 启动会话标记图标装饰。
 * @param ctx - 客户端 cordis 上下文（只需 sessions 面）。
 * @returns dispose。
 */
export function startSessionMarkerDecoration(ctx: Pick<ClientContext, 'sessions'>): () => void {
  let raf = 0
  const schedule = (): void => {
    if (raf !== 0) return
    raf = requestAnimationFrame(() => {
      raf = 0
      decorateAll(ctx)
    })
  }
  const mo = new MutationObserver(schedule)
  mo.observe(document.body, { childList: true, subtree: true })
  const unsubMarker = subscribeSessionMarkers(schedule)
  const unsubSessions = ctx.sessions.list.subscribe(schedule)
  schedule()
  return () => {
    mo.disconnect()
    unsubMarker()
    unsubSessions()
    if (raf !== 0) cancelAnimationFrame(raf)
  }
}
