# 琉璃适配 DSH 0.2.1-rc.5

本次把插件的目标宿主从 `0.2.1-rc.3` 升到 **`0.2.1-rc.5`**，产物版本 `0.1.2-rc.39`。
基线为 `master`（`6078c13`，含工作区里本轮未提交的菜单滚动修复）。

## 这次和上一轮不一样：没有出现「整包被拒激活」

上一轮（rc.2 → rc.3）的事故是 `engines.dsh` 写成了**精确版本**，宿主小版本一动就整包被拒激活。
那一轮把 `engines.dsh` 改成范围 `^0.2.1-rc.3` 之后，本轮宿主升到 rc.5 时**兼容判定直接通过**：

```
semver.satisfies('0.2.1-rc.5', '^0.2.1-rc.3', { includePrerelease: true }) === true
semver.satisfies('0.2.1-rc.4', '^0.2.1-rc.3', { includePrerelease: true }) === true
```

所以这次插件页**没有**变「异常」，主题、侧栏、悬浮球照常加载 —— 范围写法按预期工作了。
本轮的问题不在激活，而在三件功能面的失配：

1. **悬浮控件补丁失效**（用户报障）：补丁的版本白名单有两份副本，都还停在 rc.3，rc.5 直接被判 `unsupported`；
2. **设置页下拉菜单不能下滑**（用户报障）：琉璃自己的 `SettingsSelects` 菜单滚动问题，与宿主版本无关但同期修复；
3. **依赖与补丁声明滞后于宿主**：依赖、peer、dev 仍钉 rc.3，`pnpm build` 用的是 rc.3 的类型；dockkit 补丁键也钉在 rc.3。

第 3 条不是故障，但会让「声明的是旧版、跑的是新版」长期潜伏 —— 一旦 rc.5 的某个原语真的变了，样式层的假设就会静默失效。本轮把它对齐。

## 变更

### 1. 版本迁移（52 处声明 + 1 处补丁键）

| 位置 | 变更 | 处数 |
|---|---|---|
| `package.json` `dependencies` / `peerDependencies` / `devDependencies` | 所有 `@deepseek-ai/dsh-*` 由 `0.2.1-rc.3` → `0.2.1-rc.5`（含 `@deepseek-ai/dsh-client-ui-dockkit`） | 50 |
| `package.json` `dsh.compatibility.dsh` | `0.2.1-rc.5` | 1 |
| `package.json` `engines.dsh` | `^0.2.1-rc.3` → **`^0.2.1-rc.5`**（范围写法，见下） | 1 |
| `package.json` `dsh.compatibility.dshReleases` | 新增 `"0.2.1-rc.4"`、`"0.2.1-rc.5": "compatible"`（`rc.2`/`rc.3` 历史条目保留） | +2 行 |
| `package.json` `version` | `0.1.2-rc.38` → `0.1.2-rc.39` | 1 |
| `pnpm-workspace.yaml` | `patchedDependencies` 键 + 补丁路径 + `minimumReleaseAgeExclude` 79 条 | 81 |
| `patches/` | dockkit 补丁随包版本改名 | 1 次重命名 |

**`engines.dsh` 为什么必须是范围，而不是精确版本**：宿主 `@deepseek-ai/dsh-app-boot` 的兼容判定
（`lib/index.js:276-285`）这样写：

```js
function satisfies(runtimeVersion, range) {
    return range.trim() !== "" && semver.satisfies(runtimeVersion, range, { includePrerelease: true });
}
function unmetRequirements(fields, runtimeVersion) {
    const engines = Object.hasOwn(fields, "engines") ? objectOf$1(fields.engines, "Plugin manifest engines") : {};
    if (Object.hasOwn(engines, "dsh")) {          // 有 engines.dsh 就只看它，peerDependencies 全部忽略
        const range = engines.dsh;
        return satisfies(runtimeVersion, range) ? {} : { "engines.dsh": range };
    }
    // …否则逐个校验 peerDependencies 里的 @deepseek-ai/dsh 与 @deepseek-ai/dsh-*
}
```

只要 manifest 里有 `engines.dsh`，`peerDependencies` 就**不参与**判定，整个 bundle 的激活只看这一个字段；
写精确版本等于把自己钉死在某一个 rc 上，宿主前进一小步就被拒绝激活（插件从
`window.__DSH_BOOT__.entries` 里消失 → 主题、侧栏、悬浮球全部不加载，插件页显示「异常」）。

