"""The user-data one-door (SPEC §5.5 #1, ADR-0002 Gate 5).

`owner_scoped()` is the ONLY place user data may be scoped to a user. An ad-hoc
`.where(Model.owner == ...)` anywhere else fails `.fitness/owner-scoped.sh`.
This is query discipline plus the seam for a possible admin/tutor role (SPEC §2)
— not multi-student preparation.
"""

from typing import TypeVar

from sqlalchemy import Select

from .models import User

S = TypeVar("S", bound=Select)  # type: ignore[type-arg]


def owner_scoped(stmt: S, model: type, user: User) -> S:
    """Scope a select over `model` to rows owned by `user`."""
    return stmt.where(model.owner == user.id)
