#!/usr/bin/env bash
# Gate 3b — Playwright e2e (ADR-0002): no screen merges without a
# critical-flow e2e. Boots the real backend (test mode) + Vite via the
# webServer config in web/playwright.config.ts.
#
# First run needs browsers:  cd web && bunx playwright install chromium
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

(cd "$ROOT/web" && bunx playwright test)

pass "e2e: Playwright critical-flow specs green"
