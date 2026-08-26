# VIV Communications Setup Guide

VIV Communications is the local-first communications surface for VIV. The local backend is the system of record for mail data, while approved people are reconciled into canonical VIV dossiers through the shared substrate.

## Runtime topology

```text
Internet mail
   |
   v
Cloudflare Email Routing / Worker
   |
   v
Cloudflare tunnel / Access
   |
   v
VIV Communications
FastAPI on 127.0.0.1:19000
   |
   +--> R:\email_client\emails.db
   +--> R:\email_client\attachments
   +--> raw-message custody vault
   +--> shared VIV dossier substrate
```

Expected local URL:

```text
http://127.0.0.1:19000/
```

Expected public authenticated entrypoint for this installation:

```text
https://mail.spruked.com/
```

The public hostname is expected to present its authentication layer before exposing the local application.

## Prerequisites

- Windows with PowerShell
- Python 3.10+
- Node.js 18+
- R: drive paths used by the current installation
- Cloudflare routing/tunnel configuration already established for the deployment

## Backend environment

The canonical backend Python environment is:

```text
SPRUK_EMAIL\backend\venv\
```

This matches `setup.bat` and is intentionally separate from any unrelated repository-root virtual environment.

### Create/repair the backend environment

From PowerShell:

```powershell
Set-Location "C:\dev\Desktop\PLATFORM\Spruk_Email\backend"

if (-not (Test-Path ".\venv\Scripts\python.exe")) {
    python -m venv venv
}

& ".\venv\Scripts\python.exe" -m pip install -r requirements.txt
```

Validate the required runtime before launch:

```powershell
& ".\venv\Scripts\python.exe" -c "import fastapi, uvicorn, httpx, pydantic; print('VIV Communications backend dependencies OK')"
```

## Backend entrypoint

The V4 entrypoint is:

```text
backend\app.py
```

`main.py` remains the compatibility/core mail backend imported by `app.py`; do not use `main.py` as the normal V4 launcher.

Direct validation:

```powershell
Set-Location "C:\dev\Desktop\PLATFORM\Spruk_Email\backend"
& ".\venv\Scripts\python.exe" app.py
```

Expected result: Uvicorn listens on `127.0.0.1:19000`.

## Frontend setup/build

```powershell
Set-Location "C:\dev\Desktop\PLATFORM\Spruk_Email\frontend"
npm install
npm run build
```

The FastAPI backend serves the production React build from port `19000`.

## Normal launch and Windows autostart

Use the root launcher:

```powershell
Set-Location "C:\dev\Desktop\PLATFORM\Spruk_Email"
.\start_prime_mail.bat
```

Despite the historical filename, this launcher now represents **VIV Communications**. It registers the current installation, creates/refreshes the VIV Communications desktop/startup entry, launches the tray supervisor, ensures the frontend build, and starts the backend.

`start_backend.bat` prefers `backend\venv\Scripts\python.exe` and verifies required imports before launching. Root-level or PATH Python interpreters are only accepted when they contain the required backend modules.

## Local storage

Current persistent mail paths:

```text
R:\email_client\emails.db
R:\email_client\attachments\
R:\email_client\vault\raw_email\
```

Approved contacts/dossiers use the shared VIV substrate rather than a separate competing CRM/contact database.

## VIV dossier behavior

- Incoming email does not automatically create a dossier.
- Unknown sources appear in owner review.
- Owner-approved sources are saved/reconciled and promoted through the VIV dossier backfill path.
- Promotion preserves business context when supplied.
- Communications and VIV can deep-link by sender/contact/message/business context.

## Diagnostics

Check whether the local service is listening:

```powershell
Get-NetTCPConnection -LocalPort 19000 -State Listen -ErrorAction SilentlyContinue
```

Tray/startup log:

```powershell
Get-Content "$env:LOCALAPPDATA\PrimeMail\tray.log" -Tail 100
```

Backend log:

```powershell
Get-Content "$env:LOCALAPPDATA\PrimeMail\backend.log" -Tail 100
```

### `ModuleNotFoundError: No module named 'fastapi'`

This is a Python-environment problem, not evidence of lost mail data or a Cloudflare failure.

The backend dependency file already declares FastAPI and the rest of the required stack. Repair the canonical environment:

```powershell
Set-Location "C:\dev\Desktop\PLATFORM\Spruk_Email\backend"
& ".\venv\Scripts\python.exe" -m pip install -r requirements.txt
```

If `backend\venv\Scripts\python.exe` does not exist:

```powershell
python -m venv venv
& ".\venv\Scripts\python.exe" -m pip install -r requirements.txt
```

Then launch `app.py` with that exact interpreter.

### Local port works but public hostname does not

Only after `127.0.0.1:19000` is confirmed healthy should the Cloudflare tunnel / Access path be investigated. Avoid changing an established Cloudflare configuration merely because the local backend failed to start.

## Security notes

- Keep webhook and Cloudflare credentials outside source control.
- Treat the R: drive mail database/raw custody path as authoritative local data.
- Public access should remain behind the established authenticated Cloudflare entrypoint.
- Keep VIV dossier promotion human-governed for unknown senders.

## Current identity

Current product-facing identity: **VIV Communications**.

Historical filenames such as `start_prime_mail.bat`, `prime_mail_tray.ps1`, `%LOCALAPPDATA%\PrimeMail`, and some compatibility environment keys remain to avoid breaking installed/runtime state. They should not be interpreted as the current product name.
