# Repository Candidate Notes

Generated with:

```bash
node scripts/collect-candidate-repos.mjs \
  --perQuery 30 \
  --minStars 500 \
  --minMergedPrs 50 \
  --since 2026-01-01 \
  --output benchmark/repos/candidates.json
```

Current output:

- `benchmark/repos/candidates.json`
- `benchmark/repos/candidates.yaml`
- 105 candidate repositories

Candidate counts by initial language bucket:

- TypeScript: 19
- JavaScript: 13
- Python: 10
- Rust: 14
- Go: 17
- Ruby: 8
- Java: 10
- Kotlin: 6
- PHP: 8

## Early Observations

The initial query successfully finds active repositories, but it also includes repositories that are probably bad benchmark targets:

- extremely large monorepos
- bot-heavy dependency repositories
- content/list repositories
- repositories with many merged PRs but weak local test reproducibility

The next filter should prioritize local reproducibility and bug-fix PR quality over raw PR count.

Additional selection direction:

- Prefer repositories that use frameworks to build real applications, services, CLIs, or tools.
- De-prioritize framework core repositories themselves, such as React, Next.js, Vite, FastAPI, Django, Rails, Angular, Svelte, Laravel framework, Symfony, and similar.
- Framework core repositories may still be useful for pilot tooling checks, but they should not dominate the final benchmark.

## Promising Pilot Repositories

These are not final selections. They are useful first-pass candidates for pilot fixture work.

### Small Candidates

- `sharkdp/bat` - Rust CLI, Apache-2.0, 58K stars, 73 merged PRs since 2026-01-01
  - PR scan found 25 debug-like PRs in the latest 49 merged PRs.
  - Likely good for small/medium CLI debugging tasks with fast tests.
- `axios/axios` - JavaScript library, MIT, 109K stars, 211 merged PRs since 2026-01-01
  - Needs PR scan.
  - Potentially good small library target.
- `fruitcake/laravel-debugbar` - PHP package, MIT, 19K stars, 172 merged PRs since 2026-01-01
  - Needs PR scan.
  - Potentially good small package target.

### Medium Candidates

- `vitejs/vite` - TypeScript build tool, MIT, 80K stars, 380 merged PRs since 2026-01-01
  - PR scan found 27 debug-like PRs in the latest 48 merged PRs.
  - Strong pilot candidate for validating scripts, but it is framework/tooling core and should not be preferred for the final application-focused set.
- `fastapi/fastapi` - Python framework, MIT, 97K stars, 283 merged PRs since 2026-01-01
  - PR scan found only 8 debug-like PRs in the latest 49 merged PRs.
  - Framework core; replacement preferred for the final benchmark.
- `caddyserver/caddy` - Go server, Apache-2.0, 72K stars, 102 merged PRs since 2026-01-01
  - Needs PR scan.
  - Potentially good Go medium target.

### Large Candidates

- `microsoft/playwright` - TypeScript, Apache-2.0, 87K stars, 957 merged PRs since 2026-01-01
  - Needs PR scan.
  - Likely good but setup/runtime may be heavy.
- `django/django` - Python, BSD-3-Clause, 87K stars, 280 merged PRs since 2026-01-01
  - Needs PR scan.
  - Long-lived test suite; likely good if targeted tests are identifiable.
- `bevyengine/bevy` - Rust, Apache-2.0, 45K stars, 941 merged PRs since 2026-01-01
  - Needs PR scan.
  - Large Rust target; may have heavy compile times.

## PR Scan Commands

Use:

```bash
node scripts/collect-pr-candidates.mjs \
  --repo vitejs/vite \
  --limit 50 \
  --since 2026-01-01
```

Current pilot scans:

- `benchmark/repos/pr-candidates/vitejs__vite.json`
- `benchmark/repos/pr-candidates/fastapi__fastapi.json`
- `benchmark/repos/pr-candidates/sharkdp__bat.json`

## Example PR Candidates From Pilot Scans

### `vitejs/vite`

Potential low:

- `#22188` - `fix(dev): handle errors in watchChange hook`
- `#22208` - `fix(optimizer): handle more chars that will be sanitized`

Potential mid:

- `#22039` - `fix(css): use unique key for cssEntriesMap to prevent same-basename collision`
- `#21871` - `fix(worker): make worker output consistent with client and SSR`
- `#22238` - `fix: detect Deno workspace root (fix #22237)`

### `sharkdp/bat`

Potential low:

- `#3686` - `Detect ZIP archives as binary content`
- `#3688` - `fix: sanitize subprocess call in generate_snapshots.py`

Potential mid:

- `#3640` - `Fix line wrapping for files with control characters`
- `#3687` - `Support BAT_WIDTH for terminal width`

Potential high:

- `#3617` - `Add --fallback-syntax for undetected files`

## Next Steps

1. Add repository size metadata to candidate collection.
2. Choose 1 pilot repository and manually validate low/mid/high PRs.
3. Clone the pilot repo and verify:
   - base commit test failure
   - fixed commit test pass
   - hidden test can be extracted or written
4. Only after pilot validation, expand to 9 repositories.

## App-Oriented PR Scan

Scan target list:

- `benchmark/repos/app-pr-scan-targets.txt`

Summary table:

- `benchmark/repos/app-pr-scan-summary.md`

The scan covered 18 application/service/CLI/tool-oriented repositories. Heuristic scores are only a triage aid; final selection still requires clone/test validation.

### Stronger Shortlist

These repositories have a good mix of debug-like PRs and low/mid/high candidates:

- `coollabsio/coolify` - full-stack deployment platform, PHP/TypeScript, many low/mid/high candidates.
- `langflow-ai/langflow` - Python/TypeScript AI workflow app, many candidates, but may be heavier to set up.
- `usememos/memos` - Go/TypeScript app, many candidates including API/auth/resource bugs.
- `koel/koel` - Laravel/Vue music app, good low/mid/high distribution.
- `go-gitea/gitea` - Go web app, many low/mid candidates and some high candidates.
- `spree/spree` - Rails commerce app, balanced low/mid/high candidates.
- `sharkdp/bat` - Rust CLI, not a framework app but likely excellent small CLI pilot target.
- `jesseduffield/lazygit` - Go terminal app, fewer candidates but likely practical and fast.
- `hoppscotch/hoppscotch` - full-stack API client, good low/mid candidates.

### Weaker or Riskier Candidates

- `browser-use/browser-use` - many debug-like PRs but few non-reject low/mid/high candidates in heuristic scan; may still be interesting but likely volatile.
- `Mintplex-Labs/anything-llm` - many debug-like hits but only one non-reject candidate due to large/no-test PRs in latest 50.
- `infiniflow/ragflow` - some candidates, but likely heavy setup.
- `google-ai-edge/gallery` - debug-like hits but no non-reject candidates in latest 50 by heuristic.
- `tauri-apps/tauri` - framework/tooling core and no non-reject candidates in latest 50 by heuristic.
- `starship/starship` - too few non-reject candidates in latest 50 by heuristic.

### Suggested Pilot

Start with `sharkdp/bat` or `jesseduffield/lazygit`.

Reasons:

- likely fast local setup
- CLI behavior is easy to test with hidden assertions
- fewer external services
- still active enough in 2026

After runner mechanics are validated on a CLI target, move to an application target such as `koel/koel`, `usememos/memos`, or `coollabsio/coolify`.
