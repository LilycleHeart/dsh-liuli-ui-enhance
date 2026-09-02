/**
 * dsh-liuli-ui-enhance 嵌入式浏览器引擎（Host 半，实现 DSH Desktop IAB）。
 *
 * 参考实现桌面端用 Electron <webview>（09-renderer-renamed styles-OqUHW1P0
 * _Component491：partition persist:embedded-browser、allowpopups、
 * did-start-loading/did-stop-loading/did-navigate/did-navigate-in-page/
 * page-title-updated/did-fail-load/render-process-gone 全套事件同步；
 * 新窗口请求转右侧浏览器标签）。DSH 宿主窗口未开 webviewTag，插件不能
 * 改宿主窗口构造参数，因此本引擎在 Electron 主进程内直接用 WebContentsView
 * 承载页面：独立会话分区、任意站点（无 X-Frame-Options 限制）、弹窗转标签、
 * 崩溃原位重建，语义与 webview 一致；渲染端把面板几何上报过来，
 * 视图精确贴合侧边栏浏览器面板区域（data-testid browser-webview 的承载位）。
 *
 * 纯 Web 部署（无 Electron）时 createBrowserEngine 返回 undefined，
 * 渲染端自动回退 iframe + /liuli-proxy 路径。
 *
 * Electron API 用本地结构化声明（monorepo 不安装 electron 包，无法取官方
 * 类型；结构化声明同时兼容主进程 import/require 两种取法）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { createBrowserOps, OPS_METHODS, type ElectronDebugger, type OpsResult } from './browser-ops.ts'

/* ── 本引擎用到的 Electron 主进程 API 最小面 ─────────────────────────── */

interface ElectronWebContents {
  on(event: string, listener: (...args: never[]) => void): void
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  getType(): string
  reload(): void
  stop(): void
  focus(): void
  close(): void
  isDestroyed(): boolean
  isLoading(): boolean
  openDevTools(options?: { mode?: string }): void
  setZoomFactor(factor: number): void
  getZoomFactor(): number
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  capturePage(): Promise<{ toPNG(): Buffer }>
  setWindowOpenHandler(handler: (details: { url: string; disposition: string }) => { action: 'deny' | 'allow' }): void
  navigationHistory: { canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void }
  /** CDP 调试器（browser-ops 操作面挂载点；Electron wc 全量具备）。 */
  debugger: ElectronDebugger
}

interface ElectronWebContentsView {
  webContents: ElectronWebContents
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void
  setVisible(visible: boolean): void
  setBackgroundColor(color: string): void
}

interface ElectronBrowserWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  contentView: {
    addChildView(view: ElectronWebContentsView, index?: number): void
    removeChildView(view: ElectronWebContentsView): void
  }
}

interface ElectronDownloadItem {
  setSaveDialogOptions(options: { title?: string }): void
}

interface ElectronMain {
  BrowserWindow: { getAllWindows(): ElectronBrowserWindow[] }
  WebContentsView: new (options: { webPreferences: Record<string, unknown> }) => ElectronWebContentsView
  webContents: { getAllWebContents(): ElectronWebContents[] }
  session: { fromPartition(partition: string): { on(event: 'will-download', listener: (e: unknown, item: ElectronDownloadItem) => void): void } }
  shell: { openExternal(url: string): Promise<void>; openPath(path: string): Promise<string> }
}

/** 与渲染端共享的标签状态快照（SSE state 事件载荷）。 */
export interface BrowserTabState {
  url: string
  title: string
  favicon: string | null
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  ready: boolean
  error: string | null
}

/** SSE 推送给渲染端的事件。 */
type BrowserEvent =
  | { type: 'hello'; tabs: Array<{ tabId: string; state: BrowserTabState }> }
  | { type: 'state'; tabId: string; state: BrowserTabState }
  | { type: 'new-tab'; sourceTabId: string; url: string; disposition: string }
  | { type: 'dialog'; tabId: string; kind: 'alert' | 'confirm' | 'prompt'; message: string }
  | { type: 'closed'; tabId: string }

/** webview 的会话分区实现（persist: 前缀保留 cookie/storage 跨重启）。 */
const PARTITION = 'persist:liuli-embedded-browser'
/** 视口硬限制（BROWSER_VIEWPORT_LIMITS：320..3840 / 320..2160）。 */
const VIEWPORT_MIN = 320
const VIEWPORT_MAX_W = 3840
const VIEWPORT_MAX_H = 2160

/**
 * 客户页 JS 对话框垫片（DSH embeddedBrowserJavaScriptDialog 预加载的轻量实现）。
 * 真实 webview 里 alert/confirm/prompt 默认弹原生模态框并阻塞自动化；垫片改为
 * 自动应答（confirm/prompt 可被 ops handleDialog 预设的一次性策略覆盖，默认
 * confirm 接受、prompt 返回默认值）并经 console.info 上报，Host 侧用
 * console-message 事件转发为 SSE dialog 事件供渲染端提示；同时记录环形历史
 * 供 ops getDialog 读取（agent 感知页面弹了什么、应答了什么）。
 */
