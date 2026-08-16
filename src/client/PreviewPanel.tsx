/** 预览面板：右侧 overlay + 同源 iframe（/preview/<sessionId>/）+ 元素选择器。 */

import { useEffect, useRef, useState } from 'react'
import { attachElementPicker, describeElement, type PickedElement } from './element-picker.ts'
import css from './PreviewPanel.module.css'

/** 预览面板根组件（独立 React root，FloatBall 同款挂载方式）。 */
export interface PreviewPanelProps {
  /** 当前会话 id 订阅（null 表示无会话）。 */
  subscribeSession: (fn: (sessionId: string | null) => void) => () => void
  /** 把拾取的元素作为引用 chip 插入当前会话输入框。 */
  insertElement: (info: PickedElement) => void
}

/** 打开/关闭事件名（header 按钮与面板通过 window 事件解耦）。 */
export const PREVIEW_TOGGLE_EVENT = 'liuli:preview-toggle'

/**
 * Render the floating preview panel.
 * @param props - session subscription and element-insert callbacks.
 * @returns the panel tree, or null while closed.
 */
export function PreviewPanel({ subscribeSession, insertElement }: PreviewPanelProps) {
  const [open, setOpen] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [frameTick, setFrameTick] = useState(0)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => subscribeSession(setSessionId), [subscribeSession])

  useEffect(() => {
    const onToggle = (): void => { setOpen(v => !v) }
    window.addEventListener(PREVIEW_TOGGLE_EVENT, onToggle)
    return () => { window.removeEventListener(PREVIEW_TOGGLE_EVENT, onToggle) }
  }, [])

  // 打开且 iframe 就绪时，对 iframe 文档挂元素选择器（同源）：悬停高亮，
  // 点击把元素作为引用 chip 插入输入框。面板自身 chrome 保持可交互。
  useEffect(() => {
    if (!open) return
    const frame = frameRef.current
    const doc = frame?.contentDocument
    if (doc === null || doc === undefined) return
    return attachElementPicker(doc, {
      onPick: (el) => { insertElement(describeElement(el)) },
    }, panelRef.current)
  }, [open, sessionId, frameTick, insertElement])

  if (!open) return null
  return (
    <div ref={panelRef} className={css.panel} data-preview-panel="">
      <div className={css.bar}>
        <span className={css.title}>工作区预览</span>
        <button
          type="button" className={css.close} aria-label="关闭预览"
          onClick={() => { setOpen(false) }}
        >
          ✕
        </button>
      </div>
      {sessionId === null ? (
        <div className={css.empty}>打开一个会话后，这里预览其工作区页面</div>
      ) : (
        <iframe
          ref={frameRef}
          className={css.frame}
          title="工作区预览"
          src={`/preview/${encodeURIComponent(sessionId)}/`}
          onLoad={() => { setFrameTick(t => t + 1) }}
        />
      )}
    </div>
  )
}

/** Header utilities 里的开关按钮：点击广播切换事件。 */
export function PreviewButton() {
  return (
    <button
      type="button"
      className={css.openBtn}
      title="预览工作区"
      aria-label="预览工作区"
      onClick={() => { window.dispatchEvent(new CustomEvent(PREVIEW_TOGGLE_EVENT)) }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
        />
      </svg>
    </button>
  )
}
