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


def _coupling_mutes(db, owner, course_id: str) -> set:
    """The focus course's muted coupling list (course.settings.coupling_mutes).
    Conversational 'stop bringing X into this' appends to it (write side T5);
    periphery_tier already respects it (CONTRACT D10)."""
    try:
        from core.database import Course
        course = _owned(db.query(Course).filter(Course.id == course_id),
                        Course, owner).first()
        if course is None or not course.settings:
            return set()
        settings = json.loads(course.settings)
        mutes = settings.get("coupling_mutes")
        return set(mutes) if isinstance(mutes, list) else set()
    except (json.JSONDecodeError, TypeError, Exception):
        return set()


def _frontier_concept(db, ids: list[str], names: dict) -> str:
    """The first non-mastered concept (region/ordinal order) for a course —
    'currently on'. ids must already be in book order. Empty string if none."""
    from src.graph import queries
    states = queries.states_for(db, ids)
    for cid in ids:
        state, _ep, _last = states.get(cid, ("unknown", None, None))
        if state != "mastered":
            return names.get(cid, "")
    return ""


def periphery_tier(db, owner, course_id: str, budget_chars: int = 0) -> list[str]:
    """T2 — coupled courses via shared graph nodes (CONTRACT D10). Coupling =
    another ACTIVE owner-scoped course whose region shares a ConceptNode.id
    with the focus region (primary mechanism), OR a 1-hop assertion between a
    focus-region node and an other-region node (best-effort). Emits one line
    per coupled course, honoring course.settings.coupling_mutes, capped to
    ~budget_chars total. Pure reads, graph only via queries, never raises."""
    try:
        from core.database import Course
        from src.graph import queries

        focus = queries.region_concepts(db, course_id, owner)
        if not focus:
            return []
        focus_ids = {c["id"] for c in focus}
        focus_names = {c["id"]: c["name"] for c in focus}
        mutes = _coupling_mutes(db, owner, course_id)

        # Other ACTIVE courses owned by this student (owner_scoped).
        others = (_owned(db.query(Course), Course, owner)
                  .filter(Course.status == "active",
                          Course.id != course_id).all())

        lines: list[str] = []
        used = 0
        for other in others:
            if other.id in mutes:
                continue
            try:
                region = queries.region_concepts(db, other.id, owner)
            except Exception:
                continue
            if not region:
                continue
            other_ids = [c["id"] for c in region]
            other_names = {c["id"]: c["name"] for c in region}
            shared = focus_ids & set(other_ids)
            shared_name = ""
            if shared:
                # Prefer the shared node earliest in the focus region's order.
                for c in focus:
                    if c["id"] in shared:
                        shared_name = c["name"]
                        break
            else:
                shared_name = _bridge_concept(db, owner, focus_ids,
                                              set(other_ids), focus_names,
                                              other_names)
            if not shared_name:
                continue
            frontier = _frontier_concept(db, other_ids, other_names)
            if not frontier:
                continue
            line = (f"also enrolled: {other.name} — currently on {frontier}, "
                    f"which connects via {shared_name}")
            if budget_chars and used + len(line) > budget_chars:
                break
            lines.append(line)
            used += len(line)
        return lines
    except Exception:
        logger.debug("student_context: periphery tier read failed", exc_info=True)
        return []


def _bridge_concept(db, owner, focus_ids: set, other_ids: set,
                    focus_names: dict, other_names: dict) -> str:
    """Best-effort 1-hop coupling: a non-invalidated concept↔concept assertion
    with one endpoint in the focus region and the other in the other region.
    Returns the FOCUS-side concept name (the bridge into this course)."""
    try:
        from src.graph.models import Assertion
        rows = (_owned(db.query(Assertion), Assertion, owner)
                .filter(Assertion.subject_type == "concept",
                        Assertion.object_type == "concept",
                        Assertion.invalidated_at.is_(None)).all())
        for a in rows:
            if a.subject_id in focus_ids and a.object_id in other_ids:
                return focus_names.get(a.subject_id, "")
            if a.object_id in focus_ids and a.subject_id in other_ids:
                return focus_names.get(a.object_id, "")
    except Exception:
        logger.debug("student_context: bridge lookup failed", exc_info=True)
    return ""


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


def course_system_messages(session_id: str, owner, course_id=None,
                            incognito: bool = False) -> list[dict]:
    """The one-door combiner for course-bound chat system messages: the tutor
    persona/dial block (F10) + the student-context block (F6) + the
    explain-persona block (F8). All gated on `not incognito`; None/empty results
    are dropped. Returns a list suitable for `preface.extend(...)` in
    build_chat_context. The persona leads (how to behave), then the student model
    (who the student is); explain mode, when active, suppresses the base persona."""
    if incognito:
        return []
    out: list[dict] = []
    try:
        from src.tutor_persona import maybe_tutor_persona
        tp_msg = maybe_tutor_persona(session_id, owner, course_id)
        if tp_msg and tp_msg.get("content"):
            out.append(tp_msg)
    except Exception as e:
        logger.warning("course_system_messages: tutor persona skipped: %s", e)
    try:
        sc_msg = maybe_student_context(session_id, owner, course_id)
        if sc_msg and sc_msg.get("content"):
            out.append(sc_msg)
    except Exception as e:
        logger.warning("course_system_messages: student context skipped: %s", e)
    try:
        from src.explain_persona import maybe_explain_persona
        ex_msg = maybe_explain_persona(session_id, owner, course_id)
        if ex_msg and ex_msg.get("content"):
            out.append(ex_msg)
    except Exception as e:
        logger.warning("course_system_messages: explain persona skipped: %s", e)
    return out


__all__ = ["student_context", "maybe_student_context", "periphery_tier",
           "course_system_messages", "CONTEXT_OPEN", "CONTEXT_CLOSE"]
