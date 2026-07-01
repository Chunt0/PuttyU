# PuttyU — Threat model

> Self-hosted, single-owner v1 (ADR-0001). This document anchors the
> **untrusted-content invariant** (SPEC §2) and enumerates the security surfaces
> each milestone must respect. New model-read or write surfaces must name their
> handling against this doc.

## Assets (what we protect)

1. **The student graph** (M3+) — the first irreplaceable data this app creates.
2. **Course materials & uploads** (M2+) — the student's own documents.
3. **Provider API keys** — billable, sensitive.
4. **The owner's session / account.**
5. **Availability & integrity** of the local box (no RCE, no data loss).

## Trust boundaries

- **Trusted:** the owner, the owner's browser session, the curated library
  shipped/added by the admin, PuttyU's own code.
- **Untrusted (data, never instructions):** anything the model *reads* —
  retrieved corpus text, user uploads, syllabi, notes, web content (if ever
  enabled), and even the model's own prior output. Treat all of it as data.

## The untrusted-content invariant (the spine rule)

Everything the model reads from user-supplied or fetched content is **untrusted
input**. Every write **derived** from it is a **proposal or evidence the user
confirms** — never a silent action. Concretely:

| Derived write | Surfaced as | Milestone |
|---|---|---|
| Tags on an upload | suggestion → confirm-to-apply | M2 |
| Calendar events / todos from a syllabus | review sheet → bulk-accept/prune/edit | M5 |
| Graph assertions (observations/insights) | visible in Progress, challengeable | M3 |
| Tutor-proposed todos | accept/dismiss, never auto-added | M5 |

The model's text output is rendered, never executed. No corpus/upload/web content
can cause a tool call, a file write, or a state change without the owner's
confirmation.

## Surfaces & mitigations

### S1 — Prompt injection (corpus, uploads, syllabi, web)
- **Risk:** retrieved/ingested content tells the model to ignore instructions,
  exfiltrate, or fabricate citations.
- **Mitigations:** clear instruction/data separation in the prompt (labeled
  source blocks `[S#]`, ADR-aligned); the system prompt forbids inventing `[S#]`
  and instructs honest ungrounded marking; no derived action without confirmation
  (above); the **tutor-eval** gate (Gate 7) tests "never fake a citation / mark
  ungrounded". The shared library is admin-curated (lower risk); **user uploads
  and web are the high-risk inputs** and gate stricter handling as they land.

### S2 — File uploads (M2)
- **Risk:** malicious files, zip bombs, oversized inputs, type confusion.
- **Mitigations:** validate MIME/type allowlist (PDF/image), enforce size limits,
  store outside any executable path, never execute, sanitize filenames, generate
  ids server-side. Vision goes only to a vision-capable model (DESIGN §5).

### S3 — Provider API keys
- **Risk:** key theft from DB, logs, or the client.
- **Mitigations:** Fernet-encrypted at rest (key = `PUTTYU_SECRET_KEY`), or
  env-referenced; **never returned to the client**; redacted from logs/errors.

### S4 — Authentication / session
- **Risk:** brute force, session theft, CSRF.
- **Mitigations:** bcrypt; rate-limited, constant-time login with generic errors;
  signed httpOnly `SameSite=Lax` cookie; `X-PuttyU-CSRF` header on mutations;
  HTTPS expected off-localhost (ADR-0001).

### S5 — Path traversal (serving PDFs / assets)
- **Risk:** client-supplied paths read arbitrary files.
- **Mitigations:** PDFs/assets served **only** by `source_id → stored path`
  lookup; reject any path component from the client; resolve and confirm the path
  is within `PUTTYU_LIBRARY_PATH` / `PUTTYU_DATA_DIR` before serving.

### S6 — XSS / rendering
- **Risk:** corpus/upload/model markdown injects script.
- **Mitigations:** sanitize rendered markdown; KaTeX in safe mode (no arbitrary
  HTML/macros); citation chips built from typed metadata, not raw HTML; React's
  default escaping; a strict CSP.

### S7 — SSRF / network egress
- **Risk:** a user-set provider `base_url` (e.g. Ollama) points at an internal
  service; or any future web-fetch reaches the metadata endpoint / LAN.
- **Mitigations:** **no web access in v1 (M0–M2)** — no deep-research/web-fetch
  surface ships until explicitly specced with SSRF controls. Provider endpoints
  are owner-configured and owner-trusted, but the owner is warned that a base_url
  is an outbound target.

### S8 — Local code execution / dependencies
- **Risk:** supply-chain or an agentic tool running shell.
- **Mitigations:** **no agent/tool execution in v1** (agent mode is later, SPEC
  F3); `engines/agent/` + `engines/tools/` are not built until that milestone. When they
  land, tools run under explicit allowlist + confirmation, specced here first.

### S9 — Runaway cost / provider abuse
- **Risk:** a loop or a malicious input drives unbounded LLM calls → a surprise
  cloud bill (especially deep/vision tiers), or hammers a local model.
- **Mitigations:** per-request and per-day **call/token budgets** in the model
  router; a **max-iterations cap** on any agentic loop (when it lands); the cost
  meter (SPEC F7) surfaces spend; sensible request timeouts. Local-first policy
  keeps background work (extraction) off paid APIs by default.

### S10 — Loss of `PUTTYU_SECRET_KEY`
- **Risk:** the key signs sessions and Fernet-encrypts provider keys at rest; if
  it's lost/rotated, stored provider keys are unreadable and all sessions
  invalidate.
- **Mitigations:** document "back this up" (ADR-0001); on key change, the app
  detects undecryptable keys and prompts the owner to re-enter them rather than
  failing silently.

## v1 decisions (security-relevant)

- **No web access / no agentic tool execution** in M0–M2.
- **Single owner**, no multi-tenant isolation yet (`owner_scoped` is the prepared
  seam; it becomes load-bearing at multi-student — F12).
- **Local-first by default** (router policy): background extraction (M3) never
  leaves the box unless the owner chooses quality-first.

## Out of scope (v1)

Network attacker on a hostile LAN without HTTPS (operator must deploy HTTPS off
localhost); physical access to the box; OS-level hardening.
