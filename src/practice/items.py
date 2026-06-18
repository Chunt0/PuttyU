"""
items.py — the core practice engine (Phase-2 T4a, SPEC F8).

Three public functions, one item machinery shared by review/gym/exam/calibration:

  due_concepts(db, owner, course_id=None, *, limit)  — ranked due concepts (D3/D4)
  item_for_concept(db, owner, concept, *, mode, difficulty)  — mint ONE item (D6)
  grade_answer(db, owner, item_key, *, answer_text, attachment_ids)  — grade (D7)

Invariants (CLAUDE.md + T4 contract):
  * Graph access ONLY through src.graph.queries / src.graph.mastery.state_of
    (Gate 6f) — never the graph ORM, never raw SQL on graph tables.
  * Model selection ONLY via model_router.resolve + a TaskProfile — no model
    name literals anywhere.
  * `owner` is threaded through every graph/router call.
  * Reference answers are written to store.py and NEVER returned to the client;
    item_for_concept returns the schemas.PracticeItem shape (no reference_answer).
"""

from __future__ import annotations

import logging
import re
from datetime import timedelta

from src.graph import queries
from src.graph.models import episode_ref, utcnow
from src.practice import store

logger = logging.getLogger(__name__)

# D3 ranking knobs.
P_INIT = 0.2                       # weakness prior when effective_p is None
STALE_HALF_LIFE_DAYS = 21.0        # matches mastery decay half-life
FOUNDATIONAL_CAP = 3               # prereq_out_degree saturates the signal here
MASTERED_MIN = 0.8                 # non-mastered candidate ceiling

# D4 exam-aware lift.
EXAM_HORIZON_DAYS = 14
EXAM_LIFT = 1.5
_EXAM_RE = re.compile(r"(?i)\b(exam|midterm|final|quiz|test)\b")

# verdict -> mastery signal (D1, 1:1). 'ungraded' writes no evidence.
_VERDICT_SIGNAL = {"correct": "correct", "partial": "partial",
                   "incorrect": "incorrect"}

# D6: a chunk's reference answer is the prose under a Solution|Answer heading.
_SOLUTION_RE = re.compile(r"(?im)^\s{0,3}#{0,6}\s*(solution|answer)\s*:?\s*$")


# --------------------------------------------------------------------------- #
# due_concepts — the review-queue ranker (D3 + D4)                             #
# --------------------------------------------------------------------------- #
def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _active_course_ids(db, owner) -> list[str]:
    """Active courses visible to `owner` (owner_scoped, Gate 5)."""
    from core.database import Course
    from src.auth_helpers import owner_scoped
    q = owner_scoped(db.query(Course), Course, owner).filter(Course.status == "active")
    return [c.id for c in q.all()]


def _exam_lifted_courses(db, owner, course_ids: list[str]) -> set[str]:
    """Course ids with an exam-like calendar event inside EXAM_HORIZON_DAYS
    (D4 title heuristic). Owner scoping is the CalendarCal.owner join (§1f)."""
    if not course_ids:
        return set()
    try:
        from core.database import CalendarCal, CalendarEvent, utcnow_naive
        now = utcnow_naive()
        horizon = now + timedelta(days=EXAM_HORIZON_DAYS)
        q = (db.query(CalendarEvent.course_id, CalendarEvent.summary)
             .join(CalendarCal, CalendarEvent.calendar_id == CalendarCal.id)
             .filter(CalendarEvent.course_id.in_(course_ids),
                     CalendarEvent.status != "cancelled",
                     CalendarEvent.dtstart >= now,
                     CalendarEvent.dtstart < horizon))
        if owner:
            q = q.filter(CalendarCal.owner == owner)
        else:
            q = q.filter(CalendarCal.owner.is_(None))
        lifted: set[str] = set()
        for cid, summary in q.all():
            if cid and _EXAM_RE.search(summary or ""):
                lifted.add(cid)
        return lifted
    except Exception as e:  # calendar is best-effort; never break the queue
        logger.debug("[practice] exam-lift lookup failed: %s", e)
        return set()


