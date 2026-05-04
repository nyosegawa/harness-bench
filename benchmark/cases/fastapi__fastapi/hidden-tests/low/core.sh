#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-vibe-core.py <<'PYEOF'
from fastapi import FastAPI

app = FastAPI()
assert not hasattr(app, "vibe")
PYEOF

uv run --with-editable . python .benchmark-hidden-vibe-core.py
