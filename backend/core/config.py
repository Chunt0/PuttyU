"""Application settings, loaded from PUTTYU_* env vars (ADR-0001).

A committed `.env.example` documents every variable; `.env` (gitignored) overrides.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

APP_VERSION = "0.0.0"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="PUTTYU_", env_file=".env", extra="ignore"
    )

    # Where app.db, data/chroma/, uploads, and JSON sidecars live.
    data_dir: Path = Path("data")
    # The content library (gitignored, local-only) the corpus ingests.
    library_path: Path = Path("../textbooks")
    # Empty → derived from data_dir (see resolved_db_url).
    db_url: str = ""
    # Signs sessions + Fernet-encrypts provider keys. BACK THIS UP (THREAT_MODEL S10).
    secret_key: str = "dev-insecure-change-me"
    host: str = "127.0.0.1"
    port: int = 7000
    # Selects the deterministic FakeProvider for tests (M0-PLAN §4).
    test_mode: bool = False
    embed_model: str = "BAAI/bge-small-en-v1.5"

    def resolved_db_url(self) -> str:
        if self.db_url:
            return self.db_url
        return f"sqlite:///{(self.data_dir / 'app.db').as_posix()}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
