#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  npm install --ignore-scripts
fi

cat > .benchmark-hidden-settle-core.mjs <<'JSEOF'
import assert from 'node:assert/strict';
import settle from './lib/core/settle.js';
import AxiosError from './lib/core/AxiosError.js';

function rejectedCodeFor(status) {
  let captured;
  settle(() => {
    throw new Error('unexpected resolve');
  }, error => {
    captured = error;
  }, {
    status,
    config: { validateStatus: () => false },
    request: {},
    data: null,
    headers: {},
  });
  assert(captured instanceof AxiosError);
  return captured.code;
}

for (const status of [200, 302, 600]) {
  assert.match(rejectedCodeFor(status), /^ERR_BAD_(REQUEST|RESPONSE)$/);
}
JSEOF

node .benchmark-hidden-settle-core.mjs
