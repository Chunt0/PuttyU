#!/usr/bin/env bash
# Gate 5 — owner_scoped one-door (ADR-0002). Blocking from M1.
#
# Only owner_scoped(query, Model, user) may scope user data. Until the first
# user-data tables land (M1), this gate self-arms: if owner-style filters
# appear in the backend before the one-door exists, it fails loudly so the
# real gate gets built the same milestone.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BACKEND_DIRS=("$ROOT/backend/app.py" "$ROOT/backend/core" "$ROOT/backend/routes")
[ -d "$ROOT/backend/engines" ] && BACKEND_DIRS+=("$ROOT/backend/engines")

if grep -rnE '\.(filter|where)\([^)]*\bowner' "${BACKEND_DIRS[@]}" --include='*.py' 2>/dev/null; then
  fail "owner-scoped: owner filters found but the one-door gate is still a stub — implement owner_scoped() and this gate (ADR-0002 Gate 5)"
fi

pass "owner-scoped: no user-data scoping yet (one-door lands M1) — informational"
