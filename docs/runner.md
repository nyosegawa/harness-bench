# Benchmark Runner

`scripts/run-case.mjs` is the initial runner. It supports agent-free verification modes and agent execution mode:

- `verify-base`
- `verify-fixed`
- `verify-current`
- `agent`

The runner reads a case YAML file, checks out the requested commit, executes the case `test_strategy`, and writes a structured result under `benchmark/runs/`.

## Usage

Verify that a case fails on the base commit:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode verify-base
```

Verify that a case passes on the fixed commit:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode verify-fixed
```

Verify the currently checked out repository state:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode verify-current
```

Optional paths:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode verify-fixed \
  --workRoot benchmark/workspaces \
  --runsRoot benchmark/runs \
  --repoDir benchmark/workspaces/sharkdp__bat
```

Run one agent condition:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode agent \
  --harness codex \
  --model gpt-5.5 \
  --effort medium
```

Claude:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode agent \
  --harness claude \
  --model claude-opus-4-7 \
  --effort medium
```

Cursor:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode agent \
  --harness cursor \
  --model gpt-5.5-medium
```

Set a timeout:

```bash
node scripts/run-case.mjs ... --agentTimeoutMs 900000
```

Estimate cost during a run:

```bash
node scripts/run-case.mjs ... \
  --rateCard benchmark/rate-cards/example-2026-05-03.json
```

## Result Layout

Each run writes:

```text
benchmark/runs/<run-id>/
  result.json
  prompt.txt
  harness.events.jsonl
  harness.result.json
  harness.stderr.log
  harness.diff.patch
  harness.git-status.txt
  core-0.stdout.log
  core-0.stderr.log
