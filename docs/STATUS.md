# STATUS — live project state

> **The single source of truth for "where is the build".** Updated in the same
> commit as each chunk lands (part of the review ritual). Everything else
> (CLAUDE.md, README, SPEC) states stable truths and points here.

- **Phase:** M0 — foundation & spine, built chunk by chunk (`docs/M0-PLAN.md`)
- **Last completed:** M0.1 — auth & first-run (2026-07-02)
- **In progress:** M0.2 — providers & router v1 (owner authorized building
  through M0.3 without per-chunk pauses; full review after M0.3)
- **Next:** M0.2, then M0.3 (fidelity checklist: `docs/M0.3-FIDELITY.md`)

## Chunk ledger

| Chunk | Status | Notes |
|---|---|---|
| M0.0 skeleton & green harness | ✅ done | `d06628f` `1e63611` `2f08946` `7a127a7` — app boots, `/api/health` typed end-to-end, 13 gates green locally + CI |
| M0.1 auth & first-run | ✅ done | `user` + `auth_session`, bcrypt, signed cookie + CSRF middleware, rate-limited login, setup→login→logout e2e, **Gate 5 active** (owner_scoped one-door) |
| M0.2 providers & router v1 | 🔨 in progress | |
| M0.3 the shell, for real | ⬜ | fidelity checklist written (`docs/M0.3-FIDELITY.md`, O12) |
| M0.4 sessions & streaming chat | ⬜ | completes M0 (SPEC §9.1) |

## Decisions resolved along the way

- **O7 (wordmark):** "puttyU" — putty-ai type + putty-blob mascot, no tagline
  (locked in `docs/M0-PLAN.md`).
