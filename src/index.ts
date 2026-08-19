/**
 * 琉璃主题（liuli-theme）—— 节点半。
 *
 * 除了作为宿主 Loader 中的插件存在，节点半还提供两个本地 HTTP 路由：
 * - `/liuli-quota`：浏览器半用它查询 DeepSeek / OpenCode Go 的余额或套餐额度。
 *   密钥只在这条 Host 路由里通过 `ctx.credentials` 解析，绝不进入浏览器 bundle。
 * - `/preview`：把当前会话 cwd 作为同源静态站点（预览面板 iframe 用），
 *   只服务会话目录内的文件，Host fence 防 DNS rebinding。
 */
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { execFile as execFileCb, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import { dirname, extname, join as joinPath, resolve as resolvePath, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute, WebUpgradeRoute } from '@deepseek-ai/dsh-host-webserver'
import { createBrowserEngine } from './browser-engine.ts'
import { windowControlRoute } from './host-window.ts'

export const name = 'liuli-theme'

export const inject = ['webServer', 'credentials', 'sessions']

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
  return hostSessions(ctx).get(sessionId)?.header.cwd
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

/** Wiki：README 摘录 + 顶层模块地图（生成式架构导读的朴素实现）。 */
async function sidebarReadWiki(root: string): Promise<{
  title: string
  readme: string[]
  readmePath?: string
  modules: Array<{ name: string; files: Array<{ name: string; path: string }> }>
}> {
  const title = root.split(sep).pop() ?? 'workspace'
  const readme: string[] = []
  let readmePath: string | undefined
  for (const candidate of ['README.md', 'README.zh.md', 'readme.md', 'README']) {
    try {
      const text = await readFile(joinPath(root, candidate), 'utf8')
      readme.push(...text.split(/\r?\n/).filter(line => line.trim() !== '').slice(0, 40).map(line => line.replace(/^#{1,6}\s*/, '').trim()).filter(Boolean))
      readmePath = joinPath(root, candidate)
      break
    } catch {
      // try next candidate
    }
  }
  const entries = await readdir(root, { withFileTypes: true })
  const modules: Array<{ name: string; files: Array<{ name: string; path: string }> }> = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const dirPath = joinPath(root, entry.name)
    let files: Array<{ name: string; path: string }> = []
    try {
      files = (await readdir(dirPath, { withFileTypes: true }))
        .filter(f => f.isFile() && !f.name.startsWith('.'))
        .slice(0, 8)
        .map(f => ({ name: f.name, path: joinPath(dirPath, f.name) }))
    } catch {
      // unreadable directory
    }
    modules.push({ name: entry.name, files })
  }
  modules.sort((a, b) => a.name.localeCompare(b.name))
  return readmePath === undefined ? { title, readme, modules } : { title, readme, readmePath, modules }
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
        const body = await readJsonBody(req) as { settings?: unknown; wallpaper?: unknown } | null
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
  ctx.effect(() => ctx.webServer.register(route), 'liuli-theme: /liuli-quota route')
  ctx.effect(() => ctx.webServer.register(liuliSettingsRoute()), 'liuli-theme: /liuli-settings route')
  ctx.effect(() => ctx.webServer.register(previewRoute(ctx)), 'liuli-theme: /preview route')
  ctx.effect(() => ctx.webServer.register(sidebarRoute(ctx)), 'liuli-theme: /liuli-sidebar route')
  ctx.effect(() => ctx.webServer.registerUpgrade(terminalUpgradeRoute(ctx)), 'liuli-theme: /liuli-terminal upgrade route')
  ctx.effect(() => ctx.webServer.register(proxyRoute()), 'liuli-theme: /liuli-proxy route')
  // advanced（无边框）模式页面内窗口按钮（WindowControls.tsx）的宿主窗口控制面：
  // GET 查询可用/最大化态，POST 触发 minimize/toggleMaximize/close；纯 Web 返回 available:false。
  ctx.effect(() => ctx.webServer.register(windowControlRoute()), 'liuli-theme: /liuli-window route')
  // 嵌入式浏览器引擎（ZCode Desktop IAB 复刻）：仅 Electron 主进程内有
  // WebContentsView 可承载真实 webview；纯 Web 部署返回 undefined，
  // 渲染端探测 /liuli-browser/capabilities 失败后自动回退 iframe。
  void createBrowserEngine().then((engine) => {
    if (engine === undefined) return
    try {
      ctx.effect(() => {
        const release = ctx.webServer.register(engine.route)
        return () => { release(); engine.dispose() }
      }, 'liuli-theme: /liuli-browser route (embedded webview engine)')
    } catch {
      // 插件在探测完成前被卸载：直接销毁引擎。
      engine.dispose()
    }
  }).catch((cause: unknown) => {
    try {
      ctx.logger.warn(`liuli-theme: embedded browser engine unavailable: ${cause instanceof Error ? cause.message : String(cause)}`)
    } catch { /* 上下文已释放则静默 */ }
  })
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
  const session = hostSessions(ctx).get(parsed.sessionId)
  const root = session?.header.cwd
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
      const [status, graph] = await Promise.all([sidebarGitStatus(root), sidebarGitLog(root, skip)])
      json(res, 200, {
        ok: true,
        root,
        git: status !== undefined || graph !== undefined,
        status: status ?? [],
        branch: graph?.branch ?? '',
        log: graph?.log ?? '',
        commits: graph?.commits ?? [],
        hasMore: graph?.hasMore ?? false,
      })
      return
    }
    if (pathname === '/liuli-sidebar/wiki') {
      const wiki = await sidebarReadWiki(root)
      json(res, 200, { ok: true, root, ...wiki })
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

      const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash'
      const child = spawn(shell, [], {
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
      send(`liuli terminal · ${shell} · cwd: ${root}\r\n\r\n`)
      child.stdout.on('data', (d: Buffer) => { send(d.toString('utf8')) })
      child.stderr.on('data', (d: Buffer) => { send(d.toString('utf8')) })
      child.on('exit', (code) => {
        send(`\r\n[process exited with code ${code ?? 0}]`)
        closed = true
        try { socket.end() } catch { /* ignore */ }
      })
      child.on('error', (err) => {
        send(`\r\n[spawn error] ${err.message}`)
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
            child.stdin.write(line.endsWith('\n') ? line : line + '\n')
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
 * （ZCode 是 Electron webview 无此限制）。本路由由 Host 抓取目标页：
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


