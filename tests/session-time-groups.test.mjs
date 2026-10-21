// 侧栏日期分段的真实浏览器回归：无浏览器自动化依赖，直接跑 headless Chrome + CDP。
// Run: node --test "tests/session-time-groups.test.mjs" (set CHROME_PATH outside Windows).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript'

const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const enabled = existsSync(chromePath)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

let chrome, profile, server, socket, sequence = 0
const pending = new Map()
const call = (method, params = {}) => new Promise((resolveCall, reject) => {
  const id = ++sequence
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 15000)
  pending.set(id, { resolve: resolveCall, reject, timer })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (fn, arg) => {
  const expression = arg === undefined ? `(${fn})()` : `(${fn})(${JSON.stringify(arg)})`
  const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

if (enabled) {
  server = createServer(async (request, response) => {
    if (request.url === '/session-time-groups.ts') {
      const source = await readFile(new URL('../src/client/session-time-groups.ts', import.meta.url), 'utf8')
      response.setHeader('Content-Type', 'text/javascript')
      response.end(transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText)
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><body></body>')
  })
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  profile = await mkdtemp(join(tmpdir(), 'liuli-day-groups-test-'))
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
  let port
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break } catch { await delay(100) }
  }
  assert.ok(port, 'Chrome exposes its test debugging port')
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(message.error.message))
    else entry.resolve(message.result)
  })
  await call('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` })
  for (let i = 0; i < 100; i++) {
    if (await evaluate(() => document.readyState === 'complete')) break
    await delay(50)
  }
  await evaluate(async () => {
    window.dayGroups = await import('/session-time-groups.ts')
    window.nextFrame = () => new Promise(resolveFrame => requestAnimationFrame(resolveFrame))
    window.setup = ({ rows, groupRow = false }) => {
      window.__dispose?.()
      window.__dispose = undefined
      document.body.replaceChildren()
      const list = document.createElement('div')
      list.id = 'list'
      document.body.append(list)
      if (groupRow) {
        const project = document.createElement('div')
        project.className = 'x1_projectRow'
        project.textContent = 'workspace'
        list.append(project)
      }
      for (const row of rows) {
        const element = document.createElement('div')
        element.setAttribute('role', 'treeitem')
        element.setAttribute('aria-selected', 'false')
        element.setAttribute('data-row-key', `session:${row.id}`)
        element.textContent = row.id
        list.append(element)
      }
    }
    window.start = ({ rows, pinned, groupRow = false }) => {
      window.setup({ rows, groupRow })
      const sessions = {
        ids: rows.map(row => row.id),
        byId: Object.fromEntries(rows.map(row => [row.id, { id: row.id, title: row.id, displayTitle: row.id, updatedAt: row.updatedAt, running: false }])),
      }
      const ctx = {
        sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} } },
        workspaces: { list: { getSnapshot: () => ({ pinnedSessionIds: pinned }), subscribe: () => () => {} } },
      }
      window.__dispose = window.dayGroups.startSessionTimeGroups(ctx)
    }
    window.readGroups = () => Array.from(document.querySelectorAll('[data-liuli-day-group]')).map(element => ({
      label: element.textContent,
      next: element.nextElementSibling?.getAttribute('data-row-key') ?? null,
    }))
  })
}

