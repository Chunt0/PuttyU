#!/usr/bin/env bash
# Gate 6e — TypeScript only under web/ (ADR-0002): no new .js/.jsx/.mjs/.cjs.
# Unavoidable infra files live in allowlists/ts-only.txt (shrink-only).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ALLOWLIST="$ROOT/.fitness/allowlists/ts-only.txt"
violations=0

while IFS= read -r file; do
  rel="${file#"$ROOT"/}"
  if ! read_allowlist "$ALLOWLIST" | grep -qxF "$rel"; then
    echo "JS file under web/: $rel" >&2
    violations=1
  fi
done < <(
  find "$ROOT/web" \
    \( -name node_modules -o -name dist -o -name test-results -o -name playwright-report \) -prune -o \
    -type f \( -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.cjs' \) -print
)

[ "$violations" -eq 0 ] || fail "ts-only: JavaScript files found under web/"
pass "ts-only: web/ is TypeScript-only"
