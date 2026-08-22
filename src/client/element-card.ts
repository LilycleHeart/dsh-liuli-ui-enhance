/**
 * 元素引用卡片（浏览器侧展示层）。
 *
 * 元素选择器把拾取结果序列化为 `formatSelection` 的纯文本随用户消息发送；
 * 官方用户气泡只会把 `/name` / `@name` 装饰成 chip，不会把
 * `[selected element] ...` 识别成卡片。本模块用 MutationObserver 在用户
 * 气泡中把这段结构化文本替换为卡片 DOM，让“用户发送的网页元素”在聊天记录里
 * 也以卡片形态展示。模型侧看到的仍是原始序列化文本，不受影响。
 */
import type { PickedElement } from './element-picker.ts'

/** formatSelection 输出的元素块起始标记。 */
const ELEMENT_MARKER = '[selected element]'
/** 元素块头部行，如 `[selected element] <div>`。 */
const HEADER_RE = /^\[selected element\]\s*<([^>]+)>$/
/** 结构化字段行。 */
const FIELD_RE = /^(selector|attributes|text|rect|color|background|font):\s*(.*)$/

/**
 * 解析 formatSelection 生成的元素文本。
 *
 * 严格单行解析：每个字段占一行，不做多行续行。formatSelection 输出的
 * text 字段已是 trim+slice 的单行字符串，无需续行；旧的“text 字段允许跨行”
 * 逻辑会把元素块之后紧跟的用户消息文本吞进卡片，已移除。
 * @param text - 元素块文本（header + 字段行）。
 * @returns 结构化元素信息；无法识别时返回 null。
 */
export function parseSelectionText(text: string): PickedElement | null {
  const lines = text.split('\n')
  const header = HEADER_RE.exec(lines[0]?.trim() ?? '')
  if (header === null) return null

  const info: PickedElement = {
    tag: header[1] ?? 'element',
    selector: '',
    attributes: '',
    text: '',
    rect: { x: 0, y: 0, width: 0, height: 0 },
    color: '',
    background: '',
    font: '',
  }

  for (const rawLine of lines.slice(1)) {
    const m = FIELD_RE.exec(rawLine)
    if (m === null) continue
    const key = m[1] as 'selector' | 'attributes' | 'text' | 'rect' | 'color' | 'background' | 'font'
    const value = m[2] ?? ''
    if (key === 'selector') info.selector = value
    else if (key === 'attributes') info.attributes = value
    else if (key === 'text') info.text = value
    else if (key === 'color') info.color = value
    else if (key === 'background') info.background = value
    else if (key === 'font') info.font = value
  }

  // rect 单独解析（格式与其它字段不同）。
  for (const rawLine of lines.slice(1)) {
    const m = /^rect:\s*x=(-?\d+) y=(-?\d+) (\d+)x(\d+)$/.exec(rawLine)
    if (m !== null) {
      info.rect = {
        x: Number(m[1]),
        y: Number(m[2]),
        width: Number(m[3]),
        height: Number(m[4]),
      }
      break
    }
  }
  return info
}

/** 创建一行字段。 */
function row(label: string, value: string): HTMLElement | null {
  if (value === '') return null
  const el = document.createElement('div')
  el.className = 'liuli-element-card-row'
  const b = document.createElement('b')
  b.textContent = label + ': '
  el.append(b, document.createTextNode(value))
  return el
}

/**
 * 把结构化元素信息渲染成卡片 DOM。
 * @param info - 元素信息。
 * @returns 卡片元素。
 */
