FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/root/.cargo/bin:/usr/local/go/bin:/opt/node/bin:${PATH}"

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    build-essential \
    ca-certificates \
    curl \
    git \
    jq \
    make \
    pkg-config \
    python3 \
    python3-pip \
    python3-venv \
    unzip \
    xz-utils \
  && curl -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain 1.85.0 \
  && curl -fsSL https://go.dev/dl/go1.24.0.linux-amd64.tar.gz | tar -C /usr/local -xz \
  && mkdir -p /opt/node \
  && curl -fsSL https://nodejs.org/dist/v22.21.1/node-v22.21.1-linux-x64.tar.xz | tar -C /opt/node --strip-components=1 -xJ \
  && /opt/node/bin/corepack enable \
  && python3 -m pip install --break-system-packages --no-cache-dir --upgrade pip uv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work/repo
