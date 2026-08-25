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

## 运行中调试（DSH Electron 壳 / CDP）

DSH Desktop 是 Electron 应用。要深度调试**正在运行的实例**（渲染 DOM / JS / 网络 / console / 主进程窗口状态），走 **9229 主进程 inspector 桥**即可，不需要渲染 CDP 端口：

```bash
# 1. 调试模式启动（先完全退出 DSH Desktop：托盘 → 退出；退不干净先跑 tools/dsh-quit.cmd）
tools/dsh-debug-launch.cmd    # 双击；等价于带 --remote-debugging-port=9222 --inspect=9229 启动
#    dsh-debug-launch.ps1 会预检端口：9222 常被 iphlpsvc 占用，被占时自动顺延并提示实际端口

# 2. 连接（零依赖，Node >= 22）
node demo/dsh-main.mjs main         # 枚举窗口 / webContents（走 9229 主进程 inspector）
node demo/dsh-main.mjs health       # 主窗口一键体检（琉璃注入 / dock / 主题 / 内存）
node demo/dsh-main.mjs page "<js>"  # 主窗口页面执行 JS（attach 后走 CDP，错误信息完整）
node demo/dsh-main.mjs eval "<js>"  # 主进程执行 JS（process.mainModule.require('electron') 可用）
node demo/dsh-main.mjs attach [id]  # 附着 webContents.debugger（默认主窗口），开始收集 CDP 事件
node demo/dsh-main.mjs console 10   # 收集 10 秒 console / 异常
node demo/dsh-main.mjs net 10       # 收集 10 秒网络请求（含内部 RPC WebSocket 帧）
node demo/dsh-main.mjs events 20    # 读最近 20 条收集到的事件
node demo/dsh-main.mjs shot x.png   # 主窗口截图（wc.capturePage）
node demo/dsh-main.mjs detach [id]  # 分离 debugger（事件累积在 globalThis.__dshCdp，用完记得 detach）

# 通用 CDP 客户端（任何调试端点都可用，含 --inspect 的 Node inspector）
node demo/cdp.mjs targets [port]    # 列目标；另有 eval / tree / shot / console / send
```

关键事实：

- `--inspect=9229` 暴露**主进程 Node inspector**；`--remote-debugging-port=9222` 暴露渲染进程 CDP。两者都是启动参数，改动需重启 DSH Desktop 一次（重启后 Web 端口不变，仍 43120，GUI 会话可恢复）。
- **9222 常被系统服务 `iphlpsvc`（IP Helper）占用**导致渲染 CDP 绑定失败——主进程桥（9229）能力已覆盖渲染调试（`executeJavaScript` + `webContents.debugger` 事件桥），**不要为此再重启**。
- 主进程 inspector 作用域**没有 `require`**：取 Electron API 用 `process.mainModule.require('electron')`。
- 页面执行优先走 debugger 的 `Runtime.evaluate`（exceptionDetails 有真实堆栈），未 attach 时回退 `wc.executeJavaScript`（报错被吞成泛化文案）。

## 目录速览

