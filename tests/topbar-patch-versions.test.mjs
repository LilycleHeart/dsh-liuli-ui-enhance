import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

/**
 * 顶栏补丁的版本白名单有两份副本，必须始终一致：
 *   - scripts/patch-official-window-controls.mjs（离线写入，客户端已退出）
 *   - src/host-topbar-patch.ts（运行中就地写入，/liuli-topbar-patch 路由）
 *
 * 2026-11 的 rc.5 事故正是只改了脚本、漏了模块：命令行 --check 已放行，但用户在
 * 悬浮球/设置页点「立即打补丁」仍拿到 unsupported。这组用例把「漏改一边」「锚点漂移」
 * 「客户端升级后忘了加白名单」都变成红灯。
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const scriptPath = join(root, 'scripts', 'patch-official-window-controls.mjs')
const modulePath = join(root, 'src', 'host-topbar-patch.ts')
const read = path => readFileSync(path, 'utf8')

function versionsOf(source, pattern, label) {
  const matched = source.match(pattern)
  assert.ok(matched !== null, `未在 ${label} 中找到「已验证版本」列表（正则 ${pattern}）`)
  return new Set([...matched[1].matchAll(/'([^']+)'/g)].map(item => item[1]))
}

const scriptVersions = versionsOf(read(scriptPath), /const verifiedVersions = new Set\(\[([\s\S]*?)\]\)/, 'patch-official-window-controls.mjs')
const moduleVersions = versionsOf(read(modulePath), /const VERIFIED_VERSIONS = new Set\(\[([\s\S]*?)\]\)/, 'host-topbar-patch.ts')

test('两处「已验证版本」列表内容完全一致', () => {
  assert.deepEqual([...moduleVersions].sort(), [...scriptVersions].sort(),
    'src/host-topbar-patch.ts 的 VERIFIED_VERSIONS 与 scripts/patch-official-window-controls.mjs 的 verifiedVersions 必须一致')
})

test('当前官方客户端 0.2.1-rc.5 在两边已验证列表内', () => {
  assert.ok(scriptVersions.has('0.2.1-rc.5'), '脚本已验证列表缺少 0.2.1-rc.5')
  assert.ok(moduleVersions.has('0.2.1-rc.5'), '模块已验证列表缺少 0.2.1-rc.5')
})

test('未在真机验证过的版本不得被标成「已验证」', () => {
  for (const version of ['0.2.1-rc.4', '0.2.1-rc.6']) {
    assert.ok(!scriptVersions.has(version), `脚本不应把未验证的 ${version} 标成已验证`)
    assert.ok(!moduleVersions.has(version), `模块不应把未验证的 ${version} 标成已验证`)
  }
})

test('版本号不再是门槛：两处源码都不得按版本硬拒绝', () => {
  const script = read(scriptPath)
  const mod = read(modulePath)
  // 旧实现：`!supportedVersions.has(version)` → fail（脚本）/ → state:'unsupported'（模块）。
  // 这正是 rc.5 升级时「官方只前进一个 rc 就整条链路报 unsupported」的成因。
  assert.ok(!/!\s*(?:supportedVersions|verifiedVersions)\.has\([^)]*\)\)\s*\{?\s*fail/.test(script),
    '脚本里又出现了「版本不在列表就 fail」的硬拒绝，应改为按锚点判定')
  assert.ok(!/!\s*SUPPORTED\.has\(/.test(mod) && !/!\s*VERIFIED_VERSIONS\.has\([^)]*\)\s*\)\s*\{/.test(mod),
    '模块里又出现了「版本不在列表就 unsupported」的硬拒绝，应改为按锚点判定')
  // 反过来要真的存在「锚点不匹配才拒绝」的出口。
  assert.match(script, /Patch anchor mismatch/, '脚本缺少锚点失配的拒绝出口')
  assert.match(mod, /找不到主窗口创建代码的补丁点/, '模块缺少锚点失配的拒绝出口')
})

test('三个补丁锚点在脚本与模块中逐字一致', () => {
  const script = read(scriptPath)
  const mod = read(modulePath)

  const scriptBefore = script.match(/const before = `([\s\S]*?)`;/)?.[1]
  const moduleBefore = mod.match(/const MAIN_BEFORE = `([\s\S]*?)`/)?.[1]
  assert.ok(scriptBefore !== undefined, '脚本里找不到 const before')
  assert.ok(moduleBefore !== undefined, '模块里找不到 MAIN_BEFORE')
  assert.equal(moduleBefore, scriptBefore, 'MAIN_BEFORE 与脚本的 before 锚点必须逐字相同')

  const ipcAnchor = mod.match(/const MAIN_IPC_ANCHOR = '([^']*)'/)?.[1]
  assert.ok(ipcAnchor !== undefined, '模块里找不到 MAIN_IPC_ANCHOR')
  assert.ok(script.includes(`'${ipcAnchor}'`), 'MAIN_IPC_ANCHOR 未出现在脚本里')

  const overlayAnchor = mod.match(/const MAIN_SETTITLEBAR = '([^']*)'/)?.[1]
  assert.ok(overlayAnchor !== undefined, '模块里找不到 MAIN_SETTITLEBAR')
  assert.ok(script.includes(`'${overlayAnchor}'`), 'MAIN_SETTITLEBAR 未出现在脚本里')
})

/** 本机真实安装：客户端升级后若忘了更新白名单，这里会直接红。 */
const asarPath = resolve(
  process.env.DSH_OFFICIAL_DIR ?? process.env.LOCALAPPDATA ?? '',
  process.env.DSH_OFFICIAL_DIR ? 'resources/app.asar' : 'Programs/DeepSeek Harness/resources/app.asar',
)

test('本机安装的客户端：四处锚点必须仍然唯一命中（版本只作记录）', { skip: !existsSync(asarPath) }, () => {
  const bytes = readFileSync(asarPath)
  assert.equal(bytes.readUInt32LE(0), 4, '未知的 ASAR 格式')
  const jsonLength = bytes.readUInt32LE(12)
  const header = JSON.parse(bytes.subarray(16, 16 + jsonLength).toString('utf8'))
  const contentStart = 8 + bytes.readUInt32LE(4)
  const readEntry = name => {
    const node = name.split('/').reduce((cur, part) => cur.files[part], header)
    if (node.unpacked === true) return readFileSync(join(`${asarPath}.unpacked`, name))
    return bytes.subarray(contentStart + Number(node.offset), contentStart + Number(node.offset) + node.size)
  }

  const version = JSON.parse(readEntry('package.json').toString('utf8')).version

  const main = readEntry('lib/main.js').toString('utf8')
  if (main.includes('[liuli official window controls v1]')) return // 已打补丁：锚点自然已消失

  const count = (text, needle) => text.split(needle).length - 1
  assert.equal(count(main, 'function createWindow(preload, show = false, primary = false)'), 1,
    `${version} 的 createWindow 工厂锚点不唯一或已漂移`)
  assert.equal(count(main, '\tipcMain.on(PLATFORM_IPC.bootstrap, (event) => {'), 1,
    `${version} 的 PLATFORM_IPC.bootstrap 锚点不唯一或已漂移`)
  assert.equal(count(main, 'if (validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({'), 1,
    `${version} 的 setTitleBarOverlay 锚点不唯一或已漂移`)
  assert.equal(count(main, 'titleBarStyle: "hidden"'), 3,
    `${version} 的 titleBarStyle 出现次数变了（预期 3：欢迎窗 darwin/win32 + 主窗 win32，主窗块为锚点）`)
})