def due_concepts(db, owner, course_id=None, *, limit: int = 10,
                 include_unseen: bool = False) -> list[dict]:
    """Ranked due concepts (D3) with the D4 exam-aware lift.

    course_id=None spans ALL active courses (the daily queue); else one course.
    Candidates = concepts that HAVE evidence (last_evidence_at != None) AND are
    non-mastered (effective_p < 0.8). Never-seen and mastered concepts are
    excluded from the push. Pure reads (no LLM). Graph access via queries only.

    include_unseen=True ALSO admits never-seen concepts (last_evidence_at is None,
    weakness from P_INIT, staleness 1.0) — the exam-simulation scope, which must
    cover the whole syllabus region, not just previously-practiced concepts.

    Each dict: {concept_id, name, score, state, effective_p, heading_path,
    sources, course_id}.
    """
    if course_id:
        course_ids = [course_id]
    else:
        course_ids = _active_course_ids(db, owner)
    if not course_ids:
        return []

    lifted = _exam_lifted_courses(db, owner, course_ids)
    now = utcnow()
    ranked: list[dict] = []

    for cid in course_ids:
        concepts = queries.region_concepts(db, cid, owner)
        if not concepts:
            continue
        ids = [c["id"] for c in concepts]
        states = queries.states_for(db, ids)
        out_deg = queries.prereq_out_degree(db, ids)
        for c in concepts:
            state, eff_p, last_at = states.get(c["id"], ("unknown", None, None))
            # D3 candidate rule: must have evidence AND be non-mastered.
            # include_unseen relaxes the evidence requirement (exam scope).
            if last_at is None and not include_unseen:
                continue
            if eff_p is not None and eff_p >= MASTERED_MIN:
                continue
            weakness = 1.0 - (eff_p if eff_p is not None else P_INIT)
            if last_at is None:
                staleness = 1.0
            else:
                days = max((now - last_at).total_seconds() / 86400.0, 0.0)
                staleness = _clamp(days / STALE_HALF_LIFE_DAYS)
            foundational = min(out_deg.get(c["id"], 0) / FOUNDATIONAL_CAP, 1.0)
            score = 0.5 * weakness + 0.3 * staleness + 0.2 * foundational
            if cid in lifted and (eff_p is None or eff_p < MASTERED_MIN):
                score *= EXAM_LIFT
            ranked.append({
                "concept_id": c["id"], "name": c["name"], "score": round(score, 6),
                "state": state, "effective_p": eff_p,
                "heading_path": c.get("heading_path", []),
                "sources": c.get("sources", []), "course_id": cid,
            })

    ranked.sort(key=lambda d: (-d["score"], d["concept_id"]))
    return ranked[: max(1, int(limit))]


# --------------------------------------------------------------------------- #
# item_for_concept — mint ONE item (D6)                                        #
# --------------------------------------------------------------------------- #
def _split_reference_answer(text: str) -> tuple[str, str]:
    """Split chunk text on a Solution|Answer heading: (prompt, reference_answer).
    Prose before the heading is the prompt, after it is the reference answer.
    No split -> (whole text, "")."""
    text = text or ""
    m = _SOLUTION_RE.search(text)
    if not m:
        return text.strip(), ""
    prompt = text[: m.start()].strip()
    answer = text[m.end():].strip()
    if not prompt:                 # heading at the very top -> answer IS the chunk;
        return "", answer          # signal "no usable prompt" so callers skip it.
    return prompt, answer


def _heading_prefix(concept: dict) -> list[str]:
    return [h for h in (concept.get("heading_path") or []) if h]


def _source_from_corpus(db, owner, concept: dict):
    """Find a real EXERCISE/TRY_IT chunk under the concept's heading subtree,
    scoped via course_source_ids (D6). Returns (chunk, src) or (None, None)."""
    course_id = concept.get("course_id")
    if not course_id:
        return None, None
    try:
        from src.corpus.course_search import course_source_ids
        from src.corpus.models import CorpusChunk, CorpusSource
        from src.corpus.records import Kind
        ids = course_source_ids(db, course_id, owner)
        if not ids:
            return None, None
        rows = (db.query(CorpusChunk)
                .filter(CorpusChunk.source_id.in_(ids or [""]),
                        CorpusChunk.kind.in_([Kind.EXERCISE, Kind.TRY_IT]))
                .order_by(CorpusChunk.ordinal).all())
        prefix = _heading_prefix(concept)
        # Order candidates: subtree-matched first (book order), then the rest, so
        # we still prefer an on-topic exercise but can fall through past a chunk
        # whose answer heading sits at the very top (L3 — never ship the answer
        # as the question).
        subtree, other = [], []
        for c in rows:
            hp = [h for h in (c.heading_path or []) if h]
            if prefix and hp[: len(prefix)] == prefix:
                subtree.append(c)
            else:
                other.append(c)
        for c in subtree + other:
            prompt, _ = _split_reference_answer(c.text or "")
            if not prompt:                 # answer-at-top / empty -> skip this chunk
                continue
            src = db.get(CorpusSource, c.source_id)
            return c, src
        return None, None
    except Exception as e:
        logger.debug("[practice] corpus sourcing failed: %s", e)
        return None, None


