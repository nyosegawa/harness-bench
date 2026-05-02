# Harness Debug Benchmark

Benchmark harness and pilot data for comparing Codex, Claude Code, and Cursor debugging runs.

The repository tracks benchmark specifications, case definitions, hidden test scripts, runner scripts, candidate repository metadata, and generated HTML reports. Large local run outputs and cloned workspaces are intentionally ignored under `benchmark/runs/` and `benchmark/workspaces/`.

## Quick Checks

```bash
node --check scripts/run-case.mjs
node --check scripts/render-results.mjs
node --check scripts/apply-rate-card.mjs
node --check scripts/refresh-result-metrics.mjs
```

Regenerate the report from local run data:

```bash
find benchmark/runs -mindepth 1 -maxdepth 1 -type d \
  | node scripts/render-results.mjs benchmark/runs benchmark/reports/results.html
```
