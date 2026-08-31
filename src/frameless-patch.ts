/**
 * DSH Desktop win32 无边框宿主自动补丁（尽力而为，失败仅告警不阻断插件加载）。
 *
 * 客户端更新后 resources/app.asar 会被还原，原生标题栏会重新出现。这个模块
 * 让插件在 Electron 主进程启动时自动重打补丁，逻辑与
 * `scripts/patch-desktop-frameless.mjs` 保持一致，但安装目录由
 * `process.resourcesPath` 推导（跟随当前运行的客户端版本，不写死路径）。
 *
 * 两种客户端布局都支持：
 *   旧布局：electron-runtime-*.js 直接位于 app.asar.unpacked/lib 磁盘目录（unpacked 条目）。
 *   新布局：electron-runtime-*.js 被打包进 app.asar 内部（packed 条目，offset 相对内容区起点）。
 *          此时把补丁后的内容解包写到磁盘 unpacked 目录，并把 asar 头条目从
 *          packed（带 offset）改为 unpacked（去 offset），让 Electron 改从磁盘读取。
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
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { join as joinPath } from 'node:path'

/** 补丁标记：electron-runtime 文件里出现该字符串即视为已打补丁。 */
const PATCH_MARK = '[liuli-theme patch]'

/** 主窗口 win32 补丁点：customChromeWindowOptions 的 win32 分支（含 autoHideMenuBar: true 前缀，
 *  height 用 geometry.titlebarHeight），不是 auxiliary 辅助窗口那份（height 字面量 36）。 */
const TITLEBAR_MAIN = /(?<=autoHideMenuBar:\s*true,\s*)titleBarStyle:\s*"hidden",\s*titleBarOverlay:\s*\{[\s\S]*?\},/
/** 兜底：无 autoHideMenuBar 锚定的历史布局（旧版客户端只有一处 titleBarOverlay）。 */
const TITLEBAR_GENERIC = /titleBarStyle:\s*"hidden",\s*titleBarOverlay:\s*\{[\s\S]*?\},/

/** advanced/compatibility 主窗口的 webPreferences 块（开头是 preload…webSecurity:true，
 *  兼容结尾是 `}` 或继续跟 partition 等字段；不匹配 profile 小窗/对话框块）。 */
const WEBVIEWTAG_PATTERN = /webPreferences:\s*\{\s*preload,\s*contextIsolation:\s*true,\s*nodeIntegration:\s*false,\s*sandbox:\s*true,\s*webSecurity:\s*true(?:,|\s*})/g

// 新版标记块：注释里记录原 titleBarOverlay height 表达式，还原时可逐字恢复。
// 用 m 标志并吞掉行首缩进：patch 时注释行前保留了原 titleBarStyle 行的缩进，
// 还原若不吞掉会双重缩进（保留缩进 + restore 自带 indent）。
const MARKER_BLOCK_NEW = /^[ \t]*\/\/ \[liuli-theme patch\] 无边框窗口：移除原生 titleBarOverlay 按钮（原 titleBarOverlay height 表达式：([^）]*)），[\s\S]*?\n[ \t]*frame: false,/m
// 旧版标记块（无 height 记录；还原按官方原版 height:32 处理）。
const MARKER_BLOCK_LEGACY = /^[ \t]*\/\/ \[liuli-theme patch\] 无边框窗口：[\s\S]*?\n[ \t]*frame: false,/m

type ProcessWithNoAsar = NodeJS.Process & { noAsar: boolean | undefined }

interface AsarFileNode {
  size?: number
  offset?: string | number
  unpacked?: boolean
  integrity?: { algorithm?: string; blockSize?: number; blocks?: string[]; hash?: string }
  files?: Record<string, AsarFileNode | { files: Record<string, unknown> }>
}

interface AsarHeader {
  files?: Record<string, AsarFileNode | { files: Record<string, unknown> }>
}

