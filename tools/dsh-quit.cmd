@echo off
rem DSH Desktop · 强制退出全部进程（重启调试模式前的兜底清理）
rem 注意：会直接终止应用，未保存的状态可能丢失；正常退出优先用托盘 → 退出。
taskkill /IM "DSH Desktop.exe" /F >nul 2>&1
echo 已强制退出 DSH Desktop 全部进程。接下来可运行 dsh-debug-launch.cmd。
pause