实测 `^0.2.1-rc.5` 的语义：

| 声明 | 0.2.1-rc.5 | 0.2.1-rc.4 | 0.2.1（正式） | 0.2.2 | 0.2.1-alpha.1 | 0.3.0 |
|---|---|---|---|---|---|---|
| `^0.2.1-rc.5`（本轮） | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| `0.2.1-rc.3`（旧的精确写法） | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

即：范围写法能吃掉后续 `0.2.x`（含正式版），又不会误放行更老的 alpha / 更高的 0.3。

> 另：`dsh.compatibility` 与 `dshReleases` 在宿主 `dsh-app-boot@0.2.1-rc.5` 里**一次都没有被读取**
> （对发布包与 `resources/app.asar` 做全量搜索均为 0 命中），它们只是给人看的声明性记录，
> 不参与兼容判定。真正的判定只有 `engines.dsh` 一处。

### 2. dockkit 补丁：只改名，不改内容

先把 `@deepseek-ai/dsh-client-ui-dockkit@0.2.1-rc.5` 的 tarball 拉下来核对，再改名：

- 包 sha1 `8508df0a…`、sha512 `5UuS6N9p…` 与 registry 元数据一致；
- **rc.5 的 `lib/index.js` 与 rc.3 逐字节相同**（116935 B / 3438 行，差异 0 行），
  rc.3 → rc.5 的包内变化只有 `package.json` 的 `version` 与两个依赖（`dsh-brand`、`dsh-client-ui-primitives`）；
- 补丁锚点 `\tuseStripScrollFades(stripTabs, pane.tabs);` 在 rc.5 的 **第 2566 行**，精确匹配 **唯一 1 次**
  （同名函数定义在第 2507 行，是另一行，不构成歧义）；hunk 头 `@@ -2566 +2566 @@` 没有漂移；
- 对 rc.5 文件 dry-run（LF 补丁 + `git apply --unidiff-zero`）通过，应用后该行变为注释行。

因此补丁正文一字未改，只把文件名改成 `patches/@deepseek-ai__dsh-client-ui-dockkit@0.2.1-rc.5.patch`
（git 判定 similarity 100%），并同步 `pnpm-workspace.yaml` 的 `patchedDependencies` 键。
**`patchedDependencies` 的键必须与补丁文件名里的版本一致**，否则 pnpm 会报找不到补丁。

### 3. 悬浮控件补丁失效：两份白名单都漏了 rc.5

用户报的是「悬浮控件补丁失效」。实际是**两层**原因叠加：

| 层 | 位置 | 症状 |
|---|---|---|
| ① 离线脚本 | `scripts/patch-official-window-controls.mjs` 的 `supportedVersions` | 只收录到 `0.2.1-rc.3`，rc.5 上 `--check` 即被判「不支持的版本」，`--apply` 拒绝写入 |
| ② 插件内同源副本 | `src/host-topbar-patch.ts` 的 `SUPPORTED` | 同样漏 rc.5 → `GET /liuli-topbar-patch` 返回 `state:"unsupported"`，文案 `客户端 0.2.1-rc.5 不在补丁支持范围内（需更新插件的补丁锚点）`，即用户在悬浮球 / 设置页点「立即打补丁」看到的那句 |

两份副本其实是同一个事实的两次拷贝：脚本负责「客户端已退出」时的离线写入，模块负责「客户端运行中」的就地写入
（只改 asar 头，把 `lib/main.js`、`lib/preload-app.cjs` 标成 unpacked，长度差用 padding 补齐）。
**漏任何一边，对应入口就报废** —— 这正是本轮事故的形态。

修复与回归防护：

- 两处白名单同步加入 `0.2.1-rc.5`（保留 `0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.3`）；
- 新增 `tests/topbar-patch-versions.test.mjs`（5 例）：两份白名单集合必须相等、rc.5 必须在两边、
  `0.2.1-rc.4`/`0.2.1-rc.6` 这类未验证版本不得出现、三个补丁锚点在脚本与模块中逐字一致、
  以及**本机真实 asar** 的版本必须已被收录、三个补丁锚点各唯一命中、`titleBarStyle: "hidden"` 出现次数不变；
