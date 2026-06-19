# T6b contract — the canvas workspace (F4)

> SPEC F4 (~lines 491-552, decision Q15): a Pointer-Events draw surface (mouse /
> drawing pad / stylus w/ pressure), templates (blank/ruled/grid/coordinate axes),
> pen/eraser/undo/clear; opens from the chat composer, a gym problem, the worksheet
> view, or as a standalone tool window; ONE-CLICK "send to tutor" submits as an
> image through the SAME path as photos; revise→resubmit = distinct attempts;
> persist as PNG (+ stroke-JSON sidecar → reopen editable). Read order: `CLAUDE.md`
> (tokens-only, no gradients, ZERO JS, calm; reading is the medium) →
> `docs/PHASE-2-BUILD-PLAN.md` §6 → this file. **Frontend-only — NO backend change**
> (PNG rides the existing `/api/upload` + `/api/corpus/materials`). Seam-verified
> 2026-06-19. The "send to tutor" door is a clean copy of CameraCapture
> (canvas → toBlob PNG → File → `onAccept` → `uploadFiles`).

---

## 0. Pinned decisions (frozen)

- **D1 — `web/src/features/canvas/`**: `canvas.model.ts` (pure, DOM-free, unit-tested),
  `Canvas.tsx` (the surface + toolbar), `canvas.css` (tokens only), `canvasStore.ts`
  (cross-window opener, mirror `gymStore.ts`/`pdfStore.ts`), `Canvas.test.tsx`.
- **D2 — one stroke model** (so undo + the future sidecar + reopen all fall out of one
  array): `Point {x:number; y:number; p:number}`; `Stroke {points:Point[]; color:string;
  width:number; erase:boolean}`; `CanvasDoc {template: Template; strokes: Stroke[];
  width:number; height:number}`. `canvas.model.ts` exports a PURE `repaint(ctx, doc)`
  that (a) paints the template background, (b) replays every stroke, (c) eraser strokes
  via `ctx.globalCompositeOperation = "destination-out"` (kept in the stack — do NOT
  erase by clearing pixels, or undo/reopen break). Plus pure `drawTemplate(ctx, template,
  w, h)`. The bitmap is DERIVED from `strokes`, so undo = `strokes.pop()` + repaint,
  clear = `strokes=[]` + repaint.
- **D3 — Pointer Events** (plain `<canvas>`, Q15): `onPointerDown` → `el.setPointerCapture(
  e.pointerId)` + start a `Stroke` with the current tool/color/width; `onPointerMove` →
  push `{x,y,p: e.pressure || 0.5}` (mice report pressure 0 → default 0.5) + redraw the
  live stroke; `onPointerUp` → commit. Stroke width modulated by pressure
  (`width * (0.4 + 0.6*p)`). NO per-device branches (the whole point of the SPEC scenario).
  Map client coords to canvas coords via `getBoundingClientRect` (+ devicePixelRatio for
  crispness).
- **D4 — toolbar** (tokens-only, calm): a template `<select>` (blank / ruled / grid /
  coordinate axes), pen, eraser, undo, clear, and a small palette (≤3 token-based colors;
  default `var(--accent)` ink), plus the "Send to tutor" CTA. Coordinate-axes template
  matters (most math work starts with axes).
- **D5 — "Send to tutor" door** (the reason the feature exists): `canvasRef.toBlob((blob)
  => onAccept([new File([blob], "canvas-<n>.png", {type:"image/png"})]), "image/png")`.
  The Canvas component takes `onAccept?: (files: File[]) => void` — the EXACT CameraCapture
  prop. Revise→resubmit falls out: each `onAccept` is just the next attachment.
- **D6 — mount inline as a third image input** beside `<CameraCapture>`/`<MathInput>` in:
  chat `Composer.tsx`, `Gym.tsx`, `Worksheet.tsx` — each `onAccept={(files) => addFiles/
  addPhotos(files)}`. (Like CameraCapture, the canvas opens its own inline panel.)
