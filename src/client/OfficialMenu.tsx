import { useEffect, useRef, useState } from 'react'
import css from './WindowControls.module.css'

/** Window-level menus stay outside the dock tree; sidebar actions stay in their pane. */
export function OfficialMenu() {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [persistent, setPersistent] = useState(document.documentElement.dataset.liuliMenuMode === 'persistent')
  useEffect(() => {
    const read = () => { setPersistent(document.documentElement.dataset.liuliMenuMode === 'persistent') }
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-liuli-menu-mode'] })
    return () => { observer.disconnect() }
  }, [])
  useEffect(() => {
    if (!persistent) return
    const anchor = document.createElement('span')
    anchor.dataset.liuliMenuSeat = ''
    let menu: HTMLElement | null = null
    const style = document.createElement('style')
    style.textContent = ':host-context([class*="_collapsed"]) [role="menubar"] { flex-direction:column; gap:2px; } :host-context([class*="_collapsed"]) button { width:40px; padding:0; }'
    const sync = () => {
      menu ??= document.querySelector<HTMLElement>('[data-windows-menu]')
      if (!menu) return
      const row = Array.from(document.querySelectorAll<HTMLElement>('[class*="_logoRow"]'))
        .find(el => el.getBoundingClientRect().width > 20)
      anchor.toggleAttribute('data-liuli-menu-fallback', !row)
      if (row && anchor.parentElement !== row) row.prepend(anchor)
      else if (!row && anchor.parentElement !== document.body) document.body.append(anchor)
      menu.dataset.liuliInlineMenu = ''
      if (menu.parentElement !== anchor) anchor.append(menu)
      if (menu.shadowRoot && !style.isConnected) menu.shadowRoot.append(style)
    }
    sync()
    const timer = window.setInterval(sync, 300)
    return () => {
      clearInterval(timer)
      style.remove()
      if (menu) { delete menu.dataset.liuliInlineMenu; document.body.append(menu) }
      anchor.remove()
    }
  }, [persistent])
  useEffect(() => {
    const html = document.documentElement
    const position = () => {
      const left = 12
      const top = 16
      html.style.setProperty('--liuli-menu-left', `${Math.max(8, left)}px`)
      html.style.setProperty('--liuli-menu-top', `${Math.max(8, top)}px`)
    }
    position()
    const timer = window.setInterval(position, 200)
    return () => { clearInterval(timer); html.style.removeProperty('--liuli-menu-left'); html.style.removeProperty('--liuli-menu-top') }
  }, [])
  useEffect(() => {
    if (persistent) return
    const html = document.documentElement
    html.toggleAttribute('data-liuli-menu-open', open)
    return () => { html.removeAttribute('data-liuli-menu-open') }
  }, [open, persistent])
  useEffect(() => {
    if (persistent) return
    let timer: number | undefined
    let dragging = false
    const nativeMenu = () => document.querySelector('[data-windows-menu]')
    const nativeActive = () => Boolean(nativeMenu()?.shadowRoot?.querySelector('[aria-expanded="true"]'))
    const cancel = () => { window.clearTimeout(timer) }
    const close = () => {
      cancel()
      timer = window.setTimeout(() => {
        if (!nativeActive() && document.activeElement !== nativeMenu()
          && !trigger.current?.matches(':hover, :focus-visible')) setOpen(false)
      }, 220)
    }
    const move = (event: PointerEvent) => {
      // Dragging a dock tab across the corner must never reveal an OS drag surface.
      if (event.buttons !== 0 || dragging) return
      const r = document.querySelector('[data-liuli-menu-island]')?.getBoundingClientRect()
      if (!persistent && event.clientX < 174 && event.clientY < 12) { cancel(); setOpen(true) }
      else if (r && event.clientX >= r.left - 8 && event.clientX <= r.right + 8 && event.clientY >= r.top - 12 && event.clientY <= r.bottom + 10) cancel()
      else close()
    }
    const down = (event: PointerEvent) => {
      if (event.composedPath().some(node => node === trigger.current || node === nativeMenu())) return
      setOpen(false)
    }
    const start = () => { dragging = true; setOpen(false) }
    const end = () => { dragging = false }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.activeElement === nativeMenu()) trigger.current?.focus()
        setOpen(false)
      }
    }
    const leave = () => { if (!nativeActive()) setOpen(false) }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerdown', down, { passive: true })
    window.addEventListener('keydown', key)
    window.addEventListener('blur', leave)
    document.addEventListener('dragstart', start)
    document.addEventListener('dragend', end)
    document.addEventListener('drop', end)
    return () => {
      cancel()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', leave)
      document.removeEventListener('dragstart', start)
      document.removeEventListener('dragend', end)
      document.removeEventListener('drop', end)
    }
  }, [persistent])
  if (persistent) return null
  const button = <button ref={trigger} type="button" className={css.menuTrigger}
    aria-label="应用与编辑菜单" aria-expanded={open} title="应用与编辑菜单"
    onFocus={() => { if (!persistent) setOpen(true) }} onClick={() => { setOpen(v => persistent ? !v : true) }}>
  </button>
  return <>
    {button}
    <div data-liuli-menu-island="" className={`${css.menuIsland}${open ? '' : ' ' + css.menuClosed}`} aria-hidden="true">
      <span className={css.menuGrip} title="拖动窗口">⠿</span>
    </div>
  </>
}
