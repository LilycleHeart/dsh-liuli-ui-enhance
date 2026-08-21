# AGENTS.md — dsh-liuli-ui-enhance 开发指导

本文件为在本仓库内工作的 AI Agent / 开发者提供上下文、命令、约定与避坑指南。
在改动代码前先读 `README.md`（项目概览）、`docs/features.md`（完整功能清单与设计语言）和 `docs/install.md`（完整安装说明）。

## 项目是什么

`dsh-liuli-ui-enhance` 是 DeepSeek Harness (DSH) 的 **Material Design 3 × Fluent 2 融合主题**插件，采用 DSH 官方插件扩展点挂载，不改任何宿主组件源码。它同时包含：

- **node 半（Host 半）**：`src/index.ts` 等，注册 `/liuli-quota`、`/preview`、`/liuli-sidebar/*`、`/liuli-window` 等 Host 路由。
- **浏览器半（Client 半）**：`src/client/*`，注入 CSS、设置页、header 组件、右侧边栏、Dockable 工作台、悬浮球、内嵌浏览器等 UI 能力。

## 技术栈与构建

- TypeScript（strict），ESM，React 18，CSS Modules
- 构建：`tsc` 生成类型 → `tsdown` 打包 `lib/index.js`（node 半）与 `lib/client.js`（浏览器半）
- 包入口：`exports["."]` 指向 node 半；`exports["./client"]` 指向浏览器半
- 纯逻辑模型（如 `dock-model.ts`）可用 Node 直接跑 TS 单测，无需构建

### 常用命令

```bash
pnpm install          # 自动触发 prepare：tsc + tsdown，生成 lib/
pnpm build            # 手动完整构建（tsc + tsdown）
pnpm watch            # tsdown watch，开发时热重建 client bundle
pnpm install:desktop  # 打包 tarball 并安装到 DSH Desktop profile（推荐安装方式）
pnpm install:desktop:npm  # 从 npm 安装到 desktop profile
pnpm patch:desktop    # 给 DSH Desktop 打 win32 无边框宿主补丁
```

### 测试 / 自检

```bash
# dock-model 纯逻辑单测（不需要浏览器/DSH）
node demo/test-dock-model.ts

# 单项 GUI / 行为验证（多数需要已安装并运行的 DSH Desktop 或 dev server）
node demo/verify-dock-gui.mjs
node demo/verify-dock-shell-gui.mjs
node demo/verify-webview.mjs
node demo/verify-webview-gui.mjs
node demo/verify-all.mjs   # 重启后一次性验证：Host 路由 + 引擎 A-suite + GUI B-suite
```

`demo/` 下还有音频、动画、悬浮球、设置延迟等验证脚本；改到对应模块时先运行相关脚本。

## 目录速览

```
src/
  index.ts                 # node 半入口：Host 路由（额度/预览/侧栏/窗口/浏览器引擎等）
  browser-engine.ts        # 内嵌浏览器引擎（CDP / Electron / Web 回退）
  host-audio.ts            # Electron 系统回环音频授权
  host-window.ts           # Electron 窗口控制（最小化/最大化/关闭/托盘）
  liuli-settings.ts        # 20 项设置 schema 与默认值
  invariant.ts             # 包级 invariant 伴生（无运行时检查）
  vendor/                  # vendored material-color-utilities（勿随意改动）
  client/
    index.ts               # 浏览器入口：CSS 注入、事件桥、header slots、悬浮球等
    liuli.css              # 主题令牌与全局覆盖样式源
    liuli-css.ts           # liuli.css 的字符串化拷贝（运行时注入用）
    dock-model.ts          # Dockable 布局纯函数模型（有单测）
    DockWorkspace.tsx      # 全屏 Dockable 工作台
    dock-shell-frame.tsx   # advanced 模式下将宿主三列布局改造为 dockable
    PreviewPanel.tsx       # 右侧边栏 / 标签面板主壳
    RightSidebarPanels.tsx # 文件树 / Git / Wiki 等标签内容
    SidePaneExtraPanels.tsx
    FileReviewPanel.tsx    # 审查文件面板
    HeaderEffects.tsx      # 声纹 / 主题切换 / header 拉伸等
    FloatBall.tsx          # 悬浮工具球
    TurnRail.tsx           # 对话轮次刻度侧边栏
    element-picker.ts / element-card.ts  # 元素选择器与引用卡片
    locales.ts             # 中英文案（键集完整性互检）
    *.module.css           # 各组件 CSS Modules
scripts/
  tsdown.client.ts         # clientBundle 预设（CSS 内联、purity gate、banner/footer）
  install-desktop.mjs      # 安装到 DSH Desktop profile
  patch-desktop-frameless.mjs
  browser-client.mjs       # 内嵌浏览器 agent 自动化 CLI（对应 docs/browser-use.md）
demo/
  test-dock-model.ts       # dock-model 单测
  verify-*.mjs             # 行为 / GUI 验证脚本
  server.mjs / cdp-run.mjs # 本地测试辅助
skills/
  control-browser/SKILL.md # 控制内嵌浏览器的 agent skill
docs/
  features.md            # 完整功能清单、设计语言、限制（详细文档主入口）
  install.md             # 安装、构建、目录结构、避坑（详细文档主入口）
  browser-use.md         # 浏览器 agent 自动化用法
  sidebar-comparison.md
```

