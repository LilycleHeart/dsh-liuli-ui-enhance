/**
 * 琉璃主题 · 常驻悬浮圆点工具窗。
 *
 * - fixed 圆点，始终置顶（z-index 极高），可整体拖拽；
 * - 松手后贴近窗口边缘时自动吸附半隐藏（仅露出窄条），悬停滑出完整；
 * - 点击（非拖拽）展开/收起工具栏；
 * - 工具栏首件工具：全局元素选择器 —— 悬停高亮 + 点击拾取 + 信息卡。
 *
 * 位置记忆到 localStorage（liuli:floatball-pos）；hover/信息卡经 portal
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
const LS_POS = 'liuli:floatball-pos'
/** 工具栏默认收起：加载后只显示圆球，点击圆球才展开工具菜单。 */
const DEFAULT_OPEN = false

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

/** DevTools 图标（开发者工具）。 */
function DevToolsIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true">
      <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5 5.4 2.9 8 5 10.6M11 5.4 13.1 8 11 10.6M9.2 4.8l-2.4 6.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
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
  /** 可选：紧跟在工具按钮后面渲染的附属小按钮（如元素选择器的模式切换）。 */
  extra?: React.ReactNode
}

/** 悬浮圆点 + 工具栏 + 全局元素选择器。
 * @param props.insertElement - 把拾取的元素作为引用 chip 插入当前会话输入框。
 * @param props.openLayoutMenu - 可选：唤起布局工作台菜单（dockable shell）。 */
