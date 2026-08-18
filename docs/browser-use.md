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