- 顺带修掉 `assertClosed()` 的两个老毛病：并行/高负载下「任一同名进程读不到 Path」会被误判成宿主在运行
  （新逻辑只比对能读到路径的条目，全部不可读才保守拒绝，安全语义不变）；以及只有一个进程时
  `ConvertTo-Json` 把数组解包成对象导致的崩溃。

**必须澄清的用户误解**：rc.5 官方**默认**就是 `titleBarStyle: "hidden"` + `titleBarOverlay`，
所以「没有原生标题栏」不是补丁的功劳。补丁真正做的是三件事：

1. 把主窗口的 `titleBarStyle:"hidden" + titleBarOverlay{…}` 换成 `frame: false`，让**系统 −□× 条带消失**；
2. 注入 `ipcMain.handle("liuli-official-window")` + preload 的 `window.liuliWindowControls` 桥，
   让页面内最小化/最大化/关闭**真正可用** —— 未打补丁时 `POST /liuli-window` 在 utility process 宿主里
   拿不到 `BrowserWindow`，只能降级：`close` 交给渲染进程 `window.close()`，其它动作返回
   `native window control unavailable in utility-process host`；
3. 把官方 `setTitleBarOverlay` 调用改成 `if (false && …)`，防止主题切换时系统按钮复活。

本机实测（`2026-11-03`，安装目录 `%LOCALAPPDATA%\Programs\DeepSeek Harness`）：

| 探针 | 实测值 |
|---|---|
| asar 内 `package.json` | `@deepseek-ai/dsh-desktop@0.2.1-rc.5`，asar 182,766,714 B |
| 补丁标记 `[liuli official window controls v1]` | **不存在** → 当前客户端未打补丁 |
| `createWindow` / `PLATFORM_IPC.bootstrap` / `setTitleBarOverlay` 锚点 | 各 1 处，唯一命中 |
| `titleBarStyle: "hidden"` | 3 处（欢迎窗 darwin/win32 + 主窗 win32） |
| `node scripts/patch-official-window-controls.mjs --check` | exit 0，`version 0.2.1-rc.5`、`mainAndPreloadPrepared: true`、`asarIntegrityFuse: "off"`、备份目录 `liuli-window-controls-backup-0.2.1-rc.5` |

### 4. 设置页下拉菜单不能下滑

**现象**：设置页「添加模型提供商」那个 41 项的原生 `<select>` 被琉璃升级成自绘下拉后，
滚轮 / 拖动上下滚动时菜单总是**弹回顶部**；用户报的定位是 `div.R1xjuq_menu:nth-of-type(7)`。

**根因**：`positionMenu()` 量自然高度用的是「先把 `el.style.maxHeight = 'none'`，再读
`getBoundingClientRect().height`」。解除上限的那一瞬间元素不再溢出、`scrollHeight === clientHeight`，
浏览器立即把 `scrollTop` 钳回 0；而菜单自身的 scroll 事件又被 document capture 阶段的 scroll 监听接住
→ 下一帧 `positionMenu` 再量一次、再钳一次。于是「滚一点、弹回顶部」。

**为什么只坏设置页下拉**：官方 MenuSurface 的滚动在**内层** `._viewport_`（`overflow-y:auto`），
且不经过琉璃这段 JS 量高路径；琉璃的自绘菜单是单层（`position:fixed; overflow-y:auto`），
量高就落在滚动元素自己身上。

**修法**（`src/client/settings-selects.ts` + `SettingsSelects.module.css`）：

- 新增 `naturalMenuHeight(el)` = `scrollHeight` + 上下边框；`positionMenu` 不再解除 `max-height`、
  不再读 `getBoundingClientRect().height`；整个量高与写回在同一个同步块内完成、不 yield；
- `onDocumentScroll()`：菜单自身的 scroll 不触发重新锚定（只响应页面级滚动）；
- `scan()` 改为 `scheduleScan()`：可见窗口走 rAF（零延迟不变），`visibilityState === 'hidden'` 时
  补一个 200ms 定时器兜底 —— **隐藏窗口里 Chromium 完全不投递 animation frame**，否则设置页在那一刻
  挂载的 select 永远等不到扫描（这也是排查初期「注入探针也不升级」假象的成因）；
- `.menu` 增加 `overscroll-behavior: contain`，滚到端点不再把滚动链交给页面；
- `scan()` 的 `catch` 补 `console.warn`（不再静默吞异常），并写入诊断标记
  `window.__liuliSettingsSelectsReady__ = { tag: 'settings-selects/2026-11-03', at, upgraded }`。

