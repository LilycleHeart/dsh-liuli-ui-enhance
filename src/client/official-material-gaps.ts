/** Targeted Liuli materials for upstream surfaces that still paint stock fills. */
export const officialMaterialGapsCss = `
/* Official MenuSurface, task popovers and tool menus share these tokens.
   Match Liuli's menu tier: one opacity step above cards, capped at 0.92. */
body,
html[data-platform='darwin'] body,
body[data-ds-dark-theme],
html[data-platform='darwin'] body[data-ds-dark-theme] {
  --dsw-menu-surface-fill: rgba(var(--liuli-acrylic-rgb), min(0.92, calc(var(--liuli-material-opacity, 0.55) + 0.3))) !important;
  --dsw-specific-menu: var(--dsw-menu-surface-fill) !important;
  --dsw-menu-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* The task manager is another global main page. Match Liuli's two dock cards
   rather than painting a high-opacity sheet across the whole workspace. */
[data-testid='task-manager-page'] {
  gap: var(--liuli-dock-padding, 8px);
  background: transparent !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

[data-testid='task-manager-page'] > :is([class$='_listPane'], [class$='_detail']) {
  position: relative;
  z-index: 1;
  isolation: isolate;
  border: 1px solid var(--dsw-alias-border-l1) !important;
  border-radius: var(--liuli-window-radius, var(--liuli-radius, 14px));
  background: transparent !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow);
}

[data-testid='task-manager-page'] > :is([class$='_listPane'], [class$='_detail'])::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity));
  background-image: var(--liuli-noise);
  -webkit-backdrop-filter: var(--liuli-material-blur);
  backdrop-filter: var(--liuli-material-blur);
  pointer-events: none;
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

/* The active Conversation has a single wallpaper blur behind the transcript. */
div[data-phase='active'] [data-changed-files] {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
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

div[data-phase='active'] [data-tool='ask_user_question'] :is(div, dl)[class$='_card'],
div[data-phase='active'] [data-workflow-run] [class$='_runHeader'] {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

body[data-liuli-resizing] :is([data-changed-files],
  [data-tool='ask_user_question'] :is(div, dl)[class$='_card'], [data-workflow-run] [class$='_runHeader']) {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

body[data-liuli-resizing] [data-testid='task-manager-page'] > :is([class$='_listPane'], [class$='_detail'])::before {
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
`
