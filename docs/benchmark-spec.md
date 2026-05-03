# Harness Debug Benchmark Specification

## Goal

Codex, Claude Code, and Cursor Agent の「実務デバッグ能力」を比較する。ここで測るのは純粋なモデル性能だけではなく、各 harness が持つ探索、編集、テスト実行、コンテキスト管理、継続ターン上限、ルール読み込みの差を含む。

LLM-as-a-judge は使わない。各問題は hidden tests で採点し、修正後に少なくとも1つの妥当な解法オラクルを通せば成功とする。

今回の主実験では、追加の Agent Skill、共通デバッグ指示、ユーザー固有memory、カスタムルールは評価対象に含めない。将来、同一harness/同一modelでそれらの介入がスコアに与える影響を測れるよう、実験条件として分離できる設計にする。

## Scale

対象リポジトリは合計9個。

- Small: 3 repositories
- Medium: 3 repositories
- Large: 3 repositories

各リポジトリにつき3問を作る。

- Low: 1 PR
- Mid: 1 PR
- High: 1 PR

合計27問。

## Repository Selection Criteria

候補リポジトリは GitHub の公開リポジトリから選ぶ。

必須条件:

- 2026年にすでに50件程度以上の merged PR がある
- stars が 0.5K 以上
- 最近もメンテナンスされている
- CI や test command が明確
- ローカルで再現可能
- debug/fix 系PRが十分にある
- clone して特定commitに checkout できる

優先条件:

- MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC などの permissive license
- セットアップが軽い
- 外部SaaS認証が不要
- flaky test が少ない
- issue/PR本文が読みやすい
- framework本体ではなく、frameworkを活用したアプリケーション、サービス、CLI、開発ツール、業務系ツール

除外条件:

- 2026年のmerged PRが少ない
- bug fix PRが少ない
- private service, cloud credential, GPU, paid API が必須
- テストが極端に重い
- fixture化に巨大なDBや大量データが必要
- copyleft license や独自licenseで再配布・fixture化の扱いが面倒
- PRの修正が大規模リファクタ中心で、hidden testで成功判定しにくい
- framework/library本体の内部仕様に寄りすぎていて、一般的なアプリケーションdebug能力の比較になりにくい

## Size Buckets

リポジトリ規模は厳密なLOCだけではなく、debug時に必要な探索範囲で決める。

Small:

- おおむね 1K-20K LOC
- 単一言語または単一主要framework
- test実行が数分以内

Medium:

- おおむね 20K-150K LOC
- 複数moduleまたはfrontend/backend構成
- test実行に多少のsetupがある

Large:

- おおむね 150K+ LOC
- monorepo、複数package、または複雑なdependency graph
- targeted test strategy が必要

言語・frameworkは偏らせない。候補例として TypeScript/JavaScript, Python, Rust, Go, Ruby, Java/Kotlin, frontend app, backend app, full-stack app, CLI/tool, desktop app を混ぜる。

Framework core repository は原則として避ける。たとえば React, Next.js, Vite, FastAPI, Django, Rails のようなframework本体は、実験対象としては「frameworkを活用したもの」より優先度を下げる。ただし、pilot用のtooling対象として明確な価値がある場合のみ例外的に扱う。

## PR Collection

各リポジトリについて、直近のclosed PRから最大 `X` 件を取得する。初期値は `X=50` とする。

取得対象:

- merged PR
- 2026年にmergeされたPRを優先
- label, title, body, files, diff, added tests, CI status, linked issue を取得

debug候補として残すPR:

- title/body/label/diff が bug, fix, regression, edge case, crash, incorrect, flaky, validation, parsing, race, error handling などに該当
- 変更の中心が不具合修正
- 追加または変更されたテストがある
- 修正前commitでテストが落ち、修正後commitで通る可能性が高い
- agentへ与える簡素なinstructionを作れる

除外するPR:

- dependency update
- formatting only
- docs only
- large refactor
- feature addition
- snapshot大量更新だけ
- 修正方針が多数ありすぎてhidden testで採点しにくい
- test追加がない、または再現が弱い

