/**
 * 会话标题元素引用过滤（浏览器侧覆盖层，不改官方代码，不改会话存储标题）。
 *
 * DSH 会话标题由首条用户消息确定性回退生成（fallbackSessionTitle 取开头若干词，
 * 空白归一化成单行）。元素选择器把拾取结果序列化为 `[selected element] <tag>` 文本块
 * 随消息发送，首条消息是元素引用时，标题就变成
 * "[selected element] <div> rect: x=… selector: #root > …" 这类机器文本。
 *
 * 本模块只做展示层处理：把命中元素块的标题展示面（侧栏会话行、会话页头面包屑
 * crumb 按钮、悬停卡、搜索结果、工作区切换器）的叶子文本替换为清洗结果——
 * 元素块字段整体剥离、保留块前后的用户文字；整条都是元素块时，从会话快照 /
 * localStorage 缓存取首条消息里块之后的真实用户文字来显示（DSH 标题只取开头
 * 几个词、块之后的原话不在标题里），取不到就显示为空。不引入「网页元素」等
 * 占位文案，也绝不动会话存储的标题（不 rename）。
 *
 * 与 element-card / session-markers 同款装饰模式：MutationObserver + rAF 节流，
 * React 重渲染会还原原标题（标记重新出现），观察器再次清洗；改写后标记消失，
 * 循环天然停转（不需要 data 标记做去重）。
 * 纯函数部分（sanitizeSessionTitle）可在 Node 直接跑 TS 单测。
 */
import type { ClientContext, SessionId } from './compat.ts'

/** formatSelection 输出的元素块起始标记（与 element-card.ts 同构）。 */
const ELEMENT_MARKER = '[selected element]'
/** 元素块头部：`[selected element] <tag>`。 */
const TAG_RE = /\[selected element\]\s*<([^>]+)>/
/** 元素块结构化字段前缀（单行归一化形式：字段名后必须紧跟空白或行尾，
 *  避免 CSS 伪类（a:hover）这类 "word:" 被误当字段锚点）。 */
const FIELD_RE = /(?:^|\s)(rect|selector|attributes|text|color|background|font):(?=\s|$)/
/** 多行形态下的独立字段行（formatSelection 原文：每个字段占一行）。 */
const FIELD_LINE_RE = /^(rect|selector|attributes|text|color|background|font):\s/

/**
 * 从一行文本剥离第一个元素块（含其后所有字段段）。
 * @param line - 单行标题（DSH 归一化后字段间以单个空格相连）。
 * @returns 块前用户文字 / text 字段值；行内无元素块时返回 null。
 */
function stripBlock(line: string): { before: string; text: string } | null {
  const markerIdx = line.indexOf(ELEMENT_MARKER)
  if (markerIdx === -1) return null
  const tagMatch = TAG_RE.exec(line.slice(markerIdx))
  if (tagMatch === null) return null
  const before = line.slice(0, markerIdx).trim()
  let text = ''
  // 消费后续字段：以 "field:" 为锚点切分。字段值可能被 fallback 的词数上限
  // 截断成片段（如 selector: #root >），仍整体吸收，不残留机器文本。
  let scanPos = markerIdx + tagMatch[0].length
  while (scanPos < line.length) {
    const rest = line.slice(scanPos)
    const m = FIELD_RE.exec(rest)
    if (m === null) break
    const valueStart = scanPos + m.index + m[0].length
    const nextAnchor = FIELD_RE.exec(line.slice(valueStart))
    const valueEnd = nextAnchor === null ? line.length : valueStart + nextAnchor.index
    if (m[1] === 'text' && text === '') text = line.slice(valueStart, valueEnd).trim()
    scanPos = valueEnd
  }
  return { before, text }
}

