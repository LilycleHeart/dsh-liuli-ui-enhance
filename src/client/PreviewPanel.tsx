/**
 * 右侧边栏（ZCode 侧边面板复刻）：宿主右侧 details 列上的标签式面板切换器。
 *
 * 依据 zcode-reverse 逆向源码（09-renderer-renamed/styles-OqUHW1P0/deobfuscated.js）
 * 逐功能对照实现：
 * - 标签模型/持久化：state model（fae/Qo/is/toe/rs/noe/roe/soe/ioe 等纯函数语义）；
 * - 标签条：48px，概览触发（chevrons-down）+ 可拖拽标签（icon+标题+常驻渐隐关闭钮）
 *   + 新增标签(+)；激活标签自动平滑滚入视野；溢出滚动隐藏滚动条；
 * - 关闭语义：关闭激活标签 → 激活同位右邻；关闭最后一个标签 → 面板收起；
 *   最近关闭上限 8（Roe）；浏览器标签重开时换新 id；
 * - 浏览器标签多实例（browser:<uid>）：新增菜单复用已有浏览器标签，
 *   会话产物链接导航新开标签；同源页面加载后取 document.title 作为标签标题；
 * - 面板类型：Treemapping / 仓库 Wiki / 审查(git) / 浏览器 / 代码查看；
 *   图标路径数据取自 ZCode bundle 的 lucide 定义；
 * - 概览弹层（w-72）：搜索（ZCode 加权排序：title 前缀 120/词界 90/包含 70/hint 40/类型 20）
 *   + 打开的标签页（相对时间+关闭钮）+ 最近关闭的标签页（点击重开）；
 * - 空状态「打开标签页」卡片（h-12 rounded-xl 按钮列）；
 * - 快捷键 Ctrl/Cmd+Alt+B 切换面板（ZCode：切换右侧面板）；Ctrl/Cmd+K 命令中心；
 * - 宽度：左缘手柄拖拽，min 240px、max 65%、首次打开默认 45%（ZCode sqt/Eqt），
 *   localStorage 持久化（ZCode 为内存态，此处为适配 DSH 热重载的扩展）；
 *   ZCode 无 maximize/restore（i18n 死键），本实现同样不提供；
 * - 元素拾取：浏览器面板工具条按钮显式开启（ZCode browser.elementPicker 语义）。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { attachElementPicker, describeElement, computedColor, type PickedElement } from './element-picker.ts'
import {
  detectWebviewEngine, reportGeometryLoop, subscribeWebviewGlobal, subscribeWebviewTab,
  webviewBrowser, type WebviewTabState,
} from './browser-webview.ts'
import {
  CommandPalette, FileTreePanel, GitPanel, WikiPanel, type CommandPaletteCommand,
} from './RightSidebarPanels.tsx'
import { fetchSidebarTree } from './right-sidebar-api.ts'
import {
  BugIcon, ChevronsDownIcon, FileCodeCornerIcon, FileDiffIcon, GlobeIcon, ListTreeIcon, MapIcon,
  MessageSquareTextIcon, NotepadTextIcon, PanelRightCloseIcon, PanelRightOpenIcon, PaletteIcon,
  PlusIcon, RepoWikiIcon, SearchIcon as SearchGlyph, SquareTerminalIcon, WaypointsIcon,
} from './SidePaneIcons.tsx'
import {
  DeveloperToolsPanel, PlanPanel, SideChatPanel, SubagentPanel, TerminalPanel, TrajectoryPanel,
  WhiteboardPanel, type SidePaneHostAccess,
} from './SidePaneExtraPanels.tsx'
import css from './PreviewPanel.module.css'

/** 打开/关闭事件名（header 按钮翻转模块状态后广播，面板同步）。 */
export const PREVIEW_TOGGLE_EVENT = 'liuli:preview-toggle'

/** 导航事件名：会话内点击前端产物时由全局点击拦截器广播。 */
export const PREVIEW_NAVIGATE_EVENT = 'liuli:preview-navigate'

/** 预览列开关的模块级状态（header 按钮与 details 面板共享）。 */
let previewOpen = false

/** 翻转预览列开关状态，返回翻转后的值。 */
export function togglePreviewOpen(): boolean {
  previewOpen = !previewOpen
  return previewOpen
}

/** 设置预览列开关状态（关闭按钮/会话切换时同步）。 */
export function setPreviewOpen(open: boolean): void {
  previewOpen = open
}

/**
 * 关闭动画保护：宿主 details 轨道带 CSS 过渡，主动关闭后列宽在约 200ms 内
 * 逐渐归零；期间 ResizeObserver 仍会看到宽度 >1，若不抑制会把 open 翻回 true
 * 导致宽度覆盖把列重新拉开（与关闭意图打架）。主动关闭时置位，观察到
 * 宽度归零或超时后自动解除。
 */
let paneSyncSuppressed = false
let paneSyncTimer: number | undefined

/** 主动关闭路径调用：暂时屏蔽 RO 的「宽度>1 ⇒ 打开」同步。 */
export function setPaneSyncSuppressed(v: boolean): void {
  paneSyncSuppressed = v
  if (paneSyncTimer !== undefined) {
    window.clearTimeout(paneSyncTimer)
    paneSyncTimer = undefined
  }
  if (v) paneSyncTimer = window.setTimeout(() => { paneSyncSuppressed = false }, 800)
}

/** 判断是否为本地回环地址（前端产物 dev server 常见目标）。 */
function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]'
    || hostname === '0.0.0.0'
    || hostname.endsWith('.localhost')
}

/** 粗略识别“前端产物”相对路径：HTML 文件或常见前端构建输出目录。 */
function looksLikeFrontendPath(path: string): boolean {
  return /\.html?$/i.test(path)
    || /(^|\/)(dist|build|public|out|docs)(\/|$)/i.test(path)
    || path.startsWith('/preview/')
}

/**
 * 把会话内点击的链接解析为预览 iframe 可用的 URL。
 * - 本地回环绝对 URL（localhost/127.0.0.1 dev server）→ 原样交给浏览器模式；
 * - `/preview/...` → 原样；
 * - 相对路径（HTML/前端构建产物）→ 映射到 `/preview/<sessionId>/<path>`；
 * - 外部站点链接 → 返回 undefined，不劫持。
 */
export function resolvePreviewUrl(raw: string, sessionId: string | undefined): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined

  let candidate = trimmed
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):\d/i.test(candidate)) {
    candidate = `http://${candidate}`
  }

  if (/^https?:\/\//i.test(candidate) || /^\/\//.test(candidate)) {
    try {
      const url = new URL(candidate, window.location.href)
      if (isLoopbackHost(url.hostname)) return url.href
    } catch {
      return undefined
    }
    return undefined
  }

  if (sessionId === undefined || sessionId === null) return undefined
  if (candidate.startsWith('/preview/')) return candidate
  if (!looksLikeFrontendPath(candidate)) return undefined

  const clean = candidate.replace(/^\.\//, '').replace(/^\/+/, '')
  const encoded = clean.split('/').map(segment => encodeURIComponent(segment)).join('/')
  return `/preview/${encodeURIComponent(sessionId)}/${encoded}`
}

/**
 * 浏览器标签地址栏（ZCode browser 语义：任意可打开的 URL）。
 * 自动补全 scheme：裸域名走 https，回环主机走 http；同源相对路径原样保留。
 * 非法输入返回 undefined（面板给出 browser.invalidUrl 提示）。
 */
export function normalizeBrowserUrl(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  // about:/data: 原样交给浏览器
  if (/^(about|data):/i.test(trimmed)) return trimmed
  // 同源相对路径（/preview/...、/plugins/... 等）
  if (trimmed.startsWith('/')) return trimmed
  // 协议相对 //host/path
  if (trimmed.startsWith('//')) {
    try { return new URL(`https:${trimmed}`).href } catch { return undefined }
  }
  // 已带 scheme：只放行 http/https
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined
      return u.href
    } catch { return undefined }
  }
  // 无 scheme 的回环主机（localhost:3000 / 127.0.0.1:8080 / 裸 localhost）
  if (/^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i.test(trimmed)) {
    try { return new URL(`http://${trimmed}`).href } catch { return undefined }
  }
  // 无 scheme 的 IPv4（局域网 dev server，如 192.168.1.5:3000）→ http://
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(trimmed)) {
    try { return new URL(`http://${trimmed}`).href } catch { return undefined }
  }
  // 裸域名（example.com / example.com:8080/path）→ https://
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/|$)/i.test(trimmed)) {
    try { return new URL(`https://${trimmed}`).href } catch { return undefined }
  }
  return undefined
}

/* ── 标签模型（ZCode sidePaneState 对应） ── */

/** 面板类型：ZCode 侧边面板在 DSH 内的可复刻集合。 */
export type SidePaneTabType =
  | 'treemapping' | 'repo-wiki' | 'git' | 'browser' | 'code-viewer'
  | 'terminal' | 'developer-tools' | 'trajectory' | 'whiteboard' | 'plan' | 'subagents' | 'side-chat'

/** 一个侧边面板标签。 */
export interface SidePaneTab {
  id: string
  type: SidePaneTabType
  openedAt: number
  /** code-viewer：工作区相对路径。 */
  rel?: string
  /** code-viewer：绝对路径（供默认编辑器打开/复制）。 */
  path?: string
  /** browser：当前 URL。 */
  url?: string
  /** browser：页面标题（同源时取 document.title）；terminal/whiteboard/side-chat：显示名。 */
  title?: string
  /** browser：页面 favicon（webview 引擎 page-favicon-updated，ZCode faviconUrl 对应）。 */
  favicon?: string
  /** side-chat：fork 出的子会话 id。 */
  childSessionId?: string
}

/** 最近关闭的标签（概览里可重开）。 */
interface ClosedTabEntry {
  tab: SidePaneTab
  closedAt: number
}

/** 持久化结构。 */
interface PanePersist {
  v: 1 | 2
  tabs: SidePaneTab[]
  activeTabId: string
  recentClosed: ClosedTabEntry[]
  width: number
}

const LS_KEY = 'liuli:side-pane'
/** ZCode Roe = 8：最近关闭标签上限。 */
const RECENT_CLOSED_MAX = 8
/** ZCode Eqt：侧边面板 minSize 240px。 */
const WIDTH_MIN = 240
/** ZCode Eqt：侧边面板 maxSize = 65%。 */
const WIDTH_MAX_RATIO = 0.65
/** ZCode sqt = 0.45：首次打开默认宽度 = 父容器 45%。 */
const WIDTH_DEFAULT_RATIO = 0.45

/** 浏览器标签 uid（ZCode：browser:<random>）。 */
let browserUid = 0

function loadPersist(): PanePersist {
  const fallback: PanePersist = { v: 2, tabs: [], activeTabId: '', recentClosed: [], width: 0 }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw === null || raw === '') return fallback
    const parsed = JSON.parse(raw) as Partial<PanePersist> & { maximized?: boolean }
    if (parsed === null || typeof parsed !== 'object') return fallback
    return {
      v: 2,
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs.filter((t): t is SidePaneTab => t !== null && typeof t === 'object' && typeof t.id === 'string' && typeof t.type === 'string') : [],
      activeTabId: typeof parsed.activeTabId === 'string' ? parsed.activeTabId : '',
      recentClosed: Array.isArray(parsed.recentClosed) ? parsed.recentClosed.filter((c): c is ClosedTabEntry => c !== null && typeof c === 'object' && typeof (c as ClosedTabEntry).closedAt === 'number') : [],
      width: typeof parsed.width === 'number' && Number.isFinite(parsed.width) ? parsed.width : 0,
    }
  } catch {
    return fallback
  }
}

function savePersist(state: PanePersist): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)) } catch { /* 配额满则放弃 */ }
}

/** 相对时间（ZCode ZS：刚刚 / x分钟前 / x小时前 / x天前）。 */
function relativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/** 标签标题（ZCode V5 对应）。 */
function tabTitle(tab: SidePaneTab): string {
  switch (tab.type) {
    case 'treemapping': return 'Treemapping'
    case 'repo-wiki': return '仓库 Wiki'
    case 'git': return '审查'
    case 'browser': return tab.title?.trim() || '浏览器'
    case 'terminal': return tab.title?.trim() || '终端'
    case 'developer-tools': return '开发者工具'
    case 'trajectory': return '模型调用轨迹'
    case 'whiteboard': return tab.title?.trim() || '画板'
    case 'plan': return '计划'
    case 'subagents': return '子智能体目录'
    case 'side-chat': return tab.title?.trim() || '辅助对话'
    case 'code-viewer': {
      const rel = tab.rel ?? ''
      const name = rel.split('/').filter(p => p !== '').pop()
      return name ?? '代码查看'
    }
  }
}

