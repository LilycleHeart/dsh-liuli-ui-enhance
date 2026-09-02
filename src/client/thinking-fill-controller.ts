/**
 * 思考等级自动补全（thinking-fill）控制器。
 *
 * 背景：DSH 的「模型提供商」页面把自定义提供商写进用户设置文档
 * （`llm-pi-ai.providers.<路由>`，即 `~/.dsh/settings.yaml`），但添加时不会
 * 自动声明每个模型的思考等级（`reasoningEfforts`）与提供商级的
 * `compat.thinkingFormat / supportsReasoningEffort`。由
 * @deepseek-ai/dsh-llm-pi-ai 解析配置时，**未声明 `reasoningEfforts`
 * 的手工声明模型完全不开放思考档位**（README：模型选择器不出现
 * thinking 档位），因此自定义提供商添加后思考等级必须手工补。
 *
 * 本控制器提供两种写入路径：
 * 1. autoApplyThinkingFill()（自动）：客户端监听 `settings/document-updated`
 *    调用。首次运行只把现有提供商登记为「已处理」（localStorage
 *    `liuli:thinking-fill-seen`，遵循 liuli:* 命名约定），**不写配置**；
 *    之后只补**新出现**的路由（已处理的不再重复写，避免与用户后续手工
 *    编辑打架）。
 * 2. applyThinkingFill()（手动「一键补全」）：对当前所有缺声明的提供商
 *    补全（含历史遗留），供设置页按钮/主动修复使用。
 *
 * 两者共用同一计划构建：以 path-addressed settings.mutate 写入 `compat`
 * （合并保留已有字段）与各模型的 `reasoningEfforts`（档位与
 * `~/.dsh/settings.yaml` 中 token-think 的手工声明一致：
 * off/low/medium/high/max，wire 值 = 档位名，`off` 留空）。
 *
 * 与 model-retry-controller 同构：只写缺失键，不碰密钥等其它字段；
 * 显式 `reasoningEfforts: false` 的模型（故意声明不支持思考）跳过；
 * 只能处理 `llm-pi-ai` 命名空间（dsh-llm-deepseek 的 profile 形状不同，
 * 误写会破坏其配置）。
 */
import type { LiuliRemoteApi, ProviderRoute, SettingsNamespace } from './remote-api.ts'

/** 补全写入的思考档位（与用户在 settings.yaml 中 token-think 的声明一致）。
 *  `off` 值留空（pi-ai 语义：不思考 = 省略 reasoning 参数）；
 *  其余档位 wire 值 = 档位名（OpenAI 兼容网关的 reasoning_effort 参数）。 */
export const THINKING_FILL_EFFORTS = {
  off: null,
  low: 'low',
  medium: 'medium',
  high: 'high',
  max: 'max',
} as const

/** 提供商级缺省 compat 补丁（OpenAI 兼容网关的思考传输）。 */
export const THINKING_FILL_COMPAT_PATCH = {
  thinkingFormat: 'openai',
  supportsReasoningEffort: true,
} as const

/** 只处理该命名空间（pi-ai 自定义提供商所在地；deepseek 等其它命名空间形状不同）。 */
const PI_AI_NAMESPACE = 'llm-pi-ai'

/** 在对象树里按 path 取值。 */
export function getObjectPath(root: unknown, path: readonly string[]): unknown {
  let node: unknown = root
  for (const key of path) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return undefined
    node = (node as Record<string | number, unknown>)[key]
  }
  return node
}

/** 判断一个模型条目是否需要补写思考等级（缺失 / 空字典需要；false 与已声明字典跳过）。 */
export function modelReasoningFillNeeded(model: unknown): boolean {
  if (typeof model !== 'object' || model === null || Array.isArray(model)) return false
  const efforts = (model as Record<string, unknown>).reasoningEfforts
  if (efforts === false) return false
  if (efforts === undefined || efforts === null) return true
  if (typeof efforts === 'object' && !Array.isArray(efforts) && Object.keys(efforts as Record<string, unknown>).length === 0) {
    return true
  }
  return false
}

