/**
 * 官方插件管理页的琉璃图标适配。
 *
 * 官方卡片把内置 artwork 和第三方 manifest image 混用；这里仅替换它们的
 * 可见图形，保留原有按钮、Switch、卡片 DOM 与插件身份。按功能用几种
 * Material glyph（未知插件回退 extension），统一用主题色；悬停图标或卡片
 * 标题仍可看到插件名与包标识。
 */

const STYLE_ID = 'liuli-plugin-manager-icons'
const OWNER_SELECTOR = [
  '[data-plugin-package]',
  '[data-plugin-item]',
  '[data-plugin-row]',
  '[data-plugin-detail]',
  '[data-plugin-item-detail]',
  '[data-plugin-row-detail]',
].join(', ')
const ICON_SELECTOR = '[class*="_cardIcon"], [class*="_rowIcon"]'

// Material Symbols (24px). SVG masks inherit the active Liuli theme color
// without another font request. Six semantic glyphs plus extension fallback
// keep a long mixed official/third-party list easy to scan.
const material = (path: string): string =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${path}"/></svg>`)}")`
const GLYPHS = {
  extension: material('M20 11h-1V4c0-1.1-.9-2-2-2h-7v1c0 1.1-.9 2-2 2S6 4.1 6 3V2H4c-1.1 0-2 .9-2 2v7h1c1.1 0 2 .9 2 2s-.9 2-2 2H2v5c0 1.1.9 2 2 2h5v-1c0-1.1.9-2 2-2s2 .9 2 2v1h5c1.1 0 2-.9 2-2v-5h1c1.1 0 2-.9 2-2s-.9-2-2-2z'),
  terminal: material('M20 3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Zm0 16H4V7h16v12ZM6 9l3 3-3 3 1.4 1.4L11.8 12 7.4 7.6 6 9Zm6 6h6v2h-6v-2Z'),
  loop: material('M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.95-.69 2.78l1.46 1.46A7.88 7.88 0 0 0 20 12c0-4.42-3.58-8-8-8Zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.95.69-2.78L5.23 7.76A7.88 7.88 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3Z'),
  group: material('M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3Zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z'),
  search: material('M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 14 15.5l.27.28v.79l5 4.99L20.49 20l-4.99-5Zm-5 0A4.5 4.5 0 1 1 10.5 5a4.5 4.5 0 0 1 0 9Z'),
  palette: material('M12 3a9 9 0 0 0 0 18h1.66c1.29 0 2.34-1.05 2.34-2.34 0-.91-.53-1.72-1.28-2.1-.46-.25-.72-.7-.72-1.22 0-.74.6-1.34 1.34-1.34H18c1.66 0 3-1.34 3-3 0-4.97-4.03-9-9-9ZM6.5 12C5.67 12 5 11.33 5 10.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12Zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5 11 5.67 11 6.5 10.33 8 9.5 8Zm5 0C13.67 8 13 7.33 13 6.5S13.67 5 14.5 5 16 5.67 16 6.5 15.33 8 14.5 8Zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9 19 9.67 19 10.5 18.33 12 17.5 12Z'),
  key: material('M7 14a5 5 0 1 1 4.9-6H22v3h-2v2h-2v2h-6.1A5 5 0 0 1 7 14Zm0-3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'),
  add: material('M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z'),
  refresh: material('M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.93 9h-2.02A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z'),
  chevronDown: material('M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41Z'),
  chevronLeft: material('M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12l4.58-4.59Z'),
  chevronRight: material('M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12l-4.58 4.59Z'),
  close: material('M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z'),
  trash: material('M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1ZM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7Z'),
  warning: material('M12 5.99 19.53 19H4.47L12 5.99ZM1 21h22L12 2 1 21Zm10-3h2v-2h-2v2Zm0-4h2v-4h-2v4Z'),
  success: material('M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9Z'),
} as const

type Glyph = keyof typeof GLYPHS
type ActionIcon = { selector: string; glyph: Glyph; size?: number; place?: 'left' | 'right' | 'safety' }

/** Keep the existing SVG's layout box, drawing a Material mask over it. */
function actionRule({ selector, glyph, size = 16, place }: ActionIcon): string {
  const position = place === 'left' ? 'left: 0; top: 50%; transform: translateY(-50%);'
    : place === 'right' ? 'right: 0; top: 50%; transform: translateY(-50%);'
      : place === 'safety' ? 'left: 12px; top: 10px;'
        : 'left: 50%; top: 50%; transform: translate(-50%, -50%);'
  return `${selector} { position: relative; }