export function buildElementCard(info: PickedElement): HTMLElement {
  const card = document.createElement('div')
  card.className = 'liuli-element-card'
  card.setAttribute('data-liuli-element-card', '')

  const label = document.createElement('div')
  label.className = 'liuli-element-card-label'
  label.textContent = '网页元素'
  card.appendChild(label)

  // 详细字段默认隐藏，指针悬停 / 键盘聚焦时再展开。
  const details = document.createElement('div')
  details.className = 'liuli-element-card-details'
  const tagRow = row('tag', `<${info.tag}>`)
  if (tagRow !== null) details.appendChild(tagRow)
  // rect 紧随 tag，和 formatSelection 的字段顺序保持一致（短字段先于长 selector）。
  const rectRow = row('rect', `x=${info.rect.x} y=${info.rect.y} ${info.rect.width}x${info.rect.height}`)
  if (rectRow !== null) details.appendChild(rectRow)
  if (info.selector !== '') {
    const selectorRow = row('selector', info.selector)
    if (selectorRow !== null) details.appendChild(selectorRow)
  }
  for (const [label, value] of [
    ['attributes', info.attributes],
    ['text', info.text],
    ['color', info.color],
    ['background', info.background],
    ['font', info.font],
  ] as const) {
    const r = row(label, value)
    if (r !== null) details.appendChild(r)
  }
  if (details.childElementCount > 0) {
    card.appendChild(details)

    const showDetails = (): void => {
      details.style.display = 'block'
      const rect = card.getBoundingClientRect()
      const width = details.offsetWidth
      const height = details.offsetHeight
      const gap = 8
      let left = rect.left
      let top = rect.bottom + gap
      if (left + width > window.innerWidth - gap) {
        left = Math.max(gap, window.innerWidth - width - gap)
      }
      if (left < gap) left = gap
      if (top + height > window.innerHeight - gap) {
        top = Math.max(gap, rect.top - height - gap)
      }
      if (top < gap) top = gap
      details.style.left = `${left}px`
      details.style.top = `${top}px`
    }
    const hideDetails = (): void => {
      details.style.display = 'none'
    }

    card.addEventListener('mouseenter', showDetails)
    card.addEventListener('mouseleave', hideDetails)
    card.addEventListener('focusin', showDetails)
    card.addEventListener('focusout', hideDetails)
  }

  return card
}

/**
 * 在文本中搜索 [selected element] 标记，把元素块渲染成卡片，其余文字保持
 * 为原始 Text 节点（不包 div、不加 class），让用户消息文本完全沿用气泡
 * 本身的渲染。
 *
 * 标记可能出现在行首（serialize 已用换行包裹），也可能粘在用户文字后面
 * （旧消息或 chip 紧跟文字）。找到标记后：标记之前的文本 → 用户消息；
 * 从标记开始提取 header 行 + 后续 FIELD_RE 行（严格单行）→ 元素卡片；
 * 遇到非 FIELD_RE 行即结束元素块，该行及之后回到用户消息。
 * @param text - 原始文本。
 * @returns 渲染节点。
 */
export function renderTextWithElementCards(text: string): Node[] {
  const parts: Node[] = []
  let pos = 0
  while (pos < text.length) {
    const markerIdx = text.indexOf(ELEMENT_MARKER, pos)
    if (markerIdx === -1) {
      const rest = text.slice(pos)
      if (rest !== '') parts.push(document.createTextNode(rest))
      break
    }

    // 标记之前的文本 → 用户消息（保留原样，不包 div）
    if (markerIdx > pos) {
      const before = text.slice(pos, markerIdx)
      if (before !== '') parts.push(document.createTextNode(before))
    }

    // 从标记位置提取 header 行（标记到行尾）
    const lineEnd = text.indexOf('\n', markerIdx)
    const headerLine = lineEnd === -1 ? text.slice(markerIdx) : text.slice(markerIdx, lineEnd)

    if (HEADER_RE.test(headerLine.trim())) {
      // 收集后续 FIELD_RE 行（严格单行，不做多行续行，避免吞用户文字）
      const blockLines: string[] = [headerLine]
      let scanPos = lineEnd === -1 ? text.length : lineEnd + 1
      while (scanPos < text.length) {
        const nextEnd = text.indexOf('\n', scanPos)
        const line = nextEnd === -1 ? text.slice(scanPos) : text.slice(scanPos, nextEnd)
        if (!FIELD_RE.test(line.trim())) break
        blockLines.push(line)
        scanPos = nextEnd === -1 ? text.length : nextEnd + 1
      }
      const info = parseSelectionText(blockLines.join('\n'))
      if (info !== null) {
        parts.push(buildElementCard(info))
      } else {
        parts.push(document.createTextNode(blockLines.join('\n')))
      }
      pos = scanPos
    } else {
      // 标记存在但 header 不合法：把标记文本当普通文字，从标记之后继续扫描
      parts.push(document.createTextNode(headerLine))
      pos = lineEnd === -1 ? text.length : lineEnd + 1
    }
  }
  return parts
}

/**
 * 扫描一个容器内的用户气泡，把其中的元素引用文本替换为卡片。
 * @param root - 扫描根（通常是 document.body）。
 */
