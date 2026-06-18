"""Phase-2 T4 / B5 (SPEC F6 periphery, CONTRACT D10) — the periphery tier:
shared-node coupling between two active courses, mute suppression, budget cap,
no-overlap absence, and focus-dominance (periphery never exceeds its slice).
Isolated tmp-sqlite DB exactly like tests/test_student_context.py."""

import json

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import core.database as cdb
import src.student_context as sc
from core.database import Course, CourseSource
from src.corpus.models import CorpusSource
from src.graph import mastery
from src.graph.models import Assertion, ConceptNode, new_id


@pytest.fixture
def db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path/'g.db'}")
    cdb.Base.metadata.create_all(engine)
    maker = sessionmaker(bind=engine)
    monkeypatch.setattr(cdb, "SessionLocal", maker)
    sess = maker()
    yield sess
    sess.close()


def _course(db, cid, name, owner, source_id, settings=None, status="active"):
    db.add(Course(id=cid, name=name, owner=owner, status=status,
                  settings=json.dumps(settings or {})))
    db.add(CorpusSource(id=source_id, source_type="textbook", title=name,
                        content_hash=f"h-{source_id}", status="ready"))
    db.add(CourseSource(course_id=cid, source_id=source_id))


def _concept(db, cid, name, source_id, owner, ordinal, extra_sources=None):
    sources = [source_id] + list(extra_sources or [])
    node = ConceptNode(id=cid, name=name, normalized_name=name.lower(),
                       source_id=source_id, owner=owner,
                       meta={"sources": sources, "ordinal": ordinal})
    db.add(node)
    return node


def _shared_world(db, owner="ada", mutes=None):
    """Calc1 (s1) and Physics (s2). They SHARE concept node 'derivative' (it
    cites both sources). Calc1 is the focus course."""
    _course(db, "calc1", "Calculus 1", owner, "s1",
            settings={"coupling_mutes": mutes} if mutes is not None else None)
    _course(db, "phys1", "Physics 1", owner, "s2")
    # Calc1 region (ordinals 0..2). 'derivative' also belongs to s2 -> shared.
    _concept(db, "k_limit", "Limits", "s1", owner, 0)
    _concept(db, "derivative", "Derivatives", "s1", owner, 1, extra_sources=["s2"])
    _concept(db, "k_integral", "Integrals", "s1", owner, 2)
    # Physics region (ordinals 0..2): kinematics, then it USES 'derivative'.
    _concept(db, "p_kinem", "Kinematics", "s2", owner, 0)
    _concept(db, "p_dyn", "Dynamics", "s2", owner, 2)
    db.commit()
    return owner


def test_calc_physics_shared_node_coupling(db):
    """Flagship: Calc1 and Physics share the 'derivative' node -> a periphery
    line names Physics' frontier and the shared concept it connects via."""
    _shared_world(db)
    lines = sc.periphery_tier(db, "ada", "calc1", budget_chars=1000)
    assert len(lines) == 1
    line = lines[0]
    assert "also enrolled: Physics 1" in line
    # Physics' frontier = first non-mastered in book order = Kinematics.
    assert "currently on Kinematics" in line
    assert "which connects via Derivatives" in line


def test_frontier_advances_past_mastered(db):
    """The coupled course's 'currently on' skips its mastered concepts. The
    Physics region (ordinal order) is Kinematics, Derivatives (the shared
    node), Dynamics — master the first two and the frontier lands on
    Dynamics."""
    _shared_world(db)
    mastery.apply_evidence("p_kinem", "override_known", owner="ada", db=db)
    mastery.apply_evidence("derivative", "override_known", owner="ada", db=db)
    lines = sc.periphery_tier(db, "ada", "calc1", budget_chars=1000)
    assert len(lines) == 1
    assert "currently on Dynamics" in lines[0]


def test_mute_suppresses_coupling(db):
    """course.settings.coupling_mutes for the FOCUS course drops the line."""
    _shared_world(db, mutes=["phys1"])
    assert sc.periphery_tier(db, "ada", "calc1", budget_chars=1000) == []


def test_budget_cap_truncates(db):
    """A tiny char budget drops the (single) coupled line entirely."""
    _shared_world(db)
    full = sc.periphery_tier(db, "ada", "calc1", budget_chars=1000)
    assert full                                          # present at full budget
    tiny = sc.periphery_tier(db, "ada", "calc1", budget_chars=5)
    assert tiny == []                                    # cap removes it


def test_no_overlap_courses_absent(db):
    """An active course with NO shared node (and no 1-hop bridge) is absent."""
    owner = "ada"
    _course(db, "calc1", "Calculus 1", owner, "s1")
    _course(db, "hist1", "History 1", owner, "s9")
    _concept(db, "k_limit", "Limits", "s1", owner, 0)
    _concept(db, "h_rome", "Rome", "s9", owner, 0)
    db.commit()
    assert sc.periphery_tier(db, "ada", "calc1", budget_chars=1000) == []


def test_archived_coupled_course_absent(db):
    """Only ACTIVE coupled courses surface (CONTRACT D10)."""
    _shared_world(db)
    phys = db.query(Course).filter(Course.id == "phys1").first()
    phys.status = "archived"
    db.commit()
    assert sc.periphery_tier(db, "ada", "calc1", budget_chars=1000) == []


def test_one_hop_bridge_coupling(db):
    """Best-effort 1-hop: no shared node, but a concept↔concept assertion
    bridges the two regions -> a coupling line still appears."""
    owner = "ada"
    _course(db, "calc1", "Calculus 1", owner, "s1")
    _course(db, "phys1", "Physics 1", owner, "s2")
    _concept(db, "k_deriv", "Derivatives", "s1", owner, 0)
    _concept(db, "p_kinem", "Kinematics", "s2", owner, 0)
    db.add(Assertion(id=new_id(), subject_type="concept", subject_id="k_deriv",
                     relation="prerequisite_of", object_type="concept",
                     object_id="p_kinem", kind="inferred", owner=owner))
    db.commit()
    lines = sc.periphery_tier(db, "ada", "calc1", budget_chars=1000)
    assert len(lines) == 1
    assert "also enrolled: Physics 1" in lines[0]
    assert "connects via Derivatives" in lines[0]


def test_focus_dominance_periphery_within_slice(db):
    """End-to-end through student_context: periphery rides at ~15% of budget
    and NEVER crowds out profile+focus (the F6 degradation contract)."""
    _shared_world(db)
    block = sc.student_context("ada", "calc1", token_budget=5000)
    assert "Calculus 1" in block                         # profile (focus course)
    assert "Frontier" in block                            # focus tier
    assert "also enrolled: Physics 1" in block            # periphery present
    # The periphery slice the assembler grants is int(budget_chars*0.15).
    budget_chars = max(5000 * sc.CHARS_PER_TOKEN, 200)
    periphery = sc.periphery_tier(db, "ada", "calc1", int(budget_chars * 0.15))
    assert sum(len(l) for l in periphery) <= int(budget_chars * 0.15)


def test_owner_scoping(db):
    """A different owner sees none of ada's coupled courses."""
    _shared_world(db, owner="ada")
    assert sc.periphery_tier(db, "bob", "calc1", budget_chars=1000) == []


def test_never_raises(db, monkeypatch):
    """Any internal error degrades to [] (never breaks chat)."""
    def boom(*a, **k):
        raise RuntimeError("graph on fire")
    monkeypatch.setattr("src.graph.queries.region_concepts", boom)
    assert sc.periphery_tier(db, "ada", "calc1", budget_chars=1000) == []
