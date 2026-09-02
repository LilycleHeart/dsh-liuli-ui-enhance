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

/* ── 展示数据模型 ─────────────────────────────────────────────── */

export interface SupplierQuotaItem {
  /** 稳定 key，用于 React 列表渲染。 */
  key: 'month' | 'week' | 'fiveHours'
  /** 中文短标签：本月 / 本周 / 5小时。 */
  label: string
  /** 展示文本（可以是 "12.5/100"、百分比、原始字符串）。 */
  value: string
  /** 可选 0..1 用量比例，用于后续进度条增强。 */
  ratio?: number
}

export type SupplierQuotaData =
  | { kind: 'package'; provider: string; items: SupplierQuotaItem[] }
  | { kind: 'balance'; provider: string; balance: string; currency?: string }
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

async function fetchFromSettings(
  api: LiuliRemoteApi,
  ctx: { provider: string },
): Promise<SupplierQuotaData> {
  try {
    const [providersResponse, settingsResponse] = await Promise.all([
      api.llm.providers(),
      api.settings.describe(),
    ])
    if (!providersResponse.ok || !settingsResponse.ok) {
      return { kind: 'unavailable', provider: ctx.provider }
    }

    const providerView = providersResponse.value.providers.find(
      candidate => candidate.provider === ctx.provider,
    )
    if (providerView === undefined) {
      return { kind: 'unavailable', provider: ctx.provider }
    }

    const namespaceView = settingsResponse.value.namespaces.find(
      candidate => candidate.ns === providerView.settingsNs,
    )
    if (namespaceView === undefined) {
      return { kind: 'unavailable', provider: ctx.provider }
    }

    let config: unknown = namespaceView.value
    for (const key of providerView.settingsPath) {
      if (typeof config !== 'object' || config === null) {
        config = undefined
        break
      }
      config = (config as Record<string, unknown>)[key]
    }

    return parseQuotaConfig(ctx.provider, config)
  } catch (_) {
    return { kind: 'unavailable', provider: ctx.provider }
  }
}

/* ── Host 路由适配（DeepSeek / OpenCode Go） ───────────────────── */

/**
 * 调用节点半注册的本地 `/liuli-quota` 路由。密钥在 Host 侧解析，
 * 浏览器侧只拿到额度/余额展示数据。
 */
async function fetchFromHost(provider: string): Promise<SupplierQuotaData> {
  const response = await fetch(`/liuli-quota?provider=${encodeURIComponent(provider)}`, {
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

/* ── 适配器列表 ───────────────────────────────────────────────── */

const adapters: SupplierQuotaAdapter[] = [
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
  setState({ provider: null, model: null, data: null, status: 'idle', error: '' })
  subscribeCurrentModelDirectory()
  void refreshSupplierQuota()
}

/** 重新查询当前会话的供应商额度（幂等，多调用只保留最后一次结果）。
 *  2.0.4：旧 sessions.models RPC 移除；当前模型选择改从 modelDirectories 的
 *  每会话目录快照读（store.subscribe 已在切会话时驱动本函数重跑）。 */
export async function refreshSupplierQuota(): Promise<void> {
  if (remote === null || currentSessionId === null) return
  const generation = ++refreshGeneration
  setState({ status: 'loading', error: '' })

  try {
    const current: ModelSelection | null = modelDirectory === null
      ? null
      : modelDirectory.directoryFor(currentSessionId).store.getSnapshot().current
    if (generation !== refreshGeneration) return
    if (current === null) {
      // 目录未就绪（catalog 未加载）：不报错，保持 idle 语义等目录回调重跑。
      setState({ status: 'idle', error: '' })
      return
    }

    const adapter = adapters.find(candidate => candidate.match(current.provider))
    if (adapter === undefined) {
      setState({
        provider: current.provider,
        model: current.model,
        data: { kind: 'unavailable', provider: current.provider },
        status: 'ready',
      })
      return
    }

    const data = await adapter.fetch(remote, {
      provider: current.provider,
      model: current.model,
    })
    if (generation !== refreshGeneration) return
    setState({ provider: current.provider, model: current.model, data, status: 'ready' })
  } catch (error) {
    if (generation !== refreshGeneration) return
    setState({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** 插件卸载时释放订阅与连接引用。 */
export function disposeSupplierQuota(): void {
  unsubscribeModel?.()
  unsubscribeModel = null
  currentSessionId = null
  remote = null
  modelDirectory = null
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
