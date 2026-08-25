// auto-drive-browser 纯逻辑单元测试（node 直接跑 TS：类型剥离，无构建）。
// 运行：node demo/test-auto-drive.ts
// 覆盖：dev server 输出解析（Vite/Next/CRA/webpack/serve/http.server/php）、
//       摘要关键词判定、前端文件识别（含 hasDevServer 放宽的 .js/.ts）、
//       审查驱动请求的目标文件解析（resolveDriveTarget）。
import {
  BASH_OUTPUT_ATTEMPTS, looksLikeDevServerRow, looksLikeFrontendFile, parseDevServerUrl,
} from '../src/client/auto-drive-browser.ts'
import { resolveDriveTarget } from '../src/client/review-drive.ts'

let pass = 0
let fail = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass += 1; console.log('PASS ' + name) }
  else { fail += 1; failures.push(name + (detail !== '' ? ' :: ' + detail : '')); console.log('FAIL ' + name + (detail !== '' ? ' :: ' + detail : '')) }
}

// A1 Vite：Local 优先于 Network
{
  const out = [
    '',
    '  VITE v6.0.0  ready in 300 ms',
    '',
    '  ➜  Local:   http://localhost:5173/',
    '  ➜  Network: http://192.168.1.5:5173/',
    '',
  ].join('\n')
  check('A1 vite Local 优先于 Network', parseDevServerUrl(out) === 'http://localhost:5173/')
}

// A2 Next.js Local 行（new URL 归一化会补尾部斜杠）
{
  const out = '▲ Next.js 14.2.3\n  - Local:        http://localhost:3000\n  - Environments: .env'
  check('A2 next local', parseDevServerUrl(out) === 'http://localhost:3000/')
}

// A3 CRA（Local + On Your Network）
{
  const out = 'Compiled successfully!\n\nYou can now view my-app in the browser.\n\n  Local:            http://localhost:3000\n  On Your Network:  http://192.168.1.5:3000'
  check('A3 cra local', parseDevServerUrl(out) === 'http://localhost:3000/')
}

// A4 webpack-dev-server：无 Local 标签的裸地址
{
  check('A4 webpack bare url', parseDevServerUrl('Project is running at http://localhost:8080/') === 'http://localhost:8080/')
}

// A5 serve：Local 行
{
  const out = '   Serving!\n\n   Local:            http://localhost:3000\n   Network:          http://192.168.1.5:3000'
  check('A5 serve local', parseDevServerUrl(out) === 'http://localhost:3000/')
}

// A6 python http.server：端口行 → localhost:port
{
  check('A6 python http.server', parseDevServerUrl('Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...') === 'http://localhost:8000/')
}

// A7 php -S：Development Server 括号地址
{
  check('A7 php -S', parseDevServerUrl('PHP 8.3.0 Development Server (http://localhost:8000) started') === 'http://localhost:8000/')
}

// A8 纯 0.0.0.0 输出 → 归一为 localhost（浏览器可访问）
{
  check('A8 0.0.0.0 normalized', parseDevServerUrl('Server running at http://0.0.0.0:3000/') === 'http://localhost:3000/')
}

// A9 带尾随标点的地址
{
  check('A9 trailing punctuation', parseDevServerUrl('Local: http://localhost:5173/, enjoy!') === 'http://localhost:5173/')
}

// A10 无 URL 输出 → null
{
  check('A10 no url -> null', parseDevServerUrl('Build completed in 12s') === null)
  check('A10b git status -> null', parseDevServerUrl(' M src/index.ts\n?? package.json') === null)
  check('A10c external url ignored', parseDevServerUrl('See https://example.com/docs for details') === null)
}

// A11 带标签的非回环地址（Server:/Local: 指向外部域名）→ 忽略（误触发防护）
{
  check('A11 labeled external url ignored', parseDevServerUrl('Server: https://example.com') === null)
  check('A11b labeled external http ignored', parseDevServerUrl('App running at: http://example.com:8080/') === null)
  check('A11c labeled external + loopback -> loopback', parseDevServerUrl('Local: http://localhost:5173/\nServer: https://example.com') === 'http://localhost:5173/')
  check('A11d labeled internal still works', parseDevServerUrl('Local: http://127.0.0.1:3000/') === 'http://127.0.0.1:3000/')
}

