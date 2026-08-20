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
//
// 安全：
//   - 首次运行会把 resources/app.asar 备份为 app.asar.bak-frameless。
//   - 已包含 [liuli-theme patch] 时跳过文件修改，只校验/重建 asar 头。
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readSync, openSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const installDir = process.env.DSH_DESKTOP_DIR
  || (process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Programs', 'DSH Desktop')
    : join(homedir(), 'Applications', 'DSH Desktop.app', 'Contents', 'Resources'));

const resourcesDir = join(installDir, 'resources');
const asarPath = join(resourcesDir, 'app.asar');
const backupPath = join(resourcesDir, 'app.asar.bak-frameless');
const patchedCopyPath = join(resourcesDir, 'app.asar.patched');
const runtimePath = join(resourcesDir, 'app.asar.unpacked', 'lib', 'electron-runtime-he0yaDKX.js');

function fail(message) {
  console.error(`[liuli-theme] ${message}`);
  process.exit(1);
}

for (const file of [asarPath, runtimePath]) {
  if (!existsSync(file)) fail(`找不到 ${file}`);
}

// 1. 备份原始 app.asar
if (!existsSync(backupPath)) {
  copyFileSync(asarPath, backupPath);
  console.log(`[liuli-theme] 已备份原始 app.asar -> ${backupPath}`);
} else {
  console.log(`[liuli-theme] 备份已存在，跳过：${backupPath}`);
}

// 2. 修改 unpacked electron runtime
let runtime = readFileSync(runtimePath, 'utf8');
if (runtime.includes('[liuli-theme patch]')) {
  console.log('[liuli-theme] electron-runtime 已包含琉璃补丁，跳过文件修改');
} else {
  const pattern = /titleBarStyle:\s*"hidden",\s*titleBarOverlay:\s*\{[\s\S]*?\},/;
  if (!pattern.test(runtime)) {
    fail('未在 electron-runtime 中找到 win32 titleBarOverlay 补丁点，已取消修改');
  }
  runtime = runtime.replace(pattern, [
    '// [liuli-theme patch] 无边框窗口：移除原生 titleBarOverlay 按钮，',
    '// 最小化/最大化/关闭改由页面内按钮承担（liuli-theme 插件 /liuli-window',
    '// 路由 + WindowControls 组件：会话 header 内 + 开始页标题条右侧兜底）。',
    '// 注意：未安装 liuli-theme 时 advanced 模式将没有窗口按钮（Alt+F4/托盘仍可用）。',
    'frame: false,',
  ].join('\n\t\t'));
  writeFileSync(runtimePath, runtime, 'utf8');
  console.log(`[liuli-theme] 已修补 ${runtimePath}`);
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
for (const part of ['lib', 'electron-runtime-he0yaDKX.js']) {
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
console.log(`[liuli-theme] 已重建 ${asarPath}`);
console.log(`[liuli-theme] 已同步 ${patchedCopyPath}`);
console.log('[liuli-theme] 请重启 DSH Desktop 生效');
