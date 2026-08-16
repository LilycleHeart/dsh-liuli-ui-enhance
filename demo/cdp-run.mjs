// 用法: node cdp-run.mjs "<曲目文件名>" [秒数] [起始偏移秒] [目录: music|dl|demo] [b64]
//   b64: 音频字节由本脚本读盘后 base64 注入页面（绕开 IDM 等下载拦截器）
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9224
const file = process.argv[2] || ''
const secs = Number(process.argv[3] || 45)
const startSec = Number(process.argv[4] || 0)
const dir = process.argv[5] || 'music'
const useB64 = process.argv[6] === 'b64'
const ROOTS = {
  music: 'C:\\CloudMusic',
  dl: 'C:\\Users\\27280\\Downloads',
  dlm: 'C:\\Users\\27280\\Downloads\\Music',
  demo: fileURLToPath(new URL('.', import.meta.url)),
}
const url = `http://127.0.0.1:8124/demo/beat-demo.html?file=${encodeURIComponent(file)}&secs=${secs}&start=${startSec}&dir=${dir}${useB64 ? '&b64=1' : ''}`

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run',
  `--user-data-dir=${path.join(os.tmpdir(), 'dsh-demo-' + process.pid)}`,
  `--remote-debugging-port=${PORT}`,
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,900',
  url,
], { stdio: 'ignore' })

const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let ws = null
let sendId = 0
const pending = new Map()
const errors = []

async function connect() {
  let list = []
  for (let i = 0; i < 40; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      if (list.some(t => t.type === 'page')) break
    } catch { /* not up yet */ }
    await sleep(500)
  }
  const target = list.find(t => t.type === 'page')
  if (!target) throw new Error('no page target')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? 'unknown')
    } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      errors.push((m.params.args || []).map(a => a.value ?? a.description ?? '').join(' '))
    }
  }
  await send('Runtime.enable')
}

function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++sendId
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) return { __err: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text }
  return r?.result?.value
}

try {
  await connect()
  if (useB64) {
    // 读盘 → base64 → 分块注入（CDP 大消息限制，4MB/块）→ 置就绪标记
    const raw = await readFile(path.join(ROOTS[dir] ?? ROOTS.music, file))
    const b64 = raw.toString('base64')
    console.error('INJECT b64 ' + (b64.length / 1024 / 1024).toFixed(1) + 'MB')
    const chunk = 4 * 1024 * 1024
    await evalJs(`window.__audioB64 = ''`)
    for (let i = 0; i < b64.length; i += chunk) {
      const part = b64.slice(i, i + chunk)
      await evalJs(`window.__audioB64 += ${JSON.stringify(part)}`)
      if (i % (chunk * 8) === 0) console.error(`INJECT ${(i / 1024 / 1024).toFixed(0)}MB`)
    }
    await evalJs(`window.__audioReady = true`)
  }
  let result = null
  for (let i = 0; i < secs + 60; i++) {
    await sleep(1000)
    result = await evalJs(`window.__result ?? null`)
    if (result) break
  }
  if (!result) {
    const state = await evalJs(`({ title: document.title, sub: document.querySelector('#sub')?.textContent ?? '', log: document.querySelector('#log')?.textContent ?? '' })`)
    console.log(JSON.stringify({ file, TIMEOUT: true, page: state, errors }, null, 1))
  } else {
    console.log(JSON.stringify({ file, ...result, errors }, null, 1))
  }
} catch (e) {
  console.log(JSON.stringify({ file, FATAL: String(e) }))
} finally {
  try { ws?.close() } catch { /* ignore */ }
  chrome.kill()
  process.exit(0)
}
