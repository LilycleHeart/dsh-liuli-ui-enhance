/**
 * 琉璃主题 · 审查文件面板（ZCode 审查功能对齐版）。
 *
 * 对齐 ZCode 侧边面板的「审查(git)」标签（XWt git pane）：
 * - 顶栏：源切换（未暂存 / 已暂存）+ 刷新；
 * - 文件列表：每行显示 文件名 + 目录 + +添加/−删除 统计，可折叠；
 * - 展开后内联展示该文件的 diff（未跟踪文本文件展示纯文本内容）；
 * - 右键菜单：打开 / 在文件管理器中打开 / 复制绝对路径 / 复制相对路径 / 在文件树中显示；
 * - 空状态区分：Git 不可用 / 非 Git 仓库 / 工作区干净。
 *
 * 同时订阅轮次卡片（TurnFileCard）的「审查」按钮事件：选中文件并展开。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  fetchSidebarDiff, fetchSidebarGit, revealSidebarPath, revealToast,
  type SidebarDiffPayload, type SidebarGitChange, type SidebarGitPayload, type SidebarGitSourceId,
} from './right-sidebar-api.ts'
import { consumeReviewRequest, REVIEW_FILE_EVENT } from './review-bus.ts'
import { getLastTurnChanges, subscribeLastTurnChanges } from './turn-file-store.ts'
import type { FileDiffHunk } from './TurnFileCard.tsx'
import { resolveDriveTarget, type ReviewPanelRequest } from './review-drive.ts'
import css from './FileReviewPanel.module.css'

export { resolveDriveTarget, type ReviewPanelRequest } from './review-drive.ts'

declare global {
  interface Window { __liuliDiffCache?: Map<string, readonly FileDiffHunk[]> }
}

export interface FileReviewPanelProps {
  sessionId?: string | undefined
  onOpenPath?: ((path: string) => void) | undefined
  /** 宿主面板（PreviewDetailsPanel）驱动的审查请求。 */
  reviewRequest?: ReviewPanelRequest | null
  /** 在文件树中定位当前文件（ZCode git.changeContext.revealInFileTree 对应）。 */
  onRevealInFileTree?: ((path: string) => void) | undefined
}

type DiffKind = 'hunk' | 'add' | 'del' | 'meta' | 'ctx'

/* ── diff 容器高度记忆（跨文件/跨会话保留） ── */

const DIFF_PANE_HEIGHT_KEY = 'liuli:diff-pane-height'
const DIFF_PANE_HEIGHT_DEFAULT = 220
const DIFF_PANE_HEIGHT_MIN = 120

function diffPaneMaxHeight(): number {
  return Math.max(DIFF_PANE_HEIGHT_MIN, Math.round(window.innerHeight * 0.65))
}

function clampDiffPaneHeight(height: number): number {
  return Math.min(diffPaneMaxHeight(), Math.max(DIFF_PANE_HEIGHT_MIN, Math.round(height)))
}

function readDiffPaneHeight(): number {
  try {
    const raw = localStorage.getItem(DIFF_PANE_HEIGHT_KEY)
    if (raw === null) return DIFF_PANE_HEIGHT_DEFAULT
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return DIFF_PANE_HEIGHT_DEFAULT
    return clampDiffPaneHeight(parsed)
  } catch {
    return DIFF_PANE_HEIGHT_DEFAULT
  }
}

function saveDiffPaneHeight(height: number): void {
  try {
    localStorage.setItem(DIFF_PANE_HEIGHT_KEY, String(clampDiffPaneHeight(height)))
  } catch {
    // localStorage 不可用时静默失败。
  }
}

/* ── 路径工具（与 TurnFileCard 一致） ── */

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}
function relOf(path: string, root: string | undefined): string {
  if (root === undefined || root === '') return path
  const rootNorm = normPath(root)
  const pathNorm = normPath(path)
  if (pathNorm.startsWith(rootNorm + '/')) return pathNorm.slice(rootNorm.length + 1)
  return pathNorm
}
function absOf(path: string, root: string | undefined): string {
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\')) return path
  if (root === undefined || root === '') return path
  return root.replace(/[\\/]+$/, '') + '/' + relOf(path, root)
}
function basenameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}
function dirnameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? '' : path.slice(0, at)
}

