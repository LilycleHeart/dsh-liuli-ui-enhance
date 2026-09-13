# 并入官方右侧栏：迁移说明与自研 dock 外壳退役范围

> 适用客户端：DSH Desktop 2.0.9（`@deepseek-ai` 0.1.5-rc.1）
> 状态：**面板迁移完成（7 个已迁移 / 2 个保留）**，默认关闭，可一键回退
> 相关代码：[`src/client/sidebar-right-tabs.ts`](../src/client/sidebar-right-tabs.ts)、
> [`src/client/dock-shell-frame.tsx`](../src/client/dock-shell-frame.tsx)、
> [`src/client/index.ts`](../src/client/index.ts)

## 1. 背景

DSH Desktop 2.0.9 起，客户端内置了官方右侧栏
（`@deepseek-ai/dsh-client-ui-sidebar-right`）。它同时提供：

- **`ctx.sidebarRight`**：导航控制器 —— `openResource` / `openTab` / `close` /
  `active` / `isExpanded` / `toggleExpanded` / `focus` / `split` / `float` / `dock`；
  两级呈现（`push` 贴靠右栏 / `fullscreen` 覆盖窗口），每会话一个停靠面；
- **`ctx.sidebarRightTabs`**：tab 类型注册表 ——
  `register({ id, kind, priority, patterns?, canOpen?, title, guide? })`；
  `priority: 'extension'` 档位**高于**官方 `builtin`，可接管同名 kind；
  `guide` 是**数组**、其 `title`/`description` 为延迟读取的函数；
- **正文席位** `sidebar.right.pane.tab`（keyed + session 作用域）与标题席位
  `sidebar.right.pane.tab.title`；正文组件经席位注入拿到 `sessionId` 等标准 props；
- 布局本体下沉到 `@deepseek-ai/dsh-client-ui-dockkit`（分裂树/拖拽/浮窗）。

官方自己的 `ui-sidebar-files`（文件树）与 `ui-sidebar-documentpreview`（文档预览）
就是走这条公开路径实现的，因此第三方插件可以只贡献「面板正文」，把外壳交还官方。

## 2. 迁移了什么

面板以**声明表**驱动注册（`PANEL_SPECS`）：每个面板 = 一个 tab 类型 + 一个正文席位，
正文复用既有组件，外层统一套错误边界（单面板崩溃不影响整条右栏）。

| 琉璃面板 | 官方 tab kind | 状态 |
|---|---|---|
| 审查（git diff） | `liuli-review` | ✅ 已迁移（试点） |
| 文件树 | `liuli-files` | ✅ 已迁移 |
| 终端 | `liuli-terminal` | ✅ 已迁移 |
| 代码查看 | `liuli-code` | ✅ 已迁移 |
| 浏览器 | `liuli-browser` | ✅ 已迁移 |
| 辅助对话 | `liuli-side-chat` | ✅ 已迁移（需宿主数据面，缺失则跳过） |
| 开发者工具 | `liuli-developer-tools` | ✅ 已迁移（同上） |
| 便签 | — | ➖ 保留在自研侧（见 §5） |
| 产物预览 | — | ➖ 保留在自研侧（见 §5） |

**帧层侧的两处配套改动**（`dock-shell-frame.tsx`）：

1. **官方右栏常驻宿主**：官方 `AppFrame` 是**无条件**渲染 `rightbar` 席位的，
   而自研帧层原先只在右栏面板渲染时才渲染它 —— 右栏关闭时官方 `RightbarRoot`
   拿不到挂载点，`ctx.sidebarRight` 会一直报 `no session surface is mounted`。
   现在帧层在 `officialRightbar` 模式下常驻渲染该席位（宽度 0 时仍挂载）。
2. **轨道宽度**：官方 RightbarRoot 依赖帧层提供轨道宽度（官方 AppFrame 用
   grid 列宽）。插件按官方常量给宽度（默认 45%，clamp 300 ~ 70% 视口），
   展开状态住在官方自己的 store 里、帧层读不到，因此用 400ms 轮询
   `__liuliSidebarRight__.isExpanded()` 决定是否为 0；同时自研 details 区域
   在该模式下宽度归零，避免双列。
3. **让出席位**：自研 `PreviewDetailsPanel` 原先以 `priority: -1` 占据
   `rightbar` 席位，压制了官方 `RightbarRoot`；开启开关后不再注册它。

## 3. 怎么开、怎么退

- **开启**：设置 → **功能** → 「并入官方右侧栏（预览）」→ **刷新页面**
  （注册与宿主渲染在插件 apply 时决定，故必须刷新）。
- **调试用兼容键**：`localStorage['liuli:official-rightbar'] = '1'`（设置项优先）。
- **回退**：关掉开关并刷新 —— 自研详细页与 dock 工作台立即回归，无残留。
- **前提**：官方面板要生效，`rightbar` 席位必须由帧层渲染（见 §2），
  因此该开关只在 2.0.9+ 的 `advanced`/`extended` 模式有意义；旧客户端
  取不到 `sidebarRightTabs` 服务时会静默跳过注册。

## 4. 自研 dock 外壳的退役范围

结论：**自研 dock 外壳不能整体退役，只让出「右栏内容区」**。

