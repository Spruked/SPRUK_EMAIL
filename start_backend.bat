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

rem The repository venv is at the project root, not backend\venv. Use that exact
rem interpreter so hidden tray/autostart launches get the same dependencies as a
rem manually activated shell. Fall back to PATH only if the repo venv is absent.
set "PYTHON_EXE=%ROOT%\venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=python"

echo [%date% %time%] Starting VIV Communications backend with %PYTHON_EXE%>>"%BACKEND_LOG%"
cd /d "%ROOT%\backend"
"%PYTHON_EXE%" app.py >>"%BACKEND_LOG%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" echo [%date% %time%] VIV Communications backend exited with code %EXIT_CODE%>>"%BACKEND_LOG%"
exit /b %EXIT_CODE%
