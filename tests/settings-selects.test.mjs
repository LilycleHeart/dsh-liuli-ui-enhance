// 设置页下拉菜单的真实浏览器回归：长选项列表可以滚动，外层滚动时菜单跟随触发器
// 且不重置滚动位置，量高过程不解锁 max-height（那会把 scrollTop 钳回 0）。
// Run: node --test "tests/settings-selects.test.mjs" (set CHROME_PATH outside Windows).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test } from 'node:test'
import { transform } from 'lightningcss'
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript'

const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const enabled = existsSync(chromePath)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

let chrome, profile, server, socket, sequence = 0
const pending = new Map()
const call = (method, params = {}) => new Promise((resolveCall, reject) => {
  const id = ++sequence
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 15000)
  pending.set(id, { resolve: resolveCall, reject, timer })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (fn, arg) => {
  const expression = arg === undefined ? `(${fn})()` : `(${fn})(${JSON.stringify(arg)})`
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

if (enabled) {
  server = createServer(async (request, response) => {
    if (request.url === '/settings-selects.ts') {
      const source = await readFile(new URL('../src/client/settings-selects.ts', import.meta.url), 'utf8')
      response.setHeader('Content-Type', 'text/javascript')
      response.end(transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText
        .replace("from './SettingsSelects.module.css'", "from '/settings-style.js'"))
      return
    }
    if (request.url === '/settings-style.js') {
      const code = await readFile(new URL('../src/client/SettingsSelects.module.css', import.meta.url))
      const compiled = transform({ filename: 'SettingsSelects.module.css', code, cssModules: true })
      response.setHeader('Content-Type', 'text/javascript')
      response.end(`const style=document.createElement('style');style.textContent=${JSON.stringify(compiled.code.toString())};document.head.append(style);export default ${JSON.stringify(Object.fromEntries(Object.entries(compiled.exports).map(([k, v]) => [k, v.name])))};`)
      return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    // 设置浮层：可滚动内容区里两个原生 select —— 60 项长列表（与「新增提供商」同形）
    // 与 3 项短列表（用来验证自然高度被正确量到、不该出现滚动条）。
    // aria-label 用 ASCII，避免测试页编码/选择器引号带来的伪失败。
    const long = Array.from({ length: 60 }, (_, i) => `<option value="p${i}">Provider ${i}</option>`).join('')
    const short = '<option value="a">Alpha</option><option value="b">Beta</option><option value="c">Gamma</option>'
    response.end(`<!doctype html><style>html,body{margin:0;height:100%}#scroller{height:100%;overflow-y:auto}</style>
<div role="dialog"><div id="scroller"><div style="height:120px"></div>
<label><select class="x_selectInput" aria-label="provider-list" style="width:240px;height:32px">${long}</select></label>
<label><select class="x_selectInput" aria-label="protocol-list" style="width:240px;height:32px">${short}</select></label>
<div style="height:2000px"></div></div></div>`)
  })
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  profile = await mkdtemp(join(tmpdir(), 'liuli-settings-selects-test-'))
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server', '--window-size=1000,700',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
  let port
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break } catch { await delay(100) }
  }
  assert.ok(port, 'Chrome exposes its test debugging port')
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
  for (let i = 0; i < 100; i++) {
    if (await evaluate(() => document.readyState === 'complete')) break
    await delay(50)
  }
  await evaluate(async () => {
    const mod = await import('/settings-selects.ts')
    window.__dispose = mod.startSettingsSelectUpgrade()
    window.frames2 = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(r => requestAnimationFrame(r)) }
    // 关闭上一个菜单并等过 120ms 退场，保证查询到的是当前菜单。
    // Escape 的处理挂在菜单自身的 keydown 上（body portal，document 收不到），
    // 因此要对着打开的那个菜单元素派发。
    window.settle = async () => {
      const current = document.querySelector('[data-liuli-settings-menu]:not([data-closing])')
      if (current !== null) current.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await new Promise(r => setTimeout(r, 200))
    }
    // 按 aria-label 打开某个下拉（select 的 aria-label 会带到菜单上）。
    window.openMenuFor = async (label) => {
      await window.settle()
      const select = Array.from(document.querySelectorAll('select')).find(s => s.getAttribute('aria-label') === label)
      if (select === undefined) throw new Error('no select labelled ' + label)
      const wanted = select.options[select.selectedIndex].text
      const trigger = Array.from(document.querySelectorAll('[data-liuli-settings-trigger]'))
        .find(t => t.textContent.trim() === wanted)
      if (trigger === undefined) throw new Error('no trigger showing ' + wanted)
      trigger.click()
      await window.frames2(4)
      return document.querySelector('[data-liuli-settings-menu]:not([data-closing])')
    }
  })
}

