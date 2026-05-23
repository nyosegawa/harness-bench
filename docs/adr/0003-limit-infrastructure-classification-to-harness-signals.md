---
id: ADR-0003
title: Limit infrastructure classification to harness signals
status: accepted
date: 2026-05-24
deciders:
  - Sakasegawa
tags:
  - scoring
  - invalid-runs
  - metrics
  - benchmark-validity
related:
  - ../benchmark-spec.md
  - ../runner.md
---

# ADR-0003: Limit Infrastructure Classification to Harness Signals

## Context

HarnessBench preserves invalid infrastructure runs so they can be retried and
audited without counting against success-rate summaries. The runner originally
scanned harness output and hidden-test output for broad strings such as
`not authenticated` or `connection timed out`.

That was too broad for Cursor. Cursor stream JSON contains assistant reasoning,
tool results, source snippets, and final explanations. A target repository can
legitimately contain strings such as `user not authenticated`, and a benchmark
case can legitimately involve timeout behavior. Scanning the full stream can
therefore misclassify a real benchmark failure as an infrastructure failure.

## Decision

Authentication and network invalid-run classification will use harness-level
signals only:

- harness stderr
- harness-specific log files
- non-Cursor stdout when the harness uses stdout for infrastructure logs

Cursor stdout/events are excluded from authentication and network
classification because they are the model transcript, not only a harness
diagnostic stream. Hidden-test output remains available for disk and quota
classification when appropriate, but target-domain failures should normally be
valid benchmark failures.

## Consequences

### Positive

- Target-code strings no longer trigger false infrastructure invalids.
- Parser fixes can re-normalize preserved raw logs instead of rerunning agent
  jobs.
- Success-rate summaries better reflect hidden-test pass/fail outcomes.

### Negative

- Some genuine authentication/network failures may require harness stderr/log
  evidence to be classified automatically.
- Harnesses with weak diagnostic output may need harness-specific parser rules.

## Alternatives Considered

### Continue scanning all output

Rejected. It is simple but confuses benchmark-domain failures with host
infrastructure failures.

### Never classify authentication or network failures automatically

Rejected. Real host authentication, keyring, network, and quota failures occur
often enough that preserving and retrying them automatically is useful.

## Follow-Up

- Prefer narrow harness-specific infrastructure patterns over generic strings.
- Re-normalize existing result files when parser rules change and raw logs are
  sufficient.
- Keep `invalid_reason` auditable by preserving the original run directory and
  raw logs.
