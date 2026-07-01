# LEARNING SCIENCE — best practices for tutoring & resources to optimize PuttyU

> Distilled from the `resources/` learning-analytics lecture library (82 lectures
> across 9 clusters, surveyed by parallel subagents). This is a **companion to
> `SPEC.md`** — it turns the science into concrete, citeable recommendations and a
> punch-list of SPEC/ADR edits (§ "SPEC updates"). Every recommendation maps to a
> feature (F1–F12) or milestone (M0–M6).
>
> Provenance: a curriculum from the Penn Center for Learning Analytics / educational
> data-mining community (Baker, Adjei, Botelho, Li, Mogessie, Chen, Bowers, Chan,
> Leite, Ocumpaugh). Cited by cluster throughout.

---

## 0. The headline

PuttyU's instincts are well-aligned with the field — and the library makes three
of them **concrete and defensible**, while adding rigor we were missing:

1. **Mastery has a standard, interpretable algorithm: Bayesian Knowledge Tracing
   (BKT).** Our "BKT-lite" should be real BKT, per-concept, with published
   safety constraints. (Cluster A — Baker)
2. **"Calm, not gamified" is not just taste — it's evidence-based.** The viz
   research is emphatic that social comparison/leaderboards *harm* mastery-oriented
   learners. Our design rule is validated. (Cluster I — Ocumpaugh)
3. **One architectural decision underwrites everything: an append-only,
   timestamped, leakage-safe evidence log.** It makes mastery reconstructable,
   the graph bi-temporal, and any future model honest. (Clusters A, D, E, H)

And it raises the bar on **how we prove the tutor works** (validity + causal
inference + evaluation methodology) — which upgrades Gate 7 from a vibe-check into
a real measurement instrument. (Clusters C, F/H)

---

## 1. Ten cross-cutting principles

1. **Performance ≠ knowledge.** A right answer can be a guess; a wrong one a slip.
   Infer mastery from the *pattern over time*, never a single observation. (A)
2. **Tightly-defined knowledge components (KCs).** Mastery is tracked per
   *narrow* skill ("two-digit addition, no carry"), not per broad domain. KC
   definition is the deepest failure mode if done badly. (A, B)
3. **Seed structure from the textbook, validate against behavior.** Expert/text
   ordering is a *hypothesis* (a low-confidence "insight"), confirmed or refuted by
   student performance. (B)
4. **Append-only evidence, derived features.** Store raw immutable events; compute
   every feature in a deterministic, `as_of`-gated transform that can only see
   events *before* the moment it predicts. (D, E)
5. **Spacing beats massing.** Long-term retention needs expanding-interval review,
   modeled by forgetting/half-life — separate from, and complementary to, mastery
   tracing. (A)
6. **Every estimate is a measurement; every insight is a claim.** Both need
   validity evidence (convergent + discriminant) and must be challengeable. (F/H)
7. **"Did it help?" is causal.** Usage logs can't prove efficacy — design for it
   (randomized rollouts) or control confounding explicitly; beware regression to
   the mean and differential attrition. (F/H)
8. **Don't fool yourself when modeling.** Student-level cross-validation, a fixed
   multi-metric bundle, and must-beat baselines — or your numbers lie. (C)
9. **Visualize to act, not to rank.** Prescriptive ("review §4.2") over comparative
   ("you're below average"); categorical state over false-precision percentages;
   show what you *don't* know. (I)
10. **Trajectories are sequences.** Model study as an ordered sequence of states;
    transitions, entropy, and frequent paths reveal strategy and "what's next". (Chen)

---

## 2. Per-domain distillation → PuttyU

### 2.1 Mastery modeling — implement real BKT (Cluster A, Baker) · M3

**Adopt BKT as the per-concept mastery engine.** Each concept node carries four
parameters and a per-student latent `P(L)`:

- `P(L0)` prior known · `P(T)` learn-per-opportunity · `P(G)` guess · `P(S)` slip.
- Predict: `P(correct) = P(L)·(1−S) + (1−P(L))·G`.
- Update on **correct**: `P(L|c) = P(L)(1−S) / [P(L)(1−S) + (1−P(L))G]`;
  on **wrong**: `P(L|w) = P(L)S / [P(L)S + (1−P(L))(1−G)]`;
  then learn: `P(L) ← P(L|obs) + (1−P(L|obs))·P(T)`.
- **Degeneracy constraints (ship these):** clamp `P(G) < 0.3`, `P(S) < 0.1`
  (Corbett-Anderson); at minimum each `< 0.5`. Unbounded fits produce the absurd
  "got it right → mastery dropped." Bounding barely costs accuracy.
- **Defaults to seed:** `L0≈0.3, T≈0.1, G≈0.2, S≈0.1`; seed `L0` higher when a
  course's prior/placement suggests it.
- **Classical simplifications (fine for v1):** first attempt per item only; one KC
  per item; no forgetting. **But log every attempt** so we can adopt a variant later.
- **Map `P(L)` → the 4 UI states**: e.g. `<0.4` unknown/weak · `0.4–0.7` learning ·
  `0.7–0.95` shaky→solid · `≥0.95` mastered (stop drilling at mastered).
- **Multi-KC items:** decompose into single-KC steps (preferred); keep **PFA/LKT**
  (`P=σ(β + Σ γ·successes + ρ·failures)`) as an optional second engine for items
  that genuinely tag several KCs.
- **DKT is permanently out** (RNN/LSTM): needs large cross-student data PuttyU
  will never have (permanently single-student — SPEC §2), is uninterpretable and
  swing-prone, and adds little after ~2 practices.
- **Elo** is a lightweight online per-item difficulty estimator if we want adaptive
  item selection without full IRT. Classical IRT assumes *no learning* → wrong for a tutor.

### 2.2 The concept / prerequisite graph (Cluster B, Adjei) · M3, F5/F6

- **Node = KC, edge = directed prerequisite.** Forward traversal = "what's next";
  backward traversal = "why am I failing this" (remediation).
- **Seed from textbook structure** (chapters/sections = coarse KCs, key terms =
  leaf KCs, preface/ordering = initial edges) — free, high-quality expert structure
  already in our library. **Mark seeded edges as low-confidence `inferred`**, not
  `observation` — this is exactly PuttyU's stated-vs-inferred distinction.
- **Q-matrix layer:** tag every worksheet/Gym/exam item with its KC(s). Without
  item→KC tags there is no knowledge tracing.
- **Validate edges by correctness-covariance:** items sharing a KC should co-vary
  in correctness; score mappings with BIC/AIC/cross-validation; flag edges the data
  contradicts; **split/merge nodes** as fit demands (graph must be mutable).
- **Cross-course transfer (F6):** because KCs (not courses) are nodes, a shared KC
  links course regions — mastery proven in Calculus pre-populates evidence in
  Physics. Periphery = downstream KCs reachable from the focus frontier.
- **Data-light bootstrap:** induce candidate edges from chapter/section *text* via
  the model router; promote to validated only once performance data accrues.

### 2.3 Learning trajectories & "what's next" (Cluster Chen) · F5, F8, F11

- **Model a study session as a SPELL sequence** `(student, activity, begin, end,
  state)` over a controlled state alphabet: `read · ask · practice · review ·
  worksheet · explain-back · stuck · idle · mastered`.
- **Surface from it:** an index-plot timeline (Progress UI), a **transition matrix**
  ("students usually go X→Y"; flag anomalies like repeated `practice→idle` =
  disengagement), and **entropy/turbulence** as coachable signals (low entropy =
  stuck in one mode; high turbulence = flailing).
- **Next-step = frequent *sequence* mining (cSPADE-style), order matters** — "did A
  then B → succeeded", ranked by lift (with adequate support). Use orderless
  **association rules** (support/confidence/lift) for "concepts studied together →
  co-surface material". Don't optimize only for the popular path (support hides the
  meaningful long tail; lift>1 with low support can still matter).
- **Concept-graph centrality:** **betweenness** flags *gatekeeper* concepts —
  master these to unlock the most downstream material → high-value next steps.
