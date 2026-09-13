#Requires -Version 5.1
<#
  琉璃主题 · DSH Desktop 补丁【文件级】回滚脚本
  ============================================================================
  用途：当无边框补丁导致客户端异常、且官方补丁脚本的 `--revert` 无法执行
        （例如客户端起不来、$env:DSH_DESKTOP_DIR 找不到）时，用本脚本直接
        用备份把客户端恢复到官方原版。

  ⚠️ 核心要点：2.0.5+ 的客户端用「exe 内嵌的 SHA256(asar 头 JSON)」校验归档
     完整性（EnableEmbeddedAsarIntegrityValidation）。补丁重建 asar 头时会
     同步改写 exe 里那个 64 字符的哈希槽。因此回滚必须 **app.asar 与
     DSH Desktop.exe 成对还原** —— 只还原 asar 会让客户端因
     `Integrity check failed` 直接 FATAL 起不来。

  安全设计：
    · 默认要求在 DSH Desktop 完全退出（含托盘）时执行，否则拒绝运行。
    · 先用 SHA256 校验备份确实是官方原版，不匹配需显式 -Force。
    · 覆盖前把当前文件另存为 *.before-restore-<时间戳>，可反悔。
    · unpacked 残留文件只改名不删除。

  用法（推荐用 pwsh 7 运行，中文输出不乱码）：
    pwsh -File scripts/restore-desktop-asar.ps1
    pwsh -File scripts/restore-desktop-asar.ps1 -InstallDir 'D:\DSH\DSH Desktop'
    pwsh -File scripts/restore-desktop-asar.ps1 -Force      # 跳过进程/哈希校验（危险）

  首选方案仍然是官方脚本自带的还原（它会同步 exe 哈希，最干净）：
    node scripts/patch-desktop-frameless.mjs --revert
