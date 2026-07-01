#!/usr/bin/env bash
# Gate 6f — graph one-door (ADR-0002). Blocking from M3.
#
# Only engines/graph/, engines/student_context.py, and routes/graph_routes.py
# may touch graph tables. Until the graph lands (M3), this gate self-arms: if a
# graph package appears, it fails so the real check gets written with it.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [ -d "$ROOT/backend/engines/graph" ]; then
  fail "graph-one-door: engines/graph/ exists but this gate is still a stub — implement the one-door check (ADR-0002 Gate 6f)"
fi

pass "graph-one-door: no graph subsystem yet (lands M3) — informational"
