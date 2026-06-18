"""
exam.py — timed mixed-topic exam simulation (Phase-2 T4 / B2, SPEC F8, D9).

Two public coroutines:

  start(db, owner, course_id, *, duration_seconds, n_items) -> dict
      Assemble a scope-weighted, mixed-topic set: rank candidates with
      items.due_concepts (weakness-biased, D3/D4 exam lift), then spread the
      pick across headings so the exam is not all one chapter. Mint each item
      via items.item_for_concept(mode="exam") and persist exam state in the
      store ("exams" section, TTL 24h). The tutor is SILENT until submit — no
      grading here. Returns an ExamStartResponse-shaped dict carrying prompts
      only; reference answers stay in the per-item store keys, never echoed.

  submit(db, owner, exam_key, answers) -> dict
      Grade each answered item via items.grade_answer (which writes mastery
      evidence with context source=exam, since each item was minted mode=exam);
      unanswered items are reported as 'skipped' and write NO evidence. Returns
      an ExamSubmitResponse-shaped debrief: per-item verdicts, the correct/
      partial/incorrect/skipped/total counts, and a short readiness narrative.

Invariants (CLAUDE.md + T4 contract):
  * Graph access only through items.* / src.graph.queries (Gate 6f).
  * Model selection only via the router, inside items.* — no model literals here.
  * `owner` is threaded through every call.
  * Reference answers NEVER serialize to the client; they live in store.py.
"""

from __future__ import annotations

import logging

from src.graph.models import utcnow
from src.practice import items, store

logger = logging.getLogger(__name__)

# Candidate pool size: pull a wide ranked slate so the spread step has room to
# mix topics rather than draining one heading. n_items is the assembled cap.
_CANDIDATE_LIMIT = 60


# --------------------------------------------------------------------------- #
# scope-weighted, mixed-topic selection                                       #
# --------------------------------------------------------------------------- #
def _heading_key(concept: dict) -> str:
    """The grouping key for the spread — the top-most non-empty heading (the
    chapter/section the concept lives under), or its name if pathless."""
    hp = [h for h in (concept.get("heading_path") or []) if h]
    if hp:
        return hp[0]
    return concept.get("name") or concept.get("concept_id") or ""


def _spread_pick(ranked: list[dict], n_items: int) -> list[dict]:
    """Pick up to n_items concepts biased toward weakness (ranked is already
    weakness-first) but spread across headings: round-robin one per heading
    group in score order, then refill from the remainder. Preserves the
    weakness bias within each pass while preventing one heading from dominating.
    """
    if n_items <= 0 or not ranked:
        return []

    # Group by heading, preserving the incoming (weakness-first) order.
    groups: dict[str, list[dict]] = {}
    order: list[str] = []
    for c in ranked:
        k = _heading_key(c)
        if k not in groups:
            groups[k] = []
            order.append(k)
        groups[k].append(c)

    picked: list[dict] = []
    # Round-robin across heading groups; each round takes the weakest remaining
    # concept from each group (groups stay weakness-ordered internally).
    while len(picked) < n_items and any(groups[k] for k in order):
        for k in order:
            if not groups[k]:
                continue
            picked.append(groups[k].pop(0))
            if len(picked) >= n_items:
                break
    return picked


