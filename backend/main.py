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
from fastapi.staticfiles import StaticFiles
from email.utils import parseaddr
import sqlite3
import json
import hashlib
import asyncio
import httpx

import os
import html as html_escape
import re
import json as _json

# --- ORB Service Discovery ---

def discover_orb_service():
    # 1. Try mesh/service_registry.json (canonical substrate location)
    mesh_path = Path("R:/R_Drive_Substrate/mesh/service_registry.json")
    if mesh_path.exists():
        try:
            with open(mesh_path, "r", encoding="utf-8") as f:
                data = _json.load(f)
            orb = data.get("services", {}).get("desktop_orb", {})
            api_url = orb.get("api_url")
            health = orb.get("health")
            if api_url:
                health_url = api_url.rstrip("/") + (health if health and health.startswith("/") else "/readiness")
                return (api_url, health_url)
        except Exception:
            pass
    # 2. Try local service_registry.json (legacy fallback)
    registry_path = Path(__file__).parent.parent / "service_registry.json"
    if registry_path.exists():
        try:
            with open(registry_path, "r", encoding="utf-8") as f:
                data = _json.load(f)
            for svc in data.get("services", []):
                if svc.get("name", "").lower() == "desktop_orb":
                    return (
                        svc.get("api_url", "http://127.0.0.1:21100/api/v1"),
                        svc.get("health_url", "http://127.0.0.1:21100/api/v1/readiness")
                    )
        except Exception:
            pass
    # 3. Fallback to env
    return (
        os.getenv("ORB_API_URL", "http://127.0.0.1:21100/api/v1"),
        os.getenv("ORB_HEALTH_URL", "http://127.0.0.1:21100/api/v1/readiness")
    )

# Use discovered ORB URLs
ORB_API_URL, ORB_HEALTH_URL = discover_orb_service()

try:
    import bleach
except ImportError:
    bleach = None

def _load_local_env() -> None:
    """Load backend/.env into process env when launching with plain python main.py."""
    env_path = Path(__file__).resolve().parent / ".env"
    if not env_path.exists():
        return

    try:
        for raw_line in env_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and os.getenv(key) is None:
                os.environ[key] = value
    except Exception:
        # If .env parsing fails, keep default environment behavior.
        return

_load_local_env()

# Support DATABASE_URL while keeping EMAIL_DB_PATH backward compatibility.
def _resolve_db_path() -> str:
    database_url = str(os.getenv("DATABASE_URL", "")).strip()
    if database_url.lower().startswith("sqlite:///"):
        return database_url[len("sqlite:///"):]
    shared = str(os.getenv("CALI_DB_PATH", "R:/R_Drive_Substrate/crm/memory/cali_personal.db")).strip()
    return os.getenv("EMAIL_DB_PATH", shared)

