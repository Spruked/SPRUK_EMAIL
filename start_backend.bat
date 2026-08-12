@echo off
setlocal EnableExtensions

rem Client code may live anywhere. Persistent PRIME MAIL/CALI data stays on the R: substrate.
set "EMAIL_DB_PATH=R:\email_client\emails.db"
set "CALI_DB_PATH=R:\Substrate_Vault_R\vaults\r_drive_system_records\crm\memory\cali_personal.db"
set "EMAIL_ATTACHMENTS_DIR=R:\email_client\attachments"
set "PRIME_MAIL_RAW_VAULT=R:\email_client\vault\raw_email"
set "CALI_CRM_PROJECT_ROOT=C:\dev\Desktop\PLATFORM\SPRUKED_CRM_MASTER_2026-05-05"

cd /d "%~dp0backend"
if exist "venv\Scripts\activate.bat" call "venv\Scripts\activate.bat"
python app.py