/** profile 的补全扫描结果。 */
export interface ProviderFillPlan {
  provider: string
  /** 提供商级 compat 是否缺 thinkingFormat / supportsReasoningEffort。 */
  needsCompat: boolean
  /** 需要补写 reasoningEfforts 的落点（models 用数字下标，modelOverrides 用键名）。 */
  fillSpots: Array<{ container: 'models' | 'modelOverrides'; key: string | number }>
}

/**
 * 扫描一个已声明的 pi-ai 提供商 profile，列出需要补全的位置。
 * 返回 null 表示该 profile **不带模型**（纯 catalog 路由 / 无 models 与
 * modelOverrides）——没有可补的落点，也不参与「已处理」记忆；
 * 带模型的 profile 总是返回计划（可能为空：已完整声明 → 两个集合都空）。
 */
export function scanProviderFillPlan(provider: string, profile: unknown): ProviderFillPlan | null {
  if (typeof profile !== 'object' || profile === null || Array.isArray(profile)) return null
  const rec = profile as Record<string, unknown>
  const models = rec.models
  const overrides = rec.modelOverrides
  const hasModels = Array.isArray(models) && models.length > 0
  const hasOverrides = typeof overrides === 'object' && overrides !== null && !Array.isArray(overrides)
    && Object.keys(overrides as Record<string, unknown>).length > 0
  if (!hasModels && !hasOverrides) return null

  const fillSpots: ProviderFillPlan['fillSpots'] = []
  if (hasModels) {
    ;(models as unknown[]).forEach((entry, index) => {
      if (modelReasoningFillNeeded(entry)) fillSpots.push({ container: 'models', key: index })
    })
  }
  if (hasOverrides) {
    for (const key of Object.keys(overrides as Record<string, unknown>)) {
      if (modelReasoningFillNeeded((overrides as Record<string, unknown>)[key])) {
        fillSpots.push({ container: 'modelOverrides', key })
      }
    }
  }

  const compat = rec.compat
  const compatRec = typeof compat === 'object' && compat !== null && !Array.isArray(compat)
    ? compat as Record<string, unknown>
    : {}
  const compatMissingField = compatRec.thinkingFormat === undefined || compatRec.supportsReasoningEffort === undefined
  // 只在该提供商与思考相关时补 compat：有需要补的模型，或已有 compat 声明
  // （部分声明需要补全；完全没 compat 且所有模型都显式 false = 故意关闭思考，跳过）。
  const compatPresent = Object.keys(compatRec).length > 0
  const needsCompat = compatMissingField && (fillSpots.length > 0 || compatPresent)

  return { provider, needsCompat, fillSpots }
}

/** 合并 compat：保留已有字段，补上 thinkingFormat / supportsReasoningEffort。 */
export function buildCompatFillValue(existing: unknown): Record<string, unknown> {
  const base = typeof existing === 'object' && existing !== null && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) }
    : {}
  for (const [field, value] of Object.entries(THINKING_FILL_COMPAT_PATCH)) {
    if (base[field] === undefined) base[field] = value
  }
  return base
}

/** settings.mutate op（最小写面）。 */
export interface ThinkingFillOp {
  op: 'set'
  path: string[]
  value: unknown
}

/** 按命名空间聚合的写入计划（含乐观锁基准 revision 与覆盖统计）。 */
export interface ThinkingFillNsPlan {
  ops: ThinkingFillOp[]
  expectedRevision?: number
  /** 覆盖的提供商路由名（去重）。 */
  providers: Set<string>
  /** 覆盖的模型落点数（models + modelOverrides 缺失条目数）。 */
  modelSpots: number
}

export type ThinkingFillOpsByNs = Map<string, ThinkingFillNsPlan>

