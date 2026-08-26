// thinking-fill 纯逻辑单元测试（node 直接跑 TS：类型剥离，无构建）。
// 运行：node demo/test-thinking-fill.ts
import {
  THINKING_FILL_EFFORTS,
  buildCompatFillValue,
  buildThinkingFillOps,
  collectFillCandidateKeys,
  getObjectPath,
  modelReasoningFillNeeded,
  planAutoFill,
  routeKeyOf,
  scanProviderFillPlan,
  type ProviderRoute,
  type SettingsNamespace,
} from '../src/client/thinking-fill-controller.ts'

let pass = 0
let fail = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass += 1; console.log('PASS ' + name) }
  else { fail += 1; failures.push(name + (detail !== '' ? ' :: ' + detail : '')); console.log('FAIL ' + name + (detail !== '' ? ' :: ' + detail : '')) }
}
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// T1 默认思考档位形状：off 留空，其余档位 wire = 档位名
{
  check('T1 efforts off is null', THINKING_FILL_EFFORTS.off === null)
  check('T1 efforts wire passthrough', THINKING_FILL_EFFORTS.low === 'low' && THINKING_FILL_EFFORTS.medium === 'medium'
    && THINKING_FILL_EFFORTS.high === 'high' && THINKING_FILL_EFFORTS.max === 'max')
  check('T1 levels set', deepEqual(Object.keys(THINKING_FILL_EFFORTS), ['off', 'low', 'medium', 'high', 'max']))
}

// T2 getObjectPath（数组不可遍历——与 model-retry-controller 的 getPath 同语义）
{
  const root = { a: { b: [{ c: 1 }] } }
  check('T2 deep path through object', getObjectPath(root, ['a', 'b']) !== undefined)
  check('T2 missing returns undefined', getObjectPath(root, ['a', 'x']) === undefined)
  check('T2 array node not traversed', getObjectPath(root, ['a', 'b', '0', 'c']) === undefined)
  check('T2 array root guard', getObjectPath([1, 2], ['0']) === undefined)
}

// T3 modelReasoningFillNeeded
{
  check('T3 missing needs fill', modelReasoningFillNeeded({ id: 'm1' }) === true)
  check('T3 null needs fill', modelReasoningFillNeeded({ id: 'm1', reasoningEfforts: null }) === true)
  check('T3 empty dict needs fill', modelReasoningFillNeeded({ id: 'm1', reasoningEfforts: {} }) === true)
  check('T3 false skips', modelReasoningFillNeeded({ id: 'm1', reasoningEfforts: false }) === false)
  check('T3 declared dict skips', modelReasoningFillNeeded({ id: 'm1', reasoningEfforts: { off: null, high: 'high' } }) === false)
  check('T3 non-object skips', modelReasoningFillNeeded('m1') === false)
}

// T4 scanProviderFillPlan：无 models / modelOverrides → 不处理
{
  check('T4 profile without models ignored', scanProviderFillPlan('pig', { baseURL: 'https://x' }) === null)
  check('T4 empty models ignored', scanProviderFillPlan('pig', { models: [] }) === null)
  check('T4 non-object ignored', scanProviderFillPlan('pig', 'x') === null)
}

// T5 scanProviderFillPlan：models 缺声明 → 列出落点 + compat 缺失
{
  const plan = scanProviderFillPlan('token', {
    baseURL: 'https://tokenrhythm.studio/v1',
    models: [{ id: 'a' }, { id: 'b', reasoningEfforts: false }, { id: 'c', reasoningEfforts: { high: 'high' } }, { id: 'd' }],
  })
  check('T5 plan detected', plan !== null)
  check('T5 spots only missing models', plan !== null && deepEqual(plan.fillSpots.map(s => s.key), [0, 3]))
  check('T5 compat missing flagged', plan !== null && plan.needsCompat === true)
}

