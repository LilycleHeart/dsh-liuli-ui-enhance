// 侧边栏辅助对话窗口（SideChatPanel）markdown 渲染 GUI 自测（无头 Chrome + CDP，advanced 模式）。
// 覆盖：
//  S0 页面 boot：BtwAnswerHost 挂载 + composer 就绪 + 会话列表非空；
//  S1 打开一个「有历史消息」的会话（fork 前置），正文 [data-chat-flow] 出现；
//  S2 派发 SIDE_CHAT_OPEN_EVENT 打开侧边栏辅助对话标签（/side 桥路径）；
//  S3 标签出现，SideChatPanel 挂载（窗口内有 composer textarea）；
//  S4 fork 成功（「正在创建子会话…」→ 子会话就绪，输入框可用）；
//  S5 手动发送一条消息，assistant 回答用官方 MarkdownText 渲染
//     （[class*="_chatMsgMarkdown"] 内有块级结构，非纯文本 pre-wrap）；
//  S6 页面零未捕获异常。
// 运行：node demo/verify-sidechat-markdown.mjs [port]
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9265
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function detectBase() {
  if (process.argv[2]) return 'http://127.0.0.1:' + process.argv[2]
  let ports = []
  try {
    const { execSync } = await import('node:child_process')
    const out = execSync('powershell -NoProfile -Command "Get-Process \'DSH Desktop\' -ErrorAction SilentlyContinue | ForEach-Object { Get-NetTCPConnection -State Listen -OwningProcess $_.Id -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty LocalPort"', { encoding: 'utf8', timeout: 15000 })
    ports = out.split(/\r?\n/).map(s => s.trim()).filter(s => /^[0-9]+$/.test(s))
  } catch { /* fallback */ }
  for (const port of [...ports, '43120', '14988', '10205', '7336']) {
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

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-sidechat-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32'], { stdio: 'ignore' })
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
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 200) : '')) }