#>
[CmdletBinding()]
param(
    [string]$InstallDir = 'D:\DSH\DSH Desktop',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

# 官方原版基准（2026-09-13 校验所得，客户端 2.0.9）
$AsarBakHash = 'f0bb5e285039adf18819c1026d9dabd6a6f604ca4f0d40cef45654aff684b0d1'
$ExeBakHash  = 'c48b36342907d286a47c000e8c569462cc0daceb92aaae03f98ee6f5a04cd318'

function Say([string]$msg) { Write-Host "[restore] $msg" }
function Warn([string]$msg) { Write-Host "[restore] 警告：$msg" -ForegroundColor Yellow }
function Fail([string]$msg) { Write-Host "[restore] 中止：$msg" -ForegroundColor Red; exit 1 }

$resources = Join-Path $InstallDir 'resources'
$asarPath  = Join-Path $resources 'app.asar'
$asarBak   = Join-Path $resources 'app.asar.bak-frameless'
$exePath   = Join-Path $InstallDir 'DSH Desktop.exe'
$exeBak    = Join-Path $InstallDir 'DSH Desktop.exe.bak-frameless'
$unpackedLib = Join-Path $resources 'app.asar.unpacked\lib'

# ── 0. 前置检查 ────────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $InstallDir)) { Fail "安装目录不存在：$InstallDir（可用 -InstallDir 指定）" }
foreach ($p in @($asarPath, $asarBak, $exePath, $exeBak)) {
    if (-not (Test-Path -LiteralPath $p)) { Fail "缺少必需文件：$p" }
}
Say "安装目录：$InstallDir"

$running = @(Get-Process -Name 'DSH Desktop' -ErrorAction SilentlyContinue)
if ($running.Count -gt 0) {
    $msg = "检测到 $($running.Count) 个 DSH Desktop 进程仍在运行（主进程与托盘常驻都算）。请从托盘菜单完全退出后重试。"
    if (-not $Force) { Fail $msg }
    Warn "$msg 已指定 -Force，继续执行（覆盖运行中的文件可能失败或让客户端状态错乱）。"
} else {
    Say '客户端未在运行，可以安全回滚。'
}

# ── 1. 校验备份确为官方原版 ────────────────────────────────────────────────
Say '校验备份文件哈希…'
$asarBakHash = (Get-FileHash -LiteralPath $asarBak -Algorithm SHA256).Hash.ToLower()
$exeBakHash  = (Get-FileHash -LiteralPath $exeBak  -Algorithm SHA256).Hash.ToLower()
if ($asarBakHash -ne $AsarBakHash) {
    if (-not $Force) { Fail "app.asar.bak-frameless 哈希与官方基准不一致（实际 $asarBakHash）。若确认该备份可用，请加 -Force。" }
    Warn "app.asar.bak-frameless 哈希与基准不一致，按 -Force 继续：$asarBakHash"
} else { Say '  app.asar 备份哈希匹配官方基准 ✓' }
if ($exeBakHash -ne $ExeBakHash) {
    if (-not $Force) { Fail "DSH Desktop.exe.bak-frameless 哈希与官方基准不一致（实际 $exeBakHash）。若确认该备份可用，请加 -Force。" }
    Warn "exe 备份哈希与基准不一致，按 -Force 继续：$exeBakHash"
} else { Say '  DSH Desktop.exe 备份哈希匹配官方基准 ✓' }

# ── 2. 保存当前状态（可反悔） ──────────────────────────────────────────────
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$asarKeep = "$asarPath.before-restore-$stamp"
$exeKeep  = "$exePath.before-restore-$stamp"
Say "备份当前补丁版文件：`n  $asarKeep`n  $exeKeep"
Copy-Item -LiteralPath $asarPath -Destination $asarKeep -Force
Copy-Item -LiteralPath $exePath  -Destination $exeKeep  -Force

# ── 3. 成对还原 asar 与 exe（顺序无关，但必须都做） ────────────────────────
Say '还原 app.asar ← app.asar.bak-frameless'
Copy-Item -LiteralPath $asarBak -Destination $asarPath -Force
Say '还原 DSH Desktop.exe ← DSH Desktop.exe.bak-frameless（内嵌 asar 头哈希随之一致）'
Copy-Item -LiteralPath $exeBak -Destination $exePath -Force

# ── 4. unpacked 残留只改名不删除 ───────────────────────────────────────────
if (Test-Path -LiteralPath $unpackedLib) {
    $stale = @(Get-ChildItem -LiteralPath $unpackedLib -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^electron-runtime-.*\.js(\.map)?$' -or $_.Name -eq 'preload.cjs' -or $_.Name -like '*.stale-check' })
    if ($stale.Count -eq 0) { Say 'unpacked/lib 无补丁残留文件。' }
    foreach ($f in $stale) {
        $newName = "$($f.Name).restored-$stamp"
        Rename-Item -LiteralPath $f.FullName -NewName $newName
        Say "  残留改名：$($f.Name) -> $newName"
    }
    Say '（官方头中这些条目为 packed，磁盘残留在还原后不会被读取；改名仅为整洁，可随时删除。）'
} else {
    Say 'unpacked/lib 目录不存在，跳过残留处理。'
}

# ── 5. 结果校验 ────────────────────────────────────────────────────────────
$asarNow = (Get-FileHash -LiteralPath $asarPath -Algorithm SHA256).Hash.ToLower()
$exeNow  = (Get-FileHash -LiteralPath $exePath  -Algorithm SHA256).Hash.ToLower()
Say "还原后 app.asar sha256        = $asarNow"
Say "还原后 DSH Desktop.exe sha256 = $exeNow"
if ($asarNow -ne $AsarBakHash -or $exeNow -ne $ExeBakHash) {
    Fail '还原后哈希与官方基准不符，请人工核对（可用 *.before-restore-* 回退到补丁版）。'
}
Say '哈希与官方基准一致 ✓'
Write-Host ''
Say '回滚完成：请启动 DSH Desktop，窗口应恢复为官方原生标题栏。'
Say "如需重新打补丁：node scripts/patch-desktop-frameless.mjs"
