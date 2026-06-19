# T5 vertical-6 contract — cost meter (F7 router spend observability)

> SPEC F7 "Spend is visible": routing observability shows tokens + estimated cost
> per feature ("deep research: ~$0.40 this week; extraction: local, free") and a
> running cloud-spend estimate. It is a GAUGE, not a bill — calm, honest, clearly
> estimated. Read order: `CLAUDE.md` (the model-router one-door: no call site names
> a model; config is data) → `docs/PHASE-2-BUILD-PLAN.md` §5 → this file. Seams
> verified 2026-06-19. Gates stay green; `.venv/bin/python`; `mkdir -p data`.

Crux resolved by the seam map: `llm_call_async` returns a bare string (usage
discarded in the unary path), so tokens are ESTIMATED for the router's unary
adopters; the router logs at resolve-time (knows the profile, not the tokens) so
capture happens AFTER the call via a new one-door `record_usage()`. The router's
adopters (extractor, session-summary, schedule-miner, practice, research) ARE
exactly the feature calls F7 wants to meter; chat does not route through the router
yet, so no chat/god-file surgery.

---

## 0. Pinned decisions (frozen)

- **D1 — `record_usage()` one-door** in `src/model_router.py` (no change to
  `llm_call_async`'s signature; the resolve log stays as-is):
  `record_usage(profile, routed, *, input_tokens, output_tokens, feature,
  usage_source="estimated", owner=None) -> None`. Computes `est_cost_usd` from the
  rate table (D3); appends one row to `data/router_usage.jsonl` + a bounded
  in-memory deque (mirror `_append_log`/`_recent`/`_log_lock`/rotation ~:330-339,
  :54-55). **Best-effort: never raises** (cost logging must never break a feature).
  Add to `__all__`. Row: `{ts, feature, tier, endpoint_id, model, input_tokens,
  output_tokens, est_cost_usd, usage_source, local, owner}`.
- **D2 — `cost_summary(owner=None, window_days=7) -> dict`** in `src/model_router.py`:
  reads the jsonl, owner-filters, keeps rows within the window, aggregates by
  `feature` → `{window_days, total_cost_usd, by_feature: [{feature, tier,
  input_tokens, output_tokens, est_cost_usd, local, usage_source}]}`. `usage_source`
  per feature = "real" | "estimated" | "mixed".
- **D3 — rates are DATA, never model-name-keyed.** Extend `RouterCapability`
  (`src/request_models.py:564-569`) with optional `cost_in_per_mtok: float|None` +
  `cost_out_per_mtok: float|None` (USD per 1M tokens), and the `RouterConfig.save`
  capability cleaner (`model_router.py:136-142`) to persist them. A `local` endpoint
  → **free** (cost 0, shown "local, free"). A remote endpoint with no rate → a
  fallback `DEFAULT_TIER_RATES` module constant in `model_router.py`
  (micro 0.10/0.30, light 0.30/1.00, standard 1.00/3.00, deep 3.00/15.00 per Mtok
  in/out — clearly an estimate). `cost = in/1e6*rate_in + out/1e6*rate_out`. Rates
  attach to `endpoint_id` (config) or `tier` (fallback), NEVER a model name.
- **D4 — token estimates.** Reuse `src.model_context.estimate_tokens(messages)` for
  input + `len(raw)//4` (or `src.corpus.records.estimate_tokens`) for output;
  `usage_source="estimated"`. (Real usage exists only on the streaming chat path,
  which is not a router adopter — out of scope here.)
- **D5 — wire `record_usage` into the router adopters** (after each `llm_call_async`,
  in a best-effort try/except so it never breaks the feature):
  `src/graph/extractor.py` (`feature="extraction"`), `src/session_summary.py`
  (`feature="session_summary"`), `src/schedule/miner.py` (`feature="schedule_miner"`),
  `src/practice/items.py` (`feature="practice"` — every grading/generation call),
  the research path `routes/research_routes.py`/`src/deep_research.py`
  (`feature="deep_research"`). Each already has `profile`+`routed` from `resolve()`
  and the `messages`+`raw` for the estimate; pass `owner`. **Chat is NOT wired**
  (it doesn't route through the router yet — note as a fast-follow).
- **D6 — route** `GET /api/router/cost?window_days=7` → `RouterCostResponse` in
  `routes/router_routes.py` (mirror `get_log` :71-74; `require_user` owner-scope,
  `response_model`). Models `RouterCostFeature` + `RouterCostResponse` in
  `src/request_models.py` (near the Router models :558-619, `extra="allow"`). Add
  `GET /api/router/cost` to `.fitness/ui-contract-endpoints.txt`; regen the contract.
- **D7 — frontend.** A new **"Spend"** section in `web/src/features/models/Routing.tsx`
  (after Live resolution), mirroring the `.routing-table` pattern: columns
  **Feature | Tokens | Est. cost** + a muted total row. `useRouterCost()` in
  `web/src/features/models/routerApi.ts` (copy `useRouterResolution`); aliases
  `RouterCost`/`RouterCostFeature` in `web/src/api/types.ts`.
- **D8 — calm + honest (the F7 "gauge not a bill" rule).** `local` → render the
  literal "local, free" (NOT "$0.00"). Dollars as `~$0.40` (leading tilde). A
  one-line hint: "Estimated from token counts and list prices — a gauge, not a
  bill." NO alarmist colors (no `--accent`/`--error`/`--green`); muted + `--mono`
  numbers only. Empty: "No cloud spend yet — everything ran locally."

---

## 1. Condensed seam APIs (copy)
- `src/model_router.py`: `TaskProfile` :75, `RoutedModel` :85, `resolve` :192,
  `_finish` log writer :317, `_append_log`/rotation :330-339, `_recent`+lock :54-55,
  `RouterConfig.save` capability cleaner :128-145, `_endpoint_is_local` :176-180,
  `__all__` :383. Add `record_usage` + `cost_summary` + `DEFAULT_TIER_RATES` here.
- Estimator: `src/model_context.py:355 estimate_tokens(messages)`.
- Adopters (the post-call wire points): `src/graph/extractor.py:314-342`,
  `src/session_summary.py:158-180`, `src/schedule/miner.py:~201`,
  `src/practice/items.py` (grading/gen call sites), research path.
- Route: `routes/router_routes.py` (`get_log` :71 is the template; `require_user`).
- Models: `src/request_models.py` Router block :558-619; extend `RouterCapability` :564.
- Frontend: `Routing.tsx` (resolution table :108-139, recent log :202-214),
  `routerApi.ts` (`useRouterResolution` :25 is the template), `types.ts` :52-56,
  `shell.css` `.routing-table` / `.routing-hint` / `--mono`/`--muted`.
- Contract regen: `scripts/openapi-export.py && (cd web && bun run gen:api)`.

## 2. File ownership / phases
- **Phase A — backend (one agent):** `src/model_router.py` (record_usage, cost_summary,
  DEFAULT_TIER_RATES, capability cost-field persistence) + `src/request_models.py`
  (RouterCostFeature/Response + RouterCapability cost fields) + `routes/router_routes.py`
  (GET /cost) + the 5 adopter wirings (best-effort) + app/ui-contract + regen. Tests:
  `tests/test_router_cost.py` (record_usage writes a row + computes cost from per-endpoint
  rate AND the tier default AND local=free; cost_summary aggregates by feature within the
  window, owner-scoped; usage_source real/estimated/mixed; record_usage never raises) +
  assert at least one adopter calls record_usage (e.g. monkeypatch + run the extractor or
  practice grade and see a usage row).
- **Phase B — frontend (one agent):** `routerApi.ts` (useRouterCost) + `types.ts` aliases
  + `Routing.tsx` (Spend section, calm) + `Routing.test.tsx` (vitest) + extend a Playwright
  routing spec.

## 3. Invariant checklist
- [ ] NO model-name literals (rates key on endpoint_id or tier); model selection still only via resolve
- [ ] record_usage best-effort (never breaks a feature); owner threaded; route owner-scoped (require_user)
- [ ] route response_model + GET params (no request.json()) + ui-contract line; regen schema.d.ts
- [ ] estimates clearly labeled; local=free shown as "free"; calm (no alarmist colors); no `any`; no god-file grew
- [ ] config is data (rates in router.json capability / a fallback constant), re-tunable without a deploy
