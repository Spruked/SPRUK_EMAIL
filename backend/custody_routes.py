from __future__ import annotations

import base64
import hashlib
import os
import sqlite3
from email.utils import getaddresses, parseaddr
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import main as legacy

router = APIRouter(tags=["prime-mail-custody"])


class CustodyIncomingEmail(BaseModel):
    message_id: str
    from_: str = Field(..., alias="from")
    to: str
    subject: str
    date: str
    raw_email: str
    raw_email_base64: Optional[str] = None
    text_body: str
    html_body: str
    received_at: str
    read: bool = False
    source: str = "cloudflare_routing"


def _vault_root() -> Path:
    configured = str(os.getenv("PRIME_MAIL_RAW_VAULT", "R:/email_client/vault/raw_email")).strip()
    root = Path(configured)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _raw_bytes(email: CustodyIncomingEmail) -> tuple[bytes, str]:
    if email.raw_email_base64:
        try:
            return base64.b64decode(email.raw_email_base64, validate=True), "worker_raw_bytes"
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid raw_email_base64: {exc}") from exc
    return email.raw_email.encode("utf-8"), "utf8_raw_fallback"


def _store_raw_message(email: CustodyIncomingEmail) -> dict:
    raw, source = _raw_bytes(email)
    digest = hashlib.sha256(raw).hexdigest()
    root = _vault_root()
    directory = root / digest[:2]
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{digest}.eml"

    # Content-addressed write: an existing hash is the same immutable object.
    if not path.exists():
        try:
            with path.open("xb") as handle:
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
        except FileExistsError:
            pass

    conn = sqlite3.connect(legacy.DB_PATH)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS raw_message_custody (
              message_id TEXT PRIMARY KEY,
              content_hash TEXT NOT NULL,
              raw_locator TEXT NOT NULL,
              byte_size INTEGER NOT NULL,
              encoding_source TEXT NOT NULL,
              received_at TEXT NOT NULL
            )
            """
        )
        existing = conn.execute(
            "SELECT content_hash, raw_locator FROM raw_message_custody WHERE message_id=?",
            (email.message_id,),
        ).fetchone()
        if existing and str(existing[0]) != digest:
            raise HTTPException(status_code=409, detail="Message-ID already exists with different raw bytes")
        conn.execute(
            """
            INSERT OR IGNORE INTO raw_message_custody(
              message_id, content_hash, raw_locator, byte_size, encoding_source, received_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (email.message_id, digest, str(path), len(raw), source, email.received_at),
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "content_hash": digest,
        "raw_locator": str(path),
        "byte_size": len(raw),
        "encoding_source": source,
    }


def _recipient_addresses(value: str) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for _name, address in getaddresses([str(value or "")]):
        normalized = legacy.normalize_email(address)
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def _account_context(recipients: list[str]) -> dict:
    for recipient in recipients:
        for account in legacy.ACCOUNTS:
            if str(account.get("email") or "").lower() == recipient:
                return {
                    "email": recipient,
                    "business_scope": str(account.get("business_scope") or "all") or "all",
                    "account_id": str(account.get("account_id") or ""),
                }
    fallback = recipients[0] if recipients else legacy.default_account_address()
    return {"email": fallback, "business_scope": "all", "account_id": ""}


async def _publish_to_cali(
    email: CustodyIncomingEmail,
    *,
    custody: dict,
    thread_id: str,
) -> dict:
    # CALI availability must never determine whether PRIME MAIL accepts and
    # preserves a message. Raw custody is authoritative for the transport event;
    # this handoff can be retried if CALI is offline or not yet configured.
    if not legacy.ADMIN_ACCESS_TOKEN:
        return {"status": "skipped", "reason": "CALI admin token is not configured"}

    recipients = _recipient_addresses(email.to)
    account = _account_context(recipients)
    sender_name, sender_address = parseaddr(email.from_)
    sender_email = legacy.normalize_email(sender_address or email.from_)
    payload = {
        "channel": "email",
        "provider": "prime_mail",
        "account_identity": account["email"],
        "business_scope": account["business_scope"],
        "external_id": email.message_id,
        "mailbox_id": "inbox",
        "direction": "inbound",
        "occurred_at": email.date or email.received_at,
        "raw_locator": custody["raw_locator"],
        "content_hash": custody["content_hash"],
        "thread_external_id": thread_id,
        "subject": email.subject,
        "sender_email": sender_email,
        "sender_name": sender_name or None,
        "recipient_emails": recipients,
    }

    try:
        response = await legacy.external_json_request(
            "POST",
            f"{legacy.CRM_API_URL}/cali/intelligence/messages/ingest",
            headers=legacy.crm_headers(),
            json_body=payload,
        )
        return {"status": "recorded", "response": response}
    except HTTPException as exc:
        return {"status": "deferred", "reason": str(exc.detail)}
    except Exception as exc:
        return {"status": "deferred", "reason": str(exc)}


@router.post("/api/emails/receive")
async def receive_email_with_custody(email: CustodyIncomingEmail, request: Request):
    secret = request.headers.get("X-Email-Secret")
    if secret != legacy.WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Invalid secret")

    custody = _store_raw_message(email)
    legacy_payload = legacy.IncomingEmail(
        **{
            "message_id": email.message_id,
            "from": email.from_,
            "to": email.to,
            "subject": email.subject,
            "date": email.date,
            "raw_email": email.raw_email,
            "text_body": email.text_body,
            "html_body": email.html_body,
            "received_at": email.received_at,
            "read": email.read,
            "source": email.source,
        }
    )
    result = await legacy.receive_email(legacy_payload, request)
    thread_id = str(result.get("thread_id") or legacy.build_thread_id(email.subject)) if isinstance(result, dict) else legacy.build_thread_id(email.subject)
    cali_sync = await _publish_to_cali(email, custody=custody, thread_id=thread_id)
    if isinstance(result, dict):
        return {**result, "custody": custody, "cali_sync": cali_sync}
    return {"result": result, "custody": custody, "cali_sync": cali_sync}


@router.get("/api/emails/custody/{message_id}")
async def get_message_custody(message_id: str):
    conn = sqlite3.connect(legacy.DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS raw_message_custody (
              message_id TEXT PRIMARY KEY,
              content_hash TEXT NOT NULL,
              raw_locator TEXT NOT NULL,
              byte_size INTEGER NOT NULL,
              encoding_source TEXT NOT NULL,
              received_at TEXT NOT NULL
            )
            """
        )
        row = conn.execute("SELECT * FROM raw_message_custody WHERE message_id=?", (message_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Raw custody record not found")
    return dict(row)
