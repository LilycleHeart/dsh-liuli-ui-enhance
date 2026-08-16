/** 琉璃主题样式 —— denpa.css 的字符串化拷贝（运行时注入 <style>，幂等）。 */
export const denpaCss = `
/* ============================================================
 * DenpaPush 风格覆盖层 (DeepSeek Harness 复刻)
 * ------------------------------------------------------------
 * 在 design-platform.css 之后加载，整体替换 --dsw-* 语义令牌为
 * 电波推送 DenpaPush 的 M3 配色（亮/暗双主题），并注入字体、
 * 圆角、材质、泛光等外观令牌与全局铬色样式。
 * 源色 = Twitter 蓝 #1d9bf0 (M3 light/dark 派生)。
 * ============================================================ */

/* ── 字体与基础外观 (全局) ── */
:root {
  --dsw-font-family: "MiSans", "Inter", "Space Grotesk", "Segoe UI", system-ui,
    -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  --ds-font-family-code: "JetBrains Mono", "SF Mono", "Fira Code", Consolas,
    "Liberation Mono", Menlo, "PingFang SC", "Microsoft YaHei";
  --dsw-font-family-display: "MiSans", "Space Grotesk", "Segoe UI", system-ui, sans-serif;

  /* DenpaPush 外观令牌（供模块 CSS 引用；运行时按设置覆盖） */
  --denpa-radius: 14px;
  --denpa-radius-sm: 10px;
  --denpa-glow-strength: 0.15;
  --denpa-shadow-strength: 0.6;
  --denpa-material-opacity: 0.55;
  --denpa-material-blur: blur(18px) saturate(1.6);
  --denpa-acrylic-rgb: 221, 229, 237;
  --denpa-acrylic-rgb-low: 232, 238, 244;
  --denpa-acrylic-rgb-high: 200, 212, 223;
  --denpa-control-rgb: 210, 220, 230;
  --denpa-noise: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='linear' slope='0.045'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E");
  --denpa-text-depth: 0 1px 1px rgba(17, 20, 28, 0.14);
}

/* ════════════════════════════════════════════════════════════
 * 亮色主题 — DenpaPush M3 light (#1d9bf0 派生)
 * ════════════════════════════════════════════════════════════ */
body {
  /* 泛光/阴影（引用 body 级品牌令牌，必须在 body 上定义才能解析） */
  --denpa-glow-brand: 0 0 10px color-mix(in srgb, var(--dsw-alias-brand-primary) calc(var(--denpa-glow-strength) * 100%), transparent);
  --denpa-glow-brand-strong: 0 0 14px color-mix(in srgb, var(--dsw-alias-brand-primary) calc(var(--denpa-glow-strength) * 165%), transparent);
  --denpa-shadow: 0 2px 10px rgba(0, 0, 0, calc(0.4 * var(--denpa-shadow-strength)));

  /* 背景 */
  --dsw-alias-bg-base: #f8f9fa;
  --dsw-alias-bg-layer-1: #eaf0f4;
  --dsw-alias-bg-layer-2: #dde5ed;
  --dsw-alias-bg-layer-3: #d2dce6;
  --dsw-alias-bg-mask-1: rgba(0, 0, 0, 0.32);
  --dsw-alias-bg-mask-2: rgba(0, 0, 0, 0.12);
  --dsw-alias-bg-mask-3: rgba(0, 0, 0, 0.55);
  --dsw-alias-bg-mask-photo: rgba(0, 0, 0, 0.88);
  --dsw-alias-bg-mask-drop: rgba(255, 255, 255, 0.7);
  --dsw-alias-bg-module-platform: #f0f4f8;
  --dsw-alias-bg-multi-select: #eef2f6;
  --dsw-alias-bg-overlay: #dde5ed;
  --dsw-alias-bg-skeleton: rgba(0, 0, 0, 0.05);
  --dsw-alias-bg-mask-photo: rgba(0, 0, 0, 0.88);
  --dsw-alias-bg-mask-drop: rgba(255, 255, 255, 0.7);

  /* 描边 */
  --dsw-alias-border-inverted2: rgba(0, 0, 0, 0);
  --dsw-alias-border-inverted: rgba(0, 0, 0, 0);
  --dsw-alias-border-l1: rgba(15, 20, 28, 0.06);
  --dsw-alias-border-l2-darkmode-thin: rgba(15, 20, 28, 0.1);
  --dsw-alias-border-l2: rgba(15, 20, 28, 0.1);
  --dsw-alias-border-l3: rgba(15, 20, 28, 0.14);
  --dsw-alias-border-l4: rgba(15, 20, 28, 0.18);

  /* 品牌 */
  --dsw-alias-brand-primary-invert: #0c0e13;
  --dsw-alias-brand-primary-new-colorprimary-new-color: #0079bf;
  --dsw-alias-brand-primary: #0079bf;
  --dsw-alias-brand-text: #1a1c1e;
  --dsw-alias-button-contrast-fill: #52606d;
  --dsw-alias-button-elevated-fill: #f2f6fa;
  --dsw-alias-button-floating-fill: #f2f6fa;
  --dsw-alias-button-floating-hover: #e8eef4;
  --dsw-alias-button-ghost-active-border: #5e636b;
  --dsw-alias-button-ghost-active-fill: #e8eef4;
  --dsw-alias-button-ghost-active-hover: #dde5ed;
  --dsw-alias-button-info-fill: #0079bf;
  --dsw-alias-button-info-hover: #0085d1;
  --dsw-alias-button-primary-dimmed: rgba(0, 121, 191, 0.12);
  --dsw-alias-button-primary-fill: #0079bf;
  --dsw-alias-button-primary-hover: #0085d1;
  --dsw-alias-button-tool-bar-fill-invisible: rgba(31, 31, 31, 0.36);
  --dsw-alias-button-tool-bar-fill: rgba(84, 85, 87, 0.5);
  --dsw-alias-button-tool-bar-hover: rgba(84, 85, 87, 0.6);

  /* 交互 */
  --dsw-alias-interactive-bg-active: rgba(0, 121, 191, 0.1);
  --dsw-alias-interactive-bg-hover-accent: rgba(0, 121, 191, 0.09);
  --dsw-alias-interactive-bg-hover-danger: rgba(186, 26, 26, 0.05);
  --dsw-alias-interactive-bg-hover-solid: #e8eef4;
  --dsw-alias-interactive-bg-hover: rgba(0, 121, 191, 0.05);

  /* 文字 */
  --dsw-alias-label-caption: #5e636b;
  --dsw-alias-label-dimmed: #9aa0a6;
  --dsw-alias-label-primary-bluish: #001d33;
  --dsw-alias-label-primary-dimmed: #1a1c1e;
  --dsw-alias-label-primary-foreground: #ffffff;
  --dsw-alias-label-primary-inverted: #ffffff;
  --dsw-alias-label-primary: #1a1c1e;
  --dsw-alias-label-secondary: #43474e;
  --dsw-alias-label-tertiary: #5e636b;

  /* Markdown */
  --dsw-alias-markdown-citation: #eef2f6;
  --dsw-alias-markdown-code-block-banner: #f0f4f8;
  --dsw-alias-markdown-code-block: #eef2f6;
  --dsw-alias-markdown-code-segment-selected: #ffffff;
  --dsw-alias-markdown-code-segment-unselected: #e8eef4;
  --dsw-alias-markdown-inline-code: #e8eef4;
  --dsw-alias-markdown-placeholder: #f0f4f8;
  --dsw-alias-markdown-tag: #e8eef4;

  /* 滚动条 */
  --dsw-alias-scrollbar-bg-l1: #d8dde3;
  --dsw-alias-scrollbar-bg-l2: #c6cdd6;
  --dsw-alias-scrollbar-hover-l1: #c6cdd6;
  --dsw-alias-scrollbar-hover-l2: #b3bcc8;

  /* 状态 */
  --dsw-alias-state-business-primary: #0079bf;
  --dsw-alias-state-business-tertiary: #d0e8ff;
  --dsw-alias-state-error-primary: #ba1a1a;
  --dsw-alias-state-error-secondary: #ffdad6;
  --dsw-alias-state-success-primary: #006d3d;
  --dsw-alias-state-success-secondary: #69dd96;
  --dsw-alias-state-success-tertiary: #86fab1;
  --dsw-alias-state-warn-label: #815500;
  --dsw-alias-state-warn-primary: #815500;
  --dsw-alias-state-warn-secondary: #ffb94d;
  --dsw-alias-state-warn-tertiary: #ffddb2;

  /* 弹出/提示 */
  --dsw-alias-toast-bg: #1a1c1e;
  --dsw-alias-tooltip-bg: #2f3133;

  /* 专用 */
  --dsw-specific-bubble-highlight: #c4e2ff;
  --dsw-specific-bubble: #d0e8ff;
  --dsw-specific-bubble-fg: #001d33;
  --dsw-specific-input-major: rgba(var(--denpa-acrylic-rgb), 0.22);
  --dsw-specific-login-input: #f8f9fa;
  --dsw-specific-menu: var(--dsw-alias-bg-layer-3);
  --dsw-specific-selector: #eef2f6;
  --dsw-specific-sidebar-fill: rgba(var(--denpa-acrylic-rgb), var(--denpa-material-opacity));
  --dsw-specific-sidebar-nav-item-active-accent: #001d33;
  --dsw-specific-sidebar-nav-item-active: #d0e8ff;
  --dsw-specific-sidebar-nav-item-hover: rgba(0, 121, 191, 0.08);
  --dsw-specific-tip: rgba(var(--denpa-acrylic-rgb), 0.5);

  --denpa-acrylic-rgb: 221, 229, 237;
  --denpa-acrylic-rgb-low: 232, 238, 244;
  --denpa-acrylic-rgb-high: 200, 212, 223;
  --denpa-control-rgb: 210, 220, 230;
  --denpa-material-opacity: 0.55;
  --denpa-text-depth: 0 1px 1px rgba(17, 20, 28, 0.14);
  color-scheme: light;
}

/* ════════════════════════════════════════════════════════════
 * 暗色主题 — DenpaPush M3 dark (#1d9bf0 派生)
 * ════════════════════════════════════════════════════════════ */
body[data-ds-dark-theme] {
  /* 背景 */
  --dsw-alias-bg-base: #121316;
  --dsw-alias-bg-layer-1: #1e2530;
  --dsw-alias-bg-layer-2: #283040;
  --dsw-alias-bg-layer-3: #333d4e;
  --dsw-alias-bg-mask-1: rgba(0, 0, 0, 0.5);
  --dsw-alias-bg-mask-2: rgba(0, 0, 0, 0.2);
  --dsw-alias-bg-mask-3: rgba(0, 0, 0, 0.48);
  --dsw-alias-bg-mask-photo: rgba(0, 0, 0, 0.88);
  --dsw-alias-bg-mask-drop: rgba(39, 39, 48, 0.7);
  --dsw-alias-bg-module-platform: #1e2530;
  --dsw-alias-bg-multi-select: #333d4e;
  --dsw-alias-bg-overlay: #283040;
  --dsw-alias-bg-skeleton: rgba(255, 255, 255, 0.07);

  /* 描边 */
  --dsw-alias-border-inverted2: rgba(255, 255, 255, 0.08);
  --dsw-alias-border-inverted: rgba(255, 255, 255, 0.06);
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.07);
  --dsw-alias-border-l2-darkmode-thin: rgba(255, 255, 255, 0.07);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.11);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.16);
  --dsw-alias-border-l4: rgba(255, 255, 255, 0.2);

  /* 品牌 */
  --dsw-alias-brand-primary-invert: #121316;
  --dsw-alias-brand-primary-new-colorprimary-new-color: #8ecdf8;
  --dsw-alias-brand-primary: #8ecdf8;
  --dsw-alias-brand-text: #e2e2e6;
  --dsw-alias-button-contrast-fill: #bac8d8;
  --dsw-alias-button-elevated-fill: #1e2530;
  --dsw-alias-button-floating-fill: #283040;
  --dsw-alias-button-floating-hover: #333d4e;
  --dsw-alias-button-ghost-active-border: #8d9199;
  --dsw-alias-button-ghost-active-fill: #333d4e;
  --dsw-alias-button-ghost-active-hover: #3f4a5c;
  --dsw-alias-button-info-fill: #6bbcf5;
  --dsw-alias-button-info-hover: #8ecdf8;
  --dsw-alias-button-primary-dimmed: rgba(142, 205, 248, 0.14);
  --dsw-alias-button-primary-fill: #8ecdf8;
  --dsw-alias-button-primary-hover: #a0d6fa;
  --dsw-alias-button-tool-bar-fill-invisible: rgba(31, 31, 31, 0.36);
  --dsw-alias-button-tool-bar-fill: rgba(84, 85, 87, 0.5);
  --dsw-alias-button-tool-bar-hover: rgba(84, 85, 87, 0.6);

  /* 交互 */
  --dsw-alias-interactive-bg-active: rgba(255, 255, 255, 0.12);
  --dsw-alias-interactive-bg-hover-accent: rgba(142, 205, 248, 0.12);
  --dsw-alias-interactive-bg-hover-danger: rgba(255, 180, 171, 0.12);
  --dsw-alias-interactive-bg-hover-solid: #283040;
  --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.07);

  /* 文字 */
  --dsw-alias-label-caption: #9d9da3;
  --dsw-alias-label-dimmed: #5e636b;
  --dsw-alias-label-primary-bluish: #d0e8ff;
  --dsw-alias-label-primary-dimmed: #c6c6ca;
  --dsw-alias-label-primary-foreground: #003450;
  --dsw-alias-label-primary-inverted: #121316;
  --dsw-alias-label-primary: #e2e2e6;
  --dsw-alias-label-secondary: #c6c6ca;
  --dsw-alias-label-tertiary: #9d9da3;

  /* Markdown */
  --dsw-alias-markdown-citation: #191d24;
  --dsw-alias-markdown-code-block-banner: #1e2530;
  --dsw-alias-markdown-code-block: #191d24;
  --dsw-alias-markdown-code-segment-selected: #283040;
  --dsw-alias-markdown-code-segment-unselected: #1e2530;
  --dsw-alias-markdown-inline-code: #1e2530;
  --dsw-alias-markdown-placeholder: #191d24;
  --dsw-alias-markdown-tag: #1e2530;

  /* 滚动条 */
  --dsw-alias-scrollbar-bg-l1: #3f4a5c;
  --dsw-alias-scrollbar-bg-l2: #333d4e;
  --dsw-alias-scrollbar-hover-l1: #4d5a6e;
  --dsw-alias-scrollbar-hover-l2: #3f4a5c;

  /* 状态 */
  --dsw-alias-state-business-primary: #8ecdf8;
  --dsw-alias-state-business-tertiary: #004a73;
  --dsw-alias-state-error-primary: #ffb4ab;
  --dsw-alias-state-error-secondary: #ffb4ab;
  --dsw-alias-state-success-primary: #69dd96;
  --dsw-alias-state-success-secondary: #69dd96;
  --dsw-alias-state-success-tertiary: #00522d;
  --dsw-alias-state-warn-label: #ffb94d;
  --dsw-alias-state-warn-primary: #ffb94d;
  --dsw-alias-state-warn-secondary: #ffb94d;
  --dsw-alias-state-warn-tertiary: #624000;

  /* 弹出/提示 */
  --dsw-alias-toast-bg: #333d4e;
  --dsw-alias-tooltip-bg: #3f4a5c;

  /* 专用 */
  --dsw-specific-bubble-highlight: #005477;
  --dsw-specific-bubble: #004a73;
  --dsw-specific-bubble-fg: #d0e8ff;
  --dsw-specific-input-major: rgba(var(--denpa-acrylic-rgb), 0.22);
  --dsw-specific-login-input: #121316;
  --dsw-specific-menu: var(--dsw-alias-bg-layer-3);
  --dsw-specific-selector: #283040;
  --dsw-specific-sidebar-fill: rgba(var(--denpa-acrylic-rgb), var(--denpa-material-opacity));
  --dsw-specific-sidebar-nav-item-active-accent: #d0e8ff;
  --dsw-specific-sidebar-nav-item-active: #004a73;
  --dsw-specific-sidebar-nav-item-hover: rgba(142, 205, 248, 0.08);
  --dsw-specific-tip: rgba(var(--denpa-acrylic-rgb), 0.5);

  --denpa-acrylic-rgb: 30, 37, 48;
  --denpa-acrylic-rgb-low: 26, 32, 42;
  --denpa-acrylic-rgb-high: 63, 74, 92;
  --denpa-control-rgb: 51, 61, 78;
  --denpa-material-opacity: 0.5;
  --denpa-text-depth: 0 1px 2px rgba(0, 0, 0, 0.45);
  color-scheme: dark;
}

/* ════════════════════════════════════════════════════════════
 * 全局铬色样式
 * ════════════════════════════════════════════════════════════ */

/* 选中文本：品牌色底 */
::selection {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent);
}

/* 焦点环：品牌描边（与 DenpaPush --focus-ring 一致） */
:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent);
  outline-offset: 1px;
}

/* 提示浮层：统一使用主题 tooltip 令牌，避免宿主硬编码浅色底/白字 */
[role="tooltip"] {
  background: var(--dsw-alias-tooltip-bg) !important;
  color: var(--dsw-alias-label-primary-inverted) !important;
}
[role="tooltip"] * {
  color: inherit !important;
}

/* 滚动条：细、圆角、主题色 */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--dsw-alias-brand-primary) transparent;
}
*::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
*::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-brand-primary);
  border-radius: 8px;
  border: 2px solid transparent;
  background-clip: content-box;
}
*::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 80%, white);
  background-clip: content-box;
  border: 2px solid transparent;
}

/* 正文渲染细节：与 DenpaPush 一致的字重与文本阴影 */
body {
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 品牌高亮微泛光（用于侧栏活动项、主按钮等，按需挂类） */
.denpa-glow {
  box-shadow: var(--denpa-glow-brand);
}

/* TodoPanel 完成状态：跟随主题色而非成功绿 */
[data-testid="todo-panel"] li[data-status="completed"] svg {
  color: var(--dsw-alias-state-business-primary);
}

/* 壁纸暗色遮罩：只在暗色主题叠加（原项目 [data-theme="dark"] 选择器语义） */
[data-denpa-bg]::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0);
  pointer-events: none;
}

body[data-ds-dark-theme] [data-denpa-bg]::before {
  background: rgba(0, 0, 0, var(--denpa-scrim, 0.4));
}

/* ════════════════════════════════════════════════════════════
 * 主题切换圆形遮罩（照搬 DenpaPush ::view-transition）
 * ════════════════════════════════════════════════════════════ */
::view-transition-old(root) {
  animation: none;
  z-index: 1;
}

::view-transition-new(root) {
  z-index: 2;
  animation: denpa-vt-circle-reveal 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes denpa-vt-circle-reveal {
  from { clip-path: circle(0px at var(--vt-x, 50%) var(--vt-y, 50%)); }
  to   { clip-path: circle(var(--vt-r, 150%) at var(--vt-x, 50%) var(--vt-y, 50%)); }
}

@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation: none;
  }
}

/* ════════════════════════════════════════════════════════════
 * 对话页中间模糊缝修正：只挖掉 header 与 scrollBody 之间 12px 的
 * 壁纸模糊层，保留 header/正文卡片的亚克力磨砂。
 * --dsh-header-height 由 HeaderEffects 在运行时测量并写到 root 上。
 * ════════════════════════════════════════════════════════════ */
div[data-phase] > div[aria-hidden="true"]:first-child {
  --dsh-header-gap: 12px;
  -webkit-mask-image: var(--dsh-wallpaper-mask, linear-gradient(to bottom,
    #000 0,
    #000 var(--dsh-header-height, 80px),
    transparent var(--dsh-header-height, 80px),
    transparent calc(var(--dsh-header-height, 80px) + var(--dsh-header-gap)),
    #000 calc(var(--dsh-header-height, 80px) + var(--dsh-header-gap)),
    #000 100%));
  mask-image: var(--dsh-wallpaper-mask, linear-gradient(to bottom,
    #000 0,
    #000 var(--dsh-header-height, 80px),
    transparent var(--dsh-header-height, 80px),
    transparent calc(var(--dsh-header-height, 80px) + var(--dsh-header-gap)),
    #000 calc(var(--dsh-header-height, 80px) + var(--dsh-header-gap)),
    #000 100%));
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
}

/* ════════════════════════════════════════════════════════════
 * 主页 / 非 active 阶段：模糊层按整个容器走，去掉 header+body 的
 * 中间缝，并用 clip-path 圆角跟随容器，避免直角。
 * ════════════════════════════════════════════════════════════ */
div[data-phase]:not([data-phase='active']) > div[aria-hidden="true"]:first-child {
  -webkit-mask-image: none !important;
  mask-image: none !important;
  clip-path: inset(0 round var(--denpa-radius, 14px));
}

/* ════════════════════════════════════════════════════════════
 * Agent 询问卡片磨砂：与输入框（composer）一致的亚克力效果。
 * QuestionComposer / PlanReviewPanel 都是接管输入框位置的卡片，
 * 背景沿用 --dsw-specific-input-major，但宿主 CSS 未带 backdrop-filter。
 * ════════════════════════════════════════════════════════════ */
[data-question-key] > section,
[data-plan-review-key] > section {
  -webkit-backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
  backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
}

/* ════════════════════════════════════════════════════════════
 * 其余浮动卡片统一补磨砂：审批卡、HoverCard、命令弹层、对话框、
 * 上下文详情弹层、下拉菜单/树菜单。
 * 背景改为与侧栏/输入框一致的半透明亚克力 + 噪声，避免实底遮住模糊。
 * ════════════════════════════════════════════════════════════ */
[data-approval-key] > div,
body > [class*="_card"],
div[aria-label][class*="_card"],
[role="dialog"][class*="_dialog"],
[role="dialog"][class*="_panel"],
div[role="menu"],
div[class$="_menu"],
ul[class$="_menu"] {
  background-color: var(--dsw-specific-input-major);
  background-image: var(--denpa-noise);
  -webkit-backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
  backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
}

/* ════════════════════════════════════════════════════════════
 * 菜单内分组标题：把实底 --dsw-specific-menu 改为与菜单一致的半透明，
 * 避免出现一块硬编码实底挡住模糊。
 * ════════════════════════════════════════════════════════════ */
[class$="_menu"] [class$="_groupTitle"],
div[role="menu"] [class$="_groupTitle"] {
  border-radius: 8px;
  background-color: var(--dsw-specific-input-major);
  background-image: var(--denpa-noise);
}

/* ════════════════════════════════════════════════════════════
 * Composer 内部弹层模糊修正：把输入卡的 backdrop-filter 移到 ::before
 * 伪元素上，避免输入卡自身成为子菜单/弹层的 backdrop root。
 * 这样输入卡仍保持磨砂，子弹层也能独立模糊。
 * ════════════════════════════════════════════════════════════ */
[data-composer-card] {
  position: relative;
  isolation: isolate;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  background: transparent !important;
}

[data-composer-card]::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background-color: var(--dsw-specific-input-major);
  background-image: var(--denpa-noise);
  -webkit-backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
  backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
  pointer-events: none;
}

/* ════════════════════════════════════════════════════════════
 * 命令卡片（GenericCommandCard）磨砂：聊天流里的命令执行卡。
 * 用 :not([data-tool]) 排除通用工具卡，只命中命令卡。
 * ════════════════════════════════════════════════════════════ */
[data-variant="others"]:not([data-tool]) {
  border-radius: 12px;
  background-color: var(--dsw-specific-input-major);
  background-image: var(--denpa-noise);
  -webkit-backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
  backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
}

/* ════════════════════════════════════════════════════════════
 * 模型/提供商设置卡片：rowCard / addCard / setupCard 及内嵌 editor。
 * ════════════════════════════════════════════════════════════ */
li[class$="rowCard"],
li[class$="setupCard"],
div[class$="addCard"] {
  background-color: var(--dsw-specific-input-major);
  background-image: var(--denpa-noise);
  -webkit-backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
  backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
}

li[class$="rowCard"] div[class$="_editor"],
div[class$="addCard"] div[class$="_editor"],
li[class$="setupCard"] div[class$="_editor"] {
  background-color: var(--dsw-specific-input-major);
  background-image: var(--denpa-noise);
  -webkit-backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
  backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
}

/* ════════════════════════════════════════════════════════════
 * 工具/技能展开内容卡：ioCard / instructionsCard。
 * ════════════════════════════════════════════════════════════ */
div[class$="ioCard"],
div[class$="instructionsCard"] {
  background-color: var(--dsw-specific-input-major);
  background-image: var(--denpa-noise);
  -webkit-backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
  backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
}

/* ════════════════════════════════════════════════════════════
 * 悬浮球 hover 信息卡（已有半透明底，只补模糊）。
 * ════════════════════════════════════════════════════════════ */
div[class$="hoverCard"] {
  background-color: var(--dsw-specific-input-major);
  background-image: var(--denpa-noise);
  -webkit-backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
  backdrop-filter: var(--denpa-material-blur-strong, var(--denpa-material-blur));
}

/* ════════════════════════════════════════════════════════════
 * DenpaPush 侧边栏会话选中样式（从 astrbot_plugin_twitter_monitor 移植）
 * 选中会话/搜索结果行使用品牌 surface 底、accent 文字与左侧指示条，
 * 并带 DenpaPush 辉光/阴影。
 * ════════════════════════════════════════════════════════════ */
[role="treeitem"][aria-selected="true"] {
  background-color: var(--dsw-specific-sidebar-nav-item-active);
  /* 左侧短指示条：与 DenpaPush 的 ::before 3px 圆角条等价，避免和拖拽 marker 伪元素冲突 */
  background-image: linear-gradient(
    var(--dsw-specific-sidebar-nav-item-active-accent),
    var(--dsw-specific-sidebar-nav-item-active-accent)
  );
  background-repeat: no-repeat;
  background-position: left center;
  background-size: 3px 18px;
  color: var(--dsw-specific-sidebar-nav-item-active-accent);
  box-shadow: var(--denpa-glow-brand), var(--denpa-shadow);
}

/* 选中行内文字统一走 accent；StateDot 自身状态色因更高优先级保持。 */
[role="treeitem"][aria-selected="true"] span {
  color: inherit;
}

/* ════════════════════════════════════════════════════════════
 * 侧边栏项目/会话入场：从底部浮上来
 * ════════════════════════════════════════════════════════════ */
@keyframes liuli-treeitem-rise {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

[role="treeitem"] {
  animation: liuli-treeitem-rise 0.45s cubic-bezier(0.22, 1, 0.36, 1) backwards;
}

@media (prefers-reduced-motion: reduce) {
  [role="treeitem"] {
    animation: none;
  }
}

/* ════════════════════════════════════════════════════════════
 * 会话切换/新消息入场动画（denpa-transition.ts 挂类）
 * 长属性写法：animation 简写里嵌 var()（级联延迟）在个别引擎上有解析
 * 风险，拆开后每条规则独立解析，延迟变量绝对可靠。
 * ════════════════════════════════════════════════════════════ */
.denpa-enter {
  animation-duration: 200ms;
  animation-timing-function: var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
  animation-delay: var(--denpa-enter-delay, 0ms);
  animation-fill-mode: backwards;
}

.denpa-enter-fade { animation-name: denpa-enter-fade; }
.denpa-enter-rise { animation-name: denpa-enter-rise; }
.denpa-enter-drop { animation-name: denpa-enter-drop; }
.denpa-enter-slide { animation-name: denpa-enter-slide; }
.denpa-enter-zoom { animation-name: denpa-enter-zoom; }
.denpa-enter-blur { animation-name: denpa-enter-blur; }
.denpa-enter-spring { animation-name: denpa-enter-spring; }

/* 级联：同批多条按 --denpa-enter-delay 递增入场（fade/rise 变体） */
.denpa-enter-stagger { animation-name: denpa-enter-fade; animation-duration: 180ms; }
.denpa-enter-staggerRise { animation-name: denpa-enter-rise; animation-duration: 180ms; }

@keyframes denpa-enter-fade {
  from { opacity: 0; }
}

@keyframes denpa-enter-rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@keyframes denpa-enter-drop {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
}

@keyframes denpa-enter-slide {
  from {
    opacity: 0;
    transform: translateX(12px);
  }
}

@keyframes denpa-enter-zoom {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
}

@keyframes denpa-enter-blur {
  from {
    opacity: 0;
    filter: blur(5px);
  }
}

@keyframes denpa-enter-spring {
  0% {
    opacity: 0;
    transform: translateY(10px);
  }
  70% {
    opacity: 1;
    transform: translateY(-2px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .denpa-enter {
    animation: none;
  }
}

`
