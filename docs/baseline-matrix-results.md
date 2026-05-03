# Baseline Matrix Results

This document summarizes the first full baseline matrix across the completed
27-case benchmark set.

Run data is local and intentionally untracked under `benchmark/runs/`. The
tracked report was regenerated at `benchmark/reports/results.html`.

## Matrix Runs

| Harness | Condition | Matrix ID | Cases | Pass | Rate |
| --- | --- | --- | ---: | ---: | ---: |
| Codex | `codex:gpt-5.5:medium:baseline` | `matrix-2026-05-02T20-45-13-252Z` | 27 | 18 | 66.7% |
| Claude Code | `claude:claude-opus-4-7:medium:baseline` | `matrix-2026-05-02T22-52-11-726Z` | 27 | 18 | 66.7% |
| Cursor Agent | `cursor:gpt-5.5-medium:baseline` | `matrix-2026-05-03T00-47-35-211Z` | 27 | 17 | 63.0% |

All baseline runs used memory-disabled harness commands. No infrastructure
retry was needed in these three full matrices.

## Speed And Usage

Wall time includes checkout/setup, agent work, and hidden test execution.

| Harness | Median Wall | Median Pass Wall | Median Turns | Median Assistant | Median Tools | Median Effective Total Tokens | Reported Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex | 248.9s | 248.9s | 1 | 9 | 36 | 1,172,347 | n/a |
| Claude Code | 224.6s | 254.7s | 20 | 20 | n/a | 618,693 | $22.62 |
| Cursor Agent | 186.6s | 174.8s | 7 | 7 | 33 | 980,871 | n/a |

Metric semantics differ by harness. In particular, Codex's single
conversation turn reflects one `codex exec` invocation; action volume is better
represented by assistant messages, command calls, file edits, and tool calls.
Claude's reported cost is native CLI output. Codex and Cursor costs require a
rate card.

## Success By Difficulty

| Harness | Low | Mid | High |
| --- | ---: | ---: | ---: |
| Codex | 6/9 | 7/9 | 5/9 |
| Claude Code | 7/9 | 6/9 | 5/9 |
| Cursor Agent | 6/9 | 6/9 | 5/9 |

High difficulty separated less than expected in aggregate because several high
cases were solved by all harnesses while a few low/mid cases exposed specific
implementation traps.

## Success By Size

| Harness | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Codex | 5/9 | 4/6 | 9/12 |
| Claude Code | 5/9 | 3/6 | 10/12 |
| Cursor Agent | 5/9 | 4/6 | 8/12 |

Large repository results are not uniformly harder because the hidden tests are
targeted and some large-repo fixes are localized.

## Shared Outcomes

Fourteen cases passed on all three harnesses.

Six cases failed on all three harnesses:

- `axios-axios-low-settle-error-code`
- `go-gitea-gitea-high-compare-no-common-history`
- `jesseduffield-lazygit-high-branch-divergence-fast-path`
- `langflow-ai-langflow-mid-mcp-connectable-inputs`
- `louislam-uptime-kuma-high-websocket-auth-options`
- `sharkdp-bat-high-fallback-syntax`

Seven cases split by harness:

| Case | Codex | Claude | Cursor |
| --- | --- | --- | --- |
| `go-gitea-gitea-mid-pr-merge-self-reference` | pass | pass | fail |
| `louislam-uptime-kuma-low-submillisecond-ping-chart` | fail | pass | fail |
| `louislam-uptime-kuma-mid-uptime-cleanup-buckets` | pass | fail | pass |
| `sharkdp-bat-low-zip-binary-detection` | pass | fail | pass |
| `sharkdp-bat-mid-control-character-wrapping` | fail | pass | fail |
| `usememos-memos-mid-mixed-case-user-resource-names` | pass | fail | pass |
| `vitejs-vite-low-flatten-id-sanitized-chars` | fail | pass | fail |

## Failure Classification

The observed failures are benchmark failures rather than infrastructure
failures. Each failed run recorded `core_pass: false` while regression and
oracle suites were either passing or empty. The hidden core tests produced
specific assertion failures:

- Axios low: returned `ERR_BAD_REQUEST` instead of the expected
  `ERR_BAD_RESPONSE`.
- Gitea high: unrelated histories did not return an error chain containing
  `ErrNotExist`.
- Lazygit high: helper functions required by the branch divergence fast path
  were missing, causing hidden tests to fail at build time.
- Langflow mid: MCP input type inference did not preserve the expected
  `Message` or `JSON` input types.
- Uptime Kuma high: websocket auth option handling either missed the exported
  helper or retained stale authorization headers.
- Uptime Kuma low: sub-millisecond ping chart extraction still failed in the
  targeted hidden script for Codex and Cursor.
- Bat high: harnesses changed or selected the wrong fallback option interface.
- Bat mid: Codex and Cursor still rendered NUL/DEL control characters as one
  physical line instead of the hidden test's expected wrapping behavior.
- Memos mid: Claude accepted numeric usernames where the hidden test expected
  them to remain invalid.
- Vite low: Codex and Cursor still produced `flattenId` collisions for
  sanitized path characters.

This does not prove the hidden tests are complete formal specifications, but
the failures are not just "public tests missed it" cases. They are concrete
hidden-oracle mismatches that should be counted as benchmark failures unless a
case's hidden expectation is later judged incorrect.

## Notes

- `benchmark/runs/` and `benchmark/workspaces/` remain local ignored data.
- Raw harness logs were preserved; `scripts/refresh-result-metrics.mjs` found
  no parser updates needed after these runs.
- The HTML report includes smoke and pilot runs as well as the three baseline
  matrices. Use matrix IDs above when isolating the production baseline set.
