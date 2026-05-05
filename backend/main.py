# ============================================
# R-DRIVE EMAIL CLIENT - FastAPI Backend
# Runs locally on your R: drive
# Stores ALL emails locally - zero cloud dependency
# ============================================

from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from pathlib import Path
import sqlite3
import json
import hashlib
import asyncio
import httpx
import os

# === CONFIGURATION ===
DB_PATH = os.getenv("EMAIL_DB_PATH", "R:/email_client/emails.db")
ATTACHMENTS_DIR = os.getenv("EMAIL_ATTACHMENTS_DIR", "R:/email_client/attachments")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "your-secret-key-here")
CLOUDFLARE_API_TOKEN = os.getenv("CF_API_TOKEN", "")
CLOUDFLARE_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID", "")
SENDER_DOMAIN = os.getenv("SENDER_DOMAIN", "yourdomain.com")

Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
Path(ATTACHMENTS_DIR).mkdir(parents=True, exist_ok=True)

app = FastAPI(title="R-Drive Email Client", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT UNIQUE,
            sender TEXT,
            recipient TEXT,
            subject TEXT,
            date TEXT,
            text_body TEXT,
            html_body TEXT,
            raw_email TEXT,
            received_at TEXT,
            read BOOLEAN DEFAULT 0,
            starred BOOLEAN DEFAULT 0,
            archived BOOLEAN DEFAULT 0,
            folder TEXT DEFAULT 'inbox',
            source TEXT,
            has_attachments BOOLEAN DEFAULT 0,
            attachment_paths TEXT,
            thread_id TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS sent_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id TEXT,
            to_addr TEXT,
            subject TEXT,
            text_body TEXT,
            html_body TEXT,
            sent_at TEXT,
            status TEXT,
            cloudflare_response TEXT
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS contacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE,
            name TEXT,
            first_seen TEXT,
            last_seen TEXT,
            email_count INTEGER DEFAULT 0
        )
    """)
    c.execute('CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id)')
    conn.commit()
    conn.close()

init_db()

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# === WEBHOOK RECEIVER ===
class IncomingEmail(BaseModel):
    message_id: str
    from_: str = Field(..., alias="from")
    to: str
    subject: str
    date: str
    raw_email: str
    text_body: str
    html_body: str
    received_at: str
    read: bool = False
    source: str = "cloudflare_routing"

@app.post("/api/emails/receive")
async def receive_email(email: IncomingEmail, request: Request):
    secret = request.headers.get("X-Email-Secret")
    if secret != WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid secret")

    conn = get_db()
    c = conn.cursor()

    clean_subject = email.subject
    for prefix in ['Re: ', 'RE: ', 'Fwd: ', 'FWD: ', 'Fw: ']:
        if clean_subject.startswith(prefix):
            clean_subject = clean_subject[len(prefix):]
    thread_id = hashlib.md5(clean_subject.encode()).hexdigest()[:16]

    try:
        c.execute("""
            INSERT INTO emails
            (message_id, sender, recipient, subject, date, text_body, html_body,
             raw_email, received_at, read, folder, source, thread_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            email.message_id, email.from_, email.to, email.subject, email.date,
            email.text_body, email.html_body, email.raw_email, email.received_at,
            False, 'inbox', email.source, thread_id
        ))
        c.execute("""
            INSERT INTO contacts (email, name, first_seen, last_seen, email_count)
            VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(email) DO UPDATE SET
                last_seen = excluded.last_seen,
                email_count = email_count + 1
        """, (email.from_, email.from_.split('@')[0], email.received_at, email.received_at))
        conn.commit()
        email_id = c.lastrowid
        return {"status": "received", "id": email_id, "thread_id": thread_id}
    except sqlite3.IntegrityError:
        return {"status": "duplicate", "message": "Email already exists"}
    finally:
        conn.close()

# === INBOX API ===
@app.get("/api/emails")
async def get_emails(
    folder: str = "inbox",
    limit: int = 50,
    offset: int = 0,
    search: Optional[str] = None,
    unread_only: bool = False
):
    conn = get_db()
    c = conn.cursor()
    query = "SELECT * FROM emails WHERE folder = ?"
    params = [folder]
    if unread_only:
        query += " AND read = 0"
    if search:
        query += " AND (subject LIKE ? OR sender LIKE ? OR text_body LIKE ?)"
        search_term = f"%{search}%"
        params.extend([search_term, search_term, search_term])
    query += " ORDER BY date DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    c.execute(query, params)
    rows = c.fetchall()
    emails = [dict(row) for row in rows]
    c.execute("SELECT COUNT(*) FROM emails WHERE folder = ? AND read = 0", (folder,))
    unread_count = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM emails WHERE folder = ?", (folder,))
    total_count = c.fetchone()[0]
    conn.close()
    return {"emails": emails, "unread_count": unread_count, "total_count": total_count, "folder": folder}

