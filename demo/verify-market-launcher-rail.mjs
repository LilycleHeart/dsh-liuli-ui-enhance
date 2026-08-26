// 无头验证：收起态左侧栏「插件市场」按钮（宿主 dshMarketLauncher，
// sidebar.footer.action slot）与 rail 其它圆形按钮的水平对齐。
// 静态 fixture 用 宿主 SidebarRoot / DESKTOP_OWNED_STYLES / market /
// Button 四段真实 CSS（取自 app.asar bundle）+ liuliCss +
// DESKTOP_ADVANCED_CSS（取自本仓库源码），复现 56px rail。
// 用法：node demo/verify-market-launcher-rail.mjs [out.png]
import { readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CDP_PORT = 9263

// liuli 运行时注入 CSS（真实产物，lyuli-css.ts 为运行时真相）
const liuliTs = readFileSync(path.join(ROOT, 'src/client/liuli-css.ts'), 'utf8')
const liuliCss = liuliTs.slice(liuliTs.indexOf('`') + 1, liuliTs.lastIndexOf('`'))

// DESKTOP_ADVANCED_CSS（真实产物）
const indexTs = readFileSync(path.join(ROOT, 'src/client/index.ts'), 'utf8')
const am = /const DESKTOP_ADVANCED_CSS = \[([\s\S]*?)[\r\n]\]\.join\('\\n'\)/.exec(indexTs)
if (!am) throw new Error('DESKTOP_ADVANCED_CSS extraction failed')
const advancedCss = eval('[' + am[1] + ']').join('\n')

// 宿主 bundle 里的四段真实 CSS
const ASAR = 'D:\\DSH\\DSH Desktop\\resources\\app.asar'
const asar = readFileSync(ASAR, 'utf8')
const grab = (from, to) => {
  const i = asar.indexOf(from)
  if (i < 0) throw new Error('asar missing: ' + from.slice(0, 40))
  const j = asar.indexOf(to, i)
  if (j < 0) throw new Error('asar missing end: ' + from.slice(0, 40))
  return asar.slice(i, j)
}
const sidebarRootCss = grab('const css = ".hHd-Xa_root{', '";\n\t\tconst tagId = "@deepseek-ai/dsh-client-ui-sidebar').replace('const css = "', '')
const desktopOwnedStyles = grab('const DESKTOP_OWNED_STYLES = `', '`;\n').slice('const DESKTOP_OWNED_STYLES = `'.length)
const marketCss = grab('.dshMarketLauncher {', '`;\n\t\tfunction installMarketStyles()').replace('`;\n\t\tfunction installMarketStyles()', '')
const btnCss = grab('._button_kz6gm_4{', '._icon_kz6gm_73{')

const dsfRules = [
  ':global(body[data-dsh-desktop-mode="advanced"] .dshDesktopUpstreamSidebar [class*="_logoRow"]) { position: relative; z-index: 201; }',
  ':global(.dshDesktopSidebarSurface[data-edge-right] .dshDesktopUpstreamSidebar) { padding-left: var(--liuli-dock-padding, 8px) !important; padding-right: 0 !important; }',
  ':global(.dshDesktopSidebarSurface:not([data-edge-left]):not([data-edge-right]) .dshDesktopUpstreamSidebar) { padding-left: var(--liuli-dock-padding, 8px) !important; padding-right: var(--liuli-dock-padding, 8px) !important; }',
].join('\n')

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<style>
:root { --liuli-dock-padding: 8px; --liuli-radius: 14px; --liuli-material-opacity: 0.55; --dsw-alias-border-l1: rgba(120,124,130,.28); --dsw-alias-border-l2: rgba(120,124,130,.4); --dsw-alias-label-primary: #e2e4e8; --dsw-alias-label-secondary: #a7abb2; --dsw-alias-label-primary-foreground:#0b0d0f; --dsw-alias-brand-primary:#4c9aff; --dsw-alias-button-primary-fill:#3b82f6; --dsw-alias-interactive-bg-hover:rgba(128,128,128,.18); --dsw-alias-bg-base:#141519; --liuli-acrylic-rgb:24,26,30; --liuli-glow-brand: none; --liuli-shadow: none; --ds-transition-duration-slow: 300ms; --ds-ease-in-out: cubic-bezier(0.4,0,0.2,1); }
html, body { margin: 0; width: 100%; height: 100%; background: #141519; }
</style>
<style>${sidebarRootCss}</style>
<style>${desktopOwnedStyles}</style>
<style>${marketCss}</style>
<style>${btnCss}</style>
<style>${liuliCss}</style>
<style>${advancedCss}</style>
<style>${dsfRules}</style>
</head>
<body data-dsh-desktop-mode="advanced" data-dsh-desktop-platform="win32" data-dsh-desktop-material="acrylic">
<div class="dshDesktopFrame liuli_frame" data-desktop-mode="advanced" data-desktop-platform="win32" style="display:grid; grid-template-columns: 56px minmax(0,1fr); grid-template-rows: 32px minmax(0,1fr); position:relative; width:100%; height:100%; overflow:hidden; background:#141519;">
  <div class="dshDesktopSidebarSurface" data-edge-left style="grid-column:1; grid-row:1/-1;">
    <div class="dshDesktopUpstreamSidebar liuli_sidebarCol">
      <div style="height:100%">
        <div class="hHd-Xa_root hHd-Xa_collapsed hHd-Xa_railIn">
          <div class="hHd-Xa_logoRow">
            <button class="hHd-Xa_iconButton hHd-Xa_toggle" aria-label="打开侧边栏" type="button">
              <span class="hHd-Xa_railMark" aria-hidden="true">◉</span>
            </button>
          </div>
          <button class="hHd-Xa_newSession" aria-label="新建会话" type="button">＋</button>
          <div class="hHd-Xa_regionArea"></div>
          <div class="hHd-Xa_footArea">
            <div class="hHd-Xa_footerActions">
              <div data-slot="sidebar.footer.action">
                <button class="_button_kz6gm_4 _ghost_kz6gm_47 _md_kz6gm_24 dshMarketLauncher" data-wide="false" type="button" aria-label="插件市场" aria-haspopup="dialog">
                  <span class="_icon_kz6gm_73"><svg data-icon="market-store" width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.25 6.25v6.5c0 .55.45 1 1 1h9.5c.55 0 1-.45 1-1v-6.5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 5.75 2.75 2.5h10.5l1.25 3.25a2 2 0 0 1-3.25 1.55A2 2 0 0 1 8 7.3a2 2 0 0 1-3.25 0A2 2 0 0 1 1.5 5.75Z" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 13.75v-3.5h4v3.5" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg></span>
                </button>
              </div>
            </div>
            <div class="hHd-Xa_settingsArea">
              <button class="hHd-Xa_iconButton" aria-label="设置" type="button">⚙</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="dshDesktopConversationSurface" style="grid-column:2; grid-row:2;"></div>
</div>
</body>
</html>`

const htmlPath = path.join(os.tmpdir(), 'liuli-market-rail.html')
writeFileSync(htmlPath, html, 'utf8')

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--user-data-dir=' + path.join(os.tmpdir(), 'liuli-mrail-' + process.pid), '--remote-debugging-port=' + String(CDP_PORT), '--window-size=1680,980', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
let ws = null, sendId = 0
const pending = new Map()
async function connect() {
  let list = []
  for (let i = 0; i < 40; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + CDP_PORT + '/json')).json(); if (list.some(t => t.type === 'page')) break } catch {}
    await sleep(300)
  }
  const t = list.find(t => t.type === 'page')
  if (!t) throw new Error('no page target')
  ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id).res(m.result); pending.delete(m.id); return } }
  await send('Runtime.enable')
  await send('Page.enable')
  await send('Page.navigate', { url: 'file:///' + htmlPath.replace(/\\/g, '/') })
}
function send(method, params = {}) {
  return new Promise((res, rej) => { const id = ++sendId; pending.set(id, { res, rej }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(method + ' timeout')) } }, 30000); ws.send(JSON.stringify({ id, method, params })) })
}
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) return { __err: String(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 300) }
  return r?.result?.value
}

const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + detail : '')) }

try {
  await connect()
  await sleep(1200)
  const data = await evalJs(`(() => {
    const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: b.x, w: b.width, cx: b.x + b.width / 2, alignIt: cs.alignItems, gutter: cs.scrollbarGutter } }
    return {
      rail: box('.hHd-Xa_root'),
      market: box('.dshMarketLauncher'),
      footer: box('.hHd-Xa_footerActions'),
      slotHost: box('[data-slot="sidebar.footer.action"]'),
      settings: box('.hHd-Xa_settingsArea'),
      settingsBtn: box('.hHd-Xa_settingsArea button'),
      toggle: box('.hHd-Xa_toggle'),
      newSession: box('.hHd-Xa_newSession'),
    }
  })()`)
  if (!data || data.__err) { console.log('FATAL: measure failed', data); process.exit(1) }
  console.log(JSON.stringify(data, null, 2))
  const m = data.market, s = data.settingsBtn, t = data.toggle, rail = data.rail
  check('market button 36x36 circle in rail', m && Math.round(m.w) === 36 && Math.round(m.x) >= 5, JSON.stringify(m))
  check('market ↔ settings center aligned', m && s && Math.abs(m.cx - s.cx) < 1, `dCenter=${m && s ? (s.cx - m.cx).toFixed(2) : 'n/a'}`)
  check('market ↔ toggle center aligned', m && t && Math.abs(m.cx - t.cx) < 1, `dCenter=${m && t ? (t.cx - m.cx).toFixed(2) : 'n/a'}`)
  /* newSession 不参与对齐判定：宿主收起态给它 align-self:flex-start，
    圆心恒在 29（内容盒起点 11），与居中图标差 1px，属于宿主既有设计，
    与本修复无关（市场按钮应跟相邻的设置/折叠按钮同轴）。 */
  check('market on rail content center', m && rail && Math.abs(m.cx - (rail.x + rail.w / 2)) < 1, `marketCx=${m && m.cx.toFixed(1)} railCx=${rail && (rail.x + rail.w / 2).toFixed(1)}`)
  check('footer no longer overflows (36px)', data.footer && Math.round(data.footer.w) === 36, `footerW=${data.footer && data.footer.w.toFixed(1)}`)
  check('slot host centers content (align-items center)', data.slotHost && data.slotHost.alignIt === 'center', `alignIt=${data.slotHost && data.slotHost.alignIt}`)
  check('slot host gutter cleared', data.slotHost && data.slotHost.gutter === 'auto', `gutter=${data.slotHost && data.slotHost.gutter}`)
  if (process.argv[2]) {
    const shot = await send('Page.captureScreenshot', { format: 'png' }).catch(() => null)
    if (shot?.data) { writeFileSync(process.argv[2], Buffer.from(shot.data, 'base64')); console.log('shot: ' + process.argv[2]) }
  }
  const failed = results.filter(r => !r.pass).length
  console.log(failed === 0 ? 'ALL PASS' : (failed + ' FAILED'))
  process.exitCode = failed === 0 ? 0 : 1
  await sleep(200)
} catch (e) {
  console.log('ERROR:', e.message)
  process.exitCode = 1
} finally {
  try { if (ws) ws.close() } catch {}
  chrome.kill()
}