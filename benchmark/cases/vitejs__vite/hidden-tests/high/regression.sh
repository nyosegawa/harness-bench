#!/usr/bin/env bash
set -euo pipefail

repo="${1:?repo path required}"
cd "$repo"

if [ ! -d node_modules ]; then
  pnpm install --ignore-scripts
fi
pnpm --filter=./packages/vite run build-bundle

cat > packages/vite/src/node/server/__tests__/full-bundle-hmr-hidden-regression.spec.ts <<'TSEOF'
import { expect, test } from 'vitest'
import { FullBundleDevEnvironment } from '../environments/fullBundleEnvironment'

test('hidden full bundle HMR regression sends a single client update', () => {
  const memoryFiles = new Map<string, { source: string }>()
  const sent: unknown[] = []
  const env = {
    memoryFiles,
    config: { root: process.cwd() },
    logger: { info() {} },
  }
  const client = { send(payload: unknown) { sent.push(payload) } }

  ;(FullBundleDevEnvironment.prototype as any).handleHmrOutput.call(
    env,
    client,
    ['/project/src/app.js'],
    {
      type: 'Update',
      filename: '/hmr_patch_0.js',
      code: 'globalThis.__hiddenPatchValue = 1',
      hmrBoundaries: [],
    },
  )

  expect(memoryFiles.has('/hmr_patch_0.js')).toBe(true)
  expect(sent).toHaveLength(1)
})
TSEOF

pnpm vitest run packages/vite/src/node/server/__tests__/full-bundle-hmr-hidden-regression.spec.ts
