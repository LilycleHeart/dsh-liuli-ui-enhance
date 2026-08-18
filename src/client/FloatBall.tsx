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
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { attachElementPicker, describeElement, type PickedElement } from './element-picker.ts'
import type { InsertElementFn } from './FloatBall.types.ts'
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
  hotkey?: string
  icon: React.ReactNode
  active?: boolean
  onSelect: () => void
}

/** 悬浮圆点 + 工具栏 + 全局元素选择器。
 * @param props.insertElement - 把拾取的元素作为引用 chip 插入当前会话输入框。
 * @param props.openDock - 可选：打开 Dockable Workspace（琉璃工作台）。 */
export function FloatBall({ insertElement, openDock }: { insertElement: InsertElementFn; openDock?: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hoverRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null)
  const posRef = useRef<Pos>(loadPos())
  const detachRef = useRef<(() => void) | null>(null)

  const [pos, setPos] = useState<Pos>(posRef.current)
  const [dragging, setDragging] = useState(false)
  const [snapped, setSnapped] = useState<Side | null>(null)
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<PickedElement | null>(null)

  const applyPos = (next: Pos): void => {
    posRef.current = next
    setPos(next)
  }

  /* ── 贴边半隐藏的悬停判定（JS 热区，替代 :hover）──
     根因：CSS :hover 滑出时 root 整体移动，鼠标落点会滑出 hover 区域
     → 收回 → 又落回露出条 → 抖动。热区固定为「吸附位 ∪ 滑出位」
     两个 box，鼠标在任一内保持滑出，位置不再抖动。 */
  useEffect(() => {
    if (snapped === null) {
      setHovered(false)
      return
    }
    const onMove = (e: MouseEvent): void => {
      const el = rootRef.current
      if (el === null) return
      const w = el.offsetWidth
      const h = el.offsetHeight
      const p = posRef.current
      const boxes: { left: number; right: number; top: number; bottom: number }[] = [
        { left: p.left, right: p.left + w, top: p.top, bottom: p.top + h },
      ]
      const SLIDE = 36
      if (snapped === 'left') boxes.push({ left: p.left + SLIDE, right: p.left + SLIDE + w, top: p.top, bottom: p.top + h })
      else if (snapped === 'right') boxes.push({ left: p.left - SLIDE, right: p.left - SLIDE + w, top: p.top, bottom: p.top + h })
      else if (snapped === 'top') boxes.push({ left: p.left, right: p.left + w, top: p.top + SLIDE, bottom: p.top + SLIDE + h })
      else boxes.push({ left: p.left, right: p.left + w, top: p.top - SLIDE, bottom: p.top - SLIDE + h })
      const hit = boxes.some(b => e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom)
      setHovered(hit)
    }
    window.addEventListener('mousemove', onMove)
    return () => { window.removeEventListener('mousemove', onMove) }
  }, [snapped])
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
        const info = describeElement(el)
        setPicked(info)
        setPicking(false)
        // 选择后插入到对话框（引用 chip 追加到 draft 末尾）
        try { insertElement(info) } catch (_) { /* 无活跃会话时静默 */ }
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

  /* ── 展开时把 root（球+工具栏）完整拉回窗口内 ──
     根因修复：球贴近右侧时 side='left' 工具栏向左展开，球被推向窗口外
     （不可见也无法点击收起）；clamp 保证展开后整体可见。 */
  useLayoutEffect(() => {
    if (!open) return
    const el = rootRef.current
    if (el === null) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const p = posRef.current
    let left = p.left
    let top = p.top
    if (r.right > vw - 8) left = Math.max(0, vw - r.width - 8)
    if (r.left < 8) left = 8
    if (r.bottom > vh - 8) top = Math.max(0, vh - r.height - 8)
    if (r.top < 8) top = 8
    if (left !== p.left || top !== p.top) applyPos({ left, top })
  }, [open])
  /* ── 工具栏热键：Alt+Shift+<首字母> 直接触发工具（并展开工具栏显示状态） ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.altKey || !e.shiftKey) return
      const k = e.key.toLowerCase()
      if (k === 'e') {
        e.preventDefault()
        setOpen(true)
        if (picking) {
          detachRef.current?.()
          setPicking(false)
        } else {
          setPicked(null)
          setPicking(true)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
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
      hint: '悬停高亮页面元素，点击拾取并查看信息（Alt+Shift+E）',
      hotkey: 'Alt+Shift+E',
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
  if (openDock !== undefined) {
    tools.push({
      id: 'dock-workspace',
      label: '琉璃工作台',
      hint: '打开 Dockable Workspace：面板拖拽/停靠/拆分/浮动/标签合并（Ctrl+Alt+W）',
      hotkey: 'Ctrl+Alt+W',
      icon: (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path fill="currentColor" d="M2 2h5.2v5.2H2V2zm1.3 1.3v2.6h2.6V3.3H3.3zM8.8 2H14v3.2H8.8V2zm1.3 1.3v.6h2.6v-.6h-2.6zm-1.3 2h5.2V14H8.8V5.3zm1.3 1.3v6.1h2.6V6.6h-2.6zM2 9.2h5.2V14H2V9.2zm1.3 1.3v2.2h2.6v-2.2H3.3z" />
        </svg>
      ),
      onSelect: () => { openDock() },
    })
  }

  /* 工具栏展开方向：球偏左向右展开，偏右向左展开 */
  const side = pos.left < window.innerWidth / 2 ? 'right' : 'left'

  return (
    <>
      <div
        ref={rootRef}
        className={css.root + (dragging ? ' ' + css.dragging : '')}
        data-snapped={snapped ?? undefined}
        data-hovered={hovered || undefined}
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
                {tool.hotkey !== undefined && <kbd className={css.hotkey}>{tool.hotkey}</kbd>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 拾取悬停信息卡（body 级，跟随鼠标；root 半隐藏 transform 不影响） */}
      {picking && createPortal(
        <div ref={hoverRef} className={css.hoverCard} data-liuli-picker-ignore="" style={{ display: 'none' }} aria-hidden="true" />,
        document.body,
      )}

      {/* 拾取结果信息卡 */}
      {picked !== null && createPortal(
        <div className={css.infoCard} role="dialog" aria-label="元素信息" data-liuli-picker-ignore="">
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
