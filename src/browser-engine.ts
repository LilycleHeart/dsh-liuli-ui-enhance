/**
 * liuli-theme 嵌入式浏览器引擎（Host 半，复刻 ZCode Desktop IAB）。
 *
 * ZCode 桌面端用 Electron <webview>（09-renderer-renamed styles-OqUHW1P0
 * _Component491：partition persist:zcode-embedded-browser、allowpopups、
 * did-start-loading/did-stop-loading/did-navigate/did-navigate-in-page/
 * page-title-updated/did-fail-load/render-process-gone 全套事件同步；
 * 新窗口请求转右侧浏览器标签）。DSH 宿主窗口未开 webviewTag，插件不能
 * 改宿主窗口构造参数，因此本引擎在 Electron 主进程内直接用 WebContentsView
 * 承载页面：独立会话分区、任意站点（无 X-Frame-Options 限制）、弹窗转标签、
 * 崩溃原位重建，语义与 ZCode webview 一致；渲染端把面板几何上报过来，
 * 视图精确贴合侧边栏浏览器面板区域（data-testid browser-webview 的承载位）。
 *
 * 纯 Web 部署（无 Electron）时 createBrowserEngine 返回 undefined，
 * 渲染端自动回退 iframe + /liuli-proxy 路径。
 *
 * Electron API 用本地结构化声明（monorepo 不安装 electron 包，无法取官方
 * 类型；结构化声明同时兼容主进程 import/require 两种取法）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/* ── 本引擎用到的 Electron 主进程 API 最小面 ─────────────────────────── */

interface ElectronWebContents {
  on(event: string, listener: (...args: never[]) => void): void
  loadURL(url: string): Promise<void>
  getURL(): string
  reload(): void
  stop(): void
  focus(): void
  close(): void
  openDevTools(options?: { mode?: string }): void
  setZoomFactor(factor: number): void
  getZoomFactor(): number
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  capturePage(): Promise<{ toPNG(): Buffer }>
  setWindowOpenHandler(handler: (details: { url: string; disposition: string }) => { action: 'deny' | 'allow' }): void
  navigationHistory: { canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void }
}

interface ElectronWebContentsView {
  webContents: ElectronWebContents
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void
  setVisible(visible: boolean): void
  setBackgroundColor(color: string): void
}

