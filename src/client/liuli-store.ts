/** 琉璃设置 section 的槽位 store（镜像设置快照 + 壁纸 + 功能分区子状态）。
 *
 * 设置页「外观」「功能」两个分区共用同一个 store 实例：外观分区读
 * settings / wallpaper，功能分区读 settings（宽边/动画/声纹）+ modelRetry +
 * historyLoad。modelRetry / historyLoad 原本是通用分区里两行各自的小 store，
 * 归拢进功能分区后合并到这里，避免注册多个槽位 store。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { LIULI_SETTINGS_DEFAULTS, type LiuliSettings } from '../liuli-settings.ts'
import { MODEL_RETRY_DEFAULTS, type ModelRetryState } from './model-retry-store.ts'
import { HISTORY_LOAD_DEFAULT_BATCHES, type HistoryLoadState } from './history-load-store.ts'
import { THINKING_FILL_DEFAULTS, type ThinkingFillState } from './thinking-fill-store.ts'

/** 槽位 store 状态。 */
export interface LiuliStoreState {
  settings: LiuliSettings
  revision: number
  wallpaper: string | null
  wallpaperRevision: number
  /** 模型请求重试行状态（功能分区）。 */
  modelRetry: ModelRetryState
  /** 切换会话默认历史加载量状态（功能分区）。 */
  historyLoad: HistoryLoadState
  /** 思考等级自动补全行状态（功能分区）。 */
  thinkingFill: ThinkingFillState
}

type LiuliStoreActions = {
  syncSettings: (draft: LiuliStoreState, settings: LiuliSettings, revision: number) => void
  syncWallpaper: (draft: LiuliStoreState, wallpaper: string | null) => void
  syncModelRetry: (draft: LiuliStoreState, patch: Partial<ModelRetryState>) => void
  syncHistoryLoad: (draft: LiuliStoreState, patch: Partial<HistoryLoadState>) => void
  syncThinkingFill: (draft: LiuliStoreState, patch: Partial<ThinkingFillState>) => void
}

/** 声明琉璃设置 section 的状态与写入面。 */
export function createLiuliStore(): EngineStoreHandle<LiuliStoreState, LiuliStoreActions> {
  return defineStore({
    init: (): LiuliStoreState => ({
      settings: LIULI_SETTINGS_DEFAULTS,
      revision: -1,
      wallpaper: null,
      wallpaperRevision: 0,
      modelRetry: {
        ...MODEL_RETRY_DEFAULTS,
        providerCount: 0,
        status: 'idle',
        error: '',
      },
      historyLoad: {
        batches: HISTORY_LOAD_DEFAULT_BATCHES,
        status: 'idle',
        error: '',
      },
      thinkingFill: { ...THINKING_FILL_DEFAULTS },
    }),
    actions: {
      syncSettings: (d, settings, revision) => {
        if (revision <= d.revision) return
        d.settings = settings
        d.revision = revision
      },
      syncWallpaper: (d, wallpaper) => {
        d.wallpaper = wallpaper
        d.wallpaperRevision += 1
      },
      syncModelRetry: (d, patch) => { Object.assign(d.modelRetry, patch) },
      syncHistoryLoad: (d, patch) => { Object.assign(d.historyLoad, patch) },
      syncThinkingFill: (d, patch) => { Object.assign(d.thinkingFill, patch) },
    },
  })
}
