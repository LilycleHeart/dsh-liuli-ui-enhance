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
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
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
import { en, zh, type DenpaAppearanceKey, modelRetryZh, modelRetryEn, type ModelRetryKey } from './locales.ts'
import { denpaCss } from './denpa-css.ts'
import {
  DenpaHeaderVoiceprint, DenpaHeaderChrome, DenpaHeaderResizer,
} from './HeaderEffects.tsx'
import { setTurnRailCommitHandler, TurnRail } from './TurnRail.tsx'
import { fileChangesDefinition, RoundSummaryCard } from './TurnFileCard.tsx'
import { startEditDiffAutoExpand } from './edit-diff-autoplay.ts'
import { startDenpaTransition } from './denpa-transition.ts'
import { startHeaderTabIndicator } from './header-tab-indicator.ts'
import { disposeSupplierQuota, initSupplierQuota, refreshSupplierQuota } from './supplier-quota.ts'
import { SupplierQuota } from './SupplierQuota.tsx'
import { ModelRetryRow, type ModelRetryRowInjected } from './ModelRetryRow.tsx'
import { createModelRetryStore } from './model-retry-store.ts'
import { initModelRetry, disposeModelRetry, loadModelRetry, saveModelRetry, cacheModelRetryBackoff } from './model-retry-controller.ts'
import { createElement } from 'react'
import { FloatBall } from './FloatBall.tsx'
import { WindowControls, isFramelessWin32 } from './WindowControls.tsx'
import { createRoot } from 'react-dom/client'
import { formatSelection, type PickedElement } from './element-picker.ts'
import { startElementCardDecoration } from './element-card.ts'
import { startSessionRename } from './session-rename.ts'
import { startSessionMarkerDecoration } from './session-markers.ts'
import { startSessionContextMenu } from './session-context-menu.ts'
import { startWorkspaceContextMenu } from './workspace-context-menu.ts'
import {
  PreviewDetailsPanel, PreviewButton, PREVIEW_TOGGLE_EVENT, PREVIEW_NAVIGATE_EVENT,
  resolvePreviewUrl, setPreviewOpen, togglePreviewOpen, setPaneSyncSuppressed,
} from './PreviewPanel.tsx'
import type { SidePaneHostAccess } from './SidePaneExtraPanels.tsx'
import { DockWorkspace, DOCK_TOGGLE_EVENT, isDockOpen, setDockOpen, toggleDockOpen } from './DockWorkspace.tsx'
import { DockStore } from './dock-store.ts'
import { addPanel as addDockPanel } from './dock-model.ts'
import { DockShellFrame, DOCK_MENU_TOGGLE_EVENT, setDockHostBridge } from './dock-shell-frame.tsx'
import {
  createDockShellStore, defaultShellLayout, exportDockJSON, importDockJSON,
  listShellSlotNames, loadShellSlotByName, saveShellDock, saveShellSlotByName,
  type HostLayoutFace,
} from './dock-shell.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** DenpaPush 界面设置 section 的文案。 */
    'denpa-appearance': DenpaAppearanceKey
    /** 模型请求重试行（通用设置区）的文案。 */
    'liuli-model-retry': ModelRetryKey
  }
}

/** DenpaPush 设置 section 的文案命名空间。 */
export const DENPA_LOCALE_NS = 'denpa-appearance'

/** 模型请求重试行的文案命名空间。 */
export const MODEL_RETRY_LOCALE_NS = 'liuli-model-retry'

/** 主题样式注入的 <style> id（幂等：重复 apply 不叠加）。 */
const STYLE_ID = 'liuli-theme-css'
// 设置持久化键在 denpa-settings.ts 中定义（HeaderEffects 运行时读取同一键）。

/** Required services: slots/locale for the settings section, theme for the toggle bridge, connection/remote for supplier quota.
 *  layout：advanced 模式由桌面 shell 提供、兼容模式由官方 ui-layout 提供，两种模式都保证在场；
 *  conversation / workspaces：交互能力依赖（引用入输入框 / 打开路径），boot 期由上游插件提供。
 *  注意：包级 boot 图依赖（package.json dsh.client.inject）不含 ui-layout / ui-conversation，
 *  避免 advanced 模式下 ui-layout 条目缺席造成的启动图死锁。 */
export const inject = ['slots', 'locale', 'theme', 'layout', 'sessions', 'workspaces', 'conversation', 'conversationEvents', 'inputTriggers', 'connection', 'remote']

/** 宽边模式样式：对话信息区在宽屏下撑满可用宽度（提高左右空间利用率）。 */
const WIDE_MODE_CSS = [
  '/* 宽边模式：覆盖会话列的内容宽度轴（--dsh-chat-content-width 定义于会话 root） */',
  'body[data-liuli-wide] [data-phase] {',
  '  --dsh-chat-content-width: min(1280px, calc(100% - 160px));',
  '}',
].join('\n')

