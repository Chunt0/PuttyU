#!/usr/bin/env bash
# Gate 6d (ADR 0002): keep the lean core from re-entangling with CUT features. Files under
# the paths in lean-core-paths.txt must NOT import any module listed in cut-modules.txt.
#
# Scope note: CUT modules are still wired into app.py until they're deleted lazily in
# Slice 7 (strangler), so this gate is enforced on the NEW lean code only (seeded with
# src/corpus/) and widens as modules are rewritten — it never lets new entanglement in.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

CUT=".fitness/cut-modules.txt"
LEAN=".fitness/lean-core-paths.txt"

cut_re=$(grep -vE '^\s*(#|$)' "$CUT" | paste -sd'|' -)
[ -z "$cut_re" ] && { echo "ok 6d: no cut modules listed"; exit 0; }

fail=0
while IFS= read -r prefix; do
  case "$prefix" in ''|\#*) continue ;; esac
  while IFS= read -r f; do
    [ -f "$f" ] || continue
    hits=$(grep -nE "^[[:space:]]*(from|import)[[:space:]]+(routes\.|services\.|src\.)?(${cut_re})([. ]|\$)" "$f" || true)
    if [ -n "$hits" ]; then
      echo "FAIL 6d: $f imports a CUT feature module:"
      printf '%s\n' "$hits" | sed 's/^/    /'
      fail=1
    fi
  done < <(git ls-files "${prefix}*.py")
done < "$LEAN"

[ "$fail" -eq 0 ] && echo "ok 6d: lean core imports no CUT modules"
exit "$fail"
