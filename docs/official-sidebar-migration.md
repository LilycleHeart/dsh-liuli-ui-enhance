# 并入官方右侧栏：迁移说明与自研 dock 外壳退役范围

> 适用客户端：DSH Desktop 2.0.9 起的 `rightbar` 槽位；本机已核对 2.0.13 的官方侧栏包 0.1.5-rc.2 接口
> 状态：**琉璃四向 dock 承载原生官方 Seat**。新版客户端默认启用，旧版自动回退自研详细页；可在「设置 → 功能」手动切换
> 相关代码：[`src/client/liuli-dock-surface.tsx`](../src/client/liuli-dock-surface.tsx)（核心）、
> [`src/client/sidebar-right-tabs.ts`](../src/client/sidebar-right-tabs.ts)、
> [`src/client/dock-shell-frame.tsx`](../src/client/dock-shell-frame.tsx)、
> [`src/client/index.ts`](../src/client/index.ts)

## 0.0 架构修订（重要，覆盖下文早期描述）

**早期做法（已废弃）**：以 `priority: -1` 遮蔽官方 `rightbar.session` 席位，让琉璃的
dock surface 占住它。**代价是官方 `ctx.sidebarRight` 彻底失效**：

```js
// 官方 client.js
bindService: (binding) => controller.bind(binding)   // ← 官方 RightbarSeat 挂载时调用
require() { if (this.binding === void 0) throw new Error("sidebarRight: no session surface is mounted") }
```

遮蔽 Seat ⇒ binding 永不建立 ⇒ 官方 controller 每个方法都抛
`sidebarRight: no session surface is mounted`。受害的是**官方插件**：

- 对话页「交付文件」的文件按钮（`ui-deliverables` 的 `gemp6G_file`）→
  `ui-chat` 的 `openFile` → `ctx.sidebarRight.openResource(url)` → 抛错 ⇒ **点击完全无反应**；
- 该错误文本还会显示在界面上（用户实测反馈）。

**现在的做法**：

1. 官方 `rightbar.session` **不遮蔽** —— 官方 Seat 照常挂载，`bindService` 建立 binding，
   官方导航 API 继续可调用；
2. 官方 Seat 在帧根部**常驻挂载**，即使用户把详情区域拖出 dock 树，
   `ctx.sidebarRight` 的绑定仍在。默认隐藏；当琉璃 dock 的「官方侧栏」标签
   处于活动态时，按该标签正文的实际矩形显示原生 Seat。它以
   `viewportWidth:0` 进入官方 auto-fullscreen 呈现，`canShow:false` 不分配
   第二条右栏轨道；浮窗只在原生标签活动时可见；
3. 琉璃的 dock surface 由**帧层在详情卡片里直接渲染**
   （`dock-shell-frame.tsx` 的 `REGION_DETAILS` 分支 → `<LiuliDockSurface>`），
   于是既有官方的完整 API，又有琉璃的四边分栏 / 4 格 / 浮窗 / 跨区域拖拽；
4. 官方 API 打开的 tab 仍由官方 Tab 域持有。**轮询桥**
   `startOfficialTabBridge` 观察官方 `active()`：官方内建 `guide`、`files`、
   `text`（以及未来未映射的原生类型）聚焦琉璃 dock 的「官方侧栏」标签，
   在其中直接显示原生 Seat；琉璃自己注册的 `liuli-*` 类型则映射回原有
   琉璃面板。原生文档预览不再降级成 CodeViewer，Markdown、代码、PDF、
   图片、HTML、打开方式、重载和行号导航由官方原组件处理。

桥只观察**当前活动 tab**，但原生 Seat 自己持有并显示全部原生标签，
切换、关闭、资源导航和浮窗仍由官方实现。琉璃只为整棵 Seat 提供外层停靠位置。
dockkit 由上游标注为内部引擎，升级时需要核对其契约。
官方展开按钮的 CSS Module 类名在本机 2.0.13 已变化；琉璃按钮现在使用
`LiuliDockSurface.module.css` 自有样式和旧版 `PanelRightOpen/CloseIcon`，
不再硬编码官方哈希类名。默认启用「禁用右栏内部分栏」：隐藏琉璃 dockkit 与
原生 Seat 的分栏按钮，并禁止原生 tab 的拖拽分栏手势；琉璃标签在栏内边缘与
栏外的落点仍交给整窗 Dockable 布局。
设置中关闭该项即可恢复右栏内部最多 4 格的分栏。
右栏标签条以 dockkit 的 `data-dockkit-*` 稳定属性对齐整窗琉璃标签样式：
48px 标签条、8px 圆角、相同的活动底色/描边/阴影和无常驻分隔线。
初始控制器不再预置「审查」tab；没有停靠标签时显示旧版「打开标签页」入口，
`＋` 菜单与空状态共用带图标的功能列表。
旧设置中保存的 `official_sidebar_right:false` 与旧默认值无法区分，升级后按新版
默认启用；曾手动关闭此选项的用户需要在设置页再关闭一次。

