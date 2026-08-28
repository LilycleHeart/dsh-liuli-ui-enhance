# dsh-liuli-ui-enhance 嵌入式浏览器（webview 引擎）

> DSH Desktop IAB（In-App Browser）+ browser-use 插件的 DSH 实现，
> 仅修改 dsh-liuli-ui-enhance 插件实现。

## 架构

- **Host 半（Electron 主进程）**：`src/browser-engine.ts` 用
  `WebContentsView` 承载页面（DSH 宿主未开 webviewTag 时；开了则侧边栏走
  `<webview>` DOM 承载）。会话分区
  `persist:liuli-embedded-browser`（DSH `persist:embedded-browser` 对应），
  cookie/storage 跨重启保留。
- **CDP 操作面**：`src/browser-ops.ts` 经 `webContents.debugger` 把官方
  Playwright InjectedScript（`src/vendor/playwright-injected-script.ts`，提取自
  playwright-core 1.59）注入 `Page.createIsolatedWorld`，提供 aria 快照、
  元素信息、真实输入（click/press/insertText）、键盘、滚动、下拉、勾选与
  world 内求值——ZCode 桌面端 IAB「可操作调试」能力对应实现。
- **路由**：`/liuli-browser/capabilities|events|tabs|tabs/action|tabs/geometry|
  tabs/viewport|tabs/state|tabs/screenshot|tabs/execute|open-external|ops`，
  只接受回环调用方。外部进程一律走 CLI 的 `LIULI_BROWSER_VIA=cdp` 桥（见下）。
- **渲染端**：`src/client/browser-webview.ts`（能力探测 / SSE 总线 / 几何上报）
  + `PreviewPanel.tsx` 的 NativeBrowserPanel / WebviewTagBrowserPanel。纯 Web 部署
  探测失败自动回退 iframe + /liuli-proxy。

## DSH 行为说明

| 参考实现（09-renderer-renamed styles-OqUHW1P0） | 本插件 |
| --- | --- |
| `<webview partition="persist:embedded-browser" allowpopups>` | WebContentsView + persist 分区（webviewTag 开启时 `<webview>`） |
| did-start/stop-loading, did-navigate(-in-page), page-title-updated | webContents 同名事件 → SSE state |
| did-fail-load（ERR_ABORTED=-3 忽略） | 同 |
| render-process-gone → webviewGeneration++ 原位重建恢复 URL | rebuildTab/generation |
| setWindowOpenHandler → 「[App] webview 请求打开右侧浏览器 tab」 | SSE new-tab → 侧边栏新标签 |
| 工具条 h-12：back/forward/reload(转圈)/地址栏/响应式/拾取/更多 | 同（data-testid 对齐） |
| 更多菜单：在默认浏览器打开 + 开发者工具 | 同（shell.openExternal / openDevTools detach） |
| 响应式：宽/高/zoom(fit,50..200)，BROWSER_VIEWPORT_LIMITS 320..3840/2160 | 同（zoom=webContents.setZoomFactor） |
| elementPicker：选完入聊天、Esc 取消、失败提示 | executeJavaScript 注入拾取器 |
| 空态（globe + browser.title/browser.empty） | 同 |
| browser-use 插件 browser-client.mjs（IAB/headless CDP 双形态） | scripts/browser-client.mjs（+ CDP 桥中转） |
| agent 侧 CDP 浏览器控制（22 种命令 + Playwright locator 引擎） | /liuli-browser/ops（browser-ops.ts，26 项验证） |

## ops CDP 操作面（可操作调试）

`POST /liuli-browser/ops`，body `{ tabId, method, params }`，返回
`{ ok: true, value }` / `{ ok: false, error: { code, message } }`。

- **tabId**：引擎标签 id（`agent:*` / `browser:*`）；`webview` /
  `webview:<url子串>` 解析侧边栏 `<webview>` 承载的 guest（webviewTag 开启时
  侧边栏浏览器走 DOM webview，不建引擎标签）。
