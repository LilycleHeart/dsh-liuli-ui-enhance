# 琉璃适配 DSH 0.2.1-rc.3

本次把插件的目标宿主从 `0.2.1-rc.2` 升到 **`0.2.1-rc.3`**，产物版本 `0.1.2-rc.38`。
基线为已安装的 `dsh-liuli-ui-enhance@0.1.2-rc.37` 对应源码（`master`，`dfb9044`，含该版本打包前尚未提交的 toast 令牌修复）。

## 事故现象与根因

DSH Desktop 于 2026-10-23 更新到内置 DSH `0.2.1-rc.3`（`@deepseek-ai/dsh-desktop` 同版本，构建提交 `be72761`）后，插件在「插件」页显示 **异常**，点开后的原因文案：

> 原因: dsh-liuli-ui-enhance@0.1.2-rc.37 与 DSH 0.2.1-rc.3 不兼容（要求 engines.dsh 0.2.1-rc.2），运行它可能导致崩溃或数据丢失。请卸载后重新安装与当前 DSH 兼容的版本。

根因在宿主 `@deepseek-ai/dsh-app-boot` 的 `evaluatePluginCompatibility`：

- 只要 manifest 里有 `engines.dsh`，就**只用它**判定（`peerDependencies` 被忽略）：
  `semver.satisfies(runtimeVersion, engines.dsh, { includePrerelease: true })`；
