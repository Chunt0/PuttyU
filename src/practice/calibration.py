"""
calibration.py — the optional graph warm-up walk (Phase-2 T4 / B3, SPEC F1, D8).

Calibration is an ordinal walk across ~10 concepts spread evenly over the
course region. Each step mints ONE item (mode='calibration') and grades the
student's answer (writing evidence source=calibration), so the graph starts
with a coarse read of where the student already stands instead of all-unknown.
It is entirely SKIPPABLE: an empty region returns a benign no_region state and
writes nothing; any step can be skipped (advances, writes no evidence).

Three public callables:

  async start(db, owner, course_id) -> dict
      D8: if the course region is empty -> {status:"no_region", message:...} and
      write nothing. Else build an ordinal-walk PLAN of ~10 concepts spread
      evenly across the region, persist it in the store ("calibrations" section,
      TTL 24h), mint the first item, and return a CalibrationStartResponse-shaped
      {status:"in_progress", session_key, message, item, total, position:0}.

  async answer(db, owner, session_key, *, item_key, answer_text, attachment_ids,
               skip) -> dict
      Grade (or skip) the current step, apply the v1 walk heuristic (a 2-correct
      streak skips ahead by one extra concept; a miss proceeds normally), advance
      the walk, and mint the next item. Returns a CalibrationAnswerResponse-shaped
      dict carrying the graded verdict, next_item (or done=True at the end),
      position and total.

  finish(db, owner, session_key) -> dict
      Stamp the course's settings.calibrated_at (Course is owner_scoped, NOT a
      graph table) and return a CalibrationFinishResponse-shaped summary of the
      walked concepts' states. Unknown/expired session -> {status:"expired"}.

Invariants (CLAUDE.md + T4 contract):
  * Graph access ONLY through src.graph.queries (Gate 6f) — region_concepts +
    states_for; never the graph ORM, never raw SQL on graph tables.
  * Model selection happens inside items.py via model_router — no model literals.
  * `owner` is threaded through every call.
  * Course.settings is owner_scoped (Gate 5); calibrated_at is a settings key,
    not a graph write.
  * Reference answers never leave store.py — this module only sees the
    client-safe item dict from items.item_for_concept and the verdict from
    items.grade_answer.
"""

from __future__ import annotations

import json
import logging

from src.graph import queries
from src.graph.models import utcnow
from src.practice import items, store

logger = logging.getLogger(__name__)

# D8 / SPEC F1: the calibration walk targets ~this many concepts, spread evenly
# across the region by ordinal. Smaller regions calibrate every concept.
PLAN_SIZE = 10
# The v1 walk heuristic: a run of this many consecutive correct answers lets the
# walk skip ahead by one extra concept (the student is clearly ahead here).
STREAK_SKIP_AHEAD = 2


# --------------------------------------------------------------------------- #
# plan building — an even ordinal spread across the region                     #
# --------------------------------------------------------------------------- #
def _spread_plan(concept_ids: list[str], size: int = PLAN_SIZE) -> list[str]:
    """Pick up to `size` concept ids spread evenly across an ordinal-ordered
    list. Fewer than `size` -> the whole list; otherwise even index sampling so
    the walk samples the whole book rather than just the first chapter."""
    n = len(concept_ids)
    if n == 0:
        return []
    if n <= size:
        return list(concept_ids)
    step = n / float(size)
    picked: list[str] = []
    seen: set[int] = set()
    for k in range(size):
        idx = int(k * step)
        if idx >= n:
            idx = n - 1
        if idx in seen:                # collisions are possible on the tail
            continue
        seen.add(idx)
        picked.append(concept_ids[idx])
    return picked


def _concept_for(db, owner, session: dict, concept_id: str) -> dict | None:
    """Hydrate one plan concept into the dict items.item_for_concept expects
    (it needs course_id to source corpus chunks). Reads via the graph door."""
    brief = queries.concept_brief(db, concept_id, owner)
    if brief is None:
        return None
    concept = dict(brief)
    concept["course_id"] = session.get("course_id")
    return concept


