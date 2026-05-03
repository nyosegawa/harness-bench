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

function assertDefinedBadCode(status) {
  assert.match(rejectedCodeFor(status), /^ERR_BAD_(REQUEST|RESPONSE)$/);
}

assertDefinedBadCode(200);
assertDefinedBadCode(302);
assertDefinedBadCode(600);
assert.equal(rejectedCodeFor(404), AxiosError.ERR_BAD_REQUEST);
JSEOF

node .benchmark-hidden-settle.mjs
