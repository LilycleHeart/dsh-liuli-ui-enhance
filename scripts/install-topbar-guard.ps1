<#
.SYNOPSIS
  给琉璃顶栏补丁装一个「更新后自动恢复」的开关。

.DESCRIPTION
  DSH Desktop 每次自动更新都会用官方文件覆盖 resources/app.asar 与
  DeepSeek Harness.exe，宿主补丁（无边框 + 窗口控制桥）随之失效，窗口顶栏
  （常驻/悬浮）就没了。补丁必须写 exe 内嵌的 ASAR 完整性哈希，只能在客户端
  完全退出时执行，因此需要外部机制在正确的时机自动补上。

  两种模式：
    Watch   登录时启动一个常驻看护进程（5 秒轮询），客户端一退出且补丁缺失就
            立刻补 —— 连 electron-updater 的静默重启也能在它启动新版前补好。
    Interval 注册一个计划任务，按分钟周期调用一次性看护。更轻，但可能慢一拍
            （最短 1 分钟，容易错过「退出 → 自动重启」之间的几秒）。

  脚本本身不修改宿主文件；真正的写入由 scripts/patch-official-window-controls.mjs
  完成（带备份、record.json 与写后校验，锚点漂移时拒绝写入）。

.EXAMPLE
  pwsh -File scripts/install-topbar-guard.ps1 -Mode Watch -DryRun   # 先看要注册什么
  pwsh -File scripts/install-topbar-guard.ps1 -Mode Watch           # 登录时常驻看护
  pwsh -File scripts/install-topbar-guard.ps1 -Mode Interval -Minutes 1
  pwsh -File scripts/install-topbar-guard.ps1 -Status
  pwsh -File scripts/install-topbar-guard.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [ValidateSet('Watch', 'Interval')]
  [string]$Mode = 'Watch',
  [int]$Minutes = 1,
  [switch]$DryRun,
  [switch]$Status,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$taskName = 'LiuliTopbarGuard'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$guard = Join-Path $scriptDir 'liuli-topbar-guard.mjs'
$watch = Join-Path $scriptDir 'liuli-topbar-watch.mjs'

function Get-NodePath {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $cmd) { throw 'PATH 里找不到 node，请先安装 Node.js 20+ 或在任务里改用绝对路径' }
  return $cmd.Source
}

function Show-Status {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -eq $task) { Write-Host "[liuli] 未注册计划任务 $taskName"; return }
  $info = Get-ScheduledTaskInfo -TaskName $taskName
  [pscustomobject]@{
    TaskName   = $task.TaskName
    State      = $task.State
    Action     = ($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join ' | '
    Triggers   = ($task.Triggers | ForEach-Object { $_.CimClass.CimClassName }) -join ', '
    LastRun    = $info.LastRunTime
    LastResult = $info.LastTaskResult
    NextRun    = $info.NextRunTime
  } | Format-List
  Write-Host "[liuli] 看护日志：$env:LOCALAPPDATA\liuli-topbar-guard.log"
}

if ($Status) { Show-Status; return }

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "[liuli] 已移除计划任务 $taskName"
  } else {
    Write-Host "[liuli] 本就没有 $taskName"
  }
  return
}

foreach ($file in @($guard, $watch)) {
  if (-not (Test-Path -LiteralPath $file)) { throw "缺少脚本：$file" }
}
$node = Get-NodePath

if ($Mode -eq 'Watch') {
  $action = New-ScheduledTaskAction -Execute $node -Argument "`"$watch`"" -WorkingDirectory $scriptDir
  # 登录时启动常驻看护；再叠一个每 10 分钟的兜底触发器 —— 看护进程被结束
  # （实测出现过 LastResult=0xC000013A）或意外退出后，最多 10 分钟重新拉起。
  # MultipleInstances IgnoreNew 保证已在运行时不会叠出第二个实例。
  $trigger = @(
    (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
      -RepetitionInterval (New-TimeSpan -Minutes 10) `
      -RepetitionDuration (New-TimeSpan -Days 3650))
  )
} else {
  $action = New-ScheduledTaskAction -Execute $node -Argument "`"$guard`" --apply --quiet" -WorkingDirectory $scriptDir
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes $Minutes) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
}
$settings = New-ScheduledTaskSettingsSet -Hidden -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

if ($DryRun) {
  Write-Host "[liuli] DryRun：将注册计划任务 $taskName"
  Write-Host "  模式      : $Mode"
  Write-Host "  执行      : $node"
  Write-Host "  参数      : $($action.Arguments)"
  Write-Host "  工作目录  : $scriptDir"
  Write-Host "  触发器    : $(if ($Mode -eq 'Watch') { '登录时 + 每 10 分钟兜底拉起' } else { "登录后每 $Minutes 分钟" })"
  Write-Host "  说明      : 隐藏窗口、忽略新实例、不因电池停止、不限执行时长"
  return
}

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description 'DSH 客户端更新后自动恢复琉璃窗口顶栏补丁' -Force | Out-Null
Write-Host "[liuli] 已注册计划任务 $taskName（模式 $Mode）"
Show-Status
