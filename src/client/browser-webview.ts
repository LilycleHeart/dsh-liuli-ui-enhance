/**
 * 嵌入式浏览器（webview 引擎）渲染端桥接。
 *
 * Host 半在 Electron 主进程内用 WebContentsView 承载页面（ZCode Desktop IAB
 * 的 webview 对应物），本模块提供渲染端三件事：
 * 1. 能力探测：/liuli-browser/capabilities（纯 Web 部署无此路由 → null →
 *    BrowserPanel 回退 iframe）；
 * 2. SSE 事件总线：/liuli-browser/events 单连接，hello/state/new-tab/closed
 *    按 tabId 分发（ZCode webview did-* 事件同步的镜像）；
 * 3. 动作 API：tabs/geometry/viewport/action/execute/open-external 等。
 *
 * 几何上报用 ResizeObserver + scroll 捕获 + 心跳，carrier 区域与原生视图
 * 逐像素贴合；窗口缩放/滚动/面板拖宽都会触发重报。
 */

/** Host 侧标签状态快照（与 browser-engine BrowserTabState 一致）。 */
export interface WebviewTabState {
  url: string
  title: string
  favicon: string | null
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  ready: boolean
  error: string | null
}

/** SSE 事件（与 browser-engine BrowserEvent 一致）。 */
export type WebviewEvent =
  | { type: 'hello'; tabs: Array<{ tabId: string; state: WebviewTabState }> }
  | { type: 'state'; tabId: string; state: WebviewTabState }
  | { type: 'new-tab'; sourceTabId: string; url: string; disposition: string }
  | { type: 'dialog'; tabId: string; kind: 'alert' | 'confirm' | 'prompt'; message: string }
  | { type: 'closed'; tabId: string }

/** 能力探测结果；null = 非 Electron 部署（回退 iframe）。 */
export interface WebviewCapabilities {
  engine: 'webview'
  partition: string
  viewport: { min: number; maxW: number; maxH: number }
}

