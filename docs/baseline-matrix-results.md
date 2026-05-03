# Baseline Matrix Results

This document summarizes the first full baseline matrix across the completed
27-case benchmark set.

Run data is local and intentionally untracked under `benchmark/runs/`. The
tracked report was regenerated at `benchmark/reports/results.html`.

## Benchmark Design

The benchmark is designed to compare debugging ability and operating efficiency
under the same task information, not to compare chat UX or long-term memory.
Baseline runs therefore disable memory and use a single issue-style prompt per
case.

Each case is anchored by:

- a real repository and pull-request-derived bug;
- a base commit where the hidden core test fails;
- a fixed commit where the same hidden core test passes;
- an instruction that gives the agent the debugging task without exposing the
hidden oracle;
- hidden tests that are run only after the agent edit.

The 27-case set covers 9 repositories. Each repository contributes one low,
one mid, and one high case. Difficulty is assigned from expected debugging
complexity and API/scope risk; repository size is tracked separately because a
large repository can still have a localized fix and a small repository can
still hide subtle behavior.

The main score is hidden-oracle pass rate. Efficiency is reported with wall
time, turns/messages, tool calls, tokens, and cost. These metrics are not
collapsed into one generic number because their meaning differs by harness:
Codex turns are `codex exec` invocations, Claude cost is reported by Claude
Code, and Codex/Cursor costs are API-equivalent estimates from the local rate
card.

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

| Harness | Median Wall | Median Pass Wall | Median Turns | Median Assistant | Median Tools | Median Effective Total Tokens | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex | 248.9s | 248.9s | 1 | 9 | 36 | 1,172,347 | $33.84 estimated |
| Claude Code | 224.6s | 254.7s | 20 | 20 | n/a | 618,693 | $22.62 |
| Cursor Agent | 186.6s | 174.8s | 7 | 7 | 33 | 980,871 | $28.34 estimated |

Metric semantics differ by harness. In particular, Codex's single
conversation turn reflects one `codex exec` invocation; action volume is better
represented by assistant messages, command calls, file edits, and tool calls.
Claude's reported cost is native CLI output. Codex and Cursor costs use the
API-equivalent rate card `benchmark/rate-cards/api-equivalent-2026-05-03.json`.
That card uses the OpenAI GPT-5.5 API rates checked on 2026-05-03 and should
not be read as Cursor subscription billing truth.

Cost per pass, using total matrix cost divided by passed cases:

| Harness | Matrix Cost | Passed | Cost / Pass |
| --- | ---: | ---: | ---: |
| Codex | $33.84 estimated | 18 | $1.88 |
| Claude Code | $22.62 reported | 18 | $1.26 |
| Cursor Agent | $28.34 estimated | 17 | $1.67 |

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

## Failure And False-negative Review

The observed failures are hidden core-test failures rather than infrastructure
failures. Each failed run recorded `core_pass: false`; there were no
`invalid_run` markers in the three baseline matrices.

Several failures have false-negative risk because the hidden test appears to
assert implementation details, exact encodings, or requirements not fully
specified by the prompt:

| Case | Harnesses | Review reason |
| --- | --- | --- |
| `axios-axios-low-settle-error-code` | Codex, Claude, Cursor | All harnesses fixed undefined codes, but the hidden test requires rejected `200/302` responses to be `ERR_BAD_RESPONSE`; the prompt only required a defined bad-request or bad-response code. |
| `go-gitea-gitea-high-compare-no-common-history` | Codex, Claude, Cursor | All harnesses added typed no-merge-base handling and compare fallback behavior, but the hidden test requires `errors.Is(err, util.ErrNotExist)` from `MergeBase`. |
| `jesseduffield-lazygit-high-branch-divergence-fast-path` | Codex, Claude, Cursor | Hidden tests reference exact private helper names even though candidate fixes use equivalent batching/parsing helpers under different names. |
| `louislam-uptime-kuma-high-websocket-auth-options` | Codex, Claude, Cursor | Hidden tests require a specific helper name and camelCase `authMethod`; candidate fixes either used equivalent helper names or the existing `auth_method` schema. |
| `louislam-uptime-kuma-low-submillisecond-ping-chart` | Codex, Cursor | Candidate fixes add zero-ping handling, but the hidden script extracts a Vue method with regex and invokes it with an incomplete `this` context. |
| `sharkdp-bat-high-fallback-syntax` | Codex, Cursor | Both accept `--fallback-syntax`, but the hidden test also requires the unstated alias `--fallback-language`. Claude is still a true failure because `--fallback-syntax` itself is rejected. |
| `vitejs-vite-low-flatten-id-sanitized-chars` | Codex, Cursor | Both avoid sanitized-character collisions, but the hidden test asserts exact PR-style encodings instead of collision avoidance and path-safe reversibility. |

The remaining failed groups look like true benchmark failures against the
current hidden oracle:

| Case | Harnesses | Evidence |
| --- | --- | --- |
| `langflow-ai-langflow-mid-mcp-connectable-inputs` | Codex, Claude, Cursor | Hidden expects numeric/bool inputs connectable as `["Message"]` and dict inputs as `["JSON"]`; outputs did not match that UI connection contract. |
| `go-gitea-gitea-mid-pr-merge-self-reference` | Cursor | Self-reference comment still exists because the fix did not cover the `UpdateIssuesCommit` path. |
| `louislam-uptime-kuma-mid-uptime-cleanup-buckets` | Claude | A stale cleanup bucket remained. |
| `sharkdp-bat-low-zip-binary-detection` | Claude | ZIP end-of-central-directory marker was not rendered as `<BINARY>`. |
| `sharkdp-bat-mid-control-character-wrapping` | Codex, Cursor | NUL/DEL input at width 40 still rendered as one physical line instead of the expected two. |
| `usememos-memos-mid-mixed-case-user-resource-names` | Claude | Mixed-case lookup remained empty and numeric usernames became valid. |

Until the review cases are resolved, the headline matrix should be read as
"hidden-oracle pass rate" rather than an absolute final correctness score.

## Notes

- `benchmark/runs/` and `benchmark/workspaces/` remain local ignored data.
- Raw harness logs were preserved; `scripts/refresh-result-metrics.mjs` found
  no parser updates needed after these runs.
- `scripts/apply-rate-card.mjs` was used to apply
  `benchmark/rate-cards/api-equivalent-2026-05-03.json` to local run results
  before regenerating the tracked HTML report.
- The HTML report includes smoke and pilot runs as well as the three baseline
  matrices. Use matrix IDs above when isolating the production baseline set.
