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
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the forwarded remote event vocabulary for ctx.remote.$on.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the theme service's Context merge (ctx.theme + theme/change).
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type { ThemePreference } from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-conversation's header slots + ui-settings' section slot names.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the layout service face (ctx.layout.openDetails/closeDetails + details slot).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: the input-trigger source roster (element picker reference chip codec).
import type { InputTriggerSource, ReferenceCodec } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { DenpaAppearanceSection, type DenpaAppearanceInjected } from './DenpaAppearance.tsx'
import { LiuliAppearanceRow, type LiuliAppearanceRowInjected } from './LiuliAppearanceRow.tsx'
import { createLiuliAppearanceStore } from './liuli-appearance-store.ts'
import { createDenpaStore } from './denpa-store.ts'
import {
  clearWallpaper, loadWallpaper, compressImage, saveWallpaper, loadImage,
  applyDenpaSettings, applyDenpaWallpaper,
} from './denpa-runtime.ts'
import {
  DENPA_LS_KEY, DENPA_SETTINGS_DEFAULTS, denpaSettingsOf,
  type DenpaBgArea, type DenpaSettings,
} from '../denpa-settings.ts'
import { en, zh, type DenpaAppearanceKey } from './locales.ts'
import { denpaCss } from './denpa-css.ts'
import {
  DenpaHeaderVoiceprint, DenpaHeaderChrome, DenpaHeaderResizer,
} from './HeaderEffects.tsx'
import { setTurnRailCommitHandler, TurnRail } from './TurnRail.tsx'
import { startDenpaTransition } from './denpa-transition.ts'
import { disposeSupplierQuota, initSupplierQuota, refreshSupplierQuota } from './supplier-quota.ts'
import { SupplierQuota } from './SupplierQuota.tsx'
import { createElement } from 'react'
import { FloatBall } from './FloatBall.tsx'
import { createRoot } from 'react-dom/client'
import { formatSelection, type PickedElement } from './element-picker.ts'
import { startElementCardDecoration } from './element-card.ts'
import { startSessionRename } from './session-rename.ts'
import { startSessionMarkerDecoration } from './session-markers.ts'
import { startSessionContextMenu } from './session-context-menu.ts'
import { startWorkspaceContextMenu } from './workspace-context-menu.ts'
import {
  PreviewDetailsPanel, PreviewButton, PREVIEW_TOGGLE_EVENT, PREVIEW_NAVIGATE_EVENT,
  resolvePreviewUrl, setPreviewOpen, togglePreviewOpen,
} from './PreviewPanel.tsx'

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
// 设置持久化键在 denpa-settings.ts 中定义（HeaderEffects 运行时读取同一键）。

/** Required services: slots/locale for the settings section, theme for the toggle bridge, connection/remote for supplier quota. */
export const inject = ['slots', 'locale', 'theme', 'layout', 'sessions', 'workspaces', 'conversation', 'inputTriggers', 'connection', 'remote']