**2.0.13 本机运行检查（2026-09-24）**：官方宿主与琉璃 surface 各 1 份；
官方 `openTab('guide')` 在琉璃标签里显示原生 8 项引导入口，进入「工作区文件」
后可见官方文件树与重新读取按钮，点击 README.md 得到官方 `text` tab 与
Markdown 渲染器。PNG 得到 Blob 图片渲染器（160×28），HTML 得到带
`sandbox="allow-scripts"` 的 Blob iframe（775×897），PDF 得到官方 PDF
渲染器和页面 canvas。可见原生面板与琉璃占位几何同为 775×973，主帧保持
2560px，只有一份官方面板，无双轨挤压。
以 `{ params: { line: 100 } }` 打开 TS 文件后，官方「代码」渲染器的正文滚动
位置到 1935px。原生形态按钮可铺满 1936×953 视口，再退回 775×894 的
标签占位；官方文件 tab 可浮出成 450×350 面板并放回，浮窗宿主保持点击穿透。
经典按钮设置默认开启时，右栏内置分栏按钮不可见、dockkit 原生 `+` 按钮为 0，
琉璃 `＋` 入口与旧版页头图标各 1 份；关闭「禁用右栏内部分栏」后分栏按钮
出现，重新开启即隐藏。禁用内部分栏时将标签拖到会话区上缘，整窗
`dock-drop-indicator` 显示 `split` 落点；在右栏内边缘松手后，外层 panel
数量增加、内层 pane 数不变，源 tab 关闭。

> 以下 §0–§0.4 是现行增强方案的实现记录；§1–§7 保留了早期迁移试验的历史记录，
> 其中关于遮蔽 Seat、默认关闭、官方界面负责分栏的描述不再代表当前行为。

**官方文件打开的完整链路（实测确认）**：

```
对话页文件按钮（ui-deliverables，style 类 gemp6G_file）
  → ui-chat 的 openFile(path)
  → fileAddressFor(sessionId, cwd, path) → sessionFileAddress
  → ctx.sidebarRight.openResource('dsh-resource://file/session/<sid>/<rel>')
  → 官方 layout 出现 tab { kind:"text", contentId:"dsh-resource://file/session/<sid>/<rel>" }
  → 琉璃轮询桥捕获 → 聚焦 dock 中的「官方侧栏」标签
  → 原生 text tab 直接通过官方 Tab 域加载并渲染文件
```

`CodeViewerPanel` 仍用于琉璃自身的代码查看入口；官方文件地址不再由桥解析
并转换为该面板，而交给官方文档预览的资源导航、参数 revision 和加载器。

## 0. 最终形态：并入官方外壳，右栏内部换成琉璃的 dockable 布局

`ui-sidebar-right` 自己就是用 `@deepseek-ai/dsh-client-ui-dockkit` 渲染的，但它把能力
**收窄**成了「右栏内左右两格」：

```js
<DockSurface dropZones="horizontal" canSplit={... dockPaneIds(layout).length < 2 ...} />
```

官方 README 明确写着这是**调用方的策略**而非引擎限制：

> `dropZones="horizontal"` 提供左右两个半区提示……**Sidebar 使用 0.2 并在自己的 store 限制两格。通用引擎仍保留原有树与其它分割方向。**

引擎实测常量：`MAX_DOCK_PANES = 4`、`dropZones?: 'edges' | 'horizontal'`、
`DOCK_ZONES` 含 `center/top/right/bottom/left`。

因此琉璃按官方 README 点明的第二条嵌入路径（「经由自己 store 路由的嵌入方则实现同名
方法」）**用自己的 `DockController` 实现 `DockIntents`**，把 `DockSurface` 接到自己的
布局状态上，在官方外壳内拿回完整能力：

| 能力 | 官方 `RightbarRoot` | 琉璃 `LiuliDockSurface` |
|---|---|---|
| 落区 | `horizontal`（仅左右） | **`edges`（四边，含上下分栏）** |
| 分栏上限 | 2 格 | **4 格（`MAX_DOCK_PANES`）** |
| 浮窗 | 有 | 有（`FloatLayer`） |
| 标签条 / chip / 右键菜单 / 分隔条 / 键盘无障碍 | 有 | 有（同一套 dockkit 组件） |
| tab 内容 | 官方注册表（files/documentpreview/…） | 琉璃 7 个面板 |

