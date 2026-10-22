/**
 * 琉璃主题 · 供应商额度适配层。
 *
 * 目标：在 header 工具区展示当前模型供应商的额度/余额。
 * 每个供应商的查询方式不同，因此这里维护一个「适配器任务列表」：
 * 先按供应商路由 id 匹配专用适配器；未实现的供应商会落到 settings 通用适配器，
 * 从 `llm.providers` + `settings.describe` 中读取供应商设置，尝试识别常见额度字段。
 *
 * 任务列表（逐个适配）：
 * - [ ] deepseek-official：官方 /user/balance 或套餐额度接口
 * - [ ] openai：OpenAI Usage / Credits API
 * - [ ] anthropic：Anthropic Billing / Credits API
 * - [x] new-api / one-api 中转站（zero.cat）：/api/user/self 的 quota ÷
 *       /api/status 的 quota_per_unit；令牌是「系统访问令牌」，由 Host 侧解析
 * - [x] commandcode（@mars-sea/dsh-commandcode-provider）：直接消费该插件自己
 *       挂载的 `commandcode/report` Remote（5 小时 / 每周窗口 + 月额度 + 附加信用），
 *       密钥留在它自己的 Host 半，本插件只读展示数据
 * - [ ] 其他 pi-ai 自定义路由：按各供应商设置/接口补充
 *
 * 通用 settings 适配器只做“尽力识别”，字段名不一致时返回 unavailable，
 * 不会影响会话与主题其它功能。
 */
// 2.0.4：connection.api(IApiClient) 移除，改用 remote-api 适配层（ctx.remote
// 收敛成旧 llm.providers/settings.describe/settings.mutate 形状）。
// ModelSelection 从 ui-model-selection 的类型面取；SessionId 从 compat 聚合面取。
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SessionId } from './compat.ts'
import type { LiuliRemoteApi, ModelDirectoryLike } from './remote-api.ts'
import { deepSeekAccountQuota, type DeepSeekAccountQuotaRemote } from './deepseek-account-quota.ts'

/* ── 展示数据模型 ─────────────────────────────────────────────── */

export interface SupplierQuotaItem {
  /** 稳定 key，用于 React 列表渲染。 */
  key: 'month' | 'week' | 'fiveHours' | 'credits' | 'bonus'
  /** 中文短标签：本月 / 本周 / 5小时。 */
  label: string
  /** 展示文本（可以是 "12.5/100"、百分比、原始字符串）。 */
  value: string
  /** 可选 0..1 用量比例，用于后续进度条增强。 */
  ratio?: number
  /** 可选悬停说明（重置时间、构成明细等）。 */
  hint?: string
}

export type SupplierQuotaData =
  | { kind: 'package'; provider: string; items: SupplierQuotaItem[]; title?: string }
  | { kind: 'balance'; provider: string; balance: string; currency?: string; title?: string }
  | { kind: 'unavailable'; provider: string }

export interface SupplierQuotaAdapter {
  /** 适配器名称（调试/日志用）。 */
  id: string
  /** 是否处理该 provider 路由。 */
  match(provider: string): boolean
  /** 查询额度；失败可 throw，由控制器转为 error 状态。 */
  fetch(
    api: LiuliRemoteApi,
    ctx: { provider: string; model: string },
  ): Promise<SupplierQuotaData>
}

/* ── 通用 settings 识别 ───────────────────────────────────────── */

const MONTH_KEYS = ['month', 'monthly', 'monthQuota', 'month_quota', '本月']
const WEEK_KEYS = ['week', 'weekly', 'weekQuota', 'week_quota', '本周']
const FIVE_HOUR_KEYS = ['fiveHours', 'five_hours', 'fiveHour', '5hours', '五小时']
const BALANCE_KEYS = ['balance', 'balanceAmount', 'balance_amount', 'credit', 'credits', '余额']

function readText(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return undefined
}

function findFirstKey(obj: Record<string, unknown>, keys: readonly string[]): { key: string; value: unknown } | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const text = readText(obj[key])
      if (text !== undefined) return { key, value: text }
    }
  }
  return undefined
}