```

Not every harness writes every raw file. For example, Claude writes `harness.result.json`; Codex and Cursor write `harness.events.jsonl`.

`result.json` includes:

- case id
- case path
- repo
- mode
- checkout commit
- test strategy
- per-test stdout/stderr paths
- pass/fail state
- duration
- metrics

Current metrics shape:

```json
{
  "metrics": {
    "wall_time_ms": 194125,
    "harness": null,
    "tests": {
      "total_duration_ms": 163755,
      "core_duration_ms": 163755,
      "regression_duration_ms": 0,
      "oracle_duration_ms": 0
    },
    "usage": {
      "conversation_turns": null,
      "turns": null,
      "assistant_messages": null,
      "tool_calls": null,
      "command_calls": null,
      "file_changes": null,
      "fresh_input_tokens": null,
      "input_tokens": null,
      "effective_input_tokens": null,
      "output_tokens": null,
      "reasoning_tokens": null,
      "cache_read_tokens": null,
      "cache_write_tokens": null,
      "fresh_total_tokens": null,
      "effective_total_tokens": null,
      "total_tokens": null,
      "cost_usd": null,
      "cost_source": null,
      "raw_usage": null
    }
  }
}
```

In verify modes, harness usage fields are `null`; test duration fields are populated.

If a run cannot be evaluated because of an infrastructure failure after the
agent has run, mark it with:

```json
{
  "invalid_run": true,
  "invalid_reason": "infrastructure failure: ..."
}
```

Invalid runs are preserved for auditability but excluded from `results.html`.

## Harness Metrics

Agent mode must capture both normalized metrics and raw harness logs. Normalized metrics make cross-harness comparison possible; raw logs make future parser fixes possible.

### Required Normalized Fields

- `wall_time_ms`: elapsed runner wall time for the whole run
- `harness_duration_ms`: elapsed subprocess wall time for the agent command
- `conversation_turns`: harness-level completed conversation turns, when defined
- `turns`: backwards-compatible alias for `conversation_turns`
- `assistant_messages`: assistant messages or model action steps, when observable
- `tool_calls`: number of tool calls if observable
- `command_calls`: shell command executions, when distinguishable
- `file_changes`: file edit events, when distinguishable
- `fresh_input_tokens`: non-cache-read input tokens
- `input_tokens`: harness-native input field; for Codex this includes cache reads, for Claude/Cursor this is fresh input
- `effective_input_tokens`: fresh input plus cache read/write tokens, or harness-native effective input
- `output_tokens`
- `reasoning_tokens`
- `cache_read_tokens`
- `cache_write_tokens`
- `fresh_total_tokens`: `fresh_input_tokens + output_tokens`
- `effective_total_tokens`: `effective_input_tokens + output_tokens`
- `total_tokens`: backwards-compatible alias for `effective_total_tokens`
- `cost_usd`
- `cost_source`: `reported`, `estimated`, or `unavailable`
- `model`
- `raw_usage`

### Codex CLI

Use `codex exec --json` and capture stdout as JSONL.

Recommended shape:

```bash
codex exec --json ... "$PROMPT" > harness.events.jsonl 2> harness.stderr.log
```

Observed final usage event:

```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 22098,
    "cached_input_tokens": 3456,
    "output_tokens": 21,
    "reasoning_output_tokens": 9
  }
}
```

Codex metrics:

- `conversation_turns`: count `turn.completed`
- `assistant_messages`: count completed `agent_message` items
- `command_calls`: count completed `command_execution` items
- `file_changes`: count completed `file_change` items
- `tool_calls`: `command_calls + file_changes`
- `input_tokens`: final `usage.input_tokens`
- `fresh_input_tokens`: `usage.input_tokens - usage.cached_input_tokens`
- `effective_input_tokens`: `usage.input_tokens`
- `cache_read_tokens`: `usage.cached_input_tokens`
- `output_tokens`: `usage.output_tokens`
- `reasoning_tokens`: `usage.reasoning_output_tokens`
- `effective_total_tokens`: `effective_input_tokens + output_tokens`
- `cost_usd`: not directly reported by observed CLI JSONL
- `cost_source`: `unavailable` unless offline estimation is added
- `wall_time_ms` / `harness_duration_ms`: measured by runner

Do not rely on normal human stdout for benchmark metrics. It has a formatted `tokens used` value but not enough breakdown.

### Claude Code CLI

Use `--output-format json` as the primary capture path.

```bash
claude -p --output-format json ... "$PROMPT" > harness.result.json 2> harness.stderr.log
```

Observed top-level fields:

- `duration_ms`
- `duration_api_ms`
- `num_turns`
- `total_cost_usd`
- `usage`
- `modelUsage`
- `stop_reason`
- `terminal_reason`
- `permission_denials`
- `session_id`
- `uuid`

Claude metrics:

- `conversation_turns`: `num_turns`
- `assistant_messages`: `num_turns`
- `fresh_input_tokens`: `usage.input_tokens`
- `input_tokens`: `usage.input_tokens`
- `cache_read_tokens`: `usage.cache_read_input_tokens`
- `cache_write_tokens`: `usage.cache_creation_input_tokens`
- `effective_input_tokens`: `input_tokens + cache_read_tokens + cache_write_tokens`
- `output_tokens`: `usage.output_tokens`
- `effective_total_tokens`: `effective_input_tokens + output_tokens`
- `cost_usd`: `total_cost_usd`
- `cost_source`: `reported`
- `raw_usage`: include `usage` and `modelUsage`

`stream-json` requires `--verbose` in the observed version. The final `type=result` record has equivalent aggregate fields, but JSON output is simpler for batch runs.

### Cursor Agent CLI

Use `--output-format stream-json` and capture stdout as JSONL.

```bash
agent -p --output-format stream-json ... "$PROMPT" > harness.events.jsonl 2> harness.stderr.log
```

Observed event shape from earlier probes:

```json
{
  "type": "result",
  "subtype": "success",
  "duration_ms": 9852,
  "duration_api_ms": 9852,
  "is_error": false,
  "result": "OK",
  "session_id": "...",
  "request_id": "...",
  "usage": {
    "inputTokens": 142,
    "outputTokens": 28,
    "cacheReadTokens": 14336,
    "cacheWriteTokens": 0
  }
}
```

Cursor metrics:

- `conversation_turns`: count assistant events
- `assistant_messages`: count assistant events
- `tool_calls`: count `tool_call` events with `subtype: "completed"`
- `fresh_input_tokens`: `usage.inputTokens`
- `input_tokens`: `usage.inputTokens`
- `output_tokens`: `usage.outputTokens`
- `cache_read_tokens`: `usage.cacheReadTokens`
- `cache_write_tokens`: `usage.cacheWriteTokens`
- `effective_input_tokens`: `inputTokens + cacheReadTokens + cacheWriteTokens`
- `effective_total_tokens`: `effective_input_tokens + outputTokens`
- `duration_ms`: result `duration_ms`
- `cost_usd`: not observed in stream-json result
- `cost_source`: `unavailable` unless offline estimation is added

Do not use `--stream-partial-output` for benchmark runs unless turn counting deduplication is implemented. Partial output can emit multiple assistant events for the same response.

Cursor runs should be serialized unless config isolation is implemented, because the CLI writes `~/.cursor/cli-config.json`.

## Cost Policy

Cost availability differs by harness:

- Claude Code: reported directly as `total_cost_usd`.
- Codex CLI: not observed in `--json`; store token usage and estimate offline if needed.
- Cursor Agent CLI: not observed in `json` or `stream-json`; store token usage and estimate offline if needed.

The runner should never silently mix reported and estimated costs. Use:

- `cost_source: "reported"` for harness-reported dollar values
- `cost_source: "estimated"` for rate-card derived values
- `cost_source: "unavailable"` when no cost is available

If cost is estimated, store the rate-card identifier or file hash in run metadata.

Rate card format:

```json
{
  "id": "example-2026-05-03",
  "currency": "USD",
  "unit": "per_1m_tokens",
  "aliases": {
    "GPT-5.5 272K Medium": "gpt-5.5",
    "gpt-5.5-medium": "gpt-5.5"
  },
  "models": {
    "gpt-5.5": {
      "input": 0,
      "cached_input": 0,
      "output": 0,
      "reasoning_output": 0,
      "cache_write": 0
    }
  }
}
```

Apply or re-apply a rate card to existing results:

```bash
node scripts/apply-rate-card.mjs \
  --rateCard benchmark/rate-cards/example-2026-05-03.json
