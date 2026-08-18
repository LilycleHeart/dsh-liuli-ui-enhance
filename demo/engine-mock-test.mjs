// Engine logic test: runs src/browser-engine (via lib/types) against a mock electron module.
import { registerHooks } from 'node:module'
import { Readable } from 'node:stream'

Object.defineProperty(process.versions, 'electron', { value: '43.4.0', configurable: true })

const results = []
const check = (name, pass, detail = '') => { results.push(pass); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 130) : '')) }

class MockWebContents {
  constructor() {
    this.listeners = new Map()
    this.url = 'about:blank'
    this.zoom = 1
    this.closed = false
    this.devtools = 0
    this.focused = 0
    this.openHandler = null
    this.navigationHistory = { canGoBack: () => this.backOk === true, canGoForward: () => this.fwdOk === true, goBack: () => {}, goForward: () => {} }
  }
  on(ev, fn) { if (!this.listeners.has(ev)) this.listeners.set(ev, []); this.listeners.get(ev).push(fn) }
  emit(ev, ...args) { for (const fn of this.listeners.get(ev) ?? []) fn({ preventDefault() {} }, ...args) }
  loadURL(url) { this.url = url; this.emit('did-start-loading'); this.emit('did-navigate', url); this.emit('page-title-updated', 'Mock ' + url); this.emit('did-stop-loading'); return Promise.resolve() }
  getURL() { return this.url }
  reload() { this.emit('did-start-loading'); this.emit('did-stop-loading') }
  stop() {}
  focus() { this.focused++ }
  close() { this.closed = true }
  openDevTools() { this.devtools++ }
  setZoomFactor(z) { this.zoom = z }
  getZoomFactor() { return this.zoom }
  executeJavaScript(code) { this.lastCode = code; return Promise.resolve('EXEC-OK') }
  capturePage() { return Promise.resolve({ toPNG: () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 42]) }) }
  setWindowOpenHandler(fn) { this.openHandler = fn }
}
class MockView {
  constructor(opts) { this.opts = opts; this.webContents = new MockWebContents(); this.bounds = null; this.visible = true; this.bg = null }
  setBounds(b) { this.bounds = b }
  setVisible(v) { this.visible = v }
  setBackgroundColor(c) { this.bg = c }
}
const winContentView = { children: [], addChildView(v) { this.children.push(v) }, removeChildView(v) { this.children = this.children.filter(x => x !== v) } }
const mockWindow = { isDestroyed: () => false, contentView: winContentView }
globalThis.__mockElectron = {
  BrowserWindow: { getAllWindows: () => [mockWindow] },
  WebContentsView: MockView,
  session: { fromPartition: (p) => ({ partition: p, downloadHandlers: [], on(ev, fn) { this.downloadHandlers.push(fn) } }) },
  shell: { opened: [], openExternal(url) { this.opened.push(url); return Promise.resolve() } },
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return { shortCircuit: true, url: 'mock:electron' }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'mock:electron') {
      return { shortCircuit: true, format: 'module', source: 'const m = globalThis.__mockElectron; export const BrowserWindow = m.BrowserWindow; export const WebContentsView = m.WebContentsView; export const session = m.session; export const shell = m.shell;' }
    }
    return nextLoad(url, context)
  },
})

const { createBrowserEngine } = await import('../lib/types/browser-engine.js')
const engine = await createBrowserEngine()
check('M1 engine created under mock electron', engine !== undefined)

// fake req/res plumbing
function fakeReq(method, url, body) {
  const req = new Readable({ read() {} })
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:7336' }
  if (body !== undefined) { req.push(JSON.stringify(body)); }
  req.push(null)
  return req
}
function fakeRes() {
  const res = { headers: null, chunks: [], ended: false, statusCode: 0 }
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers }
  res.write = (c) => { res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); return true }
  res.end = (c) => { if (c !== undefined) res.chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c))); res.ended = true }
  return res
}
const call = async (method, url, body) => {
  const res = fakeRes()
  await engine.route.handler(fakeReq(method, url, body), res)
  // route handler is fire-and-forget; wait for the async body to settle
  for (let i = 0; i < 200 && !res.ended; i++) await new Promise(r => setTimeout(r, 10))
  const text = Buffer.concat(res.chunks).toString('utf8')
  let json = null
  try { json = JSON.parse(text) } catch { /* SSE/stream */ }
  return { res, text, json }
}

