/**
 * 琉璃主题 · 顶栏补丁修复面（Host 半）
 *
 * 为什么需要它：窗口顶栏（无边框 + 自绘窗口按钮）依赖宿主补丁，而 DSH Desktop
 * 每次自动更新都会用官方文件整份覆盖 resources/app.asar 与 DeepSeek Harness.exe，
 * 补丁随之失效。以前只能退出客户端、在终端里手动跑补丁脚本。
 *
 * 本模块把「检测 + 就地补丁」做成插件内的两条路由，供悬浮球与设置页按钮调用：
 *
 * - GET  /liuli-topbar-patch  → { state, version, fuse, canApply, message }
 *                               state: patched | missing | needs-exit | unsupported
 * - POST /liuli-topbar-patch  → { ok, state, requiresRestart, message }
 *
 * 关键实现：**原地改写 asar 头**，写入后文件总长与内容区偏移完全不变。
 * - 只把 lib/main.js、lib/preload-app.cjs 两个条目标成 unpacked（内容挪到磁盘
 *   app.asar.unpacked/lib/ 下），其余条目一个字节都不动；
 * - 新头比旧头短的那部分用 padding 补齐，所以当前运行中的进程即使再按 offset
 *   读取归档内容也不会错位；
 * - 因此可以在客户端运行时写盘，只需在下次启动时生效（窗口参数只在创建时读取）。
 *
 * exe 内嵌哈希：能写就顺手同步（最保守）；运行中被锁时退回到 fuse 判断 ——
 * 只有 embeddedAsarIntegrityValidation 明确为 off 才允许「只写 asar」，
 * 否则返回 needs-exit，绝不冒让客户端起不来的风险。
 */

import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/* ── 与 scripts/patch-official-window-controls.mjs 保持一致的补丁内容 ───── */

const MARKER = '[liuli official window controls v1]'
const SUPPORTED = new Set(['0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.3'])
const FUSE_WIRE = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'

const MAIN_BEFORE = `titleBarStyle: "hidden",\n\t\t\ttitleBarOverlay: {\n\t\t\t\theight: 40,\n\t\t\t\tcolor: chromeFallbackFill(),\n\t\t\t\tsymbolColor: nativeTheme.shouldUseDarkColors ? "#f9fafb" : "#0f1115"\n\t\t\t}`
const MAIN_IPC_ANCHOR = '\tipcMain.on(PLATFORM_IPC.bootstrap, (event) => {'
const MAIN_SETTITLEBAR = 'if (validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({'

const MAIN_BRIDGE = `\n// ${MARKER}
ipcMain.handle("liuli-official-window", (event, action) => {
  const owner = assertMainApplication(event);
  switch (action) {
    case "minimize": owner.minimize(); break;
    case "toggleMaximize": owner.isMaximized() ? owner.unmaximize() : owner.maximize(); break;
    case "close": owner.close(); break;
    case "isMaximized": break;
    default: throw new Error("Unknown Liuli window action");
  }
  return { ok: true, maximized: !owner.isDestroyed() && owner.isMaximized() };
});\n`

const PRELOAD_BRIDGE = `\n// ${MARKER}
if (process.platform === "win32" && process.isMainFrame && location.protocol === "dsh-app:" && location.hostname === "app") {
  electron.contextBridge.exposeInMainWorld("liuliWindowControls", {
    official: true, platform: "win32",
    invoke: action => {
      if (!["minimize", "toggleMaximize", "close", "isMaximized"].includes(action)) return Promise.reject(new Error("Unknown window action"));
      return electron.ipcRenderer.invoke("liuli-official-window", action);
    }
  });
  const mountFallback = () => {
    const host = document.createElement("div");
    host.dataset.liuliNativeFallback = "";
    host.style.cssText = "position:fixed;right:8px;top:6px;z-index:2147483500;display:flex;border-radius:10px;background:#25282de8;color:#fff;-webkit-app-region:drag;padding:4px";
    for (const [action, label, glyph] of [["minimize","最小化窗口","−"],["toggleMaximize","最大化或还原窗口","□"],["close","关闭窗口","×"]]) {
      const button = document.createElement("button");
      button.textContent = glyph; button.title = label; button.setAttribute("aria-label", label);
      button.style.cssText = "width:34px;height:26px;color:inherit;border:0;border-radius:6px;background:transparent;font-size:18px;-webkit-app-region:no-drag;cursor:pointer";
      button.onclick = () => { void electron.ipcRenderer.invoke("liuli-official-window", action); };
      host.append(button);
    }
    document.body.append(host);
    const sync = () => { host.hidden = document.querySelector('[data-liuli-window-controls="caption"]') !== null; host.style.display = host.hidden ? "none" : "flex"; };
    const observer = new MutationObserver(sync); observer.observe(document.body, { childList: true, subtree: true }); sync();
    window.addEventListener("unload", () => observer.disconnect(), {once:true});
  };
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", mountFallback, {once:true}); else mountFallback();
}
`