```
src/
  index.ts                 # node 半入口：Host 路由（额度/预览/侧栏/窗口/浏览器引擎等）
  browser-engine.ts        # 内嵌浏览器引擎（CDP / Electron / Web 回退）
  host-audio.ts            # Electron 系统回环音频授权
  host-window.ts           # Electron 窗口控制（最小化/最大化/关闭/托盘）
  liuli-settings.ts        # 21 项设置 schema 与默认值
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
    auto-open-details.ts   # 详细页自动展开（LLM 活动感知）
    auto-drive-browser.ts  # 侧边栏浏览器自动驱动（dev server / 前端文件 → 自动展示页面）
    review-drive.ts        # 审查驱动请求纯逻辑（ReviewDriveRequest / resolveDriveTarget）
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
  test-auto-drive.ts       # auto-drive-browser 纯逻辑单测（dev server 解析 / 前端文件识别）
  verify-auto-drive.mjs    # 侧边栏浏览器自动驱动 + --show 轮询桥接 + 驱动审查 GUI 验证（T1..T14）
  verify-*.mjs             # 行为 / GUI 验证脚本
  server.mjs / cdp-run.mjs # 本地测试辅助
  cdp.mjs                  # 通用零依赖 CDP 客户端（targets/eval/tree/shot/console/send）
  cdp-dsh.mjs              # 渲染 CDP 体检/动作（依赖 --remote-debugging-port；9222 被占时用 dsh-main.mjs）
  dsh-main.mjs             # 主进程 inspector 桥（9229）：主窗口深度调试主力工具
tools/
  dsh-debug-launch.ps1/.cmd  # 调试模式启动（CDP 9222 + inspect 9229；端口预检自动避让）
  dsh-quit.cmd               # 强制退出全部 DSH Desktop 进程
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
12. **执行命令必须静默、不弹窗**：构建/安装/测试等命令尽量用后台执行（`run_in_background`）或隐藏窗口方式，避免在用户桌面弹出命令行窗口；不要为了省事反复前台跑 `pnpm build` / `pnpm install:desktop` 等命令。

## 关键避坑

- **安装到 DSH Desktop 不要用 `pnpm link`**：link 不会安装插件自身 dependencies，会报 `Cannot find package 'iconv-lite'`。用 `pnpm install:desktop` 或 `node scripts/install-desktop.mjs`。
- **DSH Desktop 默认用 `desktop` profile，安装只跑 `pnpm install:desktop`**：用户确认默认就用 desktop profile；不要默认安装到 `web` profile。历史上用户曾临时切到 `web` profile，导致 `pnpm install:desktop` 装完后页面仍无新规则（抓取 `/plugins/dsh-liuli-ui-enhance/client.js` 的长度与 `profiles/web/node_modules/...` 一致）。诊断：`Invoke-WebRequest http://127.0.0.1:<port>/` 拿到插件 URL 后抓取该 URL，与 `profiles/desktop` 的 `client.js` 长度/内容比对；或看 DSH 主进程命令行是否带 `--profile web`。只有用户明确说在用 web profile 时，才临时用 `DSH_PROFILE_DIR=C:\Users\27280\.dsh\profiles\web node scripts/install-desktop.mjs` 装 web profile；否则一律 `pnpm install:desktop`。
- **`pnpm install:desktop` 后不需要重启 DSH Desktop**：插件安装到 profile 后刷新页面即可加载新 bundle；不要主动 kill/restart DSH Desktop，重启会让 Web 端口变化并打断运行中的调试。可验证：安装后直接刷新页面观察新样式/行为。
- **agent 执行 `pnpm install:desktop` 后客户端可能不自动热重载，且不要用 HMR 注释 hack 强制热重载**：`install-desktop.mjs` 本身不触发 reload，HMR 只在 client bundle 内容 rev 变化时广播；若安装过程未让 DSH 的 `client-hmr` 检测到变化（或用户没手动刷新），界面仍是旧 bundle。曾用“向 profile 已安装的 `node_modules/dsh-liuli-ui-enhance/lib/client.js` 末尾追加一行注释”强制触发 `rebuilt`，实测**每次 HMR 热替换后琉璃客户端会不响应请求**，属于不安全路径。正确做法：安装后让用户手动刷新页面（或整页重载），不要改仓库 `lib/`、不要追加注释触发 HMR。
- 只改 desktop profile 的 `cordis.patch.yml` 不够，必须同时把 `dsh-liuli-ui-enhance` 写进该 profile 的 `package.json` dependencies。
- 隐藏原生标题栏需要执行 `pnpm patch:desktop`（手动脚本）；插件只能提供页面内窗口按钮，不能从渲染进程隐藏原生标题栏。客户端更新会还原 `app.asar`，因此插件会在启动时经 `src/frameless-patch.ts` 自动重打无边框补丁。**该补丁为尽力而为**：找不到补丁点/文件缺失/写入失败只告警不抛错、不阻止插件加载（无边框是纯外观功能，不能让它变成启动阻塞点）；幂等；生效需重启 DSH Desktop 一次。**electron-runtime 文件名不能写死**：客户端升级会从 `electron-runtime-he0yaDKX.js` 换成 `electron-runtime-ygt697jw.js` 这类 hash 名，脚本/插件都要在 `app.asar.unpacked/lib` 下动态查找 `electron-runtime-*.js`（优先包含 `titleBarStyle` 的，兜底取最大）。另外 `pnpm patch:desktop` 经 DSH Desktop runtime-commands 运行时会解析到 Electron 内置 node（fs 带 ASAR 钩子，读写 .asar 会失败），脚本检测到 `process.versions.electron` 后用 PowerShell 找系统 node 重新执行。
- **Electron 主进程里直接读写 `app.asar` 必须临时关闭 ASAR 钩子**：Electron 的 fs 会被 asar wrapper 拦截，`fs.openSync('...\\app.asar')` 读归档文件本身会抛 ENOENT（冒烟测试必现，`process.noAsar` 不设必崩）。插件自动补丁路径在 Electron 主进程执行，必须在直接读写 `.asar` 文件前后设置/恢复 `process.noAsar = true`（`src/frameless-patch.ts` 已实现）。手动脚本 `patch-desktop-frameless.mjs` 则检测 `process.versions.electron` 并用 PowerShell 找系统 node 重执行规避同一问题。
- **重建 asar 头不能写死 pad=1，也不能只写头部丢尾部**：asar 头 pickle 字符串按 4 字节对齐，`pad = (4 - jsonLength % 4) % 4`；`prefix[4]=jsonLength+8+pad`、`prefix[8]=jsonLength+4+pad`、`prefix[12]=jsonLength`。重建后必须把原文件 `16 + jsonLength + 旧pad` 之后的字节（打包内容；DSH 当前全部 `unpacked: true` 所以通常为空）原样接回，否则普通 asar 会被截断。验证：对 `default_app.asar`（含打包内容）重建头后逐字节比对尾部。
- DSH Desktop 每次重启 Web 端口会变（本次实测 43120 稳定复用，被占用时可能顺延），`localStorage` 按 origin 隔离；设置跨重启保留依赖 Host 端 `~/.liuli-theme/settings.json` 同步。
- **`--remote-debugging-port=9222` 可能绑定失败（渲染 CDP 起不来，但 9229 主进程 inspector 正常）**：9222 常被 Windows 系统服务 `iphlpsvc`（IP Helper，svchost.exe 托管）占用（`Get-NetTCPConnection -LocalPort 9222 -State Listen` 的 OwningProcess 是 svchost）。Chromium 绑定失败后**不会自动换端口**，`/json/version` 一直连不上。**不要为修 9222 再重启 DSH Desktop**——用 9229 主进程桥（`demo/dsh-main.mjs`）即可覆盖渲染调试（`executeJavaScript` + `webContents.debugger` 事件桥）；`tools/dsh-debug-launch.ps1` 已加端口预检，被占用时自动顺延并提示实际端口。
- **主进程 inspector 作用域没有 `require`（`Runtime.evaluate` 报 ReferenceError）**：`--inspect=9229` 连上 Electron 主进程后 `typeof require === 'undefined'`（ESM 作用域）。取 Electron API 用 `process.mainModule.require('electron')`（BrowserWindow / webContents / app / ipcMain / session 全可用；Electron 43 内置 Node 24，`process.mainModule` 存在）。页面侧执行：attach `webContents.debugger` 后走 `sendCommand('Runtime.evaluate')`（exceptionDetails 有真实堆栈）；未 attach 时 `wc.executeJavaScript` 的 rejection 是泛化文案（"An exception occurred while running JavaScript"），没有堆栈。
- **`webContents.debugger` 附着是持久的，事件会累积**：attach 后监听器挂在 wc 对象上（存 `globalThis.__dshCdp`，上限 5000 条），不 detach 会一直累积；`Runtime.enable/Log.enable/Network.enable` 使能后 console / 异常 / 网络 / **内部 RPC WebSocket 帧**（`server-request`）全部可见。同一 wc 已有 DevTools 打开时 attach 会失败（"Another debugger is already attached"）。用完 `wc.debugger.detach()`（或 `node demo/dsh-main.mjs detach`）。
- **`.ps1` 脚本必须 UTF-8 带 BOM**：Windows PowerShell 5.1（`powershell.exe`，`.cmd` 双击默认走它）按 ANSI/GBK 读无 BOM 的 UTF-8，中文被读乱 → 整个脚本 ParserError（报错常出现在字符串插值处，如 `"127.0.0.1:$Port"`）。注意：`edit` 工具重写文件会丢 BOM，写完用 `[System.IO.File]::ReadAllBytes` 检查头三字节 `EF BB BF`，丢了就用 `[System.IO.File]::WriteAllText($p, $c, [System.Text.UTF8Encoding]::new($true))` 补回。
- `/liuli-sidebar/*`、`/preview`、`/liuli-proxy` 等路由默认只接受 loopback / 同源 Host；局域网部署需额外配置信任域名。
- 声纹监听只捕获系统音频：Web 端靠 `getDisplayMedia`（共享整个屏幕 + 分享系统音频）；Electron Desktop 端由 Host 安装 `setDisplayMediaRequestHandler` 直接授予 `audio: 'loopback'`（Windows-only）。
- `liuli.css` 与 `liuli-css.ts` 是同一份样式的两个载体，改 CSS 源后需要同步字符串化拷贝（构建/脚本处理；不要只改其中一个）。注意历史遗留：当前 `liuli.css`（712 行）与 `liuli-css.ts` 内嵌字符串（1551 行）并不完全一致，运行时注入以 `liuli-css.ts` 为准；后续若以 `liuli.css` 为源，需先补齐同步。
- vendored `src/vendor/material-color-utilities.js` 是上游库，除非有明确目的否则不要改动。
- **项目改名后执行 `pnpm install:desktop` 会追加新注册而不是替换旧注册**：安装器只按当前包名（如 `dsh-liuli-ui-enhance`）检测 profile，旧 `id: liuli-theme` / `@deepseek-ai/liuli-theme` 不会被识别为已注册，会在 `cordis.patch.yml` 追加新 insert 块并在 `package.json` dependencies 增加新包；彻底迁移需手动删除 profile 中的旧依赖与旧 insert 块，再执行 `pnpm install`。
- **批量清理品牌词时不要只做机械替换**：复合品牌词会被替换成生造词，参考来源词会被错误归属到宿主名；需要二次替换为「琉璃」「参考实现源码」等中性词，并在 `pnpm build` 前搜索旧词残留确认无残留。
- **长对话拖 sash / 缩放窗口掉帧的元凶是宿主产物行 RO，不是琉璃布局代码**：`@deepseek-ai/dsh-client-ui-deliverables` 给每个产物行（`[data-produced-files-row]`）注册 ResizeObserver，回调内 `getComputedStyle`+多次 `getBoundingClientRect`+`textContent` 写入反复强制全量回流；列宽逐帧变化时每帧 O(产物行数) 次回流（实测 48 步拖拽主线程 10.2s）。正确做法：缩放开始冻结产物行宽度使宿主 RO 不触发、结束后分批解冻（`resize-perf.ts`，勿直接改宿主源码）；排查此类问题用 `demo/inspect-sash-perf.mjs`（RO 归因 + 分相位长任务）定位，勿凭猜测加 `content-visibility`。
- **磨砂 backdrop-filter 缩放期不能直接 `none` 硬切也不能 JS 每帧改变量硬渐变**：硬切会「突然消失」被用户吐槽；但 JS 每帧改写 body 自定义属性会触发全量子树样式失效、反而在按下时新增 ~240ms 尖峰。现行折中：rAF 缓动到恒等滤镜（~140ms）即挂 `body[data-liuli-blur-off]` 让 CSS 的 `none` 无缝接管，松手反向渐回；同时磨砂层相关 RO/遮挡检测（WindowControls/TurnRail/HeaderEffects mask）在缩放期让位。
- **dock-shell 固定区域 sash 拖拽直写 flex-basis 时必须与提交目标同 clamp**：`beginSash` 的 sidebar 分支曾只写 `newSize` 无 clamp，鼠标拖出窗口时侧栏宽度可为负/超过容器，与 `onUp` 提交的 `hostLayout.setSidebar`（宿主 clamp 264..420）不一致；拖拽直写路径（DOM 直改）不受模型 `resizeSplitTo`/宿主管束，任何分支都要显式 clamp（现在 sidebar 用 `SIDEBAR_MIN/MAX`，details 用 `clampDetailsWidth`）。details 的上限不能只看视口 88%，还要保证「侧栏 + 会话最小 480 + 详情」不超视口，否则大屏上 88% 会把右缘推出视口（现象：details 面板 `rect.width` 2000+，按钮超出视口外）；另外 localStorage 恢复 `liuli:details-width` 的路径也必须过同一个 clamp，否则旧脏值刷新后仍超。改这里时先跑 `pnpm build`，再在 advanced 模式拖左右两侧 sash 验证边界。
- **sash 拖拽必须做像素级 clamp（可变与固定区域两条路径）**：可变 split 路径曾只按 `MIN_SIZE` 比例 clamp，固定区域（详情/侧栏）路径只 clamp 区域自身，都会把手柄拖过相邻卡片。修复：`beginSash` 按下时读取相邻 shard 像素尺寸并算出 `childMinPx`（普通 240×160、会话列 640）；可变路径把最小像素换算成 `minBeforeRatio/minAfterRatio` 夹取 `na`；固定区域路径额外计算 split 内其他子级的 `othersMin`，`maxSize = total - othersMin`，详情/侧栏的 `lastRegionSize` 同时与 `maxSize` 取小。验证：拖拽拆出标签页的 sash 和详情 sash，相邻卡片都不会小于最小宽/高。
- **垂直 split 里详情/侧栏相邻的 sash 不能走固定区域路径（点击没动也会横跳）**：`fixedRegionType` 只按节点类型判断，不看 split 方向；当拆出的标签页/会话页头 dock 到详情上方或下方（`dir==='v'`）时，相邻 sash 被误判为固定区域 sash，pointerup 时 `setDetailsWidth(lastRegionSize)` 把面板高度当宽度写回（或 `hostLayout.setSidebar`），点击手柄即使没动布局也横向拉伸。修复：`beginSash` 里 `beforeType/afterType` 只在 `dir==='h'` 时取 `fixedRegionType`；垂直 split 一律走 variableShards 比例路径（垂直方向本就没有固定高度语义，渲染期 `childFixedWidth(child,'v')` 也返回 undefined）。验证：把标签页 dock 到详情上方/下方后点击/轻点两者间 sash，详情宽度不应变化；拖拽只改高度比例。
- **不要给 shard 直接写 `minWidth/minHeight` 来保证拆出标签页最小宽/高**：flex 项的硬性 min 下限在嵌套 split 里会让子级溢出 split 盒——实测嵌套横向 split（0.5/0.5）位于 345px 列内时，两个 shard 各被 `minWidth:240` 撑到 240，第二个 shard 直接盖到右侧相邻卡片上（元素拾取 rect 越过分界 sash）。正确做法：渲染期把最小宽/高换算成 flexGrow——`nodeMinPx(node, dir)` 递归聚合子级最小像素（split 主轴=子级之和、交叉轴=子级最大；固定宽度的侧栏/详情按固定 px 计），`recomputeSplitPx` 实测每个 `[data-dock-split]` 主轴像素写入 `splitPxMap`，`splitChildPx` 在容器放得下所有最小值时先抬到最小再按比例扣回，放不下时按 sizes 比例分配可用空间（允许低于最小但绝不溢出）；`renderNode` 用 `effPx/effGrowTotal` 取代 model 比例的 flexGrow，shard 上只留 `flex-basis:0; flex-shrink:1`。同时 `beginSash` 的起始比例要取 DOM 实测（渲染 clamp 后 model sizes 可能与显示不一致），min 比例与 `othersMin` 也要用递归 `nodeMinPx` 让最小宽度沿嵌套层级向上传播，松手提交的 `lastRatio` 写回 clamp 后的比例，避免按下/松手跳变。
- **窗口最大化→还原后 dock 面板卡片相互遮挡（右缘固定面板盖住相邻卡片）**：`index.ts` 的 `DESKTOP_ADVANCED_CSS` 曾给 `[class*="_shard"]:has([data-region-pane="region:conversation"])` 写 `min-width: 640px !important`；固定列（侧栏/详情）flex-shrink 0，小视口下「固定列 + 会话列 640」之和超过容器，固定列被挤出并盖到相邻卡片（用户现象：最大化时布置 dockable 布局，点「向下还原」后 dock 面板卡片互相遮挡）。这与「不要给 shard 写硬性 minWidth」冲突：渲染期 `splitChildPx` 已经能在空间足够时把会话抬到 640、空间不足时按比例压缩。修复：把该规则的 `min-width` 改为 `0 !important`，并移除 index.ts 中不再使用的 `CONVERSATION_MIN` import；`.dshDesktopConversationSurface` 保持 `min-width:0`。验证：headless Chrome 导入 [侧栏|会话+文件树|详情] 嵌套布局后 `Emulation.setDeviceMetricsOverride` 缩到 1100px，`[data-dock-node]` 无重叠且详情右缘 ≤ 视口；注入 `min-width:640` 可复现重叠。
- **同向 split 不要嵌套（[ [详情,侧栏], 会话 ] 这类结构）**：`insertPanels` 对 split 目标曾一律「包一层新 split」替换目标节点，导致同向嵌套；现象：把详情拖到侧栏左侧后，侧栏与会话之间隔了一层复合容器，直接 sash 消失/拖动不会改变会话大小。修复：`findParentSplit` 找到目标父级且父级 dir 与落点方向一致时，把新组作为兄弟子级插入（sizes 拆半），不再包层；`flattenSameDirSplits` 在 `loadSavedDock`/`parseDockSafe` 恢复旧布局时把同向嵌套拍平。`withRegion` 补挂区域时也优先兄弟插入。验证：`node demo/test-dock-model.ts` M17/M18；GUI 上把详情拖到侧栏左侧后，侧栏与会话之间仍有直接 sash 且拖动能改会话大小。
- **固定复合列（[详情, 侧栏] 两个固定子级）在父级必须按固定宽度处理**：全部子级都固定宽度的同向 split，若在父级仍按 flexGrow 分配，收起详情/侧栏后父级仍给它大段空白，侧栏收在右缘也贴不到边。修复：`childFixedWidth(child, dir)` 递归——单区域 tabs 固定；同向 split 的子级全固定时其宽度也固定（子级之和）。这样复合列在父级用 flex-basis 精确 px、不参与 grow，空白消失、收起后右缘贴合。`beginSash` 对「固定节点 + grow 节点」之间的 sash 直接 no-op（比例拖拽无法改变固定侧），避免把 flexGrow 写到固定 shard 上。
- **侧栏在非原生位置收起后宽度和原生不一致**：侧栏 surface 在右缘/中间有 `--liuli-dock-padding` 的 padding，而 shard 固定宽仍按原生收起宽（56/90）设置，导致内轨被 padding 压成 40/48px。修复：`childFixedWidth` 里侧栏收起且不在左缘时，shard 宽 = 原生收起宽 + 对应 dock 留白（右缘 +1 份、中间 +2 份），保证内部 rail 仍为原生收起宽度；`dockPad` 从 `getComputedStyle(document.body).getPropertyValue('--liuli-dock-padding')` 读取（变量由 liuli-runtime 设在 body 上，读 documentElement 会拿到空值回退 8，与真实留白不一致），不硬编码 16。无头验证：`importJSON` 成 [详情, 侧栏, 会话] → openDetails → toggleSidebar 后，侧栏 shard 宽 = 56 + 2*dockPad，rail rect 宽 56。
- **给 dock-shell sash 设置 `data-side="details"` 会被 PreviewPanel 的全局 CSS 隐藏**：`PreviewPanel.module.css` 原本写 `:global(div[data-side="details"]) { display:none }` 想隐藏宿主 `.dshDesktopResizeHandle[data-side="details"]`，但选择器太宽会误伤 dock-shell 里 `data-side="details"` 的 sash（现象：修正 data-side 语义后详情 sash 消失）。正确写法是 `:global(.dshDesktopResizeHandle[data-side="details"])`；给任何元素加 `data-side` 前先 grep 是否有宽泛的 `[data-side]` 选择器。
- **dock-shell sash 不要占布局宽度**：`DockShellFrame.module.css` 的 `.sashH/.sashV` 曾写 `flex: 0 0 8px; margin: 0 -4px`（负 margin 让 8px 命中带骑进相邻容器，用户会看到手柄“进入对话页/别的容器”）；后改成 `flex: 0 0 4px` 仍会被报「左右容器隔得太宽」。最终方案：`flex: 0 0 0; width/height: 0; margin: 0`，布局上容器紧贴无常态缝，用透明 `::after`（左右/上下各 4px）提供约 8px 命中区。改 sash 时保持“零占位 + 伪元素命中区”，不要再加正/负 margin 或 flex-basis。
- **开始页隐藏页头面板必须隐藏 shard 而不是只隐藏内部 pane**：dock 布局的占位者是外层 `.shard`（flex-grow 按比例分配空间），`[data-region-pane="region:conversation-header"]` 只是 shard 内部的 pane；开始页（官方 header 带 `aria-hidden`）只给 pane `display:none` 时，shard 仍占 flex 高度，页头区域依然空白可见（用户元素选择器看到 `conversationHeaderHost` 还在）。修复：`renderNode` 给每个 shard 加 `data-dock-shard` 和 `data-shard-region`（单区域 tabs 时写区域类型），全局 CSS 用 `[data-shard-region="region:conversation-header"]:has(header[aria-hidden]) { display:none !important }` 隐藏整个 shard，并同步隐藏其相邻 `[data-testid="dock-sash"]`。验证：开始页 CDP 查 `[data-shard-region="region:conversation-header"]` 的 `getBoundingClientRect().height` 为 0 且会话面板从顶部开始。
- **隐藏 flex item 后剩余 shard 不会自动填满：flex-grow 总和 <1 时自由空间只按比例分配**：默认 v split 的 sizes 是 [0.16, 0.84]，header shard `display:none` 后只剩会话 shard 的 `flex-grow:0.84` 参与布局，flexbox 对 grow 总和 <1 只分配 84% 自由空间，底部留出 16% 空白（现象：header 消失后开始页底部空一块）。修复：在全局 CSS 给开始页的会话 shard 提权 `[data-shard-region="region:conversation-header"]:has(header[aria-hidden]) ~ [data-shard-region="region:conversation"] { flex-grow: 1 !important }`；反向布局（页头在会话下方）用 `:has(~ ...)` 选择器。验证：CDP 查会话 shard 的 `getComputedStyle(...).flexGrow` 为 `1`，且 rect 高度等于 splitV 高度。
- **运行中的 DSH Desktop 可能继续提供旧 client bundle（新 CSS 规则不生效）**：`pnpm install:desktop` 更新 profile 里的 `lib/client.js` 后，运行中的 Desktop 服务端可能仍缓存旧 bundle；无头 Chrome 新开页面注入的 `liuli-theme-css` 文本里没有新规则（如 `flex-grow: 1`），旧规则（如 header shard 隐藏）却在。诊断方法：CDP eval `document.getElementById('liuli-theme-css').textContent.includes('flex-grow: 1')`。若为 false 且 profile 的 client.js 已含新规则，说明服务端缓存旧 bundle，此时让用户重启 DSH Desktop 再刷新；不要用 HMR 注释 hack 强制热重载。
- **从详细页标签直接拖出时难以 dock 到详情四周（先拆成浮动窗口就很容易）**：DockShellFrame/DockWorkspace 的 HTML5 拖入守卫原本排除整个 [data-liuli-side-pane]，而该容器覆盖整个详情面板矩形，鼠标在详情内容区/边缘 26% 落点区内时 dock 都不接管，必须先拖出 side pane（或先拆浮动窗口）才能显示落点。正确做法：只排除标签条滚动区 [data-side-pane-tabs-viewport]（SidePane 内部排序语义只在这里），面板内容区/边缘都允许 dock 落点；并且 onDrop 也要加同样排除，否则 drop 事件冒泡到 root 会把「标签条内排序」也当成 dock 接收。验证：从详细页标签直接拖到详情上方/下方/左侧/右侧能出现落点指示并成功 dock；拖到标签条内仍走内部排序。
- **从详细页拆出的标签再拖回详情页会变成 dock 标签组（[详情, 浏览] 两个 chip），而不是回到 SidePane 原容器**：详情页在 DockShellFrame 里是单面板 `region:details` 节点；把拆出去的 side-tab 型 dock 面板（browser/files/git/wiki/code/terminal/whiteboard）拖回详情页中心（tab 落点）时，`movePanel` 会把它合并进该节点，节点变成多标签组后渲染成通用 `paneCard`，失去原生详情表面与宽度语义。正确做法：`side-tab-dock.ts` 增加 `SIDE_TAB_OPEN_EVENT` / `openSidePaneTab` 与反向映射 `dockPanelToSideTab`；`PreviewPanel` 监听该事件调 `openTab` 还原为 SidePane 标签；DockShellFrame 在指针拖拽 onUp 与 HTML5 onDrop 里，当落点是**单面板详情 tabs 节点**（`isSingleDetailsTabs`）且被拖面板能反向映射时，改走 `removePanel` + `openSidePaneTab`（HTML5 路径不 `markSideTabAccepted`，让源标签保留）。注意只拦截单面板详情节点；详情已经与其他面板合并成多标签组时不拦截，避免改变既有合并语义。验证：从详情页拆出「浏览」标签 dock 到空白处，再拖回详情页中心，详情节点仍为单面板 `region:details` 原生表面，SidePane 中重新出现该标签且激活。
- **DockShellFrame 的 dockable 标签页布局应按会话记忆，而不是全局一致**：原 `saveShellDock/loadSavedDock` 只读写全局 `liuli.dockshell.v1`，切换会话后布局不变（用户要求每个会话记住自己的拆分/标签/浮动窗口）。正确做法：`dockStorageKey(sessionId)` 生成 `liuli.dockshell.v1.<sessionId>`，`saveShellDock(dock, sessionId)` 按会话写入，`loadSavedDock(sessionId)` 先读会话 key、缺失时回退旧全局 key 一次（迁移旧数据）；DockShellFrame 增加 `lastDockSession` ref + `useLayoutEffect`，会话切换时先把旧布局 `saveShellDock(prev)` 写回旧会话，再 `loadSavedDock(sessionId) ?? defaultShellLayout()` 载入新会话；自动保存与菜单保存都带上当前 `sessionId`。卸载前落盘仍用 `lastDockSession.current`（空 deps effect，避免会话切换时的 cleanup 用新会话 id 覆盖旧会话）。验证：headless Chrome 里给会话 A 导入/拖出特殊布局后切到会话 B（布局应为 B 自己的或默认），再切回 A 恢复 A 的布局；localStorage 可见 `liuli.dockshell.v1.<sessionA>` 与 `<sessionB>` 两份。
- **拖走详细页后右侧又自动长出一个详细页**：DockShellFrame 的 details 同步 effect 在 `hostPanels.details>0` 且树里没有 `region:details` 时会 `withRegion` 自动补挂到右缘；用户主动把详情拖去浮动/其他位置时，宿主 details 仍开着，于是被重新补挂。修复：`detailsTornOut` ref 标记用户主动拖走详情（`beginDrag` 移动节点前 + `floatPanelCentered` 里，若移动的是 `REGION_DETAILS` 就置位）；同步 effect 看到该标记跳过补挂；`hostPanels.details===0` 时清标记，之后重新 openDetails 仍可补挂。
- **详情列收起后仍露出 32px“边”**：details surface 是 `box-sizing: content-box`，DockShellFrame 给中间态详情 surface 设了 `padding-left/right: var(--liuli-dock-padding)`；当 shard 宽 0 时，content 宽 0 + 左右 padding = 32px 的可见区域。修复：DockShellFrame.module.css 里所有详情 surface 的左右/底部 padding 规则都加 `.dshDesktopFrame:not([data-details-collapsed])` 前缀，并单独给 `[data-details-collapsed]` 设 `padding: var(--liuli-dock-padding,8px) 0 0 0 !important`。验证：导入嵌套 split 布局后 closeDetails，`[data-dock-node]` 详情 rect 宽度应为 0。
- **dock 浏览器面板拆出后能力降级/无法使用**：原 dock 浏览器是 BrowserLitePanel（/liuli-proxy iframe 代理），在 Electron 上能力远弱于右侧边栏 webview。修复：导出并复用 PreviewPanel 的 `BrowserPanel`（webview/iframe 双模），dock-panels 的 `browser` 类型改渲染 `DockBrowserPanel`：`tabId` 用 `panel.id`、URL 经 `onNavigate` 写回 `panel.state.url`、`insertElement` 暂为空操作。纯 Web 下仍自动回退 iframe。
- **dock 非区域面板/浮动窗口要做成与对话页、左侧边栏一致的卡片材质**：`DockWorkspace` 的 `.pane/.floatWindow` 与 `DockShellFrame` 的扩展面板（`css.paneCard`）都不要再写 `background: rgba(var(--liuli-acrylic-rgb), …)` 实底，而要沿用 `PreviewPanel.module.css` 的 `.panel` 配方：容器 `position: relative; z-index: 1; border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--liuli-radius, 14px); background-color: transparent; background-image: none; box-shadow: var(--liuli-glow-brand), var(--liuli-shadow); overflow: hidden`，再加 `::before { content:''; position:absolute; inset:0; z-index:-1; border-radius:inherit; background-color: rgba(var(--liuli-acrylic-rgb), var(--liuli-material-opacity, 0.55)); background-image: var(--liuli-noise); -webkit-backdrop-filter/backdrop-filter: var(--liuli-material-blur-strong, var(--liuli-material-blur)); pointer-events:none }`。DockShellFrame 默认三区域仍用 `dshDesktop*Surface` 原生表面类（零侵入），仅非区域面板加 `css.paneCard`。标签条也对齐右侧边栏：`.tabStrip` 高 48px、`padding: 0 12px`、`border-bottom: 1px solid var(--dsw-alias-border-l1)`；`.tabChip` 用 `flex: 1 1 156px; min-width: 64px; max-width: 156px; height: 28px; border-radius: 8px; border: 1px solid transparent`，激活态用 `--dsw-specific-card-major` 底 + `--liuli-shadow-subtle`；卡片面板 `.paneBody` 加 10px 留白让亚克力材质透出。卡片与相邻表面卡片的间隙按桌面 shell 表面 padding 对齐：`.paneCard` 加 `margin: var(--liuli-dock-padding, 8px)`（`dshDesktopConversationSurface` 内卡留白就是同一个 `--liuli-dock-padding` 变量，不要硬编码 16px；相邻两卡可见间隙为 2×变量值）。贴住画布边缘的卡片要镜像桌面 shell 的贴边直角 + 无外侧留白：`dock-shell-frame.tsx` 不再用 split 结构猜边缘，而是 `useLayoutEffect` + `ResizeObserver`/`transitionend` 实测每个 pane 所在 shard 与 `dockBody` 的矩形，算出 `left/right/top/bottom` 写进 `edgeMap`；给 `paneCard` 只追加 `edgeBottom`（上下堆叠中的下方卡片：`margin-bottom:0` + 底部两角直角）；普通面板左右上三边永远留白+圆角。注意 shard 的 flex-basis 有 0.3s 过渡，布局树切换后 root 尺寸不变、RO 不触发，必须监听 `transitionend` 在过渡结束后重算，否则边缘标记停留在过渡中间态。区域表面按规范：`renderTabsNode` 给区域 pane 挂 `data-edge-left/right/bottom` 和 `data-has-below`；侧边栏左/右边缘贴边去圆角，中间四边留白+圆角；详细页同侧边栏，并额外在下方无卡片时底部触底去圆角；侧栏在右时对内卡曾加 `direction: rtl` 让内部元素镜像（后按用户要求取消镜像，保持 LTR）；对话页在上下堆叠且下方有卡片时，用 `.dshDesktopConversationSurface[data-has-below] [data-conversation-scroll]` 撤销全局 active 的底部触底规则（恢复 `border-bottom-*-radius: var(--liuli-radius)` 和 `margin-bottom: 0`）。`DockShellFrame.module.css` 里用 `:global` 覆盖宿主 surface padding（详情在左 `padding: var(--liuli-dock-padding,8px) var(--liuli-dock-padding,8px) 0 0 !important`、侧栏在右 wrapper `padding: var(--liuli-dock-padding,8px) 0 var(--liuli-dock-padding,8px) var(--liuli-dock-padding,8px) !important`，同样不要硬编码 16px），侧栏内卡圆角 `14px 0 0 14px`。注意详情内卡圆角不能在模块 CSS 里赢：`index.ts` 注入的 advanced CSS 有 `body[data-dsh-desktop-mode="advanced"] [class*="_detailsCol"] [data-preview-panel] { border-radius: var(--liuli-radius,14px) 0 0 0 !important }`（特异性 0,3,1），必须在同一注入段追加 `body[data-dsh-desktop-mode="advanced"] .dshDesktopDetailsSurface[data-edge-left] [data-preview-panel] { border-radius: 0 var(--liuli-radius,14px) 0 0 !important }`（特异性 0,4,1）才能镜像成左上直角、右上圆角。
- **缩放护栏 `data-liuli-resizing` 卡住会让 TurnRail 级联消失**：窗口 resize 事件会突发连发，`installResizePerfWatcher` 曾每次 `resize` 都 `beginResizePerf()` 但 settle 定时器只有一个 → depth 只增不减、body 标记卡住 15s（兜底才清）；卡住期间任何 `body[data-liuli-resizing] * { transition:none }` 都会永久杀掉 tick 的 opacity/transform 过渡，级联消失。修复：window resize 路径用 `windowResizeActive` 幂等配对（只在首次 begin、settle 后 end 一次）；验证 `node demo/inspect-resize-leak.mjs`。
- **缩放期禁用过渡不要用 `* { transition: none !important }` 一刀切**：它会把 TurnRail 刻度级联消失（`.tick` 的 opacity/transform 过渡 + `transitionDelay`）等装饰过渡一并杀掉；shard 宽度过渡已有 `DockShellFrame.module.css` 的 `.dockBody[data-resizing] .shard { transition:none }` 专门处理，无需全局杀。新增任何全局 `transition:none` 前先确认不误伤 tick/胶囊等装饰动画。
- **TurnFileCard「打开方式」菜单曾被父容器裁剪**：菜单原为 `.menuWrap` 内 `position:absolute`，卡片/消息容器链上的 `overflow:hidden` 或 `backdrop-filter` 会把它裁掉，弹不出去。正确做法：菜单用 `createPortal(menu, document.body)` + `position:fixed`，打开时按 `menuWrap.getBoundingClientRect()` 计算 `right/top`（下方空间不足则翻转到按钮上方），并给菜单面板单独 ref 用于点击外部关闭；`z-index` 用 2147482500 一档。以后凡是在消息流里弹出的浮层都应走 body portal + fixed。
- **元素选择器序列化文本要把 `rect` 放在长 `selector` 之前**：`formatSelection` 生成的 `selector` 是 CSS Modules 全路径、通常很长；会话列表预览/消息气泡按长度截断时，用户会以为「元素选择器没有返回 rect」（现象：预览只看到 `[selected element] <tag>` 和 `selector:` 开头）。正确顺序：`[selected element] <tag>` → `rect:` → `selector:` → 其它字段；解析端 `element-card.ts` 按行读取不依赖顺序，但详情卡展示顺序也应同步 rect 在前。验证：`node demo/test-element-picker.ts`（新/旧顺序都能解析）。
- **`div[class*="_menu"]` 会误伤文件行的 `menuWrap` 小容器**：全局菜单背景规则（70% 半透明 + 噪声 + 磨砂）用 `div[class*="_menu"]` 选择器，而 TurnFileCard 的 `.menuWrap` 类名含 `_menu`，会被套上一个「灰色半透明方框」包住「打开方式」SVG 图标。正确做法：给 `[class*="_fileRow"] [class*="_menuWrap"]` 单独重置 `background-color/background-image/backdrop-filter` 为透明/无；不要去掉 `div[class*="_menu"]` 这个全局规则（真正的菜单面板还需要它）。验证：打开「本轮修改」卡片看「打开方式」图标旁不再有灰框。
- **壁纸选区角手柄有一半伸出选框外，点击手柄外侧会清空选框（一拉伸就消失）**：`LiuliAppearance.tsx` 的 `onDown` 原先先做 `p0 在 box 内` 的包含判断，角手柄 8px 方块中心在选框角上、外侧 4px 在框外，点到外侧就落入 `create` 分支并 `setSelBox({w:0})`，选框瞬间消失。正确做法：角手柄命中用像素级判定（手柄 + 4px 容差，如 `handleHitPx=12`），并先于 `inside` 判断；取角时用距离最近的边（`distLeft <= distRight`）而不是 `nearLeft ? 'l' : 'r'`，避免小选框上双边同时命中时选错角。同时给选框边缘 6px 的容差（`nearBox`），点到边框/描边附近按移动处理而不是新建选区，避免从边框按下也清空选框。**另一个同源坑：corner 字符串必须按 `tl/tr/bl/br`（先纵后横）拼，`${'l'/'r'}${'t'/'b'}` 会生成 `lt/rt/lb/rb`，`resizeArea` 里任何 `corner === 'tl'` 都匹配不到，固定点变成被拖动的角本身，选框会缩成一小点**。验证：已有选区 → 编辑选区 → 点住四角任一手柄外侧拖动，选框持续拉伸不消失。
- **会话标记的“菜单预览图标”和“行内实际图标”各维护了一套 SVG，导致添加后样式不一致**：`session-context-menu.ts` 的 `MARKER_ICON` 用官方 `menu-icons.ts` 图标，而 `session-markers.ts` 的 `MARKER_SVG` 是另一套手写图标（如 done 从描边勾变成了实心圆勾）。正确做法：图标映射只保留一份，统一用 `menu-icons.ts` 的官方图标，并在 `session-markers.ts` 导出 `MARKER_ICON` 供菜单复用；颜色统一用同一份 `MARKER_COLOR`，且按产品要求全部标记统一用主题色 `var(--dsw-alias-brand-primary)`（菜单标记项在 `iconEl.style.color` 覆写，行内装饰也用同一色），否则形状/颜色会不一致。验证：右键会话 → 添加标记 → 行内图标与菜单里该项图标形状和颜色都一致（全部为主题色）。
- **advanced dock 模式拆“对话页 header / 正文双容器”不要移动 React 管理的 DOM 节点**：官方 `div[data-phase]` 的两个子节点本就并列——header 槽位容器是 `<div data-slot="conversation.session.header" style="display: contents;">`（inline contents 让它视觉上不成容器），正文是 `[data-conversation-scroll]`。只做“两个容器”时，`conversation-split.ts` 只给这两个节点打 `data-liuli-conversation-header-container` / `data-liuli-conversation-body-container` 标记，CSS 用 `[data-liuli-conversation-header-container]:not(header) { display:flex !important }` 覆盖 inline contents、`[data-liuli-conversation-body-container] { flex:1 1 auto; min-height:0 }` 让正文占满；不要用 `appendChild` 把 header/scrollBody 搬进自建 div，否则 React 后续重排/卸载时会因 fiber 父节点错位而重新插入或移除错节点。验证：CDP 查 `getComputedStyle(headerContainer).display === 'flex'` 且 phase 两个子节点带标记属性。
- **把会话页头做成独立 dock 面板（region:conversation-header）必须移动 header DOM，但要按安全时序搬**：独立面板与正文面板是两个 React 兄弟容器，官方没有独立 header slot，只能把 ConversationRoot 渲染出的 `<header>` 从 `div[data-phase]` 搬到页头面板的 host（`data-liuli-conversation-header-host`）。安全做法：`syncConversationHeader()` 在 `useLayoutEffect`（React commit 后、绘制前）同步搬入/搬回，并用 MutationObserver（rAF 节流）兜底会话切换/slot 重挂；页头面板缺失时把 header 搬回 `div[data-slot="conversation.session.header"]`，不要 remove 多余 header（React 会自行 removeChild 其管理的节点）。页头面板用 `paneCard` 材质，header 自身在面板内必须重置 `border/background/box-shadow` 避免双层卡片；`renderTabChip` 关闭按钮要排除 conversation-header（与 sidebar/conversation 一样不可删）；`loadSavedDock` 用 `withRegionAbove` 自动补挂页头面板到会话上方（同向 v split 兄弟插入，避免同向嵌套）。验证：CDP 查 `[data-region-pane="region:conversation-header"]` 存在且 `headerHost` 内有 header、conversation 面板内 `div[data-phase] header` 为空；导入无页头面板布局后 header 自动回到 conversation 面板；导入浮动页头布局后 header 在浮动窗口的 host 内。**页头面板并入多标签组（其他卡片拖进页头）时**：多标签渲染路径（renderTabsNode 通用分支）原本不渲染 `[data-liuli-conversation-header-host]`（只有页头标签激活时才经 renderPanelBody 渲染），`syncConversationHeader` 在页头标签非激活时找不到 host → 把 header 打回会话面板；且多标签卡没有 `data-region-pane`，header 的填充/去边框样式不生效——表现为「header 卡内显示不正常/跑到正文里」。修复：多标签组含页头面板时（`node.tabs.some(type === REGION_CONVERSATION_HEADER)`）① 卡片补 `data-region-pane="region:conversation-header"`（region 样式对组内 header 生效）；② 宿主常驻挂载（页头标签非激活时 `display:none` 不占位、激活时显示且不渲染 paneBody），sync 始终能找到 host，detached 的 header 由既有 `headerRef` 抢救路径（`!saved.isConnected && host 无 header` 时 appendChild）救回新宿主。注意：React 重渲染卡片子树时会把宿主连同外来子节点一起移除/重挂（host 自身无 childList 删除记录、引用不变），外来 header 不靠「常驻」，靠 sync 的抢救路径重挂。验证：`node demo/verify-header-drag.mjs` S16（importJSON 构造 [页头,便签] 多标签组、便签激活 → 卡带 region 属性、宿主隐藏常驻、注入 phase 的 header 被搬进卡内宿主、会话面板无残留 header）。
- **TurnFileCard「在资源管理器中打开」不生效（三个坑叠加）**：① 客户端 `sessionId` 是裸 UUID（`fd9c0e13-…`，PreviewPanel 写入 `liuli:last-session` 可证），而 Host 端 `ctx.sessions.get()` 的 key 需要 `session-<uuid>` 前缀；直接 `hostSessions(ctx).get(sessionId)` 会让 `/liuli-sidebar/*`、`/liuli-reveal`、`/preview` 全部 404。修复：`sidebarSessionRoot` 做双向兼容（先原样 get，未命中再补/去 `session-` 前缀），`servePreview` 也改用该函数；前端 `RoundSummaryCard` 再用 `useSessions(s=>s.current)` 做 sessionId 回退。② `spawn('explorer.exe', ['/select,'+target], {windowsHide:true})` 会**把 explorer 主窗口一起隐藏**（实测新进程 MainWindowHandle=0），且单个 `/select,<path>` 参数在路径含空格时会被 explorer 解析成打开「文档」。修复：去掉 `windowsHide:true`，参数拆成 `['/select,', target]` 两个参数。验证：`Invoke-WebRequest "http://127.0.0.1:<端口>/liuli-reveal?sessionId=<裸UUID>&path=package.json"` 返回 200 后，新 explorer 进程 `MainWindowHandle` 非 0 且标题为所在文件夹名（如 `liuli-theme - 文件资源管理器`）；注意 Host 半修复必须重启 DSH Desktop 才生效（client 半刷新即可）。
- **浏览器面板点三点菜单整个浏览器变黑**：`NativeBrowserPanel` 的「更多」菜单原本 `position:absolute` 挂在按钮下方，矩形与 carrier 相交；`isObscuredByOverlay` 检测到相交就隐藏原生 WebContentsView，carrier 露底（暗色主题即黑色）。正确做法：菜单用 `createPortal(menu, document.body)` + `position:fixed`，JS 按 `moreWrap`/`carrier` 的 `getBoundingClientRect()` 计算 `top/left`，并把 `moreMenuRef` 纳入外点关闭判断；这样菜单不会被 dock 面板 `overflow:hidden` 裁剪。产品要求菜单**向下展开**时：菜单覆盖 carrier 区域不能直接让 `isObscuredByOverlay` 隐藏原生视图，而是给 `reportGeometryLoop` 传 `getRectOverride`，把原生视图 bounds 下移到菜单底边以下（顶部留 4px 间隙），同时 `isObscuredByOverlay` 增加 `ignore` 参数忽略该菜单自身；`reportGeometryLoop` 的清理函数挂 `sendNow` 供菜单开合时立即重报，不等 300ms 心跳。WebviewTag 模式（`<webview>` 是 DOM 节点）直接向下定位即可，无需 bounds 让位。验证：打开浏览器 → 点三点 → 菜单从按钮下方展开、完整可见且网页不黑（WebContentsView 模式网页临时下移让位）。
- **拉伸浏览器面板时网页内容延迟/溢出面板**：`reportGeometryLoop` 对每次几何变化并发 `POST /liuli-browser/tabs/geometry`，请求可能乱序到达，Host 用旧 bounds 覆盖新 bounds，原生视图比 carrier 宽/高；且页面刷新后渲染端序号从 0 开始，会被 Host 当过期上报丢弃导致浏览器隐藏。正确做法：渲染端按 tab 维护单调递增 `seq`，并每次页面加载生成 `geometrySession` 一并上报；Host 对同 session 丢弃 `seq < lastGeoSeq` 的旧上报，session 变化时重置 `lastGeoSeq`。但原生 WebContentsView 无法被 DOM `overflow:hidden` 裁剪，收缩面板时异步跟随必有一两帧溢出；因此在 `reportGeometryLoop` 用 MutationObserver 监听 `body[data-liuli-resizing]`，resize 期间把几何 `visible` 置 false 隐藏原生视图（`isVisible` 回调加入 `!isResizeInProgress()`），结束再按最终 carrier 几何恢复显示。验证：`pnpm build` 后拖拽浏览器面板宽度，resize 期间浏览器隐藏不溢出、松手后按最终 bounds 贴合；刷新页面后浏览器仍可见。
- **zcode 参考实现的浏览器用 `<webview>` DOM 标签，而我们用 WebContentsView，这是“拉伸溢出”的根本差异**：`<webview>` 是真实 DOM 节点，会被父容器 `overflow:hidden` 自然裁剪；`WebContentsView` 是窗口级原生视图，DOM 裁剪对它无效，只能靠异步 `setBounds` 跟随。彻底修复：`patch-desktop-frameless.mjs` / `frameless-patch.ts` 额外给 DSH Desktop 的 `electron-runtime-*.js` 打 webviewTag 补丁（把 advanced/compatibility 主窗口 `webPreferences` 里的 `webSecurity: true` 替换为 `webviewTag: true,\n\t\t\twebSecurity: true`，需重启 DSH Desktop 生效）；客户端 `PreviewPanel` 检测 `document.createElement('webview').loadURL` 可用后走 `WebviewTagBrowserPanel`（`<webview>` 元素 + DOM 事件同步状态 + CSS 缩放响应式），否则回退 `WebContentsView` 或 iframe。验证：`node scripts/patch-desktop-frameless.mjs` 输出“已启用 webviewTag”，重启 DSH Desktop 后打开浏览器标签，CDP 里 `document.querySelector('webview')` 存在且拖拽面板时无溢出。
- **会话页头独立面板出现“两个手柄”**：header 拆成独立 dock 面板后，面板顶部有 dock 抓握簇（gripCluster，拖拽/浮动），header 底部还保留 HeaderEffects 的垂直拉伸手柄（`.resizer`，ns-resize），与页头/正文之间的 sash 功能重叠（三个 resize 相关手柄）。最终方案：**把 resizer 并入 sash**——`HeaderEffects.module.css` 用 `:global([data-region-pane='region:conversation-header']) .resizer { display:none !important }` 隐藏页头面板内的 resizer；同时把 `DockShellFrame.module.css` 的 `.sashH::before / .sashV::before` 的 `opacity` 从 0 提到 0.55，让 sash 的 44×4/4×44 指示条**常驻可见**（hover/active 仍高亮品牌色），这样页头/正文之间始终能看到一个 resize 手柄。sash 拖拽写 `liuli:header-height` 的逻辑保留；gripCluster 仍 hover 显示负责拖拽/浮动面板。注意：不能只隐藏 resizer 而让 sash 保持 hover 可见（opacity 0），否则平时看不到任何手柄。验证：CDP 查 styleSheets 有 `conversation-header .<hash>_resizer { display:none }` 规则，且 `getComputedStyle(sashV,'::before').opacity` 为 0.55（现在改 0.6，见下一条）。
- **sash 常驻指示条被当成 header 底下的黑线**：上一版 `.sashV::before` 用 `top:2px` + `translate(-50%,-50%)`，44×4 指示条整体落在分割线下方，像 header 底下一根深色短线；且 `background: var(--dsw-alias-border-l2)` 偏深。修复：`top/left` 改为 0 让指示条以 sash 分割线为中心骑缝，`background` 改用更浅的 `var(--dsw-alias-border-l1)`、`opacity:0.6`（hover/active 仍高亮品牌色）。验证：headless CDP 查 `getComputedStyle(sash,'::before')` 的 `top/left` 为 `0px`、`backgroundColor` 等于 `--dsw-alias-border-l1`、`opacity` 为 0.6。
- **header 底部黑线是官方 header 元素自带的 `::after` 底部 1px 线（类名 `.wSkVaW_header:after`）**：用户用元素选择器点中的是 `[data-region-pane="region:conversation-header"].paneCard`，但真正的线是 header 元素的 `::after`（`position:absolute; inset:auto 0 1px; height:1px; background:rgb(70,72,60)`）。此前尝试 `border-bottom`、`box-shadow`、`margin-bottom` 均无效，因为都不是这条线。修复：在 `DockShellFrame.module.css` 追加 `:global([data-region-pane='region:conversation-header'] header[class*='_header']::after) { display: none !important }`（编译后为 `header[class*=_header]:after`）。验证：headless CDP 注入该规则后 `getComputedStyle(header,'::after').display === 'none'`；注意安装后运行中的 Desktop 可能仍提供旧 bundle，需重启 DSH Desktop 再刷新才生效（见“运行中的 DSH Desktop 可能继续提供旧 client bundle”条目）。
- **会话页头面板裁剪官方后台任务悬浮窗（三层 overflow:hidden 叠加，只放开 .pane 不够）**：`.pane` 默认 `overflow:hidden`，header 拆成独立面板后，官方「后台任务」popover 定位在 header 内、溢出面板范围时被裁掉（元素选择器一开 popover 就消失，很难取证）。裁掉它的父容器链有三层，必须全部放开：① `.pane[data-region-pane='region:conversation-header']`（.pane 默认 hidden）；② `.conversationHeaderHost`（header host，默认 hidden）；③ 页头浮动成独立窗口时还有 `.floatWindow` 与 `.paneBody` 两层。修复：在 `DockShellFrame.module.css` 把 `.conversationHeaderHost` 改为 `overflow: visible`，`.pane[data-region-pane='region:conversation-header'] { overflow: visible }`，并补 `.floatWindow:has([data-liuli-conversation-header-host])` 与其 `.paneBody` 的 `overflow: visible`。声纹背景层不受影响（其 `.wrap` 自身仍有 overflow:hidden 负责圆角裁剪；header 元素透明、浮动窗口内容有 10px 内留白不贴圆角）。验证：有后台任务运行时点开 header 里的后台任务入口，popover 完整显示不被面板截断；安装后运行中的 Desktop 可能仍提供旧 bundle，需重启 DSH Desktop 再刷新才生效。
- **页头面板高度记忆要继承原 resizer 逻辑，且 restore 的 dividerIndex / dockPad 必须实测**：resizer 与页头/正文之间的 sash 都会写 `liuli:header-height`。恢复时 dividerIndex 是分割线下标，不是 `findParentSplit` 返回的子级下标：header 面板在 v split 首位时 divider=1，否则用 parent.index。几何关系以实测为准：paneCard 上下 margin 各一份 `dockPad`，所以目标 shard 高度 = saved + 2×`dockPad`。`--dsh-header-height` 在 header 搬走后要在正文 `div[data-phase]` 上置 0px，搬回时 removeProperty 交还 HeaderEffects。验证：CDP 设置 `localStorage['liuli:header-height']=120` 后 reload，header pane rect 高度 ≈120；模拟拖拽页头/正文 sash 后 localStorage 写入 pane 高度。
- **会话页头面板 sash 缩不到 78px（被 12% 比例下限卡在 ~106px）**：`beginSash` 的可变 split clamp 与 `resizeSplitTo` 的 `MIN_SIZE` 都按 12% 比例处理，但 `CONVERSATION_HEADER_MIN_H=78`（pane 卡片最小可见高度）换算出的 shard 像素下限小于 12%（split 高约 885 时 12%≈106px），向上拖 sash 时页头被弹回 106px，无法缩到对话按钮底部。修复：`variableShards` 增加 `beforeHeader/afterHeader` 标记，onMove 的 lo/hi 对页头侧只按像素 `minBeforeRatio/minAfterRatio` 夹取（不再叠加 `MIN_SIZE*sizesTotal`）；onUp 遇到页头相邻 sash 时用 `structuredClone` + `findNode` 直接写 `node.sizes[dividerIndex-1]/[dividerIndex]` 提交，绕过 `resizeSplitTo` 的 MIN_SIZE clamp。`childMinPx` 的页头 v 分支返回 `CONVERSATION_HEADER_MIN_H + 2×dockPad`（paneCard 上下 margin 各一份留白）。验证：headless Chrome CDP 打开 advanced 模式，向上拖页头/正文 sash 后 pane 高 78、shard 高 86（dockPad=4 时）、localStorage 写入 78；若仍卡 106 说明 clamp 未走 header 分支。
- **页头面板 78px 恢复/实时调整仍弹回 106px，且 header/canvas 不跟随缩放**：三个叠加坑。① `--liuli-dock-padding` 由 `liuli-runtime` 异步写入 body，DockShellFrame 首次渲染读 body 变量会拿到空值回退 8，后续 min/恢复都按 8 计算。修复：`dockPad` 从一次性 IIFE 改为 `useState(8)` + `useLayoutEffect`（立即读 + rAF 重试 10 帧 + body style MutationObserver）；`applySavedHeaderHeight` 恢复时也实时读该变量，未就绪就 rAF 重试。② `LiuliHeaderResizer` mount 时会把 localStorage 里的高度写成 `header.style.minHeight`，独立面板模式下把 header/声纹 canvas 钉住不跟 sash 缩放。修复：`syncConversationHeader` 把 header 搬入面板后 `removeProperty('min-height')`；`LiuliHeaderResizer` 检测 `header.closest('[data-region-pane="region:conversation-header"]')` 存在时跳过 min-height 写入/拖拽，并在 `sync()` 里把 `--dsh-header-height` 写 0、mask 不包含 header（header 已不在 phase 内）。③ 恢复路径 `applySavedHeaderHeight` 与 `resizeHeaderPaneTo` 仍走 `resizeSplitTo`，MIN_SIZE 会把 78px 弹回 106px；改为与 sash onUp 相同的直接写 `node.sizes`。验证：headless Chrome CDP 拖 sash 后 pane 78/shard 86/localStorage 78；设置 localStorage 120 后 reload，pane 恢复到 120/shard 128，且 header 无内联 min-height。
- **win32 无边框窗口拖拽区 = 各贴顶卡片的顶部条带（每张卡片各自的“迷你标题栏”）**：去掉 caption 行后，把 `-webkit-app-region: drag` 落到每张贴顶卡片顶部的**已知 chrome 元素**上，内部交互子元素 no-drag 挖洞保持可点——可点性不依赖任何“匹配交互元素”的列表（曾尝试：全宽覆盖条 + 逐元素 z-index 201 → 维护脆弱；lift-above-drag.ts 动态抬层 → 真实 Electron 吞掉 drag 区上的 move 事件、悬停检测断供，均废弃）。当前 drag 区：会话页头 header（`[data-region-pane="region:conversation-header"] header` 或回退到 `region:conversation` 内 header）；侧栏 logoRow（`[class*="_sidebarCol"] [class*="_logoRow"]`，60px）；详情右侧面板标签条（`[data-preview-panel] [class*="_tabStrip"]`，48px）；dock 多标签面板标签条（`[data-testid="dock-tab-strip"]`）；开始页会话面板顶部 42px 拖动条（`[data-liuli-pane-drag]`，`pointer-events:none` 默认、`:has(header[aria-hidden])` 激活）。布局 1-2-1（或任意列数）时左/中上/右卡片顶部各有一块 drag 区，整条顶部都被覆盖，与列数无关。**no-drag 挖洞**：`header :is(button, a, input, select, textarea, label, [role], [contenteditable], [data-liuli-window-controls])`、`logoRow :is(button, a, input, select, textarea, [role], [tabindex], [contenteditable])`、`tabStrip :is(button, a, [data-side-pane-tab-id], [role], [tabindex])`、`dock-tab-strip [data-testid="dock-tab-chip"]`——真实命中测试对 no-drag 洞放行（验证脚本 S6/S11 用 CDP 真实输入点击 no-drag 洞内按钮可达）。**关键教训**：① 覆盖式 drag 条（兄弟层盖在内容上）是死路——渲染层对 drag 区失明，只能提前抬升（匹配）或放弃 app-region；② 真实 Electron/Chromium 吞掉 drag 区上的鼠标事件（含 move，headless JS 合成事件绕过输入管线测不出），任何“按指针位置检测”的渲染层方案在真机失效；③ 正解是把 drag 放到**已知的卡片 chrome 元素**上（原生事件、无合成、无 IPC），交互子元素用受限的 no-drag 规则挖洞。已知取舍：**顶边门控 [data-edge-top]**——只有「触及 dock 画布顶边」的卡片（edgeMap 实测 shard 顶与画布顶齐平，`recomputePaneEdges` 的 `top` 标志，注意该函数各分支的 `top` 曾硬编码 false，已补 `topFlush` 计算；非区域 paneCard 也补挂了 data-edge-* 属性）其 chrome 才是窗口拖拽区，dockable 布局中拆到下方/中间的卡片 chrome 保持自身语义（标签条排序等），不会误拖窗口；页头面板内 header 空白区拖的是窗口不是面板（用户确认接受）；`SETTINGS_DEFER_CSS` 在设置页打开时把全部 drag 区临时置 no-drag（几何拖拽区吞点击与层级无关）。验证：`node demo/verify-header-drag.mjs`（S1..S15：条带已移除、页头 pane 标 data-edge-top、header/logoRow/tabStrip 均 drag、注入按钮 no-drag + CDP 真实输入点击可达、去掉 data-edge-top 后 header 不再是 drag 区（门控负用例）、dock-tab-strip/paneTopDrag 保留）；真机手测拖窗/双击最大化/snap 正常。
- **会话 hover 预览卡（HoverCard 可复制卡）文字颜色硬编码为浅米色 #E4E2DA，浅色主题下与琉璃亚克力背景对比度不足**：宿主 `dsh-client-ui-primitives` 的 HoverCard `.card` 背景是硬编码 `#2C2C2E`（注释明确 light/dark 相同），会话列表 hover 卡文字色硬编码 `#E4E2DA`；琉璃的全局磨砂规则 `div[aria-label][class*="_card"]` 已把该卡背景改成 `--dsw-specific-input-major`（浅色主题下是浅色亚克力），文字仍是浅米色，导致浅色主题下“浅字浅底”几乎不可读。正确做法：不要去掉背景磨砂，而是补 `div[aria-label][class*="_card"][class*="_copyable"], div[aria-label][class*="_card"][class*="_copyable"] * { color: var(--dsw-alias-label-primary) }` 让文字跟随主题（`liuli.css` 与 `liuli-css.ts` 必须同步；运行时注入以 `liuli-css.ts` 为准）。验证：浅色主题下 hover 会话列表条目，预览卡文字为深色主文字色、清晰可读；暗色主题下仍为浅色主文字色。
- **浏览器面板背景透明要三层一起做，否则仍露实底**：① `PreviewPanel.module.css` 的 `.carrier` / `.emptyWebview` 背景必须从 `var(--dsw-alias-bg-base)` 改为 `transparent`（这是用户看到实底的主因）；② WebContentsView 承载路径由 `browser-engine.ts` 的 `view.setBackgroundColor('#00000000')` 保证原生视图透明（已实现，勿回退成默认白底）；③ `<webview>` DOM 标签路径必须给元素加 `allowtransparency` 属性，否则 webview 自带白底盖住透明 carrier。iframe 回退路径无法强制跨域页面透明（浏览器默认白底）。注意：网页自身绘制背景时透明不可见（大多数站点有白底），只有无背景站点/空状态能看到亚克力透出。验证：打开浏览器空状态时能看到面板亚克力材质而非实色块；打开无背景页面（如 `data:text/html,<body style="background:transparent">`）时 carrier 透出亚克力。

