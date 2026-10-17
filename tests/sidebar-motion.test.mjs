// Real browser regression coverage, without a browser automation dependency.
// Run: node --test tests/sidebar-motion.test.mjs (set CHROME_PATH outside Windows).
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript'
import { transform } from 'lightningcss'

const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const enabled = existsSync(chromePath)
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let chrome, profile, server, socket
let sequence = 0
const pending = new Map()
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)) }, 15000)
  pending.set(id, { resolve, reject, timer })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async fn => {
  const result = await call('Runtime.evaluate', { expression: `(${fn})()`, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}

before(async () => {
  if (!enabled) return
  server = createServer(async (request, response) => {
    const name = request.url?.slice(1)
    if (name === 'react.js' || name === 'react-dom.js') {
      response.setHeader('Content-Type', 'text/javascript')
      const pkg = name === 'react.js' ? 'react' : 'react-dom'
      response.end(await readFile(new URL(`../node_modules/${pkg}/umd/${pkg}.development.js`, import.meta.url), 'utf8'))
      return
    }
    if (name === 'react-shim.js' || name === 'sidebar-right-tabs.ts' || name === 'seat-styles.js') {
      response.setHeader('Content-Type', 'text/javascript')
      response.end(name === 'react-shim.js'
        ? 'export const {createElement,useLayoutEffect,useRef,useState}=window.React'
        : name === 'sidebar-right-tabs.ts'
          ? 'export const getOfficialSidebarController=()=>window.nativeController;export const OFFICIAL_SIDEBAR_NAVIGATION_EVENT="test-native-navigation"'
          : 'export default {nativeSeatTarget:"testNativeTarget",nativeSeatPlaceholder:"testNativePlaceholder",nativeSkin:"testNativeSkin"}')
      return
    }
    if (name === 'sidebar-style.js') {
      const source = await readFile(new URL('../src/client/DockShellFrame.module.css', import.meta.url))
      const compiled = transform({filename:'DockShellFrame.module.css',code:source,cssModules:true})
      response.setHeader('Content-Type', 'text/javascript')
      response.end(`export const css=${JSON.stringify(compiled.code.toString())};export const classes=${JSON.stringify(Object.fromEntries(Object.entries(compiled.exports).map(([k,v])=>[k,v.name])))};`)
      return
    }
    if (name === 'liuli.css') {
      response.setHeader('Content-Type', 'text/css')
      response.end(await readFile(new URL('../src/client/liuli.css', import.meta.url), 'utf8'))
      return
    }
    if (['resize-perf.ts','desktop-drag.ts','use-sidebar-presence.ts','sidebar-content.tsx','official-sidebar-seat.tsx'].includes(name)) {
      const source = await readFile(new URL(`../src/client/${name}`, import.meta.url), 'utf8')
      response.setHeader('Content-Type', 'text/javascript')
      response.end(transpileModule(source, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText
        .replaceAll("from 'react'", "from '/react-shim.js'")
        .replace(/from '\.\/[^']+\.module\.css'/g, "from '/seat-styles.js'"))
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><style>body{--liuli-material-blur:none;--liuli-material-blur-strong:none}</style><div id="handle"></div><div id="pane"></div>')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  profile = await mkdtemp(join(tmpdir(), 'liuli-resize-test-'))
  chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true })
  let port
  for (let i = 0; i < 100; i++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break } catch { await delay(100) }
  }
  assert.ok(port, 'Chrome exposes its test debugging port')
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
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
    if (await evaluate(() => !!document.getElementById('handle'))) break
    await delay(50)
  }
  await evaluate(async () => {
    window.perf = await import('/resize-perf.ts')
    window.nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve))
  })
}, { timeout: 30000 })

after(async () => {
  if (socket?.readyState === WebSocket.OPEN) {
    // Browser.close tears down all test children before removing its profile.
    try { await call('Browser.close') } catch { /* Already exited. */ }
    socket.close()
  }
  for (const entry of pending.values()) clearTimeout(entry.timer)
  if (chrome && chrome.exitCode === null) {
    await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), delay(3000)])
    if (chrome.exitCode === null) chrome.kill()
  }
  if (server) await new Promise(resolve => server.close(resolve))
  if (profile) {
    assert.equal(dirname(resolve(profile)), resolve(tmpdir()))
    assert.ok(basename(profile).startsWith('liuli-resize-test-'))
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

const browserTest = (name, fn) => test(name, { skip: !enabled && 'Set CHROME_PATH to run the browser regression checks.' }, fn)

browserTest('sidebar shell resizes continuously while its content stays fixed and native geometry readers pause', async () => {
  const result = await evaluate(async () => {
    for (const src of ['/react.js','/react-dom.js']) {
      await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.onload=resolve;script.onerror=reject;document.head.append(script)})
    }
    const {useSidebarPresence}=await import('/use-sidebar-presence.ts')
    const {SidebarContent}=await import('/sidebar-content.tsx')
    const {OfficialSidebarSeatPane}=await import('/official-sidebar-seat.tsx')
    const {css,classes}=await import('/sidebar-style.js')
    const style=document.createElement('style')
    style.textContent=css+' .testNativeTarget{width:100%;height:180px} '
    document.head.append(style)
    const mount=document.createElement('div');document.body.append(mount)
    const root=ReactDOM.createRoot(mount),h=React.createElement
    window.nativeController={active:()=>({id:'native',kind:'text'}),isExpanded:()=>true,openTabs:{subscribe:()=>()=>{}}}
    let toggle
    function App(){
      const [open,setOpen]=React.useState(false);toggle=setOpen
      const collapse=React.useCallback(()=>setOpen(false),[])
      const container=React.useRef(null)
      const presence=useSidebarPresence(open,true,container)
      return h('div',{ref:container,'data-testid':'dock-shell','data-liuli-official-shell':'','data-liuli-rightbar-phase':presence.phase,
        'data-liuli-rightbar-visible':presence.visible?'':undefined,
        onTransitionEnd:e=>{if(e.propertyName==='flex-basis')presence.finish()},
        style:{'--liuli-rightbar-slide':'360px',height:240,width:900,display:'flex'}},
        h('div',{className:classes.officialRightbarHost,'data-liuli-official-rightbar-host':''},h('div',{'data-sidebar-right-panel':'push'},h('button',{id:'native-action',onClick:()=>{window.nativeActionCount=(window.nativeActionCount??0)+1}},'Native action'))),
        h('div',{style:{flex:'1 1 auto',minWidth:0}}),
        h('div',{className:classes.shard,'data-shard-region':'region:details',style:{flex:'0 0 '+(presence.visible?360:0)+'px',height:220}},
          h('div',{className:classes.officialRightbarCard,style:{margin:0}},
            h(SidebarContent,{phase:presence.phase,trackWidth:360,className:classes.officialRightbarContent},
              h('div',{'data-dockkit-host':'dock'},h(OfficialSidebarSeatPane,{nativeTabId:'native',onCollapse:collapse}))))))
    }
    ReactDOM.flushSync(()=>root.render(h(App)))
    const shell=mount.firstElementChild,shard=shell.querySelector('[data-shard-region]')
    const target=shell.querySelector('[data-liuli-official-seat-target]'),panel=shell.querySelector('[data-sidebar-right-panel]')
    const read=target.getBoundingClientRect.bind(target),rects=target.getClientRects.bind(target)
    const reads={entering:0,closing:0,preparing:0}
    const sizes=[]
    const content=shell.querySelector('[data-liuli-sidebar-content]')
    const observer=new ResizeObserver(entries=>{for(const e of entries)sizes.push({phase:shell.dataset.liuliRightbarPhase,node:e.target===shard?'shell':'content',width:e.contentRect.width})})
    observer.observe(shard);observer.observe(content)
    target.getBoundingClientRect=()=>{if(shell.dataset.liuliRightbarPhase in reads)reads[shell.dataset.liuliRightbarPhase]++;return read()}
    target.getClientRects=()=>{if(shell.dataset.liuliRightbarPhase in reads)reads[shell.dataset.liuliRightbarPhase]++;return rects()}
    const wait=ms=>new Promise(r=>setTimeout(r,ms))
    try{
      ReactDOM.flushSync(()=>toggle(true))
      const prepared=shell.dataset.liuliRightbarPhase==='preparing'&&shard.getBoundingClientRect().width<1
      await wait(110)
      const entry={phase:shell.dataset.liuliRightbarPhase,width:shard.getBoundingClientRect().width,contentWidth:read().width,aligned:Math.abs(read().left-panel.getBoundingClientRect().left)<1.5}
      const geometry={target:read().left,panel:panel.getBoundingClientRect().left,cardTranslate:getComputedStyle(shard.firstElementChild).translate,panelTranslate:getComputedStyle(panel).translate,host:panel.parentElement.outerHTML}
      await wait(270)
      const opened=shell.dataset.liuliRightbarPhase==='open'
      await nextFrame();await nextFrame()
      const nativeButton=shell.querySelector('#native-action'),nativeRect=nativeButton.getBoundingClientRect()
      const clickable=document.elementFromPoint(nativeRect.left+nativeRect.width/2,nativeRect.top+nativeRect.height/2)===nativeButton&&!nativeButton.closest('[inert]')
      const contentUnlocked=!content.inert
      ReactDOM.flushSync(()=>toggle(false))
      await wait(100)
      const exit={phase:shell.dataset.liuliRightbarPhase,width:shard.getBoundingClientRect().width,contentWidth:read().width,aligned:Math.abs(read().left-panel.getBoundingClientRect().left)<1.5}
      // Reverse without dropping the column or restarting at an endpoint.
      ReactDOM.flushSync(()=>toggle(true));await wait(360)
      const reversed=shell.dataset.liuliRightbarPhase==='open'&&shard.getBoundingClientRect().width===360
      ReactDOM.flushSync(()=>toggle(false));ReactDOM.flushSync(()=>toggle(true));await wait(90)
      const cancelledWithoutMotion=shell.dataset.liuliRightbarPhase==='open'&&!perf.isLayoutInProgress()
      ReactDOM.flushSync(()=>toggle(false));await wait(370)
      return{prepared,entry,opened,clickable,contentUnlocked,exit,reversed,cancelledWithoutMotion,closed:shell.dataset.liuliRightbarPhase==='closed'&&shard.getBoundingClientRect().width===0,reads,geometry,sizes}
    }finally{observer.disconnect();ReactDOM.flushSync(()=>root.unmount());mount.remove();style.remove();delete window.nativeController}
  })
  assert.equal(result.prepared,true)
  for(const [name,phase] of [['entry','entering'],['exit','closing']]) {
    assert.equal(result[name].phase,phase)
    assert.ok(result[name].width>0&&result[name].width<360,JSON.stringify(result))
    assert.equal(result[name].contentWidth,358,JSON.stringify(result))
    assert.equal(result[name].aligned,true,JSON.stringify(result))
  }
  assert.equal(result.opened,true)
  assert.equal(result.clickable,true,JSON.stringify(result))
  assert.equal(result.contentUnlocked,true)
  assert.equal(result.reversed,true)
  assert.equal(result.cancelledWithoutMotion,true)
  assert.equal(result.closed,true)
  assert.equal(result.reads.entering,0)
  assert.equal(result.reads.closing,0)
  assert.ok(result.reads.preparing>0)
  const movingSizes=result.sizes.filter(e=>e.phase==='entering'||e.phase==='closing')
  assert.ok(movingSizes.filter(e=>e.node==='shell').length>3,JSON.stringify(result.sizes))
  assert.equal(movingSizes.filter(e=>e.node==='content').length,0,JSON.stringify(result.sizes))
})

