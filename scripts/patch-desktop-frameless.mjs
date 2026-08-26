#!/usr/bin/env node
// 琉璃主题 · DSH Desktop win32 无边框宿主补丁
//
// 作用：全新 DSH Desktop 没有应用 frameless 补丁时，原生标题栏/窗口按钮
// 无法隐藏。本脚本修改安装目录里的：
//   resources/app.asar.unpacked/lib/electron-runtime-*.js（动态查找，客户端升级会换 hash 文件名）
// 和
//   resources/app.asar
// 把 win32 主窗口分支从 titleBarStyle: "hidden" + titleBarOverlay
// 改为 frame: false，并同步 asar 头里的 size/integrity。
//
// 两种客户端布局都支持：
//   旧布局：electron-runtime-*.js 直接位于 app.asar.unpacked/lib 磁盘目录（unpacked 条目）。
//   新布局：electron-runtime-*.js 被打包进 app.asar 内部（packed 条目，offset 相对内容区起点）。
//          此时脚本把补丁后的内容解包写到磁盘 unpacked 目录，并把 asar 头条目从
//          packed（带 offset）改为 unpacked（去 offset），让 Electron 改从磁盘读取。
//
// 用法：
//   node scripts/patch-desktop-frameless.mjs            # 打补丁（无边框 + webviewTag）
//   node scripts/patch-desktop-frameless.mjs --revert   # 还原（恢复原生标题栏，移除 webviewTag）
//   DSH_DESKTOP_DIR="C:\Program Files\DSH Desktop" node scripts/patch-desktop-frameless.mjs
// 安装目录查找顺序：DSH_DESKTOP_DIR 环境变量 → 正在运行的 DSH Desktop 进程路径 → 默认安装路径。
//
// 安全：
//   - 首次运行会把 resources/app.asar 备份为 app.asar.bak-frameless。
//   - 已包含 [liuli-theme patch] 时跳过文件修改，只校验/重建 asar 头。
//   - 重建 asar 头时保留头之后的原始字节（打包布局下条目 offset 相对内容区起点，
//     头部长度变化不影响其有效性，尾部可原样接回，不会被截断）。
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// DSH Desktop 的 runtime-commands 会把 pnpm 的 node 解析为 Electron 内置 node，
// 其 fs 带 ASAR 钩子，读/写 .asar 文件会失败。检测到 Electron node 时，用
// PowerShell 找到系统 node 后重新执行本脚本，保证补丁读写的是真实磁盘文件。
if (process.versions.electron !== undefined) {
  const scriptPath = fileURLToPath(import.meta.url);
  let systemNode;
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-Command',
      "(Get-Command node.exe -All | Where-Object { $_.Source -notlike '*DSH Desktop*' } | Select-Object -First 1 -ExpandProperty Source)",
    ], { encoding: 'utf8', timeout: 15000 });
    systemNode = out.split(/\r?\n/).map(s => s.trim()).find(s => /node\.exe$/i.test(s));
  } catch { systemNode = undefined; }
  if (systemNode !== undefined) {
    try {
      execFileSync(systemNode, [scriptPath, ...process.argv.slice(2)], { stdio: 'inherit' });
      process.exit(0);
    } catch (error) {
      process.exit(typeof error?.status === 'number' ? error.status : 1);
    }
  } else {
    console.error('[dsh-liuli-ui-enhance] 当前运行在 Electron node 下且找不到系统 node，无法打补丁');
    process.exit(1);
  }
}

// 兜底：若仍运行在带 ASAR 钩子的 node 里（如未来的 Electron 变体），关闭钩子
// 才能直接读写 .asar 归档文件本身。普通 node 下这个属性无副作用。
process.noAsar = true;

