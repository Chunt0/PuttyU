#!/usr/bin/env bash
# Gate 6b — every UI-consumed route declares response_model= (ADR-0002), so
# the OpenAPI seam (Gate 1) stays typed.
#
# A route that legitimately can't have one (e.g. an SSE StreamingResponse)
# carries `# gate6b-exempt: <reason>` inside or directly above its decorator.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

violations=$(
  find "$ROOT/backend/routes" -name '*.py' -print0 | xargs -0 -r awk '
    /gate6b-exempt/ { exempt_next = 1 }
    /@[A-Za-z_]+\.(get|post|put|patch|delete)\(/ {
      capturing = 1; buf = ""; depth = 0
      exempt = exempt_next
    }
    capturing {
      buf = buf $0 "\n"
      depth += split($0, _o, "\\(") - split($0, _c, "\\)")
      if (depth <= 0) {
        capturing = 0
        if (buf !~ /response_model=/ && buf !~ /gate6b-exempt/ && !exempt)
          printf "%s: route without response_model=:\n%s", FILENAME, buf
        exempt_next = 0
      }
      next
    }
    !/^[[:space:]]*(#|$)/ { exempt_next = 0 }
  '
)

if [ -n "$violations" ]; then
  echo "$violations" >&2
  fail "response-model: routes missing response_model="
fi

pass "response-model: every route declares response_model="
