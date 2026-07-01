# PuttyU root task runner — executable documentation.
# Commands live HERE; CLAUDE.md / README point here. Keep targets thin:
# real logic belongs in .fitness/ or the package scripts, not in make.

.PHONY: dev-backend dev-web gates contract test-backend test-web e2e

dev-backend: ## FastAPI on PUTTYU_HOST:PUTTYU_PORT (default 127.0.0.1:7000)
	cd backend && uv run python app.py

dev-web: ## Vite dev server (proxies /api to the backend)
	cd web && bun run dev

gates: ## every deterministic gate (ADR-0002) — the same entrypoint CI runs
	bash .fitness/run-all.sh

contract: ## regenerate the typed contract after any UI-consumed route change
	cd backend && uv run python scripts/openapi-export.py
	cd web && bun run gen:api

test-backend:
	cd backend && uv run pytest -q -m "not quarantine"

test-web:
	cd web && bun test src

e2e:
	cd web && bunx playwright test