/** 标签提示（概览行检索/副标题：URL / 路径）。 */
function tabHint(tab: SidePaneTab): string {
  if (tab.type === 'browser') return tab.url ?? ''
  if (tab.type === 'code-viewer') return tab.rel ?? ''
  return ''
}

/** 类型标签（ZCode GKt：概览检索的类型字段）。 */
function tabTypeLabel(tab: SidePaneTab): string {
  switch (tab.type) {
    case 'treemapping': return 'Treemapping'
    case 'repo-wiki': return '仓库 Wiki'
    case 'git': return '审查'
    case 'browser': return '浏览器'
    case 'terminal': return '终端'
    case 'developer-tools': return '开发者工具'
    case 'trajectory': return '模型调用轨迹'
    case 'whiteboard': return '画板'
    case 'plan': return '计划'
    case 'subagents': return '子智能体目录'
    case 'side-chat': return '辅助对话'
    case 'code-viewer': return '代码查看'
  }
}

/** 标签图标（ZCode R5 对应的 DSH 子集）。 */
function TabIcon({ tab, size = 14 }: { tab: SidePaneTab; size?: number }) {
  // ZCode：浏览器标签 chip 用页面 favicon（缺省 globe）。
  if (tab.type === 'browser' && tab.favicon !== undefined && tab.favicon !== '') {
    return <img src={tab.favicon} alt="" width={size} height={size} style={{ borderRadius: 3, flex: 'none' }} />
  }
  switch (tab.type) {
    case 'treemapping': return <MapIcon size={size} />
    case 'repo-wiki': return <RepoWikiIcon size={size} />
    case 'git': return <FileDiffIcon size={size} />
    case 'browser': return <GlobeIcon size={size} />
    case 'terminal': return <SquareTerminalIcon size={size} />
    case 'developer-tools': return <BugIcon size={size} />
    case 'trajectory': return <WaypointsIcon size={size} />
    case 'whiteboard': return <PaletteIcon size={size} />
    case 'plan': return <NotepadTextIcon size={size} />
    case 'subagents': return <ListTreeIcon size={size} />
    case 'side-chat': return <MessageSquareTextIcon size={size} />
    case 'code-viewer': return <FileCodeCornerIcon size={size} />
  }
}

function makeBrowserTab(url: string): SidePaneTab {
  browserUid += 1
  return { id: `browser:${Date.now().toString(36)}-${browserUid}`, type: 'browser', openedAt: Date.now(), url }
}

/** 多实例面板的 uid（terminal/whiteboard/side-chat 各自计数）。 */
let terminalUid = 0
let whiteboardUid = 0
let sideChatUid = 0

function makeTab(type: SidePaneTabType, extra?: Partial<SidePaneTab>): SidePaneTab {
  const base: SidePaneTab = { id: type, type, openedAt: Date.now(), ...extra }
  if (type === 'code-viewer') {
    base.id = `code-viewer:${extra?.rel ?? ''}`
  } else if (type === 'terminal') {
    terminalUid += 1
    base.id = `terminal:${Date.now().toString(36)}-${terminalUid}`
  } else if (type === 'whiteboard') {
    whiteboardUid += 1
    base.id = `whiteboard:${Date.now().toString(36)}-${whiteboardUid}`
  } else if (type === 'side-chat') {
    sideChatUid += 1
    base.id = `side-chat:${Date.now().toString(36)}-${sideChatUid}`
  }
  return base
}

/* ── 概览检索（ZCode OKt 加权排序对应） ── */

function searchTokens(query: string): string[] {
  const seen = new Set<string>()
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(t => t !== '' && !seen.has(t) && (seen.add(t), true))
}

function norm(s: string): string {
  return s.trim().toLocaleLowerCase()
}

function boundaryMatch(hay: string, token: string): boolean {
  return hay.split(/[\s/_.:-]+/).some(part => part.startsWith(token))
}

interface SearchRow<T> {
  item: T
  score: number
  index: number
}

/** ZCode OKt：全部 token 命中才保留；title 前缀 120 / 词界 90 / 包含 70 / hint 40 / 类型 20 / 其他 1。 */
function rankRows<T>(rows: T[], tokens: string[], fields: (item: T) => { title: string; hint: string; typeLabel: string }): SearchRow<T>[] {
  if (tokens.length === 0) return rows.map((item, index) => ({ item, score: 1, index }))
  const scored: SearchRow<T>[] = []
  rows.forEach((item, index) => {
    const f = fields(item)
    const title = norm(f.title)
    const hint = norm(f.hint)
    const typeLabel = norm(f.typeLabel)
    const all = `${title} ${hint} ${typeLabel}`
    if (!tokens.every(t => all.includes(t))) return
    let score = 0
    for (const t of tokens) {
      if (title.startsWith(t)) score += 120
      else if (boundaryMatch(title, t)) score += 90
      else if (title.includes(t)) score += 70
      else if (hint.includes(t)) score += 40
      else if (typeLabel.includes(t)) score += 20
      else score += 1
    }
    scored.push({ item, score, index })
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored
}

/* ── 面板工具条小按钮 ── */

function StripButton(props: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
  buttonRef?: (el: HTMLButtonElement | null) => void
}) {
  return (
    <button
      type="button"
      ref={props.buttonRef}
      className={css.stripBtn + (props.active === true ? ' ' + css.stripBtnActive : '')}
      title={props.label}
      aria-label={props.label}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

/* ── 关闭图标（lucide x） ── */

function XIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  )
}

/* ── 浏览器工具条图标 ── */

function ArrowIcon({ dir, size = 14 }: { dir: 'left' | 'right'; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={dir === 'right' ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  )
}

function ReloadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  )
}

function ExternalIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  )
}

/** 元素拾取钮图标（lucide mouse-pointer-click 近似：ZCode 选择网页元素加入聊天）。 */
function PickerIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4.1 12 6" />
      <path d="m5.1 8-2.9-.8" />
      <path d="m6 12-1.9 2" />
      <path d="M7.2 2.2 8 5.1" />
      <path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z" />
    </svg>
  )
}


/** 响应式视口切换钮图标（lucide smartphone：ZCode browser.responsive.enter/exit）。 */
function ResponsiveIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
      <path d="M12 18h.01" />
    </svg>
  )
}

/** 「更多」菜单触发钮图标（lucide ellipsis：ZCode browser.more）。 */
function MoreIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  )
}

/** 开发者工具菜单项图标（lucide code：ZCode browser.devtools）。 */
function DevToolsIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  )
}

/* ── 主组件 props ── */

/** 侧边面板组件（宿主 details 列占用者）。 */
export interface PreviewDetailsPanelProps {
  /** 当前会话 id（由 details slot 注入）。 */
  sessionId?: string
  /** 打开 details 列（由 layout 注入）。 */
  openDetails?: () => void
  /** 关闭 details 列（由 layout 注入）。 */
  closeDetails?: () => void
  /** 把拾取的元素作为引用 chip 插入当前会话输入框。 */
  insertElement: (info: PickedElement) => void
  /** 把文件路径作为引用插入当前会话输入框。 */
  addFileToChat?: (path: string) => void
  /** 用宿主默认应用打开路径。 */
  openPath?: (path: string) => void
  /** 新建会话。 */
  startSession?: () => void
  /** 打开文件夹（注册工作区）。 */
  pickDirectory?: () => void
  /** 切换日/夜主题。 */
  toggleTheme?: () => void
  /** 上一个会话。 */
  prevSession?: () => void
  /** 下一个会话。 */
  nextSession?: () => void
  /** 扩展面板（轨迹/计划/子智能体/辅助对话/开发者工具）的宿主数据面。 */
  host?: SidePaneHostAccess
}

/**
 * Render the ZCode-style side pane in the host details column.
 * @param props - session id, layout callbacks, element/file insertion callbacks.
 * @returns the pane tree.
 */
