#!/usr/bin/env bash
# Run every fitness function (Gate 6). Non-zero if any gate fails. Used by the CI
# `fitness` job and runnable locally: `bash .fitness/run-all.sh`.
set -uo pipefail
here="$(dirname "$0")"

rc=0
for gate in file-size route-response-models no-new-raw-json no-cross-feature-import no-javascript graph-one-door; do
  echo "── ${gate} ──"
  bash "${here}/${gate}.sh" || rc=1
done

echo
if [ "$rc" -eq 0 ]; then echo "ALL FITNESS GATES PASS"; else echo "FITNESS GATES FAILED"; fi
exit "$rc"