async def _generate_item(owner, concept: dict, *, mode: str, difficulty: int):
    """Router-generated fallback when the library is dry (D6). tier=standard,
    structured JSON. Returns {prompt, reference_answer} or None (no LLM)."""
    try:
        from src import model_router
        from src.graph.extractor import parse_extraction
        from src.llm_core import llm_call_async
        routed = model_router.resolve(
            model_router.TaskProfile(tier="standard", output_shape="structured",
                                     latency="interactive"),
            owner=owner, legacy_prefix="utility")
        if not routed.endpoint_url or not routed.model:
            return None
        system = (
            "You are a tutor writing ONE short practice question. Return ONLY a "
            "JSON object: {\"prompt\": \"<the question, no answer>\", "
            "\"reference_answer\": \"<the correct answer / worked solution>\"}. "
            "No markdown fences, no commentary.")
        user = (
            f"Concept: {concept.get('name', '')}\n"
            f"Topic path: {' > '.join(_heading_prefix(concept)) or '(none)'}\n"
            f"Difficulty (1 easy .. 5 hard): {difficulty}\n"
            "Write one self-contained practice question testing this concept.")
        raw = await llm_call_async(
            routed.endpoint_url, routed.model,
            [{"role": "system", "content": system},
             {"role": "user", "content": user}],
            temperature=0.2, max_tokens=600, headers=routed.headers, timeout=60)
        parsed = parse_extraction(raw)
        if not isinstance(parsed, dict):
            return None
        prompt = str(parsed.get("prompt") or "").strip()
        if not prompt:
            return None
        return {"prompt": prompt,
                "reference_answer": str(parsed.get("reference_answer") or "").strip()}
    except Exception as e:
        logger.debug("[practice] item generation failed: %s", e)
        return None


async def item_for_concept(db, owner, concept: dict, *, mode: str,
                           difficulty: int = 2) -> dict | None:
    """Mint ONE practice item for a concept and store the grading key.

    mode in review|gym|exam|calibration. Sourcing per D6: prefer a real
    EXERCISE/TRY_IT corpus chunk under the concept's heading subtree (split a
    reference answer on a Solution|Answer heading); else router-generate; else
    None (no LLM). Stores the full item (WITH reference_answer) in
    store.put('items', key, {...}) and RETURNS the client-safe dict WITHOUT the
    reference_answer (matches schemas.PracticeItem).
    """
    concept_id = concept.get("concept_id") or concept.get("id")
    concept_name = concept.get("name") or ""
    if not concept_id:
        return None
    course_id = concept.get("course_id")

    citation = None
    source = None
    prompt = ""
    reference_answer = ""

    chunk, src = _source_from_corpus(db, owner, concept)
    if chunk is not None and src is not None:
        prompt, reference_answer = _split_reference_answer(chunk.text or "")
        if prompt:
            from src.corpus.course_search import chunk_item
            cite = chunk_item(src, chunk)
            cite.pop("text", None)             # never ship the chunk body wholesale
            citation = cite
            source = "corpus"

    if not prompt:
        gen = await _generate_item(owner, concept, mode=mode, difficulty=difficulty)
        if not gen:
            return None
        prompt = gen["prompt"]
        reference_answer = gen.get("reference_answer", "")
        source = "generated"

    item_key = store.new_key()
    stored = {
        "mode": mode, "concept_id": concept_id, "concept_name": concept_name,
        "prompt": prompt, "reference_answer": reference_answer,
        "citation": citation, "source": source, "difficulty": int(difficulty),
        "course_id": course_id, "owner": owner,
    }
    store.put("items", item_key, stored)

    client = {
        "item_key": item_key, "concept_id": concept_id,
        "concept_name": concept_name, "prompt": prompt,
        "difficulty": int(difficulty), "mode": mode, "source": source,
        "course_id": course_id,
    }
    if citation is not None:
        client["citation"] = citation
    return client


# --------------------------------------------------------------------------- #
# grade_answer — grade + write evidence (D7, D1, D2)                           #
# --------------------------------------------------------------------------- #
# Citation's required fields (schemas.Citation): a dict missing any of these is
# NOT a usable citation and must never ride the Citation-typed field (H4/L5).
_CITATION_REQUIRED = ("chunk_id", "source_id", "title")


def _is_valid_citation(c) -> bool:
    """True iff `c` is a dict with Citation's required keys present (non-None).
    (title may be ""; it just must exist — schemas.Citation defaults it.)"""
    return isinstance(c, dict) and all(
        c.get(k) is not None for k in _CITATION_REQUIRED)


