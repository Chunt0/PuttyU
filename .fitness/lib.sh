# Shared helpers for the fitness gates (ADR-0002). Source, don't execute.
#
# Every gate script:   set -euo pipefail; source lib.sh
# and gets $ROOT (repo root), plus pass/fail/violation printers.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ROOT

pass() { echo "PASS: $*"; }

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# read_allowlist <file> — echo non-comment, non-blank lines (empty if absent).
read_allowlist() {
  [ -f "$1" ] || return 0
  grep -vE '^\s*(#|$)' "$1" || true
}
