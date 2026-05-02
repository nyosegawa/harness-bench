#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  pnpm install --ignore-scripts
fi
pnpm --filter=./packages/vite run build-bundle

cat > packages/vite/src/node/__tests__/flatten-id-hidden.spec.ts <<'TSEOF'
import { expect, test } from 'vitest'
import { flattenId } from '../utils'

test('hidden flattenId encodes sanitized path characters distinctly', () => {
  expect(flattenId('pkg/core+track+encrypt')).toBe(
    'pkg_core_02b_track_02b_encrypt',
  )
  expect(flattenId('pkg/core#track')).toBe('pkg_core_023_track')
  expect(flattenId('pkg/core$track')).toBe('pkg_core_024_track')
  expect(flattenId('pkg/core*track')).toBe('pkg_core_02a_track')
})

test('hidden flattenId avoids underscore and nested-id collisions', () => {
  const flattened = [
    flattenId('foo_bar'),
    flattenId('foo.bar'),
    flattenId('foo/bar'),
    flattenId('foo>bar'),
    flattenId('foo+bar'),
  ]
  expect(flattened).toEqual([
    'foo___bar',
    'foo__bar',
    'foo_bar',
    'foo_n_bar',
    'foo_02b_bar',
  ])
  expect(new Set(flattened).size).toBe(flattened.length)
})
TSEOF

pnpm vitest run packages/vite/src/node/__tests__/flatten-id-hidden.spec.ts
