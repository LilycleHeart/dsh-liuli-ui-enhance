# 琉璃样式规范（Style Guide）

> 本文档是 `dsh-liuli-ui-enhance` 的 UI 样式规范，覆盖从设计令牌、材质配方到按钮 / 卡片 / 输入框 / 菜单 / 徽章 / 拖拽视觉等全部组件类别。
> 所有规则均从仓库现有实现中归纳，新增样式必须先读本规范再动手；与本规范冲突的写法应视为历史遗留，在合适时机对齐。

## 0. 样式载体与“唯一真相”警告

仓库里样式有三个载体，职责不同：

| 载体 | 路径 | 职责 | 注意 |
| --- | --- | --- | --- |
| 全局样式源 | `src/client/liuli.css` | 设计令牌、亮暗主题、全局铬色、浮动卡片磨砂、侧栏选中、入场动画 | 当前与 `liuli-css.ts` **不完全一致**，是历史遗留 |
| 运行时全局样式 | `src/client/liuli-css.ts` | 浏览器入口实际注入的全局 CSS 字符串 | **运行时以它为准**；改全局样式必须至少同步这里 |
| 组件样式 | `src/client/*.module.css` | 各 React 组件的 CSS Modules | 组件私有类名，哈希化 |

另有 `src/client/index.ts` 中拼装的 `DESKTOP_ADVANCED_CSS`（DSH Desktop advanced 无边框模式差异样式）和别名挂载 effect（把 shell 元素打上 `liuli_frame / liuli_sidebarCol / liuli_centerCol / liuli_detailsCol` 类名，让 `[class*=]` 配方复用）。

**铁律**：

1. 改全局样式（令牌、选择器覆盖、动画）→ 同步 `liuli.css` 与 `liuli-css.ts` 两个文件；若只改一个，运行时会以 `liuli-css.ts` 为准。
2. 组件私有样式一律放 CSS Modules，不要在全局样式里为组件写死类名。
3. 不要修改宿主组件源码；用 CSS 覆盖 / DOM 观察 / 自有 overlay 实现。

---

## 1. 设计语言：Material 3 × Fluent 2

| 维度 | 采用 |
| --- | --- |
| 色彩 | M3 动态取色映射为 `--dsw-alias-*` 令牌，亮 / 暗双主题独立派生 |
| 材质 | Fluent 亚克力 / 云母：半透明底 + 噪声 + backdrop-filter 磨砂 |
| 形状 | M3 形状系统：14px 卡片圆角、10px 控件圆角、999px 药丸 |
| 深度 | 材质卡 + 分层阴影：`--liuli-shadow` 与品牌辉光 `--liuli-glow-brand` 叠加 |
| 动效 | Web `startViewTransition` 圆形遮罩 + 统一缓动曲线 |

---

## 2. 设计令牌

### 2.1 令牌分层

```
宿主语义层   --dsw-alias-*        （插件在 liuli-css.ts 中整体定义/覆盖）
插件外观层   --liuli-*            （圆角、材质、辉光等，运行时随设置覆盖）
宿主原始层   --dsw-specific-*     （少量专用令牌，由插件定义）
静态层       --dsw-static-*       （宿主静态色，仅在无法语义化时使用）
```

所有颜色必须走语义令牌；确需中性色时用 `color-mix(in srgb, var(--dsw-alias-brand-primary) N%, transparent)` 或 `rgba(var(--liuli-acrylic-rgb), a)`。**禁止**在组件里硬编码 `#0079bf`、`#fff` 这类字面量（终端黑底、错误红 `#e5484d`、diff 红绿除外，它们属于产品语义色）。

### 2.2 颜色令牌速查

**文字**（按优先级选）：

| 用途 | 令牌 |
| --- | --- |
| 主文字 | `var(--dsw-alias-label-primary)` |
| 次级文字 | `var(--dsw-alias-label-secondary)` |
| 三级/说明/时间 | `var(--dsw-alias-label-tertiary)` |
| 品牌前景（主按钮文字） | `var(--dsw-alias-label-primary-foreground)` |
| 反色文字 | `var(--dsw-alias-label-primary-inverted)` |

**描边**（越靠后越强）：

| 用途 | 令牌 |
| --- | --- |
| 卡片/分隔线/发丝线 | `var(--dsw-alias-border-l1)` |
| 输入框/菜单/次级描边 | `var(--dsw-alias-border-l2)` |
| 强描边/滑块轨道 | `var(--dsw-alias-border-l3)` |

