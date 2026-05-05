# Runner

HarnessBench runners execute case verification, agent runs, matrix orchestration,
metric normalization, regrading, failure review, and report generation.

## Single Case Runner

```bash
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-base
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-fixed
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode agent --harness codex --model gpt-5.5 --effort medium
```

Modes:

- `verify-base`: checkout `base_commit` and run hidden scoring tests
- `verify-fixed`: checkout `fixed_commit` and run hidden scoring tests
- `verify-current`: run hidden scoring tests against an existing checkout
- `agent`: checkout `base_commit`, run the agent, then score the patch

## Test Strategy

The runner supports the final two-layer HarnessBench strategy:

```yaml
test_strategy:
  core_tests:
    - benchmark/cases/<repo>/hidden-tests/<difficulty>/core.sh
  regression_tests:
    - benchmark/cases/<repo>/hidden-tests/<difficulty>/regression.sh
  success_rule: core_and_regression
```

Success means:

```text
all core_tests pass AND all regression_tests pass
```

`core_and_regression` is the only supported success rule. Cases must provide an
explicit `test_strategy`.

## Matrix Runner

```bash
node scripts/run-matrix.mjs \
  --experimentId harnessbench-baseline-YYYY-MM-DD \
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

Use `--includeAgents false` with `--includeVerify true` for the 27-case
authoring gate before expensive agent runs.

`--jobs` controls concurrent `run-case.mjs` processes. Official agent runs use
a 60 minute per-issue timeout. Cursor conditions that use `cursor_config` are
serialized by `run-matrix.mjs` because Cursor stores model selection in a host
CLI config file. Codex and Claude jobs can still fill the remaining worker
slots.

When both `--includeVerify` and `--includeAgents` are enabled, `run-matrix.mjs`
uses a hard stage boundary: all base/fixed verification jobs must finish before
any agent job starts. If verification produces a matrix failure, agent jobs are
skipped.

## Agent Matrix Resume

`scripts/resume-agent-matrix.mjs` resumes an interrupted agent matrix without
rerunning completed agent results. It scans `benchmark/runs/**/result.json` for
existing `(matrix_id, case_id, condition_id)` agent pairs, then invokes
`scripts/run-case.mjs` only for missing pairs.

Use it only after the verify stage has already passed for the same case set.
It does not change prompts, cases, conditions, Docker images, or scoring logic;
it only changes scheduling. Cursor jobs that write Cursor CLI config remain
serialized.

Example:

```bash
node scripts/resume-agent-matrix.mjs \
  --matrixId harnessbench-v2-official-2026-05-04c \
  --conditions benchmark/conditions/baseline.json \
  --agentTimeoutMs 3600000 \
  --rateCard benchmark/rate-cards/api-equivalent-2026-05-03.json \
  --jobs 3 \
  --minFreeGb 100
```

## Result Layout

Each run writes:

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
  core-0.stdout.log
  core-0.stderr.log
  regression-0.stdout.log
  regression-0.stderr.log
```

Not every harness writes every raw file. Raw harness logs are kept because
normalizers can improve after a run.

## Result Schema

Key fields:

```json
{
  "case_id": "sharkdp-bat-low-zip-binary-detection",
  "mode": "agent",
  "harness": "codex",
  "model": "gpt-5.5",
  "effort": "medium",
  "condition_id": "codex:gpt-5.5:medium:baseline",
  "matrix_id": "harnessbench-baseline-YYYY-MM-DD",
  "test_result": {
    "success": true,
    "success_rule": "core_and_regression",
    "core_pass": true,
    "regression_pass": true,
    "core": [],
    "regressions": []
  }
}
```

Each agent run also records harness version metadata:

```json
{
  "harness_version": {
    "name": "codex",
    "version_string": "codex-cli 0.125.0",
    "binary_path": "/home/user/.local/bin/codex",
    "binary_sha256": "...",
    "raw_version_output": "codex-cli 0.125.0\n",
    "captured_at": "2026-05-04T10:23:45.123Z"
  }
}
```

Test metrics:

```json
{
  "metrics": {
    "tests": {
      "total_duration_ms": 1000,
      "core_duration_ms": 700,
      "regression_duration_ms": 300
    }
  }
}
```

## Invalid Runs

A benchmark failure is a valid outcome. An infrastructure failure is marked:

```json
{
  "invalid_run": true,
  "invalid_reason": "infrastructure failure: ..."
}
```

Invalid runs are preserved but excluded from success-rate summaries.

## Sanitization

Runner-managed agent workspaces remove target-repository steering files:

```text
AGENTS.md
agents.md
CLAUDE.md
claude.md
.agents/
.claude/
.codex/
```

The sanitized workspace is re-materialized as a fresh one-commit git repository
before the agent starts.

## Hybrid Docker Execution

The runner executes repository setup and tests inside Docker when a case defines
`environment.image`. The agent CLI remains on the host and edits the host
workspace.

Docker Sandboxes are not used by the HarnessBench v2 runner. The decision is
recorded in
[`ADR-0001`](adr/0001-do-not-adopt-docker-sandboxes-for-v2.md).

Container responsibilities:

- `setup`
- optional `public_tests`
- `core_tests`
- `regression_tests`

Hidden scoring containers run with `--network none`. The benchmark root or a
hidden-test bundle is mounted read-only, and the workspace is mounted at the
case `environment.workdir` path.

## Metrics

Normalized fields:

- `wall_time_ms`
- `harness_duration_ms`
- `conversation_turns`
- `assistant_messages`
- `tool_calls`
- `command_calls`
- `file_changes`
- `fresh_input_tokens`
- `cache_read_tokens`
- `cache_write_tokens`
- `effective_input_tokens`
- `output_tokens`
- `reasoning_tokens`
- `effective_total_tokens`
- `cost_usd`
- `cost_source`
- `harness_version.version_string`
- `harness_version.binary_sha256`

Harness-specific semantics are documented in
`docs/harness-metrics-investigation.md`.
