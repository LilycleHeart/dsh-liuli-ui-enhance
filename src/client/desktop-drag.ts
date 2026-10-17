import { isLayoutInProgress, LAYOUT_SETTLED_EVENT } from './resize-perf.ts'

/** Subtract interactive rectangles before handing any pixels to Electron's drag region. */
export function startDesktopDrag(): () => void {
  const host = document.createElement('div')
  host.dataset.liuliDragRegions = ''
  document.body.append(host)
  let frame = 0
  let pressed = false
  let signature = ''
  const interactive = 'button,a,input,textarea,select,label,[role="button"],[role="tab"],[role="slider"],[role="separator"],[contenteditable="true"],[data-testid="dock-tab-chip"]'
  const sync = () => {
    frame = 0
    const height = Number(document.documentElement.dataset.liuliDragHeight ?? 24)
    const blocked = pressed || isLayoutInProgress() || document.body.hasAttribute('data-liuli-settings-open')
      || Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="menu"], [role="listbox"]'))
        .some(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0')
    const rects: Array<{ x: number; y: number; w: number; h: number }> = []
    if (!blocked && height > 0) {
      const exclusions = Array.from(document.querySelectorAll<HTMLElement>(interactive))
        // getClientRects() on a child of a skipped content-visibility subtree
        // realizes that entire message. Check visibility before any geometry.
        .filter(el => typeof el.checkVisibility === 'function'
          ? el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })
          : el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
        .map(el => el.getBoundingClientRect())
        .filter(r => r.width > 0 && r.height > 0 && r.bottom > 8 && r.top < height + 16)
      for (const pane of document.querySelectorAll<HTMLElement>('[data-region-pane], [data-testid="dock-pane"], [data-testid="dock-float"]')) {
        const r = pane.getBoundingClientRect()
        if (r.width < 30 || r.height < height || r.top < -1 || r.top > 16) continue
        // The inset leaves native window resize edges untouched.
        const top = Math.max(8, r.top)
        const bottom = Math.min(r.bottom, r.top + height)
        let spans = [[Math.max(8, r.left + 6), Math.min(window.innerWidth - 8, r.right - 6)]]
        for (const e of exclusions) {
          if (e.bottom <= top || e.top >= bottom) continue
          spans = spans.flatMap(([a = 0, b = 0]) => e.right + 3 <= a || e.left - 3 >= b
            ? [[a, b]] : [[a, Math.max(a, e.left - 3)], [Math.min(b, e.right + 3), b]])
        }
        for (const [a = 0, b = 0] of spans) if (b - a >= 8 && bottom > top) rects.push({ x: a, y: top, w: b - a, h: bottom - top })
      }
    }
    const next = JSON.stringify(rects)
    if (signature === next) return
    signature = next
    host.replaceChildren(...rects.map(r => {
      const el = document.createElement('div')
      el.title = '拖动窗口'
      el.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;z-index:2147482300;-webkit-app-region:drag;`
      return el
    }))
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(sync) }
  const down = () => { pressed = true; schedule() }
  const up = () => { pressed = false; schedule() }
  // Bounded interval also follows CSS-only hover controls and dock animations.
  const timer = window.setInterval(schedule, 250)
  window.addEventListener('resize', schedule)
  window.addEventListener(LAYOUT_SETTLED_EVENT, schedule)
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  window.addEventListener('blur', up)
  sync()
  return () => {
    clearInterval(timer)
    cancelAnimationFrame(frame)
    window.removeEventListener('resize', schedule)
    window.removeEventListener(LAYOUT_SETTLED_EVENT, schedule)
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', up, true)
    window.removeEventListener('blur', up)
    host.remove()
  }
}
