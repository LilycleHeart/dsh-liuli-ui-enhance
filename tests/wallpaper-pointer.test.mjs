import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imageToPointer, pointerToImage } from '../src/client/wallpaper-pointer.ts'

const view = (rotate, flipX = false, scale = 1) => ({ width: 640, height: 360, rotate, flipX, scale })
const close = (a, b) => Math.abs(a - b) < 1e-9

test('without a draft the pointer maps one to one', () => {
  const point = { x: 0.23, y: 0.71 }
  const mapped = pointerToImage(point, view(0))
  assert.ok(close(mapped.x, point.x) && close(mapped.y, point.y))
})

test('pointer mapping is the exact inverse of the image transform', () => {
  const cases = [
    view(0), view(90), view(180), view(270),
    view(90, true), view(270, true), view(0, true),
    view(90, false, 0.5), view(270, true, 0.5),
  ]
  const point = { x: 0.31, y: 0.82 }
  for (const transform of cases) {
    const visual = imageToPointer(point, transform)
    const back = pointerToImage(visual, transform)
    assert.ok(close(back.x, point.x) && close(back.y, point.y), JSON.stringify({ transform, back }))
  }
})

test('a quarter turn maps the image axes onto the visual axes', () => {
  // Centre-right of the image (x > 0.5) must land on the visual bottom after a 90° turn.
  const imagePoint = { x: 0.75, y: 0.5 }
  const visual = imageToPointer(imagePoint, view(90))
  assert.ok(close(visual.x, 0.5))
  assert.ok(visual.y > 0.5)
  // Bottom-centre of the visual frame maps back to image centre-right.
  const back = pointerToImage({ x: 0.5, y: 0.9 }, view(90))
  assert.ok(close(back.y, 0.5))
  assert.ok(back.x > 0.5)
})
