# HarnessBench Specification

HarnessBench compares coding-agent harnesses on real-repository debugging
tasks. Each case is derived from a real merged bug fix, but agents are scored
against hidden behavioral tests rather than patch similarity.

Full title:

```text
HarnessBench: Comparing Coding Agent Harnesses on Real-Repository Debugging Tasks
```

## Goals

- Compare harness behavior, not just model capability.
- Use real repositories and real bug-fix tasks.
- Keep prompts neutral and avoid implementation-path leakage.
- Preserve raw logs so metrics parsers can be improved without rerunning agents.
- Make reports readable enough for public review and detailed enough for
  follow-up analysis.

## Non-Goals

- Patch matching against the upstream PR.
- Prompting agents toward known fixed files or hidden tests.
- Using repository-local agent instructions from the target repo.
- Treating LLM failure review as authoritative grading.

## Case Set

The public benchmark case set contains 27 cases:

- 9 repositories
- 3 difficulties per repository: `low`, `mid`, `high`
- each case has a base commit, fixed commit, public setup/tests, and hidden
  scoring tests

Each selected case should satisfy:

- base commit fails hidden scoring
- fixed commit passes hidden scoring
- hidden tests exercise observable behavior, not implementation shape
- the issue can be explained without linking the original PR to the agent
- the expected fix is narrow enough for a bounded harness run

## Scoring Model

HarnessBench uses two scoring layers.

```yaml
test_strategy:
  core_tests:
    - benchmark/cases/<repo>/hidden-tests/<difficulty>/core.sh
  regression_tests:
    - benchmark/cases/<repo>/hidden-tests/<difficulty>/regression.sh
  success_rule: core_and_regression
```

### Core Tests

`core_tests` define the behavioral contract for the bug fix. Every core test
must pass.

Core tests should be written as a behavioral class. If multiple implementation
paths are valid, the core assertion should test their shared externally visible
contract rather than enumerate the paths.

Good core tests ask questions like:

- Does the broken input now behave correctly?
- Does the crash, hang, missing authorization, incorrect serialization, or
  wrong routing behavior disappear?
- Does the fix work across representative boundary inputs?

Core tests must not check:

- exact upstream diff shape
- private helper names
- a specific changed file
- fragile text not required by public behavior

### Regression Tests

`regression_tests` protect surrounding behavior that is easy to break while
fixing the bug. Every regression test must pass.

Regression tests should target overbroad or shortcut fixes:

- valid inputs near the broken boundary
- existing public API behavior
- representative old behavior that must stay unchanged
- negative controls that hidden-test fixture special-casing would mishandle

### Success Rules

Official cases use `core_and_regression`:

```text
all core_tests pass
AND all regression_tests pass
```

`core_and_regression` is the only accepted success rule. Core tests define the
required user-visible behavior as a behavioral contract. Regression tests
protect nearby behavior that should remain unchanged.

## Case YAML

Required fields:

```yaml
id: owner-repo-difficulty-short-name
repo: owner/repo
repo_url: https://github.com/owner/repo
license: MIT
stars_at_selection: 12345
size_bucket: small
language_tags: [typescript]
pr_number: 123
pr_url: https://github.com/owner/repo/pull/123
pr_title: Short upstream title
merged_at: "2026-04-01T12:34:56Z"
base_commit: abc123
original_pr_head_commit: def456
fixed_commit: fedcba
difficulty: low
instruction: >
  Neutral debugging prompt. Do not mention hidden tests, fixed files, or the
  original PR.
setup:
  - npm ci
public_tests:
  - npm test
test_strategy:
  core_tests:
    - benchmark/cases/owner__repo/hidden-tests/low/core.sh
  regression_tests:
    - benchmark/cases/owner__repo/hidden-tests/low/regression.sh
  success_rule: core_and_regression
selection_notes: >
  Why this case is suitable.
```

Cases express scoring through `test_strategy`.

## Hidden Test Authoring

Hidden test scripts receive the repository path as their first argument:

```bash
#!/usr/bin/env bash
set -euo pipefail
repo="${1:?repo path required}"
cd "$repo"
```

