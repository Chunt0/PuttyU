"""
src/practice — the practice item engine (Phase-2 T4a, SPEC F8 + F1 calibration).

One item machinery, four doors:
  review      — the daily queue (push): due-by-decay selection, exam-aware
  gym         — student-pulled sets: weakness-first, adaptive difficulty
  calibration — F1's optional graph warm-up (ordinal walk, skip/step rules)
  exam        — timed mixed-topic simulation, silent until the debrief
  explain     — explain-it-back chat sessions (curious-student persona)

Submodules:
  store       — data/practice_keys.json: short-TTL server-side grading keys
                (reference answers NEVER serialize to the client)
  items       — due_concepts / item_for_concept / grade_answer (the core)
  gym         — adaptive next-item picker + coach's pick
  calibration — ordinal walk plan + skip-ahead/step-down state machine
  exam        — scope-weighted assembly + submit/debrief
  explain     — explain session creation + the chat persona injection hook
  schemas     — the typed request/response models for routes/practice_routes
                (here, not src/request_models.py, which sits near its Gate-6a
                file-size ceiling)

Graph access goes EXCLUSIVELY through src/graph public API (queries, mastery)
— Gate 6f keeps this package out of the graph tables.
"""
