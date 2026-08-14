/**
 * 琉璃主题（liuli-theme）浏览器半 —— DenpaPush 风格界面主题的完整实现：
 *
 *  1. 注入主题样式（denpa.css 字符串，<style> 幂等挂载；覆盖 --dsw-* 语义令牌
 *     为电波推送 M3 配色，亮/暗双主题，含字体、圆角、材质、泛光、滚动条等）；
 *  2. 设置页「界面」分区（settings.section，16 项设置 localStorage 持久化）；
 *  3. DenpaPush 运行时：壁纸上传/取色（material-color-utilities 动态 M3 调色）、
 *     材质/字体/圆角/泛光/阴影/暗色遮罩应用（含 isDark 竞态与 seq 令牌保护）；
 *  4. 日/夜主题切换事件桥（startViewTransition 圆形遮罩，--vt-* 变量带坐标）；
 *  5. 会话 header 效果：声纹 canvas 背景、系统音频监听、主题切换按钮、
 *     垂直拉伸手柄（经 conversation.session.header.* slots 注入）。
 *
 * 依赖宿主主题服务（@deepseek-ai/dsh-client-ui-theme 的 ctx.theme）：偏好持久化、
 * presenter 应用与 theme/change 事件均由该服务承担，本插件只消费。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the theme service's Context merge (ctx.theme + theme/change).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-conversation's header slots + ui-settings' section slot names.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the input-trigger source roster (element picker reference chip codec).
import type { InputTriggerSource, ReferenceCodec } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { DenpaAppearanceSection, type DenpaAppearanceInjected } from './DenpaAppearance.tsx'
import { createDenpaStore } from './denpa-store.ts'
import {
  clearWallpaper, loadWallpaper, compressImage, saveWallpaper,
  applyDenpaSettings,
} from './denpa-runtime.ts'
import {
  DENPA_SETTINGS_DEFAULTS, denpaSettingsOf,
  type DenpaSettings,
} from '../denpa-settings.ts'
import { en, zh, type DenpaAppearanceKey } from './locales.ts'
import { denpaCss } from './denpa-css.ts'
import {
  DenpaHeaderVoiceprint, DenpaHeaderChrome, DenpaHeaderResizer,
} from './HeaderEffects.tsx'
import { createElement } from 'react'
import { FloatBall } from './FloatBall.tsx'
import { createRoot } from 'react-dom/client'
import { formatSelection, type PickedElement } from './element-picker.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** DenpaPush 界面设置 section 的文案。 */
    'denpa-appearance': DenpaAppearanceKey
  }
}

/** DenpaPush 设置 section 的文案命名空间。 */
export const DENPA_LOCALE_NS = 'denpa-appearance'

/** 主题样式注入的 <style> id（幂等：重复 apply 不叠加）。 */
const STYLE_ID = 'liuli-theme-css'
/** 设置持久化键（localStorage，随浏览器持久化）。 */
const DENPA_LS_KEY = 'denpa:settings'

/** Required services: slots/locale for the settings section, theme for the toggle bridge. */
export const inject = ['slots', 'locale', 'theme', 'sessions', 'conversation', 'inputTriggers']

/** 宽边模式样式：对话信息区在宽屏下撑满可用宽度（提高左右空间利用率）。 */
const WIDE_MODE_CSS = [
  '/* 宽边模式：覆盖会话列的内容宽度轴（--dsh-chat-content-width 定义于会话 root） */',
  "body[data-liuli-wide] [data-phase] {",
  "  --dsh-chat-content-width: min(1280px, calc(100% - 160px));",
  "}",
].join('\n')

/** 解析元素选择器引用（ui-preview 同构：ref = JSON.stringify(PickedElement)）。 */
function parseLiuliRef(raw: string): PickedElement {
  try {
    const parsed = JSON.parse(raw) as PickedElement
    if (parsed !== null && typeof parsed === 'object' && typeof parsed.selector === 'string') return parsed
  } catch (_) { /* 损坏则回落 */ }
  return { tag: 'element', selector: raw, attributes: '', text: '', rect: { x: 0, y: 0, width: 0, height: 0 }, color: '', background: '', font: '' }
}

/** 注入主题样式（幂等；已存在则跳过）。 */
function injectThemeCss(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.setAttribute('data-liuli-theme', '')
  style.textContent = denpaCss + '\n' + WIDE_MODE_CSS
  document.head.appendChild(style)
}

