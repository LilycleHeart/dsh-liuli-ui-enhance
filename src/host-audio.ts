/**
 * 琉璃主题 · 宿主系统音频监听（Host 半）。
 *
 * DSH Desktop（Electron）里 `navigator.mediaDevices.getDisplayMedia` 的默认行为
 * 与浏览器不同：主进程没有安装 `setDisplayMediaRequestHandler` 时请求直接以
 * NotAllowedError 拒绝，也没有 Web 端「共享屏幕并勾选分享系统音频」的选择器，
 * 因此会话 header 的「监听系统音量」按钮在 Desktop 上不可用。
 *
 * 本模块在 Electron 主进程给 defaultSession 安装 `setDisplayMediaRequestHandler`：
 * 请求含音频时直接授予系统回环音频（`audio: 'loopback'` —— Chromium 系统音频
 * 捕获，官方文档标注目前仅 Windows 支持）；刻意不用 `loopbackWithMute`，避免把
 * 系统输出静音（与 Web 端不设 suppressLocalAudioPlayback 的取舍一致）。请求含
 * 视频时授予主屏画面（与常规屏幕共享语义一致）。
 *
 * 另提供 `GET /liuli-audio` 能力探测路由：纯 Web / 非 Windows 返回
 * available:false，渲染端据此显示精确的不可用诊断。
 *
 * Electron API 用本地结构化声明（monorepo 不安装 electron 包，无法取官方
 * 类型；与 host-window.ts / browser-engine.ts 同款做法）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/* ── 本路由用到的 Electron 主进程 API 最小面 ─────────────────────────── */

/** desktopCapturer.getSources 返回的屏幕/窗口源。 */
interface HostDesktopCapturerSource {
  id: string
  name: string
  display_id: string
}

interface HostDesktopCapturer {
  getSources(options: { types: Array<'screen' | 'window'> }): Promise<HostDesktopCapturerSource[]>
}

/** setDisplayMediaRequestHandler 的请求与回调解构。 */
interface HostDisplayMediaRequest {
  videoRequested: boolean
  audioRequested: boolean
  userGesture: boolean
  securityOrigin: string
}

interface HostDisplayMediaStreams {
  video?: HostDesktopCapturerSource
  audio?: 'loopback' | 'loopbackWithMute'
}

interface HostSession {
  setDisplayMediaRequestHandler(
    handler: ((request: HostDisplayMediaRequest, callback: (streams: HostDisplayMediaStreams) => void) => void) | null,
  ): void
}

/** Electron 的 session 模块（defaultSession + fromPartition）。 */
interface HostSessionModule {
  defaultSession: HostSession
  fromPartition(partition: string): HostSession
}

/** webContents 最小面：取所属 session（用于对现存/新建渲染器补装 handler）。 */
interface HostWebContents {
  session: HostSession
}

interface HostElectronMain {
  desktopCapturer: HostDesktopCapturer
  session: HostSessionModule
  webContents?: { getAllWebContents(): HostWebContents[] }
  app?: {
    on(event: string, listener: (event: unknown, contents: HostWebContents) => void): unknown
    off?(event: string, listener: (event: unknown, contents: HostWebContents) => void): unknown
  }
}

/**
 * DSH Desktop 主窗口渲染器所在 session partition（2.0.3 起）。
 * 见 anywhere-labs/dsh-desktop `dsh-plugin-desktop/src/window-options.ts`：
 * `DESKTOP_RENDERER_SESSION_PARTITION = 'persist:dsh-desktop-renderer'`，主窗口
 * webPreferences.partition 固定用它。仅给 defaultSession 装 handler 收不到
 * 主窗口的 getDisplayMedia 请求（Electron 无 handler 时纯音频/无授权直接抛
 * NotSupportedError）。这里不写死依赖，安装时同时覆盖 defaultSession、
 * 该 partition 与现存/新建 webContents 的 session（幂等）。
 */
const DESKTOP_RENDERER_SESSION_PARTITION = 'persist:dsh-desktop-renderer'

/** 已装 handler 的 session（幂等集合，卸载时逐一复位）。 */
const installedSessions = new Set<HostSession>()

let electronPromise: Promise<HostElectronMain | undefined> | undefined

/**
 * 系统回环音频 handler 是否已实际装到目标 session。
 * 探针路由据此如实上报（index.ts 注释契约：未装 handler 时 available:false），
 * 避免「Electron + win32 就报可用、实际未授权」的误导诊断。
 */
let loopbackInstalled = false

/** 当前是否已安装系统回环音频 handler（供 /liuli-audio 探针判断）。 */
export function isLoopbackInstalled(): boolean {
  return loopbackInstalled
}

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

