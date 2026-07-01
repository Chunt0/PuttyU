#!/usr/bin/env bash
# Gate 6a — file-size ceiling: no god-files (ADR-0002).
#
# Source files stay under CEILING lines. Files allowed over it live in
# allowlists/file-size.txt — that list is frozen and may only shrink; a listed
# file that drops back under the ceiling must be removed from the list.
# Generated files are exempt (machine-written; the god-file concern is about
# code humans and agents edit).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

CEILING=400
ALLOWLIST="$ROOT/.fitness/allowlists/file-size.txt"

GENERATED=(
  web/src/api/schema.d.ts
)

is_generated() {
  local f
  for f in "${GENERATED[@]}"; do [ "$1" = "$f" ] && return 0; done
  return 1
}

is_allowlisted() {
  read_allowlist "$ALLOWLIST" | grep -qxF "$1"
}

violations=0

while IFS= read -r file; do
  rel="${file#"$ROOT"/}"
  is_generated "$rel" && continue
  lines=$(wc -l < "$file")
  if [ "$lines" -gt "$CEILING" ] && ! is_allowlisted "$rel"; then
    echo "over ceiling ($lines > $CEILING): $rel" >&2
    violations=1
  fi
done < <(
  find "$ROOT/backend" "$ROOT/web/src" \
    \( -name .venv -o -name node_modules -o -name dist \) -prune -o \
    -type f \( -name '*.py' -o -name '*.ts' -o -name '*.tsx' \) -print
)

# Allowlists shrink, never grow: a listed file now under the ceiling (or gone)
# must be dropped from the list.
while IFS= read -r listed; do
  [ -n "$listed" ] || continue
  if [ ! -f "$ROOT/$listed" ] || [ "$(wc -l < "$ROOT/$listed")" -le "$CEILING" ]; then
    echo "stale allowlist entry (remove it): $listed" >&2
    violations=1
  fi
done < <(read_allowlist "$ALLOWLIST")

[ "$violations" -eq 0 ] || fail "file-size: god-file ceiling violated"
pass "file-size: all source files ≤ $CEILING lines (allowlist clean)"
