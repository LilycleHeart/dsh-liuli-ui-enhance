// Dockable Shell GUI 自测（视觉零侵入版）。驱动方式：
//  - 面板增删/布局保存恢复/导出导入 → window.__liuliDockShell__ 钩子；
//  - 拖拽/拆分/停靠/浮动/合并/sash → 指针事件（拖把手 = 单区域 grip 或多标签 chip）。
// 使用独立 --user-data-dir（隔离 localStorage），不会污染用户真实布局。
import { spawn, execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9260
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
  for (const port of [...ports, '9134', '13532']) {
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

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-dockshell-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', 'about:blank'], { stdio: 'ignore' })
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
  // 显式导航（spawn 带 URL 存在页面 target 竞态，可能连到空白页）
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
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 150) : '')) }

/* 从 selector 元素中心拖到视口坐标 (x,y) */
async function dragTo(selector, x, y, steps = 12) {
  const rect = await evalJs('(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()')
  if (!rect || rect.__err) return false
  await evalJs('(() => { const el = document.querySelector(' + JSON.stringify(selector) + '); el.dispatchEvent(new PointerEvent("pointerdown", { clientX: ' + rect.x + ', clientY: ' + rect.y + ', bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse" })); return true })()')
  await sleep(60)
  for (let i = 1; i <= steps; i++) {
    const cx = rect.x + (x - rect.x) * i / steps
    const cy = rect.y + (y - rect.y) * i / steps
    await evalJs('window.dispatchEvent(new PointerEvent("pointermove", { clientX: ' + cx + ', clientY: ' + cy + ', bubbles: true, pointerId: 1, pointerType: "mouse" }))')
    await sleep(16)
  }
  await evalJs('window.dispatchEvent(new PointerEvent("pointerup", { clientX: ' + x + ', clientY: ' + y + ', bubbles: true, pointerId: 1, pointerType: "mouse" }))')
  await sleep(400)
  return true
}
const summary = () => evalJs('(() => { const el = document.querySelector("[data-testid=dock-summary]"); return el ? JSON.parse(el.textContent) : null })()')
const hook = (method, ...args) => evalJs('window.__liuliDockShell__.' + method + '(' + args.map(a => JSON.stringify(a)).join(',') + ')')
const paneRect = (region) => evalJs('(() => { const el = document.querySelector("[data-region-pane=\'' + region + '\']"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()')
const chipSelByLabel = (label) => evalJs('(() => { const c = Array.from(document.querySelectorAll("[data-testid=dock-tab-chip]")).find(el => el.textContent.includes(' + JSON.stringify(label) + ')); return c ? "[data-panel-id=\'" + c.getAttribute("data-panel-id") + "\']" : null })()')

