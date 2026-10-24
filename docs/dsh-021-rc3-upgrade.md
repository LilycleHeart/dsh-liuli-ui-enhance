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
| P10 rc.3 新菜单样式 | completed | 左栏「更多」菜单实测：容器 `data-menu-material="translucent"`、`rgba(54,42,46,0.92)` + `blur(20px) saturate(1.6)`、边框 `rgb(81,67,71)`、文字 `rgb(235,224,225)`、圆角 10/12px，已是琉璃配色 |
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

## 边界

- 无边框与官方窗口控制桥属于宿主补丁，必须在桌面端**完全退出**后执行：
  `node scripts/patch-official-window-controls.mjs --check` 先预检，确认无误再 `--apply`。
  未打补丁时原生标题栏与原生菜单栏会保留，页面内窗口按钮回退方案仍可用。
- 本次未验证：多显示器/DPI 缩放下的新菜单定位、会话视图与右栏「更多」菜单的完整交互、音频回环、内嵌浏览器（`webviewTag` 补丁同样需要退出后重打）。
- `dsh-cli-providers` 与 commandcode 提供商插件不在本仓库，未改动其声明；它们的 `engines.dsh` 分别是 `0.2.0-rc.2` 与 `0.2.0-rc.2 || 0.2.1-alpha.4`，同样被 rc.3 拒绝，需要各自升级或在插件页授予精确版本豁免。
