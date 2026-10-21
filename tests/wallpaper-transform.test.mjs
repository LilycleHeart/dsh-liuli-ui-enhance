import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIULI_SETTINGS_DEFAULTS, normalizeBgRotate } from '../src/liuli-settings.ts'

test('wallpaper rotation snaps to quarter turns and wraps negatives', () => {
  assert.equal(normalizeBgRotate(0), 0)
  assert.equal(normalizeBgRotate(90), 90)
  assert.equal(normalizeBgRotate(180), 180)
  assert.equal(normalizeBgRotate(270), 270)
  assert.equal(normalizeBgRotate(360), 0)
  assert.equal(normalizeBgRotate(450), 90)
  assert.equal(normalizeBgRotate(-90), 270)
  // Anything past a quarter turn away from a multiple of 90 snaps to the nearest one.
  assert.equal(normalizeBgRotate(44), 0)
  assert.equal(normalizeBgRotate(46), 90)
  assert.equal(normalizeBgRotate(undefined), 0)
  assert.equal(normalizeBgRotate(Number.NaN), 0)
  assert.equal(normalizeBgRotate(Number.POSITIVE_INFINITY), 0)
})

test('wallpaper flip and rotation default to an untouched image', () => {
  assert.equal(LIULI_SETTINGS_DEFAULTS.bg_flip_x, false)
  assert.equal(LIULI_SETTINGS_DEFAULTS.bg_rotate, 0)
})
