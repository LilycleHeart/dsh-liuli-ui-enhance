# 安装、构建与目录结构

> 本文档维护 `dsh-liuli-ui-enhance` 的完整安装说明、构建方式、目录结构以及常见避坑。
> README 只保留快速开始，详细步骤以本文档为准。

## 安装

> **重要**：全新 DSH Desktop 安装时，只改 `cordis.patch.yml` 是不够的，必须同时把
> `dsh-liuli-ui-enhance` 安装进 desktop profile 的 `package.json` 依赖，否则会报：
> `Cannot find package 'dsh-liuli-ui-enhance'`。
>
> 另外，全新 DSH Desktop 默认没有应用 win32 无边框宿主补丁，原生标题栏/窗口按钮
> 不会隐藏。可以手动执行 `pnpm patch:desktop`；插件也会在 DSH Desktop 启动时自动重打
> 该补丁。**自动补丁为尽力而为**：找不到补丁点/写入失败只会在日志告警，不会阻止
> 插件加载——此时页面内窗口按钮仍可用，只是原生标题栏按钮会保留；客户端更新后重启
> 一次即恢复无边框。
>
> **发布形态**：插件当前**尚未发布到 npm**（registry 404），DSH 内置市场也不接受
> GitHub 安装目标，因此唯一受支持的安装路径是本仓库手动安装（`pnpm install:desktop`）。
> `pnpm install:desktop:npm` 会先查询 npm registry，未发布时直接报错并提示改用本地安装。

### 自动安装（推荐）

