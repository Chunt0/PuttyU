# STATUS — live project state

> **The single source of truth for "where is the build".** Updated in the same
> commit as each chunk lands (part of the review ritual). Everything else
> (CLAUDE.md, README, SPEC) states stable truths and points here.

- **Phase:** M0 — foundation & spine, built chunk by chunk (`docs/M0-PLAN.md`)
- **Last completed:** M0.0 — skeleton & green harness (2026-07-01)
- **In progress:** nothing — awaiting owner review / go-ahead for M0.1
- **Next:** M0.1 — auth & first-run (`user` + `auth_session`, bcrypt, signed
  httpOnly cookie + CSRF, setup→login→logout e2e, Gate 5 made real)

## Chunk ledger

| Chunk | Status | Notes |
|---|---|---|
| M0.0 skeleton & green harness | ✅ done | `d06628f` `1e63611` `2f08946` `7a127a7` — app boots, `/api/health` typed end-to-end, 13 gates green locally + CI |
| M0.1 auth & first-run | ⬜ next | |
| M0.2 providers & router v1 | ⬜ | |
| M0.3 the shell, for real | ⬜ | |
| M0.4 sessions & streaming chat | ⬜ | completes M0 (SPEC §9.1) |

## Decisions resolved along the way

- **O7 (wordmark):** "puttyU" — putty-ai type + putty-blob mascot, no tagline
  (locked in `docs/M0-PLAN.md`).