# === CONFIGURATION ===
DB_PATH = _resolve_db_path()
CONTACTS_DB_PATH = str(os.getenv("CALI_DB_PATH", "R:/R_Drive_Substrate/crm/memory/cali_personal.db")).strip()
ATTACHMENTS_DIR = os.getenv("EMAIL_ATTACHMENTS_DIR", "R:/email_client/attachments")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "your-secret-key-here")
CLOUDFLARE_API_TOKEN = os.getenv("CF_API_TOKEN", "")
CLOUDFLARE_API_EMAIL = os.getenv("CF_API_EMAIL", "")
CLOUDFLARE_API_KEY = os.getenv("CF_API_KEY", "")
CLOUDFLARE_ACCOUNT_ID = os.getenv("CF_ACCOUNT_ID", "")
SENDER_DOMAIN = os.getenv("SENDER_DOMAIN", "yourdomain.com")
SENDER_LOCAL_PART = os.getenv("SENDER_LOCAL_PART", "noreply").strip() or "noreply"
DEFAULT_EMAIL_ACCOUNTS = [
    "bryan@spruked.com",
    "info@spruked.com",
    "bryan@truemarkmint.com",
    "info@truemarkmint.com",
    "bryan@certsig.com",
    "info@certsig.com",
    "bryan@alphacertsig.com",
    "info@alphacertsig.com",
]
EMAIL_ACCOUNTS_RAW = os.getenv("EMAIL_ACCOUNTS", ",".join(DEFAULT_EMAIL_ACCOUNTS))
PORT = int(os.getenv("PORT", "19000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "")
FRONTEND_BUILD_DIR = Path(os.getenv(
    "FRONTEND_BUILD_DIR",
    str(Path(__file__).resolve().parent.parent / "frontend" / "build")
))
CRM_API_URL = os.getenv("CALI_API_URL", os.getenv("CALI_CRM_API_URL", "http://127.0.0.1:21000")).rstrip("/")
CRM_ROOT = Path(os.getenv("CALI_CRM_PROJECT_ROOT", "R:/SPRUKED_CRM_MASTER_2026-05-05"))
# (Removed: now handled by discover_orb_service)
ORB_ROOT = Path(os.getenv("ORB_DESKTOP_ROOT", "R:/Orb_Assistant_Desktop"))
ADMIN_ACCESS_TOKEN = os.getenv("CALI_ADMIN_TOKEN", os.getenv("ADMIN_ACCESS_TOKEN", "")).strip()

Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
Path(CONTACTS_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
Path(ATTACHMENTS_DIR).mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Pro Prime Series Mail", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in CORS_ORIGINS.split(",") if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def sanitize_html(html: Optional[str]) -> str:
    if not html:
        return ""
    if bleach is None:
        return html

    allowed_tags = list(set(bleach.sanitizer.ALLOWED_TAGS).union({
        "p", "br", "div", "span", "blockquote", "pre", "code", "img"
    }))
    allowed_attrs = {
        "a": ["href", "title", "target", "rel"],
        "img": ["src", "alt", "title"],
        "*": ["class"]
    }
    return bleach.clean(html, tags=allowed_tags, attributes=allowed_attrs, strip=True)

def build_sender_address() -> str:
    return f"{SENDER_LOCAL_PART}@{SENDER_DOMAIN}"

def normalize_email(value: Optional[str]) -> str:
    if not value:
        return ""
    _, address = parseaddr(value)
    return (address or value).strip().lower()

def configured_accounts() -> List[Dict[str, str]]:
    seen = set()
    accounts = []
    for raw_account in EMAIL_ACCOUNTS_RAW.split(","):
        email = normalize_email(raw_account)
        if not email or "@" not in email or email in seen:
            continue
        seen.add(email)
        local_part, domain = email.split("@", 1)
        accounts.append({
            "email": email,
            "local_part": local_part,
            "domain": domain,
            "label": email
        })
    return accounts

ACCOUNTS = configured_accounts()
ACCOUNT_EMAILS = {account["email"] for account in ACCOUNTS}
EMAIL_ID_FIELD = "id"
SENT_ID_FIELD = "id"
CONTACTS_HAS_EMAIL_COUNT = True
FTS_LINK_FIELD = "email_id"
CONTACT_COLUMNS: set[str] = set()

def default_account_address() -> str:
    if ACCOUNTS:
        return ACCOUNTS[0]["email"]
    return build_sender_address()

def require_configured_account(account: Optional[str]) -> Optional[str]:
    if not account or account == "all":
        return None
    normalized = normalize_email(account)
    if normalized not in ACCOUNT_EMAILS:
        raise HTTPException(status_code=400, detail="Unknown email account")
    return normalized

def text_to_html(text: str) -> str:
    escaped = html_escape.escape(text or "").replace("\n", "<br>")
    return f"<p>{escaped}</p>"

def cloudflare_headers() -> Dict[str, str]:
    token = CLOUDFLARE_API_TOKEN.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if token:
        return {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
    if CLOUDFLARE_API_EMAIL and CLOUDFLARE_API_KEY:
        return {
            "X-Auth-Email": CLOUDFLARE_API_EMAIL,
            "X-Auth-Key": CLOUDFLARE_API_KEY,
            "Content-Type": "application/json"
        }
    return {"Content-Type": "application/json"}

def cloudflare_error_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return response.text

    errors = body.get("errors") or []
    if errors:
        return "; ".join(
            f"{err.get('code', 'unknown')}: {err.get('message', 'Unknown Cloudflare error')}"
            for err in errors
        )
    return json.dumps(body)

def clean_thread_subject(subject: Optional[str]) -> str:
    clean_subject = subject or ""
    changed = True
    while changed:
        changed = False
        for prefix in ['Re: ', 'RE: ', 'Fwd: ', 'FWD: ', 'Fw: ', 'FW: ']:
            if clean_subject.startswith(prefix):
                clean_subject = clean_subject[len(prefix):]
                changed = True
    return clean_subject.strip().lower()

def build_thread_id(subject: Optional[str], references: Optional[str] = None, in_reply_to: Optional[str] = None) -> str:
    thread_basis = references or in_reply_to or clean_thread_subject(subject) or "no-subject"
    return hashlib.md5(thread_basis.encode()).hexdigest()[:16]

async def external_json_request(
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    params: Optional[Dict[str, Any]] = None,
    json_body: Optional[Dict[str, Any]] = None,
    timeout: float = 12.0
) -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.request(
                method.upper(),
                url,
                headers=headers or {},
                params=params,
                json=json_body
            )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Integration request failed: {exc}") from exc

    try:
        payload = response.json()
    except ValueError:
        payload = {"raw": response.text}

    if response.status_code >= 400:
        detail = payload.get("detail") or payload.get("message") or payload.get("error") or response.text
        raise HTTPException(status_code=response.status_code, detail=detail)
    return payload if isinstance(payload, dict) else {"data": payload}

def crm_headers() -> Dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if ADMIN_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {ADMIN_ACCESS_TOKEN}"
    return headers

def fts_query(search: str, scope: str) -> str:
    phrase = re.sub(r'\s+', ' ', search or '').strip().replace('"', '""')
    if not phrase:
        return '""'
    scope_columns = {
        "sender": ["sender"],
        "subject": ["subject"],
        "body": ["text_body", "html_body", "raw_email"],
        "all": ["sender", "recipient", "subject", "text_body", "html_body", "raw_email"],
    }
    columns = scope_columns.get(scope, scope_columns["all"])
    return " OR ".join(f'{column}:"{phrase}"' for column in columns)

def upsert_contact(cursor: sqlite3.Cursor, email: str, name: str, timestamp: str) -> None:
    cursor.execute("PRAGMA table_info(contacts)")
    active_columns = {row[1] for row in cursor.fetchall()}
    if not active_columns:
        return
    if {"first_seen", "last_seen", "email_count"}.issubset(active_columns):
        cursor.execute("""
            INSERT INTO contacts (email, name, first_seen, last_seen, email_count)
            VALUES (?, ?, ?, ?, 1)
            ON CONFLICT(email) DO UPDATE SET
                last_seen = excluded.last_seen,
                email_count = email_count + 1
        """, (email, name, timestamp, timestamp))
        return
    if "created_at" in active_columns and "updated_at" in active_columns:
        cursor.execute("""
            INSERT INTO contacts (email, name, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
                name = excluded.name,
                updated_at = excluded.updated_at
        """, (email, name, timestamp, timestamp))
        return
    cursor.execute("""
        INSERT INTO contacts (email, name)
        VALUES (?, ?)
        ON CONFLICT(email) DO UPDATE SET
            name = excluded.name
    """, (email, name))


def _make_contact_ids(name: str, email: str, phone: Optional[str]) -> tuple[str, str]:
    seed = f"{name}|{email}|{phone or ''}|{datetime.utcnow().isoformat()}"
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    return f"contact_{digest[:16]}", digest[:16]


def _is_crm_shared_contacts_schema() -> bool:
    return "hash_id" in CONTACT_COLUMNS and "crm_stage" in CONTACT_COLUMNS and "lead_source" in CONTACT_COLUMNS


def _contact_columns(cursor: sqlite3.Cursor) -> set[str]:
    cursor.execute("PRAGMA table_info(contacts)")
    return {row[1] for row in cursor.fetchall()}

def sync_email_fts(cursor: sqlite3.Cursor, email_id: int, email: Any) -> None:
    if FTS_LINK_FIELD == "email_id":
        cursor.execute("""
            INSERT INTO emails_fts (email_id, sender, recipient, subject, text_body, html_body, raw_email)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            email_id,
            email.from_,
            email.to,
            email.subject,
            email.text_body,
            sanitize_html(email.html_body),
            email.raw_email
        ))
    else:
        cursor.execute("""
            INSERT INTO emails_fts (message_id, sender, recipient, subject, text_body, html_body, raw_email)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            email.message_id,
            email.from_,
            email.to,
            email.subject,
            email.text_body,
            sanitize_html(email.html_body),
            email.raw_email
        ))

def init_db():
    global EMAIL_ID_FIELD, SENT_ID_FIELD, CONTACTS_HAS_EMAIL_COUNT, FTS_LINK_FIELD, CONTACT_COLUMNS
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
            from_addr TEXT,
            to_addr TEXT,
            subject TEXT,
            text_body TEXT,
            html_body TEXT,
            sent_at TEXT,
            status TEXT,
            cloudflare_response TEXT
        )
    """)
    c.execute("PRAGMA table_info(sent_emails)")
    sent_columns = {row[1] for row in c.fetchall()}
    if "from_addr" not in sent_columns:
        c.execute("ALTER TABLE sent_emails ADD COLUMN from_addr TEXT")
    c.execute("UPDATE sent_emails SET from_addr = ? WHERE from_addr IS NULL OR from_addr = ''", (default_account_address(),))
    c.execute("PRAGMA table_info(contacts)")
    CONTACT_COLUMNS = {row[1] for row in c.fetchall()}
    if not CONTACT_COLUMNS:
        c.execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE,
                name TEXT,
                phone TEXT,
                address TEXT,
                photo TEXT,
                extra TEXT,
                first_seen TEXT,
                last_seen TEXT,
                email_count INTEGER DEFAULT 0
            )
        """)
        CONTACT_COLUMNS = {"id", "email", "name", "phone", "address", "photo", "extra", "first_seen", "last_seen", "email_count"}
    CONTACTS_HAS_EMAIL_COUNT = "email_count" in CONTACT_COLUMNS
    c.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
            email_id UNINDEXED,
            sender,
            recipient,
            subject,
            text_body,
            html_body,
            raw_email
        )
    """)
    c.execute("""
        CREATE TABLE IF NOT EXISTS drafts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account TEXT NOT NULL,
            to_addr TEXT DEFAULT '',
            subject TEXT DEFAULT '',
            text_body TEXT DEFAULT '',
            html_body TEXT DEFAULT '',
            updated_at TEXT NOT NULL,
            UNIQUE(account)
        )
    """)
    c.execute('CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_emails_recipient ON emails(recipient)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_sent_from ON sent_emails(from_addr)')
    c.execute("PRAGMA table_info(emails)")
    email_columns = {row[1] for row in c.fetchall()}
    EMAIL_ID_FIELD = "id" if "id" in email_columns else "rowid"
    SENT_ID_FIELD = "id" if "id" in sent_columns else "rowid"
    c.execute("PRAGMA table_info(emails_fts)")
    fts_columns = {row[1] for row in c.fetchall()}
    FTS_LINK_FIELD = "message_id" if "message_id" in fts_columns else "email_id"
    c.execute("SELECT COUNT(*) FROM emails_fts")
    fts_count = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM emails")
    email_count = c.fetchone()[0]
    if email_count and not fts_count and EMAIL_ID_FIELD == "id":
        c.execute("""
            INSERT INTO emails_fts (email_id, sender, recipient, subject, text_body, html_body, raw_email)
            SELECT id, sender, recipient, subject, text_body, html_body, raw_email FROM emails
        """)
    conn.commit()
    conn.close()

init_db()

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def get_contacts_db():
    conn = sqlite3.connect(CONTACTS_DB_PATH)
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

    thread_id = build_thread_id(
        email.subject,
        references=None,
        in_reply_to=None
    )

    try:
        c.execute("""
            INSERT INTO emails
            (message_id, sender, recipient, subject, date, text_body, html_body,
             raw_email, received_at, read, folder, source, thread_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            email.message_id, email.from_, email.to, email.subject, email.date,
            email.text_body, sanitize_html(email.html_body), email.raw_email, email.received_at,
            False, 'inbox', email.source, thread_id
        ))
        contact_conn = get_contacts_db()
        try:
            contact_cursor = contact_conn.cursor()
            upsert_contact(contact_cursor, email.from_, email.from_.split('@')[0], email.received_at)
            contact_conn.commit()
        finally:
            contact_conn.close()
        conn.commit()
        email_id = c.lastrowid
        sync_email_fts(c, email_id, email)
        conn.commit()
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
    search_scope: str = "all",
    unread_only: bool = False,
    account: Optional[str] = None,
    threaded: bool = False
):
    conn = get_db()
    c = conn.cursor()
    selected_account = require_configured_account(account)

    if folder == "sent":
        default_sender = default_account_address()
        sent_id_select = "id" if SENT_ID_FIELD == "id" else "rowid"
        query = """
            SELECT
                'sent_' || {sent_id_select} AS id,
                message_id,
                COALESCE(from_addr, ?) AS sender,
                to_addr AS recipient,
                subject,
                sent_at AS date,
                text_body,
                html_body,
                status,
                '' AS raw_email,
                sent_at AS received_at,
                1 AS read,
                0 AS starred,
                0 AS archived,
                'sent' AS folder,
                'local_send' AS source,
                0 AS has_attachments,
                NULL AS attachment_paths,
                NULL AS thread_id
            FROM sent_emails
            WHERE 1 = 1
        """.format(sent_id_select=sent_id_select)
        params = [default_sender]
        count_query = "SELECT COUNT(*) FROM sent_emails WHERE 1 = 1"
        count_params = []

        if selected_account:
            query += " AND lower(COALESCE(from_addr, ?)) = ?"
            params.extend([default_sender, selected_account])
            count_query += " AND lower(COALESCE(from_addr, ?)) = ?"
            count_params.extend([default_sender, selected_account])

        if search:
            search_term = f"%{search}%"
            query += " AND (subject LIKE ? OR to_addr LIKE ? OR text_body LIKE ?)"
            params.extend([search_term, search_term, search_term])
            count_query += " AND (subject LIKE ? OR to_addr LIKE ? OR text_body LIKE ?)"
            count_params.extend([search_term, search_term, search_term])

        query += " ORDER BY sent_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        c.execute(query, params)
        rows = c.fetchall()
        emails = [dict(row) for row in rows]

        c.execute(count_query, count_params)
        total_count = c.fetchone()[0]

        conn.close()
        return {"emails": emails, "unread_count": 0, "total_count": total_count, "folder": folder}

    email_id_expr = "emails.id" if EMAIL_ID_FIELD == "id" else "emails.rowid"
    select_clause = f"SELECT emails.*, {email_id_expr} AS id FROM emails"
    where_clauses = []
    params = []
    if folder == "starred":
        where_clauses.append("emails.starred = 1")
    else:
        where_clauses.append("emails.folder = ?")
        params.append(folder)
    if selected_account:
        where_clauses.append("lower(emails.recipient) LIKE ?")
        account_term = f"%{selected_account}%"
        params.append(account_term)
    if unread_only:
        where_clauses.append("emails.read = 0")
    if search:
        if FTS_LINK_FIELD == "email_id":
            join_clause = f" JOIN emails_fts ON emails_fts.email_id = {email_id_expr}"
        else:
            join_clause = " JOIN emails_fts ON emails_fts.message_id = emails.message_id"
        select_clause += join_clause
        where_clauses.append("emails_fts MATCH ?")
        params.append(fts_query(search, search_scope))

    where_sql = " AND ".join(where_clauses)
    query = f"{select_clause} WHERE {where_sql} ORDER BY emails.date DESC LIMIT ? OFFSET ?"
    c.execute(query, params + [limit, offset])
    rows = c.fetchall()
    emails = [dict(row) for row in rows]

    count_query = f"SELECT COUNT(*) FROM ({select_clause} WHERE {where_sql})"
    c.execute(count_query, params)
    total_count = c.fetchone()[0]

    unread_query = f"SELECT COUNT(*) FROM ({select_clause} WHERE {where_sql} AND emails.read = 0)"
    c.execute(unread_query, params)
    unread_count = c.fetchone()[0]
    conn.close()
    if threaded:
        thread_map = {}
        for email_row in emails:
            thread_id = email_row.get("thread_id") or build_thread_id(email_row.get("subject"))
            existing = thread_map.get(thread_id)
            if not existing:
                email_row["thread_count"] = 1
                thread_map[thread_id] = email_row
            else:
                existing["thread_count"] += 1
        emails = list(thread_map.values())
    return {"emails": emails, "unread_count": unread_count, "total_count": total_count, "folder": folder}