@app.get("/api/emails/{email_id}")
async def get_email(email_id: int):
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM emails WHERE id = ?", (email_id,))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Email not found")
    c.execute("UPDATE emails SET read = 1 WHERE id = ?", (email_id,))
    conn.commit()
    conn.close()
    return dict(row)

@app.patch("/api/emails/{email_id}")
async def update_email(email_id: int, updates: Dict[str, Any]):
    conn = get_db()
    c = conn.cursor()
    allowed_fields = ['read', 'starred', 'archived', 'folder']
    set_clause = []
    values = []
    for field, value in updates.items():
        if field in allowed_fields:
            set_clause.append(f"{field} = ?")
            values.append(value)
    if not set_clause:
        raise HTTPException(status_code=400, detail="No valid fields to update")
    values.append(email_id)
    c.execute(f"UPDATE emails SET {', '.join(set_clause)} WHERE id = ?", values)
    conn.commit()
    conn.close()
    return {"status": "updated"}

@app.delete("/api/emails/{email_id}")
async def delete_email(email_id: int):
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM emails WHERE id = ?", (email_id,))
    conn.commit()
    conn.close()
    return {"status": "deleted"}

# === FOLDERS ===
@app.get("/api/folders")
async def get_folders():
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        SELECT folder, COUNT(*) as count, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as unread
        FROM emails GROUP BY folder
    """)
    folders = [dict(row) for row in c.fetchall()]
    conn.close()
    default_folders = ['inbox', 'sent', 'starred', 'archive', 'trash']
    folder_map = {f['folder']: f for f in folders}
    result = []
    for f in default_folders:
        if f in folder_map:
            result.append(folder_map[f])
        else:
            result.append({"folder": f, "count": 0, "unread": 0})
    return {"folders": result}

# === CONTACTS ===
@app.get("/api/contacts")
async def get_contacts():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM contacts ORDER BY email_count DESC")
    contacts = [dict(row) for row in c.fetchall()]
    conn.close()
    return {"contacts": contacts}

# === SEND EMAIL ===
class SendEmailRequest(BaseModel):
    to: str
    subject: str
    text: Optional[str] = None
    html: Optional[str] = None
    from_name: Optional[str] = "R-Drive Mail"

@app.post("/api/emails/send")
async def send_email(req: SendEmailRequest):
    if not CLOUDFLARE_API_TOKEN or not CLOUDFLARE_ACCOUNT_ID:
        raise HTTPException(status_code=500, detail="Cloudflare API not configured")
    from_addr = f"noreply@{SENDER_DOMAIN}"
    payload = {
        "to": req.to,
        "from": {"email": from_addr, "name": req.from_name},
        "subject": req.subject,
        "text": req.text or "",
        "html": req.html or f"<p>{req.text or ''}</p>"
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/email/sending/send",
            headers={
                "Authorization": f"Bearer {CLOUDFLARE_API_TOKEN}",
                "Content-Type": "application/json"
            },
            json=payload
        )
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO sent_emails (message_id, to_addr, subject, text_body, html_body, sent_at, status, cloudflare_response)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        f"sent_{datetime.now().timestamp()}", req.to, req.subject, req.text, req.html,
        datetime.now().isoformat(),
        "sent" if response.status_code == 200 else "failed",
        response.text
    ))
    conn.commit()
    conn.close()
    if response.status_code != 200:
        raise HTTPException(status_code=500, detail=f"Failed to send: {response.text}")
    return {"status": "sent", "to": req.to}

# === STATS ===
@app.get("/api/stats")
async def get_stats():
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM emails")
    total = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM emails WHERE read = 0")
    unread = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM emails WHERE received_at > datetime('now', '-7 days')")
    last_7 = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM contacts")
    contacts = c.fetchone()[0]
    conn.close()
    return {
        "total_emails": total,
        "unread_emails": unread,
        "emails_last_7_days": last_7,
        "total_contacts": contacts,
        "storage_path": DB_PATH
    }

# === HEALTH ===
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "storage": DB_PATH,
        "attachments": ATTACHMENTS_DIR,
        "timestamp": datetime.now().isoformat()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
