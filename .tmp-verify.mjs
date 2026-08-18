// Post-restart verification of the liuli-theme webview engine (ZCode IAB parity checklist).
import { writeFileSync } from 'node:fs'
const BASE = 'http://127.0.0.1:7336'
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass, detail: String(detail).slice(0, 160) }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 120) : '')) }

async function caps() {
  const resp = await fetch(BASE + '/liuli-browser/capabilities', { headers: { accept: 'application/json' } })
  const ct = resp.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return null
  return resp.json()
}

async function post(path, body) {
  const resp = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
  return resp.json().catch(() => ({ __http: resp.status }))
}
async function get(path) {
  const resp = await fetch(BASE + path, { headers: { accept: 'application/json' } })
  return resp.json().catch(() => ({ __http: resp.status }))
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function waitState(tab, pred, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let state
  for (;;) {
    const resp = await get('/liuli-browser/tabs/state?id=' + encodeURIComponent(tab))
    state = resp.state
    if (state && pred(state)) return state
    if (Date.now() > deadline) return state
    await sleep(250)
  }
}

const c = await caps()
check('A1 capabilities returns webview engine', c && c.engine === 'webview', JSON.stringify(c ?? 'SPA fallback (host not restarted?)'))
if (!c || c.engine !== 'webview') { console.log(JSON.stringify({ summary: 'engine not live yet', results }, null, 1)); process.exit(1) }

// SSE stream observation
const events = []
const esAbort = new AbortController()
try {
  const resp = await fetch(BASE + '/liuli-browser/events', { signal: esAbort.signal, headers: { accept: 'text/event-stream' } })
  const reader = resp.body.getReader()
  const dec = new TextDecoder()
  ;(async () => {
    let buf = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2)
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try { events.push(JSON.parse(line.slice(6))) } catch { /* skip */ }
          }
        }
      }
    } catch { /* aborted */ }
  })()
} catch (e) { check('A2 SSE stream connects', false, e.message) }
await sleep(400)
check('A2 SSE stream connects + hello', events.some(e => e.type === 'hello'), 'events=' + events.length)

// create tab + navigate
const created = await post('/liuli-browser/tabs', { id: 'selftest', url: 'https://example.com/' })
check('A3 create tab', created.ok === true, JSON.stringify(created))
const st1 = await waitState('selftest', s => s.ready && !s.loading)
check('A4 example.com loads (url/title/canGoBack)', st1 && st1.url.startsWith('https://example.com') && /Example Domain/i.test(st1.title) && st1.canGoBack === false, JSON.stringify(st1 ?? {}))
check('A5 SSE state events flowed', events.filter(e => e.type === 'state' && e.tabId === 'selftest').length >= 2, 'state events=' + events.filter(e => e.type === 'state' && e.tabId === 'selftest').length)

// second nav → history
await post('/liuli-browser/tabs/action', { id: 'selftest', action: 'navigate', url: 'https://example.org/' })
const st2 = await waitState('selftest', s => s.ready && !s.loading && s.url.includes('example.org'))
check('A6 navigate second page + canGoBack', st2 && st2.canGoBack === true, JSON.stringify(st2 ?? {}))
await post('/liuli-browser/tabs/action', { id: 'selftest', action: 'back' })
const st3 = await waitState('selftest', s => s.ready && !s.loading && s.url.includes('example.com') && s.canGoForward === true)
check('A7 back returns + canGoForward', !!st3, JSON.stringify(st3 ?? {}))

// execute + title + reload
const exec = await post('/liuli-browser/tabs/execute', { id: 'selftest', code: 'document.title' })
check('A8 executeJavaScript returns title', exec.ok === true && /Example Domain/i.test(String(exec.value)), JSON.stringify(exec))
await post('/liuli-browser/tabs/action', { id: 'selftest', action: 'reload' })
const st4 = await waitState('selftest', s => s.ready && !s.loading)
check('A9 reload settles', !!st4, JSON.stringify(st4 ?? {}))

// popup → new-tab SSE (ZCode: webview 请求打开右侧浏览器 tab)
await post('/liuli-browser/tabs/execute', { id: 'selftest', code: 'window.open("https://www.iana.org/"); "opened"' })
await sleep(1200)
const newTabEvent = events.find(e => e.type === 'new-tab' && e.sourceTabId === 'selftest')
check('A10 popup → SSE new-tab event', !!newTabEvent, JSON.stringify(newTabEvent ?? 'none'))

// fail-load reporting
await post('/liuli-browser/tabs/action', { id: 'selftest', action: 'navigate', url: 'https://nonexistent.invalid/' })
const stErr = await waitState('selftest', s => s.error !== null || (!s.loading && s.ready), 15000)
check('A11 did-fail-load → error state', stErr && stErr.error !== null, JSON.stringify(stErr ?? {}))

// geometry + viewport endpoints
const geo = await post('/liuli-browser/tabs/geometry', { id: 'selftest', x: 100, y: 100, width: 400, height: 300, visible: true })
check('A12 geometry accepted', geo.ok === true, JSON.stringify(geo))
const vp = await post('/liuli-browser/tabs/viewport', { id: 'selftest', width: 390, height: 844, scale: 0.5 })
check('A13 responsive viewport accepted', vp.ok === true && JSON.stringify(vp.viewport).includes('390'), JSON.stringify(vp))
await post('/liuli-browser/tabs/viewport', { id: 'selftest', width: 0, height: 0, scale: 1 })

// screenshot
const shot = await fetch(BASE + '/liuli-browser/tabs/screenshot?id=selftest')
const shotBuf = Buffer.from(await shot.arrayBuffer())
const isPng = shotBuf.length > 8 && shotBuf[0] === 0x89 && shotBuf[1] === 0x50
if (isPng) writeFileSync('.tmp-selftest.png', shotBuf)
check('A14 screenshot PNG', isPng, 'bytes=' + shotBuf.length)

// destroy
const destroyed = await post('/liuli-browser/tabs/destroy', { id: 'selftest' })
const closedEvent = events.find(e => e.type === 'closed' && e.tabId === 'selftest')
check('A15 destroy tab + SSE closed', destroyed.ok === true && !!closedEvent, JSON.stringify({ destroyed, closedEvent: !!closedEvent }))

esAbort.abort()
const failed = results.filter(r => !r.pass)
console.log('\nSUMMARY: ' + String(results.length - failed.length) + '/' + String(results.length) + ' passed')
if (failed.length > 0) console.log('FAILED: ' + failed.map(f => f.name).join(' | '))