/**
 * 清洗会话标题里的元素选择器序列化文本（纯函数，幂等）。
 *
 * - 无元素块：原样返回（常规标题零开销、零改动）。
 * - 含元素块：剥离块与字段，保留块前后的用户文字；整条都是元素块时显示
 *   元素的 text 字段（标题截断通常带不出它），再没有就为空——不引入
 *   「网页元素」等占位文案，元素块就是不显示。
 * @param raw - DSH 会话标题（displayTitle）。
 * @returns 清洗后的展示标题（可能为空字符串）。
 */
export function sanitizeSessionTitle(raw: string): string {
  const markerIdx = raw.indexOf(ELEMENT_MARKER)
  if (markerIdx === -1) return raw
  // 防御多行（实际标题已被宿主归一化为单行；formatSelection 原文是多行）。
  const lines = raw.split('\n')
  const kept: string[] = []
  let elementText = ''
  let sawBlock = false
  let i = 0
  while (i < lines.length) {
    const seg = stripBlock(lines[i] ?? '')
    if (seg === null) {
      // 多行形态：元素块头行之后的独立字段行（"rect: …" 等）整体剥离。
      const trimmed = (lines[i] ?? '').trim()
      if (FIELD_LINE_RE.test(trimmed)) {
        const textMatch = /^text:\s*(.*)$/.exec(trimmed)
        if (textMatch !== null && textMatch[1] !== undefined && textMatch[1] !== '' && elementText === '') elementText = textMatch[1]
        i += 1
        continue
      }
      if (trimmed !== '') kept.push(trimmed)
      i += 1
      continue
    }
    sawBlock = true
    if (seg.text !== '' && elementText === '') elementText = seg.text
    if (seg.before !== '') kept.push(seg.before)
    i += 1
    // 多行形态：消费紧随头行之后的字段行。
    while (i < lines.length) {
      const fieldLine = (lines[i] ?? '').trim()
      if (!FIELD_LINE_RE.test(fieldLine)) break
      const textMatch = /^text:\s*(.*)$/.exec(fieldLine)
      if (textMatch !== null && textMatch[1] !== undefined && textMatch[1] !== '' && elementText === '') elementText = textMatch[1]
      i += 1
    }
  }
  if (!sawBlock) return raw
  const remainder = kept.join(' ').trim()
  if (remainder !== '') return remainder
  if (elementText !== '') return elementText
  return ''
}

/** 会话行内命中元素块的标题叶子 span（无子元素、文本含标记）。 */
function findPollutedTitleSpan(row: HTMLElement): HTMLElement | null {
  for (const span of Array.from(row.querySelectorAll<HTMLElement>('span'))) {
    if (span.children.length === 0 && (span.textContent ?? '').includes(ELEMENT_MARKER)) return span
  }
  return null
}

/** 清洗一个标题展示元素（文本含标记才改写；改写后标记消失，观察器天然停转）。
 *  纯元素块（清洗为空）时：用该会话首条消息里的真实用户文字替代显示，否则为空。 */
function applyTitleFilter(ctx: Pick<ClientContext, 'sessions'>, el: HTMLElement): void {
  const raw = el.textContent ?? ''
  if (!raw.includes(ELEMENT_MARKER)) return
  const cleaned = sanitizeSessionTitle(raw)
  if (cleaned === raw) return
  if (cleaned !== '') {
    el.textContent = cleaned
    return
  }
  const id = resolveTitleSessionId(ctx, raw)
  const text = id === undefined ? undefined : titleTextCache.get(id)
  el.textContent = text !== undefined && text !== '' ? text : ''
}

/** 从标题叶子反查会话 id：当前行走 current；否则按原始标题文本精确匹配 displayTitle。 */
function resolveTitleSessionId(ctx: Pick<ClientContext, 'sessions'>, rawTitle: string): SessionId | undefined {
  const snap = ctx.sessions.list.getSnapshot()
  const wanted = rawTitle.trim()
  for (const id of snap.ids) {
    const s = snap.byId[id]
    if (s !== undefined && (s.displayTitle ?? '').trim() === wanted) return id
  }
  return undefined
}