- 否则逐个校验所有 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*` 的 `peerDependencies`。

旧包把 `engines.dsh` 写成了**精确版本** `0.2.1-rc.2`，宿主升到 `rc.3` 后不再满足，整个 bundle 被拒绝激活——插件在客户端模块清单（`window.__DSH_BOOT__.entries`）里彻底消失，因此不只是某个功能失效，而是主题、侧栏、悬浮球全部不加载（页面回到官方原生外观）。

## 变更

- 依赖、`peerDependencies`、`devDependencies` 全量 `0.2.1-rc.2` → `0.2.1-rc.3`（53 处）；`pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude` 与 dockkit 补丁键同步改名。
- `engines.dsh` 由精确 `0.2.1-rc.2` 改为范围 **`^0.2.1-rc.3`**：同 minor 内的 rc 迭代（rc.4、正式 0.2.1…）不会再让整包被拒；精确声明是这次事故的直接原因。
- `dsh.compatibility` 记录 `0.2.1-rc.2` 与 `0.2.1-rc.3` 两个已验证目标版本。
- `patches/@deepseek-ai__dsh-client-ui-dockkit@0.2.1-rc.3.patch`：禁用装饰性滚动渐隐的补丁随包版本改名。rc.3 的 `lib/index.js` 里锚点仍在第 2566 行、内容一致，补丁体未变，安装后已确认生效。
- `scripts/patch-official-window-controls.mjs`：版本白名单加入 `0.2.1-rc.3`。
- `tests/window-shell-patch.test.mjs`：真实版本用例扩到 rc.3，另用 `0.2.1-rc.4` 充当「不支持版本」用例。

> 依赖升级没有改动任何客户端源码逻辑：rc.3 相对 rc.2 的对外变化（左栏/会话视图/右栏的新「更多」菜单、新会话草稿修复、API Key 模型列表刷新方式）没有触及琉璃用到的插槽、服务与导出。

## 验证记录

| 阶段 | 状态 | 证据或边界 |
|---|---|---|
| P01 来源与目标识别 | completed | 本机安装 `app.asar` 内 `dsh/package.json` = `0.2.1-rc.3`；`@deepseek-ai/dsh-desktop` = `0.2.1-rc.3`；npm 上 rc.3 相关包已可安装 |
| P02 兼容判定规则 | completed | `dsh-app-boot` 中 `evaluatePluginCompatibility` / `unmetRequirements` / `satisfies`（`includePrerelease: true`）；插件页错误文案与实际行为一致 |
| P03 依赖与补丁迁移 | completed | 53 处版本声明、dockkit 补丁键与文件名、窗口补丁白名单 |
| P04 构建 | completed | `pnpm build`（tsc + tsdown）通过，`lib/index.js` + `lib/client.js` 产出正常 |
| P05 测试 | completed | `node --test tests/*.test.mjs`：51 项通过 0 失败（含 3 个真实版本的窗口补丁用例） |
| P06 宿主补丁预检 | completed | `node scripts/patch-official-window-controls.mjs --check` 在真实 rc.3 上通过（锚点、EXE 内 ASAR 完整性哈希唯一命中、`--check` 不改盘） |
| P07 安装 | completed | `node scripts/install-desktop.mjs`：`0.1.2-rc.38-bf7c3d4808ce.tgz` 写入 desktop profile 依赖，bundles 保持不变 |
| P08 真实客户端加载 | completed | 插件页由「异常」变为正常运行；页面未刷新即挂载 `[data-liuli-theme]`、注入 `--liuli` 样式、`[data-liuli-bg]` 壁纸生效、`body` 背景为琉璃暗色 |
| P09 刷新后稳定性 | completed | 重新加载 `dsh-app` 页面后仍挂载；网络面板 0 个失败请求；控制台仅剩 KaTeX 的 `unicodeTextInMathMode` 警告（与插件无关） |
| P10 rc.3 新菜单样式 | completed | 见下节；三处偏差已修，真机回归量值全部达标 |
| P11 宿主无边框/窗控桥 | skipped→需用户配合 | 见下节：需要完全退出桌面端后 `--apply` |
| P12 其他插件 | 部分 | `dsh-cli-providers@0.3.0`、`@mars-sea/dsh-commandcode-provider@0.13.4` 仍是「异常」，原因同类 |

### 命令

```powershell
cd C:\Users\27280\.codex\worktrees\dsh-020-compat\liuli-theme
pnpm install --ignore-scripts --no-frozen-lockfile
pnpm build
node --test tests/*.test.mjs
node scripts/patch-official-window-controls.mjs --check
node scripts/install-desktop.mjs
```

## 让宿主加载新版本

本次实测：**不必重启桌面端**。`install-desktop.mjs` 更新 profile 依赖后，宿主的插件清单还是旧的（`__DSH_BOOT__.entries` 里没有琉璃，刷新页面也不重建）；在「插件」页把琉璃开关**关掉再打开**，宿主的实时重载就会把新的客户端模块推进页面——不刷新即可看到主题挂载。

若开关后仍无变化，再重启一次桌面端即可（会改变 Web 端口）。

## rc.3 新增 UI 的样式适配

rc.3 给左侧栏、会话 View 标签行、右侧栏起始页各加了一个「更多」菜单（`@deepseek-ai/dsh-client-ui-entry-customization` 往三个新槽位各注册一行）。它们都走宿主 `ui-primitives` 的 **MenuSurface 原语**，根节点为 `div[role="menu"][data-menu-material="translucent"]`，材质由内部 `[aria-hidden][class*="_material"]` 子层单独承担。据此修了三处：

1. **菜单表面双层刷漆（缺陷）**：琉璃原有的通用规则 `[role="menu"][class*="_list"]` 与 `div[role="menu"]` 也会命中这个新根，特异性高于 `[data-menu-material]` 重置，于是根先画 0.92 亚克力 + 噪声 + `blur(20)`，子层再画 0.61，实测合色 ≈0.97 近实底，且根的 `backdrop-filter` 让子层只能采样本层色板 —— 壁纸磨砂在菜单里彻底丢失。改法：这两条通用规则限定 `:not([data-menu-material])`；层级与圆角两条**刻意不排除**（专属层不提供层阶，排除会掉回官方 1100）。
2. **菜单项比面板还圆**：官方 `._item` 用 `--dsw-radius-md`（12px），琉璃面板是 10px，内层比容器圆。按样式规范把 `[data-menu-material] [role="menuitem"]` 钉到 8px。
3. **右栏「更多工具」入口不合群**：官方只给已知引导项写 `data-sidebar-right-guide-entry`，rc.3 新增的这项没有该属性，于是没有噪声、没有强磨砂、圆角是官方 `--dsw-radius-xl`（20px），与同屏 5 个兄弟入口（14px + 噪声 + `blur(20)`）不一致。用稳定锚点 `[data-sidebar-right-guide] button[class*="_entry"][aria-haspopup="menu"]` 补齐同一套配方。

左栏「更多」入口本体（`button.wtg9ga_panelRow`）**未改**：它与同屏 4 个兄弟行逐值一致，单独改反而破坏一致性。菜单文字、图标与 hover 底色由琉璃 token 层（`--dsw-alias-label-primary`、`--dsw-alias-menu-icon`、`--dsw-alias-interactive-bg-hover`）正确驱动，未重复声明。

真机回归（安装 0.1.2-rc.38 后，CDP 实测计算样式）：

| 探针 | 结果 |
|---|---|
| 左栏「更多」菜单根 | `background rgba(0,0,0,0)`、`background-image none`、`backdrop-filter none`、圆角 10px、`z-index 2147482500`、边框 `rgb(81,67,71)` |
| 上述菜单的材质子层 | `rgba(54,42,46,0.61)` + 噪声图 + `blur(20px) saturate(1.6)`（单层配方） |
| 菜单项 | `border-radius 8px`、文字 `rgb(235,224,225)` |
| 会话 View 标签行的「更多会话视图」（`an3WzG_viewsMore`，22×22） | 与左栏同值 |
| 右栏「更多工具」入口 | 圆角 14px + 噪声 + `blur(20px) saturate(1.6)`，与兄弟入口一致 |

## 边界

- 无边框与官方窗口控制桥属于宿主补丁，必须在桌面端**完全退出**后执行：
  `node scripts/patch-official-window-controls.mjs --check` 先预检，确认无误再 `--apply`。
  未打补丁时原生标题栏与原生菜单栏会保留，页面内窗口按钮回退方案仍可用。
- 本次未验证：多显示器/DPI 缩放下的新菜单定位、会话视图与右栏「更多」菜单的完整交互、音频回环、内嵌浏览器（`webviewTag` 补丁同样需要退出后重打）。
- `dsh-cli-providers` 与 commandcode 提供商插件不在本仓库，未改动其声明；它们的 `engines.dsh` 分别是 `0.2.0-rc.2` 与 `0.2.0-rc.2 || 0.2.1-alpha.4`，同样被 rc.3 拒绝，需要各自升级或在插件页授予精确版本豁免。
