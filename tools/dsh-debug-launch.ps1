# DSH Desktop · CDP 调试模式启动脚本
#
# 用法（在 PowerShell 里）:
#   powershell -ExecutionPolicy Bypass -File tools\dsh-debug-launch.ps1
#   powershell -ExecutionPolicy Bypass -File tools\dsh-debug-launch.ps1 -NoInspect   # 只开渲染进程 CDP
#   powershell -ExecutionPolicy Bypass -File tools\dsh-debug-launch.ps1 -Port 9333  # 自定义端口
#
# 效果：
#   - 以 --remote-debugging-port=<Port> 启动 DSH Desktop（渲染进程 CDP，默认 9222）
#   - 默认附带 --inspect=<InspectPort>（Electron 主进程 Node inspector，默认 9229），
#     想调试主进程代码（BrowserWindow/webContents/插件 Host 半）时用
#     chrome://inspect 或 node --inspect 客户端连 127.0.0.1:9229。
#   - 无参数双击等价于最简模式；可用 -NoInspect 只开渲染进程。
#
# 前提：先完全退出正在运行的 DSH Desktop（托盘图标右键 → 退出），
#       否则 Electron 单实例锁会让新实例把参数转发给旧实例或直接退出。
# 还原：不传任何调试参数正常启动 DSH Desktop.exe 即可。
#
# 注意：调试端口只绑定 127.0.0.1；调试期间任何本机进程都能驱动应用，
#       调试完建议恢复正常启动。

param(
  [int]$Port = 9222,
  [int]$InspectPort = 9229,
  [switch]$NoInspect
)

$ErrorActionPreference = 'Stop'

$exe = 'D:\DSH\DSH Desktop\DSH Desktop.exe'
if (-not (Test-Path $exe)) {
  # 兜底：从运行中的进程或默认安装位置找
  try {
    $running = (Get-Process 'DSH Desktop' -ErrorAction SilentlyContinue | Select-Object -First 1).Path
    if ($running -and (Test-Path $running)) { $exe = $running }
  } catch { }
}
if (-not (Test-Path $exe)) {
  Write-Host "找不到 DSH Desktop.exe，请修改本脚本顶部的 `$exe 路径" -ForegroundColor Red
  exit 1
}

$existing = Get-Process 'DSH Desktop' -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host '检测到 DSH Desktop 正在运行。请先退出（托盘右键 → 退出），再运行本脚本。' -ForegroundColor Yellow
  Write-Host '或者：Get-Process "DSH Desktop" | Stop-Process -Force 后重试。' -ForegroundColor Yellow
  exit 2
}

# 预检端口：9222 常被 iphlpsvc（IP Helper）等系统服务占用，被占用时自动向后顺延。
function Find-FreePort([int]$preferred) {
  for ($i = 0; $i -lt 20; $i++) {
    $candidate = $preferred + $i
    if (-not (Get-NetTCPConnection -LocalPort $candidate -State Listen -ErrorAction SilentlyContinue)) {
      return $candidate
    }
  }
  return $preferred + 20
}

$resolvedPort = Find-FreePort $Port
if ($resolvedPort -ne $Port) {
  Write-Host "端口 $Port 已被占用（常见：iphlpsvc 系统服务），自动改用 $resolvedPort" -ForegroundColor Yellow
  $Port = $resolvedPort
}
if (-not $NoInspect) {
  $resolvedInspect = Find-FreePort $InspectPort
  if ($resolvedInspect -ne $InspectPort) {
    Write-Host "端口 $InspectPort 已被占用，自动改用 $resolvedInspect" -ForegroundColor Yellow
    $InspectPort = $resolvedInspect
  }
}

$launchArgs = @('--remote-debugging-port=' + $Port)
if (-not $NoInspect) { $launchArgs += '--inspect=' + $InspectPort }

Write-Host "启动 DSH Desktop：$exe $($launchArgs -join ' ')" -ForegroundColor Cyan
Start-Process -FilePath $exe -ArgumentList $launchArgs

Write-Host "等待调试端点就绪..."
$deadline = (Get-Date).AddSeconds(30)
$ok = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  try {
    $v = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
    Write-Host "CDP 就绪：$($v.Browser) ($($v.'Protocol-Version'))" -ForegroundColor Green
    $ok = $true
    break
  } catch { }
}
if (-not $ok) {
  Write-Host "超时未等到 http://127.0.0.1:$Port/json/version" -ForegroundColor Red
  exit 3
}

if (-not $NoInspect) {
  Write-Host "主进程 inspector：127.0.0.1:$InspectPort（chrome://inspect 或 node inspect 连接）" -ForegroundColor Green
}
Write-Host '渲染进程 CDP 工具：node demo/cdp.mjs targets' -ForegroundColor Green
