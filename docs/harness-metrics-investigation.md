# Harness Metrics Investigation

HarnessBench records raw harness logs and normalized metrics. Normalized metrics
are useful for reporting, but raw logs are the source of truth.

## Semantics

Do not compare a field across harnesses without checking how it is produced.

| Field | Meaning |
| --- | --- |
| `conversation_turns` | Harness-level completed turns or closest observable equivalent. |
| `assistant_messages` | Assistant/model messages or action steps when observable. |
| `tool_calls` | Observable tool calls. For Codex this is `command_calls + file_changes`. |
| `fresh_input_tokens` | Non-cache input tokens. |
| `cache_read_tokens` | Cached input read tokens. |
| `cache_write_tokens` | Cache creation/write tokens. |
| `effective_input_tokens` | Fresh input plus cache reads/writes, or harness-native effective input. |
| `effective_total_tokens` | `effective_input_tokens + output_tokens`. |
| `cost_usd` | Reported cost when provided, otherwise rate-card estimate when possible. |

## Codex

Observed Codex JSONL usage includes cached input in `input_tokens`. Normalize as:

```text
fresh_input_tokens = input_tokens - cache_read_tokens
effective_input_tokens = fresh_input_tokens + cache_read_tokens + cache_write_tokens
```

Codex does not directly report dollar cost in the observed stream; use a rate
card for estimates.

## Claude Code

Claude aggregate JSON reports `num_turns` and dollar cost directly. Treat
`num_turns` as a harness-level turn proxy, not as a count directly comparable to
Cursor or Codex assistant messages.

Observed Claude `input_tokens` are fresh input. Effective input includes cache
read/write tokens when present.

## Cursor Agent

Cursor stream JSON emits action/tool events and model usage. `--model` does not
always select the intended UI model variant; high-effort Cursor model selection
may require temporary CLI config injection. Confirm selected model from the
stream `system/init` event.

Observed Cursor `input_tokens` are fresh input. Effective input includes cache
read/write tokens when present. Cursor cost usually requires a rate card.

## Reporting Rules

- Show unavailable cost as unavailable, not zero.
- Keep reported and estimated cost separate.
- Show invalid runs separately from benchmark failures.
- Preserve raw logs for every run.
