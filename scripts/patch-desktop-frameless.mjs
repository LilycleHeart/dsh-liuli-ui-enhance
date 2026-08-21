#!/usr/bin/env node
// 琉璃主题 · DSH Desktop win32 无边框宿主补丁
//
// 作用：全新 DSH Desktop 没有应用 frameless 补丁时，原生标题栏/窗口按钮
// 无法隐藏。本脚本修改安装目录里的：
//   resources/app.asar.unpacked/lib/electron-runtime-he0yaDKX.js
// 和
//   resources/app.asar
// 把 win32 advanced 分支从 titleBarStyle: "hidden" + titleBarOverlay
// 改为 frame: false，并同步 asar 头里的 size/integrity。
//
// 用法：
//   node scripts/patch-desktop-frameless.mjs
//   DSH_DESKTOP_DIR="C:\Program Files\DSH Desktop" node scripts/patch-desktop-frameless.mjs
// 安装目录查找顺序：DSH_DESKTOP_DIR 环境变量 → 正在运行的 DSH Desktop 进程路径 → 默认安装路径。
//
// 安全：
//   - 首次运行会把 resources/app.asar 备份为 app.asar.bak-frameless。
//   - 已包含 [liuli-theme patch] 时跳过文件修改，只校验/重建 asar 头。
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readSync, readdirSync, openSync, statSync, writeFileSync } from 'node:fs';
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

// 1. 备份原始 app.asar
if (!existsSync(backupPath)) {
  copyFileSync(asarPath, backupPath);
  console.log(`[dsh-liuli-ui-enhance] 已备份原始 app.asar -> ${backupPath}`);
} else {
  console.log(`[dsh-liuli-ui-enhance] 备份已存在，跳过：${backupPath}`);
}

// 2. 修改 unpacked electron runtime
let runtime = readFileSync(runtimePath, 'utf8');
if (runtime.includes('[liuli-theme patch]')) {
  console.log('[dsh-liuli-ui-enhance] electron-runtime 已包含琉璃补丁，跳过文件修改');
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
  writeFileSync(runtimePath, runtime, 'utf8');
  console.log(`[dsh-liuli-ui-enhance] 已修补 ${runtimePath}`);
}

// 3. 重建 app.asar 头（同步 size / SHA256 integrity）
function readAsarHeader(path) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const prefix = Buffer.alloc(16);
    readSync(fd, prefix, 0, 16, 0);
    const jsonLength = prefix.readUInt32LE(12);
    const jsonBuffer = Buffer.alloc(jsonLength);
    readSync(fd, jsonBuffer, 0, jsonLength, 16);
    return JSON.parse(jsonBuffer.toString('utf8'));
  } finally {
    // fd closed implicitly by process; no closeSync import needed
  }
}

const header = readAsarHeader(asarPath);
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

const json = JSON.stringify(header);
const jsonBuffer = Buffer.from(json, 'utf8');
const prefix = Buffer.alloc(16);
prefix.writeUInt32LE(4, 0);
prefix.writeUInt32LE(jsonBuffer.length + 9, 4);
prefix.writeUInt32LE(jsonBuffer.length + 5, 8);
prefix.writeUInt32LE(jsonBuffer.length, 12);
const newAsar = Buffer.concat([prefix, jsonBuffer, Buffer.from([0])]);

writeFileSync(asarPath, newAsar);
writeFileSync(patchedCopyPath, newAsar);
console.log(`[dsh-liuli-ui-enhance] 已重建 ${asarPath}`);
console.log(`[dsh-liuli-ui-enhance] 已同步 ${patchedCopyPath}`);
console.log('[dsh-liuli-ui-enhance] 请重启 DSH Desktop 生效');
