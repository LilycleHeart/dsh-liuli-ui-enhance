/**
 * 外观行槽位 store：主题偏好快照镜像（apply 侧的 theme/change 监听是唯一
 * 写入者；组件经 props.useStore 读取）。形状与官方 ui-theme 的
 * createAppearanceRowStore 一致，但为插件自实现 —— 避免跨包值导入
 * （client bundle purity gate 禁止 @deepseek-ai/dsh-client-ui-theme/client
 * 的运行时导入）。
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Store state mirrored from the theme snapshot. */
export interface LiuliAppearanceRowState {
  /** Persisted preference (selection reads this, never the resolved active theme). */
  preference: ThemePreference
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type LiuliAppearanceRowActions = {
  sync: (draft: LiuliAppearanceRowState, preference: ThemePreference, revision: number) => void
}

/**
 * Declares the appearance-row state and write surface.
 * @returns the store handle.
 */
export function createLiuliAppearanceStore(): EngineStoreHandle<LiuliAppearanceRowState, LiuliAppearanceRowActions> {
  return defineStore({
    init: (): LiuliAppearanceRowState => ({ preference: 'system', revision: -1 }),
    actions: {
      sync: (d, preference: ThemePreference, revision: number) => {
        if (revision <= d.revision) return
        d.preference = preference
        d.revision = revision
      },
    },
  })
}
