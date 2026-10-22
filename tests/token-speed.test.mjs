import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateTokens, formatSpeed, partialChars, TokenSpeedMeter, MIN_SPAN_MS, SPEED_WINDOW_MS,
} from '../src/client/token-speed.ts'

const blocks = (...items) => items

test('partialChars counts only the segments that grow while streaming', () => {
  const chars = partialChars(blocks(
    { kind: 'reasoning', text: 'abcd' },
    { kind: 'text', text: 'ef' },
    { kind: 'tool-call', name: 'read', argsRaw: '{"path":"x"}' },
    { kind: 'image', attachment: {} },
  ))
  assert.equal(chars, 4 + 2 + 'read'.length + '{"path":"x"}'.length)
})

test('estimateTokens follows the host fixed density heuristic', () => {
  assert.equal(estimateTokens(0), 0)
  assert.equal(estimateTokens(1), 1)
  assert.equal(estimateTokens(4), 1)
  assert.equal(estimateTokens(5), 2)
  assert.equal(estimateTokens(400), 100)
})

test('formatSpeed matches the shipped pill precision habit', () => {
  assert.equal(formatSpeed(0), '0')
  assert.equal(formatSpeed(3.44), '3.4')
  assert.equal(formatSpeed(9.96), '10.0')
  assert.equal(formatSpeed(10), '10')
  assert.equal(formatSpeed(128.4), '128')
  assert.equal(formatSpeed(-5), '0')
  assert.equal(formatSpeed(Number.NaN), '0')
})

test('a meter with one sample has no reading yet', () => {
  const meter = new TokenSpeedMeter()
  assert.equal(meter.push(1000, 10), true)
  assert.equal(meter.speed(1000), undefined)
  assert.equal(meter.lastSpeed, undefined)
})

test('two samples closer than MIN_SPAN_MS still withhold a reading', () => {
  const meter = new TokenSpeedMeter()
  meter.push(0, 0)
  meter.push(MIN_SPAN_MS - 50, 40)
  assert.equal(meter.speed(MIN_SPAN_MS - 50), undefined)
})

test('speed is the window difference, not the last frame delta', () => {
  const meter = new TokenSpeedMeter()
  // 1s 内累计 300 token → 窗口差分 300 tok/s；
  // 若只看最后一帧（500ms 内 200 token）会读成 400 tok/s，那是锯齿值。
  meter.push(0, 0)
  meter.push(500, 100)
  meter.push(1000, 300)
  assert.equal(meter.speed(1000), 300)
  assert.equal(meter.lastSpeed, 300)
})

test('repeated samples of an unchanged count are ignored', () => {
  const meter = new TokenSpeedMeter()
  assert.equal(meter.push(0, 10), true)
  assert.equal(meter.push(16, 10), false)
  assert.equal(meter.push(32, 10), false)
  // 同一时刻的重复采样也不入窗
  assert.equal(meter.push(0, 10), false)
})

test('a token count that goes backwards starts a fresh window', () => {
  const meter = new TokenSpeedMeter()
  meter.push(0, 0)
  meter.push(1000, 500)
  assert.equal(meter.speed(1000), 500)
  // 新的一步从头累积：旧样本必须丢弃，否则会出现负增量
  meter.push(1100, 5)
  assert.equal(meter.speed(1100), undefined)
})

test('the window slides, so a stalled stream loses its reading', () => {
  const meter = new TokenSpeedMeter()
  meter.push(0, 0)
  meter.push(1000, 300)
  assert.equal(meter.speed(1000), 300)
  // 停顿超过窗口长度后，旧采样被剪掉，读数消失而不是一直停在旧值
  assert.equal(meter.speed(1000 + SPEED_WINDOW_MS + 1), undefined)
  assert.equal(meter.lastSpeed, 300)
})

test('reset drops both the window and the remembered value', () => {
  const meter = new TokenSpeedMeter()
  meter.push(0, 0)
  meter.push(1000, 200)
  meter.speed(1000)
  meter.reset()
  assert.equal(meter.lastSpeed, undefined)
  assert.equal(meter.speed(1000), undefined)
})

test('sample retention is bounded on a long stream', () => {
  const meter = new TokenSpeedMeter()
  for (let i = 0; i < 500; i += 1) meter.push(i * 16, i * 4)
  const speed = meter.speed(499 * 16)
  assert.ok(typeof speed === 'number' && speed > 0)
  // 窗口只保留最近 2s，速度应接近每帧 4 token / 16ms ≈ 250 tok/s
  assert.ok(Math.abs(speed - 250) < 20, String(speed))
})