Guidelines:

- keep tests deterministic and offline after setup
- use temporary files/directories for fixtures
- print concise diagnostics on failure
- avoid unnecessary full-suite execution inside hidden tests
- avoid checking implementation details
- include negative controls in regression tests

## Verification Gate

Before any official matrix:

```bash
node scripts/run-case.mjs --case <case.yaml> --mode verify-base
node scripts/run-case.mjs --case <case.yaml> --mode verify-fixed
```

Acceptance:

- `verify-base` fails
- `verify-fixed` passes
- failure logs identify whether core or regression failed

If a hidden-test bug is found after agent runs, preserve raw logs and regrade
saved workspaces with `scripts/regrade-agent-results.mjs` where possible.

## Harness Conditions

A condition describes one harness/model/policy configuration:

```json
{
  "id": "codex:gpt-5.5:medium:baseline",
  "harness": "codex",
  "model": "gpt-5.5",
  "effort": "medium",
  "prompt_policy": {
    "hide_original_pr": true,
    "hide_fixed_commit": true,
    "hide_hidden_tests": true,
    "disable_memory": true,
    "custom_rules": false,
    "agent_skills": false
  }
}
```

Baseline conditions must disable memory and must not load harness-specific
skills, plugins, or repository-local steering files. Harnesses that require
native host authentication may copy only authentication/configuration state into
a run-local home directory. Agent memory, skills, plugins, and target-repository
steering files remain disabled or removed.

## Official Matrix

The full HarnessBench v2 matrix is a single-sample matrix: no repeated trials
per cell.

Every condition runs all 27 cases with a 60 minute per-issue agent timeout:

```text
agentTimeoutMs = 3,600,000
```

Timeout is a benchmark failure, not an infrastructure invalid run. CLI crash,
authentication failure, network failure, and missing harness binaries are
infrastructure failures.

### Cursor Agent

Cursor runs on the host CLI with native authentication. All listed conditions
use Max Mode and 1M context where the selected model supports it.

| condition_id | model | parameters | context |
| --- | --- | --- | --- |
| `cursor:composer-2-fast:baseline` | `composer-2` | `fast=true` | Composer default |
| `cursor:composer-2:baseline` | `composer-2` | `fast=false` | Composer default |
| `cursor:composer-2.5-fast:baseline` | `composer-2.5` | `fast=true` | Composer default |
| `cursor:composer-2.5:baseline` | `composer-2.5` | `fast=false` | Composer default |
| `cursor:gpt-5.5-medium:baseline` | `gpt-5.5` | `reasoning=medium` | 1M, Max Mode |
| `cursor:gpt-5.5-high:baseline` | `gpt-5.5` | `reasoning=high` | 1M, Max Mode |
| `cursor:gpt-5.5-extra-high:baseline` | `gpt-5.5` | `reasoning=extra-high` | 1M, Max Mode |
| `cursor:claude-opus-4-7-high:baseline` | `claude-opus-4-7` | `thinking=true`, `effort=high` | 1M, Max Mode |
| `cursor:claude-opus-4-7-extra-high:baseline` | `claude-opus-4-7` | `thinking=true`, `effort=extra-high` | 1M, Max Mode |
| `cursor:claude-opus-4-7-max:baseline` | `claude-opus-4-7` | `thinking=true`, `effort=max` | 1M, Max Mode |

Cursor model selection must be confirmed from the stream `system/init` event.
The runner records the selected init model and the full `cursor_config`.

Cursor stdout is stream JSON that can contain source text, assistant reasoning,
and tool results. Infrastructure invalid-run classification must not scan this
stream for generic authentication or network phrases. Those checks are limited
to harness stderr/log output.

### Antigravity CLI

Antigravity runs on the host CLI with native authentication and Secret Service
credential storage. The baseline condition added for Antigravity is:

| condition_id | model | effort |
| --- | --- | --- |
| `antigravity:gemini-3.5-flash-high:baseline` | `Gemini 3.5 Flash (High)` | `high` |

