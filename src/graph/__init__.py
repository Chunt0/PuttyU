"""
src/graph — the ensemble student-memory graph (Phase-2 T3a, ADR 0005).

One temporal graph per student: concept nodes (curriculum, closed-world) and
entity nodes (the user's world, open-world but sparse), connected by assertions
that carry provenance (stated | inferred) and temporal validity. Episodes are
references to existing persisted records, never a store.

Submodules:
  models        — the four tables + mastery_state cache (ensure_graph_tables)
  seeding       — corpus structure -> course region (concepts + prereq edges)
  mastery       — BKT-lite evidence engine + read-time recency decay
  extractor     — after-turn background extraction (memory_extractor pattern)
  consolidation — the scheduled tidy pass (merge dupes, decay stale insights)

The ONE read door for prompts is src/student_context.py (fitness-checked):
no call site outside this package + that module + routes/graph_routes.py may
query the graph tables directly.
"""
