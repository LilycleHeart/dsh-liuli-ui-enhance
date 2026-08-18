---
name: control-browser
description: 驱动 DSH 侧边栏嵌入式浏览器（liuli-theme webview 引擎）：打开/导航/检查/点击/输入/截图验证。
---

# Control Browser（liuli-theme 嵌入式浏览器）

liuli-theme 的 Host 半在 Electron 主进程里用 WebContentsView 承载真实 webview
（ZCode Desktop IAB 对应物）：独立会话分区 `persist:liuli-embedded-browser`、
任意站点可加载（无 X-Frame-Options 限制）、弹窗自动转侧边栏新标签。

## 能力面

- GUI 侧边栏「浏览器」标签：地址栏/前进后退/刷新/响应式视口/元素拾取/更多菜单
  （外部打开 + 开发者工具）。data-testid 与 ZCode 一致（browser-webview 等）。
- Host HTTP API：`/liuli-browser/*`（tabs/geometry/viewport/action/execute/
  screenshot/state/events SSE）。
- 命令行客户端：`scripts/browser-client.mjs`（ZCode browser-use 插件
  browser-client.mjs 的对应物）。

## agent 驱动方式（pwsh 工具）

```pwsh
node "<plugin>/scripts/browser-client.mjs" caps                    # 探测引擎
node "<plugin>/scripts/browser-client.mjs" open "https://example.com" --tab t1
node "<plugin>/scripts/browser-client.mjs" snap t1                 # DOM 快照
node "<plugin>/scripts/browser-client.mjs" click t1 "#submit"
node "<plugin>/scripts/browser-client.mjs" fill t1 "#name" "内容"
node "<plugin>/scripts/browser-client.mjs" wait t1 ".result" 8000
node "<plugin>/scripts/browser-client.mjs" shot t1 evidence.png    # 视觉证据
node "<plugin>/scripts/browser-client.mjs" goto t1 "https://…" 
node "<plugin>/scripts/browser-client.mjs" state t1                # url/title/loading/canGoBack…
node "<plugin>/scripts/browser-client.mjs" close t1
```

要点：
- agent 自建的标签（--tab 指定 id）不上报几何，保持隐藏但可导航/执行/截图，
  等效 ZCode 的 CLI-managed headless CDP；GUI 侧边栏标签 id 形如 `browser:<uid>`，
  用 `list` 查到后可直接驱动（IAB 模式，操作会被用户实时看见）。
- 快照→定位→行动：先 `snap` 读精简元素树，再用 CSS selector `click/fill/text`。
- 视觉证据用 `shot`（capturePage PNG），不要靠猜测。
- 纯 Web 部署（无 Electron）没有该引擎：`caps` 返回 SPA HTML 即不可用，
  此时 GUI 侧自动回退 iframe + /liuli-proxy。
