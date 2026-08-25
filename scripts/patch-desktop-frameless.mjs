#!/usr/bin/env node
// 琉璃主题 · DSH Desktop win32 无边框宿主补丁
//
// 作用：全新 DSH Desktop 没有应用 frameless 补丁时，原生标题栏/窗口按钮
// 无法隐藏。本脚本修改安装目录里的：
//   resources/app.asar.unpacked/lib/electron-runtime-*.js（动态查找，客户端升级会换 hash 文件名）
// 和
//   resources/app.asar
// 把 win32 advanced 分支从 titleBarStyle: "hidden" + titleBarOverlay
// 改为 frame: false，并同步 asar 头里的 size/integrity。
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
//   - 重建 asar 头时保留头之后的原始字节（DSH 当前全 unpacked，通常没有尾部；
//     若未来版本出现打包文件也不会被截断）。
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

/** 客户端升级会换 electron-runtime-<hash>.js 文件名，动态找一个包含 titleBarStyle 的。 */
function findRuntimeName() {
  let names = [];
  try { names = readdirSync(libDir); } catch { return undefined; }
  const candidates = names.filter((name) => /^electron-runtime-[A-Za-z0-9_-]+\.js$/.test(name));
  for (const name of candidates) {
    try {
      if (readFileSync(join(libDir, name), 'utf8').includes('titleBarStyle')) return name;
    } catch { /* 继续找下一个 */ }
  }
  // 兜底：取最大者（通常就是完整 runtime bundle）。
  let best; let bestSize = -1;
  for (const name of candidates) {
    try {
      const size = statSync(join(libDir, name)).size;
      if (size > bestSize) { best = name; bestSize = size; }
    } catch { /* ignore */ }
  }
  return best;
}

const runtimeName = findRuntimeName();
if (runtimeName === undefined) {
  fail(`在 ${libDir} 下找不到 electron-runtime-*.js（可设置 DSH_DESKTOP_DIR 指向 DSH Desktop 安装目录后重试；当前安装目录：${installDir}）`);
}
const runtimePath = join(libDir, runtimeName);

for (const file of [asarPath, runtimePath]) {
  if (!existsSync(file)) {
    fail(`找不到 ${file}（可设置 DSH_DESKTOP_DIR 指向 DSH Desktop 安装目录后重试；当前安装目录：${installDir}）`);
  }
}

// 1. 备份原始 app.asar（仅补丁模式；还原模式不需要备份）
const REVERT = process.argv.includes('--revert');
if (REVERT) {
  console.log('[dsh-liuli-ui-enhance] 还原模式：恢复原生标题栏并移除 webviewTag 补丁');
} else if (!existsSync(backupPath)) {
  copyFileSync(asarPath, backupPath);
  console.log(`[dsh-liuli-ui-enhance] 已备份原始 app.asar -> ${backupPath}`);
} else {
  console.log(`[dsh-liuli-ui-enhance] 备份已存在，跳过：${backupPath}`);
}