**背景**：

| 用途 | 令牌 |
| --- | --- |
| 页面底色 / iframe 底 | `var(--dsw-alias-bg-base)` |
| 分层表面 | `var(--dsw-alias-bg-layer-1/2/3)` |
| 浮层/菜单实底回退 | `var(--dsw-alias-bg-overlay)` |
| 磨砂输入底（半透明） | `var(--dsw-specific-input-major)` |

**交互状态**：

| 状态 | 令牌 |
| --- | --- |
| 通用 hover | `var(--dsw-alias-interactive-bg-hover)` |
| 品牌 hover（工具球工具等） | `var(--dsw-alias-interactive-bg-hover-accent)` |
| 按下/选中 | `var(--dsw-alias-interactive-bg-active)` |
| 危险 hover | `var(--dsw-alias-interactive-bg-hover-danger)` |

**状态色**：

| 状态 | 令牌 |
| --- | --- |
| 成功 / 添加行 | `var(--dsw-alias-state-success-primary)` |
| 错误 / 删除行 | `var(--dsw-alias-state-error-primary)` |
| 警告 | `var(--dsw-alias-state-warn-primary)` |
| 业务/品牌信息 | `var(--dsw-alias-state-business-primary)` |

**品牌按钮**：

| 用途 | 令牌 |
| --- | --- |
| 主按钮实底 | `var(--dsw-alias-button-primary-fill)` |
| 主按钮 hover | `var(--dsw-alias-button-primary-hover)` |
| 品牌色文字/图标 | `var(--dsw-alias-brand-primary)` |

### 2.3 外观令牌

定义在 `liuli.css` / `liuli-css.ts` 的 `:root`，由设置页运行时覆盖：

| 令牌 | 默认值 | 说明 |
| --- | --- | --- |
| `--liuli-radius` | `14px` | 卡片 / 大面板圆角 |
| `--liuli-radius-sm` | `10px` | 控件 / 小卡 / 输入框圆角 |
| `--liuli-material-opacity` | `0.55`（暗色 0.5） | 亚克力底透明度 |
| `--liuli-material-blur` | `blur(18px) saturate(1.6)` | 标准磨砂 |
| `--liuli-material-blur-strong` | （运行时派生） | 强磨砂档，嵌套 backdrop 采样衰减场景 |
| `--liuli-acrylic-rgb` | 亮 `221,229,237` / 暗 `30,37,48` | 亚克力底色 RGB 三元组 |
| `--liuli-acrylic-rgb-low` | 亮 `232,238,244` / 暗 `26,32,42` | 工具条 / 分区头浅亚克力 |
| `--liuli-acrylic-rgb-high` | 亮 `200,212,223` / 暗 `63,74,92` | 高实亚克力 |
| `--liuli-control-rgb` | 亮 `210,220,230` / 暗 `51,61,78` | 控件底 |
| `--liuli-noise` | SVG feTurbulence dataURL | 材质噪声层 |
| `--liuli-glow-brand` | 品牌辉光阴影 | 卡片 / 主按钮常驻 |
| `--liuli-glow-brand-strong` | 更强辉光 | 主按钮 hover 等 |
| `--liuli-shadow` | `0 2px 10px rgba(0,0,0,...)` | 通用投影 |
| `--liuli-shadow-subtle` | `0 1px 3px rgba(0,0,0,0.08)` | 小卡 / 激活 chip 微投影 |
| `--liuli-text-depth` | 文字阴影 | 品牌标题立体感 |
| `--liuli-dock-padding` | 运行时（默认 8px） | 列留白 / 卡片间隙 |

### 2.4 亮暗双主题

- 亮色写在 `body`，暗色写在 `body[data-ds-dark-theme]`。
- 两套主题都要定义 `--liuli-acrylic-rgb*` 与 `--liuli-material-opacity`（暗色更透）。
- 记得写 `color-scheme: light / dark`，让原生控件（滚动条、input）跟随。
- 检测暗色用 `body[data-ds-dark-theme]`，不要用 `prefers-color-scheme`（主题由应用态决定）。

---

## 3. 字体与排版

### 3.1 字体族

| 令牌 | 用途 |
| --- | --- |
| `var(--dsw-font-family)` | 正文 UI |
| `var(--dsw-font-family-display)` | 标题 / 品牌字（`headline`、`brand`） |
| `var(--ds-font-family-code)` | 代码、路径、hash、数字输入、selector |

### 3.2 字阶（从组件实际使用归纳）