// M2 capabilities
const caps = await call('GET', '/liuli-browser/capabilities')
check('M2 capabilities webview', caps.json?.engine === 'webview' && caps.json?.partition === 'persist:liuli-embedded-browser', caps.text.slice(0, 100))

// M3 SSE stream + hello
const sseRes = fakeRes()
const sseReq = fakeReq('GET', '/liuli-browser/events')
await engine.route.handler(sseReq, sseRes)
await new Promise(r => setTimeout(r, 50))
const sseEvents = () => Buffer.concat(sseRes.chunks).toString('utf8').split('\n\n').filter(Boolean).map(c => { try { return JSON.parse(c.replace('data: ', '')) } catch { return null } }).filter(Boolean)
check('M3 SSE hello on connect', sseEvents().some(e => e.type === 'hello'), Buffer.concat(sseRes.chunks).toString('utf8').slice(0, 80))

// M4 create tab
const created = await call('POST', '/liuli-browser/tabs', { id: 't1', url: 'https://example.com/' })
check('M4 create tab ok', created.json?.ok === true && winContentView.children.length === 1, created.text.slice(0, 300))
if (created.json?.ok !== true) { console.log('M4 DEBUG status=' + created.res.statusCode); process.exit(1) }
const view1 = winContentView.children[0]
check('M4b partition passed', view1.opts.webPreferences.partition === 'persist:liuli-embedded-browser')
check('M4c loadURL on create', view1.webContents.url === 'https://example.com/')

// M5 state reflects mock events (did-navigate + title + stop-loading)
const st = await call('GET', '/liuli-browser/tabs/state?id=t1')
check('M5 state url/title/ready', st.json?.state?.url === 'https://example.com/' && /Mock/.test(st.json?.state?.title ?? '') && st.json?.state?.ready === true, st.text.slice(0, 150))
check('M5b SSE state broadcast', sseEvents().filter(e => e.type === 'state' && e.tabId === 't1').length >= 2, 'n=' + sseEvents().filter(e => e.type === 'state').length)

// M6 actions
await call('POST', '/liuli-browser/tabs/action', { id: 't1', action: 'navigate', url: 'https://example.org/' })
check('M6 navigate action', view1.webContents.url === 'https://example.org/')
await call('POST', '/liuli-browser/tabs/action', { id: 't1', action: 'reload' })
await call('POST', '/liuli-browser/tabs/action', { id: 't1', action: 'devtools' })
check('M6b devtools opened', view1.webContents.devtools === 1)
await call('POST', '/liuli-browser/tabs/action', { id: 't1', action: 'focus' })
check('M6c focus', view1.webContents.focused === 1)

// M7 geometry
await call('POST', '/liuli-browser/tabs/geometry', { id: 't1', x: 10.4, y: 20.6, width: 300.2, height: 200.8, visible: true })
check('M7 geometry rounded bounds', JSON.stringify(view1.bounds) === JSON.stringify({ x: 10, y: 21, width: 300, height: 201 }) && view1.visible === true, JSON.stringify(view1.bounds))
await call('POST', '/liuli-browser/tabs/geometry', { id: 't1', x: 0, y: 0, width: 0, height: 0, visible: false })
check('M7b hidden when invisible', view1.visible === false && view1.bounds.x === -20000, JSON.stringify(view1.bounds))

// M8 responsive viewport: bounds centered, zoom = scale
await call('POST', '/liuli-browser/tabs/geometry', { id: 't1', x: 0, y: 0, width: 800, height: 600, visible: true })
await call('POST', '/liuli-browser/tabs/viewport', { id: 't1', width: 390, height: 844, scale: 0.5 })
check('M8 viewport scaled bounds (centered)', JSON.stringify(view1.bounds) === JSON.stringify({ x: Math.round((800 - 195) / 2), y: Math.round((600 - 422) / 2), width: 195, height: 422 }), JSON.stringify(view1.bounds))
check('M8b zoom factor applied', view1.webContents.zoom === 0.5)
await call('POST', '/liuli-browser/tabs/viewport', { id: 't1', width: 100, height: 100, scale: 1 }) // below min → cleared
check('M8c below-min viewport cleared', view1.webContents.zoom === 1 && JSON.stringify(view1.bounds) === JSON.stringify({ x: 0, y: 0, width: 800, height: 600 }), JSON.stringify(view1.bounds))

