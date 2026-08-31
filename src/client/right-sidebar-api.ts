/**
 * 右侧边栏 Host 数据 API（/liuli-sidebar/*，node 半实现）。
 * 只做同源 fetch，不落盘；所有响应都有 ok 标志位。
 */

export interface SidebarTreeEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  hidden: boolean
}

export interface SidebarTreePayload {
  ok: boolean
  root?: string
  rel?: string
  entries?: SidebarTreeEntry[]
  error?: string
}

export interface SidebarGitStatusRow {
  x: string
  y: string
  path: string
  oldPath?: string
}

export interface SidebarGitCommit {
  hash: string
  short: string
  subject: string
  author: string
  date: string
  parents: string[]
}

export type SidebarGitSourceId = 'unstaged' | 'staged' | 'branch' | 'last-turn'

export interface SidebarGitSourceOption {
  id: SidebarGitSourceId
  disabled: boolean
}

export interface SidebarGitChange {
  path: string
  workspaceRelativePath: string
  added: number
  removed: number
  kind: 'added' | 'deleted' | 'modified' | 'untracked' | 'renamed' | 'copied'
}

export interface SidebarGitSection {
  id: string
  changes: SidebarGitChange[]
}

export interface SidebarGitDataset {
  id: SidebarGitSourceId
  sections: SidebarGitSection[]
  comparisonLabel?: string | null
}

export interface SidebarGitSummary {
  isGitAvailable: boolean
  isRepository: boolean
  added: number
  removed: number
}

export interface SidebarGitPayload {
  ok: boolean
  root?: string
  git?: boolean
  status?: SidebarGitStatusRow[]
  branch?: string
  log?: string
  commits?: SidebarGitCommit[]
  hasMore?: boolean
  sourceOptions?: SidebarGitSourceOption[]
  datasets?: Record<SidebarGitSourceId, SidebarGitDataset>
  summary?: SidebarGitSummary
  loading?: boolean
  revision?: number
  error?: string
}

/** 拉取某会话根目录下的单层目录树。 */
export async function fetchSidebarTree(sessionId: string, rel = '', signal?: AbortSignal): Promise<SidebarTreePayload> {
  const query = new URLSearchParams({ sessionId })
  if (rel !== '') query.set('path', rel)
  const response = await fetch('/liuli-sidebar/tree?' + query.toString(), signal === undefined ? {} : { signal })
  return response.json() as Promise<SidebarTreePayload>
}

/** 拉取 Git 状态与提交图谱。 */
export async function fetchSidebarGit(sessionId: string, signal?: AbortSignal, skip = 0): Promise<SidebarGitPayload> {
  const query = new URLSearchParams({ sessionId })
  if (skip > 0) query.set('skip', String(skip))
  const response = await fetch('/liuli-sidebar/git?' + query.toString(), signal === undefined ? {} : { signal })
  return response.json() as Promise<SidebarGitPayload>
}

/** 单文件全文载荷（审查面板「全文」）。 */
export interface SidebarFilePayload {
  ok: boolean
  root?: string
  rel?: string
  path?: string
  content?: string
  size?: number
  error?: string
}

/** 单文件 git diff 载荷（ZCode 风格审查面板）。 */
export interface SidebarDiffPayload {
  ok: boolean
  root?: string
  rel?: string
  path?: string
  diff?: string
  x?: string
  y?: string
  untracked?: boolean
  availability?: 'patch' | 'binary' | 'unavailable'
  patch?: string
  beforeContent?: string | null
  afterContent?: string | null
  summary?: string
  error?: string
}

/** 拉取某个文件的全文（相对会话 cwd 的路径）。 */
export async function fetchSidebarFile(sessionId: string, path: string, signal?: AbortSignal): Promise<SidebarFilePayload> {
  const query = new URLSearchParams({ sessionId, path })
  const response = await fetch('/liuli-sidebar/file?' + query.toString(), signal === undefined ? {} : { signal })
  return response.json() as Promise<SidebarFilePayload>
}

/** 拉取某个文件的 git diff（相对会话 cwd 的路径；source 为 unstaged/staged）。 */
export async function fetchSidebarDiff(sessionId: string, path: string, source: SidebarGitSourceId = 'unstaged', signal?: AbortSignal): Promise<SidebarDiffPayload> {
  const query = new URLSearchParams({ sessionId, path, source })
  const response = await fetch('/liuli-sidebar/diff?' + query.toString(), signal === undefined ? {} : { signal })
  return response.json() as Promise<SidebarDiffPayload>
}

/** 页内诊断 toast：不依赖 alert（Electron 渲染进程可能禁用原生对话框）。 */
export function revealToast(message: string, kind: 'info' | 'error' = 'info'): void {
  try {
    const id = 'liuli-reveal-toast'
    document.getElementById(id)?.remove()
    const el = document.createElement('div')
    el.id = id
    el.textContent = message
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:32px', 'transform:translateX(-50%)',
      'z-index:2147483647', 'padding:10px 14px', 'border-radius:10px',
      'font-size:13px', 'line-height:1.5', 'max-width:70vw', 'pointer-events:none',
      'box-shadow:0 8px 24px rgba(0,0,0,0.35)',
      kind === 'error'
        ? 'background:#b3261e;color:#fff'
        : 'background:rgba(32,32,32,0.96);color:#fff',
    ].join(';')
    document.body.appendChild(el)
    window.setTimeout(() => { el.remove() }, kind === 'error' ? 6000 : 2500)
  } catch { /* 诊断提示不应影响主流程 */ }
}

/** 在系统文件管理器中定位文件（Host 半负责 platform 命令）。 */
export async function revealSidebarPath(sessionId: string, path: string): Promise<boolean> {
  const query = new URLSearchParams({ sessionId, path })
  revealToast('正在打开资源管理器…', 'info')
  try {
    const response = await fetch('/liuli-reveal?' + query.toString())
    if (response.ok) return true
    const detail = await response.text().catch(() => '')
    console.warn(`[liuli] /liuli-reveal failed: ${response.status} ${detail}`)
    revealToast(`在资源管理器中打开失败：${response.status} ${detail}`, 'error')
    return false
  } catch (error) {
    console.warn('[liuli] /liuli-reveal unavailable:', error)
    revealToast(`在资源管理器中打开失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    return false
  }
}

/** 在系统文件管理器中打开工作区根目录（Host 半经 workspaceRegistry 解析注册路径；
 *  同时带上客户端已知的注册路径，Host 注册表不可用时回退用它）。 */
export async function revealWorkspaceInExplorer(workspaceId: string, path?: string): Promise<boolean> {
  const query = new URLSearchParams()
  if (workspaceId !== '') query.set('workspaceId', workspaceId)
  if (path !== undefined && path !== '') query.set('path', path)
  revealToast('正在打开资源管理器…', 'info')
  try {
    const response = await fetch('/liuli-reveal-workspace?' + query.toString())
    if (response.ok) return true
    const detail = await response.text().catch(() => '')
    console.warn(`[liuli] /liuli-reveal-workspace failed: ${response.status} ${detail}`)
    revealToast(`在资源管理器中打开失败：${response.status} ${detail}`, 'error')
    return false
  } catch (error) {
    console.warn('[liuli] /liuli-reveal-workspace unavailable:', error)
    revealToast(`在资源管理器中打开失败：${error instanceof Error ? error.message : String(error)}`, 'error')
    return false
  }
}

