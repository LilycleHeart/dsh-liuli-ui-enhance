#!/usr/bin/env node
/**
 * 琉璃顶栏补丁看护进程（常驻，可选）
 *
 * 解决的问题：DSH Desktop 自动更新后，宿主补丁会被官方文件覆盖，顶栏（常驻/悬浮）
 * 失效；而补丁只能写 exe 内嵌的 ASAR 完整性哈希，必须等客户端退出才能执行。
 * 计划任务的最短周期是 1 分钟，很容易错过「更新退出 → 自动重启新版」之间那几秒。
 *
 * 本进程以 5 秒为周期轮询客户端是否在运行，一旦发现它退出、且补丁缺失，就立刻
 * 重新补丁（委托 scripts/liuli-topbar-guard.mjs）。这样即便是 electron-updater
 * 的静默重启，补丁也能在新版启动前就位。
 *
 * 用法：
 *   node scripts/liuli-topbar-watch.mjs                 # 常驻（登录时启动）
 *   node scripts/liuli-topbar-watch.mjs --interval 3000 # 自定义轮询间隔
 *   node scripts/liuli-topbar-watch.mjs --once          # 只检查一次（调试用）
 *
 * 开销：每 tick 一次 tasklist（约几毫秒），补丁只在缺失且客户端未运行时执行。
 * 安全：不在客户端运行时写盘；补丁脚本自身带备份、record.json 与写后校验，
 * 锚点漂移时拒绝写入。任何异常只记录日志，不终止进程。
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const once = args.includes('--once')
const intervalArg = args.indexOf('--interval')
const interval = intervalArg >= 0 ? Math.max(2000, Number(args[intervalArg + 1]) || 5000) : 5000

const here = dirname(fileURLToPath(import.meta.url))
const guard = join(here, 'liuli-topbar-guard.mjs')
const logPath = join(process.env.LOCALAPPDATA ?? process.env.TEMP ?? '.', 'liuli-topbar-guard.log')

const stamp = () => {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
function log(...parts) {
  const line = `[${stamp()}] ${parts.join(' ')}`
  try { appendFileSync(logPath, line + '\n') } catch { /* 日志失败不影响看护 */ }
  console.log(line)
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function state() {
  const result = spawnSync(process.execPath, [guard, '--json'], { encoding: 'utf8', windowsHide: true })
  try {
    return JSON.parse(result.stdout)
  } catch {
    return { state: 'error', detail: (result.stderr || result.stdout || '').trim().slice(0, 200) }
  }
}

function apply() {
  const result = spawnSync(process.execPath, [guard, '--apply', '--json'], { encoding: 'utf8', windowsHide: true })
  try {
    return JSON.parse(result.stdout)
  } catch {
    return { state: 'error', detail: (result.stderr || result.stdout || '').trim().slice(0, 200) }
  }
}

if (!existsSync(guard)) {
  log(`找不到 ${guard}，看护退出`)
  process.exit(4)
}

log(`看护启动（间隔 ${interval}ms，日志 ${logPath}）`)
let wasRunning = true
let lastState = ''

for (;;) {
  const current = state()
  if (current.state !== lastState) {
    log(`状态：${current.state}${current.version ? ` (${current.version})` : ''} ${current.detail ?? ''}`)
    lastState = current.state
  }

  if (current.state === 'patched' || current.state === 'unsupported' || current.state === 'error') {
    // patched：无需动作；unsupported/error：写入不安全或环境异常，保持沉默等下次
    wasRunning = current.state === 'patched' ? false : wasRunning
  } else if (current.state === 'pending') {
    wasRunning = true
  } else if (current.state === 'missing') {
    // 客户端没在运行但补丁缺失 —— 可能是更新刚把它覆盖掉
    const done = apply()
    log(`补丁：${done.state}${done.detail ? ` ${done.detail}` : ''}${wasRunning ? '（客户端刚退出）' : ''}`)
    wasRunning = false
    lastState = done.state
  }

  if (once) break
  await sleep(interval)
}
