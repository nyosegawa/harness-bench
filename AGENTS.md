# AGENTS.md

## Project Purpose

This repository is a benchmark harness for comparing debugging ability and efficiency across Codex, Claude Code, and Cursor Agent. It stores the benchmark spec, case definitions, hidden test scripts, runner scripts, candidate repository scans, and generated reports.

## Operating Rules

- Do not commit `benchmark/runs/`, `benchmark/workspaces/`, or `benchmark/archive/`; they are intentionally ignored and may be large.
- Preserve raw harness logs. Parser fixes should use raw logs to re-normalize existing results rather than rerunning expensive jobs when possible.
- Use `rg` for search when available; `grep` is acceptable until `ripgrep` is installed.
- Use `apply_patch` for manual file edits.
- Avoid destructive git commands. Do not delete run logs unless explicitly asked or they are clearly build artifacts such as nested `target/` directories.
- If a run fails because of infrastructure, mark the `result.json` with:

```json
{
  "invalid_run": true,
  "invalid_reason": "infrastructure failure: ..."
}
```

Invalid runs are excluded from experiment `results.html` by `scripts/render-results.mjs`.

## Runtime Setup

The current environment has:

- Node.js installed under `~/.local/opt/node-v22.21.1-linux-*/`
- `~/.local/bin` and `~/.cargo/bin` appended to `~/.profile` and `~/.bashrc`
- Rust available via `~/.cargo/bin`

For non-interactive SSH commands, use:

```bash
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
```

Basic checks:

```bash
node --version
cargo --version
node --check scripts/run-case.mjs
node --check scripts/render-results.mjs
node --check scripts/render-experiment-index.mjs
node --check scripts/run-matrix.mjs
node --check scripts/review-failed-runs.mjs
node --check scripts/apply-rate-card.mjs
node --check scripts/refresh-result-metrics.mjs
```

## Repository Layout

- `docs/benchmark-spec.md`: benchmark design and selection rules
- `docs/runner.md`: runner behavior, metrics schema, cost policy
- `docs/harness-metrics-investigation.md`: observed CLI metrics behavior
- `docs/end-to-end-smoke.md`: pilot results and current benchmark state
- `benchmark/cases/`: case YAML and hidden tests
- `benchmark/repos/`: candidate repository and PR scan outputs
- `benchmark/experiments/`: immutable experiment artifacts (`manifest.json`, `summary.json`, `failure-reviews.json`, `results.html`)
- `benchmark/reports/index.html`: generated experiment index
- `benchmark/rate-cards/`: rate card schema and example
- `scripts/run-case.mjs`: verify and agent run runner
- `scripts/render-results.mjs`: experiment HTML report generator
- `scripts/render-experiment-index.mjs`: experiment index generator
- `scripts/review-failed-runs.mjs`: auxiliary failure review generator/schema validator
- `scripts/refresh-result-metrics.mjs`: raw-log based result metric refresher
- `scripts/apply-rate-card.mjs`: applies rate-card cost estimates to existing results

## Current Metric Semantics

Do not collapse all token or turn metrics into a single ambiguous number.

- `conversation_turns`: harness-level completed turns.
- `assistant_messages`: assistant/model messages or action steps when observable.
- `tool_calls`: observable tool calls. For Codex this is `command_calls + file_changes`.
- `fresh_input_tokens`: non-cache input.
- `cache_read_tokens`: cache read input.
- `cache_write_tokens`: cache creation/write input.
- `effective_input_tokens`: fresh input plus cache read/write, or harness-native effective input.
- `effective_total_tokens`: `effective_input_tokens + output_tokens`.
- Codex `input_tokens` includes cached input in observed JSONL. Use `fresh_input_tokens = input_tokens - cache_read_tokens`.
- Claude and Cursor observed `input_tokens` are fresh input. Their effective input includes cache read/write.
- Claude reports dollar cost directly. Codex and Cursor need rate-card estimation.

## Common Commands

Generate an experiment HTML report:

```bash
node scripts/render-results.mjs \
  --runsRoot benchmark/runs \
  --matrixId sanitized-baseline-2026-05-03 \
  --reviewFile benchmark/experiments/sanitized-baseline-2026-05-03/failure-reviews.json \
  --output benchmark/experiments/sanitized-baseline-2026-05-03/results.html
```

Run an official baseline experiment:

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

Re-normalize existing run metrics from raw logs:

```bash
node scripts/refresh-result-metrics.mjs benchmark/runs
```

Verify case base/fixed behavior:

```bash
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-base
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-fixed
```

Run one agent condition:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode agent \
  --harness codex \
  --model gpt-5.5 \
  --effort medium \
  --agentTimeoutMs 900000
```

## Harness Commands

The runner currently uses these baseline forms:

- Codex: `codex exec --json --ignore-user-config --ignore-rules --ephemeral --disable memories --disable plugins --disable apps --disable browser_use --disable computer_use --sandbox workspace-write -m gpt-5.5 -c 'model_reasoning_effort="medium"' -C "$repo" "$prompt"`
- Claude: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude -p --output-format json --no-session-persistence --model claude-opus-4-7 --effort medium --permission-mode bypassPermissions --setting-sources project --settings "$settings" "$prompt"`
- Cursor: `agent -p --output-format stream-json --trust --workspace "$repo" --model gpt-5.5-medium "$prompt"`

Memory should remain disabled for baseline runs.

## Repository Notes

The GitHub repository is private:

```text
nyosegawa/harness-debug-benchmark
```

Expected checkout:

```bash
cd /home/sakasegawa/src/github.com/nyosegawa/harness-debug-benchmark
```

`benchmark/runs/` and `benchmark/workspaces/` are local working data and are intentionally ignored by git.
