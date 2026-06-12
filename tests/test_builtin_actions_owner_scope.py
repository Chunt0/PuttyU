"""Regression tests for owner-scoped model resolution in scheduled actions."""

from datetime import datetime
from types import SimpleNamespace

import pytest


class _Column:
    def __eq__(self, _other):
        return True

    def __ne__(self, _other):
        return True

    def __ge__(self, _other):
        return True

    def __le__(self, _other):
        return True


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def filter(self, *_args, **_kwargs):
        return self

    def limit(self, _limit):
        return self

    def all(self):
        return list(self._rows)


class _Db:
    def __init__(self, rows_by_model):
        self._rows_by_model = rows_by_model
        self.commits = 0
        self.closed = False

    def query(self, model):
        return _Query(self._rows_by_model.get(model, []))

    def commit(self):
        self.commits += 1

    def close(self):
        self.closed = True


def _resolver_spy(monkeypatch, utility_result=("", "", {}), default_result=("http://llm", "model", {})):
    from src import endpoint_resolver

    calls = []
    fallback_calls = []

    def fake_resolve(kind, *args, **kwargs):
        calls.append((kind, kwargs.get("owner")))
        return utility_result if kind == "utility" else default_result

    def fake_fallbacks(*args, **kwargs):
        fallback_calls.append(kwargs.get("owner"))
        return []

    monkeypatch.setattr(endpoint_resolver, "resolve_endpoint", fake_resolve)
    monkeypatch.setattr(endpoint_resolver, "resolve_utility_fallback_candidates", fake_fallbacks)
    return calls, fallback_calls


@pytest.mark.asyncio
async def test_classify_events_resolves_llm_for_task_owner(monkeypatch):
    from core import database
    from src.builtin_actions import action_classify_events

    class FakeCalendarEvent:
        dtstart = _Column()
        status = _Column()

    event = SimpleNamespace(
        summary="Demo presentation",
        event_type="work",
        importance="high",
        color=None,
        dtstart=datetime(2026, 1, 1, 9, 0, 0),
        location="",
    )
    db = _Db({FakeCalendarEvent: [event]})
    calls, _fallback_calls = _resolver_spy(monkeypatch, utility_result=("http://llm", "model", {}))

    monkeypatch.setattr(database, "CalendarEvent", FakeCalendarEvent)
    monkeypatch.setattr(database, "SessionLocal", lambda: db)

    message, ok = await action_classify_events("alice")

    assert ok is True
    assert "Scanned 1 upcoming event" in message
    assert calls == [("utility", "alice")]
    assert db.closed is True

