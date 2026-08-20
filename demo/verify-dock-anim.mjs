// 侧边栏收起/展开动画 GUI 自测（advanced 模式）。
// 覆盖用户报告的问题：
//  1) 两个侧边栏（左侧栏收起 rail、右侧详情开合）收起/展开应有平滑过渡；
//  2) 收起/展开时会话页（中间列）应平滑跟随，而非瞬时跳变；
//  3) sash 拖拽期间禁用过渡（跟手）。
// 运行：node demo/verify-dock-anim.mjs [port]
import { spawn, execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9288
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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
  for (const port of [...ports, '10520', '9134', '13532']) {
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

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-dock-anim-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', 'about:blank'], { stdio: 'ignore' })
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
  // 显式导航到 advanced 模式（避免 Chrome 启动竞态/错页）
  await send('Page.enable')
  await send('Page.navigate', { url: BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32' })
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
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 170) : '')) }
const hook = (method, ...args) => evalJs('window.__liuliDockShell__.' + method + '(' + args.map(a => JSON.stringify(a)).join(',') + ')')
const paneRect = (region) => evalJs('(() => { const el = document.querySelector("[data-region-pane=\'' + region + '\']"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()')
const shardTransitions = () => evalJs('(() => { const el = document.querySelector("[data-dock-split] [data-testid=dock-pane]")?.parentElement; if (!el) return null; const cs = getComputedStyle(el); return { transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration } })()')
/** 轮询采样：触发后以 50ms 间隔取 pane 宽度，捕获严格介于 (lo, hi) 的中间态
 * （过渡启动有 React 渲染延迟；错过中间帧则返回 null）。 */
const sampleMidWidth = async (region, lo, hi) => {
  for (let i = 0; i < 14; i++) {
    const rect = await paneRect(region)
    if (rect !== null && rect.w > lo + 1 && rect.w < hi - 1) return rect
    await sleep(50)
  }
  return null
}
/** 轮询采样同一时刻两个 pane 的几何（用于会话跟随断言）。
 * 单个 evalJs 内一次取两个 rect，避免两次 CDP 往返间动画推进造成伪间隙。 */
const samplePair = async (a, b) => {
  for (let i = 0; i < 14; i++) {
    const expr = `(() => {
      const map = {}
      for (const el of document.querySelectorAll('[data-region-pane]')) {
        const r = el.getBoundingClientRect()
        map[el.getAttribute('data-region-pane')] = { x: r.x, y: r.y, w: r.width, h: r.height }
      }
      const ra = map[${JSON.stringify(a)}]
      const rb = map[${JSON.stringify(b)}]
      return ra && rb ? { ra, rb } : null
    })()`
    const pair = await evalJs(expr)
    if (pair !== null && pair.ra.w > 56 + 1 && pair.ra.w < 280 - 1) return { sb: pair.ra, cv: pair.rb }
    await sleep(50)
  }
  return null
}
const frameAttrs = () => evalJs('(() => { const f = document.querySelector("[data-testid=dock-shell]"); if (!f) return null; return { sidebarCollapsed: f.getAttribute("data-sidebar-collapsed"), detailsCollapsed: f.getAttribute("data-details-collapsed"), resizing: document.querySelector("[data-testid=dock-root]")?.getAttribute("data-resizing") ?? null } })()')

