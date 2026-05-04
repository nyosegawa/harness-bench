# End-to-End Smoke

This document defines the smoke procedure for a clean HarnessBench release.

## Preconditions

- `benchmark/runs/` is empty or contains only the smoke run being evaluated.
- `benchmark/workspaces/` is disposable.
- old experiments are under `benchmark/archive/`.
- all official cases use `core_and_regression`.

## Checks

```bash
node --check scripts/run-case.mjs
node --check scripts/run-matrix.mjs
node --check scripts/render-results.mjs
node --check scripts/render-experiment-index.mjs
node --check scripts/review-failed-runs.mjs
node --check scripts/regrade-agent-results.mjs
node --check scripts/refresh-result-metrics.mjs
node --check scripts/apply-rate-card.mjs
```

## Case Verification

Run all base/fixed checks before an agent matrix:

```bash
node scripts/run-matrix.mjs \
  --experimentId harnessbench-verify-smoke-YYYY-MM-DD \
  --includeVerify true \
  --jobs 3 \
  --dryRun true
```

Then run without `--dryRun` or run selected cases directly.

Acceptance:

- every `verify-base` fails
- every `verify-fixed` passes
- no case is `core_tests_pass` in the official set
- failures identify core or regression layer

## Agent Smoke

A full smoke uses one harness condition over all 27 cases:

```bash
node scripts/run-matrix.mjs \
  --experimentId harnessbench-smoke-YYYY-MM-DD \
  --conditions benchmark/conditions/baseline.json \
  --harness codex \
  --includeVerify true \
  --jobs 3 \
  --agentTimeoutMs 3600000 \
  --maxInfraRetries 1 \
  --rateCard benchmark/rate-cards/api-equivalent-2026-05-03.json \
  --review true \
  --reviewJobs 3 \
  --report true
```

The resulting experiment should be archived after false-negative investigation
if it is only a test run.

## False-Negative Review

For every failed run:

- inspect hidden-test stderr/stdout
- inspect the saved workspace diff
- inspect harness logs when the failure mode is unclear
- decide whether the failure is a true implementation failure, case-design
  issue, or infrastructure invalid run

If a hidden test is corrected, regrade preserved workspaces rather than rerun
agents when possible.