browserTest('actual theme retains grain and shadows throughout resizing and cancellation', async () => {
  const result = await evaluate(async () => {
    const style = document.createElement('style')
    style.textContent = await fetch('/liuli.css').then(r=>r.text())
    document.head.append(style)
    const dock = document.createElement('div')
    dock.dataset.testid = 'dock-shell'
    const material = document.createElement('div')
    material.style.cssText = 'width:100px;height:60px;background-image:var(--liuli-noise);box-shadow:0 0 4px red;text-shadow:0 0 1px red'
    dock.append(material)
    document.body.append(dock)
    const read = () => {
      const s=getComputedStyle(material)
      return { noise:s.backgroundImage, shadow:s.boxShadow, text:s.textShadow }
    }
    try {
      const before=read()
      perf.beginResizePerf()
      const during=read()
      perf.endResizePerf()
      await nextFrame()
      const after=read()
      return { raster:before.noise.includes('data:image/png'), hasShadow:before.shadow!=='none', unchanged:JSON.stringify(before)===JSON.stringify(during), restored:JSON.stringify(before)===JSON.stringify(after) }
    } finally { dock.remove(); style.remove() }
  })
  assert.deepEqual(result, {raster:true,hasShadow:true,unchanged:true,restored:true})
})

browserTest('sidebar guard leases release once and publish one settled event after overlapping animations', async () => {
  const result = await evaluate(async () => {
    await nextFrame()
    const events=[]
    const listener=()=>events.push(perf.isLayoutInProgress())
    window.addEventListener(perf.LAYOUT_SETTLED_EVENT,listener)
    const a=perf.beginSidebarTransitionPerf(),b=perf.beginSidebarTransitionPerf()
    a();a()
    await nextFrame()
    const overlapping=perf.isLayoutInProgress()&&events.length===0
    const unblocked=!perf.isResizeInProgress()&&!document.querySelector('[data-liuli-resize-shield]')
    b();b()
    await nextFrame();await nextFrame()
    const settled=!perf.isLayoutInProgress()&&!document.body.hasAttribute(perf.SIDEBAR_TRANSITION_ATTR)
    window.removeEventListener(perf.LAYOUT_SETTLED_EVENT,listener)
    return{overlapping,unblocked,settled,events}
  })
  assert.deepEqual(result,{overlapping:true,unblocked:true,settled:true,events:[false]})
})