**接入点**：不重写 root 层。`rightbar` 是 root 作用域席位（框架不注入 `sessionId`），
官方 `RightbarRoot` 用 `SessionProvider` 包住后渲染 session 作用域的
`rightbar.session` 子席位；琉璃以 `priority: -1` 注册在 **`rightbar.session`** 上
（single 席位「最低者渲染」＝本 entry 生效、官方 Seat 被遮蔽），而**官方
`RightbarRoot` 照常挂载**。

**⚠️ 遮蔽官方 Seat 的连带影响（实测，必须知道）**：

官方 `ctx.sidebarRight` 控制器的每个方法都走 `this.require()`，而 `require()` 依赖
**官方 `RightbarSeat` 挂载时建立的会话绑定（`binding`）**。遮蔽该席位后 binding 永不建立：

```
ctx.sidebarRight.toggleExpanded() → "sidebarRight: no session surface is mounted"
ctx.sidebarRight.isExpanded()     → 恒 false
→ 官方 header 那枚「打开右侧边栏」按钮点了无效
```

因此迁移模式下**开合必须自己提供**。琉璃的做法：在
`conversation.session.header.corner` 席位（single）以 `priority: -1` 遮蔽官方
`ExpandButton`，放一枚**同款外观**的按钮（照抄官方样式类 `GzLz_G_button` /
`GzLz_G_icon` 与图标 `IconPanelLeftOutline16`，官方包已把该 CSS 注入到
`<style data-plugin-css>`，因此直接复用类名即得同款外观），只把 onClick 换成驱动
**我们的** `DockController`，并写 `__liuliForceExpanded__` 供帧层即时读取列宽。

**同样受影响的还有**：`ctx.sidebarRightTabs`（官方 tab 类型注册表）与官方的
`guide` 引导页、`ui-sidebar-files` / `ui-sidebar-documentpreview` 两个官方面板 ——
它们在迁移模式下都不再进入右栏（琉璃用自己的 7 个面板替代）。

**运行期实测（2026-09-15，DSH Desktop 2.0.9）**：

```
dropZones 属性        data-dockkit-drop-zones="edges"
拖到格子中央          落区提示「合并到此格」
拖到格子上边缘        落区提示「向上分栏」      ← 官方只有左右，做不到这个
连续分栏              1 → 2 → 3 → 4 格，第 5 次被拒（MAX_DOCK_PANES = 4）
pane 几何             4 格并排，高度均为 1014px（= 视口高度，几何受控）
浮窗                  floatTab → 380×300 浮窗 → unfloatPane 放回
7 个面板              逐个作为 tab 打开，全部渲染、零错误边界
官方样式按钮          点「打开右侧边栏」→ details 从 0 变 751px、dock surface 745px
跨区域拖拽            标签拖到左栏 → 右栏标签清零、外层格数增加（移动语义）
落点指示器            拖到会话区时 [data-testid=dock-drop-indicator] 出现并跟随
关闭开关后回归        liuliDockSurface: 0 / 自研 details 列与 4 区域恢复
```

## 0.1 会话身份的获取（踩坑记录）

`rightbar` 是 **root** 作用域席位，框架**不注入 `sessionId`**；官方 `RightbarRoot`
的路径是「用 `SessionProvider` 包住 → 内层渲染 session 作用域的 `rightbar.session`」，
而 `SessionProvider` 只注入给**声明了 session 子席位**的 entry。因此琉璃**不占 root 层**，
只在 `rightbar.session` 里替换内容 —— 官方 `RightbarRoot` 照常提供会话上下文。
早前若直接在 root 层注册，会拿到空 `sessionId`（表现为面板显示「请先选择一个会话」）。

## 0.2 拖拽细节（两处必须自己补的地方）

1. **「拖走本格唯一 tab 到本格边缘」被引擎放弃**：dockkit `planDropTab` 有
   `if (vacates && makeTab === void 0) return NOTHING`，而 `DockSurface` 的释放路径
   **不传 `makeTab`**（只有 `splitPane`/`addTab` 传）。结果：格子里只有一个 tab 时拖到
   自己格子边缘什么都不发生（表现为「只能左右分栏」）。琉璃在 `DockIntents` 包装层
   命中该场景时改用 `planDropTab(state, mint, tab, pane, zone, makePaneTab)` 直接生成
   操作再 `run(ops)` —— 保留 zone 决定的轴向（top/bottom → column）。
   ⚠️ 不能用 `controller.splitPane()` 兜底：它把 `axis` 写死成 `'row'`，上下分栏会变成左右。

