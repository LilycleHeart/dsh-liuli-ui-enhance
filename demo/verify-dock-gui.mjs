// Dockable Workspace GUI 自测（无头 Chrome + CDP，对照 verify-webview-gui.mjs 模式）。
// 覆盖：打开/布局、添加面板、拖拽拆分、边缘停靠、标签页合并、浮动窗口（拖动/缩放/回收）、
//       sash 缩放、保存/重置/恢复槽位、页面刷新恢复、导出/导入、关闭、HMR 存活、页面零报错。
// 运行：node demo/verify-dock-gui.mjs [port]
import { spawn, execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9242
const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function detectBase() {
  if (process.argv[2]) return 'http://127.0.0.1:' + process.argv[2]
  // 自动探测 DSH Desktop 监听端口（重启后端口会变化）
  let ports = []
  try {
    const { execSync } = await import('node:child_process')
    const out = execSync('powershell -NoProfile -Command "Get-Process \"DSH Desktop\" -ErrorAction SilentlyContinue | ForEach-Object { Get-NetTCPConnection -State Listen -OwningProcess $_.Id -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty LocalPort"', { encoding: 'utf8', timeout: 15000 })
    ports = out.split(/\r?\n/).map(s => s.trim()).filter(s => /^[0-9]+$/.test(s))
  } catch { /* fallback candidates */ }
  for (const port of [...ports, '14988', '10205', '7336']) {
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

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-dock-gui-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', BASE + '/?dsh-desktop-mode=compatibility&dsh-desktop-platform=win32'], { stdio: 'ignore' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let ws = null, sendId = 0
const pending = new Map()
const pageErrors = []

async function connect() {
  let list = []
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json')).json(); if (list.some(t => t.type === 'page')) break } catch { /* retry */ }
    await sleep(500)
  }
  const target = list.find(t => t.type === 'page')
  if (!target) throw new Error('no page target')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description ?? 'unknown')
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
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 160) : '')) }

/* React 受控输入赋值（原生 setter + 派发事件） */
const setInput = (selector, value) => evalJs(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return false
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)