## Difficulty Levels

Low:

- 症状から原因ファイルが比較的近い
- 1-2ファイル修正
- targeted test が明確
- 仕様理解よりも実装ミス修正が中心

Mid:

- 複数ファイルまたは複数moduleをまたぐ
- 既存設計の理解が必要
- edge case, integration, API contract, state transition など
- 修正方法は複数あるが、期待される挙動は明確

High:

- 症状と根因が遠い
- async, cache, concurrency, lifecycle, parser, migration, compatibility などが絡む
- 失敗再現に複数stepが必要
- ただしhidden testで客観採点できる

## Fixture Design

各問題は「PRの直前commit」を開始地点にする。

問題ごとに保存する情報:

- repository owner/name
- repository URL
- license
- star count at selection time
- size bucket
- PR number
- PR URL
- PR title
- PR merged_at
- base commit
- fixed commit
- language/framework tags
- difficulty
- short instruction for agent
- setup command
- baseline test command
- hidden test command
- expected failing tests before fix
- expected passing tests after fix
- relevant files touched by original PR
- original PR diff metadata

Agent には original PR URL, PR number, fixed commit, patch, hidden tests を見せない。

Agent に与えるinstructionは簡素にする。十分すぎる情報を与えない。

良いinstruction:

> The parser incorrectly accepts an empty segment in nested route patterns. Reproduce the failing behavior and fix it without changing the public API.

悪いinstruction:

> In `src/parser/routes.ts`, update `parseSegment` so that it rejects `""` when `state.depth > 0`, matching PR #1234.

## Hidden Tests

hidden tests は benchmark runner 側に保持し、agent作業中のworkspaceには置かない。

各問題には複数の判定テストを用意する。

- Original PRで追加されたテスト
- 代替解法でも通る behavior test
- regression guard

hidden tests は次のように分ける。

- Core tests: どの妥当な解法でも必ず満たすべき観測可能な挙動
- Oracle suite A: original PR の解法を想定した判定
- Oracle suite B/C: 別解を想定した判定

成功条件:

- Core tests が通る
- Oracle suite A/B/C のうち少なくとも1つが通る
- 既存のtargeted public tests が通る
- 明らかな破壊的変更がない

代替解法を許すため、hidden tests は実装詳細ではなく観測可能な挙動を見る。

## Test Strategy and Success Rules

各caseは `test_strategy` を持つ。

```yaml
test_strategy:
  core_tests:
    - ./benchmark-hidden/core/run.sh
  oracle_suites:
    - id: original-pr
      command: ./benchmark-hidden/oracles/original/run.sh
    - id: alternative-a
      command: ./benchmark-hidden/oracles/alternative-a/run.sh
  regression_tests:
    - ./benchmark-hidden/regressions/run.sh
  success_rule: core_and_regression_and_one_oracle
```

### Core Tests

`core_tests` は必須。すべて通る必要がある。

Core tests には、どの妥当な解法でも満たすべき観測可能な挙動を置く。たとえば「特定入力でpanicしない」「権限チェックを必ず行う」「既存の正常系を壊さない」など。

Core tests は「どれか1つ通ればOK」にしない。ここを緩めると、不完全な修正が成功扱いになる。

### Oracle Suites

`oracle_suites` は別解を受けるための one-of 条件。複数ある場合、少なくとも1つのsuiteが通ればよい。

Oracle suite は実装方針ごとの挙動セットを表す。たとえば original PR と同じ修正、設定層で直す修正、下位parserで直す修正など、複数の妥当な修正経路を受ける。

Oracle suite は「PRの実装そのもの」を固定しない。内部関数名、差分形状、ファイル名、private API ではなく、外から見える結果を検証する。

### Regression Tests

`regression_tests` は原則必須。すべて通る必要がある。

Regression tests には、修正で壊しやすい周辺挙動を置く。とくに、バグ修正で判定条件を広げすぎた場合に壊れる正常系を入れる。

### Success Rules

標準の成功条件:

```text
all core_tests pass
AND all regression_tests pass
AND (oracle_suites is empty OR at least one oracle_suite passes)
```

