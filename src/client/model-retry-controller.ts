/**
 * 模型请求重试策略适配层（节点半 dsh-llm-retry 的浏览器侧编辑面）。
 *
 * 重试策略由每个供应商 profile 持有（retryPolicy 字段，dsh-llm-pi-ai /
 * dsh-llm-deepseek 的 schema 嵌入 RetryPolicySchema），由宿主
 * @deepseek-ai/dsh-llm-retry 插件在 agent 的 agent/request-error 扩展点
 * 上执行。本控制器只做两件事：
 *
 * 1. load()：调 llm.providers 拿到所有可配置供应商路由（provider +
 *    settingsNs + settingsPath），再调 settings.describe 读出各 profile
 *    已解析的 retryPolicy，聚合成展示值（最大重试次数 + 首次等待）。
 * 2. save(params)：对每个存在 profile 的供应商，以 path-addressed
 *    settings.mutate op 写入 retryPolicy.normal.{maxRetries,backoff}，
 *    保持 normal 模式与宿主默认 retryableCodes。全新写入路径用 set，
 *    已有路径整体替换其 retryPolicy 键（path-addressed，不会把整个
 *    profile 覆盖掉，密钥等字段不受影响）。
 *
 * 这与官方 dsh-client-ui-settings-models 的写法同构（pathOps 最小化 op），
 * 因此即便某供应商 profile 尚未创建也不会误伤：未配置供应商在 save 时
 * 跳过（没有 profile 就没有 retryPolicy 落地点）。
 */
import type { LiuliRemoteApi, ProviderRoute, SettingsNamespace } from './remote-api.ts'
import { MODEL_RETRY_DEFAULTS } from './model-retry-store.ts'

/** 宿主 RetryPolicySchema 的 normal 模式 JSON 形状（写侧）。 */
interface RetryPolicyConfig {
  mode: 'normal'
  maxRetries: number
  retryableCodes?: string[]
  backoff: {
    initialDelayMs: number
    maxDelayMs: number
    jitterRatio: number
  }
}

/** 在对象树里按 path 取值。 */
function getPath(root: unknown, path: readonly string[]): unknown {
  let node: unknown = root
  for (const key of path) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return undefined
    node = (node as Record<string, unknown>)[key]
  }
  return node
}

/** 读取一个 profile 已解析的 retryPolicy（取 namespace.value，即 base+user 合并值）。 */
function readRetryPolicy(profile: unknown): RetryPolicyConfig | undefined {
  if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) return undefined
  const policy = (profile as Record<string, unknown>).retryPolicy
  if (typeof policy !== 'object' || policy === null || Array.isArray(policy)) return undefined
  return policy as RetryPolicyConfig
}

/** 控制器持有的供应商路由快照。 */
export interface ModelRetrySnapshot {
  routes: ProviderRoute[]
  /** 已存在 profile 的供应商路由键（settingsNs/settingsPath.join('/')）—— save 只写这些。 */
  configuredKeys: Set<string>
  revision: number
  /** 各 settingsNs 的最近已知 revision（写侧乐观锁）。 */
  nsRevisions: Map<string, number>
}

let remote: LiuliRemoteApi | null = null
let snapshot: ModelRetrySnapshot = { routes: [], configuredKeys: new Set(), revision: 0, nsRevisions: new Map() }

/** 注入 remote 适配层。 */
export function initModelRetry(handle: LiuliRemoteApi): void {
  remote = handle
}

/** 释放句柄（插件卸载时调用）。 */
export function disposeModelRetry(): void {
  remote = null
  snapshot = { routes: [], configuredKeys: new Set(), revision: 0, nsRevisions: new Map() }
}

/**
 * 拉取所有可配置供应商路由 + 各 profile 已解析的 retryPolicy，返回展示聚合值。
 * @returns 聚合快照：maxRetries/initialDelayMs 取首个已配置供应商的值，
 *          providerCount 为存在 profile 的供应商数量；无供应商时回落默认。
 */
export async function loadModelRetry(): Promise<{
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
  jitterRatio: number
  providerCount: number
}> {
  if (remote === null) {
    return { ...MODEL_RETRY_DEFAULTS, providerCount: 0 }
  }
  const api = remote
  const [providersResp, settingsResp] = await Promise.all([
    api.llm.providers(),
    api.settings.describe(),
  ])
  if (!providersResp.ok || !settingsResp.ok) {
    return { ...MODEL_RETRY_DEFAULTS, providerCount: 0 }
  }
  const routes = providersResp.value.providers as ProviderRoute[]
  const namespaces = settingsResp.value.namespaces as SettingsNamespace[]
  const nsMap = new Map<string, SettingsNamespace>()
  const nsRevisions = new Map<string, number>()
  for (const ns of namespaces) {
    nsMap.set(ns.ns, ns)
    nsRevisions.set(ns.ns, ns.revision)
  }
  // 记录已配置 profile 的供应商路由键（save 只写这些，避免凭空建 profile）。
  const configuredKeys = new Set<string>()
  for (const route of routes) {
    const ns = nsMap.get(route.settingsNs)
    if (ns === undefined) continue
    if (getPath(ns.value, route.settingsPath) !== undefined) {
      configuredKeys.add(route.settingsNs + '/' + route.settingsPath.join('/'))
    }
  }
  snapshot = { routes, configuredKeys, revision: Date.now(), nsRevisions }

  // 聚合：统计已配置 profile 的供应商；首个有效 retryPolicy 作为展示基准。
  let providerCount = 0
  let first: RetryPolicyConfig | undefined
  for (const route of routes) {
    const ns = nsMap.get(route.settingsNs)
    if (ns === undefined) continue
    const profile = getPath(ns.value, route.settingsPath)
    if (profile === undefined) continue
    providerCount += 1
    const policy = readRetryPolicy(profile)
    if (first === undefined && policy !== undefined) first = policy
  }
  if (first !== undefined) {
    return {
      maxRetries: typeof first.maxRetries === 'number' ? first.maxRetries : MODEL_RETRY_DEFAULTS.maxRetries,
      initialDelayMs: first.backoff?.initialDelayMs ?? MODEL_RETRY_DEFAULTS.initialDelayMs,
      maxDelayMs: first.backoff?.maxDelayMs ?? MODEL_RETRY_DEFAULTS.maxDelayMs,
      jitterRatio: first.backoff?.jitterRatio ?? MODEL_RETRY_DEFAULTS.jitterRatio,
      providerCount,
    }
  }
  return { ...MODEL_RETRY_DEFAULTS, providerCount }
}

