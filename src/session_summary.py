"""Phase-2 T5 vertical-4 (SPEC F9) — session-summary notes.

"A session leaves a note behind": when the student clicks "Summarize" after a
substantive study session, the tutor DRAFTS an editable course note (covered /
what clicked / still shaky / citations touched) and saves it as a `source="agent"`
Note in the course. The draft is the student's note — the tutor only drafts it
(untrusted-content: a proposal the user edits, never auto-acted/auto-pinned; calm:
no auto-modal, surfaced gently). See docs/T5-SUMMARY-CONTRACT.md (D1–D7).

One-door discipline:
  * graph ground-truth read ONLY via src/student_context.student_context (Gate 6f)
  * model selection ONLY via src/model_router (no model-name literals; no-LLM guard)
  * course resolution via src/corpus/grounding.session_course_id
The substantive gate + the never-invent-a-citation prompt rule both live here.
"""

from __future__ import annotations

import logging
import uuid

logger = logging.getLogger(__name__)


# Substantive gate: a "session worth a note" needs at least this many real
# user/assistant turns. Below it the route reports `too_short` and WRITES NOTHING
# (calm: don't draft on a two-line exchange / token churn).
DEFAULT_MIN_TURNS = 4

# Per-turn transcript truncation, mirroring src/graph/extractor._recent_turns.
_TURN_CHARS = 4000


# A sentinel the engine returns when the session is missing or owned by someone
# else; the route maps this to HTTPException(404). (We return a signal rather
# than raise so the engine stays import-light and unit-testable without FastAPI.)
NOT_FOUND = "__not_found__"


SUMMARY_SYSTEM_PROMPT = (
    "You are a patient tutor writing a short study note FOR the student, in their "
    "voice, about the session you just had together. It is the student's own note — "
    "calm and plain, no praise inflation, no greetings, no preamble.\n\n"
    "Write concise markdown with EXACTLY these four sections (omit a section's "
    "bullets only if there is genuinely nothing for it):\n"
    "## Covered\n"
    "## What clicked\n"
    "## Still shaky\n"
    "## Citations touched\n\n"
    "Hard rules:\n"
    "- Summarize ONLY what is actually in the transcript and the STUDENT CONTEXT "
    "block below. Do not introduce facts, topics, or claims that are not there.\n"
    "- NEVER invent a citation. Under 'Citations touched' list ONLY citation labels "
    "of the form [title §heading, p. N] that appear VERBATIM in the transcript. "
    "If none appear, write 'None this session.'\n"
    "- Be brief: short bullets, no filler. Output only the note markdown."
)


def _strip_text(content) -> str:
    """Flatten a message content (str or list-of-blocks) to text. Mirrors
    src/graph/extractor._strip_text."""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return " ".join(
            str(b.get("text") or "") for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        ).strip()
    return ""


def _all_turns(sess) -> list[dict]:
    """Every real user/assistant turn (NOT just the recent window — the note
    covers the whole session). Same shape/filters as extractor._recent_turns."""
    try:
        messages = sess.get_context_messages()
    except Exception:
        return []
    out: list[dict] = []
    for m in messages:
        role = m.get("role") if isinstance(m, dict) else getattr(m, "role", "")
        text = _strip_text(m.get("content") if isinstance(m, dict)
                           else getattr(m, "content", ""))
        if role in ("user", "assistant") and text:
            out.append({"role": role, "content": text[:_TURN_CHARS]})
    return out


def _course_name(db, course_id, owner) -> str | None:
    """The course's display name (owner-scoped read), else None. Never raises."""
    if not course_id:
        return None
    try:
        from core.database import Course
        from src.auth_helpers import owner_scoped
        q = owner_scoped(db.query(Course), Course, owner) if owner \
            else db.query(Course)
        row = q.filter(Course.id == course_id).first()
        return row.name if row else None
    except Exception as e:
        logger.debug("session_summary: course name lookup failed: %s", e)
        return None


