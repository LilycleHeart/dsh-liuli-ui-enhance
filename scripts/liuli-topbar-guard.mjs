#!/usr/bin/env node
/**
 * 琉璃顶栏补丁看护（topbar guard）
 *
 * 背景：DSH Desktop 的「窗口顶栏（常驻/悬浮）」依赖宿主补丁
 * `scripts/patch-official-window-controls.mjs`（把 app.asar 内 lib/main.js 的
 * win32 `titleBarStyle:"hidden"+titleBarOverlay` 改成 `frame:false`，并在
 * lib/preload-app.cjs 注入 window.liuliWindowControls 桥）。客户端每次自动更新
 * 都会用官方文件覆盖 resources/app.asar 与 DeepSeek Harness.exe，补丁随之失效；
 * 而补丁必须写 exe 内嵌的 ASAR 完整性哈希，运行中的 exe 被系统锁定 —— 只能在
 * 客户端完全退出时执行。本脚本负责「在正确的时机自动补上」：
 *
 *   - 已打补丁          → 报告 patched，退出码 0
 *   - 未打补丁 + 未运行 → 默认只报告 missing（退出码 2）；加 --apply 才真正写入
 *   - 未打补丁 + 运行中 → 报告 pending（退出码 2），不打扰、不写入
 *   - 版本/锚点不支持    → 报告 unsupported（退出码 3），绝不写入
 *
 * 典型用法：
 *   node scripts/liuli-topbar-guard.mjs              # 查状态
 *   node scripts/liuli-topbar-guard.mjs --apply      # 缺失且客户端未运行时补上
 *   node scripts/liuli-topbar-guard.mjs --apply --quiet   # 计划任务里静默运行
 *
 * 安全：本脚本自身不解析/改写宿主文件，所有写入都委托给
 * patch-official-window-controls.mjs（它带备份、record.json 与写后校验，
 * 且锚点漂移时直接拒绝写入）。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const WANT_APPLY = args.includes('--apply')
const QUIET = args.includes('--quiet')
const JSON_OUT = args.includes('--json')

const here = dirname(fileURLToPath(import.meta.url))
const patchScript = join(here, 'patch-official-window-controls.mjs')
const installDir = resolve(process.env.DSH_DESKTOP_DIR || join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness'))
const exePath = join(installDir, 'DeepSeek Harness.exe')

const EXIT = { patched: 0, applied: 0, missing: 2, pending: 2, unsupported: 3, error: 4 }

function log(...parts) {
  if (!QUIET && !JSON_OUT) console.log('[liuli-topbar-guard]', ...parts)
}

/** 客户端是否在运行（只看安装目录里的那个 exe，避免误伤同名进程）。 */
function desktopRunning() {
  const probe = spawnSync('tasklist', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH', '/FO', 'CSV'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (probe.error || typeof probe.stdout !== 'string') return undefined
  return /DeepSeek Harness\.exe/i.test(probe.stdout)
}

/** 运行补丁脚本的 --check，用它的输出判断是否已打补丁（脚本自己解析 asar）。 */
function checkPatch() {
  const result = spawnSync(process.execPath, [patchScript, '--check'], { encoding: 'utf8', windowsHide: true })
  const stdout = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  if (/already applied/i.test(stdout)) return { state: 'patched', detail: stdout.split('\n').at(-1) }
  if (result.status === 0) {
    try {
      const parsed = JSON.parse(result.stdout)
      return { state: 'missing', version: parsed.version, detail: 'main/preload 可补丁但尚未写入' }
    } catch {
      return { state: 'missing', detail: stdout.split('\n').at(-1) }
    }
  }
  return { state: 'unsupported', detail: stdout.split('\n').filter(Boolean).at(-1) ?? `exit ${result.status}` }
}

function applyPatch() {
  const result = spawnSync(process.execPath, [patchScript, '--apply'], { encoding: 'utf8', windowsHide: true })
  return {
    ok: result.status === 0,
    detail: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split('\n').filter(Boolean).at(-1) ?? `exit ${result.status}`,
  }
}

function report(payload, exitCode) {
  if (JSON_OUT) console.log(JSON.stringify(payload))
  else if (!QUIET || payload.state !== 'patched') {
    console.log(`[liuli-topbar-guard] state=${payload.state}${payload.version ? ` version=${payload.version}` : ''} ${payload.detail ?? ''}`)
  }
  process.exit(exitCode)
}

if (!existsSync(exePath)) {
  report({ state: 'error', detail: `找不到客户端：${exePath}（可用 DSH_DESKTOP_DIR 指定安装目录）` }, EXIT.error)
}
if (!existsSync(patchScript)) {
  report({ state: 'error', detail: `找不到补丁脚本：${patchScript}` }, EXIT.error)
}

const check = checkPatch()
if (check.state === 'patched') report({ state: 'patched', detail: check.detail }, EXIT.patched)
if (check.state === 'unsupported') report({ state: 'unsupported', version: check.version, detail: check.detail }, EXIT.unsupported)

const running = desktopRunning()
if (running === true) {
  report({
    state: 'pending',
    version: check.version,
    detail: '客户端正在运行，补丁需要退出后写入；下次启动前运行本脚本 --apply 即可恢复顶栏',
  }, EXIT.pending)
}
if (running === undefined) {
  report({ state: 'error', detail: '无法确认客户端是否在运行（tasklist 调用失败），为安全起见不写入' }, EXIT.error)
}

if (!WANT_APPLY) {
  report({ state: 'missing', version: check.version, detail: '可补丁；加 --apply 写入' }, EXIT.missing)
}

const applied = applyPatch()
if (applied.ok) {
  const after = checkPatch()
  report({ state: after.state === 'patched' ? 'applied' : 'error', version: check.version, detail: applied.detail },
    after.state === 'patched' ? EXIT.applied : EXIT.error)
}
report({ state: 'unsupported', version: check.version, detail: `补丁未写入：${applied.detail}` }, EXIT.unsupported)
