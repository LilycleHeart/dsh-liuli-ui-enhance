# ZCode 右侧边栏（侧边面板 / 切换面板）复刻对照表

> 依据 ZCode 本机安装（C:\Users\27280\AppData\Local\Programs\ZCode）解包实测：
> `resources/app.asar` → `out/renderer/assets/styles-*.js`（渲染 bundle）与 i18n 字典逐段对照；
> 辅以官方文档 [任务与文件管理](https://zcode.z.ai/cn/docs/task-management)、
> [ADE 工具](https://zcode.z.ai/cn/docs/ADE-tools)、[快捷键表](https://zcode.z.ai/docs/keyboard-shortcuts)。
>
> ZCode 右侧边栏是「侧边面板（side pane）」：一条 48px 标签条承载多个可切换面板标签，
> 标签可新增 / 关闭 / 拖拽排序 / 搜索概览，面板可收起 / 展开 / 扩大 / 拖宽。
> 本插件在 DSH 宿主右侧 `details` 布局列上 1:1 复刻该结构与交互。

## 入口与快捷键

| ZCode | liuli-theme | 状态 |
| --- | --- | --- |
| 标题栏「切换面板」按钮（panel-right-open/close 图标） | header utilities 同形按钮，图标路径取自 ZCode bundle lucide 定义，激活态高亮 | ✅ |
| Ctrl/Cmd+Alt+B 切换右侧面板 | 全局 keydown 捕获同键位；tooltip 标注「切换面板 (Ctrl+Alt+B)」 | ✅ |
| Ctrl/Cmd+K 命令中心含「切换面板 / 打开文件」 | 命令中心含 切换面板（Ctrl Alt B）/ 打开文件… / 搜索文件 / Treemapping / 仓库 Wiki / 审查 / 浏览器 等 | ✅ |

## 标签条（48px，border-b）

| ZCode 结构 | liuli-theme 实现 | 状态 |
| --- | --- | --- |
| 左侧概览触发钮（chevrons-down，outline icon-md，aria「搜索标签页」） | 同图标 / 同位置 / 同 aria | ✅ |
| 标签：h-7（28px），flex 1 1 9.75rem，min 60 max 156，rounded-lg，icon size-3.5 + truncate 标题 + 渐隐关闭钮 | 尺寸 / 圆角 / 图标 / 渐隐关闭钮同构；active 态 border + card 底 | ✅ |
| 标签 tooltip（1.5s 延迟显示标题） | 原生 title（标题 · URL/路径） | ✅（等效） |
| 点击激活 / 拖拽排序（dnd-kit） | 点击激活；HTML5 DnD 拖拽排序 | ✅ |
| 中键关闭 | onAuxClick(button===1) 关闭 | ✅ |
| 右键菜单：关闭标签 / 关闭其他标签（无其他时禁用）/ 关闭所有标签 | 同三项、同禁用逻辑（fixed 弹层菜单） | ✅ |
| 右侧「新增标签」(+) outline 按钮 + w-48 下拉（icon + 文案，按支持情况过滤） | 同形按钮与下拉；项目按 DSH 可行性过滤（见下） | ✅ |
| 标签内容常驻挂载，inactive 隐藏（保留 iframe/滚动状态） | 全部标签面板常驻，`data-state=inactive` display:none | ✅ |

## 标签类型（图标与标题逐条取自 ZCode）

| ZCode 标签 | 图标（lucide，路径数据 1:1） | DSH 对应面板 | 状态 |
| --- | --- | --- | --- |
| Treemapping | map | 工作区文件树（搜索 / 仅变更 / Git 状态徽标 / 右键 / 拖拽进聊天） | ✅ |
| 仓库 Wiki（repo-wiki） | 自绘 32x32（三圆角方块 + 对角线，fill） | README 摘录 + 顶层模块地图，文件 chip 点回源码 | ✅ |
| 审查（git） | file-diff | Git 状态 + 只读提交图（点击看完整哈希/作者/日期/父提交，可加载更多） | ✅ |
| 浏览器（browser） | globe | 内置浏览器：后退/前进/刷新/地址栏/外部打开 + iframe 元素拾取 | ✅ |
| 代码查看（code-viewer） | file-code-corner（回退图标） | 「打开文件…」对话框递归检索工作区 → `/preview/<session>/<rel>` iframe，顶栏显示相对路径 + 默认编辑器打开 | ✅ |
| 终端 / 开发者工具 / 辅助对话 / 子智能体 / 画板 / 模型轨迹 / 计划 | — | DSH 宿主无对应能力（无 Web PTY / 无 ZCode agent 运行时），与 ADE-tools 文档结论一致 | ➖ 不适用 |

## 概览弹层（搜索标签页，w-72 cmdk 风格）

| ZCode | liuli-theme | 状态 |
| --- | --- | --- |
| 搜索框实时过滤（标题/提示/类型加权） | 搜索框按 标题+提示 包含过滤 | ✅ |
| 「打开的标签页」组：图标 + 标题 + 相对打开时间（刚刚/x分钟前/x小时前/x天前，60s 刷新）+ 关闭钮 | 同组、同相对时间、同关闭钮 | ✅ |
| 「最近关闭的标签页」组：点击重开（保留最近 15 条） | 同组、点击重开、上限 15 | ✅ |
| 无结果显示「没有找到标签页。」 | 同文案 | ✅ |

## 空状态与面板操作

| ZCode | liuli-theme | 状态 |
| --- | --- | --- |
| 无标签时空状态：「打开标签页」标题 + 说明 + h-12 rounded-xl bg-surface 按钮列（可用类型） | 同标题 / 说明 / 按钮列（审查/浏览器/Treemapping/仓库 Wiki/打开文件…） | ✅ |
| 收起 / 展开侧边面板 | 标题栏按钮 + Ctrl Alt B；宿主 details 列动画展开收起 | ✅ |
| 扩大面板 / 恢复面板宽度 | 标签条 maximize-2/minimize 按钮（lucide 路径 1:1），扩大≈72% 视口，可还原 | ✅ |
| 面板宽度拖拽 + 记忆 | 左缘手柄拖拽（取代宿主 details 手柄），宽度写 localStorage；宿主 store 不持久化，插件打开时按记忆值覆盖 grid 轨道并防宿主重渲染回写 | ✅ |
| 标签集合 / 激活标签 / 最近关闭 / 宽度 / 扩大态持久化 | `liuli:side-pane` localStorage，刷新恢复 | ✅ |

## 会话联动

| 行为 | 实现 | 状态 |
| --- | --- | --- |
| 切换会话宿主自动收起面板 | 跟随宿主；标签集合保留，下次打开恢复 | ✅ |
| 会话内点击前端产物链接 → 面板打开浏览器标签 | 点击拦截 → `liuli:preview-navigate` → 浏览器标签导航 | ✅ |
| 文件树单击文件 → 打开代码查看标签 | `onOpenFile` → code-viewer 标签（一会话一文件一标签） | ✅ |
| 关闭动画期间防止被 ResizeObserver 翻回打开 | `setPaneSyncSuppressed` 抑制窗口（观察到宽度归零或 800ms 超时解除） | ✅ |

## 自测记录（Playwright 无头，针对运行中的 DSH Web :18080，构建后刷新页面）

- `tsc -b` 与 `tsdown bundle` 通过；服务器 `/plugins/.../client.js` 即时读到新 bundle（no-cache）
- 标签条三按钮（搜索标签页/新增标签/扩大面板）渲染；空状态 5 项
- 新增标签：空状态与 + 菜单均可开标签；单例类型已开时从菜单隐去
- 标签文案：Treemapping / 审查 / 浏览器 / 仓库 Wiki；图标按 ZCode lucide 定义
- 概览：打开的标签页（相对时间+关闭钮）/ 最近关闭的标签页（点击重开）；搜索过滤与无结果文案
- 右键菜单三项；关闭其他/关闭所有后最近关闭组出现；中键关闭
- 拖拽排序（browser,treemapping → treemapping,browser）
- Ctrl+Alt+B 收起（轨道 0px，面板 0）→ 再按展开（恢复记忆宽度）；关闭动画期间无回弹
- 扩大面板 ≈72% 视口 → 恢复面板宽度回到记忆值
- 左缘手柄拖宽并持久化（刷新后保持）
- 打开文件对话框：递归扫描工作区，`readme` 命中 README.md，Enter 开 code-viewer 标签（iframe `/preview/<session>/README.md`）
- 浏览器标签：地址栏导航 loopback / `/preview` 地址，后退/前进/刷新/外部打开按钮
- `liuli:preview-navigate` 事件 → 浏览器标签导航并激活
- 刷新页面后标签集合 / 激活标签恢复；切换会话宿主收起、标签保留
- 全程无 pageerror
