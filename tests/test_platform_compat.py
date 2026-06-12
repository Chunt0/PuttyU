"""Tests for the Linux-only process/shell helpers in core/platform_compat.py."""

import importlib.util
import os
from pathlib import Path


_MODULE_PATH = Path(__file__).resolve().parents[1] / "core" / "platform_compat.py"
_SPEC = importlib.util.spec_from_file_location("platform_compat_under_test", _MODULE_PATH)
platform_compat = importlib.util.module_from_spec(_SPEC)
assert _SPEC and _SPEC.loader
_SPEC.loader.exec_module(platform_compat)


def _reset_bash_cache(monkeypatch):
    monkeypatch.setattr(platform_compat, "_BASH_CACHE", None)
    monkeypatch.setattr(platform_compat, "_BASH_PROBED", False)


def test_linux_only_constants():
    assert platform_compat.IS_WINDOWS is False
    assert platform_compat.IS_POSIX is True


def test_find_bash_uses_path(monkeypatch):
    _reset_bash_cache(monkeypatch)
    monkeypatch.setattr(platform_compat.shutil, "which", lambda name: "/usr/bin/bash" if name == "bash" else None)
    assert platform_compat.find_bash() == "/usr/bin/bash"
    assert platform_compat.has_bash() is True


def test_find_bash_caches_result(monkeypatch):
    _reset_bash_cache(monkeypatch)
    calls = []

    def fake_which(name):
        calls.append(name)
        return "/usr/bin/bash"

    monkeypatch.setattr(platform_compat.shutil, "which", fake_which)
    platform_compat.find_bash()
    platform_compat.find_bash()
    assert calls == ["bash"]  # probed once, then cached


def test_run_script_argv_prefers_bash(monkeypatch):
    _reset_bash_cache(monkeypatch)
    monkeypatch.setattr(platform_compat.shutil, "which", lambda name: "/usr/bin/bash" if name == "bash" else None)
    assert platform_compat.run_script_argv("/tmp/x.sh") == ["/usr/bin/bash", "/tmp/x.sh"]


def test_run_script_argv_falls_back_to_sh(monkeypatch):
    _reset_bash_cache(monkeypatch)
    monkeypatch.setattr(platform_compat.shutil, "which", lambda _name: None)
    assert platform_compat.run_script_argv("/tmp/x.sh") == ["sh", "/tmp/x.sh"]


def test_detached_popen_kwargs_is_new_session():
    assert platform_compat.detached_popen_kwargs() == {"start_new_session": True}


def test_git_bash_path_is_posix():
    assert platform_compat.git_bash_path("/home/user/x") == "/home/user/x"


def test_pid_alive_for_self_and_dead():
    assert platform_compat.pid_alive(os.getpid()) is True
    assert platform_compat.pid_alive(None) is False


def test_safe_chmod(tmp_path):
    f = tmp_path / "secret"
    f.write_text("x")
    assert platform_compat.safe_chmod(str(f), 0o600) is True
    assert (f.stat().st_mode & 0o777) == 0o600
