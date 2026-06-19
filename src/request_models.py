from pydantic import BaseModel, ConfigDict, Field, field_validator
from typing import Optional, List, Dict, Any, Union
from datetime import datetime


# Request Models
class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=50000, description="Chat message")
    session: str = Field(..., description="Session ID")
    attachments: Optional[List[str]] = Field(default=[], description="Attachment IDs")
    use_web: Optional[bool] = Field(default=False, description="Enable web search")
    use_research: Optional[bool] = Field(default=False, description="Enable deep research")
    time_filter: Optional[str] = Field(default=None, description="Time filter for search")
    preset_id: Optional[str] = Field(default=None, description="Preset identifier")
    
    @field_validator('message')
    @classmethod
    def clean_message(cls, v):
        return v.strip()
    
    @field_validator('time_filter')
    @classmethod
    def validate_time_filter(cls, v):
        if v is not None and v not in ['day', 'week', 'month', 'year']:
            return None  # Just set to None if invalid rather than raising error
        return v


class SessionCreateRequest(BaseModel):
    name: Optional[str] = Field(default="", max_length=200, description="Session name")
    endpoint_url: str = Field(..., description="LLM endpoint URL")
    model: Optional[str] = Field(default="", description="Model ID")
    rag: Optional[bool] = Field(default=False, description="Enable RAG")


class MemoryAddRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Memory text")
    category: str = Field(default="fact", description="Memory category")
    source: str = Field(default="user", description="Memory source")
    session_id: Optional[str] = Field(default=None, description="Associated session ID")

    @field_validator('category')
    @classmethod
    def validate_category(cls, v):
        if v not in ['fact', 'contact', 'task', 'preference', 'identity', 'project', 'goal']:
            return 'fact'  # Default to 'fact' if invalid
        return v


class MemoryUpdateRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000, description="Updated memory text")
    category: Optional[str] = Field(default=None, pattern="^(fact|contact|task|preference|identity|project|goal)$", description="Memory category")


class PresetUpdateRequest(BaseModel):
    """Request model for updating custom preset configuration."""
    name: str = Field(
        "",
        max_length=50,
        description="Character display name (shown next to model name)"
    )
    enabled: bool = Field(
        True,
        description="Whether this character is active"
    )
    temperature: float = Field(
        1.0,
        ge=0.0,
        le=2.0,
        description="Temperature parameter for text generation (0.0-2.0)"
    )
    max_tokens: int = Field(
        0,
        ge=0,
        le=8192,
        description="Maximum number of tokens to generate (0 = no limit)"
    )
    system_prompt: str = Field(
        "",
        max_length=10000,
        description="System prompt to guide assistant behavior (empty = default)"
    )
    inject_prefix: str = Field(
        "",
        max_length=5000,
        description="Text to prepend to each outgoing user message"
    )
    inject_suffix: str = Field(
        "",
        max_length=5000,
        description="Text to append to each outgoing user message"
    )


class DirectoryRequest(BaseModel):
    """Request model for directory operations."""
    directory: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Path to the directory"
    )


# Response Models
class ErrorResponse(BaseModel):
    error: str = Field(..., description="Error code")
    message: str = Field(..., description="Error message")
    details: Optional[Dict[str, Any]] = Field(default=None, description="Additional error details")


class UploadResponse(BaseModel):
    id: str = Field(..., description="File ID")
    name: str = Field(..., description="Sanitized filename")
    mime: str = Field(..., description="MIME type")
    size: int = Field(..., description="File size in bytes")
    hash: str = Field(..., description="SHA-256 hash")
    uploaded_at: datetime = Field(..., description="Upload timestamp")
    is_duplicate: bool = Field(default=False, description="Whether file is a duplicate")


class SessionResponse(BaseModel):
    id: str = Field(..., description="Session ID")
    name: str = Field(..., description="Session name")
    model: str = Field(..., description="Model being used")
    rag: bool = Field(default=False, description="RAG enabled")
    archived: bool = Field(default=False, description="Whether session is archived")
    course_id: Optional[str] = Field(default=None, description="Course this session belongs to (ADR 0004); null = course-less")


