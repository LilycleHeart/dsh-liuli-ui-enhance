/**
 * 琉璃主题 · 常驻悬浮圆点工具窗。
 *
 * - fixed 圆点，始终置顶（z-index 极高），可整体拖拽；
 * - 松手后贴近窗口边缘时自动吸附半隐藏（仅露出窄条），悬停滑出完整；
 * - 点击（非拖拽）展开/收起工具栏；
 * - 工具栏首件工具：全局元素选择器 —— 悬停高亮 + 点击拾取 + 信息卡。
 *
 * 位置记忆到 localStorage（denpa:floatball-pos）；hover/信息卡经 portal
 * 挂到 body，避免被 root 的 transform（半隐藏滑出）钉住。
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { attachElementPicker, describeElement, type PickedElement } from './element-picker.ts'
import css from './FloatBall.module.css'

/** 圆点尺寸（px）。 */
const BALL = 44
/** 吸附半隐藏时露出的宽度（px）。 */
const PEEK = 14
/** 距边缘小于该距离时触发吸附（px）。 */
const SNAP_DIST = 90
/** 拖拽位移超过该阈值视为拖动而非点击（px）。 */
const CLICK_SLOP = 4
/** 位置记忆键。 */
const LS_POS = 'denpa:floatball-pos'

type Side = 'left' | 'right' | 'top' | 'bottom'

interface Pos {
  left: number
  top: number
}

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(LS_POS)
    if (raw) {
      const p = JSON.parse(raw) as { left?: number; top?: number }
      if (typeof p.left === 'number' && typeof p.top === 'number') return { left: p.left, top: p.top }
    }
  } catch (_) { /* 损坏则回落默认 */ }
  return { left: window.innerWidth - BALL - 24, top: window.innerHeight - BALL - 24 }
}

function savePos(pos: Pos): void {
  try { localStorage.setItem(LS_POS, JSON.stringify(pos)) } catch (_) {}
}

/** 准星图标（元素选择器/工具球共用）。 */
function CrosshairIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.4v2.6M8 12v2.6M1.4 8h2.6M12 8h2.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** 工具栏工具条目。 */
interface Tool {
  id: string
  label: string
  hint: string
  icon: React.ReactNode
  active?: boolean
  onSelect: () => void
}

