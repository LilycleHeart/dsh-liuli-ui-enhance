/**
 * 琉璃主题（liuli-theme）—— 节点半。
 *
 * 除了作为宿主 Loader 中的插件存在，节点半还提供一个本地 HTTP 路由
 * `/liuli-quota`：浏览器半用它查询 DeepSeek / OpenCode Go 的余额或套餐额度。
 * 密钥只在这条 Host 路由里通过 `ctx.credentials` 解析，绝不进入浏览器 bundle。
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

export const name = 'liuli-theme'

export const inject = ['webServer', 'credentials']

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

/** 宿主插件体：注册 /liuli-quota 本地路由供浏览器半查询供应商额度。 */
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
}
