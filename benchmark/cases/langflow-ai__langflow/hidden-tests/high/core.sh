#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-stream-fallback-core.py <<'PYEOF'
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from lfx.base.models.model import LCModelComponent


class HiddenStreamProbe(LCModelComponent):
    display_name = "HiddenProbe"
    description = "hidden"

    def build_model(self):
        raise NotImplementedError


def make_probe(*, session_id, event_manager):
    probe = HiddenStreamProbe.__new__(HiddenStreamProbe)
    probe.is_connected_to_chat_output = MagicMock(return_value=True)
    probe._vertex = SimpleNamespace(graph=SimpleNamespace(session_id=session_id, flow_id=None))
    probe.icon = "brain"
    probe._id = "hidden-probe"
    probe._event_manager = event_manager
    probe._build_source = MagicMock(return_value=None)
    probe.send_message = AsyncMock(side_effect=AssertionError("stream persistence should not be used without event manager"))
    return probe


async def main():
    probe = make_probe(session_id="session-123", event_manager=None)
    runnable = SimpleNamespace(
        astream=MagicMock(return_value=object()),
        ainvoke=AsyncMock(return_value=SimpleNamespace(content="batched hidden result")),
    )

    lf_message, result, ai_message = await probe._handle_stream(runnable, {"input": "value"})

    assert lf_message is None
    assert result == "batched hidden result"
    assert isinstance(result, str)
    assert ai_message is not None
    runnable.ainvoke.assert_awaited_once_with({"input": "value"})
    runnable.astream.assert_not_called()
    probe.send_message.assert_not_awaited()


asyncio.run(main())
PYEOF

uv run --package lfx python .benchmark-hidden-stream-fallback-core.py
