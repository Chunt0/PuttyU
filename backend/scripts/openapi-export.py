"""Export the OpenAPI schema for the frontend codegen (Gate 1).

Deterministic output (sorted keys) so CI can detect drift.
Run from `backend/`:  uv run python scripts/openapi-export.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import app  # noqa: E402

OUT = (
    Path(__file__).resolve().parent.parent.parent
    / "web"
    / "src"
    / "api"
    / "openapi.json"
)


def main() -> None:
    schema = app.openapi()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