${selector} > svg { visibility: hidden; }
${selector}::after {
  content: '';
  position: absolute;
  ${position}
  width: ${size}px;
  height: ${size}px;
  background-color: currentColor;
  -webkit-mask: ${GLYPHS[glyph]} center / contain no-repeat;
  mask: ${GLYPHS[glyph]} center / contain no-repeat;
  pointer-events: none;
}`
}

const ACTION_ICONS: readonly ActionIcon[] = [
  { selector: '[data-plugin-panel] button[class*="_iconButton"] > [class*="_iconWrap"]', glyph: 'refresh' },
  { selector: '[data-plugin-panel] button[class*="_addButton"] > [class*="_icon"]', glyph: 'add', size: 16 },
  { selector: '[data-plugin-panel] button[class*="_rowOpen"]', glyph: 'chevronRight', place: 'right' },
  { selector: '[data-plugin-panel] button[class*="_crumb"]', glyph: 'chevronLeft', place: 'left' },
  { selector: '[data-plugin-panel] button[class*="_danger"] > [class*="_icon"]', glyph: 'trash', size: 14 },
  { selector: '[class*="_installDialog"] button[class*="_guideToggle"]', glyph: 'chevronDown', place: 'left' },
  { selector: '[class*="_installDialog"] button[class*="_registryToggle"]', glyph: 'chevronDown', place: 'right' },
  { selector: '[class*="_installDialog"] button[class*="_wizardBack"]', glyph: 'chevronLeft', place: 'left' },
  { selector: '[class*="_installDialog"] button[class*="_wizardClose"]', glyph: 'close', size: 14 },
  { selector: '[class*="_installDialog"] button[class*="_detailsToggle"]', glyph: 'chevronDown', place: 'right' },
  { selector: '[class*="_installDialog"] [class*="_guideSafety"]', glyph: 'warning', size: 14, place: 'safety' },
  { selector: '[class*="_installDialog"] [class*="_wizardIcon"][data-state="done"]', glyph: 'success', size: 28 },
  { selector: '[class*="_installDialog"] [class*="_wizardIcon"][data-state="error"]', glyph: 'warning', size: 28 },
]

const css = `
[data-plugin-panel] :is([data-plugin-package], [data-plugin-item]) > [class*="_cardHead"] > [class*="_cardIcon"],
[data-plugin-panel] [data-plugin-row] > [class*="_rowLine"] > [class*="_rowIcon"],
[data-plugin-panel] :is([data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]) > [class*="_detailTop"] [class*="_cardIcon"] {
  position: relative;
  color: var(--dsw-alias-brand-primary);
}
/* Functional glyphs are shared across cards, detail heads and component rows.
   A package's symbol is inherited by its rows unless their own identity overrides it. */
