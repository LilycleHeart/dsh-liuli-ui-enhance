/**
 * 琉璃主题 · 宿主窗口控制面（Host 半）。
 *
 * DSH Desktop advanced（无边框）模式下系统标题栏连同最小化/最大化/关闭按钮
 * 一起消失；页面内按钮（WindowControls.tsx）经本路由调用 Electron 主进程窗口
 * API 补回这三个动作：
 *
 * - GET  /liuli-window              → { available, maximized, fullScreen }
 * - POST /liuli-window { action }   → action: minimize | toggleMaximize | close
 *                                      | toggleDevTools | openDevTools | closeDevTools
 *                                      | inspectElement {x, y}
 *
 * close 走 BrowserWindow.close()，与原生关闭按钮同语义（desktop-shell 的
 * close 处理器会把窗口收进托盘而不是退出）。纯 Web 部署没有 Electron，
 * GET 返回 available:false，前端隐藏按钮。
 *
 * Electron API 用本地结构化声明（monorepo 不安装 electron 包，无法取官方
 * 类型；与 browser-engine.ts 同款做法）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/* ── 本路由用到的 Electron 主进程 API 最小面 ─────────────────────────── */

interface HostBrowserWindow {
  isDestroyed(): boolean
  isMaximized(): boolean
  isFullScreen(): boolean
  minimize(): void
  maximize(): void
  unmaximize(): void
  close(): void
  webContents: {
    isDevToolsOpened(): boolean
    openDevTools(options?: { mode: 'right' | 'bottom' | 'detach' | 'undocked' }): void
    closeDevTools(): void
    /** 在 DevTools Elements 面板定位到指定页面坐标的元素（DIP 坐标）。 */
    inspectElement(x: number, y: number): void
  }
}

interface HostElectronMain {
  BrowserWindow: {
    getAllWindows(): HostBrowserWindow[]
    getFocusedWindow(): HostBrowserWindow | null
  }
}

let electronPromise: Promise<HostElectronMain | undefined> | undefined

/** 尝试加载 Electron 主进程 API；非 Electron 环境返回 undefined。 */
async function loadElectron(): Promise<HostElectronMain | undefined> {
  if (typeof process === 'undefined' || process.versions?.electron === undefined) return undefined
  electronPromise ??= (async () => {
    // 变量 specifier：monorepo 无 electron 类型包，避开 TS 静态模块解析。
    const electronSpecifier = 'electron'
    try {
      return await import(electronSpecifier) as unknown as HostElectronMain
    } catch {
      try {
        const { createRequire } = await import('node:module')
        const esmRequire = createRequire(import.meta.url)
        return esmRequire('electron') as HostElectronMain
      } catch {
        return undefined
      }
    }
  })()
  return electronPromise
}

/** 选取受控窗口：优先焦点窗口，回落第一个未销毁窗口。 */
function pickWindow(electron: HostElectronMain): HostBrowserWindow | undefined {
  try {
    const focused = electron.BrowserWindow.getFocusedWindow()
    if (focused !== null && !focused.isDestroyed()) return focused
    return electron.BrowserWindow.getAllWindows().find(win => !win.isDestroyed())
  } catch {
    return undefined
  }
}

/** 只接受同源页面调用（与 /liuli-quota、/liuli-titlebar 同款 fence）。 */
function allowedCaller(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      const originHost = new URL(origin).host
      const host = req.headers.host ?? ''
      if (originHost !== host) return false
    } catch {
      return false
    }
  }
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

/** 读取小型 JSON 请求体（限 4KB）。 */
async function readJsonBody(req: IncomingMessage, limit = 4096): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > limit) throw new Error('body too large')
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** Build the /liuli-window exact route.
 *
 * 请求逻辑以 IIFE 内联在 handler 里（不拆成独立 async 函数）——rolldown 的
 * tree-shake 曾把"仅被 handler 调用一次"的独立 `async function serveWindowControls`
 * 连同其专用 helper 一并误删，只留悬空调用，请求时抛 ReferenceError、
 * webserver catch 兜底返回裸 400。内联后逻辑即 handler 本体，无独立函数可被删。 */
export function windowControlRoute(): WebRoute {
  return {
    kind: 'prefix',
    path: '/liuli-window',
    handler: (req, res) => {
      void (async () => {
        if (!allowedCaller(req)) {
          sendJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        const electron = await loadElectron()
        const win = electron === undefined ? undefined : pickWindow(electron)
        if (win === undefined) {
          // 纯 Web 部署或窗口不可得：前端据此隐藏页面内窗口按钮。
          sendJson(res, 200, { available: false })
          return
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          sendJson(res, 200, {
            available: true,
            maximized: win.isMaximized(),
            fullScreen: win.isFullScreen(),
          })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid JSON body' })
          return
        }
        const action = (body as { action?: unknown } | null)?.action
        switch (action) {
          case 'minimize':
            win.minimize()
            break
          case 'toggleMaximize':
            if (win.isMaximized()) win.unmaximize()
            else win.maximize()
            break
          case 'close':
            win.close()
            break
          case 'toggleDevTools':
            // Chrome F12 语义：已打开则关闭；否则以侧边停靠（right）打开当前渲染进程 DevTools。
            if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools()
            else win.webContents.openDevTools({ mode: 'right' })
            break
          case 'openDevTools':
            if (!win.webContents.isDevToolsOpened()) win.webContents.openDevTools({ mode: 'right' })
            break
          case 'closeDevTools':
            if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools()
            break
          case 'inspectElement': {
            // 相当于浏览器右键菜单「检查」：打开 DevTools 并在 Elements 面板
            // 定位到指定坐标的元素。坐标来自渲染进程 getBoundingClientRect
            // 中心点（CSS 像素 ≈ DIP，页面未缩放时一致）。
            const bodyObj = body as { x?: unknown; y?: unknown } | null
            const x = bodyObj?.x
            const y = bodyObj?.y
            if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
              sendJson(res, 400, { ok: false, error: 'inspectElement requires numeric x,y in body' })
              return
            }
            if (!win.webContents.isDevToolsOpened()) win.webContents.openDevTools({ mode: 'right' })
            win.webContents.inspectElement(Math.round(x), Math.round(y))
            break
          }
          default:
            sendJson(res, 400, { ok: false, error: 'action must be minimize | toggleMaximize | close | toggleDevTools | openDevTools | closeDevTools | inspectElement' })
            return
        }
        sendJson(res, 200, { ok: true, available: true, maximized: win.isMaximized() })
      })().catch(() => {
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' })
      })
    },
  }
}
