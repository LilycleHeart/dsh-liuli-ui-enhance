/** DenpaPush M3 动态取色：源色 → M3 调色板 → DSH 令牌覆盖（照搬 dashboard app.js）。 */

import {
  argbFromHex,
  hexFromArgb,
  themeFromSourceColor,
} from '../vendor/material-color-utilities.js'

/** 默认源色 = Twitter 蓝 */
export const DENPA_DEFAULT_SOURCE = '#1d9bf0'

const SURFACE_TONES = {
  light: { appBg: 98, low: 96, mid: 94, high: 92, highest: 90 },
  dark: { appBg: 6, low: 10, mid: 12, high: 17, highest: 22 },
}
const SCRIM = { low: 0.05, mid: 0.08, high: 0.11, highest: 0.14 }

const paletteCache: Record<string, DenpaPalette> = {}

function rgbStr(hex: string): string {
  const h = hex.replace('#', '')
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`
}

function alphaComposite(fg: string, bg: string, a: number): string {
  const ph = fg.replace('#', ''), bh = bg.replace('#', '')
  const pr = parseInt(ph.slice(0, 2), 16), pg = parseInt(ph.slice(2, 4), 16), pb = parseInt(ph.slice(4, 6), 16)
  const br = parseInt(bh.slice(0, 2), 16), bg2 = parseInt(bh.slice(2, 4), 16), bb = parseInt(bh.slice(4, 6), 16)
  const r = Math.round(a * pr + (1 - a) * br)
  const g = Math.round(a * pg + (1 - a) * bg2)
  const b = Math.round(a * pb + (1 - a) * bb)
  const to = (x: number): string => x.toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** 一张 M3 派生调色板（与 dashboard derivePalette 同构）。 */
export interface DenpaPalette {
  brand: string
  onBrand: string
  surface: string
  onSurface: string
  hover: string
  pressed: string
  tint: string
  weak: string
  line: string
  secondary: string
  onSecondary: string
  secondaryContainer: string
  onSecondaryContainer: string
  tertiary: string
  tertiaryContainer: string
  onTertiaryContainer: string
  fg1: string
  fg2: string
  fg3: string
  fg4: string
  fgInverted: string
  appBg: string
  bg1: string
  bg2: string
  bg3: string
  bg4: string
  bgInv: string
  stroke1: string
  stroke2: string
  stroke3: string
  popupBg: string
  popupFg: string
  errorFg: string
  errorBg: string
}

/** 从源色派生 M3 调色板（按明暗缓存）。 */
export function denpaDerivePalette(sourceHex: string | undefined, isDark: boolean): DenpaPalette {
  const hex = sourceHex || DENPA_DEFAULT_SOURCE
  const key = hex.toLowerCase() + (isDark ? ':d' : ':l')
  const cached = paletteCache[key]
  if (cached) return cached
  const argb = argbFromHex(hex)
  const theme = themeFromSourceColor(argb)
  const s = isDark ? theme.schemes.dark : theme.schemes.light
  const tp = theme.palettes.primary
  const neutral = theme.palettes.neutral
  const nv = theme.palettes.neutralVariant
  const st = SURFACE_TONES[isDark ? 'dark' : 'light']
  const sc = (t: number): string => hexFromArgb(neutral.tone(t))
  const primaryHex = hexFromArgb(s.primary)
  const cLow = sc(st.low), cMid = sc(st.mid), cHigh = sc(st.high), cHighest = sc(st.highest)
  const pal: DenpaPalette = {
    brand: primaryHex,
    onBrand: hexFromArgb(s.onPrimary),
    surface: hexFromArgb(s.primaryContainer),
    onSurface: hexFromArgb(s.onPrimaryContainer),
    hover: hexFromArgb(tp.tone(isDark ? 76 : 44)),
    pressed: hexFromArgb(tp.tone(isDark ? 84 : 36)),
    tint: hexFromArgb(tp.tone(isDark ? 24 : 90)),
    weak: hexFromArgb(tp.tone(isDark ? 32 : 88)),
    line: hexFromArgb(tp.tone(isDark ? 48 : 60)),
    secondary: hexFromArgb(s.secondary),
    onSecondary: hexFromArgb(s.onSecondary),
    secondaryContainer: hexFromArgb(s.secondaryContainer),
    onSecondaryContainer: hexFromArgb(s.onSecondaryContainer),
    tertiary: hexFromArgb(s.tertiary),
    tertiaryContainer: hexFromArgb(s.tertiaryContainer),
    onTertiaryContainer: hexFromArgb(s.onTertiaryContainer),
    fg1: hexFromArgb(s.onSurface),
    fg2: hexFromArgb(s.onSurfaceVariant),
    fg3: hexFromArgb(nv.tone(isDark ? 66 : 40)),
    fg4: hexFromArgb(s.outlineVariant),
    fgInverted: hexFromArgb(s.inverseOnSurface),
    appBg: sc(st.appBg),
    bg1: alphaComposite(primaryHex, cLow, SCRIM.low),
    bg2: alphaComposite(primaryHex, cMid, SCRIM.mid),
    bg3: alphaComposite(primaryHex, cHigh, SCRIM.high),
    bg4: alphaComposite(primaryHex, cHighest, SCRIM.highest),
    bgInv: hexFromArgb(s.inverseSurface),
    stroke1: hexFromArgb(s.outline),
    stroke2: hexFromArgb(s.outlineVariant),
    stroke3: isDark ? hexFromArgb(nv.tone(40)) : hexFromArgb(nv.tone(90)),
    popupBg: isDark ? sc(st.high) : sc(st.highest),
    popupFg: hexFromArgb(s.onSurface),
    errorFg: hexFromArgb(s.error),
    errorBg: hexFromArgb(s.errorContainer),
  }
  paletteCache[key] = pal
  return pal
}

/** 把 M3 调色板映射为 DSH 令牌（body 内联变量，覆盖静态 denpa.css）。 */
export function denpaApplyBrand(pal: DenpaPalette, isDark: boolean): void {
  const body = document.body
  const set = (k: string, v: string): void => { body.style.setProperty(k, v) }
  const unset = (k: string): void => { body.style.removeProperty(k) }
  const mix = (color: string, pct: number): string => `color-mix(in srgb, ${color} ${pct}%, transparent)`

  // 品牌
  set('--dsw-alias-brand-primary', pal.brand)
  set('--dsw-alias-brand-primary-new-colorprimary-new-color', pal.brand)
  set('--dsw-alias-button-primary-fill', pal.brand)
  set('--dsw-alias-button-primary-hover', pal.hover)
  set('--dsw-alias-button-primary-dimmed', mix(pal.brand, 14))
  set('--dsw-alias-button-info-fill', pal.brand)
  set('--dsw-alias-button-info-hover', pal.hover)
  set('--dsw-alias-state-business-primary', pal.brand)
  set('--dsw-alias-state-business-tertiary', pal.surface)
  set('--dsw-alias-interactive-bg-hover', mix(pal.brand, 7))
  set('--dsw-alias-interactive-bg-hover-accent', mix(pal.brand, 12))
  set('--dsw-alias-interactive-bg-active', mix(pal.brand, 16))
  set('--dsw-specific-bubble', pal.surface)
  set('--dsw-specific-bubble-highlight', pal.weak)
  set('--dsw-specific-sidebar-nav-item-active', pal.surface)
  set('--dsw-specific-sidebar-nav-item-active-accent', pal.onSurface)
  set('--dsw-specific-sidebar-nav-item-hover', mix(pal.brand, 10))

  // 背景
  set('--dsw-alias-bg-base', pal.appBg)
  set('--dsw-alias-bg-layer-1', pal.bg1)
  set('--dsw-alias-bg-layer-2', pal.bg2)
  set('--dsw-alias-bg-layer-3', pal.bg3)
  set('--dsw-alias-bg-overlay', pal.popupBg)
  set('--dsw-alias-bg-module-platform', pal.bg1)
  set('--dsw-alias-bg-multi-select', pal.bg2)
  set('--dsw-alias-bg-skeleton', isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)')
  set('--dsw-specific-selector', pal.bg2)
  set('--dsw-specific-tip', 'rgba(var(--denpa-acrylic-rgb), 0.5)')
  set('--dsw-specific-input-major', 'rgba(var(--denpa-acrylic-rgb), 0.22)')
  set('--dsw-specific-login-input', pal.appBg)

  // 描边
  set('--dsw-alias-border-l1', pal.stroke3)
  set('--dsw-alias-border-l2-darkmode-thin', pal.stroke2)
  set('--dsw-alias-border-l2', pal.stroke2)
  set('--dsw-alias-border-l3', pal.stroke1)
  set('--dsw-alias-border-l4', pal.stroke1)

  // 文字
  set('--dsw-alias-label-primary', pal.fg1)
  set('--dsw-alias-label-secondary', pal.fg2)
  set('--dsw-alias-label-tertiary', pal.fg3)
  set('--dsw-alias-label-caption', pal.fg3)
  set('--dsw-alias-label-dimmed', pal.fg4)
  set('--dsw-alias-label-primary-bluish', pal.fg1)
  set('--dsw-alias-label-primary-dimmed', pal.fg2)
  set('--dsw-alias-label-primary-foreground', pal.onBrand)
  set('--dsw-alias-label-primary-inverted', pal.fgInverted)
  set('--dsw-alias-brand-text', pal.fg1)
  set('--dsw-alias-brand-primary-invert', pal.bgInv)

  // 按钮/浮层
  set('--dsw-alias-button-contrast-fill', pal.secondary)
  set('--dsw-alias-button-elevated-fill', pal.bg1)
  set('--dsw-alias-button-floating-fill', pal.bg1)
  set('--dsw-alias-button-floating-hover', pal.bg2)
  set('--dsw-alias-button-ghost-active-fill', pal.bg2)
  set('--dsw-alias-button-ghost-active-hover', pal.bg3)
  set('--dsw-alias-button-ghost-active-border', pal.stroke1)
  set('--dsw-alias-toast-bg', pal.bgInv)
  set('--dsw-alias-tooltip-bg', pal.bgInv)
  set('--dsw-alias-bg-mask-drop', isDark ? 'rgba(39,39,48,0.7)' : 'rgba(255,255,255,0.7)')

  // Markdown 表面
  set('--dsw-alias-markdown-code-block', pal.bg1)
  set('--dsw-alias-markdown-code-block-banner', pal.bg1)
  set('--dsw-alias-markdown-inline-code', pal.bg1)
  set('--dsw-alias-markdown-tag', pal.bg1)
  set('--dsw-alias-markdown-citation', pal.bg1)
  set('--dsw-alias-markdown-placeholder', pal.bg1)
  set('--dsw-alias-markdown-code-segment-selected', pal.bg2)
  set('--dsw-alias-markdown-code-segment-unselected', pal.bg1)

  // 滚动条
  set('--dsw-alias-scrollbar-bg-l1', pal.bg3)
  set('--dsw-alias-scrollbar-bg-l2', pal.bg4)
  set('--dsw-alias-scrollbar-hover-l1', pal.bg4)
  set('--dsw-alias-scrollbar-hover-l2', pal.stroke1)

  // 状态（错误走 M3 error；成功/警告保持静态）
  set('--dsw-alias-state-error-primary', pal.errorFg)
  set('--dsw-alias-state-error-secondary', pal.errorFg)

  // 亚克力 RGB（随 M3 表面色动态变化）
  set('--denpa-acrylic-rgb', rgbStr(pal.bg2))
  set('--denpa-acrylic-rgb-low', rgbStr(pal.bg1))
  set('--denpa-acrylic-rgb-high', rgbStr(pal.bg4))
  set('--denpa-control-rgb', rgbStr(pal.bg3))
  void unset
}

/** 清空品牌覆盖（回到 denpa.css 静态令牌）。 */
export function denpaClearBrand(): void {
  const names = [
    '--dsw-alias-brand-primary', '--dsw-alias-brand-primary-new-colorprimary-new-color',
    '--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover', '--dsw-alias-button-primary-dimmed',
    '--dsw-alias-button-info-fill', '--dsw-alias-button-info-hover',
    '--dsw-alias-state-business-primary', '--dsw-alias-state-business-tertiary',
    '--dsw-alias-interactive-bg-hover', '--dsw-alias-interactive-bg-hover-accent', '--dsw-alias-interactive-bg-active',
    '--dsw-specific-bubble', '--dsw-specific-bubble-highlight',
    '--dsw-specific-sidebar-nav-item-active', '--dsw-specific-sidebar-nav-item-active-accent',
    '--dsw-specific-sidebar-nav-item-hover',
    '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
    '--dsw-alias-bg-overlay', '--dsw-alias-bg-module-platform', '--dsw-alias-bg-multi-select', '--dsw-alias-bg-skeleton',
    '--dsw-specific-selector', '--dsw-specific-tip', '--dsw-specific-input-major', '--dsw-specific-login-input',
    '--dsw-alias-border-l1', '--dsw-alias-border-l2-darkmode-thin', '--dsw-alias-border-l2', '--dsw-alias-border-l3',
    '--dsw-alias-border-l4',
    '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-caption',
    '--dsw-alias-label-dimmed', '--dsw-alias-label-primary-bluish', '--dsw-alias-label-primary-dimmed',
    '--dsw-alias-label-primary-foreground', '--dsw-alias-label-primary-inverted',
    '--dsw-alias-brand-text', '--dsw-alias-brand-primary-invert',
    '--dsw-alias-button-contrast-fill', '--dsw-alias-button-elevated-fill', '--dsw-alias-button-floating-fill',
    '--dsw-alias-button-floating-hover', '--dsw-alias-button-ghost-active-fill', '--dsw-alias-button-ghost-active-hover',
    '--dsw-alias-button-ghost-active-border', '--dsw-alias-toast-bg', '--dsw-alias-tooltip-bg', '--dsw-alias-bg-mask-drop',
    '--dsw-alias-markdown-code-block', '--dsw-alias-markdown-code-block-banner', '--dsw-alias-markdown-inline-code',
    '--dsw-alias-markdown-tag', '--dsw-alias-markdown-citation', '--dsw-alias-markdown-placeholder',
    '--dsw-alias-markdown-code-segment-selected', '--dsw-alias-markdown-code-segment-unselected',
    '--dsw-alias-scrollbar-bg-l1', '--dsw-alias-scrollbar-bg-l2', '--dsw-alias-scrollbar-hover-l1',
    '--dsw-alias-scrollbar-hover-l2', '--dsw-alias-state-error-primary', '--dsw-alias-state-error-secondary',
    '--denpa-acrylic-rgb', '--denpa-acrylic-rgb-low', '--denpa-acrylic-rgb-high', '--denpa-control-rgb',
  ]
  for (const name of names) document.body.style.removeProperty(name)
}