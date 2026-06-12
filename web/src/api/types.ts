/** Handy aliases for generated schema types so features don't reach into `components`. */
import type { components } from "./schema";

export type AuthStatus = components["schemas"]["AuthStatusResponse"];
export type LoginResponse = components["schemas"]["LoginResponse"];
export type Session = components["schemas"]["SessionListItem"];
export type SessionResponse = components["schemas"]["SessionResponse"];
export type HistoryResponse = components["schemas"]["HistoryResponse"];
export type HistoryMessage = components["schemas"]["HistoryMessage"];

// Slice 3 — memory + personal docs / RAG + embeddings
export type MemoryItem = components["schemas"]["MemoryItem"];
export type MemoryListResponse = components["schemas"]["MemoryListResponse"];
export type MemoryAddResponse = components["schemas"]["MemoryAddResponse"];
export type MemorySearchResponse = components["schemas"]["MemorySearchResponse"];
export type PersonalFile = components["schemas"]["PersonalFile"];
export type PersonalListResponse = components["schemas"]["PersonalListResponse"];
export type PersonalUploadResponse = components["schemas"]["PersonalUploadResponse"];
export type EmbeddingModel = components["schemas"]["EmbeddingModel"];
export type EmbeddingEndpointResponse = components["schemas"]["EmbeddingEndpointResponse"];

// Slice 5 — deep research
export type ResearchStartResponse = components["schemas"]["ResearchStartResponse"];
export type ResearchStatusResponse = components["schemas"]["ResearchStatusResponse"];
export type ResearchLibraryItem = components["schemas"]["ResearchLibraryItem"];
export type ResearchLibraryResponse = components["schemas"]["ResearchLibraryResponse"];

// Slice 6.5b — notes
export type Note = components["schemas"]["NoteResponse"];

// Phase-2 T1 — courses (ADR 0004)
export type Course = components["schemas"]["CourseResponse"];
export type CourseSources = components["schemas"]["CourseSourcesResponse"];