class MemoryResponse(BaseModel):
    id: str = Field(..., description="Memory ID")
    text: str = Field(..., description="Memory text")
    category: str = Field(..., description="Memory category")
    source: str = Field(..., description="Memory source")
    timestamp: int = Field(..., description="Unix timestamp")
    session_id: Optional[str] = Field(default=None, description="Associated session")


# --- Slice 1 response contracts (SPEC Appendix A.1) -------------------------------------
# These document the EXISTING response shapes for the typed frontend client. Every model
# sets `extra="allow"` so FastAPI's response_model never DROPS a field the endpoint already
# returns — the contract is additive/observational, behaviour stays identical (ADR 0001).

class LoginResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    ok: bool = Field(..., description="True when a session was created")
    username: Optional[str] = Field(default=None, description="Authenticated username")
    requires_totp: bool = Field(default=False, description="Password OK but 2FA code needed")


class LogoutResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    ok: bool = True


class AuthStatusResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    authenticated: bool = Field(..., description="Whether the caller has a valid session")
    username: Optional[str] = Field(default=None, description="Current user, null if anonymous")
    is_admin: bool = Field(default=False, description="Whether the user has admin rights")
    signup_enabled: bool = Field(default=False, description="Whether open registration is on")
    privileges: Optional[Any] = Field(default=None, description="Effective privilege set (when authenticated)")


class SessionListItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: str
    model: str
    endpoint_url: Optional[str] = None
    rag: bool = False
    archived: bool = False
    folder: Optional[str] = None
    total_tokens: int = 0
    is_important: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    last_message_at: Optional[str] = None
    has_documents: bool = False
    has_images: bool = False
    mode: Optional[str] = None
    message_count: int = 0
    course_id: Optional[str] = None


class HistoryMessage(BaseModel):
    model_config = ConfigDict(extra="allow")
    role: str
    content: str
    metadata: Optional[Dict[str, Any]] = None


class HistoryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    history: List[HistoryMessage] = Field(default_factory=list)
    model: str
    endpoint_url: Optional[str] = None
    name: str
    course_id: Optional[str] = None


# --- Slice 3 response contracts (Memory + Personal docs / RAG + Embeddings) -------------
# Same observational contract as Slice 1: every model sets `extra="allow"` so the
# response_model documents the existing shape for the typed frontend WITHOUT dropping any
# field the endpoint already returns. Behaviour is unchanged (ADR 0001/0002, SPEC A.1).

class MemoryItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    text: str
    category: str = "fact"
    source: str = "user"
    timestamp: int = 0
    uses: int = 0
    owner: Optional[str] = None
    session_id: Optional[str] = None
    pinned: Optional[bool] = None


class MemoryListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    memory: List[MemoryItem] = Field(default_factory=list)


class MemoryAddResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    ok: bool
    count: int = 0
    message: Optional[str] = None


class MemorySearchResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    memories: List[MemoryItem] = Field(default_factory=list)
    total: int = 0
    query: str = ""


class OkResponse(BaseModel):
    """Generic `{ok, message}` ack used by mutating routes (delete/update)."""
    model_config = ConfigDict(extra="allow")
    ok: bool
    message: Optional[str] = None