2. **外层落点指示器**：dockkit 的标签拖拽走 **pointer + `setPointerCapture`**，
   不走 HTML5 drag 事件，所以外层为 HTML5 拖入准备的 `dropIndicator` 不会被触发
   （用户反馈「拖动标签页不显示 dockable 指示器，而手柄正常」）。琉璃在外层 shell 上
   暴露 `previewPanelDrop/clearPanelDrop`，由右栏侧在指针按下期间（`pointermove` +
   `mousemove` 双通道 + 60ms 轮询兜底，因为 capture 后事件只发给捕获元素）调用，
   复用与手柄**同一套** `computeDrop` 判定与同一个指示器渲染。

## 0.3 跨区域拖拽：标签能拆到任意区域

dockkit 的释放逻辑：落点不在自己的 surface 内 → 调 `intents.floatTab(tabId, rect)`。
琉璃在这里接回外层布局（恢复「标签拆到任意区域」的原设计）：

```
拖到右栏外 → dockkit 调 floatTab(tabId, rect)
           → 取 rect 中心的视口坐标
           → 问外层 getDockHostBridge().dropPanelAt(type, x, y)
           → 外层用与手柄相同的 computeDrop 判定落点（边缘条 / 各格四向拆分 / 合并）
           → placePanel 放入 + 关闭右栏源标签（移动语义，非复制）
```

kind → 外层面板类型的映射在 `KIND_TO_DOCK_TYPE`（`review→git`、`code→code` …）。

## 0.4 驱动入口与展开链路（三个实测坑）

面板驱动入口（对话页「打开」前端文件、轮次卡片「审查」、产物链接、`/side` 指令）
**必须走我们自己的 `openLiuliDockPanel`**（`controllerFor(sessionId).openContent`），
不能走官方 `ctx.sidebarRight.openTab` —— 遮蔽官方 Seat 后后者抛
`no session surface is mounted`（用户实测「无法打开对话页里的文件」）。
index.ts 的 `drive()`：迁移模式 → 自己的控制器；否则回退 `openLiuliPanel`（官方原生
模式）→ 自研链路（`PreviewDetailsPanel` 内部监听器）。

参数传递用**覆盖式表**（`latestPanelParams` + 版本订阅）：dock 里「再次打开已打开的
面板」不会重新挂载 tab，`openContent` 只聚焦 —— 参数必须能覆盖更新并触发正文重渲染；
「取走即删」的 pending 消费表满足不了这个场景。

**三个展开链路的坑（全部实测）**：

1. **控制器被拉回收起**：早前留过「控制器跟随官方 `isExpanded()`」的同步轮询，
   而官方恒 false → 每 150ms 把刚展开的控制器打回收起（surface 渲染 0 尺寸）。
   已删；展开状态的唯一权威 = 我们的控制器 + `__liuliForceExpanded__` 标记。
2. **官方轨道挤压**：`detailsOps.open()`（= 官方 `openRightbar`）会开**官方布局
   自己的右栏轨道**，把 `dshDesktopFrame` 从全宽压到 1703px，帧层的 751px 列被挤成 0。
   迁移模式下 `__liuliOpenDetails__/__liuliCloseDetails__` 必须是**空操作**，且插件
   启动时 `detailsOps.close()` 一次（回收上次会话残留的官方轨宽度）。
3. **flex-basis 过渡冻结**：`.shard { transition: flex-basis .3s }` 在「展开状态被
   快速重写」时（surface 重挂瞬间 `__liuliDockExpanded__` 钩子缺席 → 读序列跌落到
   恒 false 的官方 hook → 0↔751 翻转）每次都从 0 重启，**永远到不了 751** ——
   inline 751px 但 computed 0px，面板"开了看不见"、按钮"收不起来"。
   修复：轮询记住上次值（绝不跌落到官方 hook）+ 迁移模式下禁用该过渡
  （`[data-liuli-official-shell] .shard { transition: none }`）。


**打包**：dockkit 是官方标注的「内部引擎」（README：导出「在任何版本都可能变化」），
但它是 npm 公开包，且无跨插件运行时身份（纯 TS 引擎 + React 组件，state in/intents out）。
琉璃把它内联进 client bundle（`scripts/tsdown.client.ts` 的 `DOCKKIT_LIBRARY` 白名单；
它依赖的 `@deepseek-ai/dsh-client-ui-primitives` 已是平台模块，走 external）。

