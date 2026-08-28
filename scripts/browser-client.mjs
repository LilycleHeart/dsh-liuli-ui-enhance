#!/usr/bin/env node
/**
 * dsh-liuli-ui-enhance 浏览器自动化 CLI（browser-use-plugin 的 browser-client.mjs 实现）。
 *
 * browser-use 插件通过 node_repl js 工具 + browser-client.mjs 驱动
 * 桌面 IAB（内嵌浏览器）；DSH 里 dsh-liuli-ui-enhance 的 Host 半把同款能力暴露在
 * /liuli-browser HTTP API 上，本脚本即其命令行客户端，供 agent（pwsh 工具）
 * 或人工驱动侧边栏嵌入式浏览器：
 *
 *   node browser-client.mjs caps                       # 能力探测
 *   node browser-client.mjs open <url> [--tab <id>] [--show]  # 打开标签（缺省 agent:<n>）
 *   node browser-client.mjs list                       # 标签清单
 *   node browser-client.mjs state <tab>                # 状态 JSON
 *   node browser-client.mjs goto <tab> <url>           # 导航
 *   node browser-client.mjs back|forward|reload <tab>
 *   node browser-client.mjs url|title <tab>
 *   node browser-client.mjs wait <tab> <selector> [timeoutMs]
 *   node browser-client.mjs click <tab> <selector>
 *   node browser-client.mjs fill <tab> <selector> <text>
 *   node browser-client.mjs text <tab> <selector>
 *   node browser-client.mjs snap <tab>                 # 精简 DOM 快照（selector 树）
 *   node browser-client.mjs eval <tab> <js>            # executeJavaScript
 *   node browser-client.mjs shot <tab> [file.png]      # capturePage 截图
 *   node browser-client.mjs close <tab>
 *   node browser-client.mjs aria <tab> [ai|yaml]       # aria 快照(YAML + [ref=eN])
 *   node browser-client.mjs info <tab> <ref|selector>  # 元素信息(tag/rect/selector…)
 *   node browser-client.mjs op <tab> <method> [json]   # CDP 操作面
 *                                      # click/type/fill/press/hover/scroll/
 *                                      # select/check/uncheck/evaluate/playwright/
 *                                      # navigate/newTab/closeTab/list/screenshot/…
 *
 * 外部进程直连 Host 路由会被服务端 fence 403:设 LIULI_BROWSER_VIA=cdp 走
 * scripts/browser-bridge.mjs 中转(主进程 inspector 9229 → 页面内同源 fetch;
 * 需 DSH Desktop 以调试模式启动,见 tools/dsh-debug-launch.cmd)。
 * 无几何上报的 agent 标签保持隐藏（等效 DSH CLI-managed headless CDP：
 * 导航/执行/截图可用，仅不可见）；GUI 侧边栏打开的标签 id 形如 browser:<uid>，
 * 可直接用本 CLI 驱动（IAB 模式）。
 * `open --show`：用 browser:show-<uid> 作为标签 id，GUI 侧边栏的轮询桥接（只认
 * 这个前缀）会自动把该标签展示到右侧面板（agent 驱动浏览器 → 用户实时可见）；
 * 不带 --show 时保持隐藏，适合无头验证（snap/click/shot）。
 */
import { writeFileSync } from 'node:fs'
import { cdpFetchJson } from './browser-bridge.mjs'

const BASE = process.env.LIULI_BROWSER_BASE ?? 'http://127.0.0.1:7336'
/** LIULI_BROWSER_VIA=cdp:全部请求经主进程 inspector 桥中转(过服务端 fence)。 */
const VIA = (process.env.LIULI_BROWSER_VIA ?? '').toLowerCase()
const args = process.argv.slice(2)
const command = args[0] ?? 'help'

function fail(message) {
  process.stderr.write('browser-client: ' + message + '\n')
  process.exit(1)
}

/** 直连模式:外部 fetch(Host fence 403 时提示切 VIA=cdp)。 */
async function directJson(path, init) {
  try {
    const resp = await fetch(BASE + path, { ...init, signal: AbortSignal.timeout(init?.execTimeout ?? (init?.method === 'POST' ? 20000 : 20000)) })
    const type = resp.headers.get('content-type') ?? ''
    if (!type.includes('application/json')) fail('route ' + path + ' 不可用(宿主未启用嵌入式浏览器引擎?需要 DSH Desktop 重启加载新版 dsh-liuli-ui-enhance)')
    return resp.json()
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (message.includes('403') || message.includes('fence')) fail('直连被拒(' + message + ')——设 LIULI_BROWSER_VIA=cdp 走 inspector 桥中转')
    throw cause
  }
}

async function getJson(path) {
  if (VIA === 'cdp') return cdpFetchJson(path, { method: 'GET' })
  return directJson(path, { headers: { accept: 'application/json' } })
}