/** 复制文本到剪贴板（带降级）。 */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 剪贴板不可用（非安全上下文）时静默失败。
  }
}

/** 把 unified diff 文本切成带类型的行（@@ hunk / +add / -del / ---+++ meta / 上下文）。 */
function parseDiffRows(diff: string): Array<{ kind: DiffKind; text: string }> {
  const lines = diff.replace(/\r\n/g, '\n').split('\n')
  const rows: Array<{ kind: DiffKind; text: string }> = []
  for (const line of lines) {
    if (/^@@/.test(line)) { rows.push({ kind: 'hunk', text: line }); continue }
    if (/^\+\+\+/.test(line) || /^---/.test(line)) { rows.push({ kind: 'meta', text: line }); continue }
    if (/^\+/.test(line)) { rows.push({ kind: 'add', text: line }); continue }
    if (/^-/.test(line)) { rows.push({ kind: 'del', text: line }); continue }
    rows.push({ kind: 'ctx', text: line })
  }
  return rows
}

/** Diff 视图：按行着色。 */
function DiffView({ diff }: { diff: string }) {
  const rows = useMemo(() => parseDiffRows(diff), [diff])
  if (diff === '') {
    return <div className={css.empty}>没有 diff（文件未纳入版本控制或与 HEAD 一致）</div>
  }
  return (
    <pre className={css.diffPre}>
      {rows.map((row, index) => (
        <div key={index} className={css.diffLine} data-kind={row.kind}>{row.text || ' '}</div>
      ))}
    </pre>
  )
}

/** 纯文本视图（未跟踪文件）：按行展示，不使用 diff 符号。 */
function PlainTextView({ content }: { content: string }) {
  const lines = useMemo(() => content.replace(/\r\n/g, '\n').split('\n'), [content])
  return (
    <pre className={css.plainPre}>
      {lines.map((line, index) => (
        <div key={index} className={css.plainLine}>{line || ' '}</div>
      ))}
    </pre>
  )
}

function Chevron() {
  return (
    <svg className={css.chevron} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
    </svg>
  )
}

/* ── 文件类型图标（Material Icons，按扩展名区分，让文件列表不再单调） ── */

type FileIconKind = 'code' | 'image' | 'data' | 'doc' | 'settings' | 'default'

