/**
 * streaming.ts — hand-written, individually-typed helpers for streaming endpoints.
 *
 * Streaming responses (chat/agent/research) are NOT part of the openapi-fetch typed client
 * (SPEC §1.3.5): the OpenAPI schema can't express an SSE event stream. Instead each stream
 * gets a typed helper here, built on the generic `parseSSE` reader below.
 *
 * `streamChat(req): AsyncIterable<ChatEvent>` streams /api/chat_stream. The wire format
 * (confirmed against routes/chat_routes.py) is `data: <json>\n\n` per event, where the
 * json is either `{"delta": "..."}` (a text chunk) or `{"type": "...", ...}` (a control
 * event: model_info, tool_start, tool_output, rag_sources, web_sources, memories_used,
 * compacted, research_*, ...), terminated by the literal `data: [DONE]`.
 */

/** One decoded Server-Sent Event. `event` defaults to "message" per the SSE spec. */
export interface SSEMessage {
  event: string;
  data: string;
  id?: string;
}

/**
 * Parse a `text/event-stream` body into decoded SSE messages. Handles multi-line `data:`,
 * CRLF/LF, and split chunks across reads. Yields once per blank-line-terminated event.
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SSEMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep: number;
      // Events are separated by a blank line (\n\n), tolerate \r\n\r\n.
      while ((sep = indexOfDelimiter(buffer)) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep).replace(/^(\r?\n){2}/, "");
        const msg = decodeEvent(raw);
        if (msg) yield msg;
      }
    }
    const tail = decodeEvent(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function indexOfDelimiter(s: string): number {
  const lf = s.indexOf("\n\n");
  const crlf = s.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

function decodeEvent(raw: string): SSEMessage | null {
  const lines = raw.split(/\r?\n/);
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue; // blank or comment
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }

  if (data.length === 0) return null;
  return { event, data: data.join("\n"), id };
}

// --------------------------------------------------------------------------- //
// streamChat — the typed chat stream (Slice 1).                               //
// --------------------------------------------------------------------------- //

/**
 * Request for POST /api/chat_stream. The endpoint reads multipart form fields, so this is
 * hand-written (it isn't in the OpenAPI client). `mode` selects plain chat vs the agent
 * loop. Optional flags are sent only when set; extend as later slices add capabilities.
 */
export interface ChatStreamRequest {
  message: string;
  session: string;
  mode?: "chat" | "agent";
  use_web?: boolean;
  use_rag?: boolean;
  plan_mode?: boolean;
  incognito?: boolean;
  // Agent-mode tool permissions (default off server-side; agent mode opts in).
  allow_bash?: boolean;
  allow_web_search?: boolean;
  attachments?: string[];
  // Course-grounding fallback (F3): the session is normally course-bound server-side, but
  // sending the active course id makes a course-less session still ground correctly.
  course_id?: string;
}

/** One course-grounding citation (SPEC §5.4 typed contract — CorpusSearchItem on the wire).
 * The chat stream emits the list as a `citations` control event BEFORE token streaming. */
export interface Citation {
  chunk_id: string;
  source_id: string;
  title: string;
  heading: string;
  page_start: number | null;
  citation: string;
}

/** A decoded chat-stream event. `citations` is the course-grounding list for the turn;
 * `control` carries the raw backend object keyed by `event` (its `type`) so screens can
 * react to model_info / tool_start / tool_output / etc. */
export type ChatEvent =
  | { kind: "delta"; text: string }
  | { kind: "citations"; items: Citation[] }
  | { kind: "control"; event: string; payload: Record<string, unknown> }
  | { kind: "done" };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Defensive per-item decode: a malformed entry is dropped, never thrown. */
function decodeCitation(v: unknown): Citation | null {
  if (typeof v !== "object" || v === null) return null;
  const r = v as Record<string, unknown>;
  if (typeof r.source_id !== "string") return null;
  return {
    chunk_id: str(r.chunk_id),
    source_id: r.source_id,
    title: str(r.title),
    heading: str(r.heading),
    page_start: typeof r.page_start === "number" ? r.page_start : null,
    citation: str(r.citation),
  };
}