async function postJson(path, body) {
  const payload = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) }
  if (path === '/liuli-browser/ops') payload.execTimeout = 70000
  if (VIA === 'cdp') return cdpFetchJson(path, { ...payload, method: 'POST' })
  return directJson(path, payload)
}

function requireTab() {
  const tab = args[1]
  if (tab === undefined || tab === '') fail('缺少 <tab> 参数')
  return tab
}

/** 等待标签加载完成（did-stop-loading → loading=false，超时返回最后状态）。 */
async function waitIdle(tab, timeoutMs = 15000) {
  // webview 承载(侧边栏 <webview> guest)没有引擎状态路由,跳过引擎轮询。
  if (tab.startsWith('webview')) return { loading: false }
  const deadline = Date.now() + timeoutMs
  let state
  for (;;) {
    const resp = await getJson('/liuli-browser/tabs/state?id=' + encodeURIComponent(tab))
    state = resp.state
    if (state === undefined) fail('unknown tab ' + tab)
    if (state.loading !== true) return state
    if (Date.now() > deadline) return state
    await new Promise(r => setTimeout(r, 250))
  }
}

/** 精简 DOM 快照：可交互/语义元素 + 唯一 selector（DSH playwright.domSnapshot 的朴素对应）。 */
const SNAP_SCRIPT = '(() => {'
  + 'const rows = [];'
  + 'const esc = (s) => { let out = ""; for (const ch of String(s)) out += /[a-zA-Z0-9_-]/.test(ch) ? ch : String.fromCharCode(92) + ch; return out };'
  + 'const seg = (el) => {'
  + '  if (el.id !== "") return "#" + esc(el.id);'
  + '  const tag = el.tagName.toLowerCase();'
  + '  const cls = Array.from(el.classList).map(esc);'
  + '  const base = cls.length === 0 ? tag : tag + "." + cls.join(".");'
  + '  const parent = el.parentElement;'
  + '  if (parent === null) return base;'
  + '  const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName);'
  + '  return same.length > 1 ? base + ":nth-of-type(" + String(same.indexOf(el) + 1) + ")" : base;'
  + '};'
  + 'const selectorOf = (el) => { const parts = []; let node = el; while (node !== null && node !== document.body) { parts.unshift(seg(node)); node = node.parentElement } return parts.join(" > ") };'
  + 'const walk = (el, depth) => {'
  + '  if (depth > 12 || rows.length >= 400) return;'
  + '  for (const child of el.children) {'
  + '    const tag = child.tagName.toLowerCase();'
  + '    const interactive = ["a","button","input","select","textarea","label"].includes(tag)'
  + '      || (child.getAttribute("role") !== null && ["button","link","tab","menuitem","checkbox","radio","textbox","combobox"].includes(child.getAttribute("role")));'
  + '    const heading = /^h[1-6]$/.test(tag);'
  + '    if (interactive || heading) {'
  + '      const text = (child.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 80);'
  + '      const attrs = interactive && child.id === "" ? " " + tag : "";'
  + '      rows.push("  ".repeat(depth) + tag + (child.id !== "" ? "#" + child.id : "") + (text !== "" ? "  " + String.fromCharCode(34) + text + String.fromCharCode(34) : ""));'
  + '    }'
  + '    walk(child, depth + 1);'
  + '  }'
  + '};'
  + 'walk(document.body, 0);'
  + 'return { title: document.title, url: location.href, rows };'
  + '})()'

const INTERACT = (selector, action) => '(() => {'
  + 'const el = document.querySelector(' + JSON.stringify(selector) + ');'
  + 'if (el === null) return { ok: false, error: "selector not found" };'
  + action
  + '})()'

