"""
gym.py — the Gym: student-pulled adaptive practice sets (SPEC F8, T4 D5).

The Gym is STATELESS on the server: all set state (the running difficulty, the
signed adaptation streak, and the attempted/correct totals) is carried by the
client and echoed back on every request. There is no per-set server record —
each minted item still keeps its grading key in store.py (via items.py), but the
*set* lives entirely in the client's hands. (Totals ride the response models'
ConfigDict(extra="allow") — we never edit schemas.py to add them.)

Two public coroutines:

  next_item(db, owner, course_id, *, concept_id=None, difficulty=2)
      Mint the next item. With a concept_id, drill that topic. Without one, this
      is the COACH'S PICK: the shakiest in-region concept that ALSO has recorded
      errors (error_counts > 0), never a mastered concept (D5: "never pick a
      mastered concept as filler"). Returns a GymItemResponse-shaped dict.

  grade(db, owner, item_key, *, answer_text=None, attachment_ids=None,
        difficulty=2, streak=0, attempted=0, correct=0)
      Grade via items.grade_answer, then apply the D5 ZPD difficulty adaptation
      using `streak` as a SIGNED run counter, and fold the running set totals.
      Returns a GymAnswerResponse-shaped dict (including the next difficulty, the
      updated streak, and a GymSetSummary).

Invariants (CLAUDE.md + T4 contract):
  * Graph access ONLY through src.graph.queries (Gate 6f).
  * Model selection happens inside items.py via model_router — no model literals
    here.
  * `owner` is threaded through every call.
  * Reference answers never leave store.py — this module only ever sees the
    client-safe item dict from items.item_for_concept / the verdict from
    items.grade_answer.
"""

from __future__ import annotations

import logging

from src.graph import queries
from src.practice import items

logger = logging.getLogger(__name__)

# Difficulty bounds (D5: difficulty in {1..5}, start at 2).
DIFFICULTY_MIN = 1
DIFFICULTY_MAX = 5
# A run of this many same-direction verdicts steps the difficulty.
STEP_AFTER = 2
# Non-mastered ceiling (effective_p), matches items.MASTERED_MIN / mastery.MASTERED_MIN.
MASTERED_MIN = items.MASTERED_MIN


def _clamp_difficulty(d) -> int:
    try:
        d = int(d)
    except (TypeError, ValueError):
        d = 2
    return max(DIFFICULTY_MIN, min(DIFFICULTY_MAX, d))


# --------------------------------------------------------------------------- #
# Coach's pick — the shakiest in-region concept that has errors (D5)          #
# --------------------------------------------------------------------------- #
def _coach_pick(db, owner, course_id: str) -> tuple[dict | None, str | None]:
    """The shakiest non-mastered concept in the course region that ALSO has
    recorded errors (error_counts > 0). Returns (concept_dict, rationale) or
    (None, None) when nothing is eligible.

    "Shakiest" = lowest effective_p (treat None — never-seen — as the most
    uncertain, P_INIT). Mastered concepts (effective_p >= 0.8) are NEVER picked
    as filler. The concept dict is the queries.region_concepts shape augmented
    with course_id so items.item_for_concept can source corpus chunks.
    """
    concepts = queries.region_concepts(db, course_id, owner)
    if not concepts:
        return None, None
    ids = [c["id"] for c in concepts]
    states = queries.states_for(db, ids)
    errors = queries.error_counts(db, ids, owner)

    best = None
    best_p = None
    for c in concepts:
        if errors.get(c["id"], 0) <= 0:
            continue                                   # only concepts with errors
        state, eff_p, _last = states.get(c["id"], ("unknown", None, None))
        if eff_p is not None and eff_p >= MASTERED_MIN:
            continue                                   # never filler with mastered
        # Shakiest = lowest effective_p; None (never-seen) reads as most uncertain.
        rank_p = eff_p if eff_p is not None else items.P_INIT
        if best is None or rank_p < best_p:
            best = c
            best_p = rank_p

    if best is None:
        return None, None
    concept = dict(best)
    concept["course_id"] = course_id
    rationale = f"training {best['name']} — your shakiest"
    return concept, rationale


