#!/usr/bin/env bash
# Gate 6a (ADR 0002): no god-files. A tracked .py/.ts/.tsx over the ceiling must be split,
# or frozen in the allowlist (`path|maxlines`). An allowlisted file that GROWS past its
# recorded size also fails — the ratchet only loosens by hand, never silently.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

CEILING=800
ALLOW=".fitness/oversized-allowlist.txt"
EXCLUDE_RE='^web/node_modules/|web/src/api/schema\.d\.ts'

fail=0
while IFS= read -r f; do
  printf '%s\n' "$f" | grep -qE "$EXCLUDE_RE" && continue
  [ -f "$f" ] || continue
  n=$(wc -l < "$f")
  [ "$n" -gt "$CEILING" ] || continue
  entry=$(grep -Fx -m1 "$f|${n}" "$ALLOW" 2>/dev/null || grep -F "$f|" "$ALLOW" 2>/dev/null | head -1)
  if [ -z "$entry" ]; then
    echo "FAIL 6a: $f is $n lines (> $CEILING) and not allowlisted — split it."
    fail=1
  else
    max=${entry##*|}
    if [ "$n" -gt "$max" ]; then
      echo "FAIL 6a: $f grew to $n lines (allowlist ceiling $max) — shrink it."
      fail=1
    fi
  fi
done < <(git ls-files '*.py' '*.ts' '*.tsx')

[ "$fail" -eq 0 ] && echo "ok 6a: no new or growing god-files"
exit "$fail"
