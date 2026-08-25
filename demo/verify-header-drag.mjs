// 无边框窗口拖拽区（会话 header drag）自测。机制：
//  - 会话页头 <header> 整体 -webkit-app-region: drag（空白处拖窗）；
//  - header 内交互元素（button/a/input/[role=*]/窗口按钮等）no-drag 挖洞保持可点；
//  - 开始页激活会话面板顶部 42px 拖动条（paneTopDrag）；dock 标签条空白区也可拖窗。
// 验证方式（headless + CDP）：
//  - 注入样式强制显示被 :has(header[aria-hidden]) 隐藏的页头 shard；
//  - 断言 header computed app-region = drag、条带元素 [data-liuli-window-drag] 已移除；
//  - 向 header 注入 <button> → computed no-drag，CDP 真实输入点击可达（no-drag 洞）；
//  - 标签条/chip、paneTopDrag 规则仍在。
// 使用独立 --user-data-dir（隔离 localStorage），不会污染用户真实布局。
import { spawn, execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9280
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

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-hdrdrag-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', 'about:blank'], { stdio: 'ignore' })
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
const clickAt = async (x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const clicks = () => evalJs('window.__liuliHdrClicks || 0')

try {
  await connect()
  let mounted = false
  for (let i = 0; i < 45; i++) {
    const hit = await evalJs('document.querySelector("[data-testid=dock-shell]") !== null && document.querySelector("[data-region-pane=\'region:conversation-header\']") !== null')
    if (hit === true) { mounted = true; break }
    await sleep(1000)
  }
  check('S1 dock shell + header pane mounted', mounted)

  // 条带已移除：旧 .windowTopDrag 覆盖层不再存在
  check('S2 old drag strip removed', await evalJs('document.querySelector("[data-liuli-window-drag]") === null'))

  // 强制显示开始页被隐藏的页头 shard（测试环境无会话：shard 由 hero 阶段规则
  // 隐藏，且页面不存在 <header>——注入合成 header 验证 drag/no-drag 规则本身）
  const shown = await evalJs(`(() => {
    const st = document.createElement('style')
    st.textContent = [
      '[data-shard-region="region:conversation-header"]:has(header[aria-hidden]) { display: flex !important }',
      '[data-shard-region="region:conversation-header"]:has(~ [data-shard-region="region:conversation"] div[data-phase="hero"]) { display: flex !important }',
    ].join('\\n')
    document.head.appendChild(st)
    const pane = document.querySelector('[data-region-pane="region:conversation-header"]')
    if (!pane) return false
    // 自建合成 header（不复用官方占位 header：占位节点由 React 管理，稍后可能被
    // React 重置内联样式 / 被 sync 移入 host，querySelector 会命中它导致后续
    // 断言拿到隐藏节点——height 0、CDP 点击坐标全 0）。用固定 id 指向自建节点。
    let h = document.getElementById('hdr-syn-header')
    if (!h) {
      h = document.createElement('header')
      h.id = 'hdr-syn-header'
      pane.appendChild(h)
    }
    h.style.cssText = 'min-height: 60px; display: block !important'
    return pane.getBoundingClientRect().height > 0
  })()`)
  await sleep(300)
  check('S3 header shard forced visible with synthetic header', shown === true || (await evalJs('document.querySelector("[data-region-pane=\'region:conversation-header\']")?.getBoundingClientRect().height ?? 0')) > 0)

  // 等 edgeMap 把页头 pane 标上 data-edge-top（顶边门控的前提；RO 异步更新）
  let edgeTop = false
  for (let i = 0; i < 20; i++) {
    edgeTop = await evalJs('document.querySelector("[data-region-pane=\'region:conversation-header\']")?.hasAttribute("data-edge-top") === true')
    if (edgeTop) break
    await sleep(150)
  }
  check('S3b header pane marked data-edge-top', edgeTop === true)

  // header 整体 drag（用自建合成 header，避开官方占位 header 的隐藏节点）
  const headerInfo = await evalJs(`(() => {
    const h = document.getElementById('hdr-syn-header')
    if (!h) return null
    const cs = getComputedStyle(h)
    const r = h.getBoundingClientRect()
    return { appRegion: cs.webkitAppRegion, top: r.top, height: r.height }
  })()`)
  check('S4 header is drag region', headerInfo !== null && headerInfo.appRegion === 'drag' && headerInfo.height > 0, JSON.stringify(headerInfo))

  // 注入 <button> → no-drag 挖洞；CDP 真实输入点击应可达
  const btn = await evalJs(`(() => {
    const h = document.getElementById('hdr-syn-header')
    if (!h) return null
    let b = document.getElementById('hdr-test-btn')
    if (!b) {
      b = document.createElement('button')
      b.id = 'hdr-test-btn'
      b.textContent = 'T'
      Object.assign(b.style, { position: 'fixed', left: '320px', top: '16px', width: '60px', height: '20px', zIndex: '50' })
      b.onclick = () => { window.__liuliHdrClicks = (window.__liuliHdrClicks || 0) + 1 }
      h.appendChild(b)
    }
    const r = b.getBoundingClientRect()
    const cs = getComputedStyle(b)
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, appRegion: cs.webkitAppRegion, height: r.height }
  })()`)
  check('S5 header button injected with no-drag', btn !== null && btn.appRegion === 'no-drag' && btn.height > 0, JSON.stringify(btn))

  // 真实命中测试点击（按钮是 drag header 里的 no-drag 洞 → 输入管线放行）
  await clickAt(btn.cx, btn.cy)
  await sleep(120)
  check('S6 real-input click reaches no-drag button in header', (await clicks()) === 1, 'clicks=' + String(await clicks()))

  // JS 直达点击也可达（onclick 本身可用）
  await evalJs('document.getElementById("hdr-test-btn").click()')
  await sleep(80)
  check('S7 JS click works', (await clicks()) === 2)

  // 标签条 drag + chip no-drag 规则仍在（有标签条时断言）
  const tabStrip = await evalJs(`(() => {
    const strip = document.querySelector('[data-testid="dock-tab-strip"]')
    if (!strip) return { present: false }
    const chip = strip.querySelector('[data-testid="dock-tab-chip"]')
    return {
      present: true,
      stripAppRegion: getComputedStyle(strip).webkitAppRegion,
      chipAppRegion: chip ? getComputedStyle(chip).webkitAppRegion : null,
    }
  })()`)
  check('S8 tab strip drag / chip no-drag intact', tabStrip === null || tabStrip.present === false || (tabStrip.stripAppRegion === 'drag' && (tabStrip.chipAppRegion === null || tabStrip.chipAppRegion === 'no-drag')), JSON.stringify(tabStrip))

  // 开始页 paneTopDrag 元素仍在（激活与否由 :has 决定）
  check('S9 paneTopDrag element present', await evalJs('document.querySelector("[data-liuli-pane-drag]") !== null'))

  // 侧栏卡片顶部（logoRow）drag + 内部按钮 no-drag
  const logoRow = await evalJs(`(() => {
    const el = document.querySelector('[class*="_sidebarCol"] [class*="_logoRow"]')
    if (!el) return null
    let b = document.getElementById('logo-row-btn')
    if (!b) {
      b = document.createElement('button')
      b.id = 'logo-row-btn'
      b.textContent = 'L'
      Object.assign(b.style, { position: 'fixed', left: '40px', top: '30px', width: '50px', height: '20px', zIndex: '100' })
      b.onclick = () => { window.__liuliHdrClicks = (window.__liuliHdrClicks || 0) + 1 }
      el.appendChild(b)
    }
    const r = b.getBoundingClientRect()
    return { rowAppRegion: getComputedStyle(el).webkitAppRegion, btnAppRegion: getComputedStyle(b).webkitAppRegion, cx: r.x + r.width / 2, cy: r.y + r.height / 2, h: r.height }
  })()`)
  check('S10 logoRow drag + inner button no-drag', logoRow !== null && logoRow.rowAppRegion === 'drag' && logoRow.btnAppRegion === 'no-drag' && logoRow.h > 0, JSON.stringify(logoRow))
  await clickAt(logoRow.cx, logoRow.cy)
  await sleep(120)
  check('S11 real-input click reaches no-drag button in logoRow', (await clicks()) === 3, 'clicks=' + String(await clicks()))

  // 详情卡片顶部（右侧面板标签条）drag + 标签 no-drag（详情面板挂载较晚，轮询等待）
  let detailsTabStrip = null
  for (let i = 0; i < 20; i++) {
    detailsTabStrip = await evalJs(`(() => {
      const el = document.querySelector('[data-preview-panel] [class*="_tabStrip"]')
      if (!el) return null
      return { appRegion: getComputedStyle(el).webkitAppRegion, tabsNoDrag: Array.from(el.querySelectorAll('[data-side-pane-tab-id]')).every(t => getComputedStyle(t).webkitAppRegion === 'no-drag') }
    })()`)
    if (detailsTabStrip !== null && detailsTabStrip.appRegion !== undefined) break
    await sleep(150)
  }
  check('S12 details tabStrip drag + tabs no-drag', detailsTabStrip !== null && detailsTabStrip.appRegion === 'drag' && detailsTabStrip.tabsNoDrag, JSON.stringify(detailsTabStrip))

  // 顶边门控负用例：去掉页头 pane 的 data-edge-top → header 不再是 drag 区；
  // 恢复后重新成为 drag 区（dockable 布局中非贴顶卡片应保持此语义）
  const gateOff = await evalJs(`(() => {
    const pane = document.querySelector('[data-region-pane="region:conversation-header"]')
    const h = document.getElementById('hdr-syn-header')
    if (!pane || !h) return null
    pane.removeAttribute('data-edge-top')
    const off = getComputedStyle(h).webkitAppRegion
    pane.setAttribute('data-edge-top', '')
    const on = getComputedStyle(h).webkitAppRegion
    return { off, on }
  })()`)
  check('S14 edge-top gate: drag only when card touches top', gateOff !== null && gateOff.off === 'none' && gateOff.on === 'drag', JSON.stringify(gateOff))

  // S16 页头面板并入多标签组（其他卡片拖进页头）：宿主常驻、卡片带 region 属性、
  // header 被搬进卡内宿主而非打回会话面板（syncConversationHeader 的搬移语义）。
  const multiJson = JSON.stringify({
    v: 1,
    dock: {
      root: {
        id: 's10', kind: 'split', dir: 'h', sizes: [0.18, 0.7, 0.12],
        children: [
          { id: 'n5', kind: 'tabs', tabs: [{ id: 'p1', type: 'region:sidebar' }], activeId: 'p1' },
          { id: 's9', kind: 'split', dir: 'v', sizes: [0.16, 0.84], children: [
            { id: 'n6', kind: 'tabs', tabs: [{ id: 'p2', type: 'region:conversation-header' }, { id: 'p9', type: 'notes' }], activeId: 'p9' },
            { id: 'n7', kind: 'tabs', tabs: [{ id: 'p3', type: 'region:conversation' }], activeId: 'p3' },
          ] },
          { id: 'n8', kind: 'tabs', tabs: [{ id: 'p4', type: 'region:details' }], activeId: 'p4' },
        ],
      },
      floats: [],
      seq: 300,
    },
  })
  await evalJs('window.__liuliDockShell__.importJSON(' + JSON.stringify(multiJson) + ')')
  await sleep(900)
  await evalJs(`(() => {
    const conv = document.querySelector('[data-region-pane="region:conversation"] div[data-phase]')
    if (conv && !conv.querySelector(':scope > header')) {
      const h = document.createElement('header')
      h.id = 'multi-tab-header'
      h.style.cssText = 'min-height: 40px; display: block !important'
      conv.appendChild(h)
    }
    return true
  })()`)
  await sleep(600)
  const multi = await evalJs(`(() => {
    const card = document.querySelector('[data-dock-node="n6"]')
    const host = card?.querySelector('[data-liuli-conversation-header-host]')
    return {
      cardRegion: card?.getAttribute('data-region-pane'),
      hostExists: !!host,
      hostHidden: host ? getComputedStyle(host).display === 'none' : false,
      headerInCardHost: !!host?.querySelector('#multi-tab-header'),
      headerInConversation: !!document.querySelector('[data-region-pane="region:conversation"] header'),
      noTabStripHeader: !!card && card.querySelector('[data-testid="dock-tab-strip"] > header') === null,
    }
  })()`)
  check('S16 multi-tab header group keeps header in card host', multi !== null && multi.cardRegion === 'region:conversation-header' && multi.hostExists && multi.hostHidden && multi.headerInCardHost === true && multi.headerInConversation === false && multi.noTabStripHeader === true, JSON.stringify(multi))
  // 收尾恢复默认布局，避免影响后续
  await evalJs('window.__liuliDockShell__.reset()')
  await sleep(500)

  check('S15 no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)))

  const failed = results.filter(r => !r.pass)
  console.log('SUMMARY: ' + String(results.length - failed.length) + '/' + String(results.length) + ' passed')
  if (failed.length > 0) console.log('FAILED: ' + failed.map(x => x.name).join(' | '))
} catch (e) {
  console.log('HEADER-DRAG VERIFY ERROR:', e.message, JSON.stringify(pageErrors.slice(0, 3)))
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch {}
}
