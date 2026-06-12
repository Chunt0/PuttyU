"""Gate 5 (ADR 0002): `owner_scoped` is THE sanctioned way to scope user data.

Pins the semantics adopted from the repo's legacy convention:
  * a user sees their own rows AND legacy/shared null-owner rows
    (the `(owner == user) | (owner IS NULL)` rule used across the codebase);
  * a user NEVER sees another user's rows (cross-user isolation);
  * a falsy user (single-user / auth-off mode) leaves the query unfiltered.
"""

import tempfile
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

import core.database as cdb
from core.database import Course
from src.auth_helpers import owner_scoped

_TMPDB = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_ENGINE = create_engine(
    f"sqlite:///{_TMPDB.name}",
    connect_args={"check_same_thread": False},
    poolclass=NullPool,
)
cdb.Base.metadata.create_all(_ENGINE)
_TS = sessionmaker(bind=_ENGINE, autoflush=False, autocommit=False)


def _mk_course(db, name, owner):
    c = Course(id=str(uuid.uuid4()), name=name, owner=owner)
    db.add(c)
    db.commit()
    return c.id


def _seed():
    db = _TS()
    try:
        ids = {
            "alice": _mk_course(db, "Alice's stats", "alice"),
            "bob": _mk_course(db, "Bob's lit", "bob"),
            "shared": _mk_course(db, "Legacy shared", None),
        }
        return ids
    finally:
        db.close()


def _visible_ids(user):
    db = _TS()
    try:
        rows = owner_scoped(db.query(Course), Course, user).all()
        return {r.id for r in rows}
    finally:
        db.close()


def test_cross_user_isolation_and_shared_rows():
    ids = _seed()

    alice_sees = _visible_ids("alice")
    assert ids["alice"] in alice_sees
    assert ids["shared"] in alice_sees, "legacy null-owner rows stay visible"
    assert ids["bob"] not in alice_sees, "cross-user leak: alice sees bob's row"

    bob_sees = _visible_ids("bob")
    assert ids["bob"] in bob_sees
    assert ids["shared"] in bob_sees
    assert ids["alice"] not in bob_sees, "cross-user leak: bob sees alice's row"


def test_falsy_user_is_single_user_mode_no_filter():
    ids = _seed()
    for anon in (None, ""):
        seen = _visible_ids(anon)
        assert ids["alice"] in seen and ids["bob"] in seen and ids["shared"] in seen
