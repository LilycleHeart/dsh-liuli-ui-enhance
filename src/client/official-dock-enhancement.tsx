import { Children, cloneElement, createElement, isValidElement, type ReactNode } from 'react'
import { canSplit, dockPaneCount, planDropTab, planSplitPane, planSettle, replay, record, type LayoutState, type History, type TabRecord, type TabId, type PaneId, type DockZone } from '@deepseek-ai/dsh-client-ui-dockkit'
import { getDockHostBridge } from './dock-shell-frame.tsx'
import { LIULI_LS_KEY, liuliSettingsOf } from '../liuli-settings.ts'

// rc.2 adapter: keep the official Tab domain/store and replace only its docking
// policy. This avoids nesting a complete official sidebar inside a Liuli tab.
type Props = Record<string, any>
type Surface = { layout: LayoutState; history: History; minted: number }
type Draft = { bySession: Record<string, Surface> }
const kinds: Record<string, string> = { 'liuli-review': 'git', 'liuli-files': 'files', 'liuli-terminal': 'terminal', 'liuli-code': 'code', 'liuli-browser': 'browser', 'liuli-side-chat': 'side-chat', 'liuli-developer-tools': 'developer-tools' }
const innerDisabled = () => {
  try { return liuliSettingsOf(JSON.parse(localStorage.getItem(LIULI_LS_KEY) ?? '{}')).sidebar_disable_inner_split }
  catch { return true }
}

export function enhanceOfficialDock(ctx: any): () => void {
  let enabled = true
  const disposers: Array<() => void> = []
  const patched = new Set<object>()
  const pointer = { x: 0, y: 0 }
  let draggedType: string | undefined
  let dragStart: { x: number; y: number } | undefined
  const move = (e: PointerEvent) => {
    pointer.x = e.clientX; pointer.y = e.clientY
    if (draggedType && dragStart && e.buttons && Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y) > 6)
      getDockHostBridge().previewPanelDrop?.(draggedType, e.clientX, e.clientY, innerDisabled())
  }
  const down = (e: PointerEvent) => {
    const el = e.target instanceof Element ? e.target.closest('[data-sidebar-right-tab]') : null
    const tabId = el?.getAttribute('data-sidebar-right-tab')
    const controller = ctx.get?.('sidebarRight')
    const sid = controller?.mounted?.getSnapshot?.()
    const tab = sid && controller.tabsIn?.(sid).find((t: TabRecord) => t.id === tabId)
    draggedType = tab ? kinds[tab.kind] : undefined
    dragStart = { x: e.clientX, y: e.clientY }
  }
  const up = () => { getDockHostBridge().clearPanelDrop?.(); draggedType = undefined; dragStart = undefined }
  window.addEventListener('pointermove', move, true)
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)

  const tryPatch = () => {
    for (const entry of ctx.slots.entries('rightbar.session') as Props[]) {
      if (patched.has(entry) || typeof entry.component !== 'function' || !entry.store?.spec?.actions?.dropTab) continue
      patched.add(entry)
      const reducers = entry.store.spec.actions
      const oldDrop = reducers.dropTab
      const oldSplit = reducers.splitPane
      const advance = (d: Draft, sid: string, make: (s: LayoutState, mint: any, seed: any) => readonly any[]) => {
        const surface = d.bySession[sid]
        if (!surface) return
        let used = surface.minted
        const mint = (prefix: string) => `${prefix}${++used}`
        const seed = (id: TabId): TabRecord => ({ id, kind: 'guide', contentId: 'sidebar://guide', title: '开始' })
        const ops = make(surface.layout, mint, seed)
        if (!ops.length) return
        const after = replay(surface.layout, ops)
        const settled = planSettle(after, mint as any, after.expanded ? seed : undefined)
        const next = record(surface.history, surface.layout, [...ops, ...settled])
        d.bySession[sid] = { layout: next.state, history: next.history, minted: used }
      }
      const drop = (d: Draft, sid: string, tab: TabId, pane: PaneId, zone: DockZone) => {
        if (!enabled || zone === 'center') return oldDrop(d, sid, tab, pane, zone)
        advance(d, sid, (s, mint, seed) => planDropTab(s, mint, tab, pane, zone, seed))
      }
      const split = (d: Draft, sid: string, pane?: PaneId, settled?: (id: PaneId) => void) => {
        if (!enabled) return oldSplit(d, sid, pane, settled)
        advance(d, sid, (s, mint, seed) => planSplitPane(s, mint, pane, seed))
        const active = d.bySession[sid]?.layout.activePaneId
        if (active) settled?.(active)
      }
      reducers.dropTab = drop; reducers.splitPane = split
      const Original = entry.component
      function EnhancedPanel(props: Props): ReactNode {
        const { NativePanel, ...panel } = props
        const tree = NativePanel({ ...panel, splitPane: (pane: PaneId) => panel.actions.splitPane(panel.sessionId, pane) })
        const transform = (node: ReactNode): ReactNode => {
          if (!isValidElement<Props>(node)) return node
          if (node.props.dropZones === 'horizontal' && node.props.state && node.props.intents) {
            const p = node.props
            const original = p.intents
            const transfer = (id: string, x: number, y: number, include: boolean) => {
              const type = kinds[p.state.tabs[id]?.kind]
              if (!type || !getDockHostBridge().dropPanelAt?.(type, x, y, include)) return false
              panel.closeTab(id)
              return true
            }
            return cloneElement(node, {
              dropZones: 'edges', canSplit: innerDisabled() || (canSplit(p.state) && dockPaneCount(p.state) < 4),
              intents: {
                ...original,
                floatTab: (id: string, rect?: { x: number; y: number; width: number }) => {
                  if (!transfer(id, pointer.x, pointer.y, false)) original.floatTab(id, rect)
                },
                dropTab: (id: string, pane: string, zone: string) => {
                  if (zone !== 'center' && innerDisabled() && transfer(id, pointer.x, pointer.y, true)) return
                  original.dropTab(id, pane, zone)
                },
              },
            })
          }
          return node.props.children === undefined ? node : cloneElement(node, {}, Children.map(node.props.children, transform))
        }
        return transform(tree)
      }
      function EnhancedSeat(props: Props): ReactNode {
        const tree = Original(props)
        if (!enabled || !isValidElement<Props>(tree) || typeof tree.type !== 'function') return tree
        return createElement(EnhancedPanel, { ...tree.props, NativePanel: tree.type })
      }
      entry.component = EnhancedSeat
      disposers.push(() => {
        if (entry.component === EnhancedSeat) entry.component = Original
        if (reducers.dropTab === drop) reducers.dropTab = oldDrop
        if (reducers.splitPane === split) reducers.splitPane = oldSplit
      })
    }
  }
  tryPatch()
  const timer = window.setInterval(tryPatch, 250)
  return () => {
    enabled = false; clearInterval(timer)
    for (const dispose of disposers.reverse()) dispose()
    window.removeEventListener('pointermove', move, true)
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    up()
  }
}
