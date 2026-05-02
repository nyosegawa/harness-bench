#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-vibe.py <<'PYEOF'
from fastapi import FastAPI
from fastapi.testclient import TestClient

app = FastAPI()
assert not hasattr(app, "vibe")

@app.get("/ok")
def ok():
    return {"ok": True}

@app.websocket("/ws")
async def ws(websocket):  # pragma: no cover
    await websocket.accept()
    await websocket.close()

client = TestClient(app)
assert client.get("/ok").json() == {"ok": True}
PYEOF

uv run --with-editable . --with httpx python .benchmark-hidden-vibe.py
