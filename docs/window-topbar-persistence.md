# 窗口顶栏为什么每次客户端更新后都会失效

> 结论先行：这不是插件的 bug，而是「补丁写在宿主安装文件里」的必然结果 ——
> 客户端每次自动更新都会把 `resources/app.asar` 与 `DeepSeek Harness.exe` 换回官方版本，
> 补丁随之消失。现在插件会自己检测这件事，并在**悬浮球**和**设置页**各给一个按钮，
> 点一下就补回去（重启客户端后生效）。

## 一、顶栏依赖什么

琉璃的「窗口顶栏（常驻/悬浮）」= 页面内自绘的最小化/最大化/关闭按钮 + 拖拽区。
它需要两样宿主侧的东西，都只能由 Electron **主进程**提供：

1. **无边框窗口**：主窗口必须用 `frame: false`（或 `titleBarStyle: "hidden"` 且不显示原生按钮）创建，
   否则 Windows 原生标题栏和「应用/编辑」菜单栏会一直占着顶部；
2. **窗口控制桥**：自绘按钮要通过主进程 IPC 才能真正最小化/最大化/关闭。

这两样都在 `resources/app.asar` 的 `lib/main.js` / `lib/preload-app.cjs` 里，渲染进程改不了，
所以只能打宿主补丁。官方也**没有**提供任何「隐藏原生标题栏 / 自定义标题栏」的开关
（窗口参数在 `lib/main.js` 里硬编码；桌面设置里只有一项 `updates.allowTestAuthPopupWindow`；
渲染端只有一个只换颜色、不能隐藏按钮的 `windows-appearance` IPC）。

## 二、为什么每次更新都会失效

补丁要改三件事：

1. 把 `lib/main.js` 里主窗口的 `titleBarStyle: "hidden" + titleBarOverlay{…}` 换成 `frame: false`；
2. 往 `lib/preload-app.cjs` 追加 `window.liuliWindowControls` 桥；
3. 让 asar 头指向这两个新文件（离线脚本还会把新的 `SHA256(asar header)` 同步写回 exe）。

而客户端更新（nightly 通道，electron-updater）是**全量重铺**：安装器先把整个安装目录清空
（连备份目录一起删），再解包 `exe + app.asar + app.asar.unpacked + runtime`，而且更新是
「静默安装 + `--force-run` 自动重启」。补丁所在的两个文件被整份换掉，所以必然失效。

这也解释了插件为什么没法"自己悄悄补回来"：改 asar 之后若客户端启用了 ASAR 完整性校验，
就必须同步 exe 内嵌哈希，而运行中的 exe 被系统锁定 —— 离线脚本因此要求先退出客户端。

**但本机这个构建不必写 exe**：`DeepSeek Harness.exe` 里的 Electron fuse
`embeddedAsarIntegrityValidation` 是 **off**（`--check` 会直接报 `asarIntegrityFuse: off`），
所以插件可以在客户端运行时只改 asar 就完成补丁 —— 这是下面两个按钮能做到「不用退出、点一下就好」的前提。

## 三、怎么修：两个按钮

插件运行时会检测宿主补丁状态（`GET /liuli-topbar-patch`），检测到缺失就给出两个入口：

| 入口 | 位置 | 说明 |
|---|---|---|
| **悬浮球** | 琉璃悬浮工具窗的工具栏里多出「修复窗口顶栏」一项 | 只在 `missing` / `needs-exit` 时出现，补好后自动消失 |
| **设置** | 设置 → 功能 → 「窗口顶栏」下方 | 常驻显示当前状态与「立即打补丁」按钮，已应用时置灰 |

点击后的行为（`src/host-topbar-patch.ts`）：

1. 只改 **app.asar 头**：把 `lib/main.js`、`lib/preload-app.cjs` 两个条目标为 unpacked，
   其余条目与整个内容区**一个字节都不动**，头长度的差值用 padding 补齐 —— 文件总长与内容区偏移
   完全不变，所以客户端**运行时**写盘也不会让已经加载的进程读错位；
