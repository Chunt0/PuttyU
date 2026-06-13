#!/usr/bin/env bash
# Gate 6f (ADR 0005): the graph has ONE door. No Python file outside the allowlisted
# prefixes (src/graph/, src/student_context.py, routes/graph_routes.py, tests/) may
# query the graph tables directly — neither raw SQL (FROM/JOIN/INTO/UPDATE on the
# table names) nor the ORM classes (importing/using ConceptNode & friends). Call
# sites consume student_context() / the /api/graph routes instead; convention won't
# hold this, the build must (ADR 0002).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

ALLOW=".fitness/graph-one-door-allowlist.txt"

# Raw-SQL table references and ORM-class usage of the five graph tables.
TABLES='concept_node|entity_node|assertion|mastery_evidence|mastery_state'
CLASSES='ConceptNode|EntityNode|Assertion|MasteryEvidence|MasteryState'
SQL_RE="(FROM|JOIN|INTO|UPDATE|TABLE)[[:space:]]+(${TABLES})\b"
ORM_RE="(from[[:space:]]+src\.graph\.models[[:space:]]+import[[:space:]]+[^#]*(${CLASSES})|graph\.models\.(${CLASSES})\b)"

allowed() {
  local f="$1"
  while IFS= read -r prefix; do
    case "$prefix" in ''|\#*) continue ;; esac
    case "$f" in "$prefix"*) return 0 ;; esac
  done < "$ALLOW"
  return 1
}

fail=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  allowed "$f" && continue
  hits=$(grep -nEi "$SQL_RE" "$f" || true)
  hits2=$(grep -nE "$ORM_RE" "$f" || true)
  if [ -n "$hits$hits2" ]; then
    echo "FAIL 6f: $f touches graph tables directly (use src/student_context.py or /api/graph):"
    printf '%s\n' "$hits" "$hits2" | sed '/^$/d;s/^/    /'
    fail=1
  fi
done < <(git ls-files '*.py')

[ "$fail" -eq 0 ] && echo "ok 6f: graph tables have one door"
exit "$fail"
