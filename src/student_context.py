"""
student_context.py — THE one read door between the graph and every prompt
(ADR 0005, SPEC F6). No call site reads graph tables directly; they call
student_context() (fitness-checked by .fitness/graph-one-door.sh).

Tiers (degrade bottom-up under token budget — the ROADMAP context-bloat
lesson made a contract):

  T0 profile   — course adaptivity dial + durable stated preferences. Always kept.
  T1 focus     — active course region: mastery frontier, shaky nodes, recent
                 evidence, active insights. Always kept (compressed at worst).
  T2 periphery — coupled courses via shared nodes. T4 builds this; the seam
                 is `periphery_tier()` returning "" for now.
  T3 ambient   — recent stated observations (the problem-flavoring fuel).
                 First to drop.

Contract: cheap (pure SQL reads, no LLM), never raises into chat (any failure
returns ""), and a course-less call is a no-op (returns "").
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

CONTEXT_OPEN = "[STUDENT CONTEXT — the tutor's model of this student]"
CONTEXT_CLOSE = "[END STUDENT CONTEXT]"

CHARS_PER_TOKEN = 4          # rough estimate (same as corpus records)
DEFAULT_TOKEN_BUDGET = 1200
FRONTIER_N = 5               # first N non-mastered concepts, ordinal order
MAX_LIST = 5
FOCUS_MIN_LINES = 10         # focus compresses to this floor, never below


# --------------------------------------------------------------------------- #
# Tier builders (each returns list[str] lines; all owner-scoped SQL reads)    #
# --------------------------------------------------------------------------- #
def _profile_lines(db, owner, course_id: str) -> list[str]:
    from src.graph.models import Assertion, PREFERENCE_RELATIONS

    lines = []
    try:
        from core.database import Course
        course = _owned(db.query(Course).filter(Course.id == course_id),
                        Course, owner).first()
        if course is not None:
            settings = {}
            try:
                settings = json.loads(course.settings) if course.settings else {}
            except (json.JSONDecodeError, TypeError):
                settings = {}
            dial = ", ".join(f"{k}={settings[k]}" for k in
                             ("scaffolding", "pace", "tone") if settings.get(k))
            lines.append(f"Course: {course.name}" + (f" ({dial})" if dial else ""))
    except Exception:
        logger.debug("student_context: course profile read failed", exc_info=True)

    prefs = (_owned(db.query(Assertion), Assertion, owner)
             .filter(Assertion.kind == "stated",
                     Assertion.relation.in_(sorted(PREFERENCE_RELATIONS)),
                     Assertion.invalidated_at.is_(None))
             .order_by(Assertion.valid_from.desc()).limit(MAX_LIST).all())
    for a in prefs:
        lines.append(f'Student said ({a.relation}): "{(a.quote or a.literal or "").strip()}"')
    return lines


def _region(db, owner, course_id: str) -> list:
    """The course's concept nodes in book (ordinal) order — the same region
    the extractor classifies onto."""
    from src.graph.extractor import course_concept_shortlist
    return course_concept_shortlist(db, course_id, owner)


def _focus_lines(db, owner, course_id: str) -> list[str]:
    from src.graph import mastery
    from src.graph.models import Assertion, MasteryEvidence, MasteryState

    concepts = _region(db, owner, course_id)
    if not concepts:
        return []
    ids = [c.id for c in concepts]
    states = {s.concept_id: s for s in
              db.query(MasteryState).filter(MasteryState.concept_id.in_(ids)).all()}

    lines = []
    frontier, shaky = [], []
    for c in concepts:
        state, _p = mastery.state_of(states.get(c.id))
        if state != "mastered" and len(frontier) < FRONTIER_N:
            frontier.append(f"{c.name} ({state})")
        if state in ("shaky", "learning") and states.get(c.id) is not None:
            shaky.append(f"{c.name}: {state}")
    if frontier:
        lines.append("Frontier (work here next): " + "; ".join(frontier))
    for s in shaky[:MAX_LIST]:
        lines.append(f"Needs attention — {s}")

    recent = (db.query(MasteryEvidence)
              .filter(MasteryEvidence.concept_id.in_(ids))
              .order_by(MasteryEvidence.created_at.desc())
              .limit(MAX_LIST).all())
    names = {c.id: c.name for c in concepts}
    for ev in recent:
        when = ev.created_at.strftime("%b %d") if ev.created_at else ""
        lines.append(f"Recent: {names.get(ev.concept_id, ev.concept_id)} — "
                     f"{ev.signal}" + (f" ({when})" if when else ""))

    insights = (_owned(db.query(Assertion), Assertion, owner)
                .filter(Assertion.kind == "inferred",
                        Assertion.subject_type == "student",
                        Assertion.invalidated_at.is_(None),
                        Assertion.relation != "prerequisite_of")
                .order_by(Assertion.valid_from.desc()).limit(MAX_LIST).all())
    for a in insights:
        text = (a.literal or "").strip() or f"{a.relation} {names.get(a.object_id, '')}".strip()
        if text:
            lines.append(f"Insight ({a.relation}, conf {a.confidence if a.confidence is not None else 0.6:.1f}): {text}")
    return lines


def periphery_tier(db, owner, course_id: str, budget_chars: int = 0) -> list[str]:
    """T2 — coupled courses via shared graph nodes (≤1 line per coupled
    course, capped ~15% of budget, honoring course.settings.coupling_mutes).
    Built in T4; the seam returns nothing until then."""
    return []


def _ambient_lines(db, owner) -> list[str]:
    from src.graph.models import Assertion, PREFERENCE_RELATIONS

    rows = (_owned(db.query(Assertion), Assertion, owner)
            .filter(Assertion.kind == "stated",
                    Assertion.invalidated_at.is_(None),
                    ~Assertion.relation.in_(sorted(PREFERENCE_RELATIONS)))
            .order_by(Assertion.valid_from.desc()).limit(MAX_LIST).all())
    return [f'Observation ({a.relation}): "{(a.quote or a.literal or "").strip()}"'
            for a in rows if (a.quote or a.literal or "").strip()]


def _owned(query, model_cls, owner):
    from src.auth_helpers import owner_scoped
    return owner_scoped(query, model_cls, owner)


# --------------------------------------------------------------------------- #
# Assembly + budget degradation                                               #
# --------------------------------------------------------------------------- #
def _assemble(tiers: list[tuple[str, list[str]]], budget_chars: int) -> str:
    def render(parts):
        body = []
        for title, lines in parts:
            if not lines:
                continue
            body.append(f"## {title}")
            body.extend(f"- {ln}" for ln in lines)
        if not body:
            return ""
        return "\n".join([CONTEXT_OPEN, *body, CONTEXT_CLOSE])

    out = render(tiers)
    if len(out) <= budget_chars:
        return out
    # Degrade bottom-up: ambient drops, periphery drops, focus compresses.
    by_name = dict(tiers)
    for drop in ("ambient", "periphery"):
        if by_name.get(drop):
            by_name[drop] = []
            out = render([(n, by_name[n]) for n, _ in tiers])
            if len(out) <= budget_chars:
                return out
    focus = by_name.get("focus") or []
    if len(focus) > FOCUS_MIN_LINES:
        by_name["focus"] = focus[:FOCUS_MIN_LINES]
        out = render([(n, by_name[n]) for n, _ in tiers])
    return out  # profile + compressed focus always survive (F6 contract)


def student_context(owner, course_id, call_type: str = "chat",
                    token_budget: int = DEFAULT_TOKEN_BUDGET) -> str:
    """The assembler. Returns the delimited STUDENT CONTEXT block, or "" when
    there is no course (no-op) or nothing to say. NEVER raises."""
    if not course_id:
        return ""
    try:
        from core.database import SessionLocal
        from src.graph.models import ensure_graph_tables
        ensure_graph_tables()
        budget_chars = max(int(token_budget) * CHARS_PER_TOKEN, 200)
        db = SessionLocal()
        try:
            tiers = [
                ("profile", _profile_lines(db, owner, course_id)),
                ("focus", _focus_lines(db, owner, course_id)),
                ("periphery", periphery_tier(db, owner, course_id,
                                             int(budget_chars * 0.15))),
                ("ambient", _ambient_lines(db, owner)),
            ]
        finally:
            db.close()
        if not any(lines for _t, lines in tiers):
            return ""
        return _assemble(tiers, budget_chars)
    except Exception as e:
        logger.warning("student_context failed (returning empty): %s", e)
        return ""


def maybe_student_context(session_id: str, owner, course_id=None):
    """build_chat_context's hook: resolve the turn's course (session binding,
    else the request fallback) and return a system message or None. Mirrors
    grounding.maybe_ground's degradation contract — never raises."""
    try:
        from src.corpus.grounding import session_course_id
        resolved = session_course_id(session_id, fallback=course_id)
        block = student_context(owner, resolved) if resolved else ""
        return {"role": "system", "content": block} if block else None
    except Exception as e:
        logger.warning("student_context injection skipped: %s", e)
        return None


__all__ = ["student_context", "maybe_student_context", "periphery_tier",
           "CONTEXT_OPEN", "CONTEXT_CLOSE"]
