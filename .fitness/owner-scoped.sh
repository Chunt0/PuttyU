#!/usr/bin/env bash
# Gate 5g (CLAUDE.md invariant 5 / build-plan §7): user data has ONE door —
# `owner_scoped(query, Model, user)` (src/auth_helpers.py). Ad-hoc
# `.filter(Model.owner == ...)` query filters bypass it; they're frozen in the
# allowlist (`path|maxcount`) so NO NEW one may be added and an app-code file not on
# the list may have ZERO. New routes/services scope reads with owner_scoped; the
# allowlisted counts shrink as legacy filters migrate, never grow (ADR 0002 — an
# agent forgets the convention, the build won't). Scope: src/ routes/ core/.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

ALLOW=".fitness/owner-scoped-allowlist.txt"
PATTERN='\.filter\([^)]*\.owner[[:space:]]*=='

fail=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  c=$(grep -oE "$PATTERN" "$f" 2>/dev/null | wc -l | tr -d ' ')
  [ "$c" -gt 0 ] || continue
  entry=$(grep -F "$f|" "$ALLOW" 2>/dev/null | head -1)
  if [ -z "$entry" ]; then
    echo "FAIL 5g: $f adds an ad-hoc owner filter ($c) — use owner_scoped(query, Model, user)."
    fail=1
  else
    max=${entry##*|}
    if [ "$c" -gt "$max" ]; then
      echo "FAIL 5g: $f now has $c ad-hoc owner filters (allowlisted $max) — migrate to owner_scoped, don't add."
      fail=1
    fi
  fi
done < <(git ls-files 'src/*.py' 'routes/*.py' 'core/*.py')

[ "$fail" -eq 0 ] && echo "ok 5g: owner_scoped is the only door for new user-data reads"
exit "$fail"
