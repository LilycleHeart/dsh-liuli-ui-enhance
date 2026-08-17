/**
 * 自绘菜单的 16px 行首图标（与官方 itemIcon 槽位对齐：16px、label-tertiary）。
 * 简化为语义等价的单/少 path 形态，避免照抄官方数百字符 path；颜色走 currentColor，
 * 由 CSS 的 .liuli-menu-icon 控制（label-tertiary，危险项 error）。
 */

const svg = (inner: string, w = 16, h = 16): string =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`

export const ICONS = {
  /** 重命名（编辑） */
  edit: svg(`<path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`),
  /** 分叉 */
  branch: svg(`<circle cx="4" cy="3.5" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="4" cy="12.5" r="1.5" stroke="currentColor" stroke-width="1.4"/><circle cx="12" cy="3.5" r="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M4 5v6M4 3.5h6.5c.8 0 1.5.7 1.5 1.5v3" stroke="currentColor" stroke-width="1.4"/>`),
  /** 归档 */
  archive: svg(`<path d="M2 3h12v2H2zM3 6h10v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6z" stroke="currentColor" stroke-width="1.4"/><path d="M6 8h4" stroke="currentColor" stroke-width="1.4"/>`),
  /** 删除 */
  trash: svg(`<path d="M2.5 4h11M5.5 4V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1M4 4l.5 8a1.5 1.5 0 0 0 1.5 1.4h4A1.5 1.5 0 0 0 11.5 12l.5-8M6.5 7v3.5M9.5 7v3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`),
  /** 进行中 */
  loading: svg(`<circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.6" opacity="0.35"/><path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`),
  /** 待办 */
  checklist: svg(`<rect x="3" y="3" width="10" height="10" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 8l1.5 1.5L10.5 6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`),
  /** 已完成 */
  check: svg(`<circle cx="8" cy="8" r="6" fill="currentColor"/><path d="M5.2 8.2l1.8 1.8 3.8-4" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`),
} as const

export type MenuIconName = keyof typeof ICONS
