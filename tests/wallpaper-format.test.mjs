import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { animatedWallpaperMime, preservedWallpaperMime } from '../src/client/wallpaper-format.ts'
import { compressImage } from '../src/client/liuli-runtime.ts'

const ascii = value => Buffer.from(value, 'ascii')
const webp = (...chunks) => Buffer.concat([ascii('RIFF'), Buffer.alloc(4), ascii('WEBP'), ...chunks])
const chunk = (name, data = Buffer.alloc(0)) => {
  const length = Buffer.alloc(4)
  length.writeUInt32LE(data.length)
  return Buffer.concat([ascii(name), length, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)])
}

test('GIF, APNG and animated WebP retain their original MIME', () => {
  assert.equal(preservedWallpaperMime(ascii('GIF89a')), 'image/gif')
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const pngChunkLength = Buffer.alloc(4)
  const apng = Buffer.concat([pngSignature, pngChunkLength, ascii('acTL'), Buffer.alloc(4)])
  assert.equal(preservedWallpaperMime(apng), 'image/png')
  assert.equal(animatedWallpaperMime(webp(chunk('VP8X', Buffer.alloc(10)), chunk('ANIM'))), 'image/webp')
})

test('WebP remains WebP even if the chunk scanner cannot identify animation', () => {
  assert.equal(preservedWallpaperMime(webp(chunk('VP8X', Buffer.alloc(10)))), 'image/webp')
  assert.equal(preservedWallpaperMime(webp(chunk('VP8 ', Buffer.alloc(4)))), 'image/webp')
  assert.equal(preservedWallpaperMime(Buffer.from([0xff, 0xd8, 0xff, 0xd9])), undefined)
})

test('WebP upload retains the original bytes rather than a canvas frame', async t => {
  const originalReader = globalThis.FileReader
  const originalImage = globalThis.Image
  globalThis.FileReader = class {
    readAsDataURL(file) {
      void file.arrayBuffer().then(bytes => {
        this.result = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`
        this.onload?.()
      })
    }
  }
  globalThis.Image = class {
    set src(_) { queueMicrotask(() => this.onload?.()) }
  }
  t.after(() => {
    globalThis.FileReader = originalReader
    globalThis.Image = originalImage
  })
  const source = webp(chunk('VP8X', Buffer.alloc(10)), chunk('ANIM'))
  const encoded = await compressImage(new File([source], 'wallpaper.webp', { type: 'image/webp' }))
  assert.equal(encoded, `data:image/webp;base64,${source.toString('base64')}`)
})
