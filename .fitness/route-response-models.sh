#!/usr/bin/env bash
# Gate 6b (ADR 0002): every endpoint the UI consumes carries a typed response — so the
# generated OpenAPI client is accurate, not `unknown`. Rather than grep Python decorators
# (fragile with router prefixes), this checks the actual OpenAPI schema: each listed
# endpoint must have a non-empty 2xx JSON response schema (FastAPI emits `{}` without a
# response_model, a `$ref`/array with one).
#
# Needs the regenerated schema at web/src/api/openapi.json (run scripts/openapi-export.py).
# The contract surface in ui-contract-endpoints.txt grows one slice at a time.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

LIST=".fitness/ui-contract-endpoints.txt"
OAS="web/src/api/openapi.json"
if [ ! -f "$OAS" ]; then
  echo "skip 6b: $OAS absent — run scripts/openapi-export.py (enforced in the web-contract CI job)"
  exit 0
fi

python3 - "$LIST" "$OAS" <<'PY'
import json, sys
list_path, oas_path = sys.argv[1], sys.argv[2]
paths = json.load(open(oas_path)).get("paths", {})
fail = checked = 0
for raw in open(list_path):
    line = raw.strip()
    if not line or line.startswith("#"):
        continue
    parts = line.split()
    method, path = parts[0].lower(), parts[1]
    checked += 1
    op = paths.get(path, {}).get(method)
    if not op:
        print(f"FAIL 6b: {method.upper()} {path} not found in OpenAPI schema"); fail = 1; continue
    typed = False
    for code, resp in (op.get("responses") or {}).items():
        if str(code).startswith("2"):
            schema = ((resp.get("content", {}) or {}).get("application/json", {}) or {}).get("schema")
            if schema:  # empty {} (no response_model) is falsy
                typed = True
    if not typed:
        print(f"FAIL 6b: {method.upper()} {path} has no typed 2xx response (add response_model=)"); fail = 1
print(f"ok 6b: {checked} UI-contract endpoint(s) checked")
sys.exit(1 if fail else 0)
PY
