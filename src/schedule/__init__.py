"""
src/schedule — the schedule miner (Phase-2 T5 vertical-2, SPEC F2).

A schedule-shaped upload (syllabus, homework sheet) → router structured
extraction → PROPOSED calendar events + todos in a confirm-first review sheet.

The untrusted-content invariant is the product rule here: everything the model
reads from the material is untrusted, so `miner.mine()` WRITES NOTHING — it only
proposes. `miner.apply()` is the only writer, and only the user-confirmed,
unambiguous items it is handed.

Submodules:
  miner    — the engine: mine() (read-only diff against existing miner rows) +
             apply() (the only writer; idempotent update-in-place by proposal_key)
  schemas  — the typed request/response models for routes/schedule_routes (here,
             not src/request_models.py, which sits near its Gate-6a ceiling)
"""
