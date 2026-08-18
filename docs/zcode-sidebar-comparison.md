# ZCode 右侧边栏(侧边面板)复刻对照与验证

> 依据:用户提供的 ZCode 逆向源码 `C:\Users\27280\.zcode\workspace\default\zcode-reverse`
> (核心文件:`09-renderer-renamed/styles-OqUHW1P0/deobfuscated.js`,7.5MB,变量已重命名+JSX 反编译)。
> 本插件(/mnt/d/Agent project/liuli-theme)在 DSH 宿主右侧 `details` 布局列上实现同构的标签式侧边面板,
> 逐功能对照逆向源码实现并用 Playwright 对运行中的 DSH Web(:18080)实测。

## 源码定位(zcode-reverse)

| 模块 | 位置(deobfuscated.js 行号) |
| --- | --- |
| 标签状态纯函数(fae/Qo/is/toe/rs/noe/roe/soe/ioe/Fae/Vae/Hae/Gae…) | 1766–2560 |
| 侧边面板控制 hook(Boe:开合/打开/关闭/重开/排序/最近关闭) | 2748–3420 |
| 最近关闭上限 Roe=8 | 1131 |
| 标签 chip(FKt)/拖拽影子(IKt)/图标(R5)/tooltip(PKt) | 171650–172100 附近 |
| 概览弹层(KKt:搜索+两组+相对时间 60s 刷新) | 同上区域 |
| 标签条(jqt:viewport 遮罩/滚动跟随/+按钮位置切换/空状态/标签面板渲染) | 172880–173900 |
| 宽度常量:sqt=0.45(默认宽度比)、Eqt(min 240px/max 65%)、yqt=200ms | 172665–172760 |
| 标题栏切换按钮(panel-right-open/close + sidePane.togglePanel) | 139550–139820 |
| 面板布局(react-resizable-panels:conversation-column + browser 面板组) | 175400 附近 |
| i18n(sidePane.* / browser.* / codeViewer.* 等) | IntlProvider 字典 |

## 逐功能对照

### 标签模型与生命周期

| ZCode 逆向源码行为 | 本插件实现 | 实测 |
| --- | --- | --- |
| Qo:同 id 就地替换并激活;否则追加并激活 | openTab 同语义 | ✅ |
| is:关闭标签;被关的是激活标签时激活 `r[Math.min(n, len-1)]`(同位右邻) | closeTab 同语义 | ✅ close active → 右邻激活 |
| Nae:可见标签归零 → isSidePaneCollapsed=true(面板收起) | 关闭最后一个标签 → collapsePane | ✅ track 归 0 |
| fae:treemapping 不入持久态(ZCode 已把文件树移到左侧栏,右侧 treemapping 入口已隐藏) | DSH 左侧栏为宿主官方会话列表,文件树保留在右侧面板(DSH 适配差异,已注明) | ➖ 适配差异 |
| Roe=8:最近关闭上限 8;selection-side-chat/browser-use 不入最近关闭 | 上限 8(DSH 无另两类标签) | ✅ recentClosed ≤ 8 |
| we:重开最近关闭;browser 类型换新 id | reopenTab 同语义 | ✅ 新 id 验证通过 |
| Fae/coe:「浏览器」菜单项复用同任务已有 browser 标签 | openBrowserFromMenu 复用首个 browser 标签 | ✅ 无重复标签 |
| z/Iae:URL 导航(产物链接/webview 请求)总新建 browser 标签 | PREVIEW_NAVIGATE_EVENT → 新建 browser:<uid> | ✅ 多实例验证 |
| browser 标签标题 = 页面 title,缺省「浏览器」 | 同源 iframe onLoad 取 document.title | ✅ demo 页标题上屏 |
| code-viewer 以 sourceKey 去重(一文件一标签) | id = code-viewer:<rel> | ✅ |
| 状态为宿主内内存态(per-workspace Map,LRU 50,不跨重启) | localStorage 持久化(DSH 适配扩展:页面刷新频繁,跨刷新保留标签/宽度) | ➖ 扩展差异 |