function parseQuotaConfig(provider: string, config: unknown): SupplierQuotaData {
  if (typeof config !== 'object' || config === null) {
    return { kind: 'unavailable', provider }
  }
  const root = config as Record<string, unknown>

  // 允许把额度/余额放在 billing / quota / plan / package 子对象里，合并查找。
  const nested: Record<string, unknown> = {}
  for (const key of ['billing', 'quota', 'plan', 'package']) {
    const value = root[key]
    if (typeof value === 'object' && value !== null) {
      Object.assign(nested, value)
    }
  }

  const month = findFirstKey(root, MONTH_KEYS) ?? findFirstKey(nested, MONTH_KEYS)
  const week = findFirstKey(root, WEEK_KEYS) ?? findFirstKey(nested, WEEK_KEYS)
  const fiveHours = findFirstKey(root, FIVE_HOUR_KEYS) ?? findFirstKey(nested, FIVE_HOUR_KEYS)

  if (month !== undefined || week !== undefined || fiveHours !== undefined) {
    const items: SupplierQuotaItem[] = []
    if (month !== undefined) items.push({ key: 'month', label: '本月', value: String(month.value) })
    if (week !== undefined) items.push({ key: 'week', label: '本周', value: String(week.value) })
    if (fiveHours !== undefined) items.push({ key: 'fiveHours', label: '5小时', value: String(fiveHours.value) })
    return { kind: 'package', provider, items }
  }

  const balance = findFirstKey(root, BALANCE_KEYS) ?? findFirstKey(nested, BALANCE_KEYS)
  if (balance !== undefined) {
    const currency =
      readText(root.currency)
      ?? readText(nested.currency)
      ?? readText(root.balanceCurrency)
      ?? readText(nested.balanceCurrency)
    return currency === undefined
      ? { kind: 'balance', provider, balance: String(balance.value) }
      : { kind: 'balance', provider, balance: String(balance.value), currency }
  }

  return { kind: 'unavailable', provider }
}

/** 读取 provider 的配置对象（settings namespace 沿 settingsPath 下钻）。 */
async function readProviderConfig(api: LiuliRemoteApi, provider: string): Promise<unknown> {
  try {
    const [providersResponse, settingsResponse] = await Promise.all([
      api.llm.providers(),
      api.settings.describe(),
    ])
    if (!providersResponse.ok || !settingsResponse.ok) return undefined

    const providerView = providersResponse.value.providers.find(
      candidate => candidate.provider === provider,
    )
    if (providerView === undefined) return undefined

    const namespaceView = settingsResponse.value.namespaces.find(
      candidate => candidate.ns === providerView.settingsNs,
    )
    if (namespaceView === undefined) return undefined

    let config: unknown = namespaceView.value
    for (const key of providerView.settingsPath) {
      if (typeof config !== 'object' || config === null) return undefined
      config = (config as Record<string, unknown>)[key]
    }
    return config
  } catch (_) {
    return undefined
  }
}

async function fetchFromSettings(
  api: LiuliRemoteApi,
  ctx: { provider: string },
): Promise<SupplierQuotaData> {
  return parseQuotaConfig(ctx.provider, await readProviderConfig(api, ctx.provider))
}

/** provider 配置里 baseURL 的 host（判定它是不是 new-api 站点用）。 */
async function providerBaseHost(api: LiuliRemoteApi, provider: string): Promise<string | undefined> {
  const config = await readProviderConfig(api, provider)
  if (typeof config !== 'object' || config === null) return undefined
  const base = (config as Record<string, unknown>).baseURL
  if (typeof base !== 'string') return undefined
  try {
    return new URL(base).hostname.toLowerCase()
  } catch (_) {
    return undefined
  }
}

/* ── Host 路由适配（DeepSeek / OpenCode Go / new-api） ─────────── */

/**
 * 调用节点半注册的本地 `/liuli-quota` 路由。密钥在 Host 侧解析，
 * 浏览器侧只拿到额度/余额展示数据。
 * 传 `host` 时按站点查余额（new-api 通用入口，与 provider 名无关）。
 */
async function fetchFromHost(provider: string, host?: string): Promise<SupplierQuotaData> {
  const query = host === undefined
    ? `provider=${encodeURIComponent(provider)}`
    : `host=${encodeURIComponent(host)}`
  const response = await fetch(`/liuli-quota?${query}`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`quota endpoint HTTP ${response.status}`)
  const data = await response.json() as SupplierQuotaData & { error?: string }
  if (data.error !== undefined) throw new Error(data.error)
  return data
}

/** Host 查询失败或返回 unavailable 时，回退到通用 settings 识别。 */
async function fetchDeepSeek(api: LiuliRemoteApi, ctx: { provider: string; model: string }): Promise<SupplierQuotaData> {
  try {
    const data = await fetchFromHost(ctx.provider)
    if (data.kind !== 'unavailable') return data
  } catch (_) { /* fallthrough */ }
  return fetchFromSettings(api, ctx)
}

/**
 * new-api / one-api 中转站（zero.cat）的 provider 名快速匹配。
 * settings 里的 key 是 `zerocat` / `zero`，DSH 也可能给自定义路由加命名空间
 * 前缀（如 `pi-ai:zerocat` / `pi-ai/zerocat`），故按非字母数字边界宽松匹配。
 * 名字不匹配的 new-api 站点由下面的通用适配器兜底。
 */