| 能力 | 官方是否覆盖 | 处置 |
|---|---|---|
| 右栏标签条 / tab 分栏 / 拖拽 / 浮窗 | ✅ `ui-dockkit` + `sidebar-right` | 开启开关后**让位**（插件的 7 个面板改由官方承载） |
| 右栏宽度拖拽 / 开合 / 全屏形态 | ✅ 官方面板自带控件 | 让位 |
| 右栏 tab 的持久化（刷新保留标签组） | ❌ 官方明确「只在内存中，刷新回到折叠默认态」 | 自研仍按会话 localStorage 记忆（官方模式下暂不适用） |
| **三区域统一布局**（左栏 / 会话页头 / 会话区 + 右栏同一棵 dock 树） | ❌ 官方 dockkit 只管右栏停靠面 | **必须保留** |
| **跨区域拖拽**（把右栏面板拖进左栏/页头）、四向拆分、边缘停靠 | ❌ 官方只覆盖右栏内部 | **必须保留** |
| **Workspace 布局保存 / 恢复**（`__liuliDockShell__` 自检钩子、导入导出 JSON） | ❌ | **必须保留** |
| **便签 / 产物预览**等 dock 专用面板 | ❌ | **必须保留**（见 §5） |
| 会话页头作为可拖拽面板、`conversation-split` | ❌ | **必须保留** |

也就是说：官方提供的是「**右栏内部的停靠套件**」，琉璃自研的是「**整窗三区域工作台**」。
两者不是替代关系，而是包含关系 —— 开关控制的是"右栏内部的 shell 归谁"。

若要进一步瘦身，可选的下一步是把自研右栏在官方模式下**彻底下线**（条件注册 →
直接删除对应的标签条/宽度代码路径），但那会牺牲"关闭开关即回到旧版"的回退能力，
建议等官方扩展点进入稳定版（脱离 `rc`）后再做。

## 5. 两个未迁移的面板与原因

- **便签**：价值在于"随 Workspace 布局持久化"（写进 `dock.state`，跟着导入导出走）。
  官方 tab 记录是**内存态**、不承载业务状态，迁过去会丢掉持久化语义，反而降级。
- **产物预览**：本质是"会话 cwd 的目录浏览 iframe"，官方右栏已有 `ui-sidebar-files`
  （文件树）与 `ui-sidebar-documentpreview`（文档预览）覆盖同类需求；
  在自研侧它依赖 dock 面板的 `panel.state` 才能切目录，迁过去同样丢状态。

两者在自研模式下继续可用，功能没有丢失。

## 6. 运行期证据（2026-09-13 实测，DSH Desktop 2.0.9）

- 官方注册表内容：
  `["@deepseek-ai/dsh-client-ui-sidebar-right/guide", "dsh-liuli-ui-enhance/review",
  "dsh-liuli-ui-enhance/files", "…/terminal", "…/code", "…/browser", "…/side-chat",
  "…/developer-tools", "@deepseek-ai/dsh-client-ui-sidebar-files",
  "@deepseek-ai/dsh-client-ui-sidebar-documentpreview"]`
- 面板矩阵（逐个 `openTab` + 读正文，`demo/cdp-panel-matrix.mjs`）：7/7 全部渲染，
  零错误边界触发；正文抽样如「终端 liuli terminal · Git Bash · cwd: D:\Agent project\liuli-theme」。
- 截图：`demo/shot-official-rightbar.png`（官方标签条 + 审查面板）、
  `demo/shot-official-panels.png`（标签条承载 7 个面板 + 文件树内容）、
  `demo/shot-settings-toggle.png`（设置页开关）。
- 布局数据：常驻宿主宽度 953px（视口 2118 × 45%），面板宽度同宽。

## 7. 踩坑记录（都是实测踩出来的，代码里都有对应注释）

| # | 现象 | 根因 | 解法 |
|---|---|---|---|
| 1 | 界面报 `Failed to load plugins / loader fibers failed`，官方 `ui-sidebar-files`、`ui-sidebar-documentpreview` 一起挂 | `ctx.inject(['sidebarRightTabs', …])` 把插件挂进 cordis **boot 依赖图**，同层依赖同一服务的官方插件被一起拖死 | 改**非阻塞轮询 + `ctx.get`**（不建立依赖），服务可用后再注册 |
| 2 | `register` 抛 `(definition.guide ?? []).map is not a function` | `guide` 必须是**数组**，`title`/`description` 是**函数** | 按官方 `filesDefinition` 的形状改写 |
| 3 | 整个帧层消失、`[data-region-pane]` 全空（框架 abdicate 回退官方帧） | 条件调用 `usePanelInfo`（hook），违反 hooks 规则导致组件崩溃 | 抽成**独立子组件**，父级条件渲染组件而非条件调用 hook |
| 4 | `ctx.sidebarRight` 一直报 `no session surface is mounted` | 自研帧层只在右栏面板渲染时才渲染 `rightbar` 席位，官方 `RightbarRoot` 拿不到挂载点（官方 AppFrame 是无条件渲染） | 帧层加**常驻宿主** |
| 5 | 官方右栏渲染了但不可见（宽 0） | 轨道宽度由帧层提供，而展开状态住在官方 store 里 | 按官方常量给宽度 + 轮询 `isExpanded()`，自研 details 区域宽度归零避免双列 |
| 6 | `register at a different priority to shadow it`（HMR 重跑 apply） | keyed 席位同 key 重复注册被拒 | 正文注册统一用 `priority: -1`（keyed 席位「最低者渲染」） |
| 7 | 频繁替换 `client.js` 后刷新页面偶发插件加载失败 | 宿主 bundle 服务是**内存 map**、只在 HMR `rebuilt()` 时重读磁盘；改文件后立刻刷新会请求到过期 rev | 部署后**等 HMR 完成**（约 1s 轮询周期）再刷新 |

另外两点与迁移无直接关系但值得记：

- 不要用 `ctx.inject` 去等**可选**服务 —— 见第 1 条；本插件对 `remote.commandcode` 也
  早就用了同样的「不写进包级 inject」策略。
- 打宿主补丁（asar/exe）与改客户端插件是两件事：前者要**先退出客户端**，
  后者可以靠 HMR 热更（但宿主半改动仍需重启）。
