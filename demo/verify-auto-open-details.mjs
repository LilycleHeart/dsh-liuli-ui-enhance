// GUI-level verification for auto-open-details (LLM activity → auto expand side pane).
// Injects fake conversation-flow tool rows into the live GUI and asserts:
//  - A1: an edit tool row in a fresh turn triggers AUTO_OPEN_DETAILS_EVENT, expands the
//        details column and activates the 审查文件 (git) tab;
//  - A2: a second tool row in the SAME turn (no new user anchor) does not trigger again;
//  - A3: a new user anchor (newest in flow) re-arms and the next tool row triggers again;
//  - A4: after a manual collapse (closeDetails + PREVIEW_TOGGLE_EVENT), tool rows no longer
//        trigger in this session (dismissed until manual open);
//  - A5: after a manual open, auto-open is re-armed.
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
const BASE = await (async () => {
  if (process.env.LIULI_BROWSER_BASE) return process.env.LIULI_BROWSER_BASE
  const { execSync } = await import('node:child_process')
  let ports = []
  try {
    const out = execSync('powershell -NoProfile -Command "Get-Process \'DSH Desktop\' -ErrorAction SilentlyContinue | ForEach-Object { Get-NetTCPConnection -OwningProcess $_.Id -State Listen -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty LocalPort -Unique"', { encoding: 'utf8', timeout: 15000 })
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
  console.error('no live DSH Desktop found (tried: ' + candidates.join(',') + ')')
  process.exit(2)
})()
console.log('BASE=' + BASE)

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const PORT = 9242
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run','--user-data-dir=' + path.join(os.tmpdir(),'liuli-autoopen-' + process.pid),'--remote-debugging-port=' + String(PORT),'--window-size=1680,980',BASE + '/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32'],{stdio:'ignore'})
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
let ws=null,sendId=0;const pending=new Map();const pageErrors=[]
async function connect(){let list=[];for(let i=0;i<40;i++){try{list=await(await fetch('http://127.0.0.1:'+PORT+'/json')).json();if(list.some(t=>t.type==='page'))break}catch{}await sleep(500)}const t=list.find(t=>t.type==='page');if(!t)throw new Error('no page');ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id).res(m.result);pending.delete(m.id);return}if(m.method==='Runtime.exceptionThrown'){pageErrors.push(m.params.exceptionDetails?.exception?.description??'x')}};await send('Runtime.enable')}
function send(method,params={}){return new Promise((res,rej)=>{const id=++sendId;pending.set(id,{res,rej});setTimeout(()=>{if(pending.has(id)){pending.delete(id);rej(new Error(method+' timeout'))}},25000);ws.send(JSON.stringify({id,method,params}))})}
const evalJs=async(expr)=>{const r=await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});if(r?.exceptionDetails)return{__err:r.exceptionDetails.exception?.description??r.exceptionDetails.text};return r?.result?.value}
const results=[]
const check=(name,pass,detail='')=>{results.push({name,pass:!!pass});console.log((pass?'PASS':'FAIL')+' '+name+(detail?' :: '+String(detail).slice(0,140):''))}

// Fresh turn: new flow + user anchor + tool row. Same-turn: tool row appended to the
// newest flow (no user anchor) — must NOT re-trigger.
const INJECT_TURN = (kind) => `(() => {
  const flow = document.createElement('div')
  flow.setAttribute('data-chat-flow', '')
  flow.setAttribute('data-liuli-test-flow', '')
  const user = document.createElement('div')
  user.setAttribute('data-chat-anchor-key', 'autoopen-user-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  user.setAttribute('data-chat-flow-kind', 'user')
  const tool = document.createElement('div')
  tool.setAttribute('data-tool', ${JSON.stringify(kind)})
  flow.appendChild(user)
  flow.appendChild(tool)
  document.body.appendChild(flow)
  return flow !== null
})()`
const INJECT_TOOL_ONLY = (kind) => `(() => {
  const flow = document.querySelector('[data-liuli-test-flow]')
  if (flow === null) return false
  const tool = document.createElement('div')
  tool.setAttribute('data-tool', ${JSON.stringify(kind)})
  flow.appendChild(tool)
  return true
})()`

