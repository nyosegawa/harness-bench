---
id: ADR-0002
title: Isolate host CLI homes and cache repository mirrors
status: accepted
date: 2026-05-24
deciders:
  - Sakasegawa
tags:
  - execution-environment
  - host-cli
  - authentication
  - caching
  - benchmark-validity
related:
  - ../benchmark-spec.md
  - ../runner.md
  - 0001-do-not-adopt-docker-sandboxes-for-v2.md
---

# ADR-0002: Isolate Host CLI Homes and Cache Repository Mirrors

## Context

HarnessBench v2 runs commercial agent CLIs on the host so they can use their
native authentication flows and logging behavior. That approach keeps the
benchmark close to how the tools are actually used, but it creates two
operational problems:

- Cursor and Antigravity store model selection and authentication state under
  home-directory config paths.
- Repeatedly cloning the same repositories for every case and retry wastes time
  and network bandwidth.

The benchmark must also preserve baseline validity. Host credentials may be
copied into a run, but memory, skills, plugins, and target-repository steering
files must not influence the agent.

## Decision

HarnessBench will use run-local harness homes for host CLIs that need mutable
home-directory state:

- Cursor runs with `HOME=benchmark/runs/<run-id>/harness-home`, after copying
  the host Cursor authentication/config files into that directory.
- Antigravity runs with a copied `~/.gemini` tree under the run-local home,
  rejects global Gemini/Antigravity steering files, rejects non-empty
  Antigravity plugin/skill directories, and performs a Secret Service preflight.
- Cursor `cursor_config` and Antigravity `antigravity_config` are applied only
  inside the run-local home.

HarnessBench will also maintain local bare mirrors under
`benchmark/cache/repos`. Each run clones from the mirror and then checks out the
case base commit into an isolated workspace. The cache is local-only and is not
published as an experiment artifact.

## Consequences

### Positive

- Cursor model-selection patches no longer require a global CLI config lock, so
  Cursor runs can be scheduled in parallel.
- Antigravity baseline runs can use native authentication while rejecting
  global steering and custom extension state.
- Repeated retries and matrix resumes avoid most network clone cost.
- Raw logs and per-run homes remain available locally for audit and parser
  fixes.

### Negative

- Host authentication still has to be prepared before the run.
- Run directories are larger because each run can contain a copied harness home.
- The runner must maintain harness-specific rules for what can be copied and
  what must be rejected.
- Secret Service failures remain environment setup failures rather than
  benchmark failures.

## Alternatives Considered

### Keep using the global host home

Rejected. Global home state makes parallel Cursor config changes unsafe and
risks benchmark contamination from persistent memory or customization files.

### Serialize all Cursor and Antigravity jobs

Rejected. Serialization is simple but unnecessarily slow once config writes are
confined to per-run homes. Quota limits can still require external scheduling,
but they should not force a global runner design.

### Clone from GitHub for every run

Rejected. It keeps the implementation simple but is slow and fragile under
large retry-heavy matrices. A local bare mirror preserves isolated workspaces
without repeated network checkout cost.

## Follow-Up

- Keep `benchmark/cache/` local-only and excluded from public artifacts.
- Document new harness-specific steering files as they appear.
- Continue treating parser fixes as re-normalization work when raw logs are
  sufficient, instead of rerunning expensive jobs.
