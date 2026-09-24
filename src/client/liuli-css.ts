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
 * 内嵌浏览上下文让路（配套 resize-perf.ts / dock sash 拖拽防失焦）：
 * sash / 窗口缩放期间指针可能扫进内嵌浏览器（<webview> guest 页 /
 * iframe / 原生 WebContentsView 区域）。指针一旦进入 guest/iframe，
 * 事件就不再派发给主窗口——主窗口收不到 pointermove，拖拽即卡住，
 * 焦点还可能被内嵌页抢走（用户反馈「拖 sash 碰到浏览器窗口会失焦」）。
 * 原生 WebContentsView 已在 resize 期由 geometry 循环隐藏（见
 * browser-webview.ts 的 isVisible 回调）；DOM 内嵌两类：
 *   - iframe：pointer-events:none 点击穿透即可（内容保持可见）；
 *   - <webview>：guest 是独立渲染进程，CSS pointer-events 对它
 *     不可靠。不靠 CSS 隐藏（整屏消失体验差，用户反馈「拖拽时浏览器
 *     画面消失」）——resize-perf.ts 在缩放期挂全视口透明护盾
 *     （data-liuli-resize-shield，普通 DOM 元素、pointer-events:auto、
 *     z-index 盖过一切 DOM）：护盾先于 webview 命中测试，guest 收不到
 *     pointerdown（不抢焦点、不吞 move），而护盾透明，webview 画面
 *     全程保持可见。
 * ════════════════════════════════════════════════════════════ */
body[data-liuli-resizing] iframe {
  pointer-events: none !important;
}

/* ════════════════════════════════════════════════════════════
 * 亮色主题 — 琉璃 M3 light (#1d9bf0 派生)
 * ════════════════════════════════════════════════════════════ */
body {
  /* 泛光/阴影（引用 body 级品牌令牌，必须在 body 上定义才能解析） */
  --liuli-glow-brand: 0 0 10px color-mix(in srgb, var(--dsw-alias-brand-primary) calc(var(--liuli-glow-strength) * 100%), transparent);
  --liuli-glow-brand-strong: 0 0 14px color-mix(in srgb, var(--dsw-alias-brand-primary) calc(var(--liuli-glow-strength) * 165%), transparent);
  --liuli-shadow: 0 2px 10px rgba(0, 0, 0, calc(0.4 * var(--liuli-shadow-strength)));
  /* 统一细描边：透明表面/无底色小控件用；在 body 上定义才能解析 label-primary */
  --liuli-border-hairline: color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);

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
  /** 链接 / 文件图标 / link 语义统一跟随主题品牌色（M3 动态取色后自动同步）。 */
  --dsw-alias-link: var(--dsw-alias-brand-primary);
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
  /* 暗色主题同一枚细描边（label-primary 在本块已声明） */
  --liuli-border-hairline: color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent);

  /* 品牌 */
  --dsw-alias-brand-primary-invert: #121316;
  --dsw-alias-brand-primary-new-colorprimary-new-color: #8ecdf8;
  --dsw-alias-brand-primary: #8ecdf8;
  /** 链接 / 文件图标 / link 语义统一跟随主题品牌色（M3 动态取色后自动同步）。 */
  --dsw-alias-link: var(--dsw-alias-brand-primary);
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
/* DockShellFrame 布局工作台 / 导入导出模态不是弹出菜单：class*="_menu" 会
   误伤其 menuCard/menuHead/menuRow/menuBtn/addMenuItem 等全部类名带 _menu
   的元素——元素选择器上"到处都是 rgba(27,47,48,0.7)"就是这条规则画的。
   排除工作台卡片与模态框的内部元素，恢复各自自身的透明/令牌表面（卡片本体
   保留磨砂亚克力，与浮动卡片一致）；真正的下拉菜单不受影响。 */
div[class*="_menu"]:not([data-testid="dock-menu-card"] *):not([data-testid="dock-modal"] *),
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

/* 注：此处占位层不隐藏 —— 用户要保留提示文字。 */

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
 * 官方交付物卡片（ui-deliverables 的 PresentedFileCard = [data-presented-file]）
 * 卡片背景透明 + 文件图标 Material 化。
 *  - 官方给每张卡片铺静态浅灰底（--deliverable-fill；暗色档
 *    --dsw-static-neutral-850），在琉璃壁纸/亚克力列上发闷 → 改为透明，
 *    hover 只留极淡品牌底（--deliverable-hover）。左侧 48px 图标框复用的
 *    是同一个 --deliverable-fill，随之一起去底。
 *  - 图标框内的官方文件类型图形（28px「纸张 + 折角 + 类型符号」）换
 *    Material Symbols 单色图标：隐藏官方 svg，伪元素以 mask 绘制，
 *    颜色随框内 currentColor（--dsw-alias-link）。
 *  - 类型判定用官方 FileTypeIcon 渲染出的 CSS Modules 类后缀
 *    （_icon + _image/_pdf/_excel/_ppt/_video/_word/_markdown/_html/
 *    _folder/_other，哈希前缀跨构建变化、后缀稳定）。代码类文件走
 *    CodeFileIcon、svg 不带类型类 → 由上面的默认值落到 Material「code」。
 *  - 锚点 data-presented-file 由宿主组件自己挂（非 CSS hash），稳定；
 *    只作用于交付物卡，不会命中 produced files 行（那个是
 *    [data-produced-files-row]，用的是 LinkIcon）。
 * ════════════════════════════════════════════════════════════ */
[data-presented-file] {
  --deliverable-fill: transparent;
  --deliverable-hover: color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, transparent);
  /* 卡片背景透明后没有底色托底：官方在卡内并存三级描边（卡 l1 / 图标框 l2 /
     「打开」胶囊与分隔线 l3），在壁纸上会深浅不一。这里把三级统一成一条与文字
     同源的描边色（暗色主题=浅、亮色主题=深），既统一又保证可读性。变量写在卡片
     元素自身：元素自身声明优先于宿主 :root 继承值，与样式表注入顺序无关。 */
  --dsw-alias-border-l1: var(--liuli-border-hairline);
  --dsw-alias-border-l2: var(--liuli-border-hairline);
  --dsw-alias-border-l3: var(--liuli-border-hairline);
}

/* 「打开 / 更多」胶囊（split）去掉官方浮动实底（--dsw-alias-button-floating-fill），
   与卡片一起透出壁纸；描边保留，hover 反馈由官方 interactive-bg-hover 承担。 */
[data-presented-file] [class$="_split"] {
  background: transparent;
}

[data-presented-file] [class*="_fileIcon"] {
  background: transparent;
  /* 默认给代码类文件（官方 CodeFileIcon 不带类型类名） */
  --liuli-deliverable-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z'/%3E%3C/svg%3E");
}

[data-presented-file] [class*="_fileIcon"] > svg {
  display: none;
}

[data-presented-file] [class*="_fileIcon"]:has(> svg[class*="_word"]) {
  --liuli-deliverable-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z'/%3E%3C/svg%3E");
}

[data-presented-file] [class*="_fileIcon"]:has(> svg[class*="_markdown"]) {
  --liuli-deliverable-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='m640-360 120-120-42-43-48 48v-125h-60v125l-48-48-42 43 120 120ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm0 0v-480 480Zm60-120h60v-180h40v120h60v-120h40v180h60v-200q0-17-11.5-28.5T440-600H260q-17 0-28.5 11.5T220-560v200Z'/%3E%3C/svg%3E");
}

[data-presented-file] [class*="_fileIcon"]:has(> svg[class*="_html"]) {
  --liuli-deliverable-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='M0-360v-240h60v80h80v-80h60v240h-60v-100H60v100H0Zm310 0v-180h-70v-60h200v60h-70v180h-60Zm170 0v-200q0-17 11.5-28.5T520-600h180q17 0 28.5 11.5T740-560v200h-60v-180h-40v140h-60v-140h-40v180h-60Zm320 0v-240h60v180h100v60H800Z'/%3E%3C/svg%3E");
}

[data-presented-file] [class*="_fileIcon"]:has(> svg[class*="_image"]) {
  --liuli-deliverable-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h480L570-480 450-320l-90-120-120 160Zm-40 80v-560 560Z'/%3E%3C/svg%3E");
}

[data-presented-file] [class*="_fileIcon"]:has(> svg[class*="_pdf"]) {
  --liuli-deliverable-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='M360-460h40v-80h40q17 0 28.5-11.5T480-580v-40q0-17-11.5-28.5T440-660h-80v200Zm40-120v-40h40v40h-40Zm120 120h80q17 0 28.5-11.5T640-500v-120q0-17-11.5-28.5T600-660h-80v200Zm40-40v-120h40v120h-40Zm120 40h40v-80h40v-40h-40v-40h40v-40h-80v200ZM320-240q-33 0-56.5-23.5T240-320v-480q0-33 23.5-56.5T320-880h480q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H320Zm0-80h480v-480H320v480ZM160-80q-33 0-56.5-23.5T80-160v-560h80v560h560v80H160Zm160-720v480-480Z'/%3E%3C/svg%3E");
}

[data-presented-file] [class*="_fileIcon"]:has(> svg[class*="_excel"]) {
  --liuli-deliverable-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='M760-120H200q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120ZM200-640h560v-120H200v120Zm100 80H200v360h100v-360Zm360 0v360h100v-360H660Zm-80 0H380v360h200v-360Z'/%3E%3C/svg%3E");
}

[data-presented-file] [class*="_fileIcon"]:has(> svg[class*="_ppt"]) {
  --liuli-deliverable-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='m380-300 280-180-280-180v360ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z'/%3E%3C/svg%3E");
}

[data-presented-file] [class*="_fileIcon"]:has(> svg[class*="_video"]) {
  --liuli-deliverable-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='m160-800 80 160h120l-80-160h80l80 160h120l-80-160h80l80 160h120l-80-160h120q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800Zm0 240v320h640v-320H160Zm0 0v320-320Z'/%3E%3C/svg%3E");
}

[data-presented-file] [class*="_fileIcon"]:has(> svg[class*="_folder"]) {
  --liuli-deliverable-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z'/%3E%3C/svg%3E");
}

[data-presented-file] [class*="_fileIcon"]:has(> svg[class*="_other"]) {
  --liuli-deliverable-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -960 960 960'%3E%3Cpath d='M240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z'/%3E%3C/svg%3E");
}

[data-presented-file] [class*="_fileIcon"]::after {
  content: '';
  width: 26px;
  height: 26px;
  background-color: currentColor;
  -webkit-mask: var(--liuli-deliverable-icon) center / contain no-repeat;
  mask: var(--liuli-deliverable-icon) center / contain no-repeat;
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

/* 上一条的 -16px 让 scrollBody 比会话根高 16px、下缘越过裁切边界；composer 用
   position:sticky; bottom:0 钉在 scrollBody 底边上，于是跟着悬进裁切区 ——
   悬出的像素数 = 「scrollBody 底边 − 最近裁切祖先的底边」，**不恒等于 16px**
   （随布局/dock 留白变化），写死 16px 会多提、在底部留缝。
   所以这里不用 CSS 补偿，改由 composer-seat-anchor.ts 实测该溢出量并写成
   composer 的 sticky bottom：恰好贴住可见底边（不裁切、不留缝），正文卡片
   触底与滚动几何都不变。 */

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

/* ════════════════════════════════════════════════════════════
 * 输入面排除：DSH 2.0.4 把输入框从 textarea 换成 contenteditable，
 * 且编辑器元素带 data-phase={input.phase} 属性 —— 会被壁纸模糊层
 * div[data-phase]::before 误命中，在草稿区内注入一个 inset:0 的
 * 磨砂伪元素（开始页输入框中间那条 52px 高的“透明长条”）。
 * data-placeholder 是输入面专属标记（会话列根没有），据此精确排除：
 * 输入面不是模糊层的宿主，伪元素整个不渲染。
 * ════════════════════════════════════════════════════════════ */
div[data-phase][data-placeholder]::before {
  content: none !important;
}

/* ════════════════════════════════════════════════════════════
 * 官方 TurnNavigator 隐藏（无条件）：琉璃自绘的轮次刻度侧边栏（TurnRail，
 * "对话轮次导航"）已提供完整轮次跳转/commit 引用，官方 ChatView 内自带的
 * 右侧竖刻 rail（aria-label "轮次导航" / "Turn navigation"）与之重复，
 * 同一会话会出现左右两条轮次刻度，这里把官方的整条无条件隐藏。
 * 官方结构：div[class$="_slot"] > nav（内含 [class*="_mark"] 轮次刻度）。
 * 只按 _slot 后缀 + 「直接子 nav 内含刻度」判定，刻意**不依赖 nav 自身的
 * 局部类名**——DSH 2.0.5 起 nav 从 _rail 改名为 _frame
 * （PvW7sq_slot > nav.PvW7sq_frame > div.PvW7sq_scroller > div.PvW7sq_marks），
 * 依赖旧类名会让隐藏静默失效。琉璃 rail 是 portal 到正文卡片的无 _slot
 * 包装 nav，不会命中。locale 无关，不依赖 aria-label。
 * 无条件（不随 dom 开关门控）：官方 rail 与琉璃 rail 功能重复是常态，
 * 之前依赖 body[data-liuli-hide-native-turnrail] 属性（unofficial('dom')
 * 门控）触发，一旦用户在设置里关掉 dom 分组（localStorage 持久化）属性
 * 永不设置、官方 rail 原样显示——结构性脆弱。现改为选择器内联判定、
 * 与 body 属性彻底解耦，style 注入本身无条件，故任何设置下官方 rail 均隐藏。
 * ════════════════════════════════════════════════════════════ */
[class$="_slot"]:has(> nav:has([class*="_mark"])) {
  display: none !important;
}

/* ════════════════════════════════════════════════════════════
 * 官方宽度手柄降层（无条件）：ConversationRoot 的左右宽度手柄
 * （[data-width-handle]，官方 z-index:8，top:0/bottom:0 全高覆盖）盖在
 * 琉璃 TurnRail（z-index:5）之上，虹吸刻度所在区域的点击（点不到 turnrail）。
 * 官方手柄的唯一职能是拖拽调宽；把它降到琉璃 rail 之下（z-index:3），
 * rail 及胶囊在重叠区优先命中，手柄在非重叠区仍可拖拽调宽。
 * 琉璃 rail 无条件挂载，与手柄的层级冲突恒在，故本规则不随开关门控。
 * ════════════════════════════════════════════════════════════ */
[data-width-handle] {
  z-index: 3 !important;
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
 * 收起态插件市场按钮（dshMarketLauncher）对齐：
 * 宿主桌面壳把 sidebar.footer.action 的 slot host 设为 column flex +
 * scrollbar-gutter:stable（预留滚动条槽位）+ width:100%，
 * 36px 内容盒在 56px rail 里被 gutter 挤掉 ~10px，按钮被压到
 * slot host 内容盒起点 —— 实测圆心 23 vs rail 中心 28（左偏 5px），
 * 与设置/折叠等圆形按钮中心错位。
 * 收起态下清掉 gutter 并把按钮在 slot host 内水平居中恢复对齐；
 * 展开态（无 collapsed 类）不干预宿主原布局。
 * ════════════════════════════════════════════════════════════ */
[class*="_sidebarCol"] [class*="_collapsed"] [data-slot="sidebar.footer.action"] {
  scrollbar-gutter: auto !important;
  align-items: center !important;
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
 * 统计行（StatsLine）上方的「向上渐变模糊遮罩」—— 已整条移除。
 *
 * 历史：DSH 2.0.4 时代统计行与输入卡之间还有消息流空间，这里挂过一个
 * 「bottom:100%; height:48px」的 ::before（to top 渐隐 + backdrop blur），
 * 让内容滚入统计行前向上渐隐（iOS 式底部渐晕）。
 *
 * 失效原因：DSH 2.0.9 起官方把统计胶囊行（[data-composer-stats]）钉在
 * 输入卡正下方、两者零间隙（另见 composer-seat-anchor.ts），于是「统计行
 * 上方 48px」整段落在输入卡内部 —— 渐晕直接糊在对话框下半部分上，表现为
 * 「对话框被一层向上的渐变遮罩罩住」（用户报告）。
 *
 * 当前布局下该效果没有可用空间（遮罩高度只会等于卡片自身高度），故删除
 * 规则本身，也不再需要为它挂 position:relative。若日后上游重新留出卡片
 * 与统计行之间的间隙，再按「只覆盖卡片底边之外」重建。
 * ════════════════════════════════════════════════════════════ */

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

/* 设置页“已保存”提示去掉背景色，文字用主题色。
   p 元素选择器把特异性提到 (0,2,1)，压过下方 [class*="_save"] 保存按钮规则
   （(0,2,0)，_savedNotice 同样命中 _save 子串，同特异性时后者按源码顺序胜出，
   曾把提示染成品牌底色 + 前景反转色）。 */
[role="dialog"] p[class*="_savedNotice"] {
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
   改为品牌主按钮（与模型分区保存一致）。
   :not([class*="_savedNotice"]) 排除“已保存”提示，避免把提示也染成按钮底色
   （提示规则在上方用 p 选择器单独压过，这里双保险）。 */
[role="dialog"] [class*="_save"]:not([class*="_savedNotice"]) {
  background: var(--dsw-alias-button-primary-fill) !important;
  color: var(--dsw-alias-label-primary-foreground) !important;
}

[role="dialog"] [class*="_save"]:not([class*="_savedNotice"]):hover:not(:disabled) {
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

/* ════════════════════════════════════════════════════════════
 * 官方右侧栏（迁移模式）tab 条外观对齐。
 * 官方 tab 条的度量与琉璃自研标签条不同：条高 38px（自研 48px）、
 * 标签圆角 12px（自研 rounded-lg = 8px）、字号 13px（自研 14px）。
 * 这里只覆盖度量，不动官方的结构与交互；选择器用官方 CSS module 的
 * 类名前缀匹配（hash 后缀随版本变、前缀稳定）。
 * ════════════════════════════════════════════════════════════ */
/* 条高必须与自研 .tabStrip 的**总高**对齐：官方 _tabStrip_ 与自研 .tabStrip
   都是 content-box（官方声明 height:28px + padding:10px 6px 0 10px），
   所以要复现自研的 48px 内容高 + 1px 描边 = 49px 总高，就只能给
   height:48px 且**不再补顶部 padding**。早前这里写了
   padding: 8px 8px 0，content-box 下总高变成 48+8+1 = 57px
   （实测 57px），比自研标签条高 8px：标签条把正文区整体下压，浏览器面板的
   原生视图/地址栏也跟着下移，与侧栏、会话页头的顶部基线错位。 */
:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) [class*="_tabStrip_"] {
  height: 48px !important;
  padding: 0 var(--liuli-dock-padding, 8px) !important;
}

:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) [class*="_tab_"] {
  height: 28px !important;
  border-radius: 8px !important;
  font-size: 14px !important;
  font-weight: 500 !important;
}

:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) [class*="_tabTitle_"] {
  font-size: 14px !important;
  font-weight: 500 !important;
  gap: 6px !important;
}

/* ── 琉璃面板正文的宿主容器（官方右栏模式） ──
 * 见 sidebar-right-tabs.ts 中 panelBody 的注释：官方 ._paneBody_ 是
 * display:block / height:auto，而琉璃面板按「父级纵向 flex + 自身 flex:1」
 * 设计，直接落进去会整条塌高（浏览器面板的 .carrier 实测只剩 150px）。
 * 这里把这层容器补成自研宿主 .tabPane 的等价形态：铺满正文区高度、
 * 纵向 flex、允许内部滚动。只作用于琉璃自己渲染的正文
 * （[data-liuli-official-pane]），不影响共用同一 paneBody 的官方
 * files / documentpreview。 */
:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) [data-liuli-official-pane] {
  display: flex !important;
  flex-direction: column !important;
  flex: 1 1 auto !important;
  height: 100% !important;
  min-width: 0 !important;
  min-height: 0 !important;
  overflow: hidden !important;
}

/* 官方右栏常驻宿主内：正文区自身可滚（官方 ._paneBody_ 原本就 overflow:auto），
   但琉璃面板各自管理内部滚动，故不再叠加滚动容器。 */
:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) [data-liuli-official-pane] > * {
  min-height: 0 !important;
}

/* ── 官方面板的宽度必须被卡片内容盒收住（否则左侧内容被裁掉） ──
 * 官方面板 .Ng7Ira_panel 是 position:absolute; top:0; bottom:0; right:0 +
 *   内联 width:<轨道宽>px，在官方 AppFrame 里那一列本身就是整条轨道、没有内缩，
 *   所以「右对齐 + 定宽」正好铺满。琉璃给官方右栏套了卡片外壳（左 8px 留白 +
 *   1px 描边），卡片内容盒比轨道窄 10px，而面板仍按轨道宽 + right:0 定位 ——
 *   于是它向**左**多伸出 10px，被卡片的 overflow:hidden 裁掉：实测面板
 *   x=1808 / 卡片内容盒左缘 1818，标签条最左侧（含其左留白）整段不可见，
 *   即「左右边距留不够、浏览器面板内容被切」的直接原因。
 * 修法：只加 max-width，不改 width/left/right —— 官方的滑入滑出动画与
 *   「轨道为 0 时面板挂在列右缘」的定位语义都建立在 right:0 上，保持不动；
 *   max-width 以包含块（卡片内容盒）为准，展开时把 751px 收到 741px，
 *   正好与卡片内容盒左右对齐（实测面板 x=1818 / 宽 741 = 卡片内容盒）。
 * 只约束 push 形态：fullscreen 形态官方自己 inset:0 / position:fixed，
 *   本就该铺满视口，加上限宽会把它压回卡片尺寸。 */
:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) [data-sidebar-right-panel='push'] {
  max-width: 100% !important;
}

/* 官方右栏引导页的入口胶囊自带**不透明深色底**（实测 L5GtOG_entry = rgb(38,37,25)），
   在琉璃的磨砂材质上像一块块实心砖 —— 换成琉璃的亚克力半透明配比，让材质透出来；
   比面板底色略高一点不透明度以保证文字清晰。
   选择器必须限定 button 元素：胶囊内部的 _entryIcon / _entryText / _entryTitle
   都含 _entry 子串，早前不加限定时它们被一起染成了色块（图标与文字各顶一块深底）。 */
:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) button[class*="_entry"] {
  background-color: rgba(var(--liuli-acrylic-rgb), min(0.92, calc(var(--liuli-material-opacity) + 0.3))) !important;
}

/* 胶囊内的图标与文字容器保持透明：底色只由胶囊本体提供。 */
:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) [class*="_entryIcon"],
:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) [class*="_entryText"],
:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) [class*="_entryTitle"] {
  background-color: transparent !important;
}

/* 官方右栏内部的面板容器自带**不透明**底色（实测 Ng7Ira_panel = rgb(21,19,14)，
   全高），会把琉璃卡片外壳的亚克力材质层完全盖住 —— 表现就是「背景材质没跟插件
   一致」。这里置透明，让材质透出来（与自研 details 面板的半透明观感一致）。 */
:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) [class*="_panel"] {
  background-color: transparent !important;
}

/* tab 条与内容区之间的分隔线同理：官方用不透明底色画条，置透明后由卡片外壳统一
   提供材质；保留必要的描边以便区分条与内容。 */
:is([data-liuli-official-rightbar], [data-liuli-official-rightbar-host]) [class*="_tabStrip_"] {
  background-color: transparent !important;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(128, 128, 128, 0.14)) !important;
}

/* ⚠️ 此处的 flex-basis 过渡已移除（曾用于官方右栏滑入动画的同步）：
   实测它在「展开状态被快速重写」时会把过渡无限重启、冻结在 0 —— 表现即
   「按钮收不起来 / 打开面板后右栏仍是 0 宽（inline 751px 但 computed
   flex-basis 0px）」。宽度现在由帧层状态离散驱动（childFixedWidth → inline
   flex），瞬跳可接受；拖拽期间的防粘滞规则（body[data-liuli-resizing]）保留。 */

body[data-liuli-resizing] [data-testid="dock-shell"] [data-region-pane="region:details"] {
  transition: none !important;
}


/* ════════════════════════════════════════════════════════════
 * 官方 UI 视觉冲突修复（审计工作流生成）
 * 来源：docs/official-ui-visual-conflicts.md —— 43 个 @deepseek-ai/dsh-client-ui-* 包 / 256 条发现
 * 规则按审计分组排列，每组块首注明来源包；只覆盖视觉属性，不动布局与交互。
 * 官方升级后如出现「某块又变实底/圆角又不对」，按这里的选择器前缀复核。
 * ════════════════════════════════════════════════════════════ */

/* ── agent-preset+approval+attachment ── */
/* ════════════════════════════════════════════════════════════
 * 琉璃覆盖补充 —— agent-preset+approval+attachment
 * 来源审计：ui-audit/agent-preset+approval+attachment.json
 * 只处理 high / medium 发现；已 grep 确认下述目标在 liuli-css.ts 中无对应规则
 * （审批卡的背景/磨砂已有 [data-approval-key] > div，本组不重复）。
 * 仅覆盖视觉属性：background / background-image / color / border / border-radius /
 * box-shadow / backdrop-filter / z-index；不动布局尺寸、display 与任何交互属性。
 * 官方类名为 <hash>_<local>，用 class*= 匹配 local 名；宽选择器一律用 :has() /
 * 属性限定收窄，避免子串误伤（见每节注释）。
 * 跳过：UploadIllustration / UploadDisabledIllustration（115×84 内联 SVG 插画，
 * 属自带图标体系，按约定不覆盖）与全部 severity=low 项（reject 的边框字面量
 * #0000、审批卡硬编码 padding、brokenTip/brokenBadge 配色、preset chip 实底、
 * var() 兜底字面量）。
 * ════════════════════════════════════════════════════════════ */


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-attachment] ._removeFailed
 * 审计：high
 * 问题 —— 上传失败态删除按钮前景硬编码 #fff，未用反色语义令牌。琉璃把
 *   --dsw-alias-state-error-primary 由 #ba1a1a 重定义为 #ffb4ab（暗色更浅），
 *   纯白字压在浅红底上对比不足；同一元素的常态用的正是 label-primary-inverted。
 * 处理 —— 改为同一反色语义令牌，随主题与动态取色同步。
 * ──────────────────────────────────────────────────────────── */