// M9 execute + screenshot + open-external
const exec = await call('POST', '/liuli-browser/tabs/execute', { id: 't1', code: '1+1' })
check('M9 execute', exec.json?.ok === true && exec.json?.value === 'EXEC-OK', exec.text.slice(0, 80))
const shotRes = fakeRes()
await engine.route.handler(fakeReq('GET', '/liuli-browser/tabs/screenshot?id=t1'), shotRes)
for (let i = 0; i < 200 && !shotRes.ended; i++) await new Promise(r => setTimeout(r, 10))
check('M9b screenshot png', shotRes.headers?.['content-type'] === 'image/png' && Buffer.concat(shotRes.chunks)[0] === 0x89)
await call('POST', '/liuli-browser/open-external', { url: 'https://example.com/' })
check('M9c open-external shell call', globalThis.__mockElectron.shell.opened.length === 1)
const badExt = await call('POST', '/liuli-browser/open-external', { url: 'file:///etc/passwd' })
check('M9d open-external rejects non-http', badExt.json?.ok === false)

// M10 popup → new-tab SSE
const handler = view1.webContents.openHandler
check('M10 window-open handler set', typeof handler === 'function')
const decision = handler({ url: 'https://popup.example/', disposition: 'foreground-tab' })
check('M10b popup denied + SSE new-tab', decision.action === 'deny' && sseEvents().some(e => e.type === 'new-tab' && e.url === 'https://popup.example/' && e.sourceTabId === 't1'))

// M11 did-fail-load → error state (event arg skipped)
view1.webContents.emit('did-fail-load', -105, 'ERR_NAME_NOT_RESOLVED', 'https://bad.example/', true)
const stErr = await call('GET', '/liuli-browser/tabs/state?id=t1')
check('M11 fail-load error', /ERR_NAME_NOT_RESOLVED/.test(stErr.json?.state?.error ?? ''), stErr.text.slice(0, 140))
view1.webContents.emit('did-fail-load', -3, 'ERR_ABORTED', 'https://x/', true)
const stAb = await call('GET', '/liuli-browser/tabs/state?id=t1')
check('M11b ERR_ABORTED ignored', !/ERR_ABORTED/.test(stAb.json?.state?.error ?? ''), stAb.json?.state?.error)

// M12 render-process-gone → rebuild in place
const gen0 = (await call('GET', '/liuli-browser/tabs/state?id=t1')).json.generation
view1.webContents.emit('render-process-gone', { exitCode: 1, reason: 'crashed' })
await new Promise(r => setTimeout(r, 30))
const stRe = await call('GET', '/liuli-browser/tabs/state?id=t1')
check('M12 rebuild generation++', stRe.json?.generation === gen0 + 1, 'gen=' + stRe.json?.generation)
check('M12b view replaced & re-added', winContentView.children.length === 1 && winContentView.children[0] !== view1 && view1.webContents.closed === true)
check('M12c restore url navigated', winContentView.children[0].webContents.url !== 'about:blank', winContentView.children[0].webContents.url)

// M13 destroy
const destroyed = await call('POST', '/liuli-browser/tabs/destroy', { id: 't1' })
check('M13 destroy', destroyed.json?.ok === true && winContentView.children.length === 0 && sseEvents().some(e => e.type === 'closed' && e.tabId === 't1'))

// M14 loopback fence
const forbiddenRes = fakeRes()
const forbiddenReq = fakeReq('GET', '/liuli-browser/capabilities')
forbiddenReq.headers.host = 'evil.example.com'
await engine.route.handler(forbiddenReq, forbiddenRes)
check('M14 non-loopback host forbidden', forbiddenRes.statusCode === 403)

engine.dispose()
const failed = results.filter(r => !r).length
console.log('SUMMARY: ' + String(results.length - failed) + '/' + String(results.length) + ' passed')
process.exit(failed === 0 ? 0 : 1)