const NEWAPI_PROVIDER_RE = /(?:^|[^a-z0-9])zero(?:cat)?(?:$|[^a-z0-9])/i

/** new-api 站点余额同样在 Host 侧解析令牌后查询（/api/user/self）。 */
async function fetchNewApi(api: LiuliRemoteApi, ctx: { provider: string; model: string }): Promise<SupplierQuotaData> {
  try {
    const data = await fetchFromHost(ctx.provider)
    if (data.kind !== 'unavailable') return data
  } catch (_) { /* fallthrough */ }
  return fetchFromSettings(api, ctx)
}

/** host → 是否 new-api 站点（会话级缓存，避免每次刷新都重新探测）。 */
const newApiHostCache = new Map<string, boolean>()

/** 让 Host 侧探测某个 baseURL host 是不是 new-api（`/api/status` 指纹）。 */
async function isNewApiHost(host: string): Promise<boolean> {
  const cached = newApiHostCache.get(host)
  if (cached !== undefined) return cached
  let result = false
  try {
    const response = await fetch(`/liuli-quota?detect=${encodeURIComponent(host)}`, {
      headers: { accept: 'application/json' },
    })
    if (response.ok) {
      const data = await response.json() as { ok?: boolean; newApi?: boolean }
      result = data.ok === true && data.newApi === true
    }
  } catch (_) {
    // 探测失败按「不是 new-api」处理，回退通用 settings 识别。
  }
  newApiHostCache.set(host, result)
  return result
}

/**
 * 通用 new-api 兜底：读 provider 的 baseURL，探测它是否为 new-api 站点，
 * 是则按 host 查余额。站点/令牌都不需要在插件里登记 —— 用户只要在 DSH
 * 设置页填一次「余额令牌」即可（见 quota-token-inject.ts）。
 */
async function fetchNewApiGeneric(api: LiuliRemoteApi, ctx: { provider: string; model: string }): Promise<SupplierQuotaData> {
  const host = await providerBaseHost(api, ctx.provider)
  if (host !== undefined && await isNewApiHost(host)) {
    try {
      const data = await fetchFromHost(ctx.provider, host)
      if (data.kind !== 'unavailable') return data
    } catch (_) { /* fallthrough */ }
  }
  return fetchFromSettings(api, ctx)
}

/* ── Command Code 适配（第三方 provider 插件贡献的 Remote） ──────
 *
 * 数据来源是 `@mars-sea/dsh-commandcode-provider` 自己挂载的
 * `commandcode/report` Remote（命名空间服务 `remote.commandcode`）：它用自己的
 * API 密钥在 Host 侧查 whoami / usage / credits / subscriptions 四个端点，再把
 * 严格校验过的展示字段发给浏览器。因此本插件**不接触 Command Code 的密钥**，
 * 也不重复实现它的账户轮换逻辑 —— 只做「对方的数据 → 琉璃页头额度模型」的映射。
 */

/**
 * `@mars-sea/dsh-commandcode-provider` 的 `commandcode/report` 结果面。
 * 只声明本插件消费的字段；每条字段都由对方严格校验过（`mode: 'strict'`），
 * 因此这里按可选处理、读不到就降级。
 */
interface CommandCodeWindowLimit {
  /** 窗口内已用额度（美元）。 */
  used?: unknown
  /** 窗口额度上限（美元；0 = 无上限）。 */
  cap?: unknown
  /** 是否已超限。 */
  exceeded?: unknown
  /** 重置时间（epoch ms；0 = 未知）。 */
  resetAt?: unknown
}

interface CommandCodeCredits {
  /** 套餐内含的月度额度（美元）。 */
  monthlyCredits?: unknown
  /** 额外购买的额度（美元）。 */
  purchasedCredits?: unknown
  /** 赠送额度（美元）。 */
  freeCredits?: unknown
  fiveHour?: CommandCodeWindowLimit
  weekly?: CommandCodeWindowLimit
}

interface CommandCodeUsage {
  totalCost?: unknown
  totalCredits?: unknown
  completedCount?: unknown
  failedCount?: unknown
}

interface CommandCodePlan {
  name?: unknown
  status?: unknown
  currentPeriodEnd?: unknown
}

interface CommandCodeReport {
  account?: { userName?: unknown; name?: unknown }
  usage?: CommandCodeUsage
  credits?: CommandCodeCredits
  plan?: CommandCodePlan
  /** 部分端点失败的说明（页面只做提示）。 */
  failures?: unknown
  /** 全部端点失败时的分类（invalid-key / service-unavailable / network）。 */
  blocked?: unknown
}