/** 从正在运行的 DSH Desktop 进程推导安装目录（客户端装在非默认路径时用）。 */
function findRunningDesktopDir() {
  if (process.platform !== 'win32') return undefined;
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-Command',
      "(Get-Process 'DSH Desktop' -ErrorAction SilentlyContinue).Path",
    ], { encoding: 'utf8', timeout: 15000 });
    const path = out.split(/\r?\n/).map(s => s.trim()).find(s => /DSH Desktop\.exe$/i.test(s));
    return path !== undefined ? dirname(path) : undefined;
  } catch {
    return undefined;
  }
}

const installDir = process.env.DSH_DESKTOP_DIR
  || findRunningDesktopDir()
  || (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'DSH Desktop')
    : join(homedir(), 'Applications', 'DSH Desktop.app', 'Contents', 'Resources'));

const resourcesDir = join(installDir, 'resources');
const asarPath = join(resourcesDir, 'app.asar');
const backupPath = join(resourcesDir, 'app.asar.bak-frameless');
const patchedCopyPath = join(resourcesDir, 'app.asar.patched');
const libDir = join(resourcesDir, 'app.asar.unpacked', 'lib');

function fail(message) {
  console.error(`[dsh-liuli-ui-enhance] ${message}`);
  process.exit(1);
}

function readFullySync(fd, length, position) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const bytesRead = readSync(fd, buffer, offset, length - offset, position + offset);
    if (bytesRead <= 0) throw new Error(`读取不完整：期望 ${length} 字节，实际 ${offset} 字节`);
    offset += bytesRead;
  }
  return buffer;
}

function writeFullySync(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const bytesWritten = writeSync(fd, buffer, offset, buffer.length - offset);
    if (bytesWritten <= 0) throw new Error('写入不完整');
    offset += bytesWritten;
  }
}

/** 客户端升级会换 electron-runtime-<hash>.js 文件名，不能写死。
 *  优先在磁盘 unpacked lib 里找包含 titleBarStyle 的（旧布局）；
 *  找不到则解析 app.asar 头，在打包条目里找并读出内容（新布局）。 */
function resolveRuntime() {
  // 1) 磁盘 unpacked 目录（旧布局 / 已解包的新布局）
  let names = [];
  try { names = readdirSync(libDir); } catch { /* lib 目录可能不存在 */ }
  const diskCandidates = names.filter((name) => /^electron-runtime-[A-Za-z0-9_-]+\.js$/.test(name));
  for (const name of diskCandidates) {
    try {
      const content = readFileSync(join(libDir, name));
      if (content.toString('utf8').includes('titleBarStyle')) {
        return { name, content, mode: 'disk' };
      }
    } catch { /* 继续找下一个 */ }
  }
  // 2) app.asar 打包条目（新布局：electron-runtime 在归档内部，offset 相对内容区起点）
  try {
    const { header, contentStart } = readAsarHeader(asarPath);
    const libFiles = header?.files?.lib?.files ?? {};
    const packedNames = Object.keys(libFiles).filter(
      (name) => /^electron-runtime-[A-Za-z0-9_-]+\.js$/.test(name) && libFiles[name]?.unpacked !== true,
    );
    for (const name of packedNames) {
      try {
        const content = readPackedEntry(asarPath, libFiles[name], contentStart);
        if (content.toString('utf8').includes('titleBarStyle')) {
          return { name, content, mode: 'asar', header, contentStart };
        }
      } catch { /* 继续找下一个 */ }
    }
  } catch { /* 头读取失败，走兜底 */ }
  // 3) 兜底：磁盘目录里取最大者（通常就是完整 runtime bundle）；打包条目取 size 最大者。
  let best; let bestSize = -1;
  for (const name of diskCandidates) {
    try {
      const size = statSync(join(libDir, name)).size;
      if (size > bestSize) { best = { name, size, mode: 'disk' }; bestSize = size; }
    } catch { /* ignore */ }
  }
  try {
    const { header, contentStart } = readAsarHeader(asarPath);
    const libFiles = header?.files?.lib?.files ?? {};
    for (const [name, entry] of Object.entries(libFiles)) {
      if (!/^electron-runtime-[A-Za-z0-9_-]+\.js$/.test(name) || entry.unpacked === true) continue;
      const size = typeof entry.size === 'number' ? entry.size : 0;
      if (size > bestSize) { best = { name, size, mode: 'asar', header, contentStart }; bestSize = size; }
    }
  } catch { /* ignore */ }
  if (best !== undefined) {
    try {
      if (best.mode === 'asar') {
        const libFiles = best.header.files.lib.files;
        return { name: best.name, content: readPackedEntry(asarPath, libFiles[best.name], best.contentStart), mode: 'asar', header: best.header, contentStart: best.contentStart };
      }
      return { name: best.name, content: readFileSync(join(libDir, best.name)), mode: 'disk' };
    } catch { /* ignore */ }
  }
  return undefined;
}

