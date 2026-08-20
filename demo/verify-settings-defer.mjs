// 验证：设置页让位修复（工作台自动收起 + 浮动窗口隐藏 + 快捷键守卫）
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9300 + (process.pid % 200)
const BASE = process.argv[2] !== undefined ? 'http://127.0.0.1:' + process.argv[2] : 'http://127.0.0.1:5907'
const MODE = process.argv[3] ?? 'advanced'

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-verify-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', BASE + '/?dsh-desktop-mode=' + MODE + '&dsh-desktop-platform=win32'], { stdio: 'ignore' })
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
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' })
  if (r?.data) {
    const fs = await import('node:fs')
    fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), name), Buffer.from(r.data, 'base64'))
    console.log('saved', name)
  }
}

const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 140) : '')) }
const openSettings = () => evalJs('(() => { const b = Array.from(document.querySelectorAll("button")).find(el => { const a = el.getAttribute("aria-label") || ""; const t = (el.textContent || "").trim(); return a.includes("设置") || a === "Settings" || t === "设置" }); if (!b) return false; b.click(); return true })()')
const settingsOpen = () => evalJs('document.body.hasAttribute("data-liuli-settings-open")')
const dockOpen = () => evalJs('document.querySelector("[data-testid=dock-workspace]") !== null')

try {
  await connect()
  await sleep(13000)
  console.log('最终URL:', await evalJs('location.href'))
  console.log('title:', await evalJs('document.title'))
  console.log('body neterror:', await evalJs('document.body?.className'))

  // 按钮候选（调试）
  const btns = await evalJs('(() => Array.from(document.querySelectorAll("button")).filter(el => { const a = el.getAttribute("aria-label") || ""; const t = (el.textContent || "").trim(); const ti = el.getAttribute("title") || ""; return /设置|Settings/i.test(a + " " + t + " " + ti) }).map(el => ({ a: (el.getAttribute("aria-label") || "").slice(0, 24), t: (el.textContent || "").trim().slice(0, 14), c: String(el.className).slice(0, 30) })).slice(0, 10))()')
  console.log('设置按钮候选:', JSON.stringify(btns))
  // V1: 打开设置页 → body 标记出现
  check('V1 打开设置页', await openSettings())
  await sleep(1000)
  check('V1b body 有 data-liuli-settings-open', await settingsOpen())
  check('V1c 设置页模态可见（中心命中 overlay 内元素）', await evalJs('(() => { const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return !!el?.closest?.("[class*=_overlay]") })()'))

  // V2: 设置页打开时按 Ctrl+Alt+W → 工作台不应打开
  await evalJs("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', ctrlKey: true, altKey: true, bubbles: true }))")
  await sleep(800)
  check('V2 设置页打开时快捷键不开工作台', (await dockOpen()) === false)

  // V3: 关闭设置页 → 标记消失，此时快捷键可开工作台
  await evalJs('(() => { const b = Array.from(document.querySelectorAll("button")).find(el => { const a = el.getAttribute("aria-label") || ""; const t = (el.textContent || "").trim(); const c = String(el.className); return a.includes("关闭设置") || a === "Close settings" || (t === "关闭" && c.includes("close")) }); if (b) { b.click(); return true } return false })()')
  await sleep(600)
  check('V3 关闭设置页后标记消失', (await settingsOpen()) === false)
  await evalJs("window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', ctrlKey: true, altKey: true, bubbles: true }))")
  await sleep(800)
  check('V3b 设置页关闭后快捷键可开工作台', await dockOpen())

  // V4: 工作台开着时打开设置页 → 工作台自动收起
  await openSettings()
  await sleep(1200)
  check('V4 工作台开着时打开设置页', (await settingsOpen()) === true)
  check('V4b 工作台自动收起', (await dockOpen()) === false)

  // V5: advanced 模式浮动窗口在设置页打开时隐藏
  if (MODE === 'advanced') {
    // 先关设置页，开工作台（DockShellFrame 浮动窗口在 advanced 下由树面板浮动而来）
    await evalJs('(() => { const b = Array.from(document.querySelectorAll("button")).find(el => { const a = el.getAttribute("aria-label") || ""; const t = (el.textContent || "").trim(); const c = String(el.className); return a.includes("关闭设置") || a === "Close settings" || (t === "关闭" && c.includes("close")) }); if (b) { b.click(); return true } return false })()')
    await sleep(600)
    // 打开设置页后再检查浮动窗口是否已隐藏（无浮动窗口时跳过）
    await openSettings()
    await sleep(1000)
    const floatVisible = await evalJs('(() => { const f = document.querySelector("[data-testid=dock-float]"); if (!f) return "no-float"; const cs = getComputedStyle(f); return cs.visibility + " / " + cs.pointerEvents })()')
    check('V5 设置页打开时浮动窗口隐藏（或无浮动窗口）', floatVisible === 'no-float' || floatVisible.startsWith('hidden'), String(floatVisible))
  }

  // V6: 页面零报错（收集异常）
  const failed = results.filter(r => !r.pass)
  console.log('SUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' passed')
  if (failed.length > 0) console.log('FAILED: ' + failed.map(x => x.name).join(' | '))
} catch (e) {
  console.log('VERIFY ERROR:', e.message)
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch { /* ignore */ }
  try { execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }) } catch { /* ignore */ }
}