// T6 scanProviderFillPlan：已有 compat / 完整声明 → 空计划（带模型的 profile 总是返回计划对象）
{
  const plan = scanProviderFillPlan('token', {
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
    models: [{ id: 'a', reasoningEfforts: { off: null, high: 'high' } }],
  })
  check('T6 complete returns empty plan', plan !== null && plan.fillSpots.length === 0 && plan.needsCompat === false)
  const plan2 = scanProviderFillPlan('token', {
    compat: { thinkingFormat: 'openai' },
    models: [{ id: 'a', reasoningEfforts: { off: null, high: 'high' } }],
  })
  check('T6 partial compat flagged', plan2 !== null && plan2.needsCompat === true && plan2.fillSpots.length === 0)
}

// T7 scanProviderFillPlan：modelOverrides 条目同样处理
{
  const plan = scanProviderFillPlan('token', {
    modelOverrides: { 'm-x': { contextWindow: 1024 }, 'm-y': { reasoningEfforts: false } },
  })
  check('T7 overrides missing spot', plan !== null && deepEqual(plan.fillSpots, [{ container: 'modelOverrides', key: 'm-x' }]))
}

// T8 buildCompatFillValue：保留已有字段，只补缺失
{
  const merged = buildCompatFillValue({ supportsStore: true, thinkingFormat: 'deepseek' })
  check('T8 preserves existing', merged.supportsStore === true && merged.thinkingFormat === 'deepseek')
  check('T8 fills missing effort', merged.supportsReasoningEffort === true)
  const fromEmpty = buildCompatFillValue(undefined)
  check('T8 from empty fills both', fromEmpty.thinkingFormat === 'openai' && fromEmpty.supportsReasoningEffort === true)
}

// T9 buildThinkingFillOps：models 整数组重写 + compat 合并（宿主 path op 不遍历数组）
{
  const routes: ProviderRoute[] = [{ provider: 'token', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'token'], active: true }]
  const namespaces: SettingsNamespace[] = [{
    ns: 'llm-pi-ai',
    revision: 7,
    value: { providers: { token: { baseURL: 'https://x', models: [{ id: 'kimi' }, { id: 'glm' }] } } },
  }]
  const plan = buildThinkingFillOps(routes, namespaces)
  const entry = plan.get('llm-pi-ai')
  check('T9 ns entry exists', entry !== undefined && entry.expectedRevision === 7)
  check('T9 has 2 ops (compat + whole models)', entry !== undefined && entry.ops.length === 2)
  check('T9 providers/models counts', entry !== undefined && entry.providers.size === 1 && entry.modelSpots === 2)
  if (entry !== undefined) {
    const compatOp = entry.ops.find(o => o.path[o.path.length - 1] === 'compat')
    const modelsOp = entry.ops.find(o => o.path[o.path.length - 1] === 'models')
    check('T9 compat op', compatOp !== undefined && deepEqual(compatOp.path, ['providers', 'token', 'compat'])
      && compatOp !== undefined && compatOp.value.thinkingFormat === 'openai')
    check('T9 models op whole array path', modelsOp !== undefined && deepEqual(modelsOp.path, ['providers', 'token', 'models']))
    if (modelsOp !== undefined) {
      const arr = modelsOp.value as Array<Record<string, unknown>>
      check('T9 array preserved with id', deepEqual(arr.map(m => m.id), ['kimi', 'glm']))
      check('T9 both entries filled', arr.every(m => deepEqual(m.reasoningEfforts, { ...THINKING_FILL_EFFORTS })))
    }
  }
}

// T10 buildThinkingFillOps：非 pi-ai 命名空间 / 空 settingsNs / profile 缺失 → 跳过
{
  const routes: ProviderRoute[] = [
    { provider: 'deepseek', settingsNs: 'llm-deepseek', settingsPath: ['x'], active: true },
    { provider: 'builtin', settingsNs: '', settingsPath: [], active: true },
    { provider: 'ghost', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'ghost'], active: true },
  ]
  const namespaces: SettingsNamespace[] = [{
    ns: 'llm-pi-ai',
    revision: 1,
    value: { providers: {} },
  }]
  const plan = buildThinkingFillOps(routes, namespaces)
  check('T10 all skipped', plan.size === 0)
}

