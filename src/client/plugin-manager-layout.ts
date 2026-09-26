/**
 * Liuli reading surface for the official plugin manager.
 *
 * The upstream page is transparent, capped at 960px and laid out as one long
 * column. On an image wallpaper its secondary text sits directly on the image.
 * These selectors stay under the manager's stable data attributes so the
 * official page, forms, switches, install flow and navigation keep ownership.
 */
export const pluginManagerLayoutCss = `
[data-plugin-panel] {
  gap: 16px !important;
  padding-right: clamp(12px, 2vw, 28px) !important;
  padding-left: clamp(12px, 2vw, 28px) !important;
  padding-bottom: 24px !important;
  color: var(--dsw-alias-label-primary) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), max(0.88, var(--liuli-material-opacity, 0.55))) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

body[data-liuli-resizing] [data-plugin-panel] {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

[data-plugin-panel] > * {
  max-width: 1480px !important;
}

[data-plugin-panel] > header[data-window-drag] {
  padding-top: 20px !important;
}

[data-plugin-panel] [class*="_pageTitle"],
[data-plugin-panel] [class*="_groupTitle"],
[data-plugin-panel] [class*="_cardTitle"] {
  color: var(--dsw-alias-label-primary) !important;
  font-weight: 650 !important;
}

[data-plugin-panel] [class*="_pageIntro"],
[data-plugin-panel] [class*="_cardDesc"],
[data-plugin-panel] [class*="_count"] {
  color: var(--dsw-alias-label-secondary) !important;
  opacity: 1 !important;
}

[data-plugin-panel] [data-plugin-group] {
  box-sizing: border-box;
  container-type: inline-size;
  gap: 10px !important;
  padding: 12px 14px 14px;
  border: 1px solid var(--liuli-border-hairline);
  border-radius: var(--liuli-radius, 14px);
  background-color: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 18%, transparent);
  box-shadow: var(--liuli-shadow-subtle, 0 1px 3px rgba(0, 0, 0, .08));
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
  background-color: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 34%, transparent);
  transition: background-color 140ms ease, border-color 140ms ease;
}

[data-plugin-panel] :is(li[data-plugin-package], li[data-plugin-item]):is(:hover, :focus-within) {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 46%, transparent);
  background-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 11%, var(--dsw-alias-bg-layer-2));
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
  max-width: 1020px !important;
  padding: 0 18px 24px;
  border: 1px solid var(--liuli-border-hairline);
  border-radius: var(--liuli-radius, 14px);
  background-color: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 24%, transparent);
}

[data-plugin-panel] :is([data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]) [class*="_detailTop"] {
  padding-top: 18px !important;
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
