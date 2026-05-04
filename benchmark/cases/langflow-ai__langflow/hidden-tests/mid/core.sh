#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-mcp-inputs-core.py <<'PYEOF'
from pydantic import BaseModel, Field

from lfx.inputs.inputs import BoolInput, DictInput, FloatInput, IntInput
from lfx.io.schema import schema_to_langflow_inputs


class HiddenToolSchema(BaseModel):
    lat: float = Field(description="Latitude")
    count: int = Field(description="Count")
    enabled: bool = Field(description="Enabled")
    payload: dict = Field(description="JSON payload")


inputs = {inp.name: inp for inp in schema_to_langflow_inputs(HiddenToolSchema)}
assert isinstance(inputs["lat"], FloatInput)
assert inputs["lat"].input_types == ["Message"]
assert isinstance(inputs["count"], IntInput)
assert inputs["count"].input_types == ["Message"]
assert isinstance(inputs["enabled"], BoolInput)
assert inputs["enabled"].input_types == ["Message"]
assert isinstance(inputs["payload"], DictInput)
assert inputs["payload"].input_types == ["JSON"]
PYEOF

uv run --package lfx python .benchmark-hidden-mcp-inputs-core.py
