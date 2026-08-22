/**
 * DSH Desktop win32 无边框宿主自动补丁（尽力而为，失败仅告警不阻断插件加载）。
 *
 * 客户端更新后 resources/app.asar 会被还原，原生标题栏会重新出现。这个模块
 * 让插件在 Electron 主进程启动时自动重打补丁，逻辑与
 * `scripts/patch-desktop-frameless.mjs` 保持一致，但安装目录由
 * `process.resourcesPath` 推导（跟随当前运行的客户端版本，不写死路径）。
 *
 * 软性语义：
 * - 仅 win32 + Electron 主进程执行，纯 Web / 其他平台直接跳过（与补丁无关）；
 * - win32 + Electron 下尝试自动重打补丁，但无边框是纯外观增强，任何失败
 *   （找不到补丁点 / 文件缺失 / 写入失败）只记录告警并跳过，绝不抛错阻止
 *   插件加载；失败时页面内窗口按钮仍可用，只是原生标题栏按钮会保留；
 * - 首次运行备份 app.asar -> app.asar.bak-frameless；
 * - 已包含 [liuli-theme patch] 时跳过文件修改，只校验/重建 asar 头（幂等）。
 */
import { createHash } from 'node:crypto'
import { closeSync, copyFileSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { join as joinPath } from 'node:path'

/** 补丁标记：electron-runtime 文件里出现该字符串即视为已打补丁。 */
const PATCH_MARK = '[liuli-theme patch]'

/** 运行时文件里需要被替换的 win32 titleBarOverlay 片段。 */
const TITLEBAR_PATTERN = /titleBarStyle:\s*"hidden",\s*titleBarOverlay:\s*\{[\s\S]*?\},/

/** advanced/compatibility 主窗口的 webPreferences 块（两者同构；不匹配 profile 小窗）。 */
const WEBVIEWTAG_PATTERN = /webPreferences:\s*\{\s*preload,\s*contextIsolation:\s*true,\s*nodeIntegration:\s*false,\s*sandbox:\s*true,\s*webSecurity:\s*true\s*\}/g

type ProcessWithNoAsar = NodeJS.Process & { noAsar: boolean | undefined }

interface AsarHeader {
  files?: Record<string, unknown>
}

/**
 * 在 Electron 主进程里，fs 会被 asar wrapper 拦截：直接 open/read/write
 * `...\app.asar` 归档文件本身会抛 ENOENT。`process.noAsar = true` 可临时
 * 关闭 ASAR 钩子，让这些调用落到真实磁盘文件上。
 */
function withoutAsar<T>(fn: () => T): T {
  const proc = process as ProcessWithNoAsar
  const previous = proc.noAsar
  proc.noAsar = true
  try {
    return fn()
  } finally {
    proc.noAsar = previous
  }
}

function readFullySync(fd: number, length: number, position: number): Buffer {
  const buffer = Buffer.alloc(length)
  let offset = 0
  while (offset < length) {
    const bytesRead = readSync(fd, buffer, offset, length - offset, position + offset)
    if (bytesRead <= 0) {
      throw new Error(`读取不完整：期望 ${length} 字节，实际 ${offset} 字节`)
    }
    offset += bytesRead
  }
  return buffer
}

function writeFullySync(fd: number, buffer: Buffer): void {
  let offset = 0
  while (offset < buffer.length) {
    const bytesWritten = writeSync(fd, buffer, offset, buffer.length - offset)
    if (bytesWritten <= 0) {
      throw new Error('写入不完整')
    }
    offset += bytesWritten
  }
}

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

/**
 * 读取并解析 asar 头。返回头 JSON 以及原文件中头之后的第一个字节位置
 * （contentStart）。asar 头的 pickle 字符串按 4 字节对齐，pad 不能写死：
 * `prefix[8] = jsonLength + 4 + pad`。
 */
function readAsarHeader(asarPath: string): { header: AsarHeader; contentStart: number } {
  return withoutAsar(() => {
    const fd = openSync(asarPath, 'r')
    try {
      const prefix = readFullySync(fd, 16, 0)
      if (prefix.readUInt32LE(0) !== 4) {
        throw new Error('app.asar 头格式无法识别（不是标准 asar）')
      }
      const jsonLength = prefix.readUInt32LE(12)
      const pad = prefix.readUInt32LE(8) - jsonLength - 4
      if (pad < 0) {
        throw new Error('app.asar 头格式无法识别（padding 非法）')
      }
      const jsonBuffer = readFullySync(fd, jsonLength, 16)
      const header = JSON.parse(jsonBuffer.toString('utf8')) as AsarHeader
      return { header, contentStart: 16 + jsonLength + pad }
    } finally {
      closeSync(fd)
    }
  })
}

/** 按 asar pickle 格式重建头部（4 字节对齐 padding 动态计算）。 */
function buildAsarHeader(header: AsarHeader): Buffer {
  const jsonBuffer = Buffer.from(JSON.stringify(header), 'utf8')
  const pad = (4 - (jsonBuffer.length % 4)) % 4
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(jsonBuffer.length + 8 + pad, 4)
  prefix.writeUInt32LE(jsonBuffer.length + 4 + pad, 8)
  prefix.writeUInt32LE(jsonBuffer.length, 12)
  return Buffer.concat([prefix, jsonBuffer, Buffer.alloc(pad)])
}

/**
 * 生成完整的新 asar 文件：新头 + 原文件 contentStart 之后的全部字节。
 * 这样既兼容 DSH 当前「全部文件 unpacked、归档只有头」的布局，也不会在
 * 未来出现打包文件时把归档内容截断。
 */
function writePatchedAsar(sourcePath: string, destPath: string, newHeader: Buffer, contentStart: number): void {
  const srcFd = openSync(sourcePath, 'r')
  const destFd = openSync(destPath, 'w')
  try {
    writeFullySync(destFd, newHeader)
    const sourceSize = statSync(sourcePath).size
    if (sourceSize <= contentStart) return
    const chunkSize = 4 * 1024 * 1024
    const buffer = Buffer.alloc(chunkSize)
    let position = contentStart
    while (position < sourceSize) {
      const bytesRead = readSync(srcFd, buffer, 0, Math.min(chunkSize, sourceSize - position), position)
      if (bytesRead <= 0) {
        throw new Error(`读取 app.asar 尾部失败：position=${position}`)
      }
      writeFullySync(destFd, buffer.subarray(0, bytesRead))
      position += bytesRead
    }
  } finally {
    closeSync(srcFd)
    closeSync(destFd)
  }
}

/** 在插件启动时应用无边框补丁（win32 + Electron 下尽力而为，失败不抛错）。 */
export function applyFramelessPatch(): void {
  if (process.platform !== 'win32') return
  if (process.versions.electron === undefined) return
  const resourcesDir = (process as typeof process & { resourcesPath?: string }).resourcesPath
  if (resourcesDir === undefined || resourcesDir === '') {
    console.warn('[dsh-liuli-ui-enhance] 无边框自动补丁跳过：process.resourcesPath 为空，无法定位客户端安装目录')
    return
  }

  const asarPath = joinPath(resourcesDir, 'app.asar')
  const backupPath = joinPath(resourcesDir, 'app.asar.bak-frameless')
  const patchedCopyPath = joinPath(resourcesDir, 'app.asar.patched')
  const libDir = joinPath(resourcesDir, 'app.asar.unpacked', 'lib')
  const tmpPath = joinPath(resourcesDir, `app.asar.liuli-patch-${process.pid}.tmp`)

  // Electron 主进程里 fs 带 ASAR 钩子，直接读写 app.asar 会抛 ENOENT；
  // 整个补丁过程关闭 ASAR 钩子，结束后恢复原值。
  const proc = process as ProcessWithNoAsar
  const previousNoAsar = proc.noAsar
  proc.noAsar = true
  try {
    const runtimeName = findRuntimeFile(libDir)
    if (runtimeName === undefined) {
      throw new Error('在 app.asar.unpacked/lib 下找不到 electron-runtime-*.js（客户端目录结构可能已变化）')
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

    // 2. 修改 unpacked electron runtime（无边框 + webviewTag 两项补丁独立幂等）。
    let runtime = readFileSync(runtimePath, 'utf8')
    let runtimeChanged = false
    if (runtime.includes(PATCH_MARK)) {
      console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：electron-runtime 已包含无边框补丁，跳过该部分')
    } else {
      if (!TITLEBAR_PATTERN.test(runtime)) {
        throw new Error('未找到 win32 titleBarOverlay 补丁点（客户端版本可能不兼容，请运行 pnpm patch:desktop 手动补丁或更新插件）')
      }
      runtime = runtime.replace(TITLEBAR_PATTERN, [
        '// [liuli-theme patch] 无边框窗口：移除原生 titleBarOverlay 按钮，',
        '// 最小化/最大化/关闭改由页面内按钮承担（dsh-liuli-ui-enhance 插件 /liuli-window',
        '// 路由 + WindowControls 组件：会话 header 内 + 开始页标题条右侧兜底）。',
        '// 注意：未安装 dsh-liuli-ui-enhance 时 advanced 模式将没有窗口按钮（Alt+F4/托盘仍可用）。',
        'frame: false,',
      ].join('\n\t\t'))
      runtimeChanged = true
      console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：已修补 electron-runtime 无边框配置')
    }
    // 启用 webviewTag：zcode 参考实现的浏览器用 <webview> DOM 标签承载，
    // 由 CSS overflow:hidden 自然裁剪，彻底避免 WebContentsView 溢出容器问题。
    if (runtime.includes('webviewTag: true')) {
      console.log('[dsh-liuli-ui-enhance] 浏览器补丁：electron-runtime 已启用 webviewTag，跳过该部分')
    } else {
      if (!WEBVIEWTAG_PATTERN.test(runtime)) {
        console.warn('[dsh-liuli-ui-enhance] 浏览器补丁：未找到 webPreferences 补丁点，跳过 webviewTag（浏览器面板将回退 WebContentsView）')
      } else {
        runtime = runtime.replace(WEBVIEWTAG_PATTERN, (block) => block.replace('webSecurity: true', 'webviewTag: true,\n\t\t\twebSecurity: true'))
        runtimeChanged = true
        console.log('[dsh-liuli-ui-enhance] 浏览器补丁：已启用 webviewTag')
      }
    }
    if (runtimeChanged) {
      writeFileSync(runtimePath, runtime, 'utf8')
      console.log('[dsh-liuli-ui-enhance] 已写入 electron-runtime 补丁')
    }

    // 3. 重建 app.asar 头（同步 size / SHA256 integrity），并保留头之后的原始字节。
    const { header, contentStart } = readAsarHeader(asarPath)
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

    const newHeader = buildAsarHeader(header)
    writePatchedAsar(asarPath, tmpPath, newHeader, contentStart)
    copyFileSync(tmpPath, asarPath)
    copyFileSync(tmpPath, patchedCopyPath)
    console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：已重建 app.asar 头')
    console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：重启 DSH Desktop 后生效')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[dsh-liuli-ui-enhance] 无边框自动补丁未应用：', message)
    console.warn('[dsh-liuli-ui-enhance] 插件继续加载；页面内窗口按钮仍可用，原生标题栏按钮会保留。如需隐藏原生标题栏，请运行 pnpm patch:desktop')
  } finally {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch { /* ignore */ }
    proc.noAsar = previousNoAsar
  }
}
