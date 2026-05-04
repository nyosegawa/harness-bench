#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  npm install --ignore-scripts
fi

cat > .benchmark-hidden-fetch-global-regression.mjs <<'JSEOF'
import assert from 'node:assert/strict';

const { getFetch } = await import(`./lib/adapters/fetch.js?regression=${Date.now()}`);
assert.doesNotThrow(() => {
  getFetch({
    env: {
      fetch() {},
      Request: class Request {},
      Response: class Response {},
    },
  });
});
JSEOF

node .benchmark-hidden-fetch-global-regression.mjs
