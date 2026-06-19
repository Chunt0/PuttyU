"""
extractor.py — after-turn background graph extraction (ADR 0005 §Writes).

The memory_extractor pattern, pointed at the graph: after a completed turn,
ONE LLM call (model_router tier=light / latency=background / output_shape=
structured) extracts three things from the last user+assistant exchange:

  (a) mastery evidence  — {concept, signal, note}; concept MUST name one of
      the provided course-region nodes (closed world — unmatched names drop);
  (b) stated observations — {quote (verbatim), relation, entity}; persisted
      as entity nodes (ADD/NOOP reconciliation, normalized-equality v1) +
      kind=stated assertions carrying the quote and the episode refs;
  (c) inferred insights — {statement, relation, concept?, confidence};
      persisted as kind=inferred assertions.

Contradiction rule v1: a new assertion with the same subject+relation+object
identity but a different statement INVALIDATES the old one (invalidated_at +
reason="superseded") — never deletes (bi-temporal, Graphiti semantics).

Never blocks the stream (asyncio.create_task at the call site), never raises,
skipped in incognito (call-site gate), and skips silently when no LLM is
configured.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re

from src.graph.models import (
    Assertion, ConceptNode, EntityNode, RELATIONS, SIGNALS, ensure_graph_tables,
    episode_ref, new_id, normalize_name, utcnow,
)

logger = logging.getLogger(__name__)

# How many trailing messages feed the extraction (last user + assistant pair,
# plus a little context, like memory_extractor's CONTEXT_WINDOW).
CONTEXT_WINDOW = 4
MAX_CONCEPT_SHORTLIST = 60
MAX_ITEMS_PER_KIND = 5

EXTRACT_SYSTEM_PROMPT = """You are the student-model extractor for a tutoring app. \
Analyze the conversation excerpt and extract structured signals about the STUDENT.

Return ONE JSON object with exactly these keys (each a list, [] when empty):

"evidence": mastery signals about course concepts the student demonstrably worked on.
  Items: {"concept": "<MUST be copied exactly from the COURSE CONCEPTS list>",
          "signal": "correct" | "partial" | "incorrect" | "hint_used" | "explained",
          "note": "<short why>"}
  Only use concepts from the list — if nothing matches, emit nothing. \
"correct"/"explained" = the student solved or explained it; "partial" = partly right; \
"incorrect" = got it wrong; "hint_used" = needed a hint to proceed.

"observations": things the STUDENT stated about themself or their world.
  Items: {"quote": "<the student's words, VERBATIM>",
          "relation": "likes" | "dislikes" | "prefers" | "interested_in" | "believes",
          "entity": "<the thing the statement is about, 1-4 words>"}

"insights": conclusions YOU draw about the student's learning (not restatements).
  Items: {"statement": "<one short sentence>",
          "relation": "struggles_with" | "breakthrough_on" | "misconception" | "believes",
          "concept": "<a COURSE CONCEPTS entry, or omit>",
          "confidence": 0.0-1.0}

Rules: extract at most 5 items per list; only what THIS excerpt supports; never invent \
quotes; the assistant's words are never observations. Return ONLY the JSON object, no \
markdown fences, no commentary."""


# --------------------------------------------------------------------------- #
# Robust JSON (the memory_extractor tidy-pass approach, object-shaped)        #
# --------------------------------------------------------------------------- #
def parse_extraction(raw: str) -> dict | None:
    """Strict-JSON parse tolerating reasoning noise: <think> blocks, fences,
    leading prose, trailing commas. None when no object can be recovered."""
    text = (raw or "").strip()
    text = re.sub(r"<think(?:ing)?>[\s\S]*?</think(?:ing)?>", "", text, flags=re.I).strip()

    def _loads_obj(s):
        if not s:
            return None
        for cand in (s, re.sub(r",(\s*[}\]])", r"\1", s)):
            try:
                v = json.loads(cand)
                if isinstance(v, dict):
                    return v
            except Exception:
                continue
        return None

    obj = _loads_obj(text)
    if obj is None:
        m = re.search(r"```(?:json)?\s*\n?([\s\S]*?)```", text)
        if m:
            obj = _loads_obj(m.group(1).strip())
    if obj is None:
        a, b = text.find("{"), text.rfind("}")
        if a >= 0 and b > a:
            obj = _loads_obj(text[a:b + 1])
    return obj


# --------------------------------------------------------------------------- #
# Context assembly                                                            #
# --------------------------------------------------------------------------- #
def _strip_text(content) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return " ".join(
            str(b.get("text") or "") for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        ).strip()
    return ""


def _recent_turns(sess) -> list[dict]:
    try:
        messages = sess.get_context_messages()
    except Exception:
        return []
    recent = messages[-CONTEXT_WINDOW:]
    out = []
    for m in recent:
        role = m.get("role") if isinstance(m, dict) else getattr(m, "role", "")
        text = _strip_text(m.get("content") if isinstance(m, dict)
                           else getattr(m, "content", ""))
        if role in ("user", "assistant") and text:
            out.append({"role": role, "content": text[:4000]})
    return out