pilotや単純なCLI caseでは、別解を分ける必要がない場合がある。その場合は `oracle_suites: []` とし、`success_rule: core_tests_pass` または `core_and_regression` を使う。

重要なのは「どれか1テストだけ通れば成功」ではないこと。one-of にするのは `oracle_suites` の単位であり、suite内のassertionはすべて通す。

### Design Rationale

このbenchmarkでは「正解patchとの一致」ではなく「問題を解決したか」を測る。そのため、元PRと同じファイル、同じ関数、同じ差分である必要はない。

一方で、何でも通してよいわけではない。修正が部分的だったり、特定fixtureだけを特別扱いしたり、周辺挙動を壊したりしている場合は失敗にする必要がある。

そのため、テストは次の考え方で分ける。

- Core: 問題解決として絶対に必要な性質
- Oracle: 複数ある妥当な解法のうち、どの経路で解いたか
- Regression: 修正で壊してはいけない周辺挙動

`core_tests` と `regression_tests` は品質の下限を定義する。ここは all-pass でなければならない。

`oracle_suites` は解法の多様性を受けるための仕組み。ここだけ one-of にする。たとえば、入力validatorで直す解法、parserで直す解法、storage層で直す解法がそれぞれ妥当なら、別々のoracle suiteを用意し、そのどれかを満たせば成功にする。

避けるべきテスト:

- 元PRの関数名やprivate helperを直接呼ぶテスト
- diff形状を要求するテスト
- 1つの入力だけを通せば成功になるテスト
- エラー文言の完全一致など、仕様上重要でない表現に過剰に依存するテスト
- agentがhidden testのfixtureだけを特殊処理すれば通るテスト

望ましいテスト:

- public API、CLI、HTTP API、UI observable behavior から検証する
- positive case と negative/regression case を両方持つ
- 代表例だけでなく、同じバグクラスの近い変種を含める
- 失敗時に、何の性質が満たされなかったか分かるメッセージを出す
- 元PR実装ではなく、ユーザーから見た問題解決を検証する

## Avoiding LLM-as-a-Judge

採点は機械的に行う。

Primary:

- hidden tests pass/fail

Secondary:

- targeted existing tests pass/fail
- full test subset pass/fail
- build/typecheck/lint pass/fail
- diff size
- modified file count
- timeout

人間レビューやLLM judgeは、採点ではなく後分析に限定する。

## Harness Conditions

全run共通:

- 新規cloneまたは新規worktreeから開始
- 同一base commit
- 同一instruction
- hidden tests は見せない
- web search禁止
- session resume禁止
- 実行ログ、stdout/stderr、diff、test result、metadataを保存
- Cursor run は config race を避けるため直列化する
- prompt bundle, rule bundle, skill bundle, memory policy をrun metadataに保存する
- baselineでは prompt bundle 以外の追加skill/rule/memoryを使わない
- token usage, turn count, wall time, harness duration, test duration, and cost if available を保存する
- normalized metrics と raw harness logs の両方を保存する

### Metrics Requirements

成功/失敗だけではなく、効率とコストも比較対象にする。

各runは少なくとも次を保存する。

- `wall_time_ms`: runner全体の経過時間
- `harness_duration_ms`: agent subprocessの経過時間
- `test_duration_ms`: hidden/public test実行時間
- `conversation_turns`: harnessが報告する会話単位のturn数
- `turns`: `conversation_turns` の互換alias
- `assistant_messages`: 観測可能なassistant/model action message数
- `tool_calls`: 取得可能ならtool call数
- `command_calls`: shell command実行数を区別できる場合
- `file_changes`: file edit event数を区別できる場合
- `fresh_input_tokens`: cache readを除いた新規input token
- `input_tokens`: harness native input token field
- `effective_input_tokens`: fresh input + cache read/write、またはharness native effective input
- `output_tokens`
- `reasoning_tokens`
- `cache_read_tokens`
- `cache_write_tokens`
- `fresh_total_tokens`: `fresh_input_tokens + output_tokens`
- `effective_total_tokens`: `effective_input_tokens + output_tokens`
- `total_tokens`: `effective_total_tokens` の互換alias
- `cost_usd`
- `cost_source`: `reported`, `estimated`, or `unavailable`
- `model`
- `raw_usage`

