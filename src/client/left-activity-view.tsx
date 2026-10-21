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
import { relativeTime, StateDot, type RelativeTimeUnit } from '@deepseek-ai/dsh-client-ui-primitives'
import { groupActivities, type ActivityKind } from './activity-grouping.ts'
import css from './LeftActivityView.module.css'

type View = 'workspaces' | 'activity'

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

function Glyph({ name }: { name: 'workspaces' | 'activity' }) {
  // Material Symbols paths; currentColor follows Liuli's dynamic theme.
  const paths = {
    workspaces: 'M10 4H2c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h20c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2H12l-2-2z',
    activity: 'M13 2 3 14h7l-1 8 12-14h-7l1-6h-2z',
  } satisfies Record<string, string>
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d={paths[name]} /></svg>
}

interface ActivityItem { id: SessionId; title: string; updatedAt: number; kind: ActivityKind }

/** Row status rides on the official state dot, exactly like the official session row. */
const dotState: Record<ActivityKind, 'warning' | 'ongoing' | 'done' | 'idle'> = {
  attention: 'warning',
  running: 'ongoing',
  completed: 'done',
  idle: 'idle',
}

/** Official relative-time words (ui-workspace zh dictionary) so both lists read the same. */
const timeWords: Record<RelativeTimeUnit, (n: number) => string> = {
  now: () => '刚刚',
  minutes: n => `${n}分钟`,
  hours: n => `${n}小时`,
  days: n => `${n}天`,
  months: n => `${n}个月`,
  years: n => `${n}年`,
}

function rowTimeLabel(timestamp: number): string {
  const { unit, n } = relativeTime(timestamp, Date.now())
  return timeWords[unit](n)
}

interface RowSkin { row: string; slot: string | undefined; title: string | undefined; time: string | undefined }

function pickClass(element: Element | null, suffix: string): string | undefined {
  if (element === null) return undefined
  for (const name of element.classList) {
    if (name.endsWith(`_${suffix}`)) return name
  }
  return undefined
}

/**
 * Official session-row class names (e.g. `hIlkoa_sessionRow`, stable within one
 * client build). The Activity list reuses the official row/slot/title/time
 * classes instead of inventing its own session styling, so height, padding,
 * hover and the state dot come from the same CSS the sidebar uses. When the
 * official list has not rendered yet, fall back to this module's look-alike.
 */
function readRowSkin(): RowSkin | undefined {
  const row = document.querySelector<HTMLElement>('[data-row-key^="session:"]:not([data-liuli-activity-row])')
  if (row === null) return undefined
  const rowClass = pickClass(row, 'sessionRow')
  if (rowClass === undefined) return undefined
  return {
    row: rowClass,
    slot: pickClass(row.querySelector('[class*="_slot"]'), 'slot') ?? css.slot,
    title: pickClass(row.querySelector('[class*="_title"]'), 'title') ?? css.title,
    time: pickClass(row.querySelector('[class*="_time"]'), 'time') ?? css.time,
  }
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
      rows.push({ id, title: row.displayTitle || row.title || String(id), updatedAt: row.updatedAt, kind })
    }
    // The host's updatedAt is the authoritative latest-activity timestamp; the
    // pinned-active block and the 今天/昨天/前天 day groups live in the grouping
    // module so the ordering rules stay testable without React.
    return groupActivities(rows)
  }, [list, statuses, archived])
  // Re-read the official row classes whenever the sidebar list changes shape.
  const skin = useMemo(() => readRowSkin(), [list, statuses, archived])

  return <div className={css.panel} role="tree" aria-label="活动会话">
    {groups.length === 0
      ? <div className={css.empty}><Glyph name="activity" /><span>还没有会话</span></div>
      : groups.map(group => <section key={group.key} role="group" className={group.key === 'active' ? `${css.section} ${css.activeSection}` : css.section} aria-label={group.label}>
        <div className={group.key === 'active' ? `${css.dateTitle} ${css.activeTitle}` : css.dateTitle} aria-hidden="true">{group.label}</div>
        {group.items.map(item => <div
          key={item.id}
          role="treeitem"
          aria-selected={false}
          data-liuli-activity-row=""
          data-row-key={`session:${item.id}`}
          tabIndex={0}
          title={item.title}
          className={skin?.row ?? css.row}
          onClick={() => { host.openSession(item.id) }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            host.openSession(item.id)
          }}
        >
          <span className={skin?.slot ?? css.slot}><StateDot state={dotState[item.kind]} /></span>
          <span className={skin?.title ?? css.title}>{item.title}</span>
          <span className={skin?.time ?? css.time}>{rowTimeLabel(item.updatedAt)}</span>
        </div>)}
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
