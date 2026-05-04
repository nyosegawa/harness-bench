# HarnessBench Docker Images

These images provide fixed toolchain environments for setup and test execution.
Agent CLIs run on the host; repositories are mounted into containers at
`/work/repo`.

Images:

```text
ghcr.io/nyosegawa/harness-bench-node:22
ghcr.io/nyosegawa/harness-bench-rust:1.85
ghcr.io/nyosegawa/harness-bench-python:3.12
ghcr.io/nyosegawa/harness-bench-go:1.24
ghcr.io/nyosegawa/harness-bench-polyglot:2026-05
```

Build locally:

```bash
docker build -t ghcr.io/nyosegawa/harness-bench-node:22 docker/node-22
docker build -t ghcr.io/nyosegawa/harness-bench-rust:1.85 docker/rust-1.85
docker build -t ghcr.io/nyosegawa/harness-bench-python:3.12 docker/python-3.12
docker build -t ghcr.io/nyosegawa/harness-bench-go:1.24 docker/go-1.24
docker build -t ghcr.io/nyosegawa/harness-bench-polyglot:2026-05 docker/polyglot-2026-05
```

Official manifests record image digests.
