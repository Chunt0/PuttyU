#!/usr/bin/env bash
# Gate 3a — Bun test (unit/component) (ADR-0002).
#
# Scoped to src/ so Playwright e2e specs (web/e2e/, gate 3b) aren't picked up
# by Bun's *.spec.* glob.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

(cd "$ROOT/web" && bun test src)

pass "web-test: bun component tests green"
