// Run: node --test tests/chat-process-visibility.test.mjs
// Verify the full theme cascade, including dynamic scroll-fade classes.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'

const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

test('theme preserves hidden process groups and nested disclosure layout', { skip: !existsSync(chromePath) }, async () => {
  const { liuliCss } = await import('../src/client/liuli-css.ts')
  const mirror = await readFile(new URL('../src/client/liuli.css', import.meta.url), 'utf8')
  // Exercise the full stylesheet. Extracting only the performance rule missed
  // the global _fade rule that hid ChatGroupSeat's overflow-fade body.
  const rules = [liuliCss, mirror].map(source => source.replace(/@import[^;]+;/g, ''))
  const folder = await mkdtemp(join(tmpdir(), 'liuli-process-visibility-'))
  try {
    const file = join(folder, 'check.html')
    await writeFile(file, `<!doctype html><meta charset="utf-8">
<style id="theme"></style>
<div class="test_sidebarCol"><span id="sidebar-fade" class="test_fade">Workspace decoration</span></div>
<span id="other-fade" class="test_fade">Unrelated fade</span>
<div data-chat-flow>
  <div id="message">Ordinary transcript message</div>
  <div id="hidden-message" hidden="until-found">Folded turn member</div>
  <div id="group" data-step-process data-chat-group-key="turn-1" hidden="until-found">
    <button id="toggle" aria-expanded="false">已读取文件，已搜索代码，向用户提出了问题</button>
    <div id="body" data-step-process-body hidden="until-found" style="max-height:100px;overflow-y:auto">
      <div data-step-process-content data-chat-flow>
        <div id="nested" style="height:800px">Tool output and reasoning</div>
      </div>
    </div>
  </div>
</div>
<pre id="result"></pre>
<script>
const rules = ${JSON.stringify(rules)};
const result = [];
const fades = [];
const cv = element => getComputedStyle(element).contentVisibility;
const intrinsic = element => getComputedStyle(element).containIntrinsicSize;
for (const css of rules) {
  theme.textContent = css;
  group.setAttribute('hidden', 'until-found');
  body.setAttribute('hidden', 'until-found');
  result.push({
    message: cv(message), hiddenMessage: cv(document.getElementById('hidden-message')),
    group: cv(group), body: cv(body), nested: cv(nested),
    groupIntrinsic: intrinsic(group), nestedIntrinsic: intrinsic(nested)
  });
  // The upstream turn control reveals the outer group; its local disclosure
  // then alternates the body's hidden attribute without changing its parent.
  group.removeAttribute('hidden');
  toggle.onclick = () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    if (open) body.removeAttribute('hidden');
    else body.setAttribute('hidden', 'until-found');
  };
  for (let i = 0; i < 4; i++) {
    toggle.click();
    result.push({group: cv(group), body: cv(body), open: toggle.getAttribute('aria-expanded')});
  }
  body.removeAttribute('hidden');
  const states = ['test_body', 'test_body test_fadeBottom', 'test_body test_fadeTop', 'test_body test_fadeTop test_fadeBottom'];
  fades.push({
    sidebar: getComputedStyle(document.getElementById('sidebar-fade')).display,
    unrelated: getComputedStyle(document.getElementById('other-fade')).display,
    body: states.map(classes => {
      body.className = classes;
      return {display: getComputedStyle(body).display, height: body.getBoundingClientRect().height};
    })
  });
}
document.getElementById('result').textContent = JSON.stringify({visibility:result, fades});
</script>`)
    const run = spawnSync(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
      `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href],
    { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })
    assert.equal(run.status, 0, run.error?.message ?? run.stderr)
    const output = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)
    assert.ok(output, 'the browser completed its cascade checks')
    const { visibility: results, fades } = JSON.parse(output[1])
    for (let offset = 0; offset < results.length; offset += 5) {
      assert.deepEqual(results[offset], {
        message: 'auto', hiddenMessage: 'hidden', group: 'hidden', body: 'hidden', nested: 'visible',
        groupIntrinsic: 'none', nestedIntrinsic: 'none',
      })
      for (let i = 1; i <= 4; i++) assert.deepEqual(results[offset + i], {
        group: 'visible', body: i % 2 ? 'visible' : 'hidden', open: i % 2 ? 'true' : 'false',
      })
    }
    assert.equal(fades[0].sidebar, 'none', 'the intended left-workspace decoration stays hidden')
    for (const checks of fades) {
      assert.equal(checks.unrelated, 'inline', 'unrelated fade elements remain visible')
      assert.deepEqual(checks.body, Array(4).fill({ display: 'block', height: 100 }),
        'overflow fade classes must never hide or collapse a process body')
    }
  } finally {
    assert.equal(dirname(folder), tmpdir(), 'cleanup stays inside the temporary test directory')
    await rm(folder, { recursive: true, force: true })
  }
})
