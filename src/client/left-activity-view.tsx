/**
 * Left sidebar Activity view.
 *
 * The official sidebar exposes the entire WorkspaceBrowser as a single slot;
 * it has no view-switching child slot. Keep that official browser mounted and
 * add a small view switch to its header. The Activity list consumes official
 * session/status stores and opens sessions through uiWorkspace.
 */
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import type { ObservableSnapshot, SessionId, SessionListState } from './compat.ts'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import css from './LeftActivityView.module.css'

type View = 'workspaces' | 'activity'
type ActivityKind = 'attention' | 'running' | 'completed' | 'idle'

export interface LeftActivityHost {
  sessions: ObservableSnapshot<SessionListState>
  statuses: ObservableSnapshot<SessionStatusSnapshot>
  archived: ObservableSnapshot<readonly string[]>
  openSession: (id: SessionId) => void
}

function useSnapshot<T>(source: ObservableSnapshot<T>): T {
  const [snapshot, setSnapshot] = useState(() => source.getSnapshot())
  useEffect(() => {
    setSnapshot(source.getSnapshot())
    return source.subscribe(() => { setSnapshot(source.getSnapshot()) })
  }, [source])
  return snapshot
}

function Glyph({ name }: { name: 'workspaces' | 'activity' | ActivityKind }) {
  // Material Symbols paths; currentColor follows Liuli's dynamic theme.
  const paths = {
    workspaces: 'M10 4H2c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h20c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2H12l-2-2z',
    activity: 'M13 2 3 14h7l-1 8 12-14h-7l1-6h-2z',
    attention: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z',
    running: 'M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8V2zm1 3h-2v8l6 3 1-1.7-5-2.5V5z',
    completed: 'M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm-1 15-5-5 1.4-1.4L11 14.2l5.6-5.6L18 10l-7 7z',
    idle: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6l-4 3V6a2 2 0 0 1 2-2zm0 2v13l1.3-1H20V6H4z',
  } satisfies Record<string, string>
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d={paths[name]} /></svg>
}

interface ActivityItem { id: SessionId; title: string; cwd: string | undefined; updatedAt: number; kind: ActivityKind }

interface DateGroup { key: string; label: string; items: ActivityItem[] }

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateGroupLabel(date: Date, today: Date, yesterday: Date): string {
  const key = localDateKey(date)
  if (key === localDateKey(today)) return '今天'
  if (key === localDateKey(yesterday)) return '昨天'
  return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`
}

const kindLabel: Record<ActivityKind, string> = {
  attention: '需要处理',
  running: '进行中',
  completed: '刚完成',
  idle: '',
}

function currentWorkspace(cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined
  const trimmed = cwd.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed
}

function formatAge(timestamp: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} 小时前` : `${Math.floor(hours / 24)} 天前`
}

function ActivityPanel({ host }: { host: LeftActivityHost }) {
  const list = useSnapshot(host.sessions)
  const statuses = useSnapshot(host.statuses)
  const archived = useSnapshot(host.archived)
  const groups = useMemo(() => {
    const hidden = new Set(archived)
    const rows: ActivityItem[] = []
    for (const id of list.ids) {
      if (hidden.has(id)) continue
      const row = list.byId[id]
      if (row === undefined) continue
      const status = statuses.get(id)
      const kind: ActivityKind = status?.pendingInteraction !== undefined
        ? 'attention'
        : (status?.running ?? row.running)
          ? 'running'
          : status?.completionUnread === true ? 'completed' : 'idle'
      rows.push({ id, title: row.displayTitle || row.title || String(id), cwd: row.cwd, updatedAt: row.updatedAt, kind })
    }
    // The host's updatedAt is the authoritative latest-activity timestamp.
    // Status affects only each row's marker, never order or inclusion.
    rows.sort((a, b) => b.updatedAt - a.updatedAt || String(a.id).localeCompare(String(b.id)))
    const today = new Date()
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
    const byDate = new Map<string, DateGroup>()
    for (const item of rows) {
      const date = new Date(item.updatedAt)
      const key = localDateKey(date)
      let group = byDate.get(key)
      if (group === undefined) {
        group = { key, label: dateGroupLabel(date, today, yesterday), items: [] }
        byDate.set(key, group)
      }
      group.items.push(item)
    }
    return [...byDate.values()]
  }, [list, statuses, archived])

  return <div className={css.panel} role="region" aria-label="活动会话">
    {groups.length === 0
      ? <div className={css.empty}><Glyph name="activity" /><span>还没有会话</span></div>
      : groups.map(group => <section key={group.key} className={css.section} aria-label={group.label}>
        <div className={css.dateTitle}>{group.label}</div>
        {group.items.map(item => <button key={item.id} type="button" className={css.row} onClick={() => { host.openSession(item.id) }} title={item.title}>
          <span className={`${css.statusIcon} ${css[item.kind]}`}><Glyph name={item.kind} /></span>
          <span className={css.rowText}><span className={css.rowTitle}>{item.title}</span><span className={css.rowMeta}>{kindLabel[item.kind] && <><span className={css.statusLabel}>{kindLabel[item.kind]}</span><span aria-hidden="true"> · </span></>}{currentWorkspace(item.cwd) ?? '会话'} · {formatAge(item.updatedAt)}</span></span>
        </button>)}
      </section>)}
  </div>
}

