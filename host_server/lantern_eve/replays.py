"""The replays in ``runs/``, offered to the page by a read-only endpoint.

The server writes the replay of each game to ``runs_dir`` (``Session.write_replay``), and the page
can list them and open one. Two requests do it, both GET and both under ``/api/replays``:

``/api/replays``
    ``{"replays": [...]}``, newest first, at most ``MAX_LISTED``. Each entry names a file of the
    folder by its ``id`` (the file name without ``.json``) and says what the page needs to show it
    in a list: ``bytes``, ``modified`` (UTC), ``seed``, ``scenario``, ``coreVersion``, ``endTick``,
    ``records``, ``snapshots`` and ``host``. A file that is not a replay is not listed.
``/api/replays/<id>``
    The file, as it is.

Nothing here writes, and nothing names a file outside ``runs_dir``: a name is a few letters,
digits, dots, dashes and underscores that does not begin with a dot, and the file it names has to
be a regular file that sits directly in the folder, symbolic links included.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SUFFIX = ".json"
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
MAX_LISTED = 200
# A replay of a long game with a snapshot for every game hour is a few megabytes.
MAX_BYTES = 256 * 1024 * 1024

Meta = dict[str, Any]
Cache = dict[tuple[str, int, int], Meta | None]


def replay_path(runs_dir: Path | None, name: str) -> Path | None:
    """The file that the id ``name`` names in ``runs_dir``, or None if it names none."""
    if runs_dir is None or not NAME.fullmatch(name):
        return None
    try:
        root = runs_dir.resolve()
        path = (root / f"{name}{SUFFIX}").resolve()
    except (OSError, RuntimeError):
        return None
    if path.parent != root or not path.is_file():
        return None
    return path


def _meta(path: Path, stat: Any) -> Meta | None:
    """What a list shows of one replay file, or None if the file is not a replay."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        header = data["header"]
        entry: Meta = {
            "id": path.name[: -len(SUFFIX)],
            "bytes": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime, UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "seed": header["seed"],
            "scenario": header["scenario"],
            "coreVersion": header.get("core_version"),
            "endTick": data["end_tick"],
            "records": len(data["records"]),
            "snapshots": len(data.get("snapshots") or []),
            "host": (data.get("host") or {}).get("name"),
        }
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None
    ok = isinstance(entry["seed"], int) and isinstance(entry["scenario"], str)
    return entry if ok and isinstance(entry["endTick"], int) else None


def list_replays(runs_dir: Path | None, cache: Cache | None = None) -> list[Meta]:
    """The replays of ``runs_dir``, newest first. ``cache`` holds what was read of each file."""
    if runs_dir is None:
        return []
    cache = {} if cache is None else cache
    try:
        files = [p for p in runs_dir.iterdir() if p.suffix == SUFFIX]
    except OSError:
        return []
    found: list[tuple[float, str, Meta]] = []
    seen: set[tuple[str, int, int]] = set()
    for path in files:
        stem = path.name[: -len(SUFFIX)]
        if replay_path(runs_dir, stem) is None:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        key = (path.name, stat.st_size, stat.st_mtime_ns)
        seen.add(key)
        if key not in cache:
            cache[key] = _meta(path, stat) if stat.st_size <= MAX_BYTES else None
        meta = cache[key]
        if meta is not None:
            found.append((stat.st_mtime, path.name, meta))
    # A file that changed or went away leaves its old entry behind.
    for key in [k for k in cache if k not in seen]:
        del cache[key]
    found.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [meta for _, _, meta in found[:MAX_LISTED]]
