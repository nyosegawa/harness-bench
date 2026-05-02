#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  npm ci --omit=dev --ignore-scripts --no-audit
fi

cat > .benchmark-hidden-websocket-options.js <<'JSEOF'
const assert = require("node:assert/strict");
const { WebSocketMonitorType } = require("./server/monitor-types/websocket-upgrade");

async function main() {
    const monitorType = new WebSocketMonitorType();
    assert.equal(typeof monitorType.buildWsOptions, "function");

    const options = await monitorType.buildWsOptions({
        timeout: 7,
        headers: JSON.stringify({
            Authorization: "Bearer stale",
            "X-Trace": "hidden",
        }),
        authMethod: "basic",
        basic_auth_user: "agent",
        basic_auth_pass: "secret",
    });

    assert.equal(options.handshakeTimeout, 7000);
    assert.deepEqual(options.headers, {
        Authorization: "Basic YWdlbnQ6c2VjcmV0",
        "X-Trace": "hidden",
    });

    const invalidHeaderOptions = await monitorType.buildWsOptions({
        timeout: 1,
        headers: "{not json",
    });
    assert.deepEqual(invalidHeaderOptions.headers, {});
    assert.equal(invalidHeaderOptions.handshakeTimeout, 1000);

    const mtlsOptions = await monitorType.buildWsOptions({
        authMethod: "mtls",
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

node .benchmark-hidden-websocket-options.js