interface RuntimeRef {
  name: string
  content: Buffer
  mode: 'disk' | 'asar'
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
 *  优先磁盘 unpacked 目录（旧布局 / 已解包的新布局），没有则从 asar 头里
 *  找打包条目（新布局）并读出内容。 */
function resolveRuntime(libDir: string, asarPath: string): RuntimeRef | undefined {
  let names: string[] = []
  try {
    names = readdirSync(libDir)
  } catch {
    /* lib 目录不存在也正常 */
  }
  const diskCandidates = names.filter(name => /^electron-runtime-[A-Za-z0-9_-]+\.js$/.test(name))
  for (const name of diskCandidates) {
    try {
      const content = readFileSync(joinPath(libDir, name))
      if (content.toString('utf8').includes('titleBarStyle')) {
        return { name, content, mode: 'disk' }
      }
    } catch { /* 继续找下一个 */ }
  }
  // asar 打包条目（新布局）
  try {
    const { header, contentStart } = readAsarHeader(asarPath)
    const libFiles = (header.files?.lib as AsarFileNode | undefined)?.files ?? {}
    const packedNames = Object.keys(libFiles).filter(
      (name) => /^electron-runtime-[A-Za-z0-9_-]+\.js$/.test(name)
        && (libFiles[name] as AsarFileNode | undefined)?.unpacked !== true,
    )
    for (const name of packedNames) {
      try {
        const content = readPackedEntry(asarPath, libFiles[name] as AsarFileNode, contentStart)
        if (content.toString('utf8').includes('titleBarStyle')) {
          return { name, content, mode: 'asar' }
        }
      } catch { /* 继续找下一个 */ }
    }
  } catch { /* asar 头读取失败，交由下方兜底 */ }
  // 兜底：磁盘目录里取最大者（通常就是完整 runtime bundle）
  let best: string | undefined
  let bestSize = -1
  for (const name of diskCandidates) {
    try {
      const size = statSync(joinPath(libDir, name)).size
      if (size > bestSize) { best = name; bestSize = size }
    } catch { /* ignore */ }
  }
  if (best !== undefined) {
    try {
      return { name: best, content: readFileSync(joinPath(libDir, best)), mode: 'disk' }
    } catch { /* ignore */ }
  }
  return undefined
}

/** 从 asar 归档内容区（contentStart + offset）读取打包文件内容。 */
function readPackedEntry(asarPath: string, entry: AsarFileNode, contentStart: number): Buffer {
  const offset = parseInt(String(entry.offset), 10)
  if (!Number.isFinite(offset) || offset < 0 || typeof entry.size !== 'number') {
    throw new Error(`asar 条目无有效 offset/size：${JSON.stringify(entry)}`)
  }
  const fd = openSync(asarPath, 'r')
  try {
    return readFullySync(fd, entry.size, contentStart + offset)
  } finally {
    closeSync(fd)
  }
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
 * 生成完整的新 asar 文件：新头 + 原文件 contentStart 之后的全部字节原样接上。
 * 打包条目的 offset 相对内容区起点，头部长度变化不影响其有效性，尾部不会被截断。
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

/** 在 asar 头中找到 lib/<runtimeName> 条目。 */
function findRuntimeNode(header: AsarHeader, runtimeName: string): AsarFileNode {
  let node: AsarFileNode | { files: Record<string, unknown> } | undefined = header
  for (const part of ['lib', runtimeName]) {
    const next = node?.files?.[part] as AsarFileNode | { files: Record<string, unknown> } | undefined
    if (next === undefined) {
      throw new Error(`asar 头中缺少 ${part}（客户端版本可能不兼容）`)
    }
    node = next
  }
  return node as AsarFileNode
}

/** 从被替换的 marker 之前找最近的 autoHideMenuBar 行推断主窗口标题栏块缩进
 *  （新版 customChromeWindowOptions 是 3 层 tab；文件里对话框窗口也有
 *  autoHideMenuBar，不能全局找第一处）。找不到时退回 2 层 tab（旧版布局）。 */
function detectTitlebarIndentBefore(text: string, beforeIndex: number): string {
  const head = text.slice(0, beforeIndex)
  const lines = head.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line === undefined) continue
    const m = line.match(/^([ \t]*)autoHideMenuBar:\s*true,/)
    if (m && m[1] !== undefined) return m[1]
  }
  return '\t\t'
}

