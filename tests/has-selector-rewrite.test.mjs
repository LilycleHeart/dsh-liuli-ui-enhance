// :has() 类名子串改写的纯函数单测。
// Run: node --test tests/has-selector-rewrite.test.mjs
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after, before, test } from 'node:test'
import { transpileModule, ScriptTarget, ModuleKind } from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let dir, mod, perf

const load = async (name, rewriteImports = s => s) => {
  const src = await readFile(join(root, 'src/client', name), 'utf8')
  const out = transpileModule(rewriteImports(src), { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext } }).outputText
  const file = join(dir, name.replace(/\.ts$/, '.mjs'))
  await writeFile(file, out)
  return import(pathToFileURL(file).href)
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'liuli-has-'))
  mod = await load('has-selector-rewrite.ts')
  perf = await load('has-selector-perf.ts', s => s.replace("'./has-selector-rewrite.ts'", "'./has-selector-rewrite.mjs'"))
})
after(async () => { await rm(dir, { recursive: true, force: true }) })

test('只改写 :has() 参数内的类名子串，外部保持原样', () => {
  const css = '[class*="_menu"]:has([class*="_node"], [class$=\'_metrics\']) [class*="_row"] { color: red }'
  const out = mod.rewriteHasClassSubstrings(css, ['rezYhW_node', 'rezYhW_metrics', 'x_row', 'a_menu'])
  assert.equal(out, '[class*="_menu"]:has(:is(.rezYhW_node), :is(.rezYhW_metrics)) [class*="_row"] { color: red }')
})

test('匹配多个类名时按字典序展开；无命中用占位类', () => {
  const out = mod.rewriteHasClassSubstrings('.a:has(> svg[class*="_word"]){}', ['b_word_1', 'a_wordmark', 'zzz'])
  assert.equal(out, '.a:has(> svg:is(.a_wordmark,.b_word_1)){}')
  const none = mod.rewriteHasClassSubstrings('.a:has([class^=nope]){}', ['zzz'])
  assert.equal(none, `.a:has(:is(.${mod.VOID_CLASS})){}`)
})

test('嵌套 :has 与引号内括号不打乱区间', () => {
  const css = '[class$="_slot"]:has(> nav:has([class*="_mark"])) { content: ")" }'
  const out = mod.rewriteHasClassSubstrings(css, ['DBgHeW_mark'])
  assert.equal(out, '[class$="_slot"]:has(> nav:has(:is(.DBgHeW_mark))) { content: ")" }')
  assert.deepEqual(mod.collectHasClassPatterns(css), [{ op: '*', value: '_mark' }])
})

test('非字母开头类名被转义', () => {
  const out = mod.rewriteHasClassSubstrings('.a:has([class*="_x"]){}', ['-hpfpa_x', '_6qcDqa_x'])
  assert.match(out, /\.-hpfpa_x/)
  assert.match(out, /\._6qcDqa_x/)
})

test('根节点 :has 换成属性标记，兄弟关系保持原样', () => {
  const flags = new Map()
  const css = 'body:has(.dim-jh-page) .x{} body[data-a]:has(> [class*="_o"] > .p) > .q{} .r:has(+ .s){} html:has(~ .t){}'
  const out = perf.rewriteRootHas(css, flags)
  assert.equal(out, 'body[data-liuli-has-0] .x{} body[data-a][data-liuli-has-1] > .q{} .r:has(+ .s){} html:has(~ .t){}')
  assert.deepEqual([...flags.values()].map(f => [f.attr, f.anchor, f.arg]), [
    ['data-liuli-has-0', 'body', '.dim-jh-page'],
    ['data-liuli-has-1', 'body', '> [class*="_o"] > .p'],
  ])
  // 同一参数复用同一标记
  assert.equal(perf.rewriteRootHas('body:has(.dim-jh-page) .y{}', flags), 'body[data-liuli-has-0] .y{}')
})

test('非根 :has 不受根改写影响', () => {
  const flags = new Map()
  const css = '[data-shell] [data-pane]:has(header[aria-hidden]) {}'
  assert.equal(perf.rewriteRootHas(css, flags), css)
  assert.equal(flags.size, 0)
})
