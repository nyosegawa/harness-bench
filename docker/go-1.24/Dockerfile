FROM golang:1.24-bookworm

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
    unzip \
    xz-utils \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work/repo
