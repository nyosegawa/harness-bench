FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    jq \
    make \
    pkg-config \
    python3 \
    python3-pip \
    unzip \
    xz-utils \
  && corepack enable \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work/repo