interface CommandCodeAccountEntry {
  id?: unknown
  label?: unknown
  active?: unknown
  configured?: unknown
  report?: CommandCodeReport
}

/** 数字读取（非有限数返回 undefined，避免把 NaN 渲染出来）。 */
function finiteOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 文本读取（空串视为缺失）。 */
function textOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 美元金额：整数省略小数，小数保留两位（额度面板与命令输出的既有写法）。 */
function money(value: number): string {
  return `$${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)}`
}

/** 重置时间的本地短格式（"MM-DD HH:mm"；未知返回 undefined）。 */
function resetLabel(resetAt: number | undefined): string | undefined {
  if (resetAt === undefined || resetAt <= 0) return undefined
  const date = new Date(resetAt)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 一个窗口 → 一行额度项（`已用/上限` + 比例 + 重置时间提示）。 */
function windowItem(
  key: 'fiveHours' | 'week',
  label: string,
  limit: CommandCodeWindowLimit | undefined,
): SupplierQuotaItem | undefined {
  if (limit === undefined) return undefined
  const used = finiteOf(limit.used) ?? 0
  const cap = finiteOf(limit.cap) ?? 0
  const reset = resetLabel(finiteOf(limit.resetAt))
  const hints: string[] = []
  if (limit.exceeded === true) hints.push('已超限')
  if (reset !== undefined) hints.push(`${reset} 重置`)
  const value = cap > 0 ? `${money(used)}/${money(cap)}` : money(used)
  const ratio = cap > 0 ? Math.max(0, Math.min(1, used / cap)) : undefined
  // 把精确比例写进悬停，配合细进度条做精细读数。
  if (ratio !== undefined) hints.push(`${Math.round(ratio * 100)}%`)
  return {
    key,
    label,
    value,
    ...(ratio === undefined ? {} : { ratio }),
    ...(hints.length === 0 ? {} : { hint: hints.join(' · ') }),
  }
}

/**
 * 把 `commandcode/report` 的账户数据翻译成本插件统一的额度模型。
 *
 * 数据来自第三方插件自己的 Host 半（它已经算好 5 小时 / 每周 / 月额度 / 信用），
 * 琉璃只做「对方的展示字段 → 页头额度行」的映射。
 *
 * 两个现实约束：
 * - 交付面在网关解码差异下可能是 `{ accounts }` 或 `{ result: { accounts } }`，两种都认；
 * - 多账户轮换时以「当前生效账户」为准，但它缺可展示字段时退到其它有数据的账户，
 *   绝不因为某一个账户没数据就把整条额度隐藏。
 *
 * - 账户全部端点失败（`blocked`）时抛错，页头显示「额度不可用」并在悬停里给出原因；
 * - 所有账户都没有可用字段时返回 unavailable（页头给出诊断原因）。
 */
function parseCommandCodeReport(provider: string, raw: unknown): SupplierQuotaData {
  const entries = commandCodeAccountsOf(raw)
  if (entries === undefined || entries.length === 0) return { kind: 'unavailable', provider }
  // 当前生效账户优先；其次已配置账户；最后才是未配置/冷却中的账户。
  const ordered = [
    ...entries.filter(candidate => candidate.active === true),
    ...entries.filter(candidate => candidate.active !== true && candidate.configured !== false),
    ...entries.filter(candidate => candidate.active !== true && candidate.configured === false),
  ]
  let blocked: string | undefined
  for (const entry of ordered) {
    // 正常形态是 { report: {...} }；若对方直接把 report 平铺在账户上，也认。
    const report = entry.report ?? (looksLikeCommandCodeReport(entry) ? entry as CommandCodeReport : undefined)
    if (report === undefined || report === null) continue
    const code = textOf(report.blocked)
    if (code !== undefined) {
      if (blocked === undefined) blocked = code
      continue
    }
    const data = commandCodeEntryData(provider, entry, report)
    if (data !== undefined) return data
  }
  if (blocked !== undefined) {
    throw new Error(`Command Code 额度查询失败：${blockedReasonText(blocked)}`)
  }
  return { kind: 'unavailable', provider }
}

/** 从交付面里取账户数组（兼容 `{ accounts }` 与 `{ result: { accounts } }`）。 */
function commandCodeAccountsOf(raw: unknown): CommandCodeAccountEntry[] | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const root = raw as Record<string, unknown>
  const direct = root.accounts
  if (Array.isArray(direct)) return direct as CommandCodeAccountEntry[]
  // 网关/解码差异下可能多包一层：result / data / payload / value 都认。
  for (const key of ['result', 'data', 'payload', 'value']) {
    const wrapped = root[key]
    if (wrapped === null || typeof wrapped !== 'object') continue
    const nested = (wrapped as Record<string, unknown>).accounts
    if (Array.isArray(nested)) return nested as CommandCodeAccountEntry[]
  }
  return undefined
}

