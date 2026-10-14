// Run: node --test tests/chat-process-visibility.test.mjs
// Verify the browser cascade: hidden="until-found" must keep its native
// content-visibility:hidden rather than exposing a folded upstream process group.
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
  const sources = await Promise.all(['liuli-css.ts', 'liuli.css'].map(name =>
    readFile(new URL(`../src/client/${name}`, import.meta.url), 'utf8')))
  const rules = sources.map(source => {
    const match = source.match(/@supports \(content-visibility: auto\) \{\s*\[data-chat-flow\][\s\S]*?\n\}/)
    assert.ok(match, 'each theme source contains the transcript performance rule')
    return match[0]
  })
  const folder = await mkdtemp(join(tmpdir(), 'liuli-process-visibility-'))
  try {
    const file = join(folder, 'check.html')
    await writeFile(file, `<!doctype html><meta charset="utf-8">
<style id="theme"></style>
<div data-chat-flow>
  <div id="message">Ordinary transcript message</div>
  <div id="hidden-message" hidden="until-found">Folded turn member</div>
  <div id="group" data-step-process data-chat-group-key="turn-1" hidden="until-found">
    <button id="toggle" aria-expanded="false">已读取文件，已搜索代码，向用户提出了问题</button>
    <div id="body" data-step-process-body hidden="until-found">
      <div data-step-process-content data-chat-flow>
        <div id="nested">Tool output and reasoning</div>
      </div>
    </div>
  </div>
</div>
<pre id="result"></pre>
<script>
const rules = ${JSON.stringify(rules)};
const result = [];
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
}
document.getElementById('result').textContent = JSON.stringify(result);
</script>`)
    const run = spawnSync(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-proxy-server',
      `--user-data-dir=${join(folder, 'profile')}`, '--dump-dom', pathToFileURL(file).href],
    { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })
    assert.equal(run.status, 0, run.error?.message ?? run.stderr)
    const output = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)
    assert.ok(output, 'the browser completed its cascade checks')
    const results = JSON.parse(output[1])
    for (let offset = 0; offset < results.length; offset += 5) {
      assert.deepEqual(results[offset], {
        message: 'auto', hiddenMessage: 'hidden', group: 'hidden', body: 'hidden', nested: 'visible',
        groupIntrinsic: 'none', nestedIntrinsic: 'none',
      })
      for (let i = 1; i <= 4; i++) assert.deepEqual(results[offset + i], {
        group: 'visible', body: i % 2 ? 'visible' : 'hidden', open: i % 2 ? 'true' : 'false',
      })
    }
  } finally {
    assert.equal(dirname(folder), tmpdir(), 'cleanup stays inside the temporary test directory')
    await rm(folder, { recursive: true, force: true })
  }
})
