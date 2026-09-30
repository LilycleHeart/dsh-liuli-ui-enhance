import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { beginSidebarTransitionPerf } from './resize-perf.ts'

export const SIDEBAR_SLIDE_MS = 300
type Phase = 'closed' | 'preparing' | 'entering' | 'open' | 'closing'

/** Prepare fixed-size contents while the shell is closed, then animate the
 * shell's width. Retain contents until the shell's transition actually ends. */
export function useSidebarPresence(open: boolean, enabled: boolean, container?: RefObject<HTMLElement | null>) {
  const [state, setState] = useState<{ mounted: boolean; visible: boolean; phase: Phase }>({
    mounted: open, visible: open, phase: open ? 'open' : 'closed',
  })
  const previous = useRef(open)
  const complete = useRef<(() => void) | undefined>(undefined)
  useLayoutEffect(() => {
    if (!enabled || previous.current === open) return
    previous.current = open
    const release = beginSidebarTransitionPerf()
    let frame = 0
    let timer = 0
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      window.clearTimeout(timer)
      setState({ mounted: open, visible: open, phase: open ? 'open' : 'closed' })
      // Let the final column commit finish before auxiliary readers resume.
      frame = requestAnimationFrame(release)
    }
    complete.current = finish
    const enter = (): void => {
      setState({ mounted: true, visible: true, phase: 'entering' })
      timer = window.setTimeout(finish, SIDEBAR_SLIDE_MS * 2)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish()
    } else if (open) {
      if (state.mounted) {
        // A rapid reversal keeps the current interpolated position.
        enter()
      } else {
        setState({ mounted: true, visible: false, phase: 'preparing' })
        frame = requestAnimationFrame(() => { frame = requestAnimationFrame(enter) })
      }
    } else {
      setState({ mounted: true, visible: false, phase: 'closing' })
      timer = window.setTimeout(finish, SIDEBAR_SLIDE_MS * 2)
    }
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      if (complete.current === finish) complete.current = undefined
      release()
    }
    // Each requested state owns one cancellable animation lifecycle. Internal
    // phase commits must not restart it or resample the content dimensions.
  }, [open, enabled])
  useLayoutEffect(() => {
    if (!enabled || (state.phase !== 'entering' && state.phase !== 'closing')) return
    const root = container?.current?.closest('[data-testid="dock-shell"]')
    if (!root) return
    let disposed = false
    const frame = requestAnimationFrame(() => {
      const shard = root.querySelector<HTMLElement>('[data-shard-region="region:details"]')
      const animations = shard?.getAnimations().filter(animation =>
        animation instanceof CSSTransition && animation.transitionProperty === 'flex-basis') ?? []
      // Rapid clicks can reverse before the browser starts a transition. Do
      // not keep the content inert until the fallback timer in that case.
      void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
        if (!disposed) complete.current?.()
      })
    })
    return () => { disposed = true; cancelAnimationFrame(frame) }
  }, [enabled, state.phase, container])
  return { ...state, mounted: open || state.mounted, visible: open && state.visible, finish: () => { complete.current?.() } }
}