try{
  await connect()
  await sleep(12000) // page load + 3s settle window
  // instrument: count AUTO_OPEN_DETAILS_EVENT dispatches
  await evalJs('(() => { window.__autoOpenCount = 0; window.__autoOpenTabs = []; window.addEventListener("liuli:auto-open-details", (e) => { window.__autoOpenCount += 1; window.__autoOpenTabs.push(e.detail?.tab) }); return true })()')

  // A1: fresh turn + edit tool row → trigger, expand, activate git tab
  await evalJs(INJECT_TURN('edit'))
  await sleep(900)
  const count1 = await evalJs('window.__autoOpenCount')
  check('A1 edit row triggers auto-open', count1 === 1, 'count=' + String(count1))
  const panelW = await evalJs('(() => { const p = document.querySelector("[data-preview-panel]"); return p === null ? -1 : p.getBoundingClientRect().width })()')
  check('A1 details column expanded', panelW > 1, 'width=' + String(panelW))
  const gitActive = await evalJs('document.querySelector("[data-side-pane-tab-id=\\"git\\"][data-state=\\"active\\"]") !== null')
  check('A1 git tab activated', gitActive === true)

  // A2: same turn (no new user anchor), another tool row → no second trigger
  await evalJs(INJECT_TOOL_ONLY('write'))
  await sleep(700)
  const count2 = await evalJs('window.__autoOpenCount')
  check('A2 same turn does not re-trigger', count2 === 1, 'count=' + String(count2))

  // A3: new user anchor (newest in flow) + edit row → re-arms and triggers again
  await evalJs(INJECT_TURN('edit'))
  await sleep(900)
  const count3 = await evalJs('window.__autoOpenCount')
  check('A3 new turn re-arms and triggers', count3 === 2, 'count=' + String(count3))

  // A4: manual collapse (close details + PREVIEW_TOGGLE_EVENT) → suppressed this session
  await evalJs('(() => { const hook = window.__liuliDockShell__; if (hook && typeof hook.closeDetails === "function") hook.closeDetails(); window.dispatchEvent(new CustomEvent("liuli:preview-toggle")); return true })()')
  await sleep(700)
  const wAfterClose = await evalJs('(() => { const p = document.querySelector("[data-preview-panel]"); return p === null ? -1 : p.getBoundingClientRect().width })()')
  check('A4 details width after manual close', wAfterClose <= 1, 'width=' + String(wAfterClose))
  await evalJs(INJECT_TURN('edit'))
  await sleep(900)
  const count4 = await evalJs('window.__autoOpenCount')
  check('A4 manual collapse suppresses auto-open', count4 === 2, 'count=' + String(count4))

  // A5: manual open → re-armed
  await evalJs('(() => { const hook = window.__liuliDockShell__; if (hook && typeof hook.openDetails === "function") hook.openDetails(); window.dispatchEvent(new CustomEvent("liuli:preview-toggle")); return true })()')
  await sleep(700)
  await evalJs(INJECT_TURN('edit'))
  await sleep(900)
  const count5 = await evalJs('window.__autoOpenCount')
  check('A5 manual open re-arms auto-open', count5 === 3, 'count=' + String(count5))

} catch (e) {
  console.error('ERROR: ' + (e?.stack ?? e))
  process.exitCode = 1
} finally {
  try { chrome.kill() } catch { /* already dead */ }
}

const failed = results.filter(r => !r.pass)
console.log('----')
console.log((results.length - failed.length) + '/' + results.length + ' passed')
if (pageErrors.length > 0) console.log('page errors: ' + pageErrors.length + ' (first: ' + String(pageErrors[0]).slice(0,160) + ')')
if (failed.length > 0) process.exitCode = 1
