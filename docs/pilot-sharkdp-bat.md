# Pilot: `sharkdp/bat`

## Repository

- Repo: `sharkdp/bat`
- URL: https://github.com/sharkdp/bat
- License: Apache-2.0
- Stars at selection: 58657
- Primary language: Rust
- Size bucket: small
- Target type: CLI

This repository is a good pilot target because it has fast, observable CLI behavior and relatively lightweight local setup compared with full-stack applications.

## Selected Cases

### Low: ZIP Binary Detection

- Case file: `benchmark/cases/sharkdp__bat/low.yaml`
- PR: https://github.com/sharkdp/bat/pull/3686
- Base commit: `111aa2e10e7a7f0dcf43c209e643593ac013d623`
- Fixed commit: `a995764d230e49e089febd8e5487c1d61e5d3051`
- Hidden test: `benchmark/cases/sharkdp__bat/hidden-tests/low/run.sh`

Behavior:

- Base commit prints `File: test.zip`
- Fixed commit prints `File: test.zip   <BINARY>`

Verdict: suitable low case.

### Mid: Control Character Wrapping

- Case file: `benchmark/cases/sharkdp__bat/mid.yaml`
- PR: https://github.com/sharkdp/bat/pull/3640
- Base commit: `4a38eab3eaa191a6a19239bde42f7d5b79d7cb21`
- Fixed commit: `f2daa1eb6e2bb21366d856ca9e160698a69fd8eb`
- Hidden test: `benchmark/cases/sharkdp__bat/hidden-tests/mid/run.sh`

Behavior:

- Base commit renders the crafted control-character input as 1 line.
- Fixed commit renders it as 2 lines with the same terminal width.

Verdict: suitable mid case.

### High: Fallback Syntax

- Case file: `benchmark/cases/sharkdp__bat/high.yaml`
- PR: https://github.com/sharkdp/bat/pull/3617
- Base commit: `ab80bd9717448d988445841fc9634e7d7c2f8cf6`
- Fixed commit: `844bfded506e99c06237472bd83a8af5af433538`
- Hidden test: `benchmark/cases/sharkdp__bat/hidden-tests/high/run.sh`

Behavior:

- Base commit rejects `--fallback-syntax` as an unexpected argument.
- Fixed commit supports `--fallback-syntax`, matches explicit `--language` output when detection fails, does not override detected syntax, and errors on invalid fallback syntax.

Verdict: useful for runner mechanics, but weaker as a final high case because it is feature-like rather than a bug fix. Replace with a high-difficulty bug-fix PR from an application repository if possible.

## Verification

All hidden tests were checked against base and fixed commits:

- Low: base fails, fixed passes
- Mid: base fails, fixed passes
- High: base fails, fixed passes

The hidden tests are external shell scripts and do not require copying the original PR tests into the agent-visible workspace.

## Test Strategy

The pilot currently uses a single required core suite per case:

```text
core_tests pass
```

There are no separate oracle suites yet because these three CLI cases have fairly direct behavioral specifications. The case YAML files still use the future-compatible structure:

```yaml
test_strategy:
  core_tests:
    - benchmark/cases/sharkdp__bat/hidden-tests/<level>/run.sh
  oracle_suites: []
  regression_tests: []
  success_rule: core_tests_pass
```

For later application cases, use the fuller rule:

```text
core_tests pass
AND regression_tests pass
AND at least one oracle suite passes
```

This supports multiple valid fix approaches without accepting incomplete fixes that satisfy only one required behavior.

## Hidden Test Coverage Model

The tests do not require the original PR implementation. They check behavioral equivalence classes so alternative fixes can pass.

Low ZIP detection:

- accepts the three standard ZIP signatures as binary content
- rejects a similar non-ZIP `PK` prefix as text
- preserves ordinary text behavior

Mid control-character wrapping:

- checks NUL control characters in `--binary=as-text` character wrapping
- checks DEL control characters
- checks ordinary long text still wraps normally

High fallback syntax:

- fallback syntax matches explicit language output when auto-detection fails
- `--fallback-language` alias works
- fallback does not override file-name based detection
- fallback does not override explicit `--language`
- fallback does not override first-line/shebang detection
- invalid fallback syntax returns an error

This is not a proof that every possible implementation is correct, but it covers the main behavior classes without asserting internal helper names or exact code structure.

## Next Runner Requirements

The initial runner is documented in `docs/runner.md`.

The next runner stage should:

1. Clone `sharkdp/bat`.
2. Checkout each `base_commit`.
3. Run the selected harness with the case `instruction`.
4. Save stdout, stderr, events, and diff.
5. Run the hidden test script from outside the agent-visible workspace.
6. Record pass/fail and modified files.

For this pilot, hidden tests invoke `cargo run --quiet`, so first-run compilation cost is expected.