function ActivityView({ host, browser, panelSeat }: { host: LeftActivityHost; browser: HTMLElement; panelSeat: HTMLElement }) {
  const [view, setView] = useState<View>('workspaces')
  useEffect(() => {
    browser.dataset.liuliActivityView = view
    return () => { delete browser.dataset.liuliActivityView }
  }, [browser, view])
  return <>
    <div className={css.tabs} role="group" aria-label="左侧边栏视图">
      <button type="button" aria-pressed={view === 'workspaces'} className={view === 'workspaces' ? css.tabActive : css.tab} onClick={() => { setView('workspaces') }}><Glyph name="workspaces" /><span>会话</span></button>
      <button type="button" aria-pressed={view === 'activity'} className={view === 'activity' ? css.tabActive : css.tab} onClick={() => { setView('activity') }}><Glyph name="activity" /><span>活动</span></button>
    </div>
    {view === 'activity' && createPortal(<ActivityPanel host={host} />, panelSeat)}
  </>
}

/** Start the left-side view switch without replacing the official WorkspaceBrowser. */
export function startLeftActivityView(host: LeftActivityHost): () => void {
  let mounted: { browser: HTMLElement; header: HTMLElement; listArea: HTMLElement; anchor: HTMLElement; panelSeat: HTMLElement; root: Root; childrenObserver: MutationObserver } | undefined
  let finderObserver: MutationObserver | undefined
  let parentObserver: MutationObserver | undefined

  const findBrowser = (): { browser: HTMLElement; header: HTMLElement; listArea: HTMLElement } | undefined => {
    for (const header of document.querySelectorAll<HTMLElement>('[class*="_sectionHeader"]')) {
      const browser = header.parentElement
      const listArea = browser?.querySelector<HTMLElement>(':scope > [class*="_listArea"]')
      if (browser !== null && browser !== undefined && listArea !== null && listArea !== undefined) return { browser, header, listArea }
    }
    return undefined
  }

  const mount = (): void => {
    const found = findBrowser()
    if (found === undefined || (found.browser === mounted?.browser && found.header === mounted.header && found.listArea === mounted.listArea)) return
    if (mounted !== undefined) {
      mounted.childrenObserver.disconnect()
      mounted.root.unmount()
      mounted.anchor.remove()
      mounted.panelSeat.remove()
      delete mounted.browser.dataset.liuliActivityView
    }
    const anchor = document.createElement('span')
    anchor.dataset.liuliActivityTabs = ''
    const panelSeat = document.createElement('div')
    panelSeat.dataset.liuliActivityPanel = ''
    found.header.prepend(anchor)
    found.listArea.append(panelSeat)
    const root = createRoot(anchor)
    root.render(<ActivityView host={host} browser={found.browser} panelSeat={panelSeat} />)
    const childrenObserver = new MutationObserver(() => {
      if (found.header.parentElement !== found.browser || found.listArea.parentElement !== found.browser) {
        mount()
        return
      }
      // The official browser owns these parents. Reattach only if one of its
      // rerenders replaced our independent mount nodes.
      if (anchor.parentElement !== found.header) found.header.prepend(anchor)
      if (panelSeat.parentElement !== found.listArea) found.listArea.append(panelSeat)
    })
    childrenObserver.observe(found.browser, { childList: true })
    childrenObserver.observe(found.header, { childList: true })
    childrenObserver.observe(found.listArea, { childList: true })
    mounted = { ...found, anchor, panelSeat, root, childrenObserver }
    finderObserver?.disconnect()
    finderObserver = undefined
    parentObserver?.disconnect()
    if (found.browser.parentElement !== null) {
      parentObserver = new MutationObserver(() => {
        if (!found.browser.isConnected) {
          parentObserver?.disconnect()
          parentObserver = undefined
          finderObserver = new MutationObserver(mount)
          finderObserver.observe(document.body, { childList: true, subtree: true })
          mount()
        }
      })
      parentObserver.observe(found.browser.parentElement, { childList: true })
    }
  }

  if (document.body !== null) {
    finderObserver = new MutationObserver(mount)
    finderObserver.observe(document.body, { childList: true, subtree: true })
    mount()
  }
  return () => {
    finderObserver?.disconnect()
    parentObserver?.disconnect()
    if (mounted !== undefined) {
      mounted.childrenObserver.disconnect()
      mounted.root.unmount()
      mounted.anchor.remove()
      mounted.panelSeat.remove()
      delete mounted.browser.dataset.liuliActivityView
    }
  }
}
