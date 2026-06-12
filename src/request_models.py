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
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class NoteListResponse(BaseModel):
    model_config = ConfigDict(extra="allow")
    notes: List[NoteResponse] = Field(default_factory=list)
