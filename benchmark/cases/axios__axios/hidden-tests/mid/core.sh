#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  npm install --ignore-scripts
fi

cat > .benchmark-hidden-fetch-global-core.mjs <<'JSEOF'
import assert from 'node:assert/strict';
import utils from './lib/utils.js';

const originalGlobal = utils.global;
try {
  utils.global = undefined;
  const { getFetch } = await import(`./lib/adapters/fetch.js?hidden=${Date.now()}`);
  assert.doesNotThrow(() => {
    getFetch({
      env: {
        fetch() {},
      },
    });
  });
} finally {
  utils.global = originalGlobal;
}
JSEOF

node .benchmark-hidden-fetch-global-core.mjs
