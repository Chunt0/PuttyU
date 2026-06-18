"""
schemas.py — typed Pydantic models for the WHOLE practice route surface
(Phase-2 T4a). These describe both the shapes `items.py` returns and the
request/response bodies `routes/practice_routes.py` (built later, Phase C)
consumes — so the route file rides the real OpenAPI seam (ADR 0002 §1).

Every model carries `model_config = ConfigDict(extra="allow")`: the engine may
attach extra diagnostic keys (e.g. a router `why`, a debug `score`) without a
contract break, and downstream agents can extend a payload without editing the
base model. Reference answers NEVER appear here — they live only in
`src.practice.store` (Gate: reference answers never serialize to the client).

Lives here (not `src/request_models.py`, which sits near its Gate-6a ceiling).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


# --------------------------------------------------------------------------- #
# Shared atoms                                                                 #
# --------------------------------------------------------------------------- #
class Citation(BaseModel):
    """The chat-stream citation contract (§5.4): {chunk_id, source_id, title,
    heading, page_start, citation}. Same shape grounding.maybe_ground emits."""

    model_config = ConfigDict(extra="allow")

    chunk_id: str
    source_id: str
    title: str = ""               # a corpus source with a NULL title must not 500
    heading: str = ""
    page_start: int | None = None
    citation: str


class PracticeItem(BaseModel):
    """The client-safe minted item. NO `reference_answer` field — ever (the
    grading key stays server-side in store.py)."""

    model_config = ConfigDict(extra="allow")

    item_key: str
    concept_id: str
    concept_name: str
    prompt: str
    difficulty: int = 2
    mode: str                      # review | gym | exam | calibration
    source: str                    # "corpus" | "generated"
    course_id: str | None = None
    citation: Citation | None = None


class MasteryStateOut(BaseModel):
    """The derived (state, effective_p) a grade returns to the client. State
    vocabulary only — no raw p_known (§6 Q2)."""

    model_config = ConfigDict(extra="allow")

    concept_id: str
    concept_name: str | None = None
    state: str                     # unknown | learning | shaky | mastered
    effective_p: float | None = None


# --------------------------------------------------------------------------- #
# Review queue (the daily push)                                                #
# --------------------------------------------------------------------------- #
class DueConcept(BaseModel):
    """One ranked due concept (the queue is a list of these, items minted on
    demand). Mirrors items.due_concepts dict output."""

    model_config = ConfigDict(extra="allow")

    concept_id: str
    name: str
    score: float
    state: str
    effective_p: float | None = None
    heading_path: list[str] = []
    sources: list[str] = []
    course_id: str | None = None


class QueueResponse(BaseModel):
    """GET /api/practice/queue — the assembled review queue + counts."""

    model_config = ConfigDict(extra="allow")

    items: list[PracticeItem] = []
    due: list[DueConcept] = []
    count: int = 0
    course_id: str | None = None


class AnswerRequest(BaseModel):
    """POST /api/practice/answer — submit an answer to a queued review item."""

    model_config = ConfigDict(extra="allow")

    item_key: str
    answer_text: str | None = None
    attachment_ids: list[str] | None = None


class AnswerResponse(BaseModel):
    """The graded verdict + feedback + resulting mastery state."""

    model_config = ConfigDict(extra="allow")

    verdict: str                   # correct | partial | incorrect | ungraded | expired
    correct: bool = False
    feedback_short: str = ""
    study_citation: Citation | None = None
    concept_id: str | None = None
    concept_name: str | None = None
    state: str | None = None
    effective_p: float | None = None


# --------------------------------------------------------------------------- #
# Gym (student-pulled adaptive sets)                                           #
# --------------------------------------------------------------------------- #
class GymNextRequest(BaseModel):
    """POST /api/practice/gym/next — get the next gym item. No concept_id =
    coach's pick (the shakiest with errors). difficulty carries the running
    adaptive level across the set."""

    model_config = ConfigDict(extra="allow")

    course_id: str
    concept_id: str | None = None
    difficulty: int | None = None


class GymItemResponse(BaseModel):
    """The next gym item plus the running adaptive difficulty."""

    model_config = ConfigDict(extra="allow")

    item: PracticeItem | None = None
    difficulty: int = 2
    message: str | None = None     # e.g. "no practiceable concepts in scope yet"


class GymAnswerRequest(BaseModel):
    """POST /api/practice/gym/answer — answer a gym item; carries the set's
    running state so the engine can step difficulty (D5)."""

    model_config = ConfigDict(extra="allow")

    item_key: str
    answer_text: str | None = None
    attachment_ids: list[str] | None = None
    difficulty: int | None = None
    streak: int | None = None      # running same-direction streak (server may override)


class GymSetSummary(BaseModel):
    """Running tally for the current gym set."""

    model_config = ConfigDict(extra="allow")

    attempted: int = 0
    correct: int = 0
    difficulty: int = 2
    streak: int = 0


class GymAnswerResponse(BaseModel):
    """Graded gym verdict + the updated running set summary + next difficulty."""

    model_config = ConfigDict(extra="allow")

    verdict: str
    correct: bool = False
    feedback_short: str = ""
    study_citation: Citation | None = None
    concept_id: str | None = None
    concept_name: str | None = None
    state: str | None = None
    effective_p: float | None = None
    difficulty: int = 2            # difficulty to use for the NEXT item
    summary: GymSetSummary | None = None


# --------------------------------------------------------------------------- #
# Calibration (F1's optional graph warm-up)                                    #
# --------------------------------------------------------------------------- #
class CalibrationStartRequest(BaseModel):
    """POST /api/practice/calibration/start."""

    model_config = ConfigDict(extra="allow")

    course_id: str


class CalibrationStartResponse(BaseModel):
    """The calibration walk's opening state. status='no_region' (D8) when the
    course has no concepts to calibrate; status='ready' otherwise."""

    model_config = ConfigDict(extra="allow")

    status: str                    # ready | no_region
    session_key: str | None = None
    message: str | None = None
    item: PracticeItem | None = None
    total: int = 0
    position: int = 0


class CalibrationAnswerRequest(BaseModel):
    """POST /api/practice/calibration/answer — answer or skip a step."""

    model_config = ConfigDict(extra="allow")

    session_key: str
    item_key: str | None = None
    answer_text: str | None = None
    attachment_ids: list[str] | None = None
    skip: bool = False


class CalibrationAnswerResponse(BaseModel):
    """The graded step + the next item (or a done flag)."""

    model_config = ConfigDict(extra="allow")

    verdict: str | None = None
    correct: bool = False
    feedback_short: str = ""
    concept_id: str | None = None
    concept_name: str | None = None
    state: str | None = None
    effective_p: float | None = None
    next_item: PracticeItem | None = None
    position: int = 0
    total: int = 0
    done: bool = False


class CalibrationFinishRequest(BaseModel):
    """POST /api/practice/calibration/finish — end (or skip) the walk."""

    model_config = ConfigDict(extra="allow")

    session_key: str


class CalibrationFinishResponse(BaseModel):
    """A summary of the calibrated region: per-concept current states."""

    model_config = ConfigDict(extra="allow")

    status: str = "done"
    calibrated: bool = False
    states: list = []             # [{concept_id, concept_name, state, effective_p}]
    message: str | None = None


# --------------------------------------------------------------------------- #
# Exam (timed mixed-topic simulation — silent until debrief, D9)              #
# --------------------------------------------------------------------------- #
class ExamItemPrompt(BaseModel):
    """An exam item as shown DURING the exam: id + prompt only, no answers."""

    model_config = ConfigDict(extra="allow")

    item_key: str
    concept_id: str
    concept_name: str | None = None
    prompt: str
    citation: Citation | None = None


class ExamStartRequest(BaseModel):
    """POST /api/practice/exam/start."""

    model_config = ConfigDict(extra="allow")

    course_id: str
    duration_seconds: int = 1800
    n_items: int = 10


class ExamStartResponse(BaseModel):
    """The exam: ids + prompts only (reference answers stay in the store, D9),
    the start instant and the duration. Timer is client-side."""

    model_config = ConfigDict(extra="allow")

    exam_key: str
    items: list[ExamItemPrompt] = []
    started_at: str
    duration_seconds: int
    message: str | None = None     # set when the library is too dry to assemble


class ExamAnswer(BaseModel):
    """One submitted exam answer."""

    model_config = ConfigDict(extra="allow")

    item_key: str
    answer_text: str | None = None
    attachment_ids: list[str] | None = None


class ExamSubmitRequest(BaseModel):
    """POST /api/practice/exam/submit — grade the whole exam at once (D9)."""

    model_config = ConfigDict(extra="allow")

    exam_key: str
    answers: list[ExamAnswer] = []


class ExamItemVerdict(BaseModel):
    """Per-item debrief entry. Unanswered items report verdict='skipped'."""

    model_config = ConfigDict(extra="allow")

    item_key: str
    concept_id: str
    concept_name: str | None = None
    prompt: str = ""
    verdict: str                   # correct | partial | incorrect | skipped | ungraded
    correct: bool = False
    feedback_short: str = ""
    citation: Citation | None = None
    state: str | None = None
    effective_p: float | None = None


class ExamSubmitResponse(BaseModel):
    """The debrief: per-item verdicts + citations + a readiness summary."""

    model_config = ConfigDict(extra="allow")

    verdicts: list[ExamItemVerdict] = []
    correct: int = 0
    partial: int = 0
    incorrect: int = 0
    skipped: int = 0
    total: int = 0
    readiness: str = ""            # narrative summary, not a score (§6 Q2)


# --------------------------------------------------------------------------- #
# Explain (explain-it-back chat sessions — curious-student persona)           #
# --------------------------------------------------------------------------- #
class ExplainStartRequest(BaseModel):
    """POST /api/practice/explain/start."""

    model_config = ConfigDict(extra="allow")

    course_id: str
    concept_id: str


class ExplainStartResponse(BaseModel):
    """The created explain-mode session id + the concept being explained."""

    model_config = ConfigDict(extra="allow")

    session_id: str
    concept_id: str
    concept_name: str | None = None
    message: str | None = None


__all__ = [
    "Citation", "PracticeItem", "MasteryStateOut",
    "DueConcept", "QueueResponse", "AnswerRequest", "AnswerResponse",
    "GymNextRequest", "GymItemResponse", "GymAnswerRequest",
    "GymSetSummary", "GymAnswerResponse",
    "CalibrationStartRequest", "CalibrationStartResponse",
    "CalibrationAnswerRequest", "CalibrationAnswerResponse",
    "CalibrationFinishRequest", "CalibrationFinishResponse",
    "ExamItemPrompt", "ExamStartRequest", "ExamStartResponse",
    "ExamAnswer", "ExamSubmitRequest", "ExamItemVerdict", "ExamSubmitResponse",
    "ExplainStartRequest", "ExplainStartResponse",
]
