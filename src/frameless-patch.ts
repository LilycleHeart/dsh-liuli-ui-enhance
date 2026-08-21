/**
 * DSH Desktop win32 无边框宿主自动补丁（必装）。
 *
 * 客户端更新后 resources/app.asar 会被还原，原生标题栏会重新出现。这个模块
 * 让插件在 Electron 主进程启动时自动重打补丁，逻辑与
 * `scripts/patch-desktop-frameless.mjs` 保持一致，但安装目录由
 * `process.resourcesPath` 推导（跟随当前运行的客户端版本，不写死路径）。
 *
 * 必装语义：
 * - 仅 win32 + Electron 主进程执行，纯 Web / 其他平台直接跳过（与补丁无关）；
 * - win32 + Electron 下补丁是强制要求：找不到补丁点 / 文件缺失 / 写入失败
 *   都会抛出异常，让插件启动失败并在日志中给出明确原因，不再静默跳过；
 * - 首次运行备份 app.asar -> app.asar.bak-frameless；
 * - 已包含 [liuli-theme patch] 时跳过文件修改，只校验/重建 asar 头（幂等）。
 */
import { createHash } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join as joinPath } from 'node:path'

/** 补丁标记：electron-runtime 文件里出现该字符串即视为已打补丁。 */
const PATCH_MARK = '[liuli-theme patch]'

/** 运行时文件里需要被替换的 win32 titleBarOverlay 片段。 */
const TITLEBAR_PATTERN = /titleBarStyle:\s*"hidden",\s*titleBarOverlay:\s*\{[\s\S]*?\},/

/** 客户端版本升级会更换 electron-runtime-<hash>.js 文件名，不能写死。
 *  在 unpacked lib 里找包含 titleBarStyle 的 electron-runtime-*.js。 */
function findRuntimeFile(libDir: string): string | undefined {
  let names: string[] = []
  try {
    names = readdirSync(libDir)
  } catch {
    return undefined
  }
  const candidates = names.filter(name => /^electron-runtime-[A-Za-z0-9_-]+\.js$/.test(name))
  for (const name of candidates) {
    try {
      if (readFileSync(joinPath(libDir, name), 'utf8').includes('titleBarStyle')) return name
    } catch { /* 继续找下一个 */ }
  }
  // 兜底：取最大者（通常就是完整 runtime bundle）。
  let best: string | undefined
  let bestSize = -1
  for (const name of candidates) {
    try {
      const size = statSync(joinPath(libDir, name)).size
      if (size > bestSize) { best = name; bestSize = size }
    } catch { /* ignore */ }
  }
  return best
}

function readAsarHeader(asarPath: string): unknown {
  const fd = openSync(asarPath, 'r')
  try {
    const prefix = Buffer.alloc(16)
    readSync(fd, prefix, 0, 16, 0)
    const jsonLength = prefix.readUInt32LE(12)
    const jsonBuffer = Buffer.alloc(jsonLength)
    readSync(fd, jsonBuffer, 0, jsonLength, 16)
    return JSON.parse(jsonBuffer.toString('utf8')) as unknown
  } finally {
    closeSync(fd)
  }
}

/** 在插件启动时应用无边框补丁（win32 + Electron 下必装，失败抛错）。 */
export function applyFramelessPatch(): void {
  if (process.platform !== 'win32') return
  if (process.versions.electron === undefined) return
  const resourcesDir = (process as typeof process & { resourcesPath?: string }).resourcesPath
  if (resourcesDir === undefined || resourcesDir === '') {
    throw new Error('[dsh-liuli-ui-enhance] 无边框补丁（必装）失败：process.resourcesPath 为空')
  }

  try {
    const asarPath = joinPath(resourcesDir, 'app.asar')
    const backupPath = joinPath(resourcesDir, 'app.asar.bak-frameless')
    const patchedCopyPath = joinPath(resourcesDir, 'app.asar.patched')
    const libDir = joinPath(resourcesDir, 'app.asar.unpacked', 'lib')
    const runtimeName = findRuntimeFile(libDir)
    if (runtimeName === undefined) {
      throw new Error('找不到 electron-runtime-*.js（客户端目录结构可能已变化）')
    }
    const runtimePath = joinPath(libDir, runtimeName)

    if (!existsSync(asarPath)) {
      throw new Error('找不到 app.asar（客户端目录结构可能已变化）')
    }

    // 1. 备份原始 app.asar（首次）。
    if (!existsSync(backupPath)) {
      copyFileSync(asarPath, backupPath)
      console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：已备份 app.asar -> app.asar.bak-frameless')
    }

    // 2. 修改 unpacked electron runtime。
    let runtime = readFileSync(runtimePath, 'utf8')
    if (runtime.includes(PATCH_MARK)) {
      console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：electron-runtime 已包含琉璃补丁，跳过文件修改')
    } else {
      if (!TITLEBAR_PATTERN.test(runtime)) {
        throw new Error('未找到 win32 titleBarOverlay 补丁点（客户端版本可能不兼容，请运行 pnpm patch:desktop 或更新插件）')
      }
      runtime = runtime.replace(TITLEBAR_PATTERN, [
        '// [liuli-theme patch] 无边框窗口：移除原生 titleBarOverlay 按钮，',
        '// 最小化/最大化/关闭改由页面内按钮承担（dsh-liuli-ui-enhance 插件 /liuli-window',
        '// 路由 + WindowControls 组件：会话 header 内 + 开始页标题条右侧兜底）。',
        '// 注意：未安装 dsh-liuli-ui-enhance 时 advanced 模式将没有窗口按钮（Alt+F4/托盘仍可用）。',
        'frame: false,',
      ].join('\n\t\t'))
      writeFileSync(runtimePath, runtime, 'utf8')
      console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：已修补 electron-runtime')
    }

    // 3. 重建 app.asar 头（同步 size / SHA256 integrity）。
    const header = readAsarHeader(asarPath) as { files?: Record<string, unknown> }
    let node: { files?: Record<string, unknown> } | undefined = header
    for (const part of ['lib', runtimeName]) {
      const next = node?.files?.[part] as { files?: Record<string, unknown> } | undefined
      if (next === undefined) {
        throw new Error(`asar 头中缺少 ${part}（客户端版本可能不兼容）`)
      }
      node = next
    }

    const runtimeBuffer = readFileSync(runtimePath)
    const hash = createHash('sha256').update(runtimeBuffer).digest('hex')
    const target = node as unknown as { size?: number; integrity?: { algorithm?: string; blockSize?: number; blocks?: string[]; hash?: string } }
    target.size = runtimeBuffer.length
    target.integrity ??= { algorithm: 'SHA256', blockSize: 4194304, blocks: [] }
    target.integrity.hash = hash
    target.integrity.blocks = [hash]

    const json = JSON.stringify(header)
    const jsonBuffer = Buffer.from(json, 'utf8')
    const prefix = Buffer.alloc(16)
    prefix.writeUInt32LE(4, 0)
    prefix.writeUInt32LE(jsonBuffer.length + 9, 4)
    prefix.writeUInt32LE(jsonBuffer.length + 5, 8)
    prefix.writeUInt32LE(jsonBuffer.length, 12)
    const newAsar = Buffer.concat([prefix, jsonBuffer, Buffer.from([0])])

    writeFileSync(asarPath, newAsar)
    writeFileSync(patchedCopyPath, newAsar)
    console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：已重建 app.asar 头')
    console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：重启 DSH Desktop 后生效')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[dsh-liuli-ui-enhance] 无边框自动补丁失败：', message)
    throw error instanceof Error ? error : new Error(message)
  }
}
