from __future__ import annotations

import main as legacy
from custody_routes import receive_email_with_custody, router as custody_router
from registry_routes import router as registry_router, sync_legacy_account_globals

app = legacy.app
app.include_router(registry_router)
app.include_router(custody_router)

# The V4 reader isolates decoded message HTML in a sandboxed iframe. Preserve the
# decoded HTML at ingestion instead of destructively stripping tables/styles so
# the display layer can sanitize/contain it without losing the original meaning.
def _preserve_decoded_html(value):
    return value or ""


legacy.sanitize_html = _preserve_decoded_html

# main.py already owns the legacy /api/emails/receive route. Put the custody-aware
# route ahead of it without rewriting the large legacy backend. The custody route
# stores immutable raw bytes, then delegates parsed-message insertion to legacy.
for index, route in enumerate(list(app.router.routes)):
    if getattr(route, "endpoint", None) is receive_email_with_custody:
        app.router.routes.insert(0, app.router.routes.pop(index))
        break

# Prime the persistent registry before the first request so legacy send/draft/
# folder routes immediately recognize accounts added through the registry.
sync_legacy_account_globals()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=legacy.PORT)
