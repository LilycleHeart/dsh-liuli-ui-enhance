/**
 * 全局元素选择器（复刻自 ui-preview 的 element-picker：纯 DOM 读取，无依赖）。
 * Pure element-description helpers for the preview element picker. They turn a
 * DOM element into a CSS selector and a compact structured description the
 * user can send to the agent. No React and no network: DOM reads only, so the
 * functions stay testable under jsdom.
 */

/** Structured facts about one picked element. */
export interface PickedElement {
  /** Lowercased tag name. */
  tag: string
  /** Best-effort unique CSS selector. */
  selector: string
  /** Non-class/id/style attributes as `name="value"` pairs, comma joined. */
  attributes: string
  /** Trimmed text content, truncated to 200 characters. */
  text: string
  /** Rounded bounding rect. */
  rect: { x: number; y: number; width: number; height: number }
  /** Computed text color, normalized to hex. */
  color: string
  /** Computed background color, normalized to hex. */
  background: string
  /** Computed font size + family (e.g. `13px -apple-system, …`). */
  font: string
}

/** Escape one identifier fragment for safe use inside a CSS selector. */
function escapeCss(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&')
}

/** One path segment of a selector: id, or tag + classes + nth-of-type disambiguation. */
function segment(el: Element): string {
  if (el.id !== '') return `#${escapeCss(el.id)}`
  const tag = el.tagName.toLowerCase()
  const classes = Array.from(el.classList).map(escapeCss)
  const base = classes.length === 0 ? tag : `${tag}.${classes.join('.')}`
  const parent = el.parentElement
  if (parent === null) return base
  const sameTag = Array.from(parent.children).filter(child => child.tagName === el.tagName)
  return sameTag.length > 1 ? `${base}:nth-of-type(${sameTag.indexOf(el) + 1})` : base
}

/**
 * Normalize a computed `rgb()`/`rgba()` color to uppercase hex; transparent,
 * alpha-blended, and non-rgb values stay as reported.
 * @param value - the computed color string.
 * @returns the hex form, or the original value.
 */
export function computedColor(value: string): string {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value)
  if (match === null) return value
  const r = Number(match[1])
  const g = Number(match[2])
  const b = Number(match[3])
  const alpha = match[4] === undefined ? 1 : Number(match[4])
  if (alpha === 0) return 'transparent'
  if (alpha < 1) return value
  const hex = (n: number): string => n.toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase()
}

/**
 * Build a best-effort unique CSS selector for an element, walking up to (but
 * not including) the body. Uses `el.ownerDocument.body` so the walk stays in
 * the element's own realm (the preview iframe has a different `document` than
 * the host page).
 * @param el - the target element.
 * @returns the selector string.
 */
export function computeSelector(el: Element): string {
  const parts: string[] = []
  let node: Element | null = el
  const body = el.ownerDocument.body
  while (node !== null && node !== body) {
    parts.unshift(segment(node))
    node = node.parentElement
  }
  return parts.join(' > ')
}

/**
 * Describe one element for the agent.
 * @param el - the picked element.
 * @returns structured facts.
 */
export function describeElement(el: Element): PickedElement {
  const rect = el.getBoundingClientRect()
  const styles = getComputedStyle(el)
  const attributes = Array.from(el.attributes)
    .filter(attr => attr.name !== 'class' && attr.name !== 'id' && attr.name !== 'style')
    .map(attr => `${attr.name}="${attr.value}"`)
    .join(', ')
  return {
    tag: el.tagName.toLowerCase(),
    selector: computeSelector(el),
    attributes,
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- DOM textContent is `string | null`.
    text: (el.textContent ?? '').trim().slice(0, 200),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    color: computedColor(styles.color),
    background: computedColor(styles.backgroundColor),
    font: `${styles.fontSize} ${styles.fontFamily}`.trim(),
  }
}

/**
 * Format a picked element as the draft text written back to the composer.
 * @param info - the picked element facts.
 * @returns a compact multiline description.
 */
export function formatSelection(info: PickedElement): string {
  const lines = [
    `[selected element] <${info.tag}>`,
    `selector: ${info.selector}`,
  ]
  if (info.attributes !== '') lines.push(`attributes: ${info.attributes}`)
  if (info.text !== '') lines.push(`text: ${info.text}`)
  lines.push(`rect: x=${info.rect.x} y=${info.rect.y} ${info.rect.width}x${info.rect.height}`)
  if (info.color !== '') lines.push(`color: ${info.color}`)
  if (info.background !== '') lines.push(`background: ${info.background}`)
  if (info.font !== '') lines.push(`font: ${info.font}`)
  return lines.join('\n')
}