# --------------------------------------------------------------------------- #
# start — assemble the exam (silent until submit)                             #
# --------------------------------------------------------------------------- #
async def start(db, owner, course_id, *, duration_seconds: int = 1800,
                n_items: int = 10) -> dict:
    """Assemble a timed, mixed-topic exam for `course_id` and persist its state.

    Returns an ExamStartResponse-shaped dict:
      {exam_key, items: [ExamItemPrompt...], started_at, duration_seconds, message}
    `items` carry prompts only — no reference answers (D9). A dry/empty region
    yields an empty `items` list with an explanatory `message`.
    """
    duration_seconds = max(1, int(duration_seconds))
    n_items = max(1, int(n_items))

    # Exam scope covers the whole syllabus region (include_unseen), weakness-
    # weighted — not just previously-practiced concepts, so a fresh course still
    # assembles a real exam.
    ranked = items.due_concepts(db, owner, course_id, limit=_CANDIDATE_LIMIT,
                                include_unseen=True)
    chosen = _spread_pick(ranked, n_items)

    started_at = utcnow().isoformat()
    exam_key = store.new_key()

    minted_prompts: list[dict] = []   # client-facing ExamItemPrompt shapes
    state_items: list[dict] = []      # the persisted {item_key, concept_id, prompt}

    for concept in chosen:
        item = await items.item_for_concept(db, owner, concept, mode="exam")
        if not item:
            continue                  # dry concept (no corpus item, no LLM) — skip
        prompt_entry = {
            "item_key": item["item_key"],
            "concept_id": item["concept_id"],
            "concept_name": item.get("concept_name"),
            "prompt": item["prompt"],
        }
        if item.get("citation") is not None:
            prompt_entry["citation"] = item["citation"]
        minted_prompts.append(prompt_entry)
        # Persisted state never carries the reference answer (that stays in the
        # per-item store key); only the link back to it.
        state_items.append({
            "item_key": item["item_key"],
            "concept_id": item["concept_id"],
            "concept_name": item.get("concept_name"),
            "prompt": item["prompt"],
            "citation": item.get("citation"),
        })

    store.put("exams", exam_key, {
        "course_id": course_id,
        "owner": owner,
        "items": state_items,
        "started_at": started_at,
        "duration_seconds": duration_seconds,
    })

    message = None
    if not minted_prompts:
        message = ("No practiceable items in this course yet — the exam fills "
                   "out as the library and your study history grow.")

    return {
        "exam_key": exam_key,
        "items": minted_prompts,
        "started_at": started_at,
        "duration_seconds": duration_seconds,
        "message": message,
    }


# --------------------------------------------------------------------------- #
# submit — grade the whole exam at once, build the debrief                     #
# --------------------------------------------------------------------------- #
def _readiness_narrative(verdicts: list[dict], correct: int, total: int) -> str:
    """A short, calm, narrative readiness summary (NOT a score, §6 Q2).

    Rolls per-heading performance into one line: which areas are strong and
    which need work, plus an overall sentence. Falls back gracefully when there
    is nothing graded."""
    graded = [v for v in verdicts if v.get("verdict") in
              ("correct", "partial", "incorrect")]
    if not graded:
        return ("Nothing was graded — answer some items to get a readiness "
                "read on this exam's scope.")

    # Bucket by the citation heading (or concept name) into strong/weak.
    strong: list[str] = []
    weak: list[str] = []
    seen: set[str] = set()
    by_area: dict[str, list[bool]] = {}
    area_order: list[str] = []
    for v in graded:
        cite = v.get("citation")
        area = ""
        if isinstance(cite, dict):
            area = cite.get("heading") or cite.get("title") or ""
        if not area:
            area = v.get("concept_name") or ""
        if not area:
            area = "this material"
        if area not in by_area:
            by_area[area] = []
            area_order.append(area)
        by_area[area].append(v.get("verdict") == "correct")

    for area in area_order:
        results = by_area[area]
        rate = sum(1 for r in results if r) / max(1, len(results))
        label = area if area not in seen else area
        seen.add(label)
        if rate >= 0.75:
            strong.append(label)
        elif rate < 0.5:
            weak.append(label)

    parts: list[str] = []
    if strong:
        parts.append("strong on " + ", ".join(strong[:3]))
    if weak:
        parts.append(", ".join(weak[:3]) + " needs work")
    # L1: the readiness denominator counts only graded items (skipped/ungraded
    # excluded), so "k/n correct" can't read worse than the work actually did.
    overall = f"{correct}/{len(graded)} correct"
    if parts:
        return overall + " — " + "; ".join(parts) + "."
    return overall + " — keep working the weaker areas."


