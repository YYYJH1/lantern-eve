"""Canonical form of the state, and the hash that replays check.

Every value that reaches a snapshot, a replay or a state hash is built from dicts with str
keys, lists, str, int, bool and None. Floats are refused, and so are ints that a JavaScript
number cannot hold exactly, because snapshots and frames also pass through ``JSON.parse`` in
the browser. The canonical bytes are compact JSON with sorted keys, in UTF-8, and the state
hash is their SHA-256. Both are always computed by this module, under CPython or Pyodide,
never in JavaScript.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

JS_SAFE_INT = 2**53 - 1


class CanonError(TypeError):
    """A value that has no canonical form."""


def check(value: Any, path: str = "$") -> None:
    """Raise CanonError at the first place where ``value`` leaves the canonical types.

    Every call of the core is checked, frame and all, so there is a quick look first (``plain``)
    that passes what is plainly canonical. Anything it does not know at a glance is looked at
    carefully (``careful``), which is also what says where the trouble is.
    """
    if not plain(value):
        careful(value, path)


def plain(value: Any) -> bool:
    """Whether ``value`` is canonical, from a quick walk that does not name the place of a fault.

    It knows only the types themselves (not their subclasses): False means that ``careful`` is to
    look, and not that the value is wrong.
    """
    stack = [value]
    pop = stack.pop
    while stack:
        item = pop()
        kind = type(item)
        if kind is str or kind is bool or item is None:
            continue
        if kind is int:
            if -JS_SAFE_INT <= item <= JS_SAFE_INT:
                continue
            return False
        if kind is dict:
            for key, held in item.items():
                if type(key) is not str:
                    return False
                stack.append(held)
        elif kind is list or kind is tuple:
            stack.extend(item)
        else:
            return False
    return True


def careful(value: Any, path: str = "$") -> None:
    """``check``, slowly: the same verdict, with the path to the first fault in the message."""
    # bool is a subclass of int, and both are fine, so the order of the tests does not matter
    # for them. It matters for the range check, which a bool always passes.
    if value is None or isinstance(value, bool | str):
        return
    if isinstance(value, int):
        if not -JS_SAFE_INT <= value <= JS_SAFE_INT:
            raise CanonError(f"{path}: int {value} is outside ±(2**53 - 1)")
        return
    if isinstance(value, list | tuple):
        for i, item in enumerate(value):
            careful(item, f"{path}[{i}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise CanonError(f"{path}: key {key!r} is not a str")
            careful(item, f"{path}.{key}")
        return
    raise CanonError(f"{path}: {type(value).__name__} has no canonical form")


def dumps(value: Any) -> bytes:
    """The canonical bytes of ``value``."""
    check(value)
    text = json.dumps(
        value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
    )
    return text.encode("utf-8")


def dumps_str(value: Any) -> str:
    """The canonical form as text, for the JSON that crosses into JavaScript."""
    return dumps(value).decode("utf-8")


def _no_float(text: str) -> Any:
    raise CanonError(f"float {text} has no canonical form")


def loads(data: bytes | str) -> Any:
    """Parse canonical JSON. A float, NaN or Infinity anywhere is an error."""
    value = json.loads(data, parse_float=_no_float, parse_constant=_no_float)
    check(value)
    return value


def digest(value: Any) -> str:
    """Hex SHA-256 of the canonical bytes.

    ``hashlib.sha256`` is built into CPython and works in Pyodide, which has no OpenSSL, so no
    algorithm that only OpenSSL provides is used anywhere in the core.
    """
    return hashlib.sha256(dumps(value)).hexdigest()
