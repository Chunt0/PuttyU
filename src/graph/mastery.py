"""
mastery.py — the BKT-lite evidence engine (ADR 0005).

Append-only `mastery_evidence` is the truth; `mastery_state` is a derived
cache recomputable from the log (rebuild_mastery). Fixed v1 params:
learn=.2, slip=.1, guess=.2, prior=.2. Exponential recency decay (half-life
21 days, toward 0.5 = "uncertain again") is applied at READ time only —
stored p_known never decays, so rebuilds are deterministic.

State vocabulary (the ONLY thing the UI shows — §6 Q2, no percentages):
  unknown  — no evidence rows at all (unknown ≠ zero)
  learning — effective p < 0.55
  shaky    — 0.55 <= effective p < 0.8 (including decayed-from-mastered)
  mastered — effective p >= 0.8

The user outranks the model: override_known/override_unknown SET p (0.95 /
0.05) and still append evidence rows — overrides are evidence too.

Prerequisite splash (F5): positive direct evidence adds weak (0.25x) indirect
evidence rows to direct prerequisites. Splash rows are real log rows (so
rebuild replays them verbatim) and never cascade further.
"""

from __future__ import annotations

import logging
import math
from datetime import datetime

from src.graph.models import (
    Assertion, MasteryEvidence, MasteryState, SIGNALS, ensure_graph_tables,
    new_id, utcnow,
)

logger = logging.getLogger(__name__)

# BKT-lite v1 params (ADR 0005 — fixed, change == rebuild_mastery()).
P_LEARN = 0.2
P_SLIP = 0.1
P_GUESS = 0.2
P_INIT = 0.2

# Recency decay: half-life in days, decaying toward 0.5 ("uncertain again",
# so stale mastery lands in shaky, never back at learning by decay alone).
DECAY_HALF_LIFE_DAYS = 21.0
DECAY_CENTER = 0.5

# State thresholds on EFFECTIVE (decayed) p.
SHAKY_MIN = 0.55
MASTERED_MIN = 0.8

OVERRIDE_KNOWN_P = 0.95
OVERRIDE_UNKNOWN_P = 0.05

# signal -> (direction, weight multiplier). None direction = override.
_SIGNAL_RULES = {
    "correct":   (+1, 1.0),
    "explained": (+1, 1.0),
    "partial":   (+1, 0.5),    # half-weight positive
    "incorrect": (-1, 1.0),
    "hint_used": (-1, 0.25),   # small negative
}
POSITIVE_SIGNALS = frozenset({"correct", "explained", "partial"})

SPLASH_FACTOR = 0.25


# --------------------------------------------------------------------------- #
# Pure functions                                                              #
# --------------------------------------------------------------------------- #
def bkt_step(p: float, positive: bool) -> float:
    """One full-weight Bayesian update + learning transit (standard BKT)."""
    p = min(max(p, 0.0), 1.0)
    if positive:
        denom = p * (1 - P_SLIP) + (1 - p) * P_GUESS
        p_obs = (p * (1 - P_SLIP) / denom) if denom else p
    else:
        denom = p * P_SLIP + (1 - p) * (1 - P_GUESS)
        p_obs = (p * P_SLIP / denom) if denom else p
    return p_obs + (1 - p_obs) * P_LEARN


def apply_signal(p: float, signal: str, weight: float = 1.0) -> float:
    """p_known' for one evidence row. Weight (incl. the signal's own
    multiplier) interpolates between no-update and the full BKT step."""
    if signal == "override_known":
        return OVERRIDE_KNOWN_P
    if signal == "override_unknown":
        return OVERRIDE_UNKNOWN_P
    rule = _SIGNAL_RULES.get(signal)
    if rule is None:
        return p
    direction, mult = rule
    w = min(max(weight * mult, 0.0), 1.0)
    p_full = bkt_step(p, positive=direction > 0)
    return p + w * (p_full - p)


def effective_p(p: float, last_evidence_at, now: datetime | None = None) -> float:
    """Read-time recency decay toward 0.5 (half-life 21 days)."""
    if last_evidence_at is None:
        return p
    now = now or utcnow()
    days = max((now - last_evidence_at).total_seconds() / 86400.0, 0.0)
    factor = math.pow(0.5, days / DECAY_HALF_LIFE_DAYS)
    return DECAY_CENTER + (p - DECAY_CENTER) * factor


def state_for(p: float, last_evidence_at=None, now: datetime | None = None) -> str:
    """learning | shaky | mastered from effective p. ("unknown" is the
    ABSENCE of evidence — callers map no-state-row to it; see state_of.)

    Decay alone never demotes past shaky: a node whose UNDECAYED p clears
    SHAKY_MIN reads "shaky" at worst ("or recency-decayed" — ADR 0005). Only
    actual negative evidence can push it back to learning."""
    ep = effective_p(p, last_evidence_at, now)
    if ep >= MASTERED_MIN:
        return "mastered"
    if ep >= SHAKY_MIN or p >= SHAKY_MIN:
        return "shaky"
    return "learning"


