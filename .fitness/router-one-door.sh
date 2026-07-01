#!/usr/bin/env bash
# Gate 6g — model-router one-door (ADR-0002): no model name is hardcoded at a
# call site; calls declare a task profile and go through engines/model_router.py.
#
# The tier table itself (in model_router.py), tests, and seed scripts may name
# models; everything else may not.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# Provider model-id fingerprints. Extend as providers are added.
PATTERN='claude-[a-z0-9]|gpt-[0-9]|gemini-[0-9]|llama[0-9]|mistral-|qwen[0-9]'

ALLOWED_RE='backend/(engines/model_router\.py|tests/|scripts/)'

hits=$(
  grep -rnE "$PATTERN" \
    "$ROOT/backend/app.py" "$ROOT/backend/core" "$ROOT/backend/routes" \
    $([ -d "$ROOT/backend/engines" ] && echo "$ROOT/backend/engines") \
    --include='*.py' 2>/dev/null |
    grep -vE "$ALLOWED_RE" || true
)

if [ -n "$hits" ]; then
  echo "$hits" >&2
  fail "router-one-door: hardcoded model name at a call site — declare a task profile via engines/model_router.py"
fi

pass "router-one-door: no hardcoded model names outside the router"