| 字号 | 行高 | 场景 |
| --- | --- | --- |
| 10px | 16px | 角标、badge、statTag |
| 11px | 16px | 辅助信息、代码块、diff、commit、time |
| 12px | 16–18px | 侧栏面板、工具按钮、菜单项、输入框、卡片正文 |
| 13px | 18–20px | 列表行、菜单项（右键菜单 14px 例外） |
| 14px | 22px | 设置行标题、Tab 文字、命令中心输入 |
| 20px | 28px | 空状态标题 |

### 3.3 通用规则

- 正文渲染：`body { text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }`（全局已有）。
- 代码类一律 `font-family: var(--ds-font-family-code)`，并配 `word-break: break-word / break-all` 防溢出。
- 数字（额度、统计）用 `font-variant-numeric: tabular-nums`。
- 单行截断三件套：

```css
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

- 多行截断（摘要、infoText）：

```css
display: -webkit-box;
-webkit-line-clamp: 2;
-webkit-box-orient: vertical;
overflow: hidden;
```

- 路径 / 面包屑末尾省略用 `direction: rtl; text-align: left` 保留文件名。

---

## 4. 圆角与间距

### 4.1 圆角阶梯

| 值 | 场景 |
| --- | --- |
| `999px` | 药丸：pill 按钮、badge、branchBadge、dragGhost、toast、chip |
| `var(--liuli-radius)` 14px | 卡片、面板、浮动窗口、弹层大卡 |
| `var(--liuli-radius-sm)` 10px | 输入框、小卡、菜单面板、工具栏按钮、行 hover |
| `8px` | chip、菜单项、图标小按钮、右键菜单项 |
| `7px` | 26px 图标按钮、浏览器 moreItem |
| `6px` | 18–22px 关闭/浮动小按钮、代码段底 |
| `4px` | 拖拽手柄指示条、frameGuide |
| `2px` | 细指示条、sash 手柄条 |

**规则**：越大越“卡”，越小越“控”。卡片永远用 14px 档（或按贴边规则某一侧归零），控件永远 7–10px 档，状态胶囊永远 999px。

### 4.2 间距

- 紧凑：`2px / 4px / 6px`（列表 gap、标签内 gap）
- 常规：`8px / 10px`（面板内留白、工具条 padding、卡片间隙）
- 宽松：`12px / 16px / 20px`（卡片内 padding、列留白、空状态）
- 列留白：`var(--liuli-dock-padding)`（运行时设置，默认 8px）；桌面 shell 表面卡片留白 16px。
- 相邻卡片间隙：各 16px 留白 → 可见 32px（`DockShellFrame` 的 `paneCard` 对齐此值）。

---

## 5. 材质配方（最核心）

### 5.1 标准亚克力卡片配方（`.panel` 配方）

适用于：`PreviewPanel.panel`、`DockWorkspace.pane / .floatWindow`、`DockShellFrame.paneCard / .floatWindow`、侧栏根、详情预览面板。

```css
.card {
  position: relative;
  z-index: 1;                 /* 自建堆叠上下文，防止 ::before z-index:-1 逃逸 */
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: var(--liuli-radius, 14px);
  background-color: transparent;
  background-image: none;
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow);
  overflow: hidden;
}