@app.get("/api/emails/{email_id}")
async def get_email(email_id: str):
    conn = get_db()
    c = conn.cursor()

    if email_id.startswith("sent_"):
        sent_id = email_id.replace("sent_", "", 1)
        if not sent_id.isdigit():
            raise HTTPException(status_code=400, detail="Invalid email id")
        sent_id_column = "id" if SENT_ID_FIELD == "id" else "rowid"

        c.execute(f"""
            SELECT
                {sent_id_column} AS sid,
                message_id,
                from_addr,
                to_addr,
                subject,
                text_body,
                html_body,
                sent_at,
                status
            FROM sent_emails
            WHERE {sent_id_column} = ?
        """, (int(sent_id),))
        row = c.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Email not found")

        conn.close()
        return {
            "id": f"sent_{row['sid']}",
            "message_id": row["message_id"],
            "sender": row["from_addr"] or default_account_address(),
            "recipient": row["to_addr"],
            "subject": row["subject"],
            "date": row["sent_at"],
            "text_body": row["text_body"],
            "html_body": row["html_body"],
            "raw_email": "",
            "received_at": row["sent_at"],
            "read": True,
            "starred": False,
            "archived": False,
            "folder": "sent",
            "source": "local_send",
            "has_attachments": False,
            "attachment_paths": None,
            "thread_id": None,
            "status": row["status"]
        }

    if not email_id.isdigit():
        raise HTTPException(status_code=400, detail="Invalid email id")
    email_id_column = "id" if EMAIL_ID_FIELD == "id" else "rowid"
    c.execute(f"SELECT *, {email_id_column} AS id FROM emails WHERE {email_id_column} = ?", (email_id,))
    row = c.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Email not found")
    c.execute(f"UPDATE emails SET read = 1 WHERE {email_id_column} = ?", (email_id,))
    conn.commit()
    conn.close()
    return dict(row)

