@echo off
rem DSH Desktop · CDP 调试模式启动（双击即可）
rem 前提：先完全退出正在运行的 DSH Desktop（托盘图标右键 → 退出）
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0dsh-debug-launch.ps1" %*
pause
