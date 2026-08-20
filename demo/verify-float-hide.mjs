// 验证 V5 强化：创建浮动窗口 → 打开设置页 → 浮动窗口隐藏 → 关闭设置页恢复
import { spawn, execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9400 + (process.pid % 100)
const BASE = process.argv[2] !== undefined ? 'http://127.0.0.1:' + process.argv[2] : 'http://127.0.0.1:2050'
const MODE = 'advanced'

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-v5-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', BASE + '/?dsh-desktop-mode=' + MODE + '&dsh-desktop-platform=win32'], { stdio: 'ignore' })
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
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 120) : '')) }

try {
  await connect()
  await sleep(13000)
  console.log('URL:', await evalJs('location.href'))
  console.log('title:', await evalJs('document.title'))

  // 1. 找浮动按钮并创建浮动窗口（抓握簇 ⧉）
  const grip = await evalJs(`(() => { const panes = Array.from(document.querySelectorAll('[data-dock-node]')); const conv = panes.find(p => p.querySelector('[data-region-pane="region:conversation"]')); const target = conv ?? panes[0]; if (!target) return null; const b = target.querySelector('[data-testid=dock-grip-float]'); if (!b) return null; b.click(); return { cls: String(target.className).slice(0, 40) } })()`)
  console.log('浮动目标:', JSON.stringify(grip))
  await sleep(800)
  let floats = await evalJs('(() => Array.from(document.querySelectorAll("[data-testid=dock-float]")).map(f => { const cs = getComputedStyle(f); return { vis: cs.visibility, pe: cs.pointerEvents } }))()')
  check('浮动窗口已创建', Array.isArray(floats) && floats.length > 0, JSON.stringify(floats))

  // 2. 直接注入 body 标记（模拟设置页打开时 observer 设置的属性）→ 浮动窗口应隐藏
  await evalJs('document.body.setAttribute("data-liuli-settings-open", "")')
  await sleep(300)
  floats = await evalJs('(() => Array.from(document.querySelectorAll("[data-testid=dock-float]")).map(f => { const cs = getComputedStyle(f); return { vis: cs.visibility, pe: cs.pointerEvents } }))()')
  check('设置页标记时浮动窗口 visibility hidden', Array.isArray(floats) && floats.length > 0 && floats.every(f => f.vis === 'hidden' && f.pe === 'none'), JSON.stringify(floats))

  // 3. 移除标记 → 浮动窗口恢复
  await evalJs('document.body.removeAttribute("data-liuli-settings-open")')
  await sleep(300)
  floats = await evalJs('(() => Array.from(document.querySelectorAll("[data-testid=dock-float]")).map(f => { const cs = getComputedStyle(f); return { vis: cs.visibility } }))()')
  check('标记移除后浮动窗口恢复可见', Array.isArray(floats) && floats.length > 0 && floats.every(f => f.vis === 'visible'), JSON.stringify(floats))

  const failed = results.filter(r => !r.pass)
  console.log('SUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' passed')
} catch (e) {
  console.log('V5 ERROR:', e.message)
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch { /* ignore */ }
  try { execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }) } catch { /* ignore */ }
}