.card::before {
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
```

**为什么用 `::before` 而不是直接写在根元素**：根元素持有 `backdrop-filter` 会成为 `position: fixed` 后代的包含块，导致设置页全屏模态、菜单等被压缩进卡片。背景层放 `::before`，根只负责定位 / 圆角 / 阴影 / 裁剪。

### 5.2 简化亚克力配方（直接写在元素上）

适用于：**无 fixed 后代**的小卡、工具条、徽章按钮、hover 卡、信息卡。例：`TurnFileCard.root`、`FloatBall.toolbar / .infoCard`、`FileReviewPanel.sourceTrigger`、`LiuliAppearance.wallpaperBlock / .selector`。

```css
.el {
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity));
  background-image: var(--liuli-noise);
  -webkit-backdrop-filter: var(--liuli-material-blur);
  backdrop-filter: var(--liuli-material-blur);
  /* 需要时叠加描边 + 阴影 */
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--liuli-glow-brand), var(--liuli-shadow);
}
```

选择标准：

| 条件 | 配方 |
| --- | --- |
| 卡片内可能有 fixed 后代（模态、菜单） | 5.1 `::before` 配方 |
| 纯展示 / 无 fixed 后代的小卡、工具条 | 5.2 简化配方 |
| 菜单 / 对话框 / 嵌套浮层（backdrop 采样衰减） | 5.2 + `--liuli-material-blur-strong` |
| 会话 header / 正文滚动区双卡 | 根元素**禁止** backdrop-filter（会截断 composer 子卡磨砂采样），壁纸模糊由 `div[data-phase]::before` 独立层承担 |

### 5.3 Composer 输入卡特殊处理

输入卡自身移除 backdrop-filter，防止它成为子菜单 / 弹层的 backdrop root：

```css
[data-composer-card] {
  position: relative;
  isolation: isolate;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  background: transparent !important;
}
[data-composer-card]::before {
  /* 同 5.1 配方 */
}
```

### 5.4 磨砂档位

- 普通卡片 / 工具条：`var(--liuli-material-blur)`。
- 菜单、对话框、hover 卡等与背景之间隔了其它 backdrop 根的场景：`var(--liuli-material-blur-strong, var(--liuli-material-blur))`。
- 缩放性能护栏：`body[data-liuli-blur-off]` 会把两档都置为 `none`；**不要**在缩放期写全局 `transition: none`（会杀掉 TurnRail 刻度级联等装饰动画）。

---

## 6. 组件规范

### 6.1 按钮

#### 6.1.1 图标按钮（最常用）

参考：`PreviewPanel.stripBtn / .navBtn / .openBtn`、`WindowControls.btn`、`DockWorkspace.headerBtn`。

```css
.iconBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;          /* 或 28px、22px */
  height: 26px;
  border: none;
  border-radius: 7px;   /* 26px 用 7px；28px 可用 8px */
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.iconBtn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.iconBtn:disabled {
  opacity: 0.4;
  cursor: default;
}
```

尺寸对照：

| 尺寸 | 圆角 | 场景 |
| --- | --- | --- |
| 22×22 | 6px | 卡片内关闭 / 浮动按钮 |
| 26×26 | 7px | 标签条工具按钮、浏览器导航 |
| 28×28 | 8px | header 入口按钮、刷新按钮 |
| 34×24 | 8px | 窗口控制三键 |

#### 6.1.2 主动态（开关式按钮）

参考 `.stripBtnActive`、`.navBtnActive`、`.openBtnActive`、`.termBtn[data-active]`：

```css
.btnActive,
.btnActive:hover {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent);
  color: var(--dsw-alias-brand-primary);
}
```

#### 6.1.3 工具 / 描边按钮

参考 `DockWorkspace.toolBtn`、`FloatBall.tool`、`LiuliAppearance.selector`：

```css
.toolBtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--liuli-radius-sm, 10px);
  background: rgba(var(--liuli-acrylic-rgb), 0.45);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}
.toolBtn:hover {
  color: var(--dsw-alias-brand-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent);
}
```

#### 6.1.4 药丸小按钮

参考 `TurnFileCard.btn`（卡片内 “审查 / 打开 / 打开方式”）：

```css
.pillBtn {
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
  background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity));
  background-image: var(--liuli-noise);
  box-shadow: var(--liuli-shadow-subtle);
  font-size: 11px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.pillBtn:hover {
  background-color: rgba(var(--liuli-acrylic-rgb), calc(var(--liuli-material-opacity) + 0.15));
  color: var(--dsw-alias-label-primary);
}
```

#### 6.1.5 主按钮

参考 `liuli-css.ts` 侧栏新建会话按钮、`SidePaneExtraPanels.chatSend`：

```css
.primaryBtn {
  border: none;
  border-radius: var(--liuli-radius-sm, 10px);
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  box-shadow: var(--liuli-glow-brand);
}
.primaryBtn:hover {
  background: var(--dsw-alias-button-primary-hover);
  box-shadow: var(--liuli-glow-brand-strong);
}
.primaryBtn:disabled {
  opacity: 0.5;
  cursor: default;
}
```

#### 6.1.6 危险按钮

- 窗口关闭键 hover：`background: var(--dsw-alias-state-error-primary); color: #fff`。
- 标签关闭小按钮 hover：`background: rgba(229, 72, 77, 0.16); color: #e5484d`。
- 菜单危险项：`color: var(--dsw-alias-state-error-primary)`，hover 用 `--dsw-alias-interactive-bg-hover-danger`。

#### 6.1.7 焦点环

全局已有 `:focus-visible { outline: 2px solid color-mix(...brand 70%); outline-offset: 1px }`。组件内若自行 `outline: none`，必须补等价可见焦点（如输入框的品牌描边 + 光圈）：

