// 诊断14：composer 高度构成（144px vs 官方 94px）
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9320
const BASE = process.argv[2] ? 'http://127.0.0.1:' + process.argv[2] : 'http://127.0.0.1:43120'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-hdiag-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32'], { stdio: 'ignore' })
let ws = null, sendId = 0
const pending = new Map()

async function connect() {
  let list = []
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json')).json(); if (list.some(t => t.type === 'page')) break } catch { /* retry */ }
    await sleep(400)
  }
  const target = list.find(t => t.type === 'page')
  if (!target) throw new Error('no page target')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); return }
  }
  await send('Runtime.enable')
}
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++sendId
    pending.set(id, { res, rej })
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' timeout')) } }, 30000)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r?.result?.value
}

try {
  await connect()
  await sleep(13000)
  await evalJs(`(() => {
    const rows = document.querySelectorAll('[data-session-id], [class*="_sessionItem"], [class*="_sessionRow"]')
    const target = Array.from(rows).find(r => !(r.textContent ?? '').includes('新会话')) ?? rows[0]
    if (target) target.click()
    return true
  })()`)
  await sleep(3000)
  await evalJs(`(() => {
    const btn = document.querySelector('button[aria-label*="展开侧边面板"], button[aria-label*="收起侧边面板"]')
    if (btn) { btn.click(); return true }
    return false
  })()`)
  await sleep(1500)
  await evalJs(`window.dispatchEvent(new CustomEvent('liuli:side-chat-open'))`)
  await sleep(3000)
  const geo = await evalJs(`(() => {
    const comp = document.querySelector('[class*="_chatComposer"]')
    if (!comp) return 'no-comp'
    const q = (sel) => comp.querySelector(sel)
    const r = (el) => { if (!el) return null; const g = el.getBoundingClientRect(); return { h: Math.round(g.height), w: Math.round(g.width) } }
    const cs = (el) => { if (!el) return null; const s = getComputedStyle(el); return { pt: s.paddingTop, pb: s.paddingBottom, pl: s.paddingLeft, pr: s.paddingRight, gap: s.gap, lh: s.lineHeight, fs: s.fontSize, mh: s.maxHeight, h: s.height } }
    const scroll = q('[class*="_composerScroll"]')
    const grow = q('[class*="_composerGrow"]')
    const mirror = q('[class*="_composerMirror"]')
    const input = q('[class*="_chatInput"]')
    const row = q('[class*="_composerRow"]')
    return JSON.stringify({
      comp: r(comp), compCS: cs(comp),
      scroll: r(scroll), scrollCS: cs(scroll),
      grow: r(grow), growCS: cs(grow),
      mirror: r(mirror), mirrorText: mirror ? JSON.stringify(mirror.textContent) : null,
      input: r(input), inputCS: cs(input),
      row: r(row), rowCS: cs(row),
      mirrorChildH: mirror ? Math.round(mirror.firstChild?.parentElement?.getBoundingClientRect().height ?? 0) : null,
    })
  })()`)
  console.log('geo:', geo)
  // 官方 composer 对比
  const official = await evalJs(`(() => {
    const seat = document.querySelector('[data-composer-seat]')
    const card = seat ? seat.querySelector('[data-composer-card="true"]') : null
    const grow = card ? card.querySelector('[class*="_grow"]') : null
    const mirror = card ? card.querySelector('[data-input-mirror]') : null
    const input = card ? card.querySelector('[class*="_input"]') : null
    const row = card ? card.querySelector('[class*="_row"]') : null
    const r = (el) => { if (!el) return null; const g = el.getBoundingClientRect(); return { h: Math.round(g.height), w: Math.round(g.width) } }
    const cs = (el) => { if (!el) return null; const s = getComputedStyle(el); return { pt: s.paddingTop, pb: s.paddingBottom, gap: s.gap, lh: s.lineHeight, fs: s.fontSize } }
    return JSON.stringify({
      card: r(card), cardCS: cs(card),
      grow: r(grow), growCS: cs(grow),
      mirror: r(mirror), mirrorText: mirror ? JSON.stringify(mirror.textContent) : null,
      input: r(input),
      row: r(row), rowCS: cs(row),
    })
  })()`)
  console.log('official:', official)
} catch (err) {
  console.error('SCRIPT ERROR:', err)
} finally {
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
}
