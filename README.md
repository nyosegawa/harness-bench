# Harness Debug Benchmark

Benchmark harness and pilot data for comparing Codex, Claude Code, and Cursor debugging runs.

The repository tracks benchmark specifications, case definitions, hidden test scripts, runner scripts, candidate repository metadata, and generated HTML reports. Large local run outputs and cloned workspaces are intentionally ignored under `benchmark/runs/` and `benchmark/workspaces/`.

## Quick Checks

```bash
node --check scripts/run-case.mjs
node --check scripts/run-matrix.mjs
node --check scripts/render-results.mjs
node --check scripts/apply-rate-card.mjs
node --check scripts/refresh-result-metrics.mjs
```

## Case Verification

Each case starts from the original PR base commit and is expected to fail hidden tests before the fix and pass after the fixed commit:

```bash
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-base
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-fixed
```

Case YAML files record the source repository, base/fixed commits, PR metadata, difficulty, repo size bucket, and hidden test strategy. Hidden tests live under `benchmark/cases/*/hidden-tests/` and are copied only into benchmark-controlled test execution, not into the agent prompt.

## Matrix Runs

Baseline harness/model conditions are defined in:

```text
benchmark/conditions/baseline.json
```

Preview the current baseline matrix:

```bash
node scripts/run-matrix.mjs --dryRun true
```

Run a selected subset:

```bash
node scripts/run-matrix.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --harness codex,cursor \
  --includeVerify true \
  --agentTimeoutMs 900000
```

`run-matrix.mjs` runs sequentially. This keeps Cursor CLI config writes serialized and makes raw logs easier to audit. Agent failures are benchmark outcomes; infrastructure failures are marked separately as invalid runs when detectable.

Each agent run writes:

```text
benchmark/runs/<run-id>/
  result.json
  prompt.txt
  prompt-bundle.json
  harness.events.jsonl
  harness.result.json
  harness.stderr.log
  harness.diff.patch
  harness.git-status.txt
```

Raw harness logs are intentionally preserved. Parser or metric fixes should use `scripts/refresh-result-metrics.mjs` to re-normalize existing results before rerunning expensive jobs.

## Reports

Regenerate the report from local run data:

```bash
find benchmark/runs -mindepth 1 -maxdepth 1 -type d \
  | node scripts/render-results.mjs benchmark/runs benchmark/reports/results.html
```

The HTML report excludes invalid runs from success-rate summaries, displays invalid runs separately, and keeps reported costs separate from rate-card estimates.

Apply a rate card to existing results:

```bash
node scripts/apply-rate-card.mjs \
  --rateCard benchmark/rate-cards/example-2026-05-03.json
```

The example rate card is a schema placeholder. Fill in real rates before publishing estimated cost comparisons, and keep Cursor estimates labeled as API-equivalent estimates rather than subscription billing truth.

## Run Data Policy

Do not commit `benchmark/runs/` or `benchmark/workspaces/`. They are ignored local working data and can be large. Commit case definitions, hidden tests, docs, scripts, condition configs, and generated reports intentionally.

## Future Interventions

Prompt or Agent Skill experiments should be added as separate condition files under `benchmark/conditions/`. Keep baseline runs memory-free and free of custom rules so intervention comparisons can be isolated by `condition_id`.
