from __future__ import annotations

import hashlib
import os
import re
import sqlite3
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import main as legacy

router = APIRouter(prefix="/api/registry", tags=["prime-mail-registry"])

STANDARD_FOLDERS = ["inbox", "sent", "drafts", "starred", "archive", "spam", "trash"]
KNOWN_BUSINESS_DOMAINS = {
    "spruked.com": "spruked",
    "truemarkmint.com": "truemark_mint",
    "certsig.com": "certsig",
    "alphacertsig.com": "alpha_certsig",
}
DEFAULT_PRIMARY_ACCOUNT = "bryan@spruked.com"


def _primary_account() -> str:
    configured = legacy.normalize_email(os.getenv("PRIMARY_EMAIL_ACCOUNT", DEFAULT_PRIMARY_ACCOUNT))
    return configured or DEFAULT_PRIMARY_ACCOUNT


def _stable_id(prefix: str, *parts: str) -> str:
    raw = "|".join(str(part or "") for part in parts)
    return f"{prefix}:{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]}"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(legacy.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _normalize_domain(value: str) -> str:
    domain = str(value or "").strip().lower()
    domain = re.sub(r"^https?://", "", domain).split("/", 1)[0].strip(".")
    if not domain or "." not in domain or "@" in domain:
        raise HTTPException(status_code=400, detail="Invalid mail domain")
    return domain


def _normalize_folder(value: str) -> str:
    name = " ".join(str(value or "").strip().split())
    if not name:
        raise HTTPException(status_code=400, detail="Folder name is required")
    if len(name) > 80:
        raise HTTPException(status_code=400, detail="Folder name is too long")
    return name


def ensure_registry_schema() -> None:
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS mail_domain (
              domain_id TEXT PRIMARY KEY,
              domain TEXT NOT NULL UNIQUE,
              business_scope TEXT,
              status TEXT NOT NULL DEFAULT 'active'
            );

            CREATE TABLE IF NOT EXISTS mail_account (
              account_id TEXT PRIMARY KEY,
              domain_id TEXT NOT NULL REFERENCES mail_domain(domain_id),
              local_part TEXT NOT NULL,
              display_name TEXT,
              config_ref TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'active',
              UNIQUE (domain_id, local_part)
            );

            CREATE TABLE IF NOT EXISTS mailbox (
              mailbox_id TEXT PRIMARY KEY,
              account_id TEXT NOT NULL REFERENCES mail_account(account_id),
              name TEXT NOT NULL,
              mailbox_type TEXT NOT NULL DEFAULT 'standard',
              uidvalidity TEXT,
              business_scope TEXT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS ux_mailbox_account_name
              ON mailbox(account_id, name);
            CREATE INDEX IF NOT EXISTS ix_mailbox_account
              ON mailbox(account_id);
            """
        )
        conn.commit()


def _seed_account(conn: sqlite3.Connection, email: str, display_name: Optional[str] = None) -> None:
    normalized = legacy.normalize_email(email)
    if not normalized or "@" not in normalized:
        return
    local_part, domain = normalized.split("@", 1)
    business_scope = KNOWN_BUSINESS_DOMAINS.get(domain)
    domain_id = domain
    account_id = _stable_id("mail-account", normalized)
    conn.execute(
        """
        INSERT INTO mail_domain(domain_id, domain, business_scope, status)
        VALUES (?, ?, ?, 'active')
        ON CONFLICT(domain_id) DO UPDATE SET
          domain=excluded.domain,
          business_scope=COALESCE(mail_domain.business_scope, excluded.business_scope),
          status='active'
        """,
        (domain_id, domain, business_scope),
    )
    conn.execute(
        """
        INSERT INTO mail_account(account_id, domain_id, local_part, display_name, config_ref, status)
        VALUES (?, ?, ?, ?, 'legacy-or-cloudflare-config', 'active')
        ON CONFLICT(account_id) DO UPDATE SET
          display_name=COALESCE(excluded.display_name, mail_account.display_name),
          status='active'
        """,
        (account_id, domain_id, local_part, display_name or normalized),
    )
    for folder in STANDARD_FOLDERS:
        mailbox_id = _stable_id("mailbox", account_id, folder.lower())
        conn.execute(
            """
            INSERT OR IGNORE INTO mailbox(mailbox_id, account_id, name, mailbox_type, business_scope)
            VALUES (?, ?, ?, 'standard', ?)
            """,
            (mailbox_id, account_id, folder, business_scope),
        )


def _apply_primary_account_policy(conn: sqlite3.Connection) -> None:
    """Keep the real Spruked mailbox primary while leaving future sites opt-in.

    Earlier builds seeded several planned addresses as if they were active mailboxes.
    Only legacy-scaffold rows are demoted here. An account explicitly added later via
    the registry receives a different config_ref and remains active.
    """

    primary = _primary_account()
    _seed_account(conn, primary, primary)
    conn.execute(
        """
        UPDATE mail_account
        SET status='pending'
        WHERE config_ref='legacy-or-cloudflare-config'
          AND lower(local_part || '@' || domain_id) <> ?
        """,
        (primary,),
    )
    conn.execute(
        """
        UPDATE mail_account
        SET status='active'
        WHERE lower(local_part || '@' || domain_id) = ?
        """,
        (primary,),
    )


def seed_registry_from_legacy_accounts() -> None:
    ensure_registry_schema()
    legacy_accounts = list(legacy.ACCOUNTS)
    with _connect() as conn:
        count = conn.execute("SELECT COUNT(*) FROM mail_account WHERE status='active'").fetchone()[0]
        if count == 0:
            for account in legacy_accounts:
                _seed_account(conn, str(account.get("email") or ""), str(account.get("label") or "") or None)
        _apply_primary_account_policy(conn)
        conn.commit()


def sync_legacy_account_globals() -> None:
    """Make the existing backend endpoints honor the dynamic registry.

    main.py still owns message retrieval/sending. Its account validation reads the
    ACCOUNTS/ACCOUNT_EMAILS globals at request time, so mutating those globals is
    enough to keep the existing send/draft/folder code working while the registry
    becomes persistent and user-editable.
    """

    seed_registry_from_legacy_accounts()
    primary = _primary_account()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT a.account_id, a.local_part, a.display_name, d.domain, d.business_scope
            FROM mail_account a
            JOIN mail_domain d ON d.domain_id=a.domain_id
            WHERE a.status='active' AND d.status='active'
            ORDER BY
              CASE WHEN lower(a.local_part || '@' || d.domain) = ? THEN 0 ELSE 1 END,
              CASE d.business_scope
                WHEN 'spruked' THEN 0
                WHEN 'truemark_mint' THEN 1
                WHEN 'certsig' THEN 2
                WHEN 'alpha_certsig' THEN 3
                ELSE 9
              END,
              d.domain COLLATE NOCASE,
              a.local_part COLLATE NOCASE
            """,
            (primary,),
        ).fetchall()
    accounts: List[Dict[str, Any]] = []
    for row in rows:
        email = f"{row['local_part']}@{row['domain']}".lower()
        accounts.append(
            {
                "email": email,
                "local_part": str(row["local_part"]),
                "domain": str(row["domain"]),
                "label": str(row["display_name"] or email),
                "account_id": str(row["account_id"]),
                "business_scope": str(row["business_scope"] or ""),
                "is_primary": email == primary,
            }
        )
    legacy.ACCOUNTS[:] = accounts
    legacy.ACCOUNT_EMAILS.clear()
    legacy.ACCOUNT_EMAILS.update(account["email"] for account in accounts)


class DomainCreate(BaseModel):
    domain: str
    business_scope: Optional[str] = None


class AccountCreate(BaseModel):
    email: str
    display_name: Optional[str] = None
    business_scope: Optional[str] = None
    config_ref: str = "pending-configuration"


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    account_email: str


@router.get("/domains")
def list_domains() -> Dict[str, Any]:
    sync_legacy_account_globals()
    with _connect() as conn:
        domains = conn.execute(
            """
            SELECT domain_id, domain, business_scope, status
            FROM mail_domain
            WHERE status='active'
            ORDER BY CASE business_scope WHEN 'spruked' THEN 0 WHEN 'truemark_mint' THEN 1 WHEN 'certsig' THEN 2 WHEN 'alpha_certsig' THEN 3 ELSE 9 END,
                     domain COLLATE NOCASE
            """
        ).fetchall()
        result = []
        for domain_row in domains:
            accounts = conn.execute(
                """
                SELECT account_id, local_part, display_name, status
                FROM mail_account
                WHERE domain_id=? AND status='active'
                ORDER BY local_part COLLATE NOCASE
                """,
                (domain_row["domain_id"],),
            ).fetchall()
            result.append(
                {
                    **dict(domain_row),
                    "accounts": [
                        {
                            **dict(account),
                            "email": f"{account['local_part']}@{domain_row['domain']}",
                            "is_primary": f"{account['local_part']}@{domain_row['domain']}".lower() == _primary_account(),
                        }
                        for account in accounts
                    ],
                }
            )
    return {"domains": result, "primary_account": _primary_account()}


@router.post("/domains")
def add_domain(payload: DomainCreate) -> Dict[str, Any]:
    ensure_registry_schema()
    domain = _normalize_domain(payload.domain)
    business_scope = payload.business_scope or KNOWN_BUSINESS_DOMAINS.get(domain)
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO mail_domain(domain_id, domain, business_scope, status)
            VALUES (?, ?, ?, 'active')
            ON CONFLICT(domain_id) DO UPDATE SET
              business_scope=COALESCE(excluded.business_scope, mail_domain.business_scope),
              status='active'
            """,
            (domain, domain, business_scope),
        )
        conn.commit()
    return {"domain_id": domain, "domain": domain, "business_scope": business_scope, "status": "active"}


@router.post("/accounts")
def add_account(payload: AccountCreate) -> Dict[str, Any]:
    ensure_registry_schema()
    email = legacy.normalize_email(payload.email)
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email address is required")
    local_part, domain = email.split("@", 1)
    business_scope = payload.business_scope or KNOWN_BUSINESS_DOMAINS.get(domain)
    account_id = _stable_id("mail-account", email)
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO mail_domain(domain_id, domain, business_scope, status)
            VALUES (?, ?, ?, 'active')
            ON CONFLICT(domain_id) DO UPDATE SET
              business_scope=COALESCE(excluded.business_scope, mail_domain.business_scope),
              status='active'
            """,
            (domain, domain, business_scope),
        )
        conn.execute(
            """
            INSERT INTO mail_account(account_id, domain_id, local_part, display_name, config_ref, status)
            VALUES (?, ?, ?, ?, ?, 'active')
            ON CONFLICT(account_id) DO UPDATE SET
              display_name=excluded.display_name,
              config_ref=excluded.config_ref,
              status='active'
            """,
            (account_id, domain, local_part, payload.display_name or email, payload.config_ref),
        )
        for folder in STANDARD_FOLDERS:
            mailbox_id = _stable_id("mailbox", account_id, folder.lower())
            conn.execute(
                """
                INSERT OR IGNORE INTO mailbox(mailbox_id, account_id, name, mailbox_type, business_scope)
                VALUES (?, ?, ?, 'standard', ?)
                """,
                (mailbox_id, account_id, folder, business_scope),
            )
        conn.commit()
    sync_legacy_account_globals()
    return {
        "account_id": account_id,
        "email": email,
        "domain": domain,
        "business_scope": business_scope,
        "is_primary": email == _primary_account(),
        "status": "active",
    }