// 2. 修改 unpacked electron runtime（补丁 / 还原 两个方向，各自幂等）
let runtime = readFileSync(runtimePath, 'utf8');
let runtimeChanged = false;
if (REVERT) {
  // marker 注释块 + frame:false → 逐字还原官方 win32 advanced 窗口配置
  // （anywhere-labs/dsh-desktop 的 window-options.ts，bundler 已内联常量：
  // titleBarStyle:"hidden" + titleBarOverlay { color:#00000000, symbolColor:#7f858f,
  // height:32 }，原生标题栏按钮回归且配色与原版一致）。
  const markerBlock = /\/\/ \[liuli-theme patch\] 无边框窗口：[\s\S]*?\n\s*frame: false,/;
  const nativeRestore = [
    'titleBarStyle: "hidden",',
    '\t\ttitleBarOverlay: {',
    '\t\t\tcolor: "#00000000",',
    '\t\t\tsymbolColor: "#7f858f",',
    '\t\t\theight: 32',
    '\t\t},',
  ].join('\n');
  if (markerBlock.test(runtime)) {
    runtime = runtime.replace(markerBlock, nativeRestore);
    runtimeChanged = true;
    console.log('[dsh-liuli-ui-enhance] 已还原官方原生标题栏配置');
  } else {
    console.log('[dsh-liuli-ui-enhance] electron-runtime 未包含无边框补丁，跳过还原');
  }
  if (runtime.includes('webviewTag: true')) {
    runtime = runtime.replace(/^\s*webviewTag: true,\r?\n/mg, '');
    runtimeChanged = true;
    console.log('[dsh-liuli-ui-enhance] 已移除 webviewTag 补丁');
  } else {
    console.log('[dsh-liuli-ui-enhance] electron-runtime 未包含 webviewTag 补丁，跳过还原');
  }
} else if (runtime.includes('[liuli-theme patch]')) {
  console.log('[dsh-liuli-ui-enhance] electron-runtime 已包含无边框补丁，跳过该部分');
} else {
  const pattern = /titleBarStyle:\s*"hidden",\s*titleBarOverlay:\s*\{[\s\S]*?\},/;
  if (!pattern.test(runtime)) {
    fail('未在 electron-runtime 中找到 win32 titleBarOverlay 补丁点，已取消修改');
  }
  runtime = runtime.replace(pattern, [
    '// [liuli-theme patch] 无边框窗口：移除原生 titleBarOverlay 按钮，',
    '// 最小化/最大化/关闭改由页面内按钮承担（dsh-liuli-ui-enhance 插件 /liuli-window',
    '// 路由 + WindowControls 组件：会话 header 内 + 开始页标题条右侧兜底）。',
    '// 注意：未安装 dsh-liuli-ui-enhance 时 advanced 模式将没有窗口按钮（Alt+F4/托盘仍可用）。',
    'frame: false,',
  ].join('\n\t\t'));
  runtimeChanged = true;
  console.log(`[dsh-liuli-ui-enhance] 已修补 ${runtimePath} 无边框配置`);
}
// 启用 webviewTag：zcode 参考实现的浏览器用 <webview> DOM 标签承载，
// 由 CSS overflow:hidden 自然裁剪，彻底避免 WebContentsView 溢出容器问题。
// 还原模式下已在上方移除，这里跳过补丁分支。
if (!REVERT && runtime.includes('webviewTag: true')) {
  console.log('[dsh-liuli-ui-enhance] electron-runtime 已启用 webviewTag，跳过该部分');
} else if (!REVERT) {
  const webviewPattern = /webPreferences:\s*\{\s*preload,\s*contextIsolation:\s*true,\s*nodeIntegration:\s*false,\s*sandbox:\s*true,\s*webSecurity:\s*true\s*\}/g;
  if (!webviewPattern.test(runtime)) {
    console.warn('[dsh-liuli-ui-enhance] 未找到 webPreferences 补丁点，跳过 webviewTag（浏览器面板将回退 WebContentsView）');
  } else {
    runtime = runtime.replace(webviewPattern, (block) => block.replace('webSecurity: true', 'webviewTag: true,\n\t\t\twebSecurity: true'));
    runtimeChanged = true;
    console.log('[dsh-liuli-ui-enhance] 已启用 webviewTag');
  }
}
if (runtimeChanged) {
  writeFileSync(runtimePath, runtime, 'utf8');
}

// 3. 重建 app.asar 头（同步 size / SHA256 integrity），并保留头之后的原始字节。
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

const { header, contentStart } = readAsarHeader(asarPath);
let node = header;
for (const part of ['lib', runtimeName]) {
  if (node?.files?.[part] === undefined) fail(`asar 头中缺少 ${part}`);
  node = node.files[part];
}

const runtimeBuffer = readFileSync(runtimePath);
const hash = createHash('sha256').update(runtimeBuffer).digest('hex');
node.size = runtimeBuffer.length;
node.integrity ??= { algorithm: 'SHA256', blockSize: 4194304, blocks: [] };
node.integrity.hash = hash;
node.integrity.blocks = [hash];

const newHeader = buildAsarHeader(header);
const tmpPath = join(resourcesDir, `app.asar.liuli-patch-${process.pid}.tmp`);
try {
  writePatchedAsar(asarPath, tmpPath, newHeader, contentStart);
  copyFileSync(tmpPath, asarPath);
  copyFileSync(tmpPath, patchedCopyPath);
} finally {
  try { unlinkSync(tmpPath); } catch { /* ignore */ }
}
console.log(`[dsh-liuli-ui-enhance] 已重建 ${asarPath}`);
console.log(`[dsh-liuli-ui-enhance] 已同步 ${patchedCopyPath}`);
if (REVERT) {
  console.log('[dsh-liuli-ui-enhance] 还原完成：请重启 DSH Desktop 恢复原生标题栏');
} else {
  console.log('[dsh-liuli-ui-enhance] 请重启 DSH Desktop 生效');
}
