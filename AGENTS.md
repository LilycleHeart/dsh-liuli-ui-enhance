# AGENTS.md — dsh-liuli-ui-enhance 开发指导

本文件为在本仓库内工作的 AI Agent / 开发者提供上下文、命令、约定与避坑指南。
在改动代码前先读 `README.md`，它维护了完整的功能清单、设计语言和安装说明。

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

## 目录速览

```
src/
  index.ts                 # node 半入口：Host 路由（额度/预览/侧栏/窗口/浏览器引擎等）
  browser-engine.ts        # 内嵌浏览器引擎（CDP / Electron / Web 回退）
  host-audio.ts            # Electron 系统回环音频授权
  host-window.ts           # Electron 窗口控制（最小化/最大化/关闭/托盘）
  liuli-settings.ts        # 20 项设置 schema 与默认值
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
  verify-*.mjs             # 行为 / GUI 验证脚本
  server.mjs / cdp-run.mjs # 本地测试辅助
skills/
  control-browser/SKILL.md # 控制内嵌浏览器的 agent skill
docs/
  browser-use.md           # 浏览器 agent 自动化用法
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
5. 新增设置项要同步 `liuli-settings.ts` 的 schema/默认值，并在 README 功能表与设置分区文案中体现。
6. 纯逻辑尽量抽成无副作用函数（参考 `dock-model.ts`），并在 `demo/test-dock-model.ts` 补单测；Node 直接跑 TS 即可。
7. 改动 Dockable / dock-model 后至少跑 `node demo/test-dock-model.ts` 和相关 GUI 验证脚本。
8. 改动内嵌浏览器能力后同步更新 `scripts/browser-client.mjs` 与 `docs/browser-use.md`，并运行 `demo/verify-webview*.mjs`。
9. 提交前运行 `pnpm build` 确认类型与打包通过；不要提交 `.tmp-*`、截图探针等调试产物。
10. 注释和文档保持简体中文，与仓库现有风格一致。
11. 完成功能并 `pnpm build` 通过后，**自动执行 `pnpm install:desktop`** 安装到 DSH Desktop profile，不再询问用户；安装后不需要重启 DSH Desktop。

## 关键避坑

- **安装到 DSH Desktop 不要用 `pnpm link`**：link 不会安装插件自身 dependencies，会报 `Cannot find package 'iconv-lite'`。用 `pnpm install:desktop` 或 `node scripts/install-desktop.mjs`。
- **`pnpm install:desktop` 后不需要重启 DSH Desktop**：插件安装到 profile 后刷新页面即可加载新 bundle；不要主动 kill/restart DSH Desktop，重启会让 Web 端口变化并打断运行中的调试。可验证：安装后直接刷新页面观察新样式/行为。
- 只改 desktop profile 的 `cordis.patch.yml` 不够，必须同时把 `dsh-liuli-ui-enhance` 写进该 profile 的 `package.json` dependencies。
- 隐藏原生标题栏需要额外执行 `pnpm patch:desktop`；插件只能提供页面内窗口按钮，不能从渲染进程隐藏原生标题栏。
- DSH Desktop 每次重启 Web 端口会变，`localStorage` 按 origin 隔离；设置跨重启保留依赖 Host 端 `~/.liuli-theme/settings.json` 同步。
- `/liuli-sidebar/*`、`/preview`、`/liuli-proxy` 等路由默认只接受 loopback / 同源 Host；局域网部署需额外配置信任域名。
- 声纹监听只捕获系统音频：Web 端靠 `getDisplayMedia`（共享整个屏幕 + 分享系统音频）；Electron Desktop 端由 Host 安装 `setDisplayMediaRequestHandler` 直接授予 `audio: 'loopback'`（Windows-only）。
- `liuli.css` 与 `liuli-css.ts` 是同一份样式的两个载体，改 CSS 源后需要同步字符串化拷贝（构建/脚本处理；不要只改其中一个）。注意历史遗留：当前 `liuli.css`（712 行）与 `liuli-css.ts` 内嵌字符串（1551 行）并不完全一致，运行时注入以 `liuli-css.ts` 为准；后续若以 `liuli.css` 为源，需先补齐同步。
- vendored `src/vendor/material-color-utilities.js` 是上游库，除非有明确目的否则不要改动。
- **项目改名后执行 `pnpm install:desktop` 会追加新注册而不是替换旧注册**：安装器只按当前包名（如 `dsh-liuli-ui-enhance`）检测 profile，旧 `id: liuli-theme` / `@deepseek-ai/liuli-theme` 不会被识别为已注册，会在 `cordis.patch.yml` 追加新 insert 块并在 `package.json` dependencies 增加新包；彻底迁移需手动删除 profile 中的旧依赖与旧 insert 块，再执行 `pnpm install`。
- **批量清理品牌词时不要只做机械替换**：复合品牌词会被替换成生造词，参考来源词会被错误归属到宿主名；需要二次替换为「琉璃」「参考实现源码」等中性词，并在 `pnpm build` 前搜索旧词残留确认无残留。

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
4. **同步文档**：若该坑涉及安装流程、命令或功能行为，同时更新 `README.md` / `docs/` 对应章节。
5. **不要删历史坑**：旧坑即使暂时不适用，也保留；如确实过时，可标注“已解决/已废弃”而不是直接删除。

## 完成一项功能时的收尾清单

- [ ] `pnpm build` 通过
- [ ] 相关 `demo/verify-*.mjs` / `demo/test-dock-model.ts` 通过
- [ ] `locales.ts` zh/en 键完整
- [ ] README 功能表 / 文档已同步
- [ ] 本次新踩到的坑已写入 AGENTS.md「关键避坑」
- [ ] 未提交 `lib/`、`.tmp-*` 等产物
