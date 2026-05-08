# AGENTS.md

## Project Purpose

HarnessBench is a benchmark for comparing coding-agent harnesses on
real-repository debugging tasks.

Full title:

```text
HarnessBench: Comparing Coding Agent Harnesses on Real-Repository Debugging Tasks
```

The project stores benchmark specifications, case definitions, hidden tests,
runner scripts, condition configs, rate cards, and generated experiment
reports.

## Operating Rules

- Do not commit `benchmark/runs/`, `benchmark/workspaces/`, or
  `benchmark/archive/`.
- Preserve raw harness logs. Parser fixes should re-normalize existing logs
  rather than rerunning expensive jobs when possible.
- Use `rg` for search when available.
- Use `apply_patch` for manual file edits.
- Avoid destructive git commands.
- If a run fails because of infrastructure, mark the `result.json` with:

```json
{
  "invalid_run": true,
  "invalid_reason": "infrastructure failure: ..."
}
```

Invalid runs are preserved for auditability but excluded from success-rate
summaries.

## Publishing Experiment Artifacts

Publish official benchmark artifacts, but do not publish raw run data by
default.

Keep these local-only:

- `benchmark/runs/`
- `benchmark/workspaces/`
- `benchmark/archive/`
- `benchmark/cache/`

These directories can contain raw harness logs, cloned repositories,
workspaces, provider-specific session details, and local filesystem paths.
Preserve them locally for auditability and re-normalization, but do not commit
them.

For an official experiment, publish only the curated artifact directory under
`benchmark/experiments/<experiment-id>/` when it contains report-level files
such as:

- `summary.json`
- `manifest.json`
- `failure-reviews.json`
- `results.html`

Before committing an experiment artifact:

1. Confirm the artifact size is reasonable:

```bash
du -sh benchmark/experiments/<experiment-id>
```

2. Remove local absolute paths from public artifacts. Replace repository paths
   with `<repo>` and home-directory paths with `<home>`:

```bash
perl -0pi -e 's#/home/sakasegawa/src/github.com/nyosegawa/harness-debug-benchmark#<repo>#g; s#/home/sakasegawa#<home>#g' \
  benchmark/experiments/<experiment-id>/summary.json \
  benchmark/experiments/<experiment-id>/manifest.json \
  benchmark/experiments/<experiment-id>/failure-reviews.json \
  benchmark/experiments/<experiment-id>/results.html
```

3. Validate JSON artifacts:

```bash
node -e "for (const f of ['summary.json','manifest.json','failure-reviews.json']) JSON.parse(require('fs').readFileSync('benchmark/experiments/<experiment-id>/'+f,'utf8')); console.log('json ok')"
```

4. Scan for local paths and common secret patterns:

```bash
rg -n "(/home/sakasegawa|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-|ghp_|github_pat_|ANTHROPIC_API_KEY|OPENAI_API_KEY|CURSOR_API_KEY|Authorization: Bearer [A-Za-z0-9._-]{20,})" \
  benchmark/experiments/<experiment-id> || true
```

5. Keep `.gitignore` broad, and unignore only the specific official experiment
   files intended for publication. Do not unignore `benchmark/runs/`,
   `benchmark/workspaces/`, or `benchmark/archive/`.

6. Run the basic script checks before pushing:

```bash
node --check scripts/render-results.mjs
node --check scripts/run-case.mjs
```

## Architecture Decision Records

Use `docs/adr/` for material benchmark design decisions. Add or update an ADR
when changing or rejecting decisions that affect:

- execution substrate or isolation model
- scoring semantics or case schema
- official matrix conditions
- report methodology or statistical interpretation
- artifact retention, regrading, or reproducibility policy

ADRs use YAML frontmatter plus Markdown sections. Prefer a short, append-only
record with `Context`, `Decision`, `Consequences`, `Alternatives Considered`,
and `Follow-Up`. Supersede old decisions with a new ADR instead of rewriting
history. Link relevant specs or runner docs to the ADR.

## Scoring Model

HarnessBench uses two scoring layers:

- `core_tests`: behavioral bug-fix contract. All must pass.
- `regression_tests`: targeted surrounding behavior. All must pass.

Official cases should use:

```yaml
test_strategy:
  core_tests:
    - benchmark/cases/<repo>/hidden-tests/<difficulty>/core.sh
  regression_tests:
    - benchmark/cases/<repo>/hidden-tests/<difficulty>/regression.sh
  success_rule: core_and_regression
```