// T11 buildThinkingFillOps：同命名空间多个提供商合并一次 mutate
{
  const routes: ProviderRoute[] = [
    { provider: 'a', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'a'], active: true },
    { provider: 'b', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'b'], active: true },
  ]
  const namespaces: SettingsNamespace[] = [{
    ns: 'llm-pi-ai',
    revision: 3,
    value: {
      providers: {
        a: { models: [{ id: 'm1' }] },
        b: { models: [{ id: 'm2', reasoningEfforts: false }] },
      },
    },
  }]
  const plan = buildThinkingFillOps(routes, namespaces)
  check('T11 one ns entry for both', plan.size === 1)
  const entry = plan.get('llm-pi-ai')
  // b 全部模型显式 reasoningEfforts:false 且无 compat → 视为故意关闭思考，整个跳过
  check('T11 ops for a only (b explicit false)', entry !== undefined && entry.ops.length === 2
    && entry.ops.some(o => deepEqual(o.path, ['providers', 'a', 'models']))
    && entry.ops.some(o => deepEqual(o.path, ['providers', 'a', 'compat']))
    && !entry.ops.some(o => o.path[1] === 'b'))
  check('T11 counts match', entry !== undefined && entry.providers.size === 1 && entry.modelSpots === 1)
}

// T12 buildThinkingFillOps：已完整声明的提供商零 op
{
  const routes: ProviderRoute[] = [{ provider: 'c', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'c'], active: true }]
  const namespaces: SettingsNamespace[] = [{
    ns: 'llm-pi-ai',
    revision: 1,
    value: {
      providers: {
        c: {
          compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
          models: [{ id: 'm1', reasoningEfforts: { off: null, high: 'high' } }],
        },
      },
    },
  }]
  const plan = buildThinkingFillOps(routes, namespaces)
  check('T12 nothing to fill', plan.size === 0)
}

// T13 buildThinkingFillOps：无 compat 且所有模型显式 false → 整个跳过
{
  const routes: ProviderRoute[] = [{ provider: 'd', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'd'], active: true }]
  const namespaces: SettingsNamespace[] = [{
    ns: 'llm-pi-ai',
    revision: 1,
    value: { providers: { d: { models: [{ id: 'm1', reasoningEfforts: false }] } } },
  }]
  const plan = buildThinkingFillOps(routes, namespaces)
  check('T13 all-false without compat skipped', plan.size === 0)
}

// T14 buildThinkingFillOps：models 整数组重写与 modelOverrides 逐键 op 并存
{
  const routes: ProviderRoute[] = [{ provider: 'token', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'token'], active: true }]
  const namespaces: SettingsNamespace[] = [{
    ns: 'llm-pi-ai',
    revision: 2,
    value: {
      providers: {
        token: {
          models: [{ id: 'a' }, { id: 'b', reasoningEfforts: { high: 'high' } }],
          modelOverrides: { 'm-x': { contextWindow: 1024 }, 'm-y': { reasoningEfforts: false } },
        },
      },
    },
  }]
  const plan = buildThinkingFillOps(routes, namespaces)
  const entry = plan.get('llm-pi-ai')
  check('T14 ops: models whole + overrides per-key + compat', entry !== undefined && entry.ops.length === 3
    && entry.ops.some(o => deepEqual(o.path, ['providers', 'token', 'models']) && (o.value as unknown[]).length === 2)
    && entry.ops.some(o => deepEqual(o.path, ['providers', 'token', 'modelOverrides', 'm-x', 'reasoningEfforts']))
    && entry.ops.some(o => deepEqual(o.path, ['providers', 'token', 'compat']))
    && !entry.ops.some(o => o.path.includes('m-y')))
  if (entry !== undefined) {
    const modelsOp = entry.ops.find(o => deepEqual(o.path, ['providers', 'token', 'models']))
    const arr = (modelsOp?.value ?? []) as Array<Record<string, unknown>>
    check('T14 only missing model filled, declared kept', arr.length === 2
      && deepEqual(arr[0].reasoningEfforts, { ...THINKING_FILL_EFFORTS })
      && deepEqual(arr[1].reasoningEfforts, { high: 'high' }))
    check('T14 counts', entry.providers.size === 1 && entry.modelSpots === 2)
  }
}

