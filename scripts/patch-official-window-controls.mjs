#!/usr/bin/env node
/** Version-scoped, reversible window controls for official Windows Desktop.
 * No sandbox, web security, or IPC sender validation is relaxed.
 * Run --check first; --apply/--revert require the application to be closed.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

/** **已验证过**的官方 Desktop 版本 —— 只作记录，不再当作门槛。
 *
 *  补丁真正的安全判据是锚点：`createWindow` 工厂、win32 `titleBarOverlay` 分支、
 *  `PLATFORM_IPC.bootstrap` 监听、`setTitleBarOverlay` 调用四处必须逐字命中且唯一，
 *  再加上 exe 内嵌 asar 哈希唯一命中与 fuse 判定。官方小版本更新通常不动这些代码
 *  （0.2.1-rc.2 → rc.3 → rc.5 三处锚点一字未变，asar 完整性哈希算法也没变），所以
 *  列在这里只是「我们真机跑过」的记录；**未列出的版本同样放行**，锚点不匹配一样
 *  拒绝写入。这样官方每次小版本更新不需要人工回来补白名单。
 *  （2026-11 之前的做法是白名单硬拒绝，rc.5 升级时脚本直接报 unsupported —— 那次
 *  事故根因是维护滞后，不是补丁不兼容。） */
const verifiedVersions = new Set(['0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.3', '0.2.1-rc.5']);
const marker = '[liuli official window controls v1]';
const dir = resolve(process.env.DSH_OFFICIAL_DIR || join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'));
const asarPath = join(dir, 'resources', 'app.asar');
const exePath = join(dir, 'DeepSeek Harness.exe');
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
const unpack = bytes => {
  if (bytes.readUInt32LE(0) !== 4) fail('Unknown ASAR format');
  const length = bytes.readUInt32LE(12);
  return { header: JSON.parse(bytes.subarray(16, 16 + length)), json: bytes.subarray(16, 16 + length), start: 8 + bytes.readUInt32LE(4) };
};
const entry = (header, name) => name.split('/').reduce((node, part) => node.files[part], header);
const readEntry = (archive, info, name) => {
  const node = entry(info.header, name);
  return node.unpacked ? readFileSync(join(asarPath + '.unpacked', name)) : archive.subarray(info.start + Number(node.offset), info.start + Number(node.offset) + node.size);
};
/** 锚点失配的统一出口：引导去更新锚点，而不是让人回来加版本号。 */
const anchorHint = '\n该版本的窗口创建代码可能已改写：请更新锚点常量（见 docs/dsh-021-rc5-upgrade.md），而不是加版本号。';
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) fail('Patch anchor mismatch: ' + before.slice(0, 90) + anchorHint);
  return text.replace(before, after);
}
function assertClosed() {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'ConvertTo-Json -InputObject @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue | Select-Object Id, Path) -Compress; exit 0'], { encoding: 'utf8', windowsHide: true });
  const parsed = JSON.parse(output.trim() || '[]');
  // ConvertTo-Json 在「恰好一个进程」时会把数组解包成对象，两种形状都要吃下。
  const processes = (Array.isArray(parsed) ? parsed : parsed == null ? [] : [parsed])
    .filter(item => item !== null && typeof item === 'object');
  const target = exePath.toLowerCase();
  // 有一条能读到路径、且路径就是本安装目录的 exe → 客户端确实在运行，拒绝写入。
  const readable = processes.map(item => (typeof item.Path === 'string' && item.Path !== '' ? resolve(item.Path).toLowerCase() : undefined));
  if (readable.some(path => path === target)) {
    fail('Exit DeepSeek Harness before applying or reverting the shell patch');
  }
  // 有同名进程却一条路径都读不出：无法判定，保守拒绝（并行/高负载下个别条目读不到 Path
  // 不再误判，但只要全部不可读仍按「可能在运行」处理）。
  if (processes.length > 0 && readable.every(path => path === undefined)) {
    fail('Exit DeepSeek Harness before applying or reverting the shell patch');
  }
}
const mainBridge = `\n// ${marker}
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
});\n`;
const preloadBridge = `\n// ${marker}
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
`;

