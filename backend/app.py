from __future__ import annotations

import os

# VIV Communications has two separate persistent stores: the mail authority and
# the shared VIV dossier/contact substrate. These defaults must be established
# before importing the legacy compatibility module because main.py initializes
# SQLite during import. Manual launches therefore resolve to the same stores as
# the Windows tray/auto-start launcher instead of accidentally opening a new or
# unrelated database.
os.environ.setdefault("EMAIL_DB_PATH", r"R:\email_client\emails.db")
os.environ.setdefault(
    "CALI_DB_PATH",
    r"R:\Substrate_Vault_R\vaults\r_drive_system_records\crm\memory\cali_personal.db",
)
os.environ.setdefault("EMAIL_ATTACHMENTS_DIR", r"R:\email_client\attachments")
os.environ.setdefault("PRIME_MAIL_RAW_VAULT", r"R:\email_client\vault\raw_email")
os.environ.setdefault(
    "CALI_CRM_PROJECT_ROOT",
    r"C:\dev\Desktop\PLATFORM\SPRUKED_CRM_MASTER_2026-05-05",
)

import main as legacy
from cali_bridge_routes import ensure_handoff_schema, router as cali_bridge_router
from contact_candidate_routes import router as contact_candidate_router
from custody_routes import receive_email_with_custody, router as custody_router
from mail_repair import repair_suspicious_messages
from registry_routes import router as registry_router, sync_legacy_account_globals
from viv_dossier_bridge import promote_contact_to_viv, router as viv_dossier_router

# VIV Communications and VIV Core are components of the same single-owner system.
# Keep legacy token-aware code paths intact for compatibility, but ensure the
# internal Communications -> VIV bridge never blocks on a missing owner/admin token.
if not legacy.ADMIN_ACCESS_TOKEN:
    legacy.ADMIN_ACCESS_TOKEN = "viv-owner-local"

# The compatibility backend still defines the original request model. Normalize
# its externally visible sender identity here so callers that omit from_name do
# not leak the former product name in outbound mail.
try:
    model_fields = getattr(legacy.SendEmailRequest, "model_fields", None)
    if model_fields and "from_name" in model_fields:
        model_fields["from_name"].default = "VIV Communications"
    legacy_fields = getattr(legacy.SendEmailRequest, "__fields__", None)
    if legacy_fields and "from_name" in legacy_fields:
        legacy_fields["from_name"].default = "VIV Communications"
except Exception:
    pass

app = legacy.app
app.title = "VIV Communications"
app.version = "4.0.0"
app.include_router(registry_router)
app.include_router(cali_bridge_router)
app.include_router(contact_candidate_router)
app.include_router(custody_router)
app.include_router(viv_dossier_router)

# main.py registers the SPA catch-all while it is imported. Routers added by this
# V4 composition layer come later, so a GET such as /api/contact-candidates could
# otherwise be swallowed by /{full_path:path} and receive index.html. Keep the SPA
# fallback last so every concrete API route wins first.
def _defer_spa_catch_all() -> None:
    catch_all = []
    concrete = []
    for route in app.router.routes:
        if getattr(route, "path", "") == "/{full_path:path}":
            catch_all.append(route)
        else:
            concrete.append(route)
    if catch_all:
        app.router.routes[:] = concrete + catch_all


_defer_spa_catch_all()

# The V4 reader isolates decoded message HTML in a sandboxed iframe. Preserve the
# decoded HTML at ingestion instead of destructively stripping tables/styles so
# the display layer can sanitize/contain it without losing the original meaning.
def _preserve_decoded_html(value):
    return value or ""


legacy.sanitize_html = _preserve_decoded_html

# Receiving an email is evidence of correspondence, not consent to create a
# dossier subject. The legacy receive route used to upsert every sender into
# contacts. Disable only that implicit promotion; the explicit review/save path
# remains responsible for promoting a sender into a VIV dossier.
def _do_not_autocreate_contact(_cursor, _email, _name, _timestamp):
    return None


legacy.upsert_contact = _do_not_autocreate_contact


async def _sync_contact_to_viv(email, name, contact_type="contact", crm_stage=None):
    """Compatibility hook for callers that explicitly request a VIV sync.

    Mail and VIV share the contact substrate. Never create a second contact row.
    Reconcile the already-saved row through the canonical dossier backfill path.
    Callers that know the active business context should use /api/integrations/viv/
    promote-contact so that context is preserved; this fallback uses personal.
    """
    if not email:
        return {"status": "skipped", "reason": "email_required"}
    return await promote_contact_to_viv(email, "personal")


legacy.sync_contact_to_crm = _sync_contact_to_viv

# main.py already owns the legacy /api/emails/receive route. Put the custody-aware
# route ahead of it without rewriting the large compatibility backend. The custody
# route stores immutable raw bytes, then delegates parsed-message insertion.
for index, route in enumerate(list(app.router.routes)):
    if getattr(route, "endpoint", None) is receive_email_with_custody:
        app.router.routes.insert(0, app.router.routes.pop(index))
        break

# Moving the custody route above the legacy receiver must not pull the SPA fallback
# forward. Re-assert the route-order invariant after any route manipulation.
_defer_spa_catch_all()

# Prime persistent registries before the first request so legacy send/draft/folder
# routes honor dynamically added accounts and VIV handoffs always have a queue.
sync_legacy_account_globals()
ensure_handoff_schema()

# Older rows can contain envelope bounce addresses or quoted-printable leakage in
# derived display columns. Rebuild only suspicious derived fields from raw_email;
# the immutable/raw source itself is never changed.
try:
    repair_suspicious_messages()
except Exception as exc:
    print(f"VIV Communications startup repair skipped: {exc}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=legacy.PORT)
