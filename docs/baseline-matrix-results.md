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
Codex turns are `codex exec` invocations, Claude `assistant_messages` is a
`num_turns` proxy in aggregate JSON, Cursor turn-like counts are assistant step
events, Claude cost is reported by Claude Code, and Codex/Cursor costs are
API-equivalent estimates from the local rate card.

Candidate workspaces are sanitized after checkout. Repository-local
`AGENTS.md`, `CLAUDE.md`, `.agents`, `.claude`, and `.codex` files are removed
so that case instructions come from the benchmark prompt rather than upstream
agent steering files.

## Matrix Runs

| Harness | Condition | Matrix ID | Cases | Pass | Rate |
| --- | --- | --- | ---: | ---: | ---: |
| Codex | `codex:gpt-5.5:medium:baseline` | `matrix-2026-05-02T20-45-13-252Z` | 27 | 23 | 85.2% |
| Claude Code | `claude:claude-opus-4-7:medium:baseline` | `matrix-2026-05-02T22-52-11-726Z` | 27 | 20 | 74.1% |
| Cursor Agent | `cursor:gpt-5.5-medium:baseline` | `matrix-2026-05-03T00-47-35-211Z` | 27 | 23 | 85.2% |

All baseline runs used memory-disabled harness commands. The score above is
after fixing hidden-oracle false negatives and regrading preserved agent
workspaces without rerunning the agents.

## Speed And Usage

Wall time includes checkout/setup, agent work, and hidden test execution.

| Harness | Median Wall | Median Pass Wall | Median Turns | Median Assistant | Median Tools | Median Effective Total Tokens | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex | 248.9s | 248.9s | 1 | 9 | 36 | 1,172,347 | $33.84 estimated |
| Claude Code | 224.6s | 254.7s | 20 | 20 | n/a | 618,693 | $22.62 |
| Cursor Agent | 186.6s | 181.9s | 7 | 7 | 33 | 980,871 | $28.34 estimated |

Metric semantics differ by harness. In particular, Codex's single
conversation turn reflects one `codex exec` invocation; action volume is better
represented by assistant messages, command calls, file edits, and tool calls.
Claude's `assistant_messages` is a `num_turns` proxy because the saved aggregate
JSON does not expose a separate message count. Cursor does not expose a
Codex-style completed turn primitive; the benchmark stores assistant/action-step
events as the turn-like count. Claude's reported cost is native CLI output.
Codex and Cursor costs use the API-equivalent rate card
`benchmark/rate-cards/api-equivalent-2026-05-03.json`. That card uses the
OpenAI GPT-5.5 API rates checked on 2026-05-03 and should not be read as Cursor
subscription billing truth.

Cost per pass, using total matrix cost divided by passed cases:

| Harness | Matrix Cost | Passed | Cost / Pass |
| --- | ---: | ---: | ---: |
| Codex | $33.84 estimated | 23 | $1.47 |
| Claude Code | $22.62 reported | 20 | $1.13 |
| Cursor Agent | $28.34 estimated | 23 | $1.23 |

## Success By Difficulty

| Harness | Low | Mid | High |
| --- | ---: | ---: | ---: |
| Codex | 8/9 | 7/9 | 8/9 |
| Claude Code | 8/9 | 6/9 | 6/9 |
| Cursor Agent | 9/9 | 6/9 | 8/9 |

High difficulty separated less than expected in aggregate because several high
cases were solved by all harnesses while a few low/mid cases exposed specific
implementation traps.

## Success By Size

| Harness | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Codex | 8/9 | 5/6 | 10/12 |
| Claude Code | 6/9 | 3/6 | 11/12 |
| Cursor Agent | 8/9 | 5/6 | 10/12 |

Large repository results are not uniformly harder because the hidden tests are
targeted and some large-repo fixes are localized.

## Shared Outcomes

Seventeen cases passed on all three harnesses.

Two cases failed on all three harnesses:

- `langflow-ai-langflow-mid-mcp-connectable-inputs`
- `louislam-uptime-kuma-high-websocket-auth-options`

Eight cases split by harness:

| Case | Codex | Claude | Cursor |
| --- | --- | --- | --- |
| `go-gitea-gitea-mid-pr-merge-self-reference` | pass | pass | fail |
| `jesseduffield-lazygit-high-branch-divergence-fast-path` | pass | fail | pass |
| `louislam-uptime-kuma-mid-uptime-cleanup-buckets` | pass | fail | pass |
| `sharkdp-bat-high-fallback-syntax` | pass | fail | pass |
| `sharkdp-bat-low-zip-binary-detection` | pass | fail | pass |
| `sharkdp-bat-mid-control-character-wrapping` | fail | pass | fail |
| `usememos-memos-mid-mixed-case-user-resource-names` | pass | fail | pass |
| `vitejs-vite-low-flatten-id-sanitized-chars` | fail | pass | pass |

## Failure And False-negative Review

The observed failures are hidden core-test failures rather than infrastructure
failures. Each failed run recorded `core_pass: false`; there were no
`invalid_run` markers in the three baseline matrices.

Several hidden tests were revised after false-negative review because they
asserted implementation details, exact encodings, or requirements not fully
specified by the prompt. The agents were not rerun; existing workspaces were
regraded against the revised hidden tests.