const DIALOG_SHIM_SCRIPT = `(() => {
  if (window.__liuliDialogShim) return
  window.__liuliDialogShim = true
  const send = (kind, message, response) => {
    try {
      const h = window.__liuliDialogHistory || (window.__liuliDialogHistory = [])
      h.push({ kind, message: String(message).slice(0, 300), response, at: Date.now() })
      if (h.length > 20) h.shift()
      console.info('[liuli-dialog] ' + kind + ': ' + String(message).slice(0, 300))
    } catch { /* 忽略 */ }
  }
  window.alert = (message) => { send('alert', message, 'ok') }
  window.confirm = (message) => {
    const p = window.__liuliDialogPolicy
    const accept = p && typeof p.accept === 'boolean' ? p.accept : true
    if (p) delete window.__liuliDialogPolicy
    send('confirm', message, accept ? 'accept' : 'dismiss')
    return accept
  }
  window.prompt = (message, fallback) => {
    const p = window.__liuliDialogPolicy
    const text = p && typeof p.promptText === 'string' ? p.promptText : (fallback === undefined ? null : fallback)
    if (p) delete window.__liuliDialogPolicy
    send('prompt', message, text === null ? 'null' : String(text))
    return text
  }
})()`

/** 单个浏览器标签：一个 WebContentsView + 状态镜像。 */
interface EngineTab {
  id: string
  view: ElectronWebContentsView
  state: BrowserTabState
  /** 最近一次请求的视口尺寸（响应式模式用；null = 跟随承载位）。 */
  viewport: { width: number; height: number; scale: number } | null
  /** 最近上报的承载位几何。 */
  geometry: { x: number; y: number; width: number; height: number; visible: boolean }
  /** 最近一次应用的上报序号（渲染端并发 POST 乱序时丢弃过期几何）。 */
  lastGeoSeq: number
  /** 渲染端几何上报会话号（页面重载后序号从 0 重新开始，需识别并重置序号）。 */
  lastGeoSession: string | null
  /** 崩溃重建计数（webviewGeneration 对应）。 */
  generation: number
  /** 恢复用最近 URL（DSH render-process-gone 原位重建语义）。 */
  lastRequestedUrl: string
  /** 最近活动时间（驱逐调度用：超限时关最久未用的 agent 标签）。 */
  lastActivityAt: number
  /** 归属会话（scope 隔离；null = 公共标签，所有会话可见可操作）。 */
  ownerSessionId: string | null
}

export interface BrowserEngine {
  route: WebRoute
  dispose: () => void
}

/** 尝试加载 Electron 主进程 API；非 Electron 环境返回 undefined。 */
async function loadElectron(): Promise<ElectronMain | undefined> {
  if (typeof process === 'undefined' || process.versions?.electron === undefined) return undefined
  // 变量 specifier：monorepo 无 electron 类型包，避开 TS 静态模块解析；
  // Electron 主进程运行时该 bare specifier 解析为内置 electron 模块。
  const electronSpecifier = 'electron'
  try {
    return await import(electronSpecifier) as unknown as ElectronMain
  } catch {
    try {
      const { createRequire } = await import('node:module')
      const esmRequire = createRequire(import.meta.url)
      return esmRequire('electron') as ElectronMain
    } catch {
      return undefined
    }
  }
}

/** 只接受回环调用方（与 /preview、/liuli-sidebar 同一道 Host fence）。 */
function isLoopbackCaller(req: IncomingMessage): boolean {
  const host = req.headers.host
  if (host === undefined) return false
  try {
    const hostname = new URL(`http://${host}`).hostname
    if (hostname === 'localhost' || hostname === '[::1]') return true
    const parts = hostname.split('.')
    return parts.length === 4 && parts[0] === '127' && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  } catch {
    return false
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage, limit = 1024 * 1024): Promise<{ [key: string]: unknown } | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > limit) throw new Error('body too large')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed as { [key: string]: unknown } : undefined
  } catch {
    return undefined
  }
}

const asString = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined
const asNumber = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * 创建嵌入式浏览器引擎；非 Electron 环境返回 undefined。
 * 引擎注册 /liuli-browser 前缀路由（能力探测 / 标签生命周期 / 几何同步 /
 * 导航动作 / 状态快照 / 截图 / JS 执行 / SSE 事件流）。
 */
