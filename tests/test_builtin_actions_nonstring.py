"""Regression: builtin-action helpers must tolerate non-string inputs.

_classify_event_heuristic did `(summary or "").lower()`; a truthy non-string
(e.g. an int) would raise AttributeError. Pin the guarded behaviour.
"""
from src.builtin_actions import _classify_event_heuristic


def test_classify_event_heuristic_non_string():
    out = _classify_event_heuristic(123)
    assert out == (None, None)


def test_valid_inputs_unchanged():
    assert _classify_event_heuristic("dentist appointment")[0] == "health"