Baseline Antigravity runs must not load global Gemini/Antigravity steering
files, custom plugins, or custom skills. The runner rejects those files before
starting the agent and removes `.gemini/` and `.antigravitycli/` from the target
workspace.

### Codex CLI

| condition_id | model | effort |
| --- | --- | --- |
| `codex:gpt-5.5:medium:baseline` | `gpt-5.5` | `medium` |
| `codex:gpt-5.5:high:baseline` | `gpt-5.5` | `high` |
| `codex:gpt-5.5:xhigh:baseline` | `gpt-5.5` | `xhigh` |

### Claude Code CLI

| condition_id | model | effort |
| --- | --- | --- |
| `claude:claude-opus-4-7:high:baseline` | `claude-opus-4-7` | `high` |
| `claude:claude-opus-4-7:xhigh:baseline` | `claude-opus-4-7` | `xhigh` |
| `claude:claude-opus-4-7:max:baseline` | `claude-opus-4-7` | `max` |

Total:

```text
14 conditions * 27 cases = 378 agent runs
```

## Harness Version Recording

Each run records the harness binary version before agent execution:

```json
{
  "harness_version": {
    "name": "claude",
    "version_string": "2.1.126",
    "binary_path": "/usr/local/bin/claude",
    "binary_sha256": "...",
    "captured_at": "2026-05-04T10:23:45.123Z",
    "raw_version_output": "claude-code 2.1.126\n"
  }
}
```

Version commands:

| Harness | Command |
| --- | --- |
| Codex | `codex --version` |
| Claude Code | `claude --version` |
| Cursor Agent | `agent --version` |

Experiment manifests aggregate per-harness versions and flag version drift.
Publishable runs should use strict drift handling.

## Execution Environment

HarnessBench uses a hybrid Docker architecture:

- agent CLI runs on the host with native authentication
- workspace lives on the host and is bind-mounted into containers
- repository setup, public tests, core tests, and regression tests run inside
  Docker
- hidden scoring containers run with `--network none`

Docker Sandboxes were considered for agent execution but are not part of the
HarnessBench v2 official protocol. See
[`ADR-0001`](adr/0001-do-not-adopt-docker-sandboxes-for-v2.md).

Repository clones are not baked into images. Images provide toolchains and
system dependencies only.

Initial public images:

```text
ghcr.io/nyosegawa/harness-bench-rust:1.88@sha256:...
ghcr.io/nyosegawa/harness-bench-node:22@sha256:...
ghcr.io/nyosegawa/harness-bench-python:3.12@sha256:...
ghcr.io/nyosegawa/harness-bench-go:1.26@sha256:...
ghcr.io/nyosegawa/harness-bench-polyglot:2026-05@sha256:...
```

Case YAML records the image digest:

```yaml
environment:
  image: ghcr.io/nyosegawa/harness-bench-rust:1.88@sha256:...
  workdir: /work/repo
  setup_in_container: true
  tests_in_container: true
  test_network: none
```

## Workspace Sanitization

Before an agent starts, runner-managed workspaces remove:

```text
AGENTS.md
agents.md
CLAUDE.md
claude.md
.agents/
.claude/
.codex/
```

Agent workspaces are then re-initialized as fresh one-commit git repositories.
This prevents deleted steering files from being recoverable through ordinary
git inspection while preserving the original base commit in result metadata.

## Reporting

Official reports should show:

- success rate by harness/model/condition
- success rate by difficulty and repository size
- Wilson 95% confidence intervals for pass rates
- paired McNemar tests for condition comparisons
- effect sizes for paired outcomes
- wall time, harness time, turns, tool calls, tokens, and cost
- cost per pass and time per pass
- invalid runs separately from benchmark failures
- core vs regression failure breakdown
- timeout counts per condition
- Pareto frontier: pass rate vs median wall time, with cost per pass
- auxiliary failure reviews for failed runs
- false-negative investigation notes when grading changes

LLM failure review is auxiliary. Hidden tests remain the grading authority.

HarnessBench is distributed through the GitHub repository and citation metadata
(`CITATION.cff`). A separate Hugging Face or Zenodo dataset distribution is not
part of the core release plan.