/** 能力探测（进程内缓存；SPA 兜底 HTML 响应解析失败 → null）。 */
let capsPromise: Promise<WebviewCapabilities | null> | undefined
export function detectWebviewEngine(): Promise<WebviewCapabilities | null> {
  capsPromise ??= (async () => {
    try {
      const resp = await fetch('/liuli-browser/capabilities', {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      const type = resp.headers.get('content-type') ?? ''
      if (!resp.ok || !type.includes('application/json')) return null
      const body = await resp.json() as { ok?: boolean; engine?: string; partition?: string; viewport?: { min?: number; maxW?: number; maxH?: number } }
      if (body.ok !== true || body.engine !== 'webview') return null
      return {
        engine: 'webview',
        partition: typeof body.partition === 'string' ? body.partition : '',
        viewport: {
          min: body.viewport?.min ?? 320,
          maxW: body.viewport?.maxW ?? 3840,
          maxH: body.viewport?.maxH ?? 2160,
        },
      }
    } catch {
      return null
    }
  })()
  return capsPromise
}

/** 测试钩子：重置能力缓存（热重载后用）。 */
export function resetWebviewDetection(): void {
  capsPromise = undefined
}

/* ── SSE 事件总线（单连接多订阅） ─────────────────────────────── */

type EventListener = (event: WebviewEvent) => void

const bus = {
  source: null as EventSource | null,
  byTab: new Map<string, Set<EventListener>>(),
  global: new Set<EventListener>(),
  lastHello: null as Extract<WebviewEvent, { type: 'hello' }> | null,
}

function dispatch(event: WebviewEvent): void {
  if (event.type === 'hello') bus.lastHello = event
  if (event.type === 'state' || event.type === 'dialog' || event.type === 'closed') {
    const set = bus.byTab.get(event.tabId)
    if (set !== undefined) for (const listener of set) listener(event)
  }
  for (const listener of bus.global) listener(event)
}

function ensureEventStream(): void {
  if (bus.source !== null) return
  let source: EventSource
  try {
    source = new EventSource('/liuli-browser/events')
  } catch {
    return
  }
  bus.source = source
  source.onmessage = (message) => {
    try {
      const parsed = JSON.parse(String(message.data)) as WebviewEvent
      if (parsed !== null && typeof parsed === 'object' && typeof (parsed as { type?: unknown }).type === 'string') dispatch(parsed)
    } catch { /* 非法帧丢弃 */ }
  }
  source.onerror = () => {
    // EventSource 自带重连；连接彻底失败时释放，等下个订阅者重建。
    if (source.readyState === EventSource.CLOSED) {
      bus.source = null
      if (bus.byTab.size > 0 || bus.global.size > 0) window.setTimeout(ensureEventStream, 1500)
    }
  }
}

/** 订阅单个标签的状态事件；返回取消订阅函数。 */
export function subscribeWebviewTab(tabId: string, listener: EventListener): () => void {
  ensureEventStream()
  let set = bus.byTab.get(tabId)
  if (set === undefined) {
    set = new Set()
    bus.byTab.set(tabId, set)
  }
  set.add(listener)
  // 补发最近一次 hello 里该标签的状态，避免 SSE 晚于 create 到达时空窗。
  const helloState = bus.lastHello?.tabs.find(t => t.tabId === tabId)?.state
  if (helloState !== undefined) {
    window.setTimeout(() => { listener({ type: 'state', tabId, state: helloState }) }, 0)
  }
  return () => {
    const current = bus.byTab.get(tabId)
    if (current === undefined) return
    current.delete(listener)
    if (current.size === 0) bus.byTab.delete(tabId)
  }
}

/** 订阅全局事件（new-tab：弹窗转侧边栏新标签；closed）。 */
export function subscribeWebviewGlobal(listener: EventListener): () => void {
  ensureEventStream()
  bus.global.add(listener)
  return () => { bus.global.delete(listener) }
}

/* ── 动作 API ─────────────────────────────────────────────────── */

async function postJson(path: string, body: unknown): Promise<{ [key: string]: unknown }> {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await resp.text()
  try { return JSON.parse(text) as { [key: string]: unknown } } catch { return { ok: false, error: `bad response ${resp.status}` } }
}

/** webview 引擎动作面（Host /liuli-browser 路由的渲染端镜像）。 */
export const webviewBrowser = {
  createTab(id: string, url: string): Promise<{ [key: string]: unknown }> {
    return postJson('/liuli-browser/tabs', { id, url })
  },
  destroyTab(id: string): Promise<{ [key: string]: unknown }> {
    return postJson('/liuli-browser/tabs/destroy', { id })
  },
  geometry(id: string, rect: { x: number; y: number; width: number; height: number }, visible: boolean): Promise<void> {
    return postJson('/liuli-browser/tabs/geometry', { id, ...rect, visible }).then(() => undefined)
  },
  viewport(id: string, viewport: { width: number; height: number; scale: number } | null): Promise<void> {
    return postJson('/liuli-browser/tabs/viewport', { id, ...(viewport ?? { width: 0, height: 0, scale: 1 }) }).then(() => undefined)
  },
  action(id: string, action: 'navigate' | 'back' | 'forward' | 'reload' | 'stop' | 'devtools' | 'focus', url?: string): Promise<{ [key: string]: unknown }> {
    return postJson('/liuli-browser/tabs/action', url === undefined ? { id, action } : { id, action, url })
  },
  execute(id: string, codeText: string): Promise<{ ok?: boolean; value?: unknown; error?: string }> {
    return postJson('/liuli-browser/tabs/execute', { id, code: codeText }) as Promise<{ ok?: boolean; value?: unknown; error?: string }>
  },
  openExternal(url: string): Promise<{ [key: string]: unknown }> {
    return postJson('/liuli-browser/open-external', { url })
  },
}

/* ── carrier 几何上报 ─────────────────────────────────────────── */

/**
 * 把 carrier 元素的位置持续上报给 Host（原生视图贴合用）。
 * visible=false 或宽高 <4px 时 Host 隐藏视图。
 */
export function reportGeometryLoop(
  tabId: string,
  getElement: () => HTMLElement | null,
  isVisible: () => boolean,
): () => void {
  let disposed = false
  let lastSent = ''
  let pending = 0

  const send = (): void => {
    if (disposed) return
    const el = getElement()
    if (el === null) return
    const rect = el.getBoundingClientRect()
    const visible = isVisible() && rect.width >= 4 && rect.height >= 4 && document.visibilityState === 'visible'
    const x = Math.round(rect.left)
    const y = Math.round(rect.top)
    const width = Math.round(rect.width)
    const height = Math.round(rect.height)
    const key = `${x}:${y}:${width}:${height}:${visible ? 1 : 0}`
    if (key === lastSent) return
    lastSent = key
    pending += 1
    void webviewBrowser.geometry(tabId, { x, y, width, height }, visible).finally(() => { pending -= 1 })
  }

  // 心跳兜底：祖先 transform/位移不经 RO/scroll 冒泡（ZCode 用 rAF 循环，这里 300ms 足够省）。
  const heartbeat = window.setInterval(() => { if (pending < 4) send() }, 300)
  const onScrollResize = (): void => { send() }
  window.addEventListener('resize', onScrollResize)
  window.addEventListener('scroll', onScrollResize, true)
  document.addEventListener('visibilitychange', onScrollResize)

  const el = getElement()
  let observer: ResizeObserver | undefined
  if (el !== null && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(() => { send() })
    observer.observe(el)
  }
  send()

  return () => {
    disposed = true
    window.clearInterval(heartbeat)
    window.removeEventListener('resize', onScrollResize)
    window.removeEventListener('scroll', onScrollResize, true)
    document.removeEventListener('visibilitychange', onScrollResize)
    observer?.disconnect()
    // 收起/卸载时立即隐藏原生视图。
    void webviewBrowser.geometry(tabId, { x: 0, y: 0, width: 0, height: 0 }, false)
  }
}
