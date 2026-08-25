// /btw 正文回答卡片 GUI 自测（无头 Chrome + CDP，advanced 模式）。
// compatibility 模式下 layout 服务不激活、插件 boot 失败，因此走 advanced。
// 覆盖：
//  B0 页面 boot：BtwAnswerHost 挂载 + composer 就绪；
//  B1 打开一个「有历史消息」的会话（fork 要求源会话有 completed turn），
//     正文 [data-chat-flow] 出现；无有内容会话时标记 skipped；
//  B2 派发 BTW_ANSWER_EVENT 后正文滚动容器内出现 [data-liuli-btw-answer-list]；
//  B3 卡片出现，标题「⚡ 辅助回答」+ 问题文本；
//  B4 卡片 fork 状态推进（「回答中…」/「已完成」= 真实 fork 成功；「创建失败」= 空会话边界）；
//  B5 fork 成功时回答文本最终非空（流式/落盘）；fork 失败时失败提示清晰；
//  B5b 回答卡片确实在正文滚动容器内（宽度 > 50）；
//  B6 关闭按钮可移除卡片；
//  B7 可再次开卡（第二张）；
//  B8 页面零未捕获异常。
// 运行：node demo/verify-btw-answer.mjs [port]
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9257
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

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-btw-answer-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32'], { stdio: 'ignore' })
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

