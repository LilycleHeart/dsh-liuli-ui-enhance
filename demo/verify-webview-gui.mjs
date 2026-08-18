// GUI-level webview verification: headless Chrome loads the Electron-hosted GUI,
// opens a browser tab in the side pane, and checks the native panel + engine wiring.
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { writeFileSync } from 'node:fs'
const BASE = await (async () => {
  if (process.env.LIULI_BROWSER_BASE) return process.env.LIULI_BROWSER_BASE
  const { execSync } = await import('node:child_process')
  let ports = []
  try {
    const out = execSync('powershell -NoProfile -Command "Get-Process \\"DSH Desktop\\" -ErrorAction SilentlyContinue | ForEach-Object { Get-NetTCPConnection -OwningProcess $_.Id -State Listen -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty LocalPort -Unique"', { encoding: 'utf8', timeout: 15000 })
    ports = out.split(/\r?\n/).map(s => s.trim()).filter(s => /^[0-9]+$/.test(s))
  } catch { /* fall through to static candidates */ }
  const candidates = [...ports, '10205', '7336']
  for (const port of candidates) {
    try {
      const resp = await fetch('http://127.0.0.1:' + port + '/liuli-browser/capabilities', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(3000) })
      const ct = resp.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) return 'http://127.0.0.1:' + port
    } catch { /* try next */ }
  }
  console.error('no live liuli-browser engine found (tried: ' + candidates.join(',') + ')')
  process.exit(2)
})()
console.log('BASE=' + BASE)

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9241
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--user-data-dir=' + path.join(os.tmpdir(),'liuli-gui-' + process.pid),'--remote-debugging-port=' + String(PORT),'--window-size=1680,980',BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32'],{stdio:'ignore'})
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
let ws=null,sendId=0;const pending=new Map();const pageErrors=[]
async function connect(){let list=[];for(let i=0;i<40;i++){try{list=await(await fetch('http://127.0.0.1:'+PORT+'/json')).json();if(list.some(t=>t.type==='page'))break}catch{}await sleep(500)}const t=list.find(t=>t.type==='page');if(!t)throw new Error('no page');ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id).res(m.result);pending.delete(m.id);return}if(m.method==='Runtime.exceptionThrown'){pageErrors.push(m.params.exceptionDetails?.exception?.description??'x')}};await send('Runtime.enable')}
function send(method,params={}){return new Promise((res,rej)=>{const id=++sendId;pending.set(id,{res,rej});setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error(method+' timeout'))}},25000);ws.send(JSON.stringify({id,method,params}))})}
const evalJs=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r?.exceptionDetails)return{__err:r.exceptionDetails.exception?.description??r.exceptionDetails.text};return r?.result?.value}
const results=[]
const check=(name,pass,detail='')=>{results.push({name,pass:!!pass});console.log((pass?'PASS':'FAIL')+' '+name+(detail?' :: '+String(detail).slice(0,140):''))}
const shot=async(name)=>{try{const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(name,Buffer.from(s.data,'base64'));console.log('screenshot: '+name)}catch{}}

