#!/usr/bin/env bash
set -euo pipefail

repo="${1:-$PWD}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

text_output="$(
  cd "$repo"
  printf 'PK\003\003hello' > "$tmp_dir/not-zip.txt"
  cargo run --quiet -- "$tmp_dir/not-zip.txt" \
    --decorations=always \
    --style=header \
    -r=0:0 \
    --file-name=not-zip.txt
)"

if grep -q '<BINARY>' <<<"$text_output"; then
  printf 'non-ZIP PK-prefixed text was incorrectly classified as binary\n' >&2
  printf '%s\n' "$text_output" >&2
  exit 1
fi

plain_output="$(
  cd "$repo"
  printf 'hello\n' > "$tmp_dir/plain.txt"
  cargo run --quiet -- "$tmp_dir/plain.txt" \
    --decorations=always \
    --style=header \
    -r=0:0 \
    --file-name=plain.txt
)"

if grep -q '<BINARY>' <<<"$plain_output"; then
  printf 'ordinary text was incorrectly classified as binary\n' >&2
  printf '%s\n' "$plain_output" >&2
  exit 1
fi