/** 该对象是否本身就是一份 report（有 credits / usage / plan / blocked 任一字段）。 */
function looksLikeCommandCodeReport(value: unknown): value is CommandCodeReport {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.credits !== undefined || candidate.usage !== undefined
    || candidate.plan !== undefined || candidate.blocked !== undefined
}

/** 把对方给的 blocked 分类翻成可读原因。 */
function blockedReasonText(blocked: string): string {
  return blocked === 'invalid-key'
    ? 'API 密钥被拒绝（401）'
    : blocked === 'service-unavailable' ? 'Command Code 服务不可用（5xx）'
      : blocked === 'network' ? '网络不可达'
        : blocked === 'invalid-response' ? '响应格式异常'
          : blocked
}

/** 单个账户 → 页头额度；没有可展示字段时返回 undefined（由调用方换下一个账户）。 */
function commandCodeEntryData(
  provider: string,
  entry: CommandCodeAccountEntry,
  report: CommandCodeReport,
): SupplierQuotaData | undefined {
  const credits = report.credits
  const items: SupplierQuotaItem[] = []
  const fiveHour = windowItem('fiveHours', '5小时', credits?.fiveHour)
  if (fiveHour !== undefined) items.push(fiveHour)
  const weekly = windowItem('week', '本周', credits?.weekly)
  if (weekly !== undefined) items.push(weekly)

  if (credits !== undefined) {
    const monthly = finiteOf(credits.monthlyCredits)
    if (monthly !== undefined && monthly > 0) {
      const periodEnd = resetLabel(finiteOf(report.plan?.currentPeriodEnd))
      // 本周期已用：对方 usage.totalCost（美元口径）；缺失时退回 totalCredits。
      // 有已用值就按 5小时/本周 同款样式显示「已用/上限」+ 细进度条。
      const spentRaw = finiteOf(report.usage?.totalCost) ?? finiteOf(report.usage?.totalCredits)
      const spent = spentRaw === undefined ? undefined : Math.max(0, spentRaw)
      if (spent !== undefined) {
        const ratio = Math.max(0, Math.min(1, spent / monthly))
        const hints: string[] = []
        if (periodEnd !== undefined) hints.push(`本周期至 ${periodEnd}`)
        hints.push(`${Math.round(ratio * 100)}%`)
        items.push({
          key: 'month',
          label: '月额度',
          value: `${money(spent)}/${money(monthly)}`,
          ratio,
          hint: hints.join(' · '),
        })
      } else {
        items.push({
          key: 'month',
          label: '月额度',
          value: money(monthly),
          ...(periodEnd === undefined ? {} : { hint: `本周期至 ${periodEnd}` }),
        })
      }
    }
    const purchased = finiteOf(credits.purchasedCredits) ?? 0
    const free = finiteOf(credits.freeCredits) ?? 0
    if (purchased + free > 0) {
      items.push({
        key: 'credits',
        label: '信用',
        value: money(purchased + free),
        hint: `已购 ${money(purchased)} · 赠送 ${money(free)}`,
      })
    }
  }

  if (items.length === 0) return undefined

  // 悬停标题：账户名 + 套餐名 + 本周期用量（与对方面板同源的事实）。
  const label = textOf(entry.label)
  const accountName = textOf(report.account?.userName) ?? textOf(report.account?.name)
  const planName = textOf(report.plan?.name)
  const spend = finiteOf(report.usage?.totalCost)
  const parts = [
    accountName ?? label,
    planName,
    spend === undefined ? undefined : `本周期花费 ${money(spend)}`,
  ].filter((part): part is string => part !== undefined)
  const title = parts.length === 0 ? 'Command Code 额度' : `Command Code 额度 · ${parts.join(' · ')}`
  return { kind: 'package', provider, items, title }
}

/** `commandcode/report` Remote 的最小调用面（第三方插件挂载时才有值）。 */
export interface CommandCodeRemoteLike {
  report(): Promise<{ ok?: boolean; value?: unknown; error?: { message?: string } }>
}

/** 当前已挂载的 commandcode Remote；由插件 apply 经 setCommandCodeRemote 注入。 */
let commandCodeRemote: CommandCodeRemoteLike | null = null

/**
 * 是否已经拿到第三方插件的 `commandcode/report` Remote。
 *
 * client/index.ts 的兜底轮询用它判断「inject 回调有没有落地」，避免对已挂载的
 * 命名空间反复覆盖同一个对象（每次覆盖都会清缓存并触发一次上游请求）。
 */
export function hasCommandCodeRemote(): boolean {
  return commandCodeRemote !== null
}