## 开发约定

1. **`src/` 是唯一源码真相**，`lib/` 是构建产物且被 `.gitignore` 忽略；永远不要手改 `lib/`。
2. 所有新功能优先挂载官方已有扩展点：
   - header 组件挂在 `dsh-client-ui-conversation` 的 `actions` / `utilities` slot；
   - 侧栏面板占用 `dsh-client-ui-layout` 的 `details` 列（`priority: -1`）；
   - 外观主题事件走 `dsh-client-ui-theme` 的 `liuli:set-theme` + `startViewTransition` 圆形遮罩；
   - Host 路由注册在 node 半，用 `/liuli-*` 前缀，避免与官方路由冲突。
3. 不要修改宿主组件源码；能用 CSS 覆盖 / DOM 观察 / 自有 overlay 实现的就优先这样做。
4. 新增 UI 文案必须同时维护 `locales.ts` 的 zh/en 键，保证键集完整。
5. 新增设置项要同步 `liuli-settings.ts` 的 schema/默认值，并在 `docs/features.md` 功能表与 README 概览 / 设置分区文案中体现。
6. 纯逻辑尽量抽成无副作用函数（参考 `dock-model.ts`），并在 `demo/test-dock-model.ts` 补单测；Node 直接跑 TS 即可。
7. 改动 Dockable / dock-model 后至少跑 `node demo/test-dock-model.ts` 和相关 GUI 验证脚本。
8. 改动内嵌浏览器能力后同步更新 `scripts/browser-client.mjs` 与 `docs/browser-use.md`，并运行 `demo/verify-webview*.mjs`。
9. 提交前运行 `pnpm build` 确认类型与打包通过；不要提交 `.tmp-*`、截图探针等调试产物。
10. 注释和文档保持简体中文，与仓库现有风格一致。
11. 完成功能并 `pnpm build` 通过后，**自动执行 `pnpm install:desktop`** 安装到 DSH Desktop profile，不再询问用户；安装后不需要重启 DSH Desktop。

## 关键避坑

