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
import { stat } from 'node:fs/promises'
import { extname, resolve as resolvePath, sep } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

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
  ctx.effect(() => ctx.webServer.register(previewRoute(ctx)), 'liuli-theme: /preview route')
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
  const pathname = new URL(req.url ?? '/', 'http://x').pathname
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
    const index = resolvePath(target, 'index.html')
    try {
      const indexInfo = await stat(index)
      if (indexInfo.isFile()) {
        previewSendFile(res, index, indexInfo.size, req.method)
        return
      }
    } catch {
      // Fall through to the directory-not-served answer.
    }
    previewSendError(res, 404, 'not found')
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
