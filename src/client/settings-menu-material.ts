/**
 * Settings and popup material corrections for the official desktop shell.
 * Keep this layer after liuliCss: the old generic `_menu` selector paints a
 * second fill over MenuSurface's own material, obscuring its noise and blur.
 */
export const settingsMenuMaterialCss = `
/* The settings dialog retains a visible response to Liuli's opacity slider.
   A permanent acrylic scrim keeps text legible over detailed wallpapers;
   the variable background underneath still responds across the full range. */
[data-shortcut-modal="settings"]::before {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55)) !important;
  background-image: var(--liuli-noise),
    linear-gradient(rgba(var(--liuli-acrylic-rgb), 0.55), rgba(var(--liuli-acrylic-rgb), 0.55)) !important;
}

/* The stock caption color is too muted against the dark translucent panel.
   Only explanatory copy is promoted, preserving the title/description order. */
body[data-ds-dark-theme] [data-shortcut-modal="settings"]
  :is([class$="_desc"], [class$="_description"], [class$="_hint"]) {
  color: var(--dsw-alias-label-secondary) !important;
}

/* The official settings-card token defaults to the solid layer-2 surface.
   Sharing Liuli's acrylic fill/stroke lets Account and other native settings
   cards use the same material as the already themed provider cards. */
[data-shortcut-modal="settings"] {
  --dsw-alias-settings-card-fill: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55));
  --dsw-alias-settings-card-stroke: var(--dsw-alias-border-l2);
}

/* AccountSection's identity card is identified by its immediate identity row;
   balanceCard has a unique local name. Avoid generic card selectors. */
[data-shortcut-modal="settings"] :is([class$="_card"]:has(> [class$="_identity"]), [class$="_balanceCard"]) {
  background-color: var(--dsw-alias-settings-card-fill) !important;
  background-image: var(--liuli-noise) !important;
  border-color: var(--dsw-alias-settings-card-stroke) !important;
  border-radius: var(--liuli-radius, 14px) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}
body[data-ds-dark-theme] [data-shortcut-modal="settings"] section:has(> [class$="_balanceCard"])
  :is([class$="_status"], [class$="_secondary"], [class$="_unavailable"]) {
  color: var(--dsw-alias-label-secondary) !important;
}
[data-shortcut-modal="settings"] section:has(> [class$="_balanceCard"])
  a[class*="_linkButton"]:not([class*="_primary"]) {
  border-color: var(--dsw-alias-border-l2) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  background-color: rgba(var(--liuli-control-rgb), 0.34) !important;
  background-image: var(--liuli-noise) !important;
}

/* GeneralSection's contributed items have a stable data-slot wrapper. The
   font stepper, selection pills and shortcut button currently use the solid
   module-platform fill with no border; scope these controls to that section
   so the Liuli Appearance page keeps its own slider/switch implementation. */
[data-shortcut-modal="settings"] [data-slot="settings.general.item"]
  :is([class$="_stepper"], button[class$="_selector"], [class$="_setting"] > button[class$="_button"]) {
  background-color: rgba(var(--liuli-acrylic-rgb), min(0.84, calc(var(--liuli-material-opacity, 0.55) + 0.2))) !important;
  background-image: var(--liuli-noise) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2) !important;
}
[data-shortcut-modal="settings"] [data-slot="settings.general.item"]
  :is(button[class$="_selector"], [class$="_setting"] > button[class$="_button"]):hover {
  background-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, rgba(var(--liuli-acrylic-rgb), 0.76)) !important;
}
[data-shortcut-modal="settings"] [data-slot="settings.general.item"] button[class*="_themeCube"] {
  border-color: var(--dsw-alias-border-l2) !important;
  border-radius: var(--liuli-radius, 14px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), 0.28) !important;
  background-image: var(--liuli-noise) !important;
}
[data-shortcut-modal="settings"] [data-slot="settings.general.item"] button[class*="_themeCube"][aria-pressed="true"] {
  border-color: var(--dsw-alias-brand-primary) !important;
  background-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, rgba(var(--liuli-acrylic-rgb), 0.64)) !important;
  box-shadow: var(--liuli-glow-brand) !important;
}

/* The native Switch's unchecked thumb inherited the primary-button ink,
   making it appear as an isolated accent dot on the dark track. */
[data-shortcut-modal="settings"] button[role="switch"] {
  background: rgba(var(--liuli-control-rgb), 0.82) !important;
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2) !important;
}
[data-shortcut-modal="settings"] button[role="switch"][aria-checked="true"] {
  background: var(--dsw-alias-button-primary-fill) !important;
}
[data-shortcut-modal="settings"] button[role="switch"][aria-checked="false"] > [class$="_thumb"] {
  background: var(--dsw-alias-label-primary) !important;
}
[data-shortcut-modal="settings"] button[role="switch"][aria-checked="true"] > [class$="_thumb"] {
  background: var(--dsw-alias-label-primary-foreground) !important;
}

/* The dialog's own ::before already performs the strong wallpaper blur.
   Child controls keep their independent tint, noise, stroke and contrast, but
   do not resample the same backdrop for every row. The two inventory cards
   must retain their ::before tint layer because their roots are transparent. */
[data-shortcut-modal="settings"] :is(
  li[class*="rowCard"], li[class*="setupCard"], div[class*="addCard"],
  li[class*="rowCard"] div[class$="_editor"],
  li[class*="setupCard"] div[class$="_editor"],
  div[class*="addCard"] div[class$="_editor"],
  input[class$="_input"], [class*="_switcher"], [class*="_search"] input,
  [data-liuli-settings-trigger],
  [class$="_card"]:has(> [class$="_identity"]), [class$="_balanceCard"],
  [data-slot="settings.general.item"] [class$="_stepper"],
  [data-slot="settings.general.item"] button[class$="_selector"],
  [data-slot="settings.general.item"] [class$="_setting"] > button[class$="_button"]
) {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
[data-shortcut-modal="settings"]
  :is([class*="_MT6gCq_card"], [class*="_BDWblG_card"])::before {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

/* Official MenuSurface supplies its own isolated material child.  Painting
   another 70% acrylic fill on the role=menu container doubles the tint and
   makes menus look unlike Liuli's other surfaces. */
[data-menu-material="translucent"] {
  background-color: transparent !important;
  background-image: none !important;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  box-shadow: var(--liuli-shadow) !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
[data-menu-material="translucent"] > [aria-hidden="true"][class*="_material"] {
  background-color: rgba(var(--liuli-acrylic-rgb), min(0.92, calc(var(--liuli-material-opacity, 0.55) + 0.3))) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}
[data-menu-material="translucent"] [class*="_groupTitle"] {
  background: transparent !important;
}

/* Plugin Manager's registry choices are portaled to body beside Modal.root.
   Upstream gives this panel z=1100 to clear its stock z=1000 modal, while
   Liuli raises Modal.root to 2147482800. Keep this one child popup between
   the modal and toast tiers so the list, radios and URL field stay clickable. */
fieldset[data-install-registry] {
  z-index: 2147482850 !important;
  pointer-events: auto;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), min(0.92, calc(var(--liuli-material-opacity, 0.55) + 0.3))) !important;
  background-image: var(--liuli-noise) !important;
  box-shadow: var(--liuli-shadow) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}
fieldset[data-install-registry] [class*="_registryOption"][data-checked="true"] {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 42%, transparent) !important;
  background-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, rgba(var(--liuli-acrylic-rgb), 0.68)) !important;
  background-image: var(--liuli-noise) !important;
}
fieldset[data-install-registry] input[class*="_registryCustomField"] {
  border-color: var(--dsw-alias-border-l2) !important;
  background-color: rgba(var(--liuli-control-rgb), 0.54) !important;
  background-image: var(--liuli-noise) !important;
}

/* Dom-owned Liuli context menus do not have a MenuSurface material child.
   The data anchor is exact; role=menu alone also occurs on layout wrappers. */
[data-liuli-context-menu] {
  background-color: rgba(var(--liuli-acrylic-rgb), min(0.92, calc(var(--liuli-material-opacity, 0.55) + 0.3))) !important;
  background-image: var(--liuli-noise) !important;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  box-shadow: var(--liuli-shadow) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}
[data-liuli-context-menu] {
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  overscroll-behavior: contain;
}

body[data-liuli-resizing] [data-shortcut-modal="settings"]::before,
body[data-liuli-resizing] [data-menu-material="translucent"] > [aria-hidden="true"][class*="_material"],
body[data-liuli-resizing] fieldset[data-install-registry],
body[data-liuli-resizing] [data-liuli-context-menu] {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
`