/**
 * 报告缓存：对方的 `report()` 每次都会打 4 个账户端点（whoami / usage /
 * credits / subscriptions），而本插件的额度刷新会被切会话、设置变更、重连
 * 等多个事件触发 —— 不缓存会把 header 变成对上游的轮询器。这里按 TTL 缓存
 * 已解析结果，并让并发调用合并到同一次请求（in-flight 复用）。
 *
 * 失败也缓存（更短 TTL）：密钥被拒/上游 5xx 这类失败在短时间内不会自愈，
 * 缓存它避免每次刷新都重打一遍；用户改完设置或点刷新后 30 秒内自然恢复。
 */
const COMMANDCODE_CACHE_TTL_MS = 60_000
const COMMANDCODE_ERROR_TTL_MS = 30_000
let commandCodeCache: { at: number; ttl: number; data?: SupplierQuotaData; error?: string; diagnostic?: string } | null = null
let commandCodeInflight: Promise<SupplierQuotaData> | null = null

/**
 * 最近一次 `commandcode/report` 返回面的结构摘要。
 *
 * 解析结果为「不可展示」时页头就是一片空白，看不到是 accounts 层级变了、账户没
 * 配 report，还是字段全空。这里把返回面压成一句人话，作为页头灰字的诊断原因
 * （只在 provider 命中 commandcode 时使用，不参与正常展示）。
 */
let commandCodeDiagnostic = ''

/** 把远端返回面压成一句可读的结构摘要（顶层键 / accounts / 首个账户 report 的键）。 */
function describeCommandCodeReport(raw: unknown): string {
  if (raw === null || raw === undefined) return `返回面为空（${String(raw)}）`
  if (typeof raw !== 'object') return `返回面不是对象（${typeof raw}）`
  const root = raw as Record<string, unknown>
  const keys = Object.keys(root)
  const accounts = root.accounts
  if (!Array.isArray(accounts)) {
    return `返回面没有 accounts 数组（顶层键：${keys.length === 0 ? '(空)' : keys.join(',')}）`
  }
  if (accounts.length === 0) return '账户列表为空（accounts: []）'
  const first = accounts[0] as Record<string, unknown> | null
  if (first === null || typeof first !== 'object') return `首个账户不是对象（${String(first)}）`
  const report = first.report
  if (report === null || report === undefined || typeof report !== 'object') {
    return `首个账户没有 report（账户键：${Object.keys(first).join(',') || '(空)'}）`
  }
  const reportKeys = Object.keys(report as Record<string, unknown>)
  return `首个账户 report 键：${reportKeys.length === 0 ? '(空)' : reportKeys.join(',')}`
}

/**
 * 注入（或清除）第三方插件贡献的 `commandcode/report` Remote。
 * client/index.ts 用 `ctx.inject(['remote.commandcode'], …)` 在服务出现时调用，
 * 服务随插件卸载而消失时回调清理传 null —— 两种时机都清缓存并触发一次重查。
 */
export function setCommandCodeRemote(remote: CommandCodeRemoteLike | null): void {
  if (commandCodeRemote === remote) return
  commandCodeRemote = remote
  commandCodeCache = null
  commandCodeInflight = null
  commandCodeDiagnostic = ''
  if (currentSessionId !== null) void refreshSupplierQuota()
}

/** 调用第三方插件挂载的 `commandcode/report` Remote；未挂载时返回 unavailable。 */
async function fetchCommandCode(_api: LiuliRemoteApi, ctx: { provider: string }): Promise<SupplierQuotaData> {
  const namespace = commandCodeRemote
  if (namespace === null) return { kind: 'unavailable', provider: ctx.provider }

  const cached = commandCodeCache
  if (cached !== null && Date.now() - cached.at < cached.ttl) {
    if (cached.error !== undefined) throw new Error(cached.error)
    if (cached.data !== undefined) {
      commandCodeDiagnostic = cached.diagnostic ?? ''
      return cached.data
    }
  }

  if (commandCodeInflight !== null) return commandCodeInflight
  const inflight = (async (): Promise<SupplierQuotaData> => {
    try {
      const response = await namespace.report()
      if (response?.ok !== true) {
        throw new Error(response?.error?.message ?? 'commandcode/report remote failed')
      }
      const data = parseCommandCodeReport(ctx.provider, response.value)
      // 解析出不了可展示行时，把远端的结构摘要留下来给页头做诊断。
      commandCodeDiagnostic = data.kind === 'unavailable' ? describeCommandCodeReport(response.value) : ''
      commandCodeCache = { at: Date.now(), ttl: COMMANDCODE_CACHE_TTL_MS, data, diagnostic: commandCodeDiagnostic }
      return data
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      commandCodeCache = { at: Date.now(), ttl: COMMANDCODE_ERROR_TTL_MS, error: message }
      throw error
    } finally {
      commandCodeInflight = null
    }
  })()
  commandCodeInflight = inflight
  return inflight
}

