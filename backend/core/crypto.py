"""Secrets at rest (ADR-0001): Fernet keyed from PUTTYU_SECRET_KEY.

Provider API keys are encrypted before DB storage and never returned to the
client. If the secret key changes, stored secrets become unreadable — surfaced
as SecretDecryptError so the UI can prompt re-entry instead of failing silently
(THREAT_MODEL S10).
"""

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings


class SecretDecryptError(Exception):
    """A stored secret can't be decrypted — PUTTYU_SECRET_KEY changed?"""


def _fernet() -> Fernet:
    digest = hashlib.sha256(get_settings().secret_key.encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise SecretDecryptError(
            "stored secret is undecryptable — re-enter it (was PUTTYU_SECRET_KEY changed?)"
        ) from exc