try {
  await connect()
  // 初始化较慢（插件变多），轮询等待 dock shell 挂载
  let mounted = false
  for (let i = 0; i < 45; i++) {
    const hit = await evalJs('document.querySelector("[data-testid=dock-shell]") !== null && !!window.__liuliDockShell__')
    if (hit === true) { mounted = true; break }
    await sleep(1000)
  }

  // S1 视觉零侵入：dock shell 接管 root，但无自定义工具栏/菜单，默认
  // [侧栏 | (会话标题+会话) | 详情]，详情面板常驻（宽度 0 保持挂载）
  check('S1 dock shell owns root', mounted)
  let s = await summary()
  check('S1b default layout (sidebar/header/conversation/details)', s && s.panels === 4 && s.groups === 4 && s.rootKind === 'split', JSON.stringify(s))
  check('S1c no always-on toolbar', await evalJs('document.querySelector("[data-testid=dock-topbar]") === null'))
  check('S1d menu hidden by default', await evalJs('document.querySelector("[data-testid=dock-menu-card]") === null'))
  const sb = await paneRect('region:sidebar')
  const cv = await paneRect('region:conversation')
  check('S1e native geometry (sidebar 280, conversation fills)', sb && cv && Math.abs(sb.w - 280) < 2 && Math.abs(cv.x - 280) < 2, JSON.stringify({ sb, cv }))

  // S2 加便签（进会话组，成多标签）
  await hook('addPanel', 'notes')
  await sleep(400)
  s = await summary()
  check('S2 notes added (details group, 5 panels / 4 groups)', s && s.panels === 5 && s.groups === 4, JSON.stringify(s))
  check('S2b notes rendered', await evalJs('document.querySelector("[data-testid=dock-notes-textarea]") !== null'))

  // S3 便签 chip 拖到侧栏右缘 → 拆分
  const notesChip = await chipSelByLabel('便签')
  check('S3 notes chip found', typeof notesChip === 'string', String(notesChip))
  const sbRect = await paneRect('region:sidebar')
  await dragTo(notesChip, sbRect.x + sbRect.w * 0.93, sbRect.y + sbRect.h / 2)
  s = await summary()
  check('S3b drag to edge splits (5 groups)', s && s.groups === 5 && s.panels === 5, JSON.stringify(s))

  // S4 会话区域（单区域=grip）拖到便签面板下缘 → 垂直拆分
  const convGrip = '[data-region-pane="region:conversation"] [data-testid="dock-grip"]'
  const notesPane = await evalJs('(() => { const chip = Array.from(document.querySelectorAll("[data-testid=dock-tab-chip]")).find(el => el.textContent.includes("便签")); const pane = chip?.closest("[data-dock-node]"); if (!pane) return null; const r = pane.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()')
  check('S4 notes pane located', notesPane !== null && !notesPane?.__err, JSON.stringify(notesPane))
  await dragTo(convGrip, notesPane.x + notesPane.w / 2, notesPane.y + notesPane.h * 0.93)
  await sleep(300)
  s = await summary()
  // 垂直堆叠判定：会话面板顶边应低于便签面板中线
  const stackCheck = await evalJs('(() => { const np = document.querySelector("[data-testid=dock-tab-chip]"); const notesPaneEl = Array.from(document.querySelectorAll("[data-testid=dock-tab-chip]")).find(el => el.textContent.includes("便签"))?.closest("[data-dock-node]"); const convEl = document.querySelector("[data-region-pane=\'region:conversation\']"); if (!notesPaneEl || !convEl) return null; const nr = notesPaneEl.getBoundingClientRect(); const cr = convEl.getBoundingClientRect(); return { notesMidY: nr.y + nr.height / 2, convTopY: cr.y } })()')
  check('S4b v-split (conversation stacked below notes)', s && s.panels === 5 && stackCheck && stackCheck.convTopY > stackCheck.notesMidY - 4, JSON.stringify({ s, stackCheck }))

  // S5 便签 chip（非区域单面板仍有标签条）拖回会话面板中心 → 标签合并
  const notesChip2 = await chipSelByLabel('便签')
  const convPane = await paneRect('region:conversation')
  check('S5 handles located', typeof notesChip2 === 'string' && convPane !== null, JSON.stringify({ notesChip2, convPane }))
  await dragTo(notesChip2, convPane.x + convPane.w / 2, convPane.y + convPane.h / 2)
  await sleep(300)
  s = await summary()
  check('S5b tab merge (groups shrink to 4)', s && s.groups === 4 && s.panels === 5, JSON.stringify(s))

  // S6 侧栏一键浮动按钮（⧉）→ 浮动（无边框改造后 caption 拖拽悬浮区已移除，
  //    改用 grip 簇里的显式浮动入口）
  await evalJs('document.querySelector("[data-testid=dock-grip-float]").click()')
  await sleep(300)
  s = await summary()
  check('S6 sidebar floated', s && s.floats === 1 && s.groups === 3, JSON.stringify(s))
  const floatBox = await evalJs('(() => { const el = document.querySelector("[data-testid=dock-float]"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()')
  check('S6b float window rendered', floatBox !== null && floatBox.w > 100, JSON.stringify(floatBox))

  // S7 浮动窗口移动 + 缩放
  await dragTo('[data-testid="dock-float-title"]', 320, 240)
  const moved = await evalJs('(() => { const el = document.querySelector("[data-testid=dock-float]"); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()')
  check('S7 float moved', moved && Math.abs(moved.x - floatBox.x) + Math.abs(moved.y - floatBox.y) > 40, JSON.stringify({ from: floatBox, to: moved }))
  await dragTo('[data-testid="dock-float-resize"]', moved.x + moved.w - 9 + 120, moved.y + moved.h - 9 + 70)
  const resized = await evalJs('(() => { const el = document.querySelector("[data-testid=dock-float]"); const r = el.getBoundingClientRect(); return { w: r.width, h: r.height } })()')
  check('S7b float resized', resized && resized.w > moved.w + 40 && resized.h > moved.h + 30, JSON.stringify({ before: moved, after: resized }))

  // S8 浮动一键停靠回布局
  await evalJs('document.querySelector("[data-testid=dock-float-dock]").click()')
  await sleep(400)
  s = await summary()
  check('S8 float docked back', s && s.floats === 0 && s.panels === 5, JSON.stringify(s))

  // S9 sash 缩放
  const before = await paneRect('region:sidebar') ?? await evalJs('(() => { const p = document.querySelectorAll("[data-dock-node]")[0]; const r = p.getBoundingClientRect(); return { w: r.width } })()')
  const sashTarget = await evalJs('(() => { const el = document.querySelector("[data-dock-split] [data-testid=dock-sash]"); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()')
  check('S9 sash found', sashTarget !== null && !sashTarget?.__err, JSON.stringify(sashTarget))
  if (sashTarget && !sashTarget.__err) {
    await evalJs('(() => { const el = document.querySelector("[data-dock-split] [data-testid=dock-sash]"); el.dispatchEvent(new PointerEvent("pointerdown", { clientX: ' + sashTarget.x + ', clientY: ' + sashTarget.y + ', bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse" })); return true })()')
    for (let i = 1; i <= 10; i++) { await evalJs('window.dispatchEvent(new PointerEvent("pointermove", { clientX: ' + (sashTarget.x + 12 * i) + ', clientY: ' + sashTarget.y + ', bubbles: true, pointerId: 1, pointerType: "mouse" }))'); await sleep(20) }
    await evalJs('window.dispatchEvent(new PointerEvent("pointerup", { clientX: ' + (sashTarget.x + 120) + ', clientY: ' + sashTarget.y + ', bubbles: true, pointerId: 1, pointerType: "mouse" }))')
    await sleep(400)
    const firstPaneAfter = await evalJs('(() => { const p = document.querySelectorAll("[data-dock-node]")[0]; const r = p.getBoundingClientRect(); return { w: r.width } })()')
    check('S9b sash resizes pane', before && firstPaneAfter && firstPaneAfter.w > before.w + 40, JSON.stringify({ before: before.w, after: firstPaneAfter?.w }))
  }

  // S10/S11 详情开合联动宿主 layout 服务
  await hook('openDetails')
  await sleep(500)
  s = await summary()
  check('S10 openDetails expands pane', s && s.details > 0 && await evalJs('(() => { const el = document.querySelector("[data-region-pane=\'region:details\']"); return el !== null && el.getBoundingClientRect().width > 300 })()'), JSON.stringify(s))
  await hook('closeDetails')
  await sleep(500)
  s = await summary()
  check('S11 closeDetails collapses pane (kept mounted)', s && s.details === 0 && await evalJs('(() => { const el = document.querySelector("[data-region-pane=\'region:details\']"); return el !== null && el.getBoundingClientRect().width < 2 })()'), JSON.stringify(s))

  // S12 保存槽位 → 重置 → 恢复（钩子驱动）
  await hook('saveSlot', 'selftest-shell')
  const savedSummary = await summary()
  await hook('reset')
  await sleep(400)
  s = await summary()
  check('S12 reset to default', s && s.panels === 4 && s.groups === 4 && s.rootKind === 'split', JSON.stringify(s))
  const loaded = await hook('loadSlot', 'selftest-shell')
  await sleep(400)
  s = await summary()
  check('S12b restore slot', loaded === true && s && s.panels === savedSummary.panels && s.groups === savedSummary.groups, JSON.stringify({ loaded, s, savedSummary }))

  // S13 导出 → 重置 → 导入（钩子驱动）
  const exported = await hook('exportJSON')
  check('S13 export JSON', typeof exported === 'string' && exported.includes('"dock"') && exported.includes('region:conversation'), String(exported).slice(0, 70))
  await hook('reset')
  await sleep(400)
  const imported = await evalJs('window.__liuliDockShell__.importJSON(' + JSON.stringify(exported) + ')')
  await sleep(400)
  s = await summary()
  check('S13b import restores', imported === true && s && s.panels === savedSummary.panels, JSON.stringify({ imported, s }))

  // S14 页面刷新后布局自动恢复
  await send('Page.navigate', { url: BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32' })
  let s14ok = false
  for (let i = 0; i < 45; i++) {
    const hit = await evalJs('document.querySelector("[data-testid=dock-shell]") !== null')
    if (hit === true) { s14ok = true; break }
    await sleep(1000)
  }
  check('S14 dock shell renders after reload', s14ok)
  s = await summary()
  check('S14b layout restored after reload', s && s.panels === savedSummary.panels && s.groups === savedSummary.groups, JSON.stringify(s))

  // S15 热重载存活：改写 marker → 重建 → HMR 重载 → shell 原样回归
  const preHmr = await summary()
  const markerPath = path.join(PKG_DIR, 'src', 'client', 'hmr-marker.ts')
  const markerOriginal = readFileSync(markerPath, 'utf8')
  const markerValue = 'liuli-dockshell-hmr-' + String(Date.now())
  let hmrOk = false
  let lastSeen = null
  try {
    writeFileSync(markerPath, markerOriginal.replace(/HMR_MARKER = '[^']*'/, "HMR_MARKER = '" + markerValue + "'"))
    const rebuildOut = execSync('pnpm bundle', { cwd: PKG_DIR, encoding: 'utf8', timeout: 180000 })
    console.log('rebuild:', rebuildOut.split(/\r?\n/).find(l => l.includes('client.js')) ?? '?')
    for (let i = 0; i < 30; i++) {
      await sleep(1500)
      const markerAttr = await evalJs('document.querySelector("[data-testid=dock-shell]")?.getAttribute("data-hmr-marker") ?? null')
      if (markerAttr !== null) {
        const cur = await summary()
        lastSeen = { markerAttr, cur }
        if (markerAttr === markerValue && cur && cur.panels === preHmr.panels && cur.groups === preHmr.groups) { hmrOk = true; break }
      }
    }
  } finally {
    writeFileSync(markerPath, markerOriginal)
    try { execSync('pnpm bundle', { cwd: PKG_DIR, encoding: 'utf8', timeout: 180000 }) } catch { /* restore build */ }
  }
  check('S15 hot reload survives rebuild', hmrOk, JSON.stringify({ preHmr, markerValue, lastSeen }))

  // S15b 多标签 chip 一键浮动：caption 拖拽悬浮区移除后，多标签组里的单个
  //      标签通过 chip 上的 ⧉ 按钮浮动（恢复原拖到标题栏悬浮的能力）
  const notesChipSel3 = await chipSelByLabel('便签')
  check('S15b notes chip located', typeof notesChipSel3 === 'string', String(notesChipSel3))
  await evalJs('document.querySelector(' + JSON.stringify(notesChipSel3 + ' [data-testid=dock-tab-float]') + ').click()')
  await sleep(300)
  s = await summary()
  check('S15c multi-tab chip floated', s && s.floats === 1 && s.panels === 5 && s.groups === 4, JSON.stringify(s))
  // S15d 浮动窗口停靠回边缘
  await evalJs('document.querySelector("[data-testid=dock-float-dock]").click()')
  await sleep(300)
  s = await summary()
  check('S15d chip float docked back', s && s.floats === 0 && s.panels === 5, JSON.stringify(s))

  // S16 无页面报错
  check('S16 no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)))

  // S17 右侧标签面板(SidePane)标签拖入布局（HTML5 DnD 桥）：
  //     打开详情 → SidePane 新增 Treemapping 标签 → 把标签拖到会话面板右缘
  //     → 布局按落点拆分出新面板、源标签从 SidePane 关闭（移动语义）。
  await hook('openDetails')
  await sleep(600)
  s = await summary()
  check('S17 details pane open', s && s.details > 0 && await evalJs('document.querySelector("[data-liuli-side-pane]") !== null'), JSON.stringify(s))
  // SidePane 空状态列表里点开 Treemapping（文件树标签）
  const openedTab = await evalJs('(() => { const item = document.querySelector("[data-side-pane-open-tab-item=\'treemapping\']"); if (!item) return false; item.click(); return true })()')
  await sleep(500)
  const sideChip = await evalJs('(() => { const c = Array.from(document.querySelectorAll("[data-side-pane-tab-id]")).find(el => el.textContent.includes("Treemapping")); return c ? c.getAttribute("data-side-pane-tab-id") : null })()')
  check('S17b side-pane treemapping tab opened', openedTab === true && typeof sideChip === 'string' && sideChip !== null, String(sideChip))
  const panelsBefore = (await summary())?.panels ?? 0
  const convRect = await paneRect('region:conversation')
  check('S17c conversation pane located', convRect !== null, JSON.stringify(convRect))
  // 构造 DataTransfer 模拟 HTML5 拖拽：dragstart(源 chip) → dragover/drop(会话面板右缘)
  const dragResult = await evalJs('(() => { const chip = Array.from(document.querySelectorAll("[data-side-pane-tab-id]")).find(el => el.textContent.includes("Treemapping")); const pane = document.querySelector("[data-region-pane=\'region:conversation\']"); if (!chip || !pane) return null; const pr = pane.getBoundingClientRect(); const x = pr.x + pr.width * 0.94, y = pr.y + pr.height / 2; const dt = new DataTransfer(); const tab = { id: chip.getAttribute("data-side-pane-tab-id"), type: "treemapping", openedAt: Date.now() }; dt.setData("application/x-liuli-side-tab", JSON.stringify(tab)); chip.dispatchEvent(new DragEvent("dragstart", { dataTransfer: dt, bubbles: true, cancelable: true })); window.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true })); window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true })); chip.dispatchEvent(new DragEvent("dragend", { dataTransfer: dt, bubbles: true, cancelable: true })); return { x, y } })()')
  await sleep(500)
  s = await summary()
  check('S17d drop into layout adds panel', dragResult !== null && s && s.panels === panelsBefore + 1, JSON.stringify({ dragResult, s, panelsBefore }))
  const sideChipGone = await evalJs('Array.from(document.querySelectorAll("[data-side-pane-tab-id]")).every(el => !el.textContent.includes("Treemapping"))')
  check('S17e source tab closed (moved into layout)', sideChipGone === true)
  const filesPanelInLayout = await evalJs('Array.from(document.querySelectorAll("[data-testid=dock-tab-chip]")).some(el => el.textContent.includes("文件树"))')
  check('S17f files panel present in layout', filesPanelInLayout === true)
  // 收尾：关闭详情（S11 已测过移除面板；这里确保后续不干扰）
  await hook('closeDetails')
  await sleep(500)

  const failed = results.filter(r => !r.pass)
  console.log('SUMMARY: ' + String(results.length - failed.length) + '/' + String(results.length) + ' passed')
  if (failed.length > 0) console.log('FAILED: ' + failed.map(x => x.name).join(' | '))
} catch (e) {
  console.log('GUI VERIFY ERROR:', e.message, JSON.stringify(pageErrors.slice(0, 3)))
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch {}
}
