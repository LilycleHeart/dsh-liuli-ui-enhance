// 会话 header 视图标签滑动指示条 GUI 自测（v2，精确匹配 wSkVaW_tabs）
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9302
const BASE = process.argv[2] ? 'http://127.0.0.1:' + process.argv[2] : 'http://127.0.0.1:2050'
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-tabind2-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32'], { stdio: 'ignore' })
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
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push(String(m.params.exceptionDetails?.exception?.description ?? 'x').slice(0, 200))
  }
  await send('Runtime.enable')
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
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 200) : '')) }

const TABS_QRY = '[class*="wSkVaW_tabs"]'
const TAB_QRY = '[class*="wSkVaW_tab"]'
const BAR_QRY = '[data-liuli-tab-indicator]'

try {
  await connect()
  await sleep(15000)

  // 打开会话直到 tabs 出现
  let found = false
  for (let i = 0; i < 10; i++) {
    found = await evalJs('document.querySelector(' + JSON.stringify(TABS_QRY) + ') !== null')
    if (found) break
    await evalJs(`(() => { const all = Array.from(document.querySelectorAll('[role="treeitem"], [class*="_sessionRow"]')); const hit = all.find(el => (el.textContent || '').includes('对话和轨迹')) || all.find(el => (el.textContent || '').trim().length > 0 && el.getBoundingClientRect().width > 0); if (hit) { hit.click(); return true } return false })()`)
    await sleep(2000)
  }
  check('T1 header tabs row present', found)

  if (found) {
    // T2 官方横条透明化（激活 tab 的 ::after 也不应有背景色）
    const officialBar = await evalJs('(() => { const tabs = document.querySelector(' + JSON.stringify(TABS_QRY) + '); if (!tabs) return null; const tab = tabs.querySelector(' + JSON.stringify(TAB_QRY + '[class*="tabActive"]') + '); if (!tab) return null; const after = getComputedStyle(tab, "::after"); return { bg: after.backgroundColor } })()')
    check('T2 official ::after hidden', officialBar && (officialBar.bg === 'rgba(0, 0, 0, 0)' || officialBar.bg === 'transparent'), JSON.stringify(officialBar))

    // T3 注入的指示条存在且定位正确
    const barInfo = await evalJs('(() => { const tabs = document.querySelector(' + JSON.stringify(TABS_QRY) + '); const bar = tabs?.querySelector(' + JSON.stringify(BAR_QRY) + '); if (!bar) return null; const r = bar.getBoundingClientRect(); const active = tabs.querySelector("[class*=\'tabActive\'], [aria-selected=\'true\']"); const ar = active?.getBoundingClientRect(); const cs = getComputedStyle(bar); return { exists: true, barX: r.x, barW: r.width, barH: r.height, activeX: ar?.x, activeW: ar?.width, transition: cs.transitionProperty, bg: cs.backgroundColor } })()')
    check('T3 indicator injected', barInfo && barInfo.exists, JSON.stringify(barInfo))
    check('T3b indicator under active tab', barInfo && barInfo.activeX !== undefined && Math.abs(barInfo.barX - barInfo.activeX) < 2 && Math.abs(barInfo.barW - barInfo.activeW) < 2, JSON.stringify(barInfo))
    check('T3c indicator animatable', barInfo && (barInfo.transition || '').includes('transform'), JSON.stringify(barInfo))

    // T4 切换视图：点击另一个 tab，指示条应位移
    const before = await evalJs('(() => { const tabs = document.querySelector(' + JSON.stringify(TABS_QRY) + '); const bar = tabs.querySelector(' + JSON.stringify(BAR_QRY) + '); return bar ? getComputedStyle(bar).transform : null })()')
    const clicked = await evalJs('(() => { const tabs = document.querySelector(' + JSON.stringify(TABS_QRY) + '); const tabsList = Array.from(tabs.querySelectorAll(' + JSON.stringify(TAB_QRY) + ')); const activeIdx = tabsList.findIndex(t => t.classList.contains("tabActive") || t.getAttribute("aria-selected") === "true"); if (activeIdx < 0 || tabsList.length < 2) return "single"; const target = tabsList[(activeIdx + 1) % tabsList.length]; target.click(); return "clicked:" + target.textContent })()')
    check('T4 clicked other tab', typeof clicked === 'string' && clicked.startsWith('clicked'), String(clicked))
    await sleep(1200)
    const after = await evalJs('(() => { const tabs = document.querySelector(' + JSON.stringify(TABS_QRY) + '); const bar = tabs?.querySelector(' + JSON.stringify(BAR_QRY) + '); if (!bar) return null; const active = tabs.querySelector("[class*=\'tabActive\'], [aria-selected=\'true\']"); const ar = active?.getBoundingClientRect(); const r = bar.getBoundingClientRect(); return { transform: getComputedStyle(bar).transform, barX: r.x, activeX: ar?.x, activeText: active?.textContent } })()')
    check('T4b indicator moved', after && before !== null && after.transform !== before, JSON.stringify({ before, after }))
    check('T4c indicator at new active', after && after.activeX !== undefined && Math.abs(after.barX - after.activeX) < 2, JSON.stringify(after))
  }
} catch (err) {
  console.log('ERROR ' + (err instanceof Error ? err.message : String(err)))
  pageErrors.forEach(e => console.log('PAGEERR ' + e))
} finally {
  try { await evalJs('window.close()') } catch {}
  chrome.kill()
}

const failed = results.filter(r => !r.pass)
console.log('\n' + results.length + ' checks, ' + failed.length + ' failed')
if (pageErrors.length) { console.log('page errors:'); pageErrors.slice(0, 5).forEach(e => console.log('  ' + e)) }
process.exit(failed.length ? 1 : 0)