FROM python:3.12-bookworm

ENV DEBIAN_FRONTEND=noninteractive

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
    unzip \
    xz-utils \
  && python -m pip install --no-cache-dir --upgrade pip uv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work/repo
