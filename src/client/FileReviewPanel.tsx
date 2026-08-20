/**
 * 琉璃主题 · 审查文件面板（替换原「审查 / Git 图谱」面板）。
 *
 * 左侧：工作区变更文件列表（git status）；点选后在右侧展示该文件：
 * - Diff 标签：git diff（未跟踪文件渲染成整文件新增）；
 * - 全文标签：文件全文（/liuli-sidebar/file，带行号）；
 * - 顶栏操作：打开（默认编辑器）/ 在资源管理器中打开 / 复制绝对路径 / 复制相对路径。
 *
 * 同时订阅轮次卡片（TurnFileCard）的「审查」按钮事件：选中文件并刷新。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchSidebarDiff, fetchSidebarFile, fetchSidebarGit, revealSidebarPath,
  type SidebarDiffPayload, type SidebarFilePayload, type SidebarGitPayload,
} from './right-sidebar-api.ts'
import { consumeReviewRequest, REVIEW_FILE_EVENT } from './review-bus.ts'
import css from './FileReviewPanel.module.css'

export interface FileReviewPanelProps {
  sessionId?: string | undefined
  onOpenPath?: ((path: string) => void) | undefined
  /** 宿主面板（PreviewDetailsPanel）驱动的审查请求。 */
  reviewRequest?: { path: string; nonce: number } | null
}

type Tab = 'diff' | 'full'

/** 路径工具（与 TurnFileCard 一致）。 */
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

/** 复制文本到剪贴板（带降级）。 */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // 剪贴板不可用（非安全上下文）时静默失败。
  }
}

