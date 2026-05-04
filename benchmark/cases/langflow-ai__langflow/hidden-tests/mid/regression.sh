#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-mcp-inputs-regression.py <<'PYEOF'
from lfx.inputs.inputs import BoolInput, DictInput
from lfx.schema.data import Data
from lfx.schema.message import Message


assert BoolInput(name="enabled", value=Message(text="true")).value is True
assert BoolInput(name="enabled", value=Message(text="false")).value is False
assert DictInput(name="payload", value=Message(text='{"a": 1}')).value == {"a": 1}
assert DictInput(name="payload", value=Data(data={"a": 1})).value == {"a": 1}
PYEOF

uv run --package lfx python .benchmark-hidden-mcp-inputs-regression.py