```css
.input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
```

### 6.2 卡片

#### 6.2.1 区域大卡

会话 header、正文滚动区、侧栏根、详情预览面板、dock 面板 / 浮动窗口全部走 **5.1 标准亚克力配方**，且遵循贴边规则：

- 左贴边（详情列在左）：`margin-left: 0` 且左侧圆角归零。
- 右贴边（侧栏在右）：`margin-right: 0` 且右侧圆角归零。
- 下贴边：`margin-bottom: 0` 且底部圆角归零。
- 上边缘始终保留留白与圆角（对齐 `dshDesktopConversationSurface` 顶部）。

CSS Modules 内用 `edgeLeft / edgeRight / edgeBottom` 类；区域表面镜像用 `:global` + `!important` 覆盖宿主 surface padding（见 `DockShellFrame.module.css` 83–97 行）。

#### 6.2.2 内嵌小卡

参考 `TurnFileCard.root`、`PreviewPanel.emptyItem`、`RightSidebarPanels.wikiModule / .gitLog`、`SidePaneExtraPanels.devSection`：

- 圆角 `var(--liuli-radius-sm)`（10px），不参与贴边。
- 底色 `rgba(var(--liuli-acrylic-rgb), 0.35–0.5)` 或完整 5.2 配方，按“是否独立悬浮”决定。
- 内嵌卡之间 gap 4–8px；卡片内 padding 8–12px。

#### 6.2.3 消息气泡

- 用户 / 助手气泡圆角跟随 `var(--liuli-radius)`（可到 22px 药丸），文字颜色用 `--dsw-specific-bubble-fg`。
- 辅助对话面板内气泡：`max-width: 92%`，用户 `align-self: flex-end` + 品牌 12% 底，助手 `align-self: flex-start` + 亚克力底。

#### 6.2.4 卡片层次

同卡系内，子容器比父卡更实一档：父 `--liuli-material-opacity`，子（如 editor）`calc(var(--liuli-material-opacity) + 0.15)`，展开 / 激活卡同理 +0.15。

### 6.3 标签条与 Tab chip

参考 `PreviewPanel.tabStrip / .tab`、`DockWorkspace.tabStrip / .tabChip`：

- 标签条：高 **48px**，`padding: 0 12px`，`border-bottom: 1px solid var(--dsw-alias-border-l1)`，横向滚动隐藏滚动条。
- Chip：`flex: 1 1 156px; min-width: 64px; max-width: 156px; height: 28px; border-radius: 8px`。
- 常态：透明底 + `border: 1px solid transparent` + `color: label-secondary`。
- Hover：`border-color: border-l2` + `color: label-primary`。
- 激活：`border-color: border-l2` + `background: var(--dsw-specific-card-major)` + `box-shadow: var(--liuli-shadow-subtle)`。
- 关闭按钮 18×18，hover 危险红；浮动按钮 ⧉ 中性 hover。

### 6.4 输入框

参考 `PreviewPanel.browserInput / .responsiveInput`、`DockWorkspace.slotInput`、`RightSidebarPanels.searchBox`、`HistoryLoadRow.numInput`、`SidePaneExtraPanels.chatInput`。

**标准配方**：

```css
.input {
  padding: 5px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--liuli-radius-sm, 10px);
  background: var(--dsw-specific-input-major); /* 或 rgba(var(--liuli-acrylic-rgb), 0.45) */
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
  outline: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.input:focus {
  border-color: color-mix(in srgb, var(--dsw-alias-brand-primary) 70%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent);
}
.input:disabled { opacity: 0.55; cursor: default; }
```

- 搜索框 = 外框 + 内透明 `input`；外框负责描边圆角底。
- 数字输入：`text-align: right` + 代码字体 + 宽度固定（58–96px）。
- 地址 / 路径输入：代码字体。
- textarea（便签 / 导出 JSON / 聊天输入）：`resize: none`、代码或正文字体、10px 圆角、10px padding。

### 6.5 菜单与弹出层

**结构纪律**：

1. 凡是消息流 / 卡片里弹出的浮层，**必须** `createPortal(menu, document.body)` + `position: fixed`，按触发元素 `getBoundingClientRect()` 计算 `right/top`，下方空间不足翻转到上方（见 `TurnFileCard`）。
2. 菜单面板统一：

