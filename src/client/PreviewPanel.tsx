/** 预览面板：宿主右侧 details 列 + 同源 iframe（/preview/<sessionId>/）+ 浏览器模式 + 元素选择器。 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { attachElementPicker, describeElement, type PickedElement } from './element-picker.ts'
import css from './PreviewPanel.module.css'

/** 打开/关闭事件名（保留给外部触发，按钮现在直接走 ctx.layout）。 */
export const PREVIEW_TOGGLE_EVENT = 'liuli:preview-toggle'

/** 导航事件名：会话内点击前端产物时由全局点击拦截器广播。 */
export const PREVIEW_NAVIGATE_EVENT = 'liuli:preview-navigate'

/** 预览列开关的模块级状态（header 按钮与 details 面板共享）。 */
let previewOpen = false

/** 翻转预览列开关状态，返回翻转后的值。 */
export function togglePreviewOpen(): boolean {
  previewOpen = !previewOpen
  return previewOpen
}

/** 设置预览列开关状态（关闭按钮/会话切换时同步）。 */
export function setPreviewOpen(open: boolean): void {
  previewOpen = open
}

/** Material Icons：产物（folder）。 */
function ArtifactsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  )
}

/** Material Icons：浏览器（language）。 */
function BrowserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z" />
    </svg>
  )
}

/** 判断是否为本地回环地址（前端产物 dev server 常见目标）。 */
function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '0.0.0.0'
    || hostname.endsWith('.localhost')
}

/** 粗略识别“前端产物”相对路径：HTML 文件或常见前端构建输出目录。 */
function looksLikeFrontendPath(path: string): boolean {
  return /\.html?$/i.test(path)
    || /(^|\/)(dist|build|public|out|docs)(\/|$)/i.test(path)
    || path.startsWith('/preview/')
}

/**
 * 把会话内点击的链接解析为预览 iframe 可用的 URL。
 * - 本地回环绝对 URL（localhost/127.0.0.1 dev server）→ 原样交给浏览器模式；
 * - `/preview/...` → 原样；
 * - 相对路径（HTML/前端构建产物）→ 映射到 `/preview/<sessionId>/<path>`；
 * - 外部站点链接 → 返回 undefined，不劫持。
 */
export function resolvePreviewUrl(raw: string, sessionId: string | undefined): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined

  // 无 scheme 的 localhost:port 补成 http://，方便用户直接点“localhost:3000”。
  let candidate = trimmed
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d/i.test(candidate)) {
    candidate = `http://${candidate}`
  }

  // 绝对 URL：只劫持本地回环；外部链接保持原浏览器行为。
  if (/^https?:\/\//i.test(candidate) || /^\/\//.test(candidate)) {
    try {
      const url = new URL(candidate, window.location.href)
      if (isLoopbackHost(url.hostname)) return url.href
    } catch {
      return undefined
    }
    return undefined
  }

  if (sessionId === undefined || sessionId === null) return undefined
  if (candidate.startsWith('/preview/')) return candidate
  if (!looksLikeFrontendPath(candidate)) return undefined

  const clean = candidate.replace(/^\.\//, '').replace(/^\/+/, '')
  const encoded = clean.split('/').map(segment => encodeURIComponent(segment)).join('/')
  return `/preview/${encodeURIComponent(sessionId)}/${encoded}`
}

/** 预览列组件（宿主 details 列占用者）。 */
export interface PreviewDetailsPanelProps {
  /** 当前会话 id（由 details slot 注入）。 */
  sessionId?: string
  /** 打开 details 列（由 layout 注入，供导航事件把列展开）。 */
  openDetails?: () => void
  /** 关闭 details 列（由 layout 注入）。 */
  closeDetails?: () => void
  /** 把拾取的元素作为引用 chip 插入当前会话输入框。 */
  insertElement: (info: PickedElement) => void
}

/**
 * Render the preview details column.
 * @param props - session id, layout open/close callbacks, and element-insert callback.
 * @returns the column tree.
 */