/**
 * 由 llm.providers 路由 + settings.describe 命名空间构建补全写入计划。
 * 纯函数：便于单测；apply 直接按此计划提交 mutate。
 *
 * 注意：宿主 settings.mutate 的 path op **不遍历数组**（数组被当作非 plain
 * object 整体替换），因此 models 缺声明的条目不能逐项写
 * `models.N.reasoningEfforts`（那会把 models 数组换成 {N: …} 对象、整个
 * llm-pi-ai 命名空间校验失败）——改为对整个 models 数组做一次重写；
 * modelOverrides 是字典（plain object），逐键写 path op 是安全的。
 */
export function buildThinkingFillOps(
  routes: ProviderRoute[],
  namespaces: SettingsNamespace[],
): ThinkingFillOpsByNs {
  const nsMap = new Map<string, SettingsNamespace>()
  for (const ns of namespaces) nsMap.set(ns.ns, ns)
  const plan = new Map<string, ThinkingFillNsPlan>()

  const ensureNs = (ns: string, revision: number | undefined): ThinkingFillNsPlan => {
    let entry = plan.get(ns)
    if (entry === undefined) {
      entry = { ops: [], providers: new Set(), modelSpots: 0, ...(revision !== undefined ? { expectedRevision: revision } : {}) }
      plan.set(ns, entry)
    }
    return entry
  }

  for (const route of routes) {
    if (route.settingsNs === '' || route.settingsNs !== PI_AI_NAMESPACE) continue
    const ns = nsMap.get(route.settingsNs)
    if (ns === undefined) continue
    const profile = getObjectPath(ns.value, route.settingsPath)
    const fill = scanProviderFillPlan(route.provider, profile)
    if (fill === null || fill.fillSpots.length === 0 && !fill.needsCompat) continue
    const entry = ensureNs(route.settingsNs, ns.revision)
    entry.providers.add(route.provider)
    entry.modelSpots += fill.fillSpots.length
    if (fill.needsCompat) {
      const existing = typeof profile === 'object' && profile !== null && !Array.isArray(profile)
        ? (profile as Record<string, unknown>).compat
        : undefined
      entry.ops.push({
        op: 'set',
        path: [...route.settingsPath, 'compat'],
        value: buildCompatFillValue(existing),
      })
    }
    // models：整数组重写（path op 不遍历数组）。只改动缺声明的条目，其余原样保留。
    const modelSpots = fill.fillSpots.filter(spot => spot.container === 'models')
    if (modelSpots.length > 0 && typeof profile === 'object' && profile !== null && !Array.isArray(profile)) {
      const models = (profile as Record<string, unknown>).models
      if (Array.isArray(models)) {
        const spotKeys = new Set(modelSpots.map(spot => String(spot.key)))
        const nextModels = models.map((model, index) => {
          return spotKeys.has(String(index))
            ? { ...(typeof model === 'object' && model !== null && !Array.isArray(model) ? model as Record<string, unknown> : {}), reasoningEfforts: { ...THINKING_FILL_EFFORTS } }
            : model
        })
        entry.ops.push({
          op: 'set',
          path: [...route.settingsPath, 'models'],
          value: nextModels,
        })
      }
    }
    // modelOverrides：字典（plain object），逐键写 path op 安全。
    for (const spot of fill.fillSpots) {
      if (spot.container !== 'modelOverrides') continue
      entry.ops.push({
        op: 'set',
        path: [...route.settingsPath, 'modelOverrides', String(spot.key), 'reasoningEfforts'],
        value: { ...THINKING_FILL_EFFORTS },
      })
    }
  }
  return plan
}

/* ── 自动补全：已处理路由记忆（localStorage，遵循 liuli:* 命名约定）── */

/** 已处理路由键的 localStorage 键。 */
const SEEN_FILL_KEYS = 'liuli:thinking-fill-seen'

/** 路由键：`settingsNs/path[0]/path[1]…`，区分不同命名空间的同名路由。 */
export function routeKeyOf(route: ProviderRoute): string {
  return route.settingsNs + '/' + route.settingsPath.join('/')
}

/** 读取已处理路由键集合（损坏数据返回空集，安全回退）。 */
export function loadSeenFillKeys(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_FILL_KEYS)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'))
  } catch {
    return new Set()
  }
}