@app.patch("/api/emails/{email_id}")
async def update_email(email_id: str, updates: Dict[str, Any]):
    if email_id.startswith("sent_"):
        raise HTTPException(status_code=400, detail="Sent messages cannot be updated")
    if not email_id.isdigit():
        raise HTTPException(status_code=400, detail="Invalid email id")

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
    email_id_column = "id" if EMAIL_ID_FIELD == "id" else "rowid"
    values.append(email_id)
    c.execute(f"UPDATE emails SET {', '.join(set_clause)} WHERE {email_id_column} = ?", values)
    conn.commit()
    conn.close()
    return {"status": "updated"}

@app.delete("/api/emails/{email_id}")
async def delete_email(email_id: str):
    conn = get_db()
    c = conn.cursor()

    if email_id.startswith("sent_"):
        sent_id = email_id.replace("sent_", "", 1)
        if not sent_id.isdigit():
            raise HTTPException(status_code=400, detail="Invalid email id")
        sent_id_column = "id" if SENT_ID_FIELD == "id" else "rowid"
        c.execute(f"DELETE FROM sent_emails WHERE {sent_id_column} = ?", (int(sent_id),))
    else:
        if not email_id.isdigit():
            raise HTTPException(status_code=400, detail="Invalid email id")
        email_id_column = "id" if EMAIL_ID_FIELD == "id" else "rowid"
        c.execute(f"DELETE FROM emails WHERE {email_id_column} = ?", (email_id,))

    conn.commit()
    conn.close()
    return {"status": "deleted"}

