# ADR-0001 — Foundation & authentication

- **Status:** Accepted (2026-06-19)
- **Context:** PuttyU is a fresh-start rebuild (see `SPEC.md`). This ADR freezes
  the platform foundation and the v1 authentication model so every later ADR and
  milestone builds on a fixed base.

## Decision

### Stack

- **Backend:** Python 3.11+, FastAPI + Uvicorn (async). It carries the agent /
  LLM / corpus / embedding work where the ecosystem lives. No rewrite to another
  runtime.
- **Frontend:** React 19 + TypeScript (`strict`), Vite 6, toolchain **Bun**
  (package manager + test runner). **Zero JavaScript** in the end state — configs
  included (`.ts`). Enforced by Gate 6e (ADR-0002).
- **Contract:** the only frontend↔backend seam is the generated OpenAPI client
  (ADR-0002, Gate 1). The frontend never hand-writes request/response types.
- **Platform:** Ubuntu Linux only. No cross-OS branches; no Windows/macOS shims.
- **Single process.** v1 assumes one process, one box, one user. SQLite +
  embedded Chroma (ADR-0003), no external services required to run.

### Authentication (v1: single owner)

PuttyU v1 has exactly one human: the **owner**, who is also the **student**
(SPEC §3). Auth is built so multi-student is a later seam, not a v1 feature.

- **One `user` row = the owner.** All user data is scoped to it via
  `owner_scoped` (ADR-0002 Gate 5, ADR-0004). The table supports many rows; v1
  creates one.
- **First-run setup.** If no `user` exists, the app serves a setup screen
  (`POST /api/auth/setup`) that creates the owner with a chosen password. After
  that, setup is closed.
- **Password:** stored as a **bcrypt** hash. Never stored or logged in plaintext.
- **Session:** a **signed, httpOnly, SameSite=Lax** cookie carrying an opaque
  session id; server-side session store (DB or signed token). HTTPS expected in
  any non-localhost deployment.
- **CSRF:** cookie-auth mutations require a custom header (`X-PuttyU-CSRF`) the
  SPA sets; combined with SameSite=Lax this covers the single-user LAN case.
- **Login hardening:** rate-limit failed logins; constant-time compare; generic
  error messages (THREAT_MODEL.md).
- **2FA / TOTP:** deferred (seam noted, not built in v1).

### Configuration & secrets

- **Env prefix `PUTTYU_*`** only (no legacy fallbacks). A committed
  `.env.example` documents every variable. Key ones:
  - `PUTTYU_SECRET_KEY` — signs sessions and encrypts secrets at rest (Fernet).
    **Back it up:** if lost/changed, stored provider keys become unreadable and
    all sessions invalidate; the app should detect undecryptable keys and prompt
    re-entry rather than fail silently (THREAT_MODEL S10).
  - `PUTTYU_LIBRARY_PATH` — absolute path to the content library (default
    `./textbooks`). The library is **not** in git (SPEC §5.2).
  - `PUTTYU_DATA_DIR` — where `app.db`, `data/chroma/`, uploads, and JSON
    sidecars live (default `./backend/data`).
  - `PUTTYU_DB_URL` — defaults to SQLite at `${PUTTYU_DATA_DIR}/app.db`.
- **Provider API keys** (Anthropic, etc.) entered via the Providers screen are
  **encrypted at rest** (Fernet, key = `PUTTYU_SECRET_KEY`) before DB storage, or
  referenced from an env var by name. Never returned to the client in plaintext.
- **HTTP headers** use the `X-PuttyU-*` namespace; Chroma collections are
  `puttyu_*`; the systemd unit is `puttyu.service`.

### Running

- **Dev:** backend `uvicorn app:app --reload` (with `PUTTYU_DATA_DIR` present);
  frontend `cd web && bun install && bun run dev` (Vite proxies `/api` to the
  backend).
- **Prod:** a single-container `docker-compose` (app + embedded Chroma in-process,
  no separate vector server). The library path is bind-mounted.

## Consequences

- A trivially simple auth surface (one account) keeps M0 small while
  `owner_scoped` keeps the multi-student door open at zero present cost.
- Embedded everything (SQLite + Chroma in-process) means "clone, set two env
  vars, run" — matching the "start slow / no extra servers" stance that also
  drove the memory-engine decision (SPEC §13.1).
- Linux-only and single-process are real limits, accepted for v1.

## Alternatives considered

- **No auth (localhost only).** Rejected: the box may be on a LAN; the owner's
  graph and materials are sensitive; auth is cheap.
- **JWT in localStorage.** Rejected: httpOnly cookies resist XSS token theft.
- **Stateless app, keys in env only.** Rejected for UX: the Providers screen
  needs to add/rotate keys at runtime; encrypted-at-rest in DB supports that.
