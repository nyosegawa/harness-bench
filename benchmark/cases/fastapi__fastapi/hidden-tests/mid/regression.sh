#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-color-regression.py <<'PYEOF'
from fastapi.encoders import jsonable_encoder
from pydantic.color import Color as LegacyColor

assert jsonable_encoder({"color": LegacyColor("blue")}) == {"color": "blue"}
PYEOF

uv run --with-editable . python .benchmark-hidden-color-regression.py