**真机前后对比**（同一个 41 项下拉；修复前 = 10-29 安装包，修复后 = 本轮）：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 诊断标记 tag | 不存在 | `settings-selects/2026-11-03` |
| `scrollHeight / clientHeight` | 1278 / 666 | 1278 / 666 |
| inline `max-height` | 668px | 668px（重锚时 608↔668，均为 px） |
| 菜单 rect 在视口内 | 是 `[468,8,240,668]` | 是 `[468,8,240,668]` |
| `scrollTop=400` 后 8 次/60ms 采样 | 第 1 次即 **0**，之后恒 0 | **400 ×8，保持** |
| `scrollTop=200` 同上 | 立即 **0** | **200 ×8，保持** |
| 页面滚动重锚后 scrollTop | — | 仍 **400** |
| 滚动期间 `max-height` 写入次数 | 4 次（每次都含 `none`） | 0 次（仅页面滚动那次重锚写 2 次，无 `none`） |

**测试**：`tests/settings-selects.test.mjs` 由 2 例扩到 **7 例**（真 Chrome headless，17.4s，7/7 pass）：
长菜单保持自身滚动位置 / 页面滚动仍重锚 / **量高不得出现 `max-height:none`（本次根因的回归锚点，
用 MutationObserver 抓中间态）** / 视口内切边 + overscroll / 短菜单自然高度正确 /
隐藏窗口（rAF 暂停）仍能升级 / 诊断标记存在。

### 5. rc.3 → rc.5 官方客户端变更盘点（结论：无需补样式）

**方法论要点（下次别白比一遍）**：不能直接拿 npm tarball 跟 asar 比 CSS Module 类名哈希 ——
前缀由**构建时的绝对路径**播种，npm 包在 Linux CI 上构建（前缀形如 `hHd-Xa`），桌面端在 Windows CI 上构建
（前缀形如 `wtg9ga` / `hc2fJa`）。必须先把「哈希前缀 + 内嵌版本号 + 仓库路径」归一化再 diff。
归一化之后：**76 个含 `client.js` 的包里有 71 个与 rc.3 逐字节相同**。

真正有变化的只有 5 个（外加一个仅构建号变化的）：

| 包 | 变化 | 对琉璃的影响 |
|---|---|---|
| `dsh-client-ui-chat` | 新增 `reasoningText()` 剥掉 reasoning 里的 `<signature>` 包装；无正文时 `ReasoningRow` 返回 `null`；Body 槽新增 `rawText` | 空思考块不再渲染空壳；琉璃给思考块加的材质/圆角只作用于有内容的块，属预期 |
| `dsh-client-ui-conversation` | 删除 i18n key `session.moreViewsCurrent`，「更多会话视图」按钮的 `aria-label` 恒定为该文案（不再拼当前视图名）；新增 `ViewTabLabel`，标签宽度 > 88px 才套 Tooltip | 利好：基于 `aria-label` 的选择器更稳定；View 标签外层可能多/少一层 Tooltip |
| `dsh-cordis-client-runner` | 槽位契约清单行号 + `ReasoningBodyOwnerProps.rawText` | 无样式影响 |
| `dsh-client-ui-sidebar` | 仅内嵌构建提交号 `be72761` → `d4db512` | 无 |
| `dsh-experimental-client-ui-cot-translation` | 仅注释文案 | 无 |
| 其余（含 `sidebar-right`、`layout`、`theme`、`settings*`、`model-selection`、`input-trigger`、`workspace`、`tool`、`trajectory`、`session`、`renderer`、**web 壳 `dsh-web-frontend`**） | 逐字节相同 | 无 |

**web 壳是决定性证据**：`index-*.js`（941,436 B）、`vendor-*.js`（741,114 B）与两个 CSS 在 rc.3/rc.5 之间
**逐字节相同** —— 布局、设置外壳、以及**全部 primitives（MenuSurface / Toast / Dialog / HoverCard）**都在壳里，
等于「菜单原语一行没改」。

四个重点问题的答案：

1. **设置页原生 `<select>` 还在**：rc.3/rc.5 同集合，共 11 处 `jsx("select")`
   （settings-models ×4、cordis ×1、cot-translation ×1、voice-input ×4、session-inspector ×1）。
   琉璃靠 `_selectInput` 后缀扫是对的，**但绝不能把 `jrmgQW` 这类前缀写死**（前缀随构建路径变）。