- **方法**：`snapshot`（ariaSnapshot，mode `ai`（带 `[ref=eN]`）/`yaml`）、
  `elementInfo`、`click`（真实按下/抬起）、`type`/`fill`、`press`、`hover`（合成）、
  `scroll`、`select`、`check`/`uncheck`、`evaluate`（isolated world）、`playwright`
  （domSnapshot/elementInfo/evaluate/locator）、`getState`/`navigate`/`back`/
  `forward`/`reload`/`stop`/`newTab`/`closeTab`/`list`/`screenshot`/
  `browserViewportSet`/`browserViewportReset`。
- aria 快照的 `[ref=eN]` 跨请求可用：isolated world 同名复用同一
  executionContext，注入实例（`globalThis.__liuliPlaywrightInjected`）常驻；
  导航后失效，重新 snapshot 即恢复。
- 真实输入前引擎会把屏外/隐藏的视图临时垫进窗口（GUI 之下 + 1024×768），
  否则 Input 命中不了任何元素；操作完按原几何复位，GUI 承载不受影响。
- 自测：`node demo/verify-browser-ops.mjs`（T1..T26，全部经 CDP 桥，需
  调试模式 DSH）。

## 外部 CLI 与 CDP 桥（Host fence）

DSH 服务端对外部直连一律 403：`LIULI_BROWSER_VIA=cdp` 让
`scripts/browser-client.mjs` 全部请求经 `scripts/browser-bridge.mjs` 中转——
连主进程 inspector（默认 9229，`LIULI_INSPECT_PORT` 可指定），主进程里找主窗口
`webContents.executeJavaScript` 执行**页面内同源 fetch** 过 fence。
需 DSH Desktop 以调试模式启动：`tools/dsh-debug-launch.cmd`。

```pwsh
$env:LIULI_BROWSER_VIA='cdp'
node scripts/browser-client.mjs caps
node scripts/browser-client.mjs open "http://localhost:5173" --show
node scripts/browser-client.mjs aria "browser:show-xxx"     # aria 快照
node scripts/browser-client.mjs op "webview:8931" click '{"ref":"e6"}'
```

## 自测

1. `pnpm exec tsc -b && pnpm run bundle`
2. Host 半改动需重启 DSH Desktop（调试模式见 tools/dsh-debug-launch.cmd）
3. `node demo/verify-browser-ops.mjs` → T1..T26（ops 全方法 + 正负用例）
4. GUI 右侧面板 → 浏览器标签：地址栏输入任意站点（含禁嵌入的 Google/GitHub 也可加载）
5. `node scripts/browser-client.mjs open https://example.com --tab t1` →
   `aria t1` → `op t1 screenshot`
6. `node demo/verify-auto-drive.mjs` → 自动驱动 + `--show` 轮询桥接 + 驱动审查 GUI 验证
   （T1..T14：dev server bash 行注入 → 侧边栏自动展开出浏览器标签；每轮一次；
   同源复用导航并激活；前端文件编辑驱动；非前端文件不驱动；驱动审查自动切
   「上一轮更改」；`browser:*` 引擎标签轮询桥接）

## 自动驱动侧边栏浏览器（LLM 活动感知）

模型在对话流里做前端项目时，插件会自动把页面展示到右侧边栏浏览器
（`src/client/auto-drive-browser.ts`，设置「功能 → 自动驱动侧边栏浏览器」可关）：

- **dev server 启动**：bash 工具行摘要命中 dev server 关键词（vite / next dev /
  serve / http.server / php -S 等）时，临时展开该行读取输出（读完即收起，
  流式输出最多重试 3 次），解析本地地址（Vite/Next/CRA「Local:」、webpack
  「Project is running at」、serve「Local:」、python「Serving HTTP on … port N」、
  php -S 等；`0.0.0.0` 归一为 `localhost`），自动在侧边栏打开浏览器标签并展开面板。
