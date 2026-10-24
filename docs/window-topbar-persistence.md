# 窗口顶栏为什么每次客户端更新后都会失效

> 结论先行：这不是插件的 bug，而是「补丁在宿主安装文件里」这件事的必然结果。
> 客户端自动更新把 `resources/app.asar` 与 `DeepSeek Harness.exe` 换成官方原版，
> 补丁被覆盖；而补丁又只能在客户端**完全退出**时写入，所以每次更新后都需要
> 恢复一次。本文给出四种恢复方式，其中两种可以做到「基本无感」。

## 一、顶栏依赖什么

琉璃的「窗口顶栏（常驻/悬浮）」= 页面内自绘的最小化/最大化/关闭按钮 + 拖拽区。
它需要两样宿主侧的东西，都只能由 Electron **主进程**提供：

1. **无边框窗口**：主窗口必须用 `frame: false`（或 `titleBarStyle: "hidden"` 且不显示原生按钮）创建，
   否则 Windows 原生标题栏和「应用/编辑」菜单栏会一直占着顶部；
2. **窗口控制桥**：自绘按钮要通过主进程 IPC 才能真正最小化/最大化/关闭。

这两样都在 `resources/app.asar` 的 `lib/main.js` / `lib/preload-app.cjs` 里，渲染进程改不了，
所以插件必须打宿主补丁：`scripts/patch-official-window-controls.mjs`。

## 二、为什么每次更新都会失效

补丁做了三件事：

1. 把 `lib/main.js` 里主窗口的 `titleBarStyle: "hidden" + titleBarOverlay{…}` 换成 `frame: false`；
2. 往 `lib/preload-app.cjs` 追加 `window.liuliWindowControls` 桥；
3. **重建 asar 头，并把新的 `SHA256(asar header)` 写回 `DeepSeek Harness.exe`**。

第 3 步是关键：Electron 启动时会拿 exe 里内嵌的哈希校验 asar 头，改了 asar 不同步 exe 就会
`Integrity check failed` 直接起不来。而 **运行中的 exe 被 Windows 锁定、写不进去** ——

> 所以补丁的硬性前提是：**客户端必须处于完全退出状态**。

客户端更新（nightly 通道，electron-updater）会把 `app.asar`、`DeepSeek Harness.exe` 整份替换成
官方文件，我们写入的三处改动随之消失；插件又在运行时，无法立刻补回。这就是「每次更新后顶栏失效」的全部原因。

补充两点容易误解的地方：

- 插件里的自动补丁 `src/frameless-patch.ts` 现在**不会**替你补：它受「2.0.5+ 自动补丁会导致主进程启动崩溃」
  的历史结论（`isAutoPatchBlocked`）与客户端包名判断拦截，只会留一行告警；
- 旧的 `pnpm patch:desktop`（`scripts/patch-desktop-frameless.mjs`）目标是 `electron-runtime-*.js`，
  **0.2.1 起该文件已不存在**，所以它现在会在这一步失败并提示改用官方补丁脚本。

## 三、四种恢复方式

| 方式 | 操作 | 无感程度 | 适合谁 |
|---|---|---|---|
| A. 手动补丁 | 退出客户端 → `node scripts/patch-official-window-controls.mjs --apply` → 启动 | 每次更新后手动一次 | 偶尔更新、想完全掌控 |
| B. 琉璃启动器 | 以后从 `scripts/liuli-launch.cmd` 的快捷方式启动 | 从它启动时永远是最新 | 习惯从固定快捷方式启动 |
| C. 看护进程（推荐） | `pwsh -File scripts/install-topbar-guard.ps1 -Mode Watch` | 客户端一退出就自动补，连静默重启也赶得上 | 想彻底不再管 |
| D. 定时看护 | `pwsh -File scripts/install-topbar-guard.ps1 -Mode Interval -Minutes 1` | 退出后最多 1 分钟补上 | 不想常驻进程 |

### A. 手动

```powershell
node scripts/patch-official-window-controls.mjs --check   # 预检，不改盘
# 完全退出 DSH Desktop（含托盘）
node scripts/patch-official-window-controls.mjs --apply
# 还原：node scripts/patch-official-window-controls.mjs --revert
```

也可以先问状态：

```powershell
node scripts/liuli-topbar-guard.mjs
# state=patched / missing / pending（客户端在运行）/ unsupported
```

### B. 琉璃启动器

`scripts/liuli-launch.cmd` 会在启动客户端**之前**检查补丁：缺失且客户端没在运行就自动补，然后启动。
给它建一个快捷方式（可换图标），以后从它启动即可。安装目录非默认时先设 `DSH_DESKTOP_DIR`。

### C / D. 看护（计划任务）

```powershell
pwsh -File scripts/install-topbar-guard.ps1 -Mode Watch -DryRun   # 先看要注册什么
pwsh -File scripts/install-topbar-guard.ps1 -Mode Watch           # C：登录时常驻看护
pwsh -File scripts/install-topbar-guard.ps1 -Mode Interval -Minutes 1   # D：每分钟检查
pwsh -File scripts/install-topbar-guard.ps1 -Status
pwsh -File scripts/install-topbar-guard.ps1 -Uninstall
```

看护的判定逻辑（`scripts/liuli-topbar-guard.mjs`）：

- 已打补丁 → 什么都不做；
- 补丁缺失、客户端**正在运行** → 只记录「待应用」，绝不写盘；
- 补丁缺失、客户端**已退出** → 调用补丁脚本写入（带备份、`record.json` 与写后校验）；
- 客户端版本/锚点不受支持 → 拒绝写入并记录原因（绝不硬改）。

常驻看护每 5 秒轮询一次 `tasklist`（毫秒级开销），日志写在
`%LOCALAPPDATA%\liuli-topbar-guard.log`。

## 四、已知限制

- **锚点漂移**：官方若改写主窗口创建代码，补丁脚本会因找不到锚点而拒绝写入（安全失败）。此时需要更新
  `scripts/patch-official-window-controls.mjs` 的锚点与版本白名单 —— 这属于每次大版本升级的正常维护。
- **备份占用**：每次成功补丁都会在安装目录留下 `liuli-window-controls-backup-<版本>/`
  （`app.asar` + `exe`，约 400 MB）。版本更新后旧备份已经没用（对应文件已被替换），确认不需要回滚时可以手动删除。
- **内嵌浏览器**：`webviewTag` 同样属于宿主补丁，历史上由 `patch-desktop-frameless.mjs` 负责；0.2.1 起窗口参数
  搬进 `lib/main.js` 后，官方窗口控制补丁尚未接管这一项，内嵌浏览器当前走官方 `WebContentsView`。
- **如果官方将来提供无边框/自定义标题栏开关**，这套补丁就可以整体退休 —— 优先用官方能力。

## 五、排查清单

| 现象 | 先看这里 |
|---|---|
| 顶栏没了、原生标题栏回来了 | `node scripts/liuli-topbar-guard.mjs` |
| 想看补丁脚本会做什么 | `node scripts/patch-official-window-controls.mjs --check`（不改盘） |
| 客户端启动即崩溃 / Integrity check failed | 用 `--revert` 还原，或删除安装目录下的 `liuli-window-controls-backup-*` 后重装客户端 |
| 看护没动作 | `%LOCALAPPDATA%\liuli-topbar-guard.log`、`install-topbar-guard.ps1 -Status` |
