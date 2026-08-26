# VIV Communications

**VIV Communications is the local-first email and communications surface for VIV — Vector Intelligence Vault.**

It stores the authoritative mail record locally on the R: drive, serves the browser client from the local FastAPI service on port `19000`, and integrates approved people and correspondence with canonical VIV dossiers.

Public access is intended through the configured Cloudflare tunnel / Access layer at `https://mail.spruked.com/`, where the authentication screen appears before the local VIV Communications application is exposed.

## Current product boundary

- **VIV Communications** owns email presentation, mail actions, message custody, local mail storage, account/folder state, drafts, search, and communications UX.
- **VIV** owns canonical subjects/dossiers, business context, relationships, lifecycle state, and durable intelligence about people.
- Incoming email is evidence of correspondence. It does **not** automatically create a VIV dossier.
- Unknown senders are reviewed by the owner. Approved people are reconciled into the shared VIV substrate and promoted into canonical dossiers without creating a competing contact authority.

## Runtime architecture

```text
Internet sender
      |
      v
Cloudflare Email Routing / Worker
      |
      v
Authenticated tunnel / webhook path
      |
      v
VIV Communications backend
FastAPI on 127.0.0.1:19000
      |
      +--> R:\email_client\emails.db
      +--> R:\email_client\attachments
      +--> raw-mail custody vault
      |
      +--> VIV shared contact / dossier substrate
      |       |
      |       +--> canonical Party / dossier
      |       +--> business context
      |       +--> relationship intelligence
      |
      v
React VIV Communications UI
```

## Primary capabilities

- Multi-account inbox and sent-mail views
- Read, compose, reply, forward, star, archive, trash, drafts, and search
- Sandboxed/contained HTML email reader
- Local message custody and raw-message preservation
- Unknown-source review before dossier promotion
- VIV dossier lookup from a selected sender
- Communications-to-dossier and dossier-to-communications deep links
- Business-context-aware VIV handoff
- Shared canonical contact substrate rather than duplicate CRM/contact databases
- Startup tray supervisor and Windows login autostart
- Public Cloudflare Access entrypoint at `mail.spruked.com`

## Repository layout

```text
SPRUK_EMAIL/
├── backend/
│   ├── app.py                    # VIV Communications V4 entrypoint
│   ├── main.py                   # compatibility backend and core mail API
│   ├── viv_dossier_bridge.py     # Communications -> canonical VIV dossier bridge
│   ├── cali_bridge_routes.py     # VIV/CALI compatibility integration routes
│   ├── custody_routes.py         # raw-message custody path
│   ├── contact_candidate_routes.py
│   ├── registry_routes.py
│   └── requirements.txt
├── frontend/
│   ├── src/PrimeMailV4.js        # current VIV Communications client
│   ├── src/ContactReviewOverlay.js
│   └── package.json
├── scripts/
│   ├── prime_mail_tray.ps1
│   └── prime_mail_register_current_location.ps1
├── start_backend.bat
├── start_frontend.bat
├── start_prime_mail.bat
├── setup.bat
├── dev.log
└── docs/SETUP.md
```

## Canonical Python runtime

`setup.bat` provisions the backend environment here:

```text
SPRUK_EMAIL\backend\venv\
```

That is the preferred VIV Communications backend runtime.

The backend dependency set is declared in:

```text
backend\requirements.txt
```

and includes FastAPI, Uvicorn, HTTPX, Pydantic, multipart support, and Bleach.

### Backend dependency repair

If startup reports `ModuleNotFoundError: No module named 'fastapi'`, do **not** assume the mail database or Cloudflare tunnel failed. It means the selected Python interpreter does not contain the backend dependency set.

From the repository root:

```powershell
Set-Location "C:\dev\Desktop\PLATFORM\Spruk_Email\backend"

if (-not (Test-Path ".\venv\Scripts\python.exe")) {
    python -m venv venv
}

& ".\venv\Scripts\python.exe" -m pip install -r requirements.txt
& ".\venv\Scripts\python.exe" app.py
```

`start_backend.bat` probes for a compatible interpreter and prefers `backend\venv\Scripts\python.exe`. It will not deliberately select a Python environment that cannot import the required FastAPI/Uvicorn modules.

## Build and launch

### Frontend validation/build

```powershell
Set-Location "C:\dev\Desktop\PLATFORM\Spruk_Email\frontend"
npm run build
```

### Normal application launch

```powershell
Set-Location "C:\dev\Desktop\PLATFORM\Spruk_Email"
.\start_prime_mail.bat
```

The launcher registers the current installation, starts the tray supervisor, ensures the frontend build is available, and starts the backend on port `19000`.

### Direct backend validation

```powershell
Set-Location "C:\dev\Desktop\PLATFORM\Spruk_Email\backend"
& ".\venv\Scripts\python.exe" app.py
```

Expected local application URL:

```text
http://127.0.0.1:19000/
```

Expected public authenticated entrypoint:

```text
https://mail.spruked.com/
```

## Startup and diagnostics

The tray supervisor is designed to continue running at Windows login after the application has been registered by `start_prime_mail.bat`.

Useful checks:

```powershell
Get-NetTCPConnection -LocalPort 19000 -State Listen -ErrorAction SilentlyContinue
Get-Content "$env:LOCALAPPDATA\PrimeMail\tray.log" -Tail 100
Get-Content "$env:LOCALAPPDATA\PrimeMail\backend.log" -Tail 100
```

If port `19000` is not listening, diagnose the local backend before changing Cloudflare configuration.

## Storage

Primary persistent mail paths are local:

```text
R:\email_client\emails.db
R:\email_client\attachments\
R:\email_client\vault\raw_email\
```

VIV Communications also participates in the shared VIV substrate for approved people/dossiers rather than maintaining an independent competing CRM database.

## Identity and terminology

The current product identity is **VIV Communications**.

Current UI terminology uses:

- **Star / Starred / Unstar** for email importance
- **Dossier** for a canonical VIV subject record
- **Business Context** for ordinary VIV scoping
- **Compartment / clearance** only for security concepts

Legacy `Prime Mail`, `CALI CRM`, and related names may still appear internally in compatibility filenames, environment keys, migration paths, or historical logs. They are not the intended current product-facing identity.

## Development status — 2026-08-26

The `prime-mail-v4` branch contains the VIV Communications identity conversion, VIV dossier bridge, business-context handoff, deep-link integration, HTML reader containment, human-governed unknown-source promotion, and revised Windows startup/tray registration.

A runtime startup regression was identified on 2026-08-26 when a root-level virtual environment lacking FastAPI was selected during manual validation. The canonical backend environment remains `backend\venv`, matching `setup.bat`. Startup logic has been corrected to prefer and verify that backend environment before launching.

See `dev.log` for the detailed engineering history and verification state.
