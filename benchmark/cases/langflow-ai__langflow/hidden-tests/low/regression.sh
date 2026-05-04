#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-loguru-regression.py <<'PYEOF'
import logging
import logging.handlers
import tempfile
from pathlib import Path

from loguru import logger as loguru_logger
from lfx.log.logger import configure

with tempfile.TemporaryDirectory() as tmp_dir:
    first = Path(tmp_dir) / "first.log"
    second = Path(tmp_dir) / "second.log"

    configure(log_level="INFO", log_file=first, cache=False)
    logging.getLogger("langflow.hidden").info("standard logging still routes")
    configure(log_level="DEBUG", log_file=second, cache=False)
    loguru_logger.info("new file only")

    for handler in logging.root.handlers:
        if hasattr(handler, "flush"):
            handler.flush()

    assert "standard logging still routes" in first.read_text()
    assert "new file only" in second.read_text()
    assert "new file only" not in first.read_text()
PYEOF

uv run --package lfx python .benchmark-hidden-loguru-regression.py
