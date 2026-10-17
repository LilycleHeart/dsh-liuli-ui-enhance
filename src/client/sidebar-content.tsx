import { createElement, useLayoutEffect, useRef, type ReactNode } from 'react'

/** The card may resize every frame; its content gets one fixed-width layout.
 * At rest it follows normal resizing, so dragging a sash still resizes editors. */
export function SidebarContent({ phase, trackWidth, className, children }: {
  phase: string
  trackWidth: number
  className: string | undefined
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const measured = useRef<{ trackWidth: number; width: number } | null>(null)
  useLayoutEffect(() => {
    if (ref.current !== null) ref.current.inert = phase !== 'open'
  }, [phase])
  useLayoutEffect(() => {
    const content = ref.current
    const card = content?.parentElement
    const shard = card?.closest<HTMLElement>('[data-shard-region="region:details"]')
    if (!content || !card || !shard) return
    const freeze = (width: number): void => {
      const value = `${Math.max(0, width)}px`
      if (content.style.getPropertyValue('--liuli-sidebar-content-width') !== value) {
        content.style.setProperty('--liuli-sidebar-content-width', value)
      }
    }
    if (phase === 'preparing') {
      if (measured.current?.trackWidth === trackWidth) {
        freeze(measured.current.width)
      } else {
        // The outer column is still closed. Resolve its final inner width from
        // chrome only, without stretching the column or measuring its contents.
        let width = trackWidth
        for (let node: HTMLElement | null = card; node && node !== shard; node = node.parentElement) {
          const style = getComputedStyle(node)
          if (style.display === 'contents') continue
          for (const value of [style.paddingLeft, style.paddingRight, style.marginLeft, style.marginRight,
            style.borderLeftWidth, style.borderRightWidth]) width -= Number.parseFloat(value) || 0
        }
        freeze(width)
      }
    } else if (phase === 'closing' && measured.current !== null) {
      freeze(measured.current.width)
    }
    if (phase !== 'open') return
    // Observe the shell only at rest. Disconnect before its width tween, so
    // there is no per-frame resize callback or content-width write during it.
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width !== undefined && width > 0) measured.current = { trackWidth, width }
    })
    observer.observe(card)
    return () => { observer.disconnect() }
  }, [phase, trackWidth])
  return createElement('div', { ref, className, 'data-liuli-sidebar-content': '' }, children)
}