# === FOLDERS ===
@app.get("/api/folders")
async def get_folders(account: Optional[str] = None):
    conn = get_db()
    c = conn.cursor()
    selected_account = require_configured_account(account)
    folder_where = ""
    folder_params = []
    if selected_account:
        folder_where = "WHERE lower(recipient) LIKE ?"
        folder_params.append(f"%{selected_account}%")
    c.execute(f"""
        SELECT folder, COUNT(*) as count, SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) as unread
        FROM emails {folder_where} GROUP BY folder
    """, folder_params)
    folders = [dict(row) for row in c.fetchall()]
    starred_query = "SELECT COUNT(*), SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) FROM emails WHERE starred = 1"
    starred_params = []
    if selected_account:
        starred_query += " AND lower(recipient) LIKE ?"
        starred_params.append(f"%{selected_account}%")
    c.execute(starred_query, starred_params)
    starred_count, starred_unread = c.fetchone()
    folders.append({"folder": "starred", "count": starred_count or 0, "unread": starred_unread or 0})
    sent_query = "SELECT COUNT(*) FROM sent_emails"
    sent_params = []
    if selected_account:
        sent_query += " WHERE lower(COALESCE(from_addr, ?)) = ?"
        sent_params.extend([default_account_address(), selected_account])
    c.execute(sent_query, sent_params)
    sent_count = c.fetchone()[0]
    folders.append({"folder": "sent", "count": sent_count, "unread": 0})
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