interface ElectronBrowserWindow {
  isDestroyed(): boolean
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
  session: { fromPartition(partition: string): { on(event: 'will-download', listener: (e: unknown, item: ElectronDownloadItem) => void): void } }
  shell: { openExternal(url: string): Promise<void> }
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

/** ZCode webview 的会话分区对应物（persist: 前缀保留 cookie/storage 跨重启）。 */
const PARTITION = 'persist:liuli-embedded-browser'
/** 视口硬限制（ZCode BROWSER_VIEWPORT_LIMITS：320..3840 / 320..2160）。 */
const VIEWPORT_MIN = 320
const VIEWPORT_MAX_W = 3840
const VIEWPORT_MAX_H = 2160

/**
 * 客户页 JS 对话框垫片（ZCode embeddedBrowserJavaScriptDialog 预加载的轻量对应物）。
 * 真实 webview 里 alert/confirm/prompt 默认弹原生模态框并阻塞自动化；垫片改为
 * 自动应答（confirm 接受、prompt 返回默认值）并经 console.info 上报，Host 侧
 * 用 console-message 事件转发为 SSE dialog 事件供渲染端提示。
 */
const DIALOG_SHIM_SCRIPT = `(() => {
  if (window.__liuliDialogShim) return
  window.__liuliDialogShim = true
  const send = (kind, message) => {
    try { console.info('[liuli-dialog] ' + kind + ': ' + String(message).slice(0, 300)) } catch { /* 忽略 */ }
  }
  window.alert = (message) => { send('alert', message) }
  window.confirm = (message) => { send('confirm', message); return true }
  window.prompt = (message, fallback) => { send('prompt', message); return fallback === undefined ? null : fallback }
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
  /** 崩溃重建计数（ZCode webviewGeneration 对应）。 */
  generation: number
  /** 恢复用最近 URL（ZCode render-process-gone 原位重建语义）。 */
  lastRequestedUrl: string
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
      // （等效 ZCode CSS transform scale 的 webview 呈现）。
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

  /** webContents 事件 → 状态镜像 + SSE（ZCode did-* 监听一一对应）。 */
  const wireEvents = (tab: EngineTab): void => {
    const wc = tab.view.webContents
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
      // ZCode page-favicon-updated → faviconUrl（标签条图标）。
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
      if (errorCode === -3) return // ERR_ABORTED：被新导航打断，非错误（ZCode 同语义）
      tab.state.loading = false
      tab.state.error = `${errorDescription} (${String(errorCode)})`
      if (typeof validatedURL === 'string' && validatedURL !== '') tab.state.url = validatedURL
      pushState(tab)
    })
    wc.on('render-process-gone', () => {
      // ZCode：guest renderer 异常退出 → 原位重建并恢复最近 URL。
      if (disposed || !tabs.has(tab.id)) return
      const restoreUrl = tab.lastRequestedUrl !== '' ? tab.lastRequestedUrl : tab.state.url
      rebuildTab(tab, restoreUrl)
    })
    wc.setWindowOpenHandler((details) => {
      // ZCode：[App] webview 请求打开右侧浏览器 tab（一律转侧边栏新标签）。
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

  const createTab = (id: string, url: string): EngineTab => {
    const existing = tabs.get(id)
    if (existing !== undefined) return existing
    const win = findWindow()
    if (win === undefined) throw new Error('no host window')
    const view = makeView()
    const tab: EngineTab = {
      id,
      view,
      state: { url: url !== '' ? url : 'about:blank', title: '', favicon: null, canGoBack: false, canGoForward: false, loading: url !== '' && url !== 'about:blank', ready: false, error: null },
      viewport: null,
      geometry: { x: 0, y: 0, width: 0, height: 0, visible: false },
      generation: 0,
      lastRequestedUrl: url !== '' && url !== 'about:blank' ? url : '',
    }
    wireEvents(tab)
    tabs.set(id, tab)
    win.contentView.addChildView(view)
    view.setBounds({ x: -20000, y: -20000, width: 1, height: 1 })
    if (url !== '' && url !== 'about:blank') {
      view.webContents.loadURL(url).catch(() => { /* did-fail-load 上报 */ })
    }
    return tab
  }

  const destroyTab = (id: string): boolean => {
    const tab = tabs.get(id)
    if (tab === undefined) return false
    tabs.delete(id)
    const win = findWindow()
    try { if (win !== undefined) win.contentView.removeChildView(tab.view) } catch { /* 窗口已销毁 */ }
    try { tab.view.webContents.close() } catch { /* 已销毁 */ }
    broadcast({ type: 'closed', tabId: id })
    return true
  }

  /** 下载走分区会话默认保存对话框。 */
  guestSession.on('will-download', (_e: unknown, item: ElectronDownloadItem) => {
    item.setSaveDialogOptions({ title: '保存文件' })
  })

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!isLoopbackCaller(req)) { sendJson(res, 403, { ok: false, error: 'forbidden' }); return }
    const url = new URL(req.url ?? '/', 'http://x')
    const path = url.pathname
    const method = req.method ?? 'GET'

    try {
      if (path === '/liuli-browser/capabilities') {
        sendJson(res, 200, { ok: true, engine: 'webview', partition: PARTITION, viewport: { min: VIEWPORT_MIN, maxW: VIEWPORT_MAX_W, maxH: VIEWPORT_MAX_H }, tabs: [...tabs.keys()] })
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
        const tab = createTab(id, target)
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
        // 隐藏/屏外视图不参与合成（capturePage 会返回空图）：临时移进窗口取帧。
        // 优先垫到 GUI 之下（index 0）避免闪烁；若仍为空再抬到顶层重试一次。
        const geo = tab.geometry
        const hidden = !geo.visible || geo.width < 4 || geo.height < 4
        const captureOnce = async (): Promise<Buffer> => {
          const image = await tab.view.webContents.capturePage()
          return image.toPNG()
        }
        let png: Buffer
        if (!hidden) {
          png = await captureOnce()
        } else {
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
          png = await captureOnce()
          if (png.length === 0) {
            prepare() // 顶层重试（短暂可见）
            await new Promise(r => setTimeout(r, 280))
            png = await captureOnce()
          }
          raiseView(tab)
          applyBounds(tab)
        }
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(png.length), 'cache-control': 'no-store' })
        res.end(png)
        return
      }

      if (method === 'POST' && path === '/liuli-browser/tabs/execute') {
        const body = await readBody(req)
        const tab = tabs.get(asString(body?.id) ?? '')
        const codeText = asString(body?.code) ?? ''
        if (tab === undefined) { sendJson(res, 404, { ok: false, error: 'unknown tab' }); return }
        if (codeText === '') { sendJson(res, 400, { ok: false, error: 'missing code' }); return }
        try {
          const value = await tab.view.webContents.executeJavaScript(codeText, true)
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
        if (parsed === undefined || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
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
    },
  }
}