- **安装到 DSH Desktop 不要用 `pnpm link`**：link 不会安装插件自身 dependencies，会报 `Cannot find package 'iconv-lite'`。用 `pnpm install:desktop` 或 `node scripts/install-desktop.mjs`。
- **`pnpm install:desktop` 后不需要重启 DSH Desktop**：插件安装到 profile 后刷新页面即可加载新 bundle；不要主动 kill/restart DSH Desktop，重启会让 Web 端口变化并打断运行中的调试。可验证：安装后直接刷新页面观察新样式/行为。
- **agent 执行 `pnpm install:desktop` 后客户端可能不自动热重载，且不要用 HMR 注释 hack 强制热重载**：`install-desktop.mjs` 本身不触发 reload，HMR 只在 client bundle 内容 rev 变化时广播；若安装过程未让 DSH 的 `client-hmr` 检测到变化（或用户没手动刷新），界面仍是旧 bundle。曾用“向 profile 已安装的 `node_modules/dsh-liuli-ui-enhance/lib/client.js` 末尾追加一行注释”强制触发 `rebuilt`，实测**每次 HMR 热替换后琉璃客户端会不响应请求**，属于不安全路径。正确做法：安装后让用户手动刷新页面（或整页重载），不要改仓库 `lib/`、不要追加注释触发 HMR。
- 只改 desktop profile 的 `cordis.patch.yml` 不够，必须同时把 `dsh-liuli-ui-enhance` 写进该 profile 的 `package.json` dependencies。
- 隐藏原生标题栏需要额外执行 `pnpm patch:desktop`；插件只能提供页面内窗口按钮，不能从渲染进程隐藏原生标题栏。
- DSH Desktop 每次重启 Web 端口会变，`localStorage` 按 origin 隔离；设置跨重启保留依赖 Host 端 `~/.liuli-theme/settings.json` 同步。
- `/liuli-sidebar/*`、`/preview`、`/liuli-proxy` 等路由默认只接受 loopback / 同源 Host；局域网部署需额外配置信任域名。
- 声纹监听只捕获系统音频：Web 端靠 `getDisplayMedia`（共享整个屏幕 + 分享系统音频）；Electron Desktop 端由 Host 安装 `setDisplayMediaRequestHandler` 直接授予 `audio: 'loopback'`（Windows-only）。
- `liuli.css` 与 `liuli-css.ts` 是同一份样式的两个载体，改 CSS 源后需要同步字符串化拷贝（构建/脚本处理；不要只改其中一个）。注意历史遗留：当前 `liuli.css`（712 行）与 `liuli-css.ts` 内嵌字符串（1551 行）并不完全一致，运行时注入以 `liuli-css.ts` 为准；后续若以 `liuli.css` 为源，需先补齐同步。
- vendored `src/vendor/material-color-utilities.js` 是上游库，除非有明确目的否则不要改动。
- **项目改名后执行 `pnpm install:desktop` 会追加新注册而不是替换旧注册**：安装器只按当前包名（如 `dsh-liuli-ui-enhance`）检测 profile，旧 `id: liuli-theme` / `@deepseek-ai/liuli-theme` 不会被识别为已注册，会在 `cordis.patch.yml` 追加新 insert 块并在 `package.json` dependencies 增加新包；彻底迁移需手动删除 profile 中的旧依赖与旧 insert 块，再执行 `pnpm install`。
- **批量清理品牌词时不要只做机械替换**：复合品牌词会被替换成生造词，参考来源词会被错误归属到宿主名；需要二次替换为「琉璃」「参考实现源码」等中性词，并在 `pnpm build` 前搜索旧词残留确认无残留。
- **长对话拖 sash / 缩放窗口掉帧的元凶是宿主产物行 RO，不是琉璃布局代码**：`@deepseek-ai/dsh-client-ui-deliverables` 给每个产物行（`[data-produced-files-row]`）注册 ResizeObserver，回调内 `getComputedStyle`+多次 `getBoundingClientRect`+`textContent` 写入反复强制全量回流；列宽逐帧变化时每帧 O(产物行数) 次回流（实测 48 步拖拽主线程 10.2s）。正确做法：缩放开始冻结产物行宽度使宿主 RO 不触发、结束后分批解冻（`resize-perf.ts`，勿直接改宿主源码）；排查此类问题用 `demo/inspect-sash-perf.mjs`（RO 归因 + 分相位长任务）定位，勿凭猜测加 `content-visibility`。
- **磨砂 backdrop-filter 缩放期不能直接 `none` 硬切也不能 JS 每帧改变量硬渐变**：硬切会「突然消失」被用户吐槽；但 JS 每帧改写 body 自定义属性会触发全量子树样式失效、反而在按下时新增 ~240ms 尖峰。现行折中：rAF 缓动到恒等滤镜（~140ms）即挂 `body[data-liuli-blur-off]` 让 CSS 的 `none` 无缝接管，松手反向渐回；同时磨砂层相关 RO/遮挡检测（WindowControls/TurnRail/HeaderEffects mask）在缩放期让位。
- **dock-shell 固定区域 sash 拖拽直写 flex-basis 时必须与提交目标同 clamp**：`beginSash` 的 sidebar 分支曾只写 `newSize` 无 clamp，鼠标拖出窗口时侧栏宽度可为负/超过容器，与 `onUp` 提交的 `hostLayout.setSidebar`（宿主 clamp 264..420）不一致；拖拽直写路径（DOM 直改）不受模型 `resizeSplitTo`/宿主管束，任何分支都要显式 clamp（现在 sidebar 用 `SIDEBAR_MIN/MAX`，details 用 `clampDetailsWidth`）。details 的上限不能只看视口 88%，还要保证「侧栏 + 会话最小 480 + 详情」不超视口，否则大屏上 88% 会把右缘推出视口（现象：details 面板 `rect.width` 2000+，按钮超出视口外）；另外 localStorage 恢复 `liuli:details-width` 的路径也必须过同一个 clamp，否则旧脏值刷新后仍超。改这里时先跑 `pnpm build`，再在 advanced 模式拖左右两侧 sash 验证边界。
- **给 dock-shell sash 设置 `data-side="details"` 会被 PreviewPanel 的全局 CSS 隐藏**：`PreviewPanel.module.css` 原本写 `:global(div[data-side="details"]) { display:none }` 想隐藏宿主 `.dshDesktopResizeHandle[data-side="details"]`，但选择器太宽会误伤 dock-shell 里 `data-side="details"` 的 sash（现象：修正 data-side 语义后详情 sash 消失）。正确写法是 `:global(.dshDesktopResizeHandle[data-side="details"])`；给任何元素加 `data-side` 前先 grep 是否有宽泛的 `[data-side]` 选择器。
- **dock-shell sash 不要占布局宽度**：`DockShellFrame.module.css` 的 `.sashH/.sashV` 曾写 `flex: 0 0 8px; margin: 0 -4px`（负 margin 让 8px 命中带骑进相邻容器，用户会看到手柄“进入对话页/别的容器”）；后改成 `flex: 0 0 4px` 仍会被报「左右容器隔得太宽」。最终方案：`flex: 0 0 0; width/height: 0; margin: 0`，布局上容器紧贴无常态缝，用透明 `::after`（左右/上下各 4px）提供约 8px 命中区。改 sash 时保持“零占位 + 伪元素命中区”，不要再加正/负 margin 或 flex-basis。
- **拖走详细页后右侧又自动长出一个详细页**：DockShellFrame 的 details 同步 effect 在 `hostPanels.details>0` 且树里没有 `region:details` 时会 `withRegion` 自动补挂到右缘；用户主动把详情拖去浮动/其他位置时，宿主 details 仍开着，于是被重新补挂。修复：`detailsTornOut` ref 标记用户主动拖走详情（`beginDrag` 移动节点前 + `floatPanelCentered` 里，若移动的是 `REGION_DETAILS` 就置位）；同步 effect 看到该标记跳过补挂；`hostPanels.details===0` 时清标记，之后重新 openDetails 仍可补挂。
- **详情列收起后仍露出 32px“边”**：details surface 是 `box-sizing: content-box`，DockShellFrame 给中间态详情 surface 设了 `padding-left/right: var(--liuli-dock-padding)`；当 shard 宽 0 时，content 宽 0 + 左右 padding = 32px 的可见区域。修复：DockShellFrame.module.css 里所有详情 surface 的左右/底部 padding 规则都加 `.dshDesktopFrame:not([data-details-collapsed])` 前缀，并单独给 `[data-details-collapsed]` 设 `padding: var(--liuli-dock-padding,8px) 0 0 0 !important`。验证：导入嵌套 split 布局后 closeDetails，`[data-dock-node]` 详情 rect 宽度应为 0。
- **dock 非区域面板/浮动窗口要做成与对话页、左侧边栏一致的卡片材质**：`DockWorkspace` 的 `.pane/.floatWindow` 与 `DockShellFrame` 的扩展面板（`css.paneCard`）都不要再写 `background: rgba(var(--liuli-acrylic-rgb), …)` 实底，而要沿用 `PreviewPanel.module.css` 的 `.panel` 配方：容器 `position: relative; z-index: 1; border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--liuli-radius, 14px); background-color: transparent; background-image: none; box-shadow: var(--liuli-glow-brand), var(--liuli-shadow); overflow: hidden`，再加 `::before { content:''; position:absolute; inset:0; z-index:-1; border-radius:inherit; background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55)); background-image: var(--liuli-noise); -webkit-backdrop-filter/backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)); pointer-events:none }`。DockShellFrame 默认三区域仍用 `dshDesktop*Surface` 原生表面类（零侵入），仅非区域面板加 `css.paneCard`。标签条也对齐右侧边栏：`.tabStrip` 高 48px、`padding: 0 12px`、`border-bottom: 1px solid var(--dsw-alias-border-l1)`；`.tabChip` 用 `flex: 1 1 156px; min-width: 64px; max-width: 156px; height: 28px; border-radius: 8px; border: 1px solid transparent`，激活态用 `--dsw-specific-card-major` 底 + `--liuli-shadow-subtle`；卡片面板 `.paneBody` 加 10px 留白让亚克力材质透出。卡片与相邻表面卡片的间隙按桌面 shell 表面 padding 对齐：`.paneCard` 加 `margin: var(--liuli-dock-padding, 8px)`（`dshDesktopConversationSurface` 内卡留白就是同一个 `--liuli-dock-padding` 变量，不要硬编码 16px；相邻两卡可见间隙为 2×变量值）。贴住画布边缘的卡片要镜像桌面 shell 的贴边直角 + 无外侧留白：`dock-shell-frame.tsx` 不再用 split 结构猜边缘，而是 `useLayoutEffect` + `ResizeObserver`/`transitionend` 实测每个 pane 所在 shard 与 `dockBody` 的矩形，算出 `left/right/top/bottom` 写进 `edgeMap`；给 `paneCard` 只追加 `edgeBottom`（上下堆叠中的下方卡片：`margin-bottom:0` + 底部两角直角）；普通面板左右上三边永远留白+圆角。注意 shard 的 flex-basis 有 0.3s 过渡，布局树切换后 root 尺寸不变、RO 不触发，必须监听 `transitionend` 在过渡结束后重算，否则边缘标记停留在过渡中间态。区域表面按规范：`renderTabsNode` 给区域 pane 挂 `data-edge-left/right/bottom` 和 `data-has-below`；侧边栏左/右边缘贴边去圆角，中间四边留白+圆角；详细页同侧边栏，并额外在下方无卡片时底部触底去圆角；侧栏在右时对内卡加 `direction: rtl` 让内部元素也镜像；对话页在上下堆叠且下方有卡片时，用 `.dshDesktopConversationSurface[data-has-below] [data-conversation-scroll]` 撤销全局 active 的底部触底规则（恢复 `border-bottom-*-radius: var(--liuli-radius)` 和 `margin-bottom: 0`）。`DockShellFrame.module.css` 里用 `:global` 覆盖宿主 surface padding（详情在左 `padding: var(--liuli-dock-padding,8px) var(--liuli-dock-padding,8px) 0 0 !important`、侧栏在右 wrapper `padding: var(--liuli-dock-padding,8px) 0 var(--liuli-dock-padding,8px) var(--liuli-dock-padding,8px) !important`，同样不要硬编码 16px），侧栏内卡圆角 `14px 0 0 14px`。注意详情内卡圆角不能在模块 CSS 里赢：`index.ts` 注入的 advanced CSS 有 `body[data-dsh-desktop-mode="advanced"] [class*="_detailsCol"] [data-preview-panel] { border-radius: var(--liuli-radius,14px) 0 0 0 !important }`（特异性 0,3,1），必须在同一注入段追加 `body[data-dsh-desktop-mode="advanced"] .dshDesktopDetailsSurface[data-edge-left] [data-preview-panel] { border-radius: 0 var(--liuli-radius,14px) 0 0 !important }`（特异性 0,4,1）才能镜像成左上直角、右上圆角。
- **缩放护栏 `data-liuli-resizing` 卡住会让 TurnRail 级联消失**：窗口 resize 事件会突发连发，`installResizePerfWatcher` 曾每次 `resize` 都 `beginResizePerf()` 但 settle 定时器只有一个 → depth 只增不减、body 标记卡住 15s（兜底才清）；卡住期间任何 `body[data-liuli-resizing] * { transition:none }` 都会永久杀掉 tick 的 opacity/transform 过渡，级联消失。修复：window resize 路径用 `windowResizeActive` 幂等配对（只在首次 begin、settle 后 end 一次）；验证 `node demo/inspect-resize-leak.mjs`。
- **缩放期禁用过渡不要用 `* { transition: none !important }` 一刀切**：它会把 TurnRail 刻度级联消失（`.tick` 的 opacity/transform 过渡 + `transitionDelay`）等装饰过渡一并杀掉；shard 宽度过渡已有 `DockShellFrame.module.css` 的 `.dockBody[data-resizing] .shard { transition:none }` 专门处理，无需全局杀。新增任何全局 `transition:none` 前先确认不误伤 tick/胶囊等装饰动画。
- **TurnFileCard「打开方式」菜单曾被父容器裁剪**：菜单原为 `.menuWrap` 内 `position:absolute`，卡片/消息容器链上的 `overflow:hidden` 或 `backdrop-filter` 会把它裁掉，弹不出去。正确做法：菜单用 `createPortal(menu, document.body)` + `position:fixed`，打开时按 `menuWrap.getBoundingClientRect()` 计算 `right/top`（下方空间不足则翻转到按钮上方），并给菜单面板单独 ref 用于点击外部关闭；`z-index` 用 2147482500 一档。以后凡是在消息流里弹出的浮层都应走 body portal + fixed。
- **元素选择器序列化文本要把 `rect` 放在长 `selector` 之前**：`formatSelection` 生成的 `selector` 是 CSS Modules 全路径、通常很长；会话列表预览/消息气泡按长度截断时，用户会以为「元素选择器没有返回 rect」（现象：预览只看到 `[selected element] <tag>` 和 `selector:` 开头）。正确顺序：`[selected element] <tag>` → `rect:` → `selector:` → 其它字段；解析端 `element-card.ts` 按行读取不依赖顺序，但详情卡展示顺序也应同步 rect 在前。验证：`node demo/test-element-picker.ts`（新/旧顺序都能解析）。
- **`div[class*="_menu"]` 会误伤文件行的 `menuWrap` 小容器**：全局菜单背景规则（70% 半透明 + 噪声 + 磨砂）用 `div[class*="_menu"]` 选择器，而 TurnFileCard 的 `.menuWrap` 类名含 `_menu`，会被套上一个「灰色半透明方框」包住「打开方式」SVG 图标。正确做法：给 `[class*="_fileRow"] [class*="_menuWrap"]` 单独重置 `background-color/background-image/backdrop-filter` 为透明/无；不要去掉 `div[class*="_menu"]` 这个全局规则（真正的菜单面板还需要它）。验证：打开「本轮修改」卡片看「打开方式」图标旁不再有灰框。