2. **MenuSurface 结构 / 类名属性 / 滚动容器全部未变**：根 `div[data-menu-material=translucent]._surface_`
   → 材质层 `div[aria-hidden]._material_` → 内层 `._viewport_` 才是 `overflow-y:auto`；
   根的 `._scrollable_` 只有 `max-height: calc(100vh - 12px - max(12px, var(--dsh-frame-overlay-top, 12px)))`。
   另有一层 macOS 专属：body 级 `div[aria-hidden][data-menu-backing]._backing_` 用实底盖住壁纸，
   仅 `html[data-platform=darwin]` 时 `display:block`，Windows 无影响。
3. **官方 `data-*` 锚点 0 新增 0 消失**：把琉璃源码里 253 个 `data-*` 令牌逐个核对，
   其中 112 个是官方锚点，rc.3/rc.5 两边都在。
   ⚠️ **更正常见误解**：`data-region-pane`、`data-edge-top/right/bottom/left` **不是官方锚点，是琉璃自己的 dock 壳写的**
   （值是 `region:sidebar` 这种，配套类是琉璃 CSS Module `qFxRq_pane`）。官方真实存在、需要盯的是：
   `data-sidebar-right-guide` / `data-sidebar-right-guide-entry` / `data-sidebar-right-panel` / `data-sidebar-right-mode` /
   `data-composer-card` / `data-composer-seat` / `data-tool` / `data-variant` / `data-turn` / `data-slot` /
   `data-menu-material` / `data-shortcut-modal` / `data-conversation-scroll` / `data-input-scroll` /
   `data-trajectory-scroll` / `data-ds-dark-theme` —— 全部 rc.3/rc.5 同包同值。
   （`data-sidebar-right-guide-entry` 是历史锚点：官方只给已知引导项写它，rc.5 新增的「更多工具」入口
   **仍然没有**这个属性，所以琉璃那条 `aria-haspopup="menu"` 补齐规则仍然必要 —— 详见「边界」。）
4. **右栏「更多工具」、侧栏、页头、统计行均未变**：侧栏哈希前缀 rc.3/rc.5 都是 `wtg9ga`；
   右栏 `p2k40q_*` 不变；页头 `data-window-drag`、`data-conversation-header-leading/corner` 都在；
   `data-composer-stats` / `data-composer-stat` 是**琉璃自己的**锚点，不受官方变更影响。

**结论**：rc.3 → rc.5 没有任何需要补样式或改选择器的官方变更。本轮的样式层改动只来自两个用户报障本身。

### 6. 过时文档更正

| 文档 | 原文 | 更正 |
|---|---|---|
| [official-desktop-rc2.md](official-desktop-rc2.md) | 「当前适配桌面端为 0.2.1-rc.2」「脚本支持 0.2.0-rc.2 和 0.2.1-rc.2」 | 指到 rc.5 与本轮的补丁支持范围（见该文档顶部提示） |
| [features.md](features.md) | 「依赖对 DSH Desktop 的窗口参数补丁（`app.asar.unpacked/lib/electron-runtime-*.js` …）」 | 官方 Desktop 的窗口参数在 `app.asar` 内的 `lib/main.js`，由官方窗口控制补丁处理；`electron-runtime-*.js` 是更早的社区 / 2.0.x 旧布局的机制 |
| [features.md](features.md) | 「无边框补丁还原：… 把 electron-runtime 里的补丁块还原 …」 | 同上：官方 0.2.x 上自动还原找不到目标文件（`--check` 可见），还原要离线跑 `patch-official-window-controls.mjs --revert` |
| [install.md](install.md) | 「插件也会在 DSH Desktop 启动时自动重打该补丁」 | 官方 0.2.x 上启动时的自动补丁找不到 `electron-runtime-*.js`，只告警跳过；真正的路径是官方窗口控制补丁（`--check` → 退出客户端 → `--apply`，或客户端内按钮） |
| [install.md](install.md) | 「0.1.2 适配 DSH 0.2.0-rc.2」 | 本轮产物 `0.1.2-rc.39` 适配 DSH `0.2.1-rc.5`（`engines.dsh = ^0.2.1-rc.5`） |
| [dsh-021-rc3-upgrade.md](dsh-021-rc3-upgrade.md) | P06 记录的宿主补丁预检只到 rc.3 | 加一行指引：后续版本见本文档 |

