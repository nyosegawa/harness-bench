#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  npm ci --omit=dev --ignore-scripts --no-audit
fi

cat > .benchmark-hidden-websocket-options-core.js <<'JSEOF'
const assert = require("node:assert/strict");
const { WebSocketMonitorType } = require("./server/monitor-types/websocket-upgrade");

async function main() {
    const monitorType = new WebSocketMonitorType();
    const buildOptions = monitorType.buildWsOptions ?? monitorType.buildWebSocketOptions;
    assert.equal(typeof buildOptions, "function");

    const options = await buildOptions.call(monitorType, {
        timeout: 7,
        headers: JSON.stringify({
            Authorization: "Bearer stale",
            "X-Trace": "hidden",
        }),
        authMethod: "basic",
        auth_method: "basic",
        basic_auth_user: "agent",
        basic_auth_pass: "secret",
    });

    assert.equal(options.handshakeTimeout, 7000);
    assert.deepEqual(options.headers, {
        Authorization: "Basic YWdlbnQ6c2VjcmV0",
        "X-Trace": "hidden",
    });
}

main();
JSEOF

node .benchmark-hidden-websocket-options-core.js
