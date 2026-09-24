# 琉璃功能详解

> 本文档维护 `dsh-liuli-ui-enhance` 的完整功能清单、设计语言、与宿主 shell 的配合方式以及已知限制。
> README 只保留概览，详细同步以本文档为准。

## 设计语言：Material 3 × Fluent 2

两个体系各取所长，避免风格打架：

| 设计维度 | Material Design 3 提供 | Fluent 2 提供 | Liuli 采用 |
| --- | --- | --- | --- |
| 色彩 | 从壁纸派生亮/暗两套动态调色板 | 表面随内容分层取色 | M3 动态取色 → `--dsw-alias-*` 令牌 |
| 材质 | 纯色 tonal surface | 亚克力磨砂材质 | Fluent 亚克力，含强磨砂档 `--liuli-material-blur-strong` |
| 形状 | 全圆、药丸与 20/20/4/20 气泡圆角 | 较小圆角的桌面窗口 | M3 形状系统（气泡明暗互换 `--dsw-specific-bubble-fg`） |
| 深度 | 分层阴影与状态层 | 窗口阴影 + 材质描边 | 两者叠加：材质卡 + M3 阴影层级 |
| 动效 | 状态层涟漪 | 平滑缓动 | Web `startViewTransition` 圆形遮罩承载日/夜切换 |
| 交互 | 组件状态与可访问对比度 | 桌面贴边吸附语义 | 悬浮球贴边半隐藏 + `Alt+Shift+E` 唤起 |

## 功能模块

