#!/usr/bin/env python3
"""
openapi-export.py — dump the backend's OpenAPI schema for the typed frontend seam.

Writes `app.openapi()` to web/src/api/openapi.json with STABLE formatting (sorted keys,
trailing newline) so the Gate-1 drift check (`git diff --exit-code`) only fires on real
contract changes, not key-ordering noise.

Usage:
    python scripts/openapi-export.py [--out web/src/api/openapi.json]

This is the source of truth for `bun run gen:api` (openapi-typescript -> schema.d.ts).
"""

from __future__ import annotations

import argparse
import json
import os
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(REPO_ROOT, "web", "src", "api", "openapi.json")


def export(out_path: str) -> dict:
    # Import lazily so --help is instant and import side effects only run on real export.
    sys.path.insert(0, REPO_ROOT)
    from app import app  # FastAPI instance; importing boots routers (no server lifespan)

    schema = app.openapi()
    if not schema.get("paths"):
        raise SystemExit("openapi-export: schema has no paths — backend wiring changed?")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(schema, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")
    return schema


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Export backend OpenAPI schema.")
    ap.add_argument("--out", default=DEFAULT_OUT, help="output path (default: web/src/api/openapi.json)")
    args = ap.parse_args(argv)

    schema = export(args.out)
    rel = os.path.relpath(args.out, REPO_ROOT)
    print(f"openapi-export: wrote {len(schema['paths'])} paths to {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
