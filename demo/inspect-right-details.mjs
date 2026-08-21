// 调查：右侧边栏（details 列）与设置页的层级关系
import { spawn, execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9500 + (process.pid % 100)
const BASE = process.argv[2] !== undefined ? 'http://127.0.0.1:' + process.argv[2] : 'http://127.0.0.1:2050'
const MODE = process.argv[3] ?? 'advanced'

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-rd-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', BASE + '/?dsh-desktop-mode=' + MODE + '&dsh-desktop-platform=win32'], { stdio: 'ignore' })
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
  console.log('URL:', await evalJs('location.href'))

  // 1. 打开 details 列（右侧边栏）——预览面板按钮
  const hookRes = await evalJs(`(() => { const h = window.__liuliDockShell__; if (!h) return 'no-hook'; h.openDetails(); return 'opened' })()`)
  console.log('openDetails:', hookRes)
  await sleep(1000)
  const det = await evalJs('(() => { const cols = Array.from(document.querySelectorAll("[class*=_detailsCol]")); return cols.map(c => { const r = c.getBoundingClientRect(); const cs = getComputedStyle(c); return { cls: String(c.className).slice(0, 60), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, z: cs.zIndex, pos: cs.position } }) })()')
  console.log('details 列:', JSON.stringify(det, null, 1))
  // details 列内是否有面板内容
  const detText = await evalJs('(() => { const c = document.querySelector("[class*=_detailsCol]"); return c ? (c.textContent || "").trim().slice(0, 80) : null })()')
  console.log('details 内容:', detText)

  // 2. 打开设置页
  await evalJs('(() => { const b = Array.from(document.querySelectorAll("button")).find(el => (el.getAttribute("aria-label") || "").includes("设置") || (el.textContent || "").trim() === "设置"); if (b) { b.click(); return true } return false })()')
  await sleep(1200)
  console.log('body 标记:', await evalJs('document.body.hasAttribute("data-liuli-settings-open")'))
  // 3. 设置页打开后：右半区域 elementFromPoint 命中
  const hits = await evalJs('(() => { const pts = [innerWidth * 0.7, innerWidth * 0.85, innerWidth * 0.95].map(x => { const el = document.elementFromPoint(x, innerHeight * 0.5); let n = el; const chain = []; while (n && chain.length < 5) { chain.push({ tag: n.tagName, cls: String(n.className).slice(0, 45) }); n = n.parentElement } return { x: Math.round(x), top: chain[0], inOverlay: !!el?.closest?.("[class*=_overlay]"), inDetails: !!el?.closest?.("[class*=_detailsCol]") } }); return pts })()')
  console.log('右半命中:', JSON.stringify(hits, null, 1))
  // 4. overlay 与 details 列的 z-index 对比
  const zi = await evalJs('(() => { const ov = document.querySelector("[class*=_overlay]"); const dc = document.querySelector("[class*=_detailsCol]"); return { overlay: ov ? { cls: String(ov.className).slice(0, 40), z: getComputedStyle(ov).zIndex, inSidebar: !!ov.closest("[class*=_sidebarCol]") } : null, details: dc ? { cls: String(dc.className).slice(0, 50), z: getComputedStyle(dc).zIndex, pos: getComputedStyle(dc).position } : null } })()')
  console.log('层级对比:', JSON.stringify(zi, null, 1))
} catch (e) {
  console.log('RD ERROR:', e.message)
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch { /* ignore */ }
  try { execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }) } catch { /* ignore */ }
}

