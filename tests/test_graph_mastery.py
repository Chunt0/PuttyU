"""Phase-2 T3a (ADR 0005) — the BKT-lite mastery engine: signal mapping,
state thresholds, the-user-outranks overrides, read-time recency decay,
prerequisite splash, rebuild-from-log, and the F5 'graph survives being
wrong' degradation scenario."""

from datetime import timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from src.graph import mastery
from src.graph.models import (
    Assertion, MasteryEvidence, MasteryState, ensure_graph_tables, new_id,
    utcnow,
)


@pytest.fixture
def db(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path/'g.db'}")
    ensure_graph_tables(bind=engine)
    sess = sessionmaker(bind=engine)()
    yield sess
    sess.close()


def _prereq(db, a, b):
    """a prerequisite_of b."""
    db.add(Assertion(id=new_id(), subject_type="concept", subject_id=a,
                     relation="prerequisite_of", object_type="concept",
                     object_id=b, kind="inferred", confidence=0.5))
    db.commit()


# ---------------------------------------------------------------- pure math

def test_unknown_is_absence_of_evidence_not_zero():
    assert mastery.state_of(None) == ("unknown", None)


def test_two_corrects_reach_mastered_from_prior(db):
    s = mastery.apply_evidence("c1", "correct", db=db)
    assert s.p_known > mastery.P_INIT
    s = mastery.apply_evidence("c1", "correct", db=db)
    assert s.p_known >= mastery.MASTERED_MIN
    assert mastery.state_of(db.get(MasteryState, "c1"))[0] == "mastered"
    assert db.query(MasteryEvidence).filter_by(concept_id="c1").count() == 2


def test_signal_ordering_partial_half_hint_small():
    base = 0.5
    correct = mastery.apply_signal(base, "correct")
    partial = mastery.apply_signal(base, "partial")
    incorrect = mastery.apply_signal(base, "incorrect")
    hint = mastery.apply_signal(base, "hint_used")
    explained = mastery.apply_signal(base, "explained")
    assert correct > partial > base          # partial = half-weight positive
    assert incorrect < hint < base           # hint = small negative
    assert explained == correct
    # partial is exactly the half-step
    assert partial == pytest.approx(base + 0.5 * (correct - base))


def test_overrides_set_p_and_append_evidence(db):
    s = mastery.apply_evidence("c1", "override_known", db=db,
                               context={"source": "override"})
    assert s.p_known == mastery.OVERRIDE_KNOWN_P
    assert mastery.state_of(db.get(MasteryState, "c1"))[0] == "mastered"
    s = mastery.apply_evidence("c1", "override_unknown", db=db)
    assert s.p_known == mastery.OVERRIDE_UNKNOWN_P
    assert mastery.state_of(db.get(MasteryState, "c1"))[0] == "learning"
    # overrides are evidence too — the log keeps both receipts
    signals = [e.signal for e in db.query(MasteryEvidence)
               .filter_by(concept_id="c1").order_by(MasteryEvidence.created_at).all()]
    assert signals == ["override_known", "override_unknown"]


def test_unknown_signal_rejected(db):
    with pytest.raises(ValueError):
        mastery.apply_evidence("c1", "vibes", db=db)


# ---------------------------------------------- F5: the graph survives being wrong

def test_mastered_degrades_within_same_session_on_repeated_errors(db):
    mastery.apply_evidence("z", "override_known", db=db)   # believed mastered
    assert mastery.state_of(db.get(MasteryState, "z"))[0] == "mastered"
    states = []
    for _ in range(4):
        mastery.apply_evidence("z", "incorrect", db=db)
        states.append(mastery.state_of(db.get(MasteryState, "z"))[0])
    # degrades toward shaky/learning with the new evidence — no decay needed
    assert "shaky" in states or "learning" in states
    assert states[-1] in ("shaky", "learning")
    # the old override evidence is still in the log (append-only, never edited)
    assert db.query(MasteryEvidence).filter_by(
        concept_id="z", signal="override_known").count() == 1


# ---------------------------------------------------------------- recency decay

def test_effective_p_decays_toward_half_with_21d_half_life():
    now = utcnow()
    p = 0.9
    e21 = mastery.effective_p(p, now - timedelta(days=21), now)
    assert e21 == pytest.approx(0.5 + (p - 0.5) * 0.5)     # one half-life
    e42 = mastery.effective_p(p, now - timedelta(days=42), now)
    assert e42 == pytest.approx(0.5 + (p - 0.5) * 0.25)
    assert mastery.effective_p(p, now, now) == pytest.approx(p)
    assert mastery.effective_p(p, None) == p


def test_stale_mastery_reads_as_shaky_not_learning(db):
    mastery.apply_evidence("c1", "override_known", db=db)
    row = db.get(MasteryState, "c1")
    now = utcnow() + timedelta(days=40)
    state, ep = mastery.state_of(row, now)
    assert state == "shaky"          # decayed out of mastered…
    assert ep < mastery.MASTERED_MIN
    # …but decay alone never drops below the 0.5 center into "learning"
    state_late, _ = mastery.state_of(row, utcnow() + timedelta(days=400))
    assert state_late == "shaky"


# ---------------------------------------------------------------- prereq splash

def test_positive_evidence_splashes_direct_prerequisites(db):
    _prereq(db, "pre", "main")
    mastery.apply_evidence("main", "correct", db=db,
                           context={"source": "chat"})
    splash = db.query(MasteryEvidence).filter_by(concept_id="pre").all()
    assert len(splash) == 1
    assert splash[0].weight == pytest.approx(mastery.SPLASH_FACTOR)
    assert splash[0].context.get("indirect") is True
    assert splash[0].context.get("via") == "main"
    assert db.get(MasteryState, "pre").p_known > mastery.P_INIT


def test_negative_evidence_does_not_splash(db):
    _prereq(db, "pre", "main")
    mastery.apply_evidence("main", "incorrect", db=db)
    assert db.query(MasteryEvidence).filter_by(concept_id="pre").count() == 0


def test_splash_never_cascades(db):
    _prereq(db, "a", "b")
    _prereq(db, "b", "c")
    mastery.apply_evidence("c", "correct", db=db)
    assert db.query(MasteryEvidence).filter_by(concept_id="b").count() == 1
    assert db.query(MasteryEvidence).filter_by(concept_id="a").count() == 0


# ---------------------------------------------------------------- rebuild

def test_rebuild_mastery_reproduces_incremental_state(db):
    _prereq(db, "pre", "main")
    mastery.apply_evidence("main", "correct", owner="ada", db=db)
    mastery.apply_evidence("main", "partial", owner="ada", db=db)
    mastery.apply_evidence("main", "incorrect", owner="ada", db=db)
    mastery.apply_evidence("main", "override_known", owner="ada", db=db)
    mastery.apply_evidence("main", "hint_used", owner="ada", db=db)
    before = {s.concept_id: s.p_known for s in db.query(MasteryState).all()}

    rebuilt = mastery.rebuild_mastery(owner="ada", db=db)
    after = {s.concept_id: s.p_known for s in db.query(MasteryState).all()}
    assert rebuilt == len(before) == 2          # main + splashed prereq
    for cid, p in before.items():
        assert after[cid] == pytest.approx(p, abs=1e-9)
