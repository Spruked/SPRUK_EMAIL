from __future__ import annotations

from datetime import datetime, timezone
from email import policy
from email.header import decode_header, make_header
from email.parser import Parser
from email.utils import parseaddr
import re
import sqlite3
from typing import Any, Dict, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

import main as legacy

router = APIRouter(prefix="/api/contact-candidates", tags=["prime-mail-contact-review"])

_AUTOMATED_LOCAL_PREFIXES = (
    "bounce",
    "bounces",
    "mailer-daemon",
    "postmaster",
    "no-reply",
    "noreply",
    "do-not-reply",
    "donotreply",
    "notifications",
    "notification",
    "newsletter",
)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_email(value: str) -> str:
    _name, address = parseaddr(str(value or ""))
    return (address or str(value or "")).strip().lower()


def _decode_header(value: Optional[str]) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value))).strip()
    except Exception:
        return str(value).strip()


def _parse_raw(raw_email: str) -> tuple[str, str, Dict[str, str]]:
    if not raw_email:
        return "", "", {}
    try:
        message = Parser(policy=policy.default).parsestr(raw_email)
    except Exception:
        return "", "", {}

    raw_from = _decode_header(message.get("From"))
    name, address = parseaddr(raw_from)
    headers = {
        "auto_submitted": str(message.get("Auto-Submitted") or "").strip().lower(),
        "precedence": str(message.get("Precedence") or "").strip().lower(),
        "list_unsubscribe": str(message.get("List-Unsubscribe") or "").strip(),
        "list_id": str(message.get("List-Id") or "").strip(),
        "x_auto_response_suppress": str(message.get("X-Auto-Response-Suppress") or "").strip(),
    }
    return _decode_header(name), address.strip().lower(), headers


def _looks_automated(name: str, email: str, headers: Dict[str, str]) -> bool:
    if not email or "@" not in email:
        return True

    local, _domain = email.split("@", 1)
    local_lower = local.lower()
    if local_lower.startswith(_AUTOMATED_LOCAL_PREFIXES):
        return True
    if local_lower.startswith("bounces+") or "=spruked.com" in local_lower:
        return True
    if headers.get("list_unsubscribe") or headers.get("list_id"):
        return True
    if headers.get("precedence") in {"bulk", "list", "junk"}:
        return True
    auto_submitted = headers.get("auto_submitted") or ""
    if auto_submitted and auto_submitted != "no":
        return True
    if headers.get("x_auto_response_suppress"):
        return True

    clean_name = (name or "").strip()
    lowered_name = clean_name.lower()
    if any(token in lowered_name for token in ("mailer daemon", "mail delivery", "automated message", "do not reply", "no reply")):
        return True
    if clean_name:
        compact = re.sub(r"\s+", "", clean_name)
        if len(compact) >= 18:
            digit_ratio = sum(ch.isdigit() for ch in compact) / max(1, len(compact))
            if digit_ratio > 0.35:
                return True
    elif len(local) > 48 or local.count("+") > 1:
        return True

    return False


def _ensure_decision_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS contact_candidate_decisions (
          email TEXT PRIMARY KEY,
          decision TEXT NOT NULL CHECK (decision IN ('ignored')),
          decided_at TEXT NOT NULL
        )
        """
    )
    conn.commit()


def _existing_contact_emails() -> set[str]:
    conn = legacy.get_contacts_db()
    try:
        rows = conn.execute("SELECT email FROM contacts WHERE email IS NOT NULL AND trim(email) != ''").fetchall()
        return {_normalize_email(str(row[0])) for row in rows if _normalize_email(str(row[0]))}
    finally:
        conn.close()


def _ignored_emails(conn: sqlite3.Connection) -> set[str]:
    _ensure_decision_table(conn)
    rows = conn.execute("SELECT email FROM contact_candidate_decisions WHERE decision='ignored'").fetchall()
    return {_normalize_email(str(row[0])) for row in rows if _normalize_email(str(row[0]))}


@router.get("")
def list_contact_candidates(limit: int = Query(default=20, ge=1, le=50)) -> Dict[str, Any]:
    existing = _existing_contact_emails()
    configured = {str(item).lower() for item in legacy.ACCOUNT_EMAILS}
    conn = legacy.get_db()
    conn.row_factory = sqlite3.Row
    try:
        ignored = _ignored_emails(conn)
        rows = conn.execute(
            """
            SELECT sender, subject, date, raw_email
            FROM emails
            WHERE folder='inbox'
            ORDER BY date DESC
            LIMIT 500
            """
        ).fetchall()
    finally:
        conn.close()

    grouped: Dict[str, Dict[str, Any]] = {}
    filtered_count = 0
    for row in rows:
        stored_sender = str(row["sender"] or "")
        raw_name, raw_address, headers = _parse_raw(str(row["raw_email"] or ""))
        stored_name, stored_address = parseaddr(stored_sender)
        email = (raw_address or stored_address or stored_sender).strip().lower()
        name = raw_name or _decode_header(stored_name) or (email.split("@", 1)[0] if "@" in email else email)

        if not email or email in existing or email in configured or email in ignored:
            continue
        if _looks_automated(name, email, headers):
            filtered_count += 1
            continue

        candidate = grouped.get(email)
        if candidate is None:
            grouped[email] = {
                "email": email,
                "name": name,
                "message_count": 1,
                "latest_at": row["date"],
                "sample_subject": str(row["subject"] or ""),
            }
        else:
            candidate["message_count"] += 1

    candidates = list(grouped.values())[:limit]
    return {
        "count": len(candidates),
        "candidates": candidates,
        "filtered_automated": filtered_count,
        "policy": "explicit_save_only",
    }


class IgnoreCandidate(BaseModel):
    email: str


@router.post("/ignore")
def ignore_contact_candidate(payload: IgnoreCandidate) -> Dict[str, Any]:
    email = _normalize_email(payload.email)
    if not email:
        return {"status": "ignored", "email": ""}
    conn = legacy.get_db()
    try:
        _ensure_decision_table(conn)
        conn.execute(
            """
            INSERT INTO contact_candidate_decisions(email, decision, decided_at)
            VALUES (?, 'ignored', ?)
            ON CONFLICT(email) DO UPDATE SET decision='ignored', decided_at=excluded.decided_at
            """,
            (email, _utc_now()),
        )
        conn.commit()
    finally:
        conn.close()
    return {"status": "ignored", "email": email}