def _episode_refs_for(sess, session_id: str) -> list[dict]:
    """Receipts for this turn: the persisted message ids when available
    (metadata._db_id), else the session itself."""
    refs = []
    try:
        for msg in list(getattr(sess, "history", []))[-2:]:
            meta = getattr(msg, "metadata", None)
            if isinstance(meta, dict) and meta.get("_db_id"):
                refs.append(episode_ref("chat_message", meta["_db_id"]))
    except Exception:
        pass
    return refs or [episode_ref("chat_session", session_id)]


def course_concept_shortlist(db, course_id: str, owner) -> list:
    """Names of the course-region concept nodes (the closed world the
    extractor classifies onto), in book (ordinal) order."""
    from src.corpus.course_search import course_source_ids
    source_ids = set(course_source_ids(db, course_id, owner))
    if not source_ids:
        return []
    q = db.query(ConceptNode)
    q = q.filter(ConceptNode.owner == owner) if owner else \
        q.filter(ConceptNode.owner.is_(None))
    nodes = []
    for node in q.all():
        meta = node.meta if isinstance(node.meta, dict) else {}
        node_sources = set(meta.get("sources") or [])
        if node.source_id:
            node_sources.add(node.source_id)
        if node_sources & source_ids:
            nodes.append(node)
    nodes.sort(key=lambda n: (n.meta or {}).get("ordinal", 0)
               if isinstance(n.meta, dict) else 0)
    return nodes[:MAX_CONCEPT_SHORTLIST]


# --------------------------------------------------------------------------- #
# Persistence                                                                 #
# --------------------------------------------------------------------------- #
def _reconcile_entity(db, name: str, owner):
    """ADD/UPDATE/NOOP v1: exact/normalized match reuses (NOOP), else ADD.
    (The LLM-arbitrated near-match step is a later upgrade — ADR 0005.)"""
    norm = normalize_name(name)
    if not norm:
        return None
    q = db.query(EntityNode).filter(EntityNode.normalized_name == norm)
    q = q.filter(EntityNode.owner == owner) if owner else \
        q.filter(EntityNode.owner.is_(None))
    node = q.first()
    if node is not None:
        return node
    node = EntityNode(id=new_id(), name=name.strip(), normalized_name=norm,
                      owner=owner, meta={})
    db.add(node)
    db.flush()
    return node


def _object_identity(a: Assertion) -> tuple:
    if a.object_id:
        return ("node", a.object_type, a.object_id)
    return ("literal", normalize_name(a.literal or ""))


def persist_assertion(db, candidate: Assertion) -> Assertion | None:
    """Insert with the v1 contradiction rule: an active assertion with the
    same subject+relation+object identity but different content is
    invalidated (superseded); an identical one makes this a NOOP."""
    new_content = normalize_name(candidate.quote or candidate.literal or "")
    existing = (db.query(Assertion)
                .filter(Assertion.subject_type == candidate.subject_type,
                        Assertion.subject_id == candidate.subject_id,
                        Assertion.relation == candidate.relation,
                        Assertion.invalidated_at.is_(None),
                        Assertion.owner == candidate.owner)
                .all())
    for old in existing:
        if _object_identity(old) != _object_identity(candidate):
            continue
        old_content = normalize_name(old.quote or old.literal or "")
        if old.kind == candidate.kind and old_content == new_content:
            return None  # NOOP — same fact already active
        old.invalidated_at = utcnow()
        old.invalidation_reason = "superseded"
    db.add(candidate)
    return candidate