def _normalize(s: str) -> str:
    """Normalize for the no-LLM exact match: lowercase, collapse whitespace, and
    strip ALL punctuation (internal too) so "Paris, France" == "paris france"."""
    s = (s or "").strip().lower()
    s = re.sub(r"[^\w\s]", " ", s)      # drop internal punctuation, not just edges
    return re.sub(r"\s+", " ", s).strip()


def _grade_string(answer_text, reference_answer) -> str:
    """No-LLM verdict (D7). A reference answer exists -> exact normalized equality
    is the ONLY 'correct'; anything else is 'incorrect' (no token-subset matching,
    which false-passed "not 4" against ref "4"). No reference key on file ->
    'ungraded' (writes no evidence)."""
    if not (reference_answer or "").strip():
        return "ungraded"
    a = _normalize(answer_text or "")
    r = _normalize(reference_answer or "")
    if not a:
        return "incorrect"
    return "correct" if a == r else "incorrect"


def _resolve_image_data_uris(owner, attachment_ids: list[str]) -> list[dict]:
    """Resolve upload ids to OpenAI-style image_url data-URI message blocks.

    Mirrors src.document_processor.build_user_content's image branch: owner-aware
    UploadHandler.resolve_upload -> base64 data-URI. Real wiring, not a stub.
    """
    import base64
    import os
    blocks: list[dict] = []
    try:
        from src.constants import BASE_DIR, UPLOAD_DIR
        from src.upload_handler import UploadHandler
        handler = UploadHandler(BASE_DIR, UPLOAD_DIR)
        for fid in attachment_ids or []:
            info = handler.resolve_upload(fid, owner=owner)
            if not info:
                continue
            path = info.get("path")
            if not path or not os.path.exists(path):
                continue
            name = info.get("name") or info.get("original_name") or path
            mime = info.get("mime")
            if not handler.is_image_file(name, mime):
                continue
            with open(path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")
            ext = os.path.splitext(path.lower())[1].lstrip(".") or "png"
            blocks.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/{ext};base64,{encoded}"},
            })
    except Exception as e:
        logger.debug("[practice] image resolution failed: %s", e)
    return blocks


async def _grade_llm(owner, item: dict, answer_text, image_blocks):
    """LLM verdict (D7). tier=micro structured. Vision when image_blocks present
    (modality=vision RAISES RouterError with the setup hint — never grade blind).
    Returns the parsed verdict dict, or None to fall back to string match."""
    from src import model_router
    from src.graph.extractor import parse_extraction
    from src.llm_core import llm_call_async

    vision = bool(image_blocks)
    try:
        routed = model_router.resolve(
            model_router.TaskProfile(
                tier="micro", output_shape="structured", latency="interactive",
                modality="vision" if vision else "text"),
            owner=owner, legacy_prefix="utility")
    except model_router.RouterError as e:
        # No VL model configured — surface the setup hint, never grade blind.
        return {"verdict": "ungraded", "feedback_short": str(e), "_setup_hint": True}

    if not routed.endpoint_url or not routed.model:
        return None

    system = (
        "You are grading ONE student practice answer. Compare it to the reference "
        "answer if given. Return ONLY a JSON object: {\"verdict\": "
        "\"correct\"|\"partial\"|\"incorrect\", \"feedback_short\": \"<one warm, "
        "specific sentence>\", \"study_citation\": \"<optional: what to review>\"}. "
        "No markdown fences, no commentary.")
    user_text = (
        f"QUESTION:\n{item.get('prompt', '')}\n\n"
        f"REFERENCE ANSWER:\n{item.get('reference_answer') or '(none provided)'}\n\n"
        f"STUDENT ANSWER:\n{answer_text or '(see attached image)'}")
    if vision:
        user_content = [{"type": "text", "text": user_text}, *image_blocks]
    else:
        user_content = user_text
    try:
        raw = await llm_call_async(
            routed.endpoint_url, routed.model,
            [{"role": "system", "content": system},
             {"role": "user", "content": user_content}],
            temperature=0.1, max_tokens=400, headers=routed.headers, timeout=60)
    except Exception as e:
        logger.debug("[practice] grade LLM call failed: %s", e)
        return None
    parsed = parse_extraction(raw)
    if not isinstance(parsed, dict):
        return None
    return parsed


