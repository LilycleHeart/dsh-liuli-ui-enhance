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

export interface SidebarGitPayload {
  ok: boolean
  root?: string
  git?: boolean
  status?: SidebarGitStatusRow[]
  branch?: string
  log?: string
  commits?: SidebarGitCommit[]
  hasMore?: boolean
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
  const response = await fetch(`/liuli-sidebar/tree?${query}`, signal === undefined ? {} : { signal })
  return response.json() as Promise<SidebarTreePayload>
}

/** 拉取 Git 状态与提交图谱。 */
export async function fetchSidebarGit(sessionId: string, signal?: AbortSignal, skip = 0): Promise<SidebarGitPayload> {
  const query = new URLSearchParams({ sessionId })
  if (skip > 0) query.set('skip', String(skip))
  const response = await fetch(`/liuli-sidebar/git?${query}`, signal === undefined ? {} : { signal })
  return response.json() as Promise<SidebarGitPayload>
}

/** 拉取生成的架构导读。 */
export async function fetchSidebarWiki(sessionId: string, signal?: AbortSignal): Promise<SidebarWikiPayload> {
  const query = new URLSearchParams({ sessionId })
  const response = await fetch(`/liuli-sidebar/wiki?${query}`, signal === undefined ? {} : { signal })
  return response.json() as Promise<SidebarWikiPayload>
}
