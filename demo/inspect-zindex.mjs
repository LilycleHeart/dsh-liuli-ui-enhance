// 深挖：设置页 overlay 与 details 列的堆叠细节
import { spawn, execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9600 + (process.pid % 100)
const BASE = process.argv[2] !== undefined ? 'http://127.0.0.1:' + process.argv[2] : 'http://127.0.0.1:3392'
const MODE = 'advanced'

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-zi-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', BASE + '/?dsh-desktop-mode=' + MODE + '&dsh-desktop-platform=win32'], { stdio: 'ignore' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let ws = null, sendId = 0
const pending = new Map()

async function connect() {
  let list = []
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json')).json(); if (list.some(t => t.type === 'page')) break } catch { /* retry */ }
    await sleep(500)
  }
  const pages = list.filter(t => t.type === 'page')
  const target = pages.find(t => t.url && t.url.startsWith(BASE)) ?? pages.find(t => t.url && t.url.startsWith('http')) ?? pages[0]
  if (!target) throw new Error('no page target')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); return }
  }
  await send('Runtime.enable')
  await send('Page.enable')
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
  await evalJs('(() => { const h = window.__liuliDockShell__; if (h) h.openDetails(); return true })()').catch(() => false)
  await sleep(1000)
  await evalJs('(() => { const b = Array.from(document.querySelectorAll("button")).find(el => (el.getAttribute("aria-label") || "").includes("设置") || (el.textContent || "").trim() === "设置"); if (b) { b.click(); return true } return false })()')
  await sleep(1200)

  const expr = [
    "(() => {",
    "const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return { sel, cls: String(el.className).slice(0, 60), pos: cs.position, z: cs.zIndex, transform: cs.transform.slice(0, 30), backdrop: cs.backdropFilter.slice(0, 40), filter: cs.filter.slice(0, 30), opacity: cs.opacity, rect: { x: Math.round(r.x), w: Math.round(r.width) } } }",
    "const sidebarRoot = pick('[class*=_sidebarCol] > div > [class*=_root]')",
    "const sidebarSurface = pick('.dshDesktopSidebarSurface')",
    "const detailsSurface = pick('.dshDesktopDetailsSurface')",
    "const overlay = (() => { const el = document.querySelector('[class*=_overlay]'); if (!el) return null; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); const chain = []; let n = el; while (n && chain.length < 8) { chain.push({ tag: n.tagName, cls: String(n.className).slice(0, 45) }); n = n.parentElement } return { cls: String(el.className).slice(0, 40), pos: cs.position, z: cs.zIndex, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, offsetParent: el.offsetParent ? String(el.offsetParent.className).slice(0, 40) : null, chain } })()",
    "const frame = pick('.dshDesktopFrame')",
    "return { sidebarRoot, sidebarSurface, detailsSurface, overlay, frame }",
    "})()",
  ].join('\n')
  const info = await evalJs(expr)
  console.log(JSON.stringify(info, null, 1))
} catch (e) {
  console.log('ZI ERROR:', e.message)
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch { /* ignore */ }
  try { execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }) } catch { /* ignore */ }
}