```css
.menu {
  position: fixed;
  z-index: 2147482500;
  min-width: 168–240px;
  padding: 4–6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--liuli-radius-sm, 10px) 或 12px;
  background-color: rgba(var(--liuli-acrylic-rgb), 0.92–0.96);
  background-image: var(--liuli-noise);
  -webkit-backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur));
  box-shadow: var(--liuli-shadow);
}
```

3. 菜单项：`display:flex; gap:8px; padding:6–8px 8–10px; border:none; border-radius:7–8px; background:transparent; font-size:12–13px; cursor:pointer; text-align:left`，hover `background: var(--dsw-alias-interactive-bg-hover)`，禁用 `opacity:0.45; cursor:default`。
4. 分组标题：`padding: 4px 8px; font-size: 12px; color: label-tertiary`；分隔线：`height:1px; margin:4px 6px; background: border-l1`。
5. **不要**在全局用 `div[class*="_menu"]` 一类的宽选择器给 menuWrap 套背景（已有误伤先例）；菜单背景规则只应命中真正的菜单面板，`menuWrap` 需要单独重置透明（见 `liuli-css.ts` 1586–1605 行）。

### 6.6 滑块、开关、下拉

- **滑块**：轨道用亚克力（`rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity))` + 噪声 + 磨砂），thumb 品牌色圆形 + `border: 2px solid var(--dsw-alias-bg-base)` + 品牌辉光；禁用 `opacity:0.4`。
- **开关**：40×22 药丸轨道，关 = `--dsw-alias-border-l3`，开 = `--dsw-alias-brand-primary`；knob 18×18 圆形，颜色用 `--dsw-alias-label-primary`（保证明暗都可见），`transform: translateX(18px)`。
- **下拉触发器**：胶囊形（`border-radius: 18px`），亚克力配方，`min-height: 36px; padding: 0 14px`；若会渲染 fixed 下拉菜单，触发器用简化配方即可（菜单 portal 到 body）。
- 原生 `select / input[type=checkbox]`：优先让宿主控件走令牌；checkbox 可用 `accent-color: var(--dsw-alias-brand-primary)`。

### 6.7 徽章与状态

| 类型 | 配方 | 示例 |
| --- | --- | --- |
| 品牌 badge | `border-radius:999px; border:1px solid color-mix(...brand 35%); background:color-mix(...brand 12%); color:brand` | `branchBadge`、`statTag`、`wikiFileLink` |
| 中性 badge | `border-radius:999px; border:1px solid border-l2; color:label-tertiary` | `fileHidden`、`subPreset`、`planGoalPhase` |
| 代码角标 | 6–7px 圆角，代码字体，浅底 | `commandShortcut`、`hotkey` |
| 状态点 | 8px 圆点；running 品牌色 + 脉冲，done 绿，error 红 | `trajDot` |
| Git 状态 | 代码字体 11px，按 status 换底/字色 | `gitStatus` |
| Diff 行 | add 绿底 14% + success 字；del 红底 13% + error 字；hunk 品牌底 12% + brand 字；meta 灰字 | `FileReviewPanel.diffLine` |

### 6.8 空状态

- 大空态：居中 flex，`gap: 4–12px; padding: 24px`，标题 14px 600，说明 12px `label-tertiary`。
- 虚线空卡：`border: 1px dashed var(--dsw-alias-border-l2); border-radius: var(--liuli-radius-sm); color: label-tertiary; padding: 12–16px; text-align: center`。
- 空态按钮列表（`PreviewPanel.emptyItem`）：48px 行高、12px 圆角、亚克力 0.5 底、hover `interactive-bg-hover`。

### 6.9 拖拽视觉与 sash

- **sash 零占位**：`flex: 0 0 0; width/height: 0; margin: 0`，用透明 `::after`（左右/上下各 4px）提供约 8px 命中区，hover/active 时 `::before` 显示品牌色手柄条。**不要**加正 / 负 margin 或 flex-basis（历史坑）。
- **拖拽落点指示**：`position: fixed; z-index: 2147482500; border: 2px solid brand; border-radius: 10px; background: color-mix(...brand 14–16%); box-shadow: 0 0 0 4px color-mix(...brand 10%)`，`pointer-events: none`。
- **拖拽幽灵**：药丸，`z-index: 2147482700`，品牌描边 + 阴影，`pointer-events: none`。
- **拖拽屏蔽层**：`position: fixed; inset: 0; z-index: 2147482600; background: transparent; cursor: grabbing`。
- **resize 手柄**：5px 宽命中区，hover/active 显示 1px 品牌线；`touch-action: none`。
- 拖拽期间目标 shard 禁用过渡：`.dockBody[data-resizing] .shard { transition: none }`（只禁 shard，不禁全局）。