/** 设置页模态让位（body[data-liuli-settings-open] 由 settings overlay 检测 effect 维护）：
 *  1) 右侧边栏（details 列）面板 z-index:1 与侧栏根（z-index:1）同层、DOM 靠后，
 *     会盖住侧栏根上下文内的设置页 overlay —— 设置页打开时把侧栏根抬到 100，
 *     overlay 随之超越右侧面板/缩放手柄/抓握簇（模态优先）；
 *  2) webview 嵌入式浏览器是 Host WebContentsView 原生视图，不受 CSS 层级控制，
 *     始终浮在 DOM 之上 —— 隐藏 carrier 后几何上报（rect=0）驱动 Host 隐藏视图。 */
const SETTINGS_DEFER_CSS = [
  'body[data-liuli-settings-open] [class*="_sidebarCol"] > div > [class*="_root"] {',
  '  z-index: 100 !important;',
  '}',
  'body[data-liuli-settings-open] [data-testid="browser-webview"] {',
  '  display: none !important;',
  '}',
].join('\n')


/** DSH Desktop 高级（无边框）模式兼容样式。
 *  advanced 模式下桌面 shell（.dshDesktopFrame 网格）替换了上游 AppFrame，
 *  上游哈希结构类（*_frame / *_sidebarCol / *_centerCol / *_detailsCol）全部消失。
 *  别名挂载 effect 会把 shell 元素打上 liuli_frame / liuli_sidebarCol /
 *  liuli_centerCol / liuli_detailsCol 类名，让既有 [class*=] 配方直接命中；
 *  这里只补 shell 层面的少量差异（表面透明、macOS 红绿灯留白等）。 */