export function PreviewDetailsPanel({ sessionId, openDetails, closeDetails, insertElement }: PreviewDetailsPanelProps) {
  const [open, setOpen] = useState(previewOpen)
  const [mode, setMode] = useState<'artifacts' | 'browser'>('artifacts')
  const [browserUrl, setBrowserUrl] = useState('about:blank')
  const [draftUrl, setDraftUrl] = useState('')
  const [frameTick, setFrameTick] = useState(0)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const lastSession = useRef(sessionId)

  // header 按钮翻转模块状态后广播事件，面板同步为最新的开关状态。
  useEffect(() => {
    const onToggle = (): void => { setOpen(previewOpen) }
    window.addEventListener(PREVIEW_TOGGLE_EVENT, onToggle)
    return () => { window.removeEventListener(PREVIEW_TOGGLE_EVENT, onToggle) }
  }, [])

  // 会话内点击前端产物：切到浏览器模式并展开右侧列。
  useEffect(() => {
    const onNavigate = (e: Event): void => {
      const detail = (e as CustomEvent<{ url?: string }>).detail
      const url = detail?.url
      if (url === undefined || url === '') return
      setMode('browser')
      setBrowserUrl(url)
      setDraftUrl(url)
      setOpen(true)
      setPreviewOpen(true)
      openDetails?.()
    }
    window.addEventListener(PREVIEW_NAVIGATE_EVENT, onNavigate)
    return () => { window.removeEventListener(PREVIEW_NAVIGATE_EVENT, onNavigate) }
  }, [openDetails])

  // details 列始终挂载（宽度 0 时不可见）：用 ResizeObserver 跟随真实列宽，
  // 外部打开 details 时也能自动切到预览内容，并在列收起时复位开关。
  useLayoutEffect(() => {
    const el = panelRef.current
    if (el === null) return
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (width > 1) {
        setPreviewOpen(true)
        setOpen(true)
      } else {
        setPreviewOpen(false)
        setOpen(false)
      }
    })
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [])

  // 切换会话时宿主会自动收起 details 列，这里同步预览开关状态。
  useEffect(() => {
    if (lastSession.current !== undefined && lastSession.current !== sessionId) {
      setPreviewOpen(false)
      setOpen(false)
    }
    lastSession.current = sessionId
  }, [sessionId])

  // 打开且 iframe 就绪时，对 iframe 文档挂元素选择器（同源）：悬停高亮，
  // 点击把元素作为引用 chip 插入输入框。面板自身 chrome 保持可交互。
  useEffect(() => {
    if (!open || sessionId === undefined || sessionId === null || mode !== 'artifacts') return
    const frame = frameRef.current
    const doc = frame?.contentDocument
    if (doc === null || doc === undefined) return
    return attachElementPicker(doc, {
      onPick: (el) => { insertElement(describeElement(el)) },
    }, panelRef.current)
  }, [open, sessionId, mode, frameTick, insertElement])

  const close = (): void => {
    setPreviewOpen(false)
    setOpen(false)
    closeDetails?.()
  }

  const navigate = (raw: string): void => {
    const url = resolvePreviewUrl(raw, sessionId)
    if (url === undefined) return
    setMode('browser')
    setBrowserUrl(url)
    setDraftUrl(url)
  }

  const artifactsSrc = sessionId === undefined || sessionId === null
    ? 'about:blank'
    : `/preview/${encodeURIComponent(sessionId)}/?artifacts=1`

  return (
    <div ref={panelRef} className={css.panel} data-preview-panel="">
      <div className={css.bar}>
        <span className={css.title}>工作区预览</span>
        <div className={css.modeSwitch} role="group" aria-label="预览模式">
          <button
            type="button"
            className={css.modeBtn + (mode === 'artifacts' ? ' ' + css.modeActive : '')}
            aria-pressed={mode === 'artifacts'}
            onClick={() => { setMode('artifacts') }}
          >
            <ArtifactsIcon />
            <span>产物</span>
          </button>
          <button
            type="button"
            className={css.modeBtn + (mode === 'browser' ? ' ' + css.modeActive : '')}
            aria-pressed={mode === 'browser'}
            onClick={() => { setMode('browser') }}
          >
            <BrowserIcon />
            <span>浏览器</span>
          </button>
        </div>
        <button
          type="button" className={css.close} aria-label="关闭预览"
          onClick={close}
        >
          ✕
        </button>
      </div>

      {mode === 'browser' && (
        <form
          className={css.browserBar}
          onSubmit={(e) => { e.preventDefault(); navigate(draftUrl) }}
        >
          <input
            className={css.browserInput}
            value={draftUrl}
            onChange={(e) => { setDraftUrl(e.target.value) }}
            placeholder="输入 localhost 或 /preview/... 地址"
            spellCheck={false}
          />
          <button type="submit" className={css.browserGo}>前往</button>
        </form>
      )}

      {!open || sessionId === undefined || sessionId === null ? (
        <div className={css.empty}>打开一个会话后，这里显示会话产物</div>
      ) : mode === 'browser' ? (
        <iframe
          ref={frameRef}
          className={css.frame}
          title="浏览器预览"
          src={browserUrl}
          onLoad={() => { setFrameTick(t => t + 1) }}
        />
      ) : (
        <iframe
          ref={frameRef}
          className={css.frame}
          title="会话产物"
          src={artifactsSrc}
          onLoad={() => { setFrameTick(t => t + 1) }}
        />
      )}
    </div>
  )
}

/** Header utilities 里的开关按钮：点击展开/收起右侧预览列。 */
export function PreviewButton({ onToggle }: { onToggle?: () => void }) {
  return (
    <button
      type="button"
      className={css.openBtn}
      title="预览工作区"
      aria-label="预览工作区"
      onClick={() => {
        if (onToggle !== undefined) onToggle()
        else window.dispatchEvent(new CustomEvent(PREVIEW_TOGGLE_EVENT))
      }}
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