async function run() {
  switch (command) {
    case 'caps': {
      console.log(JSON.stringify(await getJson('/liuli-browser/capabilities'), null, 2))
      return
    }
    case 'list': {
      const caps = await getJson('/liuli-browser/capabilities')
      const rows = []
      for (const tabId of caps.tabs ?? []) {
        const st = await getJson('/liuli-browser/tabs/state?id=' + encodeURIComponent(tabId))
        rows.push({ tabId, ...st.state })
      }
      console.log(JSON.stringify(rows, null, 2))
      return
    }
    case 'open': {
      const url = args[1] ?? 'about:blank'
      const tabIndex = args.indexOf('--tab')
      // --show：用 browser:show-<uid> id，GUI 侧边栏轮询桥接（只认这个前缀）
      // 会自动展示（agent 驱动浏览器 → 用户实时可见）；缺省 agent:<n> 保持隐藏
      // （无头验证用）。普通 browser:* / agent:* 标签不会被桥接，避免误打扰。
      const show = args.includes('--show')
      const tab = tabIndex >= 0
        ? args[tabIndex + 1]
        : (show ? 'browser:show-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7) : 'agent:' + Date.now().toString(36))
      const created = await postJson('/liuli-browser/tabs', { id: tab, url })
      if (created.ok !== true) fail('create failed: ' + JSON.stringify(created))
      const state = await waitIdle(tab)
      if (show) process.stderr.write(`[browser-client] --show 标签 ${tab} 会在数秒内出现在侧边栏（PreviewPanel 轮询桥接）\n`)
      console.log(JSON.stringify({ tabId: tab, ...state }, null, 2))
      return
    }
    case 'close': {
      const tab = requireTab()
      console.log(JSON.stringify(await postJson('/liuli-browser/tabs/destroy', { id: tab })))
      return
    }
    case 'state': {
      const tab = requireTab()
      console.log(JSON.stringify(await getJson('/liuli-browser/tabs/state?id=' + encodeURIComponent(tab)), null, 2))
      return
    }
    case 'goto': {
      const tab = requireTab()
      const url = args[2]
      if (url === undefined) fail('缺少 <url>')
      await postJson('/liuli-browser/tabs/action', { id: tab, action: 'navigate', url })
      console.log(JSON.stringify({ tabId: tab, ...(await waitIdle(tab)) }, null, 2))
      return
    }
    case 'back':
    case 'forward':
    case 'reload': {
      const tab = requireTab()
      await postJson('/liuli-browser/tabs/action', { id: tab, action: command })
      console.log(JSON.stringify({ tabId: tab, ...(await waitIdle(tab)) }, null, 2))
      return
    }
    case 'url':
    case 'title': {
      const tab = requireTab()
      const state = await waitIdle(tab)
      console.log(command === 'url' ? state.url : state.title)
      return
    }
    case 'wait': {
      const tab = requireTab()
      const selector = args[2]
      if (selector === undefined) fail('缺少 <selector>')
      const timeout = Number(args[3] ?? '10000')
      const deadline = Date.now() + timeout
      for (;;) {
        const resp = await postJson('/liuli-browser/tabs/execute', { id: tab, code: INTERACT(selector, 'return { ok: true }') })
        if (resp.ok === true && resp.value?.ok === true) { console.log(JSON.stringify({ ok: true, selector })); return }
        if (Date.now() > deadline) { console.log(JSON.stringify({ ok: false, error: 'timeout waiting for ' + selector })); process.exit(2) }
        await new Promise(r => setTimeout(r, 300))
      }
    }
    case 'click': {
      const tab = requireTab()
      const selector = args[2]
      if (selector === undefined) fail('缺少 <selector>')
      const resp = await postJson('/liuli-browser/tabs/execute', {
        id: tab,
        code: INTERACT(selector, 'const r = el.getBoundingClientRect();'
          + 'el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));'
          + 'el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));'
          + 'el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));'
          + 'el.click();'
          + 'return { ok: true, tag: el.tagName.toLowerCase() }'),
      })
      await new Promise(r => setTimeout(r, 300))
      console.log(JSON.stringify({ ...(resp.value ?? resp), ...(await waitIdle(tab, 8000)).loading === true ? { navigating: true } : {} }))
      return
    }
    case 'fill': {
      const tab = requireTab()
      const selector = args[2]
      const text = args.slice(3).join(' ')
      if (selector === undefined) fail('缺少 <selector>')
      const resp = await postJson('/liuli-browser/tabs/execute', {
        id: tab,
        code: INTERACT(selector, 'const editable = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el.isContentEditable === true;'
          + 'if (!editable) return { ok: false, error: "element is not fillable (" + el.tagName.toLowerCase() + ")" };'
          + 'if (el.isContentEditable === true) { el.focus(); el.textContent = ' + JSON.stringify(text) + '; el.dispatchEvent(new InputEvent("input", { bubbles: true })); return { ok: true } }'
          + 'const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : (el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype);'
          + 'Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ' + JSON.stringify(text) + ');'
          + 'el.dispatchEvent(new Event("input", { bubbles: true }));'
          + 'el.dispatchEvent(new Event("change", { bubbles: true }));'
          + 'return { ok: true }'),
      })
      console.log(JSON.stringify(resp.value ?? resp))
      return
    }
    case 'text': {
      const tab = requireTab()
      const selector = args[2]
      if (selector === undefined) fail('缺少 <selector>')
      const resp = await postJson('/liuli-browser/tabs/execute', {
        id: tab,
        code: INTERACT(selector, 'return { ok: true, text: (el.textContent || "").trim().slice(0, 4000) }'),
      })
      const value = resp.value ?? resp
      console.log(value.ok === true ? value.text : JSON.stringify(value))
      return
    }
    case 'snap': {
      const tab = requireTab()
      const state = await waitIdle(tab)
      const resp = await postJson('/liuli-browser/tabs/execute', { id: tab, code: SNAP_SCRIPT })
      const value = resp.value
      if (value === null || typeof value !== 'object') { console.log(JSON.stringify(resp)); return }
      console.log('# ' + value.title + ' — ' + value.url + ' (loading=' + String(state.loading) + ')')
      for (const row of value.rows ?? []) console.log(row)
      return
    }
    case 'eval': {
      const tab = requireTab()
      const code = args.slice(2).join(' ')
      if (code === '') fail('缺少 <js>')
      // 优先按表达式求值（拿到返回值）；多语句代码包不进 return(...)，回退原样执行。
      let resp = await postJson('/liuli-browser/tabs/execute', { id: tab, code: '(() => { return (' + code + ') })()' })
      if (resp.ok === false && typeof resp.error === 'string' && resp.error.includes('Script failed')) {
        resp = await postJson('/liuli-browser/tabs/execute', { id: tab, code })
      }
      console.log(JSON.stringify(resp, null, 2))
      return
    }
    case 'shot': {
      const tab = requireTab()
      await waitIdle(tab)
      const capture = async () => {
        const resp = await fetch(BASE + '/liuli-browser/tabs/screenshot?id=' + encodeURIComponent(tab))
        if (!resp.ok) fail('screenshot failed: HTTP ' + String(resp.status))
        return Buffer.from(await resp.arrayBuffer())
      }
      let buf = await capture()
      let promoted = false
      if (buf.length === 0) {
        // 隐藏/无 carrier 标签不参与合成（DSH headless 对应）：临时移入窗口取帧后复位隐藏。
        // 有 GUI carrier 的标签其几何心跳（300ms）会自动恢复承载位。
        await postJson('/liuli-browser/tabs/geometry', { id: tab, x: 0, y: 0, width: 1024, height: 768, visible: true })
        promoted = true
        await new Promise(r => setTimeout(r, 450))
        buf = await capture()
      }
      const file = args[2] ?? 'liuli-browser-' + tab.replace(/[^a-zA-Z0-9_-]/g, '_') + '.png'
      writeFileSync(file, buf)
      if (promoted) await postJson('/liuli-browser/tabs/geometry', { id: tab, x: 0, y: 0, width: 0, height: 0, visible: false })
      console.log(JSON.stringify({ ok: buf.length > 0, file, bytes: buf.length }))
      return
    }
    case 'aria': {
      const tab = requireTab()
      const mode = args[2] === 'yaml' ? 'yaml' : 'ai'
      await waitIdle(tab)
      const resp = await postJson('/liuli-browser/ops', { tabId: tab, method: 'snapshot', params: { mode } })
      if (resp.ok !== true) fail('aria snapshot failed: ' + JSON.stringify(resp.error))
      console.log(resp.value.yaml)
      return
    }
    case 'info': {
      const tab = requireTab()
      const selector = args[2]
      if (selector === undefined) fail('缺少 <ref|selector>')
      const resp = await postJson('/liuli-browser/ops', { tabId: tab, method: 'elementInfo', params: { selector } })
      console.log(JSON.stringify(resp, null, 2))
      return
    }
    case 'op': {
      const tab = requireTab()
      const opMethod = args[2]
      if (opMethod === undefined) fail('缺少 <method>(click/type/fill/press/hover/scroll/select/check/uncheck/evaluate/playwright/navigate/newTab/closeTab/list/screenshot/getState)')
      let params = {}
      if (args[3] !== undefined) {
        try { params = JSON.parse(args.slice(3).join(' ')) } catch { fail('<json> 参数不是合法 JSON') }
      }
      const resp = await postJson('/liuli-browser/ops', { tabId: tab, method: opMethod, params })
      const isShot = opMethod === 'screenshot' && resp.ok === true
      if (isShot) {
        const file = params.out ?? 'liuli-op-' + tab.replace(/[^a-zA-Z0-9_-]/g, '_') + '.png'
        writeFileSync(file, Buffer.from(resp.value.base64, 'base64'))
        console.log(JSON.stringify({ ok: true, file, bytes: resp.value.bytes }))
        return
      }
      console.log(JSON.stringify(resp, null, 2))
      return
    }
    case 'help':
    default: {
      const header = typeof __filename !== 'undefined' ? '' : ''
      process.stdout.write(header + '用法见脚本头注释：caps/open/list/state/goto/back/forward/reload/url/title/wait/click/fill/text/snap/eval/shot/close/aria/info/op'
        + (VIA === 'cdp' ? '(VIA=cdp 桥中转)' : '(直连 ' + BASE + ';403 时设 LIULI_BROWSER_VIA=cdp)') + '\n')
    }
  }
}

run().catch((cause) => { fail(cause instanceof Error ? cause.message : String(cause)) })
