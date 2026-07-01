#!/usr/bin/env bash
# Gate 6d — no cross-feature imports (ADR-0002): feature modules don't reach
# into each other; shared code moves to shared modules.
#
# Backend: a package backend/src/<feat>/ may not import from a sibling
# package backend/src/<other>/. Top-level modules directly under src/
# (e.g. model_router.py, student_context.py) are shared by design.
# Web: web/src/features/<a> may not import from features/<b>.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

violations=0

if [ -d "$ROOT/backend/src" ]; then
  for featdir in "$ROOT/backend/src"/*/; do
    [ -d "$featdir" ] || continue
    feat=$(basename "$featdir")
    for otherdir in "$ROOT/backend/src"/*/; do
      other=$(basename "$otherdir")
      [ "$other" = "$feat" ] && continue
      if grep -rnE "^\s*(from|import)\s+src\.$other(\.|\s|$)" "$featdir" --include='*.py'; then
        echo "backend: src/$feat imports sibling feature src/$other" >&2
        violations=1
      fi
    done
  done
fi

if [ -d "$ROOT/web/src/features" ]; then
  for featdir in "$ROOT/web/src/features"/*/; do
    [ -d "$featdir" ] || continue
    feat=$(basename "$featdir")
    if grep -rnE "from\s+[\"'][^\"']*features/(?!$feat(/|[\"']))" "$featdir" \
        --include='*.ts' --include='*.tsx' -P 2>/dev/null; then
      echo "web: features/$feat imports a sibling feature" >&2
      violations=1
    fi
  done
fi

[ "$violations" -eq 0 ] || fail "cross-feature: feature modules import each other"
pass "cross-feature: no cross-feature imports"
