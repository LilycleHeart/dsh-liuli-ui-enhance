#!/usr/bin/env node
/**
 * liuli-theme 浏览器自动化 CLI（ZCode browser-use-plugin 的 browser-client.mjs 对应物）。
 *
 * ZCode 的 browser-use 插件通过 node_repl js 工具 + browser-client.mjs 驱动
 * 桌面 IAB（内嵌浏览器）；DSH 里 liuli-theme 的 Host 半把同款能力暴露在
 * /liuli-browser HTTP API 上，本脚本即其命令行客户端，供 agent（pwsh 工具）
 * 或人工驱动侧边栏嵌入式浏览器：
 *
 *   node browser-client.mjs caps                       # 能力探测
 *   node browser-client.mjs open <url> [--tab <id>]    # 打开标签（缺省 agent:<n>）
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
 *
 * 无几何上报的 agent 标签保持隐藏（等效 ZCode CLI-managed headless CDP：
 * 导航/执行/截图可用，仅不可见）；GUI 侧边栏打开的标签 id 形如 browser:<uid>，
 * 可直接用本 CLI 驱动（IAB 模式）。
 */
import { writeFileSync } from 'node:fs'

const BASE = process.env.LIULI_BROWSER_BASE ?? 'http://127.0.0.1:7336'
const args = process.argv.slice(2)
const command = args[0] ?? 'help'

function fail(message) {
  process.stderr.write('browser-client: ' + message + '\n')
  process.exit(1)
}

async function getJson(path) {
  const resp = await fetch(BASE + path, { headers: { accept: 'application/json' } })
  const type = resp.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) fail('route ' + path + ' 不可用（宿主未启用嵌入式浏览器引擎？需要 DSH Desktop 重启加载新版 liuli-theme）')
  return resp.json()
}

async function postJson(path, body) {
  const resp = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const type = resp.headers.get('content-type') ?? ''
  if (!type.includes('application/json')) fail('route ' + path + ' 不可用（宿主未启用嵌入式浏览器引擎？）')
  return resp.json()
}

function requireTab() {
  const tab = args[1]
  if (tab === undefined || tab === '') fail('缺少 <tab> 参数')
  return tab
}

/** 等待标签加载完成（did-stop-loading → loading=false，超时返回最后状态）。 */
async function waitIdle(tab, timeoutMs = 15000) {
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

/** 精简 DOM 快照：可交互/语义元素 + 唯一 selector（ZCode playwright.domSnapshot 的朴素对应）。 */
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
  + '      rows.push("  ".repeat(depth) + tag + (child.id !== "" ? "#" + child.id : "") + (text !== "" ? "  \"" + text + "\"" : ""));'
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
      const tab = tabIndex >= 0 ? args[tabIndex + 1] : 'agent:' + Date.now().toString(36)
      const created = await postJson('/liuli-browser/tabs', { id: tab, url })
      if (created.ok !== true) fail('create failed: ' + JSON.stringify(created))
      const state = await waitIdle(tab)
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
        code: INTERACT(selector, 'const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;'
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
      const resp = await postJson('/liuli-browser/tabs/execute', { id: tab, code: '(() => { return (' + code + ') })()' })
      console.log(JSON.stringify(resp, null, 2))
      return
    }
    case 'shot': {
      const tab = requireTab()
      await waitIdle(tab)
      const resp = await fetch(BASE + '/liuli-browser/tabs/screenshot?id=' + encodeURIComponent(tab))
      if (!resp.ok) fail('screenshot failed: HTTP ' + String(resp.status))
      const buf = Buffer.from(await resp.arrayBuffer())
      const file = args[2] ?? 'liuli-browser-' + tab.replace(/[^a-zA-Z0-9_-]/g, '_') + '.png'
      writeFileSync(file, buf)
      console.log(JSON.stringify({ ok: true, file, bytes: buf.length }))
      return
    }
    case 'help':
    default: {
      const header = typeof __filename !== 'undefined' ? '' : ''
      process.stdout.write(header + '用法见脚本头注释：caps/open/list/state/goto/back/forward/reload/url/title/wait/click/fill/text/snap/eval/shot/close\n')
    }
  }
}

run().catch((cause) => { fail(cause instanceof Error ? cause.message : String(cause)) })
