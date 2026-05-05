# 📧 R-Drive Email Client

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
React UI (localhost:3000)
```

## ✨ Features

- ✅ **Zero Big Tech** - No Gmail, Outlook, Yahoo servers
- ✅ **Local Storage** - All emails on YOUR R: drive
- ✅ **Full Inbox** - Read, compose, reply, star, archive
- ✅ **Search** - Full-text search across all emails
- ✅ **Contacts** - Auto-built from incoming emails
- ✅ **Threading** - Conversation grouping
- ✅ **Send via Cloudflare** - Outbound through Cloudflare Email Service

## 📁 Project Structure

```
rdrive-email-client/
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
