"""The cast: who the people are and what their routines say, as read-only tables.

``Person`` is a row of ``data.CAST``. The routine of a person is turned into a table of
``(start, act, place)`` with ``start`` in ticks from 06:00 of the game day, which is what the
clock counts in (``clock.hour_start``). A day person's entries by day are late by a few ticks that
depend on the person's number in the cast, so that a town does not move as one body when the
clock strikes the hour. The entries of the night are not late, since a night tick is 4 minutes
and a delay would be hours.

The table is cyclic. The entry in force at a tick is the last one that has started, and before
the first one has started it is the last entry of the day before. The next entry starts at
``leaves_at``, the tick at which a person who is in a conversation with the manager has to go.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lantern_core.world.bridge import clock

STAGGER_STEP = 7
STAGGER_SPAN = 30  # ticks, a quarter of a day hour


@dataclass(frozen=True, slots=True)
class Person:
    index: int
    id: str
    zh: str
    en: str
    family: str | None
    tags: tuple[str, ...]
    night_shift: bool
    home: str
    work: str
    traits: dict[str, int]
    ops: dict[str, int]
    routine: tuple[tuple[int, str, str], ...]  # (start tick of the game day, act, place)

    def entry_at(self, cycle_tick: int) -> tuple[int, str, str]:
        """The routine entry in force at ``cycle_tick`` (ticks from 06:00 of the game day)."""
        chosen = self.routine[-1]
        for entry in self.routine:
            if entry[0] > cycle_tick:
                break
            chosen = entry
        return chosen

    def leaves_at(self, tick: int) -> int:
        """The tick, after ``tick``, at which the routine takes the person away from here: the
        start of their next entry, which is tomorrow's first if today has no more. Someone who is
        not on the night shift goes home when the night begins, whatever the routine says, so that
        is the latest it can be by day, and at night they are on their way home already: the next
        tick."""
        day, cycle = divmod(tick, clock.CYCLE_TICKS)
        if cycle >= clock.DAY_TICKS and not self.night_shift:
            return tick + 1
        starts = sorted(entry[0] for entry in self.routine)
        stop = next((start for start in starts if start > cycle), starts[0] + clock.CYCLE_TICKS)
        if not self.night_shift:
            stop = min(stop, clock.DAY_TICKS)
        return day * clock.CYCLE_TICKS + stop


def stagger(index: int) -> int:
    """How many ticks late person ``index`` is for the entries of the day."""
    return index * STAGGER_STEP % STAGGER_SPAN


def routine_table(index: int, routine: list[dict[str, Any]]) -> tuple[tuple[int, str, str], ...]:
    rows = []
    for entry in routine:
        start = clock.hour_start(entry["hour"])
        if start < clock.DAY_TICKS:
            start += stagger(index)
        rows.append((start, entry["act"], entry["place"]))
    return tuple(rows)


class Cast:
    """The people of the scenario in cast order, with the tables around them."""

    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data
        self.people = tuple(
            Person(
                i,
                raw["id"],
                raw["zh"],
                raw["en"],
                raw["family"],
                tuple(raw["tags"]),
                raw["night_shift"],
                raw["home"],
                raw["work"],
                dict(raw["traits"]),
                dict(raw["ops"]),
                routine_table(i, raw["routine"]),
            )
            for i, raw in enumerate(data["people"])
        )
        self.index = {p.id: p.index for p in self.people}
        self.items = tuple(item["id"] for item in data["items"])
        self.activities = tuple(act["id"] for act in data["activities"])