function nativeTitleBarRestore(heightExpr: string, indent: string = '\t\t'): string {
  return [
    `${indent}titleBarStyle: "hidden",`,
    `${indent}titleBarOverlay: {`,
    `${indent}\tcolor: "#00000000",`,
    `${indent}\tsymbolColor: "#7f858f",`,
    `${indent}\theight: ${heightExpr}`,
    `${indent}},`,
  ].join('\n')
}

/** 写回 runtime 内容（磁盘或 asar 解包）并重建 asar 头（同步 size/integrity）。 */
function commitRuntime(
  resourcesDir: string,
  asarPath: string,
  runtime: RuntimeRef,
  content: Buffer,
  runtimeChanged: boolean,
): void {
  const libDir = joinPath(resourcesDir, 'app.asar.unpacked', 'lib')
  const patchedCopyPath = joinPath(resourcesDir, 'app.asar.patched')
  const diskRuntimePath = joinPath(libDir, runtime.name)

  if (runtimeChanged) {
    mkdirSync(libDir, { recursive: true })
    writeFileSync(diskRuntimePath, content)
    console.log(`[dsh-liuli-ui-enhance] 已写入 ${diskRuntimePath}`)
  }

  const { header, contentStart } = readAsarHeader(asarPath)
  const target = findRuntimeNode(header, runtime.name)
  const hash = createHash('sha256').update(content).digest('hex')
  const needUnpack = target.unpacked !== true

  // 幂等快路径：内容没变 && 头部已是最新（unpacked 状态、size、hash 一致）时跳过重建。
  if (!runtimeChanged && !needUnpack && target.size === content.length && target.integrity?.hash === hash) {
    console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：asar 头已是最新，跳过重建（不再重写 app.asar）')
    return
  }

  if (needUnpack) {
    // packed 条目 -> unpacked：去掉 offset，内容改由 app.asar.unpacked 磁盘文件承担
    delete target.offset
    target.unpacked = true
    console.log('[dsh-liuli-ui-enhance] asar 条目已从打包改为 unpacked（内容改由磁盘文件承载）')
  }
  target.size = content.length
  target.integrity ??= { algorithm: 'SHA256', blockSize: 4194304, blocks: [] }
  target.integrity.hash = hash
  target.integrity.blocks = [hash]

  const newHeader = buildAsarHeader(header)
  const tmpPath = joinPath(resourcesDir, `app.asar.liuli-patch-${process.pid}.tmp`)
  try {
    writePatchedAsar(asarPath, tmpPath, newHeader, contentStart)
    copyFileSync(tmpPath, asarPath)
    copyFileSync(tmpPath, patchedCopyPath)
    console.log(`[dsh-liuli-ui-enhance] 已重建 ${asarPath}`)
    console.log(`[dsh-liuli-ui-enhance] 已同步 ${patchedCopyPath}`)
  } finally {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch { /* ignore */ }
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

  // Electron 主进程里 fs 带 ASAR 钩子，直接读写 app.asar 会抛 ENOENT；
  // 整个补丁过程关闭 ASAR 钩子，结束后恢复原值。
  const proc = process as ProcessWithNoAsar
  const previousNoAsar = proc.noAsar
  proc.noAsar = true
  try {
    if (!existsSync(asarPath)) {
      throw new Error('找不到 app.asar（客户端目录结构可能已变化）')
    }
    const libDir = joinPath(resourcesDir, 'app.asar.unpacked', 'lib')
    const runtime = resolveRuntime(libDir, asarPath)
    if (runtime === undefined) {
      throw new Error('在磁盘 app.asar.unpacked/lib 与 app.asar 头内均找不到 electron-runtime-*.js（客户端目录结构可能已变化）')
    }
    console.log(`[dsh-liuli-ui-enhance] 无边框自动补丁：runtime=${runtime.name}（${runtime.mode === 'disk' ? '磁盘 unpacked' : 'app.asar 打包'}）`)

    // 1. 备份原始 app.asar（首次）。
    if (!existsSync(backupPath)) {
      copyFileSync(asarPath, backupPath)
      console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：已备份 app.asar -> app.asar.bak-frameless')
    }

    // 2. 修改 runtime 内容（无边框 + webviewTag 两项补丁独立幂等）。
    let content = runtime.content
    let runtimeChanged = false
    const text = content.toString('utf8')
    if (text.includes(PATCH_MARK)) {
      console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：electron-runtime 已包含无边框补丁，跳过该部分')
    } else {
      const mainMatch = text.match(TITLEBAR_MAIN)
      const genericMatch = !mainMatch ? text.match(TITLEBAR_GENERIC) : undefined
      const block = mainMatch?.[0] ?? genericMatch?.[0]
      if (block === undefined) {
        throw new Error('未找到 win32 titleBarOverlay 补丁点（客户端版本可能不兼容，请运行 pnpm patch:desktop 手动补丁或更新插件）')
      }
      const heightExpr = (block.match(/height:\s*([^,}]+)/)?.[1] ?? '32').trim()
      const replacement = [
        `// [liuli-theme patch] 无边框窗口：移除原生 titleBarOverlay 按钮（原 titleBarOverlay height 表达式：${heightExpr}），`,
        '// 最小化/最大化/关闭改由页面内按钮承担（dsh-liuli-ui-enhance 插件 /liuli-window',
        '// 路由 + WindowControls 组件：会话 header 内 + 开始页标题条右侧兜底）。',
        '// 注意：未安装 dsh-liuli-ui-enhance 时 advanced 模式将没有窗口按钮（Alt+F4/托盘仍可用）。',
        'frame: false,',
      ].join('\n\t\t')
      content = Buffer.from(text.replace(block, replacement), 'utf8')
      runtimeChanged = true
      console.log(`[dsh-liuli-ui-enhance] 无边框自动补丁：已修补 ${runtime.name} 无边框配置（${mainMatch ? '主窗口标题栏块' : '通用标题栏块'}，原 height: ${heightExpr}）`)
    }
    // 启用 webviewTag：参考实现的浏览器用 <webview> DOM 标签承载，
    // 由 CSS overflow:hidden 自然裁剪，彻底避免 WebContentsView 溢出容器问题。
    const textAfter = content.toString('utf8')
    if (textAfter.includes('webviewTag: true')) {
      console.log('[dsh-liuli-ui-enhance] 浏览器补丁：electron-runtime 已启用 webviewTag，跳过该部分')
    } else {
      if (!WEBVIEWTAG_PATTERN.test(textAfter)) {
        console.warn('[dsh-liuli-ui-enhance] 浏览器补丁：未找到主窗口 webPreferences 补丁点，跳过 webviewTag（浏览器面板将回退 WebContentsView）')
      } else {
        content = Buffer.from(
          textAfter.replace(WEBVIEWTAG_PATTERN, (block) => block.replace('webSecurity: true', 'webviewTag: true,\n\t\t\twebSecurity: true')),
          'utf8',
        )
        runtimeChanged = true
        console.log('[dsh-liuli-ui-enhance] 浏览器补丁：已启用 webviewTag')
      }
    }

    // 3. 写回 runtime 内容 + 重建 asar 头（同步 size / SHA256 integrity）。
    commitRuntime(resourcesDir, asarPath, runtime, content, runtimeChanged)
    console.log('[dsh-liuli-ui-enhance] 无边框自动补丁：重启 DSH Desktop 后生效')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[dsh-liuli-ui-enhance] 无边框自动补丁未应用：', message)
    console.warn('[dsh-liuli-ui-enhance] 插件继续加载；页面内窗口按钮仍可用，原生标题栏按钮会保留。如需隐藏原生标题栏，请运行 pnpm patch:desktop')
  } finally {
    proc.noAsar = previousNoAsar
  }
}

