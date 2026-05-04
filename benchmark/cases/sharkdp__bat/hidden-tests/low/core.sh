#!/usr/bin/env bash
set -euo pipefail

repo="${1:-$PWD}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

for idx in 1 2 3; do
  case "$idx" in
    1) printf 'PK\003\004hello' > "$tmp_dir/test-$idx.zip" ;;
    2) printf 'PK\005\006hello' > "$tmp_dir/test-$idx.zip" ;;
    3) printf 'PK\007\010hello' > "$tmp_dir/test-$idx.zip" ;;
  esac

  output="$(
    cd "$repo"
    cargo run --quiet -- "$tmp_dir/test-$idx.zip" \
      --decorations=always \
      --style=header \
      -r=0:0 \
      --file-name="test-$idx.zip"
  )"

  expected="File: test-$idx.zip   <BINARY>"
  if [[ "$output" != "$expected" ]]; then
    printf 'expected: %s\n' "$expected" >&2
    printf 'actual:   %s\n' "$output" >&2
    exit 1
  fi
done
