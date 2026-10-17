import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { collectToolCommits } from '../src/client/tool-commits.ts'

const hashes = block => {
  const result = []
  collectToolCommits(block, result)
  return [...new Set(result)]
}

test('preparing calls do not require completed argument text', () => {
  assert.deepEqual(hashes({ phase: 'preparing', name: 'shell', subCalls: [] }), [])
})

test('started calls retain commit references from completed arguments', () => {
  assert.deepEqual(hashes({
    phase: 'start', name: 'git', argsRaw: '{"command":"commit","sha":"ABCDEF1"}', subCalls: [],
  }), ['abcdef1'])
})

test('settled shell calls use the paired call arguments to identify commit output', () => {
  assert.deepEqual(hashes({
    kind: 'tool-result', name: 'shell', call: { name: 'shell', argsRaw: 'git commit -m change' },
    content: [{ type: 'text', text: '[main abcdef1] change' }], subCalls: [],
  }), ['abcdef1'])
})

test('truncated call heads and nested calls remain readable', () => {
  assert.deepEqual(hashes({
    kind: 'tool-result', name: '', call: null, content: [],
    subCalls: [{
      kind: 'tool-result', name: '', call: null,
      content: [{ type: 'text', text: 'commit 1234567' }], subCalls: [],
    }],
  }), ['1234567'])
})
