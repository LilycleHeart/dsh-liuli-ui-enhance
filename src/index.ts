/**
 * 琉璃主题（dsh-liuli-ui-enhance）—— 节点半。
 *
 * 除了作为宿主 Loader 中的插件存在，节点半还提供两个本地 HTTP 路由：
 * - `/liuli-quota`：浏览器半用它查询 DeepSeek / OpenCode Go 的余额或套餐额度。
 *   密钥只在这条 Host 路由里通过 `ctx.credentials` 解析，绝不进入浏览器 bundle。
 * - `/preview`：把当前会话 cwd 作为同源静态站点（预览面板 iframe 用），
 *   只服务会话目录内的文件，Host fence 防 DNS rebinding。
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { execFile as execFileCb, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { TextDecoder, promisify } from 'node:util'
import iconv from 'iconv-lite'
import { dirname, extname, isAbsolute as isPathAbsolute, join as joinPath, relative as relativePath, resolve as resolvePath, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { createBrowserEngine } from './browser-engine.ts'
import { applyFramelessPatch, revertFramelessPatch } from './frameless-patch.ts'
import { windowControlRoute } from './host-window.ts'
import { audioCaptureRoute, installSystemAudioCapture } from './host-audio.ts'

export const name = 'dsh-liuli-ui-enhance'

export const inject = ['webServer', 'credentials', 'sessions']

/**
 * 琉璃扩展命令的最小结构面。刻意不 import @deepseek-ai/dsh-commands：
 * 它的类型面会拖进 dsh-session 的 `Context.sessions: SessionStore` 声明，
 * 与 dsh-client-runtime 浏览器侧的 `ISessions` 声明合并冲突（见 AGENTS.md）。
 * 这里只声明我们用到的子集，运行时经 ctx.inject(['commands']) 解析。
 */
interface LiuliCommandRegistry {
  register(definition: {
    name: string
    description: string
    input?: { hint: string; images?: boolean }
    recordInput?: boolean
    handler: (invocation: { agent: unknown; rawInput: string; attachments: unknown[] }) => {
      kind: 'success' | 'error'
      text?: string
    } | Promise<{ kind: 'success' | 'error'; text?: string }>
  }): () => void
}

/**
 * Host 会话存储的最小读面。刻意不 import @deepseek-ai/dsh-session：它的
 * `Context.sessions: SessionStore` 声明会与 dsh-client-runtime 的浏览器侧
 * `ISessions` 声明合并冲突，污染同一编译单元里的浏览器半。
 */
interface HostSessionCwd {
  header: { cwd?: string }
}

function hostSessions(ctx: Context): { get(id: string): HostSessionCwd | undefined } {
  return (ctx as unknown as { sessions: { get(id: string): HostSessionCwd | undefined } }).sessions
}

/**
 * Host 工作区注册表的最小读面（对应 @deepseek-ai/dsh-workspace 的
 * `Context.workspaceRegistry`）。刻意不 import 该包：它与 dsh-session 一样会把
 * 类型面拖进本编译单元；这里只声明用到的子集，运行时经上下文解析。
 * 拿不到服务时路由回退到客户端已知的工作区路径（见 serveRevealWorkspace）。
 */
interface HostWorkspaceRegistry {
  get(id: string): { path: string } | undefined
}

function hostWorkspaceRegistry(ctx: Context): HostWorkspaceRegistry | undefined {
  // 官方代码（app.asar 内）访问 workspaceRegistry 也要显式 inject；插件未声明它时，
  // 属性访问在真实宿主里可能抛「cannot get property without inject」。这里先试属性
  // 访问，再试 `ctx.get(name, false)`（cordis 不经 inject 的 store 读取），都拿不到
  // 才返回 undefined（路由回退到客户端已知路径）。
  try {
    const direct = (ctx as unknown as { workspaceRegistry?: HostWorkspaceRegistry }).workspaceRegistry
    if (direct !== undefined) return direct
  } catch {
    // 属性访问不可用（未注入/作用域隔离），继续尝试 store 读取。
  }
  try {
    const read = (ctx as unknown as { get?: (name: string, strict?: boolean) => unknown }).get?.('workspaceRegistry', false)
    if (read !== undefined) return read as HostWorkspaceRegistry
  } catch {
    // 同上。
  }
  return undefined
}

const execFile = promisify(execFileCb)

/* ── /liuli-sidebar：右侧边栏（文件树 / Git / Wiki）Host 数据路由 ───────── */

interface SidebarTreeEntry {
  name: string
  path: string
  kind: 'file' | 'dir'
  hidden: boolean
}

interface SidebarGitStatusRow {
  x: string
  y: string
  path: string
  /** 重命名时旧路径（porcelain 行内的 old -> new）。 */
  oldPath?: string
}

/** 会话 cwd 解析；与 /preview 共用同一 Host fence。 */
function sidebarSessionRoot(ctx: Context, sessionId: string): string | undefined {
  const sessions = hostSessions(ctx)
  // 客户端 sessionId 可能是裸 UUID（如 fd9c0e13-…），而 Host sessions 服务的
  // key 是 `session-<uuid>`；反过来也可能收到带前缀的 id。这里做双向兼容，
  // 避免琉璃 Host 路由（/liuli-sidebar/*、/liuli-reveal、/preview）因 id
  // 形式不匹配而整体 404。
  const direct = sessions.get(sessionId)
  if (direct !== undefined) return direct.header.cwd
  if (!sessionId.startsWith('session-')) {
    const prefixed = sessions.get('session-' + sessionId)
    if (prefixed !== undefined) return prefixed.header.cwd
  } else {
    const bare = sessions.get(sessionId.slice('session-'.length))
    if (bare !== undefined) return bare.header.cwd
  }
  return undefined
}

/** 读取一层目录树（目录优先，名称排序，隐藏文件保留但标记）。 */
async function sidebarReadTree(root: string, rel: string): Promise<SidebarTreeEntry[]> {
  const target = resolveWithin(root, rel)
  if (target === undefined) throw new Error('forbidden')
  const info = await stat(target)
  if (!info.isDirectory()) throw new Error('not a directory')
  const entries = await readdir(target, { withFileTypes: true })
  const rows: SidebarTreeEntry[] = entries.map(entry => ({
    name: entry.name,
    path: joinPath(target, entry.name),
    kind: entry.isDirectory() ? 'dir' as const : 'file' as const,
    hidden: entry.name.startsWith('.'),
  }))
  rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return rows
}

