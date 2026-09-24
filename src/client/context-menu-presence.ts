/** Retire a DOM-owned context menu after its short exit while releasing input now. */
export function dismissLiuliContextMenu(menu: HTMLElement): void {
  if (!menu.isConnected) return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    menu.remove()
    return
  }
  menu.setAttribute('inert', '')
  menu.setAttribute('aria-hidden', 'true')
  menu.dataset.closing = 'true'
  window.setTimeout(() => { menu.remove() }, 120)
}