> **前置条件（首次安装务必确认）**：
> 1. 已安装 [Node.js](https://nodejs.org) 20+ 与 [pnpm](https://pnpm.io/installation)；
> 2. 已启动过一次 DSH Desktop —— 首次启动会生成 `~/.dsh/profiles/desktop`，
>    该目录不存在时 `pnpm install:desktop` 会直接报错退出。

在插件源码目录执行：

```bash
# 0. 首次：安装依赖并构建 lib/（pnpm install 会触发 prepare=pnpm build）。
#    install:desktop 内部检测到未构建时也会自动补这步，但显式执行更直观。
pnpm install

# 1. 安装插件到 DSH Desktop desktop profile（本地源码会先 pack 成 tarball，
#    确保 iconv-lite、react 等依赖能正确装进 profile）
pnpm install:desktop

# 2. 给 DSH Desktop 打 win32 无边框宿主补丁（隐藏原生标题栏/窗口按钮；可选——
#    插件启动时也会自动必装该补丁，手动执行只是提前打上，免去重启一次）
pnpm patch:desktop

# 或等发布到 npm 后，从 npm 安装（当前不可用，会直接报错提示改用本地安装）：
pnpm install:desktop:npm
```

`pnpm install:desktop` 会：

1. 把 `dsh-liuli-ui-enhance` 写入 `~/.dsh/profiles/desktop/package.json` 的 `dependencies`；
   - 本地源码模式：`pnpm pack` 生成 tarball，以 `file:<tarball>` 安装；
   - 这样插件自身的 `dependencies`（`iconv-lite`、`react` 等）会被装进 profile。
2. 确保 `~/.dsh/profiles/desktop/cordis.patch.yml` 注册了 `dsh-liuli-ui-enhance`；
3. 在 desktop profile 目录执行 `pnpm install`。

> **从旧包名 `@deepseek-ai/liuli-theme` 迁移时**：安装器只会追加新注册，不会自动删除旧依赖和旧
> `cordis.patch.yml` insert 块。如需彻底切换，请手动移除 profile 中的旧插件依赖、旧 insert 块后
> 再执行 `pnpm install`。

`pnpm patch:desktop` 会：

1. 备份 `resources/app.asar` 为 `app.asar.bak-frameless`；
2. 在 `resources/app.asar.unpacked/lib/` 下动态查找 `electron-runtime-*.js`（客户端升级会换 hash 文件名）并修改：
   - win32 无边框：把 advanced 窗口的 `titleBarStyle: "hidden"` + `titleBarOverlay` 改为 `frame: false`；
   - 浏览器 webviewTag：把 advanced/compatibility 主窗口 `webPreferences` 补上 `webviewTag: true`（内嵌浏览器用 `<webview>` DOM 标签承载，拉伸时由 CSS `overflow:hidden` 裁剪，不溢出容器）；
3. 重建 `resources/app.asar` 并同步 integrity；
4. 写入 `resources/app.asar.patched`。

> 安装目录查找顺序：`DSH_DESKTOP_DIR` 环境变量 → 正在运行的 DSH Desktop 进程路径 → 默认安装路径。
> 若 `pnpm patch:desktop` 经 DSH Desktop 的 runtime-commands 运行（node 被解析为 Electron 内置 node），
> 脚本会自动改由系统 node 重新执行，避免 ASAR 钩子干扰。

### 手动安装

```bash
# 1. 进入 desktop profile
cd ~/.dsh/profiles/desktop

# 2a. 已发布到 npm：
pnpm add dsh-liuli-ui-enhance

# 2b. 本地源码（先 pack，避免 link 导致依赖缺失）：
pnpm pack --pack-destination /tmp/liuli
pnpm add file:/tmp/liuli/dsh-liuli-ui-enhance-0.1.0.tgz
```

然后确认 `~/.dsh/profiles/desktop/cordis.patch.yml` 里有：

```yaml
- insert:
    - id: dsh-liuli-ui-enhance
      name: 'dsh-liuli-ui-enhance'
```

最后重启 DSH Desktop。移除该注册行即回到素版外观（shell 的外观行降级为直连切换，无圆形遮罩）。

### Agent / AI 安装方式（避坑）

如果你是 AI Agent，请按下面顺序执行，避免最常见的几个坑：

```text
1. 确定目标 profile
   DSH_HOME 默认是 ~/.dsh；DSH Desktop 的 desktop profile 位于：
   $DSH_HOME/profiles/desktop

2. 优先使用仓库自带安装器（推荐）
   cd <dsh-liuli-ui-enhance 源码目录>
   pnpm install   # 首次：装依赖并构建 lib/（安装器检测到未构建时也会自动补）
   DSH_PROFILE_DIR="$DSH_HOME/profiles/desktop" node scripts/install-desktop.mjs

   它会自动完成：
   - 检测构建依赖（tsc/tsdown）缺失时自动 pnpm install（全新 clone 不先 install 也能成功）
   - pnpm pack 生成 tarball
   - 写入 package.json 的 dependencies（file:<tarball>）
   - 修复 cordis.patch.yml（全新 profile 的 [] 会被替换为 insert 块）
   - 在 profile 目录执行 pnpm install

3. 如果必须手动安装，不要用 link:
   # 错误示范：pnpm add dsh-liuli-ui-enhance@link:... 
   # link: 不会安装插件自身的 dependencies，会报 Cannot find package 'iconv-lite'

   正确方式：
   cd <dsh-liuli-ui-enhance 源码目录>
   pnpm install          # 触发 prepare，构建 lib/
   pnpm pack --pack-destination /tmp/liuli
   cd "$DSH_HOME/profiles/desktop"
   pnpm add file:/tmp/liuli/dsh-liuli-ui-enhance-0.1.0.tgz

4. 只改 cordis.patch.yml 是不够的
   package.json 的 dependencies 里必须真的有 dsh-liuli-ui-enhance，
   否则启动时报：
   Cannot find package 'dsh-liuli-ui-enhance'

5. 全新 profile 的 cordis.patch.yml 默认是 []
   不要直接在 [] 后面追加 YAML，会解析失败。
   应替换为：
   - insert:
       - id: dsh-liuli-ui-enhance
         name: 'dsh-liuli-ui-enhance'

6. 安装后不需要重启 DSH Desktop
   客户端插件安装到 profile 后，刷新页面即可加载新 bundle；不要主动重启 DSH Desktop（会改变 Web 端口并打断调试）。

7. 隐藏原生标题栏需要额外宿主补丁
   插件只能提供页面内窗口按钮，不能从渲染进程隐藏原生标题栏。
   在 DSH Desktop 安装目录执行：
   DSH_DESKTOP_DIR="C:\Program Files\DSH Desktop" node scripts/patch-desktop-frameless.mjs
   或使用仓库脚本：
   pnpm patch:desktop

8. 验证清单
   - $DSH_HOME/profiles/desktop/node_modules/dsh-liuli-ui-enhance/lib/index.js 存在
   - $DSH_HOME/profiles/desktop/node_modules/dsh-liuli-ui-enhance/lib/client.js 存在
   - cordis.patch.yml 包含 dsh-liuli-ui-enhance insert
   - 重启后页面出现 [data-liuli-theme] 和右侧边栏/窗口控制胶囊
```

依赖宿主主题服务（`ctx.theme`，由 `dsh-client-ui-theme` 提供）：偏好持久化与 `theme/change` 事件由宿主承担，本插件只消费。host 半（node 半）提供两条本地路由：`/liuli-quota`（凭据额度）与 `/preview`（会话 cwd 静态站点，preview 面板用）。

## 构建

独立仓库已自包含构建链，全新 clone 后可直接：

```bash
pnpm install   # 自动触发 prepare：tsc + tsdown，生成 lib/
# 或手动构建：
pnpm build
```

产出 `lib/index.js`（node 半）+ `lib/client.js`（浏览器半，closure-factory 产物）。
类型声明由 `tsc -p tsconfig.json` 生成到 `lib/types`，供 tsdown 打包入口引用。

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

## 目录结构

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
  features.md            # 完整功能清单、设计语言、限制（详细文档主入口）
  install.md             # 安装、构建、目录结构、避坑（本文档）
  browser-use.md         # 浏览器 agent 自动化用法
  sidebar-comparison.md
```
