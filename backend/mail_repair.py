from __future__ import annotations

from email import policy
from email.header import decode_header, make_header
from email.parser import Parser
from email.utils import parseaddr
from typing import Optional

import main as legacy


def _decode_header(value: Optional[str]) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value))).strip()
    except Exception:
        return str(value).strip()


def _body_part(message, content_type: str) -> str:
    try:
        if message.is_multipart():
            for part in message.walk():
                if part.get_content_disposition() == "attachment":
                    continue
                if part.get_content_type() != content_type:
                    continue
                try:
                    content = part.get_content()
                except Exception:
                    payload = part.get_payload(decode=True) or b""
                    charset = part.get_content_charset() or "utf-8"
                    content = payload.decode(charset, errors="replace")
                if content:
                    return str(content).strip()
            return ""

        if message.get_content_type() == content_type:
            try:
                return str(message.get_content()).strip()
            except Exception:
                payload = message.get_payload(decode=True) or b""
                charset = message.get_content_charset() or "utf-8"
                return payload.decode(charset, errors="replace").strip()
    except Exception:
        return ""
    return ""


def _suspicious_sender(value: str) -> bool:
    _name, address = parseaddr(value or "")
    candidate = (address or value or "").lower()
    local = candidate.split("@", 1)[0] if "@" in candidate else candidate
    return (
        not candidate
        or local.startswith("bounce")
        or local.startswith("bounces+")
        or "=spruked.com" in local
        or local.startswith("mailer-daemon")
    )


def _suspicious_body(value: str) -> bool:
    text = value or ""
    return (
        "=3D" in text
        or "=20" in text
        or "<= body" in text.lower()
        or "content-transfer-encoding:" in text.lower()
    )


def repair_suspicious_messages(limit: int = 2000) -> dict:
    """Repair only derived fields; raw_email remains untouched and authoritative."""
    conn = legacy.get_db()
    conn.row_factory = __import__("sqlite3").Row
    repaired = 0
    scanned = 0
    try:
        rows = conn.execute(
            """
            SELECT id, sender, recipient, subject, date, text_body, html_body, raw_email
            FROM emails
            WHERE raw_email IS NOT NULL AND trim(raw_email) != ''
            ORDER BY id DESC
            LIMIT ?
            """,
            (max(1, min(int(limit), 10000)),),
        ).fetchall()

        for row in rows:
            scanned += 1
            sender = str(row["sender"] or "")
            text_body = str(row["text_body"] or "")
            html_body = str(row["html_body"] or "")
            if not (_suspicious_sender(sender) or _suspicious_body(text_body) or _suspicious_body(html_body)):
                continue

            try:
                message = Parser(policy=policy.default).parsestr(str(row["raw_email"] or ""))
            except Exception:
                continue

            raw_from = _decode_header(message.get("From"))
            raw_to = _decode_header(message.get("To"))
            raw_subject = _decode_header(message.get("Subject"))
            raw_date = str(message.get("Date") or "").strip()
            parsed_text = _body_part(message, "text/plain")
            parsed_html = _body_part(message, "text/html")

            next_sender = raw_from or sender
            next_recipient = raw_to or str(row["recipient"] or "")
            next_subject = raw_subject or str(row["subject"] or "")
            next_date = raw_date or str(row["date"] or "")
            next_text = parsed_text or text_body
            next_html = parsed_html or html_body

            conn.execute(
                """
                UPDATE emails
                SET sender=?, recipient=?, subject=?, date=?, text_body=?, html_body=?
                WHERE id=?
                """,
                (
                    next_sender,
                    next_recipient,
                    next_subject,
                    next_date,
                    next_text,
                    next_html,
                    row["id"],
                ),
            )
            repaired += 1

        conn.commit()
    finally:
        conn.close()

    return {"scanned": scanned, "repaired": repaired, "raw_preserved": True}
