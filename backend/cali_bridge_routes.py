from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query

import main as legacy

router = APIRouter(prefix="/api/integrations/cali", tags=["prime-mail-cali-bridge"])


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stable_id(prefix: str, *parts: str) -> str:
    raw = "|".join(str(part or "") for part in parts)
    return f"{prefix}:{hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]}"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(legacy.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_handoff_schema() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cali_handoff_queue (
              handoff_id TEXT PRIMARY KEY,
              external_id TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              status TEXT NOT NULL DEFAULT 'pending',
              attempts INTEGER NOT NULL DEFAULT 0,
              last_error TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              delivered_at TEXT
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS ix_cali_handoff_status ON cali_handoff_queue(status, updated_at)"
        )
        conn.commit()


def enqueue_handoff(payload: Dict[str, Any]) -> str:
    ensure_handoff_schema()
    external_id = str(payload.get("external_id") or "").strip()
    account_identity = str(payload.get("account_identity") or "").strip().lower()
    mailbox_id = str(payload.get("mailbox_id") or "").strip()
    if not external_id:
        raise ValueError("external_id is required for CALI handoff")
    handoff_id = _stable_id("cali-handoff", account_identity, mailbox_id, external_id)
    now = _utc_now()
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO cali_handoff_queue(
              handoff_id, external_id, payload_json, status, attempts,
              created_at, updated_at
            ) VALUES (?, ?, ?, 'pending', 0, ?, ?)
            ON CONFLICT(handoff_id) DO UPDATE SET
              payload_json=excluded.payload_json,
              status=CASE WHEN cali_handoff_queue.status='delivered' THEN 'delivered' ELSE 'pending' END,
              updated_at=excluded.updated_at
            """,
            (handoff_id, external_id, encoded, now, now),
        )
        conn.commit()
    return handoff_id


async def dispatch_handoff(handoff_id: str) -> Dict[str, Any]:
    ensure_handoff_schema()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM cali_handoff_queue WHERE handoff_id=?", (handoff_id,)).fetchone()
    if not row:
        return {"handoff_id": handoff_id, "status": "missing"}
    if str(row["status"]) == "delivered":
        return {"handoff_id": handoff_id, "status": "delivered", "already_delivered": True}

    attempts = int(row["attempts"] or 0) + 1
    payload = json.loads(str(row["payload_json"]))
    now = _utc_now()

    if not legacy.ADMIN_ACCESS_TOKEN:
        error = "CALI admin token is not configured"
        with _connect() as conn:
            conn.execute(
                """
                UPDATE cali_handoff_queue
                SET status='pending', attempts=?, last_error=?, updated_at=?
                WHERE handoff_id=?
                """,
                (attempts, error, now, handoff_id),
            )
            conn.commit()
        return {"handoff_id": handoff_id, "status": "pending", "reason": error, "attempts": attempts}

    try:
        response = await legacy.external_json_request(
            "POST",
            f"{legacy.CRM_API_URL}/cali/intelligence/messages/ingest",
            headers=legacy.crm_headers(),
            json_body=payload,
        )
    except HTTPException as exc:
        error = str(exc.detail)
        with _connect() as conn:
            conn.execute(
                """
                UPDATE cali_handoff_queue
                SET status='pending', attempts=?, last_error=?, updated_at=?
                WHERE handoff_id=?
                """,
                (attempts, error, now, handoff_id),
            )
            conn.commit()
        return {"handoff_id": handoff_id, "status": "pending", "reason": error, "attempts": attempts}
    except Exception as exc:
        error = str(exc)
        with _connect() as conn:
            conn.execute(
                """
                UPDATE cali_handoff_queue
                SET status='pending', attempts=?, last_error=?, updated_at=?
                WHERE handoff_id=?
                """,
                (attempts, error, now, handoff_id),
            )
            conn.commit()
        return {"handoff_id": handoff_id, "status": "pending", "reason": error, "attempts": attempts}

    with _connect() as conn:
        conn.execute(
            """
            UPDATE cali_handoff_queue
            SET status='delivered', attempts=?, last_error=NULL, updated_at=?, delivered_at=?
            WHERE handoff_id=?
            """,
            (attempts, now, now, handoff_id),
        )
        conn.commit()
    return {
        "handoff_id": handoff_id,
        "status": "delivered",
        "attempts": attempts,
        "response": response,
    }


async def enqueue_and_dispatch(payload: Dict[str, Any]) -> Dict[str, Any]:
    handoff_id = enqueue_handoff(payload)
    return await dispatch_handoff(handoff_id)


@router.get("/handoffs")
def list_handoffs(
    status: str = "pending",
    limit: int = Query(default=100, ge=1, le=500),
) -> Dict[str, Any]:
    ensure_handoff_schema()
    with _connect() as conn:
        if status == "all":
            rows = conn.execute(
                "SELECT * FROM cali_handoff_queue ORDER BY updated_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM cali_handoff_queue WHERE status=? ORDER BY updated_at ASC LIMIT ?",
                (status, limit),
            ).fetchall()
    items = []
    for row in rows:
        item = dict(row)
        item.pop("payload_json", None)
        items.append(item)
    return {"status": status, "count": len(items), "handoffs": items}


@router.post("/retry-pending")
async def retry_pending(limit: int = Query(default=50, ge=1, le=250)) -> Dict[str, Any]:
    ensure_handoff_schema()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT handoff_id FROM cali_handoff_queue
            WHERE status='pending'
            ORDER BY updated_at ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    results = [await dispatch_handoff(str(row["handoff_id"])) for row in rows]
    delivered = sum(1 for item in results if item.get("status") == "delivered")
    return {
        "attempted": len(results),
        "delivered": delivered,
        "remaining": len(results) - delivered,
        "results": results,
    }


@router.get("/resolve")
async def resolve_cali_party(email: str) -> Dict[str, Any]:
    if not legacy.ADMIN_ACCESS_TOKEN:
        raise HTTPException(status_code=503, detail="CALI admin token is not configured")
    return await legacy.external_json_request(
        "GET",
        f"{legacy.CRM_API_URL}/cali/intelligence/parties/resolve",
        headers=legacy.crm_headers(),
        params={"email": email},
    )


@router.get("/parties/{party_id:path}/timeline")
async def cali_party_timeline(
    party_id: str,
    business_scope: str = "all",
    channel: str = "email",
    limit: int = Query(default=100, ge=1, le=500),
) -> Dict[str, Any]:
    if not legacy.ADMIN_ACCESS_TOKEN:
        raise HTTPException(status_code=503, detail="CALI admin token is not configured")
    encoded_party = quote(party_id, safe="")
    return await legacy.external_json_request(
        "GET",
        f"{legacy.CRM_API_URL}/cali/intelligence/parties/{encoded_party}/timeline",
        headers=legacy.crm_headers(),
        params={"business_scope": business_scope, "channel": channel, "limit": limit},
    )
