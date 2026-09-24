# 交互动效核对表

本表按用户能看见的**状态变化**核对。连续输入（打字、滚动、拖动中的指针/面板几何、裁剪选区）应即时跟手；在释放、打开、关闭、切换或选中时提供短过渡。`prefers-reduced-motion: reduce` 与“会话切换动画＝关闭”是用户主动选择的例外。

验收范围是 **Liuli 绘制的控件、Liuli 接管的官方侧栏，以及这些入口触发的可见状态变化**。宿主自行管理生命周期的全局 Menu、Modal、Tooltip 在表中作为外部依赖单列；我们可覆盖入场样式，但退场需要宿主组件支持延迟卸载，不能把插件 CSS 当作退场已完成的证据。官方 Toast 源码已有定时淡出。

符号：`✓` 源码已有过渡；`△` 只覆盖一部分；`×` 缺口；`—` 无这种状态或连续操控应即时跟手。四列依次区分悬停/按压、打开入场、选中/布局状态变化、关闭退场。源码覆盖与运行验收分开记录；未触发的操作不能仅凭 CSS 推断视觉效果。

| 区域与操作 | 悬停/按压 | 入场 | 状态变化 | 退场 | 源码证据 / 剩余缺口 |
| --- | --- | --- | --- | --- | --- |
| 会话切换、新消息、辅助对话与 `/btw` 新块 | — | ✓ | ✓ | — | `liuli-transition.ts`、`chat-flow-view.tsx`、`liuli-css.ts`、`BtwAnswer.module.css`；不同长度会话待实测 |
| 左侧会话树新行、标题变化 | △ | ✓ | ✓ | — | `liuli-treeitem-rise`、`liuli-header-text-rise`；删除行由宿主 `dsh-client-ui-workspace` 直接卸载，非 Liuli 接管面，见外部依赖说明 |
| 轮次刻度与点击跳转 | ✓ | ✓ | ✓ | ✓ | `TurnRail.tsx` 对 rail/capsule 用 presence 延迟卸载，贴边 tick 级联淡出；滚动位置即时跟手 |
| 产物文件卡展开/菜单 | ✓ | ✓ | ✓ | ✓ | `TurnFileCard.tsx` 菜单与列表用 `usePopupPresence`，列表 grid rows 180ms 双向过渡，收起即 inert |
| 审查来源切换、文件 diff、右键菜单 | ✓ | ✓ | ✓ | ✓ | `FileReviewPanel.tsx` 菜单用 `usePopupPresence` / `usePopupValuePresence`；diff grid 双向过渡 |
| 日夜主题切换 | ✓ | — | ✓ | — | `index.ts` 的 `startViewTransition`、`liuli-css.ts` 圆形遮罩 |
| 侧栏/详情开合、Dock 点击添加/关闭/浮动 | ✓ | ✓ | ✓ | ✓ | `.shard` 宽度过渡、面板/浮窗入场及主动关闭的 140ms opacity 退场；减少动态效果时即时关闭 |
| 标签/sash/浮窗拖放与拆分/合并 | — | ✓ | ✓ | — | 拖动中的几何即时跟手；释放后新卡片淡入、标签选中态过渡，拖离的旧卡片直接让出落点 |
| 右栏标签、加号、概览、空栏入口 | ✓ | ✓ | ✓ | ✓ | 新版默认由 `LiuliDockSurface` 接管（Dock 代理继续验收）；旧版/手动关闭官方席位时 `PreviewPanel.tsx` 的概览、加号、空态、右键也有 presence 退场 |
| 浏览器导航/刷新/地址/响应式/更多 | ✓ | ✓ | ✓ | ✓ | 新旧右栏均复用 `BrowserPanel`；`PreviewPanel.tsx` 的 Native/Webview 更多菜单保留定位到退场完成，浏览器可用性由运行验收证明 |
| 文件树目录、Git 提交、命令中心 | ✓ | ✓ | ✓ | ✓ | `RightSidebarPanels.tsx` 目录请求期旧列表淡出、新文件行浮现；文件右键与命令中心用 presence 双向过渡 |
| 终端发送、辅助对话发送/停止 | ✓ | ✓ | ✓ | — | `SidePaneExtraPanels.module.css`、消息级联；终端命令执行状态待实测 |
| 辅助对话命令菜单、上下文计量 | ✓ | ✓ | ✓ | ✓ | `SidePaneExtraPanels.tsx` 使用 `usePopupPresence` 延迟卸载 120ms；CSS exit 规则 |
| 设置主题块、开关、滑条、数字输入、复位 | ✓ | — | ✓ | — | `LiuliAppearanceRow.module.css`、`LiuliAppearance.module.css`、`HistoryLoadRow.module.css`、`ModelRetryRow.module.css` |
| 设置原生 select 替换菜单 | ✓ | ✓ | ✓ | ✓ | `settings-selects.ts` 延迟移除且清理监听，`SettingsSelects.module.css` exit 规则 |
| 设置提示卡、声纹高级区 | ✓ | ✓ | ✓ | ✓ | `LiuliAppearance.tsx` tip 用 `usePopupValuePresence`；`LiuliFeaturesSection.tsx` 高级区 grid rows 180ms 双向过渡，收起即 inert |
| 壁纸框选/移动/缩放、上传/删除 | ✓ | ✓ | ✓ | ✓ | `LiuliAppearance.tsx` 上传显示旋转进度，预览挂载淡入/删除折叠退场，选区模式描边变色；框选几何即时跟手 |
| 悬浮球吸附、工具栏、拾取/检查卡、提示 | ✓ | ✓ | ✓ | ✓ | `FloatBall.tsx` 使用 `usePopupPresence` / `usePopupValuePresence`，CSS exit 规则 |
| 会话/工作区/文件右键 | ✓ | ✓ | ✓ | ✓ | `context-menu-presence.ts` 释放监听后保留 120ms，`liuli-css.ts` / `liuli.css` 双向动效 |
| 官方 Menu | ✓ | ✓ | ✓ | × | `liuli-css.ts` 可装饰入场与条目状态；宿主立即卸载，退场需在宿主 Menu 生命周期接入 presence |
| 官方 Modal、Tooltip、Toast | △ | ✓ | △ | △ | Modal/Tooltip 立即卸载；Toast 宿主自带延迟淡出（`node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/Toast.module.css`） |
| 窗口按钮悬停、全屏与窗口操作 | ✓ | — | ✓ | — | `HeaderEffects.module.css`、`WindowControls.module.css`；系统窗口切换由宿主处理 |