| 模块 | 说明 |
| --- | --- |
| 🎨 M3 动态取色 | 从壁纸提取 Material 3 调色板（vendored material-color-utilities@0.4），映射为 `--dsw-alias-*` 令牌；亮/暗双主题独立派生，用户气泡明暗互换 |
| 🖼️ 壁纸背景 | 上传图片 → 压缩为 JPEG dataURL 持久化到 localStorage；适应模式（Cover / Contain / Stretch）+ 自定义选区（拖拽框选，Cover 下放大该区域；已有选区可再次编辑/拉伸）；暗色遮罩随主题即时叠加 |
| 🪟 磨砂材质 | 亚克力 Fluent 材质，透明度、模糊强度可调；含强磨砂档（滑条值 ×4，供对话框等嵌套 backdrop 采样衰减的场景） |
| 🔊 声纹可视化 | 会话 header 背景 canvas：空闲态品牌色流动波形；点击按钮经 `getDisplayMedia` 授权捕获系统扬声器输出（Web 端：共享「整个屏幕」并勾选「分享系统音频」；DSH Desktop 端：Host 半在 Electron 主进程安装 `setDisplayMediaRequestHandler`，直接授予系统回环音频 `audio:'loopback'`，点击即监听、无选择器）；只监听系统音量，不降级麦克风；检测默认走**自动节拍同步**（设置页可切回官方检测）：**谱通量触发**（频谱变化量超 期望 + fluxMult×标准差 的自适应门限）判定节拍/脉冲起点，**实时 BPM 估算**（帧能量环形缓冲自相关，55–240 BPM 平滑）按 `120/BPM` 自动伸缩均值窗口与冷却（手动窗口/冷却值视为 120 BPM 参考）；关闭则走官方 Nanoleaf Desktop（Energetic）检测：能量包络对比节拍（Σx² vs 0.7s 滑动平均 + 200ms 冷却）+ 50-350Hz 低频脉冲（0.8×均值 + 220ms 冷却）；两级强度（节拍 100%/脉冲 30%）叠加于三频段连续能量响应之上，波形绘制逐字参照 liuli_echo；失败给出「分享系统音频」勾选提示/授权/非安全上下文诊断；波形外观与检测细节全面参数化（自动节拍同步开关 / 谱通量触发阈值 / 线条数 / 空闲流速 / 整体与主波振幅 / 辉光 / 线条透明度 / 右缘渐隐 / 低中高频视觉事件强度（低频冲击 / 中频流速 / 高频星闪） / 节拍与脉冲均值窗口 / 频段自学习速率 / 驱动平滑 / 响应 presence 包络速度等 15 项）；设置页「功能 → 声纹响应」提供**总开关**（关闭后立即停止系统音频监听并隐藏页头波形，参数保留，重新开启即恢复），其余参数滑条收进「高级设置」折叠区（默认收起、展开后才显示，总开关关闭时联动禁用），改动即时生效） |
| 🌗 日/夜切换 | header 圆形按钮 + 设置页外观行，`startViewTransition` 圆形遮罩过渡（带坐标） |
| 📏 header 拉伸 | header 底部垂直拖拽手柄，高度记忆到 localStorage，刷新/切换会话自动恢复 |
| ⛶ header 全屏 | header 工具区最右端（右上角）Material 图标按钮 + `F11` 快捷键切换浏览器全屏（标准 Fullscreen API，纯 Web 与 DSH Desktop 一致）；进入/退出状态图标联动（fullscreen / fullscreen_exit） |
| 📐 对话轮次刻度侧边栏 | 琉璃时间线风格：左侧竖线刻度，胶囊沿竖线滑动，显示该轮时间/commit号/摘要，点击刻度跳转对应轮次（仅 Chat 视图显示） |
| 💳 供应商额度显示 | header 标题区普通文本，跟在 agent preset 标签右侧：套餐供应商显示本月/本周/5小时三项额度，非套餐供应商显示余额；已内置 DeepSeek 余额（`/user/balance`）、OpenCode Go 套餐（`/zen/go/v1/usage`）、new-api 中转站（zero.cat，`/api/user/self`）余额与 Command Code（5 小时/每周窗口 + 月额度 + 信用），密钥经 Host `/liuli-quota` 路由或对方插件自己的 Host 半读取，不进浏览器 |
| ⚪ 悬浮工具球 | 常驻悬浮圆点：贴边吸附半隐藏（JS 热区防抖动）、拖拽随行、打开后自动夹进视口；快捷键 `Alt+Shift+E` 唤起 |
| 🎯 元素选择器 | 悬浮球进入拾取模式后点击任意页面元素，生成引用 chip 插入当前会话输入框（`@` 触发源 + ReferenceCodec）；发送后用户气泡中以简洁卡片展示，悬停展开详情；工具旁提供「插入 / 检查」模式切换小按钮——检查模式下点击元素弹出「元素检查」卡（selector / rect / 19 项 computed styles / outerHTML 截断 1000 字符，带 复制选择器 / 复制 HTML / 切换开发者工具 / 完成）；宿主仍具备元素定位能力时（DSH Desktop ≤ 2.0.8 的主进程宿主）同时经 Host `/liuli-window` 的 `webContents.inspectElement(x,y)` 在侧边 DevTools 的 Elements 面板定位该元素——**2.0.9 起宿主插件跑在 Electron utility process，拿不到 BrowserWindow，inspectElement 整条降级（GET 的 `capabilities.inspectElement:false`，POST 回 native window control unavailable），卡片即结果面**；**会话标题过滤**：元素引用序列化文本作为首条消息时，DSH 自动生成的会话标题会变成 "[selected element] <div> rect: …" 机器文本。插件只做展示层过滤：把命中元素块的标题展示面（侧栏会话行、会话页头面包屑、悬停卡、搜索结果、工作区切换器）的叶子文本替换为清洗结果——元素块字段整体剥离、保留块前后的用户文字；纯元素块标题（DSH 只取开头几词、块之后的原话进不了标题）从会话快照 / localStorage 缓存取首条消息里的真实用户文字替代显示，取不到才为空。无「网页元素」占位文案，**不重命名、不改动会话存储的标题**。`unofficial_dom` 组，MutationObserver 装饰，React 重渲染后重新清洗 |
| 🔍 开发者工具 | 悬浮球新增「开发者工具」（`F12` / `Alt+Shift+I`）：经 Host `/liuli-window` 路由调用 Electron `webContents.openDevTools({ mode:'right' })`，打开/关闭 Chrome F12 式侧边停靠的 DevTools 窗口（再次触发关闭）；纯 Web 部署返回 available:false 并提示改用浏览器 F12 |
| 🎞️ 会话切换动画 | 切换会话/新消息入场效果（10 选 1）：淡入/上浮/下沉/右滑/缩放/模糊/弹性/级联×2/关闭；插件内 MutationObserver 挂类，动画独立于宿主组件实现；官方会话列（`[data-chat-flow]`）与插件自绘信息流（侧边栏助手 / `/btw` 答案卡等 `[data-liuli-chat-flow]` 列）统一接入级联 |
| 🖥️ 右侧边栏（DSH 侧边面板实现） | 按参考实现源码逐功能说明实现的标签式侧边面板：48px 标签条（搜索标签页概览 + 可拖拽排序标签 + 新增标签下拉），标签类型 审查（参考实现 git pane：未暂存/已暂存/全部分支/上一轮 四源切换 + 折叠 diff）/浏览器（多实例，任意 http/https 网址+自动补全 scheme）/代码查看（图标取自 lucide 定义）/终端（行模式 piped shell，无可见输入框，命令直接显示在终端屏内并本地回显，Windows cmd 风格；面板内不再有工具条，启动 Shell 由「设置 → 功能 → 侧边栏默认终端」统一配置，意外断开自动重连）/开发者工具/辅助对话；关闭激活标签激活右邻、关闭最后一个标签收起面板、最近关闭上限 8、浏览器标签重开换新 id 并取页面标题；**会话内点击前端产物链接（PREVIEW_NAVIGATE）与自动驱动统一「同源复用」**：已有同源浏览器标签则导航复用并激活（不重复开窗、自动跳转到该窗口），无同源标签才新开；**对话页「打开」前端页面文件默认在右侧详细页打开**：会话正文链接（a[href]）、官方工具行的 fileLink / 「打开 <path>」按钮、轮次卡片「打开」按钮——前端页面文件（html / 构建产物目录等，经 resolvePreviewUrl 判定）一律在右侧详细页打开：**Desktop（Electron 壳）下把本地路径转成 `file:///` URL 直接在侧边栏浏览器 webview 里打开**（与参考实现同款：`file://` 不经过 DSH webServer，没有 renderer-token 门，地址栏即本地路径；加载 `http://127.0.0.1:端口/preview/…` 会被宿主安全门 403），**映射为外部 / dev server URL 的同样走侧边栏浏览器标签**（同源复用）；纯 Web 没有 webview（iframe 不能加载 file://），`/preview` 映射回退主窗口 iframe 的「代码查看」标签（token 正常注入、HTML 完整渲染）；非前端文件放行官方默认编辑器打开（`unofficial_dom` 组拦截；侧边栏增强关闭时不接管，避免死点击）；webview 弹窗 new-tab 仍新开；概览弹层加权搜索 + 相对时间；宽度左缘拖拽（min 240px/max 88%/默认 45%，持久化）；**标签组按会话独立记忆**（持久化键 `liuli:side-pane.<会话 id>`，每个会话各自整套标签/激活项/最近关闭，切换会话互不共存；旧版本全局键 `liuli:side-pane` 的标签组在首次访问时一次性迁移给首个会话后清除，之后各会话从空标签组开始）；`Ctrl/Cmd+Alt+B` 切换面板；浏览器面板元素拾取为显式开关；会话切换仅在切换当前会话时收起面板；文件树面板仅存在于 Dockable 布局内（走 `/liuli-sidebar/*`），代码查看走 `/preview` iframe；命令中心 `Ctrl/Cmd+K` 含 切换面板/打开文件 等 16 条命令；标签可**拖入 Dockable 布局**（DockShell）拆分/停靠/合并：**全部标签类型**（审查/浏览器（带 URL）/代码查看（带路径）/终端/开发者工具/辅助对话）拖出即放入布局落点，移动语义（源标签关闭进最近关闭，可概览重开）；拖到面板自身内部仍走内部排序 |
| 📝 对话页编辑 diff | 对话页 edit/write 工具行自动展开并显示文件 diff：上游 ToolRow 默认收起 + 当前 DSH 版本 result 视图/meta 缺失，琉璃按工具参数合成 hunks（window.__liuliDiffCache）注入 +/− 视图；轮次结束在对话流内嵌文件变更卡片（文件名 + DIFF 数量 + 审查/打开/展开打开方式：在资源管理器中打开 · 复制绝对/相对路径），点击审查直达右侧「审查」面板；**卡片头可点击展开/收起**（localStorage 记忆 `liuli:turn-card-collapsed`，默认展开），收起时显示「X 个文件被更改 + 总 diff（+加 −删）」；**对话页所有可点击文件（轮次卡片文件行 + 官方 edit/write 工具行）右键菜单**：在资源管理器中打开（/liuli-reveal）/ 审查（打开侧栏审查面板）/ 复制绝对路径 / 复制相对路径（`unofficial_dom` 组，document 级委托自绘菜单，轮次卡片行经 data-liuli-* 属性直读 path/cwd/sessionId） |
| 📖 审查面板 | 右侧边栏「审查」标签对齐 参考实现 审查(git)功能：顶栏四源切换（未暂存 / 已暂存 / 全部分支更改 / 上一轮更改）+ 刷新；文件列表（文件名 + 目录 + +添加/−删除 统计）可折叠，展开内联 diff（未跟踪文本文件显示纯文本内容）；上一轮更改复用轮次卡片（TurnFileCard）发布的行级 hunk 缓存；右键菜单 打开 / 在文件管理器中打开（/liuli-reveal：explorer /select 等） / 复制绝对路径 / 复制相对路径 / 在文件树中显示；空状态区分 Git 不可用 / 非 Git 仓库 / 当前来源无改动 |
| 🖱️ 工作区/目录行右键菜单 | 工作区行右键弹出自绘菜单（`unofficial_dom` 组）：在资源管理器中打开（Host `/liuli-reveal-workspace` 优先按 workspaceId 经工作区注册表解析目录并打开系统文件管理器；注册表不可用时回退客户端已知的注册路径——两者都限回环同源调用方 + 绝对目录校验）/ 重命名工作区 / 删除工作区；未分组桶（无 workspaceId）匹配不到，自然不弹菜单 |
| 🧭 侧栏「DeepSeek logo」点击后右侧详细页自动收回 | 从会话点侧栏 logoRow 里的品牌按钮（DeepSeek logo + 名称，aria-label 同「新建会话」session.new.label）回开始页时，官方只开新会话（blank 会话使 detailsSession 变 undefined、宿主不触发 closeDetails），右侧详细页保持展开；琉璃等官方流程结束后若详情列仍展开则收回（advanced 走 dock shard、兼容模式走官方列，`unofficial_dom` 组，document 级捕获监听，复用 workspace-new-session-collapse 的 isDetailsOpen 判宽，仅命中 logoRow 内品牌按钮、不误伤折叠钮/新建会话钮） |
| ⚡ 详细页自动展开（LLM 活动感知） | 模型在对话流执行「写/改文件」（`[data-tool="edit"/"write"]`）或「git 操作」（`[data-tool="git"]` / bash 行摘要含 git 子命令）时自动展开右侧详细页并切到「审查」标签，让用户实时看到模型产出（`auto-open-details.ts` 观察对话流 + `AUTO_OPEN_DETAILS_EVENT` 桥接到 PreviewPanel）；**驱动审查时自动切到「上一轮更改」来源并展开第一个修改文件到 diff 区域**（`review-drive.ts` 的 `ReviewDriveRequest` 驱动请求：`source: 'last-turn'` 强制切源 + `resolveDriveTarget` 选目标文件；轮次卡片「审查」按钮仍走 `reviewPath` 自动定位到包含该文件的源）；**每轮只展开一次**（新增最新一条 user/steering 锚点时重置，历史批量挂载的旧锚点不重置）；**用户手动收起后本会话不再自动展开**（PREVIEW_TOGGLE_EVENT 只由手动开合路径 dispatch，自动展开不触发它，收起后延迟读面板 rect 置抑制位，手动打开或切换会话解除）；切换会话（滚动容器重建）重置抑制与轮次并进入 3s 稳定窗口，避开首屏/历史批量挂载；浏览器新标签/导航展开仍走 PreviewPanel 既有逻辑（PREVIEW_NAVIGATE_EVENT / webview new-tab） |
| 🌐 侧边栏浏览器自动驱动（LLM 活动感知） | 模型做前端项目时自动把页面展示到右侧边栏浏览器（`auto-drive-browser.ts` 观察对话流 + `AUTO_DRIVE_BROWSER_EVENT` 桥接）：① bash 工具行启动 dev server（vite / next dev / serve / http.server 等，摘要关键词命中后才临时展开 disclosure 读取输出，读完即收起）时解析输出里的本地地址（Vite/Next/CRA「Local:」、webpack「Project is running at」、serve「Local:」、python「Serving HTTP on … port N」、php -S 等，`0.0.0.0` 归一为 `localhost`），自动在侧边栏打开浏览器标签并展开面板；② 前端文件（html/tsx/jsx/vue/css 等；已有 dev server 时放宽到 .js/.ts）被 edit/write 且本会话已知 dev server 地址时，每轮最多一次把浏览器标签导航回 dev server 根地址（无 HMR 的静态服务也能看到最新页面）；同源已有浏览器标签时**导航复用**、否则新开标签，避免标签爆炸；控制策略与详细页自动展开一致（每轮一次 / 手动收起抑制 / 会话切换重置 / 3s 稳定窗口），设置项 `auto_drive_browser`（功能分区，默认开启）可整体关闭；agent 用 `scripts/browser-client.mjs open --show` 创建的 `browser:*` 引擎标签经 PreviewPanel 轮询桥接（4s）自动出现在侧边栏（agent 驱动浏览器 → 用户实时可见），不带 `--show` 的 agent 标签保持隐藏（无头验证用）；纯逻辑（dev server 输出解析 / 摘要关键词 / 前端文件识别）单测 `demo/test-auto-drive.ts` 34 项全绿 |
| 🌐 内嵌浏览器（DSH Desktop IAB 实现） | Electron 宿主优先使用 `<webview>` DOM 标签承载（需 `pnpm patch:desktop`/自动补丁把主窗口 `webPreferences.webviewTag` 置 true，重启后生效；DOM 标签可被 CSS `overflow:hidden` 裁剪，拉伸面板不溢出）；webviewTag 未启用时回退 WebContentsView 承载；两者均使用独立会话分区 `persist:liuli-embedded-browser`、任意站点可开、弹窗自动转新标签、崩溃原位重建、favicon 同步；工具条与参考实现逐项对齐（前进/后退/刷新/地址栏/响应式视口 320..3840×2160 + fit..200% + 拖拽手柄/元素拾取/更多：外部打开+开发者工具）；纯 Web 部署自动回退 iframe + `/liuli-proxy`；agent 自动化 CLI `scripts/browser-client.mjs`（open/goto/snap/click/fill/shot…）对应 browser-use 插件，详见 `docs/browser-use.md` |