Core tests define the required user-visible behavior as a behavioral contract.
Regression tests protect nearby behavior that should remain unchanged.

## Runtime Setup

The current environment has:

- Node.js under `~/.local/opt/node-v22.21.1-linux-*/`
- `~/.local/bin` and `~/.cargo/bin` on the shell path
- Rust via `~/.cargo/bin`

For non-interactive commands:

```bash
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
```

Basic checks:

```bash
node --version
cargo --version
node --check scripts/run-case.mjs
node --check scripts/run-matrix.mjs
node --check scripts/resume-agent-matrix.mjs
node --check scripts/render-results.mjs
node --check scripts/render-experiment-index.mjs
node --check scripts/review-failed-runs.mjs
node --check scripts/regrade-agent-results.mjs
node --check scripts/apply-rate-card.mjs
node --check scripts/refresh-result-metrics.mjs
```

## Repository Layout

- `docs/benchmark-spec.md`: benchmark design and case authoring rules
- `docs/runner.md`: runner behavior, metrics schema, cost policy
- `docs/harness-metrics-investigation.md`: observed CLI metrics behavior
- `docs/end-to-end-smoke.md`: smoke-run procedure and acceptance criteria
- `benchmark/cases/`: case YAML and hidden tests
- `benchmark/repos/`: candidate repository and PR scan outputs
- `benchmark/conditions/`: matrix condition configs
- `benchmark/rate-cards/`: cost estimation configs
- `benchmark/reports/`: public report index
- `scripts/run-case.mjs`: single-case verifier and agent runner
- `scripts/run-matrix.mjs`: matrix orchestrator
- `scripts/resume-agent-matrix.mjs`: agent-only matrix resume helper
- `scripts/render-results.mjs`: experiment report generator
- `scripts/regrade-agent-results.mjs`: preserved-workspace regrader
- `scripts/review-failed-runs.mjs`: auxiliary failure reviewer

## Metric Semantics

Do not collapse all token or turn metrics into a single ambiguous number.

- `conversation_turns`: harness-level completed turns.
- `assistant_messages`: assistant/model messages or action steps when
  observable.
- `tool_calls`: observable tool calls. For Codex this is
  `command_calls + file_changes`.
- `fresh_input_tokens`: non-cache input.
- `cache_read_tokens`: cache read input.
- `cache_write_tokens`: cache creation/write input.
- `effective_input_tokens`: fresh input plus cache read/write, or
  harness-native effective input.
- `effective_total_tokens`: `effective_input_tokens + output_tokens`.
- Codex `input_tokens` includes cached input in observed JSONL. Use
  `fresh_input_tokens = input_tokens - cache_read_tokens`.
- Claude and Cursor observed `input_tokens` are fresh input. Their effective
  input includes cache read/write.
- Claude reports dollar cost directly. Codex and Cursor need rate-card
  estimation.

## Common Commands

Verify case behavior:

```bash
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-base
node scripts/run-case.mjs --case benchmark/cases/sharkdp__bat/low.yaml --mode verify-fixed
```

Run one agent condition:

```bash
node scripts/run-case.mjs \
  --case benchmark/cases/sharkdp__bat/low.yaml \
  --mode agent \
  --harness codex \
  --model gpt-5.5 \
  --effort medium \
  --agentTimeoutMs 3600000
```

Regenerate a report from current local runs:

```bash
find benchmark/runs -mindepth 1 -maxdepth 1 -type d \
  | node scripts/render-results.mjs benchmark/runs benchmark/reports/index.html
```

## Harness Commands

Baseline runs disable harness memory and project-local steering.

- Codex:
  `codex exec --json --ignore-user-config --ignore-rules --ephemeral --disable memories --disable plugins --disable apps --disable browser_use --disable computer_use --sandbox workspace-write -m gpt-5.5 -c 'model_reasoning_effort="medium"' -C "$repo" "$prompt"`
- Claude:
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude -p --output-format json --no-session-persistence --model claude-opus-4-7 --effort medium --permission-mode bypassPermissions --setting-sources project --settings "$settings" "$prompt"`
- Cursor:
  `agent -p --output-format stream-json --trust --workspace "$repo" --model gpt-5.5-medium "$prompt"`

Memory should remain disabled for baseline runs.

## Repository Notes

Expected repository:

```text
nyosegawa/harness-bench
```

Expected checkout after rename:

```bash
cd /home/sakasegawa/src/github.com/nyosegawa/harness-bench
```