class PersonalFile(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str
    size: int = 0
    path: str = ""


class PersonalListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    files: List[PersonalFile] = Field(default_factory=list)
    directories: List[Any] = Field(default_factory=list)


class PersonalUploadResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    success: bool
    uploaded: List[str] = Field(default_factory=list)
    indexed_count: int = 0
    failed_count: int = 0


class PersonalDeleteResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    success: bool
    removed_chunks: int = 0
    deleted_from_disk: bool = False


class EmbeddingModel(BaseModel):
    """One fastembed catalog entry with local download/active status."""
    model_config = ConfigDict(extra="allow")
    model: str
    dim: Optional[int] = None
    size_gb: float = 0
    description: str = ""
    downloaded: bool = False
    downloading: bool = False
    active: bool = False
    recommended: bool = False
    cached_size_mb: Optional[float] = None


class EmbeddingEndpointResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    url: str = ""
    model: str = ""
    active: bool = False


# --- Slice 5 response contracts (Deep Research) ----------------------------------------
# Observational (extra="allow"); fields default/lenient so response validation never 500s on
# a persisted dict with a missing/loosely-typed key (e.g. library `rounds` is int OR "").
# The stream (SSE) and report (HTML) endpoints are NOT typed here — they're hand-written
# helpers / an iframe, outside the OpenAPI client.

class ResearchStartResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    session_id: str
    status: str = "running"
    query: str = ""


class ResearchStatusResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    status: str = "running"
    progress: Dict[str, Any] = Field(default_factory=dict)
    query: str = ""
    started_at: float = 0
    avg_duration: Optional[float] = None


class ResearchLibraryItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    query: str = ""
    category: str = ""
    source_count: int = 0
    status: str = "done"
    duration: str = ""
    rounds: Union[int, str] = ""
    started_at: float = 0
    completed_at: float = 0
    archived: bool = False


class ResearchLibraryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    research: List[ResearchLibraryItem] = Field(default_factory=list)
    total: int = 0


# --- Slice 6.5b response contracts (Notes — KEEP, tutoring core) ------------------------
# note_routes.py isn't frozen, so notes go through the real OpenAPI seam. Observational
# (extra="allow") so the response_model never drops a field _note_to_dict already returns.

class NoteResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    title: str = ""
    content: Optional[str] = None
    items: Optional[List[Any]] = None
    note_type: str = "note"
    color: Optional[str] = None
    label: Optional[str] = None
    pinned: bool = False
    archived: bool = False
    due_date: Optional[str] = None
    sort_order: int = 0
    image_url: Optional[str] = None
    repeat: str = "none"
    # Phase-2 (ADR 0004 / T5 F9): course scoping + provenance, so a summary note
    # lands "in the course" and the UI can tell agent drafts from user notes.
    course_id: Optional[str] = None
    session_id: Optional[str] = None
    source: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class NoteListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    notes: List[NoteResponse] = Field(default_factory=list)


# --- Phase-2 T5 vertical-4 (SPEC F9) — session-summary note ------------------------------
# routes/session_summary_routes.py POSTs {session_id} and gets back a status + the
# drafted Note (or None when the session was too short / no model was configured).

class SessionSummaryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    status: str  # "ok" | "too_short" | "no_llm"
    note: Optional[NoteResponse] = None


# --- Phase-2 T1: courses (ADR 0004) ------------------------------------------------------
# Real OpenAPI seam: course_routes.py is born small + typed, so requests AND responses live
# here. `extra="allow"` keeps the contract additive (no field-drop), like the other slices.

class CourseCreateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: str = Field(..., min_length=1, max_length=200, description="Free-form course name (no fixed catalog)")
    settings: Optional[Dict[str, Any]] = Field(default=None, description="Persona dial / coupling mutes (ADR 0004)")


class CourseUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    settings: Optional[Dict[str, Any]] = None


class CourseResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: str
    status: str = "active"  # active | archived
    owner: Optional[str] = None
    settings: Dict[str, Any] = Field(default_factory=dict)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    archived_at: Optional[str] = None


class CourseListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    courses: List[CourseResponse] = Field(default_factory=list)


class CourseSourcesUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    source_ids: List[str] = Field(default_factory=list, description="Replacement set of linked corpus_source ids")


class CourseSourcesResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    course_id: str
    source_ids: List[str] = Field(default_factory=list)
    # Set when the corpus tables aren't present yet (src/corpus isn't wired into
    # init_db): ids were accepted verbatim, unverified.
    note: Optional[str] = None


# --- Phase-2 T5: todos + dashboard (ADR 0004 §Q12, SPEC F11) -----------------------------
# Real OpenAPI seam: todo_routes.py is born small + typed (mirrors the Course* block).
# `extra="allow"` keeps the contract additive. The dashboard aggregator is read-only and
# degrades per-section (never 500s the landing page) — its lists stay loosely typed.

class TodoCreateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    text: str = Field(..., min_length=1, max_length=2000, description="The todo text (required)")
    course_id: Optional[str] = Field(default=None, description="null = Home / course-less")
    due_date: Optional[str] = Field(default=None, description="ISO date string")


class TodoUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    text: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    course_id: Optional[str] = None
    due_date: Optional[str] = None


class TodoResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    owner: Optional[str] = None
    course_id: Optional[str] = None
    text: str
    due_date: Optional[str] = None
    done_at: Optional[str] = None
    done: bool = False
    source: str = "manual"  # manual | miner | tutor
    provenance: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class TodoListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    todos: List[TodoResponse] = Field(default_factory=list)


class DashboardResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    review_count: int = 0
    weak_spots: List[Dict[str, Any]] = Field(default_factory=list)
    insights: List[Dict[str, Any]] = Field(default_factory=list)
    reading: List[Dict[str, Any]] = Field(default_factory=list)


# --- Phase-2 T2a: corpus library + course materials (SPEC F2, ADR 0003/0004) -------------
# Real OpenAPI seam: corpus_routes.py is born small + typed. `kind` discriminates the
# shared read-only library (owner NULL) from the caller's own materials.

class CorpusSourceItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    kind: str = "library"  # library | material
    title: str = ""
    source_type: str = ""  # textbook|literature|video_transcript|material
    subject: Optional[str] = None
    authors: Optional[str] = None
    status: str = "ready"  # importing|ready|failed|needs_ocr
    course_id: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    has_pdf: bool = False
    chunk_count: int = 0


class CorpusSourceListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    sources: List[CorpusSourceItem] = Field(default_factory=list)


class CorpusTocNode(BaseModel):
    model_config = ConfigDict(extra="allow")
    heading: str
    ordinal: int = 0
    page_start: Optional[int] = None
    children: List["CorpusTocNode"] = Field(default_factory=list)


class CorpusTocResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    source_id: str
    toc: List[CorpusTocNode] = Field(default_factory=list)


class CorpusSearchRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    query: str = Field(..., min_length=1, max_length=2000)
    course_id: Optional[str] = Field(default=None, description="Scope to a course's linked sources + materials")
    tags: Optional[List[str]] = Field(default=None, description="Narrow to sources carrying at least one tag")
    top_k: int = Field(default=6, ge=1, le=25)


class CorpusSearchItem(BaseModel):
    """The typed citation contract (SPEC §5.4) — retrieval returns these, the chat
    stream carries them as the `citations` control event, the UI renders chips."""
    model_config = ConfigDict(extra="allow")
    chunk_id: str
    source_id: str
    title: str = ""
    heading: str = ""
    page_start: Optional[int] = None
    citation: str = ""
    text: str = ""


class CorpusSearchResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    items: List[CorpusSearchItem] = Field(default_factory=list)
    # True when Chroma/embeddings were unavailable and the SQL keyword fallback served
    # the query (the rag_vector degradation contract, surfaced honestly).
    keyword_fallback: bool = False


class CorpusMaterialUploadResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    source: CorpusSourceItem
    created: bool = True  # False = idempotent re-upload (same content hash)
    chunks: int = 0
    needs_ocr: bool = False


class CorpusTagsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    tags: List[str] = Field(default_factory=list, description="Replacement tag list")


# --- Phase-2 T2a: model router (SPEC F7, §5.3d — the third one-door) ---------------------
# The tier table is DATA (data/router.json), these models are its typed mirror.

class RouterPin(BaseModel):
    model_config = ConfigDict(extra="allow")
    endpoint_id: str
    model: Optional[str] = None  # omitted = endpoint's first enabled chat model


class RouterCapability(BaseModel):
    model_config = ConfigDict(extra="allow")
    vision: bool = False
    reasoning: str = "standard"  # micro | light | standard | deep
    context_window: Optional[int] = None
    local: Optional[bool] = None  # override the base_url heuristic


class RouterConfigResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    policy: str = "local_first"  # local_first | quality_first
    pins: Dict[str, RouterPin] = Field(default_factory=dict)
    capabilities: Dict[str, RouterCapability] = Field(default_factory=dict)
    # False = router dormant; every call site transparently uses the legacy
    # default-model chain (current behavior unchanged).
    configured: bool = False


class RouterConfigUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    policy: Optional[str] = None
    pins: Optional[Dict[str, RouterPin]] = None
    capabilities: Optional[Dict[str, RouterCapability]] = None


class RouterResolutionRow(BaseModel):
    model_config = ConfigDict(extra="allow")
    tier: str
    modality: str = "text"
    endpoint_id: Optional[str] = None
    model: Optional[str] = None
    token_budget: int = 0
    why: str = ""
    degraded: bool = False  # nearest-tier / legacy-chain note (no silent degradation)
    error: Optional[str] = None  # vision with no VL candidate (setup hint)


class RouterResolutionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    policy: str = "local_first"
    configured: bool = False
    rows: List[RouterResolutionRow] = Field(default_factory=list)


class RouterLogEntry(BaseModel):
    model_config = ConfigDict(extra="allow")
    ts: float = 0
    profile: Dict[str, Any] = Field(default_factory=dict)
    endpoint_id: Optional[str] = None
    model: str = ""
    why: str = ""


class RouterLogResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    entries: List[RouterLogEntry] = Field(default_factory=list)


# --- Phase-2 T3a: ensemble student-memory graph (SPEC F5/F6, ADR 0005) -------------------
# Real OpenAPI seam: routes/graph_routes.py is born small + typed. `state` is the ONLY
# mastery vocabulary the UI shows (unknown|learning|shaky|mastered — §6 Q2).

class GraphConceptNode(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: str = ""
    state: str = "unknown"  # unknown | learning | shaky | mastered
    p_known: Optional[float] = None  # effective (recency-decayed); None = unknown
    evidence_count: int = 0
    children: List["GraphConceptNode"] = Field(default_factory=list)


class GraphConceptsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    course_id: Optional[str] = None
    concepts: List[GraphConceptNode] = Field(default_factory=list)


class GraphEvidenceItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    signal: str = ""
    weight: float = 1.0
    created_at: Optional[str] = None
    source: Optional[str] = None       # context.source (chat|gym|review|override|…)
    note: Optional[str] = None
    indirect: bool = False             # prerequisite-splash evidence
    episode_ref: Optional[Dict[str, Any]] = None


class GraphAssertionItem(BaseModel):
    """One timeline entry — invalidated assertions ride along with their
    invalidated_at set (the trajectory view: the arc, not just the state)."""
    model_config = ConfigDict(extra="allow")
    id: str
    kind: str = "inferred"             # stated | inferred
    relation: str = ""
    statement: str = ""                # quote (stated) or literal/derived text
    quote: Optional[str] = None        # verbatim — stated only
    confidence: Optional[float] = None  # inferred only
    subject_type: str = ""
    object_type: Optional[str] = None
    object_id: Optional[str] = None
    object_name: Optional[str] = None
    valid_from: Optional[str] = None
    invalidated_at: Optional[str] = None
    invalidation_reason: Optional[str] = None
    episode_refs: List[Dict[str, Any]] = Field(default_factory=list)


class GraphConceptDetailResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    name: str = ""
    heading_path: List[str] = Field(default_factory=list)
    state: str = "unknown"
    p_known: Optional[float] = None
    evidence: List[GraphEvidenceItem] = Field(default_factory=list)
    assertions: List[GraphAssertionItem] = Field(default_factory=list)


class GraphOverrideRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    known: bool  # True -> "I know this" (p=.95); False -> "I never learned this" (p=.05)


class GraphOverrideResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str
    state: str = "unknown"
    p_known: Optional[float] = None
    evidence_count: int = 0


class GraphObservationsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    observations: List[GraphAssertionItem] = Field(default_factory=list)


class GraphChallengeRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    correction: str = Field(..., min_length=1, max_length=2000)


class GraphChallengeResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    invalidated: GraphAssertionItem
    correction: GraphAssertionItem