export function decorateElementCards(root: ParentNode): void {
  if (typeof document === 'undefined') return
  const bubbles = root.querySelectorAll<HTMLElement>('[class*="_bubble"]')
  for (const bubble of bubbles) {
    // 在气泡本身打标记（而非检查卡片是否存在）：直接替换 React 拥有的文本
    // 节点后，React re-render 会删掉卡片、恢复文本——若守卫检查卡片是否存在，
    // re-render 后卡片消失→重新处理→replaceWith→React 再恢复→死循环崩溃。
    // 气泡级 data 标记由本插件写入，React 不管理它，re-render 后仍留存，
    // 守卫持续生效，循环被截断（代价：re-render 后卡片不重建，不崩溃优先）。
    if (bubble.dataset.liuliCardDone === '1') continue
    // 只处理用户/steering 右对齐气泡，避免误伤 tooltip、assistant 引用等。
    const userRow = bubble.closest<HTMLElement>('[class*="_userRow"], [data-pending-steering]')
    if (userRow === null) continue

    const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT)
    const targets: Text[] = []
    while (walker.nextNode() !== null) {
      const node = walker.currentNode as Text
      if (node.nodeValue?.includes(ELEMENT_MARKER) !== true) continue
      if (node.parentElement === null) continue
      targets.push(node)
    }
    if (targets.length === 0) continue

    // 只替换命中的文本节点，保留容器内其它子元素（chip 等），
    // 这样即使消息文本和官方装饰混排也能正确包成卡片。
    for (const node of targets) {
      const nodes = renderTextWithElementCards(node.nodeValue ?? '')
      if (nodes.length === 0) continue
      const frag = document.createDocumentFragment()
      for (const n of nodes) frag.appendChild(n)
      node.replaceWith(frag)
    }
    bubble.dataset.liuliCardDone = '1'
  }

  // 待发送区 / 队列 dock 的预览文本：同样是纯文本，命中元素块就包成卡片。
  // 只匹配队列行里的 preview，避免误伤其它页面里的“预览”容器。
  const previews = root.querySelectorAll<HTMLElement>('li[class*="_row"] > span[class*="_preview"]')
  for (const preview of previews) {
    if (preview.dataset.liuliCardDone === '1') continue
    if (preview.children.length > 0) continue
    const text = preview.textContent ?? ''
    if (!text.includes(ELEMENT_MARKER)) continue
    const nodes = renderTextWithElementCards(text)
    if (nodes.length === 0) continue
    const frag = document.createDocumentFragment()
    for (const n of nodes) frag.appendChild(n)
    preview.replaceChildren(frag)
    preview.dataset.liuliCardDone = '1'
  }
}

/**
 * 启动用户气泡元素卡片装饰：初始扫描 + 监听 DOM 变化。
 * @returns disposer（插件 fiber 卸载时断开观察器）。
 */
/**
 * composer reference chip 卡片装饰的暂存区：元素选择器插入引用时登记最近一次
 * 元素信息，chip 装饰层（MutationObserver）据此给官方 chip 打
 * `data-liuli-element-chip` 标记并写入 `--liuli-chip-width`。只保留最近一条，
 * 每次插入引用都会覆盖；读取后不消耗（同一条引用可能被多次重渲染观察）。
 */
let lastComposerElementInfo: PickedElement | undefined

/** 登记最近一次插入 composer 的元素引用信息。 */
export function rememberComposerElementInfo(info: PickedElement): void {
  lastComposerElementInfo = info
}

/** 读取最近一次插入 composer 的元素引用信息（chip 装饰层用）。 */
export function getLastComposerElementInfo(): PickedElement | undefined {
  return lastComposerElementInfo
}

export function startElementCardDecoration(): () => void {
  let raf = 0
  const scan = (): void => {
    if (raf !== 0) return
    raf = requestAnimationFrame(() => {
      raf = 0
      decorateElementCards(document.body)
    })
  }

  scan()
  const observer = new MutationObserver(scan)
  // 不监听 characterData：流式输出时助手消息文本节点每几百毫秒变化一次，
  // characterData 会让 observer 每帧触发、对整个 body 跑 querySelectorAll，
  // 叠加 React 调和器与直接 DOM 改写的反馈循环，直接崩浏览器。
  // 元素卡片是结构问题（气泡新增/重挂载），只需 childList。
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    if (raf !== 0) cancelAnimationFrame(raf)
  }
}
