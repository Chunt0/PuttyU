#!/usr/bin/env bash
# Gate 1 — typed OpenAPI contract (ADR-0002).
#
# Regenerates the OpenAPI schema from the live FastAPI app and the TS types
# from that schema, then fails if either differs from what's committed.
# On failure the regenerated files are left in the working tree: review and
# commit them (that IS the fix — the contract is the seam).
#
# M0.4 will extend this gate to assert the SSE ChatEvent models are exported
# into components.schemas (M0-PLAN §3).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

(cd "$ROOT/backend" && uv run python scripts/openapi-export.py >/dev/null)
(cd "$ROOT/web" && bun run --silent gen:api >/dev/null)

CONTRACT_FILES=(web/src/api/openapi.json web/src/api/schema.d.ts)

# Both generated files must be tracked — an untracked contract can't drift-check.
git -C "$ROOT" ls-files --error-unmatch "${CONTRACT_FILES[@]}" >/dev/null 2>&1 ||
  fail "contract: generated contract files are not committed: ${CONTRACT_FILES[*]}"

if ! git -C "$ROOT" diff --exit-code -- "${CONTRACT_FILES[@]}" >/dev/null; then
  git -C "$ROOT" --no-pager diff --stat -- "${CONTRACT_FILES[@]}" >&2
  fail "contract: committed OpenAPI contract has drifted from the backend — commit the regenerated files"
fi

pass "contract: openapi.json + schema.d.ts match the backend"