/** 悬浮圆点 + 工具栏 + 全局元素选择器。 */
export function FloatBall() {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hoverRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null)
  const posRef = useRef<Pos>(loadPos())
  const detachRef = useRef<(() => void) | null>(null)

  const [pos, setPos] = useState<Pos>(posRef.current)
  const [dragging, setDragging] = useState(false)
  const [snapped, setSnapped] = useState<Side | null>(null)
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<PickedElement | null>(null)

  const applyPos = (next: Pos): void => {
    posRef.current = next
    setPos(next)
  }

  /* ── 拾取模式生命周期 ── */
  useEffect(() => {
    if (!picking) return
    const root = rootRef.current
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setPicking(false)
        setPicked(null)
      }
    }
    const detach = attachElementPicker(window.document, {
      onHover: (el, point) => {
        const card = hoverRef.current
        if (card === null) return
        if (el === null) {
          card.style.display = 'none'
          return
        }
        // 信息卡跟随鼠标（视口坐标），防止超出右/下边缘
        const w = 260
        const x = point.x + 16 + w > window.innerWidth ? point.x - w - 12 : point.x + 16
        const y = Math.min(point.y + 20, window.innerHeight - 48)
        card.style.display = 'block'
        card.style.left = x + 'px'
        card.style.top = y + 'px'
        card.textContent = '<' + el.tagName.toLowerCase() + '> ' + describeElement(el).selector
      },
      onPick: (el) => {
        setPicked(describeElement(el))
        setPicking(false)
      },
    }, root)
    detachRef.current = detach
    window.addEventListener('keydown', onEsc)
    return () => {
      detach()
      detachRef.current = null
      window.removeEventListener('keydown', onEsc)
    }
  }, [picking])

  /* ── 拖拽 / 点击 / 吸附 ── */
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    drag.current = { sx: e.clientX, sy: e.clientY, px: posRef.current.left, py: posRef.current.top, moved: false }
    setDragging(true)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (d === null) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > CLICK_SLOP) d.moved = true
    if (d.moved) {
      applyPos({ left: d.px + dx, top: d.py + dy })
      setSnapped(null)
    }
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const d = drag.current
    if (d === null) return
    drag.current = null
    setDragging(false)
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    if (!d.moved) {
      // 点击：若处于半隐藏吸附，先滑出完整再展开工具栏
      if (snapped !== null) {
        const vw = window.innerWidth
        const vh = window.innerHeight
        const p = posRef.current
        const full: Pos = snapped === 'left' ? { left: 8, top: p.top }
          : snapped === 'right' ? { left: vw - BALL - 8, top: p.top }
          : snapped === 'top' ? { left: p.left, top: 8 }
          : { left: p.left, top: vh - BALL - 8 }
        applyPos(full)
        setSnapped(null)
      }
      setOpen(o => !o)
      return
    }
    // 松手：贴近边缘则吸附半隐藏
    const vw = window.innerWidth
    const vh = window.innerHeight
    const p = posRef.current
    const cx = p.left + BALL / 2
    const cy = p.top + BALL / 2
    const dl = cx
    const dr = vw - cx
    const dt = cy
    const db = vh - cy
    const min = Math.min(dl, dr, dt, db)
    if (min < SNAP_DIST) {
      const side: Side = min === dl ? 'left' : min === dr ? 'right' : min === dt ? 'top' : 'bottom'
      const target: Pos = side === 'left' ? { left: -BALL + PEEK, top: p.top }
        : side === 'right' ? { left: vw - PEEK, top: p.top }
        : side === 'top' ? { left: p.left, top: -BALL + PEEK }
        : { left: p.left, top: vh - PEEK }
      applyPos(target)
      setSnapped(side)
    } else {
      setSnapped(null)
    }
    savePos(posRef.current)
  }

  /* ── 复制选择器 ── */
  const copySelector = (): void => {
    if (picked === null) return
    void navigator.clipboard?.writeText(picked.selector).catch(() => {})
  }

  const tools: Tool[] = [
    {
      id: 'element-picker',
      label: '元素选择器',
      hint: '悬停高亮页面元素，点击拾取并查看信息',
      icon: <CrosshairIcon size={15} />,
      active: picking,
      onSelect: () => {
        if (picking) {
          detachRef.current?.()
          setPicking(false)
          return
        }
        setPicked(null)
        setPicking(true)
      },
    },
  ]

  /* 工具栏展开方向：球偏左向右展开，偏右向左展开 */
  const side = pos.left < window.innerWidth / 2 ? 'right' : 'left'

  return (
    <>
      <div
        ref={rootRef}
        className={css.root + (dragging ? ' ' + css.dragging : '')}
        data-snapped={snapped ?? undefined}
        data-side={side}
        style={{ left: pos.left, top: pos.top }}
      >
        {/* 拖拽/点击只在球上生效：工具栏按钮不经过 pointer 逻辑，
            避免 pointerup 关闭工具栏导致按钮 click 丢失 */}
        <div
          className={css.ball}
          role="button"
          aria-label="琉璃工具"
          title="琉璃工具窗（拖拽移动，点击展开）"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <CrosshairIcon size={17} />
        </div>
        {open && (
          <div className={css.toolbar} role="toolbar" aria-label="琉璃工具">
            {tools.map(tool => (
              <button
                key={tool.id}
                type="button"
                className={css.tool + (tool.active === true ? ' ' + css.toolActive : '')}
                title={tool.hint}
                aria-pressed={tool.active === true}
                onClick={tool.onSelect}
              >
                {tool.icon}
                <span>{tool.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 拾取悬停信息卡（body 级，跟随鼠标；root 半隐藏 transform 不影响） */}
      {picking && createPortal(
        <div ref={hoverRef} className={css.hoverCard} style={{ display: 'none' }} aria-hidden="true" />,
        document.body,
      )}

      {/* 拾取结果信息卡 */}
      {picked !== null && createPortal(
        <div className={css.infoCard} role="dialog" aria-label="元素信息">
          <div className={css.infoHead}>
            <CrosshairIcon size={13} />
            <span className={css.infoTag}>&lt;{picked.tag}&gt;</span>
            <button type="button" className={css.infoClose} aria-label="关闭" onClick={() => { setPicked(null) }}>
              ✕
            </button>
          </div>
          <div className={css.infoSelector}>{picked.selector}</div>
          {picked.attributes !== '' && <div className={css.infoRow}>{picked.attributes}</div>}
          {picked.text !== '' && <div className={css.infoText}>{picked.text}</div>}
          <div className={css.infoRow}>
            rect: x={picked.rect.x} y={picked.rect.y} {picked.rect.width}×{picked.rect.height}
          </div>
          <div className={css.infoSwatches}>
            <span className={css.swatch} title={'color: ' + picked.color}>
              <i style={{ background: picked.color }} /> {picked.color}
            </span>
            <span className={css.swatch} title={'background: ' + picked.background}>
              <i style={{ background: picked.background }} /> {picked.background}
            </span>
          </div>
          {picked.font !== '' && <div className={css.infoRow}>{picked.font}</div>}
          <div className={css.infoActions}>
            <button type="button" className={css.infoBtn} onClick={copySelector}>复制选择器</button>
            <button type="button" className={css.infoBtn} onClick={() => { setPicked(null) }}>完成</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
