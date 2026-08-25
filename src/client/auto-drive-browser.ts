/**
 * 琉璃主题 · 侧边栏浏览器自动驱动（LLM 活动感知）。
 *
 * 模型在对话流里做前端项目时，自动驱动右侧边栏浏览器展示，让用户实时
 * 看到模型正在产出的前端页面：
 *
 * 1. bash 工具行启动 dev server（vite / next dev / serve / http.server 等）：
 *    读取行输出里的本地地址（Vite「Local: http://localhost:5173/」、Next.js
 *    「Local:」、CRA/webpack「Project is running at」、serve「Local:」、
 *    python http.server「Serving HTTP on … port 8000」等），自动在侧边栏
 *    打开浏览器标签并展开面板（会话内点击前端链接的既有 PREVIEW_NAVIGATE
 *    路径不重复处理，这里只管「没人点击时的自动展示」）；
 * 2. 前端文件（html/tsx/jsx/vue/css 等）被 edit/write 且本会话已知 dev
 *    server 地址时，每轮最多一次把浏览器标签导航回 dev server 根地址
 *    （无 HMR 的静态服务也能源源不断看到最新页面）；
 * 3. agent 用 browser-client.mjs `open --show` 创建的 `browser:*` 引擎标签
 *    由 PreviewPanel 的轮询桥接进侧边栏（本模块不负责）。
 *
 * 控制策略与 auto-open-details.ts 一致（用户确认的语义）：
 * - 每轮最多驱动一次：新增**最新一条** user/steering 锚点（新一轮）时重置；
 *   历史批量挂载的旧 user 消息不重置（上翻加载历史不会把标记清掉）；
 * - 用户手动收起侧边栏后本会话不再自动驱动（PREVIEW_TOGGLE_EVENT 只由
 *   手动开合路径 dispatch，自动驱动不 dispatch 它）；
 * - 会话切换重置：宿主重建 `[data-conversation-scroll]` 容器即重置；
 * - 启动/会话切换后的 3s 稳定窗口内不触发（避开首屏与历史批量挂载）；
 * - 设置项 `auto_drive_browser = false` 时整体禁用。
 *
 * 触发信号（对话流 DOM，宿主 dsh-client-ui-tool 标记）：
 * - `[data-variant="bash"]`：shell 行（摘要缺省只显示描述，输出在可展开
 *   disclosure 里，本模块必要时临时展开读取再收起）；
 * - `[data-tool="edit"]` / `[data-tool="write"]` / `[data-tool="write_file"]`：
 *   模型写/改文件（文本里带目标路径，按扩展名识别前端文件）。
 */
import { LIULI_LS_KEY } from '../liuli-settings.ts'

/** 请求侧边栏浏览器驱动的事件名（PreviewPanel 监听）。 */
export const AUTO_DRIVE_BROWSER_EVENT = 'liuli:auto-drive-browser'

/** 驱动请求载荷。 */
export interface AutoDriveBrowserDetail {
  /** 要展示的 URL（dev server 根地址或刷新目标）。 */
  url: string
}

/** PreviewPanel 的手动开合事件名（字符串常量，避免循环依赖）。 */
const PREVIEW_TOGGLE_EVENT = 'liuli:preview-toggle'

/** 写/改文件类工具（宿主 data-tool 取值）。 */
const FILE_TOOL_SELECTOR = '[data-tool="edit"], [data-tool="write"], [data-tool="write_file"]'
/** 经 shell 执行命令的工具行（bash/pwsh 均为 bash variant）。 */
const BASH_TOOL_SELECTOR = '[data-variant="bash"]'