# --------------------------------------------------------------------------- #
# The write door                                                              #
# --------------------------------------------------------------------------- #
def apply_evidence(concept_id: str, signal: str, weight: float = 1.0,
                   episode_ref: dict | None = None, context: dict | None = None,
                   owner=None, db=None, _splash: bool = True):
    """Append one evidence row and update the derived state. Returns the
    MasteryState row (attached to `db` when one was passed in).

    Positive direct evidence splashes weak (0.25x) indirect evidence onto
    direct prerequisites — recorded as real log rows so rebuild_mastery
    replays them; splash never cascades (indirect evidence doesn't splash).
    """
    if signal not in SIGNALS:
        raise ValueError(f"unknown mastery signal: {signal!r}")
    owner = owner or None
    own_session = db is None
    if own_session:
        from core.database import SessionLocal
        ensure_graph_tables()
        db = SessionLocal()
    try:
        row = MasteryEvidence(
            id=new_id(), concept_id=concept_id, episode_ref=episode_ref,
            signal=signal, weight=float(weight), context=context or {},
            owner=owner, created_at=utcnow(),
        )
        db.add(row)
        state = _update_state(db, concept_id, signal, weight, owner, row.created_at)

        if _splash and signal in POSITIVE_SIGNALS:
            for prereq_id in _direct_prerequisites(db, concept_id):
                splash_ctx = dict(context or {})
                splash_ctx.update({"indirect": True, "via": concept_id})
                apply_evidence(
                    prereq_id, signal, weight=float(weight) * SPLASH_FACTOR,
                    episode_ref=episode_ref, context=splash_ctx,
                    owner=owner, db=db, _splash=False,
                )
        db.commit()
        return state
    except Exception:
        db.rollback()
        raise
    finally:
        if own_session:
            db.close()


def _direct_prerequisites(db, concept_id: str) -> list:
    rows = (db.query(Assertion.subject_id)
            .filter(Assertion.relation == "prerequisite_of",
                    Assertion.subject_type == "concept",
                    Assertion.object_id == concept_id,
                    Assertion.invalidated_at.is_(None)).all())
    return [r[0] for r in rows]


def _update_state(db, concept_id: str, signal: str, weight: float, owner,
                  evidence_at) -> MasteryState:
    state = db.get(MasteryState, concept_id)
    p = state.p_known if state is not None else P_INIT
    p = apply_signal(p, signal, weight)
    if state is None:
        state = MasteryState(concept_id=concept_id, owner=owner)
        db.add(state)
    state.p_known = p
    state.last_evidence_at = evidence_at
    state.state = state_for(p)  # stored state is undecayed; reads re-derive
    state.updated_at = utcnow()
    return state


# --------------------------------------------------------------------------- #
# Reads                                                                       #
# --------------------------------------------------------------------------- #
def state_of(state_row, now: datetime | None = None) -> tuple[str, float | None]:
    """(state, effective_p) for a MasteryState row or None (= unknown)."""
    if state_row is None:
        return "unknown", None
    ep = effective_p(state_row.p_known, state_row.last_evidence_at, now)
    return state_for(state_row.p_known, state_row.last_evidence_at, now), ep


# --------------------------------------------------------------------------- #
# Rebuild (cache is derived — ADR 0005)                                       #
# --------------------------------------------------------------------------- #
def rebuild_mastery(owner=None, db=None) -> int:
    """Recompute mastery_state from the append-only log (run after param /
    prompt changes). Splash rows are already IN the log, so the replay is a
    plain per-concept fold. Returns the number of concepts rebuilt."""
    owner = owner or None
    own_session = db is None
    if own_session:
        from core.database import SessionLocal
        ensure_graph_tables()
        db = SessionLocal()
    try:
        ev_q = db.query(MasteryEvidence)
        st_q = db.query(MasteryState)
        if owner:
            ev_q = ev_q.filter(MasteryEvidence.owner == owner)
            st_q = st_q.filter(MasteryState.owner == owner)
        for stale in st_q.all():
            db.delete(stale)
        db.flush()
        by_concept: dict = {}
        for row in ev_q.order_by(MasteryEvidence.created_at,
                                 MasteryEvidence.id).all():
            by_concept.setdefault(row.concept_id, []).append(row)
        for concept_id, rows in by_concept.items():
            p = P_INIT
            for row in rows:
                p = apply_signal(p, row.signal, row.weight or 1.0)
            last = rows[-1].created_at
            db.add(MasteryState(
                concept_id=concept_id, p_known=p, state=state_for(p),
                last_evidence_at=last, updated_at=utcnow(),
                owner=rows[-1].owner,
            ))
        db.commit()
        return len(by_concept)
    except Exception:
        db.rollback()
        raise
    finally:
        if own_session:
            db.close()
