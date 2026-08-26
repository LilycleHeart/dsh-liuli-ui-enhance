/**
 * 思考等级自动补全行状态 —— 设置页「功能」分区的展示状态类型与默认值。
 *
 * 真实配置持久化在宿主各供应商 profile 里（llm-pi-ai.providers.<路由> 的
 * compat / models[*].reasoningEfforts，由 dsh-llm-pi-ai 解析）；本模块只声明
 * 展示用的聚合值形状，镜像在设置「功能」分区的合并 store 里，写入由
 * thinking-fill-controller 经 settings.mutate 落到每个供应商配置。
 */

/** 行展示状态：待补全数量 + 读写态 + 最近一次补全结果。 */
export interface ThinkingFillState {
  /** 读写状态机。 */
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  /** 最近一次错误信息（status==='error' 时有意义）。 */
  error: string
  /** 需要补全思考等级的提供商数量（缺 compat 声明或有缺声明的模型）。 */
  providerCount: number
  /** 需要补写 reasoningEfforts 的模型数量（models + modelOverrides 条目）。 */
  modelCount: number
  /** 最近一次成功补全的数量（供成功文案展示）；null 表示尚未补全过。 */
  lastFilled: { providers: number; models: number } | null
}

/** 行展示状态默认值。 */
export const THINKING_FILL_DEFAULTS: ThinkingFillState = {
  status: 'idle',
  error: '',
  providerCount: 0,
  modelCount: 0,
  lastFilled: null,
}