| Case | Harnesses | Review reason |
| --- | --- | --- |
| `axios-axios-low-settle-error-code` | Codex, Claude, Cursor | Changed oracle from exact `ERR_BAD_RESPONSE` for rejected 200/302 to any defined Axios bad request/response code. All three now pass. |
| `go-gitea-gitea-high-compare-no-common-history` | Codex, Claude, Cursor | Changed oracle to accept typed no-merge-base behavior instead of requiring `errors.Is(err, util.ErrNotExist)`. All three now pass. |
| `jesseduffield-lazygit-high-branch-divergence-fast-path` | Codex, Cursor | Removed private helper-name assertions and kept the public branch-loader behavior test. Codex and Cursor now pass; Claude remains fail. |
| `louislam-uptime-kuma-high-websocket-auth-options` | Codex, Claude, Cursor | Allowed equivalent websocket option helper names and both existing/candidate auth field spellings. All three still fail, so this remains a true benchmark failure. |
| `louislam-uptime-kuma-low-submillisecond-ping-chart` | Codex, Cursor | Replaced brittle Vue method regex/context extraction with balanced method-body extraction and real helper-method context. Codex, Claude, and Cursor now pass. |
| `sharkdp-bat-high-fallback-syntax` | Codex, Cursor | Removed unstated `--fallback-language` alias requirement while keeping `--fallback-syntax` behavior checks. Codex and Cursor now pass; Claude remains fail because `--fallback-syntax` itself is rejected. |
| `vitejs-vite-low-flatten-id-sanitized-chars` | Codex, Cursor | Changed exact PR-style encoding checks to collision-avoidance and path-safe-character properties. Cursor now passes; Codex remains fail. |

The remaining failed groups look like true benchmark failures against the
current hidden oracle:

| Case | Harnesses | Evidence |
| --- | --- | --- |
| `langflow-ai-langflow-mid-mcp-connectable-inputs` | Codex, Claude, Cursor | Hidden expects numeric/bool inputs connectable as `["Message"]` and dict inputs as `["JSON"]`; outputs did not match that UI connection contract. |
| `go-gitea-gitea-mid-pr-merge-self-reference` | Cursor | Self-reference comment still exists because the fix did not cover the `UpdateIssuesCommit` path. |
| `jesseduffield-lazygit-high-branch-divergence-fast-path` | Claude | Public branch-loader fast path behavior still did not satisfy the hidden test. |
| `louislam-uptime-kuma-high-websocket-auth-options` | Codex, Claude, Cursor | Even after helper-name/schema loosening, websocket auth option behavior remains wrong or incomplete. |
| `louislam-uptime-kuma-mid-uptime-cleanup-buckets` | Claude | A stale cleanup bucket remained. |
| `sharkdp-bat-high-fallback-syntax` | Claude | `--fallback-syntax` itself is rejected. This is marked `case_design_review` in the structured failure review because the baseline prompt asked for fallback support but did not explicitly name the flag. The case prompt has since been clarified for future runs. |
| `sharkdp-bat-low-zip-binary-detection` | Claude | ZIP end-of-central-directory marker was not rendered as `<BINARY>`. |
| `sharkdp-bat-mid-control-character-wrapping` | Codex, Cursor | NUL/DEL input at width 40 still rendered as one physical line instead of the expected two. |
| `usememos-memos-mid-mixed-case-user-resource-names` | Claude | Mixed-case lookup remained empty and numeric usernames became valid. |
| `vitejs-vite-low-flatten-id-sanitized-chars` | Codex | Collision/path-safety property test still failed. |

The remaining case-design review has been resolved in the case prompt for
future runs, but the current baseline matrix still reflects the old prompt.
Until the sanitized matrix is rerun, the headline should be read as
"hidden-oracle pass rate" rather than an absolute final correctness score.

Structured implementation reviews live in
`benchmark/reviews/baseline-failure-reviews.json`. Each review is bilingual
(`en`/`ja`) and records the failure mode, evidence, recommendation, verdict,
and confidence. `scripts/render-results.mjs` validates this schema before
rendering the report, so malformed review output fails fast instead of
silently breaking `results.html`.

`scripts/review-failed-runs.mjs --dryRun` builds evidence bundles for failed
baseline runs from `result.json`, hidden-test logs, workspace diffs, and saved
harness session logs. `scripts/review-failed-runs.mjs --generate` can call
Codex to fill missing bilingual review entries, then validates the generated
JSON before writing it. The LLM judge role remains auxiliary: it can explain
how a failed implementation went wrong, but it must not replace hidden-oracle
pass/fail scoring.

## Notes

- `benchmark/runs/` and `benchmark/workspaces/` remain local ignored data.
- Raw harness logs were preserved; `scripts/refresh-result-metrics.mjs` found
  no parser updates needed after these runs.
- `scripts/apply-rate-card.mjs` was used to apply
  `benchmark/rate-cards/api-equivalent-2026-05-03.json` to local run results
  before regenerating the tracked HTML report.
- The HTML report includes smoke and pilot runs as well as the three baseline
  matrices. Use matrix IDs above when isolating the production baseline set.
