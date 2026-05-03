# Baseline Matrix Results

This document summarizes the first publishable sanitized baseline matrix across
the completed 27-case benchmark set. The immutable experiment artifact is:

```text
benchmark/experiments/sanitized-baseline-2026-05-03/
```

Run data is local and intentionally untracked under `benchmark/runs/`. Reports
are generated per experiment as `results.html`, with
`benchmark/reports/index.html` acting as the tracked experiment index.

## Benchmark Design

The benchmark compares debugging ability and operating efficiency under the
same task information, not chat UX or long-term memory. Baseline runs disable
memory and use a single issue-style prompt per case.

Each case is anchored by a real repository, a PR-derived bug, a base commit
where the hidden core test fails, a fixed commit where the same hidden test
passes, and an instruction that does not expose the hidden oracle. The 27-case
set covers 9 repositories with one low, one mid, and one high task per
repository.

Candidate workspaces are sanitized after checkout. Repository-local
`AGENTS.md`, `agents.md`, `CLAUDE.md`, `claude.md`, `.agents`, `.claude`, and
`.codex` files are removed so that case instructions come from the benchmark
prompt rather than upstream agent steering files. Future runner-managed agent
workspaces materialize this sanitized tree as a fresh one-commit git repository
so deleted steering files do not appear in normal diffs or HEAD history.

Important limitation for `sanitized-baseline-2026-05-03`: the recorded run
removed these steering files from the working tree, but did not yet rewrite the
git root. If an upstream steering file was tracked, a sufficiently curious agent
could have recovered it with git object commands such as `git show HEAD:<path>`.
No pass/fail claim below assumes that this path was impossible. Future
runner-managed agent workspaces use fresh git-root materialization to close
that gap.

## Matrix Runs

| Harness | Condition | Matrix ID | Cases | Pass | Rate |
| --- | --- | --- | ---: | ---: | ---: |
| Codex | `codex:gpt-5.5:medium:baseline` | `sanitized-baseline-2026-05-03` | 27 | 19 | 70.4% |
| Claude Code | `claude:claude-opus-4-7:medium:baseline` | `sanitized-baseline-2026-05-03` | 27 | 20 | 74.1% |
| Cursor Agent | `cursor:gpt-5.5-medium:baseline` | `sanitized-baseline-2026-05-03` | 27 | 23 | 85.2% |

Follow-up Cursor Composer 2 run:

| Harness | Condition | Matrix ID | Cases | Pass | Rate |
| --- | --- | --- | ---: | ---: | ---: |
| Cursor Agent | `cursor:composer-2:baseline` | `cursor-composer-2-2026-05-03` | 27 | 15 | 55.6% |

Composer 2 is stored as a separate immutable experiment artifact rather than
being merged into the original baseline artifact. The experiment index compares
all conditions side by side.

All baseline runs used memory-disabled harness commands. The score above is
after one hidden-oracle false-negative fix and regrading preserved agent
workspaces without rerunning the agents. The matrix had 0 invalid runs.

## Speed And Usage

Wall time includes checkout/setup, agent work, and hidden test execution.

| Harness | Median Wall | Median Pass Wall | Median Turns | Median Assistant | Median Tools | Median Effective Total Tokens | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex | 274.8s | 260.7s | 1 | 9 | 34 | 1,088,405 | $34.25 estimated |
| Claude Code | 278.0s | 278.0s | 23 | 23 | n/a | 814,613 | $24.45 reported |
| Cursor Agent | 194.5s | 194.5s | 8 | 8 | 36 | 878,065 | $28.73 estimated |

Metric semantics differ by harness. Codex's single conversation turn reflects
one `codex exec` invocation; action volume is better represented by assistant
messages, command calls, file edits, and tool calls. Claude's
`assistant_messages` is a `num_turns` proxy because the saved aggregate JSON
does not expose a separate message count. Cursor does not expose a Codex-style
completed turn primitive; the benchmark stores assistant/action-step events as
the turn-like count. Claude's reported cost is native CLI output. Codex and
Cursor costs use the API-equivalent rate card
`benchmark/rate-cards/api-equivalent-2026-05-03.json`.