- **前端文件编辑**：edit/write 前端文件（html/tsx/jsx/vue/css 等；已有 dev server
  时放宽到 .js/.ts）且本会话已知 dev server 地址（10 分钟有效）时，每轮最多一次
  把浏览器标签导航回 dev server 根地址——同源已有浏览器标签则复用导航、否则新开。
- **每轮一次 / 手动收起抑制 / 会话切换重置 / 3s 稳定窗口**：与详细页自动展开
  （auto-open-details）同一套控制策略，避免打扰。
- 纯逻辑单测：`node demo/test-auto-drive.ts`（dev server 输出解析 / 摘要关键词 /
  前端文件识别，34 项）。

### agent CLI `open --show`：驱动即展示

`browser-client.mjs open <url> --show` 会用 `browser:show-<uid>` 作为标签 id 创建引擎
标签；GUI 侧边栏的 PreviewPanel 每 4s 轮询 `/liuli-browser/capabilities`，把新出现的
`browser:show-*` 引擎标签桥接进侧边栏并展开面板——agent 驱动浏览器时用户实时可见。
**只有这个前缀会被桥接**：普通 `browser:*` / `agent:*` 标签（GUI 自己创建的、agent
无头验证的）一律不桥接，避免「没做前端却莫名弹出浏览器」。不带 `--show`（缺省
`agent:<n>`）的标签保持隐藏，适合无头验证（snap/click/shot，不被用户看到）。若用
`--tab <id>` 显式指定 id，请配合 `--show` 使用 `browser:show-` 前缀才能被桥接展示。

```pwsh
node scripts/browser-client.mjs open "http://localhost:5173" --show   # 侧边栏可见
node scripts/browser-client.mjs open "http://localhost:5173"          # 隐藏（无头验证）
```

## 实测记录（DSH Desktop 调试模式重启后，真实 Electron 引擎）

- A 套件 `demo/verify-webview.mjs`：16/16（capabilities/SSE/创建/历史/execute/
  截图/销毁等）。
- B 套件 `demo/verify-webview-gui.mjs`：13/13（无头 GUI 打开侧边栏浏览器全套）。
- **ops 套件 `demo/verify-browser-ops.mjs`：26/26**（aria 快照 ai/yaml、elementInfo、
  click(selector/ref)、fill/type+读回、press 提交表单、hover、scroll、select、
  check/uncheck、evaluate isolated/主世界隔离、playwright.locator/domSnapshot、
  navigate/getState/back、ref 失效恢复、newTab/list/closeTab、screenshot、视口、
  unknown method/tab/参数负用例）。
- **端到端（真实 LLM 前端任务）**：DSH 新建独立会话让模型写 TodoList 静态页 +
  `npx http-server` → 插件自动展开侧边栏浏览器并导航到
  `http://127.0.0.1:8931/`；CLI 经 CDP 桥对侧边栏 `<webview>` 标签
  `aria` 快照读出输入框/按钮 ref → `op fill`「买牛奶」→ `op click`「添加」→
  `aria` 复验列表新增条目，全链路（自动展开 + 可操作调试）通过。
- 注意：DSH Desktop 每次重启后 Web 端口与 CDP 端口都会变（ephemeral），验证脚本
  自动探测；CLI 用 `LIULI_BROWSER_VIA=cdp` + `LIULI_INSPECT_PORT` 指定。
- 隐藏标签（无 GUI carrier 的 agent 标签）截图：Host 端会临时把视图垫到 GUI 之下
  取帧再复位（无闪烁）；真实输入同样走该表面唤醒。

## 无头自测注意

桌面部署按 `dsh-desktop` 设置分 compatibility/advanced 两种 shell 组合：advanced 模式下平台 ui-layout 行被禁用、由桌面壳自带 layout 服务。无头验证脚本用 `?dsh-desktop-mode=advanced`（可用环境变量 `DSH_DESKTOP_MODE` 覆盖），与用户设置保持一致，否则 boot 会因 layout 服务缺位而失败。