@app.get("/api/accounts")
async def get_accounts():
    conn = get_db()
    c = conn.cursor()
    accounts = []
    for account in ACCOUNTS:
        term = f"%{account['email']}%"
        c.execute("SELECT COUNT(*) FROM emails WHERE folder = 'inbox' AND lower(recipient) LIKE ?", (term,))
        inbox_count = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM emails WHERE folder = 'inbox' AND read = 0 AND lower(recipient) LIKE ?", (term,))
        unread_count = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM sent_emails WHERE lower(COALESCE(from_addr, ?)) = ?", (default_account_address(), account["email"]))
        sent_count = c.fetchone()[0]
        accounts.append({
            **account,
            "inbox_count": inbox_count,
            "unread_count": unread_count,
            "sent_count": sent_count
        })
    conn.close()
    return {"accounts": accounts, "default_account": default_account_address()}

# === CONTACTS ===
class ContactRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    photo: Optional[str] = None  # URL or base64
    extra: Optional[dict] = None  # Arbitrary extra fields
    contact_type: str = "marketing"
    crm_stage: Optional[str] = "prospect"
    sync_crm: bool = True

async def sync_contact_to_crm(email: str, name: str, contact_type: str = "marketing", crm_stage: Optional[str] = "prospect") -> Dict[str, Any]:
    return {"status": "skipped", "reason": "substrate_db_mode"}

@app.get("/api/contacts")
async def get_contacts():
    conn = get_contacts_db()
    c = conn.cursor()
    active_columns = _contact_columns(c)
    if "email_count" in active_columns:
        c.execute("SELECT * FROM contacts ORDER BY email_count DESC")
    elif "updated_at" in active_columns:
        c.execute("SELECT * FROM contacts ORDER BY updated_at DESC, name ASC")
    else:
        c.execute("SELECT * FROM contacts ORDER BY name ASC")
    contacts = [dict(row) for row in c.fetchall()]
    conn.close()
    return {"contacts": contacts}