### 6.10 滚动条、选中文本、焦点

全局统一（`liuli.css` / `liuli-css.ts`）：

- 滚动条：`scrollbar-width: thin; scrollbar-color: brand transparent`；WebKit 8px 宽、品牌 thumb、圆角、透明边。
- 选中文本：品牌色 24% 底。
- 焦点环：品牌 70% 描边 + 1px offset。

---

## 7. 动效规范

### 7.1 缓动与时长

| 场景 | 时长 | 缓动 |
| --- | --- | --- |
| 微交互（hover/active 色变） | 120–160ms | `var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1))` |
| 小入场（header 文本） | 300ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| 列表入场（treeitem / fileRow） | 450ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| 布局过渡（shard / 列宽） | 300ms | `var(--ds-ease-in-out, ...)` |
| 会话切换动画 | 200ms（级联 180ms） | `var(--ds-ease-in-out, ...)` |
| 主题圆形遮罩 | 500ms | `cubic-bezier(0.4, 0, 0.2, 1)` |

### 7.2 Keyframes 命名

- 所有插件 keyframes 用 `liuli-` 前缀：`liuli-treeitem-rise`、`liuli-header-text-rise`、`liuli-enter-*`、`liuliSpin`、`liuliPulse`、`liuli-vt-circle-reveal`。
- 级联动画用长属性拆分（`animation-duration / timing-function / delay / fill-mode` 分开写），避免 `animation` 简写内嵌 `var()` 的解析风险。

### 7.3 无障碍

- 所有动画都要配 `@media (prefers-reduced-motion: reduce) { animation: none; transition: none; }`。
- 触屏无 hover（`@media (hover: none)`）时，悬停展开类信息要直接展开（见元素引用卡详情）。

### 7.4 性能护栏

- 缩放期间：`body[data-liuli-resizing]` 用于 JS 让位；`body[data-liuli-blur-off]` 关磨砂。
- **禁止**全局 `* { transition: none !important }` 一刀切——会杀掉 TurnRail 刻度级联等装饰过渡；需要禁过渡时精确到 `.shard` 等目标元素。
- 长对话：`[data-chat-flow] > * { content-visibility: auto; contain-intrinsic-size: auto 300px }`（已有）。

---

## 8. Z-index 分层表

新增浮层必须从表中选档，不要随手写 9999：

| 层级 | z-index | 用途 |
| --- | --- | --- |
| 宿主手柄层 | 50–60 | 详情拖拽手柄、sash、窗口控制 |
| 命令中心 / 文件对话框 | 1400 / 1500 | `RightSidebarPanels.commandOverlay`、`PreviewPanel.fileDialogOverlay` |
| 工作台全屏层 | 2147482000 | `DockWorkspace.layer` |
| 浮动窗口 | 2147482400 | `.floatWindow` |
| 布局菜单 | 2147482450 | `DockShellFrame.menuCard` |
| **标准弹出层** | **2147482500** | 右键菜单、TurnFileCard 打开方式菜单、dropIndicator |
| 拖拽屏蔽层 | 2147482600 | `.dragShield` |
| 拖拽幽灵 | 2147482700 | `.dragGhost` |
| 模态遮罩 | 2147482800 | `.modalOverlay` |
| Toast | 2147482900 | `.toast` |
| 悬浮球根 / 设置提示 | 2147483000 | `FloatBall.root`、`LiuliAppearance.tipPortal` |
| 拾取 hover 卡 | 2147483100 | `FloatBall.hoverCard` |
| 拾取结果卡 | 2147483200 | `FloatBall.infoCard` |

原则：普通弹出层一律 2147482500；比它更“系统级”的（工作台、悬浮球、拾取）才用 2147482xxx 高位段；宿主层保持 50–60。

---

## 9. CSS 组织与选择器纪律

### 9.1 组件样式走 CSS Modules

- 组件私有类：`*.module.css`，`className` 引用，不手写全局类。
- 需要命中宿主元素时在模块内用 `:global(...)`，并收窄到具体组件：

```css
/* 正确：限定宿主具体类名 */
:global(.dshDesktopResizeHandle[data-side="details"]) { display: none !important; }

/* 错误：太宽，会误伤 dock-shell 的 sash */
:global(div[data-side="details"]) { display: none; }
```