/** 新一轮对应的消息锚点（一个用户消息/steering 算新一轮）。 */
const USER_TURN_SELECTOR = '[data-chat-anchor-key][data-chat-flow-kind="user"], [data-chat-anchor-key][data-chat-flow-kind="steering"]'
/** 对话滚动容器（会话切换时宿主重建）。 */
const SCROLL_SELECTOR = '[data-conversation-scroll]'
/** 启动/会话切换后的稳定窗口：期间不触发（避开历史批量挂载）。 */
const SETTLE_MS = 3000
/** dev server 地址的有效期：超过后不再把文件编辑导航到它（服务器可能已被杀）。 */
const DEV_URL_TTL_MS = 10 * 60 * 1000

/* ── 纯逻辑：dev server 行 / URL / 前端文件识别（demo/test-auto-drive.ts 单测） ── */

/** 展开后读取 bash 输出的最大尝试次数（dev server 启动输出是流式的）。 */
export const BASH_OUTPUT_ATTEMPTS = 3
/** 每次读取失败后的重试间隔。 */
export const BASH_OUTPUT_RETRY_MS = 1200

/**
 * dev server 摘要关键词（bash 行摘要/描述匹配；命中才值得展开读输出）。
 * 英文部分刻意不含单独的 "start"/"run"（`npm start` 这类已在列表内），避免
 * 「Start the test suite」之类的非 dev server 命令也触发展开；中文部分覆盖
 * 「启动本地开发服务」「运行 xxx 服务 5173」这类 LLM 常用中文描述——摘要
 * 不命中时，running 状态的后台服务行仍会兜底读一次输出（见 scanBashRow）。
 */
export const DEV_SERVER_KEYWORD_RE = /\b(vite|webpack|next dev|nextjs|nuxt dev|astro dev|sveltekit|quasar dev|ng serve|react-scripts start|craco start|serve|http\.server|SimpleHTTPServer|browser-sync|live-server|gatsby develop|docusaurus start|hugo server|jekyll serve|eleventy|dev server|development server|dev-server|preview server|npm run dev|pnpm dev|yarn dev|bun dev|npm start|pnpm start|yarn start|bun start|npm run start|php -S|start dev server|run dev server|start the (frontend|web|dev)|run the (frontend|web|dev)|dev server on|serve the (frontend|web|site))\b|(启动|运行|起|开启|打开).{0,8}(本地|开发|web|前端|静态)?(服务|服务器|站点)|(本地|开发|web|前端|静态).{0,4}(服务|服务器)|监听.{0,8}(端口|\d{2,})|(服务|服务器).{0,6}(端口|监听).{0,4}\d{2,}|端口\s*\d{2,}/i

/** 带标签的 dev server 地址行（Vite「Local:」/ Next「Local:」/ CRA「Local:」/ webpack「Project is running at」…）。 */
const DEV_URL_LABEL_RE = /(?:Local|Network|Server|App running at|Project is running at|Serving|listening (?:on|at)|On Your Network|On your local|Available on)\s*[:@]?\s*(https?:\/\/[^\s"'<>)\]]+)/gi
/** 裸回环地址（http://localhost:PORT / 127.0.0.1 / 0.0.0.0 / [::1]）。 */
const LOOPBACK_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?[^\s"'<>)\]]*/gi
/** python http.server / SimpleHTTPServer 不打印 URL，只有「Serving HTTP on 0.0.0.0 port 8000」。 */
const PYTHON_HTTP_SERVER_RE = /Serving HTTP on (?:0\.0\.0\.0|127\.0\.0\.1|localhost|::1) port (\d+)/i

/** 清理 URL 尾部标点并校验协议。 */
function cleanDevUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/[),.;:]+$/, '')
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

/** 0.0.0.0 归一为 localhost（dev server 绑全接口，浏览器访问 localhost 即可）。 */
function normalizeDevHost(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.hostname === '0.0.0.0') {
      url.hostname = 'localhost'
      return url.href
    }
    return raw
  } catch {
    return raw
  }
}

