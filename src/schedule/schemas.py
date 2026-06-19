"""
schemas.py — typed Pydantic models for the schedule-miner route surface
(Phase-2 T5 vertical-2, SPEC F2). These describe both the shapes `miner.py`
returns and the request/response bodies `routes/schedule_routes.py` consumes —
so the route file rides the real OpenAPI seam (ADR 0002 §1).

Every model carries `model_config = ConfigDict(extra="allow")`: the engine may
attach extra diagnostic keys (e.g. a router `why`) without a contract break.

Lives here (not `src/request_models.py`, which sits near its Gate-6a ceiling).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


# --------------------------------------------------------------------------- #
# mine() output                                                               #
# --------------------------------------------------------------------------- #
class ScheduleProposal(BaseModel):
    """One PROPOSED schedule item the miner extracted (nothing is written until
    the user confirms it via apply). `status` is the diff verdict against the
    existing miner-created rows for this source."""

    model_config = ConfigDict(extra="allow")

    key: str                                  # proposal_key (sha256, idempotent)
    kind: Literal["event", "todo"]
    type: str = ""                            # exam | quiz | homework | reading | …
    title: str
    date: str | None = None                   # ISO date|datetime, None = unresolved
    end_date: str | None = None
    all_day: bool = True
    page: int | None = None                   # source page for the citation door
    ambiguous: bool = False
    question: str | None = None               # the ask-don't-guess clarification
    status: Literal["new", "changed", "unchanged", "stale"] = "new"
    existing_id: str | None = None            # the matched row (changed/unchanged/stale)
    citation: str | None = None               # "from <source> p. N"


class MineResponse(BaseModel):
    """The review-sheet payload. Read-only — `mine` persists nothing."""

    model_config = ConfigDict(extra="allow")

    source_id: str
    title: str = ""
    summary: str = ""                         # the calm header line
    proposals: list[ScheduleProposal] = []


# --------------------------------------------------------------------------- #
# apply() input/output                                                        #
# --------------------------------------------------------------------------- #
class MineApplyItem(BaseModel):
    """A user-confirmed (possibly edited) proposal handed to apply()."""

    model_config = ConfigDict(extra="allow")

    key: str                                  # proposal_key — the idempotency key
    kind: Literal["event", "todo"]
    title: str
    date: str | None = None                   # the resolved date (None ⇒ skipped)
    end_date: str | None = None
    all_day: bool = True
    page: int | None = None
    accepted: bool = True
    existing_id: str | None = None            # set for "changed" → update in place


class MineApplyRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    items: list[MineApplyItem] = []


class MineApplyResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    created_events: int = 0
    created_todos: int = 0
    updated: int = 0
    skipped: int = 0