### 标签条 UI

| ZCode | 本插件 | 实测 |
| --- | --- | --- |
| TabsList h-12(48px)、border-b、bg-transparent | .tabStrip 48px + border-b | ✅ |
| 概览触发钮 chevrons-down outline icon,aria「搜索标签页」 | 同图标(SidePaneIcons 取自 bundle)/同 aria | ✅ |
| 标签 h-7(28px)、flex 1 1 9.75rem、min 60 max 156、rounded-lg、icon size-3.5、text-ui-base(14px) font-medium | 同尺寸/圆角/字号 | ✅ |
| 关闭钮常驻(w-2 渐变 + w-6 容器 + x size-3,ghost) | .tabCloseZone 常驻渐隐底 + 关闭钮 | ✅ |
| data-side-pane-tab-id / data-active / data-state | 同属性 | ✅ |
| dnd-kit 拖拽排序 + 拖拽影子 | HTML5 DnD 排序 | ✅ |
| 右键菜单 w-44:关闭标签/关闭其他标签(无其他禁用)/关闭所有标签 | 同三项同禁用逻辑,176px | ✅ |
| 中键关闭 | onAuxClick | ✅ |
| 激活标签平滑滚入视野(scrollBy smooth) | scrollIntoView 等效(rAF + scrollBy smooth) | ✅ |
| tooltip 1.5s 延迟显示标题 | 原生 title(标题 · URL/路径) | ✅ 等效 |
| + 新增标签:w-48 下拉,项目按条件过滤(wqt 序:辅助对话/审查/终端/浏览器/开发者工具) | DSH 可行集:审查(已有则隐)/浏览器/Treemapping(已有则隐)/仓库 Wiki(已有则隐)/打开文件… | ✅ 适配映射 |
| 空状态「打开标签页」+ 说明 + h-12 rounded-xl bg-surface 按钮列 | 同结构同文案 | ✅ 5 项 |

### 概览弹层(搜索标签页)

| ZCode | 本插件 | 实测 |
| --- | --- | --- |
| w-72(288px) cmdk 弹层,搜索框 h-8 | 同宽弹层 + 搜索框 | ✅ |
| 加权检索:全 token 命中才保留;title 前缀 120/词界 90/包含 70/hint 40/类型 20/其他 1,按分排序 | rankRows 同权重 | ✅ title 命中排在 URL 命中之前 |
| 「打开的标签页」:icon + 标题 + 相对时间 + 关闭钮(opacity-70) | 同 | ✅ |
| 「最近关闭的标签页」:点击重开 | 同 | ✅ |
| 相对时间:刚刚/x分钟前/x小时前/x天前,打开期间 60s 刷新 | 同 | ✅ |
| 无结果「没有找到标签页。」 | 同文案 | ✅ |

### 面板开合 / 宽度

| ZCode | 本插件 | 实测 |
| --- | --- | --- |
| Ctrl/Cmd+Alt+B 切换右侧面板(官网快捷键表 + toggleSidePaneShortcutLabel) | 全局捕获同键位;tooltip「切换面板 (Ctrl+Alt+B)」 | ✅ |
| 标题栏按钮:panel-right-open/close,aria 展开/收起侧边面板,tooltip 切换面板,激活态 bg-selected | header 按钮同图标/aria/激活态 | ✅ |
| 宽度:react-resizable-panels 面板组,min 240px / max 65%,默认 45%(sqt),布局持久化于 react-resizable-panels 键 | 左缘手柄拖拽,同 min/max/默认比,grid 轨道覆盖 + MutationObserver 防宿主重渲染回写,宽度 localStorage 持久化 | ✅ 首开 45%(720/1600)、min 钳制 240、拖宽持久化 |
| 无 maximize/restore(sidePane.maximize/restoreSize 为未引用的死键) | 同样不提供(已移除早期版本的按钮) | ✅ 无该按钮 |
| 收起/展开动画期间宽度过渡 | 宿主 details 轨道自带过渡;插件以 setPaneSyncSuppressed 防止关闭动画中被 RO 翻回 | ✅ 开合无回弹 |