/**
 * 把重试参数写到每个已配置供应商的 retryPolicy。
 * 使用 path-addressed settings.mutate op（op:set 到 ...settingsPath + 'retryPolicy'），
 * 与官方 dsh-client-ui-settings-models 同构：只写 retryPolicy 键，不碰密钥等其它字段。
 * @returns 写入失败的错误信息（成功为 undefined）。
 */
export async function saveModelRetry(params: {
  maxRetries: number
  initialDelayMs: number
}): Promise<string | undefined> {
  if (remote === null) return '连接未就绪'
  const api = remote

  // 校验：与宿主 RetryPolicySchema 约束一致（maxRetries 非负整数；initialDelayMs>0）。
  const maxRetries = Math.max(0, Math.floor(Number(params.maxRetries) || 0))
  const initialDelayMs = Math.max(1, Math.floor(Number(params.initialDelayMs) || 0))
  // maxDelayMs/jitterRatio 保留宿主默认（编辑器不暴露，避免误配）；若 load 拿到过则沿用。
  const maxDelayMs = Math.max(initialDelayMs, snapshotMaxDelayMs)
  const jitterRatio = snapshotJitterRatio
  const policy: RetryPolicyConfig = {
    mode: 'normal',
    maxRetries,
    backoff: { initialDelayMs, maxDelayMs, jitterRatio },
  }

  // 逐命名空间收集 op（同一 ns 下的多个供应商路由合并到一次 mutate）。
  const byNs = new Map<string, { ops: Array<{ op: 'set'; path: string[]; value: unknown }>; expectedRevision?: number }>()
  for (const route of snapshot.routes) {
    // 跳过 settingsNs 为空的路由（宿主内置供应商，无 profile 落地点）。
    if (route.settingsNs === '') continue
    // 只写已配置 profile 的供应商：retryPolicy 必须挂在 profile 上，
    // profile 不存在时不凭空创建（与官方 dsh-client-ui-settings-models 一致）。
    const routeKey = route.settingsNs + '/' + route.settingsPath.join('/')
    if (!snapshot.configuredKeys.has(routeKey)) continue
    let entry = byNs.get(route.settingsNs)
    if (entry === undefined) {
      const rev = snapshot.nsRevisions.get(route.settingsNs)
      entry = { ops: [], ...(rev !== undefined ? { expectedRevision: rev } : {}) }
      byNs.set(route.settingsNs, entry)
    }
    entry.ops.push({
      op: 'set',
      path: [...route.settingsPath, 'retryPolicy'],
      value: policy,
    })
  }

  // 逐 ns 提交。任一失败即返回错误信息（已成功的 ns 不回滚，但展示态会提示重读）。
  for (const [ns, entry] of byNs) {
    if (entry.ops.length === 0) continue
    const resp = await api.settings.mutate({
      ns,
      ops: entry.ops,
      ...(entry.expectedRevision !== undefined ? { expectedRevision: entry.expectedRevision } : {}),
    })
    if (!resp.ok) return resp.error?.message ?? 'settings.mutate failed'
    // 刷新该 ns 的 revision（后续 op 的乐观锁基准）。
    if (resp.value !== undefined) snapshot.nsRevisions.set(ns, resp.value.revision)
  }
  return undefined
}

/** 缓存最近一次 load 拿到的 maxDelayMs/jitterRatio，save 时沿用（编辑器不暴露）。 */
let snapshotMaxDelayMs = MODEL_RETRY_DEFAULTS.maxDelayMs
let snapshotJitterRatio = MODEL_RETRY_DEFAULTS.jitterRatio

/** 由 loadModelRetry 调用以缓存展示基准（供 save 沿用未暴露字段）。 */
export function cacheModelRetryBackoff(maxDelayMs: number, jitterRatio: number): void {
  if (Number.isFinite(maxDelayMs) && maxDelayMs > 0) snapshotMaxDelayMs = maxDelayMs as typeof MODEL_RETRY_DEFAULTS.maxDelayMs
  if (Number.isFinite(jitterRatio) && jitterRatio >= 0 && jitterRatio <= 1) snapshotJitterRatio = jitterRatio as typeof MODEL_RETRY_DEFAULTS.jitterRatio
}