/** 撤销无边框/webviewTag 补丁（unofficial_desktop 关闭时调用，尽力而为，失败不抛错）。
 *  幂等：未打补丁（无 marker / 无 webviewTag）时零写入；asar 头已一致时跳过重建。
 *  生效需重启 DSH Desktop（窗口参数在启动时读取）。 */
export function revertFramelessPatch(): void {
  if (process.platform !== 'win32') return
  if (process.versions.electron === undefined) return
  const resourcesDir = (process as typeof process & { resourcesPath?: string }).resourcesPath
  if (resourcesDir === undefined || resourcesDir === '') {
    console.warn('[dsh-liuli-ui-enhance] 无边框补丁还原跳过：process.resourcesPath 为空，无法定位客户端安装目录')
    return
  }

  const asarPath = joinPath(resourcesDir, 'app.asar')

  const proc = process as ProcessWithNoAsar
  const previousNoAsar = proc.noAsar
  proc.noAsar = true
  try {
    if (!existsSync(asarPath)) {
      throw new Error('找不到 app.asar（客户端目录结构可能已变化）')
    }
    const libDir = joinPath(resourcesDir, 'app.asar.unpacked', 'lib')
    const runtime = resolveRuntime(libDir, asarPath)
    if (runtime === undefined) {
      throw new Error('在磁盘 app.asar.unpacked/lib 与 app.asar 头内均找不到 electron-runtime-*.js（客户端目录结构可能已变化）')
    }
    console.log(`[dsh-liuli-ui-enhance] 无边框补丁还原：runtime=${runtime.name}（${runtime.mode === 'disk' ? '磁盘 unpacked' : 'app.asar 打包'}）`)

    let content = runtime.content
    let runtimeChanged = false
    const text = content.toString('utf8')
    const newMatch = text.match(MARKER_BLOCK_NEW)
    const legacyMatch = !newMatch ? text.match(MARKER_BLOCK_LEGACY) : undefined
    if (!newMatch && !legacyMatch) {
      console.log('[dsh-liuli-ui-enhance] 无边框补丁还原：electron-runtime 未包含无边框补丁，跳过还原')
    } else {
      const heightExpr = (newMatch?.[1] ?? '32').trim()
      const markerBlock = newMatch ? MARKER_BLOCK_NEW : MARKER_BLOCK_LEGACY
      const markerIndex = (newMatch ?? legacyMatch)?.index ?? 0
      const indent = detectTitlebarIndentBefore(text, markerIndex)
      content = Buffer.from(text.replace(markerBlock, () => nativeTitleBarRestore(heightExpr, indent)), 'utf8')
      runtimeChanged = true
      console.log(`[dsh-liuli-ui-enhance] 无边框补丁还原：已恢复官方原生标题栏配置（titleBarOverlay height: ${heightExpr}）`)
    }
    if (content.toString('utf8').includes('webviewTag: true')) {
      content = Buffer.from(content.toString('utf8').replace(/^\s*webviewTag: true,\r?\n/mg, ''), 'utf8')
      runtimeChanged = true
      console.log('[dsh-liuli-ui-enhance] 无边框补丁还原：已移除 webviewTag')
    }

    // 重建 asar 头（同步 size / SHA256 integrity）。
    commitRuntime(resourcesDir, asarPath, runtime, content, runtimeChanged)
    console.log('[dsh-liuli-ui-enhance] 无边框补丁还原：重启 DSH Desktop 后原生标题栏恢复')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[dsh-liuli-ui-enhance] 无边框补丁还原未完成：', message)
    console.warn('[dsh-liuli-ui-enhance] 可手动运行 pnpm patch:desktop --revert，或重新启用「桌面宿主补丁」开关后重启 DSH Desktop')
  } finally {
    proc.noAsar = previousNoAsar
  }
}