@app.post("/api/contacts")
async def create_contact(contact: ContactRequest):
    email = normalize_email(contact.email) if contact.email else None
    name = (contact.name or (email.split("@", 1)[0] if email else "")).strip()
    phone = (contact.phone or "").strip() or None
    address = (contact.address or "").strip() or None
    photo = (contact.photo or "").strip() or None
    extra = contact.extra or None
    if not (email or name):
        raise HTTPException(status_code=400, detail="Contact must have at least a name or email")
    now = datetime.now().isoformat()
    conn = get_contacts_db()
    c = conn.cursor()
    active_columns = _contact_columns(c)
    # Upsert logic for new fields
    if not active_columns:
        conn.close()
        raise HTTPException(status_code=500, detail="Contact columns not initialized")
    if {"hash_id", "crm_stage", "lead_source"}.issubset(active_columns):
        owner = default_account_address()
        found = None
        if email:
            c.execute("SELECT * FROM contacts WHERE lower(email) = ? LIMIT 1", (email,))
            found = c.fetchone()
        if not found:
            c.execute("SELECT * FROM contacts WHERE name = ? AND phone IS ? AND address IS ? LIMIT 1", (name, phone, address))
            found = c.fetchone()
        if found:
            existing = dict(found)
            c.execute(
                """
                UPDATE contacts
                SET
                    name = COALESCE(?, name),
                    phone = COALESCE(?, phone),
                    email = COALESCE(?, email),
                    address = COALESCE(?, address),
                    type = COALESCE(?, type),
                    crm_stage = COALESCE(?, crm_stage),
                    lead_source = COALESCE(?, lead_source),
                    owner = COALESCE(?, owner),
                    notes = COALESCE(?, notes),
                    updated_at = ?
                WHERE id = ?
                """,
                (
                    name or None,
                    phone,
                    email,
                    address,
                    contact.contact_type or "marketing",
                    contact.crm_stage or "prospect",
                    "spruk_email",
                    owner,
                    "Updated from Prime Mail contacts.",
                    now,
                    existing["id"],
                ),
            )
            contact_id = existing["id"]
        else:
            contact_id, hash_id = _make_contact_ids(name or (email or "contact"), email or "", phone)
            c.execute(
                """
                INSERT INTO contacts (
                    id, hash_id, name, type, phone, email, address, notes, priority,
                    crm_stage, lead_source, owner, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    contact_id,
                    hash_id,
                    name or (email or "Email Contact"),
                    contact.contact_type or "marketing",
                    phone,
                    email,
                    address,
                    "Created from Prime Mail contacts.",
                    1,
                    contact.crm_stage or "prospect",
                    "spruk_email",
                    owner,
                    now,
                    now,
                ),
            )
    elif {"first_seen", "last_seen", "email_count", "phone", "address", "photo", "extra"}.issubset(active_columns):
        c.execute("""
            INSERT INTO contacts (email, name, phone, address, photo, extra, first_seen, last_seen, email_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(email) DO UPDATE SET
                name = excluded.name,
                phone = excluded.phone,
                address = excluded.address,
                photo = excluded.photo,
                extra = excluded.extra,
                last_seen = excluded.last_seen,
                email_count = email_count + 1
        """, (email, name, phone, address, photo, json.dumps(extra) if extra else None, now, now))
    else:
        c.execute("""
            INSERT INTO contacts (email, name, phone, address, photo, extra)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET
                name = excluded.name,
                phone = excluded.phone,
                address = excluded.address,
                photo = excluded.photo,
                extra = excluded.extra
        """, (email, name, phone, address, photo, json.dumps(extra) if extra else None))
    conn.commit()
    # Fetch by email if present, else by name/phone/address
    if email:
        c.execute("SELECT * FROM contacts WHERE email = ?", (email,))
    else:
        c.execute("SELECT * FROM contacts WHERE name = ? AND phone IS ? AND address IS ?", (name, phone, address))
    row = c.fetchone()
    saved = dict(row) if row else {}
    # Parse extra JSON if present
    if saved.get('extra'):
        try:
            saved['extra'] = json.loads(saved['extra'])
        except Exception:
            saved['extra'] = None
    conn.close()
    crm_sync = await sync_contact_to_crm(email, name, contact.contact_type, contact.crm_stage) if (contact.sync_crm and email) else {"status": "skipped"}
    return {"status": "saved", "contact": saved, "crm_sync": crm_sync}

@app.delete("/api/contacts/{email}")
async def delete_contact(email: str):
    normalized = normalize_email(email)
    conn = get_contacts_db()
    c = conn.cursor()
    c.execute("DELETE FROM contacts WHERE email = ?", (normalized,))
    conn.commit()
    conn.close()
    return {"status": "deleted", "email": normalized}

# === SEND EMAIL ===
class SendEmailRequest(BaseModel):
    to: str
    subject: str
    text: Optional[str] = None
    html: Optional[str] = None
    from_name: Optional[str] = "PRIME MAIL"
    from_address: Optional[str] = None

class DraftRequest(BaseModel):
    account: str
    to: Optional[str] = ""
    subject: Optional[str] = ""
    text: Optional[str] = ""
    html: Optional[str] = None

@app.post("/api/emails/send")
async def send_email(req: SendEmailRequest):
    has_token_auth = bool(CLOUDFLARE_API_TOKEN.strip())
    has_key_auth = bool(CLOUDFLARE_API_EMAIL and CLOUDFLARE_API_KEY)
    if (not has_token_auth and not has_key_auth) or not CLOUDFLARE_ACCOUNT_ID:
        raise HTTPException(status_code=500, detail="Cloudflare API not configured")
    from_addr = require_configured_account(req.from_address) or default_account_address()
    payload = {
        "to": req.to,
        "from": {"address": from_addr, "name": req.from_name},
        "subject": req.subject,
        "text": req.text or "",
        "html": sanitize_html(req.html or text_to_html(req.text or ""))
    }
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/email/sending/send",
            headers=cloudflare_headers(),
            json=payload,
            timeout=30
        )
    conn = get_db()
    c = conn.cursor()
    c.execute("""
        INSERT INTO sent_emails (message_id, from_addr, to_addr, subject, text_body, html_body, sent_at, status, cloudflare_response)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        f"sent_{datetime.now().timestamp()}", from_addr, req.to, req.subject, req.text, payload["html"],
        datetime.now().isoformat(),
        "sent" if response.status_code == 200 else "failed",
        response.text
    ))
    conn.commit()
    conn.close()
    if not 200 <= response.status_code < 300:
        raise HTTPException(status_code=response.status_code, detail=f"Failed to send: {cloudflare_error_detail(response)}")
    return {"status": "sent", "to": req.to}

@app.get("/api/drafts/{account}")
async def get_draft(account: str):
    selected_account = require_configured_account(account)
    conn = get_db()
    c = conn.cursor()
    c.execute("SELECT * FROM drafts WHERE account = ?", (selected_account,))
    row = c.fetchone()
    conn.close()
    if not row:
        return {
            "account": selected_account,
            "to": "",
            "subject": "",
            "text": "",
            "html": "",
            "updated_at": None
        }
    return {
        "account": row["account"],
        "to": row["to_addr"],
        "subject": row["subject"],
        "text": row["text_body"],
        "html": row["html_body"],
        "updated_at": row["updated_at"]
    }