# --------------------------------------------------------------------------- #
# next_item — mint the next gym item (D5)                                      #
# --------------------------------------------------------------------------- #
async def next_item(db, owner, course_id, *, concept_id: str | None = None,
                    difficulty: int = 2) -> dict:
    """Mint the next gym item (GymItemResponse-shaped dict).

    With `concept_id`: drill exactly that topic (the user explicitly picked it,
    so a mastered or unknown concept is allowed — the no-filler rule is only for
    the coach's auto-pick). Without it: coach's pick (the shakiest concept with
    errors). On no eligible concept or a dry library (no item could be minted),
    return {item: None, difficulty, message}.
    """
    difficulty = _clamp_difficulty(difficulty)

    if concept_id:
        concept = queries.concept_brief(db, concept_id, owner)
        if concept is None:
            return {"item": None, "difficulty": difficulty,
                    "message": "That topic isn't in this course."}
        concept = dict(concept)
        concept["course_id"] = course_id
        message = None
    else:
        concept, message = _coach_pick(db, owner, course_id)
        if concept is None:
            return {"item": None, "difficulty": difficulty,
                    "message": "No shaky concepts with errors to drill yet — "
                               "practice a topic from chat first, or pick one."}

    item = await items.item_for_concept(db, owner, concept, mode="gym",
                                        difficulty=difficulty)
    if item is None:
        name = concept.get("name") or concept.get("concept_name") or "this topic"
        return {"item": None, "difficulty": difficulty,
                "message": f"No practiceable item for {name} yet "
                           "(the library has no exercise here and no model is "
                           "configured to write one)."}
    return {"item": item, "difficulty": difficulty, "message": message}


# --------------------------------------------------------------------------- #
# grade — grade + D5 ZPD adaptation + running set totals                       #
# --------------------------------------------------------------------------- #
def _adapt(verdict: str, difficulty: int, streak: int, item_citation):
    """Apply the D5 ZPD step. `streak` is SIGNED (positive = consecutive
    correct, negative = consecutive wrong). Returns
    (new_difficulty, new_streak, study_citation_override | None).

    correct  -> streak = (streak + 1) if already non-negative else 1
                if streak >= STEP_AFTER: difficulty = min(+1, MAX), streak = 0
    incorrect-> streak = (streak - 1) if already non-positive else -1
                if streak <= -STEP_AFTER: difficulty = max(-1, MIN), streak = 0,
                and ensure a study citation is present (fall back to the item's).
    partial / ungraded / expired / anything else -> no nudge (streak unchanged).
    """
    citation_override = None
    if verdict == "correct":
        streak = (streak + 1) if streak >= 0 else 1
        if streak >= STEP_AFTER:
            difficulty = min(difficulty + 1, DIFFICULTY_MAX)
            streak = 0
    elif verdict == "incorrect":
        streak = (streak - 1) if streak <= 0 else -1
        if streak <= -STEP_AFTER:
            difficulty = max(difficulty - 1, DIFFICULTY_MIN)
            streak = 0
            # On a difficulty drop, the user should get something to study.
            if isinstance(item_citation, dict):
                citation_override = item_citation
    # 'partial' (and any non-correct/incorrect verdict) nudges neither.
    return difficulty, streak, citation_override


async def grade(db, owner, item_key, *, answer_text=None, attachment_ids=None,
                difficulty: int = 2, streak: int = 0,
                attempted: int = 0, correct: int = 0) -> dict:
    """Grade a gym item and step the set (GymAnswerResponse-shaped dict).

    Calls items.grade_answer (which writes evidence with source='gym'), then
    applies the D5 ZPD adaptation and folds the client-carried running totals.
    The returned `difficulty` is the level to use for the NEXT item; `streak` is
    the updated signed run; `summary` is the running GymSetSummary.
    """
    difficulty = _clamp_difficulty(difficulty)
    try:
        streak = int(streak)
    except (TypeError, ValueError):
        streak = 0
    try:
        attempted = max(0, int(attempted))
    except (TypeError, ValueError):
        attempted = 0
    try:
        correct = max(0, int(correct))
    except (TypeError, ValueError):
        correct = 0

    # The item's own citation (for the difficulty-drop study fallback) — read it
    # before grading; grade_answer never returns the stored item.
    item_citation = None
    try:
        from src.practice import store
        stored = store.get("items", item_key)
        if isinstance(stored, dict) and isinstance(stored.get("citation"), dict):
            item_citation = stored["citation"]
    except Exception as e:           # the store is best-effort here
        logger.debug("[gym] item citation lookup failed: %s", e)

    result = await items.grade_answer(db, owner, item_key, answer_text=answer_text,
                                      attachment_ids=attachment_ids)
    verdict = result.get("verdict") or "ungraded"
    is_correct = verdict == "correct"

    new_difficulty, new_streak, citation_override = _adapt(
        verdict, difficulty, streak, item_citation)

    # On a difficulty drop with no citation from grading, surface the fallback.
    if citation_override is not None and not result.get("study_citation"):
        result["study_citation"] = citation_override

    new_attempted = attempted + 1
    new_correct = correct + (1 if is_correct else 0)
    summary = {
        "attempted": new_attempted,
        "correct": new_correct,
        "difficulty": new_difficulty,
        "streak": new_streak,
    }

    out = dict(result)               # verdict, correct, feedback_short, concept_*,
    out["difficulty"] = new_difficulty   # state, effective_p, study_citation?
    out["streak"] = new_streak
    out["summary"] = summary
    return out


__all__ = ["next_item", "grade"]
