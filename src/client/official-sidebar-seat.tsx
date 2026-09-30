/**
 * Keep the upstream Sidebar seat mounted in its original Slot tree, then place
 * its visible panel over one Liuli dock tab. The native body depends on the
 * upstream Tab domain and cannot be rendered by our independent DockSurface.
 */
import { createElement, useLayoutEffect, useRef, type ReactElement } from 'react'
import { getOfficialSidebarController, OFFICIAL_SIDEBAR_NAVIGATION_EVENT } from './sidebar-right-tabs.ts'
import { isResizeInProgress, LAYOUT_SETTLED_EVENT } from './resize-perf.ts'
import css from './LiuliDockSurface.module.css'
import materialCss from './OfficialSidebarMaterial.module.css'

const HOST_SELECTOR = '[data-liuli-official-rightbar-host]'
let projectedTarget: HTMLElement | null = null

function overlaps(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** The native Seat is a fixed overlay. Never let it cover a different Liuli
 * float that the user has raised above the file card. */
function mayProjectOverFloats(target: HTMLElement): boolean {
  const surface = target.closest<HTMLElement>('[data-liuli-dock-surface]')
  if (surface === null) return true
  const current = target.closest<HTMLElement>('[data-dockkit-float]')
  const targetRect = target.getBoundingClientRect()
  const currentZ = current === null ? -1 : Number(current.style.zIndex || 0)
  for (const peer of surface.querySelectorAll<HTMLElement>('[data-dockkit-float]')) {
    if (peer === current || peer.getClientRects().length === 0 || !overlaps(targetRect, peer.getBoundingClientRect())) continue
    if (current === null || Number(peer.style.zIndex || 0) > currentZ) return false
  }
  return true
}

function positionNativeSeat(host: HTMLElement, target: HTMLElement, fullscreen: boolean): boolean {
  const measured = fullscreen
    ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    : target.getBoundingClientRect()
  const shell = target.closest<HTMLElement>('[data-liuli-official-shell]')
  const preparing = !fullscreen && shell?.dataset.liuliRightbarPhase === 'preparing'
    && target.closest('[data-shard-region="region:details"]') !== null
    && target.closest('[data-dockkit-float]') === null
  // During preparation the shell is still closed. Store the full-width
  // endpoint; CSS then follows its moving left edge without repeated reads.
  const offset = preparing ? Number.parseFloat(shell.style.getPropertyValue('--liuli-rightbar-slide')) || 0 : 0
  const rect = { left: measured.left - offset, top: measured.top, width: measured.width, height: measured.height }
  const visible = rect.width > 20 && rect.height > 20 && target.getClientRects().length > 0
  if (!visible) return false
  // These variables inherit through the entire native sidebar. Do not
  // invalidate its styles when the projection has not moved.
  for (const [name, value] of [['left', rect.left], ['top', rect.top], ['width', rect.width], ['height', rect.height]] as const) {
    const property = `--liuli-native-seat-${name}`
    const next = `${value}px`
    if (host.style.getPropertyValue(property) !== next) host.style.setProperty(property, next)
  }
  host.toggleAttribute('data-liuli-native-seat-active', true)
  host.toggleAttribute('data-liuli-native-fullscreen', fullscreen)
  return true
}

/** Each Liuli chip owns a target. The single upstream Seat follows whichever
 * native occurrence is active; inactive split cards offer a focus affordance. */
export function OfficialSidebarSeatPane({ onCollapse, nativeTabId, label = '开始' }: {
  onCollapse: () => void
  nativeTabId?: string
  label?: string
}): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const target = ref.current
    const host = document.querySelector<HTMLElement>(HOST_SELECTOR)
    if (target === null || host === null) return
    if (materialCss.nativeSkin !== undefined) host.classList.add(materialCss.nativeSkin)
    let fullscreen = false
    let collapsedByUser = false
    let frame = 0
    let motionFrame = 0
    let motionUntil = 0
    const shell = target.closest<HTMLElement>('[data-testid="dock-shell"]')
    // The native panel's translation follows the material shell's width tween.
    // Re-reading the moving target would double that movement and invalidate
    // the fixed-size native body on every frame.
    const frozen = (): boolean => {
      if (fullscreen || target.closest('[data-dockkit-float]') !== null
        || target.closest('[data-shard-region="region:details"]') === null) return false
      const phase = shell?.dataset.liuliRightbarPhase
      return phase === 'entering' || phase === 'closing' || phase === 'closed'
    }
    const clearProjection = (): void => {
      delete target.dataset.liuliNativeTargetActive
      if (projectedTarget !== target) return
      projectedTarget = null
      delete host.dataset.liuliNativeSeatActive
      delete host.dataset.liuliNativeFullscreen
      delete host.dataset.liuliNativeFloat
      delete host.dataset.liuliNativeKind
      delete host.dataset.liuliNativeColumn
      host.inert = false
    }
    const sync = (): void => {
      if (frame !== 0) cancelAnimationFrame(frame)
      frame = 0
      if (frozen()) return
      const controller = getOfficialSidebarController()
      const active = controller?.active?.() as { id?: string; kind?: string } | undefined
      const ownsActive = nativeTabId === undefined ? active?.kind === 'guide' : active?.id === nativeTabId
      if (!ownsActive || (!fullscreen && !mayProjectOverFloats(target))
        || !positionNativeSeat(host, target, fullscreen)) {
        clearProjection()
        collapsedByUser = false
        return
      }
      projectedTarget = target
      target.toggleAttribute('data-liuli-native-target-active', true)
      if (active?.kind !== undefined && host.dataset.liuliNativeKind !== active.kind) host.dataset.liuliNativeKind = active.kind
      host.toggleAttribute('data-liuli-native-float', target.closest('[data-dockkit-float]') !== null)
      host.toggleAttribute('data-liuli-native-column', target.closest('[data-shard-region="region:details"]') !== null)
      host.inert = shell?.dataset.liuliRightbarPhase !== 'open'
        && host.hasAttribute('data-liuli-native-column')
        && !host.hasAttribute('data-liuli-native-float') && !fullscreen
      // viewportWidth=0 keeps the upstream seat in auto-fullscreen mode without
      // reserving another frame track. Restore its content when this tab shows.
      if (!collapsedByUser && controller?.isExpanded?.() === false) controller.toggleExpanded?.()
    }
    const schedule = (): void => {
      if (!frozen() && frame === 0) frame = requestAnimationFrame(sync)
    }
    const onNativeClick = (event: MouseEvent): void => {
      const origin = event.target
      if (projectedTarget !== target || !(origin instanceof Element) || !host.contains(origin)) return
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
        // Keep the native body expanded for the exit; our presentation state
        // owns the close instead of collapsing both independent controllers.
        event.preventDefault()
        event.stopImmediatePropagation()
        collapsedByUser = true
        onCollapse()
      }
    }
    // ResizeObserver runs after layout: read the final target box here instead
    // of an earlier pointermove rAF that forces layout and trails the sash.
    const resize = new ResizeObserver(sync)
    resize.observe(target)
    // A sibling dock shard can change width while this tab keeps the same
    // dimensions; its left edge still moves. Observe the small set of outer
    // shards as well, so the native Seat tracks layout without an idle rAF loop.
    for (const shard of shell?.querySelectorAll<HTMLElement>('[class*="_shard"]') ?? []) {
      resize.observe(shard)
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('pointerdown', schedule, true)
    document.addEventListener('visibilitychange', schedule)
    window.addEventListener(OFFICIAL_SIDEBAR_NAVIGATION_EVENT, schedule)
    const onSettled = (): void => {
      if (shell?.dataset.liuliRightbarPhase === 'closed' && !fullscreen
        && target.closest('[data-dockkit-float]') === null) clearProjection()
      else { collapsedByUser = false; schedule() }
    }
    window.addEventListener(LAYOUT_SETTLED_EVENT, onSettled)
    const unsubscribeNative = getOfficialSidebarController()?.openTabs?.subscribe(schedule)
    const stateTimer = window.setInterval(schedule, 320)
    const movingProperties = ['width', 'flex-basis', 'transform', 'left', 'right', 'margin-left', 'margin-right']
    const onTransition = (event: TransitionEvent): void => {
      const origin = event.target
      if (!(origin instanceof Element) || !origin.contains(target)
        || !movingProperties.includes(event.propertyName)) return
      schedule()
    }
    const followMotion = (now: number): void => {
      motionFrame = 0
      if (frozen()) return
      sync()
      if (now < motionUntil) motionFrame = requestAnimationFrame(followMotion)
    }
    const onTransitionStart = (event: TransitionEvent): void => {
      const origin = event.target
      if (frozen() || !(origin instanceof Element) || !origin.contains(target)
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
      if (projectedTarget === target && origin instanceof Element && host.contains(origin)
        && origin.closest('[data-dockkit-tab]') !== null
        && document.querySelector('[data-liuli-disable-inner-split]') !== null) {
        // Upstream handles a tab's pointer stream as one gesture (reorder,
        // float, and inner split). The user's "disable inner split" choice
        // suppresses that native gesture while Liuli's outer dock drag stays on.
        event.stopImmediatePropagation()
        return
      }
      if (!isResizeInProgress()) schedule()
    }
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', schedule, true)
    document.addEventListener('click', onNativeClick, true)
    schedule()
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('pointerdown', schedule, true)
      document.removeEventListener('visibilitychange', schedule)
      window.removeEventListener(OFFICIAL_SIDEBAR_NAVIGATION_EVENT, schedule)
      window.removeEventListener(LAYOUT_SETTLED_EVENT, onSettled)
      unsubscribeNative?.()
      window.clearInterval(stateTimer)
      document.removeEventListener('transitionrun', onTransitionStart, true)
      document.removeEventListener('transitionend', onTransition, true)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('pointerup', schedule, true)
      document.removeEventListener('click', onNativeClick, true)
      if (frame !== 0) cancelAnimationFrame(frame)
      if (motionFrame !== 0) cancelAnimationFrame(motionFrame)
      clearProjection()
    }
  }, [onCollapse, nativeTabId])
  return createElement('div', {
    ref,
    'data-liuli-official-seat-target': '',
    className: css.nativeSeatTarget,
  }, createElement('button', {
    type: 'button',
    className: css.nativeSeatPlaceholder,
    onClick: () => {
      const native = getOfficialSidebarController()
      if (nativeTabId !== undefined) native?.focus?.(nativeTabId)
      else native?.openTab?.('guide')
    },
  }, nativeTabId === undefined ? '正在载入官方开始页…' : `点击查看「${label}」`))
}