@app.put("/api/drafts/{account}")
async def save_draft(account: str, draft: DraftRequest):
    selected_account = require_configured_account(account)
    if normalize_email(draft.account) != selected_account:
        raise HTTPException(status_code=400, detail="Draft account mismatch")
    conn = get_db()
    c = conn.cursor()
    updated_at = datetime.now().isoformat()
    c.execute("""
        INSERT INTO drafts (account, to_addr, subject, text_body, html_body, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(account) DO UPDATE SET
            to_addr = excluded.to_addr,
            subject = excluded.subject,
            text_body = excluded.text_body,
            html_body = excluded.html_body,
            updated_at = excluded.updated_at
    """, (selected_account, draft.to or "", draft.subject or "", draft.text or "", draft.html or "", updated_at))
    conn.commit()
    conn.close()
    return {"status": "saved", "account": selected_account, "updated_at": updated_at}

@app.delete("/api/drafts/{account}")
async def delete_draft(account: str):
    selected_account = require_configured_account(account)
    conn = get_db()
    c = conn.cursor()
    c.execute("DELETE FROM drafts WHERE account = ?", (selected_account,))
    conn.commit()
    conn.close()
    return {"status": "deleted", "account": selected_account}

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

@app.get("/api/config/email")
async def email_config_status():
    has_token_auth = bool(CLOUDFLARE_API_TOKEN.strip())
    has_key_auth = bool(CLOUDFLARE_API_EMAIL and CLOUDFLARE_API_KEY)
    return {
        "sender": default_account_address(),
        "sender_domain": SENDER_DOMAIN,
        "accounts": ACCOUNTS,
        "cloudflare_account_id_configured": bool(CLOUDFLARE_ACCOUNT_ID),
        "cloudflare_token_configured": has_token_auth,
        "cloudflare_key_auth_configured": has_key_auth,
        "outbound_auth_configured": (has_token_auth or has_key_auth) and bool(CLOUDFLARE_ACCOUNT_ID),
        "inbound_webhook_path": "/api/emails/receive"
    }

@app.get("/api/integrations/status")
async def integrations_status():
    crm_status: Dict[str, Any] = {
        "name": "Spruked CRM",
        "root": str(CRM_ROOT),
        "root_exists": CRM_ROOT.exists(),
        "api_url": CRM_API_URL,
        "token_configured": bool(ADMIN_ACCESS_TOKEN),
        "online": False,
    }
    orb_status: Dict[str, Any] = {
        "name": "Desktop ORB",
        "root": str(ORB_ROOT),
        "root_exists": ORB_ROOT.exists(),
        "api_url": ORB_API_URL,
        "health_url": ORB_HEALTH_URL,
        "online": False,
    }

    if ADMIN_ACCESS_TOKEN:
        try:
            crm_health = await external_json_request("GET", f"{CRM_API_URL}/health", headers=crm_headers(), timeout=5.0)
            crm_status.update({"online": True, "health": crm_health})
        except HTTPException as exc:
            crm_status.update({"health": {"status": "error", "detail": exc.detail}})
    else:
        crm_status["health"] = {"status": "error", "detail": "admin_token_missing"}

    try:
        orb_health = await external_json_request("GET", ORB_HEALTH_URL, timeout=5.0)
        orb_status.update({"online": True, "health": orb_health})
    except HTTPException as exc:
        orb_status.update({"health": {"status": "error", "detail": exc.detail}})

    return {
        "email_api": {
            "online": True,
            "api_url": "/api",
            "port": PORT,
            "accounts": ACCOUNTS,
        },
        "crm": crm_status,
        "orb": orb_status,
    }

@app.get("/api/integrations/crm/pipeline")
async def crm_pipeline_proxy():
    if not ADMIN_ACCESS_TOKEN:
        raise HTTPException(status_code=503, detail="CALI admin token is not configured")
    return await external_json_request("GET", f"{CRM_API_URL}/cali/crm/pipeline", headers=crm_headers())

@app.post("/api/integrations/crm/sync-email")
async def crm_sync_email(payload: Optional[Dict[str, Any]] = None):
    if not ADMIN_ACCESS_TOKEN:
        raise HTTPException(status_code=503, detail="CALI admin token is not configured")
    body = payload or {"folder": "inbox", "limit": 50, "unread_only": False}
    return await external_json_request(
        "POST",
        f"{CRM_API_URL}/cali/crm/external-email/sync",
        headers=crm_headers(),
        json_body=body
    )

class OrbQueryRequest(BaseModel):
    prompt: str
    context: Optional[Dict[str, Any]] = None

@app.post("/api/integrations/orb/query")
async def orb_query_proxy(payload: OrbQueryRequest):
    return await external_json_request(
        "POST",
        f"{ORB_API_URL}/tribunal",
        json_body={"prompt": payload.prompt, "context": payload.context or {}},
        timeout=30.0
    )

if FRONTEND_BUILD_DIR.exists():
    static_dir = FRONTEND_BUILD_DIR / "static"
    if static_dir.exists():
        app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

    @app.get("/")
    async def serve_frontend_root():
        return FileResponse(FRONTEND_BUILD_DIR / "index.html")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        target = FRONTEND_BUILD_DIR / full_path
        if target.exists() and target.is_file():
            return FileResponse(target)
        return FileResponse(FRONTEND_BUILD_DIR / "index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
