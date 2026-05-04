#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  pnpm install --ignore-scripts
fi
pnpm --filter=./packages/vite run build-bundle

cat > packages/vite/src/node/__tests__/flatten-id-hidden-core.spec.ts <<'TSEOF'
import { expect, test } from 'vitest'
import { flattenId } from '../utils'

test('hidden flattenId core encodes sanitized path characters distinctly', () => {
  const flattened = [
    flattenId('pkg/core+track+encrypt'),
    flattenId('pkg/core#track'),
    flattenId('pkg/core$track'),
    flattenId('pkg/core*track'),
  ]
  expect(new Set(flattened).size).toBe(flattened.length)
  expect(flattened.every((id) => !/[+#$*]/.test(id))).toBe(true)
})
TSEOF

pnpm vitest run packages/vite/src/node/__tests__/flatten-id-hidden-core.spec.ts