/** 宽边模式样式：对话信息区在宽屏下撑满可用宽度（提高左右空间利用率）。 */
const WIDE_MODE_CSS = [
  '/* 宽边模式：覆盖会话列的内容宽度轴（--dsh-chat-content-width 定义于会话 root） */',
  'body[data-liuli-wide] [data-phase] {',
  '  --dsh-chat-content-width: min(1280px, calc(100% - 160px));',
  '}',
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

  // ── 会话切换/新消息入场动画：MutationObserver 挂类（动画定义在 denpa.css）──
  ctx.effect(() => startDenpaTransition(), 'liuli-theme: message transition observer')

  // ── 用户发送的网页元素：在聊天气泡里也渲染成卡片（官方只装饰 /@ chip）──
  ctx.effect(() => startElementCardDecoration(), 'liuli-theme: element card decoration')

  // ── 会话内联重命名：双击侧栏会话标题进入内联编辑（不弹菜单/对话框）──
  ctx.effect(() => startSessionRename(ctx), 'liuli-theme: session inline rename')

  // ── 会话标记：localStorage store + 会话行图标装饰 ──
  ctx.effect(() => startSessionMarkerDecoration(ctx), 'liuli-theme: session marker decoration')

  // ── 会话栏右键菜单：右键会话行弹出标记/重命名/分叉/归档（不改官方代码）──
  ctx.effect(() => startSessionContextMenu(ctx), 'liuli-theme: session context menu')

  // ── 工作区/目录行右键菜单：重命名/删除工作区（不改官方代码）──
  ctx.effect(() => startWorkspaceContextMenu(ctx), 'liuli-theme: workspace context menu')

  // ── 供应商额度：注入 connection/remote，供 header 工具区显示当前供应商额度 ──
  initSupplierQuota(ctx.get('connection') as ConnectionHandle, ctx.get('modelDirectories'))
  ctx.effect(() => () => disposeSupplierQuota(), 'liuli-theme: supplier quota dispose')
  const refreshQuota = (): void => { void refreshSupplierQuota() }
  ctx.effect(() => {
    const disposers = [
      ctx.remote.$on('llm/adapters-updated', refreshQuota),
      ctx.remote.$on('settings/document-updated', refreshQuota),
      ctx.on('connection/reset', refreshQuota),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'liuli-theme: supplier quota refresh')

  // ── 元素选择器：选中元素作为引用 chip 插入当前会话输入框 ──
  const codec: ReferenceCodec = {
    clipboardText: ref => parseLiuliRef(ref).selector,
    // 用换行包裹元素块，使其在序列化后的消息文本中独占行——否则用户在
    // chip 前后输入的文字会和 [selected element] 头行或末尾字段行粘在
    // 同一行，导致渲染时 header 匹配失败（不包卡片）或用户文字被字段
    // 正则吞进卡片。
    serialize: ref => Promise.resolve('\n' + formatSelection(parseLiuliRef(ref)) + '\n'),
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

  // ── commit 引用：点击 TurnRail 胶囊里的 commit，把 commit 号作为引用卡片插入输入框 ──
  const commitCodec: ReferenceCodec = {
    clipboardText: ref => ref,
    serialize: ref => Promise.resolve(ref),
  }
  const commitSource: InputTriggerSource = {
    trigger: '@',
    name: 'liuli-commit',
    candidates: () => Promise.resolve([]),
    onPick: () => undefined,
    codec: commitCodec,
  }
  ctx.effect(() => ctx.inputTriggers.registerSource(commitSource), 'liuli-theme: commit reference source')
  const insertCommitReference = (commit: string): void => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === undefined) return
    const actx = ctx.sessions.scope(current)
    if (actx === undefined) return
    const input = ctx.conversation.input.for(actx)
    const state = input.state.getSnapshot()
    const span = { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev }
    input.insertReference({
      source: 'liuli-commit',
      ref: commit,
      label: 'commit: ' + commit,
      clipboardText: commit,
    }, span)
  }
  setTurnRailCommitHandler(insertCommitReference)

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

  // ── 工作区预览列：header 按钮开合宿主右侧 details 列，面板占用 details slot ──
  const togglePreview = (): void => {
    const open = togglePreviewOpen()
    if (open) ctx.layout.openDetails()
    else ctx.layout.closeDetails()
    window.dispatchEvent(new CustomEvent(PREVIEW_TOGGLE_EVENT))
  }
  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    priority: -1,
    inject: () => ({
      openDetails: () => { ctx.layout.openDetails() },
      closeDetails: () => {
        setPreviewOpen(false)
        ctx.layout.closeDetails()
      },
      insertElement,
    }),
  }, PreviewDetailsPanel))

  // 切换会话时宿主会自动收起 details 列；这里同步重置预览开关，避免下次按钮反向。
  ctx.effect(() => ctx.sessions.list.subscribe(() => {
    setPreviewOpen(false)
  }), 'liuli-theme: preview open reset on session switch')

  // ── 会话内前端产物点击：拦截本地回环/前端文件链接，切换到预览浏览器模式 ──
  ctx.effect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const target = e.target as Element | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (anchor === null || anchor === undefined) return
      // 只劫持会话正文里的链接，避免影响侧栏/设置等其他区域。
      if (anchor.closest('[data-phase]') === null) return
      const href = anchor.getAttribute('href') ?? ''
      const sessionId = ctx.sessions.list.getSnapshot().current ?? undefined
      const url = resolvePreviewUrl(href, sessionId)
      if (url === undefined) return
      e.preventDefault()
      window.dispatchEvent(new CustomEvent(PREVIEW_NAVIGATE_EVENT, { detail: { url } }))
    }
    document.addEventListener('click', onDocClick, true)
    return () => { document.removeEventListener('click', onDocClick, true) }
  }, 'liuli-theme: frontend artifact preview click')

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
  // 记录上次应用选区时的窗口尺寸与选区，用于 resize 时围绕中心点按比例缩放。
  let lastViewportWidth = window.innerWidth
  let lastViewportHeight = window.innerHeight
  let lastBgArea: DenpaBgArea | null = readDenpaSettings().bg_area
  const commitDenpa = (next: DenpaSettings): void => {
    writeDenpaSettings(next)
    syncDenpa(next)
    lastBgArea = next.bg_area
    lastViewportWidth = window.innerWidth
    lastViewportHeight = window.innerHeight
    void applyDenpaSettings(next)
    // 声纹响应参数热载（HeaderEffects 监听后重读）
    window.dispatchEvent(new CustomEvent('liuli:vp-params'))
  }
  const denpaInjected = (actions: BoundActions<typeof denpaStore>): DenpaAppearanceInjected => {
    denpaBound = actions
    denpaBound.syncWallpaper(loadWallpaper())
    denpaBound.syncSettings(readDenpaSettings(), denpaRev)
    return {
      save: (patch) => {
        const next = { ...readDenpaSettings(), ...patch }
        commitDenpa(next)
      },
      reset: () => {
        writeDenpaSettings(DENPA_SETTINGS_DEFAULTS)
        clearWallpaper()
        denpaBound?.syncWallpaper(null)
        syncDenpa(DENPA_SETTINGS_DEFAULTS)
        lastBgArea = null
        lastViewportWidth = window.innerWidth
        lastViewportHeight = window.innerHeight
        void applyDenpaSettings(DENPA_SETTINGS_DEFAULTS)
      },
      uploadWallpaper: async (file) => {
        const dataUrl = await compressImage(file)
        saveWallpaper(dataUrl)
        // DenpaPush 原版行为：上传后自动切换到壁纸背景模式（动态取色随之生效）
        const current = readDenpaSettings()
        let next: DenpaSettings = current.background_mode === 'image' ? current : { ...current, background_mode: 'image' as const }
        // 首次上传且还没有自定义选区时，按窗口比例生成一个默认居中选区。
        if (current.bg_area === null) {
          try {
            const img = await loadImage(dataUrl)
            const imgRatio = img.naturalWidth / img.naturalHeight
            const winRatio = window.innerWidth / window.innerHeight
            const maxW = imgRatio > winRatio ? winRatio / imgRatio : 1
            const maxH = imgRatio > winRatio ? 1 : imgRatio / winRatio
            const scale = 0.9
            const w = maxW * scale
            const h = maxH * scale
            const bg_area: DenpaBgArea = {
              x: (1 - w) / 2,
              y: (1 - h) / 2,
              w,
              h,
            }
            next = { ...next, bg_area }
          } catch (_) { /* 取不到图片尺寸时跳过默认选区 */ }
        }
        denpaBound?.syncWallpaper(dataUrl)
        commitDenpa(next)
      },
      removeWallpaper: () => {
        clearWallpaper()
        denpaBound?.syncWallpaper(null)
        // 移除后若处于壁纸模式，回到跟随主题
        const current = readDenpaSettings()
        if (current.background_mode === 'image') {
          const next = { ...current, background_mode: 'theme' as const }
          commitDenpa(next)
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

  // 窗口尺寸变化后实时围绕选区中心点按窗口变化比例缩放，避免壁纸被拉伸。
  ctx.effect(() => {
    let raf = 0
    const onResize = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const current = readDenpaSettings()
        const vw = window.innerWidth
        const vh = window.innerHeight
        if (current.bg_area !== null && lastBgArea !== null && lastViewportWidth > 0 && lastViewportHeight > 0) {
          const scaleX = vw / lastViewportWidth
          const scaleY = vh / lastViewportHeight
          const cx = lastBgArea.x + lastBgArea.w / 2
          const cy = lastBgArea.y + lastBgArea.h / 2
          let w = lastBgArea.w * scaleX
          let h = lastBgArea.h * scaleY
          const fit = Math.min(1, 1 / w, 1 / h)
          w *= fit
          h *= fit
          w = Math.max(0.04, Math.min(1, w))
          h = Math.max(0.04, Math.min(1, h))
          const nextArea: DenpaBgArea = {
            x: Math.min(1 - w, Math.max(0, cx - w / 2)),
            y: Math.min(1 - h, Math.max(0, cy - h / 2)),
            w,
            h,
          }
          const next = { ...current, bg_area: nextArea }
          // 轻量同步：只更新壁纸层，不重新跑动态取色，避免 resize 延迟。
          writeDenpaSettings(next)
          syncDenpa(next)
          lastBgArea = next.bg_area
          lastViewportWidth = vw
          lastViewportHeight = vh
          applyDenpaWallpaper(next)
        } else {
          lastViewportWidth = vw
          lastViewportHeight = vh
          lastBgArea = current.bg_area
        }
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, 'liuli-theme: window resize reapply')

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

  // ── 设置页「外观」行：以同 id + 更低 priority 替换官方 AppearanceRow ──
  //    点击带圆形遮罩过渡（denpa:set-theme 事件桥），桥未就绪时降级直连。
  const appearanceStore = createLiuliAppearanceStore()
  let appearanceBound: BoundActions<typeof appearanceStore> | undefined
  const syncAppearance = (snapshot: { preference: ThemePreference; revision: number }): void => {
    appearanceBound?.sync(snapshot.preference, snapshot.revision)
  }
  ctx.on('theme/change', syncAppearance)
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'appearance',
    priority: -1,
    order: 10,
    locale: 'settings.theme',
    store: appearanceStore,
    inject: (actions: BoundActions<typeof appearanceStore>): LiuliAppearanceRowInjected => {
      appearanceBound = actions
      // 注册与首次渲染之间可能错过 theme/change，从 getter 补同步一次。
      const snapshot = ctx.theme.getTheme()
      appearanceBound.sync(snapshot.preference, snapshot.revision)
      return {
        setTheme: (id) => { ctx.theme.setTheme(id) },
      }
    },
  }, LiuliAppearanceRow))

  // ── 会话 header 效果（供应商额度/声纹/监听/主题切换/拉伸手柄）──
  // 额度放在 header.actions：跟在 agent preset 标签右侧，作为普通文本而非工具区胶囊。
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'liuli-supplier-quota',
    order: 5,
  }, SupplierQuota))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'liuli-voiceprint',
    order: 10,
  }, DenpaHeaderVoiceprint))
  // 手柄与回合导轨挂在官方 header.utilities（最右端）：tabs 条挂载点只存在于
  // 未发布的 harness 改动里，官方版本没有该 slot；utilities 位置最接近。
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'liuli-header-chrome',
    order: 10,
  }, DenpaHeaderChrome))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'liuli-header-resizer',
    order: 15,
  }, DenpaHeaderResizer))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'liuli-turn-rail',
    order: 20,
  }, TurnRail))
  // 工作区预览开关：点击开合宿主右侧 details 列（不再是 overlay）
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'liuli-preview-button',
    order: 25,
  }, () => createElement(PreviewButton, { onToggle: togglePreview })))
}
