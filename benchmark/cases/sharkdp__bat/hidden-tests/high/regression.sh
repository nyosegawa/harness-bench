#!/usr/bin/env bash
set -euo pipefail

repo="${1:-$PWD}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

rust_file="$tmp_dir/main.rs"
json_file="$tmp_dir/data.unknown"
printf 'fn main() { println!("hello"); }\n' > "$rust_file"
printf '{"a": 1}\n' > "$json_file"

with_fallback="$(
  cd "$repo"
  cargo run --quiet -- \
    --color=always \
    --style=plain \
    --file-name=main.rs \
    --fallback-syntax=json \
    "$rust_file"
)"

without_fallback="$(
  cd "$repo"
  cargo run --quiet -- \
    --color=always \
    --style=plain \
    --file-name=main.rs \
    "$rust_file"
)"

if [[ "$with_fallback" != "$without_fallback" ]]; then
  printf 'fallback syntax incorrectly overrode file-name based detection\n' >&2
  exit 1
fi

explicit_with_fallback="$(
  cd "$repo"
  cargo run --quiet -- \
    --color=always \
    --style=plain \
    --language=json \
    --fallback-syntax=rust \
    --file-name=data.unknown \
    "$json_file"
)"

explicit_without_fallback="$(
  cd "$repo"
  cargo run --quiet -- \
    --color=always \
    --style=plain \
    --language=json \
    --file-name=data.unknown \
    "$json_file"
)"

if [[ "$explicit_with_fallback" != "$explicit_without_fallback" ]]; then
  printf 'fallback syntax incorrectly overrode explicit language selection\n' >&2
  exit 1
fi

shebang_file="$tmp_dir/script-with-shebang"
printf '#!/usr/bin/env python3\nprint("hello")\n' > "$shebang_file"

shebang_with_fallback="$(
  cd "$repo"
  cargo run --quiet -- \
    --color=always \
    --style=plain \
    --file-name=script-with-shebang \
    --fallback-syntax=json \
    "$shebang_file"
)"

shebang_without_fallback="$(
  cd "$repo"
  cargo run --quiet -- \
    --color=always \
    --style=plain \
    --file-name=script-with-shebang \
    "$shebang_file"
)"

if [[ "$shebang_with_fallback" != "$shebang_without_fallback" ]]; then
  printf 'fallback syntax incorrectly overrode first-line detection\n' >&2
  exit 1
fi

if (
  cd "$repo"
  cargo run --quiet -- \
    --color=always \
    --style=plain \
    --file-name=data.unknown \
    --fallback-syntax=InvalidSyntax \
    "$json_file"
) >/tmp/bat-invalid-fallback.out 2>/tmp/bat-invalid-fallback.err; then
  printf 'invalid fallback syntax unexpectedly succeeded\n' >&2
  exit 1
fi

if ! grep -q "unknown syntax: 'InvalidSyntax'" /tmp/bat-invalid-fallback.err; then
  printf 'invalid fallback syntax did not produce expected error\n' >&2
  cat /tmp/bat-invalid-fallback.err >&2
  exit 1
fi
