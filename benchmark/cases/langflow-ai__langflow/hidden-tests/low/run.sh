#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

cat > .benchmark-hidden-loguru.py <<'PYEOF'
import logging
import tempfile
from pathlib import Path

from loguru import logger as loguru_logger
from lfx.log.logger import configure

with tempfile.TemporaryDirectory() as tmp_dir:
    log_file = Path(tmp_dir) / "langflow.log"
    for handler in logging.root.handlers[:]:
        if isinstance(handler, logging.handlers.RotatingFileHandler):
            logging.root.removeHandler(handler)
            handler.close()

    configure(log_level="INFO", log_file=log_file, cache=False)
    loguru_logger.info("hidden custom component log message")

    for handler in logging.root.handlers:
        if hasattr(handler, "flush"):
            handler.flush()

    text = log_file.read_text()
    assert "hidden custom component log message" in text
PYEOF

uv run --package lfx python .benchmark-hidden-loguru.py