export function FloatBall({ insertElement, openLayoutMenu }: { insertElement: InsertElementFn; openLayoutMenu?: () => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)
  const hoverRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null)
  /** 从吸附半隐藏态点击展开时的原吸附边；关闭菜单时据此回到原位置吸附隐藏。 */
  const returnSnap = useRef<Side | null>(null)
  const posRef = useRef<Pos>(loadPos())
  const detachRef = useRef<(() => void) | null>(null)

  const [pos, setPos] = useState<Pos>(posRef.current)
  const [dragging, setDragging] = useState(false)
  const [snapped, setSnapped] = useState<Side | null>(null)
  const [open, setOpen] = useState(DEFAULT_OPEN)
  /** 菜单翻到球左侧（默认在球右侧） */
  const [menuLeft, setMenuLeft] = useState(false)
  /** 菜单底边对齐球底、向上展开（默认顶边对齐球顶、向下展开） */
  const [menuBottom, setMenuBottom] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<PickedElement | null>(null)
  const [pickerMode, setPickerMode] = useState<'insert' | 'inspect'>('insert')
  const [devtoolsBusy, setDevtoolsBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

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
  /* ── 检查模式：把元素定位到 DevTools Elements 面板（等价浏览器右键「检查」） ── */
  const inspectElementAt = async (info: PickedElement): Promise<void> => {
    const x = info.rect.x + Math.round(info.rect.width / 2)
    const y = info.rect.y + Math.round(info.rect.height / 2)
    try {
      const resp = await fetch('/liuli-window', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'inspectElement', x, y }),
      })
      const body = await resp.json().catch(() => ({})) as { ok?: boolean; available?: boolean; error?: string }
      if (body.available === false) {
        setNotice('当前不是 Electron 桌面版，无法在 DevTools 中定位元素')
      } else if (body.ok !== true) {
        setNotice(typeof body.error === 'string' ? body.error : 'DevTools 定位失败')
      }
    } catch {
      setNotice('DevTools 定位请求失败（Host 路由不可达）')
    }
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
        const info = describeElement(el)
        setPicked(info)
        setPicking(false)
        if (pickerMode === 'inspect') {
          // 检查模式：不插入聊天，改为在 DevTools 中定位元素。
          void inspectElementAt(info)
        } else {
          // 插入模式：选择后插入到对话框（引用 chip 追加到 draft 末尾）。
          try { insertElement(info) } catch (_) { /* 无活跃会话时静默 */ }
        }
      },
    }, root)
    detachRef.current = detach
    window.addEventListener('keydown', onEsc)
    return () => {
      detach()
      detachRef.current = null
      window.removeEventListener('keydown', onEsc)
    }
  }, [picking, pickerMode])
  /* ── 开发者工具（Electron F12 侧边窗口）：经 Host /liuli-window 打开/关闭 ── */
  const toggleDevTools = async (): Promise<void> => {
    if (devtoolsBusy) return
    setDevtoolsBusy(true)
    try {
      const resp = await fetch('/liuli-window', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'toggleDevTools' }),
      })
      const body = await resp.json().catch(() => ({})) as { ok?: boolean; available?: boolean; error?: string }
      if (body.available === false) {
        setNotice('当前不是 Electron 桌面版，请直接用浏览器 F12 打开开发者工具')
      } else if (body.ok !== true) {
        setNotice(typeof body.error === 'string' ? body.error : '开发者工具打开失败')
      }
    } catch {
      setNotice('开发者工具请求失败（Host 路由不可达）')
    } finally {
      setDevtoolsBusy(false)
    }
  }

  useEffect(() => {
    if (notice === null) return
    const timer = window.setTimeout(() => { setNotice(null) }, 2600)
    return () => { window.clearTimeout(timer) }
  }, [notice])

  /* ── 展开时把球 + 竖向菜单完整拉回窗口内 ──
     菜单绝对定位在球旁：默认在球右侧、顶边对齐球顶向下展开；
     根据球的位置动态调整——右侧放不下且左侧放得下 → 翻到球左侧（data-menu-left）；
     下方放不下且上方放得下 → 改为底边对齐球底向上展开（data-menu-bottom）。
     root 只承载球本体，夹取按「球 ∪ 菜单」的并集矩形计算；
     方向判定与夹取分两步：先定方向（等重渲染挂上翻转类），再按最终 rect 夹取。 */
  useLayoutEffect(() => {
    if (!open) return
    const el = rootRef.current
    const t = toolbarRef.current
    if (el === null || t === null) return
    const vw = window.innerWidth
    const vh = window.innerHeight
    const r = el.getBoundingClientRect()
    const menuW = t.offsetWidth
    const menuH = t.offsetHeight
    // 水平方向：默认球右侧，右侧放不下且左侧放得下 → 翻到球左侧
    const wantLeft = vw - (r.right + 8) < menuW && r.left - 8 >= menuW
    // 垂直方向：默认顶边对齐球顶向下展开，下方放不下且上方放得下 → 底边对齐向上展开
    const wantBottom = r.top + menuH > vh - 8 && r.bottom - menuH >= 8
    if (wantLeft !== menuLeft || wantBottom !== menuBottom) {
      setMenuLeft(wantLeft)
      setMenuBottom(wantBottom)
      return
    }
    // 夹取：球与菜单的并集矩形保持在视口内（偏移同时作用于两者）
    const tr = t.getBoundingClientRect()
    const left = Math.min(r.left, tr.left)
    const top = Math.min(r.top, tr.top)
    const width = Math.max(r.right, tr.right) - left
    const height = Math.max(r.bottom, tr.bottom) - top
    const p = posRef.current
    const dLeft = left - p.left
    const dTop = top - p.top
    let nl = p.left
    let nt = p.top
    if (nl + dLeft < 8) nl = 8 - dLeft
    if (nl + dLeft + width > vw - 8) nl = vw - 8 - width - dLeft
    if (nt + dTop < 8) nt = 8 - dTop
    if (nt + dTop + height > vh - 8) nt = vh - 8 - height - dTop
    nl = Math.max(0, nl)
    nt = Math.max(0, nt)
    if (nl !== p.left || nt !== p.top) applyPos({ left: nl, top: nt })
  }, [open, menuLeft, menuBottom])
  /* ── 工具栏热键：Alt+Shift+<首字母> 直接触发工具；F12 打开侧边开发者工具 ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F12') {
        e.preventDefault()
        setOpen(true)
        void toggleDevTools()
        return
      }
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
      } else if (k === 'i') {
        e.preventDefault()
        setOpen(true)
        void toggleDevTools()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [picking, toggleDevTools])
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
      // 点击：若处于半隐藏吸附，先滑出完整再展开工具栏，并记住原吸附边，
      // 关闭菜单时回到原位置吸附隐藏（见下方 next 分支）。
      if (snapped !== null) {
        returnSnap.current = snapped
        const vw = window.innerWidth
        const vh = window.innerHeight
        const p = posRef.current
        const el = rootRef.current
        // hover 滑出时球已在完整视觉位置（transform 偏移，left 属性仍在半隐藏位）：
        // 直接按当前视觉 rect 落定并临时禁过渡，避免 left 过渡与 transform 归零
        // 不同步——点击瞬间先跳回半隐藏位、再播放滑动画到另一个位置。
        if (hovered && el !== null) {
          const r = el.getBoundingClientRect()
          el.style.transition = 'none'
          applyPos({ left: r.left, top: r.top })
          requestAnimationFrame(() => { el.style.transition = '' })
        } else {
          const full: Pos = snapped === 'left' ? { left: 8, top: p.top }
            : snapped === 'right' ? { left: vw - BALL - 8, top: p.top }
              : snapped === 'top' ? { left: p.left, top: 8 }
                : { left: p.left, top: vh - BALL - 8 }
          applyPos(full)
        }
        setSnapped(null)
      }
      const next = !open
      if (!next && returnSnap.current !== null) {
        // 从展开态关闭且展开前处于吸附 → 恢复原位置吸附半隐藏
        const side = returnSnap.current
        returnSnap.current = null
        const vw = window.innerWidth
        const vh = window.innerHeight
        const p = posRef.current
        const target: Pos = side === 'left' ? { left: -BALL + PEEK, top: p.top }
          : side === 'right' ? { left: vw - PEEK, top: p.top }
            : side === 'top' ? { left: p.left, top: -BALL + PEEK }
              : { left: p.left, top: vh - PEEK }
        applyPos(target)
        setSnapped(side)
      }
      setOpen(next)
      return
    }
    // 拖拽松手：不再回弹到点击展开前的吸附位
    returnSnap.current = null
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
      label: pickerMode === 'inspect' ? '元素检查' : '元素选择器',
      hint: pickerMode === 'inspect'
        ? '检查模式：点击元素在 DevTools 中定位（相当于右键→检查；Alt+Shift+E）'
        : '悬停高亮页面元素，点击拾取并插入聊天（Alt+Shift+E）',
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
      extra: (
        <button
          key="element-picker-mode"
          type="button"
          className={css.modeBtn + (pickerMode === 'inspect' ? ' ' + css.modeBtnActive : '')}
          aria-pressed={pickerMode === 'inspect'}
          title={pickerMode === 'inspect' ? '当前：检查模式（点击元素 → DevTools 定位）' : '当前：插入聊天模式（点击元素 → 插入聊天）'}
          onClick={() => { setPickerMode(mode => mode === 'inspect' ? 'insert' : 'inspect') }}
        >
          {pickerMode === 'inspect' ? '检查' : '插入'}
        </button>
      ),
    },
    {
      id: 'devtools',
      label: '开发者工具',
      hint: '打开/关闭 Electron 侧边开发者工具（F12 或 Alt+Shift+I）',
      hotkey: 'F12',
      icon: <DevToolsIcon size={15} />,
      onSelect: () => { void toggleDevTools() },
    },
  ]
  if (openLayoutMenu !== undefined) {
    tools.push({
      id: 'dock-layout-menu',
      label: '布局工作台',
      hint: '自定义当前布局：面板拖拽/停靠/拆分/浮动/标签合并、布局保存与恢复（Ctrl+Alt+L）',
      hotkey: 'Ctrl+Alt+L',
      icon: (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path fill="currentColor" d="M2 3.2c0-.66.54-1.2 1.2-1.2h9.6c.66 0 1.2.54 1.2 1.2v9.6c0 .66-.54 1.2-1.2 1.2H3.2c-.66 0-1.2-.54-1.2-1.2V3.2zm1.2 0v9.6h9.6V3.2H3.2zm1.6 1.6h2.8v2.8H4.8V4.8zm4.8 0h1.6v1.6H9.6V4.8zm0 3.2h1.6v1.6H9.6V8zm-4.8 0h2.8v2.8H4.8V8z" />
        </svg>
      ),
      onSelect: () => { openLayoutMenu() },
    })
  }

  /* 工具栏展开方向：菜单竖向浮在球上方（下方空间不足时翻到球下方） */
  return (
    <>
      <div
        ref={rootRef}
        className={css.root + (dragging ? ' ' + css.dragging : '')}
        data-snapped={snapped ?? undefined}
        data-hovered={hovered || undefined}
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
          <div ref={toolbarRef} className={css.toolbar} data-menu-left={menuLeft || undefined} data-menu-bottom={menuBottom || undefined} role="toolbar" aria-label="琉璃工具">
            {tools.map(tool => (
              <div className={css.toolGroup} key={tool.id}>
                <button
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
                {tool.extra}
              </div>
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

      {/* 轻提示（开发者工具不可用/失败时） */}
      {notice !== null && createPortal(
        <div className={css.notice} role="status" data-liuli-picker-ignore="">{notice}</div>,
        document.body,
      )}
    </>
  )
}