/* ── 适配器列表 ───────────────────────────────────────────────── */

let deepSeekAccountRemote: DeepSeekAccountQuotaRemote | null = null
let deepSeekAccountInflight: Promise<SupplierQuotaData> | null = null

export function setDeepSeekAccountRemote(remote: DeepSeekAccountQuotaRemote | null): void {
  deepSeekAccountRemote = remote
  deepSeekAccountInflight = null
  if (currentSessionId !== null) void refreshSupplierQuota()
}

async function fetchDeepSeekAccount(): Promise<SupplierQuotaData> {
  if (deepSeekAccountRemote === null) return { kind: 'unavailable', provider: 'deepseek-account' }
  if (deepSeekAccountInflight !== null) return deepSeekAccountInflight
  const request = deepSeekAccountRemote.getBalance().then(response => {
    if (!response.ok) throw new Error(response.error?.message ?? 'DeepSeek 账号余额查询失败')
    return deepSeekAccountQuota(response.value ?? null)
  }).finally(() => { if (deepSeekAccountInflight === request) deepSeekAccountInflight = null })
  deepSeekAccountInflight = request
  return request
}

const adapters: SupplierQuotaAdapter[] = [
  { id: 'deepseek-account', match: provider => provider === 'deepseek-account', fetch: fetchDeepSeekAccount },
  {
    // new-api / one-api 中转站（zero.cat）：Host 侧用「系统访问令牌」查
    // /api/user/self 的 quota，再按站点 quota_per_unit 换算成货币余额。
    id: 'newapi',
    match: provider => NEWAPI_PROVIDER_RE.test(provider),
    fetch: fetchNewApi,
  },
  {
    id: 'deepseek',
    match: provider => provider === 'deepseek',
    fetch: fetchDeepSeek,
  },
  {
    id: 'deepseek-official',
    match: provider => provider === 'deepseek-official',
    fetch: fetchDeepSeek,
  },
  {
    id: 'opencode-go',
    match: provider => provider === 'opencode-go',
    fetch: fetchDeepSeek,
  },
  {
    // Command Code（@mars-sea/dsh-commandcode-provider）：数据由该插件自己的
    // Host 半经 `commandcode/report` Remote 提供，本插件只读展示字段。
    // 多账户轮换下 report 返回每个账户一份；展示当前生效账户。
    id: 'commandcode',
    match: provider => provider === 'commandcode',
    fetch: fetchCommandCode,
  },
  {
    id: 'openai',
    match: provider => provider === 'openai',
    fetch: async (_api, ctx) => {
      // TODO: 接入 OpenAI Usage / Credits API。
      return fetchFromSettings(_api, ctx)
    },
  },
  {
    id: 'anthropic',
    match: provider => provider === 'anthropic',
    fetch: async (_api, ctx) => {
      // TODO: 接入 Anthropic Billing / Credits API。
      return fetchFromSettings(_api, ctx)
    },
  },
  {
    // 通用 new-api 兜底：provider 名不含 zero 但 baseURL 是 new-api 站点时，
    // 由 Host 探测确认后按 host 查余额（见 fetchNewApiGeneric）。
    id: 'newapi-generic',
    match: () => true,
    fetch: fetchNewApiGeneric,
  },
  {
    id: 'settings-generic',
    match: () => true,
    fetch: fetchFromSettings,
  },
]

/* ── 控制器（模块级单例，React 组件用 useSyncExternalStore 订阅） ── */

export interface SupplierQuotaState {
  provider: string | null
  model: string | null
  data: SupplierQuotaData | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string
  /**
   * 页头为什么没有可展示的额度（诊断用，空串表示不缺数据）。
   *
   * 「数据缺失」与「该供应商暂无可展示额度」原本都静默隐藏，线上出现「页头没有
   * 额度」时无法区分是没拿到模型、第三方 Remote 没挂载，还是字段为空。这里记下
   * 中断点，页头只在 provider 命中 commandcode 时以灰字提示，其它供应商维持静默。
   */
  reason: string
  updatedAt: number
}

let remote: LiuliRemoteApi | null = null
let modelDirectory: ModelDirectoryLike | null = null
let currentSessionId: SessionId | null = null
let unsubscribeModel: (() => void) | null = null
let refreshGeneration = 0

const initialState: SupplierQuotaState = {
  provider: null,
  model: null,
  data: null,
  status: 'idle',
  error: '',
  reason: '',
  updatedAt: 0,
}

