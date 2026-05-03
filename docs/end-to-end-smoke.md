# End-to-End Smoke Results

Case:

- `benchmark/cases/sharkdp__bat/low.yaml`
- `sharkdp-bat-low-zip-binary-detection`

All three harnesses completed an agent run and passed the hidden core test.

## Commands

Codex:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode agent \
  --harness codex \
  --model gpt-5.5 \
  --effort medium \
  --agentTimeoutMs 420000
```

Claude:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode agent \
  --harness claude \
  --model claude-opus-4-7 \
  --effort medium \
  --agentTimeoutMs 900000
```

Cursor:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode agent \
  --harness cursor \
  --model gpt-5.5-medium \
  --agentTimeoutMs 900000
```

## Observed Metrics

| Harness | Model | Result | Wall Time | Harness Time | Conv Turns | Assistant | Tools | Commands | File Edits | Fresh Input | Cache Read | Cache Write | Effective Input | Output | Reasoning | Effective Total | Cost |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex | `gpt-5.5` medium | pass | 189.4s | 151.0s | 1 | 8 | 27 | 24 | 3 | 57031 | 789248 | n/a | 846279 | 6097 | 1438 | 852376 | unavailable |
| Claude | `claude-opus-4-7` medium | pass | 173.8s | 148.0s | 17 | 17 | n/a | n/a | n/a | 22 | 431249 | 14091 | 445362 | 5272 | n/a | 450634 | $0.436165 reported |
| Cursor | `gpt-5.5-medium` | pass | 200.4s | 140.8s | 8 | 8 | 27 | n/a | n/a | 38244 | 590848 | 0 | 629092 | 7609 | n/a | 636701 | unavailable |

Interpretation notes:

- Codex `Conv Turns=1` is expected for a single `codex exec` prompt; action volume is reflected by `Assistant`, `Commands`, `File Edits`, and `Tools`.
- Claude `Fresh Input=22` is not the whole context. The effective input includes cache read/write tokens.
- Cursor effort is inferred as `medium` from `gpt-5.5-medium` / `GPT-5.5 272K Medium` when the CLI does not emit a separate effort field.

## Modified Files

- Codex: `src/input.rs`, `tests/integration_tests.rs`
- Claude: `src/input.rs`
- Cursor: `src/input.rs`, `tests/integration_tests.rs`

## Report

Legacy generated report:

```text
benchmark/reports/results.html
```

Current experiment reports are generated under
`benchmark/experiments/<experiment-id>/results.html`; the command below is kept
only as historical context for the smoke run.

```bash
node scripts/render-results.mjs \
  --runsRoot benchmark/runs \
  --matrixId <matrix-id> \
  --reviewFile benchmark/experiments/<experiment-id>/failure-reviews.json \
  --output benchmark/experiments/<experiment-id>/results.html
```

## Notes

- The first Codex attempt was manually killed before timeout support was added and did not produce `result.json`.
- After timeout support was added, Codex completed successfully.
- Claude is currently the only harness with reported dollar cost.
- Codex and Cursor costs require rate-card estimation. The runner now supports `--rateCard`, and existing results can be updated with `scripts/apply-rate-card.mjs`.
- `scripts/refresh-result-metrics.mjs` can re-normalize existing `result.json` files from raw harness logs after parser improvements.

## Mid/High Pilot Runs

After fixing metrics normalization, the mid and high pilot cases were run with the same baseline conditions:

- Codex: `gpt-5.5` with `--effort medium`
- Claude: `claude-opus-4-7` with `--effort medium`
- Cursor: `gpt-5.5-medium`

Base/fixed validation:

| Case | Base | Fixed |
| --- | --- | --- |
| `sharkdp-bat-mid-control-character-wrapping` | fail | pass |
| `sharkdp-bat-high-fallback-syntax` | fail | pass |

Agent results:

| Case | Harness | Result | Wall Time | Conv Turns | Assistant | Tools | Fresh Input | Cache Read | Cache Write | Effective Input | Output | Reasoning | Effective Total | Cost |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| mid | Codex | pass | 334s | 1 | 9 | 42 | 66548 | 1098368 | n/a | 1164916 | 8143 | 1981 | 1173059 | unavailable |
| mid | Claude | pass | 389s | 34 | 34 | n/a | 39 | 1266909 | 37740 | 1304688 | 11774 | n/a | 1316462 | $1.164444 reported |
| mid | Cursor | fail | 240s | 8 | 8 | 41 | 110121 | 961536 | 0 | 1071657 | 9673 | n/a | 1081330 | unavailable |
| high | Codex | pass | 295s | 1 | 8 | 46 | 102853 | 1523072 | n/a | 1625925 | 9876 | 1325 | 1635801 | unavailable |
| high | Claude | fail | 262s | 44 | 44 | n/a | 49 | 1765885 | 42257 | 1808191 | 10489 | n/a | 1818680 | $1.410068 reported |
| high | Cursor | fail | 238s | 7 | 7 | 48 | 81952 | 1663488 | 0 | 1745440 | 10671 | n/a | 1756111 | unavailable |

Failure notes:

- Mid Cursor changed control-character width to one column; the hidden test expected NUL/DEL terminal rendering to wrap as two-column caret notation.
- High Claude implemented `--fallback-language` but missed the required `--fallback-syntax` interface.
- High Cursor implemented `--fallback-syntax` but missed the alias/compatibility path covered by the hidden test.
- One earlier Claude mid run failed with `No space left on device` during Rust build. It is marked `invalid_run: true` and excluded from the HTML report.