2. 把补丁后的 `main.js` / `preload-app.cjs` 写到 `app.asar.unpacked/lib/`；
3. exe 内嵌哈希**能写就同步**；写不了时，只有 fuse 明确为 `off` 才允许「只写 asar」；
4. 若该客户端启用了完整性校验（fuse `on`/`unknown`）或版本、锚点不支持 → 返回
   `needs-exit` / `unsupported` 并**拒绝写入**，绝不让客户端起不来；
5. **重启客户端后生效**（窗口参数只在创建窗口时读取）。

状态含义：`patched`（已应用）/ `missing`（可补）/ `needs-exit`（需退出客户端走离线脚本）/
`unsupported`（版本或锚点不在支持范围）。

### 命令行兜底

```powershell
node scripts/liuli-topbar-guard.mjs                       # 查状态：patched / missing / pending / unsupported
node scripts/patch-official-window-controls.mjs --check   # 离线补丁预检（不改盘）
# 完全退出 DSH Desktop（含托盘）后：
node scripts/patch-official-window-controls.mjs --apply
# 还原：node scripts/patch-official-window-controls.mjs --revert
```

`--apply` 那条路适合 fuse 为 `on` 的客户端（按钮会提示需要退出），也是出问题时的手动兜底；
它带备份目录、`record.json` 与写后校验。

### 实测记录（2026-10-26）

顶栏补丁被官方文件覆盖后（`state=missing`、`fuse=off`、`canApply=true`）：

| 场景 | 结果 |
|---|---|
| 设置 → 功能 → 「立即打补丁」 | 补丁写入成功，界面转为「无边框补丁已应用」 |
| 悬浮球 → 「修复窗口顶栏」 | 提示「已写入 app.asar（未启用 asar 完整性校验，无需同步 exe），重启后生效」，该入口随即消失 |
| 落盘校验 | asar 大小（182434783）与头长度（4748104）**均未变化**、`lib/main.js` 转为 unpacked 且无 offset、内容区 SHA256 不变、unpacked 文件写入完成 |
| 幂等 | 已应用状态下再点返回「无需重复操作」，不重复写盘 |
| 隔离测试（原版 asar 副本 + 合成 exe） | 全部不变量成立：文件大小不变、头长度不变、内容区哈希不变、marker / `frame: false` / preload 桥齐备、条目 size 与磁盘文件一致 |

## 四、已知限制

- **锚点漂移**：官方若改写主窗口创建代码，检测会返回 `unsupported` 并拒绝写入（安全失败）。
  此时需要更新 `src/host-topbar-patch.ts` 与离线脚本里的锚点、版本白名单 —— 属于大版本升级的正常维护。
- **备份占用**：离线脚本每成功补丁一次都会在安装目录留下 `liuli-window-controls-backup-<版本>/`
  （`app.asar` + `exe`，约 400 MB）。确认不需要回滚时可以手动删除（客户端更新本身也会清掉它）。
- **内嵌浏览器**：`webviewTag` 同属宿主补丁，历史上由 `patch-desktop-frameless.mjs` 负责；0.2.1 起窗口参数
  搬进 `lib/main.js` 后，本补丁未接管这一项，内嵌浏览器当前走官方 `WebContentsView`。
- **如果官方将来提供无边框/自定义标题栏开关**，这套补丁就可以整体退休 —— 优先用官方能力。

## 五、排查清单

| 现象 | 先看这里 |
|---|---|
| 顶栏没了、原生标题栏回来了 | 悬浮球或设置里的「打补丁」按钮；`node scripts/liuli-topbar-guard.mjs` 查状态 |
| 想知道按钮会不会成功 | 设置页那块会显示 `state` 与 fuse 状态；或 `node scripts/patch-official-window-controls.mjs --check`（不改盘） |
| 提示 `needs-exit` | 完全退出客户端 → `node scripts/patch-official-window-controls.mjs --apply` → 启动 |
| 客户端启动即崩溃 / Integrity check failed | `--revert` 还原，或删除安装目录下的 `liuli-window-controls-backup-*` 后重装客户端 |
| 打完补丁没变化 | 需要**重启客户端**（窗口参数只在创建窗口时读取） |