/** 持久化已处理路由键集合。 */
export function saveSeenFillKeys(keys: Set<string>): void {
  try {
    localStorage.setItem(SEEN_FILL_KEYS, JSON.stringify([...keys]))
  } catch {
    // localStorage 不可用（隐私模式等）时静默降级：下个周期重新扫描。
  }
}

/** 自动补全的一次扫描结果：写入计划 + 应并入已处理集合的新路由。 */
export interface AutoFillDraft {
  plan: ThinkingFillOpsByNs
  /** 本次应标记为「已处理」的路由键（已补全或已完整声明；不带模型的留待观察）。 */
  seenAdditions: string[]
}

/**
 * 构建自动补全计划（纯函数，便于单测）：
 * - 只处理 pi-ai 命名空间、已声明 profile 且带 models/modelOverrides 的路由；
 * - 已处于 seen 的路由跳过（不重复写，避免与用户后续手工编辑打架）；
 * - 新出现且缺声明的路由 → 生成写入计划；
 * - 新出现但已完整声明的路由 → 只并入 seen，不写；
 * - 不带模型的路由 → 既不写也不并入 seen（用户之后补 models 时仍会被发现）。
 */
export function planAutoFill(
  routes: ProviderRoute[],
  namespaces: SettingsNamespace[],
  seen: ReadonlySet<string>,
): AutoFillDraft {
  const nsMap = new Map<string, SettingsNamespace>()
  for (const ns of namespaces) nsMap.set(ns.ns, ns)
  const plan = new Map<string, ThinkingFillNsPlan>()
  const seenAdditions: string[] = []
  const ensureNs = (ns: string, revision: number | undefined): ThinkingFillNsPlan => {
    let entry = plan.get(ns)
    if (entry === undefined) {
      entry = { ops: [], providers: new Set(), modelSpots: 0, ...(revision !== undefined ? { expectedRevision: revision } : {}) }
      plan.set(ns, entry)
    }
    return entry
  }

  for (const route of routes) {
    if (route.settingsNs === '' || route.settingsNs !== PI_AI_NAMESPACE) continue
    const ns = nsMap.get(route.settingsNs)
    if (ns === undefined) continue
    const profile = getObjectPath(ns.value, route.settingsPath)
    const fill = scanProviderFillPlan(route.provider, profile)
    // 不带模型的 profile：留待观察，不标记已处理。
    if (fill === null) continue
    const key = routeKeyOf(route)
    if (seen.has(key)) continue
    // 新路由：缺声明 → 生成计划；已完整声明 → 只标记已处理。
    seenAdditions.push(key)
    if (fill.fillSpots.length === 0 && !fill.needsCompat) continue
    const entry = ensureNs(route.settingsNs, ns.revision)
    entry.providers.add(route.provider)
    entry.modelSpots += fill.fillSpots.length
    if (fill.needsCompat) {
      const existing = typeof profile === 'object' && profile !== null && !Array.isArray(profile)
        ? (profile as Record<string, unknown>).compat
        : undefined
      entry.ops.push({
        op: 'set',
        path: [...route.settingsPath, 'compat'],
        value: buildCompatFillValue(existing),
      })
    }
    const modelSpots = fill.fillSpots.filter(spot => spot.container === 'models')
    if (modelSpots.length > 0 && typeof profile === 'object' && profile !== null && !Array.isArray(profile)) {
      const models = (profile as Record<string, unknown>).models
      if (Array.isArray(models)) {
        const spotKeys = new Set(modelSpots.map(spot => String(spot.key)))
        const nextModels = models.map((model, index) => {
          return spotKeys.has(String(index))
            ? { ...(typeof model === 'object' && model !== null && !Array.isArray(model) ? model as Record<string, unknown> : {}), reasoningEfforts: { ...THINKING_FILL_EFFORTS } }
            : model
        })
        entry.ops.push({
          op: 'set',
          path: [...route.settingsPath, 'models'],
          value: nextModels,
        })
      }
    }
    for (const spot of fill.fillSpots) {
      if (spot.container !== 'modelOverrides') continue
      entry.ops.push({
        op: 'set',
        path: [...route.settingsPath, 'modelOverrides', String(spot.key), 'reasoningEfforts'],
        value: { ...THINKING_FILL_EFFORTS },
      })
    }
  }
  return { plan, seenAdditions }
}

