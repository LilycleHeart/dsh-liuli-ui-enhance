# 无边框补丁 · 离线回滚（asar + exe 成对还原）

> 配套脚本：[`restore-desktop-asar.ps1`](./restore-desktop-asar.ps1)
> 适用客户端：DSH Desktop 2.0.9（win32，安装于 `D:\DSH\DSH Desktop`）

## 什么时候用它

按优先级从高到低：

1. **能进客户端、只想撤掉无边框** → 用官方补丁脚本自带的还原模式（会同步 exe 内嵌哈希，最干净）：
   ```powershell
   node scripts/patch-desktop-frameless.mjs --revert
   ```
2. **客户端起不来 / 补丁脚本报错 / asar 疑似损坏** → 用本目录的离线回滚脚本（纯文件级，不依赖客户端能启动）：
   ```powershell
   pwsh -File scripts/restore-desktop-asar.ps1
   ```

## 为什么必须「成对还原」

DSH Desktop **2.0.5+** 启用了 Electron 的 `EnableEmbeddedAsarIntegrityValidation`：
客户端用 **exe 内嵌的 `SHA256(asar 头 JSON)`** 校验归档完整性。

打补丁重建 asar 头时，脚本会就地改写 `DSH Desktop.exe` 里那个 64 字符哈希槽
（等长替换，PE 结构与文件大小不变；首次修改前备份为 `DSH Desktop.exe.bak-frameless`）。

因此：

| 只还原 app.asar | 只还原 exe | 两者都还原 |
|---|---|---|
| ❌ 启动即 `Integrity check failed` FATAL | ❌ 头哈希与实际 asar 不匹配 | ✅ 正常 |

## 校验基准（官方 2.0.9，2026-09-13 实测）

| 文件 | 大小 | SHA256 |
|---|---|---|
| `resources\app.asar.bak-frameless` | 168 985 005 | `f0bb5e285039adf18819c1026d9dabd6a6f604ca4f0d40cef45654aff684b0d1` |
| `DSH Desktop.exe.bak-frameless` | 225 653 760 | `c48b36342907d286a47c000e8c569462cc0daceb92aaae03f98ee6f5a04cd318` |

补丁版（供对照，当前状态）：

| 文件 | 大小 | SHA256 |
|---|---|---|
| `resources\app.asar` | 168 984 997 | `ac59fe4da9c0e030f95c5f18875da619e5699d539cc4b719687f009dca751f0e` |
| `DSH Desktop.exe` | 225 653 760 | `4f8d3cd6feb265f90dd121708d2616d5df39da4456144647bffbb68408ae712e` |

## 脚本做了什么

1. 检查安装目录，默认**要求客户端完全退出**（含托盘常驻），否则拒绝执行（`-Force` 可跳过，不推荐）。
2. SHA256 校验两个备份确为官方原版，不匹配需显式 `-Force`。
3. 覆盖前把当前补丁版另存为
   `app.asar.before-restore-<yyyyMMdd-HHmmss>` 与 `DSH Desktop.exe.before-restore-<时间戳>`（可反悔）。
4. 用备份覆盖 `app.asar` 与 `DSH Desktop.exe`（**成对**）。
5. `resources\app.asar.unpacked\lib\` 下的补丁残留（`electron-runtime-*.js`、`preload.cjs`）**只改名**为 `*.restored-<时间戳>`，不删除。
6. 打印还原后的 SHA256 并与基准比对，不一致即报错退出。

## 手动三步兜底（脚本也跑不了时）

```powershell
# 0) 完全退出 DSH Desktop（托盘 → 退出），确认无残留进程
Get-Process 'DSH Desktop' -ErrorAction SilentlyContinue

# 1) 成对复制备份回去
$d = 'D:\DSH\DSH Desktop'
Copy-Item "$d\resources\app.asar.bak-frameless" "$d\resources\app.asar" -Force
Copy-Item "$d\DSH Desktop.exe.bak-frameless"    "$d\DSH Desktop.exe"     -Force

# 2) 残留改名（可选，纯粹为了整洁）
Get-ChildItem "$d\resources\app.asar.unpacked\lib" -File |
  Where-Object { $_.Name -match '^electron-runtime-.*\.js$' -or $_.Name -eq 'preload.cjs' } |
  Rename-Item -NewName { "$($_.Name).restored" }

# 3) 校验 + 启动
(Get-FileHash "$d\resources\app.asar" -Algorithm SHA256).Hash.ToLower()
(Get-FileHash "$d\DSH Desktop.exe" -Algorithm SHA256).Hash.ToLower()
```

还原后窗口应恢复官方原生标题栏（页面内窗口按钮自动隐藏）；要重新启用无边框：

```powershell
node scripts/patch-desktop-frameless.mjs   # 打完请重启客户端
```

## 注意事项

- **不要在客户端运行时打补丁或回滚**。重建 asar 会让运行中的实例在启动子进程时崩溃（实测：宿主 job runner 以 `0x80000003` 退出，`pwsh`/`grep`/`glob` 全部失效，重启客户端才恢复）。
- `resources\app.asar.patched` 是补丁脚本产出的同步副本（内容与 `app.asar` 相同），不含在回滚范围；`app.asar.bak-209-patched` 是更早流程的残留备份，Electron 不会加载，可留可删。
- 客户端升级（安装器）会整体替换 exe 与 asar，通常也会覆盖/失效上述备份 —— 升级后请重新执行一次 `pnpm patch:desktop`，并重新确认备份基准哈希。
