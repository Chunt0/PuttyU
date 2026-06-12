"""Process / shell helpers for the host OS (Ubuntu Linux).

puttyU targets **Ubuntu Linux only**. This module was once a Windows/macOS
portability layer; it has been collapsed to the Linux (POSIX) implementations.
The function names and the ``IS_WINDOWS`` constant are kept so existing callers
import unchanged — ``IS_WINDOWS`` is now a constant ``False`` (any
``if IS_WINDOWS:`` branch left in not-yet-removed feature modules is dead code).

Design rule: stdlib only, no third-party deps.
"""

from __future__ import annotations

import os
import shutil
import signal
from pathlib import Path
from typing import List, Optional

# Linux-only build. Retained so callers that still reference these constants keep
# importing; their non-Linux branches are statically dead.
IS_WINDOWS = False
IS_POSIX = True


# ── File permissions ────────────────────────────────────────────────────────
def safe_chmod(path, mode: int) -> bool:
    """``os.chmod`` used to lock secret/key files down to e.g. 0o600. Returns
    True when the mode was applied, False on error."""
    try:
        os.chmod(path, mode)
        return True
    except OSError:
        return False


# ── Process detach / liveness / teardown ────────────────────────────────────
def detached_popen_kwargs() -> dict:
    """Keyword args for :class:`subprocess.Popen` that fully detach a child so it
    outlives the request/stream that launched it: ``start_new_session=True``
    (``setsid`` — a new session + process group)."""
    return {"start_new_session": True}


def pid_alive(pid: Optional[int]) -> bool:
    """True if a process with ``pid`` is currently running (``os.kill(pid, 0)``)."""
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def kill_process_tree(pid: Optional[int]) -> None:
    """Terminate ``pid`` and all of its descendants by signalling the whole
    process group (``killpg``), falling back to a plain ``kill`` if the pid isn't
    a group leader."""
    if not pid:
        return
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except Exception:
        try:
            os.kill(pid, signal.SIGTERM)
        except Exception:
            pass


# ── Shell / executable resolution ───────────────────────────────────────────
_BASH_CACHE: Optional[str] = None
_BASH_PROBED = False


def git_bash_path(path: str | Path) -> str:
    """Return ``path`` in POSIX form (forward slashes). Kept for caller
    compatibility; on Linux this is just ``Path.as_posix()``."""
    return Path(path).as_posix()


def find_bash() -> Optional[str]:
    """Locate a ``bash`` interpreter on PATH, or None. Result is cached. Many
    features (the agent ``bash`` tool, background jobs) emit bash syntax."""
    global _BASH_CACHE, _BASH_PROBED
    if _BASH_PROBED:
        return _BASH_CACHE
    _BASH_PROBED = True
    _BASH_CACHE = which_tool("bash")
    return _BASH_CACHE


def has_bash() -> bool:
    return find_bash() is not None


def which_tool(name: str) -> Optional[str]:
    """``shutil.which`` — locate an executable on PATH, or None."""
    return shutil.which(name)


def run_script_argv(script_path) -> List[str]:
    """argv to execute a shell *script file*. Prefers bash (so ``.sh`` wrappers
    run verbatim), falling back to ``sh``."""
    bash = find_bash()
    if bash:
        return [bash, str(script_path)]
    return ["sh", str(script_path)]