after(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await call('Browser.close') } catch { /* Already exited. */ }
    socket.close()
  }
  chrome?.kill()
  server?.close()
  if (profile !== undefined) {
    assert.equal(dirname(profile), tmpdir(), 'cleanup stays inside the temporary test directory')
    for (let i = 0; i < 20; i++) {
      try { await rm(profile, { recursive: true, force: true }); break } catch { await delay(100) }
    }
  }
})

test('a long settings menu keeps its own scroll position', { skip: !enabled }, async () => {
  const result = await evaluate(async () => {
    await window.frames2()
    const menu = await window.openMenuFor('provider-list')
    const scrollable = menu.scrollHeight > menu.clientHeight + 1
    menu.scrollTop = 400
    // The scroll event arrives on the next frame; the old re-anchor ran one frame after it.
    await window.frames2(4)
    const first = menu.scrollTop
    menu.scrollTop = 800
    await window.frames2(4)
    return { scrollable, first, second: menu.scrollTop, open: menu.isConnected && menu.dataset.closing !== 'true' }
  })
  assert.equal(result.scrollable, true, 'the 60-item menu is height-limited and scrolls')
  assert.equal(result.open, true, 'scrolling inside the menu does not close it')
  assert.equal(result.first, 400, 'the menu keeps the position the user scrolled to')
  assert.equal(result.second, 800, 'a second scroll is kept as well')
})

test('scrolling the settings page still re-anchors the open menu', { skip: !enabled }, async () => {
  const result = await evaluate(async () => {
    const menu = await window.openMenuFor('provider-list')
    const select = document.querySelector('select[aria-label="provider-list"]')
    const gapBefore = menu.getBoundingClientRect().top - select.getBoundingClientRect().bottom
    menu.scrollTop = 300
    await window.frames2(4)
    document.getElementById('scroller').scrollTop = 40
    await window.frames2(6)
    const gapAfter = menu.getBoundingClientRect().top - select.getBoundingClientRect().bottom
    return {
      gapBefore: Math.round(gapBefore),
      gapAfter: Math.round(gapAfter),
      menuScroll: menu.scrollTop,
      scrollableAfter: menu.scrollHeight > menu.clientHeight + 1,
    }
  })
  assert.equal(result.gapAfter, result.gapBefore, 'the menu follows its trigger when the page scrolls')
  assert.equal(result.scrollableAfter, true, 're-anchoring keeps the menu height-limited (still scrollable)')
  assert.equal(result.menuScroll, 300, 're-anchoring keeps the menu scroll position')
})

// 回归锚点：旧实现用 `el.style.maxHeight = 'none'` 量自然高度，那一瞬间 overflow 失效、
// 浏览器把 scrollTop 钳回 0，菜单自己的滚动又会触发一次重锚，于是「滚一点就被弹回顶部」。
// 修复后量高改读 scrollHeight，任何一次重锚都不允许出现 max-height: none。
test('measuring the natural height never unlocks max-height', { skip: !enabled }, async () => {
  const result = await evaluate(async () => {
    const menu = await window.openMenuFor('provider-list')
    const seen = []
    const observer = new MutationObserver(() => { seen.push(menu.style.maxHeight || '(cleared)') })
    observer.observe(menu, { attributes: true, attributeFilter: ['style'] })
    menu.scrollTop = 500
    await window.frames2(4)
    // 页面滚动 → scheduleSync → syncMenu → positionMenu（旧实现会在这里解除 max-height）
    const scroller = document.getElementById('scroller')
    scroller.scrollTop = 80
    await window.frames2(6)
    scroller.scrollTop = 120
    await window.frames2(6)
    observer.disconnect()
    return { seen, scrollTop: menu.scrollTop, inlineMaxHeight: menu.style.maxHeight }
  })
  assert.equal(result.seen.some(value => value === 'none' || value === ''), false,
    `no intermediate max-height:none during re-anchor (saw ${JSON.stringify(result.seen.slice(0, 6))})`)
  assert.match(result.inlineMaxHeight, /^\d+(\.\d+)?px$/, 'the menu height stays pinned in px')
  assert.equal(result.scrollTop, 500, 'the menu scroll position survives two page-scroll re-anchors')
})