// B1 摘要关键词
{
  check('B1 vite summary', looksLikeDevServerRow('Start the Vite dev server'))
  check('B2 next dev summary', looksLikeDevServerRow('Run next dev'))
  check('B3 http.server summary', looksLikeDevServerRow('python -m http.server 8000'))
  check('B4 serve summary', looksLikeDevServerRow('npx serve dist'))
  check('B5 dev server phrase', looksLikeDevServerRow('Run the frontend dev server'))
  check('B6 negative: tests', !looksLikeDevServerRow('Run unit tests'))
  check('B7 negative: install', !looksLikeDevServerRow('Install dependencies'))
  check('B8 negative: start app', !looksLikeDevServerRow('Start the application'))
  check('B9 negative: git', !looksLikeDevServerRow('Commit changes'))
  check('B10 negative: server word', !looksLikeDevServerRow('Deploy to the production server'))
  // 中文摘要（LLM 常用描述）
  check('B11 zh: 启动本地开发服务器', looksLikeDevServerRow('启动本地开发服务器'))
  check('B12 zh: 运行视频 WebUI 服务', looksLikeDevServerRow('运行一个视频 WebUI 服务'))
  check('B13 zh: 起一个静态服务', looksLikeDevServerRow('用 python 起一个本地静态服务'))
  check('B14 zh: 端口', looksLikeDevServerRow('把服务跑起来监听 5173 端口'))
  check('B15 zh negative: 客户服务', !looksLikeDevServerRow('处理客户服务请求'))
  check('B16 zh negative: 服务条款', !looksLikeDevServerRow('阅读服务条款'))
  // running 兜底场景的摘要（关键词不命中，靠 data-state=running 读输出）
  check('B17 en negative for running-fallback', !looksLikeDevServerRow('Start the video webui backend'))
}

// C1 前端文件识别（含真实 edit 行的「路径后跟 diff 内容」形态）
{
  check('C1 tsx always frontend', looksLikeFrontendFile('Edit src/App.tsx', false))
  check('C1b tsx mid-text (path followed by diff)', looksLikeFrontendFile('Edit src/App.tsx复制D:\\project\\src\\App.tsx// 其余 5 行', false))
  check('C1c tsx followed by description', looksLikeFrontendFile('Edit src/App.tsx to fix the button color', false))
  check('C2 css frontend', looksLikeFrontendFile('Write src/index.css', false))
  check('C3 html frontend', looksLikeFrontendFile('Edit index.html', false))
  check('C4 vue frontend', looksLikeFrontendFile('Write components/Button.vue', false))
  check('C5 ts only with dev server', !looksLikeFrontendFile('Edit src/server.ts', false))
  check('C6 ts with dev server', looksLikeFrontendFile('Edit src/server.ts', true))
  check('C6b ts mid-text with dev server', looksLikeFrontendFile('Edit src/server.ts复制D:\\project\\src\\server.ts// 其余 3 行', true))
  check('C7 js only with dev server', !looksLikeFrontendFile('Write api/index.js', false))
  check('C8 js with dev server', looksLikeFrontendFile('Write api/index.js', true))
  check('C9 python never frontend', !looksLikeFrontendFile('Edit src/main.py', true))
  check('C10 json never frontend', !looksLikeFrontendFile('Write package.json', true))
  check('C11 md never frontend', !looksLikeFrontendFile('Edit README.md', true))
  check('C11b md mid-text never frontend', !looksLikeFrontendFile('Write README.md with usage notes', true))
  check('C12 tsx.bak not frontend', !looksLikeFrontendFile('Edit src/App.tsx.bak', true))
}

// D1 常量健全性
{
  check('D1 attempts >= 1', BASH_OUTPUT_ATTEMPTS >= 1)
}

// E1 审查驱动目标文件解析（resolveDriveTarget）
{
  const changes = [
    { path: 'src/App.tsx', workspaceRelativePath: 'src/App.tsx', added: 5, removed: 2, kind: 'modified' },
    { path: 'src/index.css', workspaceRelativePath: 'src/index.css', added: 3, removed: 0, kind: 'modified' },
  ] as const
  check('E1 no path -> first change', resolveDriveTarget(changes, undefined) === 'src/App.tsx')
  check('E2 explicit path in snapshot', resolveDriveTarget(changes, 'src/index.css') === 'src/index.css')
  check('E3 path not in snapshot -> first', resolveDriveTarget(changes, 'README.md') === 'src/App.tsx')
  check('E4 empty snapshot -> null', resolveDriveTarget([], undefined) === null)
  check('E5 empty snapshot with path -> null', resolveDriveTarget([], 'src/App.tsx') === null)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.log('FAILED: ' + failures.join('; '))
  process.exit(1)
}