| 🪟 无边框模式兼容 | 兼容 DSH Desktop advanced（无边框/页面内标题栏）模式：桌面 shell 表面别名挂载上游结构类名（`liuli_frame`/`liuli_sidebarCol`/`liuli_centerCol`/`liuli_detailsCol`），浮动卡片/亚克力材质/壁纸/列留白等配方自动复用；另补表面透明、帧背景令牌迁移、macOS 红绿灯留白与侧栏内联宽度修正，观感与兼容模式对齐 |
| 🧱 Dockable 布局（现有布局停靠化） | advanced 桌面壳与 **Web UI（纯浏览器/兼容模式）** 下都把宿主既有三列布局**本身**改造成 dockable 停靠布局：琉璃以更低渲染优先级接管 root slot（`dock-shell-frame.tsx`，子 slot 声明 advanced 归桌面 shell、Web 归官方 AppFrame——两者声明同一套 slot；Web 下另经官方 `LayoutController.attachPanels` 把 `ctx.layout` 面板动作重定向到琉璃同构 store，官方侧栏折叠按钮/详情开合继续生效，`createWebHostLayout` 逐条对齐官方 store 语义），**侧边栏/会话/详情三大区域成为可拖拽面板** —— 拖拽（pointer 命中 + 幽灵 + 落点指示器）、四向拆分、边缘/面板内停靠、浮动窗口（移动/缩放/一键回收；无边框去掉 caption 行后改由 ⧉ 一键浮动——单标签面板悬停抓握簇、多标签 chip）、标签页合并、sash 缩放（像素级 clamp：普通卡 240×160、会话列 640，手柄不越过相邻卡片）；同向拆分目标优先**兄弟插入**、旧布局同向嵌套自动拍平（`[ [详情,侧栏], 会话 ]` → `[详情,侧栏,会话]`，相邻区域保持直接 sash）；全部子级都固定的同向 split 在父级按固定宽度处理（收起后不产生空白、侧栏贴边正确）；详情区域与宿主 layout 服务双向联动（`openDetails/closeDetails` ⟷ 面板加入/移出右缘）；扩展面板（文件树/Git/终端/代码/预览/浏览/便签/开发者工具/辅助对话）可混排，非区域面板与浮动窗口采用与对话页/左侧边栏一致的亚克力卡片材质（48px 标签条 + 卡片外框 + 内容留白；卡片留白/圆角按统一规范：普通 dock 面板默认四边留白+圆角，上下堆叠时下方卡片底部触底去圆角；侧边栏/详细页按左右方向镜像（边缘侧贴边去圆角，中间四边留白+圆角）；详细页在下方无卡片时底部触底去圆角；默认三区域保持桌面 shell 原生表面；侧栏在非原生位置收起时 shard 自动补 dock 留白，收起 rail 宽度与原生一致）；dock 布局按会话记忆（切换会话恢复各自布局）；接受**右侧标签面板标签的 HTML5 拖入**（拖拽时显示落点指示，drop 即按落点拆分/合并/停靠，源标签移动进布局）；**会话页头独立 dock 面板**：默认把会话列拆成 `region:conversation-header`（页头）与 `region:conversation`（正文）两个上下排列的 dock 面板，页头面板使用亚克力卡片材质、可像普通面板一样拖拽/四向拆分/停靠/浮动/标签合并；官方 ConversationRoot 渲染出的 `<header>` 由 `syncConversationHeader` 在 DOM 层搬入页头面板宿主（useLayoutEffect + MutationObserver 同步，绘制前完成），页头面板缺失时自动搬回正文面板；旧布局恢复时自动补挂页头面板到会话上方；**开始页（官方 blank session）自动隐藏页头面板及其相邻 sash**（官方会给 header 加 `aria-hidden`，琉璃据此把整个页头面板 display:none，避免开始页顶部出现空 header 卡片）；**布局保存/恢复**：dock 树自动落 localStorage + 命名槽位 + JSON 导出/导入，刷新/HMR 重载原样恢复；Web 壳样式由 `WEB_DOCK_SHELL_CSS`（桌面 ADVANCED_STYLES 的最小等价物 + 外观配方镜像）提供，以 `[data-testid="dock-shell"][data-shell-mode="web"]` 作用域与原生壳互不干扰；GUI 自测 `demo/verify-dock-shell-gui.mjs`（S1..S16 全交互含热重载存活）与 `demo/verify-dock-shell-web.mjs`（Web UI 挂载/开合/拖拽） |
| 🎛️ 页面内窗口按钮 | 无边框模式三按钮（最小化/最大化·还原/关闭）移入页面：会话 header 最右端常驻 + 开始页固定窗口右上角的磨砂胶囊兜底（win32 已移除 32px caption 行，内容顶格铺满；该胶囊同时是窗口拖动区，承接原标题栏拖拽职能）；经 Host `/liuli-window` 路由直驱 Electron 窗口（close=收进托盘，与原生同语义）；Win+方向键贴边/双击拖动区最大化等系统行为保留；**窗口拖拽区 = 各贴顶卡片顶部条带**（每张卡片自己的“迷你标题栏”）：会话页头 header / 侧栏 logoRow / 详情标签条 / dock 标签条 / 开始页顶部条均可拖窗，内部交互元素 no-drag 挖洞保持可点（不依赖匹配列表，布局任意列数通用） |
| 🔤 主题字体 | CSS `@import` 加载 MiSans / Inter / Space Grotesk / JetBrains Mono（字体族令牌早已引用，官方 harness 不注入 link，由插件自行加载） |
| ⚙️ 设置「外观」「功能」两个分区 | 「外观」：取色/状态色来源/背景/材质/字体/圆角/面板留白/泛光/阴影/壁纸（上传/适应/自定义选区）；「功能」：宽边模式/会话切换动画/自动驱动侧边栏浏览器/**侧边栏默认终端（终端面板启动 Shell：cmd / Windows PowerShell / PowerShell 7 / Git Bash，去掉面板内工具条后的唯一设置入口）**/声纹响应（总开关 + 参数 30 项：检测 15 项 + 波形外观与细节 15 项，收进「高级设置」折叠区，默认收起、展开后才显示，总开关关闭时联动禁用）**/模型请求重试/切换会话默认历史加载/**思考等级自动补全**/非官方增强（兼容其它插件）总开关 + 五组开关。即时生效、自动保存；状态色来源支持硬编码内置红绿橙或 MCU 取色（success=primary / warn=secondary / error=tertiary） |
| ⚙️ 设置页原生下拉升级 | DSH「模型服务商」卡片里的原生 `<select>`（API 协议 / 新增提供商等，宿主 class 后缀 `_selectInput`）统一换成琉璃下拉组件：宿主 select **原位隐藏**（`opacity:0`，保留布局、可聚焦性与键盘/值语义），上方覆盖插件触发器（body portal + fixed，坐标随滚动/窗口缩放/`details` 折叠实时同步，滚动出可视区或折叠时自动隐藏）；点击打开插件菜单（body portal + fixed，与终端 Shell 选择器同款观感：亚克力材质/圆角/勾选/分组头/禁用项，z-index 与其它浮层同档）；选择经原生 value setter + `change`/`input` 事件写回宿主受控表单（React onChange → setState → 渲染回写选项），不修改、不搬动宿主 DOM、不改宿主源码；随「非官方增强 → DOM 观察增强」开关挂载 |
| 🧠 思考等级自动补全 | 自定义提供商（`llm-pi-ai.providers.<路由>`，经 DSH「模型提供商」页面或 settings.yaml 添加）手工声明时**不会自动带思考等级**——`dsh-llm-pi-ai` 对未声明 `reasoningEfforts` 的模型完全不开放思考档位。功能分区「思考等级自动补全」行：**新添加的提供商自动补全**（客户端监听 `settings/document-updated` 事件，`liuli:thinking-fill-seen` 记录已处理路由，只补新出现的路由、不动历史配置）；历史缺声明的用「一键补全」手动补齐。补全内容：缺声明的模型补写 `reasoningEfforts`（off/low/medium/high/max，wire 值 = 档位名，off 留空，与用户既有声明一致），提供商级缺 `compat.thinkingFormat/supportsReasoningEffort` 时补 `{ thinkingFormat: 'openai', supportsReasoningEffort: true }`（合并保留其它 compat 字段）；写入走 path-addressed `settings.mutate`（与模型重试行同构，只写缺失键、不碰密钥等字段）；显式 `reasoningEfforts: false` 的模型与完全无 compat 且全部模型显式关闭思考的提供商跳过（视为故意关闭）；`modelOverrides` 条目同样补全。纯逻辑单测 `demo/test-thinking-fill.ts`（48 项） |
| 🗂️ 对话历史加载增强 | 切换会话时按功能设置「默认加载轮数」自动补载更多历史（宿主基线约 2 轮，调大后自动点击 older 按钮）；上翻到消息列顶部自动加载更早消息，替代手动点击 |
| 🚀 缩放性能护栏 | 长对话下 sash / 窗口缩放防掉帧（`resize-perf.ts`）：宿主 ui-deliverables 给每行「产物」注册 RO，回调内反复强制回流，列宽逐帧变化时每帧 O(产物行数) 次全量回流——缩放开始冻结产物行宽度使其 RO 不触发、结束后定时器分批解冻；磨砂 backdrop-filter 缩放期渐隐（~140ms 缓动到恒等滤镜）再由 `body[data-liuli-blur-off]` 接管 none、松手渐回，避免重采样又无生硬闪变；窗口 resize / 宿主原生手柄同样纳入护栏；配套：TurnRail 滚动跟随改单次锚点索引（O(轮数×DOM)→O(DOM)）并在缩放期让位、HeaderEffects 的 mask 仅在纵向几何变化时重建、WindowControls 遮挡检测缩放期让位、DockShell sash 拖拽直写 shard 样式松手才提交布局、对话流条目 `content-visibility:auto`（屏外跳过布局/绘制）。实测 338 条目/6.5k 元素：48 步拖拽主线程占用 10.2s→1.2s（`demo/inspect-sash-perf.mjs`） |
| ⚡ 全局交互性能 | Dock 拖拽提示独立渲染，指针移动不再重绘整窗槽位；TurnRail 滚动按动画帧更新并缓存消息锚点；旧统计行观察器在新版停用；标题、标记和元素卡片观察器只响应相关 DOM；右上角窗口控件仅在触发区进出时检测遮挡；声纹无音频时降到约 30 FPS，音频响应仍逐帧。大型磨砂层仍沿用现有材质，前台 FPS 需在实际窗口测量 |
| 🧩 官方交付物卡片观感对齐 | 宿主 ui-deliverables 渲染的「交付物卡片」（`[data-presented-file]`）与「产物」行（`[data-produced-files-row]`）在琉璃下的观感：卡片、48px 文件图标框与「打开 / 更多」胶囊（split，官方 `--dsw-alias-button-floating-fill` 浮动实底）**全部透明**，hover 只留极淡品牌底；透明后没有底色托底，卡内三级描边（卡片 l1 / 图标框 l2 / 「打开」胶囊与分隔线 l3）**统一成一条与文字同源的描边色**（`color-mix(label-primary 22%)`，暗色主题浅、亮色主题深，两种主题都可读）；文件类型图形换成 **Material Symbols 单色图标**（PDF / 图片 / 表格 / 幻灯片 / 视频 / 代码 / 文件夹 / Markdown / HTML / 文档，mask 绘制）；同时把 `--dsw-alias-link` 映射到品牌色（亮 `#0079bf` / 暗 `#8ecdf8`，动态取色下随 M3 调色板自动同步），链接文字、文件图标与 Material 图标随之跟随主题色；纯 CSS 覆盖（宿主 `data-*` 锚点 + 类名后缀 + `:has()`），不动宿主 DOM、不新增观察器，同一屏的 `TurnFileCard.btn`（「审查 / 打开」药丸）也去实底、走同一条描边；统一细描边提升为全局令牌 `--liuli-border-hairline`；仅出现在 `liuli.css` / `liuli-css.ts` / `TurnFileCard.module.css` |