/* 拖拽：从 selector 元素中心拖到视口坐标 (x, y) */
async function dragTo(selector, x, y, steps = 12) {
  const rect = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  if (!rect || rect.__err) return false
  const down = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) return false
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: ${rect.x}, clientY: ${rect.y}, bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse' }))
    return true
  })()`
  await evalJs(down)
  await sleep(60)
  for (let i = 1; i <= steps; i++) {
    const cx = rect.x + (x - rect.x) * i / steps
    const cy = rect.y + (y - rect.y) * i / steps
    await evalJs(`window.dispatchEvent(new PointerEvent('pointermove', { clientX: ${cx}, clientY: ${cy}, bubbles: true, pointerId: 1, pointerType: 'mouse' }))`)
    await sleep(16)
  }
  await evalJs(`window.dispatchEvent(new PointerEvent('pointerup', { clientX: ${x}, clientY: ${y}, bubbles: true, pointerId: 1, pointerType: 'mouse' }))`)
  await sleep(400)
  return true
}

const summary = () => evalJs(`(() => { const el = document.querySelector('[data-testid="dock-summary"]'); return el ? JSON.parse(el.textContent) : null })()`)
const rects = () => evalJs(`(() => Array.from(document.querySelectorAll('[data-dock-node]')).map(el => { const r = el.getBoundingClientRect(); return { id: el.getAttribute('data-dock-node'), x: r.x, y: r.y, w: r.width, h: r.height, tabs: el.querySelectorAll('[data-testid="dock-tab-chip"]').length } }))()`)

try {
  await connect()
  await sleep(12000)

  // D1 打开工作台（Ctrl+Alt+W 快捷键）
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', ctrlKey: true, altKey: true, bubbles: true }))`)
  await sleep(800)
  check('D1 workspace opens via shortcut', await evalJs('document.querySelector("[data-testid=dock-workspace]") !== null'))
  let s = await summary()
  check('D1b default layout = 3 panels / 2 groups / h-split root', s && s.panels === 3 && s.groups === 2 && s.rootKind === 'split' && s.floats === 0, JSON.stringify(s))

  // D2 添加便签面板（添加菜单）
  await evalJs('document.querySelector("[data-testid=dock-add-button]").click()')
  await sleep(300)
  check('D2 add menu opens', await evalJs('document.querySelector("[data-testid=dock-add-menu]") !== null'))
  await evalJs('document.querySelector("[data-testid=dock-add-notes]").click()')
  await sleep(400)
  s = await summary()
  check('D2b notes added (4 panels)', s && s.panels === 4, JSON.stringify(s))
  check('D2c notes textarea rendered', await evalJs('document.querySelector("[data-testid=dock-notes-textarea]") !== null'))

  // D3 把便签拖到最左面板右缘 → 垂直拆分条（split）
  let panes = await rects()
  const leftPane = panes[0]
  const notesChip = await evalJs(`(() => Array.from(document.querySelectorAll('[data-testid="dock-tab-chip"]')).find(el => el.textContent.includes('便签'))?.getAttribute('data-panel-id'))()`)
  check('D3 notes chip found', typeof notesChip === 'string', String(notesChip))
  await dragTo('[data-panel-id="' + notesChip + '"]', leftPane.x + leftPane.w * 0.92, leftPane.y + leftPane.h / 2)
  s = await summary()
  check('D3 drag to pane edge splits (3 groups)', s && s.groups === 3 && s.panels === 4, JSON.stringify(s))

  // D4 把 wiki 拖到 git 面板下缘 → 上下拆分
  panes = await rects()
  const gitPane = panes.find(p => p.id !== leftPane.id && p.tabs >= 2) ?? panes[panes.length - 1]
  const wikiChip = await evalJs(`(() => Array.from(document.querySelectorAll('[data-testid="dock-tab-chip"]')).find(el => el.textContent.includes('Wiki'))?.getAttribute('data-panel-id'))()`)
  check('D4 wiki chip found', typeof wikiChip === 'string', String(wikiChip))
  await dragTo('[data-panel-id="' + wikiChip + '"]', gitPane.x + gitPane.w / 2, gitPane.y + gitPane.h * 0.93)
  s = await summary()
  check('D4b vertical split created (4 groups)', s && s.groups === 4 && s.panels === 4, JSON.stringify(s))

  // D5 把 wiki 拖回 git 面板中心 → 标签页合并
  const gitPaneId = await evalJs(`(() => { const chip = Array.from(document.querySelectorAll('[data-testid="dock-tab-chip"]')).find(el => el.textContent.includes('Git')); return chip?.closest('[data-dock-node]')?.getAttribute('data-dock-node') })()`)
  const gitRect = (await rects()).find(p => p.id === gitPaneId)
  await dragTo('[data-panel-id="' + wikiChip + '"]', gitRect.x + gitRect.w / 2, gitRect.y + gitRect.h / 2)
  s = await summary()
  check('D5 tab merge: wiki back with git (3 groups)', s && s.groups === 3 && s.panels === 4, JSON.stringify(s))
  check('D5b merged strip has 2 chips', (await rects()).find(p => p.id === gitPaneId)?.tabs === 2)

  // D6 把便签拖到顶部工具栏（空白区）→ 浮动窗口
  const topbar = await evalJs(`(() => { const r = document.querySelector('[data-testid="dock-topbar"]').getBoundingClientRect(); return { x: r.x + r.width * 0.55, y: r.y + r.height / 2 } })()`)
  await dragTo('[data-panel-id="' + notesChip + '"]', topbar.x, topbar.y)
  s = await summary()
  check('D6 float created', s && s.floats === 1, JSON.stringify(s))
  const floatBox = await evalJs(`(() => { const el = document.querySelector('[data-testid="dock-float"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
  check('D6b float window rendered', floatBox !== null && floatBox.w > 100, JSON.stringify(floatBox))

  // D7 拖动浮动窗口标题栏（移到视口内安全区域，为缩放留空间）
  await dragTo('[data-testid="dock-float-title"]', 420, 210)
  const moved = await evalJs(`(() => { const el = document.querySelector('[data-testid="dock-float"]'); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y } })()`)
  check('D7 float moved', moved && Math.abs(moved.x - floatBox.x) + Math.abs(moved.y - floatBox.y) > 40, JSON.stringify({ from: floatBox, to: moved }))

  // D7b 缩放浮动窗口（从右下角手柄向外拖：起点=手柄位置，目标=手柄+delta，保持不超视口）
  const curBox = await evalJs(`(() => { const el = document.querySelector('[data-testid="dock-float"]'); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`)
  const handle = { x: curBox.x + curBox.w - 9, y: curBox.y + curBox.h - 9 }
  await dragTo('[data-testid="dock-float-resize"]', handle.x + 140, handle.y + 80)
  const resized = await evalJs(`(() => { const el = document.querySelector('[data-testid="dock-float"]'); const r = el.getBoundingClientRect(); return { w: r.width, h: r.height } })()`)
  check('D7c float resized', resized && resized.w > curBox.w + 60 && resized.h > curBox.h + 40, JSON.stringify({ before: curBox, after: resized }))

  // D8 浮动窗口停靠回工作区
  await evalJs('document.querySelector("[data-testid=dock-float-dock]").click()')
  await sleep(400)
  s = await summary()
  check('D8 float docked back', s && s.floats === 0 && s.panels === 4, JSON.stringify(s))

  // D9 sash 拖拽缩放（根分割线右移 120px）
  const before = await rects()
  const sashTarget = await evalJs(`(() => { const el = document.querySelector('[data-dock-split]')?.querySelector(':scope > [data-testid="dock-sash"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  check('D9 root sash found', sashTarget !== null && !sashTarget?.__err, JSON.stringify(sashTarget))
  await evalJs(`(() => {
    const el = document.querySelector('[data-dock-split]')?.querySelector(':scope > [data-testid="dock-sash"]')
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: ${sashTarget.x}, clientY: ${sashTarget.y}, bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: 'mouse' }))
    return true
  })()`)
  for (let i = 1; i <= 10; i++) {
    await evalJs(`window.dispatchEvent(new PointerEvent('pointermove', { clientX: ${sashTarget.x + 12 * i}, clientY: ${sashTarget.y}, bubbles: true, pointerId: 1, pointerType: 'mouse' }))`)
    await sleep(20)
  }
  await evalJs(`window.dispatchEvent(new PointerEvent('pointerup', { clientX: ${sashTarget.x + 120}, clientY: ${sashTarget.y}, bubbles: true, pointerId: 1, pointerType: 'mouse' }))`)
  await sleep(400)
  const after = await rects()
  const grew = after[0] && before[0] && after[0].w > before[0].w + 60
  check('D9 sash drag resizes panes', grew, JSON.stringify({ before: before[0]?.w, after: after[0]?.w }))

  // D10 保存槽位 → 重置 → 恢复
  await setInput('[data-testid="dock-slot-name"]', 'selftest')
  await evalJs('document.querySelector("[data-testid=dock-save-button]").click()')
  await sleep(300)
  const saved = await summary()
  await evalJs('document.querySelector("[data-testid=dock-reset-button]").click()')
  await sleep(400)
  s = await summary()
  check('D10 reset returns default layout', s && s.panels === 3 && s.groups === 2, JSON.stringify(s))
  await evalJs(`(() => { const sel = document.querySelector('[data-testid="dock-slot-select"]'); sel.value = 'selftest'; return sel.value })()`)
  await evalJs('document.querySelector("[data-testid=dock-restore-button]").click()')
  await sleep(400)
  s = await summary()
  check('D10b restore slot returns saved layout', s && JSON.stringify(s) === JSON.stringify(saved), JSON.stringify({ saved, restored: s }))

  // D11 页面刷新后自动恢复（开合 + 布局均持久化）
  await send('Page.navigate', { url: BASE + '/?dsh-desktop-mode=compatibility&dsh-desktop-platform=win32' })
  await sleep(12000)
  check('D11 workspace auto-reopens after reload', await evalJs('document.querySelector("[data-testid=dock-workspace]") !== null'))
  s = await summary()
  check('D11b layout restored after reload', s && JSON.stringify(s) === JSON.stringify(saved), JSON.stringify(s))

  // D12 导出 → 导入
  await evalJs('document.querySelector("[data-testid=dock-export-button]").click()')
  await sleep(300)
  const exported = await evalJs('document.querySelector("[data-testid=dock-modal-text]")?.value ?? null')
  check('D12 export JSON', typeof exported === 'string' && exported.includes('"root"') && exported.includes('notes'), String(exported).slice(0, 80))
  await evalJs('document.querySelector("[data-testid=dock-modal-close]").click()')
  await sleep(200)
  await evalJs('document.querySelector("[data-testid=dock-reset-button]").click()')
  await sleep(300)
  await evalJs('document.querySelector("[data-testid=dock-import-button]").click()')
  await sleep(200)
  await evalJs(`(() => { const ta = document.querySelector('[data-testid="dock-modal-text"]'); Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, ${JSON.stringify(exported ?? '{}')}); ta.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
  await evalJs('document.querySelector("[data-testid=dock-modal-apply]").click()')
  await sleep(400)
  s = await summary()
  check('D12b import restores exported layout', s && JSON.stringify(s) === JSON.stringify(saved), JSON.stringify(s))

  // D13 关闭工作台
  await evalJs('document.querySelector("[data-testid=dock-close-button]").click()')
  await sleep(400)
  check('D13 workspace closed', await evalJs('document.querySelector("[data-testid=dock-workspace]") === null'))

  // D14 重新打开后热重载存活：保持页面无刷新，重新构建 → HMR 重载插件 → 工作台带原布局回归
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', ctrlKey: true, altKey: true, bubbles: true }))`)
  await sleep(600)
  const preHmr = await summary()
  execSync('pnpm bundle', { cwd: PKG_DIR, stdio: 'ignore', timeout: 120000 })
  console.log('rebuild triggered; waiting for HMR...')
  let hmrOk = false
  for (let i = 0; i < 16; i++) {
    await sleep(1500)
    const present = await evalJs('document.querySelector("[data-testid=dock-workspace]") !== null')
    if (present === true) { const cur = await summary(); if (cur && JSON.stringify(cur) === JSON.stringify(preHmr)) { hmrOk = true; break } }
  }
  check('D14 hot reload: workspace survives rebuild without page refresh', hmrOk, JSON.stringify(preHmr))

  // D15 页面零报错
  const dockErrors = pageErrors.filter(e => !/Could not load|favicon/i.test(String(e)))
  check('D15 no page errors', dockErrors.length === 0, JSON.stringify(dockErrors.slice(0, 3)))

  const failed = results.filter(r => !r.pass)
  console.log('SUMMARY: ' + String(results.length - failed.length) + '/' + String(results.length) + ' passed')
  if (failed.length > 0) console.log('FAILED: ' + failed.map(x => x.name).join(' | '))
} catch (e) {
  console.log('GUI VERIFY ERROR:', e.message, JSON.stringify(pageErrors.slice(0, 3)))
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch { /* ignore */ }
}