try{
  await connect()
  await sleep(11000)
  // B1: capabilities as seen from the page
  const caps = await evalJs('fetch("/liuli-browser/capabilities",{headers:{accept:"application/json"}}).then(r=>r.headers.get("content-type").includes("json")?r.json():null).then(j=>j?j.engine:"fallback")')
  check('B1 page sees webview engine', caps === 'webview', String(caps))
  // snapshot engine tabs BEFORE the panel mounts (it creates its host tab on mount)
  const beforeTabs = await (await fetch(BASE + '/liuli-browser/capabilities', { headers: { accept: 'application/json' } })).json()

  // open + menu → browser tab
  await evalJs('(() => { const add = document.querySelector("button[aria-label=\\\"新增标签\\\"]"); if (add) add.click(); return add !== null })()')
  await sleep(700)
  await evalJs('(() => { const item = document.querySelector("[data-side-pane-open-tab-item=browser]"); if (item) item.click(); return item !== null })()')
  await sleep(2500)
  // B2: native panel rendered (address input + carrier + responsive/picker/more buttons)
  check('B2 address input', await evalJs('document.querySelector("[data-testid=browser-address-input]") !== null'))
  check('B3 webview carrier', await evalJs('document.querySelector("[data-testid=browser-webview]") !== null'))
  check('B4 toolbar buttons', await evalJs('["browser-back-button","browser-forward-button","browser-refresh-button","browser-responsive-button","browser-element-picker-button","browser-more-button"].every(id => document.querySelector("[data-testid=" + JSON.stringify(id) + "]") !== null)'))
  check('B5 empty state', await evalJs('document.querySelector("[class*=emptyWebview]") !== null'))
  // navigate via address bar → engine tab created (diff tab lists: the user may have tabs already)
  await evalJs('(() => { const input = document.querySelector("[data-testid=browser-address-input]"); const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set; setter.call(input, "example.com"); input.dispatchEvent(new Event("input", { bubbles: true })); input.form.requestSubmit(); return true })()')
  await sleep(5000)
  const hostTabs = await (await fetch(BASE + '/liuli-browser/capabilities', { headers: { accept: 'application/json' } })).json()
  const beforeSet = new Set(beforeTabs.tabs ?? [])
  const guiTab = (hostTabs.tabs ?? []).find(t => String(t).startsWith('browser:') && !beforeSet.has(t))
  check('B6 engine tab created for GUI browser tab', guiTab !== undefined, JSON.stringify(hostTabs.tabs ?? []))
  if (guiTab !== undefined) {
    const st = await (await fetch(BASE + '/liuli-browser/tabs/state?id=' + encodeURIComponent(guiTab), { headers: { accept: 'application/json' } })).json()
    check('B7 guest loaded example.com + title', st.state && String(st.state.url).includes('example.com') && /Example Domain/i.test(st.state.title), JSON.stringify(st.state ?? {}))
    check('B8 favicon synced to state', st.state && typeof st.state.favicon === 'string' && st.state.favicon !== '', String(st.state?.favicon ?? 'none'))
    // the headless GUI column may be zero-width (view hidden); force bounds so capturePage has a surface
    await fetch(BASE + '/liuli-browser/tabs/geometry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: guiTab, x: 80, y: 80, width: 520, height: 420, visible: true }) })
    await sleep(700)
    const shotResp = await fetch(BASE + '/liuli-browser/tabs/screenshot?id=' + encodeURIComponent(guiTab))
    const buf = Buffer.from(await shotResp.arrayBuffer())
    check('B9 guest screenshot', buf.length > 100 && buf[0] === 0x89, 'bytes=' + buf.length)
    if (buf.length > 100) writeFileSync('demo/verify-gui-guest.png', buf)
  }
  // B10: tab chip shows title + favicon img
  check('B10 tab chip title synced', await evalJs('String(document.body.innerText).includes("Example Domain")'))
  // B11: responsive mode toolbar appears
  await evalJs('(() => { const b = document.querySelector("[data-testid=browser-responsive-button]"); if (b) b.click(); return b !== null })()')
  await sleep(800)
  check('B11 responsive toolbar + frame guide', await evalJs('document.querySelector("[data-testid=browser-responsive-toolbar]") !== null && document.querySelector("[data-testid=browser-responsive-scaled-frame]") !== null'))
  await evalJs('(() => { const b = document.querySelector("[data-testid=browser-responsive-button]"); if (b) b.click(); return true })()')
  // B12: more menu items
  await evalJs('(() => { const b = document.querySelector("[data-testid=browser-more-button]"); if (b) b.click(); return b !== null })()')
  await sleep(500)
  check('B12 more menu external+devtools', await evalJs('document.querySelector("[data-testid=browser-open-external-item]") !== null && document.querySelector("[data-testid=browser-devtools-button]") !== null'))
  await evalJs('(() => { document.body.click(); return true })()')
  await shot('demo/verify-gui-panel.png')
  check('B13 no page errors', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0,3)))
  if (guiTab !== undefined) {
    await fetch(BASE + '/liuli-browser/tabs/destroy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: guiTab }) })
    console.log('cleaned up test tab ' + guiTab)
  }
  const failed = results.filter(r => !r.pass)
  console.log('SUMMARY: ' + String(results.length - failed.length) + '/' + String(results.length) + ' passed')
  if (failed.length > 0) console.log('FAILED: ' + failed.map(f => f.name).join(' | '))
}catch(e){ console.log('GUI VERIFY FAIL:', e.message, JSON.stringify(pageErrors.slice(0,3))) }
finally{ try{chrome.kill()}catch{} }