const CODE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'css', 'scss', 'less', 'html', 'htm', 'vue', 'svelte', 'php', 'rb', 'swift', 'kt', 'sql', 'sh', 'bash', 'zsh', 'lua', 'r', 'scala', 'dart', 'ex', 'exs'])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif', 'apng'])
const DATA_EXTS = new Set(['json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'csv', 'tsv', 'lock'])
const DOC_EXTS = new Set(['md', 'markdown', 'txt', 'doc', 'docx', 'pdf', 'rtf', 'tex', 'rst'])

/** Material Icons 路径（24×24 viewBox）。 */
const FILE_ICON_PATHS: Record<FileIconKind, string> = {
  code: 'M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
  image: 'M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z',
  data: 'M4 7v2c0 .55-.45 1-1 1H2v4h1c.55 0 1 .45 1 1v2c0 1.65 1.35 3 3 3h3v-2H7c-.55 0-1-.45-1-1v-2c0-1.3-.84-2.42-2-2.83v-.34C5.16 11.42 6 10.3 6 9V7c0-.55.45-1 1-1h3V4H7C5.35 4 4 5.35 4 7zm17 3h-1c-.55 0-1-.45-1-1V7c0-1.65-1.35-3-3-3h-3v2h3c.55 0 1 .45 1 1v2c0 1.3.84 2.42 2 2.83v.34c-1.16.41-2 1.52-2 2.83v2c0 .55-.45 1-1 1h-3v2h3c1.65 0 3-1.35 3-3v-2c0-.55.45-1 1-1h1v-4z',
  doc: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  default: 'M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z',
}

function fileIconKind(path: string): FileIconKind {
  const base = basenameOf(path).toLowerCase()
  if (base === 'package.json' || base.endsWith('lock') || base.startsWith('.') || /(config|settings)\.(js|ts|json|ya?ml)$/.test(base)) {
    return 'settings'
  }
  const dot = base.lastIndexOf('.')
  if (dot === -1 || dot === base.length - 1) return 'default'
  const ext = base.slice(dot + 1)
  if (CODE_EXTS.has(ext)) return 'code'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (DATA_EXTS.has(ext)) return 'data'
  if (DOC_EXTS.has(ext)) return 'doc'
  return 'default'
}

function FileIcon({ path }: { path: string }) {
  const kind = fileIconKind(path)
  return (
    <span className={css.fileIcon} data-file-kind={kind} aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
        <path d={FILE_ICON_PATHS[kind]} />
      </svg>
    </span>
  )
}

/** 上一轮更改 diff：从 TurnFileCard 的行级 hunk 缓存合成 +/− 视图。 */
function LastTurnDiffView({ path }: { path: string }) {
  const hunks = window.__liuliDiffCache?.get(path)
  if (hunks === undefined || hunks.length === 0) {
    return <div className={css.empty}>没有可显示的 diff（该文件没有行级变更缓存）</div>
  }
  return (
    <pre className={css.diffPre}>
      {hunks.map((hunk, hunkIndex) => {
        const oldLines = hunk.oldText === null || hunk.oldText === '' ? [] : hunk.oldText.split('\n')
        const newLines = hunk.newText.split('\n')
        return (
          <div key={hunkIndex}>
            <div className={css.diffLine} data-kind="hunk">{`@@ hunk ${hunkIndex + 1}`}</div>
            {oldLines.map((line, index) => (
              <div key={'o' + index} className={css.diffLine} data-kind="del">{'-' + line || ' '}</div>
            ))}
            {newLines.map((line, index) => (
              <div key={'n' + index} className={css.diffLine} data-kind="add">{'+' + line || ' '}</div>
            ))}
          </div>
        )
      })}
    </pre>
  )
}

/** 可拖拽高度的 diff 容器：底部中央一条精致的拖拽条（隐藏原生 resize 角）。 */
function DiffPane({ children }: { children: ReactNode }) {
  const paneRef = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState(readDiffPaneHeight)

  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const el = paneRef.current
    if (el === null) return
    const startY = e.clientY
    const startHeight = el.getBoundingClientRect().height
    const minHeight = DIFF_PANE_HEIGHT_MIN
    const maxHeight = diffPaneMaxHeight()
    const onMove = (move: PointerEvent): void => {
      const next = Math.min(maxHeight, Math.max(minHeight, startHeight + (move.clientY - startY)))
      el.style.height = `${Math.round(next)}px`
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      const nextHeight = Math.round(el.getBoundingClientRect().height)
      setHeight(nextHeight)
      saveDiffPaneHeight(nextHeight)
    }
    document.body.style.cursor = 'ns-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div ref={paneRef} className={css.diffPane} style={{ height: `${height}px` }}>
      <div className={css.diffScroll}>{children}</div>
      <div className={css.diffResizeHandle} data-testid="review-diff-resize" onPointerDown={startResize} />
    </div>
  )
}

/** 源切换选项（ZCode git.source.* 对应）。 */
const SOURCE_LABELS: Record<SidebarGitSourceId, string> = {
  unstaged: '未暂存',
  staged: '已暂存',
  branch: '全部分支更改',
  'last-turn': '上一轮更改',
}

const FALLBACK_SOURCES: Array<{ id: SidebarGitSourceId; disabled: boolean }> = [
  { id: 'unstaged', disabled: false },
  { id: 'staged', disabled: false },
  { id: 'branch', disabled: false },
  { id: 'last-turn', disabled: false },
]

/** ZCode 风格源切换下拉：触发按钮 + body portal 菜单，与插件其它菜单同材质。 */
function SourceSelect({ value, options, onChange }: {
  value: SidebarGitSourceId
  options: ReadonlyArray<{ id: SidebarGitSourceId; disabled: boolean }>
  onChange: (id: SidebarGitSourceId) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ right: number; top: number }>({ right: 0, top: 0 })
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (triggerRef.current !== null && triggerRef.current.contains(target)) return
      if (menuRef.current !== null && menuRef.current.contains(target)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onResize = (): void => { setOpen(false) }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const toggleMenu = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    const itemHeight = 32
    const height = options.length * itemHeight + 12
    const right = Math.max(8, window.innerWidth - rect.right)
    const top = rect.bottom + 4 + height > window.innerHeight ? Math.max(8, rect.top - 4 - height) : rect.bottom + 4
    setPos({ right, top })
    setOpen(prev => !prev)
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={css.sourceTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggleMenu}
      >
        <span className={css.sourceTriggerLabel}>{SOURCE_LABELS[value]}</span>
        <span className={css.sourceTriggerChevron + (open ? ' ' + css.sourceTriggerChevronOpen : '')}>
          <Chevron />
        </span>
      </button>
      {open && createPortal(
        <div ref={menuRef} className={css.sourceMenu} role="menu" style={{ right: pos.right, top: pos.top }}>
          {options.map(option => (
            <button
              key={option.id}
              type="button"
              role="menuitem"
              className={css.sourceMenuItem + (option.id === value ? ' ' + css.sourceMenuItemActive : '')}
              disabled={option.disabled}
              onClick={() => { onChange(option.id); setOpen(false) }}
            >
              <span className={css.sourceItemLabel}>{SOURCE_LABELS[option.id]}</span>
              {option.id === value && (
                <svg className={css.sourceCheck} viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                </svg>
              )}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}

/**
 * 审查文件面板：ZCode 风格 git 变更审查。
 * @param props - 会话 id、默认编辑器打开回调、宿主审查请求、文件树定位回调。
 */
export function FileReviewPanel({ sessionId, onOpenPath, reviewRequest, onRevealInFileTree }: FileReviewPanelProps) {
  const [git, setGit] = useState<SidebarGitPayload | null>(null)
  const [source, setSource] = useState<SidebarGitSourceId>('unstaged')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [diffCache, setDiffCache] = useState<Record<string, SidebarDiffPayload | undefined>>({})
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ path: string; deleted: boolean; right: number; top: number } | null>(null)
  const menuWrapRef = useRef<HTMLDivElement | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const requestSeq = useRef(0)
  const diffCacheRef = useRef<Record<string, SidebarDiffPayload | undefined>>({})
  /** 已应用的「驱动请求」nonce：同一请求只应用一次。effect 依赖中的
   *  reviewPath 身份会随 source/git/datasets 等状态变化而重建，若不加闸，
   *  用户手动切换来源/折叠文件后 effect 重跑会把旧驱动请求重新弹回
   *  （现象：LLM 驱动展开审查面板后「来源选项无法切换」）。 */
  const lastDriveNonce = useRef(-1)
  /** 已应用的「定位请求」nonce：git 未就绪时不标记（等加载后 effect 重跑
   *  再完成定位），应用后标记，防止旧定位请求被反复重放。 */
  const lastPathNonce = useRef(-1)

  // diffCache 镜像到 ref，避免 loadDiff/toggle/reviewPath 因缓存变化而改变身份。
  useEffect(() => {
    diffCacheRef.current = diffCache
  }, [diffCache])

  // 拉取 git state（sourceOptions / datasets / summary）。
  useEffect(() => {
    if (sessionId === undefined) return
    const controller = new AbortController()
    setGit(null)
    setExpanded(null)
    setDiffCache({})
    setError(null)
    fetchSidebarGit(sessionId, controller.signal, 0)
      .then(payload => {
        setGit(payload)
        if (payload.ok === false) setError(payload.error ?? '加载失败')
      })
      .catch(() => { setGit(null) })
    return () => { controller.abort() }
  }, [sessionId])

  const root = git?.root
  const [lastTurnChanges, setLastTurnChangesState] = useState<readonly SidebarGitChange[]>(() => getLastTurnChanges())

  // 订阅 TurnFileCard 发布的「上一轮更改」快照。
  useEffect(() => subscribeLastTurnChanges(() => {
    setLastTurnChangesState(getLastTurnChanges())
  }), [])

  // Host 不返回 last-turn，客户端把该源补在最后（ZCode 顺序：未暂存/已暂存/全部分支/上一轮）。
  const sourceOptions = useMemo(() => {
    const base = git?.sourceOptions ?? FALLBACK_SOURCES
    return base.some(option => option.id === 'last-turn') ? base : [...base, { id: 'last-turn' as const, disabled: false }]
  }, [git])

  const datasets = git?.datasets
  const changes = useMemo(() => {
    if (source === 'last-turn') return [...lastTurnChanges]
    const sections = datasets?.[source]?.sections ?? []
    return sections.flatMap(section => section.changes)
  }, [datasets, source, lastTurnChanges])

  const loadDiff = useCallback((path: string, sourceId: SidebarGitSourceId): void => {
    if (sourceId === 'last-turn' || sessionId === undefined) return
    const key = `${sourceId}:${path}`
    if (diffCacheRef.current[key] !== undefined) return
    const seq = ++requestSeq.current
    setLoadingDiff(true)
    setError(null)
    diffCacheRef.current = { ...diffCacheRef.current, [key]: undefined }
    setDiffCache(prev => ({ ...prev, [key]: undefined }))
    fetchSidebarDiff(sessionId, path, sourceId)
      .then(payload => {
        if (requestSeq.current === seq) setDiffCache(prev => ({ ...prev, [key]: payload }))
      })
      .catch((reason: unknown) => {
        if (requestSeq.current === seq) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (requestSeq.current === seq) setLoadingDiff(false)
      })
  }, [sessionId])

  const toggle = useCallback((path: string): void => {
    const next = expanded === path ? null : path
    setExpanded(next)
    if (next !== null && source !== 'last-turn') {
      const key = `${source}:${next}`
      if (diffCacheRef.current[key] === undefined) loadDiff(next, source)
    }
  }, [expanded, source, loadDiff])

  /** 从轮次卡片等入口跳转：确保源正确、文件展开。 */
  const reviewPath = useCallback((path: string): void => {
    if (git === null) return
    let nextSource = source
    if (source !== 'last-turn') {
      const inCurrent = (datasets?.[source]?.sections ?? []).some(section => section.changes.some(change => change.path === path))
      if (!inCurrent) {
        const inStaged = (datasets?.staged?.sections ?? []).some(section => section.changes.some(change => change.path === path))
        if (inStaged) {
          nextSource = 'staged'
        } else {
          const inBranch = (datasets?.branch?.sections ?? []).some(section => section.changes.some(change => change.path === path))
          if (inBranch) {
            nextSource = 'branch'
          } else if (lastTurnChanges.some(change => change.path === path)) {
            nextSource = 'last-turn'
          }
        }
      }
    }
    if (nextSource !== source) setSource(nextSource)
    setExpanded(path)
    if (nextSource !== 'last-turn') {
      const key = `${nextSource}:${path}`
      if (diffCacheRef.current[key] === undefined) loadDiff(path, nextSource)
    }
  }, [git, source, datasets, lastTurnChanges, loadDiff])

  // 宿主面板（PreviewDetailsPanel）驱动的审查请求（props 变化）。
  // 带 source 的请求是「LLM 活动驱动」（auto-open-details）：强制切换来源并展开
  // 目标文件——驱动打开审查面板时用户想看的是模型上一轮改了什么，所以切到
  // 「上一轮更改」并直接把第一个修改文件展开到 diff 区域；不带 source 的请求
  // 是轮次卡片「审查」按钮（reviewPath：找到包含该文件的源）。
  // 两个分支都按 nonce 只应用一次：reviewPath 身份随 source/git/datasets/
  // lastTurnChanges 等状态变化重建，若不加闸，用户手动切换来源/折叠展开后
  // effect 重跑会把旧请求重新弹回驱动值。定位分支在 git 未就绪时不标记，
  // 等 git 加载完成后重跑再完成定位（与旧的「reviewPath 身份变化即重试」等价）。
  useEffect(() => {
    if (reviewRequest === null || reviewRequest === undefined) return
    if ('source' in reviewRequest) {
      if (reviewRequest.nonce === lastDriveNonce.current) return
      lastDriveNonce.current = reviewRequest.nonce
      const req = reviewRequest
      setSource(req.source)
      if (req.source === 'last-turn') {
        // last-turn 快照是同步的（turn-file-store），直接展开目标文件。
        const changes = getLastTurnChanges()
        const target = resolveDriveTarget(changes, req.path)
        setExpanded(target)
      } else {
        setExpanded(req.path ?? null)
      }
      return
    }
    if (reviewRequest.nonce === lastPathNonce.current) return
    if (git === null) return
    lastPathNonce.current = reviewRequest.nonce
    reviewPath(reviewRequest.path)
  }, [reviewRequest, reviewPath, git])

  /** 已消费的 pending 审查路径：兜底请求按路径去重，避免 effect 随
   *  reviewPath 身份重跑时反复重放同一条旧请求（与驱动请求 nonce 同因）。 */
  const consumedPendingPath = useRef<string | null>(null)
  // 事件驱动的审查请求（自包含面板兜底：dock 布局实例等）。
  useEffect(() => {
    const pending = consumeReviewRequest()
    if (pending !== null && consumedPendingPath.current !== pending.path) {
      consumedPendingPath.current = pending.path
      reviewPath(pending.path)
    }
    const onReview = (e: Event): void => {
      const detail = (e as CustomEvent<{ sessionId?: string; path: string }>).detail
      if (detail === undefined || typeof detail.path !== 'string') return
      if (detail.sessionId !== undefined && detail.sessionId !== sessionId) return
      reviewPath(detail.path)
    }
    window.addEventListener(REVIEW_FILE_EVENT, onReview)
    return () => { window.removeEventListener(REVIEW_FILE_EVENT, onReview) }
  }, [sessionId, reviewPath])

  // 右键菜单关闭。
  useEffect(() => {
    if (menu === null) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (menuWrapRef.current !== null && menuWrapRef.current.contains(target)) return
      if (menuPanelRef.current !== null && menuPanelRef.current.contains(target)) return
      setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    const onResize = (): void => { setMenu(null) }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onResize)
    }
  }, [menu])

  const openMenu = (e: { preventDefault(): void; clientX: number; clientY: number }, change: SidebarGitChange): void => {
    e.preventDefault()
    const height = change.kind === 'deleted' ? 140 : 176
    const right = Math.max(8, window.innerWidth - e.clientX)
    const top = e.clientY + height > window.innerHeight ? Math.max(8, e.clientY - height) : e.clientY
    setMenu({ path: change.path, deleted: change.kind === 'deleted', right, top })
  }

  const runMenu = (action: () => void): void => {
    setMenu(null)
    action()
  }

  const selectedRel = menu === null ? '' : relOf(menu.path, root)
  const selectedAbs = menu === null ? '' : absOf(menu.path, root)

  const refresh = (): void => {
    if (sessionId === undefined) return
    setGit(null)
    setExpanded(null)
    setDiffCache({})
    setError(null)
    void fetchSidebarGit(sessionId, undefined, 0)
      .then(payload => {
        setGit(payload)
        if (payload.ok === false) setError(payload.error ?? '加载失败')
      })
      .catch(() => { setGit(null) })
  }

  const summary = git?.summary
  const emptyText = (): { title: string; desc: string } => {
    if (source === 'last-turn') return { title: '当前任务还没有上一轮文件改动', desc: '当 agent 产生文件写入后，这里会展示上一轮修改的文件。' }
    if (summary === undefined) return { title: '加载中…', desc: '正在读取当前工作区的 Git 状态和文件改动。' }
    if (summary.isGitAvailable === false) return { title: '当前环境没有可用的 Git', desc: '请先安装 Git，或确认当前运行环境里可以执行 git 命令。' }
    if (summary.isRepository === false) return { title: '当前 workspace 不在 Git 仓库中', desc: '打开一个 Git 仓库目录后，这里会展示当前 workspace 作用域内的改动。' }
    return { title: '当前来源下没有可展示的改动', desc: '可以切换其它来源，或等当前 workspace 产生新的 Git 改动后再查看。' }
  }

  const diffKey = expanded === null ? '' : `${source}:${expanded}`
  const diffPayload = source === 'last-turn' ? undefined : expanded === null ? undefined : diffCache[diffKey]

  return (
    <div className={css.root} data-liuli-review-panel="">
      <div className={css.toolbar}>
        <div className={css.sourceWrap}>
          <SourceSelect
            value={source}
            options={sourceOptions}
            onChange={(next) => {
              setSource(next)
              setExpanded(null)
            }}
          />
        </div>
        {git?.branch !== undefined && git.branch !== '' && git.branch !== 'HEAD' && (
          <span className={css.branch}>{git.branch}</span>
        )}
        <button type="button" className={css.refreshBtn} title="刷新" aria-label="刷新" onClick={refresh}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path fill="currentColor" d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
          </svg>
        </button>
      </div>

      {changes.length > 0 ? (
        <div className={css.fileList}>
          {changes.map(change => {
            const rel = change.workspaceRelativePath
            const isExpanded = expanded === change.path
            return (
              <div key={source + ':' + change.path} className={css.rowShell}>
                <button
                  type="button"
                  className={css.fileRow + (isExpanded ? ' ' + css.fileRowActive : '')}
                  aria-expanded={isExpanded}
                  title={rel}
                  onClick={() => { toggle(change.path) }}
                  onContextMenu={(e) => { openMenu(e, change) }}
                >
                  <span className={css.fileInfo}>
                    <FileIcon path={rel} />
                    <span className={css.fileName}>{basenameOf(rel)}</span>
                    {dirnameOf(rel) !== '' && <span className={css.fileDir}>{dirnameOf(rel)}</span>}
                  </span>
                  <span className={css.fileStats}>
                    {change.added > 0 && <span className={css.statAdd}>+{change.added}</span>}
                    {change.removed > 0 && <span className={css.statDel}>−{change.removed}</span>}
                    {change.kind === 'untracked' && <span className={css.statTag}>未跟踪</span>}
                    {change.kind === 'deleted' && <span className={css.statTag}>已删除</span>}
                  </span>
                  <span className={css.chevronWrap + (isExpanded ? ' ' + css.chevronWrapOpen : '')}>
                    <Chevron />
                  </span>
                </button>
                {isExpanded && (
                  <DiffPane>
                    {source === 'last-turn' ? (
                      <LastTurnDiffView path={change.path} />
                    ) : (
                      <>
                        {loadingDiff && diffPayload === undefined && <div className={css.empty}>加载中…</div>}
                        {error !== null && <div className={css.empty}>{error}</div>}
                        {!loadingDiff && error === null && diffPayload !== undefined && (
                          diffPayload.availability === 'binary' ? (
                            <div className={css.empty}>二进制文件{'\n'}{diffPayload.summary ?? ''}</div>
                          ) : diffPayload.availability === 'unavailable' ? (
                            <div className={css.empty}>{diffPayload.summary ?? '没有可显示的 diff'}</div>
                          ) : diffPayload.untracked === true && diffPayload.afterContent != null ? (
                            <PlainTextView content={diffPayload.afterContent} />
                          ) : (
                            <DiffView diff={diffPayload.patch ?? diffPayload.diff ?? ''} />
                          )
                        )}
                      </>
                    )}
                  </DiffPane>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className={css.emptyState}>
          <p className={css.emptyTitle}>{emptyText().title}</p>
          <p className={css.emptyDesc}>{emptyText().desc}</p>
        </div>
      )}

      {menu !== null && createPortal(
        <div ref={menuPanelRef} className={css.menu} role="menu" style={{ right: menu.right, top: menu.top }}>
          {onOpenPath !== undefined && (
            <button
              type="button"
              role="menuitem"
              className={css.menuItem}
              onClick={() => { runMenu(() => { onOpenPath(selectedAbs) }) }}
            >
              打开
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={css.menuItem}
            disabled={menu.deleted}
            title="在系统文件管理器中定位该文件"
            onClick={() => {
              runMenu(() => {
                if (sessionId === undefined) {
                  revealToast('无会话上下文，无法定位文件', 'error')
                } else {
                  void revealSidebarPath(sessionId, selectedRel)
                }
              })
            }}
          >
            在文件管理器中打开
          </button>
          <button
            type="button"
            role="menuitem"
            className={css.menuItem}
            onClick={() => { runMenu(() => { void copyText(selectedAbs) }) }}
          >
            复制绝对路径
          </button>
          <button
            type="button"
            role="menuitem"
            className={css.menuItem}
            onClick={() => { runMenu(() => { void copyText(selectedRel) }) }}
          >
            复制相对路径
          </button>
          {onRevealInFileTree !== undefined && (
            <button
              type="button"
              role="menuitem"
              className={css.menuItem}
              onClick={() => { runMenu(() => { onRevealInFileTree(selectedAbs) }) }}
            >
              在文件树中显示
            </button>
          )}
        </div>,
        document.body,
      )}
      <div ref={menuWrapRef} />
    </div>
  )
}
