# Harness Debug Benchmark

Benchmark harness for comparing debugging ability and operating efficiency
across Codex, Claude Code, and Cursor Agent on real repository bugs.

The repository tracks benchmark specifications, case definitions, hidden tests,
runner scripts, condition configs, rate cards, and immutable experiment reports.
Raw run logs and cloned workspaces are local data and are intentionally ignored.

## Quick Checks

```bash
node --check scripts/run-case.mjs
node --check scripts/run-matrix.mjs
node --check scripts/render-results.mjs
node --check scripts/render-experiment-index.mjs
node --check scripts/review-failed-runs.mjs
node --check scripts/refresh-result-metrics.mjs
node --check scripts/apply-rate-card.mjs
```

## Artifact Model

Official benchmark results are experiment artifacts under:

```text
benchmark/experiments/<experiment-id>/
  manifest.json
  summary.json
  failure-reviews.json
  results.html
```

`manifest.json` records the matrix id, case and condition inputs, runner git
commit, script hashes, prompt bundle hashes, rate card, and raw run ids.
`summary.json` records aggregate pass/fail, invalid runs, timing, and cost.
`failure-reviews.json` stores bilingual auxiliary implementation reviews.
`results.html` is the immutable report for that experiment.

The top-level experiment index is:

```text
benchmark/reports/index.html
```

Current sanitized baseline:

```text
benchmark/experiments/sanitized-baseline-2026-05-03/results.html
```

It contains 81 baseline agent runs across 27 cases. After one oracle
false-negative fix and preserved-workspace regrade, the hidden-oracle pass
counts are Codex 19/27, Claude Code 20/27, and Cursor Agent 23/27, with 0
invalid runs.

Current Cursor Composer 2 follow-up:

```text
benchmark/experiments/cursor-composer-2-2026-05-03/results.html
```

It uses the same 27 cases with the `cursor:composer-2:baseline` condition.
The run passed 15/27 cases with 0 invalid runs. Composer 2 pricing is not in
the local rate card, so cost is reported as unavailable rather than estimated.

Limitation: this recorded baseline removed repository-local steering files from
the working tree, but it was run before fresh git-root materialization was
implemented. Future runs close that gap by re-initializing runner-managed agent
workspaces as a sanitized one-commit repository before the agent starts.

## Run An Official Experiment

Baseline conditions are defined in `benchmark/conditions/baseline.json`.
Runner-managed agent workspaces remove upstream agent steering files and
materialize the sanitized tree as a fresh one-commit git repository before the
agent starts.

Preview:

```bash
node scripts/run-matrix.mjs \
  --experimentId sanitized-baseline-2026-05-03 \
  --includeVerify true \
  --jobs 3 \
  --dryRun true
```

Run:

```bash
node scripts/run-matrix.mjs \
  --experimentId sanitized-baseline-2026-05-03 \
  --includeVerify true \
  --jobs 3 \
  --agentTimeoutMs 900000 \
  --maxInfraRetries 1 \
  --rateCard benchmark/rate-cards/api-equivalent-2026-05-03.json \
  --review true \
  --report true
```

`--jobs` controls concurrent `run-case.mjs` processes. Agent runs use isolated
per-run workspaces. Verify jobs are serialized per repository workspace to
avoid `.git/index.lock` collisions.

## Case Verification

Each case has a base commit expected to fail hidden tests and a fixed commit
expected to pass:

```bash
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-base
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-fixed
```

Hidden tests live under `benchmark/cases/*/hidden-tests/` and are never shown
to the agent prompt.

## Failure Reviews

LLM-as-a-judge is auxiliary only. Hidden tests remain the source of pass/fail
truth. Review generation explains how failed implementations went wrong.

Validate an experiment review file:

```bash
node scripts/review-failed-runs.mjs \
  --runsRoot benchmark/runs \
  --matrixId sanitized-baseline-2026-05-03 \
  --output benchmark/experiments/sanitized-baseline-2026-05-03/failure-reviews.json
```

Generate missing bilingual Codex reviews in parallel:

```bash
node scripts/review-failed-runs.mjs \
  --runsRoot benchmark/runs \
  --matrixId sanitized-baseline-2026-05-03 \
  --output benchmark/experiments/sanitized-baseline-2026-05-03/failure-reviews.json \
  --generate \
  --jobs 4
```

## Local Data Policy

Do not commit:

```text
benchmark/runs/
benchmark/workspaces/
benchmark/archive/
```

Raw harness logs are valuable. Parser fixes should use
`scripts/refresh-result-metrics.mjs` to re-normalize existing logs rather than
rerunning expensive jobs whenever possible.

## Future Interventions

Prompt, Agent Skill, memory, or tool-use experiments should use separate
condition files under `benchmark/conditions/` and a distinct `experimentId`.
Baseline runs must keep memory and repository-local agent steering disabled.