browserTest('resize fades blur smoothly and restores its exact value after release', async () => {
  const result = await evaluate(async () => {
    const original=document.body.style.cssText
    document.body.style.setProperty('--liuli-material-blur','blur(6px)')
    document.body.style.setProperty('--liuli-material-blur-strong','blur(12px)')
    let styleWrites=0
    const observer=new MutationObserver(es=>{styleWrites+=es.length})
    observer.observe(document.body,{attributes:true,attributeFilter:['style']})
    perf.beginResizePerf()
    await new Promise(r=>setTimeout(r,70))
    const during=document.body.style.getPropertyValue('--liuli-material-blur')
    const radius=Number.parseFloat(/blur\(([^p]+)/.exec(during)?.[1]??'NaN')
    perf.endResizePerf()
    const waiting=perf.isLayoutInProgress()
    await new Promise(r=>setTimeout(r,220));await nextFrame()
    const done=!perf.isLayoutInProgress()&&!document.body.hasAttribute(perf.SIDEBAR_TRANSITION_ATTR)
    const restored=document.body.style.getPropertyValue('--liuli-material-blur')==='blur(6px)'
    observer.disconnect()
    document.body.style.cssText=original
    return{waiting,done,restored,animated:styleWrites>0,intermediate:radius>0&&radius<6}
  })
  assert.deepEqual(result,{waiting:true,done:true,restored:true,animated:true,intermediate:true})
})

browserTest('sidebar restores its blur fade without adding a pointer shield', async () => {
  const result=await evaluate(async()=>{
    const shell=document.createElement('div');shell.dataset.testid='dock-shell'
    shell.style.cssText='--liuli-material-blur:blur(6px);--liuli-material-blur-strong:blur(12px)'
    document.body.append(shell)
    const original=shell.style.cssText
    let writes=0
    const observer=new MutationObserver(records=>{writes+=records.length})
    observer.observe(shell,{attributes:true,attributeFilter:['style']})
    const release=perf.beginSidebarTransitionPerf()
    await new Promise(r=>setTimeout(r,170))
    const noShield=!document.querySelector('[data-liuli-resize-shield]')
    release();await new Promise(r=>setTimeout(r,200));await nextFrame();await nextFrame()
    const unchanged=shell.style.cssText===original
    observer.disconnect();shell.remove()
    return{animated:writes>0,noShield,unchanged}
  })
  assert.deepEqual(result,{animated:true,noShield:true,unchanged:true})
})

browserTest('window drag regions defer geometry during sidebar animation and never realize offscreen message buttons', async () => {
  const result = await evaluate(async () => {
    const {startDesktopDrag}=await import('/desktop-drag.ts')
    const header=document.createElement('div');header.dataset.regionPane='region:conversation-header'
    header.style.cssText='position:fixed;left:0;top:0;width:600px;height:80px'
    const button=document.createElement('button');button.style.cssText='position:absolute;left:120px;top:8px;width:40px;height:24px';header.append(button)
    const offscreen=document.createElement('div');offscreen.style.cssText='position:absolute;top:10000px;content-visibility:auto;contain-intrinsic-size:200px 200px'
    const hidden=document.createElement('button');hidden.textContent='Offscreen message action';offscreen.append(hidden)
    document.body.append(header,offscreen)
    await nextFrame();await nextFrame()
    let headerReads=0,offscreenReads=0
    const headerRect=header.getBoundingClientRect.bind(header),hiddenRect=hidden.getBoundingClientRect.bind(hidden)
    header.getBoundingClientRect=()=>{headerReads++;return headerRect()}
    hidden.getBoundingClientRect=()=>{offscreenReads++;return hiddenRect()}
    const release=perf.beginSidebarTransitionPerf()
    const stop=startDesktopDrag()
    try{
      await new Promise(r=>setTimeout(r,270))
      const paused=headerReads===0
      release()
      await nextFrame();await nextFrame();await nextFrame()
      const spans=[...document.querySelector('[data-liuli-drag-regions]').children].map(el=>({left:parseFloat(el.style.left),right:parseFloat(el.style.left)+parseFloat(el.style.width)}))
      return{paused,resumed:headerReads>0,offscreenReads,buttonProtected:spans.length>0&&spans.every(r=>r.right<=117||r.left>=163)}
    }finally{release();stop();header.remove();offscreen.remove()}
  })
  assert.deepEqual(result,{paused:true,resumed:true,offscreenReads:0,buttonProtected:true})
})
