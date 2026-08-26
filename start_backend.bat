@echo off
setlocal EnableExtensions

rem Client code may live anywhere. Persistent VIV Communications data stays on the R: substrate.
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "EMAIL_DB_PATH=R:\email_client\emails.db"
set "CALI_DB_PATH=R:\Substrate_Vault_R\vaults\r_drive_system_records\crm\memory\cali_personal.db"
set "EMAIL_ATTACHMENTS_DIR=R:\email_client\attachments"
set "PRIME_MAIL_RAW_VAULT=R:\email_client\vault\raw_email"
set "CALI_CRM_PROJECT_ROOT=C:\dev\Desktop\PLATFORM\SPRUKED_CRM_MASTER_2026-05-05"
set "LOG_DIR=%LOCALAPPDATA%\PrimeMail"
set "BACKEND_LOG=%LOG_DIR%\backend.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

rem setup.bat provisions backend\venv, which is the canonical backend runtime.
rem Prefer it first. Root-level venv and PATH Python are compatibility fallbacks,
rem but only if they can import the required backend modules.
set "PYTHON_EXE="
call :probe_python "%ROOT%\backend\venv\Scripts\python.exe"
if not defined PYTHON_EXE call :probe_python "%ROOT%\venv\Scripts\python.exe"
if not defined PYTHON_EXE call :probe_python "python"

if not defined PYTHON_EXE (
  echo [%date% %time%] ERROR: No Python runtime with FastAPI/Uvicorn dependencies was found.>>"%BACKEND_LOG%"
  echo [%date% %time%] Expected canonical runtime: %ROOT%\backend\venv\Scripts\python.exe>>"%BACKEND_LOG%"
  echo [%date% %time%] Repair: cd /d "%ROOT%\backend" ^&^& python -m venv venv ^&^& venv\Scripts\python.exe -m pip install -r requirements.txt>>"%BACKEND_LOG%"
  exit /b 9009
)

echo [%date% %time%] Starting VIV Communications backend with %PYTHON_EXE%>>"%BACKEND_LOG%"
cd /d "%ROOT%\backend"
"%PYTHON_EXE%" app.py >>"%BACKEND_LOG%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" echo [%date% %time%] VIV Communications backend exited with code %EXIT_CODE%>>"%BACKEND_LOG%"
exit /b %EXIT_CODE%

:probe_python
set "CANDIDATE=%~1"
if "%CANDIDATE%"=="" exit /b 0
if /i not "%CANDIDATE%"=="python" if not exist "%CANDIDATE%" exit /b 0
"%CANDIDATE%" -c "import fastapi, uvicorn, httpx, pydantic" >nul 2>&1
if not errorlevel 1 set "PYTHON_EXE=%CANDIDATE%"
exit /b 0