**升级复核**：官方改动 `LayoutState` / `DockIntents` / planner 形状时，本文件会报类型错或
行为异常 —— 优先核对 `lib/types/` 下的契约定义。

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
  零错误边界触发；正文抽样如「终端 liuli terminal · Git Bash · cwd: <workspace>/liuli-theme」。
- 截图：`demo/shot-official-rightbar.png`（官方标签条 + 审查面板）、
  `demo/shot-official-panels.png`（标签条承载 7 个面板 + 文件树内容）、
  `demo/shot-settings-toggle.png`（设置页开关）。
- 布局数据：常驻宿主宽度 953px（视口 2118 × 45%），面板宽度同宽。

## 6.1 布局对齐修复（2026-09-15，官方右栏模式）

官方右栏虽然接管了标签条与分栏，但**它的布局模型是「整条轨道」**，而琉璃给它套了
卡片外壳（左 8px 留白 + 1px 描边 + 圆角），两者差了一层内缩。实测在三处直接冲突，
表现为「左右边距留不够、浏览器面板显示不出网页」：

| # | 现象 | 根因 | 解法 |
|---|---|---|---|
| 1 | 官方面板左侧内容被裁（标签条最左一段不可见） | 官方 `._panel` 是 `position:absolute; right:0` + 内联 `width:<轨道宽>px`。轨道 751px 而卡片内容盒只有 741px，面板按轨道宽右对齐后**向左多伸 10px**，被卡片 `overflow:hidden` 裁掉 | 加 `max-width:100%`（只约束 `push` 形态，`fullscreen` 本就该铺满视口）。不动 `width/left/right`，官方的滑入滑出动画与「轨道为 0 时挂在列右缘」的语义都建立在 `right:0` 上 |
| 2 | 标签条比自研高 8px，正文区整体下移 | 官方 `._tabStrip_` 是 **content-box**，早前覆盖写 `height:48px` + `padding:8px 8px 0` ⇒ 总高 48+8+1 = **57px**（实测） | 归零纵向 padding（`padding: 0 <dock-padding>`），总高 49px，与自研 `.tabStrip` 的 48px 内容 + 1px 描边一致 |
| 3 | **浏览器面板不显示网页**（只在顶部渲出一条窄缝） | 琉璃面板全部按「父级纵向 flex + 自身 `flex:1`」设计（自研宿主 `.tabPane` 正是如此），而官方 `._paneBody_` 是 `display:block; height:auto`。落进去后 `flex:1` 不生效、`height:100%` 落空 ⇒ 浏览器面板的 `.carrier`（`flex:1 1 auto`）塌成 `<webview>` 的 150px 固有高度（实测 carrier 150px / 可用 965px） | 正文注册时**外再包一层** `[data-liuli-official-pane]`（`display:flex; flex-direction:column; height:100%`），补回自研宿主那一层等价容器；只包琉璃自己的正文，不改官方 files/documentpreview 共用的 `._paneBody_` 布局模式 |

另有第 4 处顺带对齐：卡片原用 `height: calc(100% - 2×padding)` + 上下 margin，
但本列（区域 pane）**自身已有 8px 上下 surface padding**，等于留白翻倍、卡片上下各空 8px。
改为 `flex: 1 1 auto; height:auto; margin: 0 0 0 <dock-padding>`，让卡片沿列主轴撑满内容盒。

**验证**（`demo/` 下单测脚本 + CDP，视口 2560×1032）：

- 卡片内容盒 741×1014，官方面板 741×1014、标签条 741×49，几何差全为 **0**
- 7 个琉璃面板（审查/文件树/终端/代码/浏览器/辅助对话/开发者工具）逐个 `openTab` 核对：
  左右溢出 0/0、标签条 49px、正文区 965px、错误边界零触发
- 浏览器面板：`.carrier` 由 150px 恢复为 **741×918**，工具条 + 网页占卡片内容高 **95.2%**
- 官方自带 files / guide 面板不经过包裹层，渲染正常（未受影响）

> 调试提示：窗口**最小化或后台**时 `document.visibilityState === 'hidden'`，
> 帧层决定轨道宽度的 120ms 轮询被浏览器节流到约 1 分钟一次，`details` 列会长时间停在
> 宽度 0（表现为「右栏打不开」）。这是宿主/浏览器节流，不是布局缺陷 ——
> CDP 验证前先 `Page.bringToFront` 并把窗口从最小化恢复。

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
