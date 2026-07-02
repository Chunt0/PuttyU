"""SQLAlchemy engine + session (ADR-0004).

SQLite is canonical; WAL mode for concurrency under the single async process.
Tables are created by `init_db()` at startup (idempotent; no Alembic in v1).
"""

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    """Base class for all ORM models."""


_settings = get_settings()
engine = create_engine(
    _settings.resolved_db_url(),
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def init_db() -> None:
    """Create the data dir and all tables. Safe to call repeatedly."""
    from . import models  # noqa: F401  — register tables on Base.metadata

    _settings.data_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)


def get_session() -> Iterator[Session]:
    """FastAPI dependency: a scoped DB session."""
    with SessionLocal() as session:
        yield session
