/** 琉璃主题样式 —— liuli.css 的字符串化拷贝（运行时注入 <style>，幂等）。 */
export const liuliCss = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
@import url('https://cdn-font.hyperos.mi.com/font/css?family=MiSans:100,200,300,400,450,500,600,650,700,900:Chinese_Simplify,Latin&display=swap');

/* ============================================================
 * 琉璃 风格覆盖层 (DeepSeek Harness 实现)
 * ------------------------------------------------------------
 * 在 design-platform.css 之后加载，整体替换 --dsw-* 语义令牌为
 * 电波推送 琉璃 的 M3 配色（亮/暗双主题），并注入字体、
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

  /* 琉璃 外观令牌（供模块 CSS 引用；运行时按设置覆盖） */
  --liuli-radius: 14px;
  --liuli-radius-sm: 10px;
  --liuli-glow-strength: 0.15;
  --liuli-shadow-strength: 0.6;
  --liuli-material-opacity: 0.55;
  --liuli-material-blur: blur(18px) saturate(1.6);
  --liuli-acrylic-rgb: 221, 229, 237;
  --liuli-acrylic-rgb-low: 232, 238, 244;
  --liuli-acrylic-rgb-high: 200, 212, 223;
  --liuli-control-rgb: 210, 220, 230;
  --liuli-noise: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncA type='linear' slope='0.045'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E");
  --liuli-text-depth: 0 1px 1px rgba(17, 20, 28, 0.14);
}

/* ════════════════════════════════════════════════════════════
 * 缩放性能护栏（配套 src/client/resize-perf.ts）：sash / 窗口
 * resize 期间 body 挂 data-liuli-resizing；磨砂由 JS 渐变归一
 * 后再挂 data-liuli-blur-off（避免「突然消失」的生硬感）。
 * 磨砂 backdrop-filter 每帧都要重采样背景（会话列整宽 blur 尤其
 * 昂贵），缩放期降为 none；渐变过渡见 resize-perf.ts 的
 * fadeBlurOut/fadeBlurIn（blur 半径 + saturate 缓动到恒等滤镜后
 * 由本规则无缝接管，结束时反向渐回）。
 * 注意：不要在此用「* { transition: none }」一刀切——会误杀
 * TurnRail 刻度级联消失等装饰过渡；shard 宽度过渡由
 * DockShellFrame.module.css 的 .dockBody[data-resizing] .shard
 * 专门禁用即可。
 * 宿主产物行 RO 风暴由 resize-perf.ts 冻结行宽解决（见该文件注释）。
 * ════════════════════════════════════════════════════════════ */
body[data-liuli-blur-off] {
  --liuli-material-blur: none !important;
  --liuli-material-blur-strong: none !important;
}

/* ════════════════════════════════════════════════════════════
 * 亮色主题 — 琉璃 M3 light (#1d9bf0 派生)
 * ════════════════════════════════════════════════════════════ */
body {
  /* 泛光/阴影（引用 body 级品牌令牌，必须在 body 上定义才能解析） */
  --liuli-glow-brand: 0 0 10px color-mix(in srgb, var(--dsw-alias-brand-primary) calc(var(--liuli-glow-strength) * 100%), transparent);
  --liuli-glow-brand-strong: 0 0 14px color-mix(in srgb, var(--dsw-alias-brand-primary) calc(var(--liuli-glow-strength) * 165%), transparent);
  --liuli-shadow: 0 2px 10px rgba(0, 0, 0, calc(0.4 * var(--liuli-shadow-strength)));

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
  /* 输入面/浮动卡（composer 卡、审批卡、问题卡等）：跟随材质不透明度滑条，
     不再写死 0.22 —— 否则拖动「材质不透明度」对这些表面无效果。 */
  --dsw-specific-input-major: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55));
  --dsw-specific-login-input: #f8f9fa;
  --dsw-specific-menu: var(--dsw-alias-bg-layer-3);
  --dsw-specific-selector: #eef2f6;
  --dsw-specific-sidebar-fill: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity));
  --dsw-specific-sidebar-nav-item-active-accent: #001d33;
  --dsw-specific-sidebar-nav-item-active: #d0e8ff;
  --dsw-specific-sidebar-nav-item-hover: rgba(0, 121, 191, 0.08);
  /* 输入 dock（GoalBar / QueueDock / TodoDock）：跟随材质不透明度滑条，
     不再写死 0.5。 */
  --dsw-specific-tip: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55));

  --liuli-acrylic-rgb: 221, 229, 237;
  --liuli-acrylic-rgb-low: 232, 238, 244;
  --liuli-acrylic-rgb-high: 200, 212, 223;
  --liuli-control-rgb: 210, 220, 230;
  --liuli-material-opacity: 0.55;
  --liuli-text-depth: 0 1px 1px rgba(17, 20, 28, 0.14);
  color-scheme: light;
}

/* ════════════════════════════════════════════════════════════
 * 暗色主题 — 琉璃 M3 dark (#1d9bf0 派生)
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
  --dsw-specific-input-major: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55));
  --dsw-specific-login-input: #121316;
  --dsw-specific-menu: var(--dsw-alias-bg-layer-3);
  --dsw-specific-selector: #283040;
  --dsw-specific-sidebar-fill: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity));
  --dsw-specific-sidebar-nav-item-active-accent: #d0e8ff;
  --dsw-specific-sidebar-nav-item-active: #004a73;
  --dsw-specific-sidebar-nav-item-hover: rgba(142, 205, 248, 0.08);
  --dsw-specific-tip: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55));

  --liuli-acrylic-rgb: 30, 37, 48;
  --liuli-acrylic-rgb-low: 26, 32, 42;
  --liuli-acrylic-rgb-high: 63, 74, 92;
  --liuli-control-rgb: 51, 61, 78;
  --liuli-material-opacity: 0.5;
  --liuli-text-depth: 0 1px 2px rgba(0, 0, 0, 0.45);
  color-scheme: dark;
}

/* ════════════════════════════════════════════════════════════
 * 全局铬色样式
 * ════════════════════════════════════════════════════════════ */

/* 选中文本：品牌色底 */
::selection {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 24%, transparent);
}

/* 焦点环：品牌描边（与 琉璃 --focus-ring 一致） */
:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent);
  outline-offset: 1px;
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

/* 正文渲染细节：与 琉璃 一致的字重与文本阴影 */
body {
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 品牌高亮微泛光（用于侧栏活动项、主按钮等，按需挂类） */
.liuli-glow {
  box-shadow: var(--liuli-glow-brand);
}

/* TodoPanel 完成状态：跟随主题色而非成功绿 */
[data-testid="todo-panel"] li[data-status="completed"] svg {
  color: var(--dsw-alias-state-business-primary);
}

/* 壁纸暗色遮罩：只在暗色主题叠加（原项目 [data-theme="dark"] 选择器语义） */
[data-liuli-bg]::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0);
  pointer-events: none;
}

body[data-ds-dark-theme] [data-liuli-bg]::before {
  background: rgba(0, 0, 0, var(--liuli-scrim, 0.4));
}

/* ════════════════════════════════════════════════════════════
 * 主题切换圆形遮罩（照搬 琉璃 ::view-transition）
 * ════════════════════════════════════════════════════════════ */
