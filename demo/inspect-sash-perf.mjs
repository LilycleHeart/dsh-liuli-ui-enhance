// 探测 + 测速：长对话下 sash 拖拽掉帧基线（修复前后复测对比用）。
// 无头环境 rAF 帧率不稳定，因此主指标用「强制布局探针」：
// 每帧拖拽 = 改一次 details 宽度 + 一次布局提交，探针精确测量该成本。
// 另外用克隆 flowItem 的方式把对话放大到指定规模，模拟「轮数多」。
// 用法: node inspect-sash-perf.mjs [端口] [目标flowItem数] [标签]
import { spawn, execSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9530 + (process.pid % 60)
const TARGET_ITEMS = Number(process.argv[3] ?? 360)
const LABEL = process.argv[4] ?? 'run'

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
console.error('host:', BASE)

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
  '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-sashperf-' + process.pid),
  '--remote-debugging-port=' + String(CDP_PORT),
  '--window-size=1680,980',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let ws = null, sendId = 0
const pending = new Map()

async function connect() {
  let list = []
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json')).json(); if (list.some(t => t.type === 'page')) break } catch { /* retry */ }
    await sleep(500)
  }
  const pages = list.filter(t => t.type === 'page')
  const target = pages.find(t => t.url && t.url.startsWith(BASE)) ?? pages[0]
  if (!target) throw new Error('no page target')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id) }
  }
  await send('Runtime.enable')
  await send('Page.enable')
  // 在任何页面脚本之前拦截 ResizeObserver：记录每个 RO 回调耗时与注册堆栈，
  // 用于定位拖拽期间的大块 RO 回调属于哪个模块。
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const RO = ResizeObserver
    function InstrumentedRO(callback) {
      const stack = (new Error()).stack || ''
      const wrapped = (entries, observer) => {
        const t0 = performance.now()
        try { return callback(entries, observer) }
        finally {
          const dur = performance.now() - t0
          if (dur > 3) {
            const target = entries[0]?.target
            (window.__roTrace ??= []).push({
              at: Math.round(t0),
              dur: Math.round(dur),
              n: entries.length,
              tgt: target ? (target.tagName + '.' + String(target.className).slice(0, 40) + (target.getAttribute('data-produced-files-row') !== null ? '[pfrow]' : '')) : '?',
              stack: stack.split('\\n').slice(2, 4).join(' | ').slice(0, 200),
            })
            if (window.__roTrace.length > 800) window.__roTrace.shift()
          }
        }
      }
      return new RO(wrapped)
    }
    InstrumentedRO.prototype = RO.prototype
    window.ResizeObserver = InstrumentedRO
    // rAF 归因：记录 >8ms 的回调耗时与注册堆栈
    const origRaf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb) => {
      const stack = (new Error()).stack || ''
      return origRaf((t) => {
        const t0 = performance.now()
        try { return cb(t) }
        finally {
          const dur = performance.now() - t0
          if (dur > 8) {
            (window.__rafTrace ??= []).push({ at: Math.round(t0), dur: Math.round(dur), stack: stack.split('\\n').slice(2, 4).join(' | ').slice(0, 160) })
            if (window.__rafTrace.length > 500) window.__rafTrace.shift()
          }
        }
      })
    }
  })()` })
  await send('Page.navigate', { url: BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32' })
}
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++sendId
    pending.set(id, { res, rej })
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' timeout')) } }, 60000)
    ws.send(JSON.stringify({ id, method, params }))
  })
}
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 300) }
  return r?.result?.value
}

try {
  await connect()
  let mounted = false
  for (let i = 0; i < 60; i++) {
    const hit = await evalJs('document.querySelector("[data-testid=dock-shell]") !== null && !!window.__liuliDockShell__')
    if (hit === true) { mounted = true; break }
    await sleep(1000)
  }
  if (!mounted) throw new Error('dock shell not mounted')

  // 找侧栏里「最长的」会话：逐个点开数 flowItem（最多试 10 个）
  let best = { items: -1, idx: -1 }
  for (let i = 0; i < 10; i++) {
    const clicked = await evalJs(`(() => {
      const rows = Array.from(document.querySelectorAll('[role="treeitem"], [class*="_sessionRow"]'))
        .filter(el => (el.textContent || '').trim().length > 0 && el.getBoundingClientRect().width > 0)
      const hit = rows[` + i + `]
      if (!hit) return false
      hit.click()
      return true
    })()`)
    if (clicked !== true) break
    await sleep(2200)
    const n = await evalJs('(() => { const f = document.querySelector("[data-chat-flow]"); return f ? f.children.length : -1 })()')
    if (typeof n === 'number' && n > best.items) best = { items: n, idx: i }
    if (best.items >= TARGET_ITEMS) break
  }
  // 回到最长的会话
  if (best.idx > 0) {
    await evalJs(`(() => {
      const rows = Array.from(document.querySelectorAll('[role="treeitem"], [class*="_sessionRow"]'))
        .filter(el => (el.textContent || '').trim().length > 0 && el.getBoundingClientRect().width > 0)
      rows[` + best.idx + `]?.click()
      return true
    })()`)
    await sleep(2500)
  }

  // 预载历史（点 older 按钮）直到足够或没有更多
  for (let i = 0; i < 60; i++) {
    const n = await evalJs('(() => { const f = document.querySelector("[data-chat-flow]"); return f ? f.children.length : -1 })()')
    if (n >= TARGET_ITEMS) break
    const clicked = await evalJs(`(() => {
      const b = document.querySelector('[data-conversation-scroll] [class*="older"] button') ?? document.querySelector('[class*="older"] button')
      if (!b || b.disabled) return 'no-btn'
      b.click()
      return 'clicked'
    })()`)
    if (clicked !== 'clicked') break
    await sleep(800)
  }

  // 克隆放大到 TARGET_ITEMS（模拟长对话；克隆节点布局成本与真实一致）
  const cloned = await evalJs(`(() => {
    const flow = document.querySelector('[data-chat-flow]')
    if (!flow) return -1
    const have = flow.children.length
    if (have <= 0) return -2
    const items = Array.from(flow.children)
    let added = 0
    for (let round = 0; flow.children.length < ` + TARGET_ITEMS + ` && round < 20; round++) {
      for (const src of items) {
        if (flow.children.length >= ` + TARGET_ITEMS + `) break
        const copy = src.cloneNode(true)
        copy.removeAttribute('data-chat-anchor-key')
        flow.appendChild(copy)
        added++
      }
    }
    return { before: have, after: flow.children.length, added }
  })()`)
  await sleep(1500) // 等 MutationObserver 相关副作用稳定

  const domStats = await evalJs(`(() => {
    const s = document.querySelector('[data-conversation-scroll]')
    const f = document.querySelector('[data-chat-flow]')
    return {
      flowItems: f ? f.children.length : -1,
      elementsInScroll: s ? s.querySelectorAll('*').length : -1,
      scrollHeight: s ? s.scrollHeight : -1,
    }
  })()`)

  // 打开 details 列，使最右 sash 出现
  await evalJs('window.__liuliDockShell__.openDetails()')
  await sleep(1500)

  const sash = await evalJs(`(() => {
    const sashes = Array.from(document.querySelectorAll('[data-testid="dock-sash"]'))
    if (sashes.length === 0) return null
    const hit = sashes.reduce((a, b) => (b.getBoundingClientRect().x > a.getBoundingClientRect().x ? b : a))
    const r = hit.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, side: hit.getAttribute('data-side') }
  })()`)
  if (sash === null) throw new Error('no sash found')

  // ── 探针 1：强制布局成本（= 拖拽每帧的核心成本）──
  // 模拟 beginSash 的直写路径：改 details shard 的 flex-basis 后强制布局，重复取中位数。
  const layoutProbe = await evalJs(`(() => {
    const sash = Array.from(document.querySelectorAll('[data-testid="dock-sash"]'))
      .reduce((a, b) => (b.getBoundingClientRect().x > a.getBoundingClientRect().x ? b : a))
    const splitBox = sash.parentElement
    const shards = Array.from(splitBox.children).filter(el => el !== sash && el.style.flexBasis !== undefined)
    // 找到 details shard（固定宽度那个：flexGrow 为 0）
    const detShard = shards.find(el => getComputedStyle(el).flexGrow === '0') ?? shards[shards.length - 1]
    if (!detShard) return { err: 'no details shard' }
    const base = Number.parseFloat(getComputedStyle(detShard).flexBasis) || detShard.getBoundingClientRect().width
    const samples = []
    for (let i = 0; i < 24; i++) {
      const w = base + (i % 2 === 0 ? 3 : -3) + i * 0.5
      const t0 = performance.now()
      detShard.style.flexBasis = w + 'px'
      document.body.offsetWidth // 强制布局提交
      samples.push(performance.now() - t0)
    }
    samples.sort((a, b) => a - b)
    detShard.style.flexBasis = base + 'px'
    document.body.offsetWidth
    return {
      median: samples[Math.floor(samples.length / 2)].toFixed(2),
      p90: samples[Math.floor(samples.length * 0.9)].toFixed(2),
      max: samples[samples.length - 1].toFixed(2),
    }
  })()`)

  // ── 疑点验证：TurnRail 式扫描成本 + LoAF 归因 ──
  const culprit = await evalJs(`(() => {
    const s = document.querySelector('[data-conversation-scroll]')
    if (!s) return { err: 'no scroll' }
    // 模拟 TurnRail follow-update：每轮一次全量 querySelectorAll + getClientRects
    const anchorCount = s.querySelectorAll('[data-chat-anchor-key]').length
    const turns = Math.max(8, Math.min(80, anchorCount))
    let t0 = performance.now()
    for (let i = 0; i < turns; i++) {
      const rows = s.querySelectorAll('[data-chat-anchor-key]')
      for (const r of rows) { if (r.dataset.chatAnchorKey === '__never__') r.getClientRects() }
    }
    const turnRailScanMs = performance.now() - t0
    return { anchorCount, turns, turnRailScanMs: turnRailScanMs.toFixed(1), perFrameEstimate: (turnRailScanMs).toFixed(1) }
  })()`)

  // ── 假设验证：冻结产物行宽度 → 其 RO 不再触发 ──
  const FREEZE = process.argv[5] === 'freeze'
  const CV = process.argv[5] === 'cv'
  if (CV) {
    await evalJs(`(() => {
      const st = document.createElement('style')
      st.textContent = '[data-chat-flow] > * { content-visibility: auto; contain-intrinsic-size: auto 300px; }'
      document.head.appendChild(st)
      return true
    })()`)
    await sleep(800)
    console.error('content-visibility applied')
  }
  if (FREEZE) {
    const froze = await evalJs(`(() => {
      const rows = Array.from(document.querySelectorAll('[data-produced-files-row]'))
      window.__frozenRows = []
      for (const el of rows) {
        const w = el.getBoundingClientRect().width
        if (!Number.isFinite(w) || w <= 0) continue
        window.__frozenRows.push({ el, width: el.style.width })
        el.style.width = w + 'px'
      }
      return window.__frozenRows.length
    })()`)
    console.error('frozen rows:', froze)
  }

  // ── 探针 2：真实拖拽 + longtask + LoAF 归因 ──
  await evalJs('(() => { window.__long = []; window.__loaf = []; try { const po = new PerformanceObserver(l => { for (const e of l.getEntries()) { window.__long.push({ at: e.startTime, dur: e.duration }); const scripts = (e.scripts ?? []).map(sc => ({ fn: sc.invoker, dur: sc.duration.toFixed(0) })).filter(x => x.dur > 5); if (scripts.length) window.__loaf.push({ at: e.startTime.toFixed(0), dur: e.duration.toFixed(0), scripts }) } }); po.observe({ entryTypes: ["long-animation-frame"] }); window.__po = po } catch { try { const po2 = new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push({ at: e.startTime, dur: e.duration }) }); po2.observe({ entryTypes: ["longtask"] }); window.__po = po2 } catch {} } })()')
  await sleep(300)
  const t0 = Date.now()
  const dragStartPerf = await evalJs('performance.now()')
  const downAt = await evalJs('(() => { const el = document.elementFromPoint(' + sash.x + ', ' + sash.y + '); const t = el && el.closest ? (el.closest(\'[data-testid="dock-sash"]\') ?? el) : el; t.dispatchEvent(new PointerEvent("pointerdown", { clientX: ' + sash.x + ', clientY: ' + sash.y + ', bubbles: true, cancelable: true, button: 0, pointerId: 1, pointerType: "mouse" })); return performance.now() })()')
  await sleep(80)
  const steps = 48
  const dx = 240
  const blurSamples = []
  for (let i = 1; i <= steps; i++) {
    const cx = sash.x + dx * i / steps
    await evalJs('window.dispatchEvent(new PointerEvent("pointermove", { clientX: ' + cx + ', clientY: ' + sash.y + ', bubbles: true, pointerId: 1, pointerType: "mouse" }))')
    if (i === 2 || i === 24 || i === 46) {
      blurSamples.push(await evalJs('({ resizing: document.body.hasAttribute("data-liuli-resizing"), blurOff: document.body.hasAttribute("data-liuli-blur-off"), blur: getComputedStyle(document.body).getPropertyValue("--liuli-material-blur").trim(), inline: document.body.style.getPropertyValue("--liuli-material-blur").trim() })'))
    }
    await sleep(12)
  }
  const upAt = await evalJs('(() => { window.dispatchEvent(new PointerEvent("pointerup", { clientX: ' + (sash.x + dx) + ', clientY: ' + sash.y + ', bubbles: true, pointerId: 1, pointerType: "mouse" })); return performance.now() })()')
  await sleep(500)
  blurSamples.push(await evalJs('({ phase: "after-release", resizing: document.body.hasAttribute("data-liuli-resizing"), blurOff: document.body.hasAttribute("data-liuli-blur-off"), blur: getComputedStyle(document.body).getPropertyValue("--liuli-material-blur").trim(), inline: document.body.style.getPropertyValue("--liuli-material-blur").trim() })'))
  await sleep(200)
  const long = await evalJs('(() => { const L = window.__long; const total = L.reduce((a,b)=>a+b.dur,0); return { count: L.length, total: total.toFixed(0), max: Math.max(0, ...L.map(x=>x.dur)).toFixed(0) } })()')
  // 按相位归因：down 前 250ms / move 段 / up 之后
  const phaseLong = await evalJs(`(() => {
    const L = window.__long
    const down = ` + downAt + `, up = ` + upAt + `
    const pick = (from, to) => L.filter(x => x.at >= from && x.at <= to)
    const seg = (list) => ({ n: list.length, total: list.reduce((a,b)=>a+b.dur,0).toFixed(0), max: Math.max(0, ...list.map(x=>x.dur)).toFixed(0), items: list.map(x => ({ at: Math.round(x.at - down), dur: Math.round(x.dur) })) })
    return { downPhase: seg(pick(down - 5, down + 250)), movePhase: seg(pick(down + 250, up - 5)), upPhase: seg(pick(up - 5, up + 2000)) }
  })()`)
  if (FREEZE) await evalJs('(() => { for (const f of (window.__frozenRows ?? [])) f.el.style.width = f.width; return true })()')

  // RO 回调归因（仅拖拽窗口内，按注册堆栈首帧聚合，含目标样本）
  const roTrace = await evalJs('window.__roTrace ?? []')
  const roGroups = new Map()
  const dragWindow = []
  for (const t of Array.isArray(roTrace) ? roTrace : []) {
    if (t.at >= dragStartPerf - 50) dragWindow.push(t)
    const key = String(t.stack).split(' | ')[0] || '(unknown)'
    const g = roGroups.get(key) ?? { key, calls: 0, totalMs: 0, maxMs: 0, targets: new Set() }
    g.calls += 1
    g.totalMs += t.dur
    g.maxMs = Math.max(g.maxMs, t.dur)
    g.targets.add(t.tgt)
    roGroups.set(key, g)
  }
  const roAttribution = Array.from(roGroups.values())
    .map(g => ({ key: g.key, calls: g.calls, totalMs: g.totalMs, maxMs: g.maxMs, targets: Array.from(g.targets).slice(0, 4) }))
    .sort((a, b) => b.totalMs - a.totalMs)

  console.log(JSON.stringify({ label: LABEL, domStats, cloned, culprit, layoutProbe, dragLongtasks: long, phaseLong, rafTrace: (await evalJs('window.__rafTrace ?? []')).filter(r => r.at >= dragStartPerf - 100), loaf: await evalJs('window.__loaf ?? []'), dragWindowRoCalls: dragWindow.length, roAttribution, blurSamples, dragMs: Date.now() - t0 }, null, 1))
} catch (e) {
  console.log('SASH PERF ERROR:', e.message)
  process.exitCode = 1
} finally {
  try { ws?.close() } catch { /* ignore */ }
  try { chrome.kill() } catch { /* ignore */ }
  try { execSync('taskkill /PID ' + chrome.pid + ' /T /F', { stdio: 'ignore' }) } catch { /* ignore */ }
}
