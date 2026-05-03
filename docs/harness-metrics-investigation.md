# Harness Metrics Investigation

This document records what each CLI exposes for benchmark metrics.

## Summary

| Harness | Recommended capture | Tokens | Turns | Tool calls | Duration | Cost |
| --- | --- | --- | --- | --- | --- | --- |
| Codex CLI | `codex exec --json` JSONL | yes | derive from `turn.completed` | derive from events when present | runner wall time | not observed |
| Claude Code | `claude -p --output-format json` | yes | `num_turns` | available in stream/transcript, not primary JSON aggregate | `duration_ms`, runner wall time | `total_cost_usd` |
| Cursor Agent | `agent -p --output-format stream-json` JSONL | yes | derive from events | count completed `tool_call` events | `duration_ms`, runner wall time | not observed |

## Codex CLI

Observed version:

```text
codex-cli 0.125.0
```

Recommended command:

```bash
codex exec --json ... "$PROMPT" > harness.events.jsonl 2> harness.stderr.log
```

Observed final event:

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

Capture:

- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `reasoning_output_tokens`
- turn count by counting `turn.completed`
- assistant message count by counting completed `agent_message` items
- command count by counting completed `command_execution` items
- file-change count by counting completed `file_change` items

`turn.completed` is a Codex exec turn count. In a single-prompt `codex exec` run it can be `1` even when the agent performs many commands and edits, so reports must show action counts next to conversation turns. `file_change` counts are edit events, not unique files; one event can contain multiple changed paths.

Codex `input_tokens` includes `cached_input_tokens` in the observed JSONL. Normalize:

- `fresh_input_tokens = input_tokens - cached_input_tokens`
- `effective_input_tokens = input_tokens`
- `effective_total_tokens = effective_input_tokens + output_tokens`

Cost was not observed in CLI JSONL. Estimate later from token usage if needed.

Use `--rateCard` or `scripts/apply-rate-card.mjs` to estimate API-equivalent cost from:

- `fresh_input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `reasoning_output_tokens`

## Claude Code

Observed version:

```text
2.1.126
```

Recommended command:

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
- `session_id`

Observed `usage` fields:

- `input_tokens`
- `cache_creation_input_tokens`
- `cache_read_input_tokens`
- `output_tokens`
- `server_tool_use`

Claude is the only investigated harness that directly reports dollar cost. Store `total_cost_usd` with `cost_source: reported`.

Observed Claude `usage.input_tokens` is fresh input only. Cache reads/writes can dominate the actual context processed, so reports should display:

- `fresh_input_tokens = usage.input_tokens`
- `cache_read_tokens = usage.cache_read_input_tokens`
- `cache_write_tokens = usage.cache_creation_input_tokens`
- `effective_input_tokens = fresh_input_tokens + cache_read_tokens + cache_write_tokens`
- `effective_total_tokens = effective_input_tokens + output_tokens`

`assistant_messages` is not independently observable in the saved aggregate JSON. The benchmark stores `num_turns` there as a Claude-specific proxy. `tool_calls`, `command_calls`, and `file_changes` remain unavailable unless future runs capture stream-json transcripts.

`stream-json` requires `--verbose` in the observed version. It can be useful for live event timing, but the final JSON result is easier for batch metrics.

## Cursor Agent CLI

Observed version:

```text
2026.05.01-eea359f
```

Recommended command:

```bash
agent -p --output-format stream-json ... "$PROMPT" > harness.events.jsonl 2> harness.stderr.log
```

Observed events:

```json
{"type":"system","subtype":"init","model":"GPT-5.5 272K Medium"}
{"type":"user","message":{"role":"user"}}
{"type":"assistant","message":{"role":"assistant"}}
{"type":"result","duration_ms":11635,"duration_api_ms":11635,"usage":{"inputTokens":350,"outputTokens":5,"cacheReadTokens":14336,"cacheWriteTokens":0}}
```

Capture:

- model from `system` init event
- `inputTokens`
- `outputTokens`
- `cacheReadTokens`
- `cacheWriteTokens`
- duration from result event
- tool calls from completed `tool_call` events
- conversation turns / assistant messages by counting assistant events
- shell command calls from completed `shellToolCall` events
- file edit events from completed `editToolCall`, `writeToolCall`, and `deleteToolCall` events

Cursor does not expose a completed-turn primitive equivalent to Codex `turn.completed`. The benchmark stores assistant/action-step event count as both `conversation_turns` and `assistant_messages`; reports should treat that as a Cursor-specific action-step count.

Observed Cursor `inputTokens` is fresh input. Normalize:

- `fresh_input_tokens = inputTokens`
- `effective_input_tokens = inputTokens + cacheReadTokens + cacheWriteTokens`
- `effective_total_tokens = effective_input_tokens + outputTokens`

Do not use `--stream-partial-output` for benchmark runs unless deduplication is implemented. It can emit partial assistant events that distort turn counts.

Cost was not observed in Cursor CLI output or local runtime logs. Estimate later from token usage if needed.

Use `--rateCard` or `scripts/apply-rate-card.mjs` to estimate API-equivalent cost from:

- `inputTokens`
- `cacheReadTokens`
- `outputTokens`
- `cacheWriteTokens`

Cursor estimates may not match Cursor billing.

## Runner Implications

The runner should write both:

- normalized metrics in `result.json`
- raw harness output files

Raw files allow parser corrections later without rerunning expensive benchmark jobs.

Required raw files for agent mode:

```text
harness.stdout.log
harness.stderr.log
harness.events.jsonl
harness.result.json
harness.diff.patch
```

Not every harness will produce every raw file. Missing files should be recorded as `null`, not silently omitted.