/** 控制器持有的连接句柄。 */
let remote: LiuliRemoteApi | null = null

/** 注入连接句柄。 */
export function initThinkingFill(handle: LiuliRemoteApi): void {
  remote = handle
}

/** 释放句柄（插件卸载时调用）。 */
export function disposeThinkingFill(): void {
  remote = null
}

/** 读取 describe / providers 并扫描待补数量（providerCount/modelCount）。 */
async function scanNeeds(): Promise<{ providerCount: number; modelCount: number }> {
  if (remote === null) return { providerCount: 0, modelCount: 0 }
  const api = remote
  const [providersResp, settingsResp] = await Promise.all([
    api.llm.providers(),
    api.settings.describe(),
  ])
  if (!providersResp.ok || !settingsResp.ok) {
    return { providerCount: 0, modelCount: 0 }
  }
  const routes = providersResp.value.providers as ProviderRoute[]
  const namespaces = settingsResp.value.namespaces as SettingsNamespace[]
  const nsMap = new Map<string, SettingsNamespace>()
  for (const ns of namespaces) nsMap.set(ns.ns, ns)

  let providerCount = 0
  let modelCount = 0
  for (const route of routes) {
    if (route.settingsNs === '' || route.settingsNs !== PI_AI_NAMESPACE) continue
    const ns = nsMap.get(route.settingsNs)
    if (ns === undefined) continue
    const profile = getObjectPath(ns.value, route.settingsPath)
    const fill = scanProviderFillPlan(route.provider, profile)
    if (fill === null || fill.fillSpots.length === 0 && !fill.needsCompat) continue
    providerCount += 1
    modelCount += fill.fillSpots.length
  }
  return { providerCount, modelCount }
}

/**
 * 重新扫描并返回待补全数量（供「重新检测」与补全后刷新展示）。
 */
export async function loadThinkingFill(): Promise<{ providerCount: number; modelCount: number }> {
  return scanNeeds()
}

/**
 * 一键补全：对缺声明的 pi-ai 自定义提供商写入 compat + 各模型
 * reasoningEfforts。以当前 describe 为准（不依赖上次 load 的快照，
 * 避免漏掉刚添加的提供商）。返回补全的提供商/模型数量与错误信息。
 */
export async function applyThinkingFill(): Promise<{
  ok: boolean
  error?: string
  filledProviders: number
  filledModels: number
}> {
  if (remote === null) return { ok: false, error: '连接未就绪', filledProviders: 0, filledModels: 0 }
  const api = remote
  const [providersResp, settingsResp] = await Promise.all([
    api.llm.providers(),
    api.settings.describe(),
  ])
  if (!providersResp.ok || !settingsResp.ok) {
    return { ok: false, error: '读取提供商配置失败', filledProviders: 0, filledModels: 0 }
  }
  const routes = providersResp.value.providers as ProviderRoute[]
  const namespaces = settingsResp.value.namespaces as SettingsNamespace[]
  const plan = buildThinkingFillOps(routes, namespaces)

  let filledProviders = 0
  let filledModels = 0
  // 逐 ns 提交（同一个 ns 的多个提供商合并到一次 mutate）。任一失败即中止并返回错误。
  for (const [ns, entry] of plan) {
    if (entry.ops.length === 0) continue
    filledProviders += entry.providers.size
    filledModels += entry.modelSpots
    const resp = await api.settings.mutate({
      ns,
      ops: entry.ops,
      ...(entry.expectedRevision !== undefined ? { expectedRevision: entry.expectedRevision } : {}),
    })
    if (!resp.ok) return { ok: false, error: resp.error?.message ?? 'settings.mutate failed', filledProviders: 0, filledModels: 0 }
  }
  return { ok: true, filledProviders, filledModels }
}