- Python equivalents fit our stack: `pandas` (SPELL wrangling), `prefixspan`/`spmf`/
  `mlxtend` (rules/sequences), `networkx` (graph) — no R needed.

### 2.4 Practice & scheduling (Cluster A) · M4, F8

- **Review queue = forgetting model, not just decay.** Implement **half-life
  regression** (Duolingo/FSRS-style): predict recall + memory half-life from cheap
  features (time-since-last-seen, #seen, #correct, #incorrect, item difficulty);
  schedule the next review at the predicted half-life with **expanding intervals**
  (Leitner boxes). This is independent of BKT and complementary.
- **Weakness-first selection (Gym):** pick KCs with lowest `P(L)`; stop drilling at
  `P(L)≥0.95`. Exam-sim samples across KCs weighted by mastery + exam scope.

### 2.5 Honest insights & valid measurement (Cluster F/H — Chan) · M3, F5, Gate 7

- **Treat each mastery estimate as a measurement** needing **convergent** evidence
  (graph mastery tracks worksheet/exam performance) and **discriminant** evidence
  (a "fractions" node must *not* be driven by reading load / UI familiarity —
  construct-irrelevant variance). Run a periodic discriminant check.
- **Every inferred insight carries:** a `confidence` score (by evidence
  quantity/recency), **the observations it rests on** (citations, like RAG), and a
  **"challenge this" affordance** that demotes/retracts it. The student is a
  first-class validity check.
- **Respect nesting** (course/cohort) when aggregating — correlated observations
  aren't independent.

### 2.6 Proving it works — evaluation & causal rigor (Clusters C + F/H) · Gate 7, post-M5

**Model-evaluation discipline (Botelho) — bake into Gate 7** *(scoped for a
permanently single-student product in ADR-0002 / SPEC O10: v1 = behavioral
scenarios + κ on owner-graded samples; the fuller bundle only where labeled data
exists)*:
- **Student-level cross-validation** (all of a student's rows in one fold). Row-level
  splits with multi-row-per-student data silently inflate "new-student" performance
  — the single most likely way our numbers could lie.
- **Frozen, version-pinned held-out eval set**, never used for prompt/model tuning;
  touched once.
- **Fixed metric bundle, not accuracy:** `AUC` (discrimination) + `RMSE`
  (calibration) + **Cohen's κ** (agreement above chance — *exactly* right for
  "does the grader agree with a human rater?") + `recall`. Accuracy lies under the
  class imbalance typical of mastery/at-risk labels.
- **Must-beat baselines declared up front:** majority-class and per-concept
  average-correctness. A 98%-accurate model can be useless.
- Watch the **train-vs-eval gap** as an overfitting alarm; **correct for multiple
  testing** across the many sub-checks (Benjamini-Hochberg).

**Efficacy / "did it help?" (Leite) — post-M5, design now:**
- Prefer **randomized feature rollout** (A/B) — self-selection *is* the confounding
  threat. Where impossible, ship a **propensity-weighting** pipeline (always include
  a pre-test covariate; prove covariate balance; run an omitted-variable sensitivity
  analysis). Exploit natural cutoffs (e.g. "below X → Gym") as **regression
  discontinuity** (report a Local ATE at the cutoff, not platform-wide).
- **Heterogeneity pass:** the average hides subgroups some features *harm* — flag
  them before shipping broadly.

### 2.7 The data layer (Clusters D + E) · M0/M1, M3

- **Log interaction events from day one** (append-only, immutable, UTC, single
  timestamp format): `student_id, course_id, concept_id(s), item_id, item_type,
  event_type (attempt|hint|chat_turn|worksheet|review), is_correct, attempt_number,
  num_hints, response_latency_ms, time_on_task, difficulty, session_id, source,
  timestamp`. Store **raw, un-normalized**; a JSON payload column absorbs extra detail.
- **Derive features in a separate deterministic layer**, keyed by `(student,
  concept, as_of_timestamp)`, computable only from events strictly *before*
  `as_of`. This one choice delivers pipeline discipline + leakage-safety + a
  reconstructable bi-temporal graph in a single stroke.
- **Feature hygiene:** `log1p` time-on-task & counts (right-skewed, zero-inflated);
  binarize "used a hint at all"; quantile-bin latency; **z-score per feature** for
  model inputs but **fit scaler params on training data only** (persist them) and
  decide deliberately between global vs **per-student** normalization (per-student
  baselines stop a fast/slow learner from looking like high/low mastery);
  ordinal features (difficulty, hint-level) keep order — don't one-hot them; hash
  high-cardinality categoricals as the item/skill space grows.
- **Storage (Mogessie):** keep the relational SQLite spine + normalized linked
  tables; use **SQLAlchemy ORM** (eases a future Postgres move); **mastery/skill
  estimates as time-stamped rows, not in-place updates** (the "salaries table"
  pattern → trajectory is queryable for free); prefer **nullable `to_ts`** over
  sentinel dates; **stream/paginate** over the corpus/log, never load all into
  memory; offer **CSV/JSON import-export**, and consider **xAPI/Caliper**
  (actor-verb-object) event envelopes for interaction logs to ease future LMS
  interop. (The library covers no ed-data standards itself — this is a gap to fill.)

### 2.8 Clustering (Cluster G, Bowers) · now for content, later for learners

- **Now, single-student safe:** cluster **corpus-chunk / concept embeddings**
  (cosine similarity = Bowers's recommended "uncentered correlation") to detect
  near-duplicate chunks, group material into concept families, and **seed
  concept-graph nodes** data-drivenly (M1→M3). Cluster a student's **error/skill
  patterns** (z-scored, rows=attempts) to surface recurring misconceptions; a
  concept×session heat-map (red/blue, **white=missing**) is a strong Progress-UI
  artifact.
- **Not applicable to PuttyU** (permanently single-student — SPEC §2); kept for
  science completeness: learner-profile clustering needs a population — prefer
  **latent class/profile analysis (LCA/LPA)** over k-means when you need defensible
  "real distinct types" with significance; HCA heat-maps for exploration. Always
  z-score; prefer average linkage (missing-data robust); keep it deterministic.
- **Caution:** clusters are descriptive, not truth; *k* is arbitrary; cherry-picking
  features manufactures spurious clusters (p-hacking); never cluster on your
  prediction target (leakage).

### 2.9 Visualization for Progress UI & Dashboard (Cluster I, Ocumpaugh) · M3, M5

- **Mastery state = 4 distinct categorical colors** (unknown/learning/shaky/
  mastered), **never a percentage or progress bar** (false precision + "score"
  feel). Pair color with **shape/icon/label** (color-vision accessibility). Reserve
  **coral `--accent` for attention/action** ("review due"), never for a state, so
  attention and state never collide.
- **Trajectory = a per-concept state-timeline / step band** (color advances over
  time) — shows direction of travel without a comparative axis to misread. If a
  sparkline is used, anchor the axis honestly (no truncation).
- **Momentum = prescriptive narrative**, not a tally/streak: "you solidified
  integration by parts — revisit limits", with a tiny state-change chip.
- **NO social comparison / class averages / leaderboards** — the research is
  emphatic they harm mastery-oriented learners. This *validates* our hard rule.
- **Show what you don't know** ("blank box": a calm "needs investigation" /
  question-mark state) so sparse data doesn't read as false confidence
  (streetlight effect).
- **Be prescriptive > predictive > descriptive**; only show data the student can
  act on; flag-and-filter rather than flood; prefer natural frequencies ("9 of 10")
  over conditional-probability framing.

---

## 3. SPEC updates (the punch-list this doc feeds)

> **Status: APPLIED (2026-06).** All ten items below are folded into
> SPEC / ADR-0002 / ADR-0003 / ADR-0004 / DESIGN-SYSTEM. Kept for provenance —
> **do not re-apply.**

1. **§13 / ADR-0005 (M3 mastery):** change "BKT-lite" → **real per-concept BKT**
   with the four params, the update equations, and the **degeneracy clamps
   (`P(G)<0.3, P(S)<0.1`)** as a hard requirement. Note PFA/LKT as the multi-KC
   fallback and DKT as deferred.
2. **ADR-0004 (data model):** add an **`interaction_event`** table (append-only,
   the field list in §2.7) and state the **mastery-as-time-stamped-rows** +
   **`as_of`-gated feature-derivation** rule. Add **SQLAlchemy ORM** explicitly.
3. **ADR-0003 / DESIGN:** add **embedding-based clustering** as the data-driven
   way to seed concept families/nodes; note CSV/JSON import-export and xAPI/Caliper
   as a considered import format.
4. **F5 (ensemble graph):** add the **Q-matrix (item→KC tagging)** requirement and
   the **correctness-covariance edge validation** + node split/merge; insights get
   an explicit **`confidence` + supporting-observations + challenge** contract
   (already partly present — make it concrete).
5. **F8 (practice):** specify the **half-life-regression review scheduler** with
   expanding intervals; weakness-first by lowest `P(L)`; stop at `≥0.95`.
6. **F5/F11 (trajectory & momentum):** add the **SPELL-sequence model**, transition
   matrix, entropy/turbulence signals, and **frequent-sequence-mining "what's
   next"**.
7. **Gate 7 (tutor evals) — upgrade in ADR-0002 + SPEC §7:** require **student-level
   CV**, a **frozen held-out set**, the **AUC+RMSE+κ+recall** bundle, **must-beat
   baselines**, multiple-testing correction, and a train-vs-eval-gap alarm.
   Add **κ for worksheet-grading agreement** specifically.
8. **New §/ADR (post-M5): efficacy evaluation** — randomized rollout first;
   propensity/RDD/HTE for observational claims; the confounding/regression-to-mean/
   attrition cautions.
9. **§6 + DESIGN-SYSTEM (viz):** add the concrete dashboard rules from §2.9
   (categorical state colors + shape, coral=attention-only, state-timeline
   trajectory, prescriptive momentum, no social comparison, blank-box for unknowns,
   natural frequencies). Reserve specific `--chart-1..4` as the fixed mastery-state
   legend.
10. **Validity framing (M3):** add convergent/discriminant validity checks for the
    mastery model and the construct-irrelevant-variance guard.

---

## 4. Reading map — which resources back which feature

| PuttyU area | Use these clusters |
|---|---|
| Mastery model (M3) | **Knowledge Tracing** (Baker 1–6) |
| Concept/prereq graph (F5/F6, M3) | **Knowledge Graphs** (Adjei 1–5) |
| Practice scheduling (F8, M4) | KT Part 6 (memory/forgetting) |
| Trajectory / what's next (F5/F8/F11) | **Bodong Chen** (sequence/assoc/network) |
| Data layer & evidence log (M0/M1/M3) | **Haiying Li** (feature eng) + **Mogessie** (DB) |
| Model evaluation / Gate 7 | **Botelho** (eval methodology + metrics) |
| Honest insights & validity (F5, M3) | **Wendy Chan** (validity) |
| "Does it help?" efficacy (post-M5) | **Walter Leite** (causal/PSA/RDD/HTE) |
| Seeding concepts / misconception patterns | **Bowers** (cluster analysis) |
| Progress UI & Dashboard viz (M3/M5) | **Ocumpaugh** (data viz) |

---

## 5. Data gaps in the library (flagged by the survey)

Some lecture directories are **empty** (no transcript) — re-fetch if wanted:
- `Part-5-Convolutional-Neural-Networks-…-Botelho` (CNNs — uncovered).
- `Data-and-Measurement-Validity-Part-4-External-Validity-…-Chan` (external
  validity covered only indirectly via Leite).
- `Data-Visualization-Part-A / D / H` (the three `VER-2` dirs — intro + viz
  principles partly uncovered).
- The two Mogessie series (`Data-Management-and-Database-Access-*` and
  `Part-N-Dr-Michael-Mogessie-*`) are **near-duplicate re-recordings** of one
  module — not two topics.

These gaps don't block any recommendation above; the covered material is sufficient.
