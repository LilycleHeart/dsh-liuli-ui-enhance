/** 琉璃主题界面设置：持久化命名空间、默认值与字段声明（同 DenpaPush 界面设置）。 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the liuli appearance section. */
export const LIULI_SETTINGS_NAMESPACE = 'liuli-theme-denpa'

/** 设置持久化键（localStorage，浏览器端；HeaderEffects 运行时读取同一键）。 */
export const DENPA_LS_KEY = 'denpa:settings'

/** 取色模式 */
export type DenpaColorMode = 'dynamic' | 'static'
/** 背景模式 */
export type DenpaBackgroundMode = 'theme' | 'brand_gradient' | 'custom' | 'image'
/** 材质类型 */
export type DenpaMaterialType = 'acrylic' | 'mica'
/** 字体模式 */
export type DenpaFontMode = 'misans' | 'builtin'
/** 壁纸适应模式 */
export type DenpaBgFit = 'cover' | 'contain' | 'stretch'
/** 壁纸自定义选区（相对原图的归一化矩形，0..1；Cover 下按窗口比例约束）。 */
export interface DenpaBgArea {
  x: number
  y: number
  w: number
  h: number
}

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
  /** 壁纸适应模式（cover 填充 / contain 适应 / stretch 拉伸）。 */
  bg_fit: DenpaBgFit
  /** 壁纸自定义选区（cover 模式下放大显示该区域，按窗口比例约束）；null 为全图。 */
  bg_area: DenpaBgArea | null
  /** 声纹响应灵敏度：连续响应的参考响度（ENV_REF，0.05-0.5，越小越灵敏）。 */
  vp_sensitivity: number
  /** 声纹鼓点强度：脉冲振幅倍率加成（PUNCH_GAIN，峰值 ×(1+gain)）。 */
  vp_beat_gain: number
  /** 声纹脉冲长度：脉冲包络指数衰减（PUNCH_DECAY，越大脉冲越长）。 */
  vp_beat_decay: number
  /** 声纹节拍灵敏度：能量超均值倍数（BEAT_MULT，越大越难触发）。 */
  vp_beat_mult: number
  /** 声纹低频脉冲灵敏度：低频能量超均值倍数（PULSE_MULT，越大越难触发）。 */
  vp_pulse_mult: number
  /** 声纹低频频段权重（0-100，与中/高频归一为驱动权重）。 */
  vp_bass_weight: number
  /** 声纹中频频段权重（0-100）。 */
  vp_mid_weight: number
  /** 声纹高频频段权重（0-100）。 */
  vp_high_weight: number
  /** 声纹节拍冷却（ms，官方 200，越小触发密度越高）。 */
  vp_beat_cooldown: number
  /** 声纹低频脉冲冷却（ms，官方 220）。 */
  vp_pulse_cooldown: number
  /** 声纹响应速度（0-100：频段包络攻速，越大越跟手；释放按攻速 1/6 跟随）。 */
  vp_env_speed: number
  /** 声纹频谱平滑度（绘制纹理一阶低通系数，越小越锐利但可能抖）。 */
  vp_spec_smooth: number
  /** 声纹静音门限（低于此电平的频段驱动归零，越大静音/底噪时越安静）。 */
  vp_noise_gate: number
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
  bg_fit: 'cover',
  bg_area: null,
  vp_sensitivity: 0.15,
  vp_beat_gain: 1.2,
  vp_beat_decay: 0.96,
  vp_beat_mult: 1.5,
  vp_pulse_mult: 0.8,
  vp_bass_weight: 40,
  vp_mid_weight: 35,
  vp_high_weight: 25,
  vp_beat_cooldown: 200,
  vp_pulse_cooldown: 220,
  vp_env_speed: 50,
  vp_spec_smooth: 0.3,
  vp_noise_gate: 0.025,
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
  bg_fit: z.union(['cover', 'contain', 'stretch']).default('cover'),
  // bg_area 为可选对象（null 表示全图），这里用 unknown 占位避免被 schema 过滤掉。
  bg_area: z.any(),
  vp_sensitivity: z.number().default(0.15),
  vp_beat_gain: z.number().default(1.2),
  vp_beat_decay: z.number().default(0.96),
  vp_beat_mult: z.number().default(1.5),
  vp_pulse_mult: z.number().default(0.8),
  vp_bass_weight: z.number().default(40),
  vp_mid_weight: z.number().default(35),
  vp_high_weight: z.number().default(25),
  vp_beat_cooldown: z.number().default(200),
  vp_pulse_cooldown: z.number().default(220),
  vp_env_speed: z.number().default(50),
  vp_spec_smooth: z.number().default(0.3),
  vp_noise_gate: z.number().default(0.025),
}) as unknown as z<DenpaSettings>

/** 合并任意部分值到完整设置（读侧防御）。 */
export function denpaSettingsOf(value: unknown): DenpaSettings {
  const v = (value ?? {}) as Partial<DenpaSettings>
  return {
    ...DENPA_SETTINGS_DEFAULTS,
    ...(typeof v === 'object' ? v : {}),
  }
}