/**
 * 从一段文本（bash 行摘要/展开后的输出）里解析 dev server 地址。
 * 优先级：带「Local」标签的回环地址 > 其它带标签的回环地址 > 任意回环地址 >
 * python 端口行。**只接受回环地址**（localhost/127.0.0.1/[::1]/0.0.0.0）——
 * 带标签的 URL（Server:/Local:/listening on 等）若指向非回环域名（如
 * `Server: https://example.com` 这类网页/命令输出）会被忽略，避免「没做前端
 * 却打开浏览器到外部站点」的误触发。无法解析时返回 null。
 */
export function parseDevServerUrl(text: string): string | null {
  const labeled: string[] = []
  const labelRe = new RegExp(DEV_URL_LABEL_RE.source, 'gi')
  let match: RegExpExecArray | null
  while ((match = labelRe.exec(text)) !== null) {
    const url = cleanDevUrl(match[1] ?? '')
    if (url !== null && isLoopbackUrl(url)) {
      const normalized = normalizeDevHost(url)
      if (!labeled.includes(normalized)) labeled.push(normalized)
    }
  }
  if (labeled.length > 0) {
    const local = labeled.find(url => /localhost|127\.0\.0\.1|\[::1\]/i.test(url))
    return local ?? labeled[0] ?? null
  }
  const bareRe = new RegExp(LOOPBACK_URL_RE.source, 'gi')
  while ((match = bareRe.exec(text)) !== null) {
    const url = cleanDevUrl(match[0])
    if (url !== null) return normalizeDevHost(url)
  }
  const python = PYTHON_HTTP_SERVER_RE.exec(text)
  if (python !== null) return `http://localhost:${python[1]}/`
  return null
}

/** 是否回环地址（dev server 判定只认本机地址）。 */
function isLoopbackUrl(raw: string): boolean {
  try {
    const hostname = new URL(raw).hostname.toLowerCase()
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '0.0.0.0'
      || hostname === '[::1]'
      || hostname === '::1'
      || hostname.endsWith('.localhost')
  } catch {
    return false
  }
}

/** 摘要/描述文本是否像 dev server 命令（命中才展开读输出）。 */
export function looksLikeDevServerRow(summary: string): boolean {
  return DEV_SERVER_KEYWORD_RE.test(summary)
}

/** 明确的前端文件扩展名（写这些文件必是前端工作）。
 * 注意：edit/write 行的 textContent 里路径后面通常还跟着 diff 内容
 * （「复制D:\…\src\App.tsx// 其余 N 行」），扩展名不是文本结尾，不能用
 * `$` 锚定，改用「扩展名后跟空白/引号/尖括号/反斜杠/斜杠或结尾」的边界。 */