let state: SupplierQuotaState = initialState
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function setState(patch: Partial<SupplierQuotaState>): void {
  state = { ...state, ...patch, updatedAt: Date.now() }
  emit()
}

/** 由插件 apply 注入 remote 适配层；重复调用只更新引用并触发一次刷新。 */
export function initSupplierQuota(
  handle: LiuliRemoteApi,
  directory?: ModelDirectoryLike | null,
): void {
  remote = handle
  modelDirectory = directory ?? null
  if (currentSessionId !== null) {
    subscribeCurrentModelDirectory()
    void refreshSupplierQuota()
  }
}

function subscribeCurrentModelDirectory(): void {
  unsubscribeModel?.()
  unsubscribeModel = null
  if (modelDirectory === null || currentSessionId === null) return
  try {
    const store = modelDirectory.directoryFor(currentSessionId).store
    unsubscribeModel = store.subscribe(() => { void refreshSupplierQuota() })
  } catch (_) {
    // 会话尚未就绪或服务不可用时忽略，等下次 setSession 再订阅。
  }
}

/** 切换当前会话时由 header 组件调用。 */
export function setSupplierQuotaSession(sessionId: SessionId): void {
  if (currentSessionId === sessionId) return
  unsubscribeModel?.()
  unsubscribeModel = null
  currentSessionId = sessionId
  setState({ provider: null, model: null, data: null, status: 'idle', error: '', reason: '' })
  subscribeCurrentModelDirectory()
  void refreshSupplierQuota()
}

/** 重新查询当前会话的供应商额度（幂等，多调用只保留最后一次结果）。
 *  2.0.4：旧 sessions.models RPC 移除；当前模型选择改从 modelDirectories 的
 *  每会话目录快照读（store.subscribe 已在切会话时驱动本函数重跑）。 */
export async function refreshSupplierQuota(): Promise<void> {
  if (remote === null || currentSessionId === null) return
  const generation = ++refreshGeneration
  setState({ status: 'loading', error: '', reason: '' })

  try {
    const current: ModelSelection | null = modelDirectory === null
      ? null
      : modelDirectory.directoryFor(currentSessionId).store.getSnapshot().current
    if (generation !== refreshGeneration) return
    if (current === null) {
      // 目录未就绪（catalog 未加载）：不报错，保持 idle 语义等目录回调重跑。
      // 记下卡点：目录服务缺失与「目录还没选出当前模型」是两种不同病因。
      setState({
        provider: null,
        model: null,
        data: null,
        status: 'idle',
        error: '',
        reason: modelDirectory === null ? '模型目录服务不可用（ctx.modelDirectories）' : '当前会话还没有模型选择',
      })
      return
    }

    const adapter = adapters.find(candidate => candidate.match(current.provider))
    if (adapter === undefined) {
      setState({
        provider: current.provider,
        model: current.model,
        data: { kind: 'unavailable', provider: current.provider },
        status: 'ready',
        reason: `没有适配 ${current.provider} 的额度查询`,
      })
      return
    }

    // Command Code 的数据只来自第三方插件的 Remote：没挂载时不必打空请求，
    // 直接把「未挂载」记成中断点（页头据此给出可区分的灰字提示）。
    if (adapter.id === 'commandcode' && commandCodeRemote === null) {
      setState({
        provider: current.provider,
        model: current.model,
        data: { kind: 'unavailable', provider: current.provider },
        status: 'ready',
        reason: 'commandcode/report Remote 未挂载',
      })
      return
    }

    const data = await adapter.fetch(remote, {
      provider: current.provider,
      model: current.model,
    })
    if (generation !== refreshGeneration) return
    setState({
      provider: current.provider,
      model: current.model,
      data,
      status: 'ready',
      reason: data.kind === 'unavailable'
        ? (adapter.id === 'commandcode' && commandCodeDiagnostic !== '' ? commandCodeDiagnostic : '该供应商暂无可展示额度')
        : '',
    })
  } catch (error) {
    if (generation !== refreshGeneration) return
    const message = error instanceof Error ? error.message : String(error)
    setState({ status: 'error', error: message, reason: message })
  }
}

/** 插件卸载时释放订阅与连接引用。 */
export function disposeSupplierQuota(): void {
  unsubscribeModel?.()
  unsubscribeModel = null
  currentSessionId = null
  remote = null
  modelDirectory = null
  commandCodeRemote = null
  deepSeekAccountRemote = null
  deepSeekAccountInflight = null
  commandCodeCache = null
  commandCodeInflight = null
  commandCodeDiagnostic = ''
  refreshGeneration += 1
  state = { ...initialState, updatedAt: Date.now() }
  emit()
}

export function subscribeSupplierQuota(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function getSupplierQuotaSnapshot(): SupplierQuotaState {
  return state
}
