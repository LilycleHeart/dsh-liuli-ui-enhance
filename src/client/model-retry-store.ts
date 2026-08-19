/**
 * 模型请求重试行槽位 store：镜像当前各供应商已解析的重试策略快照。
 *
 * 与 liuli-appearance-store 同构 —— 为 settings.general.item 行提供
 * 响应式读取面（组件经 props.useStore 读取）。真实重试策略持久化在
 * 宿主各供应商配置里（retryPolicy 字段，由 dsh-llm-retry 在 agent 失败
 * 步骤上执行）；本 store 只缓存展示用的聚合值，写入由
 * model-retry-controller 经 settings.mutate 落到每个供应商配置。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

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

/** 声明的 action 形状。 */
type ModelRetryActions = {
  sync: (draft: ModelRetryState, patch: Partial<ModelRetryState>) => void
}

/**
 * 声明模型重试行的状态与写入面。
 * @returns store handle。
 */
export function createModelRetryStore(): EngineStoreHandle<ModelRetryState, ModelRetryActions> {
  return defineStore({
    init: (): ModelRetryState => ({
      ...MODEL_RETRY_DEFAULTS,
      providerCount: 0,
      status: 'idle',
      error: '',
    }),
    actions: {
      sync: (d, patch) => { Object.assign(d, patch) },
    },
  })
}
