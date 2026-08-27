/**
 * Web（兼容模式/纯浏览器）宿主布局状态机（纯逻辑、零依赖、可 Node 单测）。
 *
 * 语义逐条对齐官方 dsh-client-ui-layout 的 createLayoutStore（stores.ts）：
 * 初值、clamp 契约、toggle/narrow 行为完全一致，防止两套 store 漂移。
 * 动作实现为「原地变更状态对象」的 reducer 表 —— 既能作为 defineStore 的
 * actions 表（immer draft 原地变更），也能在单测里对普通克隆对象直跑。
 */

/** 官方 AppFrame 的侧栏窄视口自动收起断点（LG，1024px）。 */
export const SIDEBAR_AUTO_COLLAPSE = 1024

/** 官方 LayoutState 契约（HostLayoutSnapshot 同构）。 */
export interface WebLayoutState {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
}

export function initialWebLayoutState(): WebLayoutState {
  return { sidebar: 280, details: 0, narrow: false, narrowExpanded: false }
}

const clampPx = (px: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(px)))

/** 官方 createLayoutStore 的动作写入集（同构）。 */
export const webLayoutActions = {
  setSidebar(draft: WebLayoutState, px: number): void {
    draft.sidebar = clampPx(px, 264, 420)
  },
  setDetails(draft: WebLayoutState, px: number): void {
    draft.details = clampPx(px, 300, 520)
  },
  toggleSidebar(draft: WebLayoutState): void {
    if (draft.narrow) draft.narrowExpanded = !draft.narrowExpanded
    else draft.sidebar = draft.sidebar === 0 ? 280 : 0
  },
  setNarrow(draft: WebLayoutState, narrow: boolean): void {
    if (draft.narrow === narrow) return
    draft.narrow = narrow
    draft.narrowExpanded = false
  },
  openDetails(draft: WebLayoutState): void {
    if (draft.details === 0) draft.details = 360
  },
  closeDetails(draft: WebLayoutState): void {
    draft.details = 0
  },
}
