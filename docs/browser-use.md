# liuli-theme 嵌入式浏览器（webview 引擎）

> ZCode Desktop IAB（In-App Browser）+ browser-use 插件的 DSH 复刻，
> 仅修改 liuli-theme 插件实现。

## 架构

- **Host 半（Electron 主进程）**：`src/browser-engine.ts` 用
  `WebContentsView` 承载页面（DSH 宿主窗口未开 webviewTag，`<webview>` 标签
  不可用；WebContentsView 是同进程等价物）。会话分区
  `persist:liuli-embedded-browser`（ZCode `persist:zcode-embedded-browser` 对应），
  cookie/storage 跨重启保留。
- **路由**：`/liuli-browser/capabilities|events|tabs|tabs/action|tabs/geometry|
  tabs/viewport|tabs/state|tabs/screenshot|tabs/execute|open-external`，
  只接受回环调用方。
- **渲染端**：`src/client/browser-webview.ts`（能力探测 / SSE 总线 / 几何上报）
  + `PreviewPanel.tsx` 的 NativeBrowserPanel（工具条与 carrier）。纯 Web 部署
  探测失败自动回退 iframe + /liuli-proxy。

## ZCode 行为对照

| ZCode（09-renderer-renamed styles-OqUHW1P0） | 本插件 |
| --- | --- |
| `<webview partition="persist:zcode-embedded-browser" allowpopups>` | WebContentsView + persist 分区 |
| did-start/stop-loading, did-navigate(-in-page), page-title-updated | webContents 同名事件 → SSE state |
| did-fail-load（ERR_ABORTED=-3 忽略） | 同 |
| render-process-gone → webviewGeneration++ 原位重建恢复 URL | rebuildTab/generation |
| setWindowOpenHandler → 「[App] webview 请求打开右侧浏览器 tab」 | SSE new-tab → 侧边栏新标签 |
| 工具条 h-12：back/forward/reload(转圈)/地址栏/响应式/拾取/更多 | 同（data-testid 对齐） |
| 更多菜单：在默认浏览器打开 + 开发者工具 | 同（shell.openExternal / openDevTools detach） |
| 响应式：宽/高/zoom(fit,50..200)，BROWSER_VIEWPORT_LIMITS 320..3840/2160 | 同（zoom=webContents.setZoomFactor） |
| elementPicker：选完入聊天、Esc 取消、失败提示 | executeJavaScript 注入拾取器 |
| 空态（globe + browser.title/browser.empty） | 同 |
| browser-use 插件 browser-client.mjs（IAB/headless CDP 双形态） | scripts/browser-client.mjs |

## 自测

1. `pnpm exec tsc -b && pnpm run bundle`
2. 重启 DSH Desktop（Host 半改动需重启生效）
3. `curl -sH "Accept: application/json" http://127.0.0.1:7336/liuli-browser/capabilities`
   → `{"ok":true,"engine":"webview",...}`
4. GUI 右侧面板 → 浏览器标签：地址栏输入任意站点（含禁嵌入的 Google/GitHub 也可加载）
5. `node scripts/browser-client.mjs open https://example.com --tab t1` →
   `snap t1` → `shot t1`

## 实测记录（DSH Desktop 重启后，真实 Electron 引擎）

- A 套件 `demo/verify-webview.mjs`：**16/16**（capabilities/SSE hello+state/创建/
  example.com 加载+标题/favicon/历史 back+forward/executeJavaScript/reload/
  window.open→new-tab SSE/did-fail-load 错误态/几何/响应式视口/截图 PNG/销毁+closed）。
- B 套件 `demo/verify-webview-gui.mjs`：**13/13**（无头 GUI 打开侧边栏浏览器：
  地址栏/carrier/6 工具条钮/空态/引擎标签创建/客户页加载+标题/favicon 同步/
  客户页截图/标签条标题同步/响应式工具条+视口框/更多菜单两项/零页面错误）。
- 元素拾取 E2E：注入拾取器→合成 hover+click→返回完整元素描述（tag/selector/
  attributes/text/rect/color/font）。
- 对话框垫片：alert/confirm/prompt 自动应答并经 SSE dialog 事件上报（渲染端 toast）。
- browser-client CLI：caps/open/snap(元素树)/click(触发导航)/wait/text/fill
  (输入框成功、非输入元素优雅报错)/eval/shot/state/close 全部实测通过。
- 注意：DSH Desktop 每次重启后 Web 端口会变（ephemeral），验证脚本自动探测；
  CLI 用环境变量 `LIULI_BROWSER_BASE` 指定。
- 隐藏标签（无 GUI carrier 的 agent 标签）截图：Host 端会临时把视图垫到 GUI 之下
  取帧再复位（无闪烁）；该修复需重启后生效。

## 无头自测注意

桌面部署按 `dsh-desktop` 设置分 compatibility/advanced 两种 shell 组合：advanced 模式下平台 ui-layout 行被禁用、由桌面壳自带 layout 服务。无头验证脚本用 `?dsh-desktop-mode=advanced`（可用环境变量 `DSH_DESKTOP_MODE` 覆盖），与用户设置保持一致，否则 boot 会因 layout 服务缺位而失败。