全部设置随浏览器持久化（`liuli:settings` / `liuli:wallpaper` / `liuli:header-height`）；DSH Desktop 因每次重启 Web 端口会变（localStorage 按 origin 隔离），还会额外同步到 Host 端 `~/.liuli-theme/settings.json`，跨重启不丢失。

> **页面内窗口按钮（无边框模式）**：系统最小化/最大化/关闭三按钮移入页面——会话 header 最右端常驻、开始页兜底为标题拖拽条右上角的磨砂胶囊；动作经 Host `/liuli-window` 路由直驱 Electron 窗口（close 收进托盘，与原生同语义）。依赖对 DSH Desktop 的窗口参数补丁（`resources/app.asar.unpacked/lib/electron-runtime-*.js` 的 win32 advanced 分支：`titleBarStyle: "hidden" + titleBarOverlay` → `frame: false`），应用重启后生效；未打补丁时原生覆盖按钮仍在，页面内按钮与其并存。自动补丁为尽力而为：失败仅告警、不阻断插件加载。macOS 保持原生红绿灯不动。

## 非官方增强与插件兼容（功能分区开关）

为了与其它 DSH 插件共存，功能分区提供「非官方增强」总开关与四个分组开关（默认全部开启，行为不变；改动后**刷新页面生效**，Host 半开关随设置文件跨重启生效）：