/** 把 unified diff 文本切成带类型的行（@@ hunk / +add / -del / ---+++ meta / 上下文）。 */
function parseDiffRows(diff: string): Array<{ kind: 'hunk' | 'add' | 'del' | 'meta' | 'ctx'; text: string }> {
  const lines = diff.replace(/\r\n/g, '\n').split('\n')
  const rows: Array<{ kind: 'hunk' | 'add' | 'del' | 'meta' | 'ctx'; text: string }> = []
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

/** 全文视图：带行号。 */
function FullView({ content }: { content: string }) {
  const lines = useMemo(() => content.replace(/\r\n/g, '\n').split('\n'), [content])
  return (
    <pre className={css.fullPre}>
      {lines.map((line, index) => (
        <div key={index} className={css.fullLine}>
          <span className={css.fullNo}>{index + 1}</span>
          <span className={css.fullText}>{line}</span>
        </div>
      ))}
    </pre>
  )
}

/**
 * 审查文件面板：变更文件列表 + 选中文件的全文与 diff。
 * @param props - 会话 id、默认编辑器打开回调、宿主审查请求。
 */
export function FileReviewPanel({ sessionId, onOpenPath, reviewRequest }: FileReviewPanelProps) {
  const [git, setGit] = useState<SidebarGitPayload | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('diff')
  const [file, setFile] = useState<SidebarFilePayload | null>(null)
  const [diff, setDiff] = useState<SidebarDiffPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)

  // 拉取 git status（文件列表 + cwd）。
  useEffect(() => {
    if (sessionId === undefined) return
    const controller = new AbortController()
    setGit(null)
    setSelected(null)
    fetchSidebarGit(sessionId, controller.signal, 0)
      .then(payload => { setGit(payload) })
      .catch(() => { setGit(null) })
    return () => { controller.abort() }
  }, [sessionId])

  const select = useCallback((path: string): void => {
    setSelected(path)
    setTab('diff')
    setError(null)
    if (sessionId === undefined) return
    const seq = ++requestSeq.current
    setLoading(true)
    setFile(null)
    setDiff(null)
    void Promise.all([
      fetchSidebarFile(sessionId, path).then(payload => { if (requestSeq.current === seq) setFile(payload) }),
      fetchSidebarDiff(sessionId, path).then(payload => { if (requestSeq.current === seq) setDiff(payload) }),
    ]).catch((reason: unknown) => {
      if (requestSeq.current === seq) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (requestSeq.current === seq) setLoading(false)
    })
  }, [sessionId])

  // 宿主面板（PreviewDetailsPanel）驱动的审查请求（props 变化）。
  useEffect(() => {
    if (reviewRequest !== null && reviewRequest !== undefined) select(reviewRequest.path)
  }, [reviewRequest, select])

  // 事件驱动的审查请求（自包含面板兜底：dock 工作台实例等）。
  useEffect(() => {
    const pending = consumeReviewRequest()
    if (pending !== null) select(pending.path)
    const onReview = (e: Event): void => {
      const detail = (e as CustomEvent<{ sessionId?: string; path: string }>).detail
      if (detail === undefined || typeof detail.path !== 'string') return
      if (detail.sessionId !== undefined && detail.sessionId !== sessionId) return
      select(detail.path)
    }
    window.addEventListener(REVIEW_FILE_EVENT, onReview)
    return () => { window.removeEventListener(REVIEW_FILE_EVENT, onReview) }
  }, [sessionId, select])

  const root = git?.root
  const status = git?.status ?? []
  const abs = selected === null ? '' : absOf(selected, root)
  const rel = selected === null ? '' : relOf(selected, root)

  return (
    <div className={css.root} data-liuli-review-panel="">
      <div className={css.toolbar}>
        <span className={css.title}>审查文件</span>
        {git?.git === true && git.branch !== undefined && git.branch !== '' && (
          <span className={css.branch}>{git.branch}</span>
        )}
      </div>

      <div className={css.fileList}>
        {status.map(row => (
          <button
            type="button"
            key={row.path + row.x + row.y}
            className={css.fileRow + (selected === row.path ? ' ' + css.fileRowActive : '')}
            onClick={() => { select(row.path) }}
            title={row.path}
          >
            <span className={css.fileCode} data-status={row.x + row.y}>{row.x + row.y}</span>
            <span className={css.filePath}>{row.path}</span>
          </button>
        ))}
        {git !== null && status.length === 0 && (
          <div className={css.empty}>
            {git.git === true ? '工作区干净，没有待审查的变更' : '当前目录不是 Git 仓库（无法列出变更文件）'}
          </div>
        )}
      </div>

      {selected === null ? (
        <div className={css.empty}>从列表选择文件，查看全文与 diff</div>
      ) : (
        <div className={css.detail}>
          <div className={css.detailBar}>
            <span className={css.detailPath} title={rel}>{basenameOf(rel)}</span>
            <div className={css.detailActions}>
              {onOpenPath !== undefined && (
                <button type="button" className={css.actBtn} title="用默认编辑器打开" onClick={() => { onOpenPath(abs) }}>
                  打开
                </button>
              )}
              <button
                type="button"
                className={css.actBtn}
                title="在系统文件管理器中定位文件"
                onClick={() => { if (sessionId !== undefined) revealSidebarPath(sessionId, rel) }}
              >
                在资源管理器中打开
              </button>
              <button type="button" className={css.actBtn} title="复制绝对路径" onClick={() => { void copyText(abs) }}>
                复制绝对路径
              </button>
              <button type="button" className={css.actBtn} title="复制相对路径" onClick={() => { void copyText(rel) }}>
                复制相对路径
              </button>
            </div>
          </div>
          <div className={css.tabs}>
            <button type="button" className={css.tabBtn + (tab === 'diff' ? ' ' + css.tabBtnActive : '')} onClick={() => { setTab('diff') }}>
              Diff
            </button>
            <button type="button" className={css.tabBtn + (tab === 'full' ? ' ' + css.tabBtnActive : '')} onClick={() => { setTab('full') }}>
              全文
            </button>
          </div>
          <div className={css.body}>
            {loading && <div className={css.empty}>加载中…</div>}
            {error !== null && <div className={css.empty}>{error}</div>}
            {!loading && error === null && tab === 'diff' && diff !== null && <DiffView diff={diff.diff ?? ''} />}
            {!loading && error === null && tab === 'full' && file !== null && <FullView content={file.content ?? ''} />}
          </div>
        </div>
      )}
    </div>
  )
}
