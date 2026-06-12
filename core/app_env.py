import os


def app_env(name: str, default=None):
    """Read PUTTYU_<name>. `name` is the suffix WITHOUT the prefix, e.g.
    app_env("MEMORY_IMPORT_MAX_BYTES", "...")."""
    return os.environ.get(f"PUTTYU_{name}", default)