| 开关 | 覆盖范围 | 潜在冲突面 |
| --- | --- | --- |
| 总开关 `unofficial_enabled` | 关闭后仅保留官方扩展点功能（主题 / 声纹 / 设置页），以下五组全部不挂载 | — |
| Dockable 布局改造 `unofficial_layout` | 接管宿主 root slot（三栏拖拽/拆分/浮动；advanced 桌面壳与 Web UI 均生效）、会话页头独立面板、conversation-split、桌面 shell 别名类 | 抢占 root slot / 移动 React 管理的 DOM |
| 桌面宿主补丁 `unofficial_desktop` | 自动补丁 DSH Desktop（无边框 / webviewTag）、页面内窗口按钮、系统回环音频授权；**关闭时自动还原已打的补丁（原生标题栏回归，需重启 DSH Desktop 生效）** | 改写 `app.asar` / 安装全局 `setDisplayMediaRequestHandler` |
| 右侧边栏（详细页）`unofficial_sidebar` | 新版官方 `rightbar` 槽位默认保留官方服务并显示琉璃四向 dock；旧版沿用 PreviewDetailsPanel，均含审查/浏览器/终端/代码查看/开发者工具/辅助对话等面板及自动展开 | 新版以隐藏官方 surface + 当前活动 tab 桥接兼容官方入口，升级时需复核官方 tab kind；旧版占用宿主 details 列 |
| 内嵌浏览器 `unofficial_browser` | Host 浏览器引擎（WebContentsView）、侧栏浏览器标签、模型活动自动驱动 | webviewTag 补丁 / 原生视图 |
| DOM 观察增强 `unofficial_dom` | 悬浮球、自动展开、入场动画、会话标记/右键菜单、重命名、设置页原生下拉升级、缩放性能护栏、/side /btw 等 | MutationObserver 观察宿主 DOM / 自有 overlay |

