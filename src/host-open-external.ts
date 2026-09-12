/**
 * 琉璃主题 · 「用系统默认程序打开」Host 路由（utility process 兼容实现）。
 *
 * 2.0.9+ 宿主插件运行在 Electron utility process，主进程专属的 `shell` 模块
 * 缺席（browser-engine 内建的同名 /liuli-browser/open-external 随之不可用），
 * 但 `child_process` 仍然可用。本路由用平台原生命令承接 客户端 <webview>
 * 面板的「在外部打开」需求，file: / http: / https: / mailto: 通吃。
 *
 * 与 /liuli-reveal 同款 Host fence：只接受回环 + 同源调用方。
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** 只放行系统默认程序能安全承接的协议。 */
const ALLOWED_PROTOCOLS = new Set(['file:', 'http:', 'https:', 'mailto:'])

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** 只接受回环 + 同源调用方（与 /liuli-reveal-workspace 同款 fence）。 */
function allowedCaller(req: IncomingMessage): boolean {
  const host = req.headers.host
  if (host === undefined) return false
  try {
    const hostname = new URL(`http://${host}`).hostname
    const loopback = hostname === 'localhost' || hostname === '[::1]'
      || ((): boolean => {
        const parts = hostname.split('.')
        return parts.length === 4 && parts[0] === '127' && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)
      })()
    if (!loopback) return false
  } catch {
    return false
  }
  // 带 Origin 的跨站请求拒绝：内嵌浏览器里的远程页面 no-cors POST 不允许触发
  // 本机程序打开。
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  return true
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

/**
 * 交给系统默认程序打开。win32 用 `rundll32 url.dll,FileProtocolHandler`：它按
 * URL/路径的扩展名分派（.html → 默认浏览器、目录 → 资源管理器），是无需
 * shell 模块时打开 http(s)/mailto/文件的通用入口。返回的 Promise 只在进程
 * 真正 spawn 成功时 resolve（命令不存在等 'error' 事件 reject），因此调用方
 * 能区分「已交给系统」与「启动失败」，且不会有未处理的 'error' 事件。
 */
function openWithSystem(target: string): Promise<void> {
  const command = process.platform === 'win32' ? 'rundll32'
    : process.platform === 'darwin' ? 'open'
    : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', target] : [target]
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.once('error', (error) => {
      if (!settled) { settled = true; reject(error) }
    })
    child.once('spawn', () => {
      if (!settled) { settled = true; resolve() }
    })
    child.unref()
  })
}

/** Build the /liuli-browser/open-external prefix route. */
export function openExternalRoute(): WebRoute {
  return {
    kind: 'prefix',
    path: '/liuli-browser/open-external',
    handler: (req, res) => {
      void (async () => {
        if (!allowedCaller(req)) {
          sendJson(res, 403, { ok: false, error: 'forbidden' })
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
        const raw = (body as { url?: unknown } | null)?.url
        const target = typeof raw === 'string' ? raw.trim() : ''
        let parsed: URL | undefined
        try { parsed = new URL(target) } catch { parsed = undefined }
        if (parsed === undefined || !ALLOWED_PROTOCOLS.has(parsed.protocol)) {
          sendJson(res, 400, { ok: false, error: 'invalid url' })
          return
        }
        // file: 先解码回本机路径，避免编码往返在中文/空格路径上出错。
        let resolved: string
        try {
          resolved = parsed.protocol === 'file:' ? fileURLToPath(parsed.href) : parsed.href
        } catch (cause) {
          sendJson(res, 400, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
          return
        }
        try {
          await openWithSystem(resolved)
          sendJson(res, 200, { ok: true })
        } catch (cause) {
          sendJson(res, 500, { ok: false, error: cause instanceof Error ? cause.message : String(cause) })
        }
      })().catch(() => {
        if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal error' })
      })
    },
  }
}