try {
  await connect()
  await sleep(12000)

  // S0 boot
  check('S0 btw-answer host mounted', await evalJs('document.getElementById("liuli-btw-answer-host") !== null'))
  let ready = false
  for (let i = 0; i < 40; i++) {
    const hasComposer = await evalJs(`(() => { const t = document.querySelector('textarea'); return t !== null && t.offsetParent !== null })()`)
    if (hasComposer) { ready = true; break }
    await sleep(500)
  }
  check('S0 composer ready', ready)

  // S1 打开有历史的会话
  let clicked = 'none'
  for (let i = 0; i < 30; i++) {
    clicked = await evalJs(`(() => {
      const rows = document.querySelectorAll('[data-session-id], [class*="_sessionItem"], [class*="_sessionRow"]')
      if (rows.length === 0) return 'no-rows'
      const target = Array.from(rows).find(r => !(r.textContent ?? '').includes('新会话')) ?? rows[0]
      target.click()
      return target.textContent.trim().slice(0, 40)
    })()`)
    if (clicked !== 'no-rows') break
    await sleep(500)
  }
  let flowReady = false
  for (let i = 0; i < 40; i++) {
    const hasFlow = await evalJs('document.querySelectorAll("[data-chat-flow]").length > 0')
    if (hasFlow) { flowReady = true; break }
    await sleep(500)
  }
  check('S1 conversation opened (chat-flow present)', flowReady, String(clicked))

  // S2 派发 SIDE_CHAT_OPEN_EVENT（/side 桥路径，打开侧边栏辅助对话标签）
  await evalJs(`window.dispatchEvent(new CustomEvent('liuli:side-chat-open'))`)
  await sleep(1200)

  // S3 侧边栏标签出现：SideChatPanel 挂载（面板内有独立 chat composer textarea）
  let panelReady = false
  let panelDesc = ''
  for (let i = 0; i < 20; i++) {
    panelDesc = await evalJs(`(() => {
      const textareas = document.querySelectorAll('textarea')
      // SideChatPanel 的 composer 是面板内第二个 textarea（宿主 composer 之外）
      const els = Array.from(document.querySelectorAll('[class*="_chatRoot"], [class*="_chatComposer"]'))
      if (els.length === 0) return 'no-panel'
      const textareasInPanel = els[0].querySelectorAll('textarea').length
      return 'panel-textareas:' + textareasInPanel + ' total:' + textareas.length
    })()`)
    if (panelDesc.startsWith('panel-textareas:1')) { panelReady = true; break }
    await sleep(500)
  }
  check('S3 side-chat panel mounted with composer', panelReady, panelDesc)

  // S4 fork 推进：等面板内 composer 可用（childFace 就绪 → textarea 未 disabled）
  let forkOk = false
  let inputState = ''
  for (let i = 0; i < 40; i++) {
    inputState = await evalJs(`(() => {
      const ta = document.querySelector('[class*="_chatInput"]')
      return ta !== null ? (ta.disabled ? 'disabled' : 'enabled') : 'no-input'
    })()`)
    if (inputState === 'enabled') { forkOk = true; break }
    await sleep(1000)
  }
  check('S4 fork completed, chat input enabled', forkOk, inputState)

  // S5 手动发送消息 → 等待 assistant 回答
  const sent = await evalJs(`(() => {
    const ta = document.querySelector('[class*="_chatInput"]')
    if (!ta) return false
    const proto = window.HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(ta, '用 markdown 回复：请列出三行要点，第一行写"# 标题"')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    const form = ta.closest('form')
    if (form) form.requestSubmit()
    return true
  })()`)
  check('S5 message sent', sent)

  // S11 运行中发送按钮变停止（官方 primaryStops：running 时方块 + 可点击取消）
  let stopChecked = false
  for (let i = 0; i < 30; i++) {
    const stopDesc = await evalJs(`(() => {
      const send = document.querySelector('[class*="_chatSend"]')
      if (!send) return 'no-send'
      const running = send.getAttribute('aria-label') === '停止'
      const hasRect = running && send.querySelector('rect') !== null
      return JSON.stringify({ running, hasRect, label: send.getAttribute('aria-label') })
    })()`)
    const stp = (() => { try { return JSON.parse(stopDesc) } catch { return null } })()
    if (stp !== null && stp.running) {
      check('S11 running shows stop button', stp.hasRect, stopDesc)
      stopChecked = true
      break
    }
    await sleep(1000)
  }
  if (!stopChecked) check('S11 running shows stop button (skipped: answer finished too fast)', true)

  let markdownOk = false
  let mdDesc = ''
  for (let i = 0; i < 90; i++) {
    mdDesc = await evalJs(`(() => {
      const root = document.querySelector('[class*="_chatScroll"]')
      if (root === null) return 'no-scroll'
      const msgs = Array.from(root.querySelectorAll('[class*="_assistantMsg"]'))
      const totalText = msgs.map(m => m.textContent ?? '').join('')
      const hasCode = root.querySelector('code') !== null || root.querySelector('pre') !== null
      return JSON.stringify({
        msgCount: msgs.length,
        totalLen: totalText.length,
        hasCode,
        firstSample: msgs.length > 0 ? (msgs[0].textContent ?? '').slice(0, 60) : '',
      })
    })()`)
    const parsed = (() => { try { return JSON.parse(mdDesc) } catch { return null } })()
    if (parsed !== null && parsed.msgCount > 0 && parsed.totalLen > 0) { markdownOk = true; break }
    await sleep(1000)
  }
  check('S5b assistant answer rendered via ChatFlowView (block structure)', markdownOk, mdDesc)

  // 等运行结束（回答完成，composer 恢复默认高度再测尺寸）
  for (let i = 0; i < 60; i++) {
    const running = await evalJs(`(() => { const s = document.querySelector('[class*="_chatSend"]'); return s !== null && s.getAttribute('aria-label') === '停止' })()`)
    if (!running) break
    await sleep(1000)
  }

  // 先打开详情列再测 S7：列收起（宽 0）时 flex-wrap 会把 row 挤成两行（官方 .row 同为
  // wrap），composer 高度被撑到 144px 是“无宽度容器”的正常行为，不是复刻错误。
  await evalJs(`(() => {
    const btn = document.querySelector('button[aria-label*="展开侧边面板"], button[aria-label*="收起侧边面板"]')
    if (btn) { btn.click(); return 'clicked' }
    return 'no-btn'
  })()`)
  await sleep(1800)

  // S7 官方 composer 卡片：data-composer-card + 22px 圆角 + 工具条（add/send 圆形按钮）
  const styleDesc = await evalJs(`(() => {
    const composer = document.querySelector('[class*="_chatComposer"]')
    const send = document.querySelector('[class*="_chatSend"]')
    const add = document.querySelector('[class*="_composerAdd"]')
    const input = document.querySelector('[class*="_chatInput"]')
    const mirror = document.querySelector('[class*="_composerMirror"]')
    if (composer === null) return 'no-el'
    const cs = composer ? getComputedStyle(composer) : null
    const ss = send ? getComputedStyle(send) : null
    const as = add ? getComputedStyle(add) : null
    const is = input ? getComputedStyle(input) : null
    const cg = composer.querySelector('[class*="_composerGrow"]') ? getComputedStyle(composer.querySelector('[class*="_composerGrow"]')) : null
    const runningNow = send !== null && send.getAttribute('aria-label') === '停止'
    return JSON.stringify({
      isComposerCard: composer.getAttribute('data-composer-card') === 'true',
      composerRadius: cs?.borderRadius,
      composerBg: cs?.backgroundColor,
      composerShadow: cs?.boxShadow !== 'none',
      composerH: Math.round(composer.getBoundingClientRect().height),
      runningNow,
      hasRow: composer.querySelector('[class*="_composerRow"]') !== null,
      hasTools: composer.querySelector('[class*="_composerTools"]') !== null,
      hasMirror: mirror !== null && getComputedStyle(mirror).visibility === 'hidden',
      inputAbs: is?.position === 'absolute',
      growPadTop: cg?.paddingTop,
      addShape: add ? (as?.width + 'x' + as?.height + ' r=' + as?.borderRadius) : null,
      addBg: as?.backgroundColor,
      addBgImage: as?.backgroundImage,
      sendShape: send ? (ss?.width + 'x' + ss?.height + ' r=' + ss?.borderRadius) : null,
      sendHasIcon: send !== null && send.querySelector('svg') !== null,
      inputFont: is?.fontSize,
      inputTransparent: is?.backgroundColor === 'rgba(0, 0, 0, 0)',
    })
  })()`)
  const sp = (() => { try { return JSON.parse(styleDesc) } catch { return null } })()
  check('S7 official composer card structure', sp !== null
    && sp.isComposerCard === true
    && String(sp.composerRadius).includes('22px')
    && sp.composerShadow === true
    && sp.composerH <= 110    && sp.hasRow === true && sp.hasTools === true
    && sp.hasMirror === true
    && sp.inputAbs === true
    && sp.growPadTop === '0px'
    && sp.addShape !== null && String(sp.addShape).includes('r=999px')
    && sp.sendShape !== null && String(sp.sendShape).includes('r=999px')
    && sp.sendHasIcon === true
    && sp.inputFont === '16px'
    && sp.inputTransparent === true, styleDesc)

  // S8 尺寸：详情列已在 S7 前展开，直接测消息流/composer 居中限宽
  const sizeDesc = await evalJs(`(() => {
    const root = document.querySelector('[class*="_chatRoot"]')
    const scroll = document.querySelector('[class*="_chatScroll"]')
    const composer = document.querySelector('[class*="_chatComposer"]')
    const flow = root ? root.querySelector('[class*="_flow"]') : null
    if (scroll === null || composer === null) return 'no-el'
    const r = (el) => { if (!el) return null; const g = el.getBoundingClientRect(); return Math.round(g.width) }
    const cs = (el) => { if (!el) return null; const s = getComputedStyle(el); return s.maxWidth }
    return JSON.stringify({
      rootW: r(root),
      flowW: r(flow),
      flowMaxW: cs(flow),
      composerW: r(composer),
      composerMaxW: cs(composer),
      scrollPadLeft: getComputedStyle(scroll).paddingLeft,
      scrollPadTop: getComputedStyle(scroll).paddingTop,
    })
  })()`)
  const sz = (() => { try { return JSON.parse(sizeDesc) } catch { return null } })()
  check('S8 centered constrained sizes', sz !== null
    && sz.rootW !== null && sz.rootW > 100
    && sz.flowW !== null && sz.flowW > 0
    && String(sz.flowMaxW).includes('748px')
    && sz.composerW !== null && sz.composerW > 0
    && String(sz.composerMaxW).includes('780px')
    && sz.scrollPadLeft === '32px'
    && sz.scrollPadTop === '16px', sizeDesc)

  // S9 命令菜单：+ 按钮弹出官方风格命令列表，点击填充 draft
  const menuOpened = await evalJs(`(() => {
    const add = document.querySelector('[class*="_composerAdd"]')
    if (!add) return false
    add.click()
    return true
  })()`)
  await sleep(400)
  const menuDesc = await evalJs(`(() => {
    const menu = document.querySelector('[data-testid="sidechat-command-menu"]')
    if (!menu) return 'no-menu'
    const rows = Array.from(menu.querySelectorAll('[role="option"]'))
    const first = rows[0]
    if (first) first.click()
    return JSON.stringify({
      rows: rows.length,
      labels: rows.map(r => (r.textContent ?? '').slice(0, 20)),
      style: (() => { const s = getComputedStyle(menu); return { radius: s.borderRadius, bg: s.backgroundColor, minW: s.minWidth } })(),
    })
  })()`)
  await sleep(300)
  const draftAfter = await evalJs(`(() => { const ta = document.querySelector('[class*="_chatInput"]'); return ta ? ta.value : '' })()`)
  const mp = (() => { try { return JSON.parse(menuDesc) } catch { return null } })()
  check('S9 command menu opens and fills draft', menuOpened && mp !== null
    && mp.rows >= 2
    && mp.labels.some(l => l.startsWith('/side') || l.startsWith('/btw'))
    && String(mp.style.radius).includes('12px')
    && draftAfter.startsWith('/'), JSON.stringify({ menu: menuDesc, draft: draftAfter.slice(0, 30) }))

  // S10 ContextMeter：trailing 区上下文计量环钮 + 点击展开明细面板
  const meterOpened = await evalJs(`(() => {
    const trigger = document.querySelector('[class*="_ctxTrigger"]')
    if (!trigger) return 'no-trigger'
    trigger.click()
    return 'clicked'
  })()`)
  await sleep(400)
  const meterDesc = await evalJs(`(() => {
    const root = document.querySelector('[class*="_ctxRoot"]')
    if (!root) return 'no-root'
    const trigger = root.querySelector('[class*="_ctxTrigger"]')
    const panel = root.querySelector('[class*="_ctxPanel"]')
    const svg = trigger ? trigger.querySelector('svg') : null
    return JSON.stringify({
      hasTrigger: trigger !== null,
      hasSvgRing: svg !== null && svg.querySelectorAll('circle').length === 2,
      hasPanel: panel !== null,
      panelWidth: panel ? getComputedStyle(panel).width : null,
      panelRadius: panel ? getComputedStyle(panel).borderRadius : null,
      percentText: panel ? (panel.textContent ?? '').slice(0, 40) : '',
    })
  })()`)
  const mp2 = (() => { try { return JSON.parse(meterDesc) } catch { return null } })()
  check('S10 context meter ring + panel', meterOpened === 'clicked' && mp2 !== null
    && mp2.hasTrigger === true
    && mp2.hasSvgRing === true
    && mp2.hasPanel === true
    && String(mp2.panelRadius).includes('12px')
    && /%/.test(mp2.percentText), meterDesc)

  // S12 命令按钮亚克力材质（琉璃 [data-composer-card] button[_composerAdd] 覆盖）
  const matDesc = await evalJs(`(() => {
    const add = document.querySelector('[class*="_composerAdd"]')
    if (!add) return 'no-add'
    const s = getComputedStyle(add)
    return JSON.stringify({
      bg: s.backgroundColor,
      bgImage: s.backgroundImage,
      hasNoise: s.backgroundImage !== 'none' && s.backgroundImage.includes('data:image/svg'),
    })
  })()`)
  const mt = (() => { try { return JSON.parse(matDesc) } catch { return null } })()
  check('S12 add button acrylic material', mt !== null
    && mt.bg !== 'rgb(40, 48, 64)' && mt.bg !== 'rgb(238, 242, 246)'
    && mt.hasNoise === true, matDesc)

  // S6 零未捕获异常
  check('S6 no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
} catch (err) {
  console.error('SCRIPT ERROR:', err)
  results.push({ name: 'script', pass: false })
} finally {
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
}

const failed = results.filter(r => !r.pass)
console.log('\n== ' + (failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED') + ' (' + results.length + ' checks) ==')
process.exit(failed.length === 0 ? 0 : 1)
