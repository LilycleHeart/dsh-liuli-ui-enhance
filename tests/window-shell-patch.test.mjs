import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const script = fileURLToPath(new URL('../scripts/patch-official-window-controls.mjs', import.meta.url))
const hash = value => createHash('sha256').update(value).digest('hex')
const mainSource = `function createWindow(preload, show = false, primary = false) {
  return new BrowserWindow({
titleBarStyle: "hidden",
\t\t\ttitleBarOverlay: {
\t\t\t\theight: 40,
\t\t\t\tcolor: chromeFallbackFill(),
\t\t\t\tsymbolColor: nativeTheme.shouldUseDarkColors ? "#f9fafb" : "#0f1115"
\t\t\t}
  });
}
function installHandlers() {
\tipcMain.on(PLATFORM_IPC.bootstrap, (event) => {});
  if (validColor(color) && validColor(symbolColor)) mainWindow.setTitleBarOverlay({ color, symbolColor });
}
`

async function fixture(t, version, { unpacked = false, main = mainSource } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'liuli-window-patch-'))
  t.after(async () => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()))
    assert.ok(basename(root).startsWith('liuli-window-patch-'))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })
  const contents = {
    'package.json': JSON.stringify({ name: '@deepseek-ai/dsh-desktop', version }),
    'lib/main.js': main,
    'lib/preload-app.cjs': 'const electron = require("electron");\n',
  }
  const header = { files: {} }, chunks = []
  let offset = 0
  for (const [name, text] of Object.entries(contents)) {
    const pieces = name.split('/'), leaf = pieces.pop()
    let node = header
    for (const piece of pieces) node = (node.files[piece] ??= { files: {} })
    const bytes = Buffer.from(text)
    if (unpacked && name.startsWith('lib/')) {
      node.files[leaf] = { size: bytes.length, unpacked: true }
      const target = join(root, 'resources/app.asar.unpacked', name)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, bytes)
    } else {
      node.files[leaf] = { size: bytes.length, offset: String(offset) }
      chunks.push(bytes); offset += bytes.length
    }
  }
  const json = Buffer.from(JSON.stringify(header)), pad = (4 - json.length % 4) % 4
  const prefix = Buffer.alloc(16)
  prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(json.length + 8 + pad, 4)
  prefix.writeUInt32LE(json.length + 4 + pad, 8); prefix.writeUInt32LE(json.length, 12)
  const archive = Buffer.concat([prefix, json, Buffer.alloc(pad), ...chunks])
  const exe = Buffer.from(`synthetic-executable-header:${hash(json)}:synthetic-footer`)
  await mkdir(join(root, 'resources'), { recursive: true })
  await writeFile(join(root, 'resources/app.asar'), archive)
  await writeFile(join(root, 'DeepSeek Harness.exe'), exe)
  const run = (...args) => spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, DSH_OFFICIAL_DIR: root }, encoding: 'utf8', windowsHide: true,
  })
  return { root, archive, exe, run, contents }
}

for (const version of ['0.2.0-rc.2', '0.2.1-rc.2', '0.2.1-rc.3']) {
  test(`official ${version}: check, apply, repeat and revert preserve the original shell`, { skip: process.platform !== 'win32' }, async t => {
    const f = await fixture(t, version, { unpacked: version !== '0.2.0-rc.2' })
    const stage = join(f.root, 'stage')
    const check = f.run('--check', `--stage-dir=${stage}`)
    assert.equal(check.status, 0, check.stderr)
    assert.equal(JSON.parse(check.stdout).version, version)
    assert.deepEqual(await readFile(join(f.root, 'resources/app.asar')), f.archive)
    assert.match(await readFile(join(stage, 'main.mjs'), 'utf8'), /frame: false/)
    assert.match(await readFile(join(stage, 'main.mjs'), 'utf8'), /const owner = assertMainApplication\(event\)/)
    assert.match(await readFile(join(stage, 'preload-app.cjs'), 'utf8'), /process\.isMainFrame/)
    const apply = f.run('--apply')
    assert.equal(apply.status, 0, apply.stderr)
    const patched = await readFile(join(f.root, 'resources/app.asar'))
    assert.notDeepEqual(patched, f.archive)
    const newHeader = patched.subarray(16, 16 + patched.readUInt32LE(12))
    assert.ok((await readFile(join(f.root, 'DeepSeek Harness.exe'))).includes(Buffer.from(hash(newHeader))))
    assert.equal(f.run('--apply').status, 0)
    assert.deepEqual(await readFile(join(f.root, 'resources/app.asar')), patched)
    const revert = f.run('--revert')
    assert.equal(revert.status, 0, revert.stderr)
    assert.deepEqual(await readFile(join(f.root, 'resources/app.asar')), f.archive)
    assert.deepEqual(await readFile(join(f.root, 'DeepSeek Harness.exe')), f.exe)
    if (version !== '0.2.0-rc.2') {
      for (const name of ['lib/main.js', 'lib/preload-app.cjs']) {
        assert.equal(await readFile(join(f.root, 'resources/app.asar.unpacked', name), 'utf8'), f.contents[name])
      }
    }
  })
}

test('unsupported versions and drifted anchors fail without changing the shell', async t => {
  for (const [version, main] of [['0.2.1-rc.4', mainSource], ['0.2.1-rc.2', mainSource.replace('height: 40', 'height: 41')]]) {
    const f = await fixture(t, version, { main })
    const result = f.run('--check')
    assert.notEqual(result.status, 0)
    assert.deepEqual(await readFile(join(f.root, 'resources/app.asar')), f.archive)
    assert.deepEqual(await readFile(join(f.root, 'DeepSeek Harness.exe')), f.exe)
  }
})