async def submit(db, owner, exam_key: str, answers: list) -> dict:
    """Grade an exam's answers and return the debrief.

    `answers` = list of {item_key, answer_text?, attachment_ids?}. Answered items
    are graded via items.grade_answer (writes evidence source=exam). Unanswered
    items report verdict='skipped' and write no evidence. Missing/expired exam
    -> {error:"expired", ...} (never raises). Stamps submitted_at on the exam.
    """
    exam = store.get("exams", exam_key)
    if exam is None:
        return {"error": "expired", "verdicts": [], "correct": 0, "partial": 0,
                "incorrect": 0, "skipped": 0, "total": 0,
                "readiness": "This exam has expired — start a fresh simulation."}

    # H2: idempotency. A second submit must re-grade NOTHING (the first submit
    # already consumed the per-item keys and wrote exam evidence). Short-circuit
    # with an ExamSubmitResponse-shaped no-op.
    if exam.get("submitted_at"):
        return {"verdicts": [], "correct": 0, "partial": 0, "incorrect": 0,
                "skipped": 0, "total": 0,
                "readiness": "This exam was already submitted."}

    # Index submitted answers by item_key (last write wins on duplicates).
    answer_by_key: dict[str, dict] = {}
    for a in answers or []:
        if isinstance(a, dict):
            key = a.get("item_key")
        else:                                  # tolerate pydantic models
            key = getattr(a, "item_key", None)
            a = {"item_key": key,
                 "answer_text": getattr(a, "answer_text", None),
                 "attachment_ids": getattr(a, "attachment_ids", None)}
        if key:
            answer_by_key[key] = a

    verdicts: list[dict] = []
    counts = {"correct": 0, "partial": 0, "incorrect": 0, "skipped": 0,
              "ungraded": 0}

    for ex_item in exam.get("items", []):
        item_key = ex_item.get("item_key")
        concept_id = ex_item.get("concept_id")
        concept_name = ex_item.get("concept_name")
        prompt = ex_item.get("prompt", "")
        citation = ex_item.get("citation")

        submitted = answer_by_key.get(item_key)
        answered = submitted is not None and (
            (submitted.get("answer_text") or "").strip()
            or submitted.get("attachment_ids"))

        if not answered:
            counts["skipped"] += 1
            entry = {
                "item_key": item_key, "concept_id": concept_id,
                "concept_name": concept_name, "prompt": prompt,
                "verdict": "skipped", "correct": False,
                "feedback_short": "Not answered.",
                "state": None, "effective_p": None,
            }
            if items._is_valid_citation(citation):
                entry["citation"] = citation
            verdicts.append(entry)
            continue

        graded = await items.grade_answer(
            db, owner, item_key,
            answer_text=submitted.get("answer_text"),
            attachment_ids=submitted.get("attachment_ids"))

        verdict = graded.get("verdict", "ungraded")
        # L1: an answered item that couldn't be graded (no key / expired) folds
        # into 'skipped' for reporting so the buckets sum to total and the
        # readiness denominator (graded items) excludes it.
        if verdict in ("correct", "partial", "incorrect"):
            counts[verdict] += 1
        else:
            counts["skipped"] += 1
        entry = {
            "item_key": item_key,
            "concept_id": graded.get("concept_id") or concept_id,
            "concept_name": graded.get("concept_name") or concept_name,
            "prompt": prompt,
            "verdict": verdict,
            "correct": bool(graded.get("correct")),
            "feedback_short": graded.get("feedback_short", ""),
            "state": graded.get("state"),
            "effective_p": graded.get("effective_p"),
        }
        # Prefer a grade-time study citation; else fall back to the item's own.
        # H4: ExamItemVerdict.citation must be a valid Citation or None.
        cite = graded.get("study_citation") or citation
        if items._is_valid_citation(cite):
            entry["citation"] = cite
        verdicts.append(entry)

    total = len(verdicts)
    readiness = _readiness_narrative(verdicts, counts["correct"], total)

    store.update("exams", exam_key, {"submitted_at": utcnow().isoformat()})

    return {
        "verdicts": verdicts,
        "correct": counts["correct"],
        "partial": counts["partial"],
        "incorrect": counts["incorrect"],
        "skipped": counts["skipped"],
        "total": total,
        "readiness": readiness,
    }


__all__ = ["start", "submit"]
