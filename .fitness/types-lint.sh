#!/usr/bin/env bash
# Gate 4 — tsc strict + ESLint, and no `any` in the typed seam (ADR-0002).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

(cd "$ROOT/web" && bunx tsc --noEmit)
(cd "$ROOT/web" && bun run --silent lint)

# The generated client seam must be fully typed — `any` anywhere under
# web/src/api (including generated output) breaks end-to-end typesafety.
if grep -rnE '\bany\b' "$ROOT/web/src/api" --include='*.ts' --include='*.d.ts'; then
  fail "types-lint: \`any\` found in web/src/api — the contract seam must be fully typed"
fi

pass "types-lint: tsc --strict + eslint green, no \`any\` in web/src/api"