Cost policy:

- harnessが金額を報告する場合は `cost_source: reported`
- 報告がない場合、token usage と rate card から後処理で推定できるように token breakdown を保存する
- 推定額は `cost_source: estimated` として、使ったrate card versionをmetadataに残す
- 推定できない場合は `cost_usd: null`, `cost_source: unavailable`

Timing policy:

- runner wall timeは必ず外側で測る
- harnessが `duration_ms` や `duration_api_ms` を出す場合はrawとnormalizedの両方に保存する
- API durationはwall timeと意味が違うことがあるため、集計時に混同しない

Turn policy:

- Codex: `conversation_turns` は `turn.completed` event数。作業量比較には `assistant_messages`, `command_calls`, `file_changes`, `tool_calls` を併用する
- Claude: `num_turns`
- Cursor: assistant event数から導出
- tool call数はharnessごとに表現が違うため、取れない場合は `null`

Token policy:

- Claude/Cursor の `input_tokens` は observed CLI では fresh input として扱う
- Codex の `input_tokens` は observed CLI では cache readを含むeffective inputとして扱い、`fresh_input_tokens = input_tokens - cache_read_tokens` とする
- Cost推定では cached inputを二重計上しないため、通常input rateには `fresh_input_tokens` を使い、cache rateには `cache_read_tokens` / `cache_write_tokens` を使う

### Future Skill and Instruction Interventions

今回の主実験では実施しないが、将来の追試で次のような介入を比較できるようにする。

- 同一harness + 同一model + デバッグ用 Agent Skill あり/なし
- 同一harness + 同一model + 共通debug instruction bundle あり/なし
- Claude Code の custom skills あり/なし
- Codex plugins/skills あり/なし
- Cursor rules or project instructions あり/なし
- memory enabled/disabled

介入実験の原則:

- base benchmark cases は変えない
- hidden tests は変えない
- agentに与えるissue instructionは変えない
- 変えるのは intervention bundle だけにする
- bundle内容はversioned artifactとして保存する
- run metadataに bundle id, file hash, enabled features, config diff を保存する
- baseline run と intervention run は別conditionとして扱う

Example condition IDs:

```text
claude-opus-4-7-xhigh/baseline
claude-opus-4-7-xhigh/debug-skill-v1
codex-gpt-5.5-high/baseline
codex-gpt-5.5-high/debug-instructions-v1
cursor-claude-opus-4-7-xhigh/baseline
cursor-claude-opus-4-7-xhigh/cursor-rules-debug-v1
```

Baseline contamination rules:

- baselineでは user memory, auto memory, repository-specific global rules, personal rules を使わない
- benchmark fixture 内の `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` は空またはneutralにする
- 介入条件でのみ skill/rule/instruction を明示的に注入する
- 介入条件の結果は harness/model baseline と混ぜて集計しない

### Codex CLI

Codex CLI version observed: `codex-cli 0.125.0`.

Codexは `gpt-5.5-medium` のようなvariant名ではなく、`gpt-5.5` と reasoning effort で指定する。

Medium:

```bash
codex exec \
  --ignore-user-config \
  --ignore-rules \
  --ephemeral \
  --disable memories \
  --disable plugins \
  --disable apps \
  --disable browser_use \
  --disable computer_use \
  -m gpt-5.5 \
  -c 'model_reasoning_effort="medium"' \
  -C "$WORK_DIR" \
  "$PROMPT"
```

High:

```bash
codex exec ... -m gpt-5.5 -c 'model_reasoning_effort="high"' -C "$WORK_DIR" "$PROMPT"
```

XHigh:

```bash
codex exec ... -m gpt-5.5 -c 'model_reasoning_effort="xhigh"' -C "$WORK_DIR" "$PROMPT"
```

Notes:

- `--ignore-rules` でも `AGENTS.md` は読み込まれる実測があるため、fixture repo には不要な `AGENTS.md` を置かない。
- `--disable memories` を必ず付ける。
- `--ephemeral` を必ず付ける。

### Claude Code CLI

Claude Code version observed: `2.1.126`.

Claude Codeは `claude-opus-4-7-high` ではなく、`claude-opus-4-7` と `--effort` で指定する。

Medium:

```bash
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
claude -p \
  --no-session-persistence \
  --model claude-opus-4-7 \
  --effort medium \
  --permission-mode bypassPermissions \
  --setting-sources project \
  --settings "$CLAUDE_SETTINGS_JSON" \
  "$PROMPT"
```

High:

```bash
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude -p ... --model claude-opus-4-7 --effort high "$PROMPT"
```

XHigh:

```bash
CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 claude -p ... --model claude-opus-4-7 --effort xhigh "$PROMPT"
```

`CLAUDE_SETTINGS_JSON` should exclude benchmark rule files:

```json
{
  "claudeMdExcludes": [
    "/abs/workspace/CLAUDE.md",
    "/abs/workspace/.claude/rules/**"
  ]
}
```

Notes:

- `--bare` disables auto memory and CLAUDE.md discovery, but it also skips OAuth/Keychain auth. It failed in the observed OAuth setup, so benchmark runs should not depend on `--bare`.
- `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` is required.
- `--no-session-persistence` is required.
- `claudeMdExcludes` is required if the workspace contains `CLAUDE.md` or `.claude/rules`.

### Cursor Agent CLI

Cursor CLI version observed: `2026.05.01-eea359f`.

Normal non-Max runs can use `--model`, but observed behavior must be verified via `--output-format stream-json` init event.

```bash
agent -p \
  --output-format stream-json \
  --trust \
  --workspace "$WORK_DIR" \
  --model claude-opus-4-7-xhigh \
  "$PROMPT"

agent -p \
  --output-format stream-json \
  --trust \
  --workspace "$WORK_DIR" \
  --model gpt-5.5-medium \
  "$PROMPT"

agent -p \
  --output-format stream-json \
  --trust \
  --workspace "$WORK_DIR" \
  --model composer-2 \
  "$PROMPT"
```

Observed normalized model IDs:

- `gpt-5.5-medium` -> `modelId: gpt-5.5`, `context: 272k`, `reasoning: medium`
- `claude-opus-4-7-xhigh` -> `modelId: claude-opus-4-7`, `thinking: true`, `context: 300k`, `effort: xhigh`
- `composer-2` -> `modelId: composer-2`, `fast: false` when configured directly

Max Mode:

- No official `agent --max` or `agent --max-mode` flag was observed.
- Cursor CLI reads `~/.cursor/cli-config.json`.
- `maxMode: true` plus `selectedModel.parameters.context = "1m"` produced stream-json init events such as `GPT-5.5 1M Medium` and `Opus 4.7 (Thinking) 1M Extra High`.
- For Max runs, do not pass `--model`; write a temporary `cli-config.json`, run `agent -p`, then restore the original config.

GPT-5.5 Medium Max config shape:

```json
{
  "maxMode": true,
  "model": {
    "modelId": "gpt-5.5",
    "displayModelId": "gpt-5.5",
    "displayName": "GPT-5.5 1M Medium",
    "displayNameShort": "GPT-5.5 1M Medium",
    "aliases": [],
    "maxMode": true
  },
  "selectedModel": {
    "modelId": "gpt-5.5",
    "parameters": [
      { "id": "context", "value": "1m" },
      { "id": "reasoning", "value": "medium" },
      { "id": "fast", "value": "false" }
    ]
  }
}
```

Claude Opus 4.7 XHigh Max config shape:

```json
{
  "maxMode": true,
  "model": {
    "modelId": "claude-opus-4-7",
    "displayModelId": "claude-opus-4-7",
    "displayName": "Opus 4.7 (Thinking) 1M Extra High",
    "displayNameShort": "Opus 4.7 (Thinking) 1M Extra High",
    "aliases": [],
    "maxMode": true
  },
  "selectedModel": {
    "modelId": "claude-opus-4-7",
    "parameters": [
      { "id": "thinking", "value": "true" },
      { "id": "context", "value": "1m" },
      { "id": "effort", "value": "xhigh" }
    ]
  }
}
```