try {
  await connect()
  // 初始化较慢（插件变多），轮询等待 dock shell 挂载（最长 45s）
  let mounted = false
  for (let i = 0; i < 45; i++) {
    const hit = await evalJs('document.querySelector("[data-testid=dock-shell]") !== null && !!window.__liuliDockShell__')
    if (hit === true) { mounted = true; break }
    if (i === 2 || i === 10 || i === 20 || i === 30) {
      const diag = await evalJs('({ url: location.href, dock: document.querySelector("[data-testid=dock-shell]") !== null, hook: typeof window.__liuliDockShell__, rootChildren: document.querySelectorAll("#root > *").length, scripts: document.scripts.length })')
      console.log('DIAG[' + i + ']:', JSON.stringify(diag))
    }
    await sleep(1000)
  }

  // A1 基础：dock shell 在场 + shard 带 flex-basis 过渡（动画的根基）
  check('A1 dock shell owns root', mounted, '')
  const tr = await shardTransitions()
  check('A2 shard transitions flex-basis', tr !== null && String(tr.transitionProperty).includes('flex-basis') && tr.transitionDuration.includes('0.3'), JSON.stringify(tr))
  const fa = await frameAttrs()
  check('A3 details collapsed marker present (details closed)', fa !== null && fa.detailsCollapsed !== null, JSON.stringify(fa))

  // A4 左侧边栏收起：展开 280 → 收起 rail 56。轮询采样捕获动画中间态
  // （过渡启动有 React 渲染延迟，固定 90ms 可能错过中间帧）。
  const sbBefore = await paneRect('region:sidebar')
  check('A4 sidebar initially 280', sbBefore !== null && Math.abs(sbBefore.w - 280) < 3, JSON.stringify(sbBefore))
  await hook('toggleSidebar')
  const sbMid = await sampleMidWidth('region:sidebar', 56, 280)
  await sleep(400)
  const sbAfter = await paneRect('region:sidebar')
  check('A5 sidebar collapse animated (mid 56<w<280)', sbMid !== null, JSON.stringify({ before: sbBefore?.w, mid: sbMid, after: sbAfter?.w }))
  check('A6 sidebar collapsed to rail 56', sbAfter !== null && Math.abs(sbAfter.w - 56) < 3, JSON.stringify(sbAfter))
  const fa2 = await frameAttrs()
  check('A7 collapsed marker set', fa2 !== null && fa2.sidebarCollapsed !== null, JSON.stringify(fa2))

  // A8 会话页在侧栏动画期间平滑跟随：采样同一时刻侧栏与会话的几何，
  // 会话左缘应贴着侧栏右缘（同步滑动，无跳变/间隙）
  await hook('toggleSidebar') // 展开回 280
  const follow = await samplePair('region:sidebar', 'region:conversation')
  check('A8 conversation follows during sidebar animation', follow !== null && Math.abs(follow.cv.x - follow.sb.x - follow.sb.w) < 6, JSON.stringify(follow))
  await sleep(400) // 等展开动画完成，避免 A9 中断

  // A9 二次收起动画（往返对称验证）
  await hook('toggleSidebar') // 再收起
  const sbMid2 = await sampleMidWidth('region:sidebar', 56, 280)
  await sleep(400)
  const sbAfter2 = await paneRect('region:sidebar')
  check('A9 sidebar collapse animated (2nd)', sbMid2 !== null, JSON.stringify({ mid: sbMid2, after: sbAfter2?.w }))
  check('A10 sidebar collapsed to rail 56 (2nd)', sbAfter2 !== null && Math.abs(sbAfter2.w - 56) < 3, JSON.stringify(sbAfter2))

  // A11 右侧详情开合动画：0 → 360 → 0，均经过中间态
  const dtBefore = await paneRect('region:details')
  check('A11 details initially collapsed (w<2)', dtBefore !== null && dtBefore.w < 2, JSON.stringify(dtBefore))
  await hook('openDetails')
  const dtMid = await sampleMidWidth('region:details', 0, 360)
  await sleep(400)
  const dtAfter = await paneRect('region:details')
  check('A12 details open animated (mid 0<w<360)', dtMid !== null, JSON.stringify({ mid: dtMid, after: dtAfter?.w }))
  check('A13 details opened to 360', dtAfter !== null && Math.abs(dtAfter.w - 360) < 5, JSON.stringify(dtAfter))
  const fa3 = await frameAttrs()
  check('A14 details expanded marker cleared', fa3 !== null && fa3.detailsCollapsed === null, JSON.stringify(fa3))

  // A15 会话页右缘在详情展开时同步左移（平滑跟随）
  const cvAfterOpen = await paneRect('region:conversation')
  check('A15 conversation shrinks when details open', cvAfterOpen !== null && Math.abs(cvAfterOpen.x + cvAfterOpen.w - dtAfter.x) < 6, JSON.stringify({ cvAfterOpen, dtAfter }))

  await hook('closeDetails')
  const dtMid2 = await sampleMidWidth('region:details', 0, 360)
  await sleep(400)
  const dtAfter2 = await paneRect('region:details')
  check('A16 details close animated (mid 0<w<360)', dtMid2 !== null, JSON.stringify({ mid: dtMid2, after: dtAfter2?.w }))
  check('A17 details collapsed to 0 (kept mounted)', dtAfter2 !== null && dtAfter2.w < 2, JSON.stringify(dtAfter2))

  // A18 sash 拖拽期间禁用过渡（data-resizing）—— 直接验证拖拽起止标记
  const sashProbe = await evalJs('(() => { const sash = document.querySelector("[data-dock-split] [data-testid=dock-sash]"); if (!sash) return null; const r = sash.getBoundingClientRect(); const root = document.querySelector("[data-testid=dock-root]"); sash.dispatchEvent(new PointerEvent("pointerdown", { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true, button: 0, pointerId: 7, pointerType: "mouse" })); const during = root.getAttribute("data-resizing"); window.dispatchEvent(new PointerEvent("pointerup", { clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, pointerId: 7, pointerType: "mouse" })); return { during, after: root.getAttribute("data-resizing") } })()')
  check('A18 sash drag disables transition (data-resizing)', sashProbe !== null && sashProbe.during === '' && sashProbe.after === null, JSON.stringify(sashProbe))

  // A19 无页面报错
  check('A19 no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)))

  const failed = results.filter(r => !r.pass)
  console.log('SUMMARY: ' + String(results.length - failed.length) + '/' + String(results.length) + ' passed')
  if (failed.length > 0) console.log('FAILED: ' + failed.map(x => x.name).join(' | '))
} catch (e) {
  console.log('ANIM VERIFY ERROR:', e.message, JSON.stringify(pageErrors.slice(0, 3)))
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch {}
}
