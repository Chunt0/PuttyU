#!/usr/bin/env bash
# Gate 6c — no raw request.json() (ADR-0002): routes parse bodies via typed
# Pydantic models so the contract seam (Gate 1) sees every shape.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BACKEND_DIRS=("$ROOT/backend/app.py" "$ROOT/backend/core" "$ROOT/backend/routes")
[ -d "$ROOT/backend/engines" ] && BACKEND_DIRS+=("$ROOT/backend/engines")

if grep -rnE 'request\.json\s*\(' "${BACKEND_DIRS[@]}" --include='*.py' 2>/dev/null; then
  fail "no-raw-json: raw request.json() found — parse via a typed Pydantic body"
fi

pass "no-raw-json: no raw request.json() in the backend"
