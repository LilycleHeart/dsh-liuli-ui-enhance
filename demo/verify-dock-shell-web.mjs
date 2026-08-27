// Dockable Shell Web UI 自测：纯浏览器（无 ?dsh-desktop-mode 参数）访问 DSH
// Web 服务，验证琉璃 dock 壳在 Web UI 下挂载并可用：
//  - 挂载与 Web 壳样式（WEB_DOCK_SHELL_CSS：帧网格 / 表面透明 / 别名类）；
//  - 宿主布局动作重定向（ctx.layout.toggleSidebar → 琉璃 store → 侧栏收展）；
//  - 详情开合（ctx.layout.openDetails/closeDetails → 详情 shard 宽度过渡）；
//  - sash 拖拽 / 窄视口 narrow 监视（<1024 自动收起侧栏）；
//  - advanced 回归：同浏览器切到 ?dsh-desktop-mode=advanced 后 dock 仍正常。
// 使用独立 --user-data-dir（隔离 localStorage），不污染用户真实布局。
import { spawn, execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9263

async function detectBase() {
  if (process.argv[2]) return 'http://127.0.0.1:' + process.argv[2]
  const pids = new Set()
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq DSH Desktop.exe" /FO CSV /NH', { encoding: 'utf8', timeout: 15000 })
    for (const line of out.split(/\r?\n/)) { const m = /"(\d+)"/.exec(line); if (m) pids.add(m[1]) }
  } catch { /* ignore */ }
  const ports = []
  try {
    const out = execSync('netstat -ano -p TCP', { encoding: 'utf8', timeout: 15000 })
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue
      const parts = line.trim().split(/\s+/)
      if (!pids.has(parts[4] ?? '')) continue
      const port = (parts[1] ?? '').split(':').pop()
      if (port && /^[0-9]+$/.test(port)) ports.push(port)
    }
  } catch { /* ignore */ }
  for (const port of [...ports, '9134', '13532', '43120']) {
    try {
      const resp = await fetch('http://127.0.0.1:' + port + '/', { signal: AbortSignal.timeout(2000) })
      const text = await resp.text()
      if (text.includes('__DSH_BOOT__')) return 'http://127.0.0.1:' + port
    } catch { /* next */ }
  }
  throw new Error('no DSH host found')
}
const BASE = await detectBase()
console.log('host: ' + BASE)

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-dockweb-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let ws = null, sendId = 0
const pending = new Map()
const pageErrors = []
async function connect() {
  let list = []
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json')).json(); if (list.some(t => t.type === 'page')) break } catch {}
    await sleep(500)
  }
  const t = list.find(t => t.type === 'page')
  if (!t) throw new Error('no page target')
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(String(m.params.exceptionDetails?.exception?.description ?? 'x').slice(0, 160))
  }
  await send('Runtime.enable')
  await send('Page.enable')
  // Web UI：不带 dsh-desktop-mode 参数（兼容模式 / 纯浏览器）
  await send('Page.navigate', { url: BASE + '/' })
}
function send(method, params = {}) {
  return new Promise((res, rej) => { const id = ++sendId; pending.set(id, { res, rej }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' timeout')) } }, 30000); ws.send(JSON.stringify({ id, method, params })) })
}
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 200) }
  return r?.result?.value
}
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 150) : '')) }
const summary = () => evalJs('(() => { const el = document.querySelector("[data-testid=dock-summary]"); return el ? JSON.parse(el.textContent) : null })()')
const hook = (method, ...args) => evalJs('window.__liuliDockShell__.' + method + '(' + args.map(a => JSON.stringify(a)).join(',') + ')')
const paneRect = (region) => evalJs('(() => { const el = document.querySelector("[data-region-pane=\'' + region + '\']"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()')
async function waitMounted(withHook = true) {
  for (let i = 0; i < 45; i++) {
    const hit = await evalJs('document.querySelector("[data-testid=dock-shell]") !== null' + (withHook ? ' && !!window.__liuliDockShell__' : ''))
    if (hit === true) return true
    await sleep(1000)
  }
  return false
}

