/**
 * 会话标记（进行中 / 待办 / 已完成）—— 浏览器侧覆盖层，不改官方代码。
 *
 * marker 存 localStorage（key 与官方 session-markers 一致，数据互通）。
 * 图标经 MutationObserver + 订阅注入到会话行标题后：React 重渲染会清掉
 * 注入节点，故每次列表 / marker 变化后重新装饰（element-card 同款模式）。
 * 反查 sessionId 复用 session-rename.ts 的 resolveSessionId（标题匹配折中）。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { resolveSessionId, locateTitleSpan } from './session-rename.ts'

export type SessionMarker = 'in-progress' | 'todo' | 'done'

const STORAGE_KEY = 'dsh:session-markers'
const MARKERS: readonly SessionMarker[] = ['in-progress', 'todo', 'done']

/** 本地化标签（liuli 主题面向中文；标题/菜单共用）。 */
export const MARKER_LABEL: Record<SessionMarker, string> = {
  'in-progress': '进行中',
  'todo': '待办',
  'done': '已完成',
}

const MARKER_COLOR: Record<SessionMarker, string> = {
  'in-progress': 'var(--dsw-alias-state-business-primary)',
  'todo': 'var(--dsw-alias-state-warn-primary)',
  'done': 'var(--dsw-alias-state-success-primary)',
}

const MARKER_SVG: Record<SessionMarker, string> = {
  'in-progress': '<svg viewBox="0 -960 960 960" width="14" height="14" fill="none" aria-hidden="true"><path d="m620.78-284.74 54.61-53.48-156.17-157.3v-195.22h-72.44v224.75l174 181.25ZM480.08-65.87q-85.47 0-160.94-32.55-75.48-32.56-131.81-88.87T98.44-319.04q-32.57-75.44-32.57-160.9 0-85.45 32.68-160.99 32.67-75.53 88.83-131.69t131.64-89.12Q394.5-894.7 480-894.7q85.5 0 160.98 32.96 75.48 32.96 131.64 89.12 56.16 56.16 89.12 131.64Q894.7-565.5 894.7-480q0 85.5-32.96 160.98-32.96 75.48-89.12 131.64-56.16 56.16-131.61 88.83-75.46 32.68-160.93 32.68ZM480-480Zm-.29 334.91q138.03 0 236.62-98.02 98.58-98.02 98.58-236.61 0-138.58-98.51-236.89-98.51-98.3-236.39-98.3-138.31 0-236.62 98.23-98.3 98.24-98.3 236.68 0 138.87 98.3 236.89 98.3 98.02 236.32 98.02Z" fill="currentColor"/></svg>',
  'todo': '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 8l1.5 1.5L10.5 6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'done': '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="currentColor"/><path d="M5.2 8.2l1.8 1.8 3.8-4" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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
  Object.assign(icon.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: '6px',
    flex: 'none',
    color: MARKER_COLOR[marker],
  } as Partial<CSSStyleDeclaration>)
  icon.innerHTML = MARKER_SVG[marker]
  span.after(icon)
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