/** Git status（porcelain v1）；非仓库时返回 undefined。 */
async function sidebarGitStatus(root: string): Promise<SidebarGitStatusRow[] | undefined> {
  try {
    const { stdout } = await execFile('git', ['-C', root, 'status', '--porcelain=v1'], {
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
    return stdout.split(/\r?\n/).filter(Boolean).map(line => {
      const x = line[0] ?? ' '
      const y = line[1] ?? ' '
      const rest = line.slice(3)
      const arrow = rest.indexOf(' -> ')
      if (arrow >= 0) {
        return { x, y, path: rest.slice(arrow + 4), oldPath: rest.slice(0, arrow) }
      }
      return { x, y, path: rest }
    })
  } catch {
    return undefined
  }
}

/* ── 参考实现 风格审查面板数据模型（sourceOptions / datasets / summary） ── */

type SidebarGitSourceId = 'unstaged' | 'staged' | 'branch'

interface SidebarGitSourceOption {
  id: SidebarGitSourceId
  disabled: boolean
}

interface SidebarGitChange {
  path: string
  workspaceRelativePath: string
  added: number
  removed: number
  kind: 'added' | 'deleted' | 'modified' | 'untracked' | 'renamed' | 'copied'
}

interface SidebarGitSection {
  id: string
  changes: SidebarGitChange[]
}

interface SidebarGitDataset {
  id: SidebarGitSourceId
  sections: SidebarGitSection[]
  comparisonLabel?: string | null
}

interface SidebarGitSummary {
  isGitAvailable: boolean
  isRepository: boolean
  added: number
  removed: number
}

interface SidebarGitState {
  rows: SidebarGitStatusRow[]
  sourceOptions: SidebarGitSourceOption[]
  datasets: Record<SidebarGitSourceId, SidebarGitDataset>
  summary: SidebarGitSummary
  branch: string
  revision: number
}

/** 解析 git diff --numstat 输出为 path → { added, removed }。 */
function parseNumstat(stdout: string): Map<string, { added: number; removed: number }> {
  const map = new Map<string, { added: number; removed: number }>()
  for (const line of stdout.split(/\r?\n/)) {
    if (line === '') continue
    const tab1 = line.indexOf('\t')
    if (tab1 <= 0) continue
    const tab2 = line.indexOf('\t', tab1 + 1)
    if (tab2 <= tab1) continue
    const addedText = line.slice(0, tab1)
    const removedText = line.slice(tab1 + 1, tab2)
    const path = line.slice(tab2 + 1)
    if (addedText === '-' || removedText === '-') {
      // 二进制文件：无行数统计。
      continue
    }
    const added = Math.max(0, Math.trunc(Number(addedText)) || 0)
    const removed = Math.max(0, Math.trunc(Number(removedText)) || 0)
    map.set(path, { added, removed })
  }
  return map
}

/** 统计一个文本文件的行数（未跟踪文件的新增行数用；二进制/超大文件返回 0）。 */
async function countTextLines(root: string, rel: string): Promise<number> {
  const target = resolveWithin(root, rel)
  if (target === undefined) return 0
  try {
    const info = await stat(target)
    if (!info.isFile() || info.size > 4 * 1024 * 1024) return 0
    const raw = await readFile(target)
    if (raw.includes(0)) return 0
    const text = raw.toString('utf8')
    return text.split(/\r?\n/).length - 1
  } catch {
    return 0
  }
}

function gitChangeKind(code: string): SidebarGitChange['kind'] {
  switch (code) {
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    default: return 'modified'
  }
}

/** 汇总 参考实现 风格 git state（审查面板用）。 */
async function sidebarGitState(root: string): Promise<SidebarGitState> {
  const empty = (): SidebarGitState => ({
    rows: [],
    sourceOptions: [
      { id: 'unstaged', disabled: false },
      { id: 'staged', disabled: false },
      { id: 'branch', disabled: false },
    ],
    datasets: {
      unstaged: { id: 'unstaged', sections: [] },
      staged: { id: 'staged', sections: [] },
      branch: { id: 'branch', sections: [], comparisonLabel: null },
    },
    summary: { isGitAvailable: false, isRepository: false, added: 0, removed: 0 },
    branch: '',
    revision: 0,
  })

  let rows: SidebarGitStatusRow[] = []
  let inside = ''
  let branch = ''
  let trackingBranch = ''
  let unstagedNumstat = new Map<string, { added: number; removed: number }>()
  let stagedNumstat = new Map<string, { added: number; removed: number }>()
  let branchNumstat = new Map<string, { added: number; removed: number }>()
  try {
    const [statusRows, insideResult, branchResult, trackingResult, unstaged, staged, branchDiff] = await Promise.all([
      sidebarGitStatus(root),
      execFile('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], {
        timeout: 8000, maxBuffer: 1024, windowsHide: true,
      }),
      execFile('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        timeout: 8000, maxBuffer: 1024, windowsHide: true,
      }).catch(() => ({ stdout: '' })),
      execFile('git', ['-C', root, 'rev-parse', '--abbrev-ref', '@{upstream}'], {
        timeout: 8000, maxBuffer: 1024, windowsHide: true,
      }).catch(() => ({ stdout: '' })),
      execFile('git', ['-C', root, 'diff', '--numstat', '--'], {
        timeout: 8000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      }).catch(() => ({ stdout: '' })),
      execFile('git', ['-C', root, 'diff', '--cached', '--numstat', '--'], {
        timeout: 8000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      }).catch(() => ({ stdout: '' })),
      execFile('git', ['-C', root, 'diff', '--numstat', '@{upstream}...HEAD', '--'], {
        timeout: 8000, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      }).catch(() => ({ stdout: '' })),
    ])
    if (statusRows === undefined) return empty()
    rows = statusRows
    inside = insideResult.stdout.trim()
    branch = branchResult.stdout.trim().split(/\r?\n/)[0] ?? ''
    trackingBranch = trackingResult.stdout.trim().split(/\r?\n/)[0] ?? ''
    unstagedNumstat = parseNumstat(unstaged.stdout)
    stagedNumstat = parseNumstat(staged.stdout)
    branchNumstat = parseNumstat(branchDiff.stdout)
  } catch {
    return empty()
  }

  const isRepository = inside === 'true'
  const isGitAvailable = true
  const stagedChanges: SidebarGitChange[] = []
  const unstagedChanges: SidebarGitChange[] = []

  const lookup = (map: Map<string, { added: number; removed: number }>, row: SidebarGitStatusRow): { added: number; removed: number } =>
    map.get(row.path) ?? (row.oldPath !== undefined ? map.get(row.oldPath) : undefined) ?? { added: 0, removed: 0 }

  // 未跟踪文件的行数统计（限制并发数量）。
  const untrackedRows = rows.filter(row => row.x === '?' && row.y === '?')
  const untrackedLineCounts = await Promise.all(untrackedRows.slice(0, 80).map(async row => {
    const count = await countTextLines(root, row.path)
    return { row, count }
  }))
  const untrackedCounts = new Map(untrackedLineCounts.map(({ row, count }) => [row.path, count]))

  for (const row of rows) {
    if (row.x === '?' && row.y === '?') {
      unstagedChanges.push({
        path: row.path,
        workspaceRelativePath: row.path,
        added: untrackedCounts.get(row.path) ?? 0,
        removed: 0,
        kind: 'untracked',
      })
      continue
    }
    if (row.x !== ' ' && row.x !== '?') {
      const counts = lookup(stagedNumstat, row)
      stagedChanges.push({
        path: row.path,
        workspaceRelativePath: row.path,
        added: counts.added,
        removed: counts.removed,
        kind: gitChangeKind(row.x),
      })
    }
    if (row.y !== ' ' && row.y !== '?') {
      const counts = lookup(unstagedNumstat, row)
      unstagedChanges.push({
        path: row.path,
        workspaceRelativePath: row.path,
        added: counts.added,
        removed: counts.removed,
        kind: gitChangeKind(row.y),
      })
    }
  }

  const sortChanges = (changes: SidebarGitChange[]): SidebarGitChange[] =>
    changes.sort((a, b) => a.workspaceRelativePath.localeCompare(b.workspaceRelativePath))

  const kindFromNumstat = (added: number, removed: number): SidebarGitChange['kind'] => {
    if (added > 0 && removed > 0) return 'modified'
    if (added > 0) return 'added'
    if (removed > 0) return 'deleted'
    return 'modified'
  }
  const branchChanges: SidebarGitChange[] = [...branchNumstat.entries()].map(([path, counts]) => ({
    path,
    workspaceRelativePath: path,
    added: counts.added,
    removed: counts.removed,
    kind: kindFromNumstat(counts.added, counts.removed),
  }))
  const branchComparisonLabel = trackingBranch === '' ? null : branch === '' ? `HEAD -> ${trackingBranch}` : `${branch} -> ${trackingBranch}`

  const summary: SidebarGitSummary = {
    isGitAvailable,
    isRepository,
    added: [...stagedNumstat.values(), ...unstagedNumstat.values()].reduce((sum, entry) => sum + entry.added, 0),
    removed: [...stagedNumstat.values(), ...unstagedNumstat.values()].reduce((sum, entry) => sum + entry.removed, 0),
  }

  return {
    rows,
    sourceOptions: [
      { id: 'unstaged', disabled: false },
      { id: 'staged', disabled: false },
      { id: 'branch', disabled: false },
    ],
    datasets: {
      unstaged: { id: 'unstaged', sections: unstagedChanges.length > 0 ? [{ id: 'unstaged', changes: sortChanges(unstagedChanges) }] : [] },
      staged: { id: 'staged', sections: stagedChanges.length > 0 ? [{ id: 'staged', changes: sortChanges(stagedChanges) }] : [] },
      branch: { id: 'branch', sections: branchChanges.length > 0 ? [{ id: 'branch', changes: sortChanges(branchChanges) }] : [], comparisonLabel: branchComparisonLabel },
    },
    summary,
    branch,
    revision: 0,
  }
}

/** Git 提交（结构化字段，供前端点击查看详情）。 */
interface SidebarGitCommit {
  hash: string
  short: string
  subject: string
  author: string
  date: string
  parents: string[]
}