const archive = readFileSync(asarPath);
const info = unpack(archive);
const identity = JSON.parse(readEntry(archive, info, 'package.json'));
if (identity.name !== '@deepseek-ai/dsh-desktop') {
  fail('This patch targets the official @deepseek-ai/dsh-desktop build, found: ' + identity.name);
}
const version = identity.version;
/** 版本只标记「我们真机验证过」，不作为门槛：下面的锚点检查才是硬判据。 */
const verified = verifiedVersions.has(version);
const backup = join(dir, 'liuli-window-controls-backup-' + version);
function restoreUnpackedFiles() {
  for (const name of ['main.js', 'preload-app.cjs']) {
    const saved = join(backup, name);
    if (existsSync(saved)) copyFileSync(saved, join(asarPath + '.unpacked', 'lib', name));
  }
}
let main = readEntry(archive, info, 'lib/main.js').toString();
if (process.argv.includes('--revert')) {
  assertClosed();
  const record = JSON.parse(readFileSync(join(backup, 'record.json')));
  if (hash(archive) !== record.patchedAsar || hash(readFileSync(exePath)) !== record.patchedExe) fail('Application changed after patching; refuse to overwrite an update');
  copyFileSync(join(backup, 'app.asar'), asarPath);
  copyFileSync(join(backup, 'DeepSeek Harness.exe'), exePath);
  restoreUnpackedFiles();
  console.log('Original official shell restored');
  process.exit(0);
}
if (main.includes(marker)) { console.log('Official window controls patch already applied'); process.exit(0); }
const before = `titleBarStyle: "hidden",\n\t\t\ttitleBarOverlay: {\n\t\t\t\theight: 40,\n\t\t\t\tcolor: chromeFallbackFill(),\n\t\t\t\tsymbolColor: nativeTheme.shouldUseDarkColors ? "#f9fafb" : "#0f1115"\n\t\t\t}`;
const createAt = main.indexOf('function createWindow(preload, show = false, primary = false)');
if (createAt < 0) fail('Primary window factory missing' + anchorHint);
main = main.slice(0, createAt) + replaceOnce(main.slice(createAt), before, 'frame: false');
main = replaceOnce(main, '\tipcMain.on(PLATFORM_IPC.bootstrap, (event) => {', mainBridge + '\tipcMain.on(PLATFORM_IPC.bootstrap, (event) => {');
main = replaceOnce(main, 'if (validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({', 'if (false && validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({');
const preload = readEntry(archive, info, 'lib/preload-app.cjs').toString() + preloadBridge;
const exe = readFileSync(exePath);
const oldHash = hash(info.json);
const at = exe.indexOf(oldHash);
if (at < 0 || exe.indexOf(oldHash, at + 1) >= 0) fail('Expected exactly one ASAR integrity hash in executable');
/** 报告 Electron 的 embeddedAsarIntegrityValidation fuse 状态（只读，不改变写入行为）。
 *  该 fuse 关闭时，改 asar 头并不会被 Electron 校验 —— 本机官方构建即为关闭状态，
 *  「必须同步 exe 内嵌哈希」在此前提下并非硬约束。写入路径仍保持同步 exe 的保守做法，
 *  因为 fuse 可能随版本变化，判错的代价是客户端起不来。 */
