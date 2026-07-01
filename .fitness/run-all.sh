#!/usr/bin/env bash
# Run every deterministic gate (ADR-0002) — locally and in CI.
#
#   bash .fitness/run-all.sh
#
# Gate 7 (tutor evals) is NOT here: it needs a configured model and runs
# on-demand (never a blocking CI job).
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# name:script — cheap structural gates first, toolchain gates next, e2e last.
GATES=(
  "6a file-size:file-size.sh"
  "6b response-model:response-model.sh"
  "6c no-raw-json:no-raw-json.sh"
  "6d cross-feature:cross-feature.sh"
  "6e ts-only:ts-only.sh"
  "6g router-one-door:router-one-door.sh"
  "5  owner-scoped:owner-scoped.sh"
  "6f graph-one-door:graph-one-door.sh"
  "4  types-lint:types-lint.sh"
  "2  pytest:pytest.sh"
  "3a web-test:web-test.sh"
  "1  contract:contract.sh"
  "3b e2e:e2e.sh"
)

failed=()
for gate in "${GATES[@]}"; do
  name="${gate%%:*}"
  script="${gate##*:}"
  echo
  echo "── gate $name ─────────────────────────────────────"
  if ! bash "$HERE/$script"; then
    failed+=("$name")
  fi
done

echo
echo "═══════════════════════════════════════════════════"
if [ "${#failed[@]}" -gt 0 ]; then
  echo "GATES RED: ${failed[*]}"
  exit 1
fi
echo "ALL GATES GREEN (${#GATES[@]} gates)"
