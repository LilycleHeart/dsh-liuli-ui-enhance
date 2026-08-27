/**
 * 琉璃主题（dsh-liuli-ui-enhance）浏览器半 —— 琉璃 风格界面主题的完整实现：
 *
 *  1. 注入主题样式（liuli.css 字符串，<style> 幂等挂载；覆盖 --dsw-* 语义令牌
 *     为电波推送 M3 配色，亮/暗双主题，含字体、圆角、材质、泛光、滚动条等）；
 *  2. 设置页「界面」分区（settings.section，16 项设置 localStorage 持久化）；
 *  3. 琉璃 运行时：壁纸上传/取色（material-color-utilities 动态 M3 调色）、
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
import { LiuliAppearanceSection, type LiuliAppearanceInjected } from './LiuliAppearance.tsx'
import { LiuliAppearanceRow, type LiuliAppearanceRowInjected } from './LiuliAppearanceRow.tsx'
import { LiuliFeaturesSection, type LiuliFeaturesInjected } from './LiuliFeaturesSection.tsx'
import { createLiuliAppearanceStore } from './liuli-appearance-store.ts'
import { createLiuliStore } from './liuli-store.ts'
import {
  clearWallpaper, loadWallpaper, compressImage, saveWallpaper, loadImage,
  applyLiuliSettings, applyLiuliWallpaper,
} from './liuli-runtime.ts'
import {
  LIULI_LS_KEY, LIULI_SETTINGS_DEFAULTS, liuliSettingsOf,
  type LiuliBgArea, type LiuliSettings,
} from '../liuli-settings.ts'
import { en, zh, type LiuliAppearanceKey, featuresZh, featuresEn, type LiuliFeaturesKey } from './locales.ts'
import { liuliCss } from './liuli-css.ts'
import {
  LiuliHeaderVoiceprint, LiuliHeaderChrome, LiuliHeaderResizer,
  LiuliHeaderFullscreen,
} from './HeaderEffects.tsx'
import { setTurnRailCommitHandler, TurnRail } from './TurnRail.tsx'
import { fileChangesDefinition, RoundSummaryCard } from './TurnFileCard.tsx'
import { startEditDiffAutoExpand } from './edit-diff-autoplay.ts'
import { startAutoOpenDetails } from './auto-open-details.ts'
import { startAutoDriveBrowser } from './auto-drive-browser.ts'
import { startLiuliTransition } from './liuli-transition.ts'
import { startAutoLoadHistory } from './auto-load-history.ts'
import { installResizePerfWatcher } from './resize-perf.ts'
import { startHeaderTabIndicator } from './header-tab-indicator.ts'
import { startHeaderTextAnimation } from './header-text-animation.ts'
import { startConversationSplit } from './conversation-split.ts'
import { disposeSupplierQuota, initSupplierQuota, refreshSupplierQuota } from './supplier-quota.ts'
import { SupplierQuota } from './SupplierQuota.tsx'
import { loadHistoryBatches, saveHistoryBatches } from './history-load-store.ts'
import { initModelRetry, disposeModelRetry, loadModelRetry, saveModelRetry, cacheModelRetryBackoff } from './model-retry-controller.ts'
import { initThinkingFill, disposeThinkingFill, loadThinkingFill, applyThinkingFill, autoApplyThinkingFill } from './thinking-fill-controller.ts'
import { createElement } from 'react'
import { FloatBall } from './FloatBall.tsx'
import { WindowControls, isFramelessWin32 } from './WindowControls.tsx'
import { createRoot } from 'react-dom/client'
import { formatSelection, type PickedElement } from './element-picker.ts'
import { rememberComposerElementInfo, startElementCardDecoration } from './element-card.ts'
import { startSessionRename } from './session-rename.ts'
import { startSessionMarkerDecoration } from './session-markers.ts'
import { startSessionContextMenu } from './session-context-menu.ts'
import { startSettingsSelectUpgrade } from './settings-selects.ts'
import { startWorkspaceContextMenu } from './workspace-context-menu.ts'
import { startWorkspaceNewSessionCollapse } from './workspace-new-session-collapse.ts'
import {
  PreviewDetailsPanel, PreviewButton, PREVIEW_TOGGLE_EVENT, PREVIEW_NAVIGATE_EVENT,
  SIDE_CHAT_OPEN_EVENT,
  resolvePreviewUrl, setPreviewOpen, togglePreviewOpen, setPaneSyncSuppressed,
} from './PreviewPanel.tsx'
import type { SidePaneHostAccess } from './SidePaneExtraPanels.tsx'
import { BtwAnswerHost, BTW_ANSWER_EVENT } from './BtwAnswer.tsx'
import { addPanel as addDockPanel } from './dock-model.ts'
import { DockShellFrame, DOCK_MENU_TOGGLE_EVENT, setDockHostBridge } from './dock-shell-frame.tsx'
import {
  createDockShellStore, createWebHostLayout, defaultShellLayout, exportDockJSON, importDockJSON,
  listShellSlotNames, loadShellSlotByName, saveShellDock, saveShellSlotByName, SIDEBAR_AUTO_COLLAPSE,
  type HostLayoutFace,
} from './dock-shell.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 琉璃 设置「外观」分区 section 的文案。 */
    'liuli-appearance': LiuliAppearanceKey
    /** 琉璃 设置「功能」分区 section 的文案。 */
    'liuli-features': LiuliFeaturesKey
  }
}

/** 琉璃 设置「外观」分区 section 的文案命名空间。 */
export const LIULI_LOCALE_NS = 'liuli-appearance'

/** 琉璃 设置「功能」分区 section 的文案命名空间。 */
export const LIULI_FEATURES_LOCALE_NS = 'liuli-features'

/** 主题样式注入的 <style> id（幂等：重复 apply 不叠加）。 */
const STYLE_ID = 'liuli-theme-css'
// 设置持久化键在 liuli-settings.ts 中定义（HeaderEffects 运行时读取同一键）。

/** Required services: slots/locale for the settings section, theme for the toggle bridge, connection/remote for supplier quota.
 *  layout：advanced 模式由桌面 shell 提供、兼容模式由官方 ui-layout 提供，两种模式都保证在场；
 *  conversation / workspaces：交互能力依赖（引用入输入框 / 打开路径），boot 期由上游插件提供。
 *  注意：包级 boot 图依赖（package.json dsh.client.inject）不含 ui-layout / ui-conversation，
 *  避免 advanced 模式下 ui-layout 条目缺席造成的启动图死锁。 */
export const inject = ['slots', 'locale', 'theme', 'layout', 'sessions', 'workspaces', 'conversation', 'conversationEvents', 'inputTriggers', 'connection', 'remote']

