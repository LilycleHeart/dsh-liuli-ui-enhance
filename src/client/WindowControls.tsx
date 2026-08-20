/**
 * 琉璃主题 · 页面内窗口控制按钮（DSH Desktop advanced 无边框模式）。
 *
 * 无边框窗口没有系统标题栏按钮；本组件在页面内补回最小化/最大化(还原)/关闭，
 * 固定悬浮在窗口右上角 —— 开始页与会话页保持完全一致的磨砂胶囊（与开始页
 * 的兜底变体同款，见 WindowControls.module.css）。
 *
 * 智能避让：胶囊 viewport 固定，在可停靠工作台布局下可能压住右上角的交互
 * 元素（会话 header 工具按钮 / 右侧详情面板头部 / dock 浮动窗口标题栏等）。
 * 组件周期检测胶囊矩形内的命中元素，发现交互内容即加 .hidden 淡出（不拦截
 * 下方点击）；鼠标移入右上角检测区（纯坐标判定、不占 DOM）时重新唤出。
 *
 * 动作经插件节点半 /liuli-window 路由调用 Electron 主进程窗口 API
 * （host-window.ts）；close 与原生关闭同语义（收进托盘）。仅 win32 + advanced
 * 且路由 available 时渲染（macOS 红绿灯内嵌、纯 Web 无窗口概念）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import css from './WindowControls.module.css'

/** Whether the current page is the win32 frameless desktop shell. */
export function isFramelessWin32(): boolean {
  const params = new URLSearchParams(window.location.search)
  return params.get('dsh-desktop-mode') === 'advanced'
    && params.get('dsh-desktop-platform') === 'win32'
}

interface WindowControlsState {
  /** 路由探测结果：false（纯 Web / 非 Electron）时整组隐藏。 */
  available: boolean
  maximized: boolean
}

/** 拉取窗口状态（GET /liuli-window）。 */
async function fetchWindowState(): Promise<WindowControlsState | undefined> {
  try {
    const res = await fetch('/liuli-window', { headers: { accept: 'application/json' } })
    if (!res.ok) return undefined
    const data = await res.json() as { available?: boolean; maximized?: boolean }
    if (data.available !== true) return { available: false, maximized: false }
    return { available: true, maximized: data.maximized === true }
  } catch {
    return undefined
  }
}

/** 发送一个窗口动作（POST /liuli-window）。 */
async function postWindowAction(action: 'minimize' | 'toggleMaximize' | 'close'): Promise<void> {
  try {
    await fetch('/liuli-window', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ action }),
    })
  } catch { /* 宿主路由不可达时按钮无动作即可 */ }
}

/* ── 智能避让 ─────────────────────────────────────────────────── */

/** 命中即判定"遮挡"的交互元素选择器：胶囊矩形内出现这些就自动避让。 */
const INTERACTIVE_SELECTOR = [
  'button', 'a', 'input', 'select', 'textarea', 'label',
  '[contenteditable]',
  '[role="button"]', '[role="tab"]', '[role="menuitem"]', '[role="switch"]',
  '[role="checkbox"]', '[role="radio"]', '[role="combobox"]', '[role="listbox"]',
  '[data-testid="dock-tab-chip"]',
].join(', ')

/** 右上角悬停检测区尺寸（纯坐标判定；胶囊自身位于其内）。 */
const REVEAL_W = 140
/** 展开保持区高度：胶囊已展开时，指针仍在此范围内就不隐藏（防抖/防误触）。 */
const REVEAL_H = 48
/** 展开触发区高度：仅指针进入最顶部这一小条范围才唤出胶囊；
    触发更精准，避免误碰标题行按钮区域就弹出。 */
const TRIGGER_H = 16

/** 命中元素是否属于"应避让"的交互内容（向上找最近的交互祖先）。 */
function isInteractiveHit(el: Element): boolean {
  return el.closest(INTERACTIVE_SELECTOR) !== null
}

/** 最小化图标（横线）。 */
function MinimizeIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
      <path d="M2.6 6h6.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** 最大化图标（方框）。 */
function MaximizeIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
      <rect x="2.6" y="2.6" width="6.8" height="6.8" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/** 还原图标（双方框）。 */
function RestoreIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
      <rect x="4.2" y="2" width="6" height="6" rx="1.1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2 5.4v3A1.6 1.6 0 0 0 3.6 10h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** 关闭图标（叉）。 */
