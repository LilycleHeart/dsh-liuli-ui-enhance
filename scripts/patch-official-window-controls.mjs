#!/usr/bin/env node
/** Version-scoped, reversible window controls for official Windows Desktop.
 * No sandbox, web security, or IPC sender validation is relaxed.
 * Run --check first; --apply/--revert require the application to be closed.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const version = '0.2.0-rc.2';
const marker = '[liuli official window controls v1]';
const dir = resolve(process.env.DSH_OFFICIAL_DIR || join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'));
const asarPath = join(dir, 'resources', 'app.asar');
const exePath = join(dir, 'DeepSeek Harness.exe');
const backup = join(dir, 'liuli-window-controls-backup-' + version);
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
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) fail('Patch anchor mismatch: ' + before.slice(0, 90));
  return text.replace(before, after);
}
function assertClosed() {
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', '@(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue).Id; exit 0'], { encoding: 'utf8', windowsHide: true });
  if (output.trim()) fail('Exit DeepSeek Harness before applying or reverting the shell patch');
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
if (identity.name !== '@deepseek-ai/dsh-desktop' || identity.version !== version) fail('This patch supports only official Desktop ' + version);
let main = readEntry(archive, info, 'lib/main.js').toString();
if (process.argv.includes('--revert')) {
  assertClosed();
  const record = JSON.parse(readFileSync(join(backup, 'record.json')));
  if (hash(archive) !== record.patchedAsar || hash(readFileSync(exePath)) !== record.patchedExe) fail('Application changed after patching; refuse to overwrite an update');
  copyFileSync(join(backup, 'app.asar'), asarPath);
  copyFileSync(join(backup, 'DeepSeek Harness.exe'), exePath);
  console.log('Original official shell restored');
  process.exit(0);
}
if (main.includes(marker)) { console.log('Official window controls patch already applied'); process.exit(0); }
const before = `titleBarStyle: "hidden",\n\t\t\ttitleBarOverlay: {\n\t\t\t\theight: 40,\n\t\t\t\tcolor: chromeFallbackFill(),\n\t\t\t\tsymbolColor: nativeTheme.shouldUseDarkColors ? "#f9fafb" : "#0f1115"\n\t\t\t}`;
const createAt = main.indexOf('function createWindow(preload, show = false, primary = false)');
if (createAt < 0) fail('Primary window factory missing');
main = main.slice(0, createAt) + replaceOnce(main.slice(createAt), before, 'frame: false');
main = replaceOnce(main, '\tipcMain.on(PLATFORM_IPC.bootstrap, (event) => {', mainBridge + '\tipcMain.on(PLATFORM_IPC.bootstrap, (event) => {');
main = replaceOnce(main, 'if (validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({', 'if (false && validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({');
const preload = readEntry(archive, info, 'lib/preload-app.cjs').toString() + preloadBridge;
const exe = readFileSync(exePath);
const oldHash = hash(info.json);
const at = exe.indexOf(oldHash);
if (at < 0 || exe.indexOf(oldHash, at + 1) >= 0) fail('Expected exactly one ASAR integrity hash in executable');
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
console.log(JSON.stringify({app:identity.name,version,mainAndPreloadPrepared:true,integrityHashOffset:at,backup,mode:process.argv.includes('--apply')?'apply':'check'},null,2));
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
  throw error;
}