实现要点：

- 客户端在启动时同步读取 `liuli:settings`（localStorage）决定各挂载点是否生效；关闭的组**完全不挂载**（不留观察器、不接管布局），而非仅视觉隐藏。
- Host 半在启动时同步读取 `~/.liuli-theme/settings.json`，只门控有真实副作用的动作（frameless 补丁、音频授权 handler、浏览器引擎、/side /btw 指令注册）；各 `/liuli-*` 数据路由（额度/设置/预览/侧栏/终端/代理/窗口/音频探测）保持注册——它们是被动 HTTP 端点，不与其它插件冲突。
- **无边框补丁还原**：`unofficial_desktop` 关闭时，插件启动会把 electron-runtime 里的补丁块还原为 DSH Desktop 的**原始窗口参数**（`titleBarStyle: "hidden"` + `titleBarOverlay: { color: "#00000000", symbolColor: "#7f858f", height: 32 }`，即 win32 advanced 分支未打补丁前的原值）并移除 webviewTag、重建 asar 头；幂等、尽力而为，失败仅告警。手动等价命令：`pnpm patch:desktop --revert`。生效需重启 DSH Desktop 一次。
- DSH Desktop 重启后首载页面 localStorage 为空时，客户端会从 Host 拉取上次保存的设置；若其中的非官方开关与启动默认值不一致，页面自动重载一次让开关真正生效（sessionStorage 防循环）。

### 开发原则：主题与功能解耦、兼容其它插件

- **主题 = CSS 令牌层**：色彩/材质/字体/圆角/留白/阴影/壁纸全部收敛到 `--liuli-*` 变量（映射 `--dsw-alias-*`）与 `liuli.css` / `liuli-css.ts`；功能代码不得硬编码外观值（颜色/尺寸/圆角），一律经 CSS 变量或 `getComputedStyle(document.body)` 读取。
- **功能 = 独立行为模块**：dock / 侧栏 / 浏览器 / 额度 / 审查 / 自动展开等相互独立、可单独开关（见上表开关组）；任何功能都不应依赖「主题开启」才能工作，主题层也不得依赖功能模块的 DOM 结构。
- **兼容其它插件**：自有标识全部带 `liuli` 前缀（Host 路由 `/liuli-*`、事件 `liuli:*`、CSS 变量 `--liuli-*`、DOM 属性 `data-liuli-*`、localStorage 键 `liuli:*`）；CSS 覆盖作用域化，禁止宽泛全局选择器；新能力默认纳入开关组（关闭时完全不挂载）；不移动宿主 React DOM、不写全局 `*` 规则；上线前验证与其它插件共存。

### 供应商额度凭据

- **DeepSeek**：读取 `DEEPSEEK_API_KEY` / `DEEPSEEK_OFFICIAL_API_KEY`，请求 `https://api.deepseek.com/user/balance` 显示余额。
- **OpenCode Go**：读取 `OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY`，请求 `https://opencode.ai/zen/go/v1/usage` 显示 5 小时 / 本周 / 本月套餐额度。
- **new-api / one-api 中转站（zero.cat 及任意同类站点）**：读取该站点的「系统访问令牌」凭据（**不是** `sk-` 开头的 API key），请求 `{base}/api/user/self` 取 `data.quota`，再除以 `{base}/api/status` 的 `quota_per_unit`（默认 500000）换算成货币余额；货币符号按 `quota_display_type` 判定（USD → `$`，CNY → `¥`，CUSTOM → 站点自定义符号，TOKENS → 直接显示 quota）。
  - **站点自动识别**：provider 名匹配 `zerocat` / `zero`（含 `pi-ai:zerocat` 这类命名空间前缀）时走快速路径，默认站点 `https://zero.cat`（环境变量 `ZEROCAT_BASE_URL` 可覆盖）；其余 provider 由通用兜底读其 `baseURL`，让 Host 侧探一次 `/api/status`，看到 `quota_per_unit` / `quota_display_type` / `display_in_currency` 指纹才认定为 new-api 站点，然后按 host 查询 —— **新增 new-api 站点零配置**。
  - **凭据 ref 规则**：`zero.cat` 沿用历史 ref `ZEROCAT_ACCESS_TOKEN`（向后兼容）；其它站点按 host 派生 `NEWAPI_TOKEN_<HOST_UPPER_SNAKE>`，例如 `api.example.com` → `NEWAPI_TOKEN_API_EXAMPLE_COM`。
  - **SSRF 防护**：Host 侧只接受 https 点分域名，拒绝 IP 字面量、`localhost`、`*.local` / `*.internal` 等后缀，以及 10/127/192.168/172.16-31/169.254/100.64 等私网与保留网段。
  - ⚠️ 切勿调用 `{base}/api/user/token`：该接口会重新生成 access token，让用户手里的旧令牌立即失效。
- **Command Code（`@mars-sea/dsh-commandcode-provider` 第三方 provider 插件）**：数据由对方插件自己的 Host 半经 `commandcode/report` Remote 提供（它内部打 `/alpha/whoami`、`/alpha/usage/summary`、`/alpha/billing/credits`、`/alpha/billing/subscriptions`），琉璃**不接触其 API 密钥**，只读它已经校验过的展示字段：5 小时窗口与每周窗口显示「已用 / 上限」+ 细进度条（悬停给出重置时间与超限提示）、月额度显示套餐内含额度、信用显示「已购 + 赠送」合计（悬停给出构成明细）。
  - **接入方式**：`ctx.inject(['remote.commandcode'], …)` 等待对方挂载的命名空间服务，拿到后把 `report()` 交给额度控制器；对方插件停用/卸载时服务消失，回调清理并让页头隐藏额度。刻意不写进包级 `inject`——对方插件缺席时那会让启动图死锁。
  - **多账户轮换**：报告按账户返回，页头展示当前生效账户（`active`），其次第一个已配置账户；悬停标题带账户名、套餐名与本周期花费。
  - **刷新节流**：`report()` 一次要打 4 个上游端点，因此结果按 60 秒 TTL 缓存、并发调用合并为一次请求（切会话/设置变更/重连不会变成对上游的轮询）。
  - **失败表现**：账户全部端点失败时（`blocked`）页头显示「额度不可用」并在悬停给出原因（密钥被拒 401 / 服务 5xx / 网络不可达）；字段缺失则隐藏页头，不报错。

