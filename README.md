# PuttyU

> *"putty university — your patient tutor."* A self-hosted AI **tutoring
> workspace**: a curated textbook/classics **library** as a grounded source of
> truth (answers cite the page), a per-student **memory graph** that tracks what
> you know over time, course-scoped study, practice, and an Odysseus-grade,
> typesafe UI. Single-student in v1.

## Status

**M0 (foundation & spine) is underway** — built in small, reviewed chunks with
a mechanical gate harness (typed OpenAPI contract, tests, structural checks)
green at every step, locally and in CI. Live state: [`docs/STATUS.md`](./docs/STATUS.md).

## Where to start reading

- **Building it (agents & contributors): start with [`CLAUDE.md`](./CLAUDE.md)** —
  the orientation, working rules, and read order.
- **The vision & plan:** [`SPEC.md`](./SPEC.md), then [`docs/`](./docs) (ADRs,
  the M0 plan, design system, learning-science, tutor-prompt architecture) and
  [`THREAT_MODEL.md`](./THREAT_MODEL.md).

## Stack (target)

Python / FastAPI backend · React 19 + TypeScript + Vite frontend (toolchain Bun) ·
SQLite + embedded ChromaDB · a model router over Anthropic (Claude) + local
Ollama. Typed end-to-end via a generated OpenAPI client. Linux, self-hosted.

## Local content (not in git)

`textbooks/` (the library), `resources/` (learning-science lectures),
`putty-ai-design/` (the design kit), and the `OLD-REF/` / `ODYSSEUS-REF/`
reference projects are **gitignored, local-only** knowledge bases — they're mined
during the build, never committed.

## License

TBD. Bundled content keeps its own licenses (OpenStax: CC BY-NC-SA; Project
Gutenberg: public domain) — relevant only if ever redistributed.