/** 从 asar 内容区（contentStart + offset）读取打包文件内容。 */
function readPackedEntry(asarPath, entry, contentStart) {
  const offset = parseInt(entry.offset, 10);
  if (!Number.isFinite(offset) || offset < 0) throw new Error(`asar 条目无有效 offset：${JSON.stringify(entry)}`);
  const fd = openSync(asarPath, 'r');
  try {
    return readFullySync(fd, entry.size, contentStart + offset);
  } finally {
    closeSync(fd);
  }
}

/** 读取并解析 asar 头。返回头 JSON 与内容区起点 contentStart。 */
function readAsarHeader(path) {
  const fd = openSync(path, 'r');
  try {
    const prefix = readFullySync(fd, 16, 0);
    if (prefix.readUInt32LE(0) !== 4) {
      fail('app.asar 头格式无法识别（不是标准 asar）');
    }
    const jsonLength = prefix.readUInt32LE(12);
    const pad = prefix.readUInt32LE(8) - jsonLength - 4;
    if (pad < 0) {
      fail('app.asar 头格式无法识别（padding 非法）');
    }
    const jsonBuffer = readFullySync(fd, jsonLength, 16);
    return { header: JSON.parse(jsonBuffer.toString('utf8')), contentStart: 16 + jsonLength + pad };
  } finally {
    closeSync(fd);
  }
}

/** 按 asar pickle 格式重建头部（4 字节对齐 padding 动态计算）。 */
function buildAsarHeader(header) {
  const jsonBuffer = Buffer.from(JSON.stringify(header), 'utf8');
  const pad = (4 - (jsonBuffer.length % 4)) % 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0);
  prefix.writeUInt32LE(jsonBuffer.length + 8 + pad, 4);
  prefix.writeUInt32LE(jsonBuffer.length + 4 + pad, 8);
  prefix.writeUInt32LE(jsonBuffer.length, 12);
  return Buffer.concat([prefix, jsonBuffer, Buffer.alloc(pad)]);
}

/** 生成完整的新 asar 文件：新头 + 原文件 contentStart 之后的全部字节原样接上。
 *  打包条目的 offset 相对内容区起点，头部长度变化不影响其有效性，尾部不会被截断。 */
