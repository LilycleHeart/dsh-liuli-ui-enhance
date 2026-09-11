/**
 * 琉璃 · 会话统计行（官方 StatsLine）图标装饰。
 *
 * 官方 `dsh-client-ui-chat` 的 StatsLine 把统计渲染成若干纯文本分组，
 * 用 `|` 分隔（如 `28 轮 · 387 步 | LLM 41分49秒 · 工具调用 19分1秒 |
 * 首 token 平均 4秒 · 251 tok/s | 缓存命中 99% | 输入 89.5M tok · 输出 255K tok`）。
 * 本模块在每组文本前注入一枚 16px Material Symbols 图标（stats-icons.ts），
 * 不改宿主源码、不改文本内容。
 *
 * 做法（与 session-markers.ts 同款观察式装饰）：
 * - **精确定位**：分隔符 span（宿主类名后缀 `_sep`）是 StatsLine 根节点的直接
 *   子级，且这类类名在页面其它 `_root` 容器中不出现 —— 用 `span[class$="_sep"]`
 *   反查父节点，比「找 `_root`」精确得多（页面里有大量其它 `_root`，会误命中）；
 * - 按分组文本的语义关键词匹配图标（中英文都覆盖，不依赖具体数字）；
 * - 幂等：节点已带标记且图标未变则跳过，避免注入本身触发观察器造成循环；
 * - React 重渲染会移除注入节点 → MutationObserver（rAF 节流）重新装饰。
 *
 * 随「非官方增强 → DOM 观察增强」开关挂载（index.ts 里 unofficial('dom')
 * 关闭时不启动本模块）。
 */
import { STATS_ICONS, type StatsIconName } from './stats-icons.ts'

/** 注入节点标记。 */
const MARK = 'data-liuli-stats-icon'

/** 宿主分隔符 span 的类名后缀（`bxNl9a_sep`，CSS Modules 哈希前缀跨构建变化，后缀稳定）。 */
const SEP_SUFFIX = '_sep'

/**
 * 语义 → 图标匹配表：按顺序取**第一个命中**的分组（顺序即优先级）。
 * 关键词取自官方 locales（stats.counts / stats.llm / stats.toolCall /
 * stats.ttftAverage / stats.tokensPerSecond / stats.cacheHit / stats.tokens），
 * 中英文都覆盖；用「组内出现关键词」而非整串相等，容忍数值变化。
 */
const MATCHERS: readonly { icon: StatsIconName; test: RegExp }[] = [
  // 组1 轮次 / 步数：`{turns} 轮 · {steps} 步` / `{turns} turns · {steps} steps`
  { icon: 'stacks', test: /轮|步|turns?\b|steps?\b/u },
  // 组2 耗时：LLM / 工具调用（Tool call）
  { icon: 'schedule', test: /LLM|工具调用|tool\s*call/iu },
  // 组3 速度：首 token 平均 / tok/s（TTFT avg）—— 必须排在 token 用量之前
  { icon: 'speed', test: /首\s*token|tok\/s|TTFT/iu },
  // 组4 缓存命中
  { icon: 'cached', test: /缓存|cache\s*hit/iu },
  // 组5 token 用量：输入 / 输出
  { icon: 'token', test: /输入|输出|tok/iu },
]

/** 为单个分组文本选择图标（匹配不到返回 undefined，不注入）。 */
function iconFor(text: string): StatsIconName | undefined {
  const normalized = text.trim()
  if (normalized === '') return undefined
  for (const matcher of MATCHERS) {
    if (matcher.test.test(normalized)) return matcher.icon
  }
  return undefined
}

/** 注入一枚图标到分组 span 首位。 */
function injectIcon(span: HTMLElement, want: StatsIconName): void {
  const icon = document.createElement('span')
  icon.setAttribute(MARK, want)
  icon.setAttribute('aria-hidden', 'true')
  Object.assign(icon.style, {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '14px',
    height: '14px',
    marginRight: '4px',
    flex: 'none',
    verticalAlign: '-2px',
    color: 'var(--dsw-alias-label-dimmed, var(--dsw-alias-label-tertiary))',
    opacity: '0.9',
  } as Partial<CSSStyleDeclaration>)
  // 图标 SVG 为 16px 画布，缩到 14px 与 13px 文字基线更贴合。
  icon.innerHTML = STATS_ICONS[want].replace('width="16" height="16"', 'width="14" height="14"')
  span.insertBefore(icon, span.firstChild)
}

/** 在 StatsLine 根节点内为每个分组 span 装饰图标（幂等）。 */
function decorateRoot(root: HTMLElement): void {
  // 分组是根的直接子级 span；分隔符 span（`_sep`）需排除。
  for (const child of Array.from(root.children)) {
    if (!(child instanceof HTMLElement) || child.tagName !== 'SPAN') continue
    if (typeof child.className === 'string' && child.className.endsWith(SEP_SUFFIX)) continue
    const want = iconFor(child.textContent ?? '')
    const existing = child.querySelector<HTMLElement>(`:scope > [${MARK}]`)
    if (want === undefined) {
      existing?.remove()
      continue
    }
    // 幂等：已注入且图标名未变则不动（避免观察器自触发循环）。
    if (existing !== null && existing.getAttribute(MARK) === want) continue
    existing?.remove()
    injectIcon(child, want)
  }
}

let observer: MutationObserver | null = null
let raf = 0
let started = false

/** 用分隔符 span 反查统计行根节点并装饰（分隔符是这批分组的唯一可靠指纹）。 */
function scan(): void {
  const seen = new Set<HTMLElement>()
  for (const sep of Array.from(document.querySelectorAll<HTMLElement>(`span[class$="${SEP_SUFFIX}"]`))) {
    const root = sep.parentElement
    if (root === null || seen.has(root)) continue
    seen.add(root)
    decorateRoot(root)
  }
}

function schedule(): void {
  if (raf !== 0) return
  raf = requestAnimationFrame(() => {
    raf = 0
    scan()
  })
}

/** 启动会话统计行图标装饰；返回停止函数（移除观察器与已注入节点）。 */
export function startStatsLineIcons(): () => void {
  if (started) return () => {}
  started = true
  observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  schedule()
  return () => {
    started = false
    observer?.disconnect()
    observer = null
    if (raf !== 0) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    for (const node of Array.from(document.querySelectorAll(`[${MARK}]`))) node.remove()
  }
}
