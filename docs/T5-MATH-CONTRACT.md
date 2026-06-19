# T5 vertical-7 contract — typed math (F4)

> SPEC F4: a LaTeX-backed equation input beside plain text and the canvas, in chat,
> gym, review, and exams; submitted equations RENDER in the transcript; the third
> input mode (typed / drawn / captured), never raw ASCII math. Read order:
> `CLAUDE.md` (frontend = TS+React19+Vite+Bun, strict, ZERO JS, tokens-only, no CDN
> /no gradients; reading is the medium) → `docs/PHASE-2-BUILD-PLAN.md` §5 → this
> file. Seam-verified 2026-06-19. **Frontend-only — NO backend/contract change**
> (equations are plain text in the existing `answer_text`/`message` fields; the
> grader reads the string unchanged). The load-bearing half is the RENDERER:
> LaTeX does NOT render today (no katex/remark-math in the pipeline).

---

## 0. Pinned decisions (frozen)

- **D1 — add the renderer (self-hosted, no CDN).** `bun add remark-math rehype-katex
  katex` in `web/`. Wire `web/src/components/Markdown.tsx`: add `remarkMath` to
  `remarkPlugins` and `rehypeKatex` to `rehypePlugins` (don't fork the component —
  it's the one shared renderer). Load KaTeX CSS once via `import "katex/dist/katex.min.css"`
  in `web/src/main.tsx` (next to the shell.css import) — **Vite bundles katex's woff2
  fonts from the package as app-origin assets, so it's offline/self-hosted, NOT a CDN.**
  Delimiters: inline `$...$`, block `$$...$$` (remark-math defaults; NOT `\(...\)`).
- **D2 — render user chat turns through Markdown** so a submitted equation renders in
  the transcript. `web/src/features/chat/Message.tsx` currently renders user turns as
  plain `msg-content--plain` text (assistant turns already use `<Markdown>`). Route the
  user branch through `<Markdown>` too (the same XSS-safe renderer — its tests already
  assert raw-HTML/onerror stripping). This is the intentional reversal F4 requires;
  note it in the commit (a real product choice: user text now renders markdown+math).
- **D3 — `web/src/components/MathInput.tsx`** (new) — an "Insert equation" affordance
  mirroring `CameraCapture` (an idle button → an inline panel → returns a value, owns
  no surface state). Props: `{ onInsert: (latex: string) => void; label?: string }`.
  Internals: a LaTeX `<textarea>`/`<input>` + a LIVE PREVIEW rendered through the SAME
  `<Markdown>` (preview === transcript rendering — one door): `<Markdown>{"$$" + latex +
  "$$"}</Markdown>`. Insert → `onInsert("$" + latex.trim() + "$")` (wrap inline; never
  raw ASCII), clear + close. Cancel/Esc closes. Tokens-only `mathinput.css` (or fold
  into shell.css); `role`/`aria-label` for a11y; keyboard-accessible.
- **D4 — mount `<MathInput>` in the 6 answer surfaces** beside the existing
  CameraCapture/attach control, each wiring its own setter (append the returned LaTeX
  into the surface's answer text):
  - chat `Composer.tsx` → `setInput((s) => (s ? s + " " : "") + eq)`
  - `Review.tsx` → `setAnswer(...)`; `Gym.tsx` → `setAnswerText(...)`;
    `Calibration.tsx` (CalibrationItem) → `setText(...)`; `Explain.tsx` → `setInput(...)`
  - `Exam.tsx` (per-item keyed record) → `setText(it.item_key, (answers[it.item_key]?.text ?? "") + " " + eq)`
- **D5 — no backend.** Confirmed: `routes/practice_routes.py`, `src/practice/items.py`
  (`grade_answer`/`_grade_string`/`_grade_llm`), `exam.py`, `gym.py`, chat all take a
  plain string; LaTeX flows to the grader as text. No `response_model`/OpenAPI/route
  change → no contract regen. Do NOT echo the rendered answer into the practice verdict
  in v1 (the MathInput live preview already shows the student their equation) — keep scope tight.
- **D6 — calm + medium.** Reading/typing only (no voice). A LaTeX field with a live
  preview — NOT a heavy WYSIWYG (no mathlive/mathquill); the spec says "LaTeX-backed
  equation field". Tokens-only, sentence-case, no gradients.

---

## 1. Condensed seam APIs (copy)
- Renderer: `web/src/components/Markdown.tsx:38-49` (the plugin arrays). `main.tsx:4-5`
  (the css-import pattern). Self-hosted-fonts precedent: `shell.css:2-6` @font-face;
  highlight.js token-CSS precedent `shell.css:708-716`.
- Affordance pattern: `web/src/components/CameraCapture.tsx` (idle button → panel →
  value); `Switch.tsx` (tiny styled control + stable a11y name).
- Chat render split: `web/src/features/chat/Message.tsx:33-39` (assistant `<Markdown>`
  vs user plain).
- Surfaces + setters (state, textarea onChange, submit field — all `answer_text`):
  `Composer.tsx:23,122`; `Review.tsx:32,86,113`; `Gym.tsx:81,280,~308`;
  `Exam.tsx:106,200,319`; `Calibration.tsx:53,86,101`; `Explain.tsx:52,240`.
- Tests: `web/src/components/components.test.tsx:64-97` (Markdown block — add a
  `$x^2$` → `.katex` case); `CameraCapture.test.tsx` (affordance test pattern).

## 2. File ownership / phase (ONE frontend agent — cohesive, frontend-only)
New: `web/src/components/MathInput.tsx` (+ `mathinput.css` or shell.css rules),
`web/src/components/MathInput.test.tsx`. Edit: `web/package.json` (+ lockfile via
bun add), `web/src/components/Markdown.tsx`, `web/src/main.tsx`,
`web/src/features/chat/Message.tsx`, and the 6 surfaces (Composer, Review, Gym, Exam,
Calibration, Explain). Tests: MathInput.test.tsx; a math case in components.test.tsx;
extend Review.test.tsx + Gym.test.tsx for insert→textarea; a Playwright math-insert
in an existing chat or practice spec.

## 3. Invariant checklist
- [ ] ZERO JavaScript (Gate 6e) — TS/CSS only; katex is a dep, not our code
- [ ] KaTeX CSS+fonts self-hosted via the Vite bundle (NO CDN); tokens-only; no gradients
- [ ] one renderer (Markdown) for transcript + previews; inserts emit `$...$` (never raw ASCII)
- [ ] no `any`; no backend/contract change (no route, no schema.d.ts regen)
- [ ] user chat turns render through the XSS-safe Markdown (raw-HTML still stripped)
- [ ] tsc + eslint clean; vitest + a math e2e green; all 6 gates pass