function writePatchedAsar(sourcePath, destPath, newHeader, contentStart) {
  const srcFd = openSync(sourcePath, 'r');
  const destFd = openSync(destPath, 'w');
  try {
    writeFullySync(destFd, newHeader);
    const sourceSize = statSync(sourcePath).size;
    if (sourceSize <= contentStart) return;
    const chunkSize = 4 * 1024 * 1024;
    const buffer = Buffer.alloc(chunkSize);
    let position = contentStart;
    while (position < sourceSize) {
      const bytesRead = readSync(srcFd, buffer, 0, Math.min(chunkSize, sourceSize - position), position);
      if (bytesRead <= 0) break;
      writeFullySync(destFd, buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    closeSync(srcFd);
    closeSync(destFd);
  }
}

/** 在 asar 头中找到 lib/<runtimeName> 条目。 */
function findRuntimeNode(header, runtimeName) {
  let node = header;
  for (const part of ['lib', runtimeName]) {
    if (node?.files?.[part] === undefined) fail(`asar 头中缺少 ${part}`);
    node = node.files[part];
  }
  return node;
}

const REVERT = process.argv.includes('--revert');

// 主窗口 win32 补丁点：customChromeWindowOptions 的 win32 分支（含 autoHideMenuBar: true 前缀，
// height 用 geometry.titlebarHeight），不是 auxiliary 辅助窗口那份（height 字面量 36）。
const TITLEBAR_MAIN = /(?<=autoHideMenuBar:\s*true,\s*)titleBarStyle:\s*"hidden",\s*titleBarOverlay:\s*\{[\s\S]*?\},/;
// 兜底：无 autoHideMenuBar 锚定的历史布局（旧版客户端只有一处 titleBarOverlay）。
const TITLEBAR_GENERIC = /titleBarStyle:\s*"hidden",\s*titleBarOverlay:\s*\{[\s\S]*?\},/;
// advanced/compatibility 主窗口的 webPreferences 块（开头是 preload…webSecurity:true，
// 兼容结尾是 `}` 或继续跟 partition 等字段；不匹配 profile 小窗/对话框块）。
const WEBVIEWTAG_PATTERN = /webPreferences:\s*\{\s*preload,\s*contextIsolation:\s*true,\s*nodeIntegration:\s*false,\s*sandbox:\s*true,\s*webSecurity:\s*true(?:,|\s*})/g;
// 新版标记块：注释里记录原 titleBarOverlay height 表达式，还原时可逐字恢复。
// 注意用 m 标志并吞掉行首缩进：patch 时注释行前保留了原 titleBarStyle 行的缩进，
// 还原若不吞掉会双重缩进（保留缩进 + restore 自带 indent）。
const MARKER_BLOCK_NEW = /^[ \t]*\/\/ \[liuli-theme patch\] 无边框窗口：移除原生 titleBarOverlay 按钮（原 titleBarOverlay height 表达式：([^）]*)），[\s\S]*?\n[ \t]*frame: false,/m;
// 旧版标记块（无 height 记录；还原按官方原版 height:32 处理）。
const MARKER_BLOCK_LEGACY = /^[ \t]*\/\/ \[liuli-theme patch\] 无边框窗口：[\s\S]*?\n[ \t]*frame: false,/m;

function nativeTitleBarRestore(heightExpr, indent = '\t\t') {
  return [
    `${indent}titleBarStyle: "hidden",`,
    `${indent}titleBarOverlay: {`,
    `${indent}\tcolor: "#00000000",`,
    `${indent}\tsymbolColor: "#7f858f",`,
    `${indent}\theight: ${heightExpr}`,
    `${indent}},`,
  ].join('\n');
}

/** 从被替换的 marker 之前找最近的 autoHideMenuBar 行推断主窗口标题栏块缩进
 *  （新版 customChromeWindowOptions 是 3 层 tab；文件里对话框窗口也有
 *  autoHideMenuBar，不能全局找第一处）。找不到时退回 2 层 tab（旧版布局）。 */
function detectTitlebarIndentBefore(text, beforeIndex) {
  const head = text.slice(0, beforeIndex);
  const lines = head.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^([ \t]*)autoHideMenuBar:\s*true,/);
    if (m) return m[1];
  }
  return '\t\t';
}

// 1. 定位 runtime 文件（磁盘 unpacked 或 asar 打包条目）
const runtime = resolveRuntime();
if (runtime === undefined) {
  fail(`找不到 electron-runtime-*.js（磁盘 ${libDir} 与 app.asar 头内均未命中；可设置 DSH_DESKTOP_DIR 指向 DSH Desktop 安装目录后重试；当前安装目录：${installDir}）`);
}
if (!existsSync(asarPath)) {
  fail(`找不到 ${asarPath}（可设置 DSH_DESKTOP_DIR 指向 DSH Desktop 安装目录后重试；当前安装目录：${installDir}）`);
}
const diskRuntimePath = join(libDir, runtime.name);
console.log(`[dsh-liuli-ui-enhance] 运行时文件：${runtime.name}（${runtime.mode === 'disk' ? '磁盘 unpacked' : 'app.asar 打包'}）`);

