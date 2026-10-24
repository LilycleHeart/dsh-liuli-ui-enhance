@echo off
rem ============================================================
rem 琉璃启动器：启动 DSH Desktop 之前先补齐宿主顶栏补丁
rem ------------------------------------------------------------
rem DSH Desktop 自动更新会覆盖 app.asar 与 exe，宿主补丁（无边框 +
rem 窗口控制桥）随之失效。补丁必须写 exe 内嵌的 ASAR 完整性哈希，
rem 只能在客户端未运行时执行 —— 所以把「补丁检查」放在启动之前。
rem
rem 用法：给这个 .cmd 建一个桌面/开始菜单快捷方式，以后从它启动。
rem   也可设 DSH_DESKTOP_DIR 指定非默认安装目录。
rem ============================================================
setlocal
set "SCRIPT_DIR=%~dp0"
if defined DSH_DESKTOP_DIR (
  set "DSH_DIR=%DSH_DESKTOP_DIR%"
) else (
  set "DSH_DIR=%LOCALAPPDATA%\Programs\DeepSeek Harness"
)
set "DSH_EXE=%DSH_DIR%\DeepSeek Harness.exe"

if not exist "%DSH_EXE%" (
  echo [liuli] 找不到 DSH Desktop：%DSH_EXE%
  echo         可用 DSH_DESKTOP_DIR 指定安装目录后重试。
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [liuli] PATH 里找不到 node，跳过顶栏补丁检查，直接启动。
) else (
  node "%SCRIPT_DIR%liuli-topbar-guard.mjs" --apply --quiet
  if errorlevel 3 echo [liuli] 顶栏补丁不适用当前客户端版本，已跳过（不影响启动）。
)

start "" "%DSH_EXE%"
endlocal