test('the menu stays inside the viewport and is height-limited', { skip: !enabled }, async () => {
  const result = await evaluate(async () => {
    const menu = await window.openMenuFor('provider-list')
    const rect = menu.getBoundingClientRect()
    return {
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      innerHeight: window.innerHeight,
      scrollHeight: menu.scrollHeight,
      clientHeight: menu.clientHeight,
      overflowY: getComputedStyle(menu).overflowY,
      overscroll: getComputedStyle(menu).overscrollBehaviorY,
    }
  })
  assert.ok(result.top >= 8, `menu top ${result.top} stays below the viewport edge`)
  assert.ok(result.bottom <= result.innerHeight - 8, `menu bottom ${result.bottom} stays above the viewport edge`)
  assert.ok(result.clientHeight < result.scrollHeight, 'a 60-item menu is taller than the menu box')
  assert.equal(result.overflowY, 'auto', 'the menu box is the scroll container')
  assert.equal(result.overscroll, 'contain', 'wheel chaining to the page is suppressed')
})

test('a short menu is measured to fit its content (no scrollbar)', { skip: !enabled }, async () => {
  const result = await evaluate(async () => {
    const menu = await window.openMenuFor('protocol-list')
    const rect = menu.getBoundingClientRect()
    return {
      scrollHeight: menu.scrollHeight,
      clientHeight: menu.clientHeight,
      rectHeight: Math.round(rect.height),
      inlineMaxHeight: menu.style.maxHeight,
      items: menu.querySelectorAll('[role="option"]').length,
    }
  })
  assert.equal(result.items, 3, 'the short select renders its three options')
  assert.ok(result.scrollHeight <= result.clientHeight + 1, 'no overflow for a 3-item menu')
  assert.ok(result.rectHeight < 200, `the short menu hugs its content (height ${result.rectHeight})`)
})

// 隐藏窗口（被遮挡/最小化）里 Chromium 不投递 animation frame：只挂 rAF 的扫描会停摆，
// 现场表现为「设置页里的 select 完全没被升级」。定时器兜底必须能补上。
test('a select mounted while rAF is paused is still upgraded', { skip: !enabled }, async () => {
  const result = await evaluate(async () => {
    await window.settle()
    const realRaf = window.requestAnimationFrame
    const realHidden = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState')
    const realHiddenFlag = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden')
    // 模拟被遮挡/最小化：visibilityState=hidden + rAF 不回调（与 Chromium 行为一致）。
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    window.requestAnimationFrame = () => 0
    let upgraded = null
    try {
      const select = document.createElement('select')
      select.className = 'late_selectInput'
      select.innerHTML = '<option>a</option><option>b</option>'
      select.style.cssText = 'position:fixed;left:8px;top:420px;width:160px;height:24px'
      document.body.appendChild(select)
      await new Promise(r => setTimeout(r, 450))
      upgraded = select.dataset.liuliSettingsSelect ?? null
      select.remove()
    } finally {
      window.requestAnimationFrame = realRaf
      Object.defineProperty(document, 'visibilityState', realHidden)
      Object.defineProperty(document, 'hidden', realHiddenFlag)
    }
    await window.frames2(3)
    return { upgraded, triggersLeft: document.querySelectorAll('[data-liuli-settings-trigger]').length }
  })
  assert.equal(result.upgraded, 'true', 'the 200ms timer fallback scans even without animation frames')
  assert.equal(result.triggersLeft, 2, 'the removed probe leaves no orphan trigger behind')
})

test('exposes a diagnostic marker', { skip: !enabled }, async () => {
  const marker = await evaluate(() => window.__liuliSettingsSelectsReady__ ?? null)
  assert.ok(marker, 'window.__liuliSettingsSelectsReady__ is set')
  assert.match(String(marker.tag), /^settings-selects\//, 'the marker carries a module tag')
  assert.equal(typeof marker.at, 'number', 'the marker records when the last scan ran')
  assert.ok(marker.upgraded >= 2, `the marker reports both upgraded selects (got ${marker.upgraded})`)
})
