#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  pnpm install --ignore-scripts
fi
pnpm --filter=./packages/vite run build-bundle

mkdir -p packages/vite/src/node/server/__tests__/fixtures/hidden-deno-workspace/app
cat > packages/vite/src/node/server/__tests__/fixtures/hidden-deno-workspace/deno.json <<'JSONEOF'
{
  "workspace": [
    "./app"
  ]
}
JSONEOF
cat > packages/vite/src/node/server/__tests__/fixtures/hidden-deno-workspace/app/package.json <<'JSONEOF'
{
  "name": "hidden-deno-app"
}
JSONEOF

cat > packages/vite/src/node/server/__tests__/search-root-deno-hidden.spec.ts <<'TSEOF'
import { resolve } from 'node:path'
import { expect, test } from 'vitest'
import { searchForWorkspaceRoot } from '../searchRoot'

const dirname = import.meta.dirname

test('hidden searchForWorkspaceRoot detects deno workspace roots', () => {
  const root = resolve(dirname, 'fixtures/hidden-deno-workspace')
  expect(searchForWorkspaceRoot(resolve(root, 'app'))).toBe(root)
  expect(searchForWorkspaceRoot(root)).toBe(root)
})
TSEOF

pnpm vitest run packages/vite/src/node/server/__tests__/search-root-deno-hidden.spec.ts