```

Preview without writing:

```bash
node scripts/apply-rate-card.mjs \
  --rateCard benchmark/rate-cards/example-2026-05-03.json \
  --dryRun true
```

Cursor estimates should be described as API-equivalent estimates, not actual Cursor subscription billing.

## Pilot Verification

The following checks have been run successfully for `sharkdp/bat`:

```bash
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-base
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-fixed

node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/mid.yaml --mode verify-base
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/mid.yaml --mode verify-fixed

node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/high.yaml --mode verify-base
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/high.yaml --mode verify-fixed
```

Expected outcomes:

- `verify-base`: exits non-zero
- `verify-fixed`: exits zero

Observed outcomes:

- low: base failed, fixed passed
- mid: base failed, fixed passed
- high: base failed, fixed passed

## Result Visualization

Generate the HTML report:

```bash
find benchmark/runs -mindepth 1 -maxdepth 1 -type d \
  | node scripts/render-results.mjs benchmark/runs benchmark/reports/results.html
```

Output:

```text
benchmark/reports/results.html
```

The report shows:

- pass/fail
- wall time
- harness duration
- test duration
- conversation turns and assistant messages
- tool calls
- command/file-change counts when available
- fresh input, cache read/write, effective input, output, reasoning, and effective total tokens
- cache usage
- reported/estimated/unavailable cost
- modified files via run details

## Current Limitations

- YAML parsing is intentionally minimal and only supports the current case file shape.
- Test commands are shell scripts that receive the repo path as their first argument.
- Rust compilation makes the `bat` pilot slow on cold runs.
- Cursor Max Mode config switching is not implemented in runner yet.
- Cost estimation requires a rate card with non-null rates. The runner and `scripts/apply-rate-card.mjs` use fresh input plus cache/read/write breakdowns to avoid double-counting cached input.

## Next Implementation Step

Next runner improvements:

1. Add Cursor Max Mode config switching.
2. Add batch matrix execution.
3. Add timeout and failure summaries to the HTML report.
