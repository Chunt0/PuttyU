"""
test_practice_store.py — exercise the existing src/practice/store.py
(the build plan's "don't trust unexercised code" step for the grading-key store).

Covers: put/get/update/delete round-trip, TTL pruning on load, atomic write to
the patched path, the unknown-section ValueError, and section isolation. The
store path is patched per the T4 contract §3 so parallel tests never write the
real data/practice_keys.json.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

import pytest

import src.practice.store as store


@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr("src.practice.store.STORE_PATH",
                        str(tmp_path / "practice_keys.json"))
    return tmp_path / "practice_keys.json"


def test_put_get_roundtrip_stamps_expiry():
    stored = store.put("items", "k1", {"prompt": "2+2?", "reference_answer": "4"})
    assert stored["prompt"] == "2+2?"
    assert "expires_at" in stored
    got = store.get("items", "k1")
    assert got["reference_answer"] == "4"
    assert got["expires_at"] == stored["expires_at"]


def test_put_writes_to_patched_path_atomically(isolated_store):
    store.put("items", "k1", {"a": 1})
    assert isolated_store.exists()
    raw = json.loads(isolated_store.read_text())
    assert raw["items"]["k1"]["a"] == 1
    # All sections materialize on save (pruned skeleton).
    for section in store.SECTIONS:
        assert section in raw


def test_update_shallow_merges_existing():
    store.put("exams", "e1", {"started_at": "t0", "duration_seconds": 60})
    merged = store.update("exams", "e1", {"submitted_at": "t1"})
    assert merged["started_at"] == "t0"
    assert merged["submitted_at"] == "t1"
    assert store.get("exams", "e1")["submitted_at"] == "t1"


def test_update_missing_returns_none():
    assert store.update("items", "nope", {"x": 1}) is None


def test_delete_removes_entry():
    store.put("items", "k1", {"a": 1})
    store.delete("items", "k1")
    assert store.get("items", "k1") is None
    # deleting an absent key is a no-op (no raise)
    store.delete("items", "k1")


def test_unknown_section_raises():
    with pytest.raises(ValueError):
        store.put("not_a_section", "k", {})


def test_ttl_pruning_on_load(isolated_store):
    """An entry whose expires_at is in the past is pruned on the next load."""
    store.put("items", "fresh", {"a": 1})
    # Hand-write a stale entry directly into the file.
    doc = json.loads(isolated_store.read_text())
    past = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    doc["items"]["stale"] = {"a": 2, "expires_at": past}
    isolated_store.write_text(json.dumps(doc))
    assert store.get("items", "stale") is None      # pruned on load
    assert store.get("items", "fresh") is not None   # survivor kept


def test_unreadable_expiry_is_treated_stale(isolated_store):
    store.put("items", "fresh", {"a": 1})
    doc = json.loads(isolated_store.read_text())
    doc["items"]["bad"] = {"a": 2, "expires_at": "not-a-date"}
    isolated_store.write_text(json.dumps(doc))
    assert store.get("items", "bad") is None


def test_sections_are_isolated():
    store.put("items", "x", {"who": "item"})
    store.put("exams", "x", {"who": "exam"})
    assert store.get("items", "x")["who"] == "item"
    assert store.get("exams", "x")["who"] == "exam"


def test_new_key_unique():
    assert store.new_key() != store.new_key()


def test_explain_ttl_is_longer():
    assert store.TTL_HOURS["explain"] > store.TTL_HOURS["items"]
