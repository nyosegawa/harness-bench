---
id: ADR-0001
title: Do not adopt Docker Sandboxes for HarnessBench v2
status: accepted
date: 2026-05-05
deciders:
  - Sakasegawa
tags:
  - execution-environment
  - docker
  - sandbox
  - benchmark-validity
related:
  - ../benchmark-spec.md
  - ../runner.md
---

# ADR-0001: Do Not Adopt Docker Sandboxes for HarnessBench v2

## Context

HarnessBench v2 uses a hybrid execution model:

- Codex, Claude Code, and Cursor Agent run as host CLIs with native
  authentication.
- Runner-managed workspaces are sanitized before agent execution.
- Repository setup and scoring tests run in pinned Docker containers.
- Hidden scoring containers run with network disabled.

Docker Sandboxes were considered as an alternative execution substrate for
agent execution. In that design, agent CLIs would run through `sbx` inside
Docker-managed sandboxes rather than directly on the host.

## Decision

HarnessBench v2 will keep the existing hybrid execution model. Docker
Sandboxes will not be used for the v2 official benchmark.

The primary reason is that Docker Sandboxes are still an Early Access feature.
Using an early-access execution substrate for the official benchmark would make
the benchmark's reproducibility and long-term interpretability depend on an
unstable external interface.

This decision does not commit HarnessBench to adopting Docker Sandboxes in a
future version. Docker Sandboxes remain a candidate for future investigation.

## Consequences

### Positive

- The v2 official protocol remains close to the way the production agent CLIs
  are normally used.
- Existing model, effort, logging, and metrics behavior remains comparable with
  the v2 pilot runs.
- The official run does not depend on early-access `sbx` behavior, sandbox
  templates, or sandbox lifecycle semantics.
- Hidden-test reproducibility remains anchored on pinned Docker scoring images.

### Negative

- Agent execution still depends on the host CLI environment and native
  authentication setup.
- Host-level safeguards must continue to handle memory/config contamination,
  workspace cleanup, disk usage, and Docker Desktop availability.
- The benchmark cannot claim sandbox-normalized agent execution in v2.

## Alternatives Considered

### Adopt Docker Sandboxes for v2

Rejected for v2. Although Docker Sandboxes are promising for isolation and
host safety, adopting them would change the execution substrate after v2
conditions had already been validated. It would also introduce early-access
behavior into the official benchmark.

### Run both native-host and Docker Sandbox matrices

Rejected for v2. Running both would be useful as an ablation, but it would
double the matrix and complicate interpretation. Native-host and sandbox
results should not be mixed in one official leaderboard.

### Replace v2 with a sandbox-normalized protocol

Not selected. This may become a future investigation, but no decision has been
made to adopt it for a future HarnessBench version.

## Follow-Up

Docker Sandboxes can be reconsidered if the following questions have stable
answers:

- Is the Docker Sandboxes interface out of Early Access and version-pinable?
- Can sandbox templates be pinned and audited, or can HarnessBench define a
  common template across Codex, Claude Code, and Cursor Agent?
- Do model and effort selections behave identically through `sbx`?
- Are raw logs and normalized metrics available at the same granularity?
- Can credentials, network policy, workspace mounts, and cleanup behavior be
  represented in the experiment manifest?
- Does sandbox cleanup reliably release disk usage after each run?