after(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    try { await call('Browser.close') } catch { /* Already exited. */ }
    socket.close()
  }
  for (const entry of pending.values()) clearTimeout(entry.timer)
  if (chrome && chrome.exitCode === null) {
    await Promise.race([new Promise(resolveExit => chrome.once('exit', resolveExit)), delay(3000)])
    if (chrome.exitCode === null) chrome.kill()
  }
  if (server) await new Promise(resolveClose => server.close(resolveClose))
  if (profile) {
    assert.equal(dirname(resolve(profile)), resolve(tmpdir()))
    assert.ok(basename(profile).startsWith('liuli-day-groups-test-'))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

const at = (daysAgo, hour = 12, minute = 0) => {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}
const settle = () => evaluate(async () => { await nextFrame(); await nextFrame(); await nextFrame(); return true })

const browserTest = (name, fn) => test(name, { skip: !enabled && 'Set CHROME_PATH to run the browser regression checks.' }, fn)

browserTest('a newest-first flat list is cut into 今天 / 昨天 / 前天 / dated sections', async () => {
  await evaluate(({ rows }) => start({ rows, pinned: [] }), { rows: [
    { id: 'today-a', updatedAt: at(0, 10) },
    { id: 'today-b', updatedAt: at(0, 9) },
    { id: 'yesterday', updatedAt: at(1, 20) },
    { id: 'before-yesterday', updatedAt: at(2, 12) },
    { id: 'last-week', updatedAt: at(8, 12) },
  ] })
  await settle()
  const groups = await evaluate(() => readGroups())
  assert.deepEqual(groups.map(group => group.label), ['今天', '昨天', '前天', `${new Date(at(8)).getMonth() + 1} 月 ${new Date(at(8)).getDate()} 日`])
  assert.deepEqual(groups.map(group => group.next), [
    'session:today-a', 'session:yesterday', 'session:before-yesterday', 'session:last-week',
  ])
})

browserTest('pinned rows sit above the day sections without breaking the time check', async () => {
  await evaluate(({ rows }) => start({ rows, pinned: ['pinned'] }), { rows: [
    { id: 'pinned', updatedAt: at(5, 10) },
    { id: 'today', updatedAt: at(0, 9) },
    { id: 'yesterday', updatedAt: at(1, 9) },
  ] })
  await settle()
  const groups = await evaluate(() => readGroups())
  assert.deepEqual(groups.map(group => group.label), ['今天', '昨天'])
  assert.deepEqual(groups.map(group => group.next), ['session:today', 'session:yesterday'])
})

browserTest('manually ordered lists stay untouched', async () => {
  await evaluate(({ rows }) => start({ rows, pinned: [] }), { rows: [
    { id: 'old', updatedAt: at(9, 9) },
    { id: 'new', updatedAt: at(0, 9) },
  ] })
  await settle()
  assert.deepEqual(await evaluate(() => readGroups()), [])
})

browserTest('rows wrapped in their own containers still get exactly one section per day', async () => {
  await evaluate(async ({ groups }) => {
    window.__dispose?.()
    document.body.replaceChildren()
    const sessions = { ids: [], byId: {} }
    for (const group of groups) {
      const list = document.createElement('div')
      for (const row of group) {
        const element = document.createElement('div')
        element.setAttribute('role', 'treeitem')
        element.setAttribute('aria-selected', 'false')
        element.setAttribute('data-row-key', `session:${row.id}`)
        list.append(element)
        sessions.ids.push(row.id)
        sessions.byId[row.id] = { id: row.id, updatedAt: row.updatedAt, running: false }
      }
      document.body.append(list)
    }
    const ctx = {
      sessions: { list: { getSnapshot: () => sessions, subscribe: () => () => {} } },
      workspaces: { list: { getSnapshot: () => ({ pinnedSessionIds: [] }), subscribe: () => () => {} } },
    }
    window.__dispose = window.dayGroups.startSessionTimeGroups(ctx)
    await nextFrame(); await nextFrame(); await nextFrame()
    return true
  }, { groups: [
    [{ id: 'a', updatedAt: at(0, 9) }, { id: 'b', updatedAt: at(1, 9) }],
    [{ id: 'c', updatedAt: at(1, 8) }],
  ] })
  const sections = await evaluate(() => readGroups())
  assert.deepEqual(sections.map(section => section.label), ['今天', '昨天'])
  assert.deepEqual(sections.map(section => section.next), ['session:a', 'session:b'])
})

browserTest('workspace groupings are never cut by day', async () => {
  await evaluate(({ rows }) => start({ rows, pinned: [], groupRow: true }), { rows: [
    { id: 'first', updatedAt: at(0, 9) },
    { id: 'second', updatedAt: at(1, 9) },
  ] })
  await settle()
  assert.deepEqual(await evaluate(() => readGroups()), [])
})

browserTest('sections are idempotent and disappear when the list stops being time ordered', async () => {
  await evaluate(({ rows }) => start({ rows, pinned: [] }), { rows: [
    { id: 'a', updatedAt: at(0, 9) },
    { id: 'b', updatedAt: at(1, 9) },
  ] })
  await settle()
  const first = await evaluate(() => readGroups())
  await settle()
  const second = await evaluate(() => readGroups())
  assert.equal(first.length, 2)
  assert.deepEqual(second, first)
  // Same rows reordered newest-last (as a manual sort would look): the time-order
  // guard must drop the sections it added earlier.
  await evaluate(async () => {
    const list = document.getElementById('list')
    const rows = Array.from(list.querySelectorAll('[role="treeitem"]'))
    if (rows.length > 1) list.prepend(rows[rows.length - 1])
    await nextFrame(); await nextFrame()
    return true
  })
  await settle()
  assert.deepEqual(await evaluate(() => readGroups()), [])
})
