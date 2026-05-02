#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-dump-json.py <<'PYEOF'
import json
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from pydantic import BaseModel


class HiddenItem(BaseModel):
    name: str
    count: int


app = FastAPI()


@app.get("/default")
def default() -> HiddenItem:
    return HiddenItem(name="fast", count=3)


@app.get("/explicit", response_class=JSONResponse)
def explicit() -> HiddenItem:
    return HiddenItem(name="fast", count=3)


client = TestClient(app)

with patch("starlette.responses.json.dumps", wraps=json.dumps) as mock_dumps:
    response = client.get("/default")
assert response.status_code == 200
assert response.json() == {"name": "fast", "count": 3}
mock_dumps.assert_not_called()

with patch("starlette.responses.json.dumps", wraps=json.dumps) as mock_dumps:
    response = client.get("/explicit")
assert response.status_code == 200
assert response.json() == {"name": "fast", "count": 3}
mock_dumps.assert_called_once()
PYEOF

uv run --with-editable . --with httpx python .benchmark-hidden-dump-json.py
