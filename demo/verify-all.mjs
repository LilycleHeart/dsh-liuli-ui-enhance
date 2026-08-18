// One-shot post-restart verification: host routes revival + engine A-suite + GUI B-suite.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
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


const run = (script) => new Promise((resolve) => {
  const child = spawn(process.execPath, [join(here, script)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => { out += d })
  child.on('exit', (code) => resolve({ code, out }))
  setTimeout(() => { try { child.kill() } catch { /* ignore */ } }, 300000)
})

const summary = (out) => {
  const lines = out.split(/\r?\n/)
  const passes = lines.filter(l => l.startsWith('PASS')).length
  const fails = lines.filter(l => l.startsWith('FAIL'))
  const sum = lines.find(l => l.includes('SUMMARY')) ?? ''
  return { passes, fails, sum }
}

console.log('=== 0. host routes revival (new lib loaded?) ===')
const probes = []
const probe = async (name, url, expect) => {
  try {
    const resp = await fetch(url, { headers: { accept: 'application/json' } })
    const ct = resp.headers.get('content-type') ?? ''
    const isJson = ct.includes('application/json')
    const ok = expect === 'json' ? isJson : !isJson
    probes.push({ name, ok, detail: 'HTTP ' + resp.status + ' ' + ct.slice(0, 40) })
  } catch (e) {
    probes.push({ name, ok: false, detail: e.message })
  }
}
await probe('capabilities JSON', BASE + '/liuli-browser/capabilities', 'json')
await probe('liuli-sidebar JSON (route alive)', BASE + '/liuli-sidebar/tree?sessionId=__none__', 'json')
await probe('liuli-quota JSON (route alive)', BASE + '/liuli-quota?provider=unknown', 'json')
const proxyResp = await fetch(BASE + '/liuli-proxy?url=' + encodeURIComponent('http://127.0.0.1:7336/liuli-quota?provider=x'), { headers: { accept: '*/*' } })
const proxyCt = proxyResp.headers.get('content-type') ?? ''
probes.push({ name: 'liuli-proxy responds (not SPA html)', ok: !proxyCt.includes('text/html') || (await proxyResp.clone().text()).includes('"'), detail: 'HTTP ' + proxyResp.status + ' ' + proxyCt.slice(0, 40) })
for (const p of probes) console.log((p.ok ? 'PASS' : 'FAIL') + ' ' + p.name + ' :: ' + p.detail)

const capsOk = probes[0]?.ok === true
if (!capsOk) {
  console.log('\nENGINE NOT LIVE — host still serving old lib (app not restarted?).')
  process.exit(2)
}

console.log('\n=== 1. engine A-suite (verify-webview.mjs) ===')
const a = await run('verify-webview.mjs')
const as = summary(a.out)
console.log(a.out.trim())

console.log('\n=== 2. GUI B-suite (verify-webview-gui.mjs) ===')
const b = await run('verify-webview-gui.mjs')
const bs = summary(b.out)
console.log(b.out.trim())

console.log('\n=== TOTAL ===')
console.log('routes: ' + probes.filter(p => p.ok).length + '/' + probes.length
  + ' | A-suite: ' + as.sum.trim()
  + ' | B-suite: ' + bs.sum.trim())
const allFail = [...as.fails, ...bs.fails]
if (allFail.length > 0) {
  console.log('FAILURES:')
  for (const f of allFail) console.log('  ' + f)
  process.exit(1)
}
console.log('ALL GREEN')