let turnDone = false
try {
  await connect()

  // B0 等待 boot + composer + host（至少 8s，等会话列表渲染）
  let ready = false
  for (let i = 0; i < 60; i++) {
    const hasComposer = await evalJs(`(() => { const t = document.querySelector('textarea'); return t !== null && t.offsetParent !== null })()`)
    const hostMounted = await evalJs('document.getElementById("liuli-btw-answer-host") !== null')
    if (hasComposer && hostMounted && i >= 6) { ready = true; break }
    await sleep(1000)
  }
  check('B0 composer + btw host ready', ready)

  // B1 等待会话列表渲染，点击「有历史消息」的会话行（跳过“新会话”）
  let clicked = 'none'
  for (let i = 0; i < 30; i++) {
    clicked = await evalJs(`(() => {
      const rows = document.querySelectorAll('[data-session-id], [class*="_sessionItem"], [class*="_sessionRow"]')
      if (rows.length === 0) return 'no-rows'
      const target = Array.from(rows).find(r => !(r.textContent ?? '').includes('新会话'))
        ?? Array.from(rows).find(r => !r.className.includes('selected') && !r.getAttribute('aria-selected'))
        ?? rows[0]
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
  check('B1 conversation opened (chat-flow present)', flowReady, String(clicked))

  // B1b 判断该会话是否已有 completed turn（消息列有 assistant 消息）
  for (let i = 0; i < 20; i++) {
    turnDone = await evalJs(`(() => {
      const rows = document.querySelectorAll('[data-chat-anchor-key][data-chat-flow-kind="assistant"]')
      return rows.length > 0 && rows[rows.length - 1].textContent.trim() !== ''
    })()`)
    if (turnDone) break
    await sleep(500)
  }
  console.log('B1b source session has completed turn: ' + turnDone)

  // B2 派发 BTW_ANSWER_EVENT（模拟 /btw 桥）
  const question = '用一句话回答：什么是 DSH？'
  await evalJs(`window.dispatchEvent(new CustomEvent('liuli:btw-answer', { detail: { question: ${JSON.stringify(question)} } }))`)
  await sleep(1500)

  // B2 卡片容器挂在 [data-chat-flow] 内（消息流内部，与消息同列）
  check('B2 answer list inside chat-flow', await evalJs(`(() => {
    const flow = document.querySelector('[data-chat-flow]')
    return flow !== null && flow.querySelector('[data-liuli-btw-answer-list]') !== null
  })()`))

  check('B2b list is a direct child of chat-flow', await evalJs(`(() => {
    const flow = document.querySelector('[data-chat-flow]')
    const list = flow !== null ? flow.querySelector('[data-liuli-btw-answer-list]') : null
    return list !== null && list.parentElement === flow
  })()`))

  check('B3 card rendered with badge', await evalJs(`(() => {
    const card = document.querySelector('[data-liuli-btw-answer]')
    return card !== null && card.textContent.includes('⚡ 辅助回答')
  })()`))

  check('B3b question shown in card', await evalJs(`(() => {
    const card = document.querySelector('[data-liuli-btw-answer]')
    return card !== null && card.textContent.includes('DSH')
  })()`))

  // B4 fork + prompt 推进
  let forkOk = false
  let lastStatus = ''
  for (let i = 0; i < 40; i++) {
    lastStatus = await evalJs(`(() => { const s = document.querySelector('[data-liuli-btw-answer] [class*="_status"]'); return s ? s.textContent.trim() : '' })()`)
    if (lastStatus.includes('回答中') || lastStatus.includes('已完成') || lastStatus.includes('创建失败')) { forkOk = true; break }
    await sleep(1000)
  }
  check('B4 fork progressed to terminal state (status: ' + lastStatus + ')', forkOk, lastStatus)
  const forkFailed = lastStatus.includes('创建失败')

  // B5 回答文本：fork 成功（状态非「创建失败」）时等流式/落盘文本；
  // fork 失败（空会话边界）时验证失败提示清晰。
  let answerText = ''
  if (!forkFailed) {
    for (let i = 0; i < 120; i++) {
      answerText = await evalJs(`(() => { const a = document.querySelector('[data-liuli-btw-answer] [class*="_answer"]'); return a ? a.textContent.trim() : '' })()`)
      if (answerText !== '' && !answerText.startsWith('（回答为空）') && !answerText.startsWith('…')) break
      await sleep(1000)
    }
    check('B5 answer text non-empty', answerText !== '' && !answerText.startsWith('（回答为空）'), answerText.slice(0, 120))
    // B5c 回答正文用官方 MarkdownText 渲染（段落/代码块结构），不是纯文本节点
    if (answerText !== '' && !answerText.startsWith('（回答为空）')) {
      const md = await evalJs(`(() => {
        const a = document.querySelector('[data-liuli-btw-answer] [class*="_answer"]')
        if (!a) return 'no-answer-el'
        const children = Array.from(a.children)
        return JSON.stringify({
          childCount: children.length,
          childTags: children.slice(0, 4).map(c => c.tagName + (c.className ? '.' + String(c.className).slice(0, 30) : '')),
          hasPre: a.querySelector('pre') !== null,
          hasCode: a.querySelector('code') !== null,
        })
      })()`)
      const parsed = (() => { try { return JSON.parse(md) } catch { return null } })()
      check('B5c answer rendered via MarkdownText (block structure)', parsed !== null && parsed.childCount > 0, md)
    } else {
      check('B5c answer rendered via MarkdownText (no answer to inspect, skipped)', true)
    }
  } else {
    const errShown = await evalJs(`(() => {
      const card = document.querySelector('[data-liuli-btw-answer]')
      return card !== null && /创建失败|no completed turn/.test(card.textContent)
    })()`)
    check('B5 fork-failure message shown (empty-session edge)', errShown)
  }

  // B5b 卡片确实在消息列内（随消息流布局）
  check('B5b card inside chat-flow', await evalJs(`(() => {
    const flow = document.querySelector('[data-chat-flow]')
    const card = flow !== null ? flow.querySelector('[data-liuli-btw-answer]') : null
    return card !== null && card.getBoundingClientRect().width > 50
  })()`))

  // B6 关闭按钮移除卡片
  await evalJs(`(() => { const b = document.querySelector('[data-liuli-btw-answer] button[class*="_close"]'); if (b) b.click(); return true })()`)
  await sleep(500)
  check('B6 close removes card', await evalJs('document.querySelector("[data-liuli-btw-answer]") === null'))

  // B7 再开一张
  await evalJs(`window.dispatchEvent(new CustomEvent('liuli:btw-answer', { detail: { question: '第二问' } }))`)
  await sleep(800)
  const hadCard = await evalJs('document.querySelector("[data-liuli-btw-answer]") !== null')
  check('B7 second card opens', hadCard)

  // B8 页面零未捕获异常
  check('B8 no uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '))
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
