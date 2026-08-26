@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "SHORTCUT_NAME=VIV Communications.lnk"
set "DESKTOP_SHORTCUT=%USERPROFILE%\Desktop\%SHORTCUT_NAME%"
set "ICON_DIR=%~dp0assets"
set "ICON_PATH=%ICON_DIR%\viv_communications.ico"
set "RUN_KEY_NAME=VIVCommunicationsStartup"
set "RUN_KEY_PATH=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "LAUNCHER_PATH=%~f0"
set "TRAY_SCRIPT=%~dp0scripts\prime_mail_tray.ps1"

if not exist "%ICON_DIR%" mkdir "%ICON_DIR%"

rem Re-register the CURRENT client location every time the launcher runs.
rem Persistent communications data remains on the R: substrate; this only owns app startup.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\prime_mail_register_current_location.ps1" ^
  -ShortcutPath "%DESKTOP_SHORTCUT%" ^
  -LauncherPath "%LAUNCHER_PATH%" ^
  -IconPath "%ICON_PATH%" ^
  -RunKeyPath "%RUN_KEY_PATH%" ^
  -RunKeyName "%RUN_KEY_NAME%"
if errorlevel 1 (
  echo VIV Communications startup registration failed.
  exit /b 1
)

rem Start one persistent, hidden tray supervisor. It builds the current React
rem client for manual launches, starts the backend on 19000, and owns the tray UI.
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%TRAY_SCRIPT%" -EnsureBuild

endlocal
exit /b 0
