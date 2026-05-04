# HarnessBench

HarnessBench compares coding-agent harnesses on real-repository debugging
tasks.

The benchmark asks each harness to fix the same bug from the same sanitized
repository checkout, then scores the patch with hidden behavioral tests. The
current scope is Codex, Claude Code, and Cursor Agent, but the condition schema
is harness-neutral.

Project name:

```text
HarnessBench: Comparing Coding Agent Harnesses on Real-Repository Debugging Tasks
Repository: nyosegawa/harness-bench
```

## Design

HarnessBench uses a two-layer scoring model:

- `core_tests`: the observable bug-fix contract. Every core test must pass.
- `regression_tests`: targeted surrounding behavior that must not break. Every
  regression test must pass.

Official cases use:

```yaml
test_strategy:
  core_tests:
    - benchmark/cases/<repo>/hidden-tests/<difficulty>/core.sh
  regression_tests:
    - benchmark/cases/<repo>/hidden-tests/<difficulty>/regression.sh
  success_rule: core_and_regression
```

Core tests define the required user-visible behavior as a behavioral contract.
Regression tests protect nearby behavior that should remain unchanged.

## Artifact Policy

`benchmark/runs/`, `benchmark/workspaces/`, and `benchmark/archive/` are local
data and are ignored by git. Raw logs are preserved under `benchmark/archive/`
when experiments are reset.

Official, publishable experiment artifacts live under:

```text
benchmark/experiments/<experiment-id>/
  manifest.json
  summary.json
  failure-reviews.json
  results.html
```

The public report index is:

```text
benchmark/reports/index.html
```

After a reset, old experiments are archived locally and are not part of the
public benchmark record.

## Citation

Use the repository citation metadata in `CITATION.cff`. A paper citation can be
added there after the manuscript is public.

## Quick Checks

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

## Verify A Case

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode verify-base

node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode verify-fixed
```

Expected case quality gate:

- `verify-base` fails.
- `verify-fixed` passes.
- failure output identifies whether the miss is in core or regression.

## Run A Matrix

```bash
node scripts/run-matrix.mjs \
  --experimentId harnessbench-smoke-YYYY-MM-DD \
  --conditions benchmark/conditions/baseline.json \
  --includeVerify true \
  --includeAgents true \
  --jobs 3 \
  --agentTimeoutMs 3600000 \
  --maxInfraRetries 1 \
  --rateCard benchmark/rate-cards/api-equivalent-2026-05-03.json \
  --review true \
  --reviewJobs 3 \
  --report true
```

Official runs use a 60 minute per-issue timeout. Cursor conditions that require CLI model configuration should run with
`--jobs 1` unless the runner has been updated to isolate Cursor configuration
per process.

To run only the 27-case authoring gate without agent jobs:

```bash
node scripts/run-matrix.mjs \
  --experimentId harnessbench-v2-verify-YYYY-MM-DD \
  --conditions benchmark/conditions/baseline.json \
  --includeVerify true \
  --includeAgents false \
  --jobs 3
```

## Sanitization

Runner-managed agent workspaces remove upstream steering files before the agent
starts:

```text
AGENTS.md
agents.md
CLAUDE.md
claude.md
.agents/
.claude/
.codex/
```

The sanitized tree is materialized as a fresh one-commit git repository for
agent runs. This prevents `git diff`, `git show`, or `git log` from exposing
deleted steering instructions.

## Failure Review

The hidden tests are authoritative. LLM failure reviews are auxiliary evidence:
they summarize likely root cause, whether the patch partially solved the issue,
and whether a false-negative investigation is warranted. Reviews are schema
validated before being included in reports.
