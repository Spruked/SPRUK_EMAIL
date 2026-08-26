from __future__ import annotations

import sqlite3
from typing import Any, Dict

from fastapi import APIRouter
from pydantic import BaseModel

import main as legacy

router = APIRouter(prefix="/api/integrations/viv", tags=["viv-communications-dossier-bridge"])


class PromoteContactRequest(BaseModel):
    email: str
    business_scope: str = "personal"


def _normalize_scope(value: str) -> str:
    scope = str(value or "personal").strip().lower()
    return scope if scope and scope != "all" else "personal"


def _find_contact_id(email: str) -> str:
    normalized = legacy.normalize_email(email)
    if not normalized:
        return ""
    conn = sqlite3.connect(legacy.CONTACTS_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT id FROM contacts WHERE lower(email)=? ORDER BY updated_at DESC LIMIT 1",
            (normalized,),
        ).fetchone()
        return str(row["id"] or "").strip() if row else ""
    finally:
        conn.close()


async def promote_contact_to_viv(email: str, business_scope: str = "personal") -> Dict[str, Any]:
    normalized = legacy.normalize_email(email)
    contact_id = _find_contact_id(normalized)
    if not contact_id:
        return {"status": "pending", "reason": "saved contact could not be resolved in the shared VIV substrate"}

    scope = _normalize_scope(business_scope)
    try:
        backfill = await legacy.external_json_request(
            "POST",
            f"{legacy.CRM_API_URL}/cali/intelligence/dossiers/backfill",
            headers=legacy.crm_headers(),
            json_body={
                "business_scope": scope,
                "contact_ids": [contact_id],
                "only_unscoped": False,
            },
        )
    except Exception as exc:
        return {
            "status": "pending",
            "contact_id": contact_id,
            "business_scope": scope,
            "reason": str(exc),
        }

    return {
        "status": "linked",
        "contact_id": contact_id,
        "business_scope": scope,
        "backfill": backfill,
    }


@router.post("/promote-contact")
async def promote_contact(payload: PromoteContactRequest) -> Dict[str, Any]:
    return await promote_contact_to_viv(payload.email, payload.business_scope)