/* ── 路由用的 HTTP 小工具（与 host-window.ts 同款，保持不导出） ─────────── */

function allowedCaller(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined || origin === 'null') return true
  try {
    const url = new URL(origin)
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'dsh-app:'
  } catch {
    return false
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: IncomingMessage, limit = 4096): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk as Buffer
    size += bytes.length
    if (size > limit) throw new Error('body too large')
    chunks.push(bytes)
  }
  if (chunks.length === 0) return null
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/* ── 安装目录与 asar 解析 ─────────────────────────────────────────────── */

interface InstallPaths {
  resourcesDir: string
  asarPath: string
  exePath: string
}

function resolveInstall(): InstallPaths | undefined {
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  if (typeof resourcesPath === 'string' && resourcesPath !== '' && existsSync(join(resourcesPath, 'app.asar'))) {
    return { resourcesDir: resourcesPath, asarPath: join(resourcesPath, 'app.asar'), exePath: join(dirname(resourcesPath), 'DeepSeek Harness.exe') }
  }
  const custom = process.env.DSH_DESKTOP_DIR
  const candidates = custom !== undefined && custom !== ''
    ? [custom]
    : [join(process.env.LOCALAPPDATA ?? '', 'Programs', 'DeepSeek Harness')]
  for (const dir of candidates) {
    const resourcesDir = join(dir, 'resources')
    const asarPath = join(resourcesDir, 'app.asar')
    if (existsSync(asarPath)) return { resourcesDir, asarPath, exePath: join(dir, 'DeepSeek Harness.exe') }
  }
  return undefined
}

interface AsarHeaderNode {
  size?: number
  offset?: string | number
  unpacked?: boolean
  integrity?: { algorithm?: string; blockSize?: number; blocks?: string[]; hash?: string }
  files?: Record<string, AsarHeaderNode>
}

interface AsarSnapshot {
  bytes: Buffer
  header: AsarHeaderNode
  jsonLength: number
  headerLength: number
  contentStart: number
}

/**
 * Electron 进程里 fs 带 ASAR 钩子：直接把 `...\app.asar` 当普通文件 open/read
 * 会被当成「归档内路径」处理而失败。所有对 asar 与 exe 的读写都必须包在这个
 * 包装里执行（与 frameless-patch.ts 的 withoutAsar 同款）。
 */
function withoutAsar<T>(fn: () => T): T {
  const proc = process as { noAsar?: boolean | undefined }
  const previous = proc.noAsar
  proc.noAsar = true
  try {
    return fn()
  } finally {
    if (previous === undefined) delete proc.noAsar
    else proc.noAsar = previous
  }
}

function readAsar(path: string): AsarSnapshot {
  const bytes = readFileSync(path)
  const jsonLength = bytes.readUInt32LE(12)
  const headerLength = 8 + bytes.readUInt32LE(4)
  return {
    bytes,
    header: JSON.parse(bytes.subarray(16, 16 + jsonLength).toString('utf8')) as AsarHeaderNode,
    jsonLength,
    headerLength,
    contentStart: headerLength,
  }
}

function entryNode(header: AsarHeaderNode, name: string): AsarHeaderNode | undefined {
  let node: AsarHeaderNode | undefined = header
  for (const part of name.split('/')) {
    node = node?.files?.[part]
    if (node === undefined) return undefined
  }
  return node
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function readEntryContent(paths: InstallPaths, snapshot: AsarSnapshot, name: string): Buffer | undefined {
  const node = entryNode(snapshot.header, name)
  if (node === undefined) return undefined
  if (node.unpacked === true) {
    const disk = join(`${paths.asarPath}.unpacked`, name)
    return existsSync(disk) ? readFileSync(disk) : undefined
  }
  const offset = Number(node.offset)
  if (!Number.isFinite(offset) || typeof node.size !== 'number') return undefined
  return snapshot.bytes.subarray(snapshot.contentStart + offset, snapshot.contentStart + offset + node.size)
}

/** 读 exe 里的 Electron fuse 位串（v1 布局；拿不到返回 unknown）。 */
function fuseState(exePath: string): 'on' | 'off' | 'unknown' {
  try {
    const exe = readFileSync(exePath)
    const wire = Buffer.from(FUSE_WIRE, 'ascii')
    const at = exe.indexOf(wire)
    if (at < 0) return 'unknown'
    const version = exe[at + wire.length]
    const count = exe[at + wire.length + 1]
    if (version === undefined || count === undefined || version !== 1 || count < 5 || count > 32) return 'unknown'
    const bits = exe.subarray(at + wire.length + 2, at + wire.length + 2 + count).toString('ascii')
    if (!/^[01]+$/.test(bits)) return 'unknown'
    return bits[4] === '0' ? 'off' : bits[4] === '1' ? 'on' : 'unknown'
  } catch {
    return 'unknown'
  }
}

export interface TopbarPatchStatus {
  state: 'patched' | 'missing' | 'needs-exit' | 'unsupported'
  version?: string | undefined
  fuse: 'on' | 'off' | 'unknown'
  canApply: boolean
  message?: string | undefined
}

/** 检测当前客户端是否需要（以及能否）就地补丁。 */
export function inspectTopbarPatch(): TopbarPatchStatus {
  return withoutAsar(() => inspectTopbarPatchInner())
}

function inspectTopbarPatchInner(): TopbarPatchStatus {
  const paths = resolveInstall()
  if (paths === undefined || !existsSync(paths.asarPath)) {
    return { state: 'unsupported', fuse: 'unknown', canApply: false, message: '未找到 DSH Desktop 的 app.asar（纯 Web 部署或安装目录不同）。' }
  }
  const fuse = fuseState(paths.exePath)
  let snapshot: AsarSnapshot
  try {
    snapshot = readAsar(paths.asarPath)
  } catch {
    return { state: 'unsupported', fuse, canApply: false, message: '无法解析 app.asar 头（客户端版本可能已变化）。' }
  }
  let version: string | undefined
  try {
    const pkg = readEntryContent(paths, snapshot, 'package.json')
    if (pkg !== undefined) version = (JSON.parse(pkg.toString('utf8')) as { version?: string }).version
  } catch { /* 版本读不出时继续用锚点判断 */ }

  const main = readEntryContent(paths, snapshot, 'lib/main.js')?.toString('utf8')
  if (main === undefined) {
    return { state: 'unsupported', version, fuse, canApply: false, message: 'app.asar 内找不到 lib/main.js。' }
  }
  if (main.includes(MARKER)) {
    return { state: 'patched', version, fuse, canApply: false, message: '无边框补丁已应用。' }
  }
  if (version !== undefined && !SUPPORTED.has(version)) {
    return { state: 'unsupported', version, fuse, canApply: false, message: `客户端 ${version} 不在补丁支持范围内（需更新插件的补丁锚点）。` }
  }
  const anchorAt = main.indexOf(MAIN_BEFORE)
  const createAt = main.indexOf('function createWindow(preload, show = false, primary = false)')
  if (createAt < 0 || anchorAt < 0) {
    return { state: 'unsupported', version, fuse, canApply: false, message: '找不到主窗口创建代码的补丁点（官方可能改写了窗口参数）。' }
  }
  return {
    state: 'missing',
    version,
    fuse,
    canApply: true,
    message: fuse === 'on'
      ? '需要同步 exe 内嵌哈希：请退出客户端后运行补丁脚本（运行时无法写 exe）。'
      : '可立即打补丁，重启客户端后生效。',
  }
}

export interface TopbarPatchResult {
  ok: boolean
  state: TopbarPatchStatus['state']
  requiresRestart: boolean
  message: string
}

/** 就地打补丁：只改 asar 头（长度不变）+ 写 unpacked 文件；exe 能写就同步。 */
export function applyTopbarPatch(): TopbarPatchResult {
  return withoutAsar(() => applyTopbarPatchInner())
}

function applyTopbarPatchInner(): TopbarPatchResult {
  const paths = resolveInstall()
  if (paths === undefined) return { ok: false, state: 'unsupported', requiresRestart: false, message: '未找到客户端安装目录。' }

  const status = inspectTopbarPatch()
  if (status.state === 'patched') return { ok: true, state: 'patched', requiresRestart: false, message: '无边框补丁已应用，无需重复操作。' }
  if (status.state === 'unsupported') return { ok: false, state: 'unsupported', requiresRestart: false, message: status.message ?? '当前客户端不支持该补丁。' }

  const fuse = status.fuse
  const snapshot = readAsar(paths.asarPath)
  const mainText = readEntryContent(paths, snapshot, 'lib/main.js')?.toString('utf8')
  const preloadText = readEntryContent(paths, snapshot, 'lib/preload-app.cjs')?.toString('utf8')
  if (mainText === undefined || preloadText === undefined) {
    return { ok: false, state: 'unsupported', requiresRestart: false, message: 'app.asar 内缺少 lib/main.js 或 lib/preload-app.cjs。' }
  }

  // 1. main.js：主窗口改 frame:false + 注入 IPC + 关掉官方的 setTitleBarOverlay 调用
  const createAt = mainText.indexOf('function createWindow(preload, show = false, primary = false)')
  const head = mainText.slice(0, createAt)
  let tail = mainText.slice(createAt)
  const anchorAt = tail.indexOf(MAIN_BEFORE)
  if (createAt < 0 || anchorAt < 0) {
    return { ok: false, state: 'unsupported', requiresRestart: false, message: '锚点不匹配：官方改写了主窗口创建代码，跳过写入。' }
  }
  tail = tail.slice(0, anchorAt) + 'frame: false' + tail.slice(anchorAt + MAIN_BEFORE.length)
  if (!tail.includes(MAIN_IPC_ANCHOR) || !tail.includes(MAIN_SETTITLEBAR)) {
    return { ok: false, state: 'unsupported', requiresRestart: false, message: '锚点不匹配：找不到 IPC 注入点或 setTitleBarOverlay 调用。' }
  }
  tail = tail.replace(MAIN_IPC_ANCHOR, MAIN_BRIDGE + MAIN_IPC_ANCHOR)
  tail = tail.replace(MAIN_SETTITLEBAR, MAIN_SETTITLEBAR.replace('if (', 'if (false && '))
  const nextMain = head + tail
  const nextPreload = `${preloadText}\n${PRELOAD_BRIDGE}`

  // 3. exe 可写性预检：只有 fuse 明确 off 时才允许「只写 asar、不同步 exe」，
  //    否则一律要求客户端退出后走离线脚本，避免启动时校验失败。
  const exeWritable = (() => {
    try {
      const fd = openSync(paths.exePath, 'r+')
      closeSync(fd)
      return true
    } catch {
      return false
    }
  })()
  if (!exeWritable && fuse !== 'off') {
    return {
      ok: false,
      state: 'needs-exit',
      requiresRestart: true,
      message: '该客户端启用了 ASAR 完整性校验（或无法确认开关），必须在客户端完全退出后补丁：运行时写不了 exe。',
    }
  }

  // 4. 写 unpacked 文件（原地；运行中可写）
  const unpackedLib = join(`${paths.asarPath}.unpacked`, 'lib')
  mkdirSync(unpackedLib, { recursive: true })
  writeFileSync(join(unpackedLib, 'main.js'), nextMain)
  writeFileSync(join(unpackedLib, 'preload-app.cjs'), nextPreload)

  // 3. 改头：两个条目改 unpacked（其余条目原样），并把长度差用 padding 吸收
  const nextHeader = JSON.parse(JSON.stringify(snapshot.header)) as AsarHeaderNode
  for (const [name, text] of [['lib/main.js', nextMain], ['lib/preload-app.cjs', nextPreload]] as const) {
    const node = entryNode(nextHeader, name)
    if (node === undefined) return { ok: false, state: 'unsupported', requiresRestart: false, message: `app.asar 内缺少 ${name}。` }
    const bytes = Buffer.from(text)
    node.unpacked = true
    delete node.offset
    node.size = bytes.length
    node.integrity = { algorithm: 'SHA256', blockSize: 4194304, blocks: [sha256(bytes)], hash: sha256(bytes) }
  }
  const nextJson = Buffer.from(JSON.stringify(nextHeader))
  const newPad = snapshot.headerLength - 16 - nextJson.length
  if (newPad < 0) {
    return { ok: false, state: 'needs-exit', requiresRestart: true, message: '新版头比原头长，运行时无法原地写入：请退出客户端后运行补丁脚本。' }
  }
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0)
  prefix.writeUInt32LE(nextJson.length + 8 + newPad, 4)
  prefix.writeUInt32LE(nextJson.length + 4 + newPad, 8)
  prefix.writeUInt32LE(nextJson.length, 12)
  const headerBytes = Buffer.concat([prefix, nextJson, Buffer.alloc(newPad)])

  // 4. 写 asar 头（长度不变，内容区不动）
  try {
    const fd = openSync(paths.asarPath, 'r+')
    try {
      writeSync(fd, headerBytes, 0, headerBytes.length, 0)
    } finally {
      closeSync(fd)
    }
  } catch (error) {
    // 写失败要把已经落盘的 unpacked 文件回滚成原内容，避免头/内容不一致
    try {
      writeFileSync(join(unpackedLib, 'main.js'), mainText)
      writeFileSync(join(unpackedLib, 'preload-app.cjs'), preloadText)
    } catch { /* 尽力回滚 */ }
    return {
      ok: false,
      state: 'needs-exit',
      requiresRestart: true,
      message: `无法写入 app.asar（${error instanceof Error ? error.message : String(error)}）：请退出客户端后运行补丁脚本。`,
    }
  }

  // 5. exe 内嵌哈希：预检确认可写时同步（最保守；不可写且 fuse=off 时跳过）
  let exeSynced = false
  if (exeWritable) {
    try {
      const exeBytes = readFileSync(paths.exePath)
      const oldHeaderHash = Buffer.from(sha256(snapshot.bytes.subarray(16, 16 + snapshot.jsonLength)), 'ascii')
      const at = exeBytes.indexOf(oldHeaderHash)
      if (at >= 0) {
        exeBytes.write(sha256(nextJson), at, 64, 'ascii')
        writeFileSync(paths.exePath, exeBytes)
        exeSynced = true
      }
    } catch { /* exe 写入失败：fuse=off 时不影响启动 */ }
  }

  const after = inspectTopbarPatch()
  if (after.state !== 'patched') {
    return { ok: false, state: after.state, requiresRestart: true, message: `写入后校验失败：${after.message ?? '未知原因'}` }
  }
  return {
    ok: true,
    state: 'patched',
    requiresRestart: true,
    message: exeSynced
      ? '无边框补丁已写入（含 exe 哈希同步）。重启 DSH Desktop 后生效。'
      : fuse === 'off'
        ? '无边框补丁已写入 app.asar（该客户端未启用 asar 完整性校验，无需同步 exe）。重启 DSH Desktop 后生效。'
        : '无边框补丁已写入 app.asar，但未能同步 exe 哈希且无法确认校验开关：重启前建议先运行补丁脚本 --check 复核。',
  }
}

/** /liuli-topbar-patch 路由：GET 查状态，POST 就地补丁。 */
export function topbarPatchRoute(): WebRoute {
  return {
    kind: 'prefix',
    path: '/liuli-topbar-patch',
    handler: (req, res) => {
      void (async () => {
        try {
          if (!allowedCaller(req)) {
            sendJson(res, 403, { ok: false, error: 'forbidden' })
            return
          }
          if (req.method === 'GET' || req.method === 'HEAD') {
            sendJson(res, 200, inspectTopbarPatch())
            return
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          await readJsonBody(req).catch(() => null)
          sendJson(res, 200, applyTopbarPatch())
        } catch (error) {
          sendJson(res, 500, { ok: false, state: 'unsupported', requiresRestart: false, message: error instanceof Error ? error.message : String(error) })
        }
      })()
    },
  }
}