密钥只在 Host 侧 `/liuli-quota` 路由中通过 credentials/env 解析，不会进入浏览器 bundle。

**配置入口**：new-api 站点的「系统访问令牌」可直接在 DSH 设置 →「模型服务商」里配置 —— 琉璃会在 provider 编辑表单（API Key 字段下方）注入一行「余额令牌」输入框，站点地址从表单已有的 baseURL 自动读取并经 Host 探测确认，不用重复输站点，插件也不用登记站点清单。令牌经 Host 侧 `POST /liuli-quota {host, token}` 写入 credentials，浏览器只拿得到「已配置 / 未配置」状态、从不回显明文；留空保存即清除。该注入随「非官方增强 → DOM 观察增强」开关挂载（`quota-token-inject.ts`）。

### 模型请求重试的范围

重试由宿主 `@deepseek-ai/dsh-llm-retry` 在 `agent/request-error` 扩展点上执行，策略取自每个 provider profile 的 `retryPolicy`；`mode: normal` 时**只有 `failure.code` 命中 `retryableCodes` 才会重试**（`lib/index.js` 的 `recover()`）。

- 宿主默认 `retryableCodes` 只有 5 类：`EMPTY_RESPONSE` / `RATE_LIMIT` / `SERVER` / `TIMEOUT` / `TRANSPORT`。
- pi-ai 适配器（`dsh-llm-pi-ai` 的 `classifyPiAiError`）按错误文本分类：401/403 → `AUTH`，429 → `RATE_LIMIT`，5xx → `SERVER`，timeout → `TIMEOUT`，网络/流中断 → `TRANSPORT`，**其余一律 `PI_AI_ERROR`**；宿主对非 `HarnessError` 抛出值标 `UNKNOWN`。
- 因此「上游中断 / 流异常结束 / 非标准错误文本」，以及**中转站用 400 报的渠道故障**（→ `INVALID_REQUEST`）默认一次都不重试 —— 这是「本轮运行失败」最常见的来源。
- 功能分区「模型请求重试」行的开关**「重试上游中断与 400 错误」**开启后，把 `PI_AI_ERROR` / `UNKNOWN` / `INVALID_REQUEST` 并入 `retryableCodes`（写 `RETRY_BASE_CODES + RETRY_EXTRA_CODES`）；关闭时不写该键，回到宿主默认列表（宿主升级后默认变化也能自动跟上）。确定性失败（`AUTH` / `QUOTA_EXCEEDED` / `CONTEXT_WINDOW_EXCEEDED` / `ABORTED`）刻意不纳入。

## 与宿主 shell 的配合（官方 harness 兼容）

主题完全自包含，只在官方 harness 已有的扩展点上挂载，不依赖任何未发布的自定义 slot 或组件改动：

- `dsh-client-ui-conversation`：header 的 `actions` / `utilities` 两个官方 slot 是全部 header 组件的挂点（声纹、主题切换、额度、拉伸手柄、回合导轨、预览按钮——组件把内容 portal 到自己的锚点，挂载点仅作生命周期）。会话切换动画不依赖宿主挂类逻辑：插件用 `MutationObserver` 直接在消息列新增节点上挂入场类；消息列同时识别官方会话列（`[data-chat-flow]`）与插件自绘信息流列（`[data-liuli-chat-flow]`，侧边栏助手 / `/btw` 答案卡，含各级行组件 `data-liuli-chat-anchor-key`），自绘列与官方列共用同一套级联触发与去重护栏。
- `dsh-client-ui-layout`：悬浮球是插件自有 overlay（独立 React root + fixed 定位）；右侧边栏面板占用宿主 `details` 布局列（`priority: -1` 替换官方工具详情列），随布局动画从右侧展开/收起。
- `dsh-client-ui-theme`：Appearance 外观行点击时 dispatch `liuli:set-theme`（带坐标），由本插件的事件桥接 `startViewTransition` 圆形遮罩；桥未就绪时降级直连切换。
- `dsh-host-webserver`：node 半注册 `/liuli-quota` 与 `/preview` 两条前缀路由。
- 主题观感（令牌、材质、圆角、侧栏/设置浮层样式）全部在插件的 `liuli.css` 内以 CSS 变量与选择器覆盖实现，不改任一宿主组件源码。

### 第三方插件设置分区的样式适配（Jet Hub）

Jet Hub 是第三方插件 `dsh-codearts-auth` 注册的设置分区（`settings.section`，id `jet-hub`），自带一套独立设计语言（品牌色写死 `#1677ff`、卡片走 `bg-layer-3` 实底、provider 图标垫纯白底、分隔线读 `border-default`）。琉璃在 `liuli.css` / `liuli-css.ts` 末尾以「第三方插件 Jet Hub 设置分区适配」一组规则把它收进琉璃语言，**不改对方插件源码**：

- **锚点自包含**：作用域用 `body:has(.dim-jh-page)`，不依赖 `body[data-liuli-settings-open]`。后者由 `isSettingsOverlayOpen()` 维护（要求设置遮罩位于 `[class*="_sidebarCol"] > div > [class*="_root"]` 内），而实测当前 DSH 版本里 `_sidebarCol` 经常不存在（设置遮罩改挂在 `dshDesktopUpstreamSidebar` 下），该属性因此**间歇性缺失**——依赖它会让整组适配随机失效。
- **只锚定 `.dim-jh-*` 自有前缀**：该插件手写全局类、无哈希，前缀全仓唯一，不与官方哈希类名或其它插件撞名，因此不需要 `div[class*=...]` 一类宽选择器。
- **收敛的问题**：品牌色 / 成功 / 警告 / 危险全部换语义令牌（跟随动态取色与亮暗主题）；账号卡从实底改标准亚克力配方（`::before` 材质层 + strong 档磨砂），拖「材质不透明度」滑条对本分区生效；provider 侧栏从自绘「实底卡 + 亮蓝描边」对齐官方设置导航（同用 `--dsw-specific-sidebar-nav-item-active/hover` 与 40px 行高）；页头第二个关闭入口弱化为 ghost 按钮、去掉与官方 header 重复的底边线；内容面板收回与官方 `.MI-_Aa_options` 叠加的 24px 留白；操作按钮改「工具组 | 主操作」两段式（`data-kind="primary"` 的「+ 新建账号」用 `margin-left:auto` 推到行尾，不用位置选择器——按钮个数随 provider 变化）。
- **窄窗护栏**：provider 侧栏由写死 `width:200px` 改为可收缩（下限 132px）+ 内容面板 `min-width:240px` 保底。默认 800px 宽度下逐像素不变（217px），窄窗时侧栏收缩、按钮不再横向溢出。
- **配套修复（功能性）**：模型列表弹窗靠 `position:fixed` 覆盖全屏，但设置模态面板根原先直接持有 `backdrop-filter`（「浮动卡片统一补磨砂」一节），使其成为 fixed 后代的包含块，弹窗被压扁成面板大小（实测 overlay `[880,116,800,800]`，视口 `2560×1032`，右下半截被裁）。已把该规则的面板根 `backdrop-filter` 置 `none`；材质不会丢——同一选择器的 `::before` 规则已用独立层承担同一份亚克力配方（style-guide §5.1 对「可能含 fixed 后代的卡片」要求的结构）。修复后 overlay 恢复 `[0,0,2560,1032]`。