/**
 * Format the composer chip label for one picked element: the localized
 * "element" prefix plus the tag and selector, so the chip card carries more
 * than the class alone.
 * @param prefix - the localized element-label prefix (e.g. `元素`).
 * @param info - the picked element facts.
 * @returns the chip label.
 */
export function formatChipLabel(prefix: string, info: PickedElement): string {
  return `${prefix}: <${info.tag}> ${info.selector}`
}

/** Cursor point inside the instrumented document's viewport. */
export interface PickerPoint {
  readonly x: number
  readonly y: number
}

/** Callbacks the live picker invokes. */
export interface PickerHandlers {
  /** Hover moved onto an element (null when the pointer left the document). */
  onHover?: (el: HTMLElement | null, point: PickerPoint) => void
  /** A click picked one element; the picker has already cleared its highlight. */
  onPick: (el: HTMLElement) => void
}

/** Narrow an event target to an element node (cross-realm safe via nodeType). */
function asElement(target: EventTarget | null): HTMLElement | null {
  if (target === null) return null
  const node = target as Node
  return node.nodeType === 1 ? node as unknown as HTMLElement : null
}

/**
 * Attach a transient element picker to a document: hover highlights the
 * element under the cursor with an outline and reports it through `onHover`,
 * click picks it. Elements inside `ignoreWithin` are skipped entirely (no
 * highlight, no pick, and their clicks keep their default behavior), so the
 * host picker can leave the preview panel's own chrome interactive. Returns
 * the detach function that restores the outline and cursor.
 * @param doc - the document to instrument (preview iframe or host page).
 * @param handlers - the hover and pick callbacks.
 * @param ignoreWithin - elements to skip, typically the panel's own root.
 * @returns detach function.
 */
export function attachElementPicker(
  doc: Document,
  handlers: PickerHandlers,
  ignoreWithin?: HTMLElement | null,
): () => void {
  let current: HTMLElement | null = null
  const previousOutlines = new Map<HTMLElement, string>()

  const highlight = (el: HTMLElement | null): void => {
    if (current === el) return
    if (current !== null) {
      current.style.outline = previousOutlines.get(current) ?? ''
      previousOutlines.delete(current)
    }
    current = el
    if (el !== null) {
      previousOutlines.set(el, el.style.outline)
      el.style.outline = '2px solid #4c8dff'
    }
  }

  // The crosshair cursor lives on the document root; a not-yet-loaded iframe
  // document may expose neither html nor body, so the cursor styling is
  // best-effort only (the DOM types claim documentElement is always present,
  // but jsdom iframe documents can be a bare Document).
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- jsdom iframe documents are a bare Document without html/body.
  const cursorRoot: HTMLElement | null = doc.documentElement ?? doc.body
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard: the DOM types claim documentElement is always present.
  const previousCursor = cursorRoot === null ? '' : cursorRoot.style.cursor
  // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard, see above.
  if (cursorRoot !== null) cursorRoot.style.cursor = 'crosshair'

  const skipped = (el: HTMLElement): boolean =>
    ignoreWithin !== undefined && ignoreWithin !== null && ignoreWithin.contains(el)

  const onMouseOver = (e: MouseEvent): void => {
    const el = asElement(e.target)
    if (el !== null && skipped(el)) {
      // Over the panel chrome: clear the highlight and hide the card, but
      // leave the pointer events alone so the chrome stays interactive.
      highlight(null)
      handlers.onHover?.(null, { x: e.clientX, y: e.clientY })
      return
    }
    highlight(el)
    handlers.onHover?.(el, { x: e.clientX, y: e.clientY })
  }
  const onClick = (e: MouseEvent): void => {
    const el = asElement(e.target)
    if (el === null || skipped(el)) return
    e.preventDefault()
    e.stopPropagation()
    highlight(null)
    handlers.onHover?.(null, { x: e.clientX, y: e.clientY })
    handlers.onPick(el)
  }

  doc.addEventListener('mouseover', onMouseOver, true)
  doc.addEventListener('click', onClick, true)
  return () => {
    highlight(null)
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard, see the attach-time cursor note.
    if (cursorRoot !== null) cursorRoot.style.cursor = previousCursor
    doc.removeEventListener('mouseover', onMouseOver, true)
    doc.removeEventListener('click', onClick, true)
  }
}