const fuseState = (() => {
  const wire = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX', 'ascii');
  const at0 = exe.indexOf(wire);
  if (at0 < 0) return 'unknown';
  const version = exe[at0 + wire.length];
  const count = exe[at0 + wire.length + 1];
  if (version !== 1 || !(count >= 5 && count <= 32)) return 'unknown';
  const bits = exe.subarray(at0 + wire.length + 2, at0 + wire.length + 2 + count).toString('ascii');
  if (!/^[01]+$/.test(bits)) return 'unknown';
  // fuse v1 顺序第 5 位 = EnableEmbeddedAsarIntegrityValidation
  return bits[4] === '0' ? 'off' : bits[4] === '1' ? 'on' : 'unknown';
})();
const targets = [['lib/main.js', main], ['lib/preload-app.cjs', preload]];
for (const [name, text] of targets) {
  const bytes = Buffer.from(text);
  const node = entry(info.header, name);
  node.unpacked = true; delete node.offset; node.size = bytes.length;
  node.integrity = { algorithm: 'SHA256', hash: hash(bytes), blockSize: 4194304, blocks: [hash(bytes)] };
}
const json = Buffer.from(JSON.stringify(info.header));
const pad = (4 - json.length % 4) % 4;
const prefix = Buffer.alloc(16);
prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(json.length + 8 + pad, 4); prefix.writeUInt32LE(json.length + 4 + pad, 8); prefix.writeUInt32LE(json.length, 12);
const updatedArchive = Buffer.concat([prefix, json, Buffer.alloc(pad), archive.subarray(info.start)]);
const updatedExe = Buffer.from(exe); updatedExe.write(hash(json), at, 64, 'ascii');
const stageArg = process.argv.find(arg => arg.startsWith('--stage-dir='));
if (stageArg) {
  const stage = resolve(stageArg.slice('--stage-dir='.length));
  mkdirSync(stage, {recursive:true});
  writeFileSync(join(stage,'main.mjs'), main);
  writeFileSync(join(stage,'preload-app.cjs'), preload);
  execFileSync(process.execPath, ['--check', join(stage,'main.mjs')]);
  execFileSync(process.execPath, ['--check', join(stage,'preload-app.cjs')]);
}
console.log(JSON.stringify({app:identity.name,version,verified,mainAndPreloadPrepared:true,integrityHashOffset:at,asarIntegrityFuse:fuseState,backup,mode:process.argv.includes('--apply')?'apply':'check'},null,2));
if (fuseState === 'off') {
  // 走 stderr：--check 的 stdout 必须能被调用方（如 liuli-topbar-guard.mjs）整体 JSON.parse，
  // 多一行中文提示会让它解析失败并丢掉 version。
  console.error('[liuli] 提示：该客户端的 Electron embeddedAsarIntegrityValidation fuse 处于关闭状态，asar 头不会被启动校验（本脚本仍按保守做法同步 exe 内嵌哈希）。');
}
if (!verified) {
  console.error(`[liuli] 提示：客户端 ${version} 不在真机验证过的版本列表里，但四处补丁锚点已逐字命中 —— 按锚点放行（verified=false）。`);
}
if (!process.argv.includes('--apply')) process.exit(0);
assertClosed();
if (existsSync(join(backup, 'record.json'))) fail('Backup exists; inspect or revert it before a new patch');
mkdirSync(backup, {recursive:true});
copyFileSync(asarPath, join(backup, 'app.asar')); copyFileSync(exePath, join(backup, 'DeepSeek Harness.exe'));
try {
  for (const [name, text] of targets) {
    const path = join(asarPath + '.unpacked', name);
    mkdirSync(join(asarPath + '.unpacked', 'lib'), {recursive:true});
    if (existsSync(path)) copyFileSync(path, join(backup, name.split('/').at(-1)));
    writeFileSync(path, text);
  }
  writeFileSync(asarPath, updatedArchive); writeFileSync(exePath, updatedExe);
  const record = {originalAsar:hash(archive),originalExe:hash(exe),patchedAsar:hash(updatedArchive),patchedExe:hash(updatedExe)};
  writeFileSync(join(backup,'record.json'),JSON.stringify(record,null,2));
  if (hash(readFileSync(asarPath)) !== record.patchedAsar || hash(readFileSync(exePath)) !== record.patchedExe) fail('Post-write verification failed');
  console.log('Window patch applied with backups and updated ASAR integrity hash');
} catch (error) {
  copyFileSync(join(backup,'app.asar'),asarPath); copyFileSync(join(backup,'DeepSeek Harness.exe'),exePath);
  restoreUnpackedFiles();
  throw error;
}