/**
 * Client plugin body: mount the theme, the Denpa UI settings section,
 * the runtime + toggle bridge, and the session header effects.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  injectThemeCss()

  // ── 元素选择器：选中元素作为引用 chip 插入当前会话输入框 ──
  const codec: ReferenceCodec = {
    clipboardText: ref => parseLiuliRef(ref).selector,
    serialize: ref => Promise.resolve(formatSelection(parseLiuliRef(ref))),
  }
  const source: InputTriggerSource = {
    trigger: '@',
    name: 'liuli-picker',
    candidates: () => Promise.resolve([]),
    onPick: () => undefined,
    codec,
  }
  ctx.effect(() => ctx.inputTriggers.registerSource(source), 'liuli-theme: element picker source')
  const insertElement = (info: PickedElement): void => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === undefined) return
    const actx = ctx.sessions.scope(current)
    if (actx === undefined) return
    const input = ctx.conversation.input.for(actx)
    const state = input.state.getSnapshot()
    const span = { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev }
    input.insertReference({
      source: 'liuli-picker',
      ref: JSON.stringify(info),
      label: '元素: <' + info.tag + '> ' + info.selector,
      clipboardText: info.selector,
    }, span)
  }

  // ── 常驻悬浮圆点工具窗（fixed 全局置顶，独立 React root）──
  ctx.effect(() => {
    const host = document.createElement('div')
    host.id = 'liuli-floatball-host'
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(createElement(FloatBall, { insertElement }))
    return () => {
      root.unmount()
      host.remove()
    }
  }, 'liuli-theme: float ball mount')

  ctx.effect(() => ctx.locale.register(DENPA_LOCALE_NS, { zh, en }), 'liuli-theme: denpa dictionaries')

  // ── DenpaPush 界面设置：localStorage 持久化 + 运行时应用 ──
  const denpaStore = createDenpaStore()
  const denpaT = ctx.locale.bind(DENPA_LOCALE_NS)
  let denpaBound: BoundActions<typeof denpaStore> | undefined
  let denpaRev = 0
  const readDenpaSettings = (): DenpaSettings => {
    try {
      const raw = localStorage.getItem(DENPA_LS_KEY)
      if (raw) return denpaSettingsOf(JSON.parse(raw))
    } catch (_) { /* 损坏则回落默认 */ }
    return DENPA_SETTINGS_DEFAULTS
  }
  const writeDenpaSettings = (value: DenpaSettings): void => {
    try { localStorage.setItem(DENPA_LS_KEY, JSON.stringify(value)) } catch (_) {}
  }
  const syncDenpa = (value: DenpaSettings): void => {
    denpaRev += 1
    denpaBound?.syncSettings(value, denpaRev)
  }
  const denpaInjected = (actions: BoundActions<typeof denpaStore>): DenpaAppearanceInjected => {
    denpaBound = actions
    denpaBound.syncWallpaper(loadWallpaper())
    denpaBound.syncSettings(readDenpaSettings(), denpaRev)
    return {
      save: (patch) => {
        const next = { ...readDenpaSettings(), ...patch }
        writeDenpaSettings(next)
        syncDenpa(next)
        void applyDenpaSettings(next)
      },
      reset: () => {
        writeDenpaSettings(DENPA_SETTINGS_DEFAULTS)
        clearWallpaper()
        denpaBound?.syncWallpaper(null)
        syncDenpa(DENPA_SETTINGS_DEFAULTS)
        void applyDenpaSettings(DENPA_SETTINGS_DEFAULTS)
      },
      uploadWallpaper: async (file) => {
        const dataUrl = await compressImage(file)
        saveWallpaper(dataUrl)
        // DenpaPush 原版行为：上传后自动切换到壁纸背景模式（动态取色随之生效）
        const current = readDenpaSettings()
        const next = current.background_mode === 'image' ? current : { ...current, background_mode: 'image' as const }
        writeDenpaSettings(next)
        syncDenpa(next)
        denpaBound?.syncWallpaper(dataUrl)
        void applyDenpaSettings(next)
      },
      removeWallpaper: () => {
        clearWallpaper()
        denpaBound?.syncWallpaper(null)
        // 移除后若处于壁纸模式，回到跟随主题
        const current = readDenpaSettings()
        if (current.background_mode === 'image') {
          const next = { ...current, background_mode: 'theme' as const }
          writeDenpaSettings(next)
          syncDenpa(next)
          void applyDenpaSettings(next)
        } else {
          void applyDenpaSettings(current)
        }
      },
    }
  }
  // 初始应用：默认值 + 壁纸立即生效；主题切换时按新明暗重算调色板。
  const denpaBoot = readDenpaSettings()
  void applyDenpaSettings(denpaBoot)
  ctx.on('theme/change', () => { void applyDenpaSettings(readDenpaSettings()) })
  // 启动时序兜底：boot 时 body 的 data-ds-dark-theme 可能尚未被 presenter 应用
  // （插件加载顺序不定），isDark 误判会把亮色板落到暗色主题上（气泡等颜色"对调"），
  // 且之后若无新的 theme/change 事件就无人纠正。监听 body 属性变化，一旦 presenter
  // 应用/切换主题就按最新明暗重新应用调色板（幂等，低频触发）。
  ctx.effect(() => {
    const mo = new MutationObserver(() => { void applyDenpaSettings(readDenpaSettings()) })
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => { mo.disconnect() }
  }, 'liuli-theme: body theme observer')

  // ── DenpaPush 日/夜切换事件桥：header 主题按钮 dispatch，这里走正式路径 ──
  // 照搬原项目：startViewTransition 圆形遮罩（--vt-* 变量由按钮带坐标）。
  ctx.effect(() => {
    /** startViewTransition 圆形遮罩（--vt-* 变量由触发点带坐标）。 */
    const transitionTo = (id: string, x?: number, y?: number): void => {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const cx = x ?? window.innerWidth / 2
      const cy = y ?? window.innerHeight / 2
      const r = Math.hypot(Math.max(cx, window.innerWidth - cx), Math.max(cy, window.innerHeight - cy))
      const root = document.documentElement
      root.style.setProperty('--vt-x', cx + 'px')
      root.style.setProperty('--vt-y', cy + 'px')
      root.style.setProperty('--vt-r', r + 'px')
      const apply = (): void => { ctx.theme.setTheme(id) }
      if (typeof document.startViewTransition === 'function' && !reduce) {
        document.startViewTransition(apply)
      } else {
        apply()
      }
    }
    const onToggleTheme = (e: Event): void => {
      const detail = (e as CustomEvent<{ x: number; y: number }>).detail
      const current = document.body.hasAttribute('data-ds-dark-theme') ? 'dark' : 'light'
      transitionTo(current === 'dark' ? 'light' : 'dark', detail?.x, detail?.y)
    }
    // 设置页 AppearanceRow：直接指定目标主题（light/dark/system）+ 点击坐标
    const onSetTheme = (e: Event): void => {
      const detail = (e as CustomEvent<{ id: string; x: number; y: number }>).detail
      if (detail?.id === undefined) return
      transitionTo(detail.id, detail.x, detail.y)
    }
    // 桥接就绪标记：shell 的 AppearanceRow 据此决定走事件（圆形遮罩）
    // 还是降级直连（插件未启用时）。
    ;(window as unknown as { __liuliThemeBridge__?: boolean }).__liuliThemeBridge__ = true
    window.addEventListener('denpa:toggle-theme', onToggleTheme)
    window.addEventListener('denpa:set-theme', onSetTheme)
    return () => {
      ;(window as unknown as { __liuliThemeBridge__?: boolean }).__liuliThemeBridge__ = false
      window.removeEventListener('denpa:toggle-theme', onToggleTheme)
      window.removeEventListener('denpa:set-theme', onSetTheme)
    }
  }, 'liuli-theme: denpa theme toggle bridge')

  // ── 设置页「界面」分区 ──
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'denpa-appearance',
    order: 30,
    label: () => denpaT('nav'),
    store: denpaStore,
    locale: DENPA_LOCALE_NS,
    inject: denpaInjected,
  }, DenpaAppearanceSection))

  // ── 会话 header 效果（声纹/监听/主题切换/拉伸手柄）──
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'liuli-voiceprint',
    order: 10,
  }, DenpaHeaderVoiceprint))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'liuli-header-chrome',
    order: 10,
  }, DenpaHeaderChrome))
  ctx.slots.inject('conversation.session.header.tabs', () => ctx.slots.register({
    name: 'conversation.session.header.tabs',
    id: 'liuli-header-resizer',
    order: 10,
  }, DenpaHeaderResizer))
}
