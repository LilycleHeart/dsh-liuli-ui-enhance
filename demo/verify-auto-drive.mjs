#!/usr/bin/env node
// GUI 验证：侧边栏浏览器自动驱动（auto-drive-browser）+ agent CLI --show 轮询桥接。
// headless Chrome 加载 DSH GUI（服务端已提供新 client bundle），向对话流 DOM 注入
// 模拟的 dev server bash 行 / 前端文件编辑行，断言：
//   T1  注入 dev server bash 行 → 侧边栏自动展开且出现浏览器标签
//   T2  引擎侧新增 browser:* 标签（Host 能力清单 diff）
//   T3  标签地址栏状态指向注入的 dev server URL
//   T4  同轮内再次注入不同 URL 的 dev server 行 → 不再新开标签（每轮一次）
//   T5  注入新 user 锚点重置轮次 + 同源 URL → 复用已有标签导航并激活（同源复用）
//   T12 前端文件编辑驱动（复用标签）  T13 非前端文件不驱动
//   T14 auto-open-details 驱动审查 → git 标签激活 + 来源切「上一轮更改」
//   T8  POST 引擎标签 browser:adshow-*（等效 CLI open --show）→ 轮询桥接进侧边栏
//   T11 全程无页面异常
// 运行：node demo/verify-auto-drive.mjs
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const BASE = await (async () => {
  if (process.env.LIULI_BROWSER_BASE) return process.env.LIULI_BROWSER_BASE
  const { execSync } = await import('node:child_process')
  let ports = []
  try {
    const out = execSync('powershell -NoProfile -Command "Get-Process \\"DSH Desktop\\" -ErrorAction SilentlyContinue | ForEach-Object { Get-NetTCPConnection -OwningProcess $_.Id -State Listen -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty LocalPort -Unique"', { encoding: 'utf8', timeout: 15000 })
    ports = out.split(/\r?\n/).map(s => s.trim()).filter(s => /^[0-9]+$/.test(s))
  } catch { /* fall through */ }
  const candidates = [...ports, '10205', '7336']
  for (const port of candidates) {
    try {
      const resp = await fetch('http://127.0.0.1:' + port + '/liuli-browser/capabilities', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(3000) })
      const ct = resp.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) return 'http://127.0.0.1:' + port
    } catch { /* try next */ }
  }
  console.error('no live liuli-browser engine found (tried: ' + candidates.join(',') + ')')
  process.exit(2)
})()
console.log('BASE=' + BASE)

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9242
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-ad-' + process.pid), '--remote-debugging-port=' + String(PORT), '--window-size=1680,980', BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32'], { stdio: 'ignore' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let ws = null
let sendId = 0
const pending = new Map()
const pageErrors = []
async function connect() {
  let list = []
  for (let i = 0; i < 40; i++) {
    try {
      list = await (await fetch('http://127.0.0.1:' + PORT + '/json')).json()
      if (list.some(t => t.type === 'page')) break
    } catch { /* retry */ }
    await sleep(500)
  }
  const t = list.find(t => t.type === 'page')
  if (!t) throw new Error('no page')
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(m.params.exceptionDetails?.exception?.description ?? 'x')
  }
  await send('Runtime.enable')
}
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++sendId
    pending.set(id, { res, rej })
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' timeout')) } }, 25000)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r?.result?.value
}
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail !== '' ? ' :: ' + String(detail).slice(0, 160) : '')) }
const hostCaps = async () => (await (await fetch(BASE + '/liuli-browser/capabilities', { headers: { accept: 'application/json' } })).json()).tabs ?? []
const hostState = async (id) => (await (await fetch(BASE + '/liuli-browser/tabs/state?id=' + encodeURIComponent(id), { headers: { accept: 'application/json' } })).json()).state
const hostDestroy = async (id) => { try { await fetch(BASE + '/liuli-browser/tabs/destroy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }) } catch { /* ignore */ } }

// 注入一条 dev server bash 行（摘要含 URL，免展开读输出）
const injectBash = (summary) => evalJs(`(() => {
  const row = document.createElement('div')
  row.setAttribute('data-variant', 'bash')
  row.setAttribute('data-tool', 'pwsh')
  const s = document.createElement('span')
  s.className = 'x_summary'
  s.textContent = ${JSON.stringify(summary)}
  row.appendChild(s)
  document.body.appendChild(row)
  return true
})()`)
// 注入新 user 锚点（新一轮 → 重置「本轮已驱动」）。无头页面是开始页没有
// [data-chat-flow]，自建一个假 flow 容器（isNewestAnchor 只看父级匹配与末位锚点）。
const resetTurn = () => evalJs(`(() => {
  const f = document.createElement('div')
  f.setAttribute('data-chat-flow', '')
  const a = document.createElement('div')
  a.setAttribute('data-chat-anchor-key', 'ad-test-' + Date.now())
  a.setAttribute('data-chat-flow-kind', 'user')
  f.appendChild(a)
  document.body.appendChild(f)
  return true
})()`)
// 注入一条写/改文件工具行（data-tool=edit/write）
const injectFileRow = (tool, text) => evalJs(`(() => {
  const row = document.createElement('div')
  row.setAttribute('data-tool', ${JSON.stringify(tool)})
  const s = document.createElement('span')
  s.className = 'x_summary'
  s.textContent = ${JSON.stringify(text)}
  row.appendChild(s)
  document.body.appendChild(row)
  return true
})()`)
// 侧边栏是否展开（details 列宽 > 1）
const panelOpen = () => evalJs(`(() => {
  const p = document.querySelector('[data-preview-panel]')
  return p !== null && p.getBoundingClientRect().width > 1
})()`)
// GUI 里 browser:* 标签 chip 的 id 列表
const guiBrowserTabIds = () => evalJs(`(() => [...document.querySelectorAll('[data-side-pane-tab-id]')]
  .map(el => el.getAttribute('data-side-pane-tab-id'))
  .filter(id => id !== null && id.startsWith('browser:')))()`)

const createdTabs = new Set()
try {
  await connect()
  await sleep(11000)
  // 前置：引擎标签快照（引擎在 Host 侧跨页面存活，diff 才能区分本次新建）
  const beforeTabs = new Set(await hostCaps())
  const origin = await evalJs('location.origin')
  // 探针：记录页面内 AUTO_DRIVE_BROWSER_EVENT 的 dispatch（判断事件是否触发）
  await evalJs(`(() => { window.__adEvents = []; window.addEventListener('liuli:auto-drive-browser', (e) => { window.__adEvents.push(e.detail && e.detail.url) }); return true })()`)

  // T1/T2/T3：dev server bash 行 → 自动驱动（用非 DSH 同源的本地端口，
  // 避免 isDshOwnUrl 过滤：DSH 自身 origin 的 URL 不会被当 dev server）
  const devUrl1 = 'http://127.0.0.1:51730/?ad=1'
  await injectBash('Start the Vite dev server\n\n  \u279c  Local:   ' + devUrl1 + '\n  \u279c  Network: http://192.168.1.5:5173/')
  await sleep(3500)
  check('T1 sidebar auto-opened', await panelOpen())
  const guiIds1 = await guiBrowserTabIds()
  check('T2 browser tab appeared in side pane', Array.isArray(guiIds1) && guiIds1.length > 0, JSON.stringify(guiIds1))
  const newTabs1 = (await hostCaps()).filter(id => id.startsWith('browser:') && !beforeTabs.has(id))
  check('T3 engine tab created', newTabs1.length === 1, JSON.stringify(newTabs1))
  if (newTabs1.length === 1) {
    createdTabs.add(newTabs1[0])
    const st = await hostState(newTabs1[0])
    check('T4 tab points at dev server URL', st !== undefined && String(st?.url).includes('/?ad=1'), JSON.stringify(st ?? {}))
  }
  const events1 = await evalJs('window.__adEvents')
  check('T4b drive event fired once', Array.isArray(events1) && events1.length === 1 && String(events1[0]).includes('/?ad=1'), JSON.stringify(events1))

  // T5：同轮内第二个不同 origin URL → 每轮一次，不再新开
  await injectBash('Run next dev\n\n  - Local: http://127.0.0.1:1/')
  await sleep(2500)
  const newTabsAfterSecond = (await hostCaps()).filter(id => id.startsWith('browser:') && !beforeTabs.has(id))
  const events2 = await evalJs('window.__adEvents')
  check('T5 per-turn-once (no second tab, no second drive)', newTabsAfterSecond.length === 1 && events2.length === 1, 'tabs=' + JSON.stringify(newTabsAfterSecond) + ' events=' + JSON.stringify(events2))

  // T6：新 user 锚点重置 + 同源 URL → 复用已有标签导航并激活（不新开）
  const resetOk = await resetTurn()
  await sleep(600)
  // URL2 与 URL1 同源（127.0.0.1:51730）不同路径：应复用导航而非新开
  await injectBash('pnpm dev\n\n  VITE ready\n  \u279c  Local:   http://127.0.0.1:51730/?ad=2')
  await sleep(5000)
  const events3 = await evalJs('window.__adEvents')
  check('T5b turn reset via fake user anchor', resetOk === true)
  check('T6b drive event fired after turn reset', Array.isArray(events3) && events3.length === 2 && String(events3[1]).includes('/?ad=2'), JSON.stringify(events3))
  const newTabsAfterThird = (await hostCaps()).filter(id => id.startsWith('browser:') && !beforeTabs.has(id))
  check('T6 same-origin reuse (still one tab)', newTabsAfterThird.length === 1, JSON.stringify(newTabsAfterThird))
  if (newTabsAfterThird.length === 1) {
    const st = await hostState(newTabsAfterThird[0])
    check('T7 tab navigated to same-origin URL', st !== undefined && String(st?.url).includes('/?ad=2'), JSON.stringify(st ?? {}))
  }

  // T7b：同源复用后该浏览器标签被激活（用户直接看到页面）
  await sleep(1500)
  check('T7b same-origin tab activated', await evalJs(`(() => {
    const chips = [...document.querySelectorAll('[data-side-pane-tab-id]')]
    const active = chips.find(c => String(c.className || '').includes('tabActive'))
    return active !== undefined && String(active.getAttribute('data-side-pane-tab-id')).startsWith('browser:')
  })()`))

  // T12：重置轮次后注入前端文件 edit 行 → 驱动到 liveDevUrl（每轮一次，不新开标签）
  await resetTurn()
  await sleep(600)
  await injectFileRow('edit', 'Edit src/App.tsx to fix the button color')
  await sleep(2500)
  const events4 = await evalJs('window.__adEvents')
  check('T12 frontend edit drives to live dev URL', Array.isArray(events4) && events4.length === 3 && String(events4[2]).includes('/?ad=2'), JSON.stringify(events4))
  const newTabsAfterEdit = (await hostCaps()).filter(id => id.startsWith('browser:') && !beforeTabs.has(id))
  check('T12b frontend edit reuses existing tab', newTabsAfterEdit.length === 1, JSON.stringify(newTabsAfterEdit))

  // T14：auto-open-details 驱动审查文件 → 激活 git 标签 + 来源切到「上一轮更改」
  //（用户要求：驱动打开审查面板时直接看模型上一轮改了什么；展开逻辑由
  //  resolveDriveTarget 单测覆盖，headless 无轮次快照故此处验证来源切换）。
  await sleep(1800)
  check('T14 drive switches review source to last-turn', await evalJs(`(() => {
    const active = [...document.querySelectorAll('[data-side-pane-tab-id]')].find(c => String(c.className || '').includes('tabActive'))
    const panel = document.querySelector('[data-liuli-review-panel]')
    const label = panel ? (panel.querySelector('[class*="sourceTriggerLabel"]')?.textContent || '') : ''
    return active !== undefined && active.getAttribute('data-side-pane-tab-id') === 'git' && label === '上一轮更改'
  })()`))

  // T13：非前端文件（README.md）编辑 → 不驱动
  await resetTurn()
  await sleep(600)
  await injectFileRow('write', 'Write README.md with usage notes')
  await sleep(2000)
  const events5 = await evalJs('window.__adEvents')
  check('T13 non-frontend edit does not drive', Array.isArray(events5) && events5.length === 3, JSON.stringify(events5))

  // T15：中文描述（无英文 dev server 词）+ 输出回环 URL → 自动驱动
  //（LLM 常用中文摘要，如「启动本地开发服务器」；URL 出现在行输出里）
  await resetTurn()
  await sleep(600)
  await injectBash('启动本地开发服务器\n\n  \u279c  Local:   http://127.0.0.1:51741/?ad=3')
  await sleep(2500)
  const events6 = await evalJs('window.__adEvents')
  check('T15 chinese summary drives', Array.isArray(events6) && events6.length === 4 && String(events6[3]).includes('/?ad=3'), JSON.stringify(events6))
  const newTabsAfterZh = (await hostCaps()).filter(id => id.startsWith('browser:') && !beforeTabs.has(id))
  // 51741 与之前 51730 是不同端口（不同 dev server）→ 按设计新开标签（总数 2）
  const newestZh = newTabsAfterZh.find(id => !(newTabs1 ?? []).includes(id))
  check('T15b chinese drive opens its own tab', newTabsAfterZh.length === 2 && newestZh !== undefined, JSON.stringify(newTabsAfterZh))
  if (newestZh !== undefined) {
    createdTabs.add(newestZh)
    const st = await hostState(newestZh)
    check('T15c new tab points at 51741', st !== undefined && String(st?.url).includes('51741'), JSON.stringify(st ?? {}))
  }

  // T8：agent CLI --show 等效（POST 引擎标签 browser:show-*）→ 轮询桥接进侧边栏
  const showId = 'browser:show-' + Date.now().toString(36)
  const created = await (await fetch(BASE + '/liuli-browser/tabs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: showId, url: 'https://example.com' }) })).json()
  createdTabs.add(showId)
  check('T8 host tab created for --show', created.ok === true, JSON.stringify(created))
  await sleep(6500) // 轮询 4s + 余量
  const guiIds2 = await guiBrowserTabIds()
  check('T9 --show tab bridged into side pane', Array.isArray(guiIds2) && guiIds2.includes(showId), JSON.stringify(guiIds2))
  // T9b：非 browser:show- 前缀的引擎标签（agent 无头验证/测试残留）不桥接
  const noiseId = 'browser:notshow-' + Date.now().toString(36)
  const noiseCreated = await (await fetch(BASE + '/liuli-browser/tabs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: noiseId, url: 'https://example.com' }) })).json()
  createdTabs.add(noiseId)
  check('T9b noise tab created', noiseCreated.ok === true, JSON.stringify(noiseCreated))
  await sleep(6500) // 等一个完整轮询周期
  const guiIds3 = await guiBrowserTabIds()
  check('T9c non-show tab NOT bridged', Array.isArray(guiIds3) && !guiIds3.includes(noiseId), JSON.stringify(guiIds3))

  // T10：sidebar open for --show tab
  check('T10 sidebar open for --show tab', await panelOpen())

  // T11：页面无异常
  check('T11 no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)))

  const failed = results.filter(r => !r.pass)
  console.log('SUMMARY: ' + String(results.length - failed.length) + '/' + String(results.length) + ' passed')
  if (failed.length > 0) console.log('FAILED: ' + failed.map(f => f.name).join(' | '))
} catch (e) {
  console.log('VERIFY FAIL:', e.message, JSON.stringify(pageErrors.slice(0, 3)))
} finally {
  try { chrome.kill() } catch { /* ignore */ }
  // 清理引擎侧测试标签（GUI 侧是独立临时 profile，随 headless Chrome 消失）
  for (const id of createdTabs) await hostDestroy(id)
  console.log('cleaned engine test tabs: ' + [...createdTabs].join(', ') || '(none)')
}