/** Decode one SSE `data:` payload into a ChatEvent. Returns null for unrecognised/garbage
 * data (defensive: a malformed line must not kill the stream). */
export function decodeChatEvent(data: string): ChatEvent | null {
  if (data === "[DONE]") return { kind: "done" };
  let obj: unknown;
  try {
    obj = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const rec = obj as Record<string, unknown>;
  if (typeof rec.delta === "string") return { kind: "delta", text: rec.delta };
  // {type:"citations", data:[CorpusSearchItem,...]} — typed, not a generic control event.
  if (rec.type === "citations" && Array.isArray(rec.data)) {
    return {
      kind: "citations",
      items: rec.data.map(decodeCitation).filter((c): c is Citation => c !== null),
    };
  }
  if (typeof rec.type === "string") return { kind: "control", event: rec.type, payload: rec };
  // Backend failure events ({"error": "...", "status": 500}) have no `type` —
  // surface them as an "error" control event instead of dropping them.
  if (typeof rec.error === "string") return { kind: "control", event: "error", payload: rec };
  return null;
}

/**
 * Stream a chat turn. Yields `delta` text chunks (append to the transcript), `control`
 * events, and a final `done`. Throws on a non-OK response. Pass an AbortSignal to cancel.
 */
export async function* streamChat(
  req: ChatStreamRequest,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const form = new FormData();
  form.set("message", req.message);
  form.set("session", req.session);
  if (req.mode) form.set("mode", req.mode);
  if (req.course_id) form.set("course_id", req.course_id);
  const flags: Record<string, boolean | undefined> = {
    use_web: req.use_web,
    use_rag: req.use_rag,
    plan_mode: req.plan_mode,
    incognito: req.incognito,
    allow_bash: req.allow_bash,
    allow_web_search: req.allow_web_search,
  };
  for (const [k, v] of Object.entries(flags)) {
    if (v !== undefined) form.set(k, String(v));
  }
  if (req.attachments?.length) form.set("attachments", JSON.stringify(req.attachments));

  const res = await fetch("/api/chat_stream", {
    method: "POST",
    body: form,
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) throw new Error(`chat_stream failed: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("chat_stream returned no body");

  for await (const msg of parseSSE(res.body)) {
    const event = decodeChatEvent(msg.data);
    if (!event) continue;
    yield event;
    if (event.kind === "done") return;
  }
}

// --------------------------------------------------------------------------- //
// streamResearch — the deep-research progress stream (Slice 5).               //
// --------------------------------------------------------------------------- //

/** One decoded progress event from GET /api/research/stream/{id}. Each SSE `data:` payload
 * is a JSON object whose keys vary by `phase`; `final` (or a terminal `status`) ends the run.
 * Shapes confirmed against src/deep_research.py `_emit()`. */
export interface ResearchProgress {
  status?: string; // "running" | "done" | "error" | "cancelled" | "not_found"
  phase?: string; // "planning" | "searching" | "reading" | "analyzing" | "writing" | "warning" | "error"
  message?: string;
  error?: string;
  final?: boolean;
  round?: number;
  title?: string;
  url?: string;
  progress?: number;
  [k: string]: unknown;
}

const RESEARCH_TERMINAL = new Set(["done", "error", "cancelled", "not_found"]);

/** Stream a research job's progress. Yields each `ResearchProgress` until a terminal event
 * (`final: true` or a terminal `status`), then returns. Throws on a non-OK response. */
export async function* streamResearch(
  sessionId: string,
  signal?: AbortSignal,
): AsyncGenerator<ResearchProgress> {
  const res = await fetch(`/api/research/stream/${encodeURIComponent(sessionId)}`, {
    method: "GET",
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) throw new Error(`research stream failed: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("research stream returned no body");

  for await (const msg of parseSSE(res.body)) {
    let obj: ResearchProgress;
    try {
      obj = JSON.parse(msg.data) as ResearchProgress;
    } catch {
      continue; // a malformed line must not kill the stream
    }
    yield obj;
    if (obj.final === true || (typeof obj.status === "string" && RESEARCH_TERMINAL.has(obj.status))) {
      return;
    }
  }
}
