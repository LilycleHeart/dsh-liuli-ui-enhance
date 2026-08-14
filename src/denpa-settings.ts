/** 琉璃主题界面设置：持久化命名空间、默认值与字段声明（同 DenpaPush 界面设置）。 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the liuli appearance section. */
export const LIULI_SETTINGS_NAMESPACE = 'liuli-theme-denpa'

/** 取色模式 */
export type DenpaColorMode = 'dynamic' | 'static'
/** 背景模式 */
export type DenpaBackgroundMode = 'theme' | 'brand_gradient' | 'custom' | 'image'
/** 材质类型 */
export type DenpaMaterialType = 'acrylic' | 'mica'
/** 字体模式 */
export type DenpaFontMode = 'misans' | 'builtin'

/** 琉璃界面设置（全部字段）。 */
export interface DenpaSettings {
  color_mode: DenpaColorMode
  brand_color: string
  background_mode: DenpaBackgroundMode
  custom_background: string
  custom_background_dark: string
  bg_scrim: number
  acrylic_enabled: boolean
  material_type: DenpaMaterialType
  material_opacity: number
  material_blur: number
  font_mode: DenpaFontMode
  corner_radius: number
  glow_enabled: boolean
  glow_intensity: number
  shadow_enabled: boolean
  shadow_intensity: number
  /** 宽边模式：对话信息区在宽屏下撑满可用宽度（提高空间利用率）。 */
  wide_mode: boolean
}

/** 默认设置（与 DenpaPush 界面设置一致）。 */
export const DENPA_SETTINGS_DEFAULTS: DenpaSettings = {
  color_mode: 'dynamic',
  brand_color: '#1d9bf0',
  background_mode: 'theme',
  custom_background: '#F5F6F8',
  custom_background_dark: '#0C0E13',
  bg_scrim: 40,
  acrylic_enabled: true,
  material_type: 'acrylic',
  material_opacity: 45,
  material_blur: 5,
  font_mode: 'misans',
  corner_radius: 14,
  glow_enabled: true,
  glow_intensity: 15,
  shadow_enabled: true,
  shadow_intensity: 60,
  wide_mode: false,
}

/** 持久化 schema（浏览器 scope 复用同一描述）。 */
export const DenpaSettingsSchema: z<DenpaSettings> = z.object({
  color_mode: z.union(['dynamic', 'static']).default('dynamic'),
  brand_color: z.string().default('#1d9bf0'),
  background_mode: z.union(['theme', 'brand_gradient', 'custom', 'image']).default('theme'),
  custom_background: z.string().default('#F5F6F8'),
  custom_background_dark: z.string().default('#0C0E13'),
  bg_scrim: z.number().default(40),
  acrylic_enabled: z.boolean().default(true),
  material_type: z.union(['acrylic', 'mica']).default('acrylic'),
  material_opacity: z.number().default(45),
  material_blur: z.number().default(5),
  font_mode: z.union(['misans', 'builtin']).default('misans'),
  corner_radius: z.number().default(14),
  glow_enabled: z.boolean().default(true),
  glow_intensity: z.number().default(15),
  shadow_enabled: z.boolean().default(true),
  shadow_intensity: z.number().default(60),
  wide_mode: z.boolean().default(false),
}) as unknown as z<DenpaSettings>

/** 合并任意部分值到完整设置（读侧防御）。 */
export function denpaSettingsOf(value: unknown): DenpaSettings {
  const v = (value ?? {}) as Partial<DenpaSettings>
  return {
    ...DENPA_SETTINGS_DEFAULTS,
    ...(typeof v === 'object' ? v : {}),
  }
}
