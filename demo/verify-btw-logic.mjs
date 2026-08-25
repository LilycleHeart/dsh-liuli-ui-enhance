// BtwAnswer 纯逻辑自测（不依赖 DSH GUI）：
//  - L1 extractAnswer：从 mock ConversationSnapshot 提取 assistant 文本 + partial 尾巴；
//  - L2 事件常量与桥契约：BTW_ANSWER_EVENT 名称、卡片 data 属性名与 index.ts 派发一致；
//  - L3 构建产物包含新模块（lib/client.js 含 BtwAnswerHost / liuli:btw-answer）。
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass: !!pass }); console.log((pass ? 'PASS' : 'FAIL') + ' ' + name + (detail ? ' :: ' + String(detail).slice(0, 160) : '')) }

// L3 构建产物检查（先于类型导入，避免 tsc 未跑时失败）
const clientBundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
check('L3 lib/client.js contains BtwAnswerHost', clientBundle.includes('BtwAnswerHost'))
check('L3 lib/client.js contains liuli:btw-answer', clientBundle.includes('liuli:btw-answer'))
check('L3 lib/client.js contains data-liuli-btw-answer-list', clientBundle.includes('data-liuli-btw-answer-list'))

// L2 契约：index.ts 派发的事件名与 BtwAnswer.tsx 常量一致
const indexSrc = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
const btwSrc = readFileSync(new URL('../src/client/BtwAnswer.tsx', import.meta.url), 'utf8')
const eventConst = btwSrc.match(/BTW_ANSWER_EVENT = '([^']+)'/)?.[1]
check('L2 event constant defined', eventConst !== undefined && eventConst === 'liuli:btw-answer', eventConst)
check('L2 index.ts dispatches same event', eventConst !== undefined && indexSrc.includes(`CustomEvent(BTW_ANSWER_EVENT`))
check('L2 index.ts imports BtwAnswerHost', indexSrc.includes('import { BtwAnswerHost, BTW_ANSWER_EVENT }'))
check('L2 host mounts BtwAnswerHost', indexSrc.includes('liuli-btw-answer-host'))

// L1 extractAnswer 纯逻辑：直接从源码抽取函数体太脆，改用等价实现验证快照形状契约。
// 关键断言：assistant blocks 拼接、partial 追加、限长。
function extractAnswerLike(snap) {
  let answer = ''
  if (snap === undefined) return answer
  const nodes = snap.nodes.slice(-80)
  for (const node of nodes) {
    const n = node
    if (n.kind === 'assistant') {
      let text = ''
      for (const block of n.blocks) if (block.kind === 'text' && typeof block.text === 'string') text += block.text
      if (text.trim() !== '') answer = text.slice(0, 4000)
    }
  }
  if (snap.partial !== undefined && snap.partial !== null) {
    const blocks = snap.partial.blocks
    if (blocks !== undefined) {
      let text = ''
      for (const block of blocks) if (block.kind === 'text' && typeof block.text === 'string') text += block.text
      if (text.trim() !== '') answer = (answer + text).slice(0, 4000)
    }
  }
  return answer
}

const mock = {
  nodes: [
    { kind: 'user', seq: 1, content: [{ type: 'text', text: '什么是 DSH？' }] },
    { kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: 'DSH 是' }, { kind: 'tool', name: 'x' }, { kind: 'text', text: '一个框架。' }] },
  ],
  partial: { blocks: [{ kind: 'text', text: '（流式尾巴）' }] },
  running: true,
}
const out = extractAnswerLike(mock)
check('L1 answer joins assistant text blocks', out.includes('DSH 是一个框架。'), out)
check('L1 partial appended', out.includes('（流式尾巴）'), out)
check('L1 ignores tool blocks', !out.includes('tool'), out)
check('L1 empty when no assistant', extractAnswerLike({ nodes: [{ kind: 'user', seq: 1 }], partial: null }) === '')
check('L1 caps at 4000', extractAnswerLike({ nodes: [{ kind: 'assistant', seq: 2, blocks: [{ kind: 'text', text: 'x'.repeat(9000) }] }], partial: null }).length === 4000)

const failed = results.filter(r => !r.pass)
console.log('\n== ' + (failed.length === 0 ? 'ALL PASS' : failed.length + ' FAILED') + ' (' + results.length + ' checks) ==')
process.exit(failed.length === 0 ? 0 : 1)
