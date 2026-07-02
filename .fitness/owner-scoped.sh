#!/usr/bin/env bash
# Gate 5 — owner_scoped one-door (ADR-0002). ACTIVE since M0.1.
#
# core/scoping.py::owner_scoped() is the ONLY place user data may be scoped by
# owner. Any other `.filter(...owner...)` / `.where(...owner...)` in production
# code fails here. allowlists/owner-scoped.txt freezes legacy sites (shrink-only;
# currently empty — keep it that way).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ALLOWLIST="$ROOT/.fitness/allowlists/owner-scoped.txt"
ONE_DOOR="backend/core/scoping.py"

BACKEND_DIRS=("$ROOT/backend/app.py" "$ROOT/backend/core" "$ROOT/backend/routes")
[ -d "$ROOT/backend/engines" ] && BACKEND_DIRS+=("$ROOT/backend/engines")

hits=$(
  grep -rnE '\.(filter|where)\([^)]*\bowner\b' "${BACKEND_DIRS[@]}" \
    --include='*.py' 2>/dev/null |
    grep -v "$ONE_DOOR" || true
)

# Drop allowlisted lines (path prefix match), if any ever exist.
while IFS= read -r allowed; do
  [ -n "$allowed" ] || continue
  hits=$(echo "$hits" | grep -v "^$ROOT/$allowed" || true)
done < <(read_allowlist "$ALLOWLIST")

if [ -n "$hits" ]; then
  echo "$hits" >&2
  fail "owner-scoped: ad-hoc owner filter outside core/scoping.py — use owner_scoped(stmt, Model, user)"
fi

pass "owner-scoped: owner filters only via the one-door (core/scoping.py)"