export async function createBrowserEngine(): Promise<BrowserEngine | undefined> {
  const electron = await loadElectron()
  if (electron === undefined) return undefined
  const { BrowserWindow, WebContentsView, session, shell } = electron

  const tabs = new Map<string, EngineTab>()
  const sseClients = new Set<ServerResponse>()
  const guestSession = session.fromPartition(PARTITION)
  let disposed = false

  const broadcast = (event: BrowserEvent): void => {
    const line = `data: ${JSON.stringify(event)}\n\n`
    for (const res of sseClients) {
      try { res.write(line) } catch { sseClients.delete(res) }
    }
  }

  const findWindow = (): ElectronBrowserWindow | undefined => {
    // 跳过 DevTools 窗口（detach 模式的 devtools 是独立 BrowserWindow）。
    const wins = BrowserWindow.getAllWindows().filter(win => !win.isDestroyed())
    const gui = wins.find(win => !(win as unknown as { webContents?: { isDevTools?(): boolean } }).webContents?.isDevTools?.())
    return gui ?? wins[0]
  }

  /** CDP 操作面（aria 快照 / 真实输入 / world 求值；browser-ops.ts）。 */
  const opsSurfaces = new Set<string>()
  const ops = createBrowserOps({
    findWindow,
    prepareTabSurface: async (tabId: string): Promise<void> => {
      const tab = tabs.get(tabId)
      const win = findWindow()
      if (tab === undefined || win === undefined) return
      const geo = tab.geometry
      if (geo.visible && geo.width >= 4 && geo.height >= 4) return // 已有可见承载
      try {
        // 垫到 GUI 之下（index 0）+ 1024×768：输入管线的 hit test 需要合成帧，
        // 屏外/隐藏视图的 mousePressed/Released 不挂死但不命中（实测不触发 onclick）。
        win.contentView.removeChildView(tab.view)
        win.contentView.addChildView(tab.view, 0)
        tab.view.setVisible(true)
        tab.view.setBounds({ x: 0, y: 0, width: 1024, height: 768 })
        opsSurfaces.add(tabId)
        // 等合成器出帧:垫层后立即点击会命中旧空白帧,iframe 等延迟合成的内容全 miss。
        await new Promise(resolve => setTimeout(resolve, 320))
      } catch { /* 窗口已销毁等场景忽略 */ }
    },
    restoreTabSurface: (tabId: string): void => {
      const tab = tabs.get(tabId)
      if (tab === undefined || !opsSurfaces.delete(tabId)) return
      raiseView(tab)
      applyBounds(tab)
    },
  })

  const applyBounds = (tab: EngineTab): void => {
    const geo = tab.geometry
    const hidden = !geo.visible || geo.width < 4 || geo.height < 4
    if (hidden) {
      // 移出可视区并隐藏：保留 guest 进程与历史，切回零延迟。
      tab.view.setVisible(false)
      tab.view.setBounds({ x: -20000, y: -20000, width: 1, height: 1 })
      return
    }
    const vp = tab.viewport
    if (vp !== null) {
      // 响应式模式：客户机视口固定 vp.width×vp.height，zoom=scale 视觉缩放
      // （等效 DSH CSS transform scale 的 webview 呈现）。
      const width = Math.max(1, Math.round(vp.width * vp.scale))
      const height = Math.max(1, Math.round(vp.height * vp.scale))
      const x = Math.round(geo.x + Math.max(0, (geo.width - width) / 2))
      const y = Math.round(geo.y + Math.max(0, (geo.height - height) / 2))
      tab.view.setVisible(true)
      tab.view.setBounds({ x, y, width, height })
      if (tab.view.webContents.getZoomFactor() !== vp.scale) tab.view.webContents.setZoomFactor(vp.scale)
      return
    }
    if (tab.view.webContents.getZoomFactor() !== 1) tab.view.webContents.setZoomFactor(1)
    tab.view.setVisible(true)
    tab.view.setBounds({ x: Math.round(geo.x), y: Math.round(geo.y), width: Math.max(1, Math.round(geo.width)), height: Math.max(1, Math.round(geo.height)) })
  }

  const pushState = (tab: EngineTab): void => {
    broadcast({ type: 'state', tabId: tab.id, state: { ...tab.state } })
  }

  /** 把视图提到最顶层（常规承载：盖住 GUI 的 carrier 区域）。 */
  const raiseView = (tab: EngineTab): void => {
    const win = findWindow()
    if (win === undefined) return
    try {
      win.contentView.removeChildView(tab.view)
      win.contentView.addChildView(tab.view)
    } catch { /* 窗口已销毁等场景忽略 */ }
  }

  /** webContents 事件 → 状态镜像 + SSE（did-* 监听一一对应）。 */
  const wireEvents = (tab: EngineTab): void => {    const wc = tab.view.webContents
    wc.on('did-start-loading', () => {
      tab.state.loading = true
      tab.state.error = null
      pushState(tab)
    })
    wc.on('did-stop-loading', () => {
      tab.state.loading = false
      tab.state.ready = true
      tab.state.canGoBack = wc.navigationHistory.canGoBack()
      tab.state.canGoForward = wc.navigationHistory.canGoForward()
      const current = wc.getURL()
      if (current !== '') tab.state.url = current
      pushState(tab)
    })
    const syncNavigation = (): void => {
      const current = wc.getURL()
      if (current !== '') tab.state.url = current
      tab.state.canGoBack = wc.navigationHistory.canGoBack()
      tab.state.canGoForward = wc.navigationHistory.canGoForward()
      tab.state.ready = true
      pushState(tab)
    }
    wc.on('did-navigate', syncNavigation)
    wc.on('did-navigate-in-page', syncNavigation)
    wc.on('page-title-updated', (...args: unknown[]) => {
      const title = args[1]
      if (typeof title === 'string') {
        tab.state.title = title
        pushState(tab)
      }
    })
    wc.on('page-favicon-updated', (...args: unknown[]) => {
      // DSH page-favicon-updated → faviconUrl（标签条图标）。
      const favicons = args[1]
      tab.state.favicon = Array.isArray(favicons) && typeof favicons[0] === 'string' ? favicons[0] : null
      pushState(tab)
    })
    wc.on('dom-ready', () => {
      // 每次文档加载完成注入对话框垫片（SPA 内导航不重触发，脚本仍在）。
      wc.executeJavaScript(DIALOG_SHIM_SCRIPT, false).catch(() => { /* 注入失败不影响页面 */ })
    })
    wc.on('console-message', (...args: unknown[]) => {
      // Electron 43 载荷：(event, level, message, line, sourceId)；找 [liuli-dialog] 前缀串。
      let message = ''
      for (const arg of args) {
        if (typeof arg === 'string' && arg.startsWith('[liuli-dialog]')) { message = arg; break }
      }
      if (message === '') return
      const parsed = /^\[liuli-dialog\] (alert|confirm|prompt): (.*)$/s.exec(message)
      if (parsed === null) return
      broadcast({ type: 'dialog', tabId: tab.id, kind: parsed[1] as 'alert' | 'confirm' | 'prompt', message: parsed[2] ?? '' })
    })
    wc.on('did-fail-load', (...args: unknown[]) => {
      // 第一个参数是事件对象；errorCode 起才是载荷。
      const [, errorCode, errorDescription, validatedURL, isMainFrame] = args as [unknown, number, string, string, boolean]
      if (isMainFrame === false) return
      if (errorCode === -3) return // ERR_ABORTED：被新导航打断，非错误（DSH 同语义）
      tab.state.loading = false
      tab.state.error = `${errorDescription} (${String(errorCode)})`
      if (typeof validatedURL === 'string' && validatedURL !== '') tab.state.url = validatedURL
      pushState(tab)
    })
    wc.on('render-process-gone', () => {
      // DSH：guest renderer 异常退出 → 原位重建并恢复最近 URL。
      if (disposed || !tabs.has(tab.id)) return
      const restoreUrl = tab.lastRequestedUrl !== '' ? tab.lastRequestedUrl : tab.state.url
      rebuildTab(tab, restoreUrl)
    })
    wc.setWindowOpenHandler((details) => {
      // DSH：[App] webview 请求打开右侧浏览器 tab（一律转侧边栏新标签）。
      broadcast({ type: 'new-tab', sourceTabId: tab.id, url: details.url, disposition: details.disposition })
      return { action: 'deny' }
    })
  }

  /** 创建 guest webContents 视图（崩溃重建共用）。 */
  const makeView = (): ElectronWebContentsView => {
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        javascript: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
      },
    })
    view.setBackgroundColor('#00000000')
    return view
  }

  /** 原位重建（render-process-gone 恢复路径，generation 递增）。 */
  const rebuildTab = (tab: EngineTab, restoreUrl: string): void => {
    const win = findWindow()
    try { if (win !== undefined) win.contentView.removeChildView(tab.view) } catch { /* 已移除 */ }
    try { if (tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.detach() } catch { /* 未附着 */ }
    try { tab.view.webContents.close() } catch { /* 已销毁 */ }
    tab.generation += 1
    tab.view = makeView()
    tab.state = {
      url: restoreUrl !== '' ? restoreUrl : 'about:blank',
      title: '',
      favicon: null,
      canGoBack: false,
      canGoForward: false,
      loading: restoreUrl !== '' && restoreUrl !== 'about:blank',
      ready: false,
      error: null,
    }
    wireEvents(tab)
    if (win !== undefined) win.contentView.addChildView(tab.view)
    applyBounds(tab)
    if (restoreUrl !== '' && restoreUrl !== 'about:blank') {
      tab.view.webContents.loadURL(restoreUrl).catch(() => { /* did-fail-load 上报 */ })
    }
    pushState(tab)
  }

  /** 引擎标签持久化文件（跨重启恢复；仅记 agent:/browser: 前缀标签）。 */
  const tabsStorePath = join(homedir(), '.liuli-theme', 'browser-tabs.json')
  /** 标签上限（简化驱逐：超限时关最久未用的 agent 标签，GUI 桥接标签不动）。 */
  const TAB_LIMIT = 32

  const persistTabs = (): void => {
    try {
      mkdirSync(dirname(tabsStorePath), { recursive: true })
      const rows = [...tabs.entries()]
        .filter(([id]) => id.startsWith('agent:') || id.startsWith('browser:'))
        .map(([id, t]) => ({ id, url: t.lastRequestedUrl !== '' ? t.lastRequestedUrl : t.state.url }))
      writeFileSync(tabsStorePath, JSON.stringify({ version: 1, savedAt: Date.now(), tabs: rows }, null, 2))
    } catch { /* 持久化尽力而为 */ }
  }

  const createTab = (id: string, url: string, ownerSessionId: string | null = null): EngineTab => {
    const existing = tabs.get(id)
    if (existing !== undefined) return existing
    const win = findWindow()
    if (win === undefined) throw new Error('no host window')
    // 简化驱逐(参考实现 BrowserTabResidencyCoordinator 的最低限对应):只驱逐无
    // GUI carrier 的 agent:* 标签里最久未用的;没有候选则允许超限。
    if (tabs.size >= TAB_LIMIT) {
      const victim = [...tabs.values()]
        .filter(t => t.id.startsWith('agent:'))
        .sort((a, b) => a.lastActivityAt - b.lastActivityAt)[0]
      if (victim !== undefined) destroyTab(victim.id)
    }
    const view = makeView()
    const tab: EngineTab = {
      id,
      view,
      state: { url: url !== '' ? url : 'about:blank', title: '', favicon: null, canGoBack: false, canGoForward: false, loading: url !== '' && url !== 'about:blank', ready: false, error: null },
      viewport: null,
      geometry: { x: 0, y: 0, width: 0, height: 0, visible: false },
      lastGeoSeq: 0,
      lastGeoSession: null,
      generation: 0,
      lastRequestedUrl: url !== '' && url !== 'about:blank' ? url : '',
      lastActivityAt: Date.now(),
      ownerSessionId,
    }
    wireEvents(tab)
    tabs.set(id, tab)
    win.contentView.addChildView(view)
    view.setBounds({ x: -20000, y: -20000, width: 1, height: 1 })
    if (url !== '' && url !== 'about:blank') {
      view.webContents.loadURL(url).catch(() => { /* did-fail-load 上报 */ })
    }
    persistTabs()
    return tab
  }

  const destroyTab = (id: string): boolean => {
    const tab = tabs.get(id)
    if (tab === undefined) return false
    tabs.delete(id)
    const win = findWindow()
    try { if (win !== undefined) win.contentView.removeChildView(tab.view) } catch { /* 窗口已销毁 */ }
    try { if (tab.view.webContents.debugger.isAttached()) tab.view.webContents.debugger.detach() } catch { /* 未附着 */ }
    try { tab.view.webContents.close() } catch { /* 已销毁 */ }
    broadcast({ type: 'closed', tabId: id })
    persistTabs()
    return true
  }

  /** 下载走分区会话默认保存对话框。 */
  guestSession.on('will-download', (_e: unknown, item: ElectronDownloadItem) => {
    item.setSaveDialogOptions({ title: '保存文件' })
  })

  // 跨重启恢复:按持久化记录重建上次的引擎标签。延迟 3s 等主窗口就绪
  // (插件加载可能早于窗口创建);尽力而为,单个失败不影响其它。
  setTimeout(() => {
    try {
      const parsed = JSON.parse(readFileSync(tabsStorePath, 'utf8')) as { tabs?: Array<{ id?: string; url?: string }> }
      for (const row of parsed.tabs ?? []) {
        if (typeof row.id === 'string' && typeof row.url === 'string' && row.url !== '' && row.url !== 'about:blank' && !tabs.has(row.id)) {
          try { createTab(row.id, row.url) } catch { /* 单个恢复失败忽略 */ }
        }
      }
    } catch { /* 无记录或损坏,跳过 */ }
  }, 3000)

  /**
   * 标签页 PNG 截图(既有 /tabs/screenshot 与 ops screenshot 共用)。
   * 隐藏/屏外视图不参与合成（capturePage 会返回空图）：临时移进窗口取帧;
   * 优先垫到 GUI 之下（index 0）避免闪烁;若仍为空再抬到顶层重试一次。
   */
  const captureTabPng = async (tab: EngineTab): Promise<Buffer> => {
    const geo = tab.geometry
    const hidden = !geo.visible || geo.width < 4 || geo.height < 4
    const captureOnce = async (): Promise<Buffer> => {
      const image = await tab.view.webContents.capturePage()
      return image.toPNG()
    }
    if (!hidden) return captureOnce()
    const win = findWindow()
    const width = 1024
    const height = 768
    const prepare = (index?: number): void => {
      if (win === undefined) return
      try {
        win.contentView.removeChildView(tab.view)
        win.contentView.addChildView(tab.view, index)
        tab.view.setVisible(true)
        tab.view.setBounds({ x: 0, y: 0, width, height })
      } catch { /* 忽略 */ }
    }
    prepare(0)
    await new Promise(r => setTimeout(r, 280))
    let png = await captureOnce()
    if (png.length === 0) {
      prepare() // 顶层重试（短暂可见）
      await new Promise(r => setTimeout(r, 280))
      png = await captureOnce()
    }
    raiseView(tab)
    applyBounds(tab)
    return png
  }

  /**
   * ops 路由目标解析:引擎标签优先;tabId 形如 'webview' / 'webview:<urlSubstr>'
   * 时解析侧边栏 <webview> 承载(webviewTag 补丁生效时 PreviewPanel 走 DOM webview,
   * 不建引擎标签)的 guest webContents,使 CDP 操作面同一套能力覆盖两种承载。
   * scope 隔离:有主标签(ownerSessionId ≠ null)只对所属会话可见,其它会话
   * 视同 unknown tab(与 参考实现「list 不到」一致);无主 = 公共。
   */
  const resolveOpsTarget = (tabId: string, sessionId: string | undefined): { wc: ElectronWebContents; engineTab?: EngineTab } | undefined => {
    const engineTab = tabs.get(tabId)
    if (engineTab !== undefined) {
      if (engineTab.ownerSessionId !== null && engineTab.ownerSessionId !== sessionId) return undefined
      return { wc: engineTab.view.webContents, engineTab }
    }
    if (tabId === 'webview' || tabId.startsWith('webview:')) {
      const needle = tabId.startsWith('webview:') ? tabId.slice(8) : ''
      const guest = electron.webContents.getAllWebContents().find(wc =>
        wc.getType() === 'webview' && !wc.isDestroyed() && (needle === '' || wc.getURL().includes(needle)))
      if (guest !== undefined) return { wc: guest }
    }
    return undefined
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isLoopbackCaller(req)) { sendJson(res, 403, { ok: false, error: 'forbidden' }); return }
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    const method = req.method ?? 'GET'

    try {
      if (path === '/liuli-browser/capabilities') {
        sendJson(res, 200, {
          ok: true,
          engine: 'webview',
          partition: PARTITION,
          viewport: { min: VIEWPORT_MIN, maxW: VIEWPORT_MAX_W, maxH: VIEWPORT_MAX_H },
          tabs: [...tabs.keys()],
          ops: ['getState', 'navigate', 'back', 'forward', 'reload', 'stop', 'newTab', 'closeTab', 'list', 'screenshot', 'browserViewportSet', 'browserViewportReset', ...OPS_METHODS],
        })
        return
      }

      if (path === '/liuli-browser/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          'connection': 'keep-alive',
          'x-accel-buffering': 'no',
        })
        const hello: BrowserEvent = { type: 'hello', tabs: [...tabs.entries()].map(([tabId, t]) => ({ tabId, state: { ...t.state } })) }
        res.write(`data: ${JSON.stringify(hello)}\n\n`)
        sseClients.add(res)
        const ping = setInterval(() => { try { res.write(': ping\n\n') } catch { /* 断开由 close 清理 */ } }, 25000)
        req.on('close', () => { clearInterval(ping); sseClients.delete(res) })
        return
      }

      if (method === 'POST' && path === '/liuli-browser/tabs') {
        const body = await readBody(req)
        const id = asString(body?.id) ?? ''
        const target = asString(body?.url) ?? ''
        if (id === '') { sendJson(res, 400, { ok: false, error: 'missing id' }); return }
        const tab = createTab(id, target, asString(body?.sessionId) ?? null)
        sendJson(res, 200, { ok: true, tabId: tab.id, state: tab.state, generation: tab.generation })
        return
      }

      if (method === 'POST' && path === '/liuli-browser/tabs/destroy') {
        const body = await readBody(req)
        const id = asString(body?.id) ?? ''
        sendJson(res, 200, { ok: destroyTab(id) })
        return
      }

      if (method === 'POST' && path === '/liuli-browser/tabs/geometry') {
        const body = await readBody(req)
        const tab = tabs.get(asString(body?.id) ?? '')
        if (tab === undefined) { sendJson(res, 404, { ok: false, error: 'unknown tab' }); return }
        // 渲染端并发上报可能乱序到达：同一会话内序号更旧的直接丢弃，避免旧 bounds
        // 覆盖新 bounds 导致原生视图比 carrier 宽/高、视觉上溢出面板。页面重载后
        // 渲染端会话号变化、序号从 0 重新开始，此时按新会话接受并重置序号。
        const session = asString(body?.session)
        const seq = asNumber(body?.seq)
        if (session !== undefined && session !== tab.lastGeoSession) {
          tab.lastGeoSession = session
          tab.lastGeoSeq = seq === undefined ? 0 : Math.floor(seq)
        } else if (seq !== undefined) {
          const nextSeq = Math.floor(seq)
          if (nextSeq < tab.lastGeoSeq) { sendJson(res, 200, { ok: true, stale: true }); return }
          tab.lastGeoSeq = nextSeq
        }
        tab.geometry = {
          x: asNumber(body?.x) ?? 0,
          y: asNumber(body?.y) ?? 0,
          width: asNumber(body?.width) ?? 0,
          height: asNumber(body?.height) ?? 0,
          visible: body?.visible !== false,
        }
        applyBounds(tab)
        sendJson(res, 200, { ok: true })
        return
      }

      if (method === 'POST' && path === '/liuli-browser/tabs/viewport') {
        const body = await readBody(req)
        const tab = tabs.get(asString(body?.id) ?? '')
        if (tab === undefined) { sendJson(res, 404, { ok: false, error: 'unknown tab' }); return }
        const width = Math.round(asNumber(body?.width) ?? 0)
        const height = Math.round(asNumber(body?.height) ?? 0)
        const scale = Math.min(4, Math.max(0.25, asNumber(body?.scale) ?? 1))
        tab.viewport = width >= VIEWPORT_MIN && height >= VIEWPORT_MIN && width <= VIEWPORT_MAX_W && height <= VIEWPORT_MAX_H
          ? { width, height, scale }
          : null
        applyBounds(tab)
        sendJson(res, 200, { ok: true, viewport: tab.viewport })
        return
      }

      if (method === 'POST' && path === '/liuli-browser/tabs/action') {
        const body = await readBody(req)
        const tab = tabs.get(asString(body?.id) ?? '')
        const action = asString(body?.action) ?? ''
        if (tab === undefined) { sendJson(res, 404, { ok: false, error: 'unknown tab' }); return }
        const wc = tab.view.webContents
        switch (action) {
          case 'navigate': {
            const target = asString(body?.url) ?? ''
            if (target === '') { sendJson(res, 400, { ok: false, error: 'missing url' }); return }
            tab.lastRequestedUrl = target
            tab.state.error = null
            wc.loadURL(target).catch((cause: unknown) => {
              const message = cause instanceof Error ? cause.message : String(cause)
              if (message.includes('ERR_ABORTED')) return
              tab.state.loading = false
              tab.state.error = message
              pushState(tab)
            })
            sendJson(res, 200, { ok: true })
            return
          }
          case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); sendJson(res, 200, { ok: true }); return
          case 'forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); sendJson(res, 200, { ok: true }); return
          case 'reload': wc.reload(); sendJson(res, 200, { ok: true }); return
          case 'stop': wc.stop(); sendJson(res, 200, { ok: true }); return
          case 'devtools': wc.openDevTools({ mode: 'detach' }); sendJson(res, 200, { ok: true }); return
          case 'focus': wc.focus(); sendJson(res, 200, { ok: true }); return
          default: sendJson(res, 400, { ok: false, error: `unknown action ${action}` })
        }
        return
      }

      if (path === '/liuli-browser/tabs/state') {
        const tab = tabs.get(url.searchParams.get('id') ?? '')
        if (tab === undefined) { sendJson(res, 404, { ok: false, error: 'unknown tab' }); return }
        sendJson(res, 200, { ok: true, tabId: tab.id, state: tab.state, generation: tab.generation })
        return
      }

      if (path === '/liuli-browser/tabs/screenshot') {
        const tab = tabs.get(url.searchParams.get('id') ?? '')
        if (tab === undefined) { sendJson(res, 404, { ok: false, error: 'unknown tab' }); return }
        const png = await captureTabPng(tab)
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length), 'cache-control': 'no-store' })
        res.end(png)
        return
      }

      if (method === 'POST' && path === '/liuli-browser/ops') {
        const body = await readBody(req)
        const opSessionId = asString(body?.sessionId)
        const opTabId = asString(body?.tabId) ?? asString(body?.id) ?? ''
        const opMethod = asString(body?.method) ?? ''
        // list 不针对具体标签,提前处理(scope 过滤:有主标签只对所属会话可见)。
        if (opMethod === 'list') {
          sendJson(res, 200, {
            ok: true,
            value: [...tabs.entries()]
              .filter(([, t]) => t.ownerSessionId === null || t.ownerSessionId === opSessionId)
              .map(([tabId, t]) => ({ tabId, ...t.state })),
          })
          return
        }
        const target = resolveOpsTarget(opTabId, opSessionId)
        if (target === undefined) { sendJson(res, 404, { ok: false, error: { code: 'not_found', message: 'unknown tab' } }); return }
        const { wc: targetWc, engineTab: tab } = target
        if (tab !== undefined) tab.lastActivityAt = Date.now()
        const params = (body?.params !== null && body?.params !== undefined && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>
        let result: OpsResult
        switch (opMethod) {
          case 'getState':
            result = { ok: true, value: tab === undefined
              ? { url: targetWc.getURL(), title: targetWc.getTitle(), loading: targetWc.isLoading(), ready: true, error: null, favicon: null, canGoBack: false, canGoForward: false }
              : { ...tab.state, generation: tab.generation } }
            break
          case 'navigate': {
            const navTarget = asString(params.url) ?? ''
            if (navTarget === '') { result = { ok: false, error: { code: 'bad_params', message: 'navigate 需要 url' } }; break }
            if (tab !== undefined) {
              tab.lastRequestedUrl = navTarget
              tab.state.error = null
              persistTabs()
            }
            try {
              await Promise.race([
                targetWc.loadURL(navTarget).catch((cause: unknown) => {
                  const message = cause instanceof Error ? cause.message : String(cause)
                  if (!message.includes('ERR_ABORTED')) throw cause
                }),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('navigation timed out (30s)')), 30000)),
              ])
              result = { ok: true, value: tab === undefined ? { url: targetWc.getURL() } : { ...tab.state } }
            } catch (cause) {
              result = { ok: false, error: { code: 'navigation_error', message: cause instanceof Error ? cause.message : String(cause) } }
            }
            break
          }
          case 'back': case 'forward': case 'reload': case 'stop': {
            if (opMethod === 'back') { if (targetWc.navigationHistory.canGoBack()) targetWc.navigationHistory.goBack() }
            else if (opMethod === 'forward') { if (targetWc.navigationHistory.canGoForward()) targetWc.navigationHistory.goForward() }
            else if (opMethod === 'reload') targetWc.reload()
            else targetWc.stop()
            result = { ok: true, value: tab === undefined ? { url: targetWc.getURL() } : { ...tab.state } }
            break
          }
          case 'newTab': {
            const target = asString(params.url) ?? 'about:blank'
            const newId = 'agent:' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
            const created = createTab(newId, target, opSessionId ?? null)
            result = { ok: true, value: { tabId: created.id, state: created.state } }
            break
          }
          case 'closeTab':
            result = tab === undefined
              ? { ok: false, error: { code: 'bad_params', message: 'closeTab 只支持引擎标签(webview 标签请在侧边栏关闭)' } }
              : { ok: true, value: { closed: destroyTab(tab.id) } }
            break
          case 'screenshot': {
            try {
              const png = tab === undefined ? (await targetWc.capturePage()).toPNG() : await captureTabPng(tab)
              result = { ok: true, value: { base64: png.toString('base64'), bytes: png.length } }
            } catch (cause) {
              result = { ok: false, error: { code: 'capture_failed', message: cause instanceof Error ? cause.message : String(cause) } }
            }
            break
          }
          case 'browserViewportSet': {
            if (tab === undefined) { result = { ok: false, error: { code: 'bad_params', message: '视口控制只支持引擎标签' } }; break }
            const width = Math.round(Number(params.width) || 0)
            const height = Math.round(Number(params.height) || 0)
            const scale = Math.min(4, Math.max(0.25, Number(params.scale) || 1))
            tab.viewport = width >= VIEWPORT_MIN && height >= VIEWPORT_MIN && width <= VIEWPORT_MAX_W && height <= VIEWPORT_MAX_H
              ? { width, height, scale }
              : null
            applyBounds(tab)
            result = { ok: true, value: { viewport: tab.viewport } }
            break
          }
          case 'browserViewportReset':
            if (tab === undefined) { result = { ok: false, error: { code: 'bad_params', message: '视口控制只支持引擎标签' } }; break }
            tab.viewport = null
            applyBounds(tab)
            result = { ok: true, value: { viewport: null } }
            break
          default:
            result = await ops.handle(targetWc, opTabId, opMethod, params)
        }
        sendJson(res, 200, result)
        return
      }

      if (method === 'POST' && path === '/liuli-browser/tabs/execute') {
        const body = await readBody(req)
        const tab = tabs.get(asString(body?.id) ?? '')
        const codeText = asString(body?.code) ?? ''
        if (tab === undefined) { sendJson(res, 404, { ok: false, error: 'unknown tab' }); return }
        if (codeText === '') { sendJson(res, 400, { ok: false, error: 'missing code' }); return }
        try {
          // 超时保护：未提交文档（如 about:blank）上 executeJavaScript 可能永不 resolve。
          const timeout = new Promise<never>((_, reject) => {
            setTimeout(() => { reject(new Error('execute timeout (25s)')) }, 25000)
          })
          const value = await Promise.race([tab.view.webContents.executeJavaScript(codeText, true), timeout])
          sendJson(res, 200, { ok: true, value: value === undefined ? null : value })
        } catch (cause) {
          sendJson(res, 200, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
        }
        return
      }

      if (method === 'POST' && path === '/liuli-browser/open-external') {
        const body = await readBody(req)
        const target = asString(body?.url) ?? ''
        let parsed: URL | undefined
        try { parsed = new URL(target) } catch { parsed = undefined }
        if (parsed === undefined) {
          sendJson(res, 400, { ok: false, error: 'invalid url' })
          return
        }
        // file:// 本地文件：解码回本机路径交给系统默认程序（.html 即默认浏览器）。
        // 用 openPath 而非 openExternal：对中文/空格路径更可靠（无编码往返）。
        if (parsed.protocol === 'file:') {
          try {
            const localPath = fileURLToPath(parsed.href)
            const openError = await shell.openPath(localPath)
            if (openError !== '') { sendJson(res, 400, { ok: false, error: openError }); return }
          } catch (cause) {
            sendJson(res, 400, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
            return
          }
          sendJson(res, 200, { ok: true })
          return
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          sendJson(res, 400, { ok: false, error: 'invalid url' })
          return
        }
        await shell.openExternal(parsed.href)
        sendJson(res, 200, { ok: true })
        return
      }

      sendJson(res, 404, { ok: false, error: 'not found' })
    } catch (cause) {
      sendJson(res, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  return {
    route: {
      kind: 'prefix',
      path: '/liuli-browser',
      handler: (req, res) => { void handle(req, res) },
    },
    dispose: () => {
      disposed = true
      for (const id of [...tabs.keys()]) destroyTab(id)
      for (const res of sseClients) { try { res.end() } catch { /* 忽略 */ } }
      sseClients.clear()
      ops.dispose()
    },
  }
}