try {
  await connect()
  // W1 Web UI 下 dock 壳挂载 + Web 标记
  const mounted = await waitMounted()
  check('W1 dock shell mounts on web UI', mounted)
  check('W1b web shell mode marked', await evalJs('document.querySelector("[data-testid=dock-shell]")?.getAttribute("data-shell-mode")') === 'web')
  let s = await summary()
  check('W2 default layout (sidebar/header/conversation/details)', s && s.panels === 4 && s.groups === 4 && s.rootKind === 'split', JSON.stringify(s))

  // W3 Web 壳样式生效（帧网格 + 表面透明去分割线）
  const shellCss = await evalJs('(() => { const f = document.querySelector("[data-testid=dock-shell]"); const sb = document.querySelector(".dshDesktopSidebarSurface"); if (!f || !sb) return null; const fs = getComputedStyle(f); const ss = getComputedStyle(sb); return { display: fs.display, h: Math.round(parseFloat(fs.height)), sbBg: ss.backgroundColor, sbBorder: ss.borderRightWidth } })()')
  check('W3a frame is full-size grid', shellCss !== null && shellCss.display === 'grid' && shellCss.h >= 900, JSON.stringify(shellCss))
  check('W3b sidebar surface transparent / no divider', shellCss !== null && shellCss.sbBg === 'rgba(0, 0, 0, 0)' && Number(shellCss.sbBorder) === 0, JSON.stringify(shellCss))

  // W4 别名类挂到琉璃帧（主题配方 [class*=_frame] 等可命中）
  check('W4 alias classes on web frame', await evalJs('(() => { const f = document.querySelector("[data-testid=dock-shell]"); return !!f && f.classList.contains("liuli_frame") && !!document.querySelector(".dshDesktopSidebarSurface.liuli_sidebarCol") && !!document.querySelector(".dshDesktopConversationSurface.liuli_centerCol") && !!document.querySelector(".dshDesktopDetailsSurface.liuli_detailsCol") })()') === true)

  // W5 宿主布局动作重定向：ctx.layout.toggleSidebar（钩子内调用）驱动琉璃 store
  await hook('toggleSidebar')
  await sleep(700)
  let sb = await paneRect('region:sidebar')
  check('W5a external toggle collapses sidebar (rail 56)', sb !== null && Math.abs(sb.w - 56) < 4, JSON.stringify(sb))
  await hook('toggleSidebar')
  await sleep(700)
  sb = await paneRect('region:sidebar')
  check('W5b external toggle restores sidebar (280)', sb !== null && Math.abs(sb.w - 280) < 4, JSON.stringify(sb))

  // W6 详情开合联动（openDetails/closeDetails → 详情 shard 0↔360）
  await hook('openDetails')
  await sleep(700)
  let dt = await paneRect('region:details')
  check('W6a openDetails expands details pane (>300)', dt !== null && dt.w > 300, JSON.stringify(dt))
  await hook('closeDetails')
  await sleep(700)
  dt = await paneRect('region:details')
  check('W6b closeDetails collapses details pane (kept mounted)', dt !== null && dt.w < 2, JSON.stringify(dt))

  // W7 sash 拖拽（侧栏|会话 分界，右拖加宽侧栏，提交走宿主 setSidebar clamp 264..420）
  const sash = await evalJs('(() => { const el = document.querySelector("[data-dock-split] [data-testid=dock-sash]"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()')
  check('W7 sash found', sash !== null && !sash?.__err, JSON.stringify(sash))
  if (sash && !sash.__err) {
    await evalJs('(() => { const el = document.querySelector("[data-dock-split] [data-testid=dock-sash]"); el.dispatchEvent(new PointerEvent("pointerdown", { clientX: ' + sash.x + ', clientY: ' + sash.y + ', bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse" })); return true })()')
    for (let i = 1; i <= 10; i++) { await evalJs('window.dispatchEvent(new PointerEvent("pointermove", { clientX: ' + (sash.x + 12 * i) + ', clientY: ' + sash.y + ', bubbles: true, pointerId: 1, pointerType: "mouse" }))'); await sleep(20) }
    await evalJs('window.dispatchEvent(new PointerEvent("pointerup", { clientX: ' + (sash.x + 120) + ', clientY: ' + sash.y + ', bubbles: true, pointerId: 1, pointerType: "mouse" }))')
    await sleep(600)
    sb = await paneRect('region:sidebar')
    check('W7b sash drag widens sidebar (clamped <=420)', sb !== null && sb.w > 300 && sb.w <= 421, JSON.stringify(sb))
  }

  // W8 窄视口 narrow 监视（<1024 自动收起侧栏；恢复宽度后展开）
  await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(700)
  const narrowCollapsed = await evalJs('(() => { const f = document.querySelector("[data-testid=dock-shell]"); return f !== null && f.hasAttribute("data-sidebar-collapsed") })()')
  check('W8a narrow viewport auto-collapses sidebar', narrowCollapsed === true)
  await send('Emulation.clearDeviceMetricsOverride', {})
  await sleep(700)
  const wideRestored = await evalJs('(() => { const f = document.querySelector("[data-testid=dock-shell]"); return f !== null && !f.hasAttribute("data-sidebar-collapsed") })()')
  check('W8b widening restores sidebar', wideRestored === true)

  // W9 advanced 回归：同浏览器切到 advanced URL，dock 仍正常（原生壳样式路径）
  await evalJs('Object.keys(localStorage).filter(k => k.startsWith("liuli.dockshell")).forEach(k => localStorage.removeItem(k))')
  await send('Page.navigate', { url: BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32' })
  await sleep(1500)
  const advMounted = await waitMounted()
  check('W9 dock shell still mounts in advanced shell', advMounted)
  check('W9b advanced frame unmarked (native styles path)', await evalJs('document.querySelector("[data-testid=dock-shell]")?.getAttribute("data-shell-mode")') === null)
  await hook('reset')
  await sleep(500)
  sb = await paneRect('region:sidebar')
  check('W9c advanced sidebar geometry intact', sb !== null && Math.abs(sb.w - 280) < 4, JSON.stringify(sb))
  await hook('openDetails')
  await sleep(700)
  dt = await paneRect('region:details')
  check('W9d advanced openDetails works (desktop layout service)', dt !== null && dt.w > 300, JSON.stringify(dt))

  const failed = results.filter(r => !r.pass)
  console.log('SUMMARY: ' + String(results.length - failed.length) + '/' + String(results.length) + ' passed')
  if (failed.length > 0) console.log('FAILED: ' + failed.map(x => x.name).join(' | '))
} catch (e) {
  console.log('WEB VERIFY ERROR:', e.message, JSON.stringify(pageErrors.slice(0, 3)))
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch {}
}
