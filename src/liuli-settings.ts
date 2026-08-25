/** 琉璃主题界面设置：持久化命名空间、默认值与字段声明（同 琉璃 界面设置）。 */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the liuli appearance section. */
export const LIULI_SETTINGS_NAMESPACE = 'liuli-theme'

/** 设置持久化键（localStorage，浏览器端；HeaderEffects 运行时读取同一键）。 */
export const LIULI_LS_KEY = 'liuli:settings'

/** 取色模式 */
export type LiuliColorMode = 'dynamic' | 'static'
/** 状态色模式：hardcoded=静态内置色；mcu=从 MCU 多角色色板取色 */
export type LiuliStatusColorMode = 'hardcoded' | 'mcu'
/** 背景模式 */
export type LiuliBackgroundMode = 'theme' | 'brand_gradient' | 'custom' | 'image'
/** 材质类型（云母已彻底移除，仅保留亚克力；schema 仍解析旧值 `mica` 但统一按亚克力渲染）。 */
export type LiuliMaterialType = 'acrylic'
/** 字体模式 */
export type LiuliFontMode = 'misans' | 'builtin'
/** 会话切换/新消息入场动画效果（none 关闭；stagger* 为级联入场）。 */
export type LiuliTransitionEffect =
  | 'fade' | 'rise' | 'drop' | 'slide' | 'zoom' | 'blur' | 'spring'
  | 'stagger' | 'staggerRise' | 'none'
/** 壁纸适应模式 */
export type LiuliBgFit = 'cover' | 'contain' | 'stretch'
/** 壁纸自定义选区（相对原图的归一化矩形，0..1；Cover 下按窗口比例约束）。 */
export interface LiuliBgArea {
  x: number
  y: number
  w: number
  h: number
}

/** 琉璃界面设置（全部字段）。 */
export interface LiuliSettings {
  color_mode: LiuliColorMode
  /** 状态色来源：hardcoded 使用内置静态色；mcu 从 MCU 多角色色板取色。 */
  status_color_mode: LiuliStatusColorMode
  brand_color: string
  background_mode: LiuliBackgroundMode
  custom_background: string
  custom_background_dark: string
  bg_scrim: number
  acrylic_enabled: boolean
  material_type: LiuliMaterialType
  material_opacity: number
  material_blur: number
  font_mode: LiuliFontMode
  corner_radius: number
  glow_enabled: boolean
  glow_intensity: number
  shadow_enabled: boolean
  shadow_intensity: number
  /** 宽边模式：对话信息区在宽屏下撑满可用宽度（提高空间利用率）。 */
  wide_mode: boolean
  /** 面板留白（px）：侧栏/会话/详情三列与窗口边缘之间的内边距（0-16）。 */
  dock_padding: number
  /** 壁纸适应模式（cover 填充 / contain 适应 / stretch 拉伸）。 */
  bg_fit: LiuliBgFit
  /** 壁纸自定义选区（cover 模式下放大显示该区域，按窗口比例约束）；null 为全图。 */
  bg_area: LiuliBgArea | null
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
  /** 会话切换/新消息入场动画（'rise' 默认；'none' 关闭）。 */
  transition_effect: LiuliTransitionEffect
  /** 自动驱动侧边栏浏览器（LLM 活动感知）：模型启动 dev server / 写前端文件时
   *  自动在右侧边栏打开浏览器标签展示页面（auto-drive-browser.ts）。 */
  auto_drive_browser: boolean
  /** 非官方增强总开关：关闭后仅保留官方扩展点功能（主题/声纹/设置页），
   *  全部非官方（侵入式/观察式）功能不挂载，用于与其它插件冲突时一键降级。 */
  unofficial_enabled: boolean
  /** Dockable 布局改造：advanced 模式接管宿主 root slot（三栏可拖拽/拆分/浮动）、
   *  会话页头独立面板、conversation-split、桌面 shell 别名类挂载。 */
  unofficial_layout: boolean
  /** 桌面宿主补丁：自动补丁 DSH Desktop（无边框 / 内嵌 webviewTag）、页面内窗口按钮、
   *  /liuli-window 窗口控制路由、系统回环音频授权；关闭时自动还原已打的补丁
   *  （原生标题栏回归）。 */
  unofficial_desktop: boolean
  /** 右侧边栏（详细页）：PreviewDetailsPanel（文件树/Git/Wiki/浏览器/终端/代码/审查等
   *  全部标签）、header 预览按钮、详细页自动展开等附属功能。 */
  unofficial_sidebar: boolean
  /** 内嵌浏览器：Host 浏览器引擎（WebContentsView / webview）、侧栏浏览器标签、
   *  模型活动自动驱动浏览器。 */
  unofficial_browser: boolean
  /** DOM 观察增强：悬浮球、自动展开、入场动画、会话标记/右键菜单、重命名、
   *  缩放性能护栏、/side /btw 等基于 DOM 观察或自有 overlay 的增强。 */
  unofficial_dom: boolean
}

/** 默认设置（与 琉璃 界面设置一致）。 */
export const LIULI_SETTINGS_DEFAULTS: LiuliSettings = {
  color_mode: 'dynamic',
  status_color_mode: 'mcu',
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
  dock_padding: 8,
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
  transition_effect: 'rise',
  auto_drive_browser: true,
  unofficial_enabled: true,
  unofficial_layout: true,
  unofficial_desktop: true,
  unofficial_sidebar: true,
  unofficial_browser: true,
  unofficial_dom: true,
}

/** 持久化 schema（浏览器 scope 复用同一描述）。 */
export const LiuliSettingsSchema: z<LiuliSettings> = z.object({
  color_mode: z.union(['dynamic', 'static']).default('dynamic'),
  status_color_mode: z.union(['hardcoded', 'mcu']).default('mcu'),
  brand_color: z.string().default('#1d9bf0'),
  background_mode: z.union(['theme', 'brand_gradient', 'custom', 'image']).default('theme'),
  custom_background: z.string().default('#F5F6F8'),
  custom_background_dark: z.string().default('#0C0E13'),
  bg_scrim: z.number().default(40),
  acrylic_enabled: z.boolean().default(true),
  // material_type 仅保留 acrylic 作为新值；mica 保留在 union 中以便旧设置可被解析，
  // 但运行时已不再按 mica 渲染（统一按亚克力处理）。
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
  dock_padding: z.number().default(8),
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
  transition_effect: z.union([
    'fade', 'rise', 'drop', 'slide', 'zoom', 'blur', 'spring', 'stagger', 'staggerRise', 'none',
  ]).default('rise'),
  auto_drive_browser: z.boolean().default(true),
  // 非官方增强开关（兼容其它插件）：默认全部开启（行为不变）；关闭后相应功能不挂载。
  unofficial_enabled: z.boolean().default(true),
  unofficial_layout: z.boolean().default(true),
  unofficial_desktop: z.boolean().default(true),
  unofficial_sidebar: z.boolean().default(true),
  unofficial_browser: z.boolean().default(true),
  unofficial_dom: z.boolean().default(true),
}) as unknown as z<LiuliSettings>

/** 合并任意部分值到完整设置（读侧防御）。 */
export function liuliSettingsOf(value: unknown): LiuliSettings {
  const v = (value ?? {}) as Partial<LiuliSettings>
  return {
    ...LIULI_SETTINGS_DEFAULTS,
    ...(typeof v === 'object' ? v : {}),
  }
}
