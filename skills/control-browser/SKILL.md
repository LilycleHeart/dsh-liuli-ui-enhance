---
name: control-browser
description: 驱动 DSH 侧边栏嵌入式浏览器（dsh-liuli-ui-enhance webview 引擎）：打开/导航/aria 快照/真实点击/填充/键盘/截图验证，支持外部 CLI 经 CDP 桥操作调试。
---

# Control Browser（dsh-liuli-ui-enhance 嵌入式浏览器）

dsh-liuli-ui-enhance 的 Host 半在 Electron 主进程里用 WebContentsView 承载真实 webview
（DSH Desktop IAB 实现）：独立会话分区 `persist:liuli-embedded-browser`、
任意站点可加载（无 X-Frame-Options 限制）、弹窗自动转侧边栏新标签。
DSH 宿主开了 webviewTag 时侧边栏浏览器改用 `<webview>` DOM 承载，操作面通过
`tabId = webview[:<url子串>]` 同样覆盖。

## 能力面

- GUI 侧边栏「浏览器」标签：地址栏/前进后退/刷新/响应式视口/元素拾取/更多菜单
  （外部打开 + 开发者工具）。data-testid 与 DSH 一致（browser-webview 等）。
- Host HTTP API：`/liuli-browser/*`（tabs/geometry/viewport/action/execute/
  screenshot/state/events SSE + **ops CDP 操作面**）。
- **ops CDP 操作面**（`/liuli-browser/ops`，POST `{tabId, method, params}`）：
  - 快照/定位：`snapshot`（Playwright ariaSnapshot，YAML + `[ref=eN]`）、
    `elementInfo`（tag/rect/selector/文本）
  - 真实输入：`click`/`type`/`fill`/`press`/`hover`/`scroll`/`select`/`check`/`uncheck`
    （Input.dispatchMouseEvent 按下/抬起 + insertText，非合成事件）
  - 高级：`evaluate`（isolated world 求值）、`playwright`（domSnapshot/elementInfo/
    evaluate/locator）、`navigate`/`back`/`forward`/`reload`/`newTab`/`closeTab`/
    `list`/`screenshot`/`browserViewportSet`/`browserViewportReset`
- 命令行客户端：`scripts/browser-client.mjs`（browser-use 插件
  browser-client.mjs 的实现）。

## agent 驱动方式（pwsh 工具）

```pwsh
node "<plugin>/scripts/browser-client.mjs" caps                    # 探测引擎（含 ops 清单）
node "<plugin>/scripts/browser-client.mjs" open "https://example.com" --tab t1
node "<plugin>/scripts/browser-client.mjs" open "http://localhost:5173" --show   # 侧边栏可见
node "<plugin>/scripts/browser-client.mjs" aria t1                 # aria 快照(YAML + [ref=eN])
node "<plugin>/scripts/browser-client.mjs" op t1 click '{"ref":"e5"}'       # 真实点击
node "<plugin>/scripts/browser-client.mjs" op t1 fill  '{"ref":"e2","text":"内容"}'
node "<plugin>/scripts/browser-client.mjs" op t1 press  '{"key":"Enter"}'
node "<plugin>/scripts/browser-client.mjs" op t1 screenshot '{"out":"evidence.png"}'
node "<plugin>/scripts/browser-client.mjs" op "webview:8931" snapshot '{"mode":"ai"}'  # 侧边栏 <webview> 标签
node "<plugin>/scripts/browser-client.mjs" snap t1                 # 精简 DOM 快照(合成事件版)
node "<plugin>/scripts/browser-client.mjs" click t1 "#submit"      # 合成事件版(兼容)
node "<plugin>/scripts/browser-client.mjs" fill t1 "#name" "内容"
node "<plugin>/scripts/browser-client.mjs" wait t1 ".result" 8000
node "<plugin>/scripts/browser-client.mjs" shot t1 evidence.png    # 视觉证据
node "<plugin>/scripts/browser-client.mjs" goto t1 "https://…"
node "<plugin>/scripts/browser-client.mjs" state t1                # url/title/loading/canGoBack…
node "<plugin>/scripts/browser-client.mjs" close t1
```

要点：
- **外部进程必须走 CDP 桥**：DSH 服务端对外部直连一律 403（Host fence）。
  设 `LIULI_BROWSER_VIA=cdp` 后全部请求经 `scripts/browser-bridge.mjs` 中转
  （主进程 inspector 9229 → 页面内同源 fetch）；需 DSH Desktop 以调试模式启动
  （`tools/dsh-debug-launch.cmd`，inspector 端口被占顺延时设 `LIULI_INSPECT_PORT`）。
- **做前端项目时优先 `open --show`**：CLI 用 `browser:show-<uid>` id 创建标签，GUI
  侧边栏的轮询桥接**只认这个前缀**、会自动展示（用户实时可见）；否则 agent 自建
  标签（`agent:<n>`）不上报几何、保持隐藏但可导航/执行/截图，等效 CLI-managed
  headless CDP。普通 `browser:*` / `agent:*` 标签不会被桥接（agent 测试网页不会
  莫名弹出侧边栏浏览器）。
- **琉璃会自动驱动**：模型在对话流里启动 dev server（vite/next dev/serve/
  http.server 等）或写前端文件时，插件自动在侧边栏打开浏览器标签展示页面
  （设置「功能 → 自动驱动侧边栏浏览器」可关），agent 无需手动 open。
- **优先 ops 系列（aria/op）而不是合成事件版（snap/click/fill）**：aria 快照的
  `[ref=eN]` 跨请求可用（同 isolated world），`op click/fill` 是真实输入管线
  （渲染层/受托管的输入组件都能收到）；`webview:8931` 形式的 tabId 直接操作
  侧边栏 `<webview>` 承载的标签（用户实时可见）。
- GUI 侧边栏标签 id 形如 `browser:<uid>`，用 `list` 查到后可直接驱动（IAB 模式，
  操作会被用户实时看见）。
- 快照→定位→行动：先 `aria` 读 aria 树拿 ref，`op click/fill/press` 执行；CSS
  selector 也可以（`{"selector":"#submit"}`）。
- 视觉证据用 `op t1 screenshot`（PNG base64 落盘）或 `shot`，不要靠猜测。
- 纯 Web 部署（无 Electron）没有该引擎：`caps` 返回 SPA HTML 即不可用，
  此时 GUI 侧自动回退 iframe + /liuli-proxy。