const DESKTOP_ADVANCED_CSS = [
  '/* ── DSH Desktop advanced（无边框）模式 ── */',
  '/* 表面透明：shell 各表面默认不透明 bg-base，会盖住帧背景/壁纸层',
  '   （[data-denpa-bg]）；改透明后与兼容模式观感一致 */',
  'body[data-dsh-desktop-mode="advanced"] .dshDesktopConversationSurface,',
  'body[data-dsh-desktop-mode="advanced"] .dshDesktopDetailsSurface,',
  'body[data-dsh-desktop-mode="advanced"] .dshDesktopMacCaptionRow,',
  'body[data-dsh-desktop-mode="advanced"] .dshDesktopWindowsCaptionRow,',
  'body[data-dsh-desktop-mode="advanced"] .dshDesktopSidebarSurface {',
  '  background: transparent !important;',
  '}',
  '/* 侧栏列去分割线：浮动卡片观感（对齐兼容模式 _sidebarCol 配方） */',
  'body[data-dsh-desktop-mode="advanced"] .dshDesktopSidebarSurface {',
  '  border-right: none !important;',
  '}',
  '/* 详情列去分割线（shell 给表面加了 border-left；对齐 _detailsCol 配方） */',
  'body[data-dsh-desktop-mode="advanced"] .dshDesktopDetailsSurface {',
  '  border-left: none !important;',
  '}',
  '/* macOS：红绿灯（x:16, y:16）上方留白，侧栏卡片不压系统按钮 */',
  'body[data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="darwin"] .dshDesktopUpstreamSidebar {',
  '  padding-top: 40px !important;',
  '}',
  '/* 详情列面板根：advanced 模式哈希类为 *_panel（兼容模式是 *_root），',
  '   补上去左线规则（镜像 [class*="_detailsCol"] [class*="_root"]） */',
  'body[data-dsh-desktop-mode="advanced"] [class*="_detailsCol"] [class*="_panel"] {',
  '  border-left: none !important;',
  '}',
  '/* 详情列面板根统一描边：卡片四边与会话/侧栏一致——预览面板根补上完整',
  '   1px 描边后，左缘需覆盖上面的 border-left:none（同特异性、更靠后生效） */',
  'body[data-dsh-desktop-mode="advanced"] [class*="_detailsCol"] [data-preview-panel] {',
  '  border-left: 1px solid var(--dsw-alias-border-l1) !important;',
  '}',
  '/* 侧栏根被 slot 注入内联宽度（280px 列宽），会顶掉右留白；',
  '   100% !important 收回内容盒，恢复卡片间隙（收起态 padding 0 时不受影响） */',
  'body[data-dsh-desktop-mode="advanced"] [class*="_sidebarCol"] > div > [class*="_root"] {',
  '  width: 100% !important;',
  '}',
  '/* ── 无边框窗口拖动区：去掉 caption 行后，会话 header 承担窗口拖动 ── */',
  '/* 会话页头（<header>）整体 -webkit-app-region: drag，空白处可拖动窗口 */',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header {',
  '  -webkit-app-region: drag;',
  '}',
  '/* 页头内的交互元素保持可点击（no-drag 覆盖父级 drag） */',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header button,',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header a,',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header input,',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header select,',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header textarea,',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header label,',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header [role="button"],',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header [role="tab"],',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header [role="menuitem"],',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header [role="combobox"],',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header [role="listbox"],',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header [contenteditable],',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"] header [data-liuli-window-controls] {',
  '  -webkit-app-region: no-drag;',
  '}',
  '/* dock 合并标签条空白区（tabFiller）也可拖动窗口；标签 chip no-drag 保持可拖拽/可点 */',
  'body[data-dsh-desktop-mode="advanced"] [data-testid="dock-tab-strip"] {',
  '  -webkit-app-region: drag;',
  '}',
  'body[data-dsh-desktop-mode="advanced"] [data-testid="dock-tab-strip"] [data-testid="dock-tab-chip"] {',
  '  -webkit-app-region: no-drag;',
  '}',
  '/* 开始页（会话 header 隐藏 display:none）：激活会话面板顶部拖动条，顶部可拖窗 */',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"]:has(header[aria-hidden]) [data-liuli-pane-drag] {',
  '  -webkit-app-region: drag;',
  '  pointer-events: auto;',
  '}',
  '/* 设置页模态（侧栏根内全屏 fixed overlay）打开时：advanced shell 浮动窗口',
  '   （fixed 高 z-index）会盖住设置页，整体隐藏让位；设置页关闭后自动恢复',
  '   （visibility 保留窗口位置，不破坏 dock 布局持久化） */',
  'body[data-liuli-settings-open] [data-testid="dock-float"] {',
  '  visibility: hidden !important;',
  '  pointer-events: none !important;',
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

/** 设置页模态判定：官方设置页（ui-settings）是渲染在侧栏根内的全屏 fixed overlay
 *  （侧栏根 z-index:1 上下文内 z-index:1000）。琉璃自己的浮层（工作台全屏层 /
 *  advanced shell 浮动窗口）z-index 高达 2147482xxx，会盖住设置页 ——
 *  检测此模态出现/消失，供浮层让位（body 标记 + 工作台收起 + CSS 隐藏）。 */
function isSettingsOverlayOpen(): boolean {
  const sidebarRoot = document.querySelector<HTMLElement>('[class*="_sidebarCol"] > div > [class*="_root"]')
  if (sidebarRoot === null) return false
  const vw = window.innerWidth
  const vh = window.innerHeight
  for (const el of sidebarRoot.querySelectorAll<HTMLElement>('*')) {
    if (getComputedStyle(el).position !== 'fixed') continue
    const r = el.getBoundingClientRect()
    if (r.width >= vw * 0.6 && r.height >= vh * 0.6) return true
  }
  return false
}

/** 注入主题样式（幂等；已存在则跳过）。 */
function injectThemeCss(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.setAttribute('data-liuli-theme', '')
  style.textContent = denpaCss + '\n' + WIDE_MODE_CSS + '\n' + SETTINGS_DEFER_CSS + '\n' + DESKTOP_ADVANCED_CSS
  document.head.appendChild(style)
}

/**
 * 给本插件刚注册的 root entry 补齐 children 表（框架内部缝补，防御性实现）：
 * 渲染器用 entry.children 判定 occupant 能否拿到 renderSlot 面，而子 slot 的
 * 声明已被桌面 shell 抢占（重复声明会抛错）；声明台账是全局的，children 表
 * 只需镜像四个子 slot 的规格即可让 renderSlot('sidebar' 等) 通过所有权检查。
 * 任何形状不符都静默返回 false —— 占用者渲染时崩溃会被框架 abdicate，
 * 自动回退到桌面原生 AdvancedFrame（安全降级）。
 */
function equipRootEntryChildren(ctx: ClientContext): boolean {
  try {
    const core = (ctx.slots as unknown as {
      _core?: {
        records?: Map<string, { entries: Array<{ options?: { priority?: number }; children?: Record<string, { kind: string; scope: string }> }> }>
        spec?: (key: string) => { kind: string; scope: string } | undefined
      }
    })._core
    if (core === undefined || core.records === undefined || typeof core.spec !== 'function') return false
    const rec = core.records.get('root')
    if (rec === undefined) return false
    const mine = rec.entries.find(e => e.options?.priority === -1 && e.children !== undefined && Object.keys(e.children).length === 0)
    if (mine === undefined) return false
    const table: Record<string, { kind: string; scope: string }> = {}
    // 会话标题面板（REGION_CONVERSATION_HEADER）渲染宿主 header，必须一并
    // 声明，否则 root 渲染时因 slot 未声明而崩溃（abdicate 回退原生帧）。
    for (const key of ['sidebar', 'conversation', 'details', 'shell.overlay', 'conversation.session.header']) {
      const spec = core.spec(key)
      if (spec === undefined) return false
      table[key] = { kind: spec.kind, scope: spec.scope }
    }
    mine.children = table
    return true
  } catch {
    return false
  }
}

/**
 * equipRootEntryChildren 的逆操作（HMR 安全阀）：fiber 卸载时把 entry.children
 * 清空回注册时的空表。框架按 entry.children 级联坍缩该 entry 声明过的子 slot
 * （releaseEntry），而这四个子 slot 的声明者是桌面 shell —— 若带着补全的表被
 * 释放，会把全局声明台账里的 sidebar/conversation/details/shell.overlay 一并
 * 坍缩掉（且其他插件不会重新注册占用者）。子作用域先于父级 disposer 清理，
 * 保证本清理跑在注册 disposer（releaseEntry）之前。
 */
function unequipRootEntryChildren(ctx: ClientContext): void {
  try {
    const core = (ctx.slots as unknown as {
      _core?: { records?: Map<string, { entries: Array<{ options?: { priority?: number }; children?: Record<string, unknown> }> }> }
    })._core
    const rec = core?.records?.get('root')
    if (rec === undefined) return
    const mine = rec.entries.find(e => e.options?.priority === -1 && e.children !== undefined)
    if (mine !== undefined) mine.children = {}
  } catch { /* 形状不符则放弃（最坏回到现状：释放时误坍缩，等同修复前） */ }
}

/**
 * Client plugin body: mount the theme, the Denpa UI settings section,
 * the runtime + toggle bridge, and the session header effects.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  injectThemeCss()

  // ── advanced（无边框）模式别名挂载：桌面 shell 元素补上上游结构类名，──
  // ── 让兼容模式配方（[class*="_frame"]/"_sidebarCol"/"_centerCol"/"_detailsCol"）直接命中 ──
  // advanced 模式下宿主 shell（.dshDesktopFrame 网格）替换上游 AppFrame，
  // 哈希结构类全部消失导致琉璃大部分样式失效；给 shell 表面挂同名别名类即可复用配方。
  ctx.effect(() => {
    const mode = new URLSearchParams(window.location.search).get('dsh-desktop-mode')
    if (mode !== 'advanced') return () => {}
    const ALIASES: Array<[string, string]> = [
      ['.dshDesktopFrame', 'liuli_frame'],
      ['.dshDesktopUpstreamSidebar', 'liuli_sidebarCol'],
      ['.dshDesktopConversationSurface', 'liuli_centerCol'],
      ['.dshDesktopDetailsSurface', 'liuli_detailsCol'],
    ]
    let raf = 0
    const tag = (): void => {
      raf = 0
      for (const [sel, cls] of ALIASES) {
        const el = document.querySelector(sel)
        if (el !== null && !el.classList.contains(cls)) el.classList.add(cls)
      }
    }
    tag()
    // shell 挂载晚于本插件 apply 时首跑会落空；观察 DOM 变化补挂（rAF 节流）。
    const mo = new MutationObserver(() => {
      if (raf !== 0) return
      raf = requestAnimationFrame(tag)
    })
    mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      mo.disconnect()
    }
  }, 'liuli-theme: advanced shell alias classes')

  // ── Dockable 布局 shell（advanced 模式）：把桌面 advanced shell 的既有布局改造成可停靠工作台 ──
  // advanced 模式下官方 ui-layout 被禁用；桌面 shell（dsh-plugin-desktop）提供 layout 服务
  // 并占用 root slot（AdvancedFrame）。琉璃以更低的渲染优先级（priority -1）接管 root slot，
  // 并覆盖 layout 服务指向自己的 dock store —— 三大区域（侧边栏/会话/详情）成为可拖拽面板：
  // 拖拽/四向拆分/边缘与面板内停靠/浮动窗口/标签页合并/sash 缩放 + Workspace 保存/恢复。
  // 子 slot（sidebar/conversation/details/shell.overlay）的声明仍归桌面 shell，
  // 本插件借 ctx.slots.inject('sidebar') 等到声明落地后再注册 root 占用者，避免重复声明。
  if (new URLSearchParams(window.location.search).get('dsh-desktop-mode') === 'advanced') {
    const shellHandle = createDockShellStore().create()
    // 自测钩子：无头自测脚本经此驱动宿主 layout 服务与 dock 工作台
    // （开合详情/收起侧栏/菜单开合/面板增删/布局保存恢复导出导入）。
    ctx.effect(() => {
      const hook = {
        openDetails: () => { ctx.layout.openDetails() },
        closeDetails: () => { ctx.layout.closeDetails() },
        toggleSidebar: () => { ctx.layout.toggleSidebar() },
        toggleMenu: () => { window.dispatchEvent(new CustomEvent(DOCK_MENU_TOGGLE_EVENT)) },
        addPanel: (type: string) => {
          const next = structuredClone(shellHandle.getSnapshot().dock)
          const seq = next.seq
          next.seq = seq + 1
          shellHandle.actions.setDock(addDockPanel(next, { id: 'p' + String(seq), type }))
        },
        saveSlot: (name: string) => { saveShellSlotByName(name, shellHandle.getSnapshot().dock); saveShellDock(shellHandle.getSnapshot().dock) },
        loadSlot: (name: string) => {
          const loaded = loadShellSlotByName(name)
          if (loaded === undefined) return false
          shellHandle.actions.resetShell()
          shellHandle.actions.setDock(loaded)
          return true
        },
        listSlots: () => listShellSlotNames().map(s => s.name),
        exportJSON: () => exportDockJSON(shellHandle.getSnapshot().dock),
        importJSON: (text: string) => {
          const imported = importDockJSON(text)
          if (imported === undefined) return false
          shellHandle.actions.resetShell()
          shellHandle.actions.setDock(imported)
          return true
        },
        reset: () => { shellHandle.actions.resetShell() },
        defaultLayoutJSON: () => exportDockJSON(defaultShellLayout()),
      }
      ;(window as unknown as { __liuliDockShell__?: unknown }).__liuliDockShell__ = hook
      return () => {
        if ((window as unknown as { __liuliDockShell__?: unknown }).__liuliDockShell__ === hook) {
          delete (window as unknown as { __liuliDockShell__?: unknown }).__liuliDockShell__
        }
      }
    }, 'liuli-theme: dock shell self-test hook')
    ctx.slots.inject('sidebar', () => {
      // 子 slot 声明归桌面 shell（先到者声明，重复声明会抛错）：注册时传空 children
      // 表躲开声明检查，注册完成后把四个子 slot 的规格补进本 entry 的 children 表——
      // 渲染器按 entry.children 决定 occupant 是否拿到 renderSlot 面（规格读取走
      // 全局声明台账，与声明者是谁无关）。形状不符时防御性放弃（回退桌面原生帧）。
      type RootChildren = {
        'sidebar': { kind: 'single'; scope: 'root' }
        'conversation': { kind: 'single'; scope: 'session-maybe' }
        'details': { kind: 'single'; scope: 'session' }
        'shell.overlay': { kind: 'list'; scope: 'root' }
      }
      const rootOptions = {
        name: 'root' as const,
        priority: -1,
        children: {},
        // 宿主 layout 服务（桌面 DesktopLayoutState）经 inject 钩子递进帧层：
        // 帧层订阅其宽度/narrow 状态，开合动作走它的 toggleSidebar/openDetails/closeDetails。
        inject: () => ({ dockShell: shellHandle, hostLayout: ctx.layout as unknown as HostLayoutFace }),
      }
      const disposeRegistration = ctx.slots.register(
        rootOptions as typeof rootOptions & { children: RootChildren },
        DockShellFrame,
      )
      equipRootEntryChildren(ctx)
      ctx.effect(() => () => { unequipRootEntryChildren(ctx) }, 'liuli-theme: dock shell children release guard')
      return disposeRegistration
    })
  }

  // ── 会话切换/新消息入场动画：MutationObserver 挂类（动画定义在 denpa.css）──
  ctx.effect(() => startDenpaTransition(), 'liuli-theme: message transition observer')

  // ── 会话 header 视图标签（对话/轨迹）滑动激活指示条：官方横条瞬间切换，
  //    这里注入独立指示条跟随激活 tab 平滑滑动（动画定义在 denpa.css）──
  ctx.effect(() => startHeaderTabIndicator(), 'liuli-theme: header tab indicator')

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

  // ── 模型请求重试：注入 connection，供通用设置区编辑各供应商 retryPolicy ──
  initModelRetry(ctx.get('connection') as ConnectionHandle)
  ctx.effect(() => () => disposeModelRetry(), 'liuli-theme: model retry dispose')
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

  // ── 文件引用：右侧边栏文件树「添加到聊天」把路径作为引用卡片插入输入框 ──
  const fileCodec: ReferenceCodec = {
    clipboardText: ref => ref,
    serialize: ref => Promise.resolve(ref),
  }
  const fileSource: InputTriggerSource = {
    trigger: '@',
    name: 'liuli-file',
    candidates: () => Promise.resolve([]),
    onPick: () => undefined,
    codec: fileCodec,
  }
  ctx.effect(() => ctx.inputTriggers.registerSource(fileSource), 'liuli-theme: file reference source')
  const insertFileReference = (path: string): void => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === undefined) return
    const actx = ctx.sessions.scope(current)
    if (actx === undefined) return
    const input = ctx.conversation.input.for(actx)
    const state = input.state.getSnapshot()
    const span = { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev }
    input.insertReference({
      source: 'liuli-file',
      ref: path,
      label: '文件: ' + path,
      clipboardText: path,
    }, span)
  }

  // dock shell 扩展面板的宿主能力桥（advanced 模式下 DockShellFrame 为纯组件，
  // 不碰 cordis；文件入聊天 / 系统打开经此桥到达 conversation / workspaces 服务）。
  setDockHostBridge({
    addFileToChat: insertFileReference,
    openPath: (path: string) => { void ctx.workspaces.openPath(path) },
  })

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
    root.render(createElement(FloatBall, {
      insertElement,
      openDock: () => { if (!isSettingsOverlayOpen()) toggleDockOpen() },
      openLayoutMenu: () => { window.dispatchEvent(new CustomEvent(DOCK_MENU_TOGGLE_EVENT)) },
    }))
    return () => {
      root.unmount()
      host.remove()
    }
  }, 'liuli-theme: float ball mount')

  // ── 页面内窗口按钮（无边框模式）：固定悬浮在窗口右上角，开始页与会话页一致 ──
  // 会话页不再把按钮内联进 header.utilities（此前随 header 排在工具区最右端）：
  // header 卡片带 backdrop-filter，会成为 fixed 后代的包含块、破坏视口定位，
  // 因此统一由 body 级 host 渲染与开始页同款的磨砂胶囊（右上角 6px/10px）。
  // 胶囊内置智能避让：遮挡交互元素（header 工具按钮/详情面板头部/浮动窗口
  // 标题栏等）时自动淡出，悬停右上角检测区唤出（见 WindowControls.tsx）。
  ctx.effect(() => {
    if (!isFramelessWin32()) return () => {}
    const hostEl = document.createElement('div')
    hostEl.id = 'liuli-window-controls-host'
    document.body.appendChild(hostEl)
    const root = createRoot(hostEl)
    root.render(createElement(WindowControls))
    return () => {
      root.unmount()
      hostEl.remove()
    }
  }, 'liuli-theme: window controls fixed top-right')

  // ── 工具区下沉 tabs 行的偏移测量：titleRow 底 → tabs 行底，写入 header ──
  // 工具区（Session log/监听/主题/面板）经 denpa-css.ts 锚定 titleRow 右下角，
  // 再按 --dsh-tabs-offset 下移到与视图标签同一栏（右、下对齐）。tabs 行只在
  // 视图标签 >1 时渲染，视图切换/header 拉伸会改几何：body 级观察 + rAF 节流
  // 重测；无 tabs 行时置 0（工具区留在标题行，CSS :has 条件兜底）。
  ctx.effect(() => {
    let raf = 0
    let last = -1
    const measure = (): void => {
      raf = 0
      const header = document.querySelector<HTMLElement>(
        '[data-region-pane="region:conversation-header"] header, [data-region-pane="region:conversation"] header, div[data-phase] > header, div[data-phase] > div > header',
      )
      if (header === null) return
      const titleRow = header.querySelector<HTMLElement>('[class*="_titleRow"]')
      const tabs = header.querySelector<HTMLElement>('[class*="_tabs"]')
      const next = (titleRow === null || tabs === null)
        ? 0
        : Math.max(0, Math.round(tabs.getBoundingClientRect().bottom - titleRow.getBoundingClientRect().bottom))
      // 值不变则跳过写入，避免 body 级观察在高频 DOM 活动下反复触发样式重算
      if (next !== last) {
        last = next
        header.style.setProperty('--dsh-tabs-offset', next + 'px')
      }
    }
    const schedule = (): void => { if (raf === 0) raf = requestAnimationFrame(measure) }
    measure()
    const mo = new MutationObserver(schedule)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      mo.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, 'liuli-theme: header tabs offset measure')

  // ── 设置页模态让位：设置页（侧栏根内全屏 fixed overlay）打开时，──
  // 琉璃自己的高 z-index 浮层（工作台全屏层 / advanced shell 浮动窗口）会盖住它。
  // 这里检测模态出现/消失：body 打 data-liuli-settings-open 标记（CSS 据此隐藏
  // advanced shell 浮动窗口），并自动收起工作台（模态优先；工作台布局持久化在
  // localStorage，重新打开原样恢复）。
  ctx.effect(() => {
    let raf = 0
    const update = (): void => {
      raf = 0
      if (isSettingsOverlayOpen()) {
        document.body.setAttribute('data-liuli-settings-open', '')
        setDockOpen(false)
      } else {
        document.body.removeAttribute('data-liuli-settings-open')
      }
    }
    const schedule = (): void => {
      if (raf === 0) raf = requestAnimationFrame(update)
    }
    update()
    const mo = new MutationObserver(schedule)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      mo.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, 'liuli-theme: settings overlay defer')

  // ── Dockable Workspace（琉璃工作台）：可拖拽/停靠/拆分/浮动/标签合并的面板工作台 ──
  // 布局自动落 localStorage（dock-store 防抖保存），刷新/HMR 重载后原样恢复；
  // 顶栏另有命名槽位保存/恢复与 JSON 导出/导入。
  const dockStore = new DockStore()
  ctx.effect(() => {
    const hostEl = document.createElement('div')
    hostEl.id = 'liuli-dock-host'
    document.body.appendChild(hostEl)
    const root = createRoot(hostEl)
    const renderDock = (): void => {
      root.render(isDockOpen()
        ? createElement(DockWorkspace, {
          store: dockStore,
          sessionList: ctx.sessions.list,
          addFileToChat: insertFileReference,
          openPath: (path: string) => { void ctx.workspaces.openPath(path) },
          onClose: () => { toggleDockOpen() },
        })
        : null)
    }
    renderDock()
    window.addEventListener(DOCK_TOGGLE_EVENT, renderDock)
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.code !== 'KeyW') return
      e.preventDefault()
      if (isSettingsOverlayOpen()) return
      toggleDockOpen()
    }
    window.addEventListener('keydown', onKey)
    const onPageHide = (): void => { dockStore.flush() }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener(DOCK_TOGGLE_EVENT, renderDock)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pagehide', onPageHide)
      root.unmount()
      hostEl.remove()
    }
  }, 'liuli-theme: dock workspace mount')

  // ── 工作区预览列：header 按钮开合宿主右侧 details 列，面板占用 details slot ──
  const togglePreview = (): void => {
    const open = togglePreviewOpen()
    setPaneSyncSuppressed(!open)
    if (open) ctx.layout.openDetails()
    else ctx.layout.closeDetails()
    window.dispatchEvent(new CustomEvent(PREVIEW_TOGGLE_EVENT))
  }
  const stepSession = (dir: 1 | -1): void => {
    const snap = ctx.sessions.list.getSnapshot()
    const current = snap.current
    if (current === undefined) {
      const first = snap.ids[0]
      if (first !== undefined) ctx.sessions.open(first)
      return
    }
    const index = snap.ids.indexOf(current)
    const next = snap.ids[index + dir]
    if (next !== undefined) ctx.sessions.open(next)
  }
  // 扩展面板（轨迹/计划/子智能体/辅助对话/开发者工具）的宿主数据面。
  const sidePaneHost: SidePaneHostAccess = {
    sessionList: ctx.sessions.list,
    getSessionFace: id => ctx.sessions.binding(id as SessionId)?.session,
    forkSession: id => ctx.sessions.fork({ sessionId: id as SessionId, increaseTitle: true }),
    openSession: id => { ctx.sessions.open(id as SessionId) },
  }
  ctx.slots.inject('details', () => ctx.slots.register({
    name: 'details',
    priority: -1,
    inject: () => ({
      openDetails: () => { ctx.layout.openDetails() },
      closeDetails: () => {
        setPaneSyncSuppressed(true)
        setPreviewOpen(false)
        ctx.layout.closeDetails()
      },
      insertElement,
      addFileToChat: insertFileReference,
      openPath: (path: string) => { void ctx.workspaces.openPath(path) },
      startSession: () => { ctx.workspaces.startSession() },
      pickDirectory: async () => {
        const path = await ctx.workspaces.pickDirectory()
        if (path !== null && path !== '') await ctx.workspaces.create({ path })
      },
      toggleTheme: () => {
        const dark = document.body.hasAttribute('data-ds-dark-theme')
        ctx.theme.setTheme(dark ? 'light' : 'dark')
      },
      prevSession: () => { stepSession(-1) },
      nextSession: () => { stepSession(1) },
      host: sidePaneHost,
    }),
  }, PreviewDetailsPanel))

  // 切换会话时宿主会自动收起 details 列；这里同步重置预览开关，避免下次按钮反向。
  // 宿主收起同样走关闭动画：抑制 RO 同步，防止动画期间被翻回打开。
  // 只在「当前会话真的变了」时重置：session list 的任何其他更新（状态/流式/未读）
  // 也会触发快照变化，若在此处重置会把 previewOpen 拉偏，导致 Ctrl+Alt+B 首按失效。
  let lastCurrentSession = ctx.sessions.list.getSnapshot().current
  ctx.effect(() => ctx.sessions.list.subscribe(() => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === lastCurrentSession) return
    lastCurrentSession = current
    setPaneSyncSuppressed(true)
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
  ctx.effect(() => ctx.locale.register(MODEL_RETRY_LOCALE_NS, { zh: modelRetryZh, en: modelRetryEn }), 'liuli-theme: model-retry dictionaries')

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
  // DSH Desktop 每次重启 Web 端口会变（ephemeral），localStorage 按 origin 隔离，
  // 因此跨重启持久化必须再同步一份到 Host 端 /liuli-settings；纯 Web 无此路由时忽略。
  let localDirty = false
  let remoteStateChain: Promise<void> = Promise.resolve()
  const pushRemoteState = (): void => {
    remoteStateChain = remoteStateChain
      .catch(() => {})
      .then(async () => {
        try {
          const payload = { settings: readDenpaSettings(), wallpaper: loadWallpaper() }
          const res = await fetch('/liuli-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(5000),
          })
          if (!res.ok) throw new Error('HTTP ' + res.status)
        } catch (_) { /* Host 路由不可用时保留 localStorage 行为 */ }
      })
  }
  const writeDenpaSettings = (value: DenpaSettings): void => {
    localDirty = true
    try { localStorage.setItem(DENPA_LS_KEY, JSON.stringify(value)) } catch (_) {}
    pushRemoteState()
  }
  const syncDenpa = (value: DenpaSettings): void => {
    denpaRev += 1
    denpaBound?.syncSettings(value, denpaRev)
  }
  // 记录上次应用选区时的窗口尺寸与选区，用于 resize 时围绕中心点按比例缩放。
  let lastViewportWidth = window.innerWidth
  let lastViewportHeight = window.innerHeight
  let lastBgArea: DenpaBgArea | null = readDenpaSettings().bg_area
  // 启动后从 Host 拉取上次 Desktop 会话保存的设置/壁纸（当前端口 localStorage 为空）。
  // 如果用户已经在当前会话改过设置，则不再用远端覆盖，避免本地新修改被旧值冲掉。
  const loadRemoteState = async (): Promise<void> => {
    if (localDirty) return
    try {
      const res = await fetch('/liuli-settings', { signal: AbortSignal.timeout(5000) })
      if (!res.ok) return
      const data = await res.json() as { value?: { settings?: unknown; wallpaper?: string | null } | null } | null
      const saved = data?.value
      if (saved === null || saved === undefined || (saved.settings === undefined && saved.wallpaper === undefined)) return
      const remote = denpaSettingsOf(saved.settings)
      try { localStorage.setItem(DENPA_LS_KEY, JSON.stringify(remote)) } catch (_) {}
      const wallpaper = typeof saved.wallpaper === 'string' && saved.wallpaper.length > 0 ? saved.wallpaper : null
      if (wallpaper !== null) saveWallpaper(wallpaper)
      else clearWallpaper()
      denpaBound?.syncWallpaper(wallpaper)
      syncDenpa(remote)
      lastBgArea = remote.bg_area
      lastViewportWidth = window.innerWidth
      lastViewportHeight = window.innerHeight
      void applyDenpaSettings(remote)
      window.dispatchEvent(new CustomEvent('liuli:vp-params'))
    } catch (_) { /* Host 路由不可用时保留 localStorage 行为 */ }
  }

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
        clearWallpaper()
        denpaBound?.syncWallpaper(null)
        writeDenpaSettings(DENPA_SETTINGS_DEFAULTS)
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
        pushRemoteState()
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
  // Desktop 端口每次重启会变：从 Host 端恢复上次保存的设置/壁纸。
  void loadRemoteState()
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

  // ── 设置页「通用」分区新增一行：模型请求重试次数 + 重试等待时间 ──
  //    写入由宿主各供应商 profile 持有的 retryPolicy（dsh-llm-retry 执行），
  //    path-addressed settings.mutate 只改 retryPolicy 键，不碰密钥等其它字段。
  //    只新增本插件自身的行，不替换/不修改官方通用设置区其它行。
  const modelRetryStore = createModelRetryStore()
  const modelRetryT = ctx.locale.bind(MODEL_RETRY_LOCALE_NS)
  let modelRetryBound: BoundActions<typeof modelRetryStore> | undefined
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'liuli-model-retry',
    order: 15,
    locale: MODEL_RETRY_LOCALE_NS,
    store: modelRetryStore,
    inject: (actions: BoundActions<typeof modelRetryStore>): ModelRetryRowInjected => {
      modelRetryBound = actions
      return {
        reload: async () => {
          const snap = await loadModelRetry()
          cacheModelRetryBackoff(snap.maxDelayMs, snap.jitterRatio)
          modelRetryBound?.sync({
            maxRetries: snap.maxRetries,
            initialDelayMs: snap.initialDelayMs,
            maxDelayMs: snap.maxDelayMs,
            jitterRatio: snap.jitterRatio,
            providerCount: snap.providerCount,
            status: 'ready',
            error: '',
          })
        },
        save: async (params) => {
          modelRetryBound?.sync({ status: 'saving' })
          const err = await saveModelRetry(params)
          if (err !== undefined) {
            modelRetryBound?.sync({ status: 'error', error: err })
          } else {
            modelRetryBound?.sync({ status: 'ready', error: '' })
          }
          return err
        },
      }
    },
  }, ModelRetryRow))
  void modelRetryT

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
  // ── 页面内窗口按钮（无边框模式）：不再注入 header utilities ——
  // 统一由 body 级 host 固定渲染在窗口右上角（见 'liuli-theme: window controls fixed top-right'）。

  // ── 轮次结束 · 文件变更卡片：按 step 累计修改文件与 diff，发布自定义 chat 节点 ──
  // 当前 DSH 会话转写没有 turn/start|end 事件（step 化），turnTail 槽不渲染；
  // Definition 按 step 发布 liuli-round-summary 节点，渲染器在本轮最后节点处
  // 展示卡片（文件名 + DIFF 数量 + 审查/打开/展开打开方式）。
  ctx.effect(() => ctx.conversationEvents.register(fileChangesDefinition), 'liuli-theme: file-changes definition')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'liuli-round-summary',
  }, RoundSummaryCard))

  // ── 对话页 edit/write 工具行自动展开（显示文件 diff）──
  // 上游 ToolRow 把 diff 放在默认收起的可折叠 body；这里在会话正文渲染后
  // 把带 diff 的 edit/write 行自动点开一次（虚拟化重挂载后再展开）。
  ctx.effect(() => startEditDiffAutoExpand(), 'liuli-theme: edit diff auto-expand')
}
