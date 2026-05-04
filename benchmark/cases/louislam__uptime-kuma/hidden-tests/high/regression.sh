#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  npm ci --omit=dev --ignore-scripts --no-audit
fi

cat > .benchmark-hidden-websocket-options-regression.js <<'JSEOF'
const assert = require("node:assert/strict");
const { WebSocketMonitorType } = require("./server/monitor-types/websocket-upgrade");

async function main() {
    const monitorType = new WebSocketMonitorType();
    const buildOptions = monitorType.buildWsOptions ?? monitorType.buildWebSocketOptions;
    assert.equal(typeof buildOptions, "function");

    const invalidHeaderOptions = await buildOptions.call(monitorType, {
        timeout: 1,
        headers: "{not json",
    });
    assert.deepEqual(invalidHeaderOptions.headers, {});
    assert.equal(invalidHeaderOptions.handshakeTimeout, 1000);

    const mtlsOptions = await buildOptions.call(monitorType, {
        authMethod: "mtls",
        auth_method: "mtls",
        tlsCert: "cert",
        tlsKey: "key",
        tlsCa: "ca",
        getIgnoreTls: () => true,
    });
    assert.equal(mtlsOptions.cert, "cert");
    assert.equal(mtlsOptions.key, "key");
    assert.equal(mtlsOptions.ca, "ca");
    assert.equal(mtlsOptions.rejectUnauthorized, false);
}

main();
JSEOF

node .benchmark-hidden-websocket-options-regression.js
