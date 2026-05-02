#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  npm install --ignore-scripts
fi

cat > .benchmark-hidden-settle.mjs <<'JSEOF'
import assert from 'node:assert/strict';
import settle from './lib/core/settle.js';
import AxiosError from './lib/core/AxiosError.js';

function rejectedCodeFor(status) {
  let captured;
  settle(
    () => {
      throw new Error('unexpected resolve');
    },
    error => {
      captured = error;
    },
    {
      status,
      config: { validateStatus: () => false },
      request: {},
      data: null,
      headers: {},
    },
  );
  assert(captured instanceof AxiosError);
  return captured.code;
}

assert.equal(rejectedCodeFor(200), AxiosError.ERR_BAD_RESPONSE);
assert.equal(rejectedCodeFor(302), AxiosError.ERR_BAD_RESPONSE);
assert.equal(rejectedCodeFor(600), AxiosError.ERR_BAD_RESPONSE);
assert.equal(rejectedCodeFor(404), AxiosError.ERR_BAD_REQUEST);
JSEOF

node .benchmark-hidden-settle.mjs