## 本轮源码与构建验证

- 新增动画局限于入口、退场、悬停或选中状态，最长 180ms；避免给拖拽中的 `left/top/width/height` 增加过渡。
- 已为新增动效添加 `prefers-reduced-motion` 分支。官方 Toast/Tooltip 原有降级保留。
- 官方对话框只淡入透明度，不给含 `position: fixed` 子层的容器保留 `transform`，避免固定定位变成相对卡片。
- 最终 `pnpm build`、CSS 解析、`git diff --check` 和 `node demo/test-sidebar-paths.ts` 已通过。

## DSH Desktop 2.0.13 运行结果（2026-09-24）

- `node demo/verify-animations-dsh.mjs 9333` 在前台完成 **20/20**：左侧栏 280→56→280px 有中间帧；工作台、添加面板、槽位下拉、导出弹窗、侧栏加号的入场/退场可见且关闭后卸载；模拟减少动态效果时动画关闭并即时卸载。该次会话空标签，侧栏标签过渡跳过；此前有标签时已测得选中态 `0.14s`。
- 临时“便签”面板主动关闭时 45ms 中间帧 opacity≈0.87、WAAPI 时长 140ms，195ms 后面板已卸载，面板数恢复 4；浮窗入场使用 `liuli-dock-pop-in`，关闭时同样测到 140ms 退场并恢复浮窗数 0。
- CDP 实测浏览器“更多”菜单入场 170ms、退场 120ms；文件行入场 450ms、文件右键菜单 160/120ms；设置下拉 160/120ms、提示卡 140/120ms、声纹高级区 180/150ms（关闭后 `inert`）。轮次刻度已读到 180ms 过渡及 0/30/60/90ms 级联延迟，显隐过程未在这次会话中触发。
- 原生官方 Seat 与琉璃 dock 标签实测同为 30px 标签高、8px 圆角、14px 字号、同选中底色和 140ms 状态过渡；标签条均为 49px。官方 guide/files/Markdown/PNG/HTML/PDF、行号定位、全屏与浮窗往返分别通过功能检查。
- 文件树在 Windows 点击 `docs` 后加载 39 行且无 forbidden；最终面包屑为 `~/docs`。目录请求期的淡出规则存在，快速本地请求结束前未稳定抓到中间透明度；文件行入场已实测。
- 检查期间另一个已安装插件 `dsh-antigravity-provider` 抛出 `remote.antigravity without inject`；它不由上述操作触发，已与本主题异常分开记录。浏览器标签切走后 dockkit 会卸载 WebView，返回时 URL 保留、历史重置。

## 运行验收步骤

1. 在当前 DSH Desktop 展开/收起主侧栏和右栏，切换单/多标签，拖动标签到四向落点与浮窗，拖动 sash 后放开。拖动应同步指针，放开后布局过渡应完成。
2. 打开右栏空态功能、加号菜单、概览；切换浏览器、终端、审查、文件树、Git；核对打开、选中和关闭都能看到反馈。
3. 浏览器地址输入一个可达页面，执行后退/前进/刷新、响应式开关和更多菜单；确认页面确实加载且控件状态有反馈。
4. 打开设置，逐个操作主题立方块、开关、滑条、数字输入、下拉、高级区和壁纸选区；核对即时跟手与非拖动状态过渡。
5. 打开悬浮球、元素拾取结果卡、会话/工作区/文件右键菜单、官方对话框与 Toast；再开启系统“减少动态效果”复核无不必要运动。

本轮已覆盖 Liuli 接管控件的可见开合、选中与主动关闭，并用上述前台操作核对主要路径。宿主自有 Menu/Modal/Tooltip 的退场仍取决于宿主卸载时机；轮次刻度显隐和壁纸框选的实际运动未在本次会话中触发，表中的源码证据不等同于这两项的前台实测。