- **D7 — standalone tool window**: register in `web/src/app/windows/tools.tsx`
  (`{ key: "canvas", title: "Canvas", node: <Canvas /> }`, visible — a blank canvas is
  useful standalone, unlike the hidden pdf/miner). `canvasStore.openCanvas()` for
  programmatic open. In standalone mode (no `onAccept`), offer "Save to course materials"
  via the existing `useUploadMaterial()` (`features/library/api.ts`) scoped to the active
  course — the PNG lands in the library. Gate that action on an active course.
- **D8 — v1 persistence cut.** PNG-as-attachment (send to tutor) + PNG save-to-materials
  (flat) are v1. The **stroke-JSON sidecar → reopen-EDITABLE** is an explicit FOLLOW-UP
  (needs new backend: a sidecar field on the material + a strokes reader) — note it; the
  in-memory stroke model already supports undo/clear, so the follow-up is additive.
- **D9 — no secure context needed** (`toBlob`/Pointer Events work over plain HTTP, unlike
  getUserMedia) — the canvas has NO "needs HTTPS" hint (that's a CameraCapture-only
  concern). Untrusted-content: the canvas PNG rides the identical upload→VL path photos
  do; document_processor untouched.

---

## 1. Condensed seam APIs (copy)
- The door pattern: `web/src/components/CameraCapture.tsx:91-113` (canvas→toBlob→File→onAccept;
  `onAccept` prop `:3-9`). Upload: `uploadFiles` (`features/chat/attachments.ts:17`).
- Consumers (mount points + their addFiles): `Composer.tsx:30-41,79-82`; `Gym.tsx:145-156,
  309-345`; `Worksheet.tsx` (addPhotos + the actions row). Each already turns File[] → ids.
- Opener store templates: `features/practice/gymStore.ts`, `features/library/pdfStore.ts`;
  window open: `app/windows/windowStore.ts:76`; registry `app/windows/tools.tsx`.
- Save-to-materials: `useUploadMaterial()` (`features/library/api.ts:54-67`) → POST
  `/api/corpus/materials` (multipart files + course_id). Active course: `useCourseStore`.
- Tokens: `shell.css` `:root`. Test patterns: `CameraCapture.test.tsx` (getContext + toBlob
  mocks `:16-21`, accept assertion `:66-71`); `e2e/windows.spec.ts` + `e2e/gym.spec.ts`.

## 2. File ownership / phase (ONE frontend agent — cohesive, frontend-only)
New: `web/src/features/canvas/{canvas.model.ts, Canvas.tsx, canvas.css, canvasStore.ts,
Canvas.test.tsx}`. Edit: `web/src/features/chat/Composer.tsx`, `web/src/features/practice/
Gym.tsx`, `web/src/features/worksheet/Worksheet.tsx` (mount inline), `web/src/app/windows/
tools.tsx` (register). Tests: `canvas.model` pure tests (repaint order / undo / clear /
eraser-composite); `Canvas.test.tsx` (stub getContext + toBlob like CameraCapture.test;
pointerdown/move/up → a stroke entered the model; pressure flows; "Send to tutor" → onAccept
called with one PNG File); a Playwright `web/e2e/canvas.spec.ts` (open canvas → mouse draw →
send → mock /api/upload → the next turn carries the id → graded path, mirror gym.spec).

## 3. Invariant checklist
- [ ] ZERO JavaScript (Gate 6e) — TS/CSS only; no `any`; tokens-only (no hex, no gradients)
- [ ] "send to tutor" = the EXACT CameraCapture onAccept(File[]) door → existing upload path; no new submit path, no backend change
- [ ] eraser = destination-out stroke kept in the stack (undo/clear derive from the stroke array)
- [ ] no per-device branches (Pointer Events + e.pressure); no secure-context gate
- [ ] calm; registered as a visible tool window; inline on composer/gym/worksheet
- [ ] stroke-sidecar reopen-editable is a NOTED follow-up (v1 = PNG attachment + flat save)
- [ ] tsc + eslint clean; vitest (model + component) + a canvas e2e; all 6 gates pass