/** Git log graph（文本图 + 结构化提交）。 */
async function sidebarGitLog(root: string, skip = 0): Promise<{ branch: string; log: string; commits: SidebarGitCommit[]; hasMore: boolean } | undefined> {
  try {
    const [branch, log, detailed] = await Promise.all([
      execFile('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        timeout: 8000, maxBuffer: 1024 * 1024, windowsHide: true,
      }),
      execFile('git', ['-C', root, 'log', '--oneline', '--graph', '--decorate', '--skip', String(skip), '-n', '80'], {
        timeout: 8000, maxBuffer: 1024 * 1024, windowsHide: true,
      }),
      execFile('git', ['-C', root, 'log', '--skip', String(skip), '-n', '80', '--date=short', '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ad%x1f%P'], {
        timeout: 8000, maxBuffer: 1024 * 1024, windowsHide: true,
      }),
    ])
    const commits: SidebarGitCommit[] = detailed.stdout.split(/\r?\n/).filter(Boolean).map(line => {
      const [hash = '', short = '', subject = '', author = '', date = '', parentsRaw = ''] = line.split('\x1f')
      return {
        hash,
        short,
        subject,
        author,
        date,
        parents: parentsRaw.split(/\s+/).filter(Boolean),
      }
    })
    return {
      branch: branch.stdout.trim().split(/\r?\n/)[0] ?? 'HEAD',
      log: log.stdout.trim(),
      commits,
      hasMore: commits.length === 80,
    }
  } catch {
    return undefined
  }
}

const DEEPSEEK_KEY_REFS = ['DEEPSEEK_API_KEY', 'DEEPSEEK_OFFICIAL_API_KEY']
const DEEPSEEK_BASE_URL = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.DEEPSEEK_BASE_URL
  ?? 'https://api.deepseek.com'

const OPENCODE_GO_KEY_REFS = ['OPENCODE_GO_API_KEY', 'OPENCODE_API_KEY']
const OPENCODE_GO_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'

interface QuotaBalanceInfo {
  currency?: string
  total_balance?: string
  granted_balance?: string
  topped_up_balance?: string
}

interface QuotaPayload {
  provider: string
  kind: 'package' | 'balance' | 'unavailable'
  balance?: string
  currency?: string
  items?: Array<{
    key: 'fiveHours' | 'week' | 'month'
    label: string
    value: string
  }>
}

