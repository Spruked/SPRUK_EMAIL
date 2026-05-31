# 📧 Pro Prime Series Mail

**A self-hosted email client that bypasses Google, Microsoft, and Yahoo entirely.**

Your emails go directly from Cloudflare's routing network to your local R: drive. No big tech servers ever touch your data.

## 🚀 Quick Start

1. **Double-click** `setup.bat`
2. **Edit** `backend/.env` with your Cloudflare credentials
3. **Deploy** the Cloudflare Worker (see `docs/SETUP.md`)
4. **Run** `start_backend.bat` then `start_frontend.bat`

## 🏗️ Architecture

```
Internet Sender
      │
      ▼
Cloudflare Email Routing (just routes, doesn't store)
      │
      ▼
Cloudflare Worker (parses, forwards via webhook)
      │
      ▼ (HTTPS)
Your Computer → R: Drive (SQLite + FastAPI)
      │
      ▼
React UI (served by FastAPI on port 19000)
```

## ✨ Features

- ✅ **Zero Big Tech** - No Gmail, Outlook, Yahoo servers
- ✅ **Local Storage** - All emails on YOUR R: drive
- ✅ **Full Inbox** - Read, compose, reply, star, archive
- ✅ **Search** - Full-text search across all emails
- ✅ **Contacts** - Auto-built from incoming emails
- ✅ **Threading** - Conversation grouping
- ✅ **Receive via Email Routing** - Inbound mail routes to the local webhook
- ✅ **Send via Email Service** - Outbound uses Cloudflare Email Service API

## 📁 Project Structure

```
pro-prime-series-mail/
├── backend/          # FastAPI server (stores emails locally)
│   ├── main.py
│   ├── requirements.txt
│   └── .env.example
├── frontend/         # React email client UI
│   ├── src/
│   │   ├── App.js
│   │   ├── App.css
│   │   └── index.js
│   └── package.json
├── worker/           # Cloudflare Worker (receives from Cloudflare)
│   ├── index.js
│   └── wrangler.toml
└── docs/
    └── SETUP.md      # Detailed setup instructions
```

## 🔒 Privacy

- Emails stored in SQLite on your R: drive
- Cloudflare only sees email bytes in transit (no storage)
- Webhook secured with secret key
- No analytics, no tracking, no ads

## 🛠️ Tech Stack

- **Backend**: FastAPI + SQLite
- **Frontend**: React 18
- **Email Routing**: Cloudflare Email Routing + Workers
- **Email Sending**: Cloudflare Email Service API
- **Storage**: Local SQLite on R: drive

## 📄 License

MIT - Do whatever you want with it.

## 2026-05-30: Major UI/UX and Architecture Upgrades

- Implemented a full Connections/Status panel in the Prime Mail frontend:
  - Live status indicators for Prime Mail API, CALI CRM API, Desktop ORB API, CRM DB, Email DB, and Mesh/API manifest.
  - Actions for refreshing status, testing ORB, and syncing email to CRM.
  - Ask ORB (Assistant) placeholder added for future expansion.
- Refactored Contacts section:
  - Sidebar now shows a compact contacts shortcut.
  - Full Contacts workspace/modal added with:
    - List of all contacts (searchable, clickable)
    - Detail/edit view for each contact (name, email, phone, address, photo, extra fields)
    - Add new contact form
    - Linked emails panel for each contact
- All UI changes are fully styled and integrated with the existing design.
- No changes to contact or email authority: Prime Mail remains mail authority, CALI CRM is contact authority, ORB is operator/assistant layer.
- Verified: No HTTP sync, no duplicate DBs, all contact CRUD routed to shared CRM DB.
- All changes tested and no errors found.
