// 静态服务器：/demo/* → 本目录，/music/* → C:\CloudMusic，/dl/* → 用户下载目录
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 8124
const MUSIC_ROOT = 'C:\\CloudMusic'
const DL_ROOT = 'C:\\Users\\27280\\Downloads'
const DEMO_DIR = fileURLToPath(new URL('.', import.meta.url))

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.png': 'image/png',
  '.json': 'application/json',
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x')
    let p = decodeURIComponent(url.pathname)
    let file
    if (p.startsWith('/music/')) file = join(MUSIC_ROOT, p.slice('/music/'.length))
    else if (p.startsWith('/dl/')) file = join(DL_ROOT, p.slice('/dl/'.length))
    else if (p.startsWith('/demo/')) file = join(DEMO_DIR, p.slice('/demo/'.length))
    else { res.writeHead(404); res.end('not found'); return }
    const data = await readFile(file)
    const type = types[extname(file).toLowerCase()] || 'application/octet-stream'
    const range = req.headers.range
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      const start = m && m[1] !== '' ? Number(m[1]) : 0
      const end = m && m[2] !== '' ? Number(m[2]) : data.length - 1
      if (start > end || start >= data.length) { res.writeHead(416); res.end(); return }
      res.writeHead(206, {
        'content-type': type,
        'content-range': `bytes ${start}-${end}/${data.length}`,
        'accept-ranges': 'bytes',
        'content-length': end - start + 1,
        'cache-control': 'no-store',
      })
      res.end(data.subarray(start, end + 1))
    } else {
      res.writeHead(200, {
        'content-type': type,
        'content-length': data.length,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      })
      res.end(data)
    }
  } catch (e) {
    res.writeHead(404)
    res.end('not found: ' + e.message)
  }
}).listen(PORT, '127.0.0.1', () => console.log(`demo server http://127.0.0.1:${PORT}`))