/** 文档中所有命中元素块的「标题类」叶子元素。 */
function collectTitleLeaves(): HTMLElement[] {
  const out: HTMLElement[] = []
  // 侧栏会话行标题（与 session-markers 同选择器：role=treeitem 且带 aria-selected）。
  for (const row of document.querySelectorAll<HTMLElement>('[role="treeitem"][aria-selected]')) {
    const span = findPollutedTitleSpan(row)
    if (span !== null) out.push(span)
  }
  // 会话页头面包屑：标题文本在 crumb 按钮（.wSkVaW_crumb）里，crumbSeg 只是
  // inline-flex 容器（带 crumb/分隔符子节点）；subagent lineage 槽位也渲染在
  // crumbs nav 内。故只扫 nav 下的叶子元素，命中标记才改写。
  for (const nav of document.querySelectorAll<HTMLElement>('header nav[class*="_crumbs"]')) {
    for (const el of Array.from(nav.querySelectorAll<HTMLElement>('button, span, div'))) {
      if (el.children.length === 0) out.push(el)
    }
  }
  // 侧栏悬停卡标题 / 搜索结果标题 / 工作区切换器标题：同样只改叶子。
  for (const sel of ['[class*="_hoverTitle"]', '[class*="_searchResultTitle"]', '[class*="_switcherTitle"]']) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.children.length === 0) out.push(el)
    }
  }
  return out
}

/** 标题文字缓存：会话 id → 首条消息清洗后的用户文字（localStorage 持久化，纯展示用）。 */
const titleTextCache = new Map<string, string>()
const CACHE_PREFIX = 'liuli:title-text.'

function loadTitleTextCache(): void {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (key === null || !key.startsWith(CACHE_PREFIX)) continue
      const value = localStorage.getItem(key)
      if (value !== null && value !== '') titleTextCache.set(key.slice(CACHE_PREFIX.length), value)
    }
  } catch { /* 隐私模式 / 配额不足：仅内存态 */ }
}

function cacheTitleText(id: string, text: string): void {
  titleTextCache.set(id, text)
  try { localStorage.setItem(CACHE_PREFIX + id, text) } catch { /* 同上 */ }
}

/**
 * 当前会话对话流 DOM 里，第一条含元素块的用户气泡去掉元素卡片后的用户文字。
 *
 * 元素块被 element-card 替换成卡片后原始序列化文本不在 DOM 里，但块之外的
 * 用户文字仍是纯文本节点；把卡片节点摘掉再取 textContent 即可恢复用户原话。
 * 未卡片化（观察器先于 element-card 跑）时文本里仍有元素块，交给
 * sanitizeSessionTitle 剥离。纯 DOM 读取，不依赖任何会话 API，必然可用。
 */
function domBlockMessageText(): string | undefined {
  try {
    const bubbles = document.querySelectorAll<HTMLElement>('[class*="_bubble"]')
    for (const bubble of Array.from(bubbles)) {
      if (bubble.closest('[class*="_userRow"], [data-pending-steering]') === null) continue
      const hasElement = bubble.querySelector('[data-liuli-element-card]') !== null
        || (bubble.textContent ?? '').includes(ELEMENT_MARKER)
      if (!hasElement) continue
      const clone = bubble.cloneNode(true) as HTMLElement
      for (const card of Array.from(clone.querySelectorAll('[data-liuli-element-card]'))) card.remove()
      const text = sanitizeSessionTitle((clone.textContent ?? '').trim())
      if (text !== '') return text
    }
  } catch { /* 忽略 */ }
  return undefined
}

/**
 * 从会话快照的对话节点读第一条「含元素块」的用户消息文本（防御式：快照面
 * 运行时不可用 / 异常时返回 undefined，回落 DOM 来源）。
 * 客户端 Session 声明为 ISession & ObservableSnapshot<ConversationSnapshot>，
 * 但运行时未必实现 getSnapshot；这里可选调用并整体 try/catch。
 */
