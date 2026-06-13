"""
store.py — the short-TTL practice key store (data/practice_keys.json).

Server-side grading keys: every minted practice item keeps its
reference_answer HERE, never in an HTTP response. Exam state, calibration
walks and explain-session flags ride in the same file under their own
sections. Atomic writes (core.atomic_io), pruned on every load: items/exams/
calibrations expire after 24h, explain flags after 7 days.

Single-process assumption (like the rest of the app); a module lock guards
read-modify-write cycles.
"""

from __future__ import annotations

import os
import threading
import uuid
from datetime import datetime, timedelta

STORE_PATH = os.path.join("data", "practice_keys.json")

SECTIONS = ("items", "exams", "calibrations", "explain")
TTL_HOURS = {"items": 24, "exams": 24, "calibrations": 24, "explain": 24 * 7}

_lock = threading.Lock()


def new_key() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.utcnow()


def _expired(entry: dict, now: datetime) -> bool:
    try:
        return datetime.fromisoformat(entry.get("expires_at", "")) < now
    except (TypeError, ValueError):
        return True  # unreadable expiry = treat as stale


def _load() -> dict:
    import json
    doc = {}
    try:
        with open(STORE_PATH, encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            doc = raw
    except (OSError, ValueError):
        pass
    now = _now()
    pruned = {}
    for section in SECTIONS:
        entries = doc.get(section)
        entries = entries if isinstance(entries, dict) else {}
        pruned[section] = {k: v for k, v in entries.items()
                           if isinstance(v, dict) and not _expired(v, now)}
    return pruned


def _save(doc: dict) -> None:
    from core.atomic_io import atomic_write_json
    os.makedirs(os.path.dirname(STORE_PATH) or ".", exist_ok=True)
    atomic_write_json(STORE_PATH, doc, indent=2)


def put(section: str, key: str, value: dict) -> dict:
    """Insert/replace one entry (stamps expires_at). Returns the stored dict."""
    if section not in SECTIONS:
        raise ValueError(f"unknown practice-store section: {section!r}")
    entry = dict(value)
    entry["expires_at"] = (_now() + timedelta(hours=TTL_HOURS[section])).isoformat()
    with _lock:
        doc = _load()
        doc[section][key] = entry
        _save(doc)
    return entry


def get(section: str, key: str) -> dict | None:
    with _lock:
        return _load().get(section, {}).get(key)


def update(section: str, key: str, patch: dict) -> dict | None:
    """Shallow-merge `patch` into an existing entry (None when absent/expired)."""
    with _lock:
        doc = _load()
        entry = doc.get(section, {}).get(key)
        if entry is None:
            return None
        entry.update(patch)
        _save(doc)
        return entry


def delete(section: str, key: str) -> None:
    with _lock:
        doc = _load()
        if doc.get(section, {}).pop(key, None) is not None:
            _save(doc)


__all__ = ["put", "get", "update", "delete", "new_key", "STORE_PATH",
           "TTL_HOURS", "SECTIONS"]
