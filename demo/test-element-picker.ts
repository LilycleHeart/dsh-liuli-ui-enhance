// 元素选择器纯逻辑单元测试（node 直接跑 TS：类型剥离，无构建）。
// 运行：node demo/test-element-picker.ts
import { formatSelection, type PickedElement } from '../src/client/element-picker.ts'
import { parseSelectionText } from '../src/client/element-card.ts'

let pass = 0
let fail = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass += 1; console.log('PASS ' + name) }
  else { fail += 1; failures.push(name + (detail !== '' ? ' :: ' + detail : '')); console.log('FAIL ' + name + (detail !== '' ? ' :: ' + detail : '')) }
}

const full: PickedElement = {
  tag: 'div',
  selector: '#root > div > div.fileRow:nth-of-type(2)',
  attributes: 'type="button"',
  text: 'hello',
  rect: { x: 1126, y: 565, width: 22, height: 23 },
  color: '#E2E2E5',
  background: 'rgba(39, 46, 52, 0.7)',
  font: '16px MiSans, Inter, sans-serif',
}

const text = formatSelection(full)
const lines = text.split('\n')

check('E1 header line', lines[0] === '[selected element] <div>')
check('E2 rect follows header (before long selector)', /^rect: x=1126 y=565 22x23$/.test(lines[1] ?? ''))
check('E3 selector present', lines[2] === `selector: ${full.selector}`)
check('E4 rect contains all four values', text.includes('rect: x=1126 y=565 22x23'))
check('E5 color/background/font preserved', text.includes('color: #E2E2E5') && text.includes('background: rgba(39, 46, 52, 0.7)') && text.includes('font: 16px MiSans, Inter, sans-serif'))

// 新顺序（rect 在 selector 前）必须能被解析端正确还原。
const parsed = parseSelectionText(text)
check('E6 parse round-trip rect', parsed !== null && parsed.rect.x === 1126 && parsed.rect.y === 565 && parsed.rect.width === 22 && parsed.rect.height === 23)
check('E7 parse round-trip selector', parsed !== null && parsed.selector === full.selector)
check('E8 parse round-trip color/background/font', parsed !== null && parsed.color === '#E2E2E5' && parsed.background === 'rgba(39, 46, 52, 0.7)' && parsed.font === full.font)

// 旧顺序（selector 在 rect 前）的历史消息也必须继续可解析。
const legacyText = [
  '[selected element] <div>',
  'selector: #root > div > div.fileRow:nth-of-type(2)',
  'attributes: type="button"',
  'text: hello',
  'rect: x=1126 y=565 22x23',
  'color: #E2E2E5',
  'background: rgba(39, 46, 52, 0.7)',
  'font: 16px MiSans, Inter, sans-serif',
].join('\n')
const legacy = parseSelectionText(legacyText)
check('E9 legacy order parse rect', legacy !== null && legacy.rect.x === 1126 && legacy.rect.width === 22)
check('E10 legacy order parse selector', legacy !== null && legacy.selector === full.selector)

// 可选字段为空时，不应生成空行，但 rect 必须始终存在。
const minimal: PickedElement = { ...full, attributes: '', text: '', color: '', background: '', font: '' }
const minimalText = formatSelection(minimal)
check('E11 minimal format still has rect', minimalText.split('\n')[1] === 'rect: x=1126 y=565 22x23')
check('E12 minimal format omits empty fields', !minimalText.includes('attributes:') && !minimalText.includes('color:') && !minimalText.includes('font:'))

if (fail > 0) {
  console.log('\n' + failures.length + ' failure(s):')
  for (const f of failures) console.log(' - ' + f)
  process.exitCode = 1
} else {
  console.log(`\n${pass} passed, 0 failed`)
}