[data-plugin-panel] :is([data-plugin-item="shell"], [data-plugin-item-detail="shell"]) {
  --liuli-plugin-symbol: ${GLYPHS.terminal};
}
[data-plugin-panel] :is([data-plugin-item="agent-loop"], [data-plugin-item-detail="agent-loop"]) {
  --liuli-plugin-symbol: ${GLYPHS.loop};
}
[data-plugin-panel] :is([data-plugin-item="subagent"], [data-plugin-item-detail="subagent"]) {
  --liuli-plugin-symbol: ${GLYPHS.group};
}
[data-plugin-panel] :is([data-plugin-item="web-search"], [data-plugin-item-detail="web-search"]) {
  --liuli-plugin-symbol: ${GLYPHS.search};
}
[data-plugin-panel] :is([data-plugin-package*="liuli" i], [data-plugin-detail*="liuli" i], [data-plugin-row-detail*="liuli" i], [data-plugin-row*="liuli" i]) {
  --liuli-plugin-symbol: ${GLYPHS.palette};
}
[data-plugin-panel] :is([data-plugin-package*="provider" i], [data-plugin-package*="auth" i], [data-plugin-detail*="provider" i], [data-plugin-detail*="auth" i], [data-plugin-row-detail*="provider" i], [data-plugin-row-detail*="auth" i], [data-plugin-row*="provider" i], [data-plugin-row*="auth" i]) {
  --liuli-plugin-symbol: ${GLYPHS.key};
}
[data-plugin-panel] :is([data-plugin-package*="commandcode" i], [data-plugin-detail*="commandcode" i], [data-plugin-row-detail*="commandcode" i], [data-plugin-row*="commandcode" i]) {
  --liuli-plugin-symbol: ${GLYPHS.terminal};
}
[data-plugin-panel] :is([data-plugin-package], [data-plugin-item]) > [class*="_cardHead"] > [class*="_cardIcon"] > *,
[data-plugin-panel] [data-plugin-row] > [class*="_rowLine"] > [class*="_rowIcon"] > *,
[data-plugin-panel] :is([data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]) > [class*="_detailTop"] [class*="_cardIcon"] > * {
  visibility: hidden;
}
[data-plugin-panel] :is([data-plugin-package], [data-plugin-item]) > [class*="_cardHead"] > [class*="_cardIcon"]::before,
[data-plugin-panel] [data-plugin-row] > [class*="_rowLine"] > [class*="_rowIcon"]::before,
[data-plugin-panel] :is([data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]) > [class*="_detailTop"] [class*="_cardIcon"]::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 24px;
  height: 24px;
  transform: translate(-50%, -50%);
  background-color: currentColor;
  -webkit-mask: var(--liuli-plugin-symbol, ${GLYPHS.extension}) center / contain no-repeat;
  mask: var(--liuli-plugin-symbol, ${GLYPHS.extension}) center / contain no-repeat;
  pointer-events: none;
}
[data-plugin-panel] [data-plugin-row] > [class*="_rowLine"] > [class*="_rowIcon"]::before {
  width: 22px;
  height: 22px;
}
${ACTION_ICONS.map(actionRule).join('\n')}
/* The native chevrons flip when their disclosure opens; the replacement follows. */
[class*="_installDialog"] :is(button[class*="_guideToggle"], button[class*="_registryToggle"], button[class*="_detailsToggle"])[aria-expanded="true"]::after {
  transform: translateY(-50%) rotate(180deg);
}
/* Refresh is an icon-only control; keep its themed accent readable. */
[data-plugin-panel] button[class*="_iconButton"] > [class*="_iconWrap"] {
  color: var(--dsw-alias-brand-primary);
}
`

/** Plugin name plus stable identity for a native title tooltip. */
function identity(owner: HTMLElement): string | null {
  const id = owner.getAttribute('data-plugin-package')
    ?? owner.getAttribute('data-plugin-item')
    ?? owner.getAttribute('data-plugin-row')
    ?? owner.getAttribute('data-plugin-detail')
    ?? owner.getAttribute('data-plugin-item-detail')
    ?? owner.getAttribute('data-plugin-row-detail')
  if (id === null || id === '') return null
  const title = owner.querySelector<HTMLElement>(
    'button[class*="_cardOpen"], [class*="_rowId"], [class*="_detailTitle"], [data-plugin-name]',
  )?.textContent?.trim()
  return title === undefined || title === '' || title === id ? id : `${title} · ${id}`
}

/**
 * Install scoped styles and tooltip labels. Call once from the Liuli client
 * entry's ctx.effect; its disposer restores every title added here.
 */
export function startPluginManagerIcons(): () => void {
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = css
  document.head.appendChild(style)

  const originals = new Map<HTMLElement, string | null>()
  const setTooltip = (element: HTMLElement | null, value: string): void => {
    if (element === null) return
    if (!originals.has(element)) originals.set(element, element.getAttribute('title'))
    if (element.getAttribute('title') !== value) element.setAttribute('title', value)
  }
  const annotate = (owner: HTMLElement): void => {
    if (owner.closest('[data-plugin-panel]') === null) return
    const value = identity(owner)
    if (value === null) return
    setTooltip(owner.querySelector<HTMLElement>(ICON_SELECTOR), value)
    // The official card's title button stretches over its whole card. It
    // receives pointer events above the artwork, so its tooltip needs the ID.
    setTooltip(owner.querySelector<HTMLElement>('button[class*="_cardOpen"], button[class*="_rowOpen"]'), value)
  }
  const onEnter = (event: Event): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const owner = target.closest<HTMLElement>(OWNER_SELECTOR)
    if (owner !== null) annotate(owner)
  }
  document.addEventListener('pointerover', onEnter, true)
  document.addEventListener('focusin', onEnter, true)
  document.querySelector('[data-plugin-panel]')?.querySelectorAll<HTMLElement>(OWNER_SELECTOR).forEach(annotate)

  return () => {
    document.removeEventListener('pointerover', onEnter, true)
    document.removeEventListener('focusin', onEnter, true)
    style.remove()
    for (const [element, original] of originals) {
      if (!element.isConnected) continue
      if (original === null) element.removeAttribute('title')
      else element.setAttribute('title', original)
    }
  }
}