function snapshotBlockMessageText(session: unknown): string | undefined {
  try {
    const s = session as { getSnapshot?: () => { nodes?: readonly unknown[] } }
    const nodes = s.getSnapshot?.()?.nodes
    if (nodes === undefined) return undefined
    for (const node of nodes) {
      const n = node as { kind?: unknown; content?: Array<{ type?: unknown; text?: unknown }> }
      if (n.kind !== 'user') continue
      const text = (n.content ?? [])
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text)
        .join('\n')
      if (text.trim() === '' || !text.includes(ELEMENT_MARKER)) continue
      const cleaned = sanitizeSessionTitle(text)
      if (cleaned !== '' && cleaned !== text) return cleaned
    }
  } catch { /* 快照面异常：回落 DOM / 缓存 */ }
  return undefined
}

/** 补载更早历史的尝试次数（避免无限 loadOlder；每次加载一批）。 */
const olderAttempts = new Map<string, number>()

/** 装饰全部会话标题展示面（只改显示，不改存储标题；任何异常都不阻断展示过滤）。 */
function decorateAll(ctx: Pick<ClientContext, 'sessions'>): void {
  try {
    const snap = ctx.sessions.list.getSnapshot()
    for (const id of snap.ids) {
      const summary = snap.byId[id]
      if (summary === undefined) continue
      const title = (summary.title ?? '').trim()
      if (!title.includes(ELEMENT_MARKER)) {
        titleTextCache.delete(id)
        olderAttempts.delete(id)
        continue
      }
      const session = ctx.sessions.binding(id)?.session
      // 提取真实文字：当前会话优先 DOM 气泡（必然渲染），其次会话快照。
      const text = id === snap.current
        ? domBlockMessageText() ?? snapshotBlockMessageText(session)
        : snapshotBlockMessageText(session)
      if (text !== undefined && text !== '') {
        cacheTitleText(id, text)
        olderAttempts.delete(id)
        continue
      }
      // 窗口里还没有含元素块的消息（长会话只载了最近几轮）：对当前会话补载
      // 历史，让标题显示不依赖手动滚动（有上限，避免把整个长会话全量载入）。
      if (id === snap.current && (olderAttempts.get(id) ?? 0) < 6) {
        olderAttempts.set(id, (olderAttempts.get(id) ?? 0) + 1)
        try {
          const s = session as { loadOlder?: () => Promise<unknown> }
          const p = s.loadOlder?.()
          if (p !== undefined) p.catch(() => { /* 补载失败：下次轮次重试 */ })
        } catch { /* 同上 */ }
      }
    }
  } catch { /* 提取链路异常不影响展示过滤 */ }
  // 展示过滤：清洗各标题展示面的叶子文本。
  try {
    for (const el of collectTitleLeaves()) applyTitleFilter(ctx, el)
  } catch { /* 单个叶子异常忽略 */ }
}

/**
 * 启动会话标题元素引用过滤装饰。
 * @param ctx - 客户端 cordis 上下文（只需 sessions 面，用于列表变更补扫）。
 * @returns dispose。
 */
export function startSessionTitleFilter(ctx: Pick<ClientContext, 'sessions'>): () => void {
  loadTitleTextCache()
  let raf = 0
  const schedule = (): void => {
    if (raf !== 0) return
    raf = requestAnimationFrame(() => {
      raf = 0
      decorateAll(ctx)
    })
  }
  const mo = new MutationObserver(schedule)
  mo.observe(document.body, { childList: true, subtree: true })
  const unsubSessions = ctx.sessions.list.subscribe(schedule)
  schedule()
  return () => {
    mo.disconnect()
    unsubSessions()
    if (raf !== 0) cancelAnimationFrame(raf)
  }
}
