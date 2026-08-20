// Real-Electron integration test for the Desktop system-audio fix.
// Reuses the exact node-half logic (compiled src/host-audio.ts) in a real
// Electron main process, then loads a sandboxed renderer that calls
// getDisplayMedia({ video:false, audio:true }) exactly like HeaderEffects.tsx.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'
const MARK = 'C:/Users/27280/AppData/Local/Temp/liuli-app-marker.txt'
const log = (s) => { try { writeFileSync(MARK, s + '\n', { flag: 'a' }) } catch { } console.log(s) }
log('main entry, argv=' + process.argv.join(' | '))
const noHandler = process.argv.includes('--no-handler')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.whenReady().then(async () => {
  try {
    log('app ready')
    if (!noHandler) {
      // 与插件 node 半同一份编译产物:安装 setDisplayMediaRequestHandler(audio:'loopback')
      const { installSystemAudioCapture } = await import(new URL('../../demo/.tmp-host-audio.mjs', import.meta.url).href)
      await installSystemAudioCapture()
      log('display-media handler installed (loopback)')
    } else {
      log('--no-handler mode: default Electron behavior')
    }
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        // 镜像 DSH Desktop 的窗口 webPreferences
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    await win.loadFile(fileURLToPath(new URL('index.html', import.meta.url)))
    log('page loaded')
  } catch (err) {
    log('MAIN ERROR: ' + (err && err.stack ? err.stack : String(err)))
  }
})