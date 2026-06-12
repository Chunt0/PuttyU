#!/usr/bin/env bash
# Gate 6c (ADR 0002): no new raw body parsing in routes. `request.json()`/`request.form()`
# bypass the typed Pydantic contract the OpenAPI seam depends on. Existing uses are frozen
# in the allowlist (`path|maxcount`, occurrence count); a route file not on the allowlist
# may have zero, and an allowlisted file may not exceed its recorded count.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

ALLOW=".fitness/raw-body-allowlist.txt"
PATTERN='request\.(json|form)\(\)'

fail=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  c=$(grep -oE "$PATTERN" "$f" 2>/dev/null | wc -l | tr -d ' ')
  [ "$c" -gt 0 ] || continue
  entry=$(grep -F "$f|" "$ALLOW" 2>/dev/null | head -1)
  if [ -z "$entry" ]; then
    echo "FAIL 6c: $f introduces raw request.json()/form() ($c) — use a Pydantic model."
    fail=1
  else
    max=${entry##*|}
    if [ "$c" -gt "$max" ]; then
      echo "FAIL 6c: $f now has $c raw body calls (allowlisted $max) — migrate, don't add."
      fail=1
    fi
  fi
done < <(git ls-files 'routes/*.py')

[ "$fail" -eq 0 ] && echo "ok 6c: no new raw request body parsing"
exit "$fail"
