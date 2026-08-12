from __future__ import annotations

import main as legacy
from registry_routes import router as registry_router, sync_legacy_account_globals

app = legacy.app
app.include_router(registry_router)

# Prime the persistent registry before the first request so legacy send/draft/
# folder routes immediately recognize accounts added through the registry.
sync_legacy_account_globals()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=legacy.PORT)
