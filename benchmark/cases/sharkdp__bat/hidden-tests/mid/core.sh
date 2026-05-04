#!/usr/bin/env bash
set -euo pipefail

repo="${1:-$PWD}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

python3 - "$tmp_dir/control.txt" <<'PY'
import sys
open(sys.argv[1], "wb").write(b"\x00" * 20 + b"END\n")
PY

output_file="$tmp_dir/output.txt"

(
  cd "$repo"
  cargo run --quiet -- \
    --binary=as-text \
    --wrap=character \
    --terminal-width=40 \
    --decorations=always \
    --style=plain \
    --color=never \
    "$tmp_dir/control.txt" > "$output_file"
)

line_count="$(wc -l < "$output_file" | tr -d ' ')"
if [[ "$line_count" != "2" ]]; then
  printf 'expected 2 rendered lines, got %s\n' "$line_count" >&2
  python3 - <<'PY' "$output_file" >&2
import sys
print(repr(open(sys.argv[1], "rb").read()))
PY
  exit 1
fi