## Model Experience

### 元素选择器引用 chip

#### What the model sees

元素选择器生成的引用 chip 经 `@` 触发源与 `ReferenceCodec` 序列化后插入输入框，随用户消息提交，成为该消息中的模型可见引用内容。主题视觉、声纹、壁纸与界面设置只影响浏览器渲染，不进入任何模型请求。

#### Token effect

主题本身不占用 token；仅当用户把引用 chip 作为消息发送时，chip 携带的元素文本与标识计入该条用户消息的 token。

#### KV Cache effect

chip 内容随用户消息成为对话前缀的一部分，与普通用户消息同样参与后续 KV 缓存；主题渲染与 `liuli:*` 本地设置不改变 KV 缓存。

## Known Limitations and Deferred Work

- 纯浏览器插件，只在 web 平台生效；无头、ACP 等无界面的会话看不到主题效果。
- 纯 Web 部署下，设置、壁纸与 header 高度只存 `localStorage`，清除站点数据或更换浏览器/设备不会同步；DSH Desktop 部署会额外经 Host `/liuli-settings` 写入 `~/.liuli-theme/settings.json` 以跨 ephemeral 端口重启保留。
- 声纹监听只捕获系统音频，不降级麦克风：Web 端依赖 `getDisplayMedia` 用户授权（共享「整个屏幕」并勾选「分享系统音频」）；DSH Desktop（Windows）由 Host 半安装 `setDisplayMediaRequestHandler` 直接授予系统回环音频（`audio:'loopback'`，点击即监听、无选择器），`audio: 'loopback'` 是 Electron 官方标注的 Windows-only 能力，其他平台的 Desktop 仍走默认 getDisplayMedia 行为。
- 壁纸以压缩 JPEG dataURL 持久化，受 `localStorage` 配额限制；超大原图会先压缩再保存。
- 会话切换动画是 DOM 观察层实现（消息节点挂类），并非宿主组件级动画：流式更新触发的部分节点重挂载也会再次入场，与宿主组件的缓存策略无关。去重与重播护栏：**不存在批量冷却**（pending 只收集本批新增锚点、从不对既有行重播，冷却反而会造成分批渲染/切换时部分或全部组件丢失动画直接整块出现）；同 key 移除后 2.5s 内重新挂载（React 替换重挂载、整列重挂载的“加载完成替换”）直接显示不重播，避免加载完又播一次；**视图切换窗口 15s**——列内锚点被移除后该窗口内同列追加的新内容（含快速 A→B→A、自绘面 `useId` 前缀序号归零复用的 key）统一视为新视图、一律重新级联入场，同 key 抑制在切换路径上作废；切换时按 isConnected 用新节点顶替旧视图残留的 pending 项，同 key 不阻塞新内容。级联只对视口内可见锚点播放（视口外直接显示），长会话切换不会同时启动上百个动画。列创建后 3s 内走初始稳定窗口（400ms 防抖合并、配合“收集即隐藏”锚点从挂载起即透明待入场），React 分帧提交的首屏与历史批次会合并为同一批级联动画，避免第二批被跳过导致“整块出现”。
- 插件自绘信息流（侧边栏助手面板、`/btw` 答案卡内的 `ChatFlowView` 信息流与流式尾部）通过 `data-liuli-chat-flow` 列属性 + 各行 `data-liuli-chat-anchor-key` 锚点接入同一级联动画系统：行节点（用户气泡、工具结果卡、上下文/错误/命令行）随 `transition_effect` 级联入场，列容器级元素（卡片头）保持即时出现。助手消息是**子列**（自身 `data-liuli-chat-flow`）：消息内各块（文本/Think/图片/未知块）各自锚定 `data-liuli-chat-anchor-key`；文本块额外标记 `data-liuli-cascade-text`，观察器收集其内部 markdown 块级元素（顶层段落、代码块、列表、引用、表格、标题）**逐段入场**——文本不再整块一次动画，多段回答会像回合刻度一样逐条浮现（收起态 Think 行仍随所在块整体入场，与官方信息流一致）。`prefers-reduced-motion`、`transition_effect=none` 与去重护栏同样生效；块/单元 key 以 `useId` 前缀（`<surfaceId>:<seq>:b<i>` / 文本单元 `…:u<j>` / 流式 `…:partial:b<i>`）隔离多卡片实例与会话序号归零，避免全局 `removedKeys` 误判。
- 右侧边栏面板占用宿主 `details` 布局列，会替换官方工具详情列（工具调用详情不再显示在右侧列）；`/preview` 与 `/liuli-sidebar` 路由只接受 loopback/同源 Host（局域网部署需额外配置信任域名，当前未开放该选项）。浏览器模式直接 iframe 加载 `localhost`/`127.0.0.1` 地址，若目标 dev server 未允许被 iframe 嵌入则可能显示空白；面板内的元素拾取要求 `/preview` 与页面同源（默认满足）。
- 会话侧栏行标记：通过会话行右键菜单「添加标记」写入进行中/待办/已完成（localStorage key 与官方一致）；图标由插件覆盖层注入，并复用右键菜单同一套官方图标，保证预览与实际一致。官方树行不暴露稳定 session id，插件用当前会话/标题匹配反查，极端重名场景可能定位不准。
- 正式设置分区中仍有一组规则以 `body[data-liuli-settings-open]` 为作用域（`settings-models` / `settings-plugins` 的圆角、磨砂输入面、`rowCard` 等约 16 条）。该属性由 `isSettingsOverlayOpen()` 维护，其判定要求设置遮罩位于 `[class*="_sidebarCol"] > div > [class*="_root"]` 内；实测当前 DSH 版本里 `_sidebarCol` 经常不存在（设置遮罩改挂 `dshDesktopUpstreamSidebar` 下），属性因此间歇性缺失、那组覆盖会随之失效。这些分区的**主要观感不受影响**（材质由不带该前缀的 `[class*="_overlay"] > [class*="_panel"]::before` 规则承担），受影响的只是圆角归位与输入面磨砂等细节。修法是把判定改成不依赖 `_sidebarCol` 的锚点（如按 `[class*="_settingsArea"]` 或 `.MI-_Aa_overlay` 反查），属独立于本次第三方适配的后续项；Jet Hub 适配已按自包含锚点（`body:has(.dim-jh-page)`）落地，不受此缺陷影响。
