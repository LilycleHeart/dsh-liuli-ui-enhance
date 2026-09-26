/** Inspect container chunks, not file extensions, before deciding to flatten an image. */
export function animatedWallpaperMime(bytes: Uint8Array): string | undefined {
  const text = (at: number, size: number) => String.fromCharCode(...bytes.subarray(at, at + size))
  if (text(0, 6) === 'GIF87a' || text(0, 6) === 'GIF89a') return 'image/gif'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes[0] === 137 && text(1, 3) === 'PNG') {
    for (let at = 8; at + 12 <= bytes.length;) {
      const size = view.getUint32(at)
      if (at + size + 12 > bytes.length) break
      if (text(at + 4, 4) === 'acTL') return 'image/png'
      at += size + 12
    }
  }
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    for (let at = 12; at + 8 <= bytes.length;) {
      const size = view.getUint32(at + 4, true)
      if (at + size + 8 > bytes.length) break
      if (['ANIM', 'ANMF'].includes(text(at, 4))) return 'image/webp'
      at += 8 + size + size % 2
    }
  }
  return undefined
}