const FRONTEND_FILE_RE = /\.(?:html?|tsx|jsx|vue|svelte|astro|css|scss|sass|less|styl|svg)(?=$|[\s"'<\\/])/i
/** 脚本类扩展名（.js/.ts 等：仅当已有 dev server 时才按前端处理，避免后端项目误判）。 */
const FRONTEND_SCRIPT_RE = /\.(?:[cm]?js|ts)(?=$|[\s"'<\\/])/i

/**
 * 工具行文本（含目标路径）是否像前端文件。
 * @param hasDevServer 本会话是否已知 dev server 地址（放宽到 .js/.ts）。
 */
export function looksLikeFrontendFile(text: string, hasDevServer: boolean): boolean {
  if (FRONTEND_FILE_RE.test(text)) return true
  if (hasDevServer && FRONTEND_SCRIPT_RE.test(text)) return true
  return false
}

/* ── 运行时状态 ─────────────────────────────────────────────────── */

/** 本轮是否已驱动过浏览器（检测到新一轮 user 消息时重置）。 */
let drivenThisTurn = false
/** 用户手动收起后置 true，直到用户手动打开或切换会话。 */
let dismissed = false
/** 模块启动时间（启动后 SETTLE_MS 内不触发）。 */
let startedAt = 0
/** 会话切换时间（重建滚动容器后 SETTLE_MS 内不触发）。 */
let sessionSettledAt = 0
/** 本会话已知的 dev server 地址（文件编辑时导航目标）。 */
let liveDevUrl: { url: string; at: number } | null = null
/** 已扫描过的 bash 行（避免同一行重复展开读取；重试链在扫描函数内部）。 */
const scannedRows = new WeakSet<HTMLElement>()

/** 设置项开关（缺省开启；localStorage 里显式 false 才关闭）。 */
function autoDriveEnabled(): boolean {
  try {
    const raw = localStorage.getItem(LIULI_LS_KEY)
    if (raw === null || raw === '') return true
    const parsed = JSON.parse(raw) as { auto_drive_browser?: unknown }
    return parsed?.auto_drive_browser !== false
  } catch {
    return true
  }
}

/** DSH 自身 origin（当前页面所在）：把 DSH 自己当 dev server 打开没有意义，忽略。
 * 例如历史命令文本里含 /liuli-browser/capabilities 这类 DSH 路由，展开扫描时
 * 会被 parseDevServerUrl 命中，这里过滤掉，避免误触发打开 DSH 页面。 */
function isDshOwnUrl(url: string): boolean {
  try {
    return new URL(url).origin === window.location.origin
  } catch {
    return false
  }
}

/** 发送驱动请求。 */
function requestDrive(url: string): void {
  window.dispatchEvent(new CustomEvent<AutoDriveBrowserDetail>(AUTO_DRIVE_BROWSER_EVENT, { detail: { url } }))
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => { window.setTimeout(resolve, ms) })

/** 读取 bash 行文本；disclosure 收起时临时展开读取再收起（不干扰用户已展开的行）。 */
async function readBashRowText(row: HTMLElement): Promise<string> {
  const disclosure = row.querySelector<HTMLElement>('[data-disclosure-row]')
  const expanded = disclosure?.getAttribute('aria-expanded') === 'true'
  let text = row.textContent ?? ''
  if (disclosure !== null && !expanded) {
    disclosure.click()
    await sleep(220)
    text = row.textContent ?? ''
    // 只在确实是我们展开的情况下收起（避免把用户刚展开的行又收起）。
    if (disclosure.getAttribute('aria-expanded') === 'true') disclosure.click()
  }
  return text
}

/**
 * 扫描一条 bash 行：摘要里直接带 URL 最省事；否则摘要命中 dev server
 * 关键词才展开读输出（流式输出重试 BASH_OUTPUT_ATTEMPTS 次）。
 *
 * **后台服务兜底**：LLM 常用 run_in_background 拉起服务，摘要（命令描述）可能
 * 不含关键词（如「启动视频 WebUI 服务」没写 vite/serve 等英文词）。此时若行的
 * `data-state="running"`（或文本含「运行中」），仍读一次输出兜底——长驻进程
 * 大概率是服务，输出里的回环 URL（非回环已被 parseDevServerUrl 过滤，不会误弹
 * 外部站点）就是服务地址；读不到 URL 的长驻任务（watch/编译等）不触发。
 */
async function scanBashRow(row: HTMLElement): Promise<string | null> {
  const collapsedText = row.textContent ?? ''
  const fromCollapsed = parseDevServerUrl(collapsedText)
  if (fromCollapsed !== null) return fromCollapsed
  const summary = row.querySelector<HTMLElement>('[class*="summary"]')?.textContent ?? collapsedText
  const keywordHit = looksLikeDevServerRow(summary)
  const running = row.getAttribute('data-state') === 'running' || collapsedText.includes('运行中')
  if (!keywordHit && !running) return null
  const attempts = keywordHit ? BASH_OUTPUT_ATTEMPTS : 1
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(BASH_OUTPUT_RETRY_MS)
    const text = await readBashRowText(row)
    const url = parseDevServerUrl(text)
    if (url !== null) return url
  }
  return null
}

/** 新一轮锚点是否消息流里的最后一条（历史批量挂载的不是）。 */
function isNewestAnchor(node: HTMLElement): boolean {
  const flow = node.parentElement
  if (flow === null || !flow.matches('[data-chat-flow]')) return false
  const anchors = flow.querySelectorAll<HTMLElement>(':scope > [data-chat-anchor-key]')
  const last = anchors[anchors.length - 1]
  return last === node
}

/** 触发窗口判断（稳定窗口 / 抑制 / 每轮一次 / 开关）。 */
function canDrive(): boolean {
  const now = Date.now()
  if (now - startedAt < SETTLE_MS || now - sessionSettledAt < SETTLE_MS) return false
  if (dismissed || drivenThisTurn) return false
  return autoDriveEnabled()
}

/**
 * 启动对话流观察：自动驱动侧边栏浏览器。
 * @returns 清理函数（卸载观察器与监听器）。
 */
export function startAutoDriveBrowser(): () => void {
  startedAt = Date.now()

  const observer = new MutationObserver((mutations) => {
    let scrollReplaced = false
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node instanceof HTMLElement && node.matches(SCROLL_SELECTOR)) scrollReplaced = true
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        if (node.matches(SCROLL_SELECTOR)) scrollReplaced = true
        // 最新一条 user/steering 锚点 = 新一轮：重置「本轮已驱动」。
        const userAnchor = node.matches(USER_TURN_SELECTOR)
          ? node
          : node.querySelector<HTMLElement>(USER_TURN_SELECTOR)
        if (userAnchor !== null && isNewestAnchor(userAnchor)) drivenThisTurn = false
        // bash 行：可能启动 dev server → 异步扫描（摘要不命中不展开）。
        const bashRow = node.matches(BASH_TOOL_SELECTOR)
          ? node
          : node.querySelector<HTMLElement>(BASH_TOOL_SELECTOR)
        if (bashRow !== null && !scannedRows.has(bashRow)) {
          scannedRows.add(bashRow)
          void (async () => {
            if (!canDrive()) return
            const url = await scanBashRow(bashRow)
            if (url === null || isDshOwnUrl(url) || !canDrive()) return
            drivenThisTurn = true
            liveDevUrl = { url, at: Date.now() }
            requestDrive(url)
          })()
        }
        // 写/改文件行：前端文件 + 已知 dev server → 每轮一次导航回 dev 根地址。
        const fileRow = node.matches(FILE_TOOL_SELECTOR)
          ? node
          : node.querySelector<HTMLElement>(FILE_TOOL_SELECTOR)
        if (fileRow !== null) {
          if (!canDrive()) continue
          const now = Date.now()
          if (liveDevUrl === null || now - liveDevUrl.at > DEV_URL_TTL_MS || isDshOwnUrl(liveDevUrl.url)) continue
          const text = fileRow.textContent ?? ''
          if (!looksLikeFrontendFile(text, true)) continue
          drivenThisTurn = true
          requestDrive(liveDevUrl.url)
        }
      }
    }
    if (scrollReplaced) {
      scrollReplaced = false
      drivenThisTurn = false
      dismissed = false
      liveDevUrl = null
      sessionSettledAt = Date.now()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // 用户手动开合（PREVIEW_TOGGLE_EVENT 只由手动路径 dispatch）：延迟读面板
  // rect 判断开/关（details 列带 ~200ms CSS 过渡，等过渡落定再判定）。
  let toggleTimer = 0
  const onToggle = (): void => {
    window.clearTimeout(toggleTimer)
    toggleTimer = window.setTimeout(() => {
      const panel = document.querySelector<HTMLElement>('[data-preview-panel]')
      const width = panel?.getBoundingClientRect().width ?? 0
      if (width > 1) dismissed = false
      else dismissed = true
    }, 250)
  }
  window.addEventListener(PREVIEW_TOGGLE_EVENT, onToggle)

  return () => {
    observer.disconnect()
    window.removeEventListener(PREVIEW_TOGGLE_EVENT, onToggle)
    window.clearTimeout(toggleTimer)
  }
}