def _note_to_dict(note) -> dict:
    """The SAME shape routes/note_routes._note_to_dict returns (so the engine's
    `note` payload matches the notes API). Imported from the route to stay in
    lockstep; falls back to a local build if the import ever moves."""
    from routes.note_routes import _note_to_dict as _route_note_to_dict
    return _route_note_to_dict(note)


async def summarize_session(
    session_manager,
    db,
    owner,
    session_id: str,
    *,
    min_turns: int = DEFAULT_MIN_TURNS,
) -> dict:
    """Draft a session-summary note (F9). Returns one of:

      {"status": "ok",        "note": <_note_to_dict dict>}   # note WRITTEN
      {"status": "too_short", "note": None}                   # WRITES NOTHING
      {"status": "no_llm",    "note": None}                   # WRITES NOTHING
      {"status": NOT_FOUND,   "note": None}                   # route -> 404

    Strict session ownership: a missing session, or one whose owner != `owner`
    (when `owner` is truthy), yields NOT_FOUND. The note is source="agent",
    unpinned (untrusted-content / calm). Graph ground-truth is read only through
    student_context (Gate 6f); the model is chosen only via the router.
    """
    # --- load + strict ownership ---------------------------------------------
    try:
        sess = session_manager.get_session(session_id)
    except Exception:
        sess = None
    if sess is None:
        return {"status": NOT_FOUND, "note": None}
    sess_owner = getattr(sess, "owner", None)
    if owner and sess_owner and sess_owner != owner:
        return {"status": NOT_FOUND, "note": None}

    # --- substantive gate (WRITES NOTHING below threshold) -------------------
    turns = _all_turns(sess)
    if len(turns) < min_turns:
        return {"status": "too_short", "note": None}

    # --- resolve the course + graph ground-truth (one-door, never raises) ----
    from src.corpus.grounding import session_course_id
    from src import student_context as student_context_mod
    course_id = session_course_id(session_id)
    context_block = student_context_mod.student_context(owner, course_id) \
        if course_id else ""

    # --- draft via the router (no model-name literals; no-LLM guard) ----------
    from src import model_router
    from src.llm_core import llm_call_async
    routed = model_router.resolve(
        model_router.TaskProfile(tier="light", output_shape="free",
                                 latency="background"),
        owner=owner, legacy_prefix="utility")
    if not routed.endpoint_url or not routed.model:
        logger.debug("[session-summary] no LLM configured, skipping")
        return {"status": "no_llm", "note": None}

    transcript = "\n".join(
        f"{t['role'].upper()}: {t['content']}" for t in turns)
    user_block = ""
    if context_block:
        user_block += context_block + "\n\n"
    user_block += "TRANSCRIPT:\n" + transcript

    try:
        raw = await llm_call_async(
            routed.endpoint_url, routed.model,
            [{"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
             {"role": "user", "content": user_block}],
            temperature=0.3, max_tokens=1200, headers=routed.headers,
            timeout=120)
    except Exception as e:
        # A configured provider can still be momentarily down/slow/rate-limited
        # (llm_call_async RAISES on 429/5xx/timeout). Degrade to the calm no_llm
        # path (writes nothing) instead of a hard 5xx — mirrors the extractor.
        logger.debug("[session-summary] LLM call failed: %s", e)
        return {"status": "no_llm", "note": None}

    from src.text_helpers import strip_think
    draft = strip_think(raw or "", prose=True).strip()
    if not draft:
        # The model returned nothing usable; treat as no-op rather than write an
        # empty note (calm: never leave a blank artifact behind).
        return {"status": "no_llm", "note": None}

    # --- create the Note (source="agent", unpinned) --------------------------
    from core.database import Note
    cname = _course_name(db, course_id, owner)
    title = f"Session summary — {cname}" if cname else "Session summary"
    note = Note(
        id=str(uuid.uuid4()),
        owner=owner,
        title=title,
        content=draft,
        note_type="note",
        source="agent",
        session_id=session_id,
        course_id=course_id,
        pinned=False,
        archived=False,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return {"status": "ok", "note": _note_to_dict(note)}
