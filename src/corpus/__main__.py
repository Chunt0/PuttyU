"""
CLI: import textbook directories into the corpus.

    python -m src.corpus <dir> [<dir> ...] [--subject stats] [--level hs] [--no-embed]

Each <dir> is a Marker textbook directory (book.md + images/ + source.pdf). A directory
that itself contains such directories is expanded, so you can point it at the whole
compiled library:  python -m src.corpus /path/to/compiled-textbooks/

Idempotent + resumable: a source whose book text is unchanged is skipped, so re-running
as the library grows only picks up new/changed books (ADR 0003 §Bootstrapping).
"""

from __future__ import annotations

import argparse
import os
import sys

from src.corpus.indexer import index, select_importer


def _discover(paths: list[str]) -> list[str]:
    """Expand each path to importable source dirs (the dir itself, else its children)."""
    found: list[str] = []
    for p in paths:
        p = os.path.abspath(p)
        try:
            select_importer(p)
            found.append(p)
            continue
        except ValueError:
            pass
        if os.path.isdir(p):
            for name in sorted(os.listdir(p)):
                child = os.path.join(p, name)
                if os.path.isdir(child):
                    try:
                        select_importer(child)
                        found.append(child)
                    except ValueError:
                        pass
    return found


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python -m src.corpus", description="Import textbooks into the corpus.")
    ap.add_argument("paths", nargs="+", help="textbook dir(s), or a dir of textbook dirs")
    ap.add_argument("--subject", help="subject tag applied to imported sources")
    ap.add_argument("--level", help="level tag (e.g. hs, undergrad)")
    ap.add_argument("--language", default="en")
    ap.add_argument("--no-embed", action="store_true", help="store to SQLite only; skip Chroma")
    args = ap.parse_args(argv)

    dirs = _discover(args.paths)
    if not dirs:
        print("no importable textbook directories found", file=sys.stderr)
        return 1

    overrides = {k: v for k, v in (("subject", args.subject), ("level", args.level),
                                   ("language", args.language)) if v}
    rc = 0
    for d in dirs:
        try:
            stats = index(d, embed=not args.no_embed, **overrides)
            verb = "skipped (unchanged)" if stats.get("skipped") else (
                f"{stats.get('chunks')} chunks, {stats.get('embedded', 0)} embedded")
            print(f"[corpus] {os.path.basename(d)} -> {stats['source_id']}: {verb}")
        except Exception as e:
            print(f"[corpus] FAILED {d}: {e}", file=sys.stderr)
            rc = 1
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
