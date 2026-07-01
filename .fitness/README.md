# .fitness — the mechanical gate harness (ADR-0002)

Invariants here are **gates, not conventions**: an agent forgets conventions
across sessions but cannot bypass a failing build.

Run everything: `bash .fitness/run-all.sh`. CI runs the same script.

| Gate | Script | Status |
|---|---|---|
| 1 typed OpenAPI contract | `contract.sh` | blocking |
| 2 pytest | `pytest.sh` | blocking (`quarantine` marker → excluded) |
| 3a bun test | `web-test.sh` | blocking |
| 3b Playwright e2e | `e2e.sh` | blocking |
| 4 tsc strict + eslint + no-`any`-in-api | `types-lint.sh` | blocking |
| 5 `owner_scoped` one-door | `owner-scoped.sh` | self-arming stub (blocks from M1) |
| 6a file-size ceiling (400) | `file-size.sh` | blocking |
| 6b `response_model=` on routes | `response-model.sh` | blocking (`# gate6b-exempt: <reason>` for SSE) |
| 6c no raw `request.json()` | `no-raw-json.sh` | blocking |
| 6d no cross-feature imports | `cross-feature.sh` | blocking |
| 6e TS-only under `web/` | `ts-only.sh` | blocking |
| 6f graph one-door | `graph-one-door.sh` | self-arming stub (blocks from M3) |
| 6g model-router one-door | `router-one-door.sh` | blocking |
| 7 tutor evals | *(not here)* | on-demand vs a configured model, never CI |

Rules (ADR-0002): gates are added, not waived; `allowlists/` shrink, never
grow; every gate is cheap and deterministic.