### 9.2 全局覆盖选择器

宿主哈希类名规则：构建产物形如 `<hash>_<local>`。匹配用：

- `[class*="_local"]`：子串匹配，命中含该 local 的类；注意会误伤 `_localLabel` 之类兄弟（需补 `:not([class*="_localLabel"])`）。
- `[class$="_local"]`：后缀匹配，精确命中该 local 本身；在“类名本身”足够时优先用。
- **data 锚点优先**：宿主提供 `data-testid / data-*` 时优先用（如 `[data-testid="todo-panel"]`、`[data-goal-bar]`），比哈希类名稳定。

### 9.3 `!important` 使用条件

- 仅在覆盖**宿主同特异性或更高特异性**规则时使用；插件内部模块 CSS 之间不要用 `!important`。
- 使用后写注释说明为什么压不过（如 `DockShellFrame.module.css` 中覆盖宿主 surface padding 的说明）。
- 镜像类规则（如 `data-edge-left`）注意特异性计算：先 grep 是否已有 `[data-side]` / `[class*="_detailsCol"]` 等宽选择器会互相误伤。

### 9.4 命名

- 类名：驼峰（CSS Modules），模块内顺序按组件结构从上到下。
- 状态类：`active / open / dragging / hidden / inactive` 等语义名，配合 `data-*` 属性（如 `data-dragging`、`data-snapped`）供 JS 切换。
- 贴边类：`edgeLeft / edgeRight / edgeBottom`。

---

## 10. 新组件落地 Checklist

写任何新 UI 前逐项核对：

- [ ] 颜色全部走 `--dsw-alias-*` / `--liuli-*` 令牌，无硬编码色值
- [ ] 圆角使用 `--liuli-radius` / `--liuli-radius-sm` / 8px / 999px 阶梯
- [ ] 卡片按 5.1 / 5.2 选择正确材质配方（检查是否有 fixed 后代）
- [ ] 按钮有 hover / active / disabled / focus-visible 四态
- [ ] 输入框有 focus 品牌描边 + 光圈
- [ ] 菜单浮层走 body portal + fixed + z-index 2147482500
- [ ] 亮暗双主题下检查（`body[data-ds-dark-theme]`）
- [ ] 长文本有截断或换行策略
- [ ] 动画配 `prefers-reduced-motion` 降级
- [ ] 若为全局样式：同步 `liuli.css` 与 `liuli-css.ts`
- [ ] 新增文案同步 `locales.ts`（zh/en 键完整）
- [ ] 新踩坑写入 `AGENTS.md`「关键避坑」

---

## 11. 文件索引

| 关注点 | 文件 |
| --- | --- |
| 设计令牌 / 亮暗主题 / 全局覆盖 | `src/client/liuli.css`、`src/client/liuli-css.ts` |
| advanced 无边框模式差异 | `src/client/index.ts`（`DESKTOP_ADVANCED_CSS`） |
| 卡片配方母版 | `src/client/PreviewPanel.module.css`（`.panel`） |
| 标签条 / Tab chip 母版 | `src/client/PreviewPanel.module.css`（`.tabStrip` / `.tab`） |
| 工作台卡片 / 工具按钮 / 拖拽视觉 | `src/client/DockWorkspace.module.css` |
| 零侵入 dock 布局 / 贴边镜像 / sash | `src/client/DockShellFrame.module.css` |
| 悬浮球 / 工具面板 / 拾取卡 | `src/client/FloatBall.module.css` |
| 窗口控制按钮 | `src/client/WindowControls.module.css` |
| 轮次刻度 / 胶囊 | `src/client/TurnRail.module.css` |
| 文件变更卡 / 药丸按钮 / 右键菜单 | `src/client/TurnFileCard.module.css` |
| 侧栏面板（搜索 / 列表 / 命令中心） | `src/client/RightSidebarPanels.module.css` |
| 审查面板（源切换 / diff / 右键菜单） | `src/client/FileReviewPanel.module.css` |
| 设置页控件（滑块 / 开关 / 选择器 / 壁纸） | `src/client/LiuliAppearance.module.css` |
| 设置行（Appearance / 历史加载 / 重试） | `src/client/LiuliAppearanceRow.module.css`、`HistoryLoadRow.module.css`、`ModelRetryRow.module.css` |
| 终端 / 轨迹 / 画板 / 计划 / 辅助对话 | `src/client/SidePaneExtraPanels.module.css` |
| 工作台面板内容 | `src/client/dock-panels.module.css` |
