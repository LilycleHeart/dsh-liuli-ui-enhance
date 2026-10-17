import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fontFamilies, fontFamilyList, fontStack, moveFont } from '../src/client/font-priority.ts'

test('font order survives normalization and duplicate names keep their first priority', () => {
  assert.deepEqual(fontFamilies('"MiSans", Arial, misans, "Microsoft YaHei", serif'), ['MiSans','Arial','Microsoft YaHei','serif'])
  assert.equal(fontFamilyList(['MiSans','Arial','Microsoft YaHei','serif']), '"MiSans", "Arial", "Microsoft YaHei", serif')
})

test('moving a font changes only its priority and leaves the original list unchanged', () => {
  const original=['Arial','MiSans','Consolas']
  assert.deepEqual(moveFont(original,2,-1),['Arial','Consolas','MiSans'])
  assert.deepEqual(moveFont(original,0,1),['MiSans','Arial','Consolas'])
  assert.deepEqual(moveFont(original,0,-1),original)
  assert.deepEqual(original,['Arial','MiSans','Consolas'])
})

test('custom text and code fonts precede their own defaults with a final generic fallback', () => {
  assert.match(fontStack('Missing Font, Arial','text'), /^"Missing Font", "Arial", "MiSans", "Inter"/)
  assert.match(fontStack('Consolas','code'), /^"Consolas", "JetBrains Mono"/)
  assert.match(fontStack('','text','builtin'), /^"Inter", "Segoe UI"/)
  assert.ok(fontStack('','text').endsWith('sans-serif'))
  assert.ok(fontStack('','code').endsWith('monospace'))
})

test('font names are serialized as names rather than executable CSS', () => {
  assert.equal(fontFamilyList(['Arial; color:red','<MiSans>','"Inter"','system-ui']), '"Arial; color:red", "MiSans", "Inter", system-ui')
  const normalized=fontFamilyList(['MiSans','Inter','sans-serif'])
  assert.equal(fontFamilyList(fontFamilies(normalized)),normalized)
})
