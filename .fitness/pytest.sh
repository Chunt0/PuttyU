#!/usr/bin/env bash
# Gate 2 — pytest required (ADR-0002).
#
# Flaky tests get @pytest.mark.quarantine and are excluded here (they run
# informationally, never with continue-on-error).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

(cd "$ROOT/backend" && uv run pytest -q -m "not quarantine")

pass "pytest: backend tests green"
