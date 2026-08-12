@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "FIRST_RUN_FLAG=%~dp0.prime_mail_first_run_done"
set "SHORTCUT_NAME=Prime Mail.lnk"
set "DESKTOP_SHORTCUT=%USERPROFILE%\Desktop\%SHORTCUT_NAME%"
set "ICON_DIR=%~dp0assets"
set "SOURCE_EMAIL_LOGO_PNG=%~dp0frontend\public\primemail-logo.png"
set "SOURCE_CRM_WALLPAPER_PNG=C:\dev\Desktop\PLATFORM\SPRUKED_CRM_MASTER_2026-05-05\CLAI CRMLOGO.png"
set "SHORTCUT_LOGO_PNG=%ICON_DIR%\email-logo.png"
set "CRM_WALLPAPER_PNG=%ICON_DIR%\crm-wallpaper.png"
set "ICON_PATH=%ICON_DIR%\prime_mail.ico"
set "WALLPAPER_PATH=%CRM_WALLPAPER_PNG%"
set "RUN_KEY_NAME=PrimeMailStartup"
set "RUN_KEY_PATH=HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
set "LAUNCHER_PATH=%~f0"

if not exist "%ICON_DIR%" mkdir "%ICON_DIR%"
if exist "%SOURCE_EMAIL_LOGO_PNG%" copy /y "%SOURCE_EMAIL_LOGO_PNG%" "%SHORTCUT_LOGO_PNG%" >nul
if exist "%SOURCE_CRM_WALLPAPER_PNG%" copy /y "%SOURCE_CRM_WALLPAPER_PNG%" "%CRM_WALLPAPER_PNG%" >nul

if not exist "%FIRST_RUN_FLAG%" (
  echo Running first-time Prime Mail startup setup...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\prime_mail_first_run.ps1" ^
    -ShortcutLogoPng "%SHORTCUT_LOGO_PNG%" ^
    -IconPath "%ICON_PATH%" ^
    -WallpaperPath "%WALLPAPER_PATH%" ^
    -ShortcutPath "%DESKTOP_SHORTCUT%" ^
    -LauncherPath "%LAUNCHER_PATH%" ^
    -RunKeyPath "%RUN_KEY_PATH%" ^
    -RunKeyName "%RUN_KEY_NAME%" ^
    -FlagPath "%FIRST_RUN_FLAG%"
  if errorlevel 1 exit /b 1
)

if exist "%DESKTOP_SHORTCUT%" (
  echo Shortcut verification: OK - "%DESKTOP_SHORTCUT%"
) else (
  echo Shortcut verification: FAILED - "%DESKTOP_SHORTCUT%"
)

for /f "tokens=3,*" %%A in ('reg query "%RUN_KEY_PATH%" /v "%RUN_KEY_NAME%" 2^>nul ^| findstr /i "%RUN_KEY_NAME%"') do (
  set "RUN_VALUE=%%A %%B"
)
if defined RUN_VALUE (
  echo Run key verification: OK - !RUN_VALUE!
) else (
  echo Run key verification: FAILED - %RUN_KEY_PATH%\%RUN_KEY_NAME%
)

rem Build the React client FIRST so port 19000 can never serve a stale frontend.
call "%~dp0start_frontend.bat" --no-pause
if errorlevel 1 (
  echo PRIME MAIL startup aborted because the frontend build failed.
  exit /b 1
)

rem Only start the backend after the current frontend build is ready.
start "Prime Mail Backend" cmd /c call "%~dp0start_backend.bat"

endlocal
exit /b 0
