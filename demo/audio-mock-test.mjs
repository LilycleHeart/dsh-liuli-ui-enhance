// Audio-capture host logic test: runs src/host-audio (compiled to demo/.tmp-host-audio.mjs)
// Regenerate the artifact: rolldown src/host-audio.ts --file demo/.tmp-host-audio.mjs --format esm --platform node
// against a mock electron module. Verifies the Desktop system-audio fix:
//   A1 installSystemAudioCapture registers a display-media handler granting
//      audio:'loopback' (system loopback) without muting on defaultSession,
//      the desktop renderer partition (persist:dsh-desktop-renderer, 2.0.3+),
//      and existing webContents sessions, plus a web-contents-created watcher;
//   A2 handler answers audio-only and audio+video requests correctly;
//   A3 dispose resets all handlers to null (plugin unload);
//   A4 /liuli-audio route reports available:true + capture:'loopback' under
//      Electron on win32 while installed, available:false otherwise.
import { registerHooks } from 'node:module'
import { Readable } from 'node:stream'

const results = []
const check = (name, pass, detail = '') => { results.push(pass); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 130) : '')) }

// ── mock electron: desktopCapturer + session (defaultSession + fromPartition) + webContents + app ──
const captured = { handler: null, requests: [], resets: 0, partitions: [], appOn: null }
const partitionHandler = { handler: null, resets: 0 }
const wcHandler = { handler: null, resets: 0 }
function makeSession(store) {
  return {
    setDisplayMediaRequestHandler(handler) {
      if (handler === null) { store.resets++; store.handler = null; return }
      store.handler = handler
    },
  }
}
globalThis.__mockElectron = {
  desktopCapturer: {
    getSources: async (opts) => { captured.requests.push({ kind: 'getSources', opts })
      return [{ id: 'screen:0:0', name: 'Screen 1', display_id: '0' }] },
  },
  session: {
    defaultSession: makeSession(captured),
    fromPartition(partition) { captured.partitions.push(partition); return makeSession(partitionHandler) },
  },
  webContents: { getAllWebContents: () => [{ session: makeSession(wcHandler) }] },
  app: { on: (event, cb) => { captured.appOn = { event, cb } }, off: () => {} },
}

Object.defineProperty(process.versions, 'electron', { value: '43.4.0', configurable: true })

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return { shortCircuit: true, url: 'mock:electron' }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'mock:electron') {
      return { shortCircuit: true, format: 'module', source: 'const m = globalThis.__mockElectron; export const desktopCapturer = m.desktopCapturer; export const session = m.session; export const webContents = m.webContents; export const app = m.app;' }
    }
    return nextLoad(url, context)
  },
})

function fakeReq(method, url) {
  const req = new Readable({ read() {} })
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:7336' }
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
async function callRoute(route, method, url) {
  const res = fakeRes()
  await route.handler(fakeReq(method, url), res)
  for (let i = 0; i < 200 && !res.ended; i++) await new Promise(r => setTimeout(r, 10))
  const text = Buffer.concat(res.chunks).toString('utf8')
  let json = null
  try { json = JSON.parse(text) } catch { }
  return { res, text, json }
}

const modUrl = new URL('.tmp-host-audio.mjs', import.meta.url).href
const hostAudio = await import(modUrl)

// A1 install handler (win32: current platform IS win32)
const dispose = await hostAudio.installSystemAudioCapture()
check('A1 handler installed (defaultSession)', typeof captured.handler === 'function', 'default=' + typeof captured.handler)
check('A1b handler installed on desktop renderer partition', typeof partitionHandler.handler === 'function' && captured.partitions.includes('persist:dsh-desktop-renderer'), 'partitions=' + captured.partitions.join(','))
check('A1c handler installed on existing webContents session', typeof wcHandler.handler === 'function', 'wc=' + typeof wcHandler.handler)
check('A1d web-contents-created watcher attached', captured.appOn?.event === 'web-contents-created', 'event=' + (captured.appOn?.event ?? 'none'))

// A2a audio-only request -> { audio: 'loopback' } (no video granted, no getSources)
const streamsA = {}
captured.handler({ videoRequested: false, audioRequested: true, userGesture: true, securityOrigin: 'http://127.0.0.1:7336' }, (s) => Object.assign(streamsA, s))
await new Promise(r => setTimeout(r, 20))
check('A2a audio-only -> loopback', streamsA.audio === 'loopback' && streamsA.video === undefined && captured.requests.length === 0, JSON.stringify(streamsA))

// A2b audio+video request -> loopback + first screen source
const streamsB = {}
captured.handler({ videoRequested: true, audioRequested: true, userGesture: true, securityOrigin: 'http://127.0.0.1:7336' }, (s) => Object.assign(streamsB, s))
await new Promise(r => setTimeout(r, 30))
check('A2b audio+video -> loopback + screen', streamsB.audio === 'loopback' && streamsB.video?.id === 'screen:0:0', JSON.stringify(streamsB))

// A2c route probe while handler installed -> available:true (Electron+win32 且已装 handler)
let route = hostAudio.audioCaptureRoute()
let r2 = await callRoute(route, 'GET', '/liuli-audio')
check('A2c desktop loopback capability (handler installed)', r2.json?.available === true && r2.json?.capture === 'loopback', r2.text.slice(0, 120))

// A2d 新建 webContents 触发 web-contents-created → 补装 handler（DSH 重启渲染器/新窗口）
const lateStore = { handler: null, resets: 0 }
const lateSession = makeSession(lateStore)
captured.appOn.cb({}, { session: lateSession })
check('A2d new webContents gets handler via watcher', typeof lateStore.handler === 'function', 'late=' + typeof lateStore.handler)

// A3 dispose resets handler to null (all sessions + watcher off)
await dispose()
check('A3 dispose resets handler', captured.handler === null && captured.resets === 1, 'resets=' + captured.resets)
check('A3b dispose resets partition handler', partitionHandler.handler === null && partitionHandler.resets === 1, 'resets=' + partitionHandler.resets)
check('A3c dispose resets webContents handler', wcHandler.handler === null && wcHandler.resets === 1, 'resets=' + wcHandler.resets)

// A4 route probe after dispose -> available:false（handler 已卸载，探针如实上报，不再仅凭
//    Electron+win32 就宣称可用；index.ts 契约：未装 handler 时 available:false）
route = hostAudio.audioCaptureRoute()
const r4 = await callRoute(route, 'GET', '/liuli-audio')
check('A4 desktop loopback capability (handler disposed)', r4.json?.available === false && r4.json?.capture === 'getDisplayMedia', r4.text.slice(0, 120))
check('A4b fence non-loopback', (await (async () => { const res = fakeRes(); const req = fakeReq('GET', '/liuli-audio'); req.headers.host = 'evil.example.com'; await route.handler(req, res); return res.statusCode })()) === 403)

// A5 plain Web (no electron): fresh module instance with electron version unset
delete process.versions.electron
const webUrl = modUrl + '?web'
const hostAudioWeb = await import(webUrl)
const routeWeb = hostAudioWeb.audioCaptureRoute()
const r5 = await callRoute(routeWeb, 'GET', '/liuli-audio')
check('A5 plain web -> available:false', r5.json?.available === false && r5.json?.capture === 'getDisplayMedia', r5.text.slice(0, 120))

const failed = results.filter(r => !r).length
console.log('SUMMARY: ' + String(results.length - failed) + '/' + String(results.length) + ' passed')
process.exit(failed === 0 ? 0 : 1)