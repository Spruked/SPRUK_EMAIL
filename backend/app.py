from __future__ import annotations

import main as legacy
from cali_bridge_routes import ensure_handoff_schema, router as cali_bridge_router
from contact_candidate_routes import router as contact_candidate_router
from custody_routes import receive_email_with_custody, router as custody_router
from mail_repair import repair_suspicious_messages
from registry_routes import router as registry_router, sync_legacy_account_globals

app = legacy.app
app.include_router(registry_router)
app.include_router(cali_bridge_router)
app.include_router(contact_candidate_router)
app.include_router(custody_router)

# The V4 reader isolates decoded message HTML in a sandboxed iframe. Preserve the
# decoded HTML at ingestion instead of destructively stripping tables/styles so
# the display layer can sanitize/contain it without losing the original meaning.
def _preserve_decoded_html(value):
    return value or ""


legacy.sanitize_html = _preserve_decoded_html

# Receiving an email is evidence of correspondence, not consent to create a
# contact. The legacy receive route used to upsert every sender into contacts.
# Disable only that implicit promotion; POST /api/contacts remains the explicit
# save path used by the review UI.
def _do_not_autocreate_contact(_cursor, _email, _name, _timestamp):
    return None


legacy.upsert_contact = _do_not_autocreate_contact

# main.py already owns the legacy /api/emails/receive route. Put the custody-aware
# route ahead of it without rewriting the large legacy backend. The custody route
# stores immutable raw bytes, then delegates parsed-message insertion to legacy.
for index, route in enumerate(list(app.router.routes)):
    if getattr(route, "endpoint", None) is receive_email_with_custody:
        app.router.routes.insert(0, app.router.routes.pop(index))
        break

# Prime persistent registries before the first request so legacy send/draft/folder
# routes honor dynamically added accounts and CALI handoffs always have a queue.
sync_legacy_account_globals()
ensure_handoff_schema()

# Older rows can contain envelope bounce addresses or quoted-printable leakage in
# derived display columns. Rebuild only suspicious derived fields from raw_email;
# the immutable/raw source itself is never changed.
try:
    repair_suspicious_messages()
except Exception as exc:
    print(f"PRIME MAIL startup repair skipped: {exc}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=legacy.PORT)