function json(res: Parameters<WebRoute['handler']>[1], status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
/** 读取小型 JSON 请求体（本地设置持久化用，上限 6MB 以容纳壁纸 dataURL）。 */
async function readJsonBody(req: IncomingMessage, limit = 6 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > limit) throw new Error('body too large')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** 琉璃主题持久化文件（DSH Desktop 每次重启 Web 端口会变，localStorage 按 origin 隔离，
 *  因此跨重启稳定状态必须落到 Host 端文件；纯 Web 没有 Host 时仍回退 localStorage）。 */
function liuliSettingsFile(): string {
  const root = process.env.LIULI_THEME_DATA_DIR || joinPath(homedir(), '.liuli-theme')
  return joinPath(root, 'settings.json')
}

/** 非官方增强开关（Host 半，兼容其它插件）：同步读取用户保存的 Host 设置文件
 * （客户端每次改设置都会 PUT 到这里；文件缺失/损坏时默认全部开启，行为不变）。
 * 只读布尔字段，刻意不 import schemastery，避免把额外依赖拖进 node bundle。
 * 注意：这里的开关只在「有真实副作用的动作」上生效——frameless 补丁（改写
 * DSH app.asar）、系统音频授权 handler（全局 handler 安装）、内嵌浏览器引擎、
 * /side /btw 指令注册；各 /liuli-* 数据路由保持注册（被动、无冲突）。 */
function hostUnofficialFlags(): { desktop: boolean; browser: boolean; dom: boolean } {
  const flags = { desktop: true, browser: true, dom: true }
  try {
    const text = readFileSync(liuliSettingsFile(), 'utf8')
    const data = JSON.parse(text) as { settings?: Record<string, unknown> | null }
    const s = data.settings
    if (typeof s !== 'object' || s === null) return flags
    if (s.unofficial_enabled === false) return { desktop: false, browser: false, dom: false }
    flags.desktop = s.unofficial_desktop !== false
    flags.browser = s.unofficial_browser !== false
    flags.dom = s.unofficial_dom !== false
    return flags
  } catch {
    return flags
  }
}

/** /liuli-settings：Host 端保存/读取琉璃界面设置与壁纸（跨 ephemeral 端口持久化）。 */
function liuliSettingsRoute(): WebRoute {
  return {
    kind: 'prefix',
    path: '/liuli-settings',
    handler: async (req, res) => {
      try {
        // 只允许同源页面读写；带 Origin 的跨站请求直接拒绝。
        const origin = req.headers.origin
        if (origin !== undefined) {
          const originHost = new URL(origin).host
          const host = req.headers.host ?? ''
          if (originHost !== host) {
            json(res, 403, { ok: false, error: 'cross-origin liuli settings request is not allowed' })
            return
          }
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (url.pathname !== '/liuli-settings') {
          json(res, 404, { ok: false, error: 'not found' })
          return
        }
        const file = liuliSettingsFile()
        if (req.method === 'GET' || req.method === 'HEAD') {
          try {
            const text = await readFile(file, 'utf8')
            json(res, 200, { ok: true, value: JSON.parse(text) as unknown })
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              json(res, 200, { ok: true, value: null })
            } else {
              throw error
            }
          }
          return
        }
        if (req.method !== 'PUT' && req.method !== 'POST') {
          json(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req) as { settings?: unknown; wallpaper?: unknown; sessionMarkers?: unknown } | null
        if (typeof body !== 'object' || body === null) {
          json(res, 400, { ok: false, error: 'invalid JSON body' })
          return
        }
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, JSON.stringify({
          v: 1,
          savedAt: Date.now(),
          settings: body.settings ?? null,
          wallpaper: typeof body.wallpaper === 'string' ? body.wallpaper : null,
          // 会话标记（右键菜单「添加标记」）：与设置/壁纸一样跨重启持久化。
          sessionMarkers: typeof body.sessionMarkers === 'object' && body.sessionMarkers !== null
            ? body.sessionMarkers
            : null,
        }), 'utf8')
        json(res, 200, { ok: true })
      } catch (error) {
        json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}


async function resolveFirstCredential(ctx: Context, refs: readonly string[]): Promise<string | undefined> {
  for (const ref of refs) {
    const resolved = await ctx.credentials.resolve(credentialRef(ref))
    if (resolved !== undefined) return resolved.value
  }
  return undefined
}

async function fetchJson(url: string, token: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) {
    throw new Error(`quota endpoint responded HTTP ${response.status}`)
  }
  return response.json() as Promise<unknown>
}

function unavailable(provider: string): QuotaPayload {
  return { provider, kind: 'unavailable' }
}

async function queryDeepSeek(ctx: Context, provider: string): Promise<QuotaPayload> {
  const token = await resolveFirstCredential(ctx, DEEPSEEK_KEY_REFS)
  if (token === undefined) return unavailable(provider)
  const data = await fetchJson(`${DEEPSEEK_BASE_URL}/user/balance`, token) as {
    is_available?: boolean
    balance_infos?: QuotaBalanceInfo[]
  }
  const info = data.balance_infos?.[0]
  if (info === undefined) return unavailable(provider)
  return {
    provider,
    kind: 'balance',
    balance: info.total_balance ?? '0',
    ...(info.currency === undefined ? {} : { currency: info.currency }),
  }
}

async function queryOpencodeGo(ctx: Context, provider: string): Promise<QuotaPayload> {
  const token = await resolveFirstCredential(ctx, OPENCODE_GO_KEY_REFS)
  if (token === undefined) return unavailable(provider)
  const data = await fetchJson(OPENCODE_GO_USAGE_URL, token) as {
    usage?: {
      rolling?: { status?: string; percent?: number; resetsAt?: string }
      weekly?: { status?: string; percent?: number; resetsAt?: string }
      monthly?: { status?: string; percent?: number; resetsAt?: string }
    }
  }
  const usage = data.usage
  if (usage === undefined) return unavailable(provider)
  const percent = (value: number | undefined): string => value === undefined ? '--' : `${Math.round(value)}%`
  return {
    provider,
    kind: 'package',
    items: [
      { key: 'fiveHours', label: '5小时', value: percent(usage.rolling?.percent) },
      { key: 'week', label: '本周', value: percent(usage.weekly?.percent) },
      { key: 'month', label: '本月', value: percent(usage.monthly?.percent) },
    ],
  }
}

async function queryQuota(ctx: Context, provider: string): Promise<QuotaPayload> {
  switch (provider) {
    case 'deepseek':
    case 'deepseek-official':
      return queryDeepSeek(ctx, provider)
    case 'opencode-go':
      return queryOpencodeGo(ctx, provider)
    default:
      return unavailable(provider)
  }
}

/** 宿主插件体：注册 /liuli-quota 与 /preview 本地路由。 */
export function apply(ctx: Context): void {
  // 非官方增强开关（兼容其它插件）：与浏览器半共用同一份 Host 设置文件。
  const unofficial = hostUnofficialFlags()

  // 客户端更新会还原 app.asar，无边框补丁需要在插件启动时自动重打。
  // 幂等；仅 win32 + Electron 主进程生效，纯 Web / 其他平台自动跳过。
  // 补丁为尽力而为：失败只告警不阻断插件加载，避免外观功能变成启动阻塞点。
  // unofficial_desktop 关闭时不再打补丁，并自动还原已打的补丁
  // （原生标题栏回归；生效需重启 DSH Desktop 一次）。
  if (unofficial.desktop) {
    applyFramelessPatch()
  } else {
    revertFramelessPatch()
  }

  const route: WebRoute = {
    kind: 'prefix',
    path: '/liuli-quota',
    handler: async (req, res) => {
      try {
        // 只允许同源页面读取额度；带 Origin 的跨站请求直接拒绝。
        const origin = req.headers.origin
        if (origin !== undefined) {
          const originHost = new URL(origin).host
          const host = req.headers.host ?? ''
          if (originHost !== host) {
            json(res, 403, { error: 'cross-origin quota request is not allowed' })
            return
          }
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const provider = url.searchParams.get('provider') ?? ''
        if (provider === '') {
          json(res, 400, { error: 'missing provider' })
          return
        }
        const payload = await queryQuota(ctx, provider)
        json(res, 200, payload)
      } catch (error) {
        json(res, 502, {
          provider: 'unknown',
          kind: 'unavailable',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'dsh-liuli-ui-enhance: /liuli-quota route')
  ctx.effect(() => ctx.webServer.register(liuliSettingsRoute()), 'dsh-liuli-ui-enhance: /liuli-settings route')
  ctx.effect(() => ctx.webServer.register(previewRoute(ctx)), 'dsh-liuli-ui-enhance: /preview route')
  ctx.effect(() => ctx.webServer.register(sidebarRoute(ctx)), 'dsh-liuli-ui-enhance: /liuli-sidebar route')
  ctx.effect(() => ctx.webServer.registerUpgrade(terminalUpgradeRoute(ctx)), 'dsh-liuli-ui-enhance: /liuli-terminal upgrade route')
  ctx.effect(() => ctx.webServer.register(proxyRoute()), 'dsh-liuli-ui-enhance: /liuli-proxy route')
  // advanced（无边框）模式页面内窗口按钮（WindowControls.tsx）的宿主窗口控制面：
  // GET 查询可用/最大化态，POST 触发 minimize/toggleMaximize/close；纯 Web 返回 available:false。
  ctx.effect(() => ctx.webServer.register(windowControlRoute()), 'dsh-liuli-ui-enhance: /liuli-window route')
  // 审查面板「在资源管理器中打开」：系统文件管理器定位文件（explorer /select 等）。
  ctx.effect(() => ctx.webServer.register(revealRoute(ctx)), 'dsh-liuli-ui-enhance: /liuli-reveal route')
  // 工作区右键菜单「在资源管理器中打开」：按 workspaceId 解析注册目录并打开系统文件管理器。
  ctx.effect(() => ctx.webServer.register(revealWorkspaceRoute(ctx)), 'dsh-liuli-ui-enhance: /liuli-reveal-workspace route')
  // 系统音频监听（HeaderEffects.tsx 的「监听系统音量」按钮）：Electron 主进程给
  // defaultSession 装 setDisplayMediaRequestHandler，getDisplayMedia 的 audio 请求
  // 直接授予系统回环音频（audio:'loopback'，仅 Windows）；另提供 /liuli-audio 探测
  // （路由保持注册，未装 handler 时返回 available:false，前端降级走默认授权流程）。
  // 纯 Web 部署两者都为空操作（handler 不装、路由返回 available:false）。
  // unofficial_desktop 关闭时只跳过 handler 安装（全局 handler 会与其他插件冲突）。
  ctx.effect(() => {
    if (!unofficial.desktop) return () => {}
    let disposed = false
    let dispose: (() => void) | undefined
    void installSystemAudioCapture().then((release) => {
      if (disposed) release()
      else dispose = release
    })
    return () => {
      disposed = true
      dispose?.()
    }
  }, 'dsh-liuli-ui-enhance: desktop system audio capture handler')
  ctx.effect(() => ctx.webServer.register(audioCaptureRoute()), 'dsh-liuli-ui-enhance: /liuli-audio route')
  // /side、/btw 指令：挂到 DSH 命令注册表（控制面，绝不进入模型历史）。
  // 命令本身只回成功；fork 子会话与标签打开在客户端观察 command/executed 完成，
  // 保证辅助对话的 fork 不进入会话列表（只出现在标签页）。
  // unofficial_dom 关闭时不注册（客户端对应桥也一并停用）。
  if (unofficial.dom) {
    ctx.inject(['commands'], (commandCtx) => {
      const commands = (commandCtx as unknown as { commands: LiuliCommandRegistry }).commands
      commands.register({
        name: 'side',
        description: '在当前会话侧边栏新建一个辅助对话',
        handler: () => ({ kind: 'success' }),
      })
      commands.register({
        name: 'btw',
        description: '把问题交给辅助对话并发回答，不改变当前会话上下文',
        input: { hint: '<问题>', images: false },
        recordInput: false,
        handler: ({ rawInput }) => ({ kind: 'success', text: rawInput.trim() }),
      })
    })
  }
  // 嵌入式浏览器引擎（DSH Desktop IAB 实现）：仅 Electron 主进程内有
  // WebContentsView 可承载真实 webview；纯 Web 部署返回 undefined，
  // 渲染端探测 /liuli-browser/capabilities 失败后自动回退 iframe。
  // unofficial_browser 关闭时直接跳过（前端浏览器标签自动回退 iframe / 代理）。
  if (unofficial.browser) {
    void createBrowserEngine().then((engine) => {
      if (engine === undefined) return
      try {
        ctx.effect(() => {
          const release = ctx.webServer.register(engine.route)
          return () => { release(); engine.dispose() }
        }, 'dsh-liuli-ui-enhance: /liuli-browser route (embedded webview engine)')
      } catch {
        // 插件在探测完成前被卸载：直接销毁引擎。
        engine.dispose()
      }
    }).catch((cause: unknown) => {
      try {
        ctx.logger.warn(`dsh-liuli-ui-enhance: embedded browser engine unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
      } catch { /* 上下文已释放则静默 */ }
    })
  }
}

/* ── /preview：会话 cwd 同源静态服务（预览面板 iframe）────────────── */

/** Content types keyed by lowercase extension; anything unknown is an octet stream. */
const PREVIEW_MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

/** Whether a WHATWG URL hostname names the local loopback authority. */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Parse a `/preview/<sessionId>/<relative-path>` pathname into its two parts. */
function parsePreviewPath(pathname: string): { sessionId: string; rel: string } | undefined {
  const PREFIX = '/preview'
  if (pathname !== PREFIX && !pathname.startsWith(`${PREFIX}/`)) return undefined
  const trimmed = pathname.slice(PREFIX.length).replace(/^\//, '')
  const slash = trimmed.indexOf('/')
  const rawSession = slash === -1 ? trimmed : trimmed.slice(0, slash)
  const rawRel = slash === -1 ? '' : trimmed.slice(slash + 1)
  let sessionId: string
  let rel: string
  try {
    sessionId = decodeURIComponent(rawSession)
    rel = decodeURIComponent(rawRel)
  } catch {
    return undefined
  }
  if (sessionId === '') return undefined
  return { sessionId, rel }
}

/** Resolve a requested relative path strictly within a root directory. */
function resolveWithin(root: string, rel: string): string | undefined {
  const target = resolvePath(root, rel)
  if (target !== root && !target.startsWith(`${root}${sep}`)) return undefined
  return target
}

function previewSendError(res: ServerResponse, code: number, text: string): void {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}

function previewSendFile(res: ServerResponse, path: string, size: number, method: string | undefined): void {
  res.writeHead(200, {
    'content-type': PREVIEW_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(size),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  })
  if (method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(path).pipe(res)
}

/** Escape HTML text for the directory listing page. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Render a simple directory listing for the preview iframe（无 index.html 时兜底）。 */
async function previewSendDirectoryListing(
  res: ServerResponse,
  target: string,
  sessionId: string,
  rel: string,
  method: string | undefined,
  artifacts: boolean,
): Promise<void> {
  let entries
  try {
    entries = await readdir(target, { withFileTypes: true })
  } catch {
    previewSendError(res, 500, 'failed to list directory')
    return
  }
  const basePath = `/preview/${encodeURIComponent(sessionId)}/${rel === ''
    ? ''
    : rel.split('/').filter(Boolean).map(segment => encodeURIComponent(segment)).join('/') + '/'}`
  const query = artifacts ? '?artifacts=1' : ''
  const items = entries
    .filter(entry => !entry.name.startsWith('.'))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    .map((entry) => {
      const name = entry.name
      const suffix = entry.isDirectory() ? '/' : ''
      const href = `${basePath}${encodeURIComponent(name)}${suffix}${query}`
      return `<li><a href="${href}">${escapeHtml(name)}${suffix}</a></li>`
    })
    .join('')
  const title = rel === '' ? '会话产物' : `会话产物 / ${rel}`
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --liuli-bg: #f8f9fa;
    --liuli-card: rgba(221, 229, 237, 0.65);
    --liuli-card-hover: rgba(221, 229, 237, 0.95);
    --liuli-border: rgba(15, 20, 28, 0.1);
    --liuli-text: #1a1c1e;
    --liuli-text-secondary: #5e636b;
    --liuli-brand: #0079bf;
    --liuli-brand-soft: rgba(0, 121, 191, 0.1);
    --liuli-shadow: 0 2px 10px rgba(0, 0, 0, 0.08);
  }
  html[data-liuli-dark] {
    --liuli-bg: #121316;
    --liuli-card: rgba(30, 37, 48, 0.65);
    --liuli-card-hover: rgba(63, 74, 92, 0.8);
    --liuli-border: rgba(255, 255, 255, 0.1);
    --liuli-text: #e2e2e6;
    --liuli-text-secondary: #9d9da3;
    --liuli-brand: #8ecdf8;
    --liuli-brand-soft: rgba(142, 205, 248, 0.12);
    --liuli-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    padding: 20px;
    font: 14px/1.6 "MiSans", "Inter", "Segoe UI", system-ui, sans-serif;
    background: var(--liuli-bg);
    color: var(--liuli-text);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--liuli-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex: none;
    padding: 2px 10px;
    border: 1px solid color-mix(in srgb, var(--liuli-brand) 40%, transparent);
    border-radius: 999px;
    background: var(--liuli-brand-soft);
    color: var(--liuli-brand);
    font-size: 12px;
    line-height: 20px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  li {
    border-radius: 12px;
    border: 1px solid var(--liuli-border);
    background: var(--liuli-card);
    box-shadow: var(--liuli-shadow);
    transition: background 140ms ease, transform 140ms ease;
  }
  li:hover {
    background: var(--liuli-card-hover);
    transform: translateY(-1px);
  }
  a {
    display: block;
    padding: 10px 14px;
    color: var(--liuli-brand);
    text-decoration: none;
    font-family: "JetBrains Mono", "SF Mono", "Consolas", monospace;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .empty {
    padding: 20px;
    border-radius: 12px;
    border: 1px dashed var(--liuli-border);
    color: var(--liuli-text-secondary);
    text-align: center;
  }
</style>
<script>
  (function () {
    try {
      var dark = window.parent.document.body.hasAttribute('data-ds-dark-theme');
      document.documentElement.toggleAttribute('data-liuli-dark', dark);
    } catch (_) { /* 跨源时保持亮色 */ }
  })();
</script>
</head>
<body>
  <div class="head">
    <h1>${escapeHtml(title)}</h1>
    <span class="badge">琉璃预览</span>
  </div>
  ${items === '' ? '<div class="empty">（空目录）</div>' : `<ul>${items}</ul>`}
</body>
</html>`
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(Buffer.byteLength(html)),
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
  })
  if (method === 'HEAD') {
    res.end()
    return
  }
  res.end(html)
}

/** Resolve and serve one preview request（Host fence：loopback 或同源）。 */
async function servePreview(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    previewSendError(res, 405, 'method not allowed')
    return
  }
  const host = req.headers.host
  if (host === undefined || !isLoopbackHostname(new URL(`http://${host}`).hostname)) {
    previewSendError(res, 403, 'forbidden')
    return
  }
  const url = new URL(req.url ?? '/', 'http://x')
  const pathname = url.pathname
  const wantsArtifacts = url.searchParams.get('artifacts') === '1'
  const parsed = parsePreviewPath(pathname)
  if (parsed === undefined) {
    previewSendError(res, 404, 'not found')
    return
  }
  const root = sidebarSessionRoot(ctx, parsed.sessionId)
  if (root === undefined) {
    previewSendError(res, 404, 'not found')
    return
  }
  const target = resolveWithin(root, parsed.rel)
  if (target === undefined) {
    previewSendError(res, 403, 'forbidden')
    return
  }
  let info
  try {
    info = await stat(target)
  } catch {
    previewSendError(res, 404, 'not found')
    return
  }
  if (info.isDirectory()) {
    // 产物模式：始终展示目录列表，而不是自动打开 index.html。
    if (wantsArtifacts) {
      await previewSendDirectoryListing(res, target, parsed.sessionId, parsed.rel, req.method, true)
      return
    }
    const index = resolvePath(target, 'index.html')
    try {
      const indexInfo = await stat(index)
      if (indexInfo.isFile()) {
        previewSendFile(res, index, indexInfo.size, req.method)
        return
      }
    } catch {
      // Fall through to the directory listing.
    }
    await previewSendDirectoryListing(res, target, parsed.sessionId, parsed.rel, req.method, false)
    return
  }
  if (!info.isFile()) {
    previewSendError(res, 404, 'not found')
    return
  }
  previewSendFile(res, target, info.size, req.method)
}

/** Build the /preview prefix route over the live-session cwd store. */
function previewRoute(ctx: Context): WebRoute {
  return {
    kind: 'prefix',
    path: '/preview',
    handler: (req, res) => { void servePreview(ctx, req, res) },
  }
}

/* ── /liuli-sidebar：右侧边栏数据路由实现 ─────────────────────────────── */

/** 解析 /liuli-sidebar 请求并返回 JSON。 */
async function serveSidebar(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  const host = req.headers.host
  if (host === undefined || !isLoopbackHostname(new URL(`http://${host}`).hostname)) {
    json(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://x')
  const pathname = url.pathname
  const sessionId = url.searchParams.get('sessionId') ?? ''
  if (sessionId === '') {
    json(res, 400, { ok: false, error: 'missing sessionId' })
    return
  }
  const root = sidebarSessionRoot(ctx, sessionId)
  if (root === undefined) {
    json(res, 404, { ok: false, error: 'not found' })
    return
  }

  try {
    if (pathname === '/liuli-sidebar/tree') {
      const rel = url.searchParams.get('path') ?? ''
      const entries = await sidebarReadTree(root, rel)
      json(res, 200, { ok: true, root, rel, entries })
      return
    }
    if (pathname === '/liuli-sidebar/git') {
      const skip = Math.max(0, Math.trunc(Number(url.searchParams.get('skip') ?? '0')) || 0)
      const [state, graph] = await Promise.all([sidebarGitState(root), sidebarGitLog(root, skip)])
      json(res, 200, {
        ok: true,
        root,
        git: state.summary.isGitAvailable || graph !== undefined,
        status: state.rows,
        branch: graph?.branch ?? state.branch,
        log: graph?.log ?? '',
        commits: graph?.commits ?? [],
        hasMore: graph?.hasMore ?? false,
        sourceOptions: state.sourceOptions,
        datasets: state.datasets,
        summary: state.summary,
        loading: false,
        revision: state.revision,
      })
      return
    }
    if (pathname === '/liuli-sidebar/file') {
      const rel = url.searchParams.get('path') ?? ''
      const payload = await sidebarReadFile(root, rel)
      json(res, 200, { ok: true, root, rel, ...payload })
      return
    }
    if (pathname === '/liuli-sidebar/diff') {
      const rel = url.searchParams.get('path') ?? ''
      const sourceParam = url.searchParams.get('source') ?? 'unstaged'
      const source: SidebarGitSourceId = sourceParam === 'staged' || sourceParam === 'branch' ? sourceParam : 'unstaged'
      const payload = await sidebarFileDiff(root, rel, source)
      json(res, 200, { ok: true, root, rel, ...payload })
      return
    }
    json(res, 404, { ok: false, error: 'not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = message === 'forbidden' ? 403 : message === 'not a directory' ? 400 : 500
    json(res, code, { ok: false, error: message })
  }
}

/** Build the /liuli-sidebar prefix route. */
function sidebarRoute(ctx: Context): WebRoute {
  return {
    kind: 'prefix',
    path: '/liuli-sidebar',
    handler: (req, res) => { void serveSidebar(ctx, req, res) },
  }
}

/* ── /liuli-sidebar/file：读取会话工作区单个文件全文（审查面板「全文」用） ── */

/** 读取一个文本文件全文；二进制（含 NUL 字节）或超大文件返回错误。 */
async function sidebarReadFile(root: string, rel: string): Promise<{
  path: string
  content: string
  size: number
}> {
  const target = resolveWithin(root, rel)
  if (target === undefined) throw new Error('forbidden')
  const info = await stat(target)
  if (!info.isFile()) throw new Error('not a file')
  if (info.size > 4 * 1024 * 1024) throw new Error('file too large to preview')
  const raw = await readFile(target)
  if (raw.includes(0)) throw new Error('binary file')
  return { path: target, content: raw.toString('utf8'), size: info.size }
}

/* ── /liuli-sidebar/diff：单文件 git diff（审查面板「Diff」用） ── */

/** 未跟踪文件：把全文渲染成整文件新增的 diff。 */
function wholeFileAddedDiff(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  return lines.map(line => '+' + line).join('\n')
}

/** 读取单个文件的 git diff（参考实现 风格：availability / patch / beforeContent / afterContent）。 */
async function sidebarFileDiff(root: string, rel: string, source: SidebarGitSourceId = 'unstaged'): Promise<{
  path: string
  diff: string
  x: string
  y: string
  untracked: boolean
  availability: 'patch' | 'binary' | 'unavailable'
  patch?: string
  beforeContent?: string | null
  afterContent?: string | null
  summary?: string
}> {
  const target = resolveWithin(root, rel)
  if (target === undefined) throw new Error('forbidden')
  const info = await stat(target).catch(() => undefined)
  const relPath = target === undefined ? rel : relativePath(root, target)
  const gitPath = relPath.replace(/\\/g, '/')
  let x = ' '
  let y = ' '
  let untracked = false

  if (source === 'branch') {
    let diff = ''
    let summary: string | undefined
    try {
      const upstream = await execFile('git', ['-C', root, 'rev-parse', '--abbrev-ref', '@{upstream}'], {
        timeout: 8000, maxBuffer: 1024, windowsHide: true,
      })
      const tracking = upstream.stdout.trim().split(/\r?\n/)[0] ?? ''
      if (tracking === '') {
        return { path: target ?? rel, diff: '', x, y, untracked: false, availability: 'unavailable', summary: '当前分支没有上游分支。' }
      }
      const result = await execFile('git', ['-C', root, 'diff', `${tracking}...HEAD`, '--', gitPath], {
        timeout: 8000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
      })
      diff = result.stdout
    } catch (error) {
      summary = error instanceof Error ? error.message : String(error)
    }
    if (diff === '') {
      return { path: target ?? rel, diff, x, y, untracked: false, availability: 'unavailable', summary: summary ?? '没有可显示的 branch diff' }
    }
    if (/^Binary files /m.test(diff)) {
      return { path: target ?? rel, diff, x, y, untracked: false, availability: 'binary', summary: diff.trim() }
    }
    return {
      path: target ?? rel,
      diff,
      x,
      y,
      untracked: false,
      availability: 'patch',
      patch: diff,
      beforeContent: null,
      afterContent: null,
    }
  }

  try {
    const { stdout } = await execFile('git', ['-C', root, 'status', '--porcelain=v1', '--', gitPath], {
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    })
    const line = stdout.split(/\r?\n/).find(entry => entry.length >= 3)
    if (line !== undefined) {
      x = line[0] ?? ' '
      y = line[1] ?? ' '
      untracked = x === '?' || x === '!'
    }
  } catch {
    // 非 git 仓库：保持默认空格状态。
  }
  if (untracked) {
    if (target !== undefined && info?.isFile() === true) {
      try {
        const raw = await readFile(target)
        if (raw.includes(0)) {
          return { path: target, diff: '', x, y, untracked: true, availability: 'binary', summary: '二进制文件' }
        }
        const content = raw.toString('utf8')
        return {
          path: target,
          diff: wholeFileAddedDiff(content),
          x,
          y,
          untracked: true,
          availability: 'patch',
          patch: wholeFileAddedDiff(content),
          beforeContent: null,
          afterContent: content,
        }
      } catch {
        return { path: target, diff: '', x, y, untracked: true, availability: 'unavailable', summary: '无法读取文件' }
      }
    }
    return { path: target ?? rel, diff: '', x, y, untracked: true, availability: 'unavailable', summary: '文件不存在' }
  }
  let diff = ''
  try {
    const args = source === 'staged'
      ? ['-C', root, 'diff', '--cached', '--', gitPath]
      : ['-C', root, 'diff', '--', gitPath]
    const { stdout } = await execFile('git', args, {
      timeout: 8000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })
    diff = stdout
  } catch {
    // 非 git 仓库或无 HEAD：无 diff。
  }
  if (diff === '') {
    return { path: target ?? rel, diff, x, y, untracked: false, availability: 'unavailable', summary: '没有可显示的 diff' }
  }
  if (/^Binary files /m.test(diff)) {
    return { path: target ?? rel, diff, x, y, untracked: false, availability: 'binary', summary: diff.trim() }
  }
  return {
    path: target ?? rel,
    diff,
    x,
    y,
    untracked: false,
    availability: 'patch',
    patch: diff,
    beforeContent: null,
    afterContent: null,
  }
}

/* ── /liuli-reveal：在系统文件管理器中显示文件（审查「在资源管理器中打开」） ── */

/** 系统「在文件管理器中显示」命令（按平台）。 */
function revealInExplorer(target: string): void {
  if (process.platform === 'win32') {
    // 注意：1) 不能加 windowsHide:true —— 实测它会连 explorer 主窗口一起隐藏；
    // 2) 参数必须拆成 ['/select,', target] 两个参数，合成单个 '/select,<path>'
    // 在路径含空格时会被 explorer 解析错（打开「文档」而不是选中文件）。
    spawn('explorer.exe', ['/select,', target], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (process.platform === 'darwin') {
    spawn('open', ['-R', target], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  spawn('xdg-open', [dirname(target)], { detached: true, stdio: 'ignore' }).unref()
}

/** 解析 /liuli-reveal 请求（Host fence：回环调用方 + 会话根内路径）。 */
async function serveReveal(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  const host = req.headers.host
  if (host === undefined || !isLoopbackHostname(new URL('http://' + host).hostname)) {
    json(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://x')
  const sessionId = url.searchParams.get('sessionId') ?? ''
  const path = url.searchParams.get('path') ?? ''
  if (sessionId === '' || path === '') {
    json(res, 400, { ok: false, error: 'missing sessionId or path' })
    return
  }
  const root = sidebarSessionRoot(ctx, sessionId)
  if (root === undefined) {
    json(res, 404, { ok: false, error: 'not found' })
    return
  }
  const target = resolveWithin(root, path)
  if (target === undefined) {
    json(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  try {
    revealInExplorer(target)
    json(res, 200, { ok: true })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Build the /liuli-reveal prefix route. */
function revealRoute(ctx: Context): WebRoute {
  return {
    kind: 'prefix',
    path: '/liuli-reveal',
    handler: (req, res) => { void serveReveal(ctx, req, res) },
  }
}

/* ── /liuli-reveal-workspace：工作区右键「在资源管理器中打开」────────── */

/** 系统「打开文件夹」命令（按平台；区别于 revealInExplorer 的定位/选中文件）。 */
function openInExplorer(target: string): void {
  if (process.platform === 'win32') {
    // 与 /liuli-reveal 不同：这里打开目录本身，不带 /select 前缀；
    // 单个参数交给 spawn 的 CreateProcess 引号处理，路径含空格也安全。
    spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (process.platform === 'darwin') {
    spawn('open', [target], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref()
}

/** 解析 /liuli-reveal-workspace 请求（Host fence：回环调用方 + 同源 + 注册工作区 id）。 */
async function serveRevealWorkspace(ctx: Context, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  const host = req.headers.host
  if (host === undefined || !isLoopbackHostname(new URL('http://' + host).hostname)) {
    json(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  // 跨源拒绝（与 /liuli-quota 同款 fence）：带 Origin 且不同源的请求（如内嵌
  // 浏览器里的远程网页 no-cors fetch）不允许触发本路由，防止任意本地目录被
  // 远程页面打开。
  const origin = req.headers.origin
  if (origin !== undefined) {
    const originHost = new URL(origin).host
    if (originHost !== host) {
      json(res, 403, { ok: false, error: 'cross-origin request is not allowed' })
      return
    }
  }
  const url = new URL(req.url ?? '/', 'http://x')
  const workspaceId = url.searchParams.get('workspaceId') ?? ''
  const clientPath = url.searchParams.get('path') ?? ''
  if (workspaceId === '' && clientPath === '') {
    json(res, 400, { ok: false, error: 'missing workspaceId or path' })
    return
  }
  let target: string | undefined
  if (workspaceId !== '') {
    const registry = hostWorkspaceRegistry(ctx)
    if (registry === undefined) {
      console.warn('[dsh-liuli-ui-enhance] /liuli-reveal-workspace: workspaceRegistry 服务不可用，回退客户端路径')
    } else {
      target = registry.get(workspaceId)?.path
    }
    if (target === undefined && clientPath === '') {
      json(res, 404, { ok: false, error: 'workspace not found' })
      return
    }
  }
  if (target === undefined) {
    // 回退：客户端已知的工作区路径（仅回环同源调用方，且必须是绝对路径）。
    if (!isPathAbsolute(clientPath)) {
      json(res, 403, { ok: false, error: 'forbidden' })
      return
    }
    target = clientPath
  }
  try {
    const info = await stat(target)
    if (!info.isDirectory()) {
      json(res, 404, { ok: false, error: 'not a directory' })
      return
    }
  } catch {
    json(res, 404, { ok: false, error: 'directory not found' })
    return
  }
  try {
    openInExplorer(target)
    json(res, 200, { ok: true })
  } catch (error) {
    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Build the /liuli-reveal-workspace prefix route. */
function revealWorkspaceRoute(ctx: Context): WebRoute {
  return {
    kind: 'prefix',
    path: '/liuli-reveal-workspace',
    handler: (req, res) => { void serveRevealWorkspace(ctx, req, res) },
  }
}

/* ── /liuli-terminal：WebSocket 终端（侧边面板「终端」标签）────────────── */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** Compute the Sec-WebSocket-Accept hash for the handshake. */
function wsAccept(key: string): string {
  return createHash('sha1').update(key + WS_GUID).digest('base64')
}

/** Encode one unmasked text frame. */
function wsEncodeText(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const len = payload.length
  if (len < 126) {
    return Buffer.concat([Buffer.from([0x81, len]), payload])
  }
  if (len < 65536) {
    const head = Buffer.alloc(4)
    head[0] = 0x81
    head[1] = 126
    head.writeUInt16BE(len, 2)
    return Buffer.concat([head, payload])
  }
  const head = Buffer.alloc(10)
  head[0] = 0x81
  head[1] = 127
  head.writeBigUInt64BE(BigInt(len), 2)
  return Buffer.concat([head, payload])
}

/** Incremental WebSocket frame reader (client frames are masked). */
class WsReader {
  private buffer = Buffer.alloc(0)

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
  }

  next(): { opcode: number; payload: Buffer } | null {
    const buf = this.buffer
    if (buf.length < 2) return null
    const opcode = buf[0]! & 0x0f
    const masked = (buf[1]! & 0x80) !== 0
    let len = buf[1]! & 0x7f
    let offset = 2
    if (len === 126) {
      if (buf.length < 4) return null
      len = buf.readUInt16BE(2)
      offset = 4
    } else if (len === 127) {
      if (buf.length < 10) return null
      const big = buf.readBigUInt64BE(2)
      if (big > BigInt(0x7fffffff)) return null
      len = Number(big)
      offset = 10
    }
    const maskSize = masked ? 4 : 0
    if (buf.length < offset + maskSize + len) return null
    let payload = buf.subarray(offset + maskSize, offset + maskSize + len)
    if (masked) {
      const mask = buf.subarray(offset, offset + 4)
      payload = Buffer.from(payload)
      for (let i = 0; i < payload.length; i += 1) payload[i] = payload[i]! ^ mask[i % 4]!
    }
    this.buffer = buf.subarray(offset + maskSize + len)
    return { opcode, payload }
  }
}

interface TerminalShellOption {
  id: string
  label: string
}

const TERMINAL_SHELL_OPTIONS: TerminalShellOption[] = process.platform === 'win32'
  ? [
      { id: 'cmd', label: '命令提示符 (cmd)' },
      { id: 'powershell', label: 'Windows PowerShell' },
      { id: 'pwsh', label: 'PowerShell 7 (pwsh)' },
      { id: 'bash', label: 'Git Bash' },
    ]
  : [
      { id: 'bash', label: 'Bash' },
    ]

interface ResolvedTerminalShell {
  id: string
  label: string
  command: string
  args: string[]
  encoding: 'gbk' | 'utf-8'
}

/** 优先使用常见的绝对路径，找不到时回退到 PATH 里的命令名。 */
function resolveWindowsCommand(fallback: string, candidates: string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return fallback
}

function resolveTerminalShell(requested: string | null): ResolvedTerminalShell {
  const id = requested !== null && TERMINAL_SHELL_OPTIONS.some(option => option.id === requested)
    ? requested
    : (process.platform === 'win32' ? 'cmd' : 'bash')
  const option = TERMINAL_SHELL_OPTIONS.find(item => item.id === id) ?? TERMINAL_SHELL_OPTIONS[0]!

  if (process.platform !== 'win32') {
    return { id: option.id, label: option.label, command: 'bash', args: [], encoding: 'utf-8' }
  }

  const programFiles = process.env.ProgramFiles
  const programFiles86 = process.env['ProgramFiles(x86)']
  const localAppData = process.env.LOCALAPPDATA
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'

  switch (id) {
    case 'powershell':
      return {
        id,
        label: option.label,
        command: resolveWindowsCommand('powershell.exe', [
          joinPath(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          joinPath(systemRoot, 'SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ]),
        args: ['-NoLogo'],
        encoding: 'utf-8',
      }
    case 'pwsh':
      return {
        id,
        label: option.label,
        command: resolveWindowsCommand('pwsh', [
          ...(programFiles ? [joinPath(programFiles, 'PowerShell', '7', 'pwsh.exe')] : []),
          ...(programFiles86 ? [joinPath(programFiles86, 'PowerShell', '7', 'pwsh.exe')] : []),
        ]),
        args: ['-NoLogo'],
        encoding: 'utf-8',
      }
    case 'bash':
      return {
        id,
        label: option.label,
        command: resolveWindowsCommand('bash', [
          ...(programFiles ? [joinPath(programFiles, 'Git', 'bin', 'bash.exe')] : []),
          ...(programFiles86 ? [joinPath(programFiles86, 'Git', 'bin', 'bash.exe')] : []),
          ...(localAppData ? [joinPath(localAppData, 'Programs', 'Git', 'bin', 'bash.exe')] : []),
        ]),
        args: ['--norc', '--noprofile'],
        encoding: 'utf-8',
      }
    case 'cmd':
    default: {
      const comSpec = process.env.ComSpec
      return {
        id: 'cmd',
        label: '命令提示符 (cmd)',
        command: comSpec !== undefined && existsSync(comSpec) ? comSpec : 'cmd.exe',
        args: [],
        encoding: 'gbk',
      }
    }
  }
}

/** cmd.exe 使用系统 ANSI/OEM 代码页（中文系统通常是 GBK），PowerShell/Git Bash 走 UTF-8。 */
function createTerminalDecoder(encoding: 'gbk' | 'utf-8'): TextDecoder {
  return new TextDecoder(encoding)
}

/** 把浏览器来的文本编码为 shell 管道需要的字节。 */
function encodeTerminalInput(line: string, encoding: 'gbk' | 'utf-8'): Buffer {
  const text = line.endsWith('\n') ? line : line + '\n'
  return encoding === 'gbk' ? iconv.encode(text, 'gbk') : Buffer.from(text, 'utf8')
}

function terminalShellInstallHint(shell: ResolvedTerminalShell): string {
  switch (shell.id) {
    case 'pwsh':
      return '请先安装 PowerShell 7（https://github.com/PowerShell/PowerShell），或在「设置 → 功能 → 侧边栏默认终端」里改选其他 Shell。'
    case 'bash':
      return '请先安装 Git for Windows（https://git-scm.com/download/win），或在「设置 → 功能 → 侧边栏默认终端」里改选其他 Shell。'
    case 'powershell':
      return '请检查 Windows PowerShell 是否可用，或在「设置 → 功能 → 侧边栏默认终端」里改选其他 Shell。'
    case 'cmd':
      return '请检查系统命令提示符（cmd.exe）是否可用，或在「设置 → 功能 → 侧边栏默认终端」里改选其他 Shell。'
    default:
      return '请确认已安装对应 Shell，或在「设置 → 功能 → 侧边栏默认终端」里改选其他 Shell。'
  }
}

function terminalSpawnErrorMessage(shell: ResolvedTerminalShell, error: Error): string {
  const code = (error as { code?: string }).code
  if (code === 'ENOENT') {
    return `[无法启动 ${shell.label}] 未找到 ${shell.command}。${terminalShellInstallHint(shell)}`
  }
  return `[无法启动 ${shell.label}] ${error.message}`
}

/** One piped shell per WebSocket connection, cwd = session cwd（回退进程 cwd）。 */
function terminalUpgradeRoute(ctx: Context): WebUpgradeRoute {
  return {
    path: '/liuli-terminal',
    handler: (req, socket: Duplex, head: Buffer) => {
      const host = req.headers.host
      if (host === undefined || !isLoopbackHostname(new URL(`http://${host}`).hostname)) {
        socket.destroy()
        return
      }
      const key = req.headers['sec-websocket-key']
      if (typeof key !== 'string' || key === '') {
        socket.destroy()
        return
      }
      const url = new URL(req.url ?? '/', 'http://x')
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const root = (sessionId !== '' ? sidebarSessionRoot(ctx, sessionId) : undefined) ?? process.cwd()

      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n'
        + 'Upgrade: websocket\r\n'
        + 'Connection: Upgrade\r\n'
        + `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`,
      )

      const requestedShell = url.searchParams.get('shell')
      const resolved = resolveTerminalShell(requestedShell)
      const child = spawn(resolved.command, resolved.args, {
        cwd: root,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let closed = false
      const send = (text: string): void => {
        if (closed) return
        try { socket.write(wsEncodeText(text)) } catch { /* socket 已死，忽略 */ }
      }
      send(`liuli terminal · ${resolved.label} · cwd: ${root}\r\n\r\n`)
      const stdoutDecoder = createTerminalDecoder(resolved.encoding)
      const stderrDecoder = createTerminalDecoder(resolved.encoding)
      child.stdout.on('data', (d: Buffer) => { send(stdoutDecoder.decode(d, { stream: true })) })
      child.stderr.on('data', (d: Buffer) => { send(stderrDecoder.decode(d, { stream: true })) })
      child.on('exit', (code) => {
        send(stdoutDecoder.decode())
        send(stderrDecoder.decode())
        send(`\r\n[process exited with code ${code ?? 0}]`)
        closed = true
        try { socket.end() } catch { /* ignore */ }
      })
      child.on('error', (err) => {
        send(`\r\n${terminalSpawnErrorMessage(resolved, err)}`)
        closed = true
        try { socket.end() } catch { /* ignore */ }
      })

      const reader = new WsReader()
      if (head.length > 0) reader.push(head)
      socket.on('data', (chunk: Buffer) => {
        reader.push(chunk)
        for (let frame = reader.next(); frame !== null; frame = reader.next()) {
          if (frame.opcode === 0x8) {
            closed = true
            try { socket.end() } catch { /* ignore */ }
            break
          }
          if (frame.opcode === 0x9) {
            try { socket.write(Buffer.from([0x8a, 0x00])) } catch { /* ignore */ }
            continue
          }
          if ((frame.opcode === 0x1 || frame.opcode === 0x2) && child.stdin.writable) {
            const line = frame.payload.toString('utf8')
            child.stdin.write(encodeTerminalInput(line, resolved.encoding))
          }
        }
      })
      const teardown = (): void => {
        closed = true
        try { child.kill() } catch { /* ignore */ }
      }
      socket.on('close', teardown)
      socket.on('error', teardown)
    },
  }
}

/* ── /liuli-proxy：浏览器标签的嵌入代理（剥除 X-Frame-Options/CSP）─────
 * 纯网页里 iframe 是唯一嵌入原语，目标站点可用 X-Frame-Options/CSP 拒绝嵌入
 * （DSH 是 Electron webview 无此限制）。本路由由 Host 抓取目标页：
 * - 非 HTML（图片/css/js 等）原样流式回传；
 * - HTML 注入 <base href="最终 URL">，相对/根相对资源仍回原站解析；
 * 仅接受回环调用方、http/https 目标；10MB 截断；15s 超时。
 * 限制（物理上限）：站内 JS 的跨源 fetch、登录态 cookie、依赖
 * location.hostname 的逻辑会降级；站内点击导航离开代理后若目标再次拒绝
 * 嵌入则重新显示提示。
 */

const PROXY_MAX_BYTES = 10 * 1024 * 1024

/** Build the /liuli-proxy prefix route. */
function proxyRoute(): WebRoute {
  return {
    kind: 'prefix',
    path: '/liuli-proxy',
    handler: (req, res) => { void serveProxy(req, res) },
  }
}

/** Resolve one /liuli-proxy request. */
async function serveProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { ok: false, error: 'method not allowed' })
    return
  }
  const host = req.headers.host
  if (host === undefined || !isLoopbackHostname(new URL(`http://${host}`).hostname)) {
    json(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  const reqUrl = new URL(req.url ?? '/', 'http://x')
  const target = reqUrl.searchParams.get('url') ?? ''
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    json(res, 400, { ok: false, error: 'invalid url' })
    return
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    json(res, 400, { ok: false, error: 'unsupported scheme' })
    return
  }

  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, 15000)
  let upstream: Response
  try {
    upstream = await fetch(parsed, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; liuli-theme-side-pane-proxy)', 'accept': '*/*' },
    })
  } catch (error) {
    clearTimeout(timer)
    json(res, 502, { ok: false, error: error instanceof Error ? error.message : String(error) })
    return
  }
  clearTimeout(timer)

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
  const isHtml = /^text\/html|^application\/xhtml\+xml/i.test(contentType)

  try {
    if (!isHtml) {
      res.writeHead(upstream.status, { 'content-type': contentType, 'cache-control': 'no-store' })
      const body = upstream.body
      if (body === null || req.method === 'HEAD') { res.end(); return }
      const reader = body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
      res.end()
      return
    }
    let html = await upstream.text()
    if (Buffer.byteLength(html) > PROXY_MAX_BYTES) html = Buffer.from(html).subarray(0, PROXY_MAX_BYTES).toString('utf-8')
    const finalUrl = (upstream.url !== '' ? upstream.url : parsed.href).replace(/#.*$/, '')
    const baseTag = `<base href="${finalUrl}">`
    const headMatch = /<head[^>]*>/i.exec(html)
    const injected = headMatch !== null
      ? html.slice(0, headMatch.index + headMatch[0].length) + baseTag + html.slice(headMatch.index + headMatch[0].length)
      : baseTag + html
    res.writeHead(upstream.status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : injected)
  } catch {
    if (!res.headersSent) json(res, 502, { ok: false, error: 'proxy stream failed' })
    else res.end()
  }
}


