/**
 * 琉璃自有样式表的 :has() 性能改写（运行时）。视觉零变化，只换选择器写法。
 *
 * 两类改写（均为等价改写，原始文本保存在内存，样式表被外部重写时重新取源）：
 *
 * 1. `:has()` 参数里的类名子串选择器 → 具体类名 `:is(.a,.b)`
 *    见 has-selector-rewrite.ts。Blink 不能为 `[class*=]` 参数建立失效索引，
 *    任一元素改 class 就整页重算样式（实测每次 25~55ms）；改写后 0.3ms。
 *    类名集合 = 全部样式表选择器里出现的类名 + DOM 现有 classList；新样式表
 *    注入（插件懒加载 CSS module）或 DOM 出现新类名时重算，结果不变则不重写。
 *
 * 2. 根节点 `body:has(X)` / `html:has(X)` / `:root:has(X)` → `body[data-liuli-has-N]`
 *    根节点 :has 让文档内任意子树增删都要重新求值根的 :has（流式输出每批 DOM
 *    插入都付这笔钱）。改由一个 MutationObserver 在回调里 `matches(':has(X)')`
 *    一次性求值并同步写属性；MO 回调在渲染前运行，不会产生可见的一帧延迟。
 */
import { collectHasClassPatterns, findHasArgs, matchesPattern, rewriteHasClassSubstrings, type ClassPattern } from './has-selector-rewrite.ts'

/** 本插件拥有的样式元素（主题主表、插件管理图标、宿主代注入的 CSS module）。 */
const OWNED_SELECTOR = 'style#liuli-theme-css, style#liuli-plugin-manager-icons, style[data-plugin="dsh-liuli-ui-enhance"]'

/** 琉璃运行时挂到宿主 shell 上的别名类（不出现在任何样式表选择器里）。 */
const ALIAS_TOKENS = ['liuli_frame', 'liuli_sidebarCol', 'liuli_centerCol', 'liuli_detailsCol']

const FLAG_PREFIX = 'data-liuli-has-'

/** 根 :has 前缀：紧挨 `:has(` 之前的 body / html / :root（可带属性限定）。 */
const ROOT_BEFORE_RE = /(^|[\s,{}>(+~])(body|html|:root)((?:\[[^\]]*\])*)$/

interface RootFlag {
  readonly attr: string
  readonly anchor: 'body' | 'html'
  readonly arg: string
}

/** 去注释（注释里的 `body:has(...)` 示例文本不应生成标记）。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 把根节点 :has 替换为属性标记；flags 以参数文本去重。
 * 只处理参数以后代 / 子代关系出发的情形（`+` / `~` 开头的兄弟关系对根节点
 * 无意义，保持原样）。
 */
export function rewriteRootHas(text: string, flags: Map<string, RootFlag>): string {
  const spans = findHasArgs(text)
  if (spans.length === 0) return text
  let out = ''
  let last = 0
  for (const [start, a, b] of spans) {
    if (start < last) continue
    const head = out + text.slice(last, start)
    const m = ROOT_BEFORE_RE.exec(head.slice(-120))
    const arg = text.slice(a, b)
    if (m === null || /^\s*[+~]/.test(arg)) {
      out = head + text.slice(start, a)
      last = a
      continue
    }
    const anchor: RootFlag['anchor'] = m[2] === 'body' ? 'body' : 'html'
    const key = `${anchor}|${arg}`
    let flag = flags.get(key)
    if (flag === undefined) {
      flag = { attr: `${FLAG_PREFIX}${flags.size}`, anchor, arg }
      flags.set(key, flag)
    }
    out = `${head}[${flag.attr}]`
    last = b + 1
  }
  return out + text.slice(last)
}

/** 收集当前文档全部类名 token（样式表选择器 + DOM）。 */
function collectTokens(): Set<string> {
  const tokens = new Set<string>(ALIAS_TOKENS)
  const walk = (list: CSSRuleList): void => {
    for (const rule of Array.from(list)) {
      const sel = (rule as CSSStyleRule).selectorText
      if (typeof sel === 'string' && sel.includes('.')) {
        for (const m of sel.matchAll(/\.((?:[\w-]|\\.)+)/g)) {
          const raw = m[1] ?? ''
          tokens.add(raw.includes('\\') ? raw.replace(/\\(.)/g, '$1') : raw)
        }
      }
      const nested = (rule as CSSGroupingRule).cssRules
      if (nested !== undefined && nested.length > 0) walk(nested)
    }
  }
  for (const sheet of Array.from(document.styleSheets)) {
    try { walk(sheet.cssRules) } catch { /* 跨源样式表不可读 */ }
  }
  for (const el of Array.from(document.querySelectorAll('[class]'))) {
    for (const c of Array.from(el.classList)) tokens.add(c)
  }
  return tokens
}

/**
 * 启动改写；返回清理函数（还原全部原始文本并移除标记）。
 */
