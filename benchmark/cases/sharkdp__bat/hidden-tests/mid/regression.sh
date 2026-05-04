#!/usr/bin/env bash
set -euo pipefail

repo="${1:-$PWD}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

python3 - "$tmp_dir/del.txt" <<'PY'
import sys
open(sys.argv[1], "wb").write(b"\x7f" * 20 + b"END\n")
PY

del_output_file="$tmp_dir/del-output.txt"
(
  cd "$repo"
  cargo run --quiet -- \
    --binary=as-text \
    --wrap=character \
    --terminal-width=40 \
    --decorations=always \
    --style=plain \
    --color=never \
    "$tmp_dir/del.txt" > "$del_output_file"
)

del_line_count="$(wc -l < "$del_output_file" | tr -d ' ')"
if [[ "$del_line_count" != "2" ]]; then
  printf 'expected DEL control-character input to render as 2 lines, got %s\n' "$del_line_count" >&2
  python3 - <<'PY' "$del_output_file" >&2
import sys
print(repr(open(sys.argv[1], "rb").read()))
PY
  exit 1
fi

printf '1234567890123456789012345678901234567890END\n' > "$tmp_dir/plain.txt"
plain_output_file="$tmp_dir/plain-output.txt"
(
  cd "$repo"
  cargo run --quiet -- \
    --wrap=character \
    --terminal-width=40 \
    --decorations=always \
    --style=plain \
    --color=never \
    "$tmp_dir/plain.txt" > "$plain_output_file"
)

plain_line_count="$(wc -l < "$plain_output_file" | tr -d ' ')"
if [[ "$plain_line_count" != "2" ]]; then
  printf 'expected plain long input to still wrap as 2 lines, got %s\n' "$plain_line_count" >&2
  exit 1
fi
