#!/usr/bin/env bash
set -euo pipefail

repo="${1:-$PWD}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

unknown_file="$tmp_dir/unknown.fallbacksyntax"
printf '# comment\nfoo=bar\n' > "$unknown_file"

fallback_output="$(
  cd "$repo"
  cargo run --quiet -- \
    --color=always \
    --style=plain \
    --file-name=unknown.fallbacksyntax \
    --fallback-syntax=bash \
    "$unknown_file"
)"

explicit_output="$(
  cd "$repo"
  cargo run --quiet -- \
    --color=always \
    --style=plain \
    --language=bash \
    --file-name=unknown.fallbacksyntax \
    "$unknown_file"
)"

if [[ "$fallback_output" != "$explicit_output" ]]; then
  printf 'fallback syntax output did not match explicit language output\n' >&2
  exit 1
fi