async def _mint_at(db, owner, session: dict):
    """Mint the item for the plan concept at the session's current position,
    skipping forward over any concept that can't produce an item (dry/missing).
    Mutates session['position'] to point at the concept that produced the item.
    Returns (item_dict | None, done_bool)."""
    plan = session.get("plan") or []
    pos = int(session.get("position", 0))
    while pos < len(plan):
        concept = _concept_for(db, owner, session, plan[pos])
        if concept is not None:
            item = await items.item_for_concept(
                db, owner, concept, mode="calibration")
            if item is not None:
                session["position"] = pos
                return item, False
        pos += 1                       # dry/missing concept — walk past it
    session["position"] = len(plan)
    return None, True


# --------------------------------------------------------------------------- #
# start — open the walk (D8)                                                   #
# --------------------------------------------------------------------------- #
async def start(db, owner, course_id) -> dict:
    """Open a calibration walk for `course_id`.

    D8: an empty region (no library / no concepts) returns
    {status:"no_region", message:...} and writes nothing. Otherwise builds the
    ordinal-walk plan, persists it, mints the first item, and returns the
    CalibrationStartResponse-shaped opening state.
    """
    region = queries.region_concepts(db, course_id, owner)
    if not region:
        return {
            "status": "no_region",
            "message": ("No library concepts to calibrate yet — the graph warms "
                        "up as you study."),
        }

    plan = _spread_plan([c["id"] for c in region], PLAN_SIZE)
    session_key = store.new_key()
    session = {
        "course_id": course_id,
        "owner": owner,
        "plan": plan,
        "position": 0,
        "streak": 0,
        "results": {},          # concept_id -> verdict (most recent)
    }

    item, done = await _mint_at(db, owner, session)
    store.put("calibrations", session_key, session)

    total = len(plan)
    if done:
        # Every plan concept was dry — there is nothing to ask, but the walk is
        # still openable so the caller can finish() it cleanly.
        return {
            "status": "in_progress",
            "session_key": session_key,
            "message": ("No practiceable items for these concepts yet — finish "
                        "to skip calibration for now."),
            "item": None,
            "total": total,
            "position": session["position"],
            "done": True,
        }

    return {
        "status": "in_progress",
        "session_key": session_key,
        "message": ("A quick warm-up across this course — answer or skip each "
                    "one so the tutor knows where to start."),
        "item": item,
        "total": total,
        "position": session["position"],
    }


# --------------------------------------------------------------------------- #
# answer — grade (or skip) the current step, mint the next (v1 walk heuristic) #
# --------------------------------------------------------------------------- #
async def answer(db, owner, session_key, *, item_key=None, answer_text=None,
                 attachment_ids=None, skip: bool = False) -> dict:
    """Grade or skip the current calibration step and advance the walk.

    skip=True advances without writing evidence. Otherwise grades via
    items.grade_answer (writes evidence source=calibration). The v1 walk
    heuristic: a run of STREAK_SKIP_AHEAD consecutive correct answers skips
    ahead by one extra concept; a miss (or partial/ungraded) resets the streak
    and proceeds normally. Returns a CalibrationAnswerResponse-shaped dict with
    next_item (or done=True at the end), position and total. Unknown/expired
    session -> {status:"expired"} (never raises).
    """
    session = store.get("calibrations", session_key)
    if session is None:
        return {"status": "expired", "done": True, "position": 0, "total": 0,
                "next_item": None,
                "feedback_short": "This calibration has expired — start a fresh "
                                  "one any time."}

    plan = session.get("plan") or []
    total = len(plan)
    result: dict = {}

    if skip:
        # No grading, no evidence — just step the walk and reset the streak.
        session["streak"] = 0
        advance = 1
    else:
        result = await items.grade_answer(
            db, owner, item_key, answer_text=answer_text,
            attachment_ids=attachment_ids)
        verdict = result.get("verdict")
        # Record the verdict against the current concept for the finish summary.
        cur_pos = int(session.get("position", 0))
        if 0 <= cur_pos < total:
            session.setdefault("results", {})[plan[cur_pos]] = verdict
        if verdict == "correct":
            session["streak"] = int(session.get("streak", 0)) + 1
        else:
            session["streak"] = 0
        # v1 walk heuristic: on a 2-correct streak, skip ahead one extra concept.
        advance = 1
        if session["streak"] >= STREAK_SKIP_AHEAD:
            advance = 2
            session["streak"] = 0      # reset so the bonus skip isn't repeated

    session["position"] = int(session.get("position", 0)) + advance
    next_item, done = await _mint_at(db, owner, session)
    store.put("calibrations", session_key, session)

    out: dict = {
        "verdict": result.get("verdict"),
        "correct": bool(result.get("correct")),
        "feedback_short": result.get("feedback_short", ""),
        "concept_id": result.get("concept_id"),
        "concept_name": result.get("concept_name"),
        "state": result.get("state"),
        "effective_p": result.get("effective_p"),
        "next_item": next_item,
        "position": session["position"],
        "total": total,
        "done": done,
    }
    if isinstance(result.get("study_citation"), dict):
        out["study_citation"] = result["study_citation"]
    return out