### 面板类型(图标均取自 ZCode bundle 的 lucide 定义)

| ZCode 标签 | 图标 | DSH 对应 | 状态 |
| --- | --- | --- | --- |
| Treemapping | map | 文件树(搜索/仅变更/Git 状态徽标/右键/拖拽进聊天);ZCode 已隐藏该入口,DSH 保留 | ✅(适配保留) |
| 仓库 Wiki(repo-wiki) | 自绘 32x32(3 圆角方块+对角线) | README 摘录 + 模块地图,chip 点回源码 | ✅ |
| 审查(git) | file-diff | Git 状态 + 只读提交图(详情/加载更多) | ✅ |
| 浏览器(browser) | globe | 后退/前进/刷新/地址栏/外部打开 + 元素拾取开关(同 ZCode browser.elementPicker 显式语义);地址栏接受任意 http/https(裸域名补 https、回环/局域网 IP 补 http、相对产物路径映射 /preview),同源页标题回写标签 | ✅ |
| 代码查看(code-viewer) | file-code-corner(回退)/文件图标 | /preview iframe + 路径栏 + 默认编辑器打开;ZCode 有语法高亮渲染,DSH 走 /preview 原样服务 | ✅(渲染深度差异,已注明) |
| 终端/开发者工具/辅助对话/子智能体/画板/模型轨迹/计划 | — | DSH 宿主无对应能力(无 Web PTY/无 ZCode agent 运行时) | ➖ 不适用 |

## 实测记录(Playwright 无头,运行中的 DSH Web :18080,构建后刷新)

- t20-parity(18/18):无 maximize 按钮;首开宽度=45% 帧宽;三标签开启;浏览器菜单复用;
  产物链接新开浏览器标签;iframe 标题上屏;关闭激活→右邻激活;recentClosed≤8;
  重开浏览器换 id;关闭最后一个标签→轨道归 0;重开显示空状态;拾取钮存在且可开关;
  加权检索 title 优先;拖宽 min 钳制 240
- t2 回归:概览激活/右键菜单/关闭其他/最近关闭重开/Ctrl+Alt+B 开合(704→0→704 精确还原)/
  拖宽持久化/打开文件→代码查看 iframe/全程无 pageerror
- t22-width:开-关-开宽度精确还原;拖拽以 grid 轨道为基准(修复 slot 包裹层宽 0 的换算错误)
- 构建链:tsc -b 无错;tsdown bundle 通过;服务器 /plugins/.../client.js no-cache 直读磁盘,
  重建后浏览器刷新即生效(宿主 web-app 补丁禁用 HMR,故热重载自测=重建+刷新循环)

## 已知差异(均为宿主能力差异,非复刻遗漏)

1. treemapping:ZCode 当前构建隐藏右侧入口(文件树移至左侧栏);DSH 左侧栏为宿主官方组件,
   插件不可替换,故保留在右侧面板。
2. 持久化:ZCode 标签状态为应用内内存态;DSH 页面刷新频繁,插件持久化到 localStorage(扩展)。
3. 代码查看:ZCode 内置语法高亮/diff 渲染;DSH 经 /preview 原样服务(HTML 可渲染,代码按文本)。
4. 终端/开发者工具/辅助对话/子智能体/画板/模型轨迹/计划:依赖 ZCode 自有运行时,DSH 无对应能力。
5. 浏览器承载:ZCode 用 Electron webview(可加载任意站点)。本插件已在 Electron 宿主内
   用 WebContentsView 复刻同款承载(browser-engine.ts,会话分区 persist:liuli-embedded-browser、
   任意站点、弹窗转标签、崩溃原位重建、favicon 同步、响应式视口+拖拽手柄、元素拾取、
   外部打开/开发者工具),纯 Web 部署自动回退 iframe + /liuli-proxy。详见 docs/browser-use.md。