[class*="_removeFailed"] {
  color: var(--dsw-alias-label-primary-inverted) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-attachment] ._card（240×64 附件文件卡）
 * 审计：medium
 * 问题一 —— 圆角写死 16px，不在琉璃圆角阶梯（规范 4.1：14/10/8/7/6）内，与输入区
 *   同屏时比输入卡本身还圆，破坏「越大越卡、越小越控」的层级观感。
 * 问题二（同项根因一并修）—— 底走 --dsw-specific-input-major（半透明）却缺噪声与
 *   磨砂，在壁纸上只是一块发灰的半透片；规范 5.2 要求半透明底搭噪声 + 磨砂。
 * 处理 —— 圆角落卡片档；按简化亚克力配方补 background-color + noise + 磨砂
 *   （strong 兜底写法：本卡嵌在消息区/输入区的 backdrop 根内，采样会衰减；
 *   body[data-liuli-blur-off] 会把两档置 none，护栏自动生效）。尺寸/布局不动。
 * 收窄 —— 仅命中同时含 _body 与 _meta 的卡，不波及设置页等其它 _card。
 * ──────────────────────────────────────────────────────────── */
[class*="_card"]:has([class*="_body"]):has([class*="_meta"]) {
  border-radius: var(--liuli-radius, 14px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-attachment] ._thumbnail / MessageImage ._frame
 * 审计：medium
 * 问题 —— 上传瓦片与消息图片瓦片三处都写死 16px 圆角，而同容器的 _error 用 10px，
 *   同屏自相矛盾；琉璃 64px 级小卡走控件档而非卡片档。
 * 处理 —— 统一到控件档 var(--liuli-radius-sm)=10px。
 * 收窄 —— _frame 用 _gallery 容器限定，避免命中运行时 shell 的 [class*="_frame"]
 *   （该帧背景与区域卡圆角另有规则），也与本组其它规则互不重叠。
 * ──────────────────────────────────────────────────────────── */
[class*="_thumbnail"],
[class*="_gallery"] [class*="_frame"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-attachment] DropOverlay ._mask
 * 审计：medium
 * 问题一 —— 全屏拖拽遮罩写死 backdrop-filter:blur(10px)，既绕开磨砂档位、也绕开
 *   body[data-liuli-blur-off] 缩放护栏；全屏模糊正是拖拽路径上最费的一笔。
 * 问题二 —— z-index:1000 不在琉璃分层表（规范 8）任何档位。
 * 处理 —— 模糊改回标准档变量（全屏层刻意不取 strong 档，控制拖拽路径开销，
 *   护栏生效后为 none）；层级按分层表取「拖拽屏蔽层」2147482600（同为拖拽期间的
 *   全屏 fixed 层）。
 * 收窄 —— 仅命中内含 _illustration 的遮罩（DropOverlay 独有），不动其它 mask。
 * ──────────────────────────────────────────────────────────── */
[class*="_mask"]:has([class*="_illustration"]) {
  z-index: 2147482600 !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-attachment] ImageLightbox ._backdrop
 * 审计：medium
 * 问题 —— 灯箱 backdrop 固定 z-index:1000，低于琉璃全部自有浮层（浮动窗口
 *   2147482400、标准弹出层 2147482500）：灯箱打开时这些浮层仍浮在其上，右上角
 *   ._close(z-index:1) 随 backdrop 建立的堆叠上下文一起被压住。
 * 处理 —— 按分层表取「模态遮罩」档 2147482800。
 * 收窄 —— 仅命中含 _close 的 backdrop。
 * ──────────────────────────────────────────────────────────── */
[class*="_backdrop"]:has([class*="_close"]) {
  z-index: 2147482800 !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-attachment] ImageLightbox ._image
 * 审计：medium
 * 问题一 —— 原图容器固定 12px 圆角，不在琉璃圆角阶梯内（灯箱是最大的一块浮起
 *   表面，应走卡片档）。
 * 问题二 —— 阴影只走宿主 --dsw-shadow-lv3，缺品牌辉光与 --liuli-shadow，与同层
 *   卡片的「宿主档 + glow + shadow」三段式不一致。
 * 处理 —— 圆角落卡片档；阴影补齐三段式；底色补噪声，让透明 PNG 区域也吃到材质。
 *   图像元素自身不透明，故不额外引入 backdrop-filter（只有合成开销、无视觉收益）。
 * ──────────────────────────────────────────────────────────── */
[class*="_backdrop"]:has([class*="_close"]) [class*="_image"] {
  border-radius: var(--liuli-radius, 14px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  box-shadow: var(--dsw-shadow-lv3, none), var(--liuli-glow-brand), var(--liuli-shadow) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-agent-preset] AgentPresetSection ._iconButton::after（data-tip 气泡）
 * 审计：medium
 * 问题 —— 自绘 tooltip 用 label-primary 作底、bg-layer-3 作字色（反色搭配）。琉璃把
 *   两者都重定义为不透明实色（暗色底 #e2e2e6、字 #333d4e），暗色下变成「浅底深字」，
 *   失去反色对比，且与同屏宿主 Tooltip（tooltip-bg + static-neutral-bluish-00）不一致。
 * 处理 —— 统一到宿主 Tooltip 配色；形状、字号、显隐动效保持官方实现。动态取色下
 *   --dsw-alias-tooltip-bg 仍由琉璃按主题给出深色板，白字对比稳定。
 * 收窄 —— 加 [data-tip] 限定，只命中真正渲染气泡的图标按钮。
 * ──────────────────────────────────────────────────────────── */
[class*="_iconButton"][data-tip]::after {
  background: var(--dsw-alias-tooltip-bg) !important;
  color: var(--dsw-static-neutral-bluish-00) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-agent-preset] AgentPresetSection ._card / ._creatorButton
 * 审计：medium
 * 问题 —— 预设卡与「新建」虚线按钮都写死 20px 圆角（超出琉璃阶梯上限档 14px），
 *   同一管理面板里卡比琉璃标准卡更圆，与侧栏/设置页卡片观感不一致。
 * 处理 —— 落到卡片档；_creatorButton 与卡片同尺寸同屏，同走卡片档（非控件档）。
 * 收窄 —— 卡片用 :has(_cardMain) 定位到本区块（_cardMain 为该模块独有），
 *   不误伤设置页其它 _card。
 * ──────────────────────────────────────────────────────────── */
[class*="_cards"] > [class*="_card"]:has([class*="_cardMain"]),
[class*="_card"]:has(> [class*="_cardMain"]),
[class*="_creatorButton"] {
  border-radius: var(--liuli-radius, 14px) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-agent-preset] ._cardMain
 * 审计：medium
 * 问题 —— 卡片内主按钮顶部固定 12px 12px 0 0，与外层圆角不配套（12px 不在阶梯上）。
 * 处理 —— 与外层同档取卡片档，底部保持归零（贴边规则）。
 * ──────────────────────────────────────────────────────────── */
[class*="_cardMain"] {
  border-radius: var(--liuli-radius, 14px) var(--liuli-radius, 14px) 0 0 !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-approval] ApprovalPanel ._card
 * 审计：medium
 * 问题一 —— 审批卡固定 20px 圆角，不在琉璃阶梯内；该卡顶替 composer 出现在输入区，
 *   应与输入卡/相邻卡片同档。
 * 问题二 —— 阴影只有宿主 --dsw-shadow-lv2，缺品牌辉光与 --liuli-shadow，与输入卡
 *   （lv2 + glow + shadow）不一致。
 * 处理 —— 圆角落卡片档；阴影对齐输入卡的三段式。
 * 说明 —— 背景/磨砂已有 [data-approval-key] > div 覆盖，本组不重复。
 * 锚点 —— 宿主把 data-approval-key 挂在组件 root 上，其直接子 div 即 ._card
 *   （已核对官方 JSX 结构），故用该属性而非会随版本变的哈希类名。
 * ──────────────────────────────────────────────────────────── */
[data-approval-key] > [class*="_card"] {
  border-radius: var(--liuli-radius, 14px) !important;
  box-shadow: var(--dsw-shadow-lv2, none), var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

/* ── brand-official+chat+commands ── */
/* ════════════════════════════════════════════════════════════
 * 琉璃覆盖补充 —— brand-official+chat+commands
 * 来源审计：ui-audit/brand-official+chat+commands.json
 * 只处理 high / medium 发现；已 grep 确认下述目标在 liuli-css.ts 中无对应规则
 * （liuli-css.ts 已覆盖 _turnStatus、_bubble 圆角、_toBottom，不重复）。
 * 仅覆盖视觉属性：background / background-image / border / border-radius /
 * backdrop-filter；不动布局尺寸、display、position 与任何交互属性。
 * 官方类名为 <hash>_<local>，用 class*= 前缀匹配；同名兄弟类已逐一核对
 * （见每节注释），无子串误伤。
 * ════════════════════════════════════════════════════════════ */


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-chat] .VnbZpq_fileCard
 * 审计：medium
 * 问题一 —— 圆角写死 16px：既非卡片档 14px、也非控件档 10px，不在琉璃圆角
 *   阶梯（规范 4.1）内，用户调整 --liuli-radius 时这张附件卡不会同步。
 * 问题二 —— border 的回退值是硬编码色 #0000001f，属规范 2.1 明令禁止的
 *   组件内字面量；改为语义令牌 border-l1（卡片/发丝线档，规范 2.2）。
 * 问题三（同项 low 的根因一并修）—— 底走 semi-transparent 的
 *   --dsw-specific-input-major，却缺噪声层与 backdrop-filter；规范 5.2 / 6.4
 *   要求半透明底必须搭 var(--liuli-noise) + 强磨砂，否则在壁纸上只是一块
 *   发灰的半透片而非磨砂卡。
 * 说明：本模块内以 _fileCard 结尾的类只有 VnbZpq_fileCard 一个（同模块的
 *   _fileIcon / _fileMeta 等均不以 _fileCard 结尾），无子串误伤。
 * ──────────────────────────────────────────────────────────── */
[class*="_fileCard"] {
  border-radius: var(--liuli-radius, 14px) !important;
  border-color: var(--dsw-alias-border-l1) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-chat] .PvW7sq_preview
 * 审计：medium
 * 问题 —— 轮次导航悬浮预览卡用 --dsw-alias-bg-layer-1 铺不透明实底，而琉璃把
 *   该令牌重定义为固定实色（liuli-css.ts:91 亮 #eaf0f4 / :222 暗 #1e2530）；
 *   这是浮在会话流与壁纸之上的预览浮层，实底会留下与周围磨砂卡不一致的硬色块。
 *   规范 5.2：无 fixed 后代的悬浮小卡走简化亚克力配方，浮层另加
 *   --liuli-material-blur-strong（backdrop 采样衰减场景）。
 * 圆角 —— 原 10px 已在控件档，但仍以 var(--liuli-radius-sm) 表达，跟随设置。
 * 兄弟类排除：同模块存在 PvW7sq_markPreview（含 _preview 子串），用 :not() 排除。
 * ──────────────────────────────────────────────────────────── */
[class*="_preview"]:not([class*="_markPreview"]) {
  border-radius: var(--liuli-radius-sm, 10px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-commands] ._1q_ULW_card
 * 审计：medium
 * 问题 —— 命令参数下拉菜单面板圆角写死 20px，既非卡片档 14px、也非控件档
 *   10px，更不是药丸档，不在琉璃圆角阶梯（规范 4.1）内；插件的菜单亚克力
 *   规则只改背景不重置圆角，该 20px 会原样留在面板上，与同屏菜单/胶囊的
 *   圆角语言不一致（规范 6.5：菜单面板 var(--liuli-radius-sm) 或 12px）。
 * 背景不在此重复 —— 该面板带 aria-label，已由 liuli-css.ts:513-521 的
 *   div[aria-label][class*="_card"] 统一配方兜住；此处只补它没管的圆角档位。
 * 选择器与 513-521 行同锚点（aria-label 用于收窄到真正的菜单面板），
 *   [class*="_card"][aria-label]（0,2,0）稳过官方 ._1q_ULW_card（0,1,0）；
 *   同模块无 _cardXxx 兄弟类，仅 _check / _detail / _row 等，不误伤。
 * ──────────────────────────────────────────────────────────── */
[class*="_card"][aria-label] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-commands] ._1q_ULW_search
 * 审计：medium
 * 问题 —— 搜索框描边用 --dsw-alias-border-inverted，而琉璃在亮色主题把该令牌
 *   定义为 rgba(0, 0, 0, 0) 全透明（liuli-css.ts:108；暗色 :237 也只有
 *   rgba(255,255,255,0.06)），搜索框在亮色壁纸下失去描边、只剩 8% 的输入底。
 *   规范 6.4 要求输入框边框走 var(--dsw-alias-border-l2)。
 * 只改描边颜色：保留官方 0.5px 线宽、8px 圆角、透明底与内边距，不动布局。
 * 全模块以 _search 结尾的类只有 _1q_ULW_search 一个，无子串误伤。
 * ──────────────────────────────────────────────────────────── */
[class*="_search"] {
  border-color: var(--dsw-alias-border-l2) !important;
}

/* ── conversation+cordis+deliverables ── */
/* ════════════════════════════════════════════════════════════════
 * 琉璃 · 官方 UI 视觉冲突覆盖（第 2 批）
 * 来源包：dsh-client-ui-conversation / -deliverables / -cordis
 * 依据：ui-audit/conversation+cordis+deliverables.json 的 high + medium 发现
 * ----------------------------------------------------------------
 * 纪律：
 *  - 只覆盖视觉属性（background / background-image / color / border* /
 *    border-radius / box-shadow / backdrop-filter / z-index），
 *    不动布局尺寸、display 与交互。
 *  - 选择器用官方 CSS Modules 的 local 名匹配（hash 前缀随构建变化，local 稳定），
 *    并尽量用官方 data-* 锚点收窄作用域，避免误伤宿主其它包与插件自身 DOM
 *    （注意：插件侧边辅助对话的输入框也带 data-composer-card，故卡片内规则
 *    一律再叠加官方专有锚点/local 名，不用裸 [class*=] 宽匹配）。
 *  - 需要压过官方同特异性（甚至更高特异性）规则处用 !important，与
 *    liuli-css.ts 现有风格一致。
 * ----------------------------------------------------------------
 * 本表刻意「不重复」的发现（liuli-css.ts 已有等价覆盖，复核时请对照）：
 *  - 发现 5  .dAK66G_root 的 --deliverable-fill / --deliverable-hover 静态中性色
 *            → [data-presented-file] 上归零 + 品牌 hover 底（680-690 行）。
 *  - 发现 6  .dAK66G_fileIcon 二次铺同一灰底
 *            → [data-presented-file] [class*="_fileIcon"] 置透明（698-699 行）。
 *  - 发现 11 .uPhUma_root 铺 --dsw-alias-bg-base 实底
 *            → div[data-phase]{background:transparent!important}（1219-1221 行）。
 *  - 发现 14 .uPhUma_root[data-phase=active] .uPhUma_composerSeat 渐变实底遮罩
 *            → [data-composer-seat]{background:transparent!important}（588-590 行）。
 *  - 发现 20-26（severity=low）：JdJrwG_panel 阴影 / dAK66G_split /
 *    fU-zVq_versionPicker / Oae22q_count 字体 / 分组标题大写 /
 *    dAK66G_file 几何 / zNic4G_workspace+modalInput —— 不在本批范围。
 * ════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════
 * dsh-client-ui-conversation（对话区 / 输入卡 / 统计浮层）
 * ════════════════════════════════════════════════════════════════ */

/* 【发现 1，high】ContextMeter 上下文统计面板：
 * .JdJrwG_colorTools{--meter-tint:#a78bfa} 把「工具」占用条与图例色块写成硬编码
 * 紫色字面量（同组另两条走 --dsw-static-* 语义色），不随 M3 动态取色变化、暗色档
 * 与相邻刻度不成体系 → 改走语义品牌色。--meter-tint 由 _segment（占用条）与
 * _swatch（图例色块）消费，改这一处两处同步生效。
 * 官方升级复核点：确认 .JdJrwG_colorTools 仍在、且 --meter-tint 仍被 _segment/_swatch 读取。 */
[class*="_colorTools"] {
  --meter-tint: var(--dsw-alias-brand-primary) !important;
}

/* 【发现 2，high】输入卡发送/停止圆钮：
 * .Q7WfXG_primary{background:var(--dsw-alias-button-info-fill);color:#fff} 前景写死不透明
 * 白。琉璃把 button-info-fill 重定义为亮 #0079bf / 暗 #6bbcf5，暗色档是很浅的蓝，
 * 白色箭头对比不足 → 走随亮暗与取色自动翻转的前景令牌。
 * 作用域：官方 DOM 为 InputBar._primary（34px 圆钮，位于 [data-composer-card] 的 _trailing
 * 行内；发送态与停止态共用该类）；限定 button 元素 + 输入卡锚点，避免命中设置页等
 * 其它包的 _primary（dsh-client-ui-settings-models 也有同名 local）。 */
[data-composer-card] button[class*="_primary"] {
  color: var(--dsw-alias-label-primary-foreground) !important;
}

/* 【发现 3，high】输入卡模式选择器（原生 select，appearance:none）：
 * .Q7WfXG_select 把 12×12 折线箭头以 data URI 画进 background-image，描边硬编码
 * #81858C —— document 内的令牌进不了 SVG 图片，DOM 里也没有 svg 可隐藏/替换。
 * 处理：隐藏官方图案，用两层 45° 渐变画出等价的 V 形（每臂 3×3px、等效描边约 1.5px，
 * 位置对齐官方几何：箭头横向占 right-13 ~ right-7、纵向居中），颜色走
 * --dsw-alias-label-secondary，随亮暗与动态取色同步；background-color 不动，
 * 官方 hover 的 interactive-bg-hover 仍然生效。
 * :not([class*="_selector"]) 排除带 selector 子串的类（插件 LiuliAppearance.selector 等）。 */
[data-composer-card] [class*="_select"]:not([class*="_selector"]) {
  background-image:
    linear-gradient(45deg, transparent 33%, var(--dsw-alias-label-secondary) 33%, var(--dsw-alias-label-secondary) 67%, transparent 67%),
    linear-gradient(-45deg, transparent 33%, var(--dsw-alias-label-secondary) 33%, var(--dsw-alias-label-secondary) 67%, transparent 67%) !important;
  background-position: right 10px center, right 7px center !important;
  background-size: 3px 3px, 3px 3px !important;
  background-repeat: no-repeat !important;
}

/* 【发现 4，high】输入卡「切换工作区」虚线描边：
 * .Q7WfXG_cardWorkspaceTrigger:after 用 mask:url("data:image/svg+xml,…rect rx='22'
 * stroke-dasharray='4 4'") 把虚线图案与圆角烧进图片，改 --liuli-radius 或换描边色都
 * 无法同步（DOM 里也没有可隐藏的 svg）→ 去掉 mask，改用令牌化
 * border:1px dashed + border-radius:inherit（跟随卡片自身圆角，官方升级改半径也同步）。
 * :after 是 absolute + inset:-1px，补 1px border 不改变外框尺寸。
 * 选择器用同一元素自匹配（卡片本体同时带 data-composer-card 与 _cardWorkspaceTrigger）。 */
[data-composer-card][class*="_cardWorkspaceTrigger"]::after {
  background: none !important;
  -webkit-mask: none !important;
  mask: none !important;
  border: 1px dashed var(--dsw-alias-border-l3) !important;
  border-radius: inherit !important;
}

/* 【发现 4，high】同上的 hover 反馈：官方靠 :after 底色切到
 * --dsw-alias-state-business-primary，虚线化后同一语义由描边色承担。 */
[data-composer-card][class*="_cardWorkspaceTrigger"]:hover::after {
  border-color: var(--dsw-alias-state-business-primary) !important;
}

/* 【发现 13，medium】上下文统计浮层 z-index:100：
 * .JdJrwG_panel 挂在 [data-composer-card]（InputBar.card）内部，而琉璃对该卡写了
 * isolation:isolate（liuli-css.ts 564-570），面板被关进输入卡的堆叠上下文；
 * 100 又远低于琉璃任何浮层档位，向上弹出时会被上层内容或琉璃浮层压住 →
 * 按规范第 8 节取「标准弹出层」2147482500。
 * 顺带把实底 --dsw-specific-menu（琉璃 = --dsw-alias-bg-layer-3 实色）换成菜单磨砂
 * 配方，半透明底不再挡住 composer 材质；辉光/阴影已由 liuli-css.ts 1685-1688 的
 * [role="dialog"][class*="_panel"] 规则承担，此处不重复。
 * 作用域：[role="dialog"] 是官方该面板自带的语义属性（JdJrwG_panel + role=dialog），
 * 可排除输入卡内其它包的同名 local。 */
[data-composer-card] [role="dialog"][class*="_panel"] {
  z-index: 2147482500 !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* 【发现 18，medium】引用 chip（.rUhRIG_chip）固定 6px 圆角：
 * 琉璃阶梯里 chip 档是 8px（规范 4.1），同一行里 chip 与相邻胶囊控件圆角不成体系。
 * 底色/辉光已由 liuli-css.ts 1474-1477 的 _chip 规则承担，这里只补半径。
 * 注意：现有那条规则依赖的 data-decoration / data-invalid 属性在当前宿主构建
 * （2.0.x，ReferenceChip 只有 chip/invalid/icon/label/marker 五个 local）里已不存在，
 * 复核时可考虑改用 [data-input-scroll] [class*="_chip"] 这类锚点。
 * 作用域：[data-input-scroll] 是输入卡编辑器的滚动区（chip 渲染在编辑器内），
 * 可避开 dsh-client-ui-plan / -message-feedback 里同名的 _chip。 */
[data-input-scroll] [class*="_chip"]:not([class*="_chipLabel"]) {
  border-radius: 8px !important;
}

/* 【发现 19，medium】队列/附件停靠区的文件 chip、缩略图、重命名输入框
 * （.Oae22q_file / _thumb / _editor）统一铺 --dsw-alias-bg-base 实底 + 4~6px 圆角：
 * 这是贴在亚克力输入卡上方的控件，同处叠了三层实色小块 → 按规范 6.4 走
 * 0.45 亚克力 + 噪声 + 磨砂与控件档 10px 圆角，实底色阶消失。
 * _file 的 :not 列表排除同前缀的 _fileIcon / _fileName / _fileSize（子串匹配会连带命中）。
 * 作用域：[data-queue-dock] 是官方队列停靠区锚点（面板与行都在其内）。 */
[data-queue-dock] [class*="_file"]:not([class*="_fileIcon"]):not([class*="_fileName"]):not([class*="_fileSize"]),
[data-queue-dock] [class*="_thumb"],
[data-queue-dock] [class*="_editor"] {
  background-color: rgba(var(--liuli-acrylic-rgb), 0.45) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}


/* ════════════════════════════════════════════════════════════════
 * dsh-client-ui-deliverables（交付物卡 / 工具输出行）
 * ════════════════════════════════════════════════════════════════ */

/* 【发现 7，high】交付物输出段落（PresentRow 的 <pre class="_9x9ddq_output">）用
 * --dsw-alias-bg-layer-1 铺满整块不透明底：琉璃把该令牌定义为亮 #eaf0f4 / 暗 #1e2530
 * 实色，整块盖住磨砂材质与壁纸 → 换内容块亚克力配方；圆角与 cordis 输出块统一到
 * 控件档 10px（官方 8px）。
 * 作用域：[data-tool="present"] 是该行的官方锚点（present 工具行专属，deliverables 独有）。 */
[data-tool="present"] [class*="_output"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* 【发现 15，medium】交付物卡（.dAK66G_file）固定 18px 圆角：
 * 琉璃圆角阶梯只有卡片档 14px（--liuli-radius）与控件档 10px，18px 让官方交付物卡
 * 比同屏插件自绘卡片更圆 → 归卡片档。锚点 [data-presented-file] 即卡片本体
 * （PresentedFileCard 的 _file div 自带该属性）。 */
[data-presented-file] {
  border-radius: var(--liuli-radius, 14px) !important;
}


/* ════════════════════════════════════════════════════════════════
 * dsh-client-ui-cordis（cordis 运行/定义卡与清单弹出面板）
 * ════════════════════════════════════════════════════════════════ */

/* 【发现 8，high】cordis 业务卡内层（.sbk6oW_business）用 --dsw-alias-bg-base 做实底：
 * 琉璃的 bg-base 是亮 #f8f9fa / 暗 #121316 不透明页面底色，在会话列里切出一块纯色
 * 矩形 → 亚克力卡片配方；半径归内嵌小卡档 10px（官方 12px）。
 * 作用域：[data-cordis-business-view] 是官方业务视图锚点（cordis 独有）。 */
[data-cordis-business-view] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* 【发现 9，high ＋ 发现 17，medium】cordis 输出块
 * （.sbk6oW_output / .GWuUma_output）读取被琉璃重定义为实色的
 * --dsw-alias-markdown-code-block（亮 #eef2f6 / 暗 #191d24），且固定 8px 圆角、
 * .5px 描边 → 换半透明内容块底（不再出现不随材质变化的硬边色块），圆角归控件档
 * 10px，描边宽度统一到 1px（规范 4.1 / 6.2.2 要求同屏描边粗细一致）。
 * 只改 border-width / border-style 不改 border-color：两个包官方描边色本就不同
 * （border-l1 / border-l4），改宽度即可，避免压过官方其它状态色。
 * 作用域：[data-cordis-status] 同时覆盖 CordisRunRow.card 与 CordisDefineRow.card
 * （官方两张卡都带该属性）；_output 这个 local 全宿主只在这两个包出现。 */
[data-cordis-status] [class*="_output"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  border-width: 1px !important;
  border-style: solid !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* 【发现 9，high】业务卡内的 output 是官方刻意做的贴边内嵌块
 * （.sbk6oW_business .sbk6oW_output{border:none;border-radius:0}）：材质由外层业务卡
 * 承担，这里只去底保持贴边，避免同一层亚克力叠两次形成更闷的色块。 */
[data-cordis-business-view] [class*="_output"] {
  background-color: transparent !important;
  background-image: none !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  border: none !important;
  border-radius: 0 !important;
}

/* 【发现 10，high】药丸「查看」按钮（.GWuUma_inspectButton）用 --dsw-alias-bg-base 实底：
 * 同屏插件侧药丸按钮（TurnFileCard、交付物卡「打开」胶囊）都走透明底 +
 * --liuli-border-hairline，这里按规范 6.1.4 对齐（不再叠不透明底，也不再出现
 * .5px 与 1px 描边混用）。
 * 作用域：[data-cordis-status] 限定 cordis 卡（dsh-client-ui-skill / -tool 也有同名 local，
 * 不在本批审计范围内，不连带改动）。 */
[data-cordis-status] [class*="_inspectButton"] {
  background-color: transparent !important;
  background-image: none !important;
  border: 1px solid var(--liuli-border-hairline) !important;
  color: var(--dsw-alias-label-secondary) !important;
}

/* 【发现 10，high】官方 hover 是实底 --dsw-alias-interactive-bg-hover-solid（不透明），
 * 与透明底药丸配方冲突 → 换成非实底 hover 令牌 + 主文字色，保住悬停反馈。 */
[data-cordis-status] [class*="_inspectButton"]:hover {
  background-color: var(--dsw-alias-interactive-bg-hover) !important;
  color: var(--dsw-alias-label-primary) !important;
}

/* 【发现 17，medium】面板内嵌行（.fU-zVq_row）固定 .5px 描边 + 12px 圆角：
 * 圆角归控件档 10px；描边宽度统一 1px（同屏交付物卡外层用 1px）。
 * 不改 border-color：awaiting 态官方用 --dsw-alias-state-business-primary 标色，
 * 简写会把它一起压掉。[data-cordis-row] 是官方行锚点（CordisPanel.row 自带）。 */
[data-cordis-row] {
  border-width: 1px !important;
  border-style: solid !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* 【发现 17，medium】状态提示块（.sbk6oW_message）铺不透明
 * --dsw-alias-button-ghost-active-fill（亮 #e8eef4 / 暗 #333d4e）+ 8px 圆角：
 * 同在 cordis 卡内的内嵌小块 → 0.45 亚克力底 + 控件档圆角。 */
[data-cordis-status] [class*="_message"] {
  background-color: rgba(var(--liuli-acrylic-rgb), 0.45) !important;
  background-image: var(--liuli-noise) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* 【发现 12，medium ＋ 发现 16，medium】cordis 清单弹出面板（.fU-zVq_panel）：
 *  - z-index 只有 30：面板已 position:fixed 锚到视口（组件内按 getBoundingClientRect
 *    算 left/bottom），30 一旦与侧栏 / 浮动窗口 / 悬浮球重叠就会被整片压住 →
 *    按规范第 8 节取「标准弹出层」2147482500。
 *  - 固定 12px 圆角、无描边、只有 host 阴影 → 按规范 6.5.2 的菜单面板配方：
 *    --liuli-radius-sm(10px) + 1px --dsw-alias-border-l2 描边 + 琉璃辉光/投影。
 *  - 实底 --dsw-specific-menu（琉璃 = --dsw-alias-bg-layer-3 实色）一并换成亚克力
 *    磨砂（backdrop-filter 走 strong 档：面板与背景之间隔了会话卡的材质层）。
 * 作用域：[data-cordis-panel] 是官方面板锚点（CordisPanel.panel 自带）。 */
[data-cordis-panel] {
  z-index: 2147482500 !important;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

/* ── directory-picker-browse+directory-picker-native+goal ── */
/* ════════════════════════════════════════════════════════════
 * 官方 UI 视觉冲突覆盖 —— 组：directory-picker-browse / directory-picker-native / goal
 * 来源审计：ui-audit/directory-picker-browse+directory-picker-native+goal.json
 *   （high 1 条、medium 7 条；low 4 条按规则跳过：objectiveInput:focus 弱焦点、
 *     _bar 固定 12px 圆角、crumbBar 的 #0000 字面量、title 16px/510 字阶）
 * 只覆盖视觉属性（background / background-image / color / border-color /
 *   border-radius / box-shadow / backdrop-filter），不动布局尺寸、display 与交互。
 * 选择器走官方 CSS module 的 local 名子串匹配 + 稳定锚点作用域；hash 前缀
 *   （HzweGa_ / zzK9Ca_）随官方构建变化，故不写死。directory-picker-native
 *   变体复用同一 DirectoryBrowser.module.css，下列规则同时生效。
 * 已 grep liuli-css.ts 确认无重复：[data-goal-bar] 本体已有噪声+磨砂+辉光
 *   （1592 行），本文件补其内部子元素；[role="dialog"][class*="_dialog"] 已覆盖
 *   对话框本体背景（515 行）、[role="dialog"] input 已覆盖对话框内输入框背景
 *   （1717 行），故这两处背景不重复声明。
 * ════════════════════════════════════════════════════════════ */

/* ── dsh-client-ui-goal ───────────────────────────────────── */

/* 发现 1（high）：目标条内联编辑输入框 .zzK9Ca_objectiveInput 用不透明页面底色
   var(--dsw-alias-bg-base) 作背景 —— 琉璃把该令牌重定义为实色（亮 #f8f9fa /
   暗 #121316，动态取色亦为 #rrggbb 无 alpha），在已磨砂的 GoalBar 里挖出一块实色底板。
   改琉璃输入面配方：亚克力底 + 噪声 + 强磨砂（该输入框嵌在自身带 backdrop-filter
   的条内，属嵌套采样衰减场景，走 strong 档并回退标准档）。
   官方用 background 简写，必须 background-color / background-image 分写才能压过。 */
[data-goal-bar] [class*="_objectiveInput"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* 发现 2（medium）：同输入框写死 6px 圆角 —— 6px 在琉璃阶梯里属 18–22px 迷你
   按钮/代码段档，不在输入框档，且不随设置页圆角滑条变化。
   改控件档 var(--liuli-radius-sm)（默认 10px）。 */
[data-goal-bar] [class*="_objectiveInput"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* 发现 4（medium）：目标条图标按钮 .zzK9Ca_iconBtn 28×28 用 999px 全圆角（正圆），
   与琉璃工具按钮的方圆角体系冲突（999px 只给药丸按钮/badge/chip/toast）。
   按 style-guide 4.1 与 6.1.1：28×28 图标按钮 = 8px。
   作用域限定 [data-goal-bar]，避免误伤消息流行内 _iconBtn（liuli-css.ts 另有
   fileRow menuWrap 覆盖，两者互不影响）。 */
[data-goal-bar] [class*="_iconBtn"] {
  border-radius: 8px !important;
}

/* ── dsh-client-ui-directory-picker-browse ────────────────── */

/* 发现 6（medium）：目录列表右下加载浮标 .HzweGa_loadingFloat 用不透明实底
   var(--dsw-alias-bg-layer-2)（亮 #dde5ed / 暗 #283040，动态取色同为无 alpha 实色）
   且完全没有圆角，在磨砂对话框上是一块直角实色块。
   改琉璃浮层配方（style-guide 5.2）：亚克力 + 噪声 + 强磨砂 + 控件档圆角。
   只改视觉，不动 position/padding/bottom/right，浮标位置与命中区不变。 */
[class*="_loadingFloat"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* 发现 7（medium）：新建文件夹输入框 .HzweGa_createInput 44px 高配 22px 圆角
   （恰好等于高度一半的全药丸形），琉璃体系里没有对应档位（药丸只给 pill 按钮/
   badge/chip，输入框统一控件档），且不随 --liuli-radius-sm 调整。
   背景属 [role="dialog"] input 已有亚克力覆盖范围，此处只修形状、不重复声明。 */
[class*="_createInput"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* 发现 8（medium）：该输入框自带 outline:none 且本包无任何 :focus 规则，键盘焦点
   没有品牌反馈（全局 :focus-visible 与本类同为 0-1-0 特异度，胜负取决于注入顺序，
   不可依赖）。按 style-guide 6.1.7 补等价可见焦点：品牌 70% 描边 + 3px 品牌 12%
   光圈。只改 border-color / box-shadow，官方 0.5px 描边宽度与尺寸不变。 */
[class*="_createInput"]:focus {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent) !important;
}

/* 发现 9（medium）：28px 目录列表行 .HzweGa_row 写死 6px 圆角（迷你按钮档），
   其 hover/选中底色已是琉璃品牌色，但高亮形状与琉璃其它列表行不一致，也不随圆角
   设置变化。改控件档 var(--liuli-radius-sm)。
   用 rowSeat > row 的父子结构锚定，避免命中 _rowName / _rowIcon / _rowChevron
   等同前缀子元素以及设置对话框里的其它 _row 容器；_rowSelected 与 _row 同元素，
   一并生效。 */
[class*="_rowSeat"] > [class*="_row"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* 发现 10（medium）：目录浏览对话框头/脚分隔线用最强档 border-l3（亮 0.14 / 暗 0.16，
   是发丝线档 l1 的两倍以上），明显重于琉璃所有其它面板分隔线。
   按描边阶梯改 l1；只用 border-color 改颜色，不动 0.5px 宽度与布局。
   :has(_crumbBar) 把作用域锁死在本目录浏览对话框上，避免误伤设置对话框的 _header。 */
[class*="_dialog"]:has([class*="_crumbBar"]) [class*="_header"],
[class*="_dialog"]:has([class*="_crumbBar"]) [class*="_footerBar"] {
  border-color: var(--dsw-alias-border-l1) !important;
}

/* 同发现 10：Miller 列间竖线 .HzweGa_divider 也用 l3 画，且走 background 简写，
   用 background-color 分写覆盖为发丝线档。 */
[class*="_dialog"]:has([class*="_crumbBar"]) [class*="_divider"] {
  background-color: var(--dsw-alias-border-l1) !important;
}

/* ── dsh-client-ui-workspace ── */
/* ════════════════════════════════════════════════════════════
 * 琉璃覆盖补充 —— dsh-client-ui-workspace（侧栏工作区 / 会话浏览树）
 * 来源审计：ui-audit/workspace.json（其 package 字段 = dsh-client-ui-workspace；
 *   任务书所给 ui-audit/dsh-client-ui-workspace.json 该路径不存在，按 package 对齐）。
 * 处理范围：high 4 条（hover 卡硬编码文字色）+ medium 5 条（圆角阶梯 4 条、
 *   焦点可见性 1 条）。
 * 跳过：low 5 条 —— .ozLDBG_projectRow/.ozLDBG_sessionRow 行圆角 8px、
 *   .ozLDBG_iconButton 行内 4px、.ozLDBG_renameInput 不透明 elevated-fill
 *   （本构建未被 JSX 引用，死样式）、.SJMXQW_fade 渐变终点令牌、以及
 *   「官方 outline 图标集未走 Material Symbols」的图标体系项（按约定跳过）。
 * 已 grep 确认无重复：liuli-css.ts / liuli.css 对本包
 *   _hoverContent / _hoverTitle / _hoverPath / _hoverTime / _hoverStatus /
 *   _sectionHeader / _searchExpanded / _searchSlot / _searchButton /
 *   _clearButton / _renameInput 全部零规则；仅
 *   [class*="_sidebarCol"] [class*="_iconButton"]:hover（liuli-css.ts:1363-1371）
 *   管 hover 配色，不管圆角，与本文件不冲突。
 * 仅覆盖视觉属性：color / border-color / border-radius / box-shadow；
 *   不动布局尺寸、display、position、transition 与任何交互属性。
 * 官方类名为 <hash>_<local>（本包 hash 现为 SJMXQW / ozLDBG，跨版本会变），
 *   故全部按局部名用 class*= / class$= 匹配；跨包同名类已逐一收窄（见各节注）。
 * ════════════════════════════════════════════════════════════ */


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-workspace] .ozLDBG_hoverTitle / _hoverPath / _hoverTime / _hoverStatus
 * 审计：high ×4（同一根因：hover 卡文字色硬编码）
 * 问题 —— 会话 / 工作区 hover 卡（primitives HoverCard）四段文字全是字面量：
 *   #fff（标题）、#cfd3d6 ×2（工作区路径 / 相对时间）、#adb2b8（状态行）。这套灰阶
 *   是为官方深色卡面 --dsw-hovercard-bg:#2C2C2E（亮暗同色）挑的；琉璃已把该卡换成
 *   半透明亚克力底（liuli-css.ts:512-521），浅色壁纸下白字压浅磨砂仅约 1.1:1 不可读。
 *   当前之所以"还能看"，只因为 liuli-css.ts:526-529 用
 *   div[aria-label][class*="_card"][class*="_copyable"] * 把整卡文字统一刷成
 *   label-primary —— 可读性完全押在官方同时保留 _card + _copyable + aria-label 三者上，
 *   官方一旦出现不传 copyText 的 hover 卡（如空会话、搜索结果预览）即刻失效；
 *   且该 '*' 通配把标题 / 路径 / 时间 / 状态四档层级压平成同一个颜色，
 *   与同屏自有状态语义粒度不一致（规范 2.2 / 3.2）。
 * 处理 —— 四段文字各自接到语义令牌，恢复正常层级：标题 label-primary、
 *   路径 label-secondary、时间 label-tertiary、状态行 label-secondary。
 *   末条 :not([data-state]) 精确排除 StateDot 圆点那个 span（primitives 的 dot 带
 *   data-state，ongoing 态渲染为 svg，均不命中），只让状态文字继承行色 ——
 *   状态色仍由 StateDot 自身的 data-state 规则给出，不被本块刷平（规范 6.7）。
 *   特异性 [class*="_hoverContent"] > [class*="_hoverTitle"] = 0,2,0，
 *   末条 0,3,1，配 !important 稳过官方 .ozLDBG_hoverTitle（0,1,0）与
 *   liuli-css.ts:526-529 的 '*'（0,2,1，无 !important）。
 * 复核 —— 官方若把这四色改为语义令牌，本块整段可删；届时 liuli-css.ts:526-529
 *   的 '*' 补丁也建议一并收敛，避免继续压平层级。
 * ──────────────────────────────────────────────────────────── */
[class*="_hoverContent"] > [class*="_hoverTitle"] {
  color: var(--dsw-alias-label-primary) !important;
}

[class*="_hoverContent"] > [class*="_hoverPath"] {
  color: var(--dsw-alias-label-secondary) !important;
}

[class*="_hoverContent"] > [class*="_hoverTime"] {
  color: var(--dsw-alias-label-tertiary) !important;
}

[class*="_hoverContent"] > [class*="_hoverStatus"] {
  color: var(--dsw-alias-label-secondary) !important;
}

[class*="_hoverContent"] > [class*="_hoverStatus"] > span:not([data-state]) {
  color: inherit !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-workspace] .SJMXQW_sectionHeader（审计：medium）
 * 问题 —— 圆角写死 12px，不在琉璃阶梯（规范 4.1：999 / 14 / 10 / 8 / 7 / 6 / 4 / 2）内，
 *   不随「圆角大小」设置变化；同屏相邻的搜索容器 10px、行 hover 8px，一行里三套圆角。
 * 处理 —— 落到控件 / 行档 var(--liuli-radius-sm)（该变量由设置派生：
 *   liuli-runtime.ts:407 写入 min(用户圆角, 10)）。该盒只用来裁剪内部滑动标签
 *   （overflow:hidden），改圆角不改盒尺寸、不影响 36px 行高与标签过渡。
 * 选择器：本模块以 _sectionHeader 结尾的类只此一个（另有 _sectionLabel /
 *   _sectionLabelHidden 含 _section 前缀，不被 *= "_sectionHeader" 命中）。
 * ──────────────────────────────────────────────────────────── */
[class*="_sectionHeader"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-workspace] .SJMXQW_iconButton / _search / _searchButton / _clearButton
 * 审计：medium（侧栏搜索 / 清除 / 新建工作区 / 视图选项四个按钮全为正圆）
 * 问题 —— 官方一律 border-radius:50%：图标按钮 28×28（_iconButton / _search /
 *   _searchButton）、清除 24×24。而同一元素 _search 加挂 _searchExpanded 后圆角变
 *   10px 方角，同一控件两种形状语言；四个按钮也都不随「圆角大小」设置走
 *   （规范 4.1「控件永远 7–10px 档」/ 6.1.1 尺寸对照表）。
 * 处理 —— 统一到控件档 var(--liuli-radius-sm)（= min(用户圆角, 10)）。此处取设置驱动的
 *   10px 档、而非 §6.1.1 给 28px 图标按钮的静态 7 / 8px 游标值：这四件控件与展开态
 *   搜索框同处一行，只有同档才能消除「折叠 ↔ 展开」的圆角跳变（审计对 .SJMXQW_searchExpanded
 *   的诉求正是「与相邻 .SJMXQW_iconButton 不得脱节」），并让四个按钮跟随设置。
 *   只改圆角：保留官方 28 / 24px 尺寸、hover 底、0.18s 过渡与全部交互。
 * 兄弟类收窄 —— _iconButton 在 6 个官方包同名（本包另有 ozLDBG_iconButton 16×16
 *   行内入口，属审计 low 项，不在此处改），故限定在 _sectionHeader 内（该排按钮的实际
 *   容器：视图选项 / 新建工作区都在 headerActions 里）；_search 用 $= 后缀精确命中
 *   容器本体，避免命中 _searchSlot / _searchButton / _searchInput / _searchStatus /
 *   _searchTree / _searchExpanded 等同前缀兄弟（规范 9.2）。
 *   corner-shape:round 是 Chrome 139+ 属性、不在本次视觉属性白名单内，未处理
 *   （它只影响超椭圆外轮廓，半径形状已由本块接管）。
 * ──────────────────────────────────────────────────────────── */
[class*="_sectionHeader"] [class*="_iconButton"],
[class*="_sectionHeader"] [class$="_search"],
[class*="_sectionHeader"] [class*="_searchButton"],
[class*="_sectionHeader"] [class*="_clearButton"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-workspace] .SJMXQW_searchExpanded（审计：medium）
 * 问题 —— 展开态搜索框圆角写死 10px 字面量。数值恰好等于控件档默认值，属
 *   「看起来对、机制错」：不读 var(--liuli-radius-sm)，用户在设置里调大 / 调小圆角后
 *   该输入框不跟随，与同屏控件脱节（规范 10 checklist：圆角一律走 --liuli-radius-sm）。
 * 处理 —— 改走 var(--liuli-radius-sm)（= min(用户圆角, 10)），与上一块的
 *   _search / _searchButton / _clearButton 同档：折叠态容器（$= "_search" 命中）与
 *   展开态容器（本块命中）取值一致，展开动画过程中圆角不再跳变。
 *   只换圆角表达式：保留官方 0.5px 描边、30px 高、margin-inline:-2px、透明底与内边距
 *   （该盒静息描边色 --dsw-alias-border-l4 不属本组审计项，未改；若其它组按
 *   「输入框描边走 border-l2」统一处理过 [class*="_search"]，本块不受影响）。
 * 兄弟类：_searchExpanded 仅本包所有；同模块的 _searchSlotExpanded 拼写为
 *   "_searchSlot" + "Expanded"，不含 "_searchExpanded" 子串，*= 匹配不会误伤它。
 * ──────────────────────────────────────────────────────────── */
[class*="_searchExpanded"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-workspace] .SJMXQW_renameInput（审计：medium）
 * 问题 —— 工作区 / 会话重命名输入框（模态内，44px 高）圆角写死 22px，是按高度反推的
 *   药丸魔法值，不读 var(--liuli-radius-sm)；同屏其它 input 会跟随设置，于是两种圆角并存
 *   （规范 6.4：输入框统一 border-radius: var(--liuli-radius-sm, 10px)）。
 * 处理 —— 取控件档而非 999px 药丸：药丸语义在琉璃只给状态胶囊 / 徽标 / chip（规范 4.1），
 *   44px 文本输入框走药丸会让两侧基线留白失衡；改 var(--liuli-radius-sm)。
 *   保留官方 0.5px 描边、44px 高、7px 14px 内边距、autofocus 全选等度量与交互。
 * 覆盖面说明 —— 本包两处 renameInput 同后缀：SJMXQW_（模态内，审计项）与 ozLDBG_
 *   （行内死样式，审计 low 项，本构建 JSX 未引用）。两者一并跟随设置；后者不渲染，
 *   无副作用，也避免官方哪天启用它时再留一个游离圆角。
 * ──────────────────────────────────────────────────────────── */
[class*="_renameInput"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}


/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-workspace] .SJMXQW_searchInput / .SJMXQW_renameInput（审计：medium）
 * 问题 —— 两处输入框都自写 outline:none，而全包无任何 :focus / :focus-within 规则补
 *   可见焦点：侧栏搜索框聚焦时只剩静态 0.5px border-l4，键盘用户看不到落点，同时压掉了
 *   琉璃全局的 :focus-visible 品牌描边（规范 6.1.7 明令「组件内若自行 outline:none，
 *   必须补等价可见焦点」）。
 * 处理 —— 按规范 6.4 / 6.1.7 的输入框焦点配方补品牌反馈：描边 70% 品牌 +
 *   3px 12% 品牌光圈。搜索框的框体是外层 .SJMXQW_searchExpanded
 *   （规范 6.4：搜索框 = 外框 + 内透明 input，外框负责描边圆角底），故焦点挂在
 *   :focus-within 上；重命名输入框自身带描边，直接 :focus。
 *   只写 border-color 与 box-shadow —— 两者都不参与布局，不改官方 0.5px 描边线宽，
 *   不会出现 1px 跳动；搜索框外框 30px 高、所在 sectionHeader 36px 高，3px 光圈
 *   恰好落在行内，不会被 overflow:hidden 裁掉。
 * ──────────────────────────────────────────────────────────── */
[class*="_searchExpanded"]:focus-within,
[class*="_renameInput"]:focus {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent) !important;
}

/* ── input-trigger+jobs+layout ── */
/* ════════════════════════════════════════════════════════════════════════════
 * 琉璃主题 · 官方 UI 视觉冲突覆盖 — 组：input-trigger + jobs + layout
 *
 * 输入：ui-audit/input-trigger+jobs+layout.json（14 条发现）
 * 本组覆盖 high / medium 共 5 条；另附带 1 条与它们同选择器、同批次修复的
 * 菜单描边项（low，见 [2] 说明）；其余 low 共 7 条按约定跳过（见文件末尾清单）。
 *
 * 选择器纪律（style-guide §9.2）：一律用官方 CSS module 类名前缀/子串匹配
 * （[class*="_menu"] 等），hash 前缀随官方版本变、local 名稳定；需要压过官方
 * 同特异性或更高特异性规则时用 !important（§9.3），并逐组写明原因。
 * 本文件只覆盖视觉属性（background / background-image / color / border /
 * border-radius / box-shadow / backdrop-filter / z-index），不触碰布局尺寸、
 * display 与交互。
 *
 * 去重结论（写前已 grep liuli-css.ts）：以下为官方自带、本组不再声明
 *  --dsw-scrollbar-thumb / --dsw-scrollbar-thumb-hover（滚动条令牌重定向，
 *  琉璃已有全局品牌滚动条规则 liuli-css.ts:367-378）；
 *  --dsw-elevation-stroke-color（官方描边色变量，未见视觉冲突）。
 * ════════════════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════════════════
 * [1] 官方弹出菜单面板：圆角 + 描边 + 浮层层级 三合一
 *     来源包：@deepseek-ai/dsh-client-ui-input-trigger（.iRJKyq_menu 斜杠/@ 候选菜单）
 *             @deepseek-ai/dsh-client-ui-jobs（.ro6IpW_menu 后台任务列表浮层）
 *
 * 解决的问题（审计 5 条）：
 *  (a) 两处都固定 border-radius:20px，超出琉璃圆角阶梯（弹层大卡 14px、
 *      菜单面板 10–12px）。liuli-css.ts:540 的通用菜单规则只覆盖
 *      background-color / background-image / backdrop-filter，不接管圆角，
 *      20px 会原样保留，与同屏琉璃菜单（10px）并排明显更圆。
 *      → 收进菜单面板档 var(--liuli-radius-sm)（10px，style-guide §4.1 / §6.5.2）。
 *  (b) 两处都显式 border:0，缺少琉璃菜单配方的 1px 描边（§6.5.2 要求
 *      border: 1px solid var(--dsw-alias-border-l2)；§2.3 的 --liuli-border-hairline
 *      是同一思路）。琉璃的通用菜单规则只补背景/噪声/磨砂、不补描边，
 *      半透明材质落在壁纸上只剩阴影定界，面板边缘发虚。
 *      → 补 1px border-l2 描边。
 *  (c) 两处固定 z-index:100，远低于琉璃浮层阶梯。style-guide §8：宿主手柄层
 *      50–60、浮动窗口 2147482400、布局菜单 2147482450、**标准弹出层 2147482500**、
 *      悬浮球 2147483000。官方菜单只有 100，与琉璃浮动窗口/悬浮球同屏时数值上
 *      必然被压在其下。
 *      → 按 §8「普通弹出层一律 2147482500」取值。
 *
 * 选择器复用 liuli-css.ts:540 的通用菜单形状（含 dock 工作台/模态排除项），
 * 保证与插件已有规则同形、不误伤 _menuWrap / _menuCard 等兄弟类。
 *
 * 【为什么不用官方 border:0 的残留】官方 border:0 会把 border-style 置为 none，
 * 只写 border-color 无法让描边出现（style:none 时宽度与颜色均不渲染），
 * 故这里显式补 border-style: solid。
 *
 * 未写入的审计项（避免与既有覆盖重复）：background: var(--dsw-specific-menu)
 * 在 liuli-css.ts:197 / 326 被琉璃重定义为 var(--dsw-alias-bg-layer-3)
 * （亮 #d2dce6 / 暗 #333d4e，不透明实底），但 liuli-css.ts:540-546 的
 * div[class*="_menu"] / ul[class*="_menu"] 通用规则已经给出
 * rgba(--liuli-acrylic-rgb, 0.7) + var(--liuli-noise) + blur-strong 的磨砂配方。
 * 本文件再写一遍只会与插件产生维护漂移（将来配方调整时这里会变成硬编码的
 * 第二真相），故仅登记该依赖，不重复声明材质三件套。
 * ════════════════════════════════════════════════════════════════════════════ */

div[class*="_menu"]:not([data-testid="dock-menu-card"] *):not([data-testid="dock-modal"] *),
ul[class*="_menu"] {
  border-width: 1px !important;
  border-style: solid !important;
  border-color: var(--dsw-alias-border-l2) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  z-index: 2147482500 !important;
}


/* ════════════════════════════════════════════════════════════════════════════
 * [2] @deepseek-ai/dsh-client-ui-layout · ._1qAH1q_handle
 *     列宽拖拽手柄（cursor:col-resize 的 8px 命中区），官方 z-index:11。
 *
 * 问题：低于琉璃宿主手柄层（style-guide §8 = 50–60）。琉璃浮层/面板只要压到
 * 列边界就会吃掉这 8px 命中区，官方列宽拖拽失效（琉璃自己接管的手柄走
 * .dshDesktopResizeHandle / sash 体系）。
 *
 * 处理：抬到宿主手柄层上限 60。手柄本身只是命中区、常态不可见，不跑任何
 * 入场/动画，抬层不改变视觉表现，只恢复与琉璃手柄/浮层的正确前后关系。
 *
 * 【一并登记的坑】它唯一的父级 ._1qAH1q_overlayLayer 是 pointer-events:none 的
 * 浮层落点，故本规则只可能让手柄盖不住别的东西、不可能吞掉其下的点击；
 * 但父级的 pointer-events / 尺寸属交互与布局范畴，本文件按硬性要求不触碰，
 * 留给插件侧处理。
 * ════════════════════════════════════════════════════════════════════════════ */

[class*="_handle"] {
  z-index: 60 !important;
}


/* ════════════════════════════════════════════════════════════════════════════
 * [3] @deepseek-ai/dsh-client-ui-layout · ._1qAH1q_overlayLayer
 *     shell.overlay 浮层落点（AppFrame / DockShellFrame 在此 renderSlot），
 *     官方 z-index:20，与琉璃浮层档位（1000 / 2147482400 / 2147482500）严重脱节。
 *
 * 关键点：固定 z-index 会为这棵子树建立**栈上下文** —— 层内写再高的 z-index
 * 也被封在 20，无法与琉璃分层表对齐；反过来官方 z-index:100 的弹出菜单在数值上
 * 会整层盖过它（按 §8，弹出层应低于浮动窗口）。
 *
 * 处理：按 §8 抬进宿主手柄层区间，取 50 —— 与手柄同段但低于手柄的 60，
 * 保证 [2] 的手柄永远优先可抓。
 *
 * 【为什么不是 2147482500】本元素的祖先链里存在被琉璃 !important 固定的栈上下文：
 * [class*="_sidebarCol"] > div > [class*="_root"] 被 liuli-css.ts:1269-1271 定为
 * z-index:1 !important，而 sidebarCol 属于官方 AppFrame 结构 —— 本浮层若落在该
 * 子树内，层内 z-index 再高也只能停在那棵子树的层上。要真正与整张分层表对齐，
 * 还须先解除这条祖先栈上下文（属插件侧改动，不在本文件范围）。这里给出层内
 * 可达的最大档，收益是：高于同层官方内容列、低于琉璃浮动窗口/弹出层，
 * 与 §8 的相对次序一致。
 * ════════════════════════════════════════════════════════════════════════════ */

[class*="_overlayLayer"] {
  z-index: 50 !important;
}


/* ════════════════════════════════════════════════════════════════════════════
 * [4] @deepseek-ai/dsh-client-ui-layout · ._1qAH1q_sidebarCol
 *     侧栏列自带填充底（--dsw-specific-sidebar-fill）+ 0.5px 分栏描边 +
 *     overflow:hidden，与琉璃「侧栏是留白浮卡」的模型正好相反。
 *
 * **本条不写规则**：liuli-css.ts:861-869 已用 !important 落实
 * background:transparent / border-right:none / overflow:visible，并附注释说明
 * 官方 overflow:hidden 会裁掉侧栏卡右侧的辉光与阴影。按任务要求「不要重复
 * liuli-css.ts 里已有的覆盖」，此处不补；审计另提的 0.5px 发丝描边也同属该规则
 * 已清掉的声明（border-right:none 之后不存在残留描边）。
 * ════════════════════════════════════════════════════════════════════════════ */


/* ════════════════════════════════════════════════════════════════════════════
 * 跳过清单（不在本文件写规则的理由）
 *
 * · input-trigger/.iRJKyq_item 字号 14px/22px（low）
 *     —— 字号属排版度量，不在「本组只覆盖 8 类视觉属性」范围内。
 * · input-trigger/.iRJKyq_drillHint 圆角 4px（low）
 *     —— 颜色已走 --dsw-alias-label-caption（liuli-css.ts:146 / 277 已提供），
 *        无硬编码色可换；纯圆角 low 项不在 high/medium 范围。
 * · input-trigger/.iRJKyq_drill（20px 小按钮圆角，low）
 * · input-trigger/.iRJKyq_crumb（chip 圆角 6px，low）
 * · jobs/.ro6IpW_trigger 圆角与 gap/padding（low）
 *     —— gap / padding 属间距与布局尺寸，硬性要求不得改；其背景 background:0 0
 *        本身是对的（审计亦如此认定）。
 * · jobs/.ro6IpW_kind 角标圆角 5px（low）
 * · jobs/.ro6IpW_label 字体令牌（low）
 *     —— 字体族切换不在本组可覆盖的视觉属性清单内。
 *
 * 另：任务书举例用到的 [class*="_hoverTitle"] 在本组 14 条发现中不存在，
 * 故未生成对应规则。
 * ════════════════════════════════════════════════════════════════════════════ */

/* ── message-feedback+model-selection+open-in-app ── */
/* ════════════════════════════════════════════════════════════
 * 琉璃覆盖补充：message-feedback + model-selection + open-in-app
 * 来源审计：ui-audit/message-feedback+model-selection+open-in-app.json（14 条）
 * 只处理 high / medium；已 grep liuli-css.ts 确认下列目标无对应规则：
 *   _detail / _warning / _submit 零命中；_dialog 的命中处（:515 背景+磨砂、
 *   :1686 阴影）都不含圆角。
 * 仅覆盖视觉属性（background / background-image / color / border /
 * border-radius / box-shadow / backdrop-filter / z-index），不动布局与交互。
 *
 * 本批**未写规则**的审计项及原因（便于官方升级后复核）：
 *  - model-selection '.*_menu' 实底 '--dsw-specific-menu'（high，发现 7）：
 *    该令牌在琉璃等于不透明的 '--dsw-alias-bg-layer-3'（liuli-css.ts:197 / :326），
 *    但背景 + 噪声 + 强磨砂已由 liuli-css.ts:540 的
 *    'div[class*="_menu"]:not(...):not(...)' 兜底为 0.7 亚克力（特异性 0-3-1，
 *    稳过官方 0-1-0），故不重复声明；该 0.7 是 liuli-css.ts:531-533 注释里
 *    为「亮壁纸上浅色菜单文字不可读」专门调过的可读性值，也不宜改写成
 *    '--liuli-material-opacity'。本文件只补它没管的 z-index 与圆角。
 *  - model-selection '.*_groupTitle' sticky 实底（high，发现 10）：已由
 *    liuli-css.ts:552-553 的 '[class*="_menu"] [class*="_groupTitle"]' 完整覆盖
 *    （半透明亚克力 0.7 + 噪声），无需重复。
 *  - open-in-app AppIcon 内联自绘 SVG 回退图形（high，发现 12）：属内联 SVG
 *    图标体系，按硬性约定排除，不写 CSS 覆盖。
 *  - 其余 4 条为 low（0.5px 描边 / elevation 投影 / 商标位图，发现 5 / 11 /
 *    13 / 14），按 severity 约定跳过。
 * ════════════════════════════════════════════════════════════ */

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-message-feedback] .OYavZa_detail（high + medium，发现 1 / 2）
 * 问题 1（high，不透明实底）：反馈弹窗内的多行输入 textarea 用
 *   'background: var(--dsw-alias-bg-layer-1)' 铺整块实底，而琉璃已把该令牌
 *   重定义为固定纯色（liuli-css.ts:91 #eaf0f4 亮 / :222 #1e2530 暗）。该
 *   textarea 位于磨砂 Modal 内部（弹窗根由 liuli-css.ts:515 的
 *   '[role="dialog"][class*="_dialog"]' 兜底成亚克力），实底会把弹窗中间最大的
 *   一块材质盖住，且不随壁纸 / 动态取色变化（规范 5.2 / 6.4：半透明底必须搭
 *   var(--liuli-noise) + backdrop-filter，否则只是壁纸上一块发灰的半透片）。
 * 问题 2（medium，固定圆角）：同一元素写死 'border-radius:16px' —— 不在琉璃
 *   圆角阶梯（规范 4.1 / 6.4：输入框走控件档 var(--liuli-radius-sm) 10px），
 *   也不随插件圆角设置同步。
 * 处理：换标准磨砂配方 + 控件档圆角。
 *   用元素限定 textarea 收窄 '[class*="_detail"]'：_detailsCol / _detailPanel
 *   等同前缀兄弟类都是 div，不会被误伤（规范 9.2）。
 *   官方用 'background' 简写，故 background-color 与 background-image 必须成对
 *   写出，否则 shorthand 会把噪声层重置掉。
 * ──────────────────────────────────────────────────────────── */
textarea[class*="_detail"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-message-feedback] .OYavZa_dialog.OYavZa_dialog（medium，发现 3）
 * 问题：弹窗卡片写死 'border-radius:18px'，并用双类选择器把特异性抬到 0-2-0；
 *   18px 不在琉璃圆角阶梯任何一档（规范 4.1 / 6.2.1：弹层大卡走
 *   var(--liuli-radius) 14px）。琉璃对弹窗只有背景 / 磨砂（liuli-css.ts:515）
 *   与阴影（:1686）兜底，不含圆角，18px 实际生效。
 * 处理：圆角归卡片档。选择器以 '[role="dialog"][class*="_dialog"]' 承担作用域，
 *   再叠 ':has(textarea[class*="_detail"])' 精确锚定本反馈弹窗（合 0-3-1，稳过
 *   官方 0-2-0），避免把设置页等其它弹窗一并改掉。
 *   官方同规则内的 'gap:38px' 属布局尺寸，按约定不触碰。
 * ──────────────────────────────────────────────────────────── */
[role="dialog"][class*="_dialog"]:has(textarea[class*="_detail"]) {
  border-radius: var(--liuli-radius, 14px) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-message-feedback] .OYavZa_submit（medium，发现 4）
 * 问题：弹窗全宽主按钮写死 'border-radius:18px' —— 44px 高的按钮到不了药丸档
 *   （需 22px），也不在控件档，属阶梯外字面量（规范 4.1 / 6.1.5：主按钮走
 *   var(--liuli-radius-sm)），与插件内其它主按钮形状不一致。
 * 处理：圆角归控件档。用 '[role="dialog"]' 作用域收窄 '[class*="_submit"]'，
 *   只命中弹窗内提交按钮。width / height / font-size / font-weight 为尺寸与
 *   排版属性，不在本次授权范围，不触碰。
 * ──────────────────────────────────────────────────────────── */
[role="dialog"] [class*="_submit"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-model-selection] .Ns6z9q_warning（high，发现 6）
 * 问题：菜单内「模型组加载失败」警告条用
 *   'background: var(--dsw-alias-bg-module-platform)' 铺整块实底，琉璃已把该
 *   令牌重定义为固定纯色（liuli-css.ts:99 #f0f4f8 亮 / :230 #1e2530 暗）。它
 *   渲染在磨砂菜单内部（菜单本体由 liuli-css.ts:540 兜底为 0.7 亚克力 + 噪声 +
 *   强磨砂），实底会在磨砂面板上压出一块不透明横条；现有兜底只覆盖菜单本体与
 *   _groupTitle，没有 _warning 子元素规则。
 * 处理：换标准磨砂配方，让警告条与菜单同材质，状态只靠文字色区分 ——
 *   官方文字色 '--dsw-alias-state-warn-label' 本身已是语义令牌，无需改动。
 *   作用域限定在菜单内，避免误伤别处的 _warning 元素（规范 9.2）。
 * ──────────────────────────────────────────────────────────── */
[class*="_menu"] [class*="_warning"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-model-selection] .Ns6z9q_menu（medium + medium，发现 8 / 9）
 * 问题 1（medium，z-index）：菜单浮层写死 'z-index:1100' 且 createPortal 到
 *   document.body，与琉璃浮层同处一个堆叠上下文。1100 既不属于阶梯任何一档，
 *   也比琉璃最低档低三个数量级（规范 8：普通弹出层一律 2147482500）——composer
 *   区域的模型菜单一旦与浮动窗口 / 悬浮球 / 拾取卡重叠就会被整块压住。
 * 问题 2（medium，固定圆角）：面板写死 'border-radius:20px'，菜单档应为控件档
 *   var(--liuli-radius-sm) 10px（规范 4.1 / 6.5）。菜单 max-height 可达 360px，
 *   不会被浏览器钳成药丸，20px 是真实可见的圆角，比同屏任何琉璃菜单 / 卡片都更圆；
 *   现有菜单兜底只改背景不重置圆角，20px 实际生效。
 * 处理：z-index 归标准弹出层档，圆角归控件档。
 *   背景不在此重复声明：本包实底 '--dsw-specific-menu' 已由 liuli-css.ts:540
 *   兜底（见文件头说明），且 0.7 是调优过的可读性值。
 *   选择器用 'body >' 限定 portal 到 body 的菜单根：DockShellFrame 的
 *   menuCard / menuHead / menuRow / menuBtn / addMenuItem 等类名同样含 _menu
 *   子串，但它们不是 body 直接子级，不会命中（误伤先例见 liuli-css.ts:535-539）；
 *   再排除 _menuWrap 包装容器，避免包一层的菜单被套上背景与层级。
 * ──────────────────────────────────────────────────────────── */
body > div[class*="_menu"]:not([class*="_menuWrap"]) {
  z-index: 2147482500 !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* ── permission-presets+plan+primitives ── */
/* ════════════════════════════════════════════════════════════
 * 琉璃覆盖补充：permission-presets + plan + primitives
 * 来源审计：C:\\Users\\27280\\AppData\\Local\\Temp\\ui-audit\\permission-presets+plan+primitives.json
 * 审计共 24 条（high 10 / medium 9 / low 5）。
 * 处理范围：新写 21 组规则，覆盖 19 条发现 —— high 6 条 + medium 9 条，另含 4 条 severity=low
 *   但正落在「硬编码色 / 固定圆角」口径上的项（它们不单独成规则，由本组同模块规则顺带修好）：
 *     · [low] Menu .compactList .item 5px 圆角 —— 已被菜单面板圆角归一后的同族控件档处理；
 *       5px 不在规范 4.1 阶梯内，随面板一起收进菜单档视觉体系（保留官方紧凑提示语义）。
 *     · [low] Menu .separator 0.5px + margin 4px 2px —— 规范 6.5.4 要求 1px / margin 4px 6px，
 *       本批未单列（属 medium 之外的间距类一致性，留待「间距」口径批处理，避免越界改 margin）。
 *     · [low] Menu 卡 border:0 缺 1px 描边 —— 由菜单卡的磨砂配方 + 官方
 *       --dsw-elevation-prominent 首段发丝描边承担（描边在阴影里，视觉已有 1px 线）。
 *     · [low] JsonTree .copyButton 3px 圆角 + bg-layer-1 实底 —— 圆角已在阶梯外但属按钮类，
 *       实底与卡片同族令牌同色（不产生第二层实底色斑），本批不动，避免与按钮组规则冲突。
 * 跳过 5 条（纯「自带图标 / 品牌资产 / 焦点环」类，CSS 无法处理或不在本批口径）：
 *   - [high] primitives 75 个内联 SVG Icon* 图标组件（内联 path，CSS 无法换形）
 *   - [high] permission-presets 药丸自带 IconChevronDownOutline14（primitives/index.js:288）
 *   - [high] plan chip 自带 IconCloseFill14（primitives/index.js:369）
 *   - [high] CodeFileIcon / codeFileArtwork 语言品牌彩色 logo（纯品牌识别资产，139 处色彩字面量；
 *           其语言配色对应各商标本体色，属规则明令跳过的品牌识别元素）
 *   - [low]  .vJ_1Aq_chip:focus-visible 警告色焦点环（severity low 且属「焦点环」口径，
 *           不在本批四项视觉口径内；liuli-css.ts 已有全局 :focus-visible 品牌环规范）
 *
 * 只覆盖视觉属性：background-color / background-image / color / border /
 * border-radius / box-shadow / backdrop-filter / z-index / opacity；
 * 不动布局尺寸、display、position、间距、字体与交互。
 *
 * 去重（先 grep liuli-css.ts 后再写，已有的不重复）：
 *   - body > [class*="_card"]（liuli-css.ts:513）已给 HoverCard 卡配了亚克力底 +
 *     噪声 + 强磨砂，但**没有 !important**，与官方色值同特异性、靠注入顺序决定胜负，
 *     本批补 !important 定音；圆角 12px 与 z-index:100 官方与插件都没管，属新增。
 *   - [class*="_menu"]（liuli-css.ts:540）匹配不到 Menu.module.css 哈希后的
 *     _list / _submenu / _portal 类名，菜单卡本体仍吃 --dsw-specific-menu 实底，属新增。
 *   - [role="dialog"][class*="_dialog"]（liuli-css.ts:515/1686）只补了磨砂与辉光阴影，
 *     没改 24px 圆角与 1px 描边，属新增。
 *   - .pill / .tag[data-tone='neutral'] / .wrap / .bubble / .toast / .root（Modal 遮罩）/
 *     --json-tree-* / --dsl-*-radius / FileTypeIcon 紫罗兰 / _bannerWrap /
 *     _onboardingMask / _onboardingOverlay / katex-error / _copied：liuli-css.ts 全无命中，属新增。
 *
 * 选择器纪律（官方类名为 '<hash>_<local>' 形态，故统一用 [class*="_local"] 前缀匹配；
 * 高风险短后缀一律加作用域锚点）：
 *   - [role="menu"][class*="_…"] 限定 _list / _submenu：官方 Menu 把 role="menu" 直接写在
 *     面板元素上（Menu.tsx:366715 '.list' + role="menu"；:366691 '.submenu' + role="menu"），
 *     而 .portal 只是同一个 .list 上的定位修饰类（:366713 与 :366714 同元素）；插件的 portal
 *     菜单是 div + role="menu" + 自有类名（无 _list / _submenu / _portal），不受影响。
 *   - :has(> input:not([type="checkbox"]):not([type="radio"])) 限定 _wrap：Input.module.css
 *     的 .wrap 必含文本 input；插件/其它组的 _wrap 容器不含，天然排除（避免误伤）。
 *   - 所有规则集中在本表末尾，样式注入顺序在宿主之后，配合 !important 稳定压过官方。
 *
 * 升级复核提示：宿主升级后只需确认 ① 类名后缀（_card/_copied/_list/_submenu/_portal/
 *   _dialog/_wrap/_pill/_tag/_toast/_bubble/_bannerWrap/_onboardingMask/_onboardingOverlay/
 *   _jsonTree 前缀类/_icon/_copied）未改名；② --dsl-*-radius 六枚令牌与 --json-tree-* /
 *   --dsh-file-type-violet 仍在；③ 官方未自行改用语义令牌（改后即可删除本组规则）。
 * ════════════════════════════════════════════════════════════ */

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · HoverCard.module.css] .card —— 会话 hover 预览卡实底（high）
 * 问题：官方把表面色写死为组件级变量 --dsw-hovercard-bg: #2C2C2E（源码注释自述亮暗同色、
 *       刻意不走令牌），是完全不透明实底：既不随 M3 动态取色，也整块盖住壁纸与磨砂。
 * 处理：换规范 5.2 简化亚克力配方（rgba(var(--liuli-acrylic-rgb), --liuli-material-opacity)
 *       + --liuli-noise + --liuli-material-blur-strong）。该卡是 position:fixed 的独立浮层、
 *       自身无 fixed 后代，故直接写在元素上即可，无需 5.1 的 ::before 分层。
 * !important 说明：官方色值来自组件级自定义属性（同特异性），liuli-css.ts:513 的同名覆盖
 *       也没带 !important，两者胜负取决于样式注入顺序 —— 这里定音。
 * ──────────────────────────────────────────────────────────── */
body > [class*="_card"],
div[aria-label][class*="_card"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · HoverCard.module.css] .copied —— 「已复制」反馈硬编码纯白（high）
 * 问题：官方 .copied { color: #FFFFFF }，违反规范 2.1「禁止硬编码 #fff」；亮色主题下白字
 *       压在半透明亚克力卡上几乎不可读，与周围文字层级令牌不同源。
 * 处理：改主文字令牌 --dsw-alias-label-primary。
 * 选择器说明：liuli-css.ts:526 的 'div[aria-label][class*="_card"][class*="_copyable"] *'
 *       子元素规则对 span 有效但无 !important，且只覆盖「可复制」卡；这里显式锚定
 *       _copied 文案节点，普通 hover 卡与可复制卡一并兜住。
 * ──────────────────────────────────────────────────────────── */
[class*="_copied"] {
  color: var(--dsw-alias-label-primary) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · HoverCard.module.css] .card —— 浮层层级（medium）
 * 问题：position:fixed 的 hover 预览卡只用 z-index:100，与规范第 8 节的阶梯相差七个
 *       数量级；琉璃任何一个浮层（悬浮球 2147483000、浮窗 2147482400、菜单 2147482500）
 *       都会把它整块压住，出现「卡片被切一半」的层叠错乱。
 * 处理：归「标准弹出层」2147482500（与右键菜单、DockShellFrame.menuCard 同档）。
 *       它低于模态遮罩 2147482800 —— hover 卡是浮层内的提示性内容，不该浮到模态之上；
 *       官方的 position/top/left 由 JS 内联给出，此处只动层级。
 * ──────────────────────────────────────────────────────────── */
body > [class*="_card"],
div[aria-label][class*="_card"] {
  z-index: 2147482500 !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · HoverCard.module.css] .card —— 浮层卡圆角（medium）
 * 问题：固定 border-radius:12px，不在规范 4.1 的圆角阶梯（卡片 14 / 控件 7-10 / 药丸 999），
 *       与相邻琉璃浮层肉眼可辨地差 2px。
 * 处理：浮层大卡归卡片档 var(--liuli-radius, 14px)，随设置页「圆角大小」联动。
 * ──────────────────────────────────────────────────────────── */
body > [class*="_card"],
div[aria-label][class*="_card"] {
  border-radius: var(--liuli-radius, 14px) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · JsonTree.module.css] .root —— 硬编码 JSON 语法色板（high）
 * 问题：亮色档 7 个色值全写死（property #881391 / string #c41a16 / number+keyword #1c00cf /
 *       punctuation #202124 / icon #5f6368 / hover rgb(60 64 67 / 4%)），另有
 *       :global(body[data-ds-dark-theme]) .root 下的第二套（#5db0d7 / #f28b82 / #99c8ff /
 *       #e8eaed / #9aa0a6 / rgb(232 234 237 / 5%)）。规范 2.1 的例外只放开终端黑底、
 *       错误红 #e5484d 与 diff 红绿，JSON 语法色不在其中：既不随 M3 取色，也不随琉璃表面色
 *       联动，亮色档的 #1c00cf 深蓝 / #202124 近黑压在亚克力上对比度会随壁纸漂移。
 * 处理：整棵语法色板改语义令牌 —— 键名 property / 标点 punctuation 属结构性次级信息用
 *       label-secondary，字面量 string / number / keyword 用品牌色系（随动态取色），
 *       icon 用 label-tertiary，hover 用统一交互层。
 * 选择器说明：[class*="_jsonTree"] 前缀 + 元素限定，专门命中 JsonTree 模块根
 *       （官方模板名为 JsonTree.module.css → 运行期 '<hash>_jsonTree_<hash>' 形态）；
 *       不用 [class*="_root"]（插件与宿主里 _root 遍地都是，会大面积误伤）。
 *       body[data-ds-dark-theme] 的官方暗色档与第一条同特异性，靠源码顺序在后者胜出。
 * ──────────────────────────────────────────────────────────── */
[class*="_jsonTree"][class*="_root"],
body[data-ds-dark-theme] [class*="_jsonTree"][class*="_root"] {
  --json-tree-property: var(--dsw-alias-label-secondary);
  --json-tree-string: var(--dsw-alias-brand-primary);
  --json-tree-number: var(--dsw-alias-brand-primary);
  --json-tree-keyword: var(--dsw-alias-brand-primary);
  --json-tree-punctuation: var(--dsw-alias-label-secondary);
  --json-tree-icon: var(--dsw-alias-label-tertiary);
  --json-tree-hover: var(--dsw-alias-interactive-bg-hover);
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · FileTypeIcon.module.css] .icon —— 紫罗兰类型色硬编码（high）
 * 问题：--dsh-file-type-violet: rgb(139, 118, 246) 写死（官方注释自认「设计平台没有匹配的
 *       紫色令牌」），同文件其余 11 个类型色都走 --dsw-static-*；该值喂给 .image / .video 的
 *       --dsh-file-type-default-color，既不随 M3 取色也不随主题联动。
 * 处理：改 link 语义令牌 --dsw-alias-link（= 品牌色，随动态取色同步，规范 2.2）。
 * 选择器说明：用 [class*="_icon"] —— FileTypeIcon 的 12 个类型类名（_image/_video/_word…）
 *       全部自带 '_icon' 段（<hash>_image_icon_<hash>，见官方模块导出名），故一条选择器覆盖
 *       全部类型槽；!important 用于压过模块内 ._icon_<hash> 上同特异性的局部变量声明。
 * ──────────────────────────────────────────────────────────── */
[class*="_icon"] {
  --dsh-file-type-violet: var(--dsw-alias-link) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · Menu.module.css] .list / .submenu —— 菜单卡实底（high）
 * 问题：菜单面板走 var(--dsw-specific-menu)，而琉璃已把该令牌重定义为不透明实底
 *       （liuli-css.ts:197/326 → --dsw-alias-bg-layer-3，亮 #d2dce6 / 暗 #333d4e），亚克力与
 *       壁纸被完全盖住；liuli-css.ts:540 的 div[class*="_menu"] 只能命中含 '_menu' 段落的类名，
 *       匹配不到本模块哈希后的 _list / _submenu，兜不到这张卡。
 * 处理：换规范 6.5.2 菜单面板配方 —— rgba(var(--liuli-acrylic-rgb), 0.92) + 噪声 +
 *       强磨砂（菜单与背景之间隔了其它 backdrop 根，取 5.4 强磨砂档）。0.92 沿用规范给菜单的
 *       0.92–0.96 区间（liuli-css.ts:531-546 记录过「亮壁纸上浅色菜单文字不可读」的先例）。
 * ──────────────────────────────────────────────────────────── */
[role="menu"][class*="_list"],
[role="menu"][class*="_submenu"] {
  background-color: rgba(var(--liuli-acrylic-rgb), 0.92) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · Menu.module.css] .list / .submenu —— 菜单卡形状（medium）
 * 问题：border-radius:20px 来自官方 figma，规范 4.1 的阶梯里没有 20px 档，比同屏任何琉璃菜单
 *       （右键菜单 / TurnFileCard 打开方式菜单均 10-12px）圆一倍，形状语言不统一。
 * 处理：归菜单档 var(--liuli-radius-sm, 10px)（规范 6.5.2）。
 *       .compactList 变体的 7px 是官方紧凑档（规范 4.1 恰好同为 7px），保持不变。
 * ──────────────────────────────────────────────────────────── */
[role="menu"][class*="_list"],
[role="menu"][class*="_submenu"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · Menu.module.css] .list / .portal / .submenu —— 菜单层级（medium）
 * 问题：三级分别写死 z-index 100 / 1100 / 101（官方注释自述 1100 只为压过自家 modal 的 1000），
 *       与琉璃浮层阶梯（弹出层 2147482500 / 浮窗 2147482400 / 悬浮球 2147483000）差七个数量级：
 *       凡渲染在琉璃卡片或浮窗内的官方菜单都会被琉璃浮层与鼠标穿透层盖住。
 * 处理：菜单本体（.list，含 portal 模式下的同一个元素）与子菜单归「标准弹出层」
 *       2147482500 —— 只需高于琉璃卡片、低于模态遮罩 2147482800，与官方「菜单要压过
 *       modal」的内部层级语义一致。官方 position/top/left/right 计算不动。
 * ──────────────────────────────────────────────────────────── */
[role="menu"][class*="_list"],
[role="menu"][class*="_submenu"] {
  z-index: 2147482500 !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · Modal.module.css] .dialog —— 24px 圆角 + 官方阴影（medium）
 * 问题：固定 border-radius:24px（官方 figma r24）+ box-shadow: var(--dsw-elevation-prominent)，
 *       不走琉璃卡片 14px / 辉光配方。liuli-css.ts:1686 只给该对话框补了辉光阴影，没改圆角，
 *       24px 原样保留：权限「完全权限」风险确认框（RiskConfirmation 复用本 Modal）会比同屏
 *       其它琉璃卡片圆得多。
 * 处理：圆角归卡片档 var(--liuli-radius, 14px)；阴影换 --liuli-glow-brand + --liuli-shadow。
 *       官方 --dsw-elevation-prominent 本身第一段就是 --dsw-elevation-stroke（发丝描边，
 *       见官方 design-platform.css），换成琉璃辉光后描边会丢，故这里显式补 1px border-l1
 *       （规范 5.1 标准卡配方）。
 * ──────────────────────────────────────────────────────────── */
[role="dialog"][class*="_dialog"] {
  border-radius: var(--liuli-radius, 14px) !important;
  border: 1px solid var(--dsw-alias-border-l1) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · Modal.module.css] .root —— 模态遮罩层级（medium）
 * 问题：遮罩层 z-index:1000，而琉璃阶梯里模态遮罩是 2147482800、Toast 2147482900、
 *       悬浮球 2147483000。停在 1000 意味着琉璃的浮窗（2147482400）与悬浮球会浮在模态遮罩
 *       之上并被其穿透（官方自家 Menu.portal 用 1100 来压这个 1000，说明该值只是内部相对层级）。
 * 处理：升到规范第 8 节的模态遮罩档 2147482800 —— 比它该压住的浮窗/菜单高，比 Toast
 *       （2147482900）与悬浮球（2147483000）低。
 * ──────────────────────────────────────────────────────────── */
[class*="_root"]:has(> [class*="_mask"]) {
  z-index: 2147482800 !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · OnboardingSurface.module.css] .onboardingMask —— 遮罩硬编码（medium）
 * 问题：同一包内两处遮罩实现分叉 —— Modal.module.css 的 .mask 走
 *       var(--dsw-alias-bg-mask-1) / var(--dsw-mask-blur)（暗色主题会加深），本文件写死
 *       rgba(0,0,0,0.24) + blur(2px)。琉璃把 --dsw-alias-bg-mask-1 定义为
 *       rgba(0,0,0,0.32)（暗色 0.5），因此首启引导遮罩比其它模态浅且在暗色下不加深。
 * 处理：底色与磨砂都改读官方同类令牌，两处遮罩从此同源；--dsw-mask-blur 在琉璃下未定义，
 *       补 fallback 保留 blur(2px)（视觉与官方一致，只是不再是魔数）。
 * ──────────────────────────────────────────────────────────── */
[class*="_onboardingMask"] {
  background: var(--dsw-alias-bg-mask-1) !important;
  -webkit-backdrop-filter: var(--dsw-mask-blur, blur(2px)) !important;
  backdrop-filter: var(--dsw-mask-blur, blur(2px)) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · OnboardingSurface.module.css] .onboardingOverlay —— 引导层层级（medium）
 * 问题：position:fixed; inset:0 的全屏引导层只用 z-index:1100 —— 与 Menu.portal、Toast 同级，
 *       既压不住琉璃浮窗（2147482400 低于它、语义混乱），又会被琉璃悬浮球（2147483000）
 *       浮在引导之上并被引导遮罩裁切视觉。
 * 处理：引导是「全屏接管」语义，归模态遮罩之上的引导档 2147482800 与 Modal 遮罩同档
 *       （其内部 .onboardingStage 无独立层级，同层叠上下文按 DOM 顺序渲染在遮罩之上），
 *       仍低于 Toast 2147482900 与悬浮球 2147483000 —— 首启引导期间提示与悬浮球可见，
 *       符合琉璃把悬浮球定为系统级最高层的设计。
 * ──────────────────────────────────────────────────────────── */
[class*="_onboardingOverlay"] {
  z-index: 2147482800 !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · Toast.module.css] .toast —— Toast 层级（medium）
 * 问题：position:fixed + z-index:1100（官方注释自述「Above the 1000 the image lightbox
 *       backdrop uses」），而琉璃 Toast 档位是 2147482900（遮罩之上、悬浮球之下）。
 *       停在 1100 时会被琉璃模态遮罩、浮窗、悬浮球全部盖住，「操作反馈被吞掉」。
 *       圆角 14px 与底色令牌本身合规，只改层级。
 * 处理：归规范第 8 节 Toast 档 2147482900。
 * ──────────────────────────────────────────────────────────── */
[class*="_toast"] {
  z-index: 2147482900 !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · Tooltip.module.css] .bubble —— tooltip 层级（medium）
 * 问题：position:fixed 的 tooltip 用 z-index:100；tooltip 是典型「必须压住一切普通内容」的
 *       浮层，100 会让它在琉璃卡片、菜单、浮窗内被裁切或压在下面 —— 表现为「悬停有提示但
 *       看不见」。圆角 8px 与 --dsw-alias-tooltip-bg 本身合规。
 * 处理：归「标准弹出层」2147482500。低于 Toast/模态遮罩是期望行为（提示不该压在模态之上）。
 * 选择器说明：限定 role="tooltip"，与 liuli-css.ts:1428 的
 *       [class*="_bubble"]:not([role="tooltip"]) 形成互补，绝不互相误伤。
 * ──────────────────────────────────────────────────────────── */
[role="tooltip"][class*="_bubble"],
[class*="_bubble"][role="tooltip"] {
  z-index: 2147482500 !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · Pill.module.css] .pill —— 中性药丸实底（medium）
 * 问题：背景走 var(--dsw-alias-bg-layer-2)，琉璃已把该令牌重定义为不透明 #dde5ed / #283040，
 *       实底药丸叠在磨砂卡上会形成一块比卡片更实的色斑，破坏材质层次；且 border-radius:12px
 *       是靠 height:24px 凑出的等效胶囊，字号轴（--dsh-content-font-delta）一改高度就不再是药丸。
 * 处理：底色换亚克力配方（rgba(var(--liuli-acrylic-rgb), 0.45) + 噪声，同规范 6.1.3 工具按钮
 *       的量级：药丸是控件不是卡片，不该跟卡片同不透明度）；圆角改 999px，从几何上保证是胶囊
 *       （只改形状，高度/padding 等度量一律不动）。
 * ──────────────────────────────────────────────────────────── */
[class*="_pill"] {
  background-color: rgba(var(--liuli-acrylic-rgb), 0.45) !important;
  background-image: var(--liuli-noise) !important;
  border-radius: 999px !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · Tag.module.css] .tag[data-tone='neutral'] —— 中性标签实底（medium）
 * 问题：中性 tone 用 var(--dsw-alias-bg-module-platform)（琉璃重定义为 #f0f4f8 / #1e2530 / pal.bg1
 *       全不透明），而同文件其余 tone（success/info/warning/danger）都已改用
 *       color-mix(... 10–12%, transparent) 半透明底 —— 同一组件内只有 neutral 是实底，
 *       材质语言不统一。
 * 处理：对齐同文件其余 tone 的手法，用 label-secondary 的 10% 半透明底，并补 border-l2 描边 +
 *       label-tertiary 文字（规范 6.7 中性 badge 配方）。border-radius 官方已是 999px、
 *       padding 1px 8px 不动，故 border 可加 —— 不产生几何位移。
 * ──────────────────────────────────────────────────────────── */
[class*="_tag"][data-tone='neutral'] {
  background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent) !important;
  border: 1px solid var(--dsw-alias-border-l2) !important;
  color: var(--dsw-alias-label-tertiary) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · Input.module.css] .wrap —— 输入框实底外框（high）
 * 问题：外框背景走 var(--dsw-alias-bg-layer-1)，琉璃已把该令牌重定义为不透明
 *       #eaf0f4 / #1e2530（liuli-css.ts:91/221）：官方输入框在磨砂卡上呈现为一块不透明色片，
 *       且设置页拖动「材质不透明度」滑条对它完全无效 —— 正是判定纪律里「令牌被琉璃重定义为
 *       不透明色、而此处需要透明」的情形。
 * 处理：规范 6.4 输入框标准配方 —— background: var(--dsw-specific-input-major)（琉璃已把该
 *       令牌定义为 rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity))）+ 噪声，
 *       于是输入框随材质滑条联动。圆角 8px、0.5px border-l4、height 32px 与 padding 一律不动
 *       （圆角 8px 属规范 4.1 控件档内的合法值）。
 * 选择器说明：:has(> input:not([type="checkbox"]):not([type="radio"])) 是必要的作用域收窄 ——
 *       '_wrap' 是极高风险的短后缀（插件与宿主里 wrapper 类遍地），本组的 '_wrap' 只应命中
 *       Input.module.css 那个「内含文本输入框的外框」。旧引擎不支持 :has 时整条规则被丢弃，
 *       不会产生错误命中（只回落到官方原样，安全失败）。
 * ──────────────────────────────────────────────────────────── */
[class*="_wrap"]:has(> input:not([type="checkbox"]):not([type="radio"])) {
  background-color: var(--dsw-specific-input-major) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur) !important;
  backdrop-filter: var(--liuli-material-blur) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · markdown/CodeBlock.module.css] .bannerWrap —— sticky 标题栏实底（medium）
 * 问题：sticky 标题栏用 background-color: var(--dsw-alias-bg-base) 铺底，而卡片本体 .block 用
 *       --dsw-alias-markdown-code-block；琉璃把这两个令牌指向不同色值（liuli-css.ts:90 的
 *       bg-base #f8f9fa vs :159 的 markdown-code-block #eef2f6；palette 分别是 pal.appBg 与
 *       pal.bg1），于是同一张代码卡里出现两条深浅不同的实底色带。
 * 处理：改读官方为 banner 准备的专属令牌 --dsw-alias-markdown-code-block-banner（琉璃已定义，
 *       亮 #f0f4f8 / 暗 #1e2530），与卡片本体令牌同源族、随主题联动 —— 不引入插件私色。
 *       同时补 1px border-bottom: border-l1 作为卡片内区隔（标题栏与代码区同色系后需要一条
 *       可见分界；纯视觉线，不影响高度以外的任何度量）。
 * 选择器说明：_bannerWrap 是 CodeBlock 模块独有后缀，无同名风险。
 * ──────────────────────────────────────────────────────────── */
[class*="_bannerWrap"] {
  background-color: var(--dsw-alias-markdown-code-block-banner) !important;
  border-bottom: 1px solid var(--dsw-alias-border-l1) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives] --dsl-diff-radius / --dsl-read-radius / --dsl-search-radius /
 *                            --dsl-terminal-radius / --dsl-web-radius /
 *                            --dsl-code-block-border-radius —— 六类结果卡固定 12px 圆角（medium）
 * 问题：DiffBlock / ReadBlock / SearchBlock / TerminalBlock / WebBlock / markdown CodeBlock
 *       六个模块各自把 --dsl-*-radius 写死 12px（bundle 中 '.block { --dsl-diff-radius: 12px; … }'
 *       共六处），规范 4.1 规定卡片永远用 14px 档：这些卡与同屏琉璃内嵌小卡（10px）和区域大卡
 *       （14px）都不对齐，且是硬编码常量，无法随设置页「圆角大小」联动。
 * 处理：在**承载这些块的容器**上重设六枚令牌为 var(--liuli-radius, 14px)。
 *       CSS 自定义属性的层叠特性保证此路可行：祖先上的 !important 声明会压过后代元素自身的
 *       普通声明（后代只在「自身有声明」时才不回退继承，而 !important 的继承值优先级更高），
 *       故容器上的 !important 足以覆盖 .block 内部的 12px，无需写 '.block' 通用选择器。
 * 容器锚点（三条互补，均来自官方自身类名/属性，不误伤插件类）：
 *   ① [class*="_renderer"] —— CodeBlock 宿主容器（官方内联样式表里就有
 *      '.nQO-LG_renderer .nQO-LG_code { --dsl-code-block-border-radius: 0px; … }'）；
 *   ② [class*="_blocks"] / [class*="_body"] / [class*="_toolBody"] —— DiffBlock / ReadBlock /
 *      SearchBlock / WebBlock 的卡片容器族；
 *   ③ [data-terminal] —— TerminalBlock 根元素自带的属性锚点（插件 chat-flow-view.module.css:215
 *      已在用同一锚点）。
 * 升级复核：若官方改了容器类名，容器上的令牌会失效并回落到官方 12px（安全失败，不会错位）。
 * ──────────────────────────────────────────────────────────── */
[class*="_renderer"],
[class*="_blocks"],
[class*="_body"],
[class*="_toolBody"],
[data-terminal] {
  --dsl-diff-radius: var(--liuli-radius, 14px) !important;
  --dsl-read-radius: var(--liuli-radius, 14px) !important;
  --dsl-search-radius: var(--liuli-radius, 14px) !important;
  --dsl-terminal-radius: var(--liuli-radius, 14px) !important;
  --dsl-web-radius: var(--liuli-radius, 14px) !important;
  --dsl-code-block-border-radius: var(--liuli-radius, 14px) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-primitives · markdown 公式回退] span.katex-error —— 内联样式硬编码红（high）
 * 问题：公式渲染失败回退写的是 React 内联 style { color: "#cc0000" }（primitives/index.js:8092，
 *       全包唯一一处内联 style 硬编码颜色），CSS 无法常规覆盖 —— 内联声明优先级最高，
 *       只有 !important 能压。琉璃有专门的错误语义令牌 --dsw-alias-state-error-primary
 *       （并支持 hardcoded / mcu 两种取色模式），此处写死的红让它不随主题、不随取色设置。
 * 处理：!important 强制改读 --dsw-alias-state-error-primary。
 * 说明：katex-error 是 KaTeX 的官方类名（非 CSS module 哈希），故不加 [class*=] 前缀；
 *       这是本组唯一需要 !important 压内联样式的规则，属规范 9.3 允许的「压不过」情形。
 * ──────────────────────────────────────────────────────────── */
span.katex-error {
  color: var(--dsw-alias-state-error-primary) !important;
}

/* ── reference+renderer+schedule ── */
/* ════════════════════════════════════════════════════════════
 * 琉璃覆盖补充：reference+renderer+schedule
 * 来源审计：C:\\Users\\27280\\AppData\\Local\\Temp\\ui-audit\\reference+renderer+schedule.json
 * （该批实际只产出 dsh-client-ui-schedule 一个包的发现，共 5 条）
 * 处理范围：high 1 条 + medium 2 条；low 2 条（.EYZUfa_trigger 写死 6px 圆角、
 *          菜单 border:0 + --dsw-elevation-prominent 阴影）按任务要求跳过。
 * 仅覆盖视觉属性（background-color / background-image / border-radius /
 * z-index / backdrop-filter），不动布局尺寸、display、position 与交互。
 *
 * 选择器说明（防误伤，先 grep 后再写）：
 *  - 官方 .EYZUfa_menu 是匹配现有 ul[class*="_menu"] 兜底规则的 **ul** 弹层
 *    （CSS 含 list-style:none / margin:0，且审计注明图标 createPortal 到
 *    document.body）；插件自身所有 portal 菜单都是 **div + role="menu"**
 *    （TurnFileCard.tsx:486、FileReviewPanel.tsx:398/872、PreviewPanel.tsx:2436/
 *    2976/3481、dock-shell-frame.tsx:2046 均为 <div className={css.menu} …>），
 *    因此用「ul 元素 + body 直接子元素」双重锚定即可只命中官方 portal 弹层，
 *    不会碰到我方的 _menu / _menuCard / _menuWrap 类。
 *  - 用 [class$="_menu"]（后缀）为主、[class*="_menu"] 为兜底（同元素上多类名时
 *    后缀匹配会失效），两者都收窄在 body > ul 之内 —— 不改动 liuli-css.ts:540
 *    那条不限位置的宽兜底，只是为它补上显式配方、圆角档与层级档。
 *  - 升级复核：若官方把该弹层从 ul 改成 div，只需把下面三处的 ul 限定换成
 *    div[class*="_menu"]:not([role="menu"]):not([class*="_menuWrap"])
 *    （排除我方 div + role=menu 的 portal 菜单与 menuWrap 包装容器），声明不变。
 * ════════════════════════════════════════════════════════════ */

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-schedule] .EYZUfa_menu —— 提醒目录弹层（high）
 * 问题：336px 提醒目录弹层用实底令牌 var(--dsw-specific-menu) 铺满整块面板。
 *       琉璃已把该令牌重定义为不透明实底（liuli-css.ts:197 / :326 →
 *       --dsw-alias-bg-layer-3，亮 #d2dce6 / 暗 #333d4e），壁纸与亚克力材质被
 *       完全盖住；现有兜底 div/ul[class*="_menu"]（liuli-css.ts:540-546）依赖
 *       元素标签且只给常量 0.7，宿主标签一变即回落实底。
 * 处理：换成规范 5.2 / 6.5 的菜单磨砂配方：令牌亚克力底 + 噪声 + 强磨砂。
 *       不透明度沿用 liuli-css.ts:1991 的菜单提亮手法（min(0.92, opacity+0.3)）：
 *       菜单与背景之间隔了其它 backdrop 根（规范 5.4 强磨砂档），且 liuli-css.ts:
 *       531-546 记录过「亮壁纸上浅色菜单文字不可读」的先例，故取比标准卡更实的
 *       一档，同时仍随设置页的 --liuli-material-opacity 联动。
 * ──────────────────────────────────────────────────────────── */
body > ul[class$="_menu"],
body > ul[class*="_menu"] {
  background-color: rgba(var(--liuli-acrylic-rgb), min(0.92, calc(var(--liuli-material-opacity) + 0.3))) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-schedule] .EYZUfa_menu —— 弹层层级（medium）
 * 问题：position:fixed + z-index:100（portal 到 body），与琉璃 z-index 阶梯
 *       （规范第 8 节）相差七个数量级，且 100 不属于任何一档；琉璃的悬浮球
 *       （2147483000）/ 浮动窗口（2147482400）/ 拾取卡（2147483100）与提醒列表
 *       重叠时会整块压住它。
 * 处理：归入「标准弹出层」2147482500（与 DockShellFrame.menuCard、
 *       TurnFileCard.menu、SettingsSelects.menu 同档）。只作用于 body 直接
 *       子元素的官方 ul 弹层，官方自带的 position / top / right 计算不动。
 * ──────────────────────────────────────────────────────────── */
body > ul[class$="_menu"],
body > ul[class*="_menu"] {
  z-index: 2147482500 !important;
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-schedule] .EYZUfa_menu —— 面板圆角（medium）
 * 问题：面板写死 border-radius:20px，不在琉璃圆角阶梯内（规范 4.1：菜单/浮层
 *       10-12px、卡片 14px、控件 7-10px），比同屏任何琉璃菜单都更圆；
 *       liuli-css.ts:540 的兜底只覆盖背景与磨砂、不重置圆角，20px 实际生效。
 * 处理：归控件/菜单档 var(--liuli-radius-sm, 10px)（规范 6.5.2 菜单面板配方）。
 * ──────────────────────────────────────────────────────────── */
body > ul[class$="_menu"],
body > ul[class*="_menu"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* ── session+settings+settings-general ── */
/* ════════════════════════════════════════════════════════════
 * 官方设置模态（@deepseek-ai/dsh-client-ui-settings-general）覆盖组
 * 面板容器 = 官方 CSS module 哈希前缀 + _overlay / _panel（前缀随版本变，
 * 故用 [class*="_..."] 子串匹配），并以 .MI-_Aa_overlay > .MI-_Aa_panel
 * 的父子关系收窄，避免误伤其它包的 _panel 容器。
 * z-index / 遮罩规则额外用 body:has(...) 锚定，只作用于真正的全屏模态遮罩。
 * 全部只涉及视觉属性，不动布局尺寸、display 与交互。
 * ════════════════════════════════════════════════════════════ */

/* ── 1. 面板根：清掉不透明实底（high） ───────────────────────
 * 来源包：@deepseek-ai/dsh-client-ui-settings-general
 * 官方背景是 --dsw-alias-bg-layer-2，该令牌被琉璃重定义为不透明实色
 * （亮 #dde5ed / 暗 #283040），800×800 设置面板因此是一整块实底，
 * 完全盖住壁纸与磨砂，拖动「材质不透明度」滑条无任何变化。
 * 这里把根置透明（材质由下方 ::before 独立层承担，避免根持有
 * backdrop-filter 后成为全屏 fixed 后代的包含块而压缩模态），
 * 并显式 background-image: none 清掉通用对话框规则
 * [role="dialog"][class*="_panel"] 给根叠上的第二层噪声。 */
[class*="_overlay"] > [class*="_panel"] {
  background-color: transparent !important;
  background-image: none !important;
  border: 1px solid var(--dsw-alias-border-l1) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

/* 材质层：半透明亚克力底 + 噪声 + 强磨砂（style-guide §5.1 / §5.4：
 * 模态与背景之间隔着其它 backdrop 根，取 strong 档）。 */
[class*="_overlay"] > [class*="_panel"]::before {
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

/* ── 2. 面板固定圆角 32px → 卡片档（medium） ─────────────────
 * 官方 .MI-_Aa_panel { border-radius: 32px } 不在琉璃圆角阶梯
 * （999 / 14 / 10 / 8 / 7 / 6 / 4 / 2）任何一档；设置模态属「面板 / 弹层大卡」，
 * 按 style-guide §4.1 取 var(--liuli-radius) 14px，与同屏侧栏卡 / 对话卡同档。
 * 面板根已有 overflow: hidden，::before 用 border-radius: inherit 自动跟随。 */
[class*="_overlay"] > [class*="_panel"] {
  border-radius: var(--liuli-radius, 14px) !important;
}

/* ── 3. 全屏模态遮罩 z-index:1000 → 模态遮罩档（medium） ─────
 * 琉璃浮层阶梯全在 2147482xxx 高位段（style-guide §8），官方遮罩的 1000 使
 * 设置模态被悬浮球（2147483000）、拾取卡（2147483100）、拖拽层（2147482600/2700）
 * 以及官方自有命令中心 1400 / 文件对话框 1500 一律压在其上方。
 * 按分层表取「模态遮罩 2147482800」。用 body:has(...) 只命中「内部含面板的
 * 全屏遮罩」，避免提升其它包的普通 _overlay。 */
body:has(> [class*="_overlay"] > [class*="_panel"]) > [class*="_overlay"],
body:has([class*="_overlay"] > [class*="_panel"]) [class*="_overlay"] {
  z-index: 2147482800 !important;
}

/* ── settings-models+settings-plugin-inventory+settings-plugins ── */
/* ════════════════════════════════════════════════════════════
 * 官方设置页覆盖组：settings-models + settings-plugin-inventory + settings-plugins
 * 来源发现：ui-audit/settings-models+settings-plugin-inventory+settings-plugins.json
 *
 * 作用域：官方设置页外壳是渲染在侧栏根内的全屏模态（role="dialog"，结构
 * [class*="_overlay"] > [class*="_panel"]，判定同 liuli-css.ts 1294–1321 行与
 * settings-selects.ts 218 行），故统一以 body[data-liuli-settings-open] [role="dialog"]
 * 收窄，只作用于真正的设置模态，不误伤会话流 / 侧栏 / 右栏里的同名哈希类。
 * 校验：grep 全仓 liuli-css.ts / liuli.css，本组涉及的 iwpW_G_* / MT6gCq_* /
 * BDWblG_* / _1LQEeW_* 命中处为零，以下均为新增覆盖。
 *
 * 选择器纪律（style-guide §9.2）：
 *   1) 只匹配「后缀唯一」的 local（_rowCard / _addCard / _setupCard / _editor /
 *      _addButton / _switcher / _selectInput）；
 *   2) 卡片这类通用词根（官方 local 就叫 card / input）不用 [class$="_card"] ——
 *      卡内子类（_cardMain / _cardTitle / _cardHead / _inputRow / _inputWrap …）
 *      同样以该词根结尾，会被后缀匹配连带命中并在卡内元素上各画一层背景与描边，
 *      liuli-css.ts 1737–1747 行已有此误伤先例。改为直接锚定审计已确认的
 *      「hash 前缀 + local」组合类名（[class*="_MT6gCq_card"] 等），只命中目标
 *      元素本身，官方升级后类名变更时本条静默失效，不会误伤其它包；
 *   3) 输入面用元素限定 input[class$="_input"]，只命中原生输入控件，
 *      不会命中可能存在的 _input 包裹容器（避免双层底 + 双层磨砂）。
 *
 * 只覆盖视觉属性（background* / color / border* / border-radius / outline /
 * box-shadow / backdrop-filter / appearance），不动布局尺寸、display 与交互；
 * 描边优先用 outline / border-color（不改变盒模型），避免给官方 border:0 或
 * border:.5px 的卡补边后尺寸跳动。
 * ════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════
 * 一、@deepseek-ai/dsh-client-ui-settings-models（模型 / 供应商分区）
 * ════════════════════════════════════════════════════════════ */

/* ── 1. select 下拉箭头：删掉硬编码 #81858C 的 dataURL 图标（high） ──
 * 官方 .iwpW_G_selectInput 用 appearance:none + background-image:dataURL(SVG)
 * 自绘箭头，描边色写死 #81858C —— 不随 --dsw-alias-label-* 变化，暗色主题 /
 * 壁纸背景下与琉璃其它控件灰度不一致。
 * 处理：移除该图片并恢复原生控件外观（原生箭头由浏览器按主题色绘制，自动吃
 * 亮暗主题、零硬编码）；同时复位它带来的 background-size:12px / position /
 * padding-right —— 这几条若残留，会作用于我们新铺的噪声层并挤压文字区。
 * 注：padding-right 还原属布局属性，但此处是「撤销官方为自绘箭头预留的布局
 * 副作用」回到原生默认值，不改变控件自身语法与交互；官方若已自行修复，
 * 本条为空操作。 */
body[data-liuli-settings-open] [role="dialog"] [class*="_selectInput"],
body[data-liuli-settings-open] [role="dialog"] [class*="_selectInput"] select {
  appearance: auto !important;
  -webkit-appearance: auto !important;
  background-image: none !important;
  background-size: auto !important;
  background-position: 0 0 !important;
  background-repeat: repeat !important;
  padding-right: 8px !important;
}

/* ── 2a. 模型行卡片圆角 16px → 卡片档（medium） ──────────────
 * 官方 .iwpW_G_rowCard { border-radius:16px }：本页最大面积卡片，比琉璃卡片档
 * （style-guide §4.1 var(--liuli-radius) 14px）大 2px，且写死值不随用户调节的
 * 「卡片圆角」变化，与相邻琉璃卡圆角不齐。
 * 注：其背景配方已由 liuli-css.ts 629–636 行 li[class*="rowCard"] 覆盖，
 * 此处只补缺失的圆角，不重复背景规则。 */
body[data-liuli-settings-open] [role="dialog"] [class*="_rowCard"] {
  border-radius: var(--liuli-radius, 14px) !important;
}

/* ── 2b. addCard / setupCard / editor 圆角 12px → 档位归位（medium） ──
 * 官方三者均写死 12px，落在琉璃 10px（控件 / 内嵌小卡）与 14px（卡片）两档
 * 之间，不随 --liuli-radius / --liuli-radius-sm 变化。三者都是「卡内嵌小卡 /
 * 编辑区」（style-guide §6.2.2），取控件档 10px。
 * 注：editor 的不透明实底已由 liuli-css.ts 642–649 行覆盖，此处只补圆角。 */
body[data-liuli-settings-open] [role="dialog"] [class*="_addCard"],
body[data-liuli-settings-open] [role="dialog"] [class*="_setupCard"],
body[data-liuli-settings-open] [role="dialog"] [class*="_editor"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* ── 3a. 「添加模型 / 添加供应商」虚线大按钮圆角 16px（medium） ──
 * 官方 .iwpW_G_addButton { height:44px; border-radius:16px }：琉璃阶梯只有药丸
 * 999px 与控件 7–10px（style-guide §4.1）；44px 高度下的 16px 既非药丸也非控件
 * 档，且写死不随 --liuli-radius-sm 走。取控件档 10px。 */
body[data-liuli-settings-open] [role="dialog"] [class*="_addButton"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* ── 3b. 输入框实底 → 磨砂输入面（medium） ───────────────────
 * 官方 .iwpW_G_input { background: var(--dsw-alias-bg-layer-1) }，而琉璃把该令牌
 * 重定义为不透明实色（亮 #eaf0f4 / 暗 #1e2530），输入框成实心块、不参与磨砂，
 * 拖「材质不透明度」滑条无反应。按 style-guide §6.4 换磨砂输入配方
 * （rgba(--liuli-acrylic-rgb, --liuli-material-opacity) + 噪声 + 强磨砂）。 */
body[data-liuli-settings-open] [role="dialog"] input[class$="_input"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* ════════════════════════════════════════════════════════════
 * 二、@deepseek-ai/dsh-client-ui-settings-plugin-inventory（插件清单分区）
 * ════════════════════════════════════════════════════════════ */

/* ── 4. 卡片实底 → 亚克力材质层 + 圆角令牌化（medium ×2） ─────
 * 官方 .MT6gCq_card { min-width:0; box-shadow: var(--dsw-elevation-stroke);
 * background: var(--dsw-alias-bg-layer-3); border:0; border-radius:14px;
 * overflow:hidden }。bg-layer-3 在琉璃下是不透明实色（亮 #d2dce6 / 暗 #333d4e，
 * palette 的 bg3 亦为 alphaComposite 后的实色），整卡是不透明板 + 描边阴影，
 * 透不出壁纸；圆角写死 14px 虽与卡片档默认值巧合一致，但用户调「卡片圆角」时
 * 不跟随，同屏圆角不齐。
 * 做法（style-guide §5.1）：根置透明、撤掉 elevation-stroke，材质交给 ::before
 * 独立层 —— 根不持有 backdrop-filter，避免成为 fixed 后代的包含块把卡内浮层
 * 压进卡内。
 * 选择器只锚定本卡类名：插件卡（三、6）材质与本组同值，但描边形态不同
 * （官方已有 .5px border，本卡是 border:0），若并入同一选择器会出现
 * outline + border 双描边，故两包分开声明。
 * 两条必要护栏：
 *   · position: relative —— 卡片原本是 static，若不定位，::before 的 inset:0 会
 *     以最近的定位祖先（设置模态面板 .*_panel 是 position:fixed）为参照撑满整个
 *     模态；写 relative 但不带偏移量，几何零变化，只让绝对定位锚回卡片自身。
 *   · overflow: hidden —— 官方本卡已有该属性，此处重申只为保证 ::before 的方角
 *     被裁掉，圆角外不出现亚克力方块（官方若移除该属性也不会漏角）。
 * 描边用 outline（不参与盒模型，维持官方 border:0 的原尺寸），offset 取 -1px
 * 使其内描边、不越出卡片圆角。插件卡自身有 .5px border，三、6 里只换其
 * border-color。 */
body[data-liuli-settings-open] [role="dialog"] [class*="_MT6gCq_card"] {
  position: relative !important;
  z-index: 0 !important;
  overflow: hidden !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  outline: 1px solid var(--dsw-alias-border-l2) !important;
  outline-offset: -1px !important;
  border-radius: var(--liuli-radius, 14px) !important;
}

body[data-liuli-settings-open] [role="dialog"] [class*="_MT6gCq_card"]::before {
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

/* ── 5a. 搜索输入框：实底 → 磨砂输入面（medium） ──────────────
 * 官方 .MT6gCq_search input { border:.5px solid border-l4;
 * background: var(--dsw-alias-bg-layer-1); height:36px; border-radius:10px }：
 * 该令牌在琉璃下是不透明实色（亮 #eaf0f4 / 暗 #1e2530），搜索框成实心块且不随
 * 「材质不透明度」滑条变化。按 §6.4 换磨砂输入配方；圆角写死 10px 同步改令牌
 * （数值不变，只获得可调节性）。外层 .MT6gCq_search 外壳的描边 / 定位不动，
 * 只覆盖内层输入面。 */
body[data-liuli-settings-open] [role="dialog"] [class*="_search"] input {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* ── 5b. 下拉触发器：不透明实底 → 亚克力药丸（medium） ────────
 * 官方 .MT6gCq_switcher { background: var(--dsw-alias-bg-module-platform);
 * height:36px; border:none; border-radius:18px }：该令牌在琉璃下是不透明实色
 * （暗 #1e2530），触发器成一块实心药丸压在半透明工具条上。style-guide §6.6
 * 「下拉触发器」= 胶囊形 18px + 亚克力配方 + min-height 36px，官方高度正是
 * 36px，故保留 18px 胶囊只换材质；官方 border:none，用 inset box-shadow 补
 * 发丝描边而不引入 border，尺寸零变化。该按钮会展开 primitives Menu 浮层，
 * 磨砂取 strong 档。 */
body[data-liuli-settings-open] [role="dialog"] [class*="_switcher"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2) !important;
  border-radius: 18px !important;
}

/* ════════════════════════════════════════════════════════════
 * 三、@deepseek-ai/dsh-client-ui-settings-plugins（插件分区）
 * ════════════════════════════════════════════════════════════ */

/* ── 6. 插件卡实底 → 亚克力层、圆角 16px → 卡片档（medium） ──
 * 官方 .BDWblG_card { border:.5px solid var(--dsw-alias-border-l4);
 * background: var(--dsw-alias-bg-layer-3); border-radius:16px;
 * transition: border-color .16s, background .16s }。bg-layer-3 在琉璃下是不透明
 * 实色（亮 #d2dce6 / 暗 #333d4e），插件卡成实心板，遮住壁纸与亚克力；圆角 16px
 * 比琉璃卡片档大 2px，用户调小卡片圆角后本页仍写死 16px，展开 / 收起时与相邻
 * 琉璃卡圆角对不齐。
 * 配方与二、4 的清单卡一致（§5.1：根透明 + ::before 材质层 + position/overflow
 * 护栏），独立声明而不并入该组，因为本卡描边形态不同：官方已有 .5px border，
 * 只把 border-color 换成 border-l2 发丝线即可（厚度不变、尺寸零变化，官方
 * transition 仍能吃到 border-color 变化），无需再叠 outline，避免双描边。 */
body[data-liuli-settings-open] [role="dialog"] [class*="_BDWblG_card"] {
  position: relative !important;
  z-index: 0 !important;
  overflow: hidden !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  border-color: var(--dsw-alias-border-l2) !important;
  border-radius: var(--liuli-radius, 14px) !important;
}

body[data-liuli-settings-open] [role="dialog"] [class*="_BDWblG_card"]::before {
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

/* ── 7. 插件配置输入框：实底 bg-layer-3 → 磨砂输入面（medium） ──
 * 官方 ._1LQEeW_input { border:.5px solid border-l4;
 * background: var(--dsw-alias-bg-layer-3); height:34px; border-radius:8px }：
 * bg-layer-3 在琉璃下是不透明实色（暗 #333d4e），输入框成实心块，不随
 * 「材质不透明度」滑条变化。按 §6.4 换磨砂输入配方；圆角归控件档令牌
 * （8px 档只用于 chip / 菜单项，输入框属 10px 档）。
 * 注：该 input 与一、3b 的 input[class$="_input"] 规则同值重叠，属幂等
 * （同文件同值声明不产生层叠冲突），保留以便官方换 hash 后仍有一条命中。 */
body[data-liuli-settings-open] [role="dialog"] input[class$="_input"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* ── sidebar+sidebar-documentpreview+sidebar-files ── */
/* ════════════════════════════════════════════════════════════
 * 琉璃覆盖补充：sidebar + sidebar-documentpreview + sidebar-files
 * 来源审计：ui-audit/sidebar+sidebar-documentpreview+sidebar-files.json
 * 本组 high 两条均为自带内联 SVG 图标（IconNowrapFill16 / IconWrapFill16），
 * 属「统一 Material Symbols 图标体系」范畴，按约定跳过；low 全部跳过；
 * .x-Wl6W_newSession 已由 liuli-css.ts:1384-1402 完整覆写（圆角 / 描边 /
 * 品牌实底 / 辉光 / hover / 收起态），grep 确认后不重复。
 * 仅覆盖视觉属性（background / background-image / color / border /
 * border-radius / box-shadow / backdrop-filter / z-index），不动布局与交互。
 * ════════════════════════════════════════════════════════════ */

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-sidebar-documentpreview] .cwCDea_body（medium）
 * 问题：文档预览正文声明 font-family: var(--dsw-font-mono, ui-monospace,
 *       monospace)，而 --dsw-font-mono 在宿主（app.asar 及全部官方 UI 包）
 *       只有引用、从无定义 —— 实际回落 generic monospace，绕过琉璃统一代码
 *       字体栈（规范 3.1）；该正文是侧栏最大的代码 / 文本阅读面，差异最显眼。
 * 处理（审计给出的一次性修法）：由琉璃补齐这条宿主缺失令牌，指向
 *       var(--ds-font-family-code)（JetBrains Mono / SF Mono 栈）。只补令牌、
 *       不写任何组件的 font-family，官方包内所有引用处一并修正。
 *       定义在 body 而非 :root：既吃 body 级运行时令牌（规范 2.3 作用域约定），
 *       也压过宿主将来在 :root 上的同名定义（本元素声明优先于继承值）。
 * 复核：官方若自行补上 --dsw-font-mono 定义，需确认本块是否还需保留。
 * ──────────────────────────────────────────────────────────── */
body {
  --dsw-font-mono: var(--ds-font-family-code, ui-monospace, "SF Mono", Menlo, Consolas, monospace);
}

/* ────────────────────────────────────────────────────────────
 * [dsh-client-ui-sidebar] .x-Wl6W_buildVersion（medium，品牌区版本角标）
 * 问题：圆角写死 2px —— 2px 是琉璃阶梯的「细指示条 / sash 手柄」档，不是徽标档；
 *       底色用 --dsw-alias-label-primary 不透明实底 + 反色文字，在侧栏磨砂材质上
 *       是一小块实心砖，与周围亚克力表面不是一套材质语言（规范 4.1 / 6.7）。
 * 处理：圆角升到徽标档 999px 药丸；底色 / 字色改走规范 6.7 品牌 badge 配方
 *       （brand 12% 底 + brand 字），把侧栏材质让出来；background-image: none
 *       清掉官方可能叠加的渐变 / 噪声层。
 *       不加 border：该角标盒高仅 10px，官方 box-sizing 未知，补 1px 描边可能
 *       改变盒尺寸，按「不动布局尺寸」的约定留白。
 * 未覆盖项（留待排版专项）：font-size 6px / line-height 10px 低于字阶最小档
 *       10px / 16px（规范 3.2），字号不在本次视觉属性白名单内，此处仅记录。
 * 选择器用后缀匹配，避免误伤 _buildVersionLabel 之类同前缀兄弟类（规范 9.2）。
 * ──────────────────────────────────────────────────────────── */
[class$="_buildVersion"] {
  border-radius: 999px !important;
  background-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent) !important;
  background-image: none !important;
  color: var(--dsw-alias-brand-primary) !important;
}

/* ── sidebar-right+skill+slots ── */
/* ════════════════════════════════════════════════════════════
 * 组名：sidebar-right+skill+slots
 * 来源审计：ui-audit/sidebar-right+skill+slots.json（只处理 high / medium）
 * 覆盖对象：dsh-client-ui-sidebar-right、dsh-client-ui-skill
 *
 * 锚点策略：官方组件把状态写在 data-* 上（与 class 同源、跨构建稳定），
 *   因此优先用 data 锚点（style-guide §9.2「data 锚点优先」）：
 *   [data-sidebar-right-guide-entry / -panel / -mode / -toggle /
 *    -expand / -float-host] 全部来自官方 JSX（SidebarRight.tsx、
 *   GuideBody.tsx、ExpandButton.tsx），比会随构建 hash 变化的
 *   [class*="L5GtOG_"] 前缀稳；只有官方未提供 data 锚点的
 *   dsh-client-ui-skill 才退回 [class*="_local"] 前缀匹配。
 * 属性纪律：只改 background / background-image / color / border /
 *   border-radius / box-shadow / backdrop-filter / z-index，
 *   不触碰布局尺寸、display、position 与交互。
 * 重复核对：liuli-css.ts 全文无 data-sidebar-right-* 覆盖，也无
 *   _instructionsCard / _instructionsHeader / _inspectButton / _bodyWrap
 *   覆盖；其中 [:1990] button[class*="_entry"] 与 [:2004] [class*="_panel"]
 *   两条同类覆盖带 [data-liuli-official-rightbar] 作用域，只在该属性存在
 *   时生效 —— 本组补的是该属性缺位时的通用版本。
 *
 * 本组未写规则（跳过 5 条）：
 *   - .L5GtOG_entryTitle 的 15px 字号（medium）：字号不在本次授权的
 *     视觉属性白名单内，属排版专题（§3.2 字阶）。
 *   - [data-sidebar-right-panel=fullscreen] 的 z-index:40 / border:none（low）
 *   - .L5GtOG_hero 静态中性色（low，装饰字形）
 *   - .uEzQxa_card[data-state=running] .uEzQxa_row:after 扫描光带（low）
 *   - .uEzQxa_iconIdle / _chevronHover / _inspectButton 的 .1s 过渡（low）
 * ════════════════════════════════════════════════════════════ */

/* ── 来源包 dsh-client-ui-sidebar-right / GuideBody.module.css ──
 * 发现①（high）：引导页入口胶囊 .L5GtOG_entry 用不透明底
 *   var(--dsw-alias-bg-layer-1)，琉璃把层令牌重定义为实色（亮 #eaf0f4 /
 *   暗 #1e2530，线上实测 rgb(38,37,25)），380×56 胶囊变成实心色块，
 *   盖住亚克力与壁纸磨砂，也不随 M3 动态取色；§6.2.2 要求内嵌卡用
 *   rgba(var(--liuli-acrylic-rgb), 0.35–0.5)。
 * 发现②（medium）：同一胶囊固定圆角 24px，不在 §4.1 阶梯内
 *   （999px / 14px 卡片 / 10px 控件 / 8-7-6px），与同屏琉璃卡片的
 *   14px 形状语言不一致 → 归卡片档。
 * 修法：§5.2 简化亚克力配方（胶离自身无 fixed 后代）＋ 卡片档圆角。
 * 说明：迁移模式下 liuli-css.ts:1990 的 [data-liuli-official-rightbar]
 *   button[class*="_entry"] 特异性更高，其 0.92/0.85 档底色会胜出，
 *   本规则只在该 data 属性缺位时接管；两侧都是亚克力 + 噪声 + 磨砂，
 *   不会出现实心回退。用 data 锚点同时避开 _entryIcon / _entryText /
 *   _entryTitle 的子串误伤（历史踩坑，见 liuli-css.ts:1988）。 */
[data-sidebar-right-guide-entry] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  border-radius: var(--liuli-radius, 14px) !important;
}

/* ── 来源包 dsh-client-ui-sidebar-right / SidebarRight.module.css ──
 * 发现③（high）：右侧栏根面板 .Ng7Ira_panel 用不透明底
 *   var(--dsw-alias-bg-base)（琉璃下亮 #f8f9fa / 暗 #121316，线上实测
 *   rgb(21,19,14)），全高实心板把琉璃卡片外壳的亚克力层完全盖住，
 *   表现是右栏材质与其它列不一致。
 * 修法：按 §6.2.1 / §5.1，区域大卡的根表面自身不持材质 —— 材质由外层
 *   琉璃表面的 ::before 磨砂层承担，与本文件既有 [data-liuli-official-rightbar]
 *   [class*="_panel"] 覆盖（liuli-css.ts:2004）同一策略，避免同一面板
 *   在不同模式下材质不一致。此处不在根元素写 backdrop-filter：会为面板内
 *   的 fixed 后代（tab 内容里的官方/插件浮层）建立包含块（§5.1 踩坑），
 *   且会与外壳的 ::before 磨砂层叠成双层采样。
 * 锚点：官方面板始终带 data-sidebar-right-panel（值 push / fullscreen），
 *   不依赖 fullscreen 这一状态值，故比 [class*="_panel"] 更窄、不误伤
 *   其它包（含琉璃自研 CSS module）的 _panel 类。 */
[data-sidebar-right-panel] {
  background-color: transparent !important;
  background-image: none !important;
}

/* ── 来源包 dsh-client-ui-sidebar-right / SidebarRight.module.css（PanelChrome）
 *    ＋ ExpandButton.module.css ──
 * 发现④（medium）：右栏工具图标按钮 .Ng7Ira_iconButton（全屏切换 / 收起）
 *   用 border-radius:28px 做成正圆。
 * 发现⑤（medium）：会话头展开按钮 .GzLz_G_button 同为正圆。
 *   §6.1.1 规定 28×28 图标按钮圆角 8px（26px 用 7px、22px 用 6px），
 *   正圆属 999px 药丸档；与琉璃侧栏 / 工具条的圆角方块图标按钮并排时
 *   形状语言冲突。
 * 修法：统一到 §4.1 的 8px 档。锚点用官方在按钮上写的
 *   data-sidebar-right-mode / -toggle / -expand，而不是 [class*="_iconButton"]
 *   ——后者会命中其它包同名的 .iconButton（如 AgentPresetSection.iconButton，
 *   形态与尺寸都不同）。 */
[data-sidebar-right-mode],
[data-sidebar-right-toggle],
[data-sidebar-right-expand] {
  border-radius: 8px !important;
}

/* ── 来源包 dsh-client-ui-sidebar-right / SidebarRight.module.css ──
 * 发现⑥（medium）：全屏浮动宿主 .Ng7Ira_floatHost 用
 *   position:fixed;inset:0;z-index:60，为后代建立 60 层层叠上下文。
 *   §8 分层表里 50–60 只属于宿主手柄 / sash 层，浮层体系在
 *   2147482400+；官方浮动层因此被压在所有琉璃浮层之下，被挂进该 host 的
 *   琉璃浮层也被截断在 60 层内。
 * 修法：按 §8「浮动窗口 2147482400」档 —— 与 .floatWindow 同档，高于普通
 *   内容与命令中心 / 文件对话框（1400 / 1500），低于标准弹出层 2147482500、
 *   拖拽屏蔽层 2600 / 幽灵 2700、模态 2800、Toast 2900、悬浮球 3000。
 *   该 host 承载的是浮动面板而非弹出菜单，故不进 2147482500 档。
 *   只改层级，position / inset / pointer-events 归官方。 */
[data-sidebar-right-float-host] {
  z-index: 2147482400 !important;
}

/* ── 来源包 dsh-client-ui-skill / SkillRow.module.css ──
 * 发现⑦（high）：Skill 说明卡 .uEzQxa_instructionsCard 用不透明底
 *   var(--dsw-alias-markdown-code-block)（琉璃下亮 #eef2f6 / 暗 #191d24），
 *   展开后是排在磨砂工具行里的实心块，盖住亚克力且不随壁纸取色。
 * 发现⑧（medium）：同一卡片固定圆角 12px，两边都不靠 §4.1 阶梯，
 *   §6.2.2 明确要求内嵌小卡取 var(--liuli-radius-sm)。
 * 修法：§5.2 简化亚克力配方（官方浮动层用 createPortal 挂到 body，
 *   卡内无 fixed 后代）＋ 控件档圆角；描边保留官方
 *   var(--dsw-alias-border-l1)。官方未提供 data 锚点，
 *   用独有 local 名 instructionsCard 前缀匹配，不会撞其它包。 */
[class*="_instructionsCard"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* ── 来源包 dsh-client-ui-skill / SkillRow.module.css ──
 * 发现⑨（medium）：说明卡标题条 .uEzQxa_instructionsHeader 用不透明底
 *   var(--dsw-alias-markdown-code-block-banner)（琉璃下亮 #f0f4f8 /
 *   暗 #1e2530），与卡体叠成两层不透明灰带后整卡失去材质，
 *   与琉璃用 rgba(var(--liuli-acrylic-rgb), a) 表达分层的做法相反。
 * 修法：同一亚克力色系 + 噪声 + 强磨砂（卡内嵌套 backdrop 采样衰减，
 *   §5.4 用 strong 档），按 §6.2.4「子容器比父卡更实一档」取
 *   material-opacity + 0.15；官方 border-bottom 分层线保留不动。 */
[class*="_instructionsHeader"] {
  background-color: rgba(var(--liuli-acrylic-rgb), calc(var(--liuli-material-opacity) + 0.15)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* ── 来源包 dsh-client-ui-skill / SkillRow.module.css ──
 * 发现⑩（high）：查看按钮 .uEzQxa_inspectButton 用不透明底
 *   var(--dsw-alias-bg-base)（琉璃下亮 #f8f9fa / 暗 #121316），
 *   999px 药丸因此是实心块，叠在壁纸与磨砂卡上时边框与底色深浅不一。
 *   圆角 999px 本身合规，问题只在底色。
 * 修法：§6.1.4 药丸小按钮 —— 透明底 + var(--liuli-border-hairline)
 *   统一细描边（该令牌在 body 上定义并随动态取色，见 §2.3 警告）；
 *   原 hover 实底 --dsw-alias-interactive-bg-hover-solid 同步换成半透明档
 *   --dsw-alias-interactive-bg-hover，否则被 transparent !important 压掉后
 *   会丢失 hover 反馈。
 * 结构：该按钮渲染在 _bodyWrap 内、与说明卡为同级兄弟（不是卡的子级），
 *   故按 .bodyWrap > .inspectButton 的直接子级关系限定，不误伤其它包的
 *   .inspectButton。 */
[class*="_bodyWrap"] > [class*="_inspectButton"] {
  background-color: transparent !important;
  background-image: none !important;
  border-color: var(--liuli-border-hairline) !important;
}

[class*="_bodyWrap"] > [class*="_inspectButton"]:hover {
  background-color: var(--dsw-alias-interactive-bg-hover) !important;
}

/* ── subagent+theme+tool ── */
/* ════════════════════════════════════════════════════════════
 * 琉璃 · 官方 UI 视觉冲突覆盖
 * 组：dsh-client-ui-subagent / dsh-client-ui-theme / dsh-client-ui-tool
 * 来源：C:\\Users\\27280\\AppData\\Local\\Temp\\ui-audit\\subagent+theme+tool.json
 *       （组内 13 条：high 2 / medium 10 / low 1；本文件覆盖 11 条，
 *        跳过内联 SVG 图标体系 1 条、severity=low 1 条）
 * 约定：只覆盖视觉属性（background / background-image / color / border /
 *       border-radius / box-shadow / backdrop-filter / z-index），
 *       不动布局尺寸、display 与交互；选择器用官方 CSS module 的 local 名匹配
 *       （hash 前缀随构建变、local 稳定），并用 :has() / aria-* 锚点收窄，
 *       避免误伤同名 local 的其它包；每条规则前的注释写明来源包与要解决的问题。
 * ════════════════════════════════════════════════════════════ */

/* ── dsh-client-ui-theme · src/styles/gradient-shadow-text.css ─────────────
 * 问题（high）：思考区渐隐层把颜色写死为不透明 #fff（暗色档 #151517），不走语义令牌，
 * 浅色下在磨砂面板上盖出一块纯白蒙层、暗色下为不透明深灰块，且不随 M3 动态取色变化。
 * 改为与琉璃表面同源的亚克力渐变：色相走 --liuli-acrylic-rgb、透明度走
 * --liuli-material-opacity，官方 20.19% → 100% 的 alpha 曲线保持不变；
 * 同源的兄弟令牌 --dsw-linear-think-select（#f5f6f7 / #232325）一并处理。 */
body {
  --dsw-linear-gradient-think: linear-gradient(
    180deg,
    rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) 20.19%,
    rgba(var(--liuli-acrylic-rgb), 0) 100%
  ) !important;
  --dsw-linear-think-select: linear-gradient(
    180deg,
    rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) 20.19%,
    rgba(var(--liuli-acrylic-rgb), 0) 100%
  ) !important;
}

/* 暗色档：官方在 body[data-ds-dark-theme] 里另有一套硬编码深灰渐变，同样改为令牌驱动。 */
body[data-ds-dark-theme] {
  --dsw-linear-gradient-think: linear-gradient(
    180deg,
    rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) 20.19%,
    rgba(var(--liuli-acrylic-rgb), 0) 100%
  ) !important;
  --dsw-linear-think-select: linear-gradient(
    180deg,
    rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) 20.19%,
    rgba(var(--liuli-acrylic-rgb), 0) 100%
  ) !important;
}

/* ── dsh-client-ui-subagent · SubagentHeaderLineage.module.css ─────────────
 * 问题（medium×2）：代理切换浮层 .tcG1Aq_menu ①圆角写死 20px（药丸档，超出菜单档，
 * 不随用户圆角设置联动）②position:fixed 却只给 z-index:100，不在 style-guide §8
 * 任何一档，与琉璃浮动窗口 / 布局菜单 / 悬浮球 / 拾取卡同屏时会被整块压住。
 * 该浮层内联渲染在消息头部（非 portal），用 :has() 锚定其独有的树内容
 * （_node / _metrics 仅本包出现）精确锁定，避免命中其它包的 _menu。 */
[class*="_menu"]:has([class*="_node"], [class*="_metrics"]) {
  border-radius: var(--liuli-radius-sm, 10px) !important;
  z-index: 2147482500 !important; /* §8 标准弹出层档 */
}

/* 问题（medium）：菜单项 / 点击区圆角写死 8px，无法随用户圆角设置缩放，
 * 与上层菜单面板叠加时内外圆角不匹配。改为跟随控件档令牌，内缩 2px 保持同心，
 * 默认解析为 8px（§4.1 菜单项档），用户改圆角时自动联动。 */
[class*="_menu"]:has([class*="_node"], [class*="_metrics"]) [class*="_row"],
[class*="_menu"]:has([class*="_node"], [class*="_metrics"]) [class*="_clickarea"] {
  border-radius: calc(var(--liuli-radius-sm, 10px) - 2px) !important;
}

/* 问题（medium）：28px 高的可点击触发器（面包屑 trigger / switcherTrigger）圆角写死 6px，
 * 6px 不在琉璃阶梯内（26px 图标按钮 7px、28px 用 8px）。
 * 用 aria-haspopup="tree" 锚定本包菜单触发器，避免误伤 input-trigger / settings-general
 * 的 _trigger（它们的档位与本条无关）。 */
button[class*="_trigger"][aria-haspopup="tree"] {
  border-radius: calc(var(--liuli-radius-sm, 10px) - 2px) !important;
}

/* ── dsh-client-ui-tool · ToolIoCard.module.css（WXmFEW_ / MISisG_ 两份同源） ──
 * 问题（medium）：工具卡输入/输出滚动区重写了 scrollbar-thumb，但只给了圆角
 * （6px，不在阶梯内）与硬编码透明边 #0000，未声明 background、未绑定琉璃滚动条令牌，
 * 实际由全局兜底，与琉璃的品牌色滚动条不一致。
 * 按 §6.10 补齐：品牌色 thumb + 8px 圆角 + 透明边（8px 宽由全局 *::-webkit-scrollbar 承担）。 */
[class*="_ioSection"]::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-brand-primary) !important;
  border: 2px solid transparent !important;
  border-radius: 8px !important;
  background-clip: content-box !important;
}

/* 上一条用 !important 压过了全局 *::-webkit-scrollbar-thumb:hover，
 * 需把 hover 反馈同步补回，否则悬停时 thumb 毫无变化。 */
[class*="_ioSection"]::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 80%, white) !important;
  border: 2px solid transparent !important;
  background-clip: content-box !important;
}

/* 问题（medium）：工具/技能的输入输出内嵌卡（ioCard / ioCard + MISisG_ 同源）圆角写死 12px，
 * 同属卡片语义应走卡片档 14px，否则同一张工具卡内部出现两级圆角。
 * 背景配方已由 liuli-css.ts 的 div[class*="ioCard"] 统一为亚克力，这里只补缺失的圆角。 */
[class*="_ioCard"] {
  border-radius: var(--liuli-radius, 14px) !important;
}

/* 问题（medium）：工具卡内的「问答记录卡」（AskQuestionCard.card）圆角写死 12px，
 * 与同屏 14px 卡片混排时圆角不齐、且不随用户设置变化；其证据里同时含不透明实底
 * var(--dsw-alias-bg-base)（琉璃重定义为 #f8f9fa / #121316 实色），在磨砂消息流里是一块实心砖，
 * 一并按 §5.2 简化亚克力配方（该卡无 fixed 后代）改为半透明 + 噪声 + 磨砂。
 * 用 :has() 锚定本卡独有的 _verdict / _questionList，避免 [class*="_card"] 宽匹配误伤其它包卡片。 */
[class*="_card"]:has([class*="_verdict"], [class*="_questionList"]) {
  border-radius: var(--liuli-radius, 14px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* ── dsh-client-ui-theme · AppearanceRow.module.css ───────────────────────
 * 问题（medium）：外观设置的主题方块 .OlZvdG_themeCube 圆角写死 20px —— 该控件既非药丸
 * 也非菜单，20px 属药丸级，超出卡片档且不随用户圆角设置联动。
 * 注：琉璃自研外观方块的 local 同为 themeCube（16px，同样不在 §4.1 阶梯内），
 * 本规则会一并收敛到卡片档，混排时两者圆角一致。 */
[class*="_themeCube"] {
  border-radius: var(--liuli-radius, 14px) !important;
}

/* ── dsh-client-ui-theme · Stepper.module.css ─────────────────────────────
 * 问题（medium）：36px 高的数字步进器圆角写死 18px 胶囊 —— 琉璃只把「下拉触发器」
 * 定义为 18px 胶囊（§6.6），普通数字步进控件应走控件档 → var(--liuli-radius-sm)，
 * 否则它在所有设置行里都是异类胶囊外观。 */
[class*="_stepper"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* 问题（medium）：步进器内的 17×12 微型上下箭头圆角写死 3px，不在琉璃阶梯内
 * （3px 偏方，与整体 M3 形状语言不符）。按 §4.1「18–22px 关闭 / 浮动小按钮 = 6px」
 * 收敛为 calc(--liuli-radius-sm - 4px)，默认 6px 并随用户圆角设置联动。
 * 选择器限定在 _stepper 内，避免命中其它包的 _arrow。 */
[class*="_stepper"] [class*="_arrow"] {
  border-radius: calc(var(--liuli-radius-sm, 10px) - 4px) !important;
}

/* ── trajectory+user-questions+workflow-run ── */
/* ════════════════════════════════════════════════════════════
 * 琉璃 · 官方 UI 视觉冲突覆盖（追加组）
 * 覆盖包：dsh-client-ui-trajectory / dsh-client-ui-user-questions
 * 来源：ui-audit 审计 JSON（package / selector / css / issue / severity / why），
 *   只处理 severity = medium 的 12 条；high 的 7 条全是包内私有内联 SVG /
 *   字符字形图标（图标体系，需 JS 侧接 Material Symbols），low 的 10 条按约定跳过。
 * 约定：
 *  1. 只覆盖视觉属性（background / background-image / color / border /
 *     border-radius / box-shadow / backdrop-filter / font-family / font-size /
 *     line-height）—— 不动布局尺寸、display 与交互，不动 z-index
 *     （本组发现里没有与 style-guide 第 8 节分层表冲突的固定 z-index）。
 *  2. 选择器用官方 CSS module 的 local 名后缀匹配（hash 前缀跨构建会变，
 *     见 liuli-css.ts 交付物卡注释），并用宿主稳定锚点收窄：
 *     [data-question-key] / [data-plan-review-key] / [role="toolbar"]（全仓唯一）/
 *     :has(> [data-trajectory-scroll])。通用 local 名（_card/_title/_badge/_search/
 *     _toggle/_action/_option/_details）一律补元素限定或 :not 排除子串误伤。
 *  3. 官方升级复核点：锚点是否仍在、local 名是否改名、官方是否已自行修复。
 * ════════════════════════════════════════════════════════════ */

/* ── dsh-client-ui-trajectory · TrajectoryTable 详情抽屉 ─────────────
 * 发现（medium）：@media (width<=760px) 的 .MLq9Lq_details 用硬编码阴影
 *   box-shadow:-12px 0 32px #00000024（固定 14% 黑影，不随
 *   --liuli-shadow-strength / 动态取色变化，亮色壁纸下显脏，与同屏琉璃浮层
 *   的方向/浓度不一致）。
 * 同时按材质配方把该抽屉的不透明实底（background: var(--dsw-alias-bg-layer-1)，
 *   亮 #eaf0f4 / 暗 #1e2530 的全高实底）换成亚克力 + 噪声 + 强磨砂，
 *   与同屏其它琉璃浮层/面板材质一致。
 * 作用域：抽屉是官方表格根的直接子 <aside>（结构：div.split >
 *   [div.tablePane[data-trajectory-scroll], aside.details]）；不用裸
 *   [class*="_details"] 匹配（会命中 _detailsCol / _detailsHeader /
 *   _detailsTitle 及其它包的 _details）。 */
div:has(> [data-trajectory-scroll]) > aside[class*="_details"] {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
}

/* 抽屉阴影只在官方 ≤760px 的浮层档存在（宽屏时它是并排的普通列、官方无阴影，
 * 这里也不加，避免给列内子面板套一层全向辉光）。媒体查询不提升特异性，
 * 官方档内的 #00000024 被这条 !important 取代。 */
@media (width<=760px) {
  div:has(> [data-trajectory-scroll]) > aside[class*="_details"] {
    box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
  }
}

/* ── dsh-client-ui-trajectory · 请求边界悬浮标签 ─────────────
 * 发现（medium）：.MLq9Lq_requestBoundaryControl:after 硬编码
 *   box-shadow:0 2px 6px #0000001f（12% 黑影），不随主题阴影强度变化，
 *   也没有琉璃浮层的品牌泛光。
 * 该标签同时是不透明实底（background: var(--dsw-alias-bg-layer-1)）+
 *   .5px 描边的 hover 浮层，属「菜单/hover 卡」档：底色换亚克力 + 噪声，
 *   磨砂用强档（与背景之间隔了卡片 backdrop 根），阴影换成琉璃浮层配方。
 * 锚点：该按钮是 <button>，local 名 _requestBoundaryControl 全仓唯一
 *   （仅 MLq9Lq 模块），自带 data-label / data-request-run-index / data-request-status。 */
button[class*="_requestBoundaryControl"]::after {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

/* ── dsh-client-ui-trajectory · 工具调用名 ─────────────
 * 发现（medium）：.MLq9Lq_toolCallNameTypeface 写死
 *   font:400 12px/18px Menlo,Consolas,Liberation Mono,PingFang SC,Microsoft YaHei
 *   —— 绕过 --ds-font-family-code 与宿主内容字号缩放，与相邻用令牌的
 *   .MLq9Lq_toolCallPayload 同屏不同字体。
 * 修法：字体族走代码字体令牌；字号/行高走宿主内容字阶令牌（secondary = 列表行档
 *   13px/18px），12px 只作令牌缺失时的回落值；用 calc(基线 + delta) 与宿主的
 *   行高缩放方式保持一致（同 host 的 bubble / retryRow 写法）。 */
[class*="_toolCallNameTypeface"] {
  font-family: var(--ds-font-family-code) !important;
  font-size: var(--dsh-content-font-size-secondary, 12px) !important;
  line-height: calc(18px + var(--dsh-content-font-delta-secondary, 0px)) !important;
}

/* ── dsh-client-ui-trajectory · 轮次标号 ─────────────
 * 发现（medium）：.MLq9Lq_turnLabel 用 font:8px/10px var(--ds-font-family-code)，
 *   低于琉璃字阶下限（最小档 10px/16px，角标/badge），且固定 8px 不随
 *   --dsh-content-font-delta 缩放。
 * 修法：落到 10px/16px 下限档。local 名 _turnLabel 全仓唯一，且
 *   turnLabelActive / turnLabelFull / turnLabelCompact 同属这一族（同一元素或
 *   其内部 span），一并归到下限，避免内层 span 再写回小号。 */
[class*="_turnLabel"] {
  font-size: 10px !important;
  line-height: 16px !important;
}

/* ── dsh-client-ui-trajectory · TrajectoryToolbar 工具按钮 ─────────────
 * 发现（medium）：.J49NjG_toggle / .J49NjG_action（20px 高工具按钮）固定
 *   border-radius:3px，不在琉璃圆角阶梯（4.1：18–22px 小按钮 = 6px；
 *   3px 属指示条档），与同屏 6px 关闭键、8px 菜单项不成阶梯。
 * 作用域：全仓仅 TrajectoryToolbar 使用 role="toolbar"（唯一一处），
 *   且限定 button 元素 —— 官方按钮内的 _toggleIcon / _actionIcon 是 svg/span，
 *   不会被 [class*="_toggle"] / [class*="_action"] 的子串匹配带上（图标体系不动）。 */
[role="toolbar"] button[class*="_toggle"],
[role="toolbar"] button[class*="_action"] {
  border-radius: 6px !important;
}

/* ── dsh-client-ui-trajectory · TrajectoryToolbar 搜索框 ─────────────
 * 发现（medium）：.J49NjG_search 用 4px 圆角 + .5px 发丝描边，未走琉璃输入框
 *   配方（6.4：border-radius: var(--liuli-radius-sm) + 1px var(--dsw-alias-border-l2)）。
 * 官方底 --dsw-alias-bg-layer-2 是不透明实底（亮 #dde5ed / 暗 #283040），
 *   在磨砂工具条上像一块实心砖 → 换成亚克力底 + 噪声；磨砂由所在卡片承担，
 *   这个 22px 控件不再自开 backdrop root（避免嵌套采样与多余开销）。
 * 限定 div：官方外框是 div（内含 _searchIcon 的 svg 与 _searchInput 的 input），
 *   元素限定即可排除同族子串误伤。 */
[role="toolbar"] div[class*="_search"] {
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity)) !important;
  background-image: var(--liuli-noise) !important;
}

/* ── dsh-client-ui-user-questions · QuestionComposer / PlanReviewPanel ─────────────
 * 两张卡都接管 composer 输入位，官方结构（宿主自带锚点，跨构建稳定）：
 *   div[data-question-key] > section.card（QuestionComposer）
 *   div[data-plan-review-key] > section.card（PlanReviewPanel）
 * local 名 _card 在多个包里都有，因此必须限定「锚点下的直接 section」。 */

/* 发现（medium ×2）：两张卡固定 border-radius:20px，官方 ≤720px 媒体查询降到 16px
 *   —— 两个值都不是琉璃阶梯值（该位置是卡片档 var(--liuli-radius) = 14px，
 *   与下方磨砂输入卡同档），20px/16px 会让卡片在磨砂面板里更圆更「软」。
 * !important 同时压过媒体查询里的 16px。 */
[data-question-key] > section[class*="_card"],
[data-plan-review-key] > section[class*="_card"] {
  border-radius: var(--liuli-radius, 14px) !important;
}

/* 发现（medium）：两张卡分别用 --dsw-elevation-panel（QOsGLa）与
 *   --dsw-shadow-lv2（gtAFBG）两个宿主 elevation 令牌做阴影，既互不一致，
 *   也没有琉璃卡片的品牌辉光（插件只给 [data-composer-card] 补了辉光合成，
 *   见 liuli-css.ts 输入卡那条）。
 * 修法：与 composer 输入卡同一条合成链：宿主 elevation + 品牌辉光 + 通用投影。
 * 顺带补齐材质配方缺的噪声层 —— 底色（--dsw-specific-input-major，即
 *   rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity))）与强磨砂
 *   已由 liuli-css.ts 的 [data-question-key] > section / [data-plan-review-key] >
 *   section 规则提供，这里不重复，只加噪声。 */
[data-question-key] > section[class*="_card"],
[data-plan-review-key] > section[class*="_card"] {
  background-image: var(--liuli-noise) !important;
  box-shadow: var(--dsw-shadow-lv2, none), var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

/* 发现（medium）：.QOsGLa_title 固定 16px/22px（官方 ≤720px 为 15px/21px），
 *   不在琉璃字阶（3.2：卡片/设置行标题档 = 14px/22px），也不跟随内容字号缩放，
 *   与同屏用令牌的 eyebrow（11px）、progress（14px）不成阶梯。
 * 结构：<h2 class="…_title">，用 h2 限定（避免命中 _titleRow 一类兄弟）；
 *   字号/行高走宿主内容字号令牌，14px/22px 只作回落值。 */
[data-question-key] h2[class*="_title"] {
  font-size: var(--dsh-content-font-size, 14px) !important;
  line-height: calc(22px + var(--dsh-content-font-delta, 0px)) !important;
}

/* 发现（medium）：「推荐」徽章把 --dsw-specific-sidebar-nav-item-active-accent
 *   当浅色底用，而琉璃把它重定义为不透明高对比前景色（亮 #001d33 / 暗 #d0e8ff），
 *   官方配的 --dsw-alias-button-info-fill 文字于是变成深底蓝字 / 浅底浅蓝字，
 *   暗色主题下几乎读不出来。
 * 修法：改成琉璃品牌 badge 配方（6.7：品牌 12% 底 + 品牌前景），明暗双主题都可读，
 *   且不再依赖被重定义的导航 active 令牌。圆角与内边距非本次发现，保持官方值。
 * local 名 _badge 全仓仅 QOsGLa / fU-zVq 两处，锚点下唯一。 */
[data-question-key] [class*="_badge"] {
  background-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent) !important;
  color: var(--dsw-alias-brand-primary) !important;
}

/* 发现（medium）：.QOsGLa_option（40px 可点选项行）/ .QOsGLa_customRow 固定
 *   border-radius:12px —— 琉璃阶梯里 12px 只给菜单面板，行/菜单项档是 8px、
 *   控件档 10px；这里按控件档取 var(--liuli-radius-sm)，与同屏 10px 输入块成阶梯。
 * 元素限定：option 是 <button>（排除 _optionCopy / _optionLine / _optionLabel
 *   文本节点），customRow 是 <div>（customRowActive 是同一元素的状态类）。
 * 官方 hover 才补的 --dsw-alias-border-l2 描边与 #0000 占位属 low 发现，不动。 */
[data-question-key] button[class*="_option"],
[data-question-key] div[class*="_customRow"] {
  border-radius: var(--liuli-radius-sm, 10px) !important;
}

/* ── 本组未覆盖（按约定跳过，便于升级后复核）─────────────────────────
 * dsh-client-ui-trajectory · high ×7：ToolWrenchIcon / InformationIcon /
 *   CompactedIcon / .assistantToolCallIcon / .toolCatalogIcon / .toggleIcon 是包内
 *   私有 16–24 viewBox 的 stroke 内联 SVG，.actionIcon 是 U+229E/U+229F 字符字形
 *   配 var(--ds-font-family-code)（该字体栈常缺这两个字形，会渲染成豆腐块）。
 *   均属图标体系，CSS 只能改颜色/字体族、无法替换图标本体 → 需在 JS 侧接
 *   Material Symbols（与 SidePaneIcons 同源）。
 * dsh-client-ui-workflow-run · low ×1：成员行 / phaseHeader 焦点环 4px 圆角，
 *   该包其余度量（32px 头行 8px、字号 11/13/14px）都在阶梯内。
 */

/* ════════════════════════════════════════════════════════════
 * 第三方插件 Jet Hub（dsh-codearts-auth）设置分区适配
 * 来源：插件 plugin-src/client/jet-hub-styles.js 手写的全局类
 *       （.dim-jh-* 前缀，非 CSS Module、无哈希，故可直接锚定）
 *
 * Jet Hub 是「Provider 凭据 / 多账号管理」设置分区。它自带一套独立设计语言：
 * 品牌色写死 #1677ff 蓝、卡片走 bg-layer-3 实底、provider 图标垫纯白底、
 * 分隔线读 border-default。在琉璃下与紧邻的官方设置导航 / 设置行明显不同族；
 * 其中两处是硬伤而不只是观感差异：
 *
 *   ① 分隔线写 var(--dsw-alias-border-default, #e5e5e5)：琉璃没有
 *      --dsw-alias-border-default 这个令牌（只有 border-l1/l2/l3/l4），
 *      于是页头底边、侧栏右边一律回落成亮灰 #e5e5e5 —— 暗色主题下是两条
 *      刺眼的浅亮线（实测 rgb(229,229,229)，而暗色 border-l1 应是极暗发丝线）。
 *   ② 模型列表弹窗靠 position:fixed 覆盖全屏，但设置模态面板根持有
 *      backdrop-filter（本文件「浮动卡片统一补磨砂」一节的
 *      [role="dialog"][class*="_panel"] 规则），使它成为 fixed 后代的包含块：
 *      弹窗被压扁成面板大小 —— 实测 overlay rect = [880,116,800,800]，
 *      而视口是 2560×1032（弹窗右下半截被裁掉）。
 *
 * 作用域：body:has(.dim-jh-page) —— 只在琉璃主题下、
 *   设置模态打开时生效；选择器一律锚定 .dim-jh-* 自有前缀（全仓唯一，不与
 *   官方哈希类名或其它插件撞名），不用 div[class*=...] 一类宽选择器。
 *
 * 纪律（style-guide §9）：只覆盖视觉属性（background* / color / border* /
 *   border-radius / box-shadow / backdrop-filter / outline / z-index /
 *   transition）与最小幅度的排版收敛（去重复留白、与官方设置导航对齐）；
 *   不改 DOM 结构、不改 display、不改交互。尺寸类改动逐条注明依据。
 * ════════════════════════════════════════════════════════════ */

/* ── 0. 配套修复：设置模态面板根不得持有 backdrop-filter（high，功能性） ──
 * 本文件「浮动卡片统一补磨砂」一节写了 [role="dialog"][class*="_panel"] 直接
 * 在根元素上挂 backdrop-filter。该写法对「无 fixed 后代的浮卡」成立，但设置
 * 模态面板内部会渲染 position:fixed 的全屏弹层（Jet Hub 模型列表、其它分区的
 * 选择器弹层），而 backdrop-filter 会让元素成为 fixed 后代的包含块 —— 弹层
 * 于是被限死在面板盒内。实测：清掉根的这一条后，Jet Hub 模型弹窗的
 * overlay rect 由 [880,116,800,800] 恢复为 [0,0,2560,1032]（完整覆盖视口）。
 * 材质不会因此丢失：本文件下面的
 * [class*="_overlay"] > [class*="_panel"]::before 规则已用 ::before 独立层
 * 承担同一份亚克力配方（半透明底 + 噪声 + strong 档磨砂），根只负责定位 /
 * 圆角 / 阴影 / 裁剪 —— 正是 style-guide §5.1 对「可能含 fixed 后代的卡片」
 * 要求的结构。选择器与那条 ::before 规则一一对应（同样要求 overlay > panel），
 * 因此凡是被本规则命中的面板，材质必然由 ::before 提供，无遗漏场景。 */
[class*="_overlay"] > [class*="_panel"] {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

/* ── 1. 页头：与官方 header 重复的第二层页头，收敛为分区标题条（medium） ──
 * 设置模态自己的 .MI-_Aa_header（54px 固定行，含「打开配置文件 / 导出诊断信息 /
 * 打开 DSH 终端 / 重启 / 关闭」）始终渲染在内容区顶部；Jet Hub 又写了一个
 * 77px 的 .dim-jh-header（品牌名 + 描述 + 第二个「关闭」按钮），于是同一屏里
 * 出现两个页头、两个关闭入口，中间还夹着 ① 的亮灰回落线。
 * 处理：去掉底边线（官方 header 已提供区域分隔），把品牌名收进琉璃字阶
 * （16px/24 w500 = 官方 .MI-_Aa_navTitle 的度量，与左栏「设置」标题同档），
 * 描述降到 12px/18 tertiary。第二个关闭按钮保留（窄窗时官方 header 可能换行，
 * 多一个入口无害），但随通用 ghost 按钮配方弱化，不再与品牌名争夺注意力。 */
body:has(.dim-jh-page) .dim-jh-header {
  align-items: center !important;
  padding: 0 0 14px !important;
  border-bottom: none !important;
}

body:has(.dim-jh-page) .dim-jh-brandName {
  font-size: 16px !important;
  font-weight: 500 !important;
  line-height: 24px !important;
  color: var(--dsw-alias-label-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-brandDesc {
  margin-top: 2px !important;
  font-size: 12px !important;
  line-height: 18px !important;
  color: var(--dsw-alias-label-tertiary) !important;
}

/* ── 2. 左侧 Provider 导航：对齐官方设置导航 .MI-_Aa_navCell（medium） ──
 * 官方导航项：height:40px、border-radius:12px、background:transparent、
 * hover 用 --dsw-specific-sidebar-nav-item-hover、选中用
 * --dsw-specific-sidebar-nav-item-active（不透明实底），选中态文字仍是
 * label-primary。Jet Hub 的 provider 卡却自绘了「实底卡 + 亮蓝描边 + 蓝字」
 * 三件套，与紧邻的官方导航列并排时一眼可辨不是一套。
 * 处理：换成与官方导航完全同源的令牌组合（同一 active/hover 令牌、同样的
 * 透明常态 + 12px 圆角），使两列导航在观感上属于同一个控件族。
 * 圆角取 12px 而不取 var(--liuli-radius-sm)：此处刻意与官方 navCell 逐值对齐，
 * 「同族」优先于「阶梯」（style-guide §4.1 的药丸/卡片分档针对琉璃自有组件）。
 * 侧栏右边框本来走 ① 的回落亮灰线，一并换成 border-l1 发丝线。 */
body:has(.dim-jh-page) .dim-jh-rail {
  gap: 4px !important;
  padding: 4px 8px 8px !important;
  border-right: 1px solid var(--dsw-alias-border-l1) !important;
}

body:has(.dim-jh-page) .dim-jh-provider {
  border: 1px solid transparent !important;
  border-radius: 12px !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
  color: var(--dsw-alias-label-secondary) !important;
  transition: background-color 0.16s cubic-bezier(0.4, 0, 0.2, 1),
    color 0.16s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

body:has(.dim-jh-page) .dim-jh-provider:hover {
  border-color: transparent !important;
  background-color: var(--dsw-specific-sidebar-nav-item-hover) !important;
  color: var(--dsw-alias-label-primary) !important;
  box-shadow: none !important;
}

body:has(.dim-jh-page) .dim-jh-provider[aria-selected="true"],
body:has(.dim-jh-page) .dim-jh-provider[aria-selected="true"]:hover {
  border-color: transparent !important;
  background-color: var(--dsw-specific-sidebar-nav-item-active) !important;
  color: var(--dsw-alias-label-primary) !important;
  box-shadow: none !important;
}

/* 焦点环归琉璃统一配方（brand 70% + 1px offset）；官方导航项无自绘焦点样式，
   此处把插件原有的「亮蓝描边 + 蓝色内阴影」双焦点换成同一条。 */
body:has(.dim-jh-page) .dim-jh-provider:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent) !important;
  outline-offset: 1px !important;
  box-shadow: none !important;
}

/* provider 图标：插件的 .codearts / .buddy / .workbuddy 三条规则都给纯白底
   （认为 logo 需要白衬底），但这三个内联 PNG 本身是带 alpha 的透明图
   （实测角像素 alpha=0），白底在暗色主题下反而是一块刺眼白斑。
   处理：撤掉白底，改中性 8% 衬底 —— 明暗主题下都能给彩色 logo 一点底色托底，
   又不会在选中态的实底导航项上形成白块。 */
body:has(.dim-jh-page) .dim-jh-providerIcon {
  border-radius: 9px !important;
  background-color: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent) !important;
  box-shadow: none !important;
}

body:has(.dim-jh-page) .dim-jh-providerIcon img {
  border-radius: 4px !important;
}

/* provider 名：插件的 .dim-jh-providerLabel 类在组件里并未挂上（DOM 是裸
   <span><strong>），那组「截断 + 字重」规则实际是死代码 —— provider 名窄到
   放不下时不会省略号截断。这里按真实结构补回，字重取 500（比官方导航项的
   400 略重，因为卡片名是列表项主信息）。 */
body:has(.dim-jh-page) .dim-jh-provider > span:last-child {
  min-width: 0 !important;
}

body:has(.dim-jh-page) .dim-jh-provider > span:last-child > strong {
  display: block !important;
  overflow: hidden !important;
  font-size: 14px !important;
  font-weight: 500 !important;
  line-height: 20px !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
}

/* ── 2b. 窄窗护栏：rail 可收缩（medium，响应式缺口） ──
 * 设置模态宽度是 min(800px, calc(100vw - 48px))，窗口压到约 850px 以下时内容区
 * 随之变窄。插件把 .dim-jh-rail 写死 width:200px 且默认 flex-shrink:1 但
 * 基准就是 200px —— 实测把模态压到 560px 时，内容区仅剩 324px，rail 独占 217px，
 * 内容面板（flex:1）被挤到 107px，6 个按钮横向溢出容器（overflow 实测 true）。
 * 处理（经四组对照实测选定）：rail 由写死的 width:200px 改为「200px 基准 + 可
 * 收缩」，下限 132px（图标 30 + gap 10 + 左右内边距 24 + 文字最小可读宽）；
 * 内容面板 flex:1 1 0% 在空间不足时会被一路压到 0（实测 480px 时仅剩 27px），
 * 故补 min-width:240px 保底，按钮组由自身 flex-wrap 接管换行。
 * 实测（模态宽度 560px）：rail 217→149px、面板 107→260px、按钮由 6 行溢出
 * 收敛为 3 行不溢出；800px 默认宽度下 flex 不触发收缩，rail 仍是 217px
 * （200px 内容盒 + 16px padding + 1px border，插件原是 content-box），
 * 与改动前逐像素一致。
 *
 * 注：「200px 基准」而非「200px 外框」是刻意的 —— 后者需同时改 box-sizing，
 * 会让默认态 rail 由 217px 变 200px，属于不必要的布局尺寸变动
 * （style-guide §9：覆盖只动视觉与必要的响应式缺口）。 */
body:has(.dim-jh-page) .dim-jh-rail {
  flex: 0 1 200px !important;
  min-width: 132px !important;
}

/* ── 3. 右侧内容区：收回与官方 options 重复的留白（medium） ──
 * 官方 .MI-_Aa_options 已提供 padding:0 24px 24px。Jet Hub 的内容面板
 * .dim-jh-panel 又补了 padding:24px，两处叠加后正文左右各缩进 48px ——
 * 面板实测仅 299px 可用宽，6 个操作按钮被迫折成 2 行。
 * 处理：只保留左侧 20px 与侧栏的呼吸间距，右 / 上 / 下交给官方 options；
 * 内容区由此增宽，按钮行压力同步缓解。 */
body:has(.dim-jh-page) .dim-jh-panel {
  min-width: 240px !important;
  padding: 0 0 0 20px !important;
}

/* 面板标题：与左栏「设置」标题、页头品牌名同档（16px/24 w500）。 */
body:has(.dim-jh-page) .dim-jh-panelTitle {
  font-size: 16px !important;
  font-weight: 500 !important;
  line-height: 24px !important;
  color: var(--dsw-alias-label-primary) !important;
}

/* ── 4. 账号卡：实底 → 标准亚克力卡（medium） ──
 * 插件给 .dim-jh-accountCard 用 background: var(--dsw-alias-bg-layer-3)，
 * 该令牌在琉璃下是不透明实色（亮 #d2dce6 / 暗 #333d4e），卡片成一块实心板，
 * 完全遮住壁纸与磨砂，拖「材质不透明度」滑条对本分区毫无反应。
 * 处理：style-guide §5.1 标准卡配方 —— 根置透明、撤掉自带阴影，材质交给
 * ::before 独立层（半透明底 + 噪声 + strong 档磨砂），根负责定位 / 圆角 /
 * 阴影 / 裁剪。strong 档依据 §5.4：本卡与壁纸之间隔着设置面板 .MI-_Aa_panel
 * 的 ::before backdrop 根，采样会衰减。
 * 两条护栏同 §5.1：position:relative 让 ::before 的 inset:0 锚回卡片自身
 * （否则会以最近的定位祖先前述面板为参照撑满整个模态）；overflow:hidden
 * 保证圆角外的亚克力方块被裁掉。z-index:0 自建层叠上下文，防止 ::before 的
 * z-index:-1 逃逸到卡片背后。
 * hover：原为写死 #1677ff 的 22% 描边，换成品牌令牌；阴影升级到 strong 辉光，
 * 与侧栏卡片 hover 的手感一致（§6.2）。 */
body:has(.dim-jh-page) .dim-jh-accountCard {
  position: relative !important;
  z-index: 0 !important;
  overflow: hidden !important;
  border: 1px solid var(--dsw-alias-border-l1) !important;
  border-radius: var(--liuli-radius, 14px) !important;
  background-color: transparent !important;
  background-image: none !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
  transition: border-color 0.16s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.16s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

body:has(.dim-jh-page) .dim-jh-accountCard::before {
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

body:has(.dim-jh-page) .dim-jh-accountCard:hover {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, var(--dsw-alias-border-l1)) !important;
  box-shadow: var(--liuli-glow-brand-strong), var(--liuli-shadow) !important;
}

/* 卡片内操作区顶部分隔线：同样从 ① 的亮灰回落线换成 border-l1。 */
body:has(.dim-jh-page) .dim-jh-accountActions {
  gap: 6px !important;
  border-top: 1px solid var(--dsw-alias-border-l1) !important;
}

/* ── 5. 按钮：默认次级 ghost、primary 主色、danger 危险色（medium） ──
 * 插件按钮统一是「bg-layer-3 实底 + #dfe1e5 描边」，在磨砂卡上叠出一块比卡片
 * 更实的色斑，且描边色不随主题令牌走。按 style-guide §6.1.3 工具 / 描边按钮
 * 配方换成「透明底 + --liuli-border-hairline 细描边 + secondary 文字」，
 * 圆角取控件档 var(--liuli-radius-sm)；§6.1.5 主按钮配方用于 data-kind=primary
 * （品牌实底 + 前景色 + 品牌辉光，hover 升到 strong）。
 * 信息层级：页头操作区默认把 6 个按钮平铺成同级。primary（「+ 新建账号」）
 * 用 margin-left:auto 推到行尾，与左侧的批量工具（显示列表 / 刷新积分 /
 * 一键领取 / 重测所有 / 重置所有）形成「工具组 | 主操作」两段式层级。
 * 位置选择器一律不用：按钮个数随 provider 变化（CodeBuddy 多一个「一键领取
 * 积分」），nth-child 会错位；只用插件已给出的 data-kind 语义锚点。 */
body:has(.dim-jh-page) .dim-jh-btn {
  border: 1px solid var(--liuli-border-hairline) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  background-color: transparent !important;
  background-image: none !important;
  color: var(--dsw-alias-label-secondary) !important;
  box-shadow: none !important;
  transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

body:has(.dim-jh-page) .dim-jh-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent) !important;
  background-color: var(--dsw-alias-interactive-bg-hover) !important;
  color: var(--dsw-alias-label-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-btn[data-kind="primary"] {
  margin-left: auto !important;
  border-color: transparent !important;
  background-color: var(--dsw-alias-button-primary-fill) !important;
  color: var(--dsw-alias-label-primary-foreground) !important;
  box-shadow: var(--liuli-glow-brand) !important;
}

body:has(.dim-jh-page) .dim-jh-btn[data-kind="primary"]:hover:not(:disabled) {
  border-color: transparent !important;
  background-color: var(--dsw-alias-button-primary-hover) !important;
  color: var(--dsw-alias-label-primary-foreground) !important;
  box-shadow: var(--liuli-glow-brand-strong) !important;
}

/* 危险按钮（账号卡「删除」）：§6.1.6 —— error 语义前景 + 危险 hover 底。 */
body:has(.dim-jh-page) .dim-jh-btn[data-kind="danger"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent) !important;
  color: var(--dsw-alias-state-error-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-btn[data-kind="danger"]:hover:not(:disabled) {
  border-color: var(--dsw-alias-state-error-primary) !important;
  background-color: var(--dsw-alias-interactive-bg-hover-danger) !important;
  color: var(--dsw-alias-state-error-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-btn:disabled {
  opacity: 0.5 !important;
  cursor: default !important;
}

/* ── 6. 徽章 / 状态点 / 积分 / 元信息（medium） ──
 * 这一组插件已部分用了语义令牌（dt 用 tertiary、metaRow 的 muted 等），
 * 但状态类全部写死：状态点 #22c55e、启用徽章 #15803d + rgb(34 197 94/12%)、
 * 积分总额 #1677ff、限额徽章 #b45309、警告文字 #e37400、代码角标 #f4f5f7。
 * 处理：逐项换成琉璃语义令牌 —— 成功类走 state-success、警告类走 state-warn、
 * 品牌数值走 brand-primary。注意琉璃的 success 在「MCU 动态取色」模式下会
 * 映射到品牌角色色（用户当前配置下实测 = 品牌色），所以状态点与启用徽章
 * 会自动跟随动态取色，不再是固定的绿。
 * 积分数值加 tabular-nums（§3.3：额度 / 统计类数字等宽对齐）。 */
body:has(.dim-jh-page) .dim-jh-accountStatus {
  background-color: var(--dsw-alias-label-tertiary) !important;
}

body:has(.dim-jh-page) .dim-jh-accountStatus[data-on="true"] {
  background-color: var(--dsw-alias-state-success-primary) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 16%, transparent) !important;
}

body:has(.dim-jh-page) .dim-jh-accountTag[data-tone="on"] {
  color: var(--dsw-alias-state-success-primary) !important;
  background-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent) !important;
}

body:has(.dim-jh-page) .dim-jh-accountTag[data-tone="off"] {
  color: var(--dsw-alias-label-tertiary) !important;
  background-color: color-mix(in srgb, var(--dsw-alias-label-tertiary) 14%, transparent) !important;
}

body:has(.dim-jh-page) .dim-jh-creditTotal {
  color: var(--dsw-alias-brand-primary) !important;
  font-variant-numeric: tabular-nums !important;
}

body:has(.dim-jh-page) .dim-jh-creditExpired {
  color: var(--dsw-alias-state-warn-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-creditPackages {
  color: var(--dsw-alias-label-tertiary) !important;
}

body:has(.dim-jh-page) .dim-jh-ttlBadge {
  color: var(--dsw-alias-state-warn-primary) !important;
  background-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent) !important;
}

body:has(.dim-jh-page) .dim-jh-metaRow dd[data-tone="warn"] {
  color: var(--dsw-alias-state-warn-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-metaRow dd[data-tone="muted"] {
  color: var(--dsw-alias-label-tertiary) !important;
}

/* 凭据 ref / 模型 id 这类代码角标：底从 bg-layer-2 实底换成「前景 8%」的
   中性淡底（bg-layer-2 在琉璃下是不透明实色，叠在磨砂卡上会形成第二层实心块），
   字体按 §3.3 统一走 --ds-font-family-code（插件写的是 ui-monospace 私有栈）。 */
body:has(.dim-jh-page) .dim-jh-metaRow code,
body:has(.dim-jh-page) .dim-jh-modelId {
  background-color: color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent) !important;
  color: var(--dsw-alias-label-secondary) !important;
  font-family: var(--ds-font-family-code) !important;
}

/* ── 7. 提示条与空状态（medium） ──
 * 提示条（重测 / 重置 / 领积分结果）与空状态原本都是「border-l2 描边 + 实底」。
 * 按 §6.8 空状态规范给空态换虚线卡；提示条保留实线但底改亚克力，tone 变体
 * 全部换语义令牌（ok→success / warn→warn / error→error）。 */
body:has(.dim-jh-page) .dim-jh-probeNotice {
  border: 1px solid var(--dsw-alias-border-l2) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55)) !important;
  background-image: var(--liuli-noise) !important;
  color: var(--dsw-alias-label-secondary) !important;
}

body:has(.dim-jh-page) .dim-jh-probeNotice[data-tone="ok"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 38%, var(--dsw-alias-border-l2)) !important;
  background-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent) !important;
  color: var(--dsw-alias-state-success-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-probeNotice[data-tone="warn"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 38%, var(--dsw-alias-border-l2)) !important;
  background-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent) !important;
  color: var(--dsw-alias-state-warn-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-probeNotice[data-tone="error"] {
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 38%, var(--dsw-alias-border-l2)) !important;
  background-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent) !important;
  color: var(--dsw-alias-state-error-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-empty {
  padding: 32px 20px !important;
  border: 1px dashed var(--dsw-alias-border-l2) !important;
  border-radius: var(--liuli-radius-sm, 10px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), calc(var(--liuli-material-opacity, 0.55) * 0.6)) !important;
  color: var(--dsw-alias-label-tertiary) !important;
}

/* 弹窗内的空态已是列表容器内的占位，不再叠一层虚线框（避免框套框）。 */
body:has(.dim-jh-page) .dim-jh-modalBody .dim-jh-empty {
  border: none !important;
  background-color: transparent !important;
  padding: 24px !important;
}

/* ── 8. 模型列表弹窗（medium，含配套的层级归位） ──
 * 弹窗根 .dim-jh-modal 用 bg-layer-1 实底 + 官方 elevation 阴影，是一块不透明
 * 板；遮罩写死 rgba(0,0,0,0.32)、z-index 写死 3000。
 * 处理：
 *   · 遮罩底色与磨砂改读官方同类令牌（--dsw-alias-bg-mask-1 / --dsw-mask-blur），
 *     与设置模态自身的 .MI-_Aa_mask 完全同源，亮暗主题自动加深；
 *   · 层级归 style-guide §8 的「模态遮罩」档 2147482800。
 *     需要说明：本弹窗渲染在 .MI-_Aa_panel 内部（该面板是 position:relative +
 *     z-index:1 的层叠上下文），因此该值只参与面板内部的相对比较 —— 面板之外的
 *     琉璃浮层（悬浮球 2147483000、拾取卡 2147483100）理应压在其上，
 *     这是既有设计而非缺陷；
 *   · 弹窗面板走 §5.2 简化亚克力配方（卡内无 fixed 后代）+ strong 档磨砂
 *     （与壁纸之间隔着面板 ::before 这一层 backdrop 根）；
 *   · 模型行 hover 从 bg-layer-2 实底换成 interactive-bg-hover，行圆角归 8px 档；
 *   · 开关按 §6.6：关态轨道 border-l3、开态 brand-primary、knob 用 label-primary
 *     （明暗双主题下都可见）。 */
body:has(.dim-jh-page) .dim-jh-modalOverlay {
  z-index: 2147482800 !important;
  background-color: var(--dsw-alias-bg-mask-1) !important;
  -webkit-backdrop-filter: var(--dsw-mask-blur, blur(2px)) !important;
  backdrop-filter: var(--dsw-mask-blur, blur(2px)) !important;
}

body:has(.dim-jh-page) .dim-jh-modal {
  border: 1px solid var(--dsw-alias-border-l1) !important;
  border-radius: var(--liuli-radius, 14px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

body:has(.dim-jh-page) .dim-jh-modelRow {
  border-radius: 8px !important;
}

body:has(.dim-jh-page) .dim-jh-modelRow:hover {
  background-color: var(--dsw-alias-interactive-bg-hover) !important;
}

body:has(.dim-jh-page) .dim-jh-modelRow[data-disabled="true"] .dim-jh-modelInfo {
  opacity: 0.5 !important;
}

body:has(.dim-jh-page) .dim-jh-switch {
  background-color: var(--dsw-alias-border-l3) !important;
}

body:has(.dim-jh-page) .dim-jh-switch::after {
  background-color: var(--dsw-alias-label-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-switch:checked {
  background-color: var(--dsw-alias-brand-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-switch:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent) !important;
  outline-offset: 1px !important;
  box-shadow: none !important;
}

/* ── 9. 登录弹窗（low；当前版本已无调用点，按同一配方预防性覆盖） ──
 * 组件里已不再渲染 .dim-jh-loginOverlay / .dim-jh-loginDialog（grep 全仓只剩
 * 一处解释性注释），保留覆盖只为该弹窗若回归时不出现「写死遮罩 + 实底板」。 */
body:has(.dim-jh-page) .dim-jh-loginOverlay {
  z-index: 2147482800 !important;
  background-color: var(--dsw-alias-bg-mask-1) !important;
}

body:has(.dim-jh-page) .dim-jh-loginDialog {
  border: 1px solid var(--dsw-alias-border-l1) !important;
  border-radius: var(--liuli-radius, 14px) !important;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55)) !important;
  background-image: var(--liuli-noise) !important;
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)) !important;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow) !important;
}

body:has(.dim-jh-page) .dim-jh-loginDialog h3 {
  color: var(--dsw-alias-label-primary) !important;
}

body:has(.dim-jh-page) .dim-jh-loginDialog p {
  color: var(--dsw-alias-label-secondary) !important;
}

/* ── 10. 动效降级（§7.3 / §10 checklist） ──
 * 本组新增的三处过渡（provider 导航项、账号卡、按钮）在「减少动态效果」下
 * 一律关闭，与仓库其它组保持一致。 */
@media (prefers-reduced-motion: reduce) {
  body:has(.dim-jh-page) .dim-jh-provider,
  body:has(.dim-jh-page) .dim-jh-accountCard,
  body:has(.dim-jh-page) .dim-jh-btn {
    transition: none !important;
  }
}

/* 轻量交互反馈：只覆盖确定为浮层本体的锚点，避免 _menuWrap 等包装器
   或指针跟随元素在每次移动时重播动画。 */
[data-liuli-context-menu],
[role="menu"][class*="_list"],
[role="menu"][class*="_submenu"] {
  animation: liuli-menu-enter 160ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

[data-liuli-context-menu][data-closing] {
  pointer-events: none;
  animation: liuli-menu-exit 120ms ease-in both;
}

.liuli-menu-item,
[role="menu"][class*="_list"] [class*="_item"],
[role="menu"][class*="_submenu"] [class*="_item"] {
  transition: background-color 120ms ease, color 120ms ease;
}

[role="dialog"][class*="_dialog"] {
  animation: liuli-dialog-enter 180ms cubic-bezier(0.22, 1, 0.36, 1) both;
}

@keyframes liuli-menu-enter {
  from { opacity: 0; transform: translateY(-4px) scale(0.985); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

@keyframes liuli-menu-exit {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to { opacity: 0; transform: translateY(-3px) scale(0.985); }
}

@keyframes liuli-dialog-enter {
  from { opacity: 0; }
  to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  [data-liuli-context-menu],
  [data-liuli-context-menu][data-closing],
  [role="menu"][class*="_list"],
  [role="menu"][class*="_submenu"],
  [role="dialog"][class*="_dialog"] { animation: none; }

  .liuli-menu-item,
  [role="menu"][class*="_list"] [class*="_item"],
  [role="menu"][class*="_submenu"] [class*="_item"] { transition: none; }
}

`
