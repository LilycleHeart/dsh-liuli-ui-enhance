/** Targeted Liuli materials for upstream surfaces that still paint stock fills. */
export const officialMaterialGapsCss = `
/* Official MenuSurface, task popovers and tool menus share these two tokens.
   A stronger minimum tint keeps small text readable over bright wallpapers. */
body,
html[data-platform='darwin'] body,
body[data-ds-dark-theme],
html[data-platform='darwin'] body[data-ds-dark-theme] {
  --dsw-menu-surface-fill: rgba(var(--liuli-acrylic-rgb), max(0.86, var(--liuli-material-opacity, 0.55))) !important;
  --dsw-specific-menu: var(--dsw-menu-surface-fill) !important;
  --dsw-menu-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* The official task manager is a root main page like Plugins. Its stock page
   and detail column both use the base solid fill. Keep the split divider. */
[data-testid='task-manager-page'] {
  background-color: rgba(var(--liuli-acrylic-rgb), max(0.88, var(--liuli-material-opacity, 0.55))) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

[data-testid='task-manager-page'] > [class$='_detail'] {
  background: rgba(var(--liuli-acrylic-rgb), 0.42) !important;
}

/* Changed-files card is paired with the already-themed presented-file card. */
[data-changed-files] {
  --changes-fill: rgba(var(--liuli-acrylic-rgb), max(0.74, var(--liuli-material-opacity, 0.55))) !important;
  --changes-hover: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, var(--changes-fill)) !important;
  background-color: var(--changes-fill) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
  border-color: var(--liuli-border-hairline) !important;
}

/* Answered ask_user_question transcript is a tool-row content card; preserve
   its question/answer hierarchy while replacing only the stock solid fill. */
[data-tool='ask_user_question'] :is(div, dl)[class$='_card'] {
  background-color: rgba(var(--liuli-acrylic-rgb), max(0.76, var(--liuli-material-opacity, 0.55))) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
  border-color: var(--liuli-border-hairline) !important;
}

/* Workflow summary strip is a control surface, not the content canvas. */
[data-workflow-run] [class$='_runHeader'] {
  background-color: rgba(var(--liuli-acrylic-rgb), max(0.72, var(--liuli-material-opacity, 0.55))) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
}

body[data-liuli-resizing] :is([data-testid='task-manager-page'], [data-changed-files],
  [data-tool='ask_user_question'] :is(div, dl)[class$='_card'], [data-workflow-run] [class$='_runHeader']) {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
`
