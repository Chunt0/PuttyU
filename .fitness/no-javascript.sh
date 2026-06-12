#!/usr/bin/env bash
# Gate 6e (ADR 0001/0002): TypeScript only. The frontend rewrite is TS — no new JavaScript,
# anywhere. The ONLY tolerated `.js/.jsx/.mjs/.cjs` are listed (by path prefix) in
# js-allowlist.txt: the legacy `static/` frontend (deleted in Slice 7) and a couple of
# CI/tooling files. The GOAL is an EMPTY allowlist = the repo is provably zero-JS.
#
# Any JS outside the allowlist fails the build — so the new web/ tree (and any future code)
# can never regress to JavaScript.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

ALLOW=".fitness/js-allowlist.txt"
fail=0
while IFS= read -r f; do
  ok=0
  while IFS= read -r prefix; do
    case "$prefix" in ''|\#*) continue ;; esac
    case "$f" in "$prefix"*) ok=1; break ;; esac
  done < "$ALLOW"
  if [ "$ok" -eq 0 ]; then
    echo "FAIL 6e: $f is JavaScript — write it in TypeScript (ADR 0001: the rewrite is TS-only)."
    fail=1
  fi
done < <(git ls-files '*.js' '*.jsx' '*.mjs' '*.cjs')

[ "$fail" -eq 0 ] && echo "ok 6e: no JavaScript outside the (shrinking) legacy allowlist"
exit "$fail"
