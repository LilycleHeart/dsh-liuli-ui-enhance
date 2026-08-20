/**
 * 全局元素选择器（实现自 ui-preview 的 element-picker：纯 DOM 读取，无依赖）。
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
 * host picker can leave the preview panel's own chrome interactive.
 *
 * While active, the picker freezes the page at the event level: hover-open
 * events (`mouseover`/`mouseenter`) are allowed through so hover UI can still
 * appear, while `mouseout`/`mouseleave` are swallowed so that hover menus and
 * popups stay open even after the pointer leaves them. Clicks, pointer
 * presses, wheel, and touch scrolling are also intercepted so the page cannot
 * react to the picker's cursor. It also temporarily forces `pointer-events:
 * auto` on page elements so disabled, click-through (`pointer-events: none`),
 * and input elements can be highlighted and picked.
 *
 * Returns the detach function that restores the outline and cursor.
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
  let lastHovered: HTMLElement | null = null
  let lastPoint: { x: number; y: number } | null = null
  const previousOutlines = new Map<HTMLElement, string>()

  const highlight = (el: HTMLElement | null): void => {
    if (current === el) return
    if (current !== null) {
      current.style.outline = previousOutlines.get(current) ?? ''
      previousOutlines.delete(current)
    }
    current = el
    if (el !== null) {
      lastHovered = el
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

  const isPickerUI = (el: HTMLElement): boolean =>
    el.hasAttribute?.('data-liuli-picker-ignore') === true

  // Full-viewport layers that are normally click-through would, once forced to
  // pointer-events:auto, sit above everything and make the picker stick to one
  // class. Remember them so targetAt can skip them and keep selecting the real
  // content underneath.
  const skipOverlays = new Set<HTMLElement>()
  const view = doc.defaultView
  if (view !== null) {
    const vw = view.innerWidth
    const vh = view.innerHeight
    const overlayHost = doc.body ?? doc.documentElement
    if (overlayHost !== null && vw > 0 && vh > 0) {
      for (const el of Array.from(overlayHost.querySelectorAll<HTMLElement>('*'))) {
        if (getComputedStyle(el).pointerEvents !== 'none') continue
        const rect = el.getBoundingClientRect()
        if (rect.width >= vw - 1 && rect.height >= vh - 1) skipOverlays.add(el)
      }
    }
  }

  // While picking, force every page element to be pointer-events: auto so the
  // picker can hit-test elements that are normally click-through
  // (pointer-events: none), disabled, or otherwise not interactive. The picker's
  // own UI is excluded via [data-liuli-picker-ignore].
  const pickerStyle = doc.createElement('style')
  pickerStyle.setAttribute('data-liuli-picker-style', '')
  pickerStyle.textContent = '*:not([data-liuli-picker-ignore]) { pointer-events: auto !important; }'
  const styleHost = doc.head ?? doc.documentElement
  if (styleHost !== null) styleHost.appendChild(pickerStyle)

  // Resolve the topmost pickable element at a viewport point. `elementsFromPoint`
  // is used when available because it returns the full paint-order stack; this
  // lets us skip picker UI and still select elements that do not receive native
  // pointer events (disabled inputs, pointer-events:none layers, etc.).
  const targetAt = (x: number, y: number): HTMLElement | null => {
    const stack = typeof doc.elementsFromPoint === 'function'
      ? doc.elementsFromPoint(x, y)
      : (() => {
          const el = doc.elementFromPoint(x, y)
          return el === null ? [] : [el]
        })()
    for (const el of stack) {
      if (el === null || el.nodeType !== 1) continue
      const h = el as HTMLElement
      if (isPickerUI(h) || skipped(h) || skipOverlays.has(h)) continue
      return h
    }
    return null
  }

  // Freeze the page at the event level instead of covering it with an opaque
  // layer: `mouseover`/`mouseenter` are allowed through so hover UI can still
  // open (e.g. the turn-rail capsule), while `mouseout`/`mouseleave` are
  // swallowed so that hover UI stays open after the pointer leaves. Pointer
  // presses, clicks, wheel, and touch scrolling are also intercepted so the
  // page cannot react to the picker's cursor.
  const onPointerEvent = (e: Event): void => {
    const mouse = e as MouseEvent
    // For leave events keep the original target (the element being left);
    // for hover/pick use the real topmost element at the cursor so disabled
    // and click-through elements can still be selected.
    const el = e.type === 'mouseout' || e.type === 'mouseleave'
      ? asElement(e.target)
      : targetAt(mouse.clientX, mouse.clientY)
    if (el === null) return

    if (skipped(el) || isPickerUI(el)) {
      // Over the panel chrome: clear the highlight and hide the card, but
      // leave the pointer events alone so the chrome stays interactive.
      if (e.type === 'mouseover' || e.type === 'mousemove') {
        highlight(null)
        handlers.onHover?.(null, { x: mouse.clientX, y: mouse.clientY })
      }
      return
    }

    switch (e.type) {
      case 'mouseover':
        // Let the page open hover content, and update the picker highlight.
        lastPoint = { x: mouse.clientX, y: mouse.clientY }
        highlight(el)
        handlers.onHover?.(el, { x: mouse.clientX, y: mouse.clientY })
        break
      case 'mousemove':
        lastPoint = { x: mouse.clientX, y: mouse.clientY }
        highlight(el)
        handlers.onHover?.(el, { x: mouse.clientX, y: mouse.clientY })
        e.stopPropagation()
        break
      case 'mouseout':
      case 'mouseleave':
        // Keep hover UI open when the pointer leaves the element.
        e.stopPropagation()
        break
      case 'mousedown':
      case 'wheel':
      case 'touchmove':
        // Keep focus on the currently focused element and block outside presses;
        // wheel/touchmove must not scroll or pan the page while picking.
        e.preventDefault()
        e.stopPropagation()
        break
      case 'mouseup':
        e.stopPropagation()
        break
      case 'click':
        e.preventDefault()
        e.stopPropagation()
        highlight(null)
        handlers.onHover?.(null, { x: mouse.clientX, y: mouse.clientY })
        handlers.onPick(el)
        break
      // mouseenter is intentionally not stopped: it lets hover UI open.
    }
  }

  const eventTypes = [
    'mouseover',
    'mouseout',
    'mouseenter',
    'mouseleave',
    'mousemove',
    'mousedown',
    'mouseup',
    'click',
    'wheel',
    'touchmove',
  ] as const
  for (const type of eventTypes) {
    if (type === 'wheel' || type === 'touchmove') {
      doc.addEventListener(type, onPointerEvent, { capture: true, passive: false })
    } else {
      doc.addEventListener(type, onPointerEvent, true)
    }
  }

  return () => {
    highlight(null)
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- runtime guard, see the attach-time cursor note.
    if (cursorRoot !== null) cursorRoot.style.cursor = previousCursor
    for (const type of eventTypes) {
      doc.removeEventListener(type, onPointerEvent, true)
    }
    if (pickerStyle.isConnected) pickerStyle.remove()
    // Let hover UI know the picker is gone; while picking we swallowed
    // mouseout/mouseleave, so replay a leave on the last hovered element to
    // avoid leaving a frozen capsule/tooltip visible after detach. If the
    // pointer is still over that element, leave the native hover state alone.
    if (lastHovered !== null && lastHovered.isConnected) {
      const stillOver = lastPoint !== null && (() => {
        const hit = doc.elementFromPoint(lastPoint.x, lastPoint.y)
        return hit !== null && (hit === lastHovered || lastHovered.contains(hit))
      })()
      if (!stillOver) {
        lastHovered.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
      }
    }
  }
}