export function PreviewDetailsPanel({
  sessionId, openDetails, closeDetails, insertElement,
  addFileToChat, openPath, startSession, pickDirectory, toggleTheme,
  prevSession, nextSession, host,
}: PreviewDetailsPanelProps) {
  const [open, setOpen] = useState(previewOpen)
  const [persist, setPersist] = useState<PanePersist>(loadPersist)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [fileDialogOpen, setFileDialogOpen] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; tabId: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const panelRef = useRef<HTMLDivElement | null>(null)
  const tabsViewportRef = useRef<HTMLDivElement | null>(null)
  const overviewBtnRef = useRef<HTMLButtonElement | null>(null)
  const addBtnRef = useRef<HTMLButtonElement | null>(null)
  const lastSession = useRef(sessionId)
  const dragTab = useRef<string | null>(null)
  const resizing = useRef(false)

  const { tabs, activeTabId, recentClosed, width } = persist
  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0]

  const patch = useCallback((p: Partial<PanePersist>) => {
    setPersist(prev => {
      const next = { ...prev, ...p }
      savePersist(next)
      return next
    })
  }, [])

  /* ── 开合同步 ── */

  useEffect(() => {
    const onToggle = (): void => { setOpen(previewOpen) }
    window.addEventListener(PREVIEW_TOGGLE_EVENT, onToggle)
    return () => { window.removeEventListener(PREVIEW_TOGGLE_EVENT, onToggle) }
  }, [])

  // details 列始终挂载：用 ResizeObserver 跟随真实列宽同步开关状态。
  useLayoutEffect(() => {
    const el = panelRef.current
    if (el === null) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 1) {
        if (paneSyncSuppressed) return
        setPreviewOpen(true)
        setOpen(true)
      } else {
        setPaneSyncSuppressed(false)
        setPreviewOpen(false)
        setOpen(false)
      }
    })
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [])

  // 切换会话时宿主自动收起 details 列：同步开关（标签集合保留）。
  useEffect(() => {
    if (lastSession.current !== undefined && lastSession.current !== sessionId) {
      setPreviewOpen(false)
      setOpen(false)
    }
    lastSession.current = sessionId
  }, [sessionId])

  /* ── 标签操作（ZCode 纯函数语义对应） ── */

  const activateTab = useCallback((id: string) => { patch({ activeTabId: id }) }, [patch])

  /** ZCode Qo：同 id 就地替换并激活；否则追加并激活。 */
  const openTab = useCallback((tab: SidePaneTab) => {
    setPersist(prev => {
      const index = prev.tabs.findIndex(t => t.id === tab.id)
      const nextTabs = index >= 0
        ? prev.tabs.map(t => t.id === tab.id ? tab : t)
        : [...prev.tabs, tab]
      const next: PanePersist = { ...prev, tabs: nextTabs, activeTabId: tab.id }
      savePersist(next)
      return next
    })
  }, [])

  /** 收起面板（ZCode：关闭最后一个标签 → isSidePaneCollapsed）。 */
  const collapsePane = useCallback((): void => {
    setPaneSyncSuppressed(true)
    setPreviewOpen(false)
    closeDetails?.()
    window.dispatchEvent(new CustomEvent(PREVIEW_TOGGLE_EVENT))
  }, [closeDetails])

  /** ZCode is + toe：关闭标签；激活标签被关时激活同位右邻；关完收起面板。 */
  const closeTab = useCallback((id: string) => {
    // 同步判断「关完是否为空」（updater 惰性执行，不能依赖其内部赋值）。
    const willBeEmpty = tabs.length === 1 && tabs.some(t => t.id === id)
    setPersist(prev => {
      const index = prev.tabs.findIndex(t => t.id === id)
      if (index < 0) return prev
      const target = prev.tabs[index]
      if (target === undefined) return prev
      const rest = prev.tabs.filter(t => t.id !== id)
      const closed: ClosedTabEntry[] = [{ tab: target, closedAt: Date.now() }, ...prev.recentClosed].slice(0, RECENT_CLOSED_MAX)
      if (rest.length === 0) {
        const next: PanePersist = { ...prev, tabs: [], activeTabId: '', recentClosed: closed }
        savePersist(next)
        return next
      }
      const activeStill = rest.some(t => t.id === prev.activeTabId)
      const nextActive = activeStill
        ? prev.activeTabId
        : (rest[Math.min(index, rest.length - 1)]?.id ?? '')
      const next: PanePersist = { ...prev, tabs: rest, recentClosed: closed, activeTabId: nextActive }
      savePersist(next)
      return next
    })
    if (willBeEmpty) collapsePane()
  }, [tabs, collapsePane])

  /** ZCode noe：只留指定标签（其余进最近关闭）。 */
  const closeOtherTabs = useCallback((id: string) => {
    setPersist(prev => {
      const keep = prev.tabs.find(t => t.id === id)
      if (keep === undefined) return prev
      const nowTs = Date.now()
      const closedOthers: ClosedTabEntry[] = prev.tabs.filter(t => t.id !== id).map(t => ({ tab: t, closedAt: nowTs }))
      const next: PanePersist = {
        ...prev,
        tabs: [keep],
        recentClosed: [...closedOthers.reverse(), ...prev.recentClosed].slice(0, RECENT_CLOSED_MAX),
        activeTabId: id,
      }
      savePersist(next)
      return next
    })
  }, [])

  /** ZCode roe：关闭全部 → 面板收起。 */
  const closeAllTabs = useCallback(() => {
    setPersist(prev => {
      if (prev.tabs.length === 0) return prev
      const nowTs = Date.now()
      const closedAll: ClosedTabEntry[] = prev.tabs.map(t => ({ tab: t, closedAt: nowTs }))
      const next: PanePersist = {
        ...prev,
        tabs: [],
        activeTabId: '',
        recentClosed: [...closedAll.reverse(), ...prev.recentClosed].slice(0, RECENT_CLOSED_MAX),
      }
      savePersist(next)
      return next
    })
    collapsePane()
  }, [collapsePane])

  /** ZCode we：重开最近关闭的标签；浏览器标签换新 id。 */
  const reopenTab = useCallback((id: string) => {
    setPersist(prev => {
      const entry = prev.recentClosed.find(c => c.tab.id === id)
      if (entry === undefined) return prev
      // ZCode we：浏览器标签重开时换新 id（其余类型原样恢复）。
      let revived: SidePaneTab
      if (entry.tab.type === 'browser') {
        const fresh = makeBrowserTab(entry.tab.url ?? 'about:blank')
        revived = { ...fresh, title: entry.tab.title ?? '' }
      } else {
        revived = { ...entry.tab, openedAt: Date.now() }
      }
      const next: PanePersist = {
        ...prev,
        tabs: [...prev.tabs, revived],
        activeTabId: revived.id,
        recentClosed: prev.recentClosed.filter(c => c.tab.id !== id),
      }
      savePersist(next)
      return next
    })
  }, [])

  const reorderTab = useCallback((fromId: string, toId: string) => {
    setPersist(prev => {
      const from = prev.tabs.findIndex(t => t.id === fromId)
      const to = prev.tabs.findIndex(t => t.id === toId)
      if (from < 0 || to < 0 || from === to) return prev
      const nextTabs = [...prev.tabs]
      const [moved] = nextTabs.splice(from, 1)
      if (moved === undefined) return prev
      nextTabs.splice(to, 0, moved)
      const next = { ...prev, tabs: nextTabs }
      savePersist(next)
      return next
    })
  }, [])

  /** 打开/激活单例型面板标签。 */
  const openSingleton = useCallback((type: SidePaneTabType) => {
    openTab(makeTab(type))
    setAddMenuOpen(false)
  }, [openTab])

  /** ZCode Fae：新增菜单的浏览器 → 复用已有浏览器标签，没有才新建。 */
  const openBrowserFromMenu = useCallback(() => {
    setPersist(prev => {
      const existing = prev.tabs.find(t => t.type === 'browser')
      if (existing !== undefined) {
        const next: PanePersist = { ...prev, activeTabId: existing.id }
        savePersist(next)
        return next
      }
      const fresh = makeBrowserTab('about:blank')
      const next: PanePersist = { ...prev, tabs: [...prev.tabs, fresh], activeTabId: fresh.id }
      savePersist(next)
      return next
    })
    setAddMenuOpen(false)
  }, [])

  /** ZCode zoe：终端编号（终端 / 终端 2 / 终端 3…取第一个未占用的）。 */
  const nextNumberedTitle = useCallback((base: string, type: SidePaneTabType): string => {
    const taken = new Set(tabs.filter(t => t.type === type).map(t => t.title?.trim() ?? base))
    if (!taken.has(base)) return base
    for (let n = 2; ; n += 1) {
      const candidate = `${base} ${n}`
      if (!taken.has(candidate)) return candidate
    }
  }, [tabs])

  /** 新开一个终端标签（多实例，ZCode vae 对应）。 */
  const openTerminal = useCallback(() => {
    openTab(makeTab('terminal', { title: nextNumberedTitle('终端', 'terminal') }))
    setAddMenuOpen(false)
  }, [openTab, nextNumberedTitle])

  /** 新开一个画板标签（多实例，ZCode Cae 对应）。 */
  const openWhiteboard = useCallback(() => {
    openTab(makeTab('whiteboard', { title: nextNumberedTitle('画板', 'whiteboard') }))
    setAddMenuOpen(false)
  }, [openTab, nextNumberedTitle])

  /** 新开一个辅助对话标签（多实例；子会话在面板内 fork）。 */
  const openSideChat = useCallback(() => {
    openTab(makeTab('side-chat', { title: nextNumberedTitle('辅助对话', 'side-chat') }))
    setAddMenuOpen(false)
  }, [openTab, nextNumberedTitle])

  /** 辅助对话 fork 成功 → 把子会话 id 写回标签。 */
  const setSideChatChild = useCallback((tabId: string, childSessionId: string) => {
    setPersist(prev => {
      const target = prev.tabs.find(t => t.id === tabId)
      if (target === undefined || target.childSessionId === childSessionId) return prev
      const next: PanePersist = { ...prev, tabs: prev.tabs.map(t => t.id === tabId ? { ...t, childSessionId } : t) }
      savePersist(next)
      return next
    })
  }, [])

  /** ZCode z/Iae：URL 导航（产物链接）→ 总是新开浏览器标签。 */
  const openBrowserUrl = useCallback((url: string) => {
    openTab(makeBrowserTab(url))
  }, [openTab])

  /** 浏览器标签内导航：更新同标签 URL（ZCode aoe 对应）。 */
  const navigateBrowserTab = useCallback((id: string, url: string) => {
    setPersist(prev => {
      const next: PanePersist = { ...prev, tabs: prev.tabs.map(t => t.id === id && t.type === 'browser' ? { ...t, url } : t) }
      savePersist(next)
      return next
    })
  }, [])

  /** 浏览器标签标题（同源页面 document.title）。 */
  const renameBrowserTab = useCallback((id: string, title: string) => {
    setPersist(prev => {
      const target = prev.tabs.find(t => t.id === id)
      if (target === undefined || target.type !== 'browser' || target.title === title) return prev
      const next: PanePersist = { ...prev, tabs: prev.tabs.map(t => t.id === id ? { ...t, title } : t) }
      savePersist(next)
      return next
    })
  }, [])

  /** 浏览器标签 favicon（webview 引擎 page-favicon-updated 经 SSE 上报）。 */
  const setBrowserTabFavicon = useCallback((id: string, favicon: string) => {
    setPersist(prev => {
      const target = prev.tabs.find(t => t.id === id)
      if (target === undefined || target.type !== 'browser' || target.favicon === favicon) return prev
      const next: PanePersist = { ...prev, tabs: prev.tabs.map(t => t.id === id ? { ...t, favicon } : t) }
      savePersist(next)
      return next
    })
  }, [])

  /** 打开代码查看标签（ZCode Vae：sourceKey 去重，一文件一标签）。 */
  const openCodeViewer = useCallback((path: string, rel: string) => {
    openTab(makeTab('code-viewer', { path, rel }))
  }, [openTab])

  const previewFile = useCallback((path: string, rel: string): void => {
    openCodeViewer(path, rel)
  }, [openCodeViewer])

  /* ── 快捷键：Ctrl/Cmd+K 命令中心，Ctrl/Cmd+Alt+B 切换面板（ZCode 切换右侧面板） ── */

  const togglePane = useCallback((): void => {
    const next = togglePreviewOpen()
    setPaneSyncSuppressed(!next)
    if (next) openDetails?.()
    else closeDetails?.()
    window.dispatchEvent(new CustomEvent(PREVIEW_TOGGLE_EVENT))
  }, [openDetails, closeDetails])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (mod && key === 'k') {
        e.preventDefault()
        setPaletteOpen(v => !v)
        return
      }
      if (mod && e.altKey && key === 'b') {
        e.preventDefault()
        togglePane()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [togglePane])

  /* ── 会话内点击前端产物：新开浏览器标签并展开（ZCode z） ── */

  useEffect(() => {
    const onNavigate = (e: Event): void => {
      const detail = (e as CustomEvent<{ url?: string }>).detail
      const url = detail?.url
      if (url === undefined || url === '') return
      openBrowserUrl(url)
      setPreviewOpen(true)
      openDetails?.()
    }
    window.addEventListener(PREVIEW_NAVIGATE_EVENT, onNavigate)
    return () => { window.removeEventListener(PREVIEW_NAVIGATE_EVENT, onNavigate) }
  }, [openDetails, openBrowserUrl])

  /* ── webview 引擎：弹窗/新窗口请求 → 侧边栏新浏览器标签（ZCode [App] webview 请求打开右侧浏览器 tab） ── */

  useEffect(() => {
    let alive = true
    let unsubscribe: (() => void) | undefined
    void detectWebviewEngine().then((caps) => {
      if (!alive || caps === null) return
      unsubscribe = subscribeWebviewGlobal((event) => {
        if (event.type !== 'new-tab') return
        if (!/^https?:/i.test(event.url)) return
        openBrowserUrl(event.url)
        setPreviewOpen(true)
        openDetails?.()
      })
    })
    return () => { alive = false; unsubscribe?.() }
  }, [openBrowserUrl, openDetails])

  /* ── 概览打开时刷新相对时间（ZCode：60s） ── */

  useEffect(() => {
    if (!overviewOpen) return
    setNow(Date.now())
    const timer = window.setInterval(() => { setNow(Date.now()) }, 60000)
    return () => { window.clearInterval(timer) }
  }, [overviewOpen])

  /* ── 激活标签平滑滚入视野（ZCode scrollBy smooth 对应） ── */

  useEffect(() => {
    if (activeTab === undefined) return
    const raf = requestAnimationFrame(() => {
      const viewport = tabsViewportRef.current
      if (viewport === null) return
      const chip = viewport.querySelector<HTMLElement>(`[data-side-pane-tab-id="${CSS.escape(activeTab.id)}"]`)
      if (chip === null) return
      const v = viewport.getBoundingClientRect()
      const c = chip.getBoundingClientRect()
      const left = c.left - v.left
      const right = c.right - v.right
      if (left < 0) viewport.scrollBy({ left, behavior: 'smooth' })
      else if (right > 0) viewport.scrollBy({ left: right, behavior: 'smooth' })
    })
    return () => { cancelAnimationFrame(raf) }
  }, [activeTab?.id, tabs.length])

  /* ── 弹层外点击关闭 ── */

  useEffect(() => {
    if (!overviewOpen && !addMenuOpen && ctxMenu === null) return
    const onMouse = (e: MouseEvent): void => {
      const target = e.target as Element | null
      if (target === null) return
      if (target.closest('[data-liuli-pane-popover]') !== null) return
      if (overviewOpen && overviewBtnRef.current?.contains(target) === true) return
      if (addMenuOpen && addBtnRef.current?.contains(target) === true) return
      setOverviewOpen(false)
      setAddMenuOpen(false)
      setCtxMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOverviewOpen(false)
        setAddMenuOpen(false)
        setCtxMenu(null)
      }
    }
    document.addEventListener('mousedown', onMouse, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onMouse, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [overviewOpen, addMenuOpen, ctxMenu])

  /* ── 宽度控制：grid 覆盖 + 左缘手柄（ZCode react-resizable-panels 对应） ── */

  const frameEl = useCallback((): HTMLElement | null => {
    let el: HTMLElement | null = panelRef.current
    while (el !== null) {
      if (el.style.gridTemplateColumns !== '') return el
      el = el.parentElement
    }
    return null
  }, [])

  const widthBounds = useCallback((): { min: number; max: number } => {
    const frame = frameEl()
    const viewport = frame?.getBoundingClientRect().width ?? window.innerWidth
    return { min: WIDTH_MIN, max: Math.max(WIDTH_MIN, Math.round(viewport * WIDTH_MAX_RATIO)) }
  }, [frameEl])

  /** ZCode sqt：首次打开默认宽度 = 父容器 45%。 */
  const defaultWidth = useCallback((): number => {
    const frame = frameEl()
    const viewport = frame?.getBoundingClientRect().width ?? window.innerWidth
    const { min, max } = widthBounds()
    return Math.min(max, Math.max(min, Math.round(viewport * WIDTH_DEFAULT_RATIO)))
  }, [frameEl, widthBounds])

  const applyWidthOverride = useCallback((px: number) => {
    const frame = frameEl()
    if (frame === null) return
    const tracks = frame.style.gridTemplateColumns.split(/\s+/)
    if (tracks.length < 3) return
    tracks[tracks.length - 1] = `${Math.round(px)}px`
    frame.style.gridTemplateColumns = tracks.join(' ')
  }, [frameEl])

  // 打开时始终把 details 轨道覆盖为目标宽度（宿主 layout store 不持久化宽度，
  // 且关闭后再打开必须回到记忆宽度）；宿主重渲染后由 MutationObserver 补回。
  useEffect(() => {
    if (!open) return
    const target = width > 0 ? width : defaultWidth()
    applyWidthOverride(target)
    const frame = frameEl()
    if (frame === null) return
    const mo = new MutationObserver(() => {
      if (resizing.current) return
      const tracks = frame.style.gridTemplateColumns.split(/\s+/)
      const last = Number.parseFloat(tracks[tracks.length - 1] ?? '')
      if (!Number.isFinite(last)) return
      // 宿主/用户把轨道归零（关闭列）时尊重关闭，不能强行拉回。
      if (last < 1) return
      const want = width > 0 ? width : defaultWidth()
      if (Math.abs(last - want) >= 2) applyWidthOverride(want)
    })
    mo.observe(frame, { attributes: true, attributeFilter: ['style'] })
    return () => { mo.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, width, applyWidthOverride])

  const onResizeStart = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    handle.setAttribute('data-dragging', '')
    resizing.current = true
    // 一律以 grid 轨道宽度为基准（面板 rect = 轨道 - 宿主列内边距，slot 包裹层宽为 0 不可用）。
    const frame = frameEl()
    const tracks = frame?.style.gridTemplateColumns.split(/\s+/) ?? []
    const startTrack = Number.parseFloat(tracks[tracks.length - 1] ?? '') || (panelRef.current?.getBoundingClientRect().width ?? width)
    const startX = e.clientX
    const { min, max } = widthBounds()
    let last = Math.min(max, Math.max(min, startTrack))
    const onMove = (ev: PointerEvent): void => {
      last = Math.min(max, Math.max(min, startTrack + (startX - ev.clientX)))
      applyWidthOverride(last)
    }
    const onUp = (ev: PointerEvent): void => {
      handle.releasePointerCapture(ev.pointerId)
      handle.removeAttribute('data-dragging')
      resizing.current = false
      patch({ width: last })
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /* ── 命令中心（ZCode quickPick 的 切换面板 / 打开文件 + 其余命令） ── */

  const commands: CommandPaletteCommand[] = [
    {
      id: 'toggle-pane',
      label: '切换面板',
      hint: '展开 / 收起右侧面板',
      shortcut: 'Ctrl Alt B',
      run: () => { togglePane() },
    },
    {
      id: 'open-file',
      label: '打开文件…',
      hint: '从当前工作区选择文件并在侧边面板打开',
      run: () => { setFileDialogOpen(true) },
    },
    {
      id: 'search-files',
      label: '搜索文件',
      hint: '切到 Treemapping 并按文件名 / 路径实时筛选',
      shortcut: 'Ctrl F',
      run: () => {
        openSingleton('treemapping')
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>('[data-liuli-file-search]')?.focus()
        }, 0)
      },
    },
    {
      id: 'treemapping',
      label: 'Treemapping',
      hint: '工作区文件树与变更地图',
      run: () => { openSingleton('treemapping') },
    },
    {
      id: 'wiki',
      label: '仓库 Wiki',
      hint: '生成式架构导读',
      run: () => { openSingleton('repo-wiki') },
    },
    {
      id: 'git',
      label: '审查',
      hint: 'Git 状态与只读提交历史图',
      run: () => { openSingleton('git') },
    },
    {
      id: 'browser',
      label: '浏览器',
      hint: '预览产物与 localhost 页面',
      run: () => { openBrowserFromMenu() },
    },
    {
      id: 'new-session',
      label: '新对话',
      hint: '打开一个新的会话',
      shortcut: 'Ctrl N',
      run: () => { startSession?.() },
    },
    {
      id: 'open-folder',
      label: '打开文件夹',
      hint: '注册一个新的工作区',
      run: () => { pickDirectory?.() },
    },
    {
      id: 'toggle-theme',
      label: '切换主题',
      hint: '在日间 / 夜间模式间切换',
      run: () => { toggleTheme?.() },
    },
    {
      id: 'prev-session',
      label: '上一个对话',
      hint: '切换到左侧列表中的上一个会话',
      shortcut: 'Ctrl Shift [',
      run: () => { prevSession?.() },
    },
    {
      id: 'next-session',
      label: '下一个对话',
      hint: '切换到左侧列表中的下一个会话',
      shortcut: 'Ctrl Shift ]',
      run: () => { nextSession?.() },
    },
    {
      id: 'find',
      label: '查找',
      hint: '聚焦左侧会话搜索框',
      shortcut: 'Ctrl F',
      run: () => {
        document.querySelector<HTMLButtonElement>('button[aria-label="Search sessions"]')?.click()
      },
    },
    {
      id: 'settings',
      label: '设置',
      hint: '打开设置面板',
      run: () => {
        document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')?.click()
      },
    },
    {
      id: 'personalization',
      label: '个性化',
      hint: '打开设置中的外观 / 界面选项',
      run: () => {
        document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')?.click()
      },
    },
    {
      id: 'mcp',
      label: 'MCP 服务器',
      hint: '打开设置中的 MCP 管理',
      run: () => {
        document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')?.click()
      },
    },
  ]

  /* ── 新增标签菜单项（ZCode wqt：条件过滤 + 排序后的可用面板类型） ── */

  const addMenuItems = useMemo(() => {
    const has = (type: SidePaneTabType): boolean => tabs.some(t => t.type === type)
    const items: Array<{ id: string; label: string; icon: ReactNode; run: () => void }> = []
    if (sessionId !== undefined && host !== undefined) {
      items.push({ id: 'side-chat', label: '辅助对话', icon: <MessageSquareTextIcon size={16} />, run: () => { openSideChat() } })
    }
    if (!has('git')) items.push({ id: 'git', label: '审查', icon: <FileDiffIcon size={16} />, run: () => { openSingleton('git') } })
    items.push({ id: 'terminal', label: '终端', icon: <SquareTerminalIcon size={16} />, run: () => { openTerminal() } })
    items.push({ id: 'browser', label: '浏览器', icon: <GlobeIcon size={16} />, run: () => { openBrowserFromMenu() } })
    if (!has('developer-tools')) items.push({ id: 'developer-tools', label: '开发者工具', icon: <BugIcon size={16} />, run: () => { openSingleton('developer-tools') } })
    items.push({ id: 'whiteboard', label: '画板', icon: <PaletteIcon size={16} />, run: () => { openWhiteboard() } })
    if (sessionId !== undefined && host !== undefined) {
      if (!has('plan')) items.push({ id: 'plan', label: '计划', icon: <NotepadTextIcon size={16} />, run: () => { openSingleton('plan') } })
      if (!has('trajectory')) items.push({ id: 'trajectory', label: '模型调用轨迹', icon: <WaypointsIcon size={16} />, run: () => { openSingleton('trajectory') } })
      if (!has('subagents')) items.push({ id: 'subagents', label: '子智能体目录', icon: <ListTreeIcon size={16} />, run: () => { openSingleton('subagents') } })
    }
    if (!has('treemapping')) items.push({ id: 'treemapping', label: 'Treemapping', icon: <MapIcon size={16} />, run: () => { openSingleton('treemapping') } })
    if (!has('repo-wiki')) items.push({ id: 'repo-wiki', label: '仓库 Wiki', icon: <RepoWikiIcon size={16} />, run: () => { openSingleton('repo-wiki') } })
    items.push({ id: 'open-file', label: '打开文件…', icon: <FileCodeCornerIcon size={16} />, run: () => { setAddMenuOpen(false); setFileDialogOpen(true) } })
    return items
  }, [tabs, sessionId, host, openSingleton, openBrowserFromMenu, openTerminal, openWhiteboard, openSideChat])

  /* ── 渲染 ── */

  const renderTabChip = (tab: SidePaneTab): ReactNode => {
    const active = activeTab?.id === tab.id
    return (
      <div
        key={tab.id}
        data-side-pane-tab-id={tab.id}
        data-active={active ? '' : undefined}
        data-state={active ? 'active' : 'inactive'}
        className={css.tab + (active ? ' ' + css.tabActive : '')}
        draggable
        title={tabTitle(tab) + (tabHint(tab) !== '' ? ' · ' + tabHint(tab) : '')}
        onClick={() => { activateTab(tab.id) }}
        onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setCtxMenu({ x: e.clientX, y: e.clientY, tabId: tab.id })
        }}
        onDragStart={(e) => {
          dragTab.current = tab.id
          e.dataTransfer.setData('application/x-liuli-pane-tab', tab.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        onDragOver={(e) => {
          if (dragTab.current !== null && dragTab.current !== tab.id) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
          }
        }}
        onDrop={(e) => {
          const from = e.dataTransfer.getData('application/x-liuli-pane-tab')
          if (from !== '' && from !== tab.id) {
            e.preventDefault()
            reorderTab(from, tab.id)
          }
          dragTab.current = null
        }}
        onDragEnd={() => { dragTab.current = null }}
      >
        <span className={css.tabIcon}><TabIcon tab={tab} /></span>
        <span className={css.tabTitle}>{tabTitle(tab)}</span>
        <span className={css.tabCloseZone}>
          <button
            type="button"
            className={css.tabClose}
            aria-label={`关闭 ${tabTitle(tab)}`}
            onPointerDown={(e) => { e.stopPropagation() }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); closeTab(tab.id) }}
          >
            <XIcon />
          </button>
        </span>
      </div>
    )
  }

  const ctxTab = ctxMenu === null ? undefined : tabs.find(t => t.id === ctxMenu.tabId)

  return (
    <div ref={panelRef} className={css.panel} data-preview-panel="" data-liuli-side-pane="">
      {/* 左缘宽度手柄（ZCode 分割线拖拽对应物） */}
      <div className={css.resizeHandle} onPointerDown={onResizeStart} role="separator" aria-label="调整面板宽度" aria-orientation="vertical" />

      {/* 标签条 */}
      <div className={css.tabStrip} role="tablist" aria-label="右侧面板标签">
        <div className={css.stripLeft}>
          <div className={css.overviewSlot}>
            <StripButton
              label="搜索标签页"
              active={overviewOpen}
              onClick={() => { setOverviewOpen(v => !v); setAddMenuOpen(false) }}
              buttonRef={(el) => { overviewBtnRef.current = el }}
            >
              <ChevronsDownIcon size={16} />
            </StripButton>
          </div>
          <div ref={tabsViewportRef} className={css.tabsViewport} data-side-pane-tabs-viewport="">
            <div className={css.tabsContent} data-side-pane-tabs-content="">
              {tabs.map(renderTabChip)}
            </div>
          </div>
        </div>
        <div className={css.stripRight}>
          <StripButton
            label="新增标签"
            active={addMenuOpen}
            onClick={() => { setAddMenuOpen(v => !v); setOverviewOpen(false) }}
            buttonRef={(el) => { addBtnRef.current = el }}
          >
            <PlusIcon size={16} />
          </StripButton>
        </div>
      </div>

      {/* 内容区：所有标签面板常驻挂载，inactive 隐藏（保留 iframe 状态） */}
      <div className={css.content}>
        {tabs.length === 0 && (
          <div className={css.emptyShell}>
            <div className={css.emptyContent}>
              <div className={css.emptyHead}>
                <h2 className={css.emptyTitle}>打开标签页</h2>
                <p className={css.emptyDesc}>选择要在侧边面板中打开的标签。</p>
              </div>
              <div className={css.emptyList}>
                {addMenuItems.map((item) => (
                  <button key={item.id} type="button" className={css.emptyItem} onClick={item.run} data-side-pane-open-tab-item={item.id}>
                    <span className={css.emptyItemIcon}>{item.icon}</span>
                    <span className={css.emptyItemLabel}>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {tabs.map((tab) => {
          const active = activeTab?.id === tab.id
          return (
            <div
              key={tab.id}
              role="tabpanel"
              data-state={active ? 'active' : 'inactive'}
              className={css.tabPane + (active ? '' : ' ' + css.tabPaneInactive)}
              aria-hidden={active ? undefined : true}
            >
              {tab.type === 'treemapping' && (
                <FileTreePanel
                  sessionId={sessionId}
                  onOpenFile={previewFile}
                  onAddFileToChat={addFileToChat}
                  onOpenPath={openPath}
                />
              )}
              {tab.type === 'repo-wiki' && <WikiPanel sessionId={sessionId} onOpenFile={previewFile} />}
              {tab.type === 'git' && <GitPanel sessionId={sessionId} />}
              {tab.type === 'browser' && (
                <BrowserPanel
                  tabId={tab.id}
                  active={active && open}
                  sessionId={sessionId}
                  url={tab.url ?? 'about:blank'}
                  onNavigate={(url) => { navigateBrowserTab(tab.id, url) }}
                  onTitleChange={(title) => { renameBrowserTab(tab.id, title) }}
                  insertElement={insertElement}
                  getPaneEl={() => panelRef.current}
                  onFavicon={(favicon) => { setBrowserTabFavicon(tab.id, favicon) }}
                />
              )}
              {tab.type === 'code-viewer' && (
                <CodeViewerPanel
                  sessionId={sessionId}
                  rel={tab.rel ?? ''}
                  path={tab.path ?? ''}
                  onOpenPath={openPath}
                />
              )}
              {tab.type === 'terminal' && (
                <TerminalPanel sessionId={sessionId} title={tabTitle(tab)} />
              )}
              {tab.type === 'developer-tools' && host !== undefined && (
                <DeveloperToolsPanel sessionId={sessionId} host={host} />
              )}
              {tab.type === 'trajectory' && host !== undefined && (
                <TrajectoryPanel sessionId={sessionId} host={host} />
              )}
              {tab.type === 'whiteboard' && (
                <WhiteboardPanel boardId={tab.id} />
              )}
              {tab.type === 'plan' && host !== undefined && (
                <PlanPanel sessionId={sessionId} host={host} />
              )}
              {tab.type === 'subagents' && host !== undefined && (
                <SubagentPanel sessionId={sessionId} host={host} />
              )}
              {tab.type === 'side-chat' && host !== undefined && (
                <SideChatPanel
                  sessionId={sessionId}
                  host={host}
                  childSessionId={tab.childSessionId}
                  onChildCreated={(childId) => { setSideChatChild(tab.id, childId) }}
                  title={tabTitle(tab)}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* 概览弹层 */}
      {overviewOpen && overviewBtnRef.current !== null && (
        <OverviewPopover
          anchor={overviewBtnRef.current}
          tabs={tabs}
          closed={recentClosed}
          activeTabId={activeTab?.id ?? ''}
          now={now}
          onActivate={(id) => { activateTab(id); setOverviewOpen(false) }}
          onCloseTab={closeTab}
          onReopen={(id) => { reopenTab(id); setOverviewOpen(false) }}
        />
      )}

      {/* 新增标签下拉 */}
      {addMenuOpen && addBtnRef.current !== null && (
        <div
          data-liuli-pane-popover=""
          className={css.popoverCard + ' ' + css.addMenu}
          style={anchorStyle(addBtnRef.current, 'right')}
          role="menu"
        >
          {addMenuItems.map((item) => (
            <button key={item.id} type="button" role="menuitem" className={css.menuItem} onClick={item.run} data-side-pane-add-item={item.id}>
              <span className={css.menuItemIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* 标签右键菜单（ZCode w-44 = 176px） */}
      {ctxMenu !== null && ctxTab !== undefined && (
        <div
          data-liuli-pane-popover=""
          className={css.popoverCard + ' ' + css.tabMenu}
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 190), top: Math.min(ctxMenu.y, window.innerHeight - 140) }}
          role="menu"
        >
          <button type="button" role="menuitem" className={css.menuItem} onClick={() => { closeTab(ctxTab.id); setCtxMenu(null) }}>关闭标签</button>
          <button type="button" role="menuitem" className={css.menuItem} disabled={tabs.length <= 1} onClick={() => { closeOtherTabs(ctxTab.id); setCtxMenu(null) }}>关闭其他标签</button>
          <button type="button" role="menuitem" className={css.menuItem} onClick={() => { closeAllTabs(); setCtxMenu(null) }}>关闭所有标签</button>
        </div>
      )}

      {/* 打开文件对话框 */}
      {fileDialogOpen && sessionId !== undefined && (
        <OpenFileDialog
          sessionId={sessionId}
          onClose={() => { setFileDialogOpen(false) }}
          onOpenFile={(path, rel) => { setFileDialogOpen(false); openCodeViewer(path, rel) }}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => { setPaletteOpen(false) }}
        commands={commands}
      />
    </div>
  )
}

/** 弹层定位：锚点元素下方（右对齐 / 左对齐）。 */
function anchorStyle(anchor: HTMLElement, align: 'left' | 'right'): CSSProperties {
  const rect = anchor.getBoundingClientRect()
  const style: CSSProperties = { top: rect.bottom + 6 }
  if (align === 'right') {
    style.right = Math.max(8, window.innerWidth - rect.right)
  } else {
    style.left = rect.left
  }
  return style
}

/* ── 概览弹层（搜索标签页 + 打开的 / 最近关闭的） ── */

interface OverviewPopoverProps {
  anchor: HTMLElement
  tabs: SidePaneTab[]
  closed: ClosedTabEntry[]
  activeTabId: string
  now: number
  onActivate: (id: string) => void
  onCloseTab: (id: string) => void
  onReopen: (id: string) => void
}

function OverviewPopover({ anchor, tabs, closed, activeTabId, now, onActivate, onCloseTab, onReopen }: OverviewPopoverProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => { inputRef.current?.focus() }, 0)
    return () => { window.clearTimeout(t) }
  }, [])

  const tokens = useMemo(() => searchTokens(query), [query])
  const openRows = useMemo(() => rankRows(tabs, tokens, tab => ({ title: tabTitle(tab), hint: tabHint(tab), typeLabel: tabTypeLabel(tab) })).map(r => r.item), [tabs, tokens])
  const closedRows = useMemo(() => rankRows(closed, tokens, entry => ({ title: tabTitle(entry.tab), hint: tabHint(entry.tab), typeLabel: tabTypeLabel(entry.tab) })).map(r => r.item), [closed, tokens])

  return (
    <div data-liuli-pane-popover="" className={css.popoverCard + ' ' + css.overviewCard} style={anchorStyle(anchor, 'left')} role="dialog" aria-label="搜索标签页">
      <div className={css.overviewInputRow}>
        <SearchGlyph size={14} />
        <input
          ref={inputRef}
          className={css.overviewInput}
          value={query}
          onChange={(e) => { setQuery(e.target.value) }}
          placeholder="搜索标签页..."
          spellCheck={false}
        />
      </div>
      <div className={css.overviewBody}>
        {openRows.length === 0 && closedRows.length === 0 && (
          <div className={css.overviewEmpty}>没有找到标签页。</div>
        )}
        {openRows.length > 0 && (
          <>
            <div className={css.overviewGroup}>打开的标签页</div>
            {openRows.map((tab) => (
              <div
                key={tab.id}
                className={css.overviewRow + (tab.id === activeTabId ? ' ' + css.overviewRowActive : '')}
                role="button"
                tabIndex={0}
                onClick={() => { onActivate(tab.id) }}
                onKeyDown={(e) => { if (e.key === 'Enter') onActivate(tab.id) }}
              >
                <span className={css.overviewRowIcon}><TabIcon tab={tab} /></span>
                <span className={css.overviewRowTitle}>{tabTitle(tab)}</span>
                <span className={css.overviewRowTime}>{relativeTime(tab.openedAt, now)}</span>
                <button
                  type="button"
                  className={css.tabClose}
                  aria-label={`关闭 ${tabTitle(tab)}`}
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCloseTab(tab.id) }}
                >
                  <XIcon />
                </button>
              </div>
            ))}
          </>
        )}
        {closedRows.length > 0 && (
          <>
            <div className={css.overviewGroup}>最近关闭的标签页</div>
            {closedRows.map((entry) => (
              <div
                key={entry.tab.id}
                className={css.overviewRow}
                role="button"
                tabIndex={0}
                onClick={() => { onReopen(entry.tab.id) }}
                onKeyDown={(e) => { if (e.key === 'Enter') onReopen(entry.tab.id) }}
              >
                <span className={css.overviewRowIcon}><TabIcon tab={entry.tab} /></span>
                <span className={css.overviewRowTitle}>{tabTitle(entry.tab)}</span>
                <span className={css.overviewRowTime}>{relativeTime(entry.closedAt, now)}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/* ── 打开文件对话框（sidePane.openFile：从当前 workspace 中选择文件并在侧边面板打开） ── */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', '__pycache__', '.venv', 'venv'])
const FILE_SCAN_MAX = 6000

interface OpenFileDialogProps {
  sessionId: string
  onClose: () => void
  onOpenFile: (path: string, rel: string) => void
}

interface FileHit {
  name: string
  path: string
  rel: string
}

function OpenFileDialog({ sessionId, onClose, onOpenFile }: OpenFileDialogProps) {
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<FileHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => { inputRef.current?.focus() }, 0)
    return () => { window.clearTimeout(t) }
  }, [])

  // 递归扫描工作区文件（BFS，限制总量），只跑一次。
  useEffect(() => {
    const controller = new AbortController()
    const collected: FileHit[] = []
    let root = ''
    const relOf = (path: string): string => root === '' ? path : path.slice(root.length).replace(/^[\/]+/, '')
    const walk = async (): Promise<void> => {
      let queue: string[] = ['']
      let dirsVisited = 0
      while (queue.length > 0 && collected.length < FILE_SCAN_MAX && dirsVisited < 800) {
        const nextQueue: string[] = []
        const batch = queue.slice(0, 8)
        queue = queue.slice(8)
        const results = await Promise.all(batch.map(rel =>
          fetchSidebarTree(sessionId, rel, controller.signal).catch(() => null),
        ))
        for (let i = 0; i < results.length; i++) {
          const payload = results[i]
          if (payload === null || payload === undefined || payload.ok !== true) continue
          root = payload.root ?? root
          for (const entry of payload.entries ?? []) {
            if (entry.kind === 'dir') {
              if (SKIP_DIRS.has(entry.name) || entry.hidden) continue
              dirsVisited += 1
              nextQueue.push(relOf(entry.path))
            } else {
              collected.push({ name: entry.name, path: entry.path, rel: relOf(entry.path) })
              if (collected.length >= FILE_SCAN_MAX) break
            }
          }
        }
        queue = [...queue, ...nextQueue]
      }
    }
    walk()
      .then(() => { if (!controller.signal.aborted) setFiles(collected) })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => { controller.abort() }
  }, [sessionId])

  const filtered = useMemo(() => {
    if (files === null) return []
    const q = query.trim().toLowerCase()
    if (q === '') return []
    const tokens = q.split(/\s+/).filter(t => t !== '')
    return files
      .filter((f) => {
        const hay = f.name.toLowerCase() + ' ' + f.rel.toLowerCase()
        return tokens.every(t => hay.includes(t))
      })
      .slice(0, 200)
  }, [files, query])

  useEffect(() => { setIndex(0) }, [query, files])

  const pick = (hit: FileHit | undefined): void => {
    if (hit === undefined) return
    onOpenFile(hit.path, hit.rel)
  }

  return (
    <div className={css.fileDialogOverlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={css.fileDialogCard} role="dialog" aria-label="打开文件">
        <div className={css.fileDialogInputRow}>
          <SearchGlyph size={14} />
          <input
            ref={inputRef}
            className={css.fileDialogInput}
            value={query}
            onChange={(e) => { setQuery(e.target.value) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); onClose() }
              else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); pick(filtered[index]) }
            }}
            placeholder={files === null ? '正在加载文件...' : '搜索当前 workspace 文件...'}
            spellCheck={false}
          />
        </div>
        <div className={css.fileDialogList}>
          {error !== null && <div className={css.overviewEmpty}>{error}</div>}
          {error === null && files === null && <div className={css.overviewEmpty}>正在加载文件...</div>}
          {error === null && files !== null && query.trim() === '' && (
            <div className={css.overviewEmpty}>输入内容搜索文件</div>
          )}
          {error === null && files !== null && query.trim() !== '' && filtered.length === 0 && (
            <div className={css.overviewEmpty}>没有找到文件。</div>
          )}
          {filtered.map((entry, i) => (
            <button
              key={entry.path}
              type="button"
              className={css.fileDialogRow + (i === index ? ' ' + css.fileDialogRowActive : '')}
              onMouseEnter={() => { setIndex(i) }}
              onClick={() => { pick(entry) }}
            >
              <span className={css.fileDialogName}>{entry.name}</span>
              <span className={css.fileDialogPath}>{entry.rel}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}


/* ── 嵌入式浏览器（webview 引擎）：Host WebContentsView 的渲染端承载 ──
 *
 * ZCode Desktop IAB 的侧边栏浏览器是 Electron <webview>（独立会话分区、
 * 任意站点、弹窗转标签、崩溃重建）。DSH 窗口未开 webviewTag，本插件在
 * Host 半用 WebContentsView 等价承载（browser-engine.ts），这里负责：
 * 工具条（back/forward/reload/地址栏/响应式/元素拾取/更多）、状态同步
 * （SSE state → 地址栏/标签标题/前进后退态）、carrier 几何上报、
 * 响应式视口（ZCode browser.responsive.*）、空态与错误呈现。
 * data-testid 与 ZCode 一致（browser-address-input 等）。
 */

/** 客户页内拾取器返回的元素描述（与 PickedElement 字段逐一对齐）。 */
interface GuestElementInfo {
  tag: string
  selector: string
  attributes: string
  text: string
  rect: { x: number; y: number; width: number; height: number }
  color: string
  background: string
  font: string
}

/**
 * 注入客户页的元素拾取脚本（ZCode browser.elementPicker 语义：hover 描边、
 * 点击拾取、Esc 取消）。脚本无反引号/模板插值/反斜杠，直接 executeJavaScript。
 */
const PICKER_SCRIPT = `(() => {
  if (window.__liuliPicker) return window.__liuliPicker.promise
  const doc = document
  const outline = doc.createElement('div')
  outline.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #2f80ed;background:rgba(47,128,237,0.12);z-index:2147483647;display:none;border-radius:2px;'
  const chip = doc.createElement('div')
  chip.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;display:none;background:#2f80ed;color:#fff;font:11px/16px monospace;padding:1px 6px;border-radius:3px;white-space:nowrap;'
  doc.documentElement.appendChild(outline)
  doc.documentElement.appendChild(chip)
  let current = null
  let finished = false
  let resolve = () => {}
  const esc = (s) => {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(s)
    let out = ''
    for (const ch of String(s)) out += /[a-zA-Z0-9_-]/.test(ch) ? ch : String.fromCharCode(92) + ch
    return out
  }
  const segment = (el) => {
    if (el.id !== '') return '#' + esc(el.id)
    const tag = el.tagName.toLowerCase()
    const classes = Array.from(el.classList).map(esc)
    const base = classes.length === 0 ? tag : tag + '.' + classes.join('.')
    const parent = el.parentElement
    if (parent === null) return base
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === el.tagName)
    return sameTag.length > 1 ? base + ':nth-of-type(' + String(sameTag.indexOf(el) + 1) + ')' : base
  }
  const selectorOf = (el) => {
    const parts = []
    let node = el
    const body = el.ownerDocument.body
    while (node !== null && node !== body) { parts.unshift(segment(node)); node = node.parentElement }
    return parts.join(' > ')
  }
  const rgb2hex = (value) => {
    const m = /^rgba?[(]([0-9]+)[, ]+([0-9]+)[, ]+([0-9]+)(?:[, ]+([0-9.]+))?[)]$/.exec(value)
    if (m === null) return value
    const alpha = m[4] === undefined ? 1 : Number(m[4])
    if (alpha === 0) return 'transparent'
    if (alpha < 1) return value
    const hex = (n) => Number(n).toString(16).padStart(2, '0')
    return ('#' + hex(m[1]) + hex(m[2]) + hex(m[3])).toUpperCase()
  }
  const describe = (el) => {
    const rect = el.getBoundingClientRect()
    const styles = getComputedStyle(el)
    const attributes = Array.from(el.attributes)
      .filter((a) => a.name !== 'class' && a.name !== 'id' && a.name !== 'style')
      .map((a) => a.name + '="' + a.value + '"')
      .join(', ')
    return {
      tag: el.tagName.toLowerCase(),
      selector: selectorOf(el),
      attributes,
      text: (el.textContent || '').trim().slice(0, 200),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      color: rgb2hex(styles.color),
      background: rgb2hex(styles.backgroundColor),
      font: (styles.fontSize + ' ' + styles.fontFamily).trim(),
    }
  }
  const cleanup = () => {
    finished = true
    window.removeEventListener('mousemove', onMove, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKey, true)
    outline.remove()
    chip.remove()
    window.__liuliPicker = null
  }
  const finish = (status, info) => {
    if (finished) return
    cleanup()
    resolve(info === undefined ? { status } : { status, info })
  }
  const onMove = (e) => {
    const el = doc.elementFromPoint(e.clientX, e.clientY)
    if (el === null || el === outline || el === chip) {
      current = null
      outline.style.display = 'none'
      chip.style.display = 'none'
      return
    }
    current = el
    const r = el.getBoundingClientRect()
    outline.style.display = 'block'
    outline.style.left = r.left + 'px'
    outline.style.top = r.top + 'px'
    outline.style.width = r.width + 'px'
    outline.style.height = r.height + 'px'
    chip.style.display = 'block'
    chip.textContent = el.tagName.toLowerCase() + (el.id !== '' ? '#' + el.id : '')
    chip.style.left = Math.max(0, r.left) + 'px'
    chip.style.top = Math.max(0, r.top - 18) + 'px'
  }
  const onClick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (current !== null) finish('picked', describe(current))
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); finish('cancelled') }
  }
  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKey, true)
  const promise = new Promise((res) => { resolve = res })
  window.__liuliPicker = { promise, cancel: () => finish('cancelled') }
  return promise
})()`

/** 取消客户页拾取（渲染端 Escape 时调用，ZCode cancelPicking 对应）。 */
const PICKER_CANCEL_SCRIPT = `(() => {
  if (window.__liuliPicker) { window.__liuliPicker.cancel(); return true }
  return false
})()`

/** 客户页拾取结果 → 聊天用 PickedElement。 */
function toPickedElement(info: GuestElementInfo): PickedElement {
  return {
    tag: info.tag,
    selector: info.selector,
    attributes: info.attributes,
    text: info.text,
    rect: info.rect,
    color: computedColor(info.color),
    background: computedColor(info.background),
    font: info.font,
  }
}

/** 引擎探测缓存（全部浏览器标签共享一次能力探测）。 */
type BrowserEngineKind = 'pending' | 'webview' | 'iframe'
let engineKindCache: BrowserEngineKind = 'pending'
let engineDetectStarted = false
const engineListeners = new Set<(kind: BrowserEngineKind) => void>()

function startEngineDetect(): void {
  if (engineDetectStarted) return
  engineDetectStarted = true
  void detectWebviewEngine().then((caps) => {
    engineKindCache = caps === null ? 'iframe' : 'webview'
    for (const listener of engineListeners) listener(engineKindCache)
  })
}

function useBrowserEngineKind(): BrowserEngineKind {
  const [kind, setKind] = useState<BrowserEngineKind>(engineKindCache)
  useEffect(() => {
    startEngineDetect()
    if (engineKindCache !== 'pending') {
      setKind(engineKindCache)
      return
    }
    const listener = (next: BrowserEngineKind): void => { setKind(next) }
    engineListeners.add(listener)
    return () => { engineListeners.delete(listener) }
  }, [])
  return kind
}

/** 响应式模式配置（ZCode HUt：fit/50/75/100/125/150/200）。 */
const ZOOM_OPTIONS = ['fit', '50', '75', '100', '125', '150', '200'] as const
const RESPONSIVE_LS_KEY = 'liuli:browser-responsive'

interface ResponsiveConfig {
  width: number
  height: number
  zoom: string
}

function loadResponsiveConfig(): ResponsiveConfig {
  const fallback: ResponsiveConfig = { width: 390, height: 844, zoom: 'fit' }
  try {
    const raw = localStorage.getItem(RESPONSIVE_LS_KEY)
    if (raw === null) return fallback
    const parsed = JSON.parse(raw) as Partial<ResponsiveConfig>
    return {
      width: typeof parsed.width === 'number' && Number.isFinite(parsed.width) ? Math.round(parsed.width) : fallback.width,
      height: typeof parsed.height === 'number' && Number.isFinite(parsed.height) ? Math.round(parsed.height) : fallback.height,
      zoom: typeof parsed.zoom === 'string' && (ZOOM_OPTIONS as readonly string[]).includes(parsed.zoom) ? parsed.zoom : 'fit',
    }
  } catch {
    return fallback
  }
}

interface NativeBrowserPanelProps {
  tabId: string
  sessionId?: string | undefined
  url: string
  active: boolean
  onNavigate: (url: string) => void
  onTitleChange: (title: string) => void
  insertElement: (info: PickedElement) => void
  onFavicon?: ((favicon: string) => void) | undefined
}

/** webview 引擎浏览器面板：Host WebContentsView 的工具条 + carrier。 */
function NativeBrowserPanel({ tabId, sessionId, url, active, onNavigate, onTitleChange, insertElement, onFavicon }: NativeBrowserPanelProps) {
  const [state, setState] = useState<WebviewTabState | null>(null)
  const [draft, setDraft] = useState(url === 'about:blank' ? '' : url)
  const [draftFocused, setDraftFocused] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [pickerOn, setPickerOn] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [responsiveOn, setResponsiveOn] = useState(false)
  const [responsive, setResponsive] = useState<ResponsiveConfig>(loadResponsiveConfig)
  const [zoomFitScale, setZoomFitScale] = useState(1)
  const [carrierSize, setCarrierSize] = useState({ width: 0, height: 0 })
  const [resizingFrame, setResizingFrame] = useState(false)
  const carrierRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<WebviewTabState | null>(null)
  const lastRequestedUrl = useRef<string>(url)
  const moreWrapRef = useRef<HTMLDivElement | null>(null)

  stateRef.current = state

  /* ── 生命周期：Host 侧标签创建/销毁 + SSE 状态同步 ── */

  useEffect(() => {
    let alive = true
    void webviewBrowser.createTab(tabId, url).then((resp) => {
      if (!alive) return
      const created = resp as { ok?: boolean; state?: WebviewTabState }
      if (created.ok === true && created.state !== undefined) {
        lastRequestedUrl.current = created.state.url
        setState(created.state)
      }
    })
    const unsubscribe = subscribeWebviewTab(tabId, (event) => {
      if (event.type !== 'state') return
      lastRequestedUrl.current = event.state.url
      setState(event.state)
    })
    return () => {
      alive = false
      unsubscribe()
      void webviewBrowser.destroyTab(tabId)
    }
  }, [tabId]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 外部 URL 变更（产物链接/持久化恢复）→ 客户机导航 ── */

  useEffect(() => {
    if (url === '' || url === 'about:blank') return
    if (url === lastRequestedUrl.current) return
    if (stateRef.current !== null && url === stateRef.current.url) return
    lastRequestedUrl.current = url
    void webviewBrowser.action(tabId, 'navigate', url)
  }, [url, tabId])

  /* ── 状态 → 标签条（标题/URL 持久化，ZCode onPageMetadataChange 对应） ── */

  useEffect(() => {
    if (state === null) return
    const title = state.title.trim()
    if (title !== '') onTitleChange(title)
    if (state.url !== '' && state.url !== 'about:blank') onNavigate(state.url)
    if (state.favicon !== null && state.favicon !== '') onFavicon?.(state.favicon)
  }, [state?.title, state?.url, state?.favicon]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 地址栏草稿跟随当前 URL（未聚焦时） ── */

  useEffect(() => {
    if (draftFocused) return
    if (state === null) return
    setDraft(state.url === 'about:blank' ? '' : state.url)
  }, [state?.url, draftFocused]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── carrier 几何上报（原生视图贴合） ── */

  useEffect(() => {
    return reportGeometryLoop(tabId, () => carrierRef.current, () => active)
  }, [tabId, active])

  /* ── 响应式视口（ZCode browser.responsive：客户机固定视口 + zoom 缩放） ── */

  useEffect(() => {
    try { localStorage.setItem(RESPONSIVE_LS_KEY, JSON.stringify(responsive)) } catch { /* 配额满忽略 */ }
  }, [responsive])

  const responsiveScale = useMemo(() => {
    if (responsive.zoom !== 'fit') return Number(responsive.zoom) / 100
    return zoomFitScale
  }, [responsive.zoom, zoomFitScale])

  useEffect(() => {
    if (!responsiveOn) {
      void webviewBrowser.viewport(tabId, null)
      return
    }
    void webviewBrowser.viewport(tabId, { width: responsive.width, height: responsive.height, scale: responsiveScale })
  }, [responsiveOn, responsive.width, responsive.height, responsiveScale, tabId])

  // fit 缩放随 carrier 尺寸变化（ZCode UUt：(画布宽-32)/视口宽，上限 1）。
  useEffect(() => {
    if (!responsiveOn) return
    const el = carrierRef.current
    if (el === null) return
    const compute = (): void => {
      const rect = el.getBoundingClientRect()
      setCarrierSize({ width: rect.width, height: rect.height })
      const byWidth = (Math.max(0, rect.width - 32)) / responsive.width
      const byHeight = (Math.max(0, rect.height - 32)) / responsive.height
      setZoomFitScale(Math.max(0.1, Math.min(1, Math.min(byWidth, byHeight))))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => { ro.disconnect() }
  }, [responsiveOn, responsive.width, responsive.height])

  /* ── 响应式视口拖拽缩放手柄（ZCode YUt resize handles 对应） ── */

  const dragResizeFrame = (edge: 'right' | 'bottom' | 'corner') => (down: ReactPointerEvent<HTMLDivElement>): void => {
    down.preventDefault()
    const startX = down.clientX
    const startY = down.clientY
    const startW = responsive.width
    const startH = responsive.height
    const scale = responsiveScale
    setResizingFrame(true)
    const onMove = (move: PointerEvent): void => {
      const next = { ...responsive }
      if (edge === 'right' || edge === 'corner') {
        next.width = Math.round(Math.min(3840, Math.max(320, startW + (move.clientX - startX) / scale)))
      }
      if (edge === 'bottom' || edge === 'corner') {
        next.height = Math.round(Math.min(2160, Math.max(320, startH + (move.clientY - startY) / scale)))
      }
      setResponsive(next)
    }
    const onUp = (): void => {
      setResizingFrame(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const nudgeFrame = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = e.shiftKey ? 50 : 10
    let dw = 0
    let dh = 0
    if (e.key === 'ArrowLeft') dw = -step
    else if (e.key === 'ArrowRight') dw = step
    else if (e.key === 'ArrowUp') dh = -step
    else if (e.key === 'ArrowDown') dh = step
    else return
    e.preventDefault()
    setResponsive(r => ({
      ...r,
      width: Math.round(Math.min(3840, Math.max(320, r.width + dw))),
      height: Math.round(Math.min(2160, Math.max(320, r.height + dh))),
    }))
  }

  // 响应式模式下视口框在 carrier 内的呈现矩形（与 Host applyBounds 居中公式一致）。
  const frameGuide = useMemo(() => {
    if (!responsiveOn) return null
    const w = responsive.width * responsiveScale
    const h = responsive.height * responsiveScale
    return {
      left: Math.max(0, (carrierSize.width - w) / 2),
      top: Math.max(0, (carrierSize.height - h) / 2),
      width: Math.min(w, carrierSize.width),
      height: Math.min(h, carrierSize.height),
    }
  }, [responsiveOn, responsive.width, responsive.height, responsiveScale, carrierSize])

  /* ── 动作 ── */

  const submitAddress = (): void => {
    const trimmed = draft.trim()
    if (trimmed === '') return
    setLocalError(null)
    // 相对前端产物路径映射 /preview（与 iframe 模式一致）。
    const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !trimmed.startsWith('/') && !trimmed.startsWith('//')
    if (bare && looksLikeFrontendPath(trimmed) && sessionId !== undefined && sessionId !== null) {
      const mapped = resolvePreviewUrl(trimmed, sessionId)
      if (mapped !== undefined) {
        lastRequestedUrl.current = mapped
        onNavigate(mapped)
        void webviewBrowser.action(tabId, 'navigate', new URL(mapped, window.location.href).href)
        return
      }
    }
    const resolved = normalizeBrowserUrl(trimmed)
    if (resolved === undefined) {
      setLocalError('无法识别的网址') // ZCode browser.invalidUrl
      return
    }
    if (stateRef.current !== null && resolved === stateRef.current.url) {
      // 重复提交同址 → 重新加载（ZCode ge 同语义）。
      void webviewBrowser.action(tabId, 'navigate', resolved)
      return
    }
    lastRequestedUrl.current = resolved
    onNavigate(resolved)
    void webviewBrowser.action(tabId, 'navigate', resolved)
  }

  const goBack = (): void => { void webviewBrowser.action(tabId, 'back') }
  const goForward = (): void => { void webviewBrowser.action(tabId, 'forward') }
  const reload = (): void => { void webviewBrowser.action(tabId, 'reload') }
  const openDevTools = (): void => { setMoreOpen(false); void webviewBrowser.action(tabId, 'devtools') }
  const openExternal = (): void => {
    setMoreOpen(false)
    const target = stateRef.current?.url ?? ''
    if (target === '' || target === 'about:blank') return
    void webviewBrowser.openExternal(target)
  }

  /* ── 元素拾取（ZCode browser.elementPicker：显式开启、Esc 取消、选完自动关） ── */

  const pickerGeneration = useRef(0)

  const cancelPicker = useCallback((): void => {
    pickerGeneration.current += 1
    setPickerOn(false)
    void webviewBrowser.execute(tabId, PICKER_CANCEL_SCRIPT)
  }, [tabId])

  const startPicker = useCallback(async (): Promise<void> => {
    const generation = pickerGeneration.current + 1
    pickerGeneration.current = generation
    setPickerOn(true)
    try {
      const resp = await webviewBrowser.execute(tabId, PICKER_SCRIPT)
      if (pickerGeneration.current !== generation) return
      if (resp.ok !== true) throw new Error(typeof resp.error === 'string' ? resp.error : 'picker failed')
      const value = resp.value as { status?: string; info?: GuestElementInfo } | null
      if (value === null || typeof value !== 'object' || typeof value.status !== 'string') return
      if (value.status === 'cancelled') return
      if (value.status === 'picked' && value.info !== undefined) insertElement(toPickedElement(value.info))
    } catch (cause) {
      if (pickerGeneration.current !== generation) return
      setLocalError(`网页元素选择失败：${cause instanceof Error ? cause.message : String(cause)}`) // ZCode browser.elementPickerFailed
    } finally {
      if (pickerGeneration.current === generation) setPickerOn(false)
    }
  }, [tabId, insertElement])

  const togglePicker = useCallback((): void => {
    if (pickerOn) cancelPicker()
    else void startPicker()
  }, [pickerOn, cancelPicker, startPicker])

  // 渲染端 Escape 取消（焦点在宿主页面时；客户页内 Escape 由拾取脚本自处理）。
  useEffect(() => {
    if (!pickerOn) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); cancelPicker() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true) }
  }, [pickerOn, cancelPicker])

  /* ── 「更多」菜单外点关闭 ── */

  useEffect(() => {
    if (!moreOpen) return
    const onDown = (e: MouseEvent): void => {
      if (moreWrapRef.current !== null && !moreWrapRef.current.contains(e.target as Node)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('mousedown', onDown) }
  }, [moreOpen])

  /* ── 呈现 ── */

  const ready = state?.ready === true
  const loading = state?.loading === true
  const canGoBack = state?.canGoBack === true
  const canGoForward = state?.canGoForward === true
  const currentUrl = state?.url ?? ''
  const errorMessage = localError ?? (state?.error ?? null)
  const isEmpty = !loading && errorMessage === null && (currentUrl === '' || currentUrl === 'about:blank') && draft.trim() === ''
  const isExternalReady = ready && /^https?:\/\//i.test(currentUrl)

  return (
    <>
      <form
        className={css.browserBar}
        onSubmit={(e) => { e.preventDefault(); submitAddress() }}
      >
        <button type="button" className={css.navBtn} title="后退" aria-label="后退" data-testid="browser-back-button" disabled={!canGoBack} onClick={goBack}>
          <ArrowIcon dir="left" />
        </button>
        <button type="button" className={css.navBtn} title="前进" aria-label="前进" data-testid="browser-forward-button" disabled={!canGoForward} onClick={goForward}>
          <ArrowIcon dir="right" />
        </button>
        <button type="button" className={css.navBtn} title="刷新" aria-label="刷新" data-testid="browser-refresh-button" disabled={!ready} onClick={reload}>
          <span className={loading ? css.navBtnSpin : undefined}><ReloadIcon /></span>
        </button>
        <input
          className={css.browserInput}
          value={draft}
          data-testid="browser-address-input"
          onChange={(e) => { setDraft(e.target.value); setLocalError(null) }}
          onFocus={() => { setDraftFocused(true) }}
          onBlur={() => { setDraftFocused(false) }}
          placeholder="输入网址后回车"
          spellCheck={false}
        />
        <button
          type="button"
          className={css.navBtn + (responsiveOn ? ' ' + css.navBtnActive : '')}
          title={responsiveOn ? '退出响应式视口' : '响应式视口'}
          aria-label={responsiveOn ? '退出响应式视口' : '响应式视口'}
          aria-pressed={responsiveOn}
          data-testid="browser-responsive-button"
          onClick={() => { setResponsiveOn(v => !v) }}
        >
          <ResponsiveIcon />
        </button>
        <button
          type="button"
          className={css.navBtn + (pickerOn ? ' ' + css.navBtnActive : '')}
          title={pickerOn ? '取消网页元素选择' : '选择网页元素加入聊天'}
          aria-label={pickerOn ? '取消网页元素选择' : '选择网页元素加入聊天'}
          aria-pressed={pickerOn}
          data-testid="browser-element-picker-button"
          disabled={!ready}
          onClick={togglePicker}
        >
          <PickerIcon />
        </button>
        <div className={css.moreWrap} ref={moreWrapRef}>
          <button
            type="button"
            className={css.navBtn + (moreOpen ? ' ' + css.navBtnActive : '')}
            title="更多"
            aria-label="更多"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            data-testid="browser-more-button"
            onClick={() => { setMoreOpen(v => !v) }}
          >
            <MoreIcon />
          </button>
          {moreOpen && (
            <div className={css.moreMenu} role="menu">
              <button
                type="button"
                role="menuitem"
                className={css.moreItem}
                data-testid="browser-open-external-item"
                disabled={!isExternalReady}
                onClick={openExternal}
              >
                <ExternalIcon />
                <span>在默认浏览器中打开</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className={css.moreItem}
                data-testid="browser-devtools-button"
                disabled={!ready}
                onClick={openDevTools}
              >
                <DevToolsIcon />
                <span>开发者工具</span>
              </button>
            </div>
          )}
        </div>
      </form>
      {responsiveOn && (
        <div className={css.responsiveBar} data-testid="browser-responsive-toolbar">
          <label className={css.responsiveField}>
            <span>宽</span>
            <input
              className={css.responsiveInput}
              data-testid="browser-responsive-width-input"
              value={String(responsive.width)}
              inputMode="numeric"
              onChange={(e) => {
                const value = Number(e.target.value.replace(/[^0-9]/g, ''))
                if (Number.isFinite(value) && value > 0) setResponsive(r => ({ ...r, width: Math.min(3840, value) }))
              }}
            />
          </label>
          <label className={css.responsiveField}>
            <span>高</span>
            <input
              className={css.responsiveInput}
              data-testid="browser-responsive-height-input"
              value={String(responsive.height)}
              inputMode="numeric"
              onChange={(e) => {
                const value = Number(e.target.value.replace(/[^0-9]/g, ''))
                if (Number.isFinite(value) && value > 0) setResponsive(r => ({ ...r, height: Math.min(2160, value) }))
              }}
            />
          </label>
          <label className={css.responsiveField}>
            <span>缩放</span>
            <select
              className={css.responsiveSelect}
              data-testid="browser-responsive-zoom-select"
              value={responsive.zoom}
              onChange={(e) => { setResponsive(r => ({ ...r, zoom: e.target.value })) }}
            >
              {ZOOM_OPTIONS.map(option => (
                <option key={option} value={option} data-testid="browser-responsive-zoom-option">
                  {option === 'fit' ? '适应窗口' : option + '%'}
                </option>
              ))}
            </select>
          </label>
          <span className={css.responsiveHint}>{responsive.width} × {responsive.height} · {Math.round(responsiveScale * 100)}%</span>
        </div>
      )}
      {errorMessage !== null && (
        <div className={css.errorBar} role="alert">
          <span>页面加载失败：{errorMessage}</span>
          <button type="button" className={css.hintBtn} onClick={reload}>重试</button>
        </div>
      )}
      <div className={css.carrier} data-testid="browser-webview" ref={carrierRef}>
        {resizingFrame && (
          <div className={css.resizeWarning} role="status">
            <span>视口调整期间页面可能重新布局</span>
          </div>
        )}
        {frameGuide !== null && (
          <div
            className={css.frameGuide}
            data-testid="browser-responsive-scaled-frame"
            style={{ left: frameGuide.left, top: frameGuide.top, width: frameGuide.width, height: frameGuide.height }}
          >
            <div
              className={css.frameHandleRight}
              data-testid="browser-responsive-resize-width"
              role="slider"
              tabIndex={0}
              aria-label="调整视口宽度"
              aria-valuenow={responsive.width}
              onPointerDown={dragResizeFrame('right')}
              onKeyDown={nudgeFrame}
            />
            <div
              className={css.frameHandleBottom}
              data-testid="browser-responsive-resize-height"
              role="slider"
              tabIndex={0}
              aria-label="调整视口高度"
              aria-valuenow={responsive.height}
              onPointerDown={dragResizeFrame('bottom')}
              onKeyDown={nudgeFrame}
            />
            <div
              className={css.frameHandleCorner}
              data-testid="browser-responsive-resize-corner"
              role="slider"
              tabIndex={0}
              aria-label="调整视口尺寸"
              aria-valuenow={responsive.width}
              onPointerDown={dragResizeFrame('corner')}
              onKeyDown={nudgeFrame}
            />
          </div>
        )}
        {isEmpty && (
          <div className={css.emptyWebview}>
            <span className={css.emptyWebviewIcon}><GlobeIcon size={56} /></span>
            <h3 className={css.emptyWebviewTitle}>浏览器</h3>
            <p className={css.emptyWebviewDesc}>内嵌浏览器已就绪（独立会话分区，可打开任意站点）。在上方地址栏输入网址开始浏览。</p>
          </div>
        )}
      </div>
    </>
  )
}

interface BrowserPanelRouterProps {
  tabId: string
  sessionId?: string | undefined
  url: string
  active: boolean
  onNavigate: (url: string) => void
  onTitleChange: (title: string) => void
  insertElement: (info: PickedElement) => void
  getPaneEl: () => HTMLElement | null
  onFavicon?: ((favicon: string) => void) | undefined
}

/** 浏览器面板路由：webview 引擎（Electron 宿主）→ 原生视图承载；纯 Web → iframe。 */
function BrowserPanel({ tabId, active, ...rest }: BrowserPanelRouterProps) {
  const engine = useBrowserEngineKind()
  if (engine === 'webview') {
    return (
      <NativeBrowserPanel
        tabId={tabId}
        active={active}
        sessionId={rest.sessionId}
        url={rest.url}
        onNavigate={rest.onNavigate}
        onTitleChange={rest.onTitleChange}
        insertElement={rest.insertElement}
        onFavicon={rest.onFavicon}
      />
    )
  }
  if (engine === 'pending') return <div className={css.empty}>正在探测浏览器引擎…</div>
  return <IframeBrowserPanel {...rest} />
}

/* ── 浏览器标签面板（ZCode browser pane：导航工具条 + 元素拾取开关） ── */

interface BrowserPanelProps {
  sessionId?: string | undefined
  url: string
  onNavigate: (url: string) => void
  onTitleChange: (title: string) => void
  insertElement: (info: PickedElement) => void
  getPaneEl: () => HTMLElement | null
}

/** iframe 可达性/同源状态：用于把「拒绝连接 / 禁止嵌入」变成可操作的提示。 */
type FrameHealth = 'unknown' | 'same-origin' | 'cross-origin' | 'unreachable'

function IframeBrowserPanel({ sessionId, url, onNavigate, onTitleChange, insertElement, getPaneEl }: BrowserPanelProps) {
  const [draft, setDraft] = useState(url === 'about:blank' ? '' : url)
  const [pickerOn, setPickerOn] = useState(false)
  const [frameTick, setFrameTick] = useState(0)
  const [health, setHealth] = useState<FrameHealth>('unknown')
  const [hintDismissed, setHintDismissed] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => { setDraft(url === 'about:blank' ? '' : url) }, [url])

  // 目标可达性预检：no-cors fetch 只能判断「服务器有没有应答」——
  // 拒绝连接/DNS 失败会 reject（→ unreachable 错误态）；有应答则交给 iframe，
  // 是否被 X-Frame-Options 拦在 handleLoad 里按 contentDocument 可访问性判定。
  useEffect(() => {
    setHealth('unknown')
    setHintDismissed(false)
    if (!/^https?:\/\//i.test(url)) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => { controller.abort() }, 8000)
    fetch(url, { mode: 'no-cors', redirect: 'follow', signal: controller.signal })
      .catch(() => { setHealth(h => h === 'same-origin' ? h : 'unreachable') })
      .finally(() => { window.clearTimeout(timer) })
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [url, retryTick])

  const navigate = (raw: string): void => {
    // 浏览器标签是通用浏览器：任意 http/https 均可打开（ZCode browser 语义），
    // 不再用 resolvePreviewUrl（只放行回环/产物，输真实网址会静默无反应）。
    // 裸域名自动补 https，回环主机补 http；相对前端产物路径仍映射到 /preview。
    const trimmed = raw.trim()
    if (trimmed === '') return
    const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !trimmed.startsWith('/') && !trimmed.startsWith('//')
    if (bare && looksLikeFrontendPath(trimmed) && sessionId !== undefined && sessionId !== null) {
      const mapped = resolvePreviewUrl(trimmed, sessionId)
      if (mapped !== undefined) { onNavigate(mapped); return }
    }
    const resolved = normalizeBrowserUrl(trimmed)
    if (resolved === undefined) return
    onNavigate(resolved)
  }

  const tryHistory = (dir: 'back' | 'forward'): void => {
    try {
      const win = frameRef.current?.contentWindow
      if (win === null || win === undefined) return
      if (dir === 'back') win.history.back()
      else win.history.forward()
    } catch { /* 跨域 iframe 无法操作，忽略 */ }
  }

  const reload = (): void => {
    const frame = frameRef.current
    if (frame === null) return
    try {
      frame.contentWindow?.location.reload()
    } catch {
      // 跨域时退回重设 src。
      const src = frame.src
      frame.src = 'about:blank'
      window.setTimeout(() => { frame.src = src }, 0)
    }
  }

  const openExternal = (): void => {
    if (url !== '' && url !== 'about:blank') window.open(url, '_blank', 'noopener')
  }

  // 通过 Host 代理重新嵌入：/liuli-proxy 抓取目标页并剥除 X-Frame-Options/CSP，
  // iframe 以同源加载，绕过站点禁止嵌入（ZCode webview 的纯网页近似）。
  const openViaProxy = (): void => {
    if (url === '' || url === 'about:blank') return
    if (url.startsWith('/liuli-proxy')) return
    onNavigate(`/liuli-proxy?url=${encodeURIComponent(url)}`)
  }

  const isProxied = url.startsWith('/liuli-proxy')

  // 同源页面加载后提取 document.title 作为标签标题（ZCode onPageMetadataChange 对应）；
  // contentDocument 不可读 ⇒ 跨域（含被 X-Frame-Options 拦截的空白页）⇒ 给提示条。
  const handleLoad = (): void => {
    setFrameTick(t => t + 1)
    let doc: Document | null | undefined
    try { doc = frameRef.current?.contentDocument } catch { doc = null }
    if (doc !== null && doc !== undefined) {
      setHealth('same-origin')
      const title = doc.title ?? ''
      if (title.trim() !== '') onTitleChange(title.trim())
    } else if (url !== 'about:blank' && url !== '') {
      setHealth(h => h === 'unreachable' ? h : 'cross-origin')
    }
  }

  const retry = (): void => { setRetryTick(t => t + 1) }

  const urlHost = ((): string => {
    try { return new URL(url, window.location.href).host } catch { return url }
  })()

  // 元素拾取（ZCode browser.elementPicker：按钮显式开启，选完自动关闭）。
  useEffect(() => {
    if (!pickerOn) return
    const doc = frameRef.current?.contentDocument
    if (doc === null || doc === undefined) return
    const detach = attachElementPicker(doc, {
      onPick: (el) => {
        insertElement(describeElement(el))
        setPickerOn(false)
      },
    }, getPaneEl())
    return () => { detach?.() }
  }, [pickerOn, frameTick, insertElement, getPaneEl])

  return (
    <>
      <form
        className={css.browserBar}
        onSubmit={(e) => { e.preventDefault(); navigate(draft) }}
      >
        <button type="button" className={css.navBtn} title="后退" aria-label="后退" onClick={() => { tryHistory('back') }}>
          <ArrowIcon dir="left" />
        </button>
        <button type="button" className={css.navBtn} title="前进" aria-label="前进" onClick={() => { tryHistory('forward') }}>
          <ArrowIcon dir="right" />
        </button>
        <button type="button" className={css.navBtn} title="刷新" aria-label="刷新" onClick={reload}>
          <ReloadIcon />
        </button>
        <input
          className={css.browserInput}
          value={draft}
          onChange={(e) => { setDraft(e.target.value) }}
          placeholder="输入网址后回车"
          spellCheck={false}
        />
        <button
          type="button"
          className={css.navBtn + (pickerOn ? ' ' + css.navBtnActive : '')}
          title={pickerOn ? '取消网页元素选择' : '选择网页元素加入聊天'}
          aria-label={pickerOn ? '取消网页元素选择' : '选择网页元素加入聊天'}
          aria-pressed={pickerOn}
          onClick={() => { setPickerOn(v => !v) }}
        >
          <PickerIcon />
        </button>
        <button type="button" className={css.navBtn} title="在默认浏览器中打开" aria-label="在默认浏览器中打开" onClick={openExternal}>
          <ExternalIcon />
        </button>
      </form>
      {url === 'about:blank' || url === '' ? (
        <div className={css.empty}>粘贴或输入 URL 以打开网页。</div>
      ) : health === 'unreachable' ? (
        <div className={css.empty}>
          <span>无法连接到 {urlHost}(连接被拒绝或网络不可达)。</span>
          <span className={css.emptyActions}>
            <button type="button" className={css.hintBtn} onClick={retry}>重试</button>
            <button type="button" className={css.hintBtn} onClick={openExternal}>在默认浏览器中打开</button>
          </span>
        </div>
      ) : (
        <>
          {health === 'cross-origin' && !hintDismissed && !isProxied && (
            <div className={css.frameHint} role="note">
              <span className={css.frameHintText}>
                跨域页面:元素拾取不可用。若页面空白,是该站点禁止被嵌入显示(如 Google、GitHub),可试「代理嵌入」或在默认浏览器打开。
              </span>
              <button type="button" className={css.hintBtn} title="经 Host 抓取并剥除禁止嵌入头,重 JS 站点可能降级" onClick={openViaProxy}>代理嵌入</button>
              <button type="button" className={css.hintBtn} onClick={openExternal}>在默认浏览器中打开</button>
              <button type="button" className={css.navBtn} aria-label="关闭提示" title="关闭提示" onClick={() => { setHintDismissed(true) }}>
                <XIcon size={10} />
              </button>
            </div>
          )}
          <iframe
            key={retryTick}
            ref={frameRef}
            className={css.frame}
            title="浏览器"
            src={url}
            onLoad={handleLoad}
          />
        </>
      )}
    </>
  )
}

/* ── 代码查看标签面板（ZCode code-viewer：无元素拾取） ── */

interface CodeViewerPanelProps {
  sessionId?: string | undefined
  rel: string
  path: string
  onOpenPath?: ((path: string) => void) | undefined
}

function CodeViewerPanel({ sessionId, rel, path, onOpenPath }: CodeViewerPanelProps) {
  const src = sessionId === undefined || sessionId === null || rel === ''
    ? 'about:blank'
    : `/preview/${encodeURIComponent(sessionId)}/${rel.split('/').map(s => encodeURIComponent(s)).join('/')}`

  return (
    <>
      <div className={css.codeBar}>
        <span className={css.codePath} title={path !== '' ? path : rel}>{rel}</span>
        {path !== '' && (
          <button
            type="button"
            className={css.navBtn}
            title="用默认编辑器打开"
            aria-label="用默认编辑器打开"
            onClick={() => { onOpenPath?.(path) }}
          >
            <ExternalIcon />
          </button>
        )}
      </div>
      <iframe
        className={css.frame}
        title={rel !== '' ? rel : '代码查看'}
        src={src}
      />
    </>
  )
}

/* ── header utilities 里的开关按钮（ZCode：panel-right-open/close + 切换面板） ── */

export interface PreviewButtonProps {
  onToggle?: () => void
}

/** Header utilities 里的开关按钮：点击展开/收起右侧面板（ZCode 切换面板按钮对应物）。 */
export function PreviewButton({ onToggle }: PreviewButtonProps) {
  const [opened, setOpened] = useState(previewOpen)

  useEffect(() => {
    const onToggleEvent = (): void => { setOpened(previewOpen) }
    window.addEventListener(PREVIEW_TOGGLE_EVENT, onToggleEvent)
    return () => { window.removeEventListener(PREVIEW_TOGGLE_EVENT, onToggleEvent) }
  }, [])

  return (
    <button
      type="button"
      className={css.openBtn + (opened ? ' ' + css.openBtnActive : '')}
      title="切换面板 (Ctrl+Alt+B)"
      aria-label={opened ? '收起侧边面板' : '展开侧边面板'}
      onClick={() => {
        if (onToggle !== undefined) onToggle()
        else window.dispatchEvent(new CustomEvent(PREVIEW_TOGGLE_EVENT))
      }}
    >
      {opened ? <PanelRightCloseIcon size={16} /> : <PanelRightOpenIcon size={16} />}
    </button>
  )
}
