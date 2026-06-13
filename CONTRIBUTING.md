# Contributing to puttyU

Thanks for helping. The project is moving quickly, so the best contributions are focused, easy to review, and easy to test.

## Branch model

puttyU has two branches:

- **`dev`** — where all PRs land. Things can be in flux here; the merge button gets used freely.
- **`main`** — what users run. Curated and tested by the maintainer. Fast-forwarded to a stable `dev` commit at each release.

**Open your PR against `dev`, not `main`.** The GitHub "base" dropdown defaults to `dev`. If you opened a PR against `main` by accident, click "Edit" on the PR and change the base — no rebase needed.

End-users cloning the repo will land on `dev` by default. To run the curated/stable version: `git checkout main` after clone.

## Before You Start

- Search existing issues and pull requests before opening a new one.
- Prefer one bug fix or feature per pull request.
- Avoid broad rewrites, formatting-only changes, or moving many files unless the issue is specifically about structure.
- If you want to work on a large feature, open an issue first and describe the approach.

## Setup

Docker is the recommended path for normal testing:

```bash
git clone https://github.com/Chunt0/PuttyU.git
cd puttyu
cp .env.example .env
docker compose up -d --build
```

Manual development uses Python 3.11+ for the backend and Bun for the frontend:

```bash
# backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
mkdir -p data
python -m uvicorn app:app --host 127.0.0.1 --port 7000

# frontend (separate terminal)
cd web && bun install && bun run dev
```

**Ubuntu Linux only.** Windows/macOS are not supported targets (`core/platform_compat.py`
is POSIX-collapsed; do not reintroduce cross-OS branches). Docker on Linux is the
safest path for normal testing.

## Running checks

puttyU's invariants are **mechanical gates**, not conventions (ADR 0002). A change
that adds a feature should add the test/contract/gate that keeps it honest. Run the
smallest relevant checks for your change; for anything non-trivial, run them all:

```bash
# backend tests (data/ must exist) — blocking in CI
mkdir -p data && .venv/bin/python -m pytest -q -m "not quarantine"

# frontend types, lint, unit, e2e
cd web && bunx tsc --noEmit && bun run lint && bun run test && bun run e2e

# the six bash fitness functions (file-size, response_model, raw-json,
# cross-feature imports, no-javascript, graph one-door)
bash .fitness/run-all.sh

# regenerate the typed OpenAPI contract after ANY UI-consumed route change
# (CI fails on drift)
python scripts/openapi-export.py && cd web && bun run gen:api
```

For Docker-related changes:

```bash
docker compose config
docker compose up -d --build
docker compose logs --tail=120 puttyu
```

Mention what you ran in the pull request description. If you could not run a check,
say so.

## Pull Requests

Good pull requests usually include:

- A short explanation of the bug or feature.
- The files or areas changed.
- Manual test steps or automated test results from running the actual app, not just the test suite.
- Screenshots or short recordings for UI changes.
- Links to related issues, for example `Fixes #123`.

Please keep PRs small. Large PRs that mix unrelated cleanup, formatting, refactors, and behavior changes are much harder to review.

> **Auto-generated PRs.** If you are running an LLM agent (Devin, Cursor, OpenHands, Claude Code, etc.) against this repo: please open an issue describing the problem first instead of opening a PR directly. Bulk agent-generated PRs that don't match the project's visual style or contribution format will be closed without review, even when the underlying fix is correct.

## Style and visual changes

puttyU has an intentional visual style (the **putty-ai-design** kit). PRs that
ignore it will be closed without merge, no matter how correct the underlying code
is.

Before submitting any change that affects what the app looks like — buttons, icons,
fonts, colors, spacing, layout, CSS, or any React component in `web/src/` that draws
to the DOM — please:

1. **Run the app locally** (`cd web && bun run dev`) and view the change in a
   browser. Type-checks and unit tests are not enough.
2. **Attach a screenshot or short clip** of the change in the running app. Add a
   mobile screenshot too if the change affects mobile.
3. **Match the existing visual language.** Specifically:
   - Use design tokens — `var(--token)` from `web/src/app/shell.css :root`. **Never
     hardcode hex values, font sizes, or spacing units.** This is what lets all 18
     themes re-skin everything.
   - **Coral `#e06c75` is the only accent.** No gradients. Sentence-case headings.
   - Reuse existing button, input, card, and shared components (`Markdown`,
     `ConfirmButton`, `toast`, `Spinner`, …). Don't invent parallel widgets.
   - **No emoji as UI.** Use inline SVG (matching the monochrome icon style) or
     plain text.
   - Type is **Inter** for UI text and **Fira Code** for mono/code. Don't override.
   - Theme work goes through the theme system (`web/src/app/themes.css` +
     `ThemePicker`), never hard-coded colors.
4. **TypeScript only.** New `.js/.jsx/.mjs/.cjs` files fail Gate 6e. No `any` in
   `web/src/api`.
5. **Don't add parallel components.** If a similar widget already exists, extend it
   instead of writing a new one.

If you are unsure whether a change is "visual," it is. Default to attaching a screenshot.

## Issue Reports

For bugs, include:

- Install method: Docker, manual Python, WSL, etc.
- OS, browser, and device if relevant.
- Exact steps to reproduce.
- Expected behavior and actual behavior.
- Logs, screenshots, or terminal output.

For model-serving issues, include:

- Backend: Ollama, vLLM, SGLang, llama.cpp, LM Studio, etc.
- Model name.
- GPU/CPU and operating system.
- Cookbook task logs or server logs.

Issues with only "help", "does not work", or a screenshot without context may be closed as not actionable.

## Security

Do not post secrets, API keys, private logs, personal documents, or public IPs in issues or pull requests.

For security reports, follow [SECURITY.md](SECURITY.md).

