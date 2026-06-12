# ADR 0005 — The ensemble student-memory graph

- Status: Accepted (owner delegated decisions, 2026-06-12)
- Related: SPEC-phase-2 v1.0 (F5, F6, §5.2/§5.3b, §6 Q1/Q2/Q6/Q9/Q10), ADR 0003
  (two-store discipline), research survey in SPEC §5 ("Research grounding")

## Context

The tutor needs a living model of the student: what they know (mastery), how
it's trending (trajectory), what they said (observations), and what the tutor
concluded (insights). Owner requirements: ensemble memory (verbatim statements
AND inferred insights), Graphiti-style preservation of interactions over time,
full transparency. Research survey (SPEC §5) settled the semantics: episodes +
bi-temporal assertions (Graphiti), ADD/UPDATE/NOOP reconciliation (Mem0),
event-units-as-atoms (DyG-RAG), BKT-style updates (knowledge tracing),
mandatory consolidation (Anthropic "dreaming" ≙ `memory_extractor` tidy pass).

## Decision

### Storage: Graphiti *semantics* on SQLite (§6 Q9 — build, don't adopt)

Four tables via the existing ad-hoc migration pattern; SQLite stays canonical
(two-store discipline). The Graphiti library (+Kuzu) is rejected for v1: a 5th
data store + an open-world extraction pipeline we'd have to constrain back to
the curriculum vocabulary. **Flip condition:** multi-hop traversal in the
per-turn hot path at ≥10⁵ nodes, or graph analytics as a product feature —
first stop is then Kuzu (embedded), never a server DB.

### Tables

**`concept_node`** — curriculum concepts, **closed-world**: `id` (pk) · `name`
· `normalized_name` · `source_id?` (seeding source) · `heading_path?` (JSON) ·
`owner?` · `meta` (JSON: `sources[]`, tags) · `created_at`.
Seeding (§6 Q1): **structure-only** — chapters/sections → concepts, KEY-TERMS
blocks → leaf concepts, book order → prerequisite assertions. At seed time an
exact `normalized_name` match per owner **reuses** the existing node (appends
to `meta.sources`) — this is what makes cross-course shared nodes (the F6
periphery) real. The extractor classifies onto existing nodes; new-node
proposals are gated through consolidation.

**`entity_node`** — the user's world, **open-world but sparse**: `id` · `name`
· `normalized_name` · `kind?` · `owner?` · `meta` (JSON) · `created_at`.
Writes pass a Mem0-style **ADD / UPDATE / NOOP** reconciliation step (LLM
decides against near-matches) — the anti-rot mechanism.

**`assertion`** — every fact/edge, with provenance and temporal validity:
`id` · `subject_type`/`subject_id` (concept|entity|student) ·
`relation` (small closed enum: `prerequisite_of`, `part_of`, `related_to`,
`likes`, `struggles_with`, `breakthrough_on`, `believes`, `misconception`, …)
· `object_type`/`object_id?` or `literal?` · **`kind`** (`stated` |
`inferred`) · `quote?` (verbatim, stated only) · `confidence?` (inferred only)
· `valid_from` · `invalidated_at?` · `invalidation_reason?` ·
`episode_refs` (JSON — the receipts) · `owner?`.
**Bi-temporal rule: contradiction invalidates, never deletes.** Stated and
inferred are never merged. Every inferred assertion is user-visible and
challengeable (§6 Q10); a challenge invalidates it and records the correction
as a new stated assertion.

**`mastery_evidence`** — append-only: `id` · `concept_id` · `episode_ref` ·
`signal` (`correct` | `partial` | `incorrect` | `hint_used` | `explained` |
`override_known` | `override_unknown`) · `weight` · `context` (JSON: difficulty,
feature source — chat|gym|review|exam|worksheet|calibration) · `owner?` ·
`created_at`.

**`mastery_state`** — a **derived cache**, recomputable from the log:
`concept_id` (pk) · `p_known` (float) · `state` (`unknown` | `learning` |
`shaky` | `mastered` — the only vocabulary the UI shows, §6 Q2; no percentages)
· `last_evidence_at` · `updated_at`. Update rule: BKT-lite —
`p_known' = p_known·(1−slip) or guess`-style Bayesian update per evidence with
fixed v1 params (learn=.2, slip=.1, guess=.2), plus exponential recency decay
applied at read time (half-life 21 days). A `rebuild_mastery()` function
recomputes the whole cache from `mastery_evidence` — run after prompt/param
changes.

### Episodes are references, not a store

`episode_ref` = `{"type": "chat_message"|"upload"|"task_run", "id": ...}`
pointing at existing persisted records. Episodes are immutable receipts.

### The one read door: `src/student_context.py`

`student_context(owner, active_course, call_type, token_budget) → tiered
block` (tiers per SPEC F6: profile → focus → periphery → ambient; degrade
bottom-up). Periphery = other active courses' regions reachable from focus
nodes (shared nodes first, then 1-hop assertions), ≤1 line per coupled course,
capped ≈15% of budget, honoring `course.settings.coupling_mutes`. No call
site reads graph tables directly — fitness-checked once call sites exist.

### Writes: background extraction + consolidation

After-turn extraction (the `memory_extractor.py` pattern; router tier=light,
structured output): evidence signals + assertion candidates → reconciliation
→ persist → event bus. A scheduled **consolidation action** (tidy-pass
pattern) merges duplicate nodes, invalidates contradicted assertions, decays
stale confidences, and processes gated new-concept proposals.

### Progress UI (§6 Q6)

A state-colored concept **tree/list** (by heading_path), not a node-graph
render. Tapping a node shows its evidence + assertion timeline (including
invalidated ones — the trajectory view).

## Rejected alternatives

- **Graphiti library + Kuzu** — 5th store, open-world extraction to constrain;
  semantics adopted instead (see flip condition above).
- **Server graph DB (Neo4j/Memgraph)** — ops burden absurd at single-user scale.
- **Files-only memory (Anthropic-style)** — right for open-ended memory, wrong
  for the curriculum-anchored queries (periphery, due-selection, readiness)
  this product computes; the existing JSON memory system remains for
  non-graph durable facts.

## Consequences

- Tutoring quality rests on extraction quality → Gate-7 tutor evals (SPEC
  §5.7) ship alongside, informational first.
- All four tables carry `owner?` — multi-student (Gate 5) needs no rework.
- The graph is the first irreplaceable data in the app → the backup seam
  (SPEC F12 @later) gains priority right after Phase-2 core.
