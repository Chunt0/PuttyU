# STATUS — live project state

> **The single source of truth for "where is the build".** Updated in the same
> commit as each chunk lands (part of the review ritual). Everything else
> (CLAUDE.md, README, SPEC) states stable truths and points here.

- **Phase:** M0 — foundation & spine, built chunk by chunk (`docs/M0-PLAN.md`)
- **Last completed:** M0.3 — the shell, for real (2026-07-02)
- **In progress:** nothing — **STOPPED for the owner's M0.1–M0.3 review**
  (review M0.3 against `docs/M0.3-FIDELITY.md`, side-by-side with
  `ODYSSEUS-REF/`)
- **Next (after sign-off):** M0.4 — sessions & streaming chat (completes M0)

## Chunk ledger

| Chunk | Status | Notes |
|---|---|---|
| M0.0 skeleton & green harness | ✅ done | `d06628f` `1e63611` `2f08946` `7a127a7` — app boots, `/api/health` typed end-to-end, 13 gates green locally + CI |
| M0.1 auth & first-run | ✅ done | `user` + `auth_session`, bcrypt, signed cookie + CSRF middleware, rate-limited login, setup→login→logout e2e, **Gate 5 active** (owner_scoped one-door) |
| M0.2 providers & router v1 | ✅ done | `setting` + `model_endpoint`, `engines/model_router.resolve()` (pins → capability filters → policy → flagged degrade), Fernet keys (never returned), FakeProvider in test mode, Providers screen + live resolution table, vision-absent fails loud |
| M0.3 the shell, for real | ✅ done (pending owner review) | kit ported to ESM (18 themes, pa- components, icons, mascot); dockable window manager (drag/edge-resize/dock+reserve/tiles+ghost/z-order/chips); Cmd-K palette; slash-command composer (Tab-insert, did-you-mean); single Escape arbiter; sidebar rail+resize+sections; 29/33 fidelity boxes ticked (4 await M0.4 streaming) |
| M0.4 sessions & streaming chat | ⬜ | completes M0 (SPEC §9.1) |

## Decisions resolved along the way

- **O7 (wordmark):** "puttyU" — putty-ai type + putty-blob mascot, no tagline
  (locked in `docs/M0-PLAN.md`).