## 验证记录

| 阶段 | 状态 | 证据或边界 |
|---|---|---|
| P01 来源与目标识别 | completed | 本机 `resources/app.asar` 内 `package.json` = `@deepseek-ai/dsh-desktop@0.2.1-rc.5`（182,766,714 B）；宿主侧 `@deepseek-ai/dsh-app-boot` 取 npm `0.2.1-rc.5` 包核对判定逻辑 |
| P02 兼容判定规则 | completed | `dsh-app-boot@0.2.1-rc.5` 的 `unmetRequirements`：有 `engines.dsh` 就只看它（`semver.satisfies(..., {includePrerelease:true})`）；`dshReleases`/`dsh.compatibility` 在宿主包与 asar 中 0 命中 |
| P03 依赖与补丁迁移 | completed | `package.json` 52 处、`pnpm-workspace.yaml` 81 处、dockkit 补丁改名（similarity 100%）；`pnpm-lock.yaml` 里 rc.3 残留 **0** 处（rc.5 1016 处 / 79 个包） |
| P04 构建 | completed | `pnpm install --ignore-scripts --no-frozen-lockfile` 9s（`+79 / -79`），复跑 `--frozen-lockfile` → `Already up to date`；`pnpm build` exit 0（`lib/index.js` 523.60 kB、`lib/client.js` 2.17 MB / map 3.20 MB），并入客户端源码改动后复跑仍 exit 0 |
| P05 测试 | completed | `node --test tests/*.test.mjs` 连跑两次 **71 tests / 71 pass / 0 fail**（本机 9.1s / 9.4s，Lead 复核 14.9s），覆盖 15 个测试文件；其中 `window-shell-patch` 5 例、`topbar-patch-versions` 5 例、`settings-selects` 7 例（含菜单滚动与 `max-height:none` 回归锚点） |
| P06 宿主补丁预检 | completed | `node scripts/patch-official-window-controls.mjs --check` exit 0：`version 0.2.1-rc.5`、`mainAndPreloadPrepared: true`、`asarIntegrityFuse: "off"`、`integrityHashOffset: 244979055`；未 `--apply`（需完全退出客户端） |
| P07 安装到 desktop profile | completed | `node scripts/install-desktop.mjs` → `.liuli-pack/dsh-liuli-ui-enhance-0.1.2-rc.39-ace165bb65ed.tgz` 写入 `~/.dsh/profiles/desktop/package.json` 的 `dependencies`；装后 `node_modules/dsh-liuli-ui-enhance/package.json` 的 `version` = `0.1.2-rc.39` |
| P08 真实客户端加载 | completed | 宿主的 live reload **自己**把新客户端模块推进了页面（无需关开插件开关、无需刷新）；CDP 实测 `window.__liuliSettingsSelectsReady__.tag === 'settings-selects/2026-11-03'`、`[data-liuli-theme]` 已挂载、`--liuli-*` CSS 变量存在、`[data-liuli-bg]` 壁纸层 ×2、`data-liuli-day-group` ×31、`data-liuli-entered` ×19，以及 `data-liuli-dock-surface` / `data-liuli-official-rightbar` / `data-liuli-speed-idle` 等 30+ 个锚点齐全；插件页状态正常（非「异常」） |
| P09 刷新后稳定性 | skipped（有意） | 用户 composer 里有未发送的输入（实测 `div.GRgSLq_input` 的 innerText 长度为 1），整页刷新会丢失，取舍上不做；以 P08 的模块热替换 + 全量测试作为替代证据 |
| P10 设置页菜单滚动 | completed | 见「4. 设置页下拉菜单不能下滑」的前后对比表：`scrollTop=400` 由「第 1 次采样即 0」变为「400 ×8 采样全程保持」；滚动期间 `max-height` 写入由 4 次（每次都含 `none`）降为 0 次；`settings-selects.test.mjs` 7/7 pass |
| P11 rc.3 → rc.5 变更盘点 | completed | 归一化后 76 个含 `client.js` 的包中 **71 个逐字节相同**；web 壳 `index-*.js` / `vendor-*.js` / 两个 CSS 逐字节相同 → 无需补样式 |
| P12 边界与未验证 | 部分 | 见文末「边界」 |

## 让宿主加载新版本