async def grade_answer(db, owner, item_key: str, *, answer_text=None,
                       attachment_ids=None) -> dict:
    """Load the stored item, grade it (D7), and write evidence (D1/D2).

    With an LLM: tier=micro structured verdict; vision when attachment_ids are
    present (RouterError -> surface the setup hint, never grade blind). No LLM:
    normalized-string match vs reference_answer (correct|incorrect), else
    'ungraded'. Maps verdict->signal 1:1 (D1) and writes evidence via
    queries.record_evidence with context['source']=mode, episode_ref,
    owner=owner, weight=1.0 (D2) — EXCEPT 'ungraded' writes NO evidence.

    Missing/expired item_key -> {verdict: 'expired', ...} (never raises).
    """
    item = store.get("items", item_key)
    # L4 (Gate-5 defense-in-depth): a stored item carries its owner; if it doesn't
    # match, treat it as not-found rather than grading another user's item.
    if item is None or (item.get("owner") and item.get("owner") != owner):
        return {"verdict": "expired", "correct": False,
                "feedback_short": "This practice item has expired — request a fresh one.",
                "concept_id": None, "concept_name": None,
                "state": None, "effective_p": None}

    concept_id = item.get("concept_id")
    concept_name = item.get("concept_name")
    mode = item.get("mode") or "review"
    reference_answer = item.get("reference_answer") or ""

    verdict = "ungraded"
    feedback = ""
    study_citation = None
    study_hint = ""        # LLM free-text "what to review" — never a Citation

    image_blocks = (_resolve_image_data_uris(owner, attachment_ids)
                    if attachment_ids else [])
    # If the caller passed attachment ids but none resolved to images, still try
    # the vision router path so the "no VL model" setup hint can surface.
    want_vision = bool(attachment_ids)

    parsed = await _grade_llm(
        owner, item, answer_text,
        image_blocks if image_blocks else ([{"type": "text", "text": ""}]
                                           if want_vision else []))
    if parsed is not None:
        v = str(parsed.get("verdict") or "").strip().lower()
        verdict = v if v in ("correct", "partial", "incorrect") else "ungraded"
        feedback = str(parsed.get("feedback_short") or "").strip()
        sc = parsed.get("study_citation")
        # H4: study_citation MUST be a valid Citation dict or None — a free-text
        # string (or a dict missing the required fields) is a study HINT, not a
        # citation, and must never land in the Citation-typed field.
        if _is_valid_citation(sc):
            study_citation = sc
        elif isinstance(sc, str) and sc.strip():
            study_hint = sc.strip()
        elif isinstance(sc, dict):
            # A malformed dict hint: keep any human-readable text as a hint.
            study_hint = str(sc.get("citation") or sc.get("text") or "").strip()
        if parsed.get("_setup_hint"):
            verdict = "ungraded"
    else:
        # No LLM configured: deterministic string match (D7).
        verdict = _grade_string(answer_text, reference_answer)
        if verdict == "correct":
            feedback = "Matches the reference answer."
        elif verdict == "incorrect":
            feedback = "Doesn't match the reference answer — review and try again."
        else:
            feedback = "No reference answer on file — can't grade this one automatically."

    # Default the study citation to the item's own citation on a miss — but only
    # if it's a structurally valid Citation (H4/L5).
    if study_citation is None and verdict in ("partial", "incorrect"):
        if _is_valid_citation(item.get("citation")):
            study_citation = item["citation"]

    # Fold an LLM free-text study hint into the feedback (never into a Citation).
    if study_hint:
        feedback = f"{feedback} {study_hint}".strip() if feedback else study_hint

    state, eff_p = None, None
    signal = _VERDICT_SIGNAL.get(verdict)
    if signal and concept_id:
        try:
            state, eff_p = queries.record_evidence(
                concept_id, signal, weight=1.0,
                episode_ref=episode_ref("task_run", item_key),
                context={"source": mode, "difficulty": item.get("difficulty", 2)},
                owner=owner, db=db)
        except Exception as e:
            logger.warning("[practice] record_evidence failed: %s", e)

    # H1: once a grade has WRITTEN evidence (any real verdict), consume the item
    # so a re-grade of the same key finds nothing and returns 'expired' (no
    # double-write). 'ungraded'/'expired' wrote no evidence -> keep for retry.
    if signal:
        try:
            store.delete("items", item_key)
        except Exception as e:
            logger.debug("[practice] item consume failed: %s", e)

    result = {
        "verdict": verdict, "correct": verdict == "correct",
        "feedback_short": feedback, "concept_id": concept_id,
        "concept_name": concept_name, "state": state, "effective_p": eff_p,
    }
    if study_citation is not None:
        result["study_citation"] = study_citation
    if study_hint:
        result["study_hint"] = study_hint
    return result


__all__ = ["due_concepts", "item_for_concept", "grade_answer"]