function CloseIcon() {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** 页面内窗口控制按钮组。 */
export function WindowControls() {
  const [state, setState] = useState<WindowControlsState>({ available: false, maximized: false })
  /** 避让隐藏态：遮挡交互元素时淡出；悬停右上角检测区唤出。 */
  const [hidden, setHidden] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const hiddenRef = useRef(false)
  hiddenRef.current = hidden
  // 页面生命周期内恒定（URL 查询参数由桌面启动器写入，不再变化）。
  const enabled = isFramelessWin32()

  const refresh = useCallback(async (): Promise<void> => {
    const next = await fetchWindowState()
    if (next === undefined) {
      // 路由暂不可达（节点半未就绪）：保持按钮隐藏并稍后重试。
      setState(s => ({ ...s, available: false }))
      return
    }
    setState(next)
  }, [])

  useEffect(() => {
    if (!enabled) return () => {}
    let cancelled = false
    void refresh()
    // 节点半路由注册可能晚于前端首渲染：短轮询探测直到可用即停。
    const probe = window.setInterval(async () => {
      const next = await fetchWindowState()
      if (cancelled) return
      if (next?.available === true) {
        setState(next)
        window.clearInterval(probe)
      }
    }, 2500)
    return () => { cancelled = true; window.clearInterval(probe) }
  }, [enabled, refresh])

  useEffect(() => {
    if (!enabled) return () => {}
    // 最大化/还原/贴边（Win+方向键）都会触发 resize：借此同步图标态。
    const onResize = (): void => { void refresh() }
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize) }
  }, [enabled, refresh])

  // ── 智能避让：遮挡检测 + 悬停唤出（一个 effect 共享调度与指针状态）──
  useEffect(() => {
    if (!enabled) return () => {}
    let raf = 0
    // 与 hidden 状态对应的"检测器上次判定"；悬停唤出时复位，保证离开后能重新评估
    let last = false
    const pointer = { x: -1, y: -1 }
    // 保持区（REVEAL_H）：胶囊已展开时在此范围内不隐藏
    const inHoldZone = (): boolean => pointer.x > window.innerWidth - REVEAL_W && pointer.y < REVEAL_H
    // 触发区（TRIGGER_H）：指针进入最顶部一半才唤出胶囊
    const inTriggerZone = (): boolean => pointer.x > window.innerWidth - REVEAL_W && pointer.y < TRIGGER_H
    const check = (): void => {
      raf = 0
      const el = rootRef.current
      if (el === null) return
      // 指针在保持区内：悬停唤出优先，暂不评估（离开保持区后由 onMove 触发重评估）
      if (inHoldZone()) return
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      // 胶囊矩形内采样 2×2 点，命中交互元素即判定遮挡
      const xs = [r.left + r.width * 0.25, r.left + r.width * 0.75]
      const ys = [r.top + r.height * 0.25, r.top + r.height * 0.75]
      let overlapping = false
      outer:
      for (const x of xs) {
        for (const y of ys) {
          for (const h of document.elementsFromPoint(x, y)) {
            // 跳过胶囊自身/后代、其他窗口控制宿主、开始页拖动条
            if (h === el || el.contains(h)) continue
            if (h.hasAttribute('data-liuli-window-controls')) continue
            if (h.hasAttribute('data-liuli-pane-drag')) continue
            if (isInteractiveHit(h)) { overlapping = true; break outer }
          }
        }
      }
      if (overlapping !== last) {
        last = overlapping
        setHidden(overlapping)
      }
    }
    const schedule = (): void => { if (raf === 0) raf = requestAnimationFrame(check) }
    const onMove = (e: PointerEvent): void => {
      pointer.x = e.clientX
      pointer.y = e.clientY
      if (inTriggerZone()) {
        // 悬停唤出：显示胶囊（复位 last，离开保持区后能重新评估隐藏）
        if (hiddenRef.current) {
          last = false
          setHidden(false)
        }
      } else {
        schedule()
      }
    }
    check()
    // body 级观察：浮动窗口移动/详情面板开合/header 变化都会触发重评估
    const mo = new MutationObserver(schedule)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      mo.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('pointermove', onMove)
    }
  }, [enabled])

  if (!enabled || !state.available) return null

  const act = (action: 'minimize' | 'toggleMaximize' | 'close'): void => {
    void postWindowAction(action).then(() => refresh())
  }

  return (
    <>
    <div
      ref={rootRef}
      className={`${css.controls}${hidden ? ' ' + css.hidden : ''}`}
      data-liuli-window-controls="caption"
    >
      <button type="button" className={css.btn} title="最小化" aria-label="最小化窗口" onClick={() => { act('minimize') }}>
        <MinimizeIcon />
      </button>
      <button
        type="button"
        className={css.btn}
        title={state.maximized ? '向下还原' : '最大化'}
        aria-label={state.maximized ? '向下还原窗口' : '最大化窗口'}
        onClick={() => { act('toggleMaximize') }}
      >
        {state.maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button type="button" className={`${css.btn} ${css.close}`} title="关闭" aria-label="关闭窗口（收进托盘）" onClick={() => { act('close') }}>
        <CloseIcon />
      </button>
    </div>
    {/* 收起提示条：胶囊避让隐藏时，右上角顶部显示一条小横条，提示鼠标移向此处唤出 */}
    <div
      className={`${css.hint}${hidden ? '' : ' ' + css.hintHidden}`}
      data-liuli-window-controls-hint=""
      aria-hidden="true"
    />
    </>
  )
}
