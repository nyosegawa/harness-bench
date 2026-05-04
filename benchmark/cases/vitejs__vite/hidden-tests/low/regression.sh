#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  pnpm install --ignore-scripts
fi
pnpm --filter=./packages/vite run build-bundle

cat > packages/vite/src/node/__tests__/flatten-id-hidden-regression.spec.ts <<'TSEOF'
import { expect, test } from 'vitest'
import { flattenId } from '../utils'

test('hidden flattenId regression avoids underscore and nested-id collisions', () => {
  const flattened = [
    flattenId('foo_bar'),
    flattenId('foo.bar'),
    flattenId('foo/bar'),
    flattenId('foo>bar'),
    flattenId('foo+bar'),
  ]
  expect(new Set(flattened).size).toBe(flattened.length)
  expect(flattened.every((id) => !/[/>+]/.test(id))).toBe(true)
})
TSEOF

pnpm vitest run packages/vite/src/node/__tests__/flatten-id-hidden-regression.spec.ts