def persist_extraction(db, parsed: dict, *, owner, concepts: list,
                       refs: list[dict]) -> dict:
    """Write one parsed extraction. Returns counters (for logs/tests)."""
    from src.graph import mastery

    by_name = {}
    for node in concepts:
        by_name[normalize_name(node.name)] = node
    counts = {"evidence": 0, "observations": 0, "insights": 0}

    for item in (parsed.get("evidence") or [])[:MAX_ITEMS_PER_KIND]:
        if not isinstance(item, dict):
            continue
        node = by_name.get(normalize_name(str(item.get("concept") or "")))
        signal = str(item.get("signal") or "").strip().lower()
        if node is None or signal not in SIGNALS or signal.startswith("override"):
            continue  # closed world: unmatched concept / bad signal drops
        mastery.apply_evidence(
            node.id, signal, weight=1.0, episode_ref=(refs[0] if refs else None),
            context={"source": "chat", "note": str(item.get("note") or "")[:300]},
            owner=owner, db=db)
        counts["evidence"] += 1

    for item in (parsed.get("observations") or [])[:MAX_ITEMS_PER_KIND]:
        if not isinstance(item, dict):
            continue
        quote = str(item.get("quote") or "").strip()
        entity_name = str(item.get("entity") or "").strip()
        if not quote or not entity_name:
            continue
        relation = str(item.get("relation") or "").strip().lower()
        relation = relation if relation in RELATIONS else "related_to"
        entity = _reconcile_entity(db, entity_name, owner)
        if entity is None:
            continue
        if persist_assertion(db, Assertion(
                id=new_id(), subject_type="student", subject_id=owner or "",
                relation=relation, object_type="entity", object_id=entity.id,
                kind="stated", quote=quote[:1000], valid_from=utcnow(),
                episode_refs=refs, owner=owner)):
            counts["observations"] += 1

    for item in (parsed.get("insights") or [])[:MAX_ITEMS_PER_KIND]:
        if not isinstance(item, dict):
            continue
        statement = str(item.get("statement") or "").strip()
        if not statement:
            continue
        relation = str(item.get("relation") or "").strip().lower()
        relation = relation if relation in RELATIONS else "believes"
        try:
            confidence = min(max(float(item.get("confidence", 0.6)), 0.0), 1.0)
        except (TypeError, ValueError):
            confidence = 0.6
        node = by_name.get(normalize_name(str(item.get("concept") or "")))
        # literal keeps the statement even when concept-anchored: the anchor
        # is the object identity (what the supersede rule keys on), the
        # statement is the content that can conflict.
        if persist_assertion(db, Assertion(
                id=new_id(), subject_type="student", subject_id=owner or "",
                relation=relation,
                object_type="concept" if node else None,
                object_id=node.id if node else None,
                literal=statement[:1000],
                kind="inferred", quote=None, confidence=confidence,
                valid_from=utcnow(), episode_refs=refs, owner=owner)):
            counts["insights"] += 1

    db.commit()
    return counts


# --------------------------------------------------------------------------- #
# The after-turn hook                                                         #
# --------------------------------------------------------------------------- #
async def extract_after_turn(sess, session_id: str, owner=None) -> dict | None:
    """The background extraction pass. Designed for asyncio.create_task —
    errors are logged, never raised. Returns counters (None on skip)."""
    try:
        from src import model_router
        from src.corpus.grounding import session_course_id
        from src.llm_core import llm_call_async

        owner = owner or getattr(sess, "owner", None) or None
        turns = _recent_turns(sess)
        if len(turns) < 2:
            return None

        profile = model_router.TaskProfile(tier="light", latency="background",
                                           output_shape="structured")
        routed = model_router.resolve(profile, owner=owner, legacy_prefix="utility")
        if not routed.endpoint_url or not routed.model:
            logger.debug("[graph-extract] no LLM configured, skipping")
            return None

        ensure_graph_tables()
        from core.database import SessionLocal
        course_id = session_course_id(session_id)
        db = SessionLocal()
        try:
            concepts = (course_concept_shortlist(db, course_id, owner)
                        if course_id else [])
            names = "\n".join(f"- {n.name}" for n in concepts)
            user_block = (
                f"COURSE CONCEPTS (closed list — copy names exactly):\n"
                f"{names or '(none — emit no evidence items)'}\n\n"
                "CONVERSATION EXCERPT:\n"
                + "\n".join(f"{t['role'].upper()}: {t['content']}" for t in turns)
            )
            messages = [{"role": "system", "content": EXTRACT_SYSTEM_PROMPT},
                        {"role": "user", "content": user_block}]
            raw = await llm_call_async(
                routed.endpoint_url, routed.model, messages,
                temperature=0.1, max_tokens=1500, headers=routed.headers,
                timeout=90)
            try:  # F7 cost meter — best-effort, never breaks extraction
                from src.model_context import estimate_tokens
                model_router.record_usage(profile, routed,
                    input_tokens=estimate_tokens(messages),
                    output_tokens=len(raw or "") // 4,
                    feature="extraction", usage_source="estimated", owner=owner)
            except Exception:
                pass
            parsed = parse_extraction(raw)
            if parsed is None:
                logger.debug("[graph-extract] non-JSON extraction output")
                return None
            refs = _episode_refs_for(sess, session_id)
            counts = persist_extraction(db, parsed, owner=owner,
                                        concepts=concepts, refs=refs)
        finally:
            db.close()

        if any(counts.values()):
            try:
                from src.event_bus import fire_event
                fire_event("graph_updated", owner)
            except Exception:
                logger.debug("graph_updated event dispatch failed", exc_info=True)
            logger.info("[graph-extract] persisted %s for session %s",
                        counts, session_id)
        return counts
    except Exception as e:
        logger.warning(f"[graph-extract] failed: {e}")
        return None


def schedule_extraction(sess, session_id: str, owner=None) -> None:
    """Fire-and-forget wrapper for run_post_response_tasks (never blocks the
    stream; no-op when no event loop is running, e.g. sync tests)."""
    try:
        asyncio.get_running_loop().create_task(
            extract_after_turn(sess, session_id, owner=owner))
    except RuntimeError:
        logger.debug("[graph-extract] no running loop; skipped")