/**
 * 收集当前所有「带模型」的 pi-ai 路由键（含已完整声明的；不带模型的
 * catalog 路由排除——它们没有可补的落点，留待用户后续补 models 时被发现）。
 * 供首次运行的基底记录使用：不写任何配置，只把现有提供商登记为「已处理」，
 * 之后的自动补全只针对**新出现**的路由。
 */
export function collectFillCandidateKeys(
  routes: ProviderRoute[],
  namespaces: SettingsNamespace[],
): string[] {
  const nsMap = new Map<string, SettingsNamespace>()
  for (const ns of namespaces) nsMap.set(ns.ns, ns)
  const keys: string[] = []
  for (const route of routes) {
    if (route.settingsNs === '' || route.settingsNs !== PI_AI_NAMESPACE) continue
    const ns = nsMap.get(route.settingsNs)
    if (ns === undefined) continue
    const profile = getObjectPath(ns.value, route.settingsPath)
    if (scanProviderFillPlan(route.provider, profile) === null) continue
    keys.push(routeKeyOf(route))
  }
  return keys
}

/**
 * 自动补全（客户端定时器/事件调用）：**只补新出现的自定义提供商**。
 * - 首次运行（localStorage `liuli:thinking-fill-seen` 为空）：只把现有
 *   提供商登记为已处理，**不写任何配置**（历史缺声明的由「一键补全」
 *   按钮手动处理，避免改动用户既有路由如 token 无思考副本）；
 * - 之后每次调用：对不在已处理集合的**新路由**，缺声明则自动补写
 *   compat + 各模型 reasoningEfforts，已完整声明则只登记；
 * - 写入成功后并入已处理集合（失败不入，下次重试）。
 * @returns changed=true 表示本周期发生了写入（供调用方刷新展示）。
 */
export async function autoApplyThinkingFill(): Promise<{
  changed: boolean
  error?: string
  filledProviders: number
  filledModels: number
}> {
  if (remote === null) return { changed: false, filledProviders: 0, filledModels: 0 }
  const api = remote
  const [providersResp, settingsResp] = await Promise.all([
    api.llm.providers(),
    api.settings.describe(),
  ])
  if (!providersResp.ok || !settingsResp.ok) {
    return { changed: false, error: '读取提供商配置失败', filledProviders: 0, filledModels: 0 }
  }
  const routes = providersResp.value.providers as ProviderRoute[]
  const namespaces = settingsResp.value.namespaces as SettingsNamespace[]
  const seen = loadSeenFillKeys()

  // 首次运行：基底登记，不写配置。
  if (seen.size === 0) {
    const bootKeys = collectFillCandidateKeys(routes, namespaces)
    for (const key of bootKeys) seen.add(key)
    saveSeenFillKeys(seen)
    return { changed: false, filledProviders: 0, filledModels: 0 }
  }

  const draft = planAutoFill(routes, namespaces, seen)

  let filledProviders = 0
  let filledModels = 0
  for (const [ns, entry] of draft.plan) {
    if (entry.ops.length === 0) continue
    filledProviders += entry.providers.size
    filledModels += entry.modelSpots
    const resp = await api.settings.mutate({
      ns,
      ops: entry.ops,
      ...(entry.expectedRevision !== undefined ? { expectedRevision: entry.expectedRevision } : {}),
    })
    if (!resp.ok) {
      // 失败不并入 seen：下次重试；也不做部分提交的 seen 合并。
      return { changed: false, error: resp.error?.message ?? 'settings.mutate failed', filledProviders: 0, filledModels: 0 }
    }
  }
  // 写入成功（或无可写）后，把本周期处理过的路由并入 seen。
  if (draft.seenAdditions.length > 0) {
    for (const key of draft.seenAdditions) seen.add(key)
    saveSeenFillKeys(seen)
  }
  return { changed: filledProviders > 0 || filledModels > 0, filledProviders, filledModels }
}