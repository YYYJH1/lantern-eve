"""The goals, flags, metrics and endings of the compiled script, and the language of their rules.

The script (``data.SCRIPT``) lists the *flags* a game can raise, the *metrics* it keeps (ints with a
closed range), the *goals* that raise a flag when a condition holds, and the table of endings.
This module reads those once and evaluates their conditions. It knows nothing of how a flag comes
to be raised, which is the business of ``goals``.

A condition is a dict with one of these keys, or in the table of endings also a plain name::

    {"flag": id}                          the flag is raised
    {"metric": id, "op": op, "value": n}  the metric compares to n; op is one of >= > <= < == !=
    {"goal": id}                          the goal is done
    {"all": [condition, ...]}  {"any": [condition, ...]}  {"not": condition}

A name in the table of endings is a derived value (``passable``) or an input flag
(``bridge_fixed``). The deadline of a goal is written in game minutes counted from 00:00 of day 1
(``minute_tick`` turns it into a tick of the clock).
"""

from __future__ import annotations

import functools
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from lantern_core.world.bridge import clock
from lantern_core.world.bridge.data import SCRIPT

MINUTES_A_DAY = 24 * 60
DAY_MINUTES = clock.DAY_HOURS * 60  # the length of the day phase, from 06:00
OPS = (">=", ">", "<=", "<", "==", "!=")


def minute_tick(minute: int) -> int:
    """The tick of the clock at game minute ``minute``, with 00:00 of day 1 as minute 0.

    Tick 0 is 06:00 of day 1, which is minute 360, so the minutes before it have no tick and give
    a negative one. A minute of the night belongs to the game day that began the evening before.
    """
    since_dawn = minute - clock.DAWN_HOUR * 60
    cycle, rest = divmod(since_dawn, MINUTES_A_DAY)
    if rest < DAY_MINUTES:
        return cycle * clock.CYCLE_TICKS + rest * clock.DAY_TICKS_PER_HOUR // 60
    return (
        cycle * clock.CYCLE_TICKS
        + clock.DAY_TICKS
        + (rest - DAY_MINUTES) * clock.NIGHT_TICKS_PER_HOUR // 60
    )


@dataclass(frozen=True, slots=True)
class Goal:
    """A goal of the script: what makes it done, by when, and the flag it raises."""

    id: str
    label: str
    done_when: Any
    deadline: int | None  # a tick; the goal cannot be done after it
    sets: str | None


@dataclass(frozen=True, slots=True)
class Row:
    """One row of the table of endings, or one hidden ending."""

    id: str
    label: str
    when: Any


@dataclass(frozen=True, slots=True)
class Rules:
    """What the script says about goals and endings."""

    flags: tuple[str, ...]
    metrics: dict[str, tuple[int, int]]  # id -> (lowest, highest)
    goals: tuple[Goal, ...]
    inputs: tuple[str, ...]  # the flags the table of endings turns on
    derived: dict[str, Any]
    rows: tuple[Row, ...]
    hidden: tuple[Row, ...]
    never: tuple[tuple[str, str], ...]  # (flag, ending): the ending cannot be if the flag is not up


def _refs(cond: Any) -> list[tuple[str, str]]:
    """The ``(kind, id)`` of every flag, metric, goal and name a condition mentions."""
    if isinstance(cond, str):
        return [("name", cond)]
    out: list[tuple[str, str]] = []
    for key in ("flag", "metric", "goal"):
        if key in cond:
            out.append((key, cond[key]))
    for key in ("all", "any"):
        for part in cond.get(key, ()):
            out += _refs(part)
    if "not" in cond:
        out += _refs(cond["not"])
    return out


@functools.cache
def rules() -> Rules:
    """The goals and endings of the script, read once."""
    flags = tuple(f["id"] for f in SCRIPT["flags"])
    metrics = {m["id"]: (m["min"], m["max"]) for m in SCRIPT["metrics"]}
    goals = tuple(
        Goal(
            g["id"],
            g["label"],
            g["done_when"],
            None if g["deadline"] is None else minute_tick(g["deadline"]),
            g["sets"],
        )
        for g in SCRIPT["goals"]
    )
    table = SCRIPT["endings"]
    found = Rules(
        flags,
        metrics,
        goals,
        tuple(table["inputs"]),
        dict(table["derived"]),
        tuple(Row(r["id"], r["label"], r["when"]) for r in table["rows"]),
        tuple(Row(r["id"], r["label"], r["when"]) for r in table["hidden"]),
        tuple((v["if_false"], v["never"]) for v in table["invariants"]),
    )
    names = {*found.inputs, *found.derived}
    goal_ids = {g.id for g in goals}
    parts = [
        *[(g.done_when, g.id) for g in goals],
        *[(row.when, row.id) for row in (*found.rows, *found.hidden)],
        *[(cond, name) for name, cond in found.derived.items()],
    ]
    for cond, owner in parts:
        for kind, ref in _refs(cond):
            known = {
                "flag": flags,
                "metric": metrics,
                "goal": goal_ids,
                "name": names,
            }[kind]
            if ref not in known:
                raise ValueError(f"the script's condition of {owner} names unknown {kind} {ref!r}")
    for flag in (*found.inputs, *[g.sets for g in goals if g.sets]):
        if flag not in flags:
            raise ValueError(f"the script raises an unknown flag {flag!r}")
    return found


def compare(value: int, op: str, bound: int) -> bool:
    """``value op bound`` for the operators a condition may use."""
    if op == ">=":
        return value >= bound
    if op == ">":
        return value > bound
    if op == "<=":
        return value <= bound
    if op == "<":
        return value < bound
    if op == "==":
        return value == bound
    if op == "!=":
        return value != bound
    raise ValueError(f"unknown comparison {op!r}")


def holds(
    cond: Any,
    flags: Mapping[str, Any],
    metrics: Mapping[str, int],
    done: Mapping[str, Any],
    derived: Mapping[str, Any] | None = None,
) -> bool:
    """Whether ``cond`` holds when the flags in ``flags`` are up and the goals in ``done`` are done.

    ``flags`` and ``done`` only need to answer ``in``; ``derived`` gives the meaning of the names
    of a table of endings that are not flags.
    """
    if isinstance(cond, str):
        if derived is not None and cond in derived:
            return holds(derived[cond], flags, metrics, done, derived)
        return cond in flags
    if "flag" in cond:
        return cond["flag"] in flags
    if "metric" in cond:
        return compare(metrics[cond["metric"]], cond["op"], cond["value"])
    if "goal" in cond:
        return cond["goal"] in done
    if "all" in cond:
        return all(holds(part, flags, metrics, done, derived) for part in cond["all"])
    if "any" in cond:
        return any(holds(part, flags, metrics, done, derived) for part in cond["any"])
    if "not" in cond:
        return not holds(cond["not"], flags, metrics, done, derived)
    raise ValueError(f"unknown condition {cond!r}")


def ending_of(flags: Mapping[str, Any], metrics: Mapping[str, int]) -> tuple[Row, tuple[Row, ...]]:
    """The base ending of a game that stands as ``flags`` say, and the hidden ones laid over it.

    The rows of the table are exclusive and cover every combination of the input flags (the
    content build checks it, and so does a test), so exactly one holds.
    """
    table = rules()
    matching = [row for row in table.rows if holds(row.when, flags, metrics, {}, table.derived)]
    if len(matching) != 1:
        raise ValueError(f"the endings table gives {[r.id for r in matching]} for {sorted(flags)}")
    hidden = tuple(
        row for row in table.hidden if holds(row.when, flags, metrics, {}, table.derived)
    )
    return matching[0], hidden
