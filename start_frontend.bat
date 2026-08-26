@echo off
setlocal EnableExtensions
cd /d "%~dp0frontend"

call npm.cmd run build
if errorlevel 1 (
  echo VIV Communications frontend build FAILED.
  exit /b 1
)

echo VIV Communications frontend build updated. The backend on port 19000 serves this build.

if /i "%~1"=="--no-pause" exit /b 0
pause
