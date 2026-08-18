/**
 * 琉璃主题 · 页面内窗口控制按钮（DSH Desktop advanced 无边框模式）。
 *
 * 无边框窗口没有系统标题栏按钮；本组件在页面内补回最小化/最大化(还原)/关闭：
 * - variant="header"：注入会话 header utilities 最右端（有会话时常驻）；
 * - variant="caption"：开始页（无会话 header）兜底，固定在标题拖拽条右侧。
 *
 * 动作经插件节点半 /liuli-window 路由调用 Electron 主进程窗口 API
 * （host-window.ts）；close 与原生关闭同语义（收进托盘）。仅 win32 + advanced
 * 且路由 available 时渲染（macOS 红绿灯内嵌、纯 Web 无窗口概念）。
 */
import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
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
export function WindowControls(props: { variant: 'header' | 'caption' }) {
  const [state, setState] = useState<WindowControlsState>({ available: false, maximized: false })
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

  if (!enabled || !state.available) return null

  const act = (action: 'minimize' | 'toggleMaximize' | 'close'): void => {
    void postWindowAction(action).then(() => refresh())
  }

  return (
    <div className={clsx(css.controls, props.variant === 'caption' && css.caption)} data-liuli-window-controls={props.variant}>
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
      <button type="button" className={clsx(css.btn, css.close)} title="关闭" aria-label="关闭窗口（收进托盘）" onClick={() => { act('close') }}>
        <CloseIcon />
      </button>
    </div>
  )
}
