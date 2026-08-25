/**
 * 模型请求重试行状态 —— 设置页「功能」分区的展示状态类型与默认值。
 *
 * 真实重试策略持久化在宿主各供应商配置里（retryPolicy 字段，由 dsh-llm-retry
 * 在 agent 失败步骤上执行）；本模块只声明展示用的聚合值形状，镜像在设置
 * 「功能」分区的合并 store 里，写入由 model-retry-controller 经 settings.mutate
 * 落到每个供应商配置。
 */

/** 宿主 dsh-llm 重试策略默认值（与 dsh-llm/retry-policy 一致）。 */
export const MODEL_RETRY_DEFAULTS = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 10_000,
  jitterRatio: 0.1,
} as const

/** 行展示状态：聚合后的重试参数 + 已配置供应商数量 + 读写态。 */
export interface ModelRetryState {
  /** 最大重试次数（normal 模式 maxRetries）。 */
  maxRetries: number
  /** 首次重试等待（backoff.initialDelayMs，ms）。 */
  initialDelayMs: number
  /** 退避上限（backoff.maxDelayMs，ms；展示用，编辑器不直接改）。 */
  maxDelayMs: number
  /** 抖动比例（backoff.jitterRatio；展示用）。 */
  jitterRatio: number
  /** 当前已配置（存在 profile）的供应商数量。 */
  providerCount: number
  /** 读写状态机。 */
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  /** 最近一次错误信息（status==='error' 时有意义）。 */
  error: string
}