/** 宽边模式样式：对话信息区在宽屏下撑满可用宽度（提高左右空间利用率）。 */
const WIDE_MODE_CSS = [
  '/* 宽边模式：覆盖会话列的内容宽度轴（--dsh-chat-content-width 定义于会话 root）',
  '   间距随容器宽度缩放（10%，上限 160px），但最小内容宽度与官方对齐（748px），',
  '   容器小时不会比原版显示更少信息。 */',
  'body[data-liuli-wide] [data-phase] {',
  '  --dsh-chat-content-width: max(748px, min(1280px, calc(100% - min(160px, 10%))));',
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
  '/* 拖拽区（-webkit-app-region: drag）按元素几何生效、不受 DOM z-index/',
  '   绘制层级影响：设置页全屏 overlay 虽盖在其上，但叠在拖拽区上的按钮',
  '   点击会被吞掉（表现为"没盖住却点不了"）。设置页打开时把琉璃的拖拽区',
  '   临时置为 no-drag，让点击正常穿透。 */',
  'body[data-liuli-settings-open] [data-region-pane="region:conversation"] header,',
  'body[data-liuli-settings-open] [data-region-pane="region:conversation-header"] header,',
  'body[data-liuli-settings-open] [data-testid="dock-tab-strip"],',
  'body[data-liuli-settings-open] [class*="_sidebarCol"] [class*="_logoRow"],',
  'body[data-liuli-settings-open] [data-preview-panel] [class*="_tabStrip"],',
  'body[data-liuli-settings-open] [data-liuli-pane-drag] {',
  '  -webkit-app-region: no-drag !important;',
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
  '   （[data-liuli-bg]）；改透明后与兼容模式观感一致 */',
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
  '  padding: 0 !important;',
  '}',
  '/* 对话页最小宽度：渲染期 splitChildPx 已把 CONVERSATION_MIN 换算成 flexGrow 分配（空间足够时优先抬到最小，空间不足时按比例压缩）。这里不能再给 shard 写 min-width: 640px —— flex 项的硬性 min 下限会让「固定列 + 会话列」之和超过小视口，右缘固定面板溢出并盖住相邻卡片（窗口最大化→还原必现）。surface 的 min-width 仍置 0。 */',
  'body[data-dsh-desktop-mode="advanced"] [class*="_shard"]:has([data-region-pane="region:conversation"]) {',
  `  min-width: 0 !important;`,
  '}',
  'body[data-dsh-desktop-mode="advanced"] .dshDesktopConversationSurface {',
  '  min-width: 0 !important;',
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
  '   去掉左缘分割线（用户确认冗余；sash 已承担分隔/缩放语义） */',
  'body[data-dsh-desktop-mode="advanced"] [class*="_detailsCol"] [class*="_panel"] {',
  '  border-left: none !important;',
  '}',
  '/* 右侧边栏（详情列）底部触底：advanced/dock 模式下保留顶部与左侧留白，',
  '   去掉底部 16px 空隙，让面板底边贴到窗口底部（用户要求）。 */',
  'body[data-dsh-desktop-mode="advanced"] .dshDesktopDetailsSurface {',
  '  padding-bottom: 0 !important;',
  '}',
  '/* 底部触底后不再用底部圆角：右侧边栏底边贴窗口，保持直角。 */',
  'body[data-dsh-desktop-mode="advanced"] [class*="_detailsCol"] [data-preview-panel] {',
  '  border-radius: var(--liuli-radius, 14px) 0 0 0 !important;',
  '}',
  '/* 详情列在左：镜像为左贴边直角、右上角保留圆角（右缘留 16px 间隙）。 */',
  'body[data-dsh-desktop-mode="advanced"] .dshDesktopDetailsSurface[data-edge-left] [data-preview-panel] {',
  '  border-radius: 0 var(--liuli-radius, 14px) 0 0 !important;',
  '}',
  '/* 侧栏根被 slot 注入内联宽度（280px 列宽），会顶掉右留白；',
  '   100% !important 收回内容盒，恢复卡片间隙（收起态 padding 0 时不受影响） */',
  'body[data-dsh-desktop-mode="advanced"] [class*="_sidebarCol"] > div > [class*="_root"] {',
  '  width: 100% !important;',
  '}',
  '/* ── 无边框窗口拖动区：win32 去掉 caption 行后，各「贴顶卡片」的顶部条带承担窗口拖动 ── */',
  '/* 门控 [data-edge-top]：只有触及 dock 画布顶边的卡片（data-edge-top，由 edgeMap 实测）',
  '   的顶部 chrome 才是窗口拖拽区；dockable 布局中拆到下方/中间的卡片其 chrome 保持',
  '   自身语义（标签条排序/面板拖拽），不会误拖窗口。悬浮窗（dock-float）不参与。 */',
  '/* 会话页头（独立面板或回退到正文面板内）整体 drag，空白处可拖窗 */',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation-header"][data-edge-top] header,',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"][data-edge-top] header {',
  '  -webkit-app-region: drag;',
  '}',
  '/* 页头内交互元素保持可点（no-drag 挖洞覆盖父级 drag） */',
  'body[data-dsh-desktop-mode="advanced"] :is([data-region-pane="region:conversation-header"][data-edge-top], [data-region-pane="region:conversation"][data-edge-top]) header :is(button, a, input, select, textarea, label, [role="button"], [role="tab"], [role="menuitem"], [role="combobox"], [role="listbox"], [contenteditable], [data-liuli-window-controls]) {',
  '  -webkit-app-region: no-drag;',
  '}',
  '/* dock 面板标签条空白区（tabFiller）也可拖动窗口（仅贴顶面板）；标签 chip no-drag 保持可拖拽/可点 */',
  'body[data-dsh-desktop-mode="advanced"] [data-testid="dock-pane"][data-edge-top] [data-testid="dock-tab-strip"] {',
  '  -webkit-app-region: drag;',
  '}',
  'body[data-dsh-desktop-mode="advanced"] [data-testid="dock-pane"][data-edge-top] [data-testid="dock-tab-strip"] [data-testid="dock-tab-chip"] {',
  '  -webkit-app-region: no-drag;',
  '}',
  '/* 侧栏卡片顶部（logoRow，60px）可拖窗：侧栏常驻贴顶，其顶部即窗口拖拽区；',
  '   内部交互元素（折叠钮/logo 等）no-drag 保持可点 */',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:sidebar"][data-edge-top] [class*="_logoRow"] {',
  '  -webkit-app-region: drag;',
  '}',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:sidebar"][data-edge-top] [class*="_logoRow"] :is(button, a, input, select, textarea, [role], [tabindex], [contenteditable]) {',
  '  -webkit-app-region: no-drag;',
  '}',
  '/* 详情卡片顶部（右侧面板标签条，48px）可拖窗（详情贴顶时）；标签/按钮 no-drag 保持可点可拖排序 */',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:details"][data-edge-top] [data-preview-panel] [class*="_tabStrip"] {',
  '  -webkit-app-region: drag;',
  '}',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:details"][data-edge-top] [data-preview-panel] [class*="_tabStrip"] :is(button, a, [data-side-pane-tab-id], [role], [tabindex]) {',
  '  -webkit-app-region: no-drag;',
  '}',
  '/* 开始页（会话 header 隐藏 display:none）：激活会话面板顶部拖动条，顶部可拖窗 */',
  'body[data-dsh-desktop-mode="advanced"] [data-region-pane="region:conversation"][data-edge-top]:has(header[aria-hidden]) [data-liuli-pane-drag] {',
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

/** Web（兼容模式/纯浏览器）Dockable 布局壳样式。
 *  桌面插件的 ADVANCED_STYLES 只在 DSH Desktop 的 advanced 壳注入，Web UI 下
 *  不存在；DockShellFrame 在 Web 下接管 root 时需要等价的壳结构（帧网格/表面/
 *  覆盖层）与外观配方（表面透明/去分割线/贴边直角）。全部规则以
 *  [data-testid="dock-shell"][data-shell-mode="web"]（仅琉璃 Web dock 帧渲染）
 *  为根作用域：原生 advanced 壳（dock 开或关）与兼容模式 AppFrame 均不含该
 *  标记，零影响；advanced 模式的同名配方继续走 DESKTOP_ADVANCED_CSS。 */
const WEB_DOCK_SHELL_CSS = [
  '/* ── Web Dockable 布局壳（结构：桌面 ADVANCED_STYLES 的最小等价物）── */',
  '[data-testid="dock-shell"][data-shell-mode="web"] {',
  '  position: relative; display: grid; grid-template-rows: 100%; width: 100%; height: 100%; overflow: hidden; background: transparent;',
  '}',
  '[data-testid="dock-shell"][data-shell-mode="web"] .dshDesktopMacCaptionRow { display: none; }',
  '[data-testid="dock-shell"][data-shell-mode="web"] .dshDesktopSidebarSurface {',
  '  position: relative; min-width: 0; overflow: hidden; background: transparent; border-right: none;',
  '}',
  '[data-testid="dock-shell"][data-shell-mode="web"] .dshDesktopUpstreamSidebar { box-sizing: border-box; width: 100%; height: 100%; }',
  '[data-testid="dock-shell"][data-shell-mode="web"] .dshDesktopConversationSurface {',
  '  min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: transparent;',
  '}',
  '[data-testid="dock-shell"][data-shell-mode="web"] .dshDesktopDetailsSurface {',
  '  min-width: 0; min-height: 0; overflow: hidden; background: transparent; border-left: none;',
  '}',
  '[data-testid="dock-shell"][data-shell-mode="web"] .dshDesktopOverlay { position: absolute; z-index: 1000; inset: 0; pointer-events: none; }',
  '[data-testid="dock-shell"][data-shell-mode="web"] .dshDesktopOverlay > * { pointer-events: auto; }',
  '/* ── Web 外观配方（镜像 DESKTOP_ADVANCED_CSS 的 dock 相关规则）── */',
  '[data-testid="dock-shell"][data-shell-mode="web"] [class*="_shard"]:has([data-region-pane="region:conversation"]) { min-width: 0 !important; }',
  '[data-testid="dock-shell"][data-shell-mode="web"] .dshDesktopConversationSurface { min-width: 0 !important; }',
  '[data-testid="dock-shell"][data-shell-mode="web"] [class*="_detailsCol"] [class*="_panel"] { border-left: none !important; }',
  '[data-testid="dock-shell"][data-shell-mode="web"] .dshDesktopDetailsSurface { padding-bottom: 0 !important; }',
  '[data-testid="dock-shell"][data-shell-mode="web"] [class*="_detailsCol"] [data-preview-panel] { border-radius: var(--liuli-radius, 14px) 0 0 0 !important; }',
  '[data-testid="dock-shell"][data-shell-mode="web"] .dshDesktopDetailsSurface[data-edge-left] [data-preview-panel] { border-radius: 0 var(--liuli-radius, 14px) 0 0 !important; }',
  '[data-testid="dock-shell"][data-shell-mode="web"] [class*="_sidebarCol"] > div > [class*="_root"] { width: 100% !important; }',
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
 *  （侧栏根 z-index:1 上下文内 z-index:1000）。琉璃自己的浮层（advanced shell
 *  浮动窗口）z-index 高达 2147482xxx，会盖住设置页 ——
 *  检测此模态出现/消失，供浮层让位（body 标记 + CSS 隐藏）。 */
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
  style.textContent = liuliCss + '\n' + WIDE_MODE_CSS + '\n' + SETTINGS_DEFER_CSS + '\n' + DESKTOP_ADVANCED_CSS + '\n' + WEB_DOCK_SHELL_CSS
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
    for (const key of ['sidebar', 'conversation', 'details', 'shell.overlay']) {
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
 * Client plugin body: mount the theme, the Liuli UI settings section,
 * the runtime + toggle bridge, and the session header effects.
 * @param ctx - client cordis context.
 */
export function apply(ctx: ClientContext): void {
  injectThemeCss()

  // ── 非官方增强开关（兼容其它插件）：启动时同步读取 localStorage，决定以下各
  //    挂载点是否生效。总开关关闭或对应分组关闭时，相应功能完全不挂载（不留
  //    DOM 观察器 / 不接管布局 / 不触发宿主补丁），只保留官方扩展点功能
  //    （主题 / 声纹 / 右侧边栏 / 设置页）。更改后需刷新页面生效。 ──
  const bootSettings = ((): LiuliSettings => {
    try {
      const raw = localStorage.getItem(LIULI_LS_KEY)
      if (raw) return liuliSettingsOf(JSON.parse(raw))
    } catch (_) { /* 损坏则回落默认 */ }
    return LIULI_SETTINGS_DEFAULTS
  })()
  /** 分组判定：总开关关闭则全部关闭；否则按分组开关。 */
  const unofficial = (group: 'layout' | 'desktop' | 'sidebar' | 'browser' | 'dom'): boolean => {
    if (!bootSettings.unofficial_enabled) return false
    switch (group) {
      case 'layout': return bootSettings.unofficial_layout
      case 'desktop': return bootSettings.unofficial_desktop
      case 'sidebar': return bootSettings.unofficial_sidebar
      case 'browser': return bootSettings.unofficial_browser
      default: return bootSettings.unofficial_dom
    }
  }
  /** 六个开关的指纹（用于远端设置与启动生效值不一致时触发重载）。 */
  const unofficialFlagsOf = (s: LiuliSettings): string =>
    [s.unofficial_enabled, s.unofficial_layout, s.unofficial_desktop, s.unofficial_sidebar, s.unofficial_browser, s.unofficial_dom].join(',')

  // 右侧边栏系列增强开关（详情列 / 预览按钮 / 自动展开）同属 unofficial_sidebar：
  // DockShellFrame 依此决定是否把 detail 区域纳入 dock 布局（关闭时剔除 region:details）。
  ;(window as unknown as { __liuliSidebarEnabled__?: boolean }).__liuliSidebarEnabled__ = unofficial('sidebar')

  // ── advanced（无边框）模式别名挂载：桌面 shell 元素补上上游结构类名，──
  // ── 让兼容模式配方（[class*="_frame"]/"_sidebarCol"/"_centerCol"/"_detailsCol"）直接命中 ──
  // advanced 模式下宿主 shell（.dshDesktopFrame 网格）替换上游 AppFrame，
  // 哈希结构类全部消失导致琉璃大部分样式失效；给 shell 表面挂同名别名类即可复用配方。
  // Web 模式下 Dockable 布局接管 root 时同理（琉璃自己的帧渲染同一批 dshDesktop*
  // 元素）；兼容模式原生 AppFrame（dock 关闭）没有这些元素，观察为无害空转。
  ctx.effect(() => {
    if (!unofficial('layout')) return () => {}
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
  }, 'dsh-liuli-ui-enhance: advanced shell alias classes')

  // ── Dockable 布局 shell（advanced 桌面壳 / Web UI 两种环境）：把宿主既有布局改造成可停靠布局 ──
  // advanced 模式下官方 ui-layout 被禁用；桌面 shell（dsh-plugin-desktop）提供 layout 服务
  // 并占用 root slot（AdvancedFrame）。Web UI（兼容模式/纯浏览器）下官方 ui-layout 的
  // AppFrame 声明同一套 slot（root + sidebar/conversation/details/shell.overlay）。
  // 琉璃以更低的渲染优先级（priority -1）接管 root slot，
  // 并覆盖 layout 服务指向自己的 dock store —— 三大区域（侧边栏/会话/详情）成为可拖拽面板：
  // 拖拽/四向拆分/边缘与面板内停靠/浮动窗口/标签页合并/sash 缩放 + Workspace 保存/恢复。
  // 子 slot（sidebar/conversation/details/shell.overlay）的声明归桌面 shell（advanced）
  // 或官方 AppFrame（Web），本插件借 ctx.slots.inject('sidebar') 等到声明落地后再注册
  // root 占用者，避免重复声明。
  if (unofficial('layout')) {
    const isAdvancedShell = new URLSearchParams(window.location.search).get('dsh-desktop-mode') === 'advanced'
    const shellHandle = createDockShellStore().create()
    // 宿主布局面：advanced 用桌面 layout 服务（须带 getSnapshot/subscribe 完整面）；
    // Web 用琉璃同构 store（createWebHostLayout），并把官方 LayoutController 的
    // 面板动作经 attachPanels（公开重注册路径）重定向到该 store —— ui-sidebar 折叠
    // 按钮、ui-conversation 详情开合等外部调用方继续生效；本插件卸载后官方
    // AppFrame 重新渲染会重新 attach 绑回自己的 store（自愈）。
    let hostLayout: HostLayoutFace = ctx.layout as unknown as HostLayoutFace
    /** root 注册 inject 工厂内的动作重定向（与官方 AppFrame 的 inject hook
     *  attachPanels 同路径、同时机）：inject 在 entry 每次渲染组合时运行，
     *  保证了「渲染 root cell 的那个 entry 最后一次 attach」——琉璃 cell 被
     *  abdicate 回退官方 AppFrame 时，官方 inject 自动把控制器绑回官方 store。 */
    let attachWebLayout: (() => void) | undefined
    const advancedFaceReady = isAdvancedShell
      && typeof (ctx.layout as unknown as { getSnapshot?: unknown }).getSnapshot === 'function'
      && typeof (ctx.layout as unknown as { subscribe?: unknown }).subscribe === 'function'
    if (!advancedFaceReady) {
      const webLayout = createWebHostLayout()
      hostLayout = webLayout.face
      attachWebLayout = () => {
        ;(ctx.layout as unknown as { attachPanels?: (actions: unknown) => void }).attachPanels?.(webLayout.bakedActions)
      }
      // 尽早重定向一次（官方 AppFrame 若先渲染过，会在这里被覆盖回来）。
      ctx.effect(() => {
        attachWebLayout?.()
        return () => {}
      }, 'dsh-liuli-ui-enhance: web layout actions redirect')
      // 窄视口喂 narrow（官方 AppFrame 的 setNarrow 职责；Web 下帧占满视口）。
      ctx.effect(() => {
        const onResize = (): void => { webLayout.setNarrow(window.innerWidth < SIDEBAR_AUTO_COLLAPSE) }
        onResize()
        window.addEventListener('resize', onResize)
        return () => { window.removeEventListener('resize', onResize) }
      }, 'dsh-liuli-ui-enhance: web layout narrow watcher')
    }
    // 对话页双容器：把 conversation 面板里的 header 槽位容器与正文滚动容器
    // 标记为两个并列容器（CSS 驱动布局），会话切换/面板重挂时由 body 级观察补标记。
    ctx.effect(() => startConversationSplit(), 'dsh-liuli-ui-enhance: conversation header/body split')
    // 自测钩子：无头自测脚本经此驱动宿主 layout 服务与 dock 布局
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
    }, 'dsh-liuli-ui-enhance: dock shell self-test hook')
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
        // 宿主 layout 服务（advanced：桌面 DesktopLayoutState；Web：琉璃同构
        // store 的 face）经 inject 钩子递进帧层：帧层订阅其宽度/narrow 状态，
        // 开合动作走它的 toggleSidebar/openDetails/closeDetails。
        inject: () => {
          // Web 模式：与本 entry 的每次渲染组合同步重定向官方控制器动作
          // （见 attachWebLayout 注释；advanced 下为 undefined 不动作）。
          attachWebLayout?.()
          return { dockShell: shellHandle, hostLayout }
        },
      }
      const disposeRegistration = ctx.slots.register(
        rootOptions as typeof rootOptions & { children: RootChildren },
        DockShellFrame,
      )
      equipRootEntryChildren(ctx)
      ctx.effect(() => () => { unequipRootEntryChildren(ctx) }, 'dsh-liuli-ui-enhance: dock shell children release guard')
      return disposeRegistration
    })
  }

  // ── 会话切换/新消息入场动画：MutationObserver 挂类（动画定义在 liuli.css）──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startLiuliTransition()
  }, 'dsh-liuli-ui-enhance: message transition observer')

  // ── 对话页历史自动加载：上翻到消息列顶部时自动点击“加载更早消息”，
  //    替代手动点击 older 按钮 ──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startAutoLoadHistory()
  }, 'dsh-liuli-ui-enhance: auto load history on scroll top')

  // ── 缩放性能护栏：sash/窗口 resize 期间冻结宿主产物行 RO、关闭磨砂/过渡，
  //    避免长对话拖拽掉帧（详见 resize-perf.ts 注释）──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    installResizePerfWatcher()
    return () => { /* 监听器随页面生命周期常驻，幂等安装无需卸载 */ }
  }, 'dsh-liuli-ui-enhance: resize perf guard')

  // ── 会话 header 视图标签（对话/轨迹）滑动激活指示条：官方横条瞬间切换，
  //    这里注入独立指示条跟随激活 tab 平滑滑动（动画定义在 liuli.css）──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startHeaderTabIndicator()
  }, 'dsh-liuli-ui-enhance: header tab indicator')

  // ── 会话 header 动态文本（标题名/模型/路由等）变化时入场动画：
  //    MutationObserver 检测文本变化后挂 .liuli-header-text-enter ──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startHeaderTextAnimation()
  }, 'dsh-liuli-ui-enhance: header text animation')

  // ── 用户发送的网页元素：在聊天气泡里也渲染成卡片（官方只装饰 /@ chip）──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startElementCardDecoration()
  }, 'dsh-liuli-ui-enhance: element card decoration')

  // ── 会话内联重命名：双击侧栏会话标题进入内联编辑（不弹菜单/对话框）──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startSessionRename(ctx)
  }, 'dsh-liuli-ui-enhance: session inline rename')

  // ── 会话标记：localStorage store + 会话行图标装饰 ──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startSessionMarkerDecoration(ctx)
  }, 'dsh-liuli-ui-enhance: session marker decoration')

  // ── 会话栏右键菜单：右键会话行弹出标记/重命名/分叉/归档（不改官方代码）──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startSessionContextMenu(ctx)
  }, 'dsh-liuli-ui-enhance: session context menu')

  // ── 工作区/目录行右键菜单：重命名/删除工作区（不改官方代码）──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startWorkspaceContextMenu(ctx)
  }, 'dsh-liuli-ui-enhance: workspace context menu')

  // ── 工作区「新建会话」后右侧详情列回弹：官方点完只开新会话，AppFrame 的自动
  //    closeDetails 只在当前会话切换时触发，详情列保持打开不回；这里等官方流程
  //    结束后若详情列仍展开则收回（advanced 走 dock shard、兼容模式走官方列），
  //    已收起时不动（详见 workspace-new-session-collapse.ts）──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startWorkspaceNewSessionCollapse(ctx)
  }, 'dsh-liuli-ui-enhance: workspace new session details collapse')

  // ── 设置页原生下拉 → 琉璃组件：DSH「模型服务商」卡片的原生 <select>（API 协议 /
  //    新增提供商等，宿主 class 后缀 _selectInput）统一换成插件下拉（触发器覆盖 +
  //    body portal 菜单，选择经 change 事件写回宿主受控表单，不改宿主源码）──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startSettingsSelectUpgrade()
  }, 'dsh-liuli-ui-enhance: settings selects upgrade')

  // ── 供应商额度：注入 connection/remote，供 header 工具区显示当前供应商额度 ──
  initSupplierQuota(ctx.get('connection') as ConnectionHandle, ctx.get('modelDirectories'))
  ctx.effect(() => () => disposeSupplierQuota(), 'dsh-liuli-ui-enhance: supplier quota dispose')

  // ── 模型请求重试：注入 connection，供通用设置区编辑各供应商 retryPolicy ──
  initModelRetry(ctx.get('connection') as ConnectionHandle)
  ctx.effect(() => () => disposeModelRetry(), 'dsh-liuli-ui-enhance: model retry dispose')
  // ── 思考等级自动补全：注入 connection，供「功能」分区一键补全自定义提供商 ──
  initThinkingFill(ctx.get('connection') as ConnectionHandle)
  ctx.effect(() => () => disposeThinkingFill(), 'dsh-liuli-ui-enhance: thinking fill dispose')
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
  }, 'dsh-liuli-ui-enhance: supplier quota refresh')

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
  ctx.effect(() => ctx.inputTriggers.registerSource(source), 'dsh-liuli-ui-enhance: element picker source')
  const insertElement = (info: PickedElement): void => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === undefined) return
    const actx = ctx.sessions.scope(current)
    if (actx === undefined) return
    const input = ctx.conversation.input.for(actx)
    const state = input.state.getSnapshot()
    const span = { start: state.draft.length, end: state.draft.length, draftRev: state.draftRev }
    rememberComposerElementInfo(info)
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
  ctx.effect(() => ctx.inputTriggers.registerSource(commitSource), 'dsh-liuli-ui-enhance: commit reference source')

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
  ctx.effect(() => ctx.inputTriggers.registerSource(fileSource), 'dsh-liuli-ui-enhance: file reference source')
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
    if (!unofficial('dom')) return () => {}
    const host = document.createElement('div')
    host.id = 'liuli-floatball-host'
    document.body.appendChild(host)
    const root = createRoot(host)
    root.render(createElement(FloatBall, {
      insertElement,
      openLayoutMenu: () => { window.dispatchEvent(new CustomEvent(DOCK_MENU_TOGGLE_EVENT)) },
    }))
    return () => {
      root.unmount()
      host.remove()
    }
  }, 'dsh-liuli-ui-enhance: float ball mount')

  // ── 页面内窗口按钮（无边框模式）：固定悬浮在窗口右上角，开始页与会话页一致 ──
  // 会话页不再把按钮内联进 header.utilities（此前随 header 排在工具区最右端）：
  // header 卡片带 backdrop-filter，会成为 fixed 后代的包含块、破坏视口定位，
  // 因此统一由 body 级 host 渲染与开始页同款的磨砂胶囊（右上角 6px/10px）。
  // 胶囊内置智能避让：遮挡交互元素（header 工具按钮/详情面板头部/浮动窗口
  // 标题栏等）时自动淡出，悬停右上角检测区唤出（见 WindowControls.tsx）。
  ctx.effect(() => {
    if (!unofficial('desktop')) return () => {}
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
  }, 'dsh-liuli-ui-enhance: window controls fixed top-right')

  // ── 工具区下沉 tabs 行的偏移测量：titleRow 底 → tabs 行底，写入 header ──
  // 工具区（Session log/监听/主题/面板）经 liuli-css.ts 锚定 titleRow 右下角，
  // 再按 --dsh-tabs-offset 下移到与视图标签同一栏（右、下对齐）。tabs 行只在
  // 视图标签 >1 时渲染，视图切换/header 拉伸会改几何：body 级观察 + rAF 节流
  // 重测；无 tabs 行时置 0（工具区留在标题行，CSS :has 条件兜底）。
  ctx.effect(() => {
    let raf = 0
    let last = -1
    const measure = (): void => {
      raf = 0
      const header = document.querySelector<HTMLElement>(
        '[data-region-pane="region:conversation"] header, div[data-phase] > header, div[data-phase] > div > header',
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
  }, 'dsh-liuli-ui-enhance: header tabs offset measure')

  // ── Electron 手动刷新快捷键：DSH Desktop 无边框窗口没有浏览器刷新按钮/菜单，
  //    安装新 bundle 后可用 Ctrl/Cmd+Shift+R（或 F5）整页重载。 ──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    const onKey = (e: KeyboardEvent): void => {
      const wantsReload = (e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyR'
      const wantsReloadF5 = e.key === 'F5'
      if (!wantsReload && !wantsReloadF5) return
      e.preventDefault()
      window.location.reload()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, 'dsh-liuli-ui-enhance: manual reload shortcut')

  // ── 设置页模态让位：设置页（侧栏根内全屏 fixed overlay）打开时，──
  // 琉璃自己的高 z-index 浮层（advanced shell 浮动窗口）会盖住它。
  // 这里检测模态出现/消失：body 打 data-liuli-settings-open 标记（CSS 据此隐藏
  // advanced shell 浮动窗口）。
  ctx.effect(() => {
    let raf = 0
    const update = (): void => {
      raf = 0
      if (isSettingsOverlayOpen()) {
        document.body.setAttribute('data-liuli-settings-open', '')
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
  }, 'dsh-liuli-ui-enhance: settings overlay defer')

  // 扩展面板（辅助对话/开发者工具）的宿主数据面。
  // 定义在 dock shell 之前，供其注入同一份数据面。
  const sidePaneHost: SidePaneHostAccess = {
    sessionList: ctx.sessions.list,
    getSessionFace: id => ctx.sessions.binding(id as SessionId)?.session,
    forkSession: async id => {
      // 辅助对话 fork 的会话只存在于标签页：fork 后立即归档，隐藏于会话列表
      // （binding 仍可寻址，prompt 照常工作；归档由 workspace 侧记账）。
      const childId = await ctx.sessions.fork({ sessionId: id as SessionId, increaseTitle: true })
      try {
        await ctx.workspaces.archiveSession(childId)
      } catch (error) {
        console.warn('liuli side-chat archive failed:', error)
      }
      return childId
    },
    openSession: id => { ctx.sessions.open(id as SessionId) },
    archiveSession: id => ctx.workspaces.archiveSession(id as SessionId),
    archivedSessionIds: {
      getSnapshot: () => ctx.workspaces.list.getSnapshot().archivedSessionIds,
      subscribe: fn => ctx.workspaces.list.subscribe(fn),
    },
  }

  // dock shell 扩展面板的宿主能力桥（advanced 模式下 DockShellFrame 为纯组件，
  // 不碰 cordis；文件入聊天 / 系统打开 / sidePane 数据面经此桥到达宿主服务）。
  setDockHostBridge({
    addFileToChat: insertFileReference,
    openPath: (path: string) => { void ctx.workspaces.openPath(path) },
    sidePaneHost,
  })

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
  // /side、/btw 指令桥：命令在 node 半注册、仅返回成功；这里监听 command/executed
  // （控制面事件，不进模型历史）。
  // - /side：在当前会话侧边栏新建辅助对话标签（fork 在标签首次打开时惰性完成）。
  // - /btw <text>：把问题交给 fork 出的子会话并发回答，回答渲染到正文消息流
  //   末尾的卡片（BtwAnswerHost），不打开侧边栏窗口、不改变主会话上下文。
  ctx.effect(() => ctx.events.on('command/executed', (sessionId: unknown, name: unknown, result: unknown) => {
    if (name !== 'side' && name !== 'btw') return
    const current = ctx.sessions.list.getSnapshot().current
    if (sessionId !== current) return
    const payload = result as { kind?: string; text?: string } | null | undefined
    if (payload?.kind !== 'success') return
    if (name === 'btw') {
      const question = (payload.text ?? '').trim()
      if (question !== '') window.dispatchEvent(new CustomEvent(BTW_ANSWER_EVENT, { detail: { question } }))
      return
    }
    window.dispatchEvent(new CustomEvent(SIDE_CHAT_OPEN_EVENT))
  }), 'dsh-liuli-ui-enhance: /side /btw command bridge')
  // ── 右侧边栏（详细页）面板：占用宿主 details 列（priority -1 替换官方工具详情列）。
  //    unofficial_sidebar 关闭时不注册，宿主 details 列还原为官方内容。 ──
  if (unofficial('sidebar')) {
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
  }

  // ── /btw 正文回答宿主（body 级 root）：fork 当前会话并发回答，
  //    回答卡片 portal 到正文消息流末尾；不打开侧边栏窗口、不改变主会话上下文。 ──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    const hostEl = document.createElement('div')
    hostEl.id = 'liuli-btw-answer-host'
    document.body.appendChild(hostEl)
    const root = createRoot(hostEl)
    root.render(createElement(BtwAnswerHost, {
      host: sidePaneHost,
      sessionList: ctx.sessions.list,
    }))
    return () => {
      root.unmount()
      hostEl.remove()
    }
  }, 'dsh-liuli-ui-enhance: /btw answer host mount')

  // 切换会话时宿主会自动收起 details 列；这里同步重置预览开关，避免下次按钮反向。
  // 宿主收起同样走关闭动画：抑制 RO 同步，防止动画期间被翻回打开。
  // 只在「当前会话真的变了」时重置：session list 的任何其他更新（状态/流式/未读）
  // 也会触发快照变化，若在此处重置会把 previewOpen 拉偏，导致 Ctrl+Alt+B 首按失效。
  let lastCurrentSession = ctx.sessions.list.getSnapshot().current
  ctx.effect(() => {
    if (!unofficial('sidebar')) return () => {}
    return ctx.sessions.list.subscribe(() => {
      const current = ctx.sessions.list.getSnapshot().current
      if (current === lastCurrentSession) return
      lastCurrentSession = current
      setPaneSyncSuppressed(true)
      setPreviewOpen(false)
    })
  }, 'dsh-liuli-ui-enhance: preview open reset on session switch')

  // ── 会话内前端产物点击：拦截本地回环/前端文件链接，切换到预览浏览器模式 ──
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
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
  }, 'dsh-liuli-ui-enhance: frontend artifact preview click')

  ctx.effect(() => ctx.locale.register(LIULI_LOCALE_NS, { zh, en }), 'dsh-liuli-ui-enhance: liuli appearance dictionaries')
  ctx.effect(() => ctx.locale.register(LIULI_FEATURES_LOCALE_NS, { zh: featuresZh, en: featuresEn }), 'dsh-liuli-ui-enhance: liuli features dictionaries')

  // ── 琉璃 界面设置：localStorage 持久化 + 运行时应用 ──
  const liuliStore = createLiuliStore()
  const liuliT = ctx.locale.bind(LIULI_LOCALE_NS)
  let liuliBound: BoundActions<typeof liuliStore> | undefined
  let liuliRev = 0
  const readLiuliSettings = (): LiuliSettings => {
    try {
      const raw = localStorage.getItem(LIULI_LS_KEY)
      if (raw) return liuliSettingsOf(JSON.parse(raw))
    } catch (_) { /* 损坏则回落默认 */ }
    return LIULI_SETTINGS_DEFAULTS
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
          const payload = { settings: readLiuliSettings(), wallpaper: loadWallpaper() }
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
  const writeLiuliSettings = (value: LiuliSettings): void => {
    localDirty = true
    try { localStorage.setItem(LIULI_LS_KEY, JSON.stringify(value)) } catch (_) {}
    pushRemoteState()
  }
  const syncLiuli = (value: LiuliSettings): void => {
    liuliRev += 1
    liuliBound?.syncSettings(value, liuliRev)
  }
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
      const remote = liuliSettingsOf(saved.settings)
      try { localStorage.setItem(LIULI_LS_KEY, JSON.stringify(remote)) } catch (_) {}
      const wallpaper = typeof saved.wallpaper === 'string' && saved.wallpaper.length > 0 ? saved.wallpaper : null
      if (wallpaper !== null) saveWallpaper(wallpaper)
      else clearWallpaper()
      liuliBound?.syncWallpaper(wallpaper)
      syncLiuli(remote)
      void applyLiuliSettings(remote)
      window.dispatchEvent(new CustomEvent('liuli:vp-params'))
      // 远端设置里的非官方开关与启动时生效的不一致（Desktop 重启后首载 localStorage
      // 为空、默认全开，远端才是用户上次的选择）→ 整页重载让开关真正生效。
      // sessionStorage 标记防循环：重载后 boot 读到的就是新值，不会再触发。
      if (unofficialFlagsOf(remote) !== unofficialFlagsOf(bootSettings)) {
        try {
          if (!sessionStorage.getItem('liuli:unofficial-reload')) {
            sessionStorage.setItem('liuli:unofficial-reload', '1')
            window.location.reload()
            return
          }
        } catch (_) { /* sessionStorage 不可用时跳过自动重载 */ }
      }
    } catch (_) { /* Host 路由不可用时保留 localStorage 行为 */ }
  }

  const commitLiuli = (next: LiuliSettings): void => {
    writeLiuliSettings(next)
    syncLiuli(next)
    void applyLiuliSettings(next)
    // 声纹响应参数热载（HeaderEffects 监听后重读）
    window.dispatchEvent(new CustomEvent('liuli:vp-params'))
  }
  const liuliInjected = (actions: BoundActions<typeof liuliStore>): LiuliAppearanceInjected => {
    liuliBound = actions
    liuliBound.syncWallpaper(loadWallpaper())
    liuliBound.syncSettings(readLiuliSettings(), liuliRev)
    return {
      save: (patch) => {
        const next = { ...readLiuliSettings(), ...patch }
        commitLiuli(next)
      },
      reset: () => {
        clearWallpaper()
        liuliBound?.syncWallpaper(null)
        writeLiuliSettings(LIULI_SETTINGS_DEFAULTS)
        syncLiuli(LIULI_SETTINGS_DEFAULTS)
        void applyLiuliSettings(LIULI_SETTINGS_DEFAULTS)
      },
      uploadWallpaper: async (file) => {
        const dataUrl = await compressImage(file)
        saveWallpaper(dataUrl)
        // 琉璃 原版行为：上传后自动切换到壁纸背景模式（动态取色随之生效）
        const current = readLiuliSettings()
        let next: LiuliSettings = current.background_mode === 'image' ? current : { ...current, background_mode: 'image' as const }
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
            const bg_area: LiuliBgArea = {
              x: (1 - w) / 2,
              y: (1 - h) / 2,
              w,
              h,
            }
            next = { ...next, bg_area }
          } catch (_) { /* 取不到图片尺寸时跳过默认选区 */ }
        }
        liuliBound?.syncWallpaper(dataUrl)
        commitLiuli(next)
      },
      removeWallpaper: () => {
        clearWallpaper()
        liuliBound?.syncWallpaper(null)
        pushRemoteState()
        // 移除后若处于壁纸模式，回到跟随主题
        const current = readLiuliSettings()
        if (current.background_mode === 'image') {
          const next = { ...current, background_mode: 'theme' as const }
          commitLiuli(next)
        } else {
          void applyLiuliSettings(current)
        }
      },
    }
  }
  // 初始应用：默认值 + 壁纸立即生效；主题切换时按新明暗重算调色板。
  const liuliBoot = readLiuliSettings()
  void applyLiuliSettings(liuliBoot)
  // Desktop 端口每次重启会变：从 Host 端恢复上次保存的设置/壁纸。
  void loadRemoteState()
  // 跟踪最近一次琉璃设置应用，供 startViewTransition 等待调色板落地后再拍新快照。
  let lastApplyPromise: Promise<void> = Promise.resolve()
  ctx.on('theme/change', () => { lastApplyPromise = applyLiuliSettings(readLiuliSettings()).catch(() => {}) })
  // 启动时序兜底：boot 时 body 的 data-ds-dark-theme 可能尚未被 presenter 应用
  // （插件加载顺序不定），isDark 误判会把亮色板落到暗色主题上（气泡等颜色"对调"），
  // 且之后若无新的 theme/change 事件就无人纠正。监听 body 属性变化，一旦 presenter
  // 应用/切换主题就按最新明暗重新应用调色板（幂等，低频触发）。
  ctx.effect(() => {
    const mo = new MutationObserver(() => { lastApplyPromise = applyLiuliSettings(readLiuliSettings()).catch(() => {}) })
    mo.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => { mo.disconnect() }
  }, 'dsh-liuli-ui-enhance: body theme observer')

  // 窗口尺寸变化后只重新应用壁纸层：bgGeometry 会按最新窗口宽高比动态归一化选区
  // （保持选区中心与面积、仅调整宽高比），窗口绝对像素尺寸不应改写 bg_area。
  // bg_area 是“相对原图的绝对选区”（0..1 图片坐标），旧实现按窗口像素宽高比缩放并
  // writeLiuliSettings 持久化它，会破坏选区宽高比、经 fit/clamp 累积中心漂移，导致
  // “最大化→还原→最大化”后壁纸位置与上次不一致。
  ctx.effect(() => {
    let raf = 0
    const onResize = (): void => {
      if (raf !== 0) return
      raf = requestAnimationFrame(() => {
        raf = 0
        // 轻量同步：只更新壁纸层，不重新跑动态取色，避免 resize 延迟。
        applyLiuliWallpaper(readLiuliSettings())
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
    }
  }, 'dsh-liuli-ui-enhance: window resize reapply')

  // ── 琉璃 日/夜切换事件桥：header 主题按钮 dispatch，这里走正式路径 ──
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
      const apply = async (): Promise<void> => {
        ctx.theme.setTheme(id)
        // 等待琉璃调色板/设置落地后再让 View Transition 拍新快照，
        // 避免圆形遮罩动画期间颜色“二次跳变”。
        await lastApplyPromise
      }
      if (typeof document.startViewTransition === 'function' && !reduce) {
        document.startViewTransition(apply)
      } else {
        void apply()
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
    window.addEventListener('liuli:toggle-theme', onToggleTheme)
    window.addEventListener('liuli:set-theme', onSetTheme)
    return () => {
      ;(window as unknown as { __liuliThemeBridge__?: boolean }).__liuliThemeBridge__ = false
      window.removeEventListener('liuli:toggle-theme', onToggleTheme)
      window.removeEventListener('liuli:set-theme', onSetTheme)
    }
  }, 'dsh-liuli-ui-enhance: liuli theme toggle bridge')

  // ── 设置页「外观」分区（settings.section）：取色/背景/材质/字体/圆角/泛光/阴影/壁纸 ──
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'liuli-appearance',
    order: 30,
    label: () => liuliT('nav'),
    store: liuliStore,
    locale: LIULI_LOCALE_NS,
    inject: liuliInjected,
  }, LiuliAppearanceSection))

  // ── 设置页「外观」行：以同 id + 更低 priority 替换官方 AppearanceRow ──
  //    点击带圆形遮罩过渡（liuli:set-theme 事件桥），桥未就绪时降级直连。
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

  // ── 设置页「功能」分区（settings.section）：宽边/会话动画/声纹 + 模型重试/历史加载 ──
  // 与「外观」分区共享同一 liuli store：模型重试与历史加载状态存在合并 store 的
  // modelRetry / historyLoad 切片（原通用分区两行归拢至此），写入面经注入面接线。
  // 模型重试写入由宿主各供应商 profile 持有的 retryPolicy（dsh-llm-retry 执行），
  // path-addressed settings.mutate 只改 retryPolicy 键，不碰密钥等其它字段。
  const featuresT = ctx.locale.bind(LIULI_FEATURES_LOCALE_NS)
  const liuliFeaturesInjected = (actions: BoundActions<typeof liuliStore>): LiuliFeaturesInjected => {
    liuliBound = actions
    liuliBound.syncWallpaper(loadWallpaper())
    liuliBound.syncSettings(readLiuliSettings(), liuliRev)
    return {
      save: (patch) => {
        const next = { ...readLiuliSettings(), ...patch }
        commitLiuli(next)
      },
      reset: () => {
        clearWallpaper()
        liuliBound?.syncWallpaper(null)
        writeLiuliSettings(LIULI_SETTINGS_DEFAULTS)
        syncLiuli(LIULI_SETTINGS_DEFAULTS)
        void applyLiuliSettings(LIULI_SETTINGS_DEFAULTS)
      },
      modelRetryReload: async () => {
        const snap = await loadModelRetry()
        cacheModelRetryBackoff(snap.maxDelayMs, snap.jitterRatio)
        liuliBound?.syncModelRetry({
          maxRetries: snap.maxRetries,
          initialDelayMs: snap.initialDelayMs,
          maxDelayMs: snap.maxDelayMs,
          jitterRatio: snap.jitterRatio,
          providerCount: snap.providerCount,
          status: 'ready',
          error: '',
        })
      },
      modelRetrySave: async (params) => {
        liuliBound?.syncModelRetry({ status: 'saving' })
        const err = await saveModelRetry(params)
        if (err !== undefined) {
          liuliBound?.syncModelRetry({ status: 'error', error: err })
        } else {
          liuliBound?.syncModelRetry({ status: 'ready', error: '' })
        }
        return err
      },
      historyLoad: () => {
        const batches = loadHistoryBatches()
        liuliBound?.syncHistoryLoad({ batches, status: 'ready', error: '' })
        return batches
      },
      historySave: (batches) => {
        saveHistoryBatches(batches)
        liuliBound?.syncHistoryLoad({ batches, status: 'ready', error: '' })
      },
      thinkingFillReload: async () => {
        const need = await loadThinkingFill()
        liuliBound?.syncThinkingFill({
          providerCount: need.providerCount,
          modelCount: need.modelCount,
          status: 'ready',
          error: '',
        })
      },
      thinkingFillApply: async () => {
        liuliBound?.syncThinkingFill({ status: 'saving', error: '' })
        const result = await applyThinkingFill()
        if (!result.ok) {
          liuliBound?.syncThinkingFill({ status: 'error', error: result.error ?? '' })
          return result.error
        }
        // 补全成功后重新扫描：无待补数量时展示成功文案。
        const need = await loadThinkingFill()
        liuliBound?.syncThinkingFill({
          providerCount: need.providerCount,
          modelCount: need.modelCount,
          status: 'ready',
          error: '',
          lastFilled: { providers: result.filledProviders, models: result.filledModels },
        })
        return undefined
      },
    }
  }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'liuli-features',
    order: 31,
    label: () => featuresT('nav'),
    store: liuliStore,
    locale: LIULI_FEATURES_LOCALE_NS,
    inject: liuliFeaturesInjected,
  }, LiuliFeaturesSection))

  // ── 思考等级自动补全：新添加的自定义提供商自动声明思考等级 ──
  // settings/document-updated 在设置文档（settings.yaml）变化时广播——
  // 在「模型提供商」页添加/修改提供商即触发；启动时先做一次「基底登记」
  // （只记录现有提供商、不写配置），之后只自动补「新出现」的路由；
  // 历史缺声明的（本次上线前已添加的）仍由「功能」分区按钮手动补全。
  {
    let fillTimer: ReturnType<typeof setTimeout> | undefined
    let filling = false
    const tickFill = async (): Promise<void> => {
      if (filling) return
      filling = true
      try {
        const result = await autoApplyThinkingFill()
        if (result.changed) {
          const need = await loadThinkingFill()
          liuliBound?.syncThinkingFill({
            providerCount: need.providerCount,
            modelCount: need.modelCount,
            status: 'ready',
            error: '',
            lastFilled: { providers: result.filledProviders, models: result.filledModels },
          })
        }
      } catch {
        // 静默：连接未就绪等场景下个事件再试。
      } finally {
        filling = false
      }
    }
    const scheduleFill = (): void => {
      if (fillTimer !== undefined) clearTimeout(fillTimer)
      fillTimer = setTimeout(() => { void tickFill() }, 500)
    }
    const disposers = [
      ctx.remote.$on('settings/document-updated', scheduleFill),
      ctx.on('connection/reset', scheduleFill),
    ]
    // 启动后做一次基底登记（以及复位后补漏）。
    const bootTimer = setTimeout(() => { void tickFill() }, 2000)
    ctx.effect(() => () => {
      for (const dispose of disposers) dispose()
      if (fillTimer !== undefined) clearTimeout(fillTimer)
      clearTimeout(bootTimer)
    }, 'dsh-liuli-ui-enhance: thinking fill watcher dispose')
  }

  // ── 会话 header 效果（供应商额度/声纹/监听/主题切换/拉伸手柄）──
  // 额度放在 header.actions：排到后台任务/子代理等官方入口右侧，作为普通文本而非工具区胶囊。
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'liuli-supplier-quota',
    order: 100,
  }, SupplierQuota))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'liuli-voiceprint',
    order: 10,
  }, LiuliHeaderVoiceprint))
  // 手柄与回合导轨挂在官方 header.utilities（最右端）：tabs 条挂载点只存在于
  // 未发布的 harness 改动里，官方版本没有该 slot；utilities 位置最接近。
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'liuli-header-chrome',
    order: 10,
  }, LiuliHeaderChrome))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'liuli-header-resizer',
    order: 15,
  }, LiuliHeaderResizer))
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'liuli-turn-rail',
    order: 20,
  }, TurnRail))
  // 工作区预览开关：点击开合宿主右侧 details 列（不再是 overlay）。
  // unofficial_sidebar 关闭时不注册（右侧边栏整体停用，按钮无意义）。
  if (unofficial('sidebar')) {
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'liuli-preview-button',
      order: 30,
    }, () => createElement(PreviewButton, { onToggle: togglePreview })))
  }
  // ── 全屏按钮：排在切换面板左侧（order 25），图标 Material fullscreen/
  // fullscreen_exit + F11 快捷键，走标准 Fullscreen API。
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'liuli-header-fullscreen',
    order: 25,
  }, LiuliHeaderFullscreen))
  // ── 页面内窗口按钮（无边框模式）：不再注入 header utilities ——
  // 统一由 body 级 host 固定渲染在窗口右上角（见 'dsh-liuli-ui-enhance: window controls fixed top-right'）。

  // ── 轮次结束 · 文件变更卡片：按 step 累计修改文件与 diff，发布自定义 chat 节点 ──
  // 当前 DSH 会话转写没有 turn/start|end 事件（step 化），turnTail 槽不渲染；
  // Definition 按 step 发布 liuli-round-summary 节点，渲染器在本轮最后节点处
  // 展示卡片（文件名 + DIFF 数量 + 审查/打开/展开打开方式）。
  ctx.effect(() => ctx.conversationEvents.register(fileChangesDefinition), 'dsh-liuli-ui-enhance: file-changes definition')
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'liuli-round-summary',
  }, RoundSummaryCard))

  // ── 对话页 edit/write 工具行自动展开（显示文件 diff）──
  // 上游 ToolRow 把 diff 放在默认收起的可折叠 body；这里在会话正文渲染后
  // 把带 diff 的 edit/write 行自动点开一次（虚拟化重挂载后再展开）。
  ctx.effect(() => {
    if (!unofficial('dom')) return () => {}
    return startEditDiffAutoExpand()
  }, 'dsh-liuli-ui-enhance: edit diff auto-expand')

  // ── 详细页自动展开（LLM 活动感知）：模型写/改文件、执行 git 操作时
  //    自动展开右侧详细页并切到「审查文件」标签（每轮一次；用户手动收起后
  //    本会话不再自动展开）。浏览器新标签仍走 PreviewPanel 既有导航展开。
  //    属于右侧边栏附属功能：unofficial_sidebar 关闭时一并停用。 ──
  ctx.effect(() => {
    if (!unofficial('sidebar')) return () => {}
    return startAutoOpenDetails()
  }, 'dsh-liuli-ui-enhance: auto open details on llm activity')

  // ── 侧边栏浏览器自动驱动（LLM 活动感知）：模型启动 dev server / 写前端
  //    文件时，自动在右侧边栏打开浏览器标签展示页面（每轮一次；设置项
  //    auto_drive_browser 与 unofficial_browser 均可关闭）。 ──
  ctx.effect(() => {
    if (!unofficial('browser')) return () => {}
    return startAutoDriveBrowser()
  }, 'dsh-liuli-ui-enhance: auto drive sidebar browser on llm activity')
}
