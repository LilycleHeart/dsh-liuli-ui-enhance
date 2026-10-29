/**
 * :has() 内类名子串匹配的等价改写（纯函数，无 DOM 依赖，便于单测）。
 *
 * 背景（CDP 实测，DSH Desktop 2.0.x，约 6k 节点）：
 *   Blink 对 `:has()` 参数里的 `[class*="_x"]` / `[class$="_x"]` 无法建立
 *   失效索引 —— 任一元素 class 变化都要按「可能影响 :has」处理，整页重算样式。
 *   琉璃 31 条此类规则使消息行一次 class 切换的样式重算从 0.3ms 涨到 25~55ms，
 *   hover / 流式输出 / 动画类名切换全部吃这笔开销，是插件启用后掉帧的主因。
 *   把参数里的子串属性选择器换成具体类名 `:is(.a,.b)` 后，失效回到按类名
 *   索引，开销回落到 0.3ms；31 条规则逐条比对 querySelectorAll 命中完全一致。
 *
 * 只改写 `:has(...)` 括号内部；括号外的 `[class*=]` 不受影响（那些走正常
 * 右到左匹配，不触发全局失效）。
 */

/** `[class*="x"]` / `[class$='x']` / `[class^=x]`（引号可选）。 */
const CLASS_ATTR_RE = /\[\s*class\s*([*^$])=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s"']+))\s*\]/g

/** 永不命中的占位类：模式当前没有任何对应类名时使用（与原语义一致：无元素可命中）。 */
export const VOID_CLASS = 'liuli-has-void'

export type ClassOp = '*' | '^' | '$'

export interface ClassPattern {
  readonly op: ClassOp
  readonly value: string
}

/** 返回 text 中所有 `:has(` 参数区间 [argStart, argEnd)，按出现顺序；含嵌套。 */
export function findHasArgs(text: string): Array<[start: number, argStart: number, argEnd: number]> {
  const spans: Array<[number, number, number]> = []
  let i = 0
  while ((i = text.indexOf(':has(', i)) !== -1) {
    let depth = 0
    let j = i + 4
    let quote = ''
    for (; j < text.length; j++) {
      const c = text[j]
      if (quote !== '') {
        if (c === '\\') { j++; continue }
        if (c === quote) quote = ''
        continue
      }
      if (c === '"' || c === "'") { quote = c; continue }
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0) break
      }
    }
    spans.push([i, i + 5, j])
    i = j
  }
  return spans
}

const keyOf = (p: ClassPattern): string => p.op + p.value

/** 收集 text 中 :has() 参数里出现的全部类名子串模式。 */
export function collectHasClassPatterns(text: string): ClassPattern[] {
  const out = new Map<string, ClassPattern>()
  for (const [, a, b] of findHasArgs(text)) {
    for (const m of text.slice(a, b).matchAll(CLASS_ATTR_RE)) {
      const p: ClassPattern = { op: m[1] as ClassOp, value: m[2] ?? m[3] ?? m[4] ?? '' }
      if (p.value !== '') out.set(keyOf(p), p)
    }
  }
  return [...out.values()]
}

/** 判断类名 token 是否满足模式。 */
export function matchesPattern(token: string, p: ClassPattern): boolean {
  switch (p.op) {
    case '*': return token.includes(p.value)
    case '^': return token.startsWith(p.value)
    default: return token.endsWith(p.value)
  }
}

/** CSS 标识符转义（浏览器有 CSS.escape 时用它；单测环境回落到最小实现）。 */
function escapeIdent(token: string): string {
  const native = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape
  if (typeof native === 'function') return native(token)
  return token.replace(/^(-?)(\d)/, (_m, dash: string, d: string) => `${dash}\\3${d} `).replace(/[^\w-]/g, ch => `\\${ch}`)
}

/**
 * 改写 text 中 :has() 参数里的类名子串选择器为具体类名列表。
 * @param text - 原始样式表文本。
 * @param tokens - 当前文档已知的全部类名（样式表选择器 + DOM classList）。
 * @returns 改写后的文本；无 :has 时原样返回。
 */
export function rewriteHasClassSubstrings(text: string, tokens: Iterable<string>): string {
  const spans = findHasArgs(text)
  if (spans.length === 0) return text
  const tokenList = [...new Set(tokens)].sort()
  const cache = new Map<string, string>()
  const replacement = (p: ClassPattern): string => {
    const key = keyOf(p)
    let hit = cache.get(key)
    if (hit === undefined) {
      const list = tokenList.filter(t => matchesPattern(t, p))
      hit = `:is(${(list.length === 0 ? [VOID_CLASS] : list).map(t => `.${escapeIdent(t)}`).join(',')})`
      cache.set(key, hit)
    }
    return hit
  }
  let out = ''
  let last = 0
  for (const [start, a, b] of spans) {
    // 嵌套 :has 已被外层区间整体处理。
    if (start < last) continue
    out += text.slice(last, a)
    out += text.slice(a, b).replace(CLASS_ATTR_RE, (_all, op: ClassOp, v1?: string, v2?: string, v3?: string) => {
      const value = v1 ?? v2 ?? v3 ?? ''
      return value === '' ? _all : replacement({ op, value })
    })
    last = b
  }
  return out + text.slice(last)
}