## 踩坑自动写入（强制约定）

凡是在本仓库开发、调试、安装或验证过程中**新踩到的坑 / 新排查结论**，必须自动追加到本文件的「关键避坑」列表，不要只留在对话或临时笔记里。

追加时保持简洁，推荐格式：

```markdown
- **现象一句话**：原因说明 + 正确做法/解决办法 + 可验证命令或检查点。
```

要求：

1. **遇到即写**：问题解决后、提交代码前，把新坑追加到「关键避坑」。
2. **可复现**：写明触发条件、报错关键字或验证方式，让后续 Agent 能快速判断是否已踩过。
3. **避免重复**：先搜索「关键避坑」是否已有同类条目；已有则补充细节，不新增重复条目。
4. **同步文档**：若该坑涉及安装流程、命令或功能行为，同时更新 `README.md` / `docs/` 对应章节（详细内容优先更新 `docs/features.md` 或 `docs/install.md`）。
5. **不要删历史坑**：旧坑即使暂时不适用，也保留；如确实过时，可标注“已解决/已废弃”而不是直接删除。

## 完成一项功能时的收尾清单

- [ ] `pnpm build` 通过
- [ ] 相关 `demo/verify-*.mjs` / `demo/test-dock-model.ts` 通过
- [ ] `locales.ts` zh/en 键完整
- [ ] `docs/features.md` 功能表 / README 概览 / 文档已同步
- [ ] 本次新踩到的坑已写入 AGENTS.md「关键避坑」
- [ ] 未提交 `lib/`、`.tmp-*` 等产物
