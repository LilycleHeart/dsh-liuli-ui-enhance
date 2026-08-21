// elementsFromPoint 查看绘制栈
import { spawn, execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9700 + (process.pid % 100)
const BASE = process.argv[2] !== undefined ? 'http://127.0.0.1:' + process.argv[2] : 'http://127.0.0.1:3392'

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-efp-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32'], { stdio: 'ignore' })
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
  const stack = await evalJs('(() => document.elementsFromPoint(1414, innerHeight / 2).map(el => ({ tag: el.tagName, cls: String(el.className).slice(0, 55) })).slice(0, 14))()')
  console.log('x=1414 绘制栈:', JSON.stringify(stack, null, 1))
  // 命中元素最近的 overlay/details
  const hit = await evalJs('(() => { const el = document.elementFromPoint(1414, innerHeight / 2); return { el: el ? String(el.className).slice(0, 50) : null, inOverlay: !!el?.closest?.("[class*=_overlay]"), inDetails: !!el?.closest?.("[class*=_detailsCol]"), overlayZ: el?.closest?.("[class*=_overlay]") ? getComputedStyle(el.closest("[class*=_overlay]")).zIndex : null } })()')
  console.log('命中:', JSON.stringify(hit))
  const pan = await evalJs('(() => { const el = document.querySelector(".ygcHSa_panel, [class*=_panel]"); const all = Array.from(document.querySelectorAll("[class*=_detailsCol] [class*=_panel]")).map(p => { const cs = getComputedStyle(p); return { cls: String(p.className).slice(0, 45), z: cs.zIndex, pos: cs.position, bf: cs.backdropFilter.slice(0, 30), tf: cs.transform.slice(0, 20) } }); return all })()')
  console.log('details 面板 z:', JSON.stringify(pan, null, 1))
  const pan2 = await evalJs('(() => Array.from(document.querySelectorAll("[class*=_detailsCol] *")).filter(el => { const z = getComputedStyle(el).zIndex; return z !== "auto" && z !== "0" }).map(el => ({ cls: String(el.className).slice(0, 45), z: getComputedStyle(el).zIndex, pos: getComputedStyle(el).position })).slice(0, 15))()')
  console.log('details 列非 auto z 元素:', JSON.stringify(pan2, null, 1))

} catch (e) {
  console.log('EFP ERROR:', e.message)
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch { /* ignore */ }
  try { execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }) } catch { /* ignore */ }
}

