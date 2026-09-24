/**
 * Keep the upstream Sidebar seat mounted in its original Slot tree, then place
 * its visible panel over one Liuli dock tab. The native body depends on the
 * upstream Tab domain and cannot be rendered by our independent DockSurface.
 */
import { createElement, useLayoutEffect, useRef, type ReactElement } from 'react'
import { getOfficialSidebarController } from './sidebar-right-tabs.ts'

const HOST_SELECTOR = '[data-liuli-official-rightbar-host]'

function positionNativeSeat(host: HTMLElement, target: HTMLElement, fullscreen: boolean): boolean {
  const rect = fullscreen
    ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    : target.getBoundingClientRect()
  const visible = rect.width > 20 && rect.height > 20 && target.getClientRects().length > 0
  if (!visible) {
    delete host.dataset.liuliNativeSeatActive
    return false
  }
  host.style.setProperty('--liuli-native-seat-left', `${rect.left}px`)
  host.style.setProperty('--liuli-native-seat-top', `${rect.top}px`)
  host.style.setProperty('--liuli-native-seat-width', `${rect.width}px`)
  host.style.setProperty('--liuli-native-seat-height', `${rect.height}px`)
  host.dataset.liuliNativeSeatActive = ''
  if (fullscreen) host.dataset.liuliNativeFullscreen = ''
  else delete host.dataset.liuliNativeFullscreen
  return true
}

/** Upstream guide, files, and document preview live here as a single native tab. */
export function OfficialSidebarSeatPane({ onCollapse }: { onCollapse: () => void }): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const target = ref.current
    const host = document.querySelector<HTMLElement>(HOST_SELECTOR)
    if (target === null || host === null) return
    let fullscreen = false
    let collapsedByUser = false
    let frame = 0
    let motionFrame = 0
    let motionUntil = 0
    const sync = (): void => {
      frame = 0
      const visible = positionNativeSeat(host, target, fullscreen)
      if (!visible) {
        collapsedByUser = false
        const liuliExpanded = (window as unknown as { __liuliForceExpanded__?: boolean }).__liuliForceExpanded__
        const controller = getOfficialSidebarController()
        if (liuliExpanded === false && controller?.isExpanded?.() === true) controller.toggleExpanded?.()
      }
      // viewportWidth=0 keeps the upstream seat in auto-fullscreen mode without
      // reserving another frame track. Restore its content when this tab shows.
      if (visible && !collapsedByUser) {
        const controller = getOfficialSidebarController()
        if (controller?.isExpanded?.() === false) controller.toggleExpanded?.()
      }
    }
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(sync)
    }
    const onNativeClick = (event: MouseEvent): void => {
      const origin = event.target
      if (!(origin instanceof Element) || !host.contains(origin)) return
      if (origin.closest('[data-sidebar-right-mode]') !== null) {
        // With viewportWidth=0 upstream always calls this "fullscreen". Let our
        // dock pane own the window geometry while preserving the native control.
        event.preventDefault()
        event.stopImmediatePropagation()
        fullscreen = !fullscreen
        const button = origin.closest<HTMLElement>('[data-sidebar-right-mode]')
        button?.setAttribute('aria-label', fullscreen ? '退出全屏' : '全屏')
        button?.setAttribute('title', fullscreen ? '退出全屏' : '全屏')
        sync()
      } else if (origin.closest('[data-sidebar-right-toggle]') !== null) {
        collapsedByUser = true
        onCollapse()
      }
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(target)
    // A sibling dock shard can change width while this tab keeps the same
    // dimensions; its left edge still moves. Observe the small set of outer
    // shards as well, so the native Seat tracks layout without an idle rAF loop.
    const shell = target.closest('[data-testid="dock-shell"]')
    for (const shard of shell?.querySelectorAll<HTMLElement>('[class*="_shard"]') ?? []) {
      resize.observe(shard)
    }
    window.addEventListener('resize', schedule)
    document.addEventListener('visibilitychange', schedule)
    const movingProperties = ['width', 'flex-basis', 'transform', 'left', 'right', 'margin-left', 'margin-right']
    const onTransition = (event: TransitionEvent): void => {
      const origin = event.target
      if (!(origin instanceof Element) || !origin.contains(target)
        || !movingProperties.includes(event.propertyName)) return
      schedule()
    }
    const followMotion = (now: number): void => {
      motionFrame = 0
      sync()
      if (now < motionUntil) motionFrame = requestAnimationFrame(followMotion)
    }
    const onTransitionStart = (event: TransitionEvent): void => {
      const origin = event.target
      if (!(origin instanceof Element) || !origin.contains(target)
        || !movingProperties.includes(event.propertyName)) return
      // Bounded geometry tracking only during an ancestor's motion. At rest,
      // ResizeObserver and discrete events do all the work.
      motionUntil = performance.now() + 900
      if (motionFrame === 0) motionFrame = requestAnimationFrame(followMotion)
    }
    document.addEventListener('transitionrun', onTransitionStart, true)
    document.addEventListener('transitionend', onTransition, true)
    const onPointerMove = (event: PointerEvent): void => {
      if (event.buttons === 0) return
      const origin = event.target
      if (origin instanceof Element && host.contains(origin)
        && origin.closest('[data-dockkit-tab]') !== null
        && document.querySelector('[data-liuli-disable-inner-split]') !== null) {
        // Upstream handles a tab's pointer stream as one gesture (reorder,
        // float, and inner split). The user's "disable inner split" choice
        // suppresses that native gesture while Liuli's outer dock drag stays on.
        event.stopImmediatePropagation()
        return
      }
      schedule()
    }
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', schedule, true)
    document.addEventListener('click', onNativeClick, true)
    schedule()
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('visibilitychange', schedule)
      document.removeEventListener('transitionrun', onTransitionStart, true)
      document.removeEventListener('transitionend', onTransition, true)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', schedule, true)
      document.removeEventListener('click', onNativeClick, true)
      if (frame !== 0) cancelAnimationFrame(frame)
      if (motionFrame !== 0) cancelAnimationFrame(motionFrame)
      delete host.dataset.liuliNativeSeatActive
      delete host.dataset.liuliNativeFullscreen
      // Closing Liuli's outer native tab should also retire the hidden seat.
      const controller = getOfficialSidebarController()
      if (controller?.isExpanded?.() === true) controller.toggleExpanded?.()
    }
  }, [onCollapse])
  return createElement('div', {
    ref,
    'data-liuli-official-seat-target': '',
    style: { position: 'relative', width: '100%', height: '100%', minHeight: 0 },
  })
}
