# DESIGN SYSTEM — the putty-ai-design kit (authoritative)

> PuttyU's frontend is built on the **putty-ai-design** kit, the owner's design
> template. This doc makes it the source of truth and maps it into `web/`. It
> supersedes the placeholder design language previously in SPEC §6.

- **Status:** Accepted (2026-06-19)
- **Kit location:** `putty-ai-design/` (currently **gitignored** — a design
  working dir / reference, as in OLD-REF). The pieces we ship are **copied into
  `web/`** (committed); the kit stays as the canonical reference.
- **Provenance:** the kit is a TypeScript/React recreation of the same workspace
  whose UI/UX we replicate (its themes are lifted from the Odysseus source app).
  So "use the Odysseus UI/UX" and "use this kit" are the same instruction.

## Identity (the rules — from `putty-ai-design/SKILL.md`)

- **Near-greyscale canvas.** Ink `#0e0e10`; panels lift lighter (`#1b1c1f`,
  `#252629`); near-white text `#eaeaec`, white headings; grey borders `#313338`.
- **Coral is the single accent.** `--accent #e06c75` for buttons, links, focus,
  active nav/toggles, and the mascot. **One hue.** Text-on-coral uses
  `--accent-solid #c2454f` (AA ≈ 4.6:1); icon-only coral fills use bright
  `--accent`. Components read `var(--accent-solid, var(--accent))`.
- **Type:** **Inter** (UI) + **Fira Code** (mono / brand voice), self-hosted
  woff2. **Sentence case** everywhere.
- **Texture:** faint white **dot-grid** + soft white radial glows. **Borders over
  shadows.**
- **Icons:** Feather/Lucide line icons (stroke 2, round caps).
- **Don't:** emoji-as-UI, colored/SaaS gradients, title-case headings, or a
  non-grey canvas. Let the coral be the only color.

## Tokens

Canonical token set: `putty-ai-design/preview/_tokens.css` (mirrored in
`ui_kits/putty-app/kit.css`). Categories (CSS custom properties on `:root`):

- **Surfaces:** `--bg --bg2 --panel --panel2 --surface-3`
- **Text:** `--fg --heading --muted --faint`
- **Accent:** `--accent --accent2 --on-accent --focus --accent-solid
  --accent-solid-hover --accent-solid-press`
- **Brand:** `--brand-putty --brand-putty2`
- **Semantic:** `--green --gold --error` (+ `--*-bg` tints)
- **Charts:** `--chart-1..6 --chart-grid --chart-axis`
- **Radii:** `--radius-sm 4 / --radius 8 / --radius-lg 10 / --radius-xl 18 /
  --radius-pill 999`
- **Shadows:** `--shadow-sm --shadow-md`
- **Fonts / motion:** `--font-sans --font-mono --ease-brand`

Component CSS reads `var(--token)` only — **never hardcoded hex** — so themes
re-skin everything.

## Themes

- **16 built-in themes + `putty`** (mono house brand), e.g. Original/dark, light,
  midnight, paper, cyberpunk, retrowave, forest, ocean, ume, copper, terminal,
  organs, lavender, gpt, claude, cute.
- **Mechanism:** `themes.css` holds the fully-derived token set per theme as
  `[data-theme="<key>"]` blocks; `themes.ts` is the typed registry (each theme = 5
  base colors `bg/fg/panel/border/accent` → derived set, plus `meta` for the
  background pattern). Apply by setting `data-theme` on `<html>`.
- **Switcher:** persisted (Zustand `useThemeStore` → `localStorage`); set
  `data-theme-switching` on `<html>` for one frame during a switch so transitions
  don't stick mid-fade.

## Components

- **`pa-`-prefixed library**, `components.css` is the **single source of truth**.
- `controls.tsx`: `Button, Field, Input, Textarea, Select, Checkbox, Radio,
  Switch, Badge, Avatar, AvatarStack, PAIcons`.
- `overlays.tsx`: `Menu, Modal, Toast, Tooltip, Alert`.
- `data.tsx`: `Tabs, Segment, Table, Pagination, EmptyState, Skeleton, Progress,
  Legend, BarChart, LineChart, Donut`.
- **Chat shell** (reference implementation): `Sidebar, Composer, Messages,
  Login, App` + `Components.html` (full showcase).
- **Mascot:** `assets/putty-blob.svg` — the single coral pop in a monochrome UI.

## Adoption into `web/` (at M0)

1. **Fonts** → `web/public/fonts/` (Inter + Fira Code woff2); `@font-face` in the
   global stylesheet.
2. **Tokens** → `web/src/app/tokens.css` (from `preview/_tokens.css`).
3. **Themes** → `web/src/app/themes.css` + `web/src/app/themes.ts` (the registry);
   `ThemePicker` + `useThemeStore` drive `data-theme` on `<html>`.
4. **Mascot / assets** → `web/public/`.
5. **Component library** → port `pa-` primitives from the kit's
   Babel-in-browser `window.*` pattern to **real ESM** modules under
   `web/src/components/`, keeping `components.css` as the styling source of truth.
   Types and structure port directly (README §Notes).
6. **Shell** → build the Odysseus-style shell from the kit's `Sidebar` /
   `Composer` / `Messages` / `Login` / `App`, **adapting the Tools list** to
   PuttyU's surfaces (course tabs, Library, Progress, Practice, Notes, Calendar,
   Settings — not Odysseus's email/cookbook/gallery).

**Coverage:** the kit covers M0's UI almost entirely (shell + primitives +
overlays + theming). PuttyU-net-new surfaces (library browser, PDF viewer, course
tabs, citation chips, Progress tree, practice surfaces, canvas) are **built from
the kit's primitives and tokens** — never off-system.

The web-side gates apply to the port: TypeScript only (Gate 6e), `tsc` strict,
no `any` in `web/src/api`; component styles stay token-driven.

## Visualization rules (learning-science)

For the Progress UI (M3) and Dashboard (M5), the data-viz research
(`docs/LEARNING-SCIENCE.md` §2.9, Ocumpaugh) sets hard rules — they reinforce the
"calm, not gamified" product rule:

- **Mastery = categorical state, never a percentage or progress bar.** Reserve a
  fixed legend (`--chart-1..4`) for the four states (unknown / learning / shaky /
  mastered); **pair color with shape/icon/label** (color-vision accessibility,
  never color alone).
- **Coral `--accent` = attention/action only** ("review due"), never a mastery
  state — so attention and state never collide.
- **Trajectory = a per-concept state-timeline / step band** (color advances over
  time); no comparative y-axis. If a sparkline is used, **anchor the axis honestly**
  (never truncate to exaggerate).
- **Momentum = prescriptive narrative** ("you solidified integration by parts —
  revisit limits"), not a tally/streak.
- **No social comparison** — no class averages, peer ranking, or leaderboards
  (the research is emphatic these harm mastery-oriented learners).
- **Show what we don't know** — a calm "needs investigation" / blank-box state for
  sparse data, so the UI doesn't read as false confidence.
- Prefer **natural frequencies** ("9 of 10") over conditional-probability framing;
  flag-and-filter rather than flood; show only data the student can act on.

## Brand reconciliation

The kit is branded **`putty-ai`** ("Soft. Local. Yours."); the product is
**PuttyU** ("your patient tutor"). **Default:** PuttyU is a product in the
putty-ai family — keep the **putty-blob mascot** and the full monochrome+coral
visual identity; product **wordmark = "puttyU"** in the kit's type; product
tagline is open (the owner dropped a header slogan earlier). This is the only
open design decision (SPEC §13 O7) and affects only the Login + sidebar brand
header at M0.
