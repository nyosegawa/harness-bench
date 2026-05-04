#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-color-core.py <<'PYEOF'
from fastapi.encoders import jsonable_encoder
from pydantic_extra_types.color import Color as ExtraColor

assert jsonable_encoder({"color": ExtraColor("blue")}) == {"color": "blue"}
PYEOF

uv run --with-editable . --with pydantic-extra-types python .benchmark-hidden-color-core.py