// T15 planAutoFill：新路由缺声明 → 生成写入计划并标记已处理
{
  const routes: ProviderRoute[] = [{ provider: 'kiro', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'kiro'], active: true }]
  const namespaces: SettingsNamespace[] = [{
    ns: 'llm-pi-ai',
    revision: 5,
    value: { providers: { kiro: { models: [{ id: 'claude-fable-5' }, { id: 'claude-opus-5' }] } } },
  }]
  const draft = planAutoFill(routes, namespaces, new Set())
  const entry = draft.plan.get('llm-pi-ai')
  check('T15 new route planned', entry !== undefined && entry.ops.length === 2
    && entry.ops.some(o => deepEqual(o.path, ['providers', 'kiro', 'models']))
    && entry.ops.some(o => deepEqual(o.path, ['providers', 'kiro', 'compat'])))
  check('T15 seen addition', deepEqual(draft.seenAdditions, ['llm-pi-ai/providers/kiro']))
}

// T16 planAutoFill：已处理的路由跳过（不重复写）
{
  const routes: ProviderRoute[] = [{ provider: 'kiro', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'kiro'], active: true }]
  const namespaces: SettingsNamespace[] = [{
    ns: 'llm-pi-ai',
    revision: 5,
    value: { providers: { kiro: { models: [{ id: 'claude-fable-5' }] } } },
  }]
  const draft = planAutoFill(routes, namespaces, new Set(['llm-pi-ai/providers/kiro']))
  check('T16 seen route skipped', draft.plan.size === 0 && draft.seenAdditions.length === 0)
}

// T17 planAutoFill：新路由已完整声明 → 只登记不写
{
  const routes: ProviderRoute[] = [{ provider: 'c', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'c'], active: true }]
  const namespaces: SettingsNamespace[] = [{
    ns: 'llm-pi-ai',
    revision: 5,
    value: {
      providers: {
        c: {
          compat: { thinkingFormat: 'openai', supportsReasoningEffort: true },
          models: [{ id: 'm1', reasoningEfforts: { off: null, high: 'high' } }],
        },
      },
    },
  }]
  const draft = planAutoFill(routes, namespaces, new Set())
  check('T17 complete new route: seen only', draft.plan.size === 0 && deepEqual(draft.seenAdditions, ['llm-pi-ai/providers/c']))
}

// T18 planAutoFill：不带模型的 profile 不写也不登记（留待补 models 后被发现）
{
  const routes: ProviderRoute[] = [
    { provider: 'n', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'n'], active: true },
    { provider: 'deep', settingsNs: 'llm-deepseek', settingsPath: ['x'], active: true },
  ]
  const namespaces: SettingsNamespace[] = [{
    ns: 'llm-pi-ai',
    revision: 5,
    value: { providers: { n: { baseURL: 'https://x' } } },
  }]
  const draft = planAutoFill(routes, namespaces, new Set())
  check('T18 no-models / non-pi-ai ignored', draft.plan.size === 0 && draft.seenAdditions.length === 0)
}

// T19 collectFillCandidateKeys：只收集带模型的 pi-ai 路由（含已完整声明的）
{
  const routes: ProviderRoute[] = [
    { provider: 'a', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'a'], active: true },
    { provider: 'b', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'b'], active: true },
    { provider: 'c', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'c'], active: true },
    { provider: 'deep', settingsNs: 'llm-deepseek', settingsPath: ['x'], active: true },
  ]
  const namespaces: SettingsNamespace[] = [{
    ns: 'llm-pi-ai',
    revision: 5,
    value: {
      providers: {
        a: { models: [{ id: 'm1' }] },
        b: { compat: { thinkingFormat: 'openai', supportsReasoningEffort: true }, models: [{ id: 'm2', reasoningEfforts: { high: 'high' } }] },
        c: { baseURL: 'https://x' },
      },
    },
  }]
  const keys = collectFillCandidateKeys(routes, namespaces)
  check('T19 keys include model-bearing only', deepEqual(keys.sort(), ['llm-pi-ai/providers/a', 'llm-pi-ai/providers/b'].sort()))
  check('T19 routeKeyOf format', routeKeyOf(routes[0]!) === 'llm-pi-ai/providers/a')
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('failures:')
  for (const f of failures) console.log('  - ' + f)
  process.exit(1)
}