// 2. 备份原始 app.asar（仅补丁模式；还原模式不需要备份）
if (REVERT) {
  console.log('[dsh-liuli-ui-enhance] 还原模式：恢复原生标题栏并移除 webviewTag 补丁');
} else if (!existsSync(backupPath)) {
  copyFileSync(asarPath, backupPath);
  console.log(`[dsh-liuli-ui-enhance] 已备份原始 app.asar -> ${backupPath}`);
} else {
  console.log(`[dsh-liuli-ui-enhance] 备份已存在，跳过：${backupPath}`);
}

// 3. 修改 runtime 内容（补丁 / 还原 两个方向，各自幂等）
let content = runtime.content;
let runtimeChanged = false;

if (REVERT) {
  const text = content.toString('utf8');
  const newMatch = text.match(MARKER_BLOCK_NEW);
  const legacyMatch = !newMatch ? text.match(MARKER_BLOCK_LEGACY) : undefined;
  if (!newMatch && !legacyMatch) {
    console.log('[dsh-liuli-ui-enhance] electron-runtime 未包含无边框补丁，跳过还原');
  } else {
    const heightExpr = (newMatch?.[1] ?? '32').trim();
    const markerBlock = newMatch ? MARKER_BLOCK_NEW : MARKER_BLOCK_LEGACY;
    const indent = detectTitlebarIndentBefore(text, (newMatch ?? legacyMatch).index);
    content = Buffer.from(text.replace(markerBlock, () => nativeTitleBarRestore(heightExpr, indent)), 'utf8');
    runtimeChanged = true;
    console.log(`[dsh-liuli-ui-enhance] 已还原官方原生标题栏配置（titleBarOverlay height: ${heightExpr}）`);
  }
  if (content.toString('utf8').includes('webviewTag: true')) {
    content = Buffer.from(content.toString('utf8').replace(/^\s*webviewTag: true,\r?\n/mg, ''), 'utf8');
    runtimeChanged = true;
    console.log('[dsh-liuli-ui-enhance] 已移除 webviewTag 补丁');
  } else {
    console.log('[dsh-liuli-ui-enhance] electron-runtime 未包含 webviewTag 补丁，跳过还原');
  }
} else {
  const text = content.toString('utf8');
  if (text.includes('[liuli-theme patch]')) {
    console.log('[dsh-liuli-ui-enhance] electron-runtime 已包含无边框补丁，跳过该部分');
  } else {
    const mainMatch = text.match(TITLEBAR_MAIN);
    const genericMatch = !mainMatch ? text.match(TITLEBAR_GENERIC) : undefined;
    const block = mainMatch?.[0] ?? genericMatch?.[0];
    if (block === undefined) {
      fail('未在 electron-runtime 中找到 win32 titleBarOverlay 补丁点，已取消修改');
    }
    const heightExpr = (block.match(/height:\s*([^,}]+)/)?.[1] ?? '32').trim();
    const replacement = [
      `// [liuli-theme patch] 无边框窗口：移除原生 titleBarOverlay 按钮（原 titleBarOverlay height 表达式：${heightExpr}），`,
      '// 最小化/最大化/关闭改由页面内按钮承担（dsh-liuli-ui-enhance 插件 /liuli-window',
      '// 路由 + WindowControls 组件：会话 header 内 + 开始页标题条右侧兜底）。',
      '// 注意：未安装 dsh-liuli-ui-enhance 时 advanced 模式将没有窗口按钮（Alt+F4/托盘仍可用）。',
      'frame: false,',
    ].join('\n\t\t');
    content = Buffer.from(text.replace(block, () => replacement), 'utf8');
    runtimeChanged = true;
    console.log(`[dsh-liuli-ui-enhance] 已修补 ${runtime.name} 无边框配置（${mainMatch ? '主窗口标题栏块' : '通用标题栏块'}，原 height: ${heightExpr}）`);
  }
  // 启用 webviewTag：zcode 参考实现的浏览器用 <webview> DOM 标签承载，
  // 由 CSS overflow:hidden 自然裁剪，彻底避免 WebContentsView 溢出容器问题。
  const textAfter = content.toString('utf8');
  if (textAfter.includes('webviewTag: true')) {
    console.log('[dsh-liuli-ui-enhance] electron-runtime 已启用 webviewTag，跳过该部分');
  } else {
    if (!WEBVIEWTAG_PATTERN.test(textAfter)) {
      console.warn('[dsh-liuli-ui-enhance] 未找到主窗口 webPreferences 补丁点，跳过 webviewTag（浏览器面板将回退 WebContentsView）');
    } else {
      content = Buffer.from(
        textAfter.replace(WEBVIEWTAG_PATTERN, (block) => block.replace('webSecurity: true', 'webviewTag: true,\n\t\t\twebSecurity: true')),
        'utf8',
      );
      runtimeChanged = true;
      console.log('[dsh-liuli-ui-enhance] 已启用 webviewTag');
    }
  }
}

// 4. 写回 runtime 内容 + 重建 asar 头（同步 size / SHA256 integrity）。
//    - 磁盘布局：直接写磁盘文件，头里条目已是 unpacked，同步 size/integrity 即可。
//    - asar 打包布局：把补丁后的内容解包写到磁盘 unpacked 目录，头里条目从
//      packed（带 offset）改为 unpacked（去 offset），Electron 改从磁盘读取。
if (runtimeChanged) {
  mkdirSync(libDir, { recursive: true });
  writeFileSync(diskRuntimePath, content);
  console.log(`[dsh-liuli-ui-enhance] 已写入 ${diskRuntimePath}`);
}

const { header, contentStart } = readAsarHeader(asarPath);
const target = findRuntimeNode(header, runtime.name);
const hash = createHash('sha256').update(content).digest('hex');
const needUnpack = target.unpacked !== true;

// 幂等快路径：内容没变 && 头部已是最新（unpacked 状态、size、hash 一致）时
// 跳过整文件重写，避免每次启动都重写 100MB+ 的 app.asar。
if (!runtimeChanged && !needUnpack && target.size === content.length && target.integrity?.hash === hash) {
  console.log('[dsh-liuli-ui-enhance] asar 头已是最新，跳过重建（不再重写 app.asar）');
} else {
  if (needUnpack) {
    // packed 条目 -> unpacked：去掉 offset，内容改由 app.asar.unpacked 磁盘文件承担
    delete target.offset;
    target.unpacked = true;
    console.log('[dsh-liuli-ui-enhance] asar 条目已从打包改为 unpacked（内容改由磁盘文件承载）');
  }
  target.size = content.length;
  target.integrity ??= { algorithm: 'SHA256', blockSize: 4194304, blocks: [] };
  target.integrity.hash = hash;
  target.integrity.blocks = [hash];

  const newHeader = buildAsarHeader(header);
  const tmpPath = join(resourcesDir, `app.asar.liuli-patch-${process.pid}.tmp`);
  try {
    writePatchedAsar(asarPath, tmpPath, newHeader, contentStart);
    copyFileSync(tmpPath, asarPath);
    copyFileSync(tmpPath, patchedCopyPath);
    console.log(`[dsh-liuli-ui-enhance] 已重建 ${asarPath}`);
    console.log(`[dsh-liuli-ui-enhance] 已同步 ${patchedCopyPath}`);
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

if (REVERT) {
  console.log('[dsh-liuli-ui-enhance] 还原完成：请重启 DSH Desktop 恢复原生标题栏');
} else {
  console.log('[dsh-liuli-ui-enhance] 请重启 DSH Desktop 生效');
}