/**
 * 切换会话默认历史加载量 —— 设置页「通用」分区行的状态 store。
 *
 * 该设置只影响 liuli-theme 插件自身行为：切换会话时，如果宿主的“加载更早
 * 消息”按钮只预载了少量历史，插件会按这里的批次数自动继续点击 older 按钮，
 * 让每个会话默认加载更多轮历史。持久化在 localStorage，不入宿主配置。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'

/** 宿主切换会话时默认已加载的历史轮数（常见基线，约两轮；一轮 = 一个用户对话）。 */
export const HISTORY_LOAD_DEFAULT_BATCHES = 2

/** localStorage 键。 */
export const HISTORY_LOAD_LS_KEY = 'liuli:history-load-batches'

/** 行展示状态。 */
export interface HistoryLoadState {
  /** 切换会话时自动加载的历史批次数（0 = 不自动预载，仅上翻时加载）。 */
  batches: number
  /** 读写状态机。 */
  status: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  /** 最近一次错误信息（status==='error' 时有意义）。 */
  error: string
}

/** 声明的 action 形状。 */
type HistoryLoadActions = {
  sync: (draft: HistoryLoadState, patch: Partial<HistoryLoadState>) => void
}

/** 读取持久化的批次数（损坏/越界时回落默认）。 */
export function loadHistoryBatches(): number {
  try {
    const raw = localStorage.getItem(HISTORY_LOAD_LS_KEY)
    if (raw === null) return HISTORY_LOAD_DEFAULT_BATCHES
    const v = Number(raw)
    if (Number.isFinite(v)) return Math.max(0, Math.min(20, Math.round(v)))
  } catch (_) { /* 存储不可用则回落默认 */ }
  return HISTORY_LOAD_DEFAULT_BATCHES
}

/** 保存批次数。 */
export function saveHistoryBatches(batches: number): void {
  const v = Math.max(0, Math.min(20, Math.round(batches)))
  try { localStorage.setItem(HISTORY_LOAD_LS_KEY, String(v)) } catch (_) { /* 忽略存储失败 */ }
}

/**
 * 声明历史加载行的状态与写入面。
 * @returns store handle。
 */
export function createHistoryLoadStore(): EngineStoreHandle<HistoryLoadState, HistoryLoadActions> {
  return defineStore({
    init: (): HistoryLoadState => ({
      batches: HISTORY_LOAD_DEFAULT_BATCHES,
      status: 'idle',
      error: '',
    }),
    actions: {
      sync: (d, patch) => { Object.assign(d, patch) },
    },
  })
}