Cost per pass, using total matrix cost divided by passed cases:

| Harness | Matrix Cost | Passed | Cost / Pass |
| --- | ---: | ---: | ---: |
| Codex | $34.25 estimated | 19 | $1.80 |
| Claude Code | $24.45 reported | 20 | $1.22 |
| Cursor Agent | $28.73 estimated | 23 | $1.25 |

## Success Slices

| Harness | Low | Mid | High |
| --- | ---: | ---: | ---: |
| Codex | 8/9 | 6/9 | 5/9 |
| Claude Code | 9/9 | 5/9 | 6/9 |
| Cursor Agent | 8/9 | 7/9 | 8/9 |

| Harness | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Codex | 7/9 | 4/6 | 8/12 |
| Claude Code | 7/9 | 3/6 | 10/12 |
| Cursor Agent | 8/9 | 5/6 | 10/12 |

High difficulty separated more clearly in the sanitized run: Cursor retained
8/9 high-case success, Claude passed 6/9, and Codex passed 5/9. Large
repositories were not uniformly harder because several large-repo fixes are
localized and the hidden tests are targeted.

## Shared Outcomes

Sixteen cases passed on all three harnesses.

Three cases failed on all three harnesses:

- `langflow-ai-langflow-mid-mcp-connectable-inputs`
- `louislam-uptime-kuma-high-websocket-auth-options`
- `sharkdp-bat-mid-control-character-wrapping`

Eight cases split by harness:

| Case | Codex | Claude | Cursor |
| --- | --- | --- | --- |
| `go-gitea-gitea-high-compare-no-common-history` | pass | fail | pass |
| `go-gitea-gitea-mid-pr-merge-self-reference` | fail | pass | pass |
| `jesseduffield-lazygit-high-branch-divergence-fast-path` | fail | fail | pass |
| `louislam-uptime-kuma-mid-uptime-cleanup-buckets` | pass | fail | pass |
| `usememos-memos-high-missing-related-users` | fail | pass | pass |
| `usememos-memos-mid-mixed-case-user-resource-names` | pass | fail | pass |
| `vitejs-vite-high-hmr-patch-esm-sentinel` | fail | pass | pass |
| `vitejs-vite-low-flatten-id-sanitized-chars` | fail | pass | fail |

## Failure And False-negative Review

The observed failures are hidden core-test failures rather than infrastructure
failures. Each failed run recorded `core_pass: false`; there were no
`invalid_run` markers in the sanitized baseline matrix.

One hidden test was revised after false-negative review because it executed a
Vue method with an incomplete component method context. The agents were not
rerun; existing workspaces were regraded against the revised hidden test.

| Case | Harnesses | Review reason |
| --- | --- | --- |
| `louislam-uptime-kuma-low-submillisecond-ping-chart` | Codex | Bound sibling Vue methods when executing `pushDatapoint` from the component source. Codex, Claude, and Cursor pass after regrade. |

The structured review classified 19 remaining failures as true implementation
failures with high confidence. The one oracle false-negative was fixed and
regraded in place. The headline should still be read as a hidden-oracle pass
rate, with LLM-as-judge review used only as supporting explanation.

Structured implementation reviews live inside each experiment directory as
`failure-reviews.json`. Each review is bilingual (`en`/`ja`) and records the
failure mode, evidence, recommendation, verdict, and confidence.
`scripts/render-results.mjs` validates this schema before rendering an
experiment report, so malformed review output fails fast instead of silently
breaking `results.html`.

## Notes

- `benchmark/runs/` and `benchmark/workspaces/` remain local ignored data.
- Raw harness logs were preserved. Parser fixes should use
  `scripts/refresh-result-metrics.mjs` to re-normalize existing runs.
- `scripts/apply-rate-card.mjs` can apply
  `benchmark/rate-cards/api-equivalent-2026-05-03.json` before regenerating
  experiment reports.
- The primary report is
  `benchmark/experiments/sanitized-baseline-2026-05-03/results.html`; the
  experiment index is `benchmark/reports/index.html`.
