/** 琉璃设置 section 的槽位 store（镜像设置快照 + 壁纸）。 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import { LIULI_SETTINGS_DEFAULTS, type LiuliSettings } from '../liuli-settings.ts'

/** 槽位 store 状态。 */
export interface LiuliStoreState {
  settings: LiuliSettings
  revision: number
  wallpaper: string | null
  wallpaperRevision: number
}

type LiuliStoreActions = {
  syncSettings: (draft: LiuliStoreState, settings: LiuliSettings, revision: number) => void
  syncWallpaper: (draft: LiuliStoreState, wallpaper: string | null) => void
}

/** 声明琉璃设置 section 的状态与写入面。 */
export function createLiuliStore(): EngineStoreHandle<LiuliStoreState, LiuliStoreActions> {
  return defineStore({
    init: (): LiuliStoreState => ({
      settings: LIULI_SETTINGS_DEFAULTS,
      revision: -1,
      wallpaper: null,
      wallpaperRevision: 0,
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
    },
  })
}
