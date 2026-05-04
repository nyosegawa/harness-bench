# HarnessBench Docker Images

These images provide fixed toolchain environments for setup and test execution.
Agent CLIs run on the host; repositories are mounted into containers at
`/work/repo`.

Published images:

```text
ghcr.io/nyosegawa/harness-bench-node:22@sha256:43c4bd31695a5cbf59b0efdc6f6248193222d8ec107571bb92589faca8d2712c
ghcr.io/nyosegawa/harness-bench-rust:1.85@sha256:faa34d05fbc996aaa517720a2f63f5d07f43c76ddb736115aa14486fc0781fff
ghcr.io/nyosegawa/harness-bench-python:3.12@sha256:f27b83613098507a203bf791f42f51abdc9f1ed4f2b5220503930232d3761597
ghcr.io/nyosegawa/harness-bench-go:1.26@sha256:24bb18aa517ef736724b294ab461760599ed7b6ab36f0d6517eed0d39571c497
ghcr.io/nyosegawa/harness-bench-polyglot:2026-05@sha256:4e888c7fec3c4f8936dce73479faa7551bb3edcd83fb125d79596fc8605fbe61
```

Build locally:

```bash
docker build -t ghcr.io/nyosegawa/harness-bench-node:22 docker/node-22
docker build -t ghcr.io/nyosegawa/harness-bench-rust:1.85 docker/rust-1.85
docker build -t ghcr.io/nyosegawa/harness-bench-python:3.12 docker/python-3.12
docker build -t ghcr.io/nyosegawa/harness-bench-go:1.26 docker/go-1.26
docker build -t ghcr.io/nyosegawa/harness-bench-polyglot:2026-05 docker/polyglot-2026-05
```

Case YAMLs use digest-pinned references. Rebuilds can reuse the same tags, but
published experiments should record and compare the digest, not only the tag.