@router.delete("/accounts/{account_id}")
def archive_account(account_id: str) -> Dict[str, Any]:
    ensure_registry_schema()
    with _connect() as conn:
        row = conn.execute("SELECT account_id FROM mail_account WHERE account_id=?", (account_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mail account not found")
        conn.execute("UPDATE mail_account SET status='archived' WHERE account_id=?", (account_id,))
        conn.commit()
    sync_legacy_account_globals()
    return {"account_id": account_id, "status": "archived"}


@router.get("/folders")
def registry_folders(account: Optional[str] = None) -> Dict[str, Any]:
    sync_legacy_account_globals()
    normalized = legacy.normalize_email(account) if account and account != "all" else ""
    with _connect() as conn:
        if normalized:
            local_part, domain = normalized.split("@", 1) if "@" in normalized else ("", "")
            rows = conn.execute(
                """
                SELECT m.mailbox_id, m.name, m.mailbox_type, m.business_scope, a.account_id,
                       a.local_part, d.domain
                FROM mailbox m
                JOIN mail_account a ON a.account_id=m.account_id
                JOIN mail_domain d ON d.domain_id=a.domain_id
                WHERE a.local_part=? AND d.domain=? AND a.status='active'
                ORDER BY CASE m.mailbox_type WHEN 'standard' THEN 0 ELSE 1 END, m.name COLLATE NOCASE
                """,
                (local_part, domain),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT m.mailbox_id, m.name, m.mailbox_type, m.business_scope, a.account_id,
                       a.local_part, d.domain
                FROM mailbox m
                JOIN mail_account a ON a.account_id=m.account_id
                JOIN mail_domain d ON d.domain_id=a.domain_id
                WHERE a.status='active'
                ORDER BY CASE d.business_scope WHEN 'spruked' THEN 0 WHEN 'truemark_mint' THEN 1 WHEN 'certsig' THEN 2 WHEN 'alpha_certsig' THEN 3 ELSE 9 END,
                         d.domain COLLATE NOCASE, a.local_part COLLATE NOCASE,
                         CASE m.mailbox_type WHEN 'standard' THEN 0 ELSE 1 END, m.name COLLATE NOCASE
                """
            ).fetchall()
    return {
        "folders": [
            {
                **dict(row),
                "account_email": f"{row['local_part']}@{row['domain']}",
            }
            for row in rows
        ]
    }


@router.post("/folders")
def add_folder(payload: FolderCreate) -> Dict[str, Any]:
    ensure_registry_schema()
    folder_name = _normalize_folder(payload.name)
    account_email = legacy.normalize_email(payload.account_email)
    if not account_email or "@" not in account_email:
        raise HTTPException(status_code=400, detail="Valid account email is required")
    local_part, domain = account_email.split("@", 1)
    with _connect() as conn:
        account = conn.execute(
            """
            SELECT a.account_id, d.business_scope
            FROM mail_account a
            JOIN mail_domain d ON d.domain_id=a.domain_id
            WHERE a.local_part=? AND d.domain=? AND a.status='active'
            """,
            (local_part, domain),
        ).fetchone()
        if not account:
            raise HTTPException(status_code=404, detail="Mail account not found")
        mailbox_id = _stable_id("mailbox", str(account["account_id"]), folder_name.lower())
        conn.execute(
            """
            INSERT INTO mailbox(mailbox_id, account_id, name, mailbox_type, business_scope)
            VALUES (?, ?, ?, 'custom', ?)
            ON CONFLICT(mailbox_id) DO UPDATE SET name=excluded.name, mailbox_type='custom'
            """,
            (mailbox_id, account["account_id"], folder_name, account["business_scope"]),
        )
        conn.commit()
    return {
        "mailbox_id": mailbox_id,
        "account_email": account_email,
        "name": folder_name,
        "mailbox_type": "custom",
    }


@router.delete("/folders/{mailbox_id}")
def delete_folder(mailbox_id: str) -> Dict[str, Any]:
    ensure_registry_schema()
    with _connect() as conn:
        row = conn.execute("SELECT mailbox_type FROM mailbox WHERE mailbox_id=?", (mailbox_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Folder not found")
        if row["mailbox_type"] != "custom":
            raise HTTPException(status_code=400, detail="Standard folders cannot be deleted")
        conn.execute("DELETE FROM mailbox WHERE mailbox_id=?", (mailbox_id,))
        conn.commit()
    return {"mailbox_id": mailbox_id, "status": "deleted"}
