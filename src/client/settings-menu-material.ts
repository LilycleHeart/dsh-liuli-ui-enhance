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
body[data-liuli-resizing] [data-liuli-context-menu] {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
`