/** 只接受同源/回环调用方（与 /liuli-window 同一道 fence）。 */
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

/** 当前进程平台（Electron 主进程内 process.platform 有效）。 */
function currentPlatform(): string {
  return (globalThis as { process?: { platform?: string } }).process?.platform ?? ''
}

/**
 * 给单个 session 安装回环音频 handler（幂等：同一 session 只装一次）。
 */
function installHandlerOn(session: HostSession, desktopCapturer: HostDesktopCapturer): void {
  if (installedSessions.has(session)) return
  installedSessions.add(session)
  session.setDisplayMediaRequestHandler((request, callback) => {
    const streams: HostDisplayMediaStreams = {}
    if (request.audioRequested) streams.audio = 'loopback'
    if (!request.videoRequested) {
      callback(streams)
      return
    }
    void desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => {
        const first = sources[0]
        if (first !== undefined) streams.video = first as NonNullable<typeof streams.video>
        callback(streams)
      })
      .catch(() => { callback(streams) })
  })
}

/** 收集当前所有应覆盖的 session（defaultSession + 桌面渲染器 partition + 现存 webContents）。 */
function collectTargetSessions(electron: HostElectronMain): HostSession[] {
  const sessions = new Set<HostSession>()
  sessions.add(electron.session.defaultSession)
  try {
    sessions.add(electron.session.fromPartition(DESKTOP_RENDERER_SESSION_PARTITION))
  } catch { /* 旧版无 fromPartition 则跳过 */ }
  try {
    for (const wc of electron.webContents?.getAllWebContents() ?? []) {
      sessions.add(wc.session)
    }
  } catch { /* 忽略 */ }
  return [...sessions]
}

/**
 * 安装系统音频监听处理器（仅 Electron + Windows）。
 * 覆盖 defaultSession、桌面渲染器 partition（persist:dsh-desktop-renderer）与
 * 现存/新建 webContents 的 session：DSH Desktop 2.0.3 起主窗口渲染器使用
 * persist:dsh-desktop-renderer partition，只装 defaultSession 收不到请求。
 * @returns 卸载函数：把 handler 复位为默认（null），插件卸载时调用。
 */
export async function installSystemAudioCapture(): Promise<() => void> {
  const electron = await loadElectron()
  if (electron === undefined) return () => {}
  // `audio: 'loopback'` 仅 Windows 受支持；其余平台不装 handler，
  // 让 getDisplayMedia 保持 Electron 默认行为（macOS 走系统选择器）。
  if (currentPlatform() !== 'win32') return () => {}
  const { desktopCapturer } = electron
  for (const session of collectTargetSessions(electron)) {
    installHandlerOn(session, desktopCapturer)
  }
  // 新窗口/新 webContents 出现时补装 handler（幂等，重复 session 不会二次安装）。
  const onWebContentsCreated = (_event: unknown, contents: HostWebContents): void => {
    installHandlerOn(contents.session, desktopCapturer)
  }
  try { electron.app?.on('web-contents-created', onWebContentsCreated) } catch { /* 忽略 */ }
  loopbackInstalled = true
  return () => {
    loopbackInstalled = false
    try { electron.app?.off?.('web-contents-created', onWebContentsCreated) } catch { /* 忽略 */ }
    for (const session of installedSessions) {
      try { session.setDisplayMediaRequestHandler(null) } catch { /* 会话已销毁则忽略 */ }
    }
    installedSessions.clear()
  }
}

/** Build the /liuli-audio exact route（能力探测）。 */
export function audioCaptureRoute(): WebRoute {
  return {
    kind: 'prefix',
    path: '/liuli-audio',
    handler: (req, res) => {
      void (async () => {
        if (!allowedCaller(req)) {
          sendJson(res, 403, { ok: false, error: 'forbidden' })
          return
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const electron = await loadElectron()
        if (electron === undefined) {
          // 纯 Web 部署：渲染端走浏览器 getDisplayMedia（屏幕共享 + 勾选系统音频）。
          sendJson(res, 200, { available: false, capture: 'getDisplayMedia' })
          return
        }
        if (currentPlatform() !== 'win32') {
          sendJson(res, 200, { available: false, capture: 'getDisplayMedia', reason: 'loopback 仅 Windows 支持' })
          return
        }
        if (!loopbackInstalled) {
          // index.ts 契约：Electron+win32 但 handler 未装（unofficial.desktop 关闭等），
          // 不如实上报会让前端误走「已授权回环」路径，报错文案不准确。
          sendJson(res, 200, { available: false, capture: 'getDisplayMedia', reason: 'loopback handler 未安装' })
          return
        }
        sendJson(res, 200, { available: true, capture: 'loopback' })
      })().catch(() => {
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' })
      })
    },
  }
}