::view-transition-old(root) {
  animation: none;
  z-index: 1;
}

::view-transition-new(root) {
  z-index: 2;
  animation: liuli-vt-circle-reveal 0.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes liuli-vt-circle-reveal {
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
div[data-phase]::before {
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
div[data-phase]:not([data-phase='active'])::before {
  -webkit-mask-image: none !important;
  mask-image: none !important;
  clip-path: inset(0 round var(--liuli-radius, 14px));
}

/* ════════════════════════════════════════════════════════════
 * 开始页（hero 阶段）去掉壁纸模糊：blank session 整列只有标题 +
 * 输入卡，磨砂层糊满整页，用户要求开始页不模糊。
 * 只关掉模糊层（backdrop-filter:none），壁纸原图清晰透出；
 * 输入卡自身的亚克力磨砂不受影响。
 * ════════════════════════════════════════════════════════════ */
div[data-phase='hero']::before {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

/* ════════════════════════════════════════════════════════════
 * 页头独立面板模式（advanced dock 拆出页头，header 被搬到
 * region:conversation-header，正文 phase 内只有 scrollBody 一张卡片）：
 * 磨砂层无需动态 mask 挖「header↔正文」的缝，改用 clip-path 整卡裁剪
 * （顶部圆角、底部直角，与 scrollBody active 态一致）——不依赖
 * HeaderEffects 动态生成的 SVG mask，收起侧栏等布局重排不会再让
 * mask 失效导致壁纸模糊层消失。与侧栏等卡片一致的稳定做法。
 * ════════════════════════════════════════════════════════════ */
div[data-phase='active']:not(:has(header))::before {
  -webkit-mask-image: none !important;
  mask-image: none !important;
  clip-path: inset(0 round var(--liuli-radius, 14px) var(--liuli-radius, 14px) 0 0);
}

/* ════════════════════════════════════════════════════════════
 * Agent 询问卡片磨砂：与输入框（composer）一致的亚克力效果。
 * QuestionComposer / PlanReviewPanel 都是接管输入框位置的卡片，
 * 背景沿用 --dsw-specific-input-major，但宿主 CSS 未带 backdrop-filter。
 * ════════════════════════════════════════════════════════════ */
[data-question-key] > section,
[data-plan-review-key] > section {
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
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
[role="dialog"][class*="_panel"] {
  background-color: var(--dsw-specific-input-major);
  background-image: var(--liuli-noise);
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
}

/* HoverCard 可复制悬浮卡（会话 hover 预览）：宿主把文字颜色硬编码为
   #E4E2DA 浅米色；琉璃已把该卡背景主题化为亚克力，浅色主题下浅字浅底
   几乎不可读。这里统一改为主文字令牌，复制成功反馈同样跟随主题。 */
div[aria-label][class*="_card"][class*="_copyable"],
div[aria-label][class*="_card"][class*="_copyable"] * {
  color: var(--dsw-alias-label-primary);
}

/* 菜单/树菜单需要更强背景对比度：浮动卡片统一的 22% 透明（input-major）
   在亮壁纸上会让浅色菜单文字不可读（右键/下拉菜单看起来像"消失"）。
   菜单单独提高到 70% 不透明，仍保留磨砂亚克力质感与噪声。 */
div[role="menu"],
div[class*="_menu"],
ul[class*="_menu"] {
  background-color: rgba(var(--liuli-acrylic-rgb), 0.7);
  background-image: var(--liuli-noise);
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
}

/* ════════════════════════════════════════════════════════════
 * 菜单内分组标题：把实底 --dsw-specific-menu 改为与菜单一致的半透明，
 * 避免出现一块硬编码实底挡住模糊。
 * ════════════════════════════════════════════════════════════ */
[class*="_menu"] [class*="_groupTitle"],
div[role="menu"] [class*="_groupTitle"] {
  border-radius: 8px;
  background-color: rgba(var(--liuli-acrylic-rgb), 0.7);
  background-image: var(--liuli-noise);
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
  background-image: var(--liuli-noise);
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  pointer-events: none;
}

/* 输入遮罩完全移除（用户要求）：官方渐变渐隐到不透明 bg-base、
   以及上一版改为的亚克力淡出，都是 composer 顶部的渐变遮罩层，
   一律去掉 —— 让消息流/输入区干净透出。 */
[data-composer-seat] {
  background: transparent !important;
}

/* 输入卡内的“命令”圆钮、聊天区“回到底部”按钮：
   从实色容器改为与卡片一致的亚克力表面。
   [class*="_add"] 覆盖官方命令圆钮（hash 尾 _add）；
   [class*="_composerAdd"] 覆盖侧边栏辅助对话的命令圆钮（hash 尾 _composerAdd）。 */
[data-composer-card] button[class*="_add"],
[data-composer-card] button[class*="_composerAdd"] {
  background-color: var(--dsw-specific-input-major) !important;
  background-image: var(--liuli-noise) !important;
}

/* “回到底部”按钮额外加磨砂模糊，和卡片材质一致。 */
button[class*="_toBottom"] {
  background-color: var(--dsw-specific-input-major) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
}

/* ════════════════════════════════════════════════════════════
 * 命令卡片（GenericCommandCard）磨砂：聊天流里的命令执行卡。
 * 用 :not([data-tool]) 排除通用工具卡，只命中命令卡。
 * ════════════════════════════════════════════════════════════ */
[data-variant="others"]:not([data-tool]) {
  border-radius: 12px;
  background-color: var(--dsw-specific-input-major);
  background-image: var(--liuli-noise);
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
}

/* ════════════════════════════════════════════════════════════
 * 模型/提供商设置卡片：rowCard / addCard / setupCard 及内嵌 editor。
 * 用卡片级亚克力配方（0.45 + 噪声 + 磨砂），与其他设置分区卡片一致
 * —— 之前用 input-major（0.22）过透，观感差异明显。
 * ════════════════════════════════════════════════════════════ */
li[class*="rowCard"],
li[class*="setupCard"],
div[class*="addCard"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
}

/* 内嵌编辑器（editor）：子容器比父卡更实（+0.15），层次分得开。
   [class$="_editor"] 精确命中 editor 本身 —— [class*="_editor"] 是子串
   匹配，会误伤 editorHeader / editorActions（名称行/操作行被错误
   亚克力化，名称行的背景应保持透明）。 */
li[class*="rowCard"] div[class$="_editor"],
div[class*="addCard"] div[class$="_editor"],
li[class*="setupCard"] div[class$="_editor"] {
  background-color: rgba(var(--liuli-acrylic-rgb), calc(var(--liuli-material-opacity) + 0.15)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
}

/* ════════════════════════════════════════════════════════════
 * 工具/技能展开内容卡：ioCard / instructionsCard。
 * ════════════════════════════════════════════════════════════ */
div[class*="ioCard"],
div[class*="instructionsCard"] {
  background-color: var(--dsw-specific-input-major);
  background-image: var(--liuli-noise);
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
}

/* ════════════════════════════════════════════════════════════
 * 悬浮球 hover 信息卡（已有半透明底，只补模糊）。
 * ════════════════════════════════════════════════════════════ */
div[class*="hoverCard"] {
  background-color: var(--dsw-specific-input-major);
  background-image: var(--liuli-noise);
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
}

/* ════════════════════════════════════════════════════════════
 * 琉璃 侧边栏会话选中样式（从 astrbot_plugin_twitter_monitor 移植）
 * 选中会话/搜索结果行使用品牌 surface 底、accent 文字与左侧指示条，
 * 并带 琉璃 辉光/阴影。
 * ════════════════════════════════════════════════════════════ */
[role="treeitem"][aria-selected="true"] {
  background-color: var(--dsw-specific-sidebar-nav-item-active);
  /* 左侧短指示条：与 琉璃 的 ::before 3px 圆角条等价，避免和拖拽 marker 伪元素冲突 */
  background-image: linear-gradient(
    var(--dsw-specific-sidebar-nav-item-active-accent),
    var(--dsw-specific-sidebar-nav-item-active-accent)
  );
  background-repeat: no-repeat;
  background-position: left center;
  background-size: 3px 18px;
  color: var(--dsw-specific-sidebar-nav-item-active-accent);
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow);
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
 * 会话 header 动态文本（标题名/模型/路由等）变化时入场动画。
 * 由 header-text-animation.ts 在文本变化时挂 .liuli-header-text-enter。
 * ════════════════════════════════════════════════════════════ */
@keyframes liuli-header-text-rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.liuli-header-text-enter {
  animation: liuli-header-text-rise 0.3s cubic-bezier(0.22, 1, 0.36, 1) backwards;
}

@media (prefers-reduced-motion: reduce) {
  .liuli-header-text-enter {
    animation: none;
  }
}

/* ════════════════════════════════════════════════════════════
 * 官方 harness 观感还原（用户 WIP 曾在宿主 module.css 中实现，
 * 现由插件全局样式承担）：浮动卡片布局 —— frame 背景消费
 * --liuli-frame-bg*（壁纸/渐变/自定义由 liuli-runtime 写入），
 * 侧栏/会话列留白，header 与正文滚动区各自成卡。
 * 选择器用 [class$=] 后缀命中构建产物的哈希类名（形如 <hash>_<local>），
 * 加 !important 压过宿主同特异性规则。
 * ════════════════════════════════════════════════════════════ */

/* 帧背景：壁纸/品牌渐变/自定义（liuli-runtime 写入变量） */
[class*="_frame"] {
  background-color: var(--liuli-frame-bg, var(--dsw-alias-bg-base)) !important;
  background-image: var(--liuli-frame-bg-image, none) !important;
  background-size: var(--liuli-frame-bg-size, auto) !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
}

/* 列留白：卡片悬浮观感（侧栏与中间列各留边距）。
   padding 过渡：收起/展开时 sidebarCol 的 padding 16↔0 切换与
   AppFrame 轨道滑动（300ms）同步，避免收起时容器宽度瞬时跳变。 */
[class*="_sidebarCol"] {
  padding: var(--liuli-dock-padding, 8px) var(--liuli-dock-padding, 8px) var(--liuli-dock-padding, 8px) 0 !important;
  background: transparent !important;
  border-right: none !important;
  /* 宿主给 sidebarCol 设了 overflow:hidden，会把侧栏卡右侧的辉光/阴影裁掉；
     放开横向溢出，让卡片右缘效果完整露出。 */
  overflow: visible !important;
  transition: padding 300ms var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1)) !important;
}

/* 收起态（rail）：官方 56px 轨道贴边、无左右留白 —— 展开态的 8px
   左侧 padding 会把 rail 列挤窄（56-8=48），控件溢出错位。
   垂直保留 8px：与展开态一致，root/面板高度不因收起而变（用户要求
   "收起高度与展开一致"）。 */
[class*="_sidebarCol"]:has([class*="_collapsed"]) {
  padding: var(--liuli-dock-padding, 8px) 0 !important;
}

/* 收起态统一高度到展开态（用户要求）：logoRow 保持展开态 60px
   （toggle 尺寸已由品牌鱼规则统一为 28px）—— 收起时内部高度不再变化。 */
[class*="_sidebarCol"] [class*="_collapsed"] [class*="_logoRow"] {
  height: 60px !important;
}

[class*="_centerCol"] {
  padding: var(--liuli-dock-padding, 8px) var(--liuli-dock-padding, 8px) var(--liuli-dock-padding, 8px) var(--liuli-dock-padding, 8px) !important;
}

/* 开始页：官方 blank session 会给会话 header 加 aria-hidden + .headerHidden
   （display:none）。普通三列模式兜底强制隐藏；advanced dock 模式下 header
   被搬入独立页头面板，需连 shard 一起隐藏（只隐藏内部 pane 不够，shard 仍
   作为 flex 成员占据顶部空间）。 */
div[data-phase] > header[aria-hidden],
div[data-phase] > div > header[aria-hidden] {
  display: none !important;
}

[data-shard-region="region:conversation-header"]:has(header[aria-hidden]) {
  display: none !important;
}

/* 页头 shard 隐藏后，其相邻 sash 仍会作为 flex 成员留在 split 顶部/底部
   （sash 自身 0 占位，但常驻指示条会露在开始页顶部），一并隐藏。 */
[data-shard-region="region:conversation-header"]:has(header[aria-hidden]) + [data-testid="dock-sash"] {
  display: none !important;
}

/* 页头 shard 在会话 shard 下方时，sash 位于会话 shard 之后、页头 shard 之前。 */
[data-testid="dock-sash"]:has(+ [data-shard-region="region:conversation-header"]:has(header[aria-hidden])) {
  display: none !important;
}

/* 页头 shard 隐藏后，会话 shard 的 flex-grow 从 <1 变成孤立的 <1 项，
   flexbox 对 grow 总和 <1 只分配对应比例的自由空间（表现为底部留白）。
   这里在开始页把会话 shard 的 grow 提回 1，让正文占满整个 split。 */
[data-shard-region="region:conversation-header"]:has(header[aria-hidden]) ~ [data-shard-region="region:conversation"] {
  flex-grow: 1 !important;
}

[data-shard-region="region:conversation"]:has(~ [data-shard-region="region:conversation-header"]:has(header[aria-hidden])) {
  flex-grow: 1 !important;
}

/* ── hero 阶段兜底（会话归档后残留旧 header 不带 aria-hidden 的场景）──
   开始页（data-phase='hero'）无论 header 是否带 aria-hidden 一律隐藏：
   归档当前会话后官方会跳到空白会话，但页头面板里可能残留归档前的旧
   header（有内容、无 aria-hidden），:has(header[aria-hidden]) 匹配不到
   导致 header 页依然显示；而重新进入开始页时只有空白 header（带
   aria-hidden）所以正常。这里以 hero 阶段为信号兜底。 */
div[data-phase='hero'] > header,
div[data-phase='hero'] > div > header {
  display: none !important;
}

/* 页头 shard：会话 shard 处于 hero 阶段时整块隐藏（覆盖旧 header 残留） */
[data-shard-region="region:conversation-header"]:has(~ [data-shard-region="region:conversation"] div[data-phase='hero']) {
  display: none !important;
}

/* 页头 shard 在会话 shard 下方时 */
[data-shard-region="region:conversation"]:has(div[data-phase='hero']) ~ [data-shard-region="region:conversation-header"] {
  display: none !important;
}

/* 相邻 sash 一并隐藏（页头在上：sash 紧随页头 shard） */
[data-shard-region="region:conversation-header"]:has(~ [data-shard-region="region:conversation"] div[data-phase='hero']) + [data-testid="dock-sash"] {
  display: none !important;
}

/* 页头在下：sash 紧随会话 shard，且其下一兄弟是页头 shard */
[data-shard-region="region:conversation"]:has(div[data-phase='hero']) + [data-testid="dock-sash"]:has(+ [data-shard-region="region:conversation-header"]) {
  display: none !important;
}

/* 页头 shard 隐藏后会话 shard 提权填满（flex-grow 总和 <1 时只按比例分配） */
[data-shard-region="region:conversation"]:has(div[data-phase='hero']) {
  flex-grow: 1 !important;
}

/* 会话 header 浮动卡片：官方 header 为 <header> 标签 + 哈希类名。
   只命中会话列顶部的 header，避免把问题/审批卡片内部的 <header> 也套上
   卡片背景导致上下样式不统一。 */
div[data-phase] > header,
div[data-phase] > div > header {
  margin-bottom: 12px !important;
  padding: 12px 28px 0 20px !important;
  border: 1px solid var(--dsw-alias-border-l1) !important;
  border-radius: var(--liuli-radius, 14px) !important;
}

/* 官方 header 底部 1px 分隔线会与卡片圆角冲突，去掉 */
div[data-phase] > header::after,
div[data-phase] > div > header::after {
  display: none !important;
}

/* 标题行浮于声纹 canvas 之上（canvas absolute z-index:0） */
div[data-phase] > header [class*="_titleRow"],
div[data-phase] > div > header [class*="_titleRow"] {
  position: relative !important;
  z-index: 1 !important;
}

/* 工具区（Session log/监听/主题/面板）下沉到 tabs 行：与视图标签同一栏，
   右、下对齐。titleRow 是 relative 包含块，故工具区 absolute 锚定 titleRow
   右下角，再按 --dsh-tabs-offset（titleRow 底 → tabs 行底，index.ts 运行时
   测量写入 header，缺省 31px = tabs 行 margin-top 4 + 标签高 27）下移；
   无 tabs 行（单视图）时 :has 不命中，工具区留在标题行。 */
div[data-phase] > header:has([class*="_tabs"]) [class*="_titleRow"] [class*="_headerUtilities"],
div[data-phase] > div > header:has([class*="_tabs"]) [class*="_titleRow"] [class*="_headerUtilities"] {
  position: absolute !important;
  right: 0 !important;
  bottom: 0 !important;
  margin-left: 0 !important;
  /* 防御：右上角窗口胶囊曾要求 132px 让位，工具区已移出标题行，清零防错位 */
  padding-right: 0 !important;
  transform: translateY(var(--dsh-tabs-offset, 31px)) !important;
}

/* 修复"四个工具按钮无法点击"：tabs 行（position:relative; z-index:1，DOM 在
   titleRow 之后）绘制在 titleRow 上方，会把 absolute + translateY 下沉到
   tabs 行区域的工具区盖住并拦截点击。让 tabs 行整行对点击透明（pointer-events:
   none），仅标签按钮自身可点——下沉的工具按钮即可正常命中。 */
div[data-phase] > header [class*="_tabs"],
div[data-phase] > div > header [class*="_tabs"],
[data-region-pane="region:conversation-header"] header [class*="_tabs"] {
  pointer-events: none !important;
}

div[data-phase] > header [class*="_tabs"] [class*="_tab"],
div[data-phase] > div > header [class*="_tabs"] [class*="_tab"],
[data-region-pane="region:conversation-header"] header [class*="_tabs"] [class*="_tab"] {
  pointer-events: auto !important;
}

/* ════════════════════════════════════════════════════════════
 * 会话 header 视图标签（对话/轨迹）滑动激活指示条：
 * 官方每个 tab 按钮用自己 ::after 画底部激活横条，切换时横条瞬间
 * 出现/消失（无位移）。这里隐藏官方横条，改由 header-tab-indicator.ts
 * 在 tabs 容器注入独立指示条 [data-liuli-tab-indicator]，JS 测量
 * 激活 tab 的 left/width，用 transform + width 过渡平滑滑动过去。
 * ════════════════════════════════════════════════════════════ */
div[data-phase] > header [class*="_tabs"] [class*="_tab"]::after,
div[data-phase] > div > header [class*="_tabs"] [class*="_tab"]::after,
[data-region-pane="region:conversation-header"] header [class*="_tabs"] [class*="_tab"]::after {
  background: transparent !important;
}

[data-liuli-tab-indicator] {
  position: absolute;
  left: 0;
  bottom: 1px;
  height: 2px;
  border-radius: 2px;
  background: var(--dsw-alias-state-business-primary);
  pointer-events: none;
  transition: transform 220ms var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1)),
    width 220ms var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
  will-change: transform, width;
  z-index: 2;
}

@media (prefers-reduced-motion: reduce) {
  [data-liuli-tab-indicator] {
    transition: none;
  }
}

/* Session log 按钮：只留 svg 图标，去掉圆钮容器（与相邻监听/主题按钮一致） */
[class*="_sessionLogButton"] {
  min-width: auto !important;
  width: auto !important;
  height: auto !important;
  padding: 9px !important;
  gap: 0 !important;
  border: none !important;
  border-radius: 0 !important;
  background: transparent !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  color: var(--dsw-alias-label-secondary) !important;
}

[class*="_sessionLogButton"]:hover:not(:disabled) {
  color: var(--dsw-alias-brand-primary) !important;
  background: transparent !important;
}

[class*="_sessionLogButton"] > span {
  display: none !important;
}

/* 正文滚动区浮动卡片：官方 [data-conversation-scroll] 为滚动容器。
   注意：不能给卡片设 position:relative —— TurnRail portal 到卡片内，
   但 rail/pill 的 absolute 定位上下文须是 [data-phase] 根（根不滚动），
   卡片一旦成为定位上下文，absolute 会随滚动内容滚动、rail 滚出视口。 */
[data-conversation-scroll] {
  border: 1px solid var(--dsw-alias-border-l1) !important;
  border-radius: var(--liuli-radius, 14px) !important;
}

/* 琉璃：正文卡片底部直切、向下延伸到窗口边缘（WIP ConversationRoot
   同款：centerCol 底部有 16px 内边距，卡片用负 margin 补偿，下缘贴窗口
   底边，底部圆角归零）。hero 阶段（composer 居中）不补偿，保持居中几何。 */
div[data-phase='active'] [data-conversation-scroll] {
  border-bottom-left-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
  margin-bottom: -16px !important;
}

/* 长对话渲染减负：对话流条目启用 content-visibility:auto，屏外条目跳过
   布局/绘制（首次渲染后 auto 记忆真实尺寸，滚动条几何基本无感）。
   实测（demo/inspect-sash-perf.mjs，338 条目/6.5k 元素）：sash 拖拽的
   按下/松手尖峰约减半（358→170ms / 646→380ms），拖拽中段长任务归零；
   同时降低长对话常规滚动与输入时的主线程占用。 */
@supports (content-visibility: auto) {
  [data-chat-flow] > * {
    content-visibility: auto;
    contain-intrinsic-size: auto 300px;
  }
}

/* 双卡亚克力配方（与侧栏同款：染色 + 噪声 + 辉光/阴影），壁纸透出。
   卡片自身不持有 backdrop-filter（会截断后代 composer 卡的磨砂采样），
   壁纸模糊由 [data-phase]::before 独立背景层承担。 */
div[data-phase] > header,
div[data-phase] > div > header,
[data-conversation-scroll] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

/* ════════════════════════════════════════════════════════════
 * advanced dock 模式：对话页拆成 header / 正文两个真正并列的容器。
 * 官方会话根 div[data-phase] 的两个子节点本就并列，但 header 槽位
 * 容器是 inline style="display: contents"，视觉上不构成容器。
 * conversation-split.ts 给它们打标记，这里只做布局：
 *  - header 槽位容器转成 flex 容器（!important 覆盖 inline contents）；
 *  - 正文滚动容器占满剩余空间（flex:1）。
 * 不移动 React 管理的 DOM 节点；旧版结构（header 直接作为 phase 子级）
 * 用 :not(header) 跳过，避免把 header 内部改成 flex 布局。 */
[data-liuli-conversation-split] {
  display: flex !important;
  flex-direction: column !important;
}

[data-liuli-conversation-split] > [data-liuli-conversation-header-container]:not(header) {
  display: flex !important;
  flex-direction: column;
  flex: none;
  min-width: 0;
}

[data-liuli-conversation-split] > [data-liuli-conversation-body-container] {
  flex: 1 1 auto;
  min-height: 0;
}

/* 壁纸模糊独立层：铺满会话列、位于卡片背后（根级 stacking context 的
   负层），透明玻璃只糊住 body 直下壁纸层（官方 DOM 无此元素，伪元素注入）。 */
div[data-phase] {
  position: relative !important;
  z-index: 0 !important;
}

div[data-phase]::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  -webkit-backdrop-filter: var(--liuli-material-blur);
  backdrop-filter: var(--liuli-material-blur);
}

/* active 态正文卡片下缘贴窗口底边（scrollBody margin-bottom:-16px），
   模糊层同步下探 16px，覆盖卡片延伸出的区域。 */
div[data-phase='active']::before {
  bottom: -16px;
}

/* 会话列根：自身不画表面，让 frame 背景透出（卡片间隙可见） */
div[data-phase] {
  background: transparent !important;
}

/* active 态根列不裁剪卡片外阴影/下缘延伸（WIP 同款）：
   官方 .root[data-phase='active'] { overflow: hidden } 会把 scrollBody
   margin-bottom:-16px 向下延伸的 16px 裁掉，卡片视觉底部停在根列底边
   （窗口底上 16px 处），露出壁纸 gap。改 visible 让卡片真正贴到窗口
   底边，卡片辉光/阴影也完整可见（横向溢出由 scrollBody 自己的
   overflow-x:hidden 承担）。 */
div[data-phase='active'] {
  overflow: visible !important;
}

/* 英雄区（空状态欢迎页）：品牌辉光标题 + 副标题（琉璃 风格） */
[class*="_headline"] {
  font-family: var(--dsw-font-family-display) !important;
  letter-spacing: -0.5px !important;
  color: var(--dsw-alias-label-primary) !important;
  text-shadow: var(--liuli-text-depth),
    0 0 14px color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent) !important;
}

[class*="_subtitle"] {
  margin: 0 !important;
  text-align: center !important;
  font-size: 14px !important;
  line-height: 20px !important;
  color: var(--dsw-alias-label-tertiary) !important;
}

/* ════════════════════════════════════════════════════════════
 * 侧栏悬浮亚克力面板（琉璃 配方）：左贴边直角、右侧圆角，
 * 半透明 + 噪声 + 磨砂 + 辉光/阴影。
 *
 * 磨砂必须由 ::before 独立背景层承担，根元素自身不能持有
 * backdrop-filter：backdrop-filter 会让元素成为 fixed 后代的包含块，
 * 而官方设置外壳（ui-settings-general 的 SettingsRoot）是渲染在侧栏
 * footArea 内部的 "position: fixed; inset: 0" 全屏模态 —— 若侧栏根持有
 * backdrop-filter，设置 overlay 的包含块会退化成侧栏根（280px），
 * flex 容器随之收缩，面板被压成侧栏宽度（"设置页面打开在侧边栏"）。
 * 与 composer 卡同一套路：背景层放 ::before，根只做定位/圆角/阴影。
 *
 * 根上还需要 position:relative + z-index:1 自建堆叠上下文：
 * 1) ::before 的 z-index:-1 不逃逸到 body 层（否则会被 frame 的壁纸
 *    背景盖住而不可见）；
 * 2) 会话列 div[data-phase] 已被设为 z-index:0 堆叠上下文，侧栏根
 *    抬高到 1，设置 overlay（fixed, z-index:1000，位于侧栏根上下文内）
 *    才能盖住会话列，恢复全屏居中模态。
 * ════════════════════════════════════════════════════════════ */
[class*="_sidebarCol"] > div > [class*="_root"] {
  position: relative !important;
  z-index: 1 !important;
  /* 描边与会话区卡片 [data-conversation-scroll] 一致（1px solid border-l1） */
  border: 1px solid var(--dsw-alias-border-l1) !important;
  border-radius: 0 var(--liuli-radius, 14px) var(--liuli-radius, 14px) 0 !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
  overflow: hidden !important;
}

[class*="_sidebarCol"] > div > [class*="_root"]::before {
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

/* ════════════════════════════════════════════════════════════
 * 设置页（SettingsRoot 全屏模态）卡片材质化：官方设置外壳的面板是
 * --dsw-alias-bg-layer-2 实底，琉璃的材质不透明度（--liuli-material-opacity）
 * 在设置页上完全不可见，拖动「材质不透明度」滑条页面无任何变化。
 * 这里只把设置卡片面板改为与侧栏/对话卡一致的 ::before 亚克力配方
 * （背景层独立、根不持有 backdrop-filter，避免成为 fixed 后代的包含块），
 * 让设置卡片随材质不透明度/模糊实时响应。
 * 卡片外的全屏遮罩（bg-mask + 磨砂）保持官方硬编码，不随滑条变化。
 * ════════════════════════════════════════════════════════════ */
[class*="_sidebarCol"] [class*="_overlay"] > [class*="_panel"] {
  background-color: transparent !important;
  background-image: none !important;
  border: 1px solid var(--dsw-alias-border-l1) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

[class*="_sidebarCol"] [class*="_overlay"] > [class*="_panel"]::before {
  content: '' !important;
  position: absolute !important;
  inset: 0 !important;
  z-index: -1 !important;
  border-radius: inherit !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  pointer-events: none !important;
}

/* 品牌头部留白（琉璃 sidebar-header 配方） */
[class*="_sidebarCol"] [class*="_logoRow"] {
  padding: 8px 2px 8px 4px !important;
  margin-bottom: 4px !important;
}

/* 收起态 logoRow：恢复官方 rail 几何（padding 0、margin-bottom 12）
   —— 展开态留白规则用 !important 会压过官方 .collapsed 规则。 */
[class*="_sidebarCol"] [class*="_collapsed"] [class*="_logoRow"] {
  padding: 0 !important;
  margin-bottom: 12px !important;
}

/* 收起态顶部品牌鱼（WIP 的 railBrand 新元素，官方等价物是 toggle 按钮：
   点击展开功能不变，这里把它样式化成 36px 圆形品牌鱼 + hover 圆底） */
[class*="_sidebarCol"] [class*="_collapsed"] [class*="_logoRow"] {
  justify-content: center !important;
}

[class*="_sidebarCol"] [class*="_collapsed"] [class*="_toggle"] {
  flex: none !important;
  /* 尺寸统一到展开态（用户要求：收起时高度不再变化） */
  width: 28px !important;
  height: 28px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  border: none !important;
  border-radius: 50% !important;
  background: transparent !important;
  color: var(--dsw-alias-label-primary) !important;
  cursor: pointer !important;
  padding: 0 !important;
}

[class*="_sidebarCol"] [class*="_collapsed"] [class*="_toggle"]:hover {
  background: var(--dsw-alias-interactive-bg-hover) !important;
}

/* 图标按钮 hover：品牌弱化底 + 品牌色图标（WIP 配方） */
[class*="_sidebarCol"] [class*="_iconButton"]:hover {
  background: var(--dsw-alias-interactive-bg-hover-accent) !important;
  color: var(--dsw-alias-brand-primary) !important;
}

/* 收起态图标按钮：品牌色（WIP：rail 图标用主品牌墨色） */
[class*="_sidebarCol"] [class*="_collapsed"] [class*="_iconButton"] {
  color: var(--dsw-alias-brand-primary) !important;
}

/* 移除官方 rail logo swap（WIP 已删）：收起态始终显示品牌鱼，
   hover 不变面板图标 —— 否则 hover 时品牌鱼会被官方规则
   .collapsed .toggle:hover .panelIcon 换成面板图标，与 WIP 不符。 */
[class*="_sidebarCol"] [class*="_collapsed"] [class*="_toggle"] [class*="_panelIcon"] {
  display: none !important;
}

/* 新建会话主按钮（琉璃 主按钮：品牌色实底 + 深色前景 + 品牌辉光，
   WIP 配方完整移植；官方背景是中性 elevated-fill，非主题色）。
   :not([class*="_newSessionLabel"]) 排除按钮内的文字 span
   （class="_newSessionLabel" 也含 "_newSession" 子串）。 */
[class*="_sidebarCol"] [class*="_newSession"]:not([class*="_newSessionLabel"]) {
  border-radius: var(--liuli-radius-sm, 10px) !important;
  border-color: transparent !important;
  background: var(--dsw-alias-button-primary-fill) !important;
  color: var(--dsw-alias-label-primary-foreground) !important;
  box-shadow: var(--liuli-glow-brand) !important;
}

[class*="_sidebarCol"] [class*="_newSession"]:not([class*="_newSessionLabel"]):hover {
  background: var(--dsw-alias-button-primary-hover) !important;
  box-shadow: var(--liuli-glow-brand-strong) !important;
}

/* 收起态退为透明底图标钮：前景回普通文本色（onBrand 两向俱错） */
[class*="_sidebarCol"] [class*="_collapsed"] [class*="_newSession"]:not([class*="_newSessionLabel"]) {
  background: transparent !important;
  box-shadow: none !important;
  color: var(--dsw-alias-label-primary) !important;
}

/* ════════════════════════════════════════════════════════════
 * 对话页细节观感（消息气泡 / 输入卡 / 引用 chip）
 * ════════════════════════════════════════════════════════════ */

/* 用户气泡：亮青气泡配深色前景（官方组件只读 label-primary，补读
   --dsw-specific-bubble-fg；token 由插件定义，暗色下保持深色前景）。
   :not([role="tooltip"]) 排除 Tooltip primitive 的气泡（类名同为
   "_bubble" 后缀）：tooltip 有自己的深色板 + 浅色文字配色，不能
   被这里强改成 bubble-fg（否则暗色主题下 tooltip 文字变深色）。 */
[class*="_bubble"]:not([role="tooltip"]) {
  color: var(--dsw-specific-bubble-fg, var(--dsw-alias-label-primary)) !important;
  /* 对话消息气泡圆角跟随“圆角大小”设置 */
  border-radius: var(--liuli-radius, 22px) !important;
}

/* 回合状态 shimmer（"Deep diving..."）：官方渐变用静态 deepseek-500/200
   （不随主题），WIP 改为 M3 动态品牌色 + 混白浅点。
   只覆盖 background-image —— 不能写 background 简写（!important 简写会
   把官方的 background-clip: text 重置成 border-box，渐变不再裁剪进文字，
   配合 color:transparent 导致文字完全不可见）。 */
[class*="_turnStatus"] {
  background-image: linear-gradient(
    90deg,
    var(--dsw-alias-brand-primary) 0%,
    var(--dsw-alias-brand-primary) 40%,
    color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, #ffffff) 50%,
    var(--dsw-alias-brand-primary) 60%,
    var(--dsw-alias-brand-primary) 100%
  ) !important;
}

/* 计时 span（"38秒"）：父级 background-clip:text 的渐变会作用到所有
   子文本，把时钟也染成品牌渐变 —— 强制恢复 caption 灰色文本、清除
   渐变背景与 text-clip（官方 -webkit-text-fill-color 保持 caption）。 */
[class*="_turnStatus"] [class*="_turnStatusClock"] {
  background-image: none !important;
  -webkit-background-clip: border-box !important;
  background-clip: border-box !important;
  color: var(--dsw-alias-label-caption) !important;
  -webkit-text-fill-color: var(--dsw-alias-label-caption) !important;
}

/* 输入卡：官方已读 --dsw-specific-input-major（插件半透明变量），补辉光/
   阴影；磨砂已由插件 [data-composer-card]::before 独立层承担。 */
[data-composer-card] {
  box-shadow: var(--dsw-shadow-lv2, none), var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

/* 引用 chip：缩放标签与底色观感（chip 本体是官方元素，类后缀命中） */
[class*="_chip"] [class*="_chipLabel"] {
  color: var(--dsw-alias-label-primary) !important;
}

/* 输入框里的引用 chip 也做成更精致的“小卡片”：亚克力底 + 描边 + 品牌辉光，
   不引入 border/padding，避免破坏 U+FFFC 与 textarea 的对齐。 */
[class*="_chip"][data-decoration="chip"]:not([data-invalid]) {
  background: rgba(var(--liuli-acrylic-rgb), 0.9) !important;
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l2), var(--liuli-glow-brand);
}


/* ════════════════════════════════════════════════════════════
 * 用户消息里的元素引用卡片（element-picker 发送后由 element-card.ts
 * 把 [selected element] 纯文本替换为卡片 DOM）。
 * ════════════════════════════════════════════════════════════ */
.liuli-element-card {
  position: relative;
  display: inline-block;
  margin: 4px 0;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--liuli-radius, 999px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), 0.92);
  background-image: var(--liuli-noise);
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  cursor: default;
}

.liuli-element-card-label {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}

/* 详细字段作为悬停卡片展示，不在卡片内展开。
   位置由 element-card.ts 的 JS 按视口动态计算并夹紧，避免超出窗口。 */
.liuli-element-card-details {
  display: none;
  position: fixed;
  left: 0;
  top: 0;
  z-index: 2147483000;
  width: max-content;
  max-width: 360px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background-color: rgba(var(--liuli-acrylic-rgb), 0.97);
  background-image: var(--liuli-noise);
  box-shadow: var(--liuli-shadow), var(--liuli-glow-brand);
  color: var(--dsw-alias-label-primary);
}

/* 无 hover 的触屏设备直接展示详情，避免信息不可达。 */
@media (hover: none) {
  .liuli-element-card-details {
    display: block;
    position: static;
    width: auto;
    max-width: none;
    margin-top: 6px;
  }
}

.liuli-element-card-row {
  margin-top: 4px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  word-break: break-word;
  white-space: pre-wrap;
}

.liuli-element-card-row b {
  color: var(--dsw-alias-label-secondary);
  font-weight: 500;
}

.liuli-element-text {
  white-space: pre-wrap;
  word-break: break-word;
}

/* ════════════════════════════════════════════════════════════
 * 统计行（StatsLine）上方的向上渐变模糊遮罩（用户要求）：
 * 消息流/内容在滚入统计行前向上渐隐模糊 —— 底部较实、向上渐隐，
 * 类似 iOS 底部渐晕。锚定 composerStack > div > InputBar_root >
 * div > StatsLine_root（两层 div 嵌套；composer 卡内 toolbar 的
 * root 是 card > row > ... 路径，结构不同，不会误伤）。
 * ::before 绝对定位在统计行正上方（bottom:100%），backdrop-filter 模糊。
 * ════════════════════════════════════════════════════════════ */
[class*="_composerStack"] > div > [class*="_root"] > div > [class*="_root"] {
  position: relative !important;
}

[class*="_composerStack"] > div > [class*="_root"] > div > [class*="_root"]::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 100%;
  height: 48px;
  background: linear-gradient(
    to top,
    rgba(var(--liuli-acrylic-rgb), 0.6),
    rgba(var(--liuli-acrylic-rgb), 0.25) 40%,
    transparent
  );
  -webkit-backdrop-filter: blur(5px);
  backdrop-filter: blur(5px);
  pointer-events: none;
}

/* ════════════════════════════════════════════════════════════
 * 剩余小件观感（原宿主 module.css 差异，全部为 琉璃 配方）：
 * dock 卡磨砂/辉光、状态点动态取色、详情列去分割线、底部淡出层移除、
 * 设置对话框辉光。
 * ════════════════════════════════════════════════════════════ */

/* 状态点（StateDot）：ongoing/done 跟随 M3 动态品牌色（原为静态刻度/成功绿） */
[class*="_dot"],
[class*="_matrix"] {
  --dsh-state-ongoing: var(--dsw-alias-brand-primary);
}

[class*="_dot"][data-state="done"] {
  color: var(--dsw-alias-brand-primary) !important;
}

/* dock 卡（TodoPanel / GoalBar）：噪声 + 磨砂 + 辉光/阴影。
   必须用组件的 data 锚点精确命中 —— [class$=] 后缀会误伤消息流里
   的每个节点 root（构建产物的类后缀太常见）。 */
[data-testid="todo-panel"],
[data-goal-bar] {
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

/* 排队面板（QueueDock 内部 .panel）：WIP 配方 —— 磨砂 + 辉光/阴影
   加在实际面板上（外层 .dock 只是布局 wrapper，blur 会形成整块遮罩，
   用户要求去外层遮罩、但面板本身要有与 composer 卡一致的磨砂）。
   面板无 fixed 后代，无包含块陷阱。 */
[data-queue-dock] [class*="_panel"] {
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

/* 外层 dock 容器自身：清掉官方/漏到 wrapper 上的辉光、阴影与磨砂模糊。
   精确锚定 composerStack 第一个 div 子级下的 _dock（QueueDock 布局
   wrapper），避免误伤内部面板和其它 _dock 容器。 */
[class*="_composerStack"] > div:nth-of-type(1) > [class*="_dock"] {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  filter: none !important;
  box-shadow: none !important;
}

/* dock 内 bar：补品牌辉光 + 阴影 + 磨砂模糊，与面板/输入卡一致。 */
[class*="_composerStack"] > div:nth-of-type(1) > [class*="_dock"] > [class*="_bar"] {
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

/* 详情列：去左侧分割线（琉璃 实现）。列内 _root 唯一（面板根），
   与侧栏不同没有树/列表子 root，宽匹配安全。 */
[class*="_detailsCol"] [class*="_root"] {
  border-left: none !important;
}


/* ════════════════════════════════════════════════════════════
 * 预览列（右侧 details）像侧栏一样：透明列留白 + 右贴边圆角卡片。
 * 与侧栏配方镜像：padding 16/0/16/16（上下留白一致，收起/展开时
 * 容器高度不跳变），圆角 左侧圆、右侧直（含左下），背景层走 ::before。
 * ════════════════════════════════════════════════════════════ */
[class*="_detailsCol"] {
  padding: var(--liuli-dock-padding, 8px) 0 var(--liuli-dock-padding, 8px) var(--liuli-dock-padding, 8px) !important;
  background: transparent !important;
  border-left: none !important;
  transition: padding 300ms var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1)) !important;
}

/* 展开时放开横向溢出让卡片辉光/阴影完整露出；收起（宽度 0）必须裁掉内容。
   收起态保留上下 16px 内边距，与侧栏一致：容器高度始终 = 列高 - 32px。 */
[class*="_frame"]:not([data-details-collapsed]) [class*="_detailsCol"] {
  overflow: visible !important;
}

[class*="_frame"][data-details-collapsed] [class*="_detailsCol"] {
  padding: var(--liuli-dock-padding, 8px) 0 !important;
  overflow: hidden !important;
}

[class*="_detailsCol"] [data-preview-panel] {
  position: relative !important;
  z-index: 1 !important;
  border-radius: var(--liuli-radius, 14px) 0 0 var(--liuli-radius, 14px) !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
  overflow: hidden !important;
}

[class*="_detailsCol"] [data-preview-panel]::before {
  content: "";
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
/* 工作区树底部淡出层：WIP 已移除该元素，插件隐藏官方残留层 */
[class*="_fade"] {
  display: none !important;
}

/* 设置对话框/面板：辉光阴影（磨砂已由通用对话框规则覆盖） */
[role="dialog"][class*="_panel"],
[role="dialog"][class*="_dialog"] {
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

/* 设置页“已保存”提示去掉背景色，文字用主题色 */
[role="dialog"] [class*="_savedNotice"] {
  background: transparent !important;
  color: var(--dsw-alias-brand-primary) !important;
}

/* 设置行药丸控件（语言/Agent preset/Enter 行为/权限选择器）：
   官方实底换亚克力配方（border-radius 18px 控件）。
   :not([class*="_toggle"]) 排除开关：toggle 有独立轨道设计
   （关=border-l3 灰、开=品牌色），亚克力覆盖会让开态失去品牌色。
   :not([class*="Button"]) 排除命名按钮（primary/secondary/add 等，
   类名如 -ccrBG_primaryButton 小写 p —— 之前用 [class*="Primary"]
   大小写不匹配，保存按钮被误伤成亚克力+白字不可读）。 */
[role="dialog"] [class*="_row"] button:not([class*="_toggle"]):not([class*="Button"]),
[role="dialog"] [class*="_row"] select,
[role="dialog"] [class*="_row"] input {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
}

/* 设置对话框输入框（插件配置 fields 等）：官方 bg-layer-3 实色浅灰，
   视觉像硬编码 —— 统一亚克力配方，与设置其他控件一致。 */
[role="dialog"] input {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
}

/* 插件卡保存按钮：官方用 label-primary 反转（深底浅字，视觉像硬编码），
   改为品牌主按钮（与模型分区保存一致）。 */
[role="dialog"] [class*="_save"] {
  background: var(--dsw-alias-button-primary-fill) !important;
  color: var(--dsw-alias-label-primary-foreground) !important;
}

[role="dialog"] [class*="_save"]:hover:not(:disabled) {
  background: var(--dsw-alias-button-primary-hover) !important;
}

/* 设置分区卡片（插件配置卡 / 插件目录卡 / Agent preset 卡）：
   官方实底 bg-layer-3（#333C44 硬编码，不随主题），WIP 改为半透明
   亚克力配方。用直接子选择器（cards > card 或 cards > div > card），
   避免命中 card 内部的 cardMain/cardHead 等子类（它们应保持透明）。 */
[role="dialog"] [class*="_cards"] > [class*="_card"],
[role="dialog"] [class*="_cards"] > div > [class*="_card"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
}

/* 展开/激活卡：比基础卡更实（WIP：opacity + 0.15） */
[role="dialog"] [class*="_cards"] > [class*="_card"][data-open="true"],
[role="dialog"] [class*="_cards"] > div > [class*="_card"][data-open="true"],
[role="dialog"] [class*="_cards"] > [class*="_card"][class*="Open"],
[role="dialog"] [class*="_cards"] > div > [class*="_card"][class*="Open"],
[role="dialog"] [class*="_cards"] > [class*="_card"][class*="Active"],
[role="dialog"] [class*="_cards"] > div > [class*="_card"][class*="Active"] {
  background-color: rgba(var(--liuli-acrylic-rgb), calc(var(--liuli-material-opacity) + 0.15)) !important;
}

/* preset 卡 ID（<code>）：官方用 label-dimmed（中性灰，不随品牌色变），
   用户要求动态取色 —— 改为主题品牌色（随壁纸 M3 取色变化）。 */
[role="dialog"] [class*="_cardId"] {
  color: var(--dsw-alias-brand-primary) !important;
}

/* ════════════════════════════════════════════════════════════
 * 会话切换/新消息入场动画（liuli-transition.ts 挂类）
 * 长属性写法：animation 简写里嵌 var()（级联延迟）在个别引擎上有解析
 * 风险，拆开后每条规则独立解析，延迟变量绝对可靠。
 * ════════════════════════════════════════════════════════════ */
.liuli-enter {
  animation-duration: 200ms;
  animation-timing-function: var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
  animation-delay: var(--liuli-enter-delay, 0ms);
  animation-fill-mode: backwards;
}

.liuli-enter-fade { animation-name: liuli-enter-fade; }
.liuli-enter-rise { animation-name: liuli-enter-rise; }
.liuli-enter-drop { animation-name: liuli-enter-drop; }
.liuli-enter-slide { animation-name: liuli-enter-slide; }
.liuli-enter-zoom { animation-name: liuli-enter-zoom; }
.liuli-enter-blur { animation-name: liuli-enter-blur; }
.liuli-enter-spring { animation-name: liuli-enter-spring; }

/* 级联：同批多条按 --liuli-enter-delay 递增入场（fade/rise 变体） */
.liuli-enter-stagger { animation-name: liuli-enter-fade; animation-duration: 180ms; }
.liuli-enter-staggerRise { animation-name: liuli-enter-rise; animation-duration: 180ms; }

@keyframes liuli-enter-fade {
  from { opacity: 0; }
}

@keyframes liuli-enter-rise {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@keyframes liuli-enter-drop {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
}

@keyframes liuli-enter-slide {
  from {
    opacity: 0;
    transform: translateX(12px);
  }
}

@keyframes liuli-enter-zoom {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
}

@keyframes liuli-enter-blur {
  from {
    opacity: 0;
    filter: blur(5px);
  }
}

@keyframes liuli-enter-spring {
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
  .liuli-enter {
    animation: none;
  }
}

/* ════════════════════════════════════════════════════════════
 * 自绘会话右键菜单（liuli session context menu）：
 * 容器复用 div[role="menu"] 的 70% 亚克力背景/磨砂/边框/圆角，
 * 这里补菜单项的布局、字号、悬停、分组标题、分隔线与危险项。
 * ════════════════════════════════════════════════════════════ */
[data-liuli-context-menu] {
  box-sizing: border-box;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--dsw-alias-border-inverted);
  border-radius: 12px;
  box-shadow: var(--dsw-shadow-lv3);
  min-width: 218px;
  max-width: 360px;
}

.liuli-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 8px 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
  text-align: left;
  cursor: pointer;
}

.liuli-menu-item:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.liuli-menu-danger {
  color: var(--dsw-alias-state-error-primary);
}

.liuli-menu-danger:hover {
  background: var(--dsw-alias-interactive-bg-hover-danger);
}

.liuli-menu-active {
  color: var(--dsw-alias-brand-primary);
}

.liuli-menu-icon {
  display: inline-flex;
  flex: none;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  color: var(--dsw-alias-label-tertiary);
}

.liuli-menu-danger .liuli-menu-icon {
  color: var(--dsw-alias-state-error-primary);
}

.liuli-menu-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.liuli-menu-group {
  padding: 8px 10px;
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}

.liuli-menu-sep {
  height: 1px;
  margin: 4px 2px;
  background: var(--dsw-alias-border-l1);
}

/* 宿主产物行「打开方式」按钮：去掉实底背景（常态与 hover 都透明）。
   注意：不能只清 iconBtn —— 上面的 div[class*="_menu"] 会误伤
   menuWrap 容器（class 含 _menu），给图标套上 70% 半透明灰框。
   这里同时把 menuWrap 容器本身也恢复透明。 */
[class*="_fileRow"] [class*="_menuWrap"] {
  background-color: transparent !important;
  background-image: none !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

[class*="_fileRow"] [class*="_menuWrap"] [class*="_iconBtn"] {
  background: transparent !important;
}

[class*="_fileRow"] [class*="_menuWrap"] [class*="_iconBtn"]:hover,
[class*="_fileRow"] [class*="_menuWrap"] [class*="_iconBtn"]:active,
[class*="_fileRow"] [class*="_menuWrap"] [class*="_iconBtn"]:focus,
[class*="_fileRow"] [class*="_menuWrap"] [class*="_iconBtn"]:focus-visible {
  background: transparent !important;
  color: var(--dsw-alias-brand-primary, #0079bf) !important;
  outline: none !important;
  box-shadow: none !important;
}

`
