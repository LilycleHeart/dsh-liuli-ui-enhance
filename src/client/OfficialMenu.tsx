import { useEffect, useRef, useState } from 'react'
import css from './WindowControls.module.css'

/** Window-level menus stay outside the dock tree; sidebar actions stay in their pane. */
export function OfficialMenu() {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
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
          && !trigger.current?.matches(':focus-visible')) setOpen(false)
      }, 220)
    }
    const move = (event: PointerEvent) => {
      // Dragging a dock tab across the corner must never reveal an OS drag surface.
      if (event.buttons !== 0 || dragging) return
      if (event.clientX < 174 && event.clientY < 12) { cancel(); setOpen(true) }
      else if (event.clientX < 190 && event.clientY < 66) cancel()
      else close()
    }
    const down = (event: PointerEvent) => {
      if (event.clientX >= 190 || event.clientY >= 66) setOpen(false)
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
  }, [])
  return <>
    <button ref={trigger} type="button" className={css.menuTrigger}
      aria-label="应用与编辑菜单" aria-expanded={open} title="应用与编辑菜单"
      onFocus={() => { setOpen(true) }} onClick={() => { setOpen(true) }} />
    <div className={`${css.menuIsland}${open ? '' : ' ' + css.menuClosed}`} aria-hidden="true">
      <span className={css.menuGrip} title="拖动窗口">⠿</span>
    </div>
  </>
}