# --------------------------------------------------------------------------- #
# finish — stamp calibrated_at + summarize the walked region                   #
# --------------------------------------------------------------------------- #
def _set_calibrated_at(db, owner, course_id: str) -> bool:
    """Set Course.settings['calibrated_at'] (owner_scoped, Gate 5). Settings is
    a JSON-as-text blob; load, set, save. Returns True on success."""
    from core.database import Course
    from src.auth_helpers import owner_scoped
    course = owner_scoped(db.query(Course), Course, owner).filter(
        Course.id == course_id).first()
    if course is None:
        return False
    try:
        settings = json.loads(course.settings or "{}")
        if not isinstance(settings, dict):
            settings = {}
    except (TypeError, ValueError):
        settings = {}
    settings["calibrated_at"] = utcnow().isoformat()
    course.settings = json.dumps(settings)
    db.add(course)
    db.commit()
    return True


def finish(db, owner, session_key) -> dict:
    """End the calibration walk: stamp the course's settings.calibrated_at and
    return a CalibrationFinishResponse-shaped summary of the walked concepts'
    current states. Unknown/expired session -> {status:"expired"} (never raises).
    """
    session = store.get("calibrations", session_key)
    if session is None:
        return {
            "status": "expired",
            "calibrated": False,
            "states": [],
            "message": ("This calibration has expired — you can start a fresh "
                        "one any time."),
        }

    course_id = session.get("course_id")
    plan = session.get("plan") or []

    # Per-concept current state, read through the graph door (states_for).
    states_out: list[dict] = []
    if plan:
        state_rows = queries.states_for(db, plan)
        for cid in plan:
            state, eff_p, _last = state_rows.get(cid, ("unknown", None, None))
            brief = queries.concept_brief(db, cid, owner)
            states_out.append({
                "concept_id": cid,
                "concept_name": brief.get("name") if brief else None,
                "state": state,
                "effective_p": eff_p,
            })

    self_calibrated = _set_calibrated_at(db, owner, course_id) if course_id else False

    # Drop the session — the walk is over.
    try:
        store.delete("calibrations", session_key)
    except Exception as e:             # cleanup is best-effort
        logger.debug("[calibration] session cleanup failed: %s", e)

    return {
        "status": "done",
        "calibrated": True,
        "states": states_out,
        "message": ("Calibration saved — the tutor now has a starting read on "
                    f"{len(states_out)} concepts."
                    if self_calibrated else
                    "Calibration saved."),
    }


__all__ = ["start", "answer", "finish", "PLAN_SIZE", "STREAK_SKIP_AHEAD"]
