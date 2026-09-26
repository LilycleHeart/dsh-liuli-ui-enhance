import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import css from './WindowControls.module.css'

/** Window-level menus stay outside the dock tree; sidebar actions stay in their pane. */
export function OfficialMenu() {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const [persistent, setPersistent] = useState(document.documentElement.dataset.liuliMenuMode === 'persistent')
  const [seat, setSeat] = useState<HTMLElement | null>(null)
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
    const sync = () => {
      const row = document.querySelector<HTMLElement>('[class*="_logoRow"]')
      if (row !== null && row.getBoundingClientRect().width > 20 && anchor.parentElement !== row) row.prepend(anchor)
      if (row === null || row.getBoundingClientRect().width < 20) { anchor.remove(); setSeat(null) }
      else setSeat(anchor)
    }
    sync()
    const timer = window.setInterval(sync, 300)
    return () => { clearInterval(timer); anchor.remove(); setSeat(null) }
  }, [persistent])
  useEffect(() => {
    const html = document.documentElement
    const position = () => {
      const r = trigger.current?.getBoundingClientRect()
      const left = persistent && r ? Math.min(r.left, window.innerWidth - 174) : 12
      const top = persistent && r ? Math.min(r.bottom + 6, window.innerHeight - 50) : 16
      html.style.setProperty('--liuli-menu-left', `${Math.max(8, left)}px`)
      html.style.setProperty('--liuli-menu-top', `${Math.max(8, top)}px`)
    }
    position()
    const timer = window.setInterval(position, 200)
    return () => { clearInterval(timer); html.style.removeProperty('--liuli-menu-left'); html.style.removeProperty('--liuli-menu-top') }
  }, [persistent, seat])
  useEffect(() => {
    const html = document.documentElement
    html.toggleAttribute('data-liuli-menu-open', open)
    return () => { html.removeAttribute('data-liuli-menu-open') }
  }, [open])
  useEffect(() => {
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
  const button = <button ref={trigger} type="button" className={persistent ? css.menuPersistent : css.menuTrigger}
    data-liuli-menu-fallback={persistent && !seat || undefined}
    aria-label="应用与编辑菜单" aria-expanded={open} title="应用与编辑菜单"
    onFocus={() => { if (!persistent) setOpen(true) }} onClick={() => { setOpen(v => persistent ? !v : true) }}>
    {persistent && <><span>琉璃</span><span aria-hidden="true">⋯</span></>}
  </button>
  return <>
    {persistent && seat ? createPortal(button, seat) : button}
    <div data-liuli-menu-island="" className={`${css.menuIsland}${open ? '' : ' ' + css.menuClosed}`} aria-hidden="true">
      <span className={css.menuGrip} title="拖动窗口">⠿</span>
    </div>
  </>
}
