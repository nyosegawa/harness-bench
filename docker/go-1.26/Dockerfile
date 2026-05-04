FROM golang:1.26-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV PATH="/usr/local/go/bin:${PATH}"

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
