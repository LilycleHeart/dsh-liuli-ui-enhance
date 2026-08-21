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

export interface SidebarWikiPayload {
  ok: boolean
  root?: string
  title?: string
  readme?: string[]
  readmePath?: string
  modules?: Array<{ name: string; files: Array<{ name: string; path: string }> }>
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

/** 拉取生成的架构导读。 */
export async function fetchSidebarWiki(sessionId: string, signal?: AbortSignal): Promise<SidebarWikiPayload> {
  const query = new URLSearchParams({ sessionId })
  const response = await fetch('/liuli-sidebar/wiki?' + query.toString(), signal === undefined ? {} : { signal })
  return response.json() as Promise<SidebarWikiPayload>
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

/** 在系统文件管理器中定位文件（fire-and-forget；Host 半负责 platform 命令）。 */
export function revealSidebarPath(sessionId: string, path: string): void {
  const query = new URLSearchParams({ sessionId, path })
  void fetch('/liuli-reveal?' + query.toString()).catch(() => {})
}

