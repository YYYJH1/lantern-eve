"""Small checks shared by the cognition types when they are built from canonical values."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any


class ShapeError(ValueError):
    """A value that does not have the shape its type needs."""


def as_dict(
    value: Any, where: str, required: Iterable[str] = (), optional: Iterable[str] = ()
) -> dict[str, Any]:
    """``value`` as a dict whose keys are exactly the required ones plus some optional ones."""
    if not isinstance(value, dict):
        raise ShapeError(f"{where}: expected an object, got {type(value).__name__}")
    required, optional = set(required), set(optional)
    missing = sorted(required - set(value))
    extra = sorted(set(value) - required - optional)
    if missing:
        raise ShapeError(f"{where}: missing {missing}")
    if extra:
        raise ShapeError(f"{where}: unknown {extra}")
    return value


def as_list(value: Any, where: str) -> list[Any]:
    if not isinstance(value, list | tuple):
        raise ShapeError(f"{where}: expected a list, got {type(value).__name__}")
    return list(value)


def as_str(value: Any, where: str) -> str:
    """A non-empty string."""
    if not isinstance(value, str) or not value:
        raise ShapeError(f"{where}: expected a non-empty string, got {value!r}")
    return value


def as_opt_str(value: Any, where: str) -> str | None:
    return None if value is None else as_str(value, where)


def as_int(value: Any, where: str, lo: int | None = None, hi: int | None = None) -> int:
    """An int (a bool is not one), optionally within ``lo`` and ``hi`` inclusive."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ShapeError(f"{where}: expected an int, got {value!r}")
    if (lo is not None and value < lo) or (hi is not None and value > hi):
        raise ShapeError(f"{where}: {value} is outside [{lo}, {hi}]")
    return value


def as_bool(value: Any, where: str) -> bool:
    if not isinstance(value, bool):
        raise ShapeError(f"{where}: expected a bool, got {value!r}")
    return value


def as_choice(value: Any, choices: Iterable[str], where: str) -> str:
    choices = tuple(choices)
    if value not in choices:
        raise ShapeError(f"{where}: {value!r} is not one of {list(choices)}")
    return value


def as_str_tuple(value: Any, where: str) -> tuple[str, ...]:
    return tuple(as_str(item, f"{where}[{i}]") for i, item in enumerate(as_list(value, where)))
