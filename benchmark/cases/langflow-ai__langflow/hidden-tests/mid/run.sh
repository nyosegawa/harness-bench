#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-mcp-inputs.py <<'PYEOF'
from pydantic import BaseModel, Field

from lfx.inputs.inputs import BoolInput, DictInput, FloatInput, IntInput
from lfx.io.schema import schema_to_langflow_inputs
from lfx.schema.data import Data
from lfx.schema.message import Message


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

assert BoolInput(name="enabled", value=Message(text="true")).value is True
assert DictInput(name="payload", value=Message(text='{"a": 1}')).value == {"a": 1}
assert DictInput(name="payload", value=Data(data={"a": 1})).value == {"a": 1}
PYEOF

uv run --package lfx python .benchmark-hidden-mcp-inputs.py