- **元素选择器点中详情列左缘“透明 5px 手柄”，用户看到的线其实是 panel 左描边**：advanced dock 模式下 `[data-preview-panel]`（`_*_panel`）左缘有 `border-left:1px solid var(--dsw-alias-border-l1)`，而 `PreviewPanel` 自己的 `.resizeHandle` 是覆盖在描边内侧的透明 5px 绝对定位层（`background:transparent`），元素选择器会优先命中手柄，导致「selected element 是 resizeHandle、实际可见线是 panel 左描边」的错位。正确做法：视觉线问题要查 `border-left` 而非手柄背景；advanced dock 模式已由 sash 接管宽度，应在 `PreviewPanel.module.css` 里 `:global(body[data-dsh-desktop-mode="advanced"]) .resizeHandle { display:none !important }`，并在 `index.ts` 的 `DESKTOP_ADVANCED_CSS` 中去掉 `[data-preview-panel]` 的 `border-left` 重加规则（保留 `[class*="_detailsCol"] [class*="_panel"] { border-left:none !important }`）。验证：headless Chrome CDP 打开 advanced 模式，`getComputedStyle(panel).borderLeftWidth` 为 `0px`，`getComputedStyle(handle).display` 为 `none`。
- **删除/重命名源文件后 `lib/types` 会残留旧 `.d.ts`/`.js.map` 并被打进 tarball**：`tsc -p tsconfig.json` 只增量生成类型，不会清理已删除源文件对应的旧产物（本次删除 `src/client/browser-pick-bus.ts` 后，`lib/types/client/browser-pick-bus.d.ts` 等仍存在并被 `pnpm install:desktop` 打包进 tarball）。正确做法：删除源文件后顺手清理 `lib/types/**` 下同名残留（`Get-ChildItem lib/types -Filter '<basename>*' | Remove-Item`），并确认 tarball 内容里没有旧文件；不要手改其它 `lib/` 内容。
- **消息入场动画在对话页加载完后重播一次（看起来播两次）**：`liuli-transition.ts` 只处理 `addedNodes`，长会话分两批挂载（首屏 + 历史加载完成）且间隔超过 400ms 合并窗口时，第二批会被当成新批次再播一次。最终方案（多轮迭代收敛）：① 先处理 `removedNodes` 记录被移除锚点的 `data-chat-anchor-key`（TTL 4s），同 key 稍后重挂载视为替换，不重播；② 同列批量动画后 **15s 冷却**，冷却期内**纯批量追加**（本批无锚点移除且 `totalAdded > 1`）不重播，单条流式（`totalAdded === 1`）始终动画；③ 若本批存在锚点移除（切换会话/替换），冷却不生效；④ 列状态带 `createdAt`，创建后 3s 内走初始稳定窗口——每个新锚点重置 **400ms 防抖** timer，稳定后统一按文档序级联，React 分帧提交的首屏 + 历史批次合并成同一批；⑤ **收集即隐藏**：进入 pending 的锚点先 `style.opacity='0'`，flush 时 `applyEnter` 先移除内联 opacity 再挂类，避免防抖等待期间消息先以默认状态显示、动画晚播时又“消失重播”；⑥ **级联按视口内可见性分配，且视口外不挂动画类**：flush 时对每个锚点 `getBoundingClientRect()`，视口内可见的按文档序递增 delay（30ms 步进、600ms cap）并挂类动画；视口外的直接 `removeProperty('opacity')` 显示、不挂类。这样长会话（180+ 条）切换时只有约 10~20 个元素动画，而不是整列同时启动动画导致卡顿；视口外滚动到时已就绪。不能按文档序前 N 个递增——用户视口常在列表底部，看到的是文档序靠后的消息（如 nth-of-type(188/189)），按前 N 个递增会让视口内全部 delay=0、整块出现。**注意 removed 单锚点的 `parentElement` 已为 null，必须用 `mutation.target.matches('[data-chat-flow]')` 判断它原本是否直接挂在列下**。验证：headless Chrome 点击真实会话后，ENTER 事件只出现一批、前 30 条 delay 0~580ms 递增、13s 后的批量追加无 ENTER；注入测试列验证：首次批量动画 → 冷却期纯批量跳过 → 有移除的切换会话正常动画 → 同 key 移除重挂载跳过。
- **滚动容器内 `position:absolute; bottom:0` 的手柄会随内容滚动而错位**：`overflow:auto` + `position:relative` 的容器里，绝对定位子元素不是固定在可视区底部，而是参与滚动内容一起滚（headless Chrome 实测滚动 100px 后手柄 top 也移动 100px）。审查面板的 diff 容器手柄 `[data-testid="review-diff-resize"]` 因此「上下滚动 diff 就错位」。正确做法：把滚动与手柄分到两层——外层 `.diffPane` 保持 `position:relative; overflow:hidden`（不再 `overflow:auto`），新增内层 `.diffScroll { height:100%; overflow:auto }` 包住内容，手柄留作外层的 absolute 子元素。验证：展开审查文件 diff 后上下滚动，手柄 rect 始终贴在 diff 容器底边；内容不超高时手柄也在容器底部。
- **全新 clone 后直接 `pnpm install:desktop`（未先 `pnpm install`）会失败**：`pnpm pack` 会触发 `prepare`（=`pnpm build`），而全新 clone 的 `node_modules` 尚未安装，`tsc`/`tsdown` 找不到（pnpm 实测输出 `[ELIFECYCLE] Command failed with exit code 7` + `node_modules missing, did you mean to install?`，pack 以非零退出码中止），进而让 `install-desktop.mjs` 的 `run()` fail。修复：本地安装分支在 pack 前 `ensureBuilt()` 检查 `node_modules/.bin/tsc(.cmd)`、`tsdown(.cmd)` 是否存在，缺失则自动 `pnpm install`（装 devDeps + 触发 prepare 构建 lib/）；README / docs/install.md 也补了前置 `pnpm install` 步骤。验证：`node --check scripts/install-desktop.mjs` 通过；全新 clone 直接跑安装器应先自动 install 再 pack，不再因 tsc 找不到而失败。
- **`pnpm install:desktop` 在 DSH Desktop 从未启动过时失败**：`~/.dsh/profiles/desktop`（含 `package.json`、`cordis.patch.yml`）由 DSH Desktop 首次启动时生成；全新机器未启动过 DSH Desktop 时该目录不存在，安装器直接 fail。修复：`install-desktop.mjs` 的报错信息补充「请先启动一次 DSH Desktop 生成 profile」，README / docs/install.md 也把「启动过一次 DSH Desktop」写进前置条件。验证：删掉（或指向空目录）`DSH_PROFILE_DIR` 跑安装器应看到该提示而非裸的「找不到目录」。
- **壁纸选区「退出重进 → 最大化 → 还原 → 最大化」后位置与上次不一致**：`bg_area` 是「相对原图的绝对选区」（0..1 图片坐标），与窗口绝对像素尺寸无关；`liuli-runtime.ts` 的 `bgGeometry` 应用时已用 `normalizeAreaToRatio(area, vRatio/iRatio)` 按窗口宽高比动态归一化（保持选区中心与面积、仅调宽高比），本已避免拉伸。但 `index.ts` 的 `window resize reapply` effect 旧实现每次 resize 都用 `scaleX=vw/lastViewportWidth`、`scaleY=vh/lastViewportHeight` 把 `lastBgArea` 独立缩放（最大化/还原宽高比不同 → scaleX≠scaleY 破坏选区宽高比），经 `fit=min(1,1/w,1/h)` + `x/y` 的 clamp 累积中心漂移，并 `writeLiuliSettings`（含 pushRemoteState 持久化到 Host）把污染值落盘，下次启动恢复的即是污染值。修复：resize 只调用 `applyLiuliWallpaper(readLiuliSettings())` 重新应用壁纸层（让 `bgGeometry` 用最新窗口比例归一化），**不再缩放、不再写回 `bg_area`**；删除仅服务于错误缩放的 `lastBgArea`/`lastViewportWidth`/`lastViewportHeight`（及 loadRemoteState/commitLiuli/reset 里对它们的赋值）。验证：`bg_area` 的写入点只剩「上传默认选区」（uploadWallpaper）与「框选完成 onArea」（LiuliAppearance）两处；resize 往返不再改 localStorage 的 `bg_area`。
- **换壁纸后声纹 canvas 颜色不跟随刷新**：`HeaderEffects.tsx` 的 `brandRGB()` 用 `brandCache` 缓存解析后的品牌色，缓存键只有 theme（`data-ds-dark-theme`）；换壁纸只改 `--dsw-alias-brand-primary`（经 `applyLiuliSettings → dynamicSourceFromImage → liuliApplyBrand` 落地）而不改主题属性，缓存永不失效，声纹波形每帧仍用旧颜色。修复：`liuliApplyBrand` 末尾 `dispatchEvent(new CustomEvent('liuli:brand-changed'))`（品牌色落地的单一事实来源），`HeaderEffects` 在 `brandCache` 声明处监听该事件并置 `brandCache = null`，下一帧 `brandRGB()` 重读新 `--dsw-alias-brand-primary`。验证：上传一张与当前取色差异明显的新壁纸（动态取色模式），声纹 canvas 波形颜色应随新源色变化，无需刷新页面。
- **对话页壁纸模糊「没跟卡片一致、正文顶部有缺」**：`liuli-css.ts` 运行时把壁纸模糊层改由 `div[data-phase]::before` 承载（`inset:0` 铺满 root，active 态再 `bottom:-16px` 下探覆盖 scrollBody 的 `margin-bottom:-16px`），mask 通过 root 上的 `--dsh-wallpaper-mask` 传给 `::before`。但 `HeaderEffects` 生成 SVG mask 时用 `root.querySelector(':scope > [aria-hidden="true"]:first-child')` 作坐标参考——官方 `div[data-phase]` 下只有 `div[data-slot="conversation.session.header"]`（display:contents）+ `div[data-conversation-scroll]` 两个 div，**没有** aria-hidden 模糊层子元素，querySelector 落空 → `blurRect === undefined` → 提前 return，mask 一直走 fallback `linear-gradient`（无圆角 + 顶部按 `--dsh-header-height` 硬算 12px 缝），于是正文卡片顶部缺一段模糊、圆角也对不上。修复分两步：① 改用 `root.getBoundingClientRect()` 自身作 mask 坐标参考，viewBox 高度补 `overhang`（active 态 +16px，与 `::before` 的 `bottom:-16px` 对齐），让 header/body 的 SVG 形状按真实 rect 精确生成。② **advanced dock 页头独立面板模式下 header 被搬到 `region:conversation-header`，`header.closest('[data-phase]')` 会返回 null**，LiuliHeaderResizer 直接不生成 mask，正文面板 `--dsh-header-height` 被 DockShellFrame 置 0，fallback 又变成「顶部 12px 透明缝 → 正文顶部缺一段模糊」；需在 root 落空且 header 处于页头面板时，全局回退 `document.querySelector('[data-region-pane="region:conversation"] div[data-phase]')`，只为正文卡片生成 mask（headerSvg 由 inDockHeaderPanel 置空）。验证：active 态会话页正文卡片顶部/圆角处模糊贴合卡片，中间缝露出壁纸；advanced 页头独立面板下正文顶部也不缺；`root.style.getPropertyValue('--dsh-wallpaper-mask')` 为 SVG data URL 而非 fallback。③ **收起侧栏时对话页模糊「消失」**：`sync()` 的 active 分支里，当 `root.querySelector('[data-conversation-scroll]')` 落空或 `bodyRect.height <= 0`（收起侧栏等布局重排的中间态）时 `bodySvg` 为空字符串，页头独立模式下 `headerSvg` 也为空，生成的 SVG mask 是空的 `<svg></svg>` → mask 全透明 → 壁纸模糊层完全不可见（其他卡片不依赖此动态 mask，所以「只有对话页会」）。修复：body 缺失/高度为 0 时退化为整卡 mask `<rect x=0 y=0 width=w height=h rx=圆角>`，保证模糊层不消失；scrollBody 恢复后 RO 会再触发 `sync` 重建精确 mask。④ **根治（照搬侧栏等卡片的稳定做法）**：页头独立模式下正文 phase 只有 scrollBody 一张卡片，本就无需「挖 header↔正文缝」的动态 mask，直接改用 clip-path 整卡裁剪——`div[data-phase='active']:not(:has(header))::before { mask-image: none !important; clip-path: inset(0 round var(--liuli-radius) var(--liuli-radius) 0 0) }`（顶部圆角、底部直角，与 scrollBody active 态一致）。这样页头独立模式下磨砂层是纯 CSS 静态裁剪，不再依赖 HeaderEffects 动态生成的 SVG mask，收起侧栏等任何布局重排都不会让模糊消失；普通模式（header 仍在 phase 内）`:has(header)` 命中，仍走动态 mask 挖缝。
- **header 拆成独立面板后页头内容空白（两个叠加根因）**：`dock-shell-frame.tsx` 的 `syncConversationHeader()` 把官方 `<header>` 从正文 `div[data-phase]` 搬到页头面板 host。① 旧逻辑 `const first = headers[0]` + `for (i=1..) headers[i].remove()` 假定「第一个 header 一定是有效节点」；React 重建会话根时可能残留多个 header（新旧并存），若 `headers[0]` 是空的旧节点、真正有内容的 header 在后面，就会「保留空节点、删掉有内容节点」。修复：优先 `headers.find(h => h.childElementCount > 0) ?? headers[0]` 选有内容的 header，并改为 `for (const h of headers) if (h !== first) h.remove()`（不能按下标 i>=1 删）。② **页头面板被拖拽拆分/浮动时**：header 之前已被 appendChild 进旧 host，React 卸载旧 host（removeChild）会把 header 作为其 DOM 子树一起移出 document（detached），此时正文 phase 已查不到 header、`headers.length===0` 直接 return，新 host 永远空。修复：新增 `headerRef` 保存当前页头 header 引用，`headers.length===0` 时若 `headerRef.current` 已 detached（`!isConnected`）且新 host 无 header，就 `headerHost.appendChild(headerRef.current)` 抢救回新 host；搬入成功后更新 `headerRef.current`。
- **侧边栏浏览器自动驱动（LLM 活动感知）与 agent CLI `open --show`**：`src/client/auto-drive-browser.ts` 观察对话流——bash 工具行摘要命中 dev server 关键词（英文 vite/next dev/serve/http.server/php -S 等 + **中文「启动本地开发服务器」「运行 xxx 服务 5173」等**）时临时展开 disclosure 读取输出（读完即收起，流式重试 3 次），解析本地地址（Vite/Next/CRA「Local:」、webpack「Project is running at」、python「Serving HTTP on … port N」、php -S 等；`0.0.0.0` 归一 `localhost`，**只认回环地址**）自动在侧边栏打开浏览器标签并展开面板；**后台服务兜底**：摘要不命中但行 `data-state="running"`（或文本含「运行中」）时仍读一次输出（长驻进程大概率是服务，输出里的回环 URL 即地址；watch/编译等无 URL 的长驻任务不触发）——LLM 用 `run_in_background` 拉起的服务也能自动弹出，不依赖摘要写对关键词；edit/write 前端文件（html/tsx/jsx/vue/css 等；有 dev server 时放宽 .js/.ts）且本会话已知 dev server 地址（10 分钟 TTL）时每轮最多一次导航回 dev 根地址；控制策略与 auto-open-details 相同（每轮一次 / 手动收起抑制 / 会话切换重置 / 3s 稳定窗口），设置项 `auto_drive_browser`（功能分区，默认开）可关。纯逻辑（`parseDevServerUrl` / `looksLikeDevServerRow` / `looksLikeFrontendFile`）单测 `node demo/test-auto-drive.ts`。**agent 想让侧边栏显示浏览器时用 `open --show`**（CLI 生成 `browser:show-<uid>` id），PreviewPanel 每 4s 轮询 `/liuli-browser/capabilities` 只把 `browser:show-*` 前缀的引擎标签桥接进侧边栏（同源已有标签时自动驱动路径导航复用而非新开）；普通 `browser:*` / `agent:*` 标签**不会**被桥接（agent 无头验证/测试网页不会莫名弹出侧边栏浏览器——实测 headless 验证脚本的 example.com 标签曾污染真实 persist 导致「没做前端却老是弹 example domain」）。改这里时同步 `scripts/browser-client.mjs`、`docs/browser-use.md`、`skills/control-browser/SKILL.md`。

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
