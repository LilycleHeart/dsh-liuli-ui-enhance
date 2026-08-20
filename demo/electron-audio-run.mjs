// CDP driver: runs the Electron test app twice — once with the plugin's
// display-media handler (expect success), once without (expect NotAllowedError).
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../../', import.meta.url) // demo/ → repo root? no: this file lives in demo/
const ELECTRON = 'C:/Users/27280/AppData/Local/Temp/liuli-electron-test/node_modules/electron/dist/electron.exe'
const APP_DIR = fileURLToPath(new URL('./electron-audio-test/', import.meta.url))
const PORT = 9339
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function cdpList() {
  const resp = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(2000) })
  return resp.json()
}

async function waitTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await cdpList()
      const page = list.find((t) => t.type === 'page' && t.url.includes('electron-audio-test'))
      if (page) return page
    } catch { }
    await sleep(300)
  }
  throw new Error('CDP page target not found')
}

async function runCase(noHandler) {
  const child = spawn(ELECTRON, ['--no-sandbox', `--remote-debugging-port=${PORT}`, APP_DIR, ...(noHandler ? ['--no-handler'] : [])], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let mainLog = ''
  child.stdout.on('data', (d) => { mainLog += d.toString() })
  child.stderr.on('data', (d) => { mainLog += d.toString() })
  const kill = () => { try { child.kill() } catch { } }
  try {
    const target = await waitTarget()
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws error')) })
    let nextId = 1
    const pending = new Map()
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    }
    const send = (method, params) => new Promise((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
    await send('Runtime.enable', {})
    // 等待页面脚本就绪(避免在 test.js 加载前调用)
    let ready = false
    for (let i = 0; i < 40 && !ready; i++) {
      const chk = await send('Runtime.evaluate', { expression: 'typeof window.__startTest === \'function\'', returnByValue: true })
      ready = chk.result?.result?.value === true
      if (!ready) await sleep(250)
    }
    if (!ready) throw new Error('page script not ready')
    // 用户手势 + 启动测试(实现点击按钮)
    await send('Runtime.evaluate', { expression: 'window.__startTest()', userGesture: true, awaitPromise: false, returnByValue: true })
    // 轮询结果
    let result = null
    let log = ''
    for (let i = 0; i < 120 && result === null; i++) {
      await sleep(250)
      const r = await send('Runtime.evaluate', { expression: 'window.__result', returnByValue: true })
      result = r.result?.result?.value ?? null
      const l = await send('Runtime.evaluate', { expression: 'document.getElementById("log").textContent', returnByValue: true })
      log = l.result?.result?.value ?? ''
    }
    ws.close()
    return { result, log, mainLog }
  } finally {
    kill()
    // 等上一实例完全退出、端口释放,避免下一个用例冲突
    for (let i = 0; i < 40; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(800) }); await sleep(250) } catch { break }
    }
    await sleep(500)
  }
}

const results = []
const check = (name, pass, detail = '') => { results.push(pass); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 220) : '')) }

// 用例1:安装了插件 handler → 期望 getDisplayMedia 成功拿到音频轨 + 有信号
const case1 = await runCase(false)
const r1 = case1.result
check('E1 handler mode: getDisplayMedia resolves with audio track', r1?.ok === true && r1?.tracks >= 1, JSON.stringify(r1))
check('E1b loopback signal energy > 0', typeof r1?.avgEnergy === 'number' && r1.avgEnergy > 0, 'avg=' + r1?.avgEnergy + ' samples=' + JSON.stringify(r1?.samples))
check('E1c main installed handler', /handler installed/.test(case1.mainLog), case1.mainLog.split('\n').filter(Boolean).slice(-3).join(' | '))

// 用例2:无 handler(默认 Electron 行为)→ 期望 NotAllowedError(复现原 bug)
const case2 = await runCase(true)
const r2 = case2.result
check('E2 no-handler mode: getDisplayMedia rejected (NotAllowedError)', r2?.ok === false && (r2?.name === 'NotAllowedError' || r2?.stage === 'catch'), JSON.stringify(r2))

const failed = results.filter((r) => !r).length
console.log('SUMMARY: ' + String(results.length - failed) + '/' + String(results.length) + ' passed')
process.exit(failed === 0 ? 0 : 1)