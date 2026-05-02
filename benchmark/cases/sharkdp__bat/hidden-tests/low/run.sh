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