export function startHasSelectorPerf(): () => void {
  /** 样式元素 → 去注释后的原始文本（改写输入）。 */
  const sources = new Map<HTMLStyleElement, string>()
  /** 样式元素 → 未经任何处理的原始文本（清理时还原）。 */
  const originals = new Map<HTMLStyleElement, string>()
  /** 样式元素 → 本模块最后写入的文本（用于识别外部重写）。 */
  const written = new WeakMap<HTMLStyleElement, string>()
  const flags = new Map<string, RootFlag>()
  let patterns: ClassPattern[] = []
  let signature = ''
  let disposed = false

  const anchorEl = (f: RootFlag): Element => f.anchor === 'body' ? document.body : document.documentElement

  /** 同步刷新根节点标记（MO 回调与改写后调用）。 */
  const syncFlags = (): void => {
    for (const f of flags.values()) {
      const el = anchorEl(f)
      let on = false
      try { on = el.matches(`:has(${f.arg})`) } catch { on = false }
      if (on !== el.hasAttribute(f.attr)) el.toggleAttribute(f.attr, on)
    }
  }

  const signatureOf = (tokens: Set<string>): string => {
    const list = [...tokens]
    return patterns.map(p => `${p.op}${p.value}=${list.filter(t => matchesPattern(t, p)).sort().join(' ')}`).join('|')
  }

  /** 登记新出现 / 被外部改写的自有样式元素；返回是否有变化。 */
  const adopt = (): boolean => {
    let changed = false
    for (const [el] of sources) {
      if (!el.isConnected) { sources.delete(el); originals.delete(el); changed = true }
    }
    for (const el of Array.from(document.querySelectorAll<HTMLStyleElement>(OWNED_SELECTOR))) {
      const text = el.textContent ?? ''
      if (sources.has(el) && written.get(el) === text) continue
      if (!text.includes(':has(')) {
        if (sources.delete(el)) changed = true
        originals.delete(el)
        continue
      }
      sources.set(el, stripComments(text))
      originals.set(el, text)
      changed = true
    }
    if (changed) {
      const all = new Map<string, ClassPattern>()
      for (const text of sources.values()) for (const p of collectHasClassPatterns(text)) all.set(p.op + p.value, p)
      patterns = [...all.values()]
    }
    return changed
  }

  let observedFlags = -1
  const rewriteAll = (force: boolean): void => {
    if (disposed) return
    const adopted = adopt()
    const tokens = collectTokens()
    const sig = signatureOf(tokens)
    if (!force && !adopted && sig === signature) return
    signature = sig
    for (const [el, source] of sources) {
      const next = rewriteRootHas(rewriteHasClassSubstrings(source, tokens), flags)
      if (el.textContent !== next) el.textContent = next
      written.set(el, next)
    }
    syncFlags()
    if (flags.size !== observedFlags) { observedFlags = flags.size; observeBody() }
  }

  // 新样式表注入（插件懒加载 CSS module 与其 DOM 同批挂载）/ 自有样式被宿主
  // 重写（HMR、实时重载）：在 MO 回调里同步重算，赶在本帧渲染前生效，避免
  // 新弹层第一帧用旧类名集合渲染。样式注入是低频事件，一次约 10~20ms。
  const headObserver = new MutationObserver(records => {
    for (const r of records) {
      // 忽略本模块自己写入引起的 text 变化。
      const target = r.target instanceof HTMLStyleElement ? r.target : r.target.parentElement
      if (target instanceof HTMLStyleElement && written.get(target) === target.textContent) continue
      rewriteAll(false)
      return
    }
  })
  headObserver.observe(document.head, { childList: true, subtree: true, characterData: true })

  // 根节点标记：子树增删 / 参数里出现的 data-* 属性变化后同步求值（只做 matches，
  // 不改样式）。MO 回调是微任务，在本次渲染前完成，标记与 DOM 同帧生效。
  // 不监听 class 属性：根 :has 参数命中的都是随节点挂载出现的页面/浮层，
  // 「已有节点改 class 才命中」的情形不存在；若有也会被下面 5s 兜底补上。
  const attributeNames = (): string[] => {
    const names = new Set<string>()
    for (const f of flags.values()) for (const m of f.arg.matchAll(/\[\s*([\w-]+)/g)) if (m[1] !== undefined && m[1] !== 'class') names.add(m[1])
    return [...names]
  }
  const bodyObserver = new MutationObserver(syncFlags)
  const observeBody = (): void => {
    bodyObserver.disconnect()
    if (flags.size === 0) return
    const attrs = attributeNames()
    bodyObserver.observe(document.documentElement, attrs.length > 0
      ? { childList: true, subtree: true, attributes: true, attributeFilter: attrs }
      : { childList: true, subtree: true })
  }

  rewriteAll(true)
  // DOM 里后出现的新类名（非 CSS module 的普通类）：低频兜底。
  const timer = window.setInterval(() => {
    if (document.hidden) return
    rewriteAll(false)
    syncFlags()
  }, 5000)

  return () => {
    disposed = true
    window.clearInterval(timer)
    headObserver.disconnect()
    bodyObserver.disconnect()
    for (const [el, original] of originals) if (el.isConnected && written.get(el) === el.textContent) el.textContent = original
    for (const f of flags.values()) anchorEl(f).removeAttribute(f.attr)
  }
}