Notes:

- Cursor CLI reads `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules`. Fixture repos should remove or neutralize these files unless they are intentionally part of every harness condition.
- Cursor CLI writes `~/.cursor/cli-config.json`; parallel Cursor runs can race on `cli-config.json.tmp`. Run Cursor jobs serially or isolate config.
- Each Cursor run should save the stream-json init event to confirm the actual model string.

## Benchmark Data Layout

Proposed layout:

```text
benchmark/
  repos/
    repos.yaml
    app-pr-scan-summary.md
  rate-cards/
    example-2026-05-03.json
  cases/
    <repo-slug>/
      low.yaml
      mid.yaml
      high.yaml
      hidden-tests/
        low/
        mid/
        high/
  runs/
    <run-id>/
      result.json
      prompt-bundle.json
      prompt.txt
      harness.events.jsonl
      harness.result.json
      harness.stderr.log
      harness.diff.patch
      harness.git-status.txt
      core-0.stdout.log
      core-0.stderr.log
  experiments/
    <experiment-id>/
      manifest.json
      summary.json
      failure-reviews.json
      results.html
  reports/
    index.html
```

`cases/*.yaml` must include enough information to reproduce:

```yaml
id: small-example-low
repo: owner/name
repo_url: https://github.com/owner/name
license: MIT
stars_at_selection: 1234
size_bucket: small
language_tags: [typescript, react]
pr_number: 123
pr_url: https://github.com/owner/name/pull/123
merged_at: "2026-04-01T12:34:56Z"
base_commit: abc123
fixed_commit: def456
difficulty: low
instruction: >
  The parser incorrectly accepts an empty segment in nested route patterns.
  Reproduce the failing behavior and fix it without changing the public API.
setup:
  - npm ci
public_tests:
  - npm test -- --runInBand
hidden_tests:
  - ./benchmark-hidden/run.sh small-example-low
test_strategy:
  core_tests:
    - ./benchmark-hidden/core/run.sh
  oracle_suites:
    - id: original-pr
      command: ./benchmark-hidden/oracles/original/run.sh
    - id: alternative-a
      command: ./benchmark-hidden/oracles/alternative-a/run.sh
  regression_tests:
    - ./benchmark-hidden/regressions/run.sh
  success_rule: core_and_regression_and_one_oracle
selection_notes: >
  Narrow bug fix with clear behavioral tests and limited solution space.
```

Run metadata should include:

```json
{
  "condition_id": "claude-opus-4-7-xhigh/baseline",
  "harness": "claude",
  "model": "claude-opus-4-7",
  "effort": "xhigh",
  "prompt_bundle_id": "baseline-v1",
  "prompt_bundle_sha256": "...",
  "skill_bundle_id": "none",
  "skill_bundle_sha256": null,
  "rule_bundle_id": "none",
  "rule_bundle_sha256": null,
  "memory_policy": "disabled",
  "config_overrides": {}
}
```

## Repository Exploration Workflow

1. Generate candidate repositories by language/framework and activity.
2. Filter by stars, license, 2026 merged PR count, and local test viability.
3. For each selected repo, fetch recent merged PRs.
4. Filter PRs to debug/fix candidates.
5. Classify candidate PRs into low/mid/high.
6. For each selected PR, verify:
   - base commit builds
   - original failing behavior can be reproduced
   - fixed commit passes
   - hidden tests can be extracted or written
7. Write `cases/*.yaml`.
8. Run a smoke benchmark on one harness before scaling.

## Open Decisions

- Exact LOC thresholds for size buckets.
- Whether Cursor Max Mode is part of the primary matrix or a separate Cursor-only axis.
- Whether to include full test suite in scoring or only targeted + hidden tests.
- How many retry attempts per harness condition.
- Whether network should be disabled during agent debugging runs.
