# TODO

## Current State

- GitHub repo: `nyosegawa/harness-debug-benchmark`
- Visibility: private
- Main branch initial commit: `4a03248`
- Checkout path: `/home/sakasegawa/src/github.com/nyosegawa/harness-debug-benchmark`
- `benchmark/runs/` and `benchmark/workspaces/` are ignored local working data.

## Completed

- Benchmark specification created under `docs/`.
- Runner implemented:
  - verify modes: `verify-base`, `verify-fixed`, `verify-current`
  - agent mode: `codex`, `claude`, `cursor`
- Report generator implemented: `scripts/render-results.mjs`.
- Raw-log metric refresher implemented: `scripts/refresh-result-metrics.mjs`.
- Rate-card application script implemented: `scripts/apply-rate-card.mjs`.
- Batch matrix runner implemented: `scripts/run-matrix.mjs`.
- Candidate repository scans and PR candidate metadata saved under `benchmark/repos/`.
- Pilot cases for `sharkdp/bat` created:
  - `low`: ZIP binary detection
  - `mid`: control-character wrapping
  - `high`: fallback syntax
- Full 27-case benchmark set completed across 9 repositories:
  - `axios/axios`
  - `fastapi/fastapi`
  - `go-gitea/gitea`
  - `jesseduffield/lazygit`
  - `langflow-ai/langflow`
  - `louislam/uptime-kuma`
  - `sharkdp/bat`
  - `usememos/memos`
  - `vitejs/vite`
- Hidden tests verified:
  - all 27 cases: base fail / fixed pass
- Pilot agent runs completed for low/mid/high across Codex, Claude, Cursor.
- Baseline matrices completed:
  - Codex `gpt-5.5` medium: 18/27
  - Claude `claude-opus-4-7` medium: 18/27
  - Cursor `gpt-5.5-medium`: 17/27
- HTML report generated at `benchmark/reports/results.html`.
- Baseline result summary saved at `docs/baseline-matrix-results.md`.
- Runtime checked:
  - Node.js `v22.21.1`
  - Rust `cargo 1.93.0`
  - `low.yaml --mode verify-fixed` passed.

## Pilot Results

| Case | Codex gpt-5.5 medium | Claude opus-4.7 medium | Cursor gpt-5.5-medium |
| --- | --- | --- | --- |
| low | pass | pass | pass |
| mid | pass | pass | fail |
| high | pass | fail | fail |

Known failure interpretations:

- Mid Cursor: treated control characters as one-column display width, while hidden tests expect NUL/DEL terminal caret notation to wrap as two columns.
- High Claude: implemented `--fallback-language`, missing the expected `--fallback-syntax` interface.
- High Cursor: implemented `--fallback-syntax` but failed an alias/compatibility path covered by the hidden test.

One earlier Claude mid run failed due to disk exhaustion during Rust build. It is marked `invalid_run: true` and excluded from reports.

## Next Tasks

1. Review shared-failure cases and decide whether any hidden expectation should be refined:
   - `axios-axios-low-settle-error-code`
   - `go-gitea-gitea-high-compare-no-common-history`
   - `jesseduffield-lazygit-high-branch-divergence-fast-path`
   - `langflow-ai-langflow-mid-mcp-connectable-inputs`
   - `louislam-uptime-kuma-high-websocket-auth-options`
   - `sharkdp-bat-high-fallback-syntax`
2. Add failure-mode annotations to generated reports:
   - no patch / wrong file
   - partial fix
   - wrong API or compatibility path
   - hidden assertion mismatch
   - timeout
   - infrastructure invalid run
3. Improve report UX:
   - filter by case/harness
   - show invalid runs separately
   - add per-case summary and cost totals by source
4. Add real rate cards for Codex/Cursor/Claude if current pricing should be estimated. Keep reported and estimated cost clearly separated.
5. Consider re-running selected split cases to estimate variance:
   - `sharkdp-bat-low-zip-binary-detection`
   - `sharkdp-bat-mid-control-character-wrapping`
   - `usememos-memos-mid-mixed-case-user-resource-names`
   - `vitejs-vite-low-flatten-id-sanitized-chars`
6. Consider Cursor Max Mode as a separate experimental axis once CLI config switching is made safe and serialized.

## Useful Commands

Start:

```bash
cd /home/sakasegawa/src/github.com/nyosegawa/harness-debug-benchmark
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
git pull --ff-only
```

Check scripts:

```bash
node --check scripts/run-case.mjs
node --check scripts/render-results.mjs
node --check scripts/apply-rate-card.mjs
node --check scripts/refresh-result-metrics.mjs
node --check scripts/run-matrix.mjs
```

Regenerate report:

```bash
find benchmark/runs -mindepth 1 -maxdepth 1 -type d \
  | node scripts/render-results.mjs benchmark/runs benchmark/reports/results.html
```

Verify pilot cases:

```bash
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-base
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-fixed
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/mid.yaml --mode verify-base
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/mid.yaml --mode verify-fixed
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/high.yaml --mode verify-base
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/high.yaml --mode verify-fixed
```

Run one baseline agent:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode agent \
  --harness codex \
  --model gpt-5.5 \
  --effort medium \
  --agentTimeoutMs 900000
```

Preview or run the baseline matrix:

```bash
node scripts/run-matrix.mjs --dryRun true
node scripts/run-matrix.mjs --agentTimeoutMs 900000 --maxInfraRetries 1
```

## Notes For Future Agents

- Read `AGENTS.md` first.
- Then read:
  - `docs/benchmark-spec.md`
  - `docs/runner.md`
  - `docs/end-to-end-smoke.md`
  - `docs/harness-metrics-investigation.md`
- Do not assume `turns` means the same thing across harnesses.
- Do not judge Claude input by `usage.input_tokens` alone; include cache read/write.
- Do not judge Codex work volume by `turn.completed` alone; include assistant messages, commands, and file changes.
- Do not commit ignored run data.
- If regenerating `benchmark/reports/results.html` changes a tracked file, commit that intentionally or restore it before unrelated commits.