本轮 P08 的实测结论：**不需要重启客户端，也不需要关开插件开关** —— `install-desktop.mjs` 更新 profile
依赖后，宿主的 live reload **自己**把新的客户端模块推进了页面（页面随即出现新的诊断标记
`__liuliSettingsSelectsReady__.tag = 'settings-selects/2026-11-03'`）。

上一轮（rc.3）的经验是「在插件页把琉璃开关关掉再打开」，本轮没有走那一步。
如果你的环境没有自动推进：先在「插件」页把琉璃开关**关掉再打开**；仍无变化再重启客户端
（重启会改变 Web 端口）。

## 让窗口补丁真正生效（改代码 ≠ 补丁生效）

这是本轮最容易踩的一步：**白名单修好只是让补丁「有资格」被写入，客户端不会自己变好**。

1. **桌面端每次自动更新都会整份重铺** `resources/app.asar` 与 `DeepSeek Harness.exe`，补丁必然丢失；
2. 自 `3c1b5ba` 起，常驻看护（`liuli-launch.cmd`、计划任务、`liuli-topbar-watch.mjs`）已被移除，
   **现在没有任何后台自愈**；能用的只有「检测到缺失 → 你点一下」；
3. 两条生效路径：
   - **客户端内**：悬浮球 →「修复窗口顶栏」，或 设置 → 功能 → 「窗口顶栏」→「立即打补丁」，
     写入成功后**再重启一次客户端**（窗口参数只在创建窗口时读取）；
   - **命令行（推荐，最稳）**：先预检，再**完全退出客户端（含托盘）**后写入：

```powershell
node scripts/patch-official-window-controls.mjs --check    # 不改盘，先看版本/锚点/fuse
# 完全退出 DSH Desktop（含托盘图标）后：
node scripts/patch-official-window-controls.mjs --apply
# 不需要时还原（同样要求客户端已退出）：
node scripts/patch-official-window-controls.mjs --revert
```

4. 还原与排查的完整清单见 [window-topbar-persistence.md](window-topbar-persistence.md)；
   `node scripts/liuli-topbar-guard.mjs`（`pnpm topbar:status`）可随时查 `patched / missing / pending / unsupported`。

## 边界

- **rc.4 未实测**：这次只核对 rc.5；`dshReleases` 里把 rc.4 记成 `compatible` 是按「同一 minor 内的 rc 迭代」的
  既有结论（范围写法本来就允许它），但没有在真实 rc.4 客户端上跑过。
- **未验证**：多显示器 / DPI 缩放下的菜单定位与顶栏拖拽、音频回环、内嵌浏览器（`webviewTag` 补丁属旧机制，
  官方 0.2.x 上内嵌浏览器走官方 `WebContentsView`）。
- **P09 有意跳过**：用户 composer 里有未发送的输入，整页刷新会丢失，所以没有做「刷新后稳定性」这一项；
  其余加载证据见 P08。
- **`data-sidebar-right-guide-entry` 到 rc.5 仍然不存在**：琉璃那条
  `[data-sidebar-right-guide] button[class*="_entry"][aria-haspopup="menu"]` 的补齐规则**仍然必要**，
  不是历史包袱，不要当死代码删掉。
- **官方槽位清单 rc.3 → rc.5 是 100 → 100、0 增 0 减**：琉璃引用的 11 个真实槽位名全部命中
  （`settings.theme` 是 i18n 命名空间，不是槽位，别混进来）。
- **唯一待人工确认项**：`dsh-client-ui-chat` 的 `reasoningText()` 让「只有 `<signature>`、没有正文」的
  思考块整块不渲染；真机未复现异常。若将来出现「空玻璃条」，修法是让 `chat-flow-view.tsx` /
  `liuli-transition.ts` 跳过无正文的 reasoning 节点，**不要用 CSS 去猜**。
- **补丁签名**：打补丁后的 exe 不再匹配厂商原签名；本机 `embeddedAsarIntegrityValidation` fuse 为 **off**
  （`--check` 可直接看到），所以只改 asar 即可；fuse 为 `on` 的客户端必须走「完全退出 + 离线 `--apply`」，
  客户端内按钮会返回 `needs-exit`。
- **其它插件**：`dsh-cli-providers`、`@mars-sea/dsh-commandcode-provider` 不在本仓库，本轮未改动其声明；
  它们的 `engines.dsh` 若不是范围写法，同样会在宿主升级后被拒。
