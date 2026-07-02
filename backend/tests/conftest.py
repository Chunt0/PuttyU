"""Test bootstrap: isolated data dir + fresh schema per test.

Env is set at import time — conftest imports before any test module, so the
cached Settings and the module-level engine bind to the temp dir, never to a
developer's real data/.
"""

import os
import tempfile

os.environ["PUTTYU_DATA_DIR"] = tempfile.mkdtemp(prefix="puttyu-test-")
os.environ["PUTTYU_TEST_MODE"] = "1"
os.environ["PUTTYU_SECRET_KEY"] = "test-secret-key-not-for-prod"

import pytest  # noqa: E402

from core import auth  # noqa: E402
from core import models  # noqa: E402,F401 — register tables
from core.database import Base, engine  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_state():
    """Blank schema + cleared rate limiter around every test."""
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    auth._failed_logins.clear()
    yield
