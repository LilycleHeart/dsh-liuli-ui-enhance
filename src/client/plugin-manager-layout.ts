/**
 * Liuli reading surface for the official plugin manager.
 *
 * The upstream page is transparent, capped at 960px and laid out as one long
 * column. Give its header and each content section the same separate acrylic
 * card used by the other dock regions, while preserving the upstream controls.
 */
export const pluginManagerLayoutCss = `
[data-testid='dock-shell'] [data-region-pane='region:conversation']:has([data-plugin-panel]) {
  /* The page's scrollport needs its own 8px shadow clearance. Transfer the
     existing region inset here so the cards still line up with other panes. */
  padding: 0 !important;
}

[data-plugin-panel] {
  gap: calc(2 * var(--liuli-dock-padding, 8px)) !important;
  padding: var(--liuli-dock-padding, 8px) !important;
  color: var(--dsw-alias-label-primary) !important;
  background: transparent !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

[data-plugin-panel] > * {
  max-width: none !important;
}

/* Like the Conversation body card, each main content surface takes the
   remaining column height. If the list exceeds it, the official page scrolls. */
[data-plugin-panel] > :is([data-plugin-group], [data-plugin-detail],
  [data-plugin-item-detail], [data-plugin-row-detail]) {
  flex: 1 0 auto;
}

/* One independent surface per header/list/detail, as on the conversation and
   right dock. Material is on ::before: the page may host fixed menus/modals. */
[data-plugin-panel] > :is(header[data-window-drag], [data-plugin-group],
  [data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]) {
  position: relative;
  z-index: 1;
  isolation: isolate;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1) !important;
  border-radius: var(--liuli-window-radius, var(--liuli-radius, 14px)) !important;
  background: transparent !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

[data-plugin-panel] > :is(header[data-window-drag], [data-plugin-group],
  [data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail])::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity));
  background-image: var(--liuli-noise);
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  pointer-events: none;
}

[data-plugin-panel] > header[data-window-drag]::before {
  -webkit-backdrop-filter: var(--liuli-material-blur);
  backdrop-filter: var(--liuli-material-blur);
}

body[data-liuli-resizing] [data-plugin-panel] > :is(header[data-window-drag], [data-plugin-group],
  [data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail])::before {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

[data-plugin-panel] > header[data-window-drag] {
  min-height: 78px;
  align-items: center;
  padding: 12px 20px !important;
}

[data-plugin-panel] [class*="_pageTitle"],
[data-plugin-panel] [class*="_groupTitle"],
[data-plugin-panel] [class*="_cardTitle"] {
  color: var(--dsw-alias-label-primary) !important;
  font-weight: 600 !important;
}

[data-plugin-panel] [class*="_pageIntro"],
[data-plugin-panel] [class*="_cardDesc"],
[data-plugin-panel] [class*="_count"] {
  color: var(--dsw-alias-label-secondary) !important;
  opacity: 1 !important;
  text-shadow: var(--liuli-text-depth);
}

[data-plugin-panel] [data-plugin-group] {
  container-type: inline-size;
  gap: 8px !important;
  padding: 14px 16px;
}

[data-plugin-panel] [data-plugin-group] > ul {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  gap: 8px !important;
}

@container (min-width: 940px) {
  [data-plugin-panel] [data-plugin-group] > ul {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

[data-plugin-panel] :is(li[data-plugin-package], li[data-plugin-item]) {
  min-width: 0;
  margin: 0 !important;
  border: 1px solid var(--liuli-border-hairline);
  border-radius: var(--liuli-radius-sm, 10px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), min(0.82, calc(var(--liuli-material-opacity) + 0.15)));
  background-image: var(--liuli-noise);
  transition: background-color 140ms ease, border-color 140ms ease;
}

[data-plugin-panel] :is(li[data-plugin-package], li[data-plugin-item]):is(:hover, :focus-within) {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 46%, transparent);
  background-color: rgba(var(--liuli-acrylic-rgb), min(0.9, calc(var(--liuli-material-opacity) + 0.22)));
}

[data-plugin-panel] :is(li[data-plugin-package], li[data-plugin-item]) > [class*="_cardHead"] {
  min-height: 58px;
  gap: 10px !important;
  padding: 7px 10px !important;
}

[data-plugin-panel] :is(li[data-plugin-package], li[data-plugin-item]) [class*="_cardIcon"] {
  width: 40px !important;
  height: 40px !important;
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  background-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}

[data-plugin-panel] :is(li[data-plugin-package], li[data-plugin-item]) [class*="_cardMain"] {
  gap: 2px !important;
}

[data-plugin-panel] :is(li[data-plugin-package], li[data-plugin-item]) [class*="_cardOpen"] {
  font-size: 13.5px !important;
  line-height: 19px !important;
}

[data-plugin-panel] :is(li[data-plugin-package], li[data-plugin-item]) [class*="_cardDesc"] {
  -webkit-line-clamp: 2 !important;
  font-size: 12.5px !important;
  line-height: 17px !important;
}

[data-plugin-panel] :is([data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]) {
  box-sizing: border-box;
  padding: 16px 20px 24px;
}

[data-plugin-panel] :is([data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]) [class*="_detailTop"] {
  padding-top: 0 !important;
}

[data-plugin-panel] :is([data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]) [class*="_detailHead"] {
  margin-top: 18px !important;
}

[data-plugin-panel] :is([data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]) [class*="_detailMain"] {
  margin-top: 14px !important;
}

[data-plugin-panel] :is([data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]) [class*="_detailSections"] {
  gap: 20px !important;
  margin-top: 20px !important;
}

[data-plugin-panel] [data-plugin-rows] [data-plugin-row] {
  padding: 8px 2px !important;
}

@container (max-width: 560px) {
  [data-plugin-panel] [data-plugin-group] {
    padding: 9px;
  }
  [data-plugin-panel] :is(li[data-plugin-package], li[data-plugin-item]) > [class*="_cardHead"] {
    padding: 6px 8px !important;
  }
  [data-plugin-panel] :is(li[data-plugin-package], li[data-plugin-item]) [class*="_cardDesc"] {
    -webkit-line-clamp: 1 !important;
  }
}
`
