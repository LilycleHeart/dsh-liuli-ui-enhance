---
name: control-browser
description: 驱动 DSH 侧边栏嵌入式浏览器（dsh-liuli-ui-enhance webview 引擎）：打开/导航/检查/点击/输入/截图验证。
---

# Control Browser（dsh-liuli-ui-enhance 嵌入式浏览器）

dsh-liuli-ui-enhance 的 Host 半在 Electron 主进程里用 WebContentsView 承载真实 webview
（DSH Desktop IAB 实现）：独立会话分区 `persist:liuli-embedded-browser`、
任意站点可加载（无 X-Frame-Options 限制）、弹窗自动转侧边栏新标签。

## 能力面

- GUI 侧边栏「浏览器」标签：地址栏/前进后退/刷新/响应式视口/元素拾取/更多菜单
  （外部打开 + 开发者工具）。data-testid 与 DSH 一致（browser-webview 等）。
- Host HTTP API：`/liuli-browser/*`（tabs/geometry/viewport/action/execute/
  screenshot/state/events SSE）。
- 命令行客户端：`scripts/browser-client.mjs`（browser-use 插件
  browser-client.mjs 的实现）。

## agent 驱动方式（pwsh 工具）

```pwsh
node "<plugin>/scripts/browser-client.mjs" caps                    # 探测引擎
node "<plugin>/scripts/browser-client.mjs" open "https://example.com" --tab t1
node "<plugin>/scripts/browser-client.mjs" open "http://localhost:5173" --show   # 侧边栏可见
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
- **做前端项目时优先 `open --show`**：CLI 用 `browser:show-<uid>` id 创建标签，GUI
  侧边栏的轮询桥接**只认这个前缀**、会自动展示（用户实时可见）；否则 agent 自建
  标签（`agent:<n>`）不上报几何、保持隐藏但可导航/执行/截图，等效 CLI-managed
  headless CDP。普通 `browser:*` / `agent:*` 标签不会被桥接（agent 测试网页不会
  莫名弹出侧边栏浏览器）。
- **琉璃会自动驱动**：模型在对话流里启动 dev server（vite/next dev/serve/
  http.server 等）或写前端文件时，插件自动在侧边栏打开浏览器标签展示页面
  （设置「功能 → 自动驱动侧边栏浏览器」可关），agent 无需手动 open。
- GUI 侧边栏标签 id 形如 `browser:<uid>`，用 `list` 查到后可直接驱动（IAB 模式，
  操作会被用户实时看见）。
- 快照→定位→行动：先 `snap` 读精简元素树，再用 CSS selector `click/fill/text`。
- 视觉证据用 `shot`（capturePage PNG），不要靠猜测。
- 纯 Web 部署（无 Electron）没有该引擎：`caps` 返回 SPA HTML 即不可用，
  此时 GUI 侧自动回退 iframe + /liuli-proxy。
