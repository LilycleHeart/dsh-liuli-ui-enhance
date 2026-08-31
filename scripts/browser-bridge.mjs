/**
 * 主进程 inspector 桥(零依赖,Node >= 22 内置 WebSocket/fetch)。
 *
 * DSH 服务端 fence 对外部直连一律 403,CLI / verify 脚本经本模块把请求
 * 中转到运行中的 DSH Desktop:连 --inspect(默认 9229)的主进程 inspector,
 * 在主进程里找到主窗口 webContents,再 executeJavaScript 在页面内执行
 * 同源 fetch(过 fence)。调试模式启动
 * (端口被占时自动顺延,可用 LIULI_INSPECT_PORT 指定实际端口)。
 */

const INSPECT_PORT_DEFAULT = 9229

function inspectPort() {
  return Number(process.env.LIULI_INSPECT_PORT ?? '') || INSPECT_PORT_DEFAULT
}

/**
 * 在 DSH 主进程作用域执行表达式(awaitPromise + returnByValue)。
 * 主进程 inspector 作用域没有 require,取 Electron API 用
 * process.mainModule.require('electron')。
 */
export async function cdpEvalMain(expression, { timeoutMs = 90000 } = {}) {
  const port = inspectPort()
  const deadline = Date.now() + timeoutMs
  // inspector 目标列表(GET /json/list),取第一个 node target。
  let wsUrl
  try {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(4000) }).then(r => r.json())
    const target = Array.isArray(list) ? list.find(t => t.type === 'node') ?? list[0] : undefined
    if (target?.webSocketDebuggerUrl === undefined) throw new Error('no inspector target')
    wsUrl = target.webSocketDebuggerUrl
  } catch {
    throw new Error(`连不上主进程 inspector(127.0.0.1:${port})——请用调试模式启动 DSH Desktop,或设 LIULI_INSPECT_PORT 为实际端口`)
  }
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('inspector WebSocket 连接失败')), { once: true })
  })
  try {
    const response = await Promise.race([
      new Promise((resolve, reject) => {
        ws.addEventListener('message', e => {
          let msg
          try { msg = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data)) } catch { return }
          if (msg.id !== 1) return
          if (msg.error !== undefined) reject(new Error(`${msg.error.code}: ${msg.error.message}`))
          else resolve(msg.result)
        })
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      }),
      new Promise((_, reject) => {
        const remain = deadline - Date.now()
        setTimeout(() => reject(new Error(`inspector evaluate 超时(${timeoutMs}ms)`)), Math.max(1000, remain))
      }),
    ])
    if (response.exceptionDetails !== undefined) {
      const detail = response.exceptionDetails
      throw new Error(detail.exception?.description ?? detail.text ?? 'main evaluate failed')
    }
    return response.result?.value
  } finally {
    try { ws.close() } catch { /* 已关闭 */ }
  }
}

/** HTTP fetch 中转:主窗口页面内同源 fetch,返回 { status, body }。 */
export async function cdpFetch(path, { method = 'GET', body, headers, timeoutMs = 90000 } = {}) {
  const pageFetch = `(async () => {
    const resp = await fetch(${JSON.stringify(path)}, {
      method: ${JSON.stringify(method)},
      headers: ${JSON.stringify(headers ?? { 'content-type': 'application/json', accept: 'application/json' })},
      ${body === undefined ? '' : `body: ${JSON.stringify(typeof body === 'string' ? body : JSON.stringify(body))},`}
    })
    const text = await resp.text()
    return JSON.stringify({ status: resp.status, body: text })
  })()`
  const mainExpression = `(async () => {
    const electron = process.mainModule.require('electron')
    const wins = electron.BrowserWindow.getAllWindows().filter(w => !w.isDestroyed()
      && w.webContents.isDevTools?.() !== true
      && !String(w.webContents.getURL?.() ?? '').startsWith('devtools://'))
    if (wins.length === 0) throw new Error('no dsh window found')
    return await wins[0].webContents.executeJavaScript(${JSON.stringify(pageFetch)}, true)
  })()`
  const raw = await cdpEvalMain(mainExpression, { timeoutMs })
  let parsed
  try { parsed = JSON.parse(String(raw)) } catch { throw new Error('bridge response not JSON: ' + String(raw).slice(0, 200)) }
  return { status: Number(parsed.status), body: String(parsed.body) }
}

/** cdpFetch + JSON 解析(非 JSON/非 2xx 抛错,信息含 status)。 */
export async function cdpFetchJson(path, options = {}) {
  const { status, body } = await cdpFetch(path, options)
  let parsed
  try { parsed = JSON.parse(body) } catch {
    throw new Error(`route ${path} 返回非 JSON(HTTP ${status})——宿主未启用嵌入式浏览器引擎?`)
  }
  if (status >= 400 && parsed?.ok !== false) throw new Error(`route ${path} HTTP ${status}`)
  return parsed
}
