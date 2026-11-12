"""Where and when the manager met each person, and what each one asked in return: the three facts of
the people book that nothing else in the state keeps.

The page keeps a book of the people the manager has talked with. Most of a row is worked out from
what the frame has already (``roster``): the hearts, what was learned of the tastes, the notebook
entries a person told. Three things are not, and they are written down here, each only once there is
something to write, so that a game in which nobody was talked to has the state it always had:

``met``      the section ``player`` keeps ``{person id: [[tick, place], ...]}``: the places and the
             times at which the manager began a talk with the person, the last ``MET_KEPT`` of
             them, oldest first. A talk at the place and on the day of the one before it is not
             written again, since the book says where and when they met and not how often.
``wanted``   ``{person id: [tick, what, item, amount, kind, target]}``: the return the person last
             asked, and for which request. It is written when a person turns a request down for want
             of weight and the talk then puts a return forward (``context.wants``), and not before,
             so that the book holds what the manager has been told and not the script's answer.
             ``what``, ``item`` and ``amount`` are the promise (``pledges``), ``kind`` and
             ``target`` the request (``entrust``).
``where``    in each entry of the notebook (``notebook``): the place the manager stood at when they
             wrote the entry down. When is already in the entry: the tick of the belief it keeps.

A place is the place of the town (``TOWN``) that the manager stands within ``NEAR`` cells of, the
nearest first and the first of the map when two are as near, and ``""`` for a cell that is at none:
the street. Only the manager's own position and the clock go in, so what is true in the game, and
what anyone believes, has no part in any of it.
"""

from __future__ import annotations

import functools
from typing import Any

from lantern_core.world.bridge import clock
from lantern_core.world.bridge.data import TOWN

NEAR = 1  # cells from the rectangle of a place; the reach of a look (``evidence.REACH``)
MET_KEPT = 3  # talks kept for each person
NO_PLACE = ""  # the street


@functools.cache
def _places() -> tuple[tuple[str, int, int, int, int], ...]:
    """The places a person can be at, in the order of the map: the ones with a door (not the
    water)."""
    return tuple(
        (p["id"], p["rect"][0], p["rect"][1], p["rect"][2], p["rect"][3])
        for p in TOWN["places"]
        if p["door"] is not None
    )


def place_at(x: int, y: int) -> str:
    """The place the cell ``(x, y)`` is at, or ``NO_PLACE``."""
    best, near = NO_PLACE, NEAR + 1
    for place_id, left, top, width, height in _places():
        dx = max(left - x, 0, x - (left + width - 1))
        dy = max(top - y, 0, y - (top + height - 1))
        if max(dx, dy) < near:
            best, near = place_id, max(dx, dy)
    return best


def where_is(section: dict[str, Any]) -> str:
    """The place the manager stands at."""
    return place_at(section["x"], section["y"])


def record_talk(section: dict[str, Any], person: str, tick: int) -> None:
    """Write down that the manager began a talk with ``person`` now, where they stand."""
    place = where_is(section)
    rows = section.setdefault("met", {}).setdefault(person, [])
    if rows and rows[-1][1] == place and clock.at(rows[-1][0]).day == clock.at(tick).day:
        return
    rows.append([tick, place])
    del rows[:-MET_KEPT]


def record_ask(
    section: dict[str, Any],
    person: str,
    tick: int,
    promise: dict[str, Any],
    kind: str,
    target: str,
) -> None:
    """Write down that ``person`` asked the return ``promise`` (the body of an offer of
    ``promise``: ``what`` and perhaps ``item`` and ``amount``) for the request ``kind``, naming
    ``target`` for the one that is about a third person."""
    section.setdefault("wanted", {})[person] = [
        tick,
        promise["what"],
        promise.get("item", ""),
        promise.get("amount", 0),
        kind,
        target,
    ]


def time_of(tick: int) -> dict[str, int]:
    """A tick as the frame says it: ``{"tick", "day", "hour", "minute"}``."""
    when = clock.at(tick)
    return {"tick": tick, "day": when.day, "hour": when.hour, "minute": when.minute}


def stamp(tick: int, place: str) -> dict[str, Any]:
    """A time and a place as the frame says them: ``{"tick", "day", "hour", "minute", "place"}``,
    the place an id of the town or null for the street."""
    return {**time_of(tick), "place": place or None}


def met_rows(section: dict[str, Any], person: str) -> list[dict[str, Any]]:
    """The talks kept for ``person``, oldest first, as the frame says them."""
    return [stamp(tick, place) for tick, place in section.get("met", {}).get(person, ())]
