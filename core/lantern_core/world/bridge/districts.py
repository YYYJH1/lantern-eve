"""The districts of the town, where the townsfolk without names live and go in the course of a day.

A *district* is a place of the town with a door, and the townsfolk without names are placed in
them and moved between them, with no walking: this is a layer of numbers and not of people on
the grid. A townsperson's *home district* is one of the places of kind ``house``. It is the
neighbourhood around that house, which is why the people of the Li house lean toward the Li and
the people of the Zhou house toward the Zhou. During the day the others go out to the places a
town goes to, by a table of slots.

The day is cut into five slots by the hour, and in each the townsfolk decide again where to be.
A slot has the share of them (per mille) who are at home, and for the rest the weights of the
kinds of place they go to; every place of a kind has the weight of the kind. Weather bends it: in a
light rain the weights of places in the open are halved, and in a heavy rain they are nothing and
another 300 per mille stay at home. The night is a slot of its own, with everyone at home.

Where each townsperson is, is a number, the index of the district in ``Layout.places``. The table
is a function of the static town and cast, so it is made once per process (``layout``).
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from typing import TYPE_CHECKING

from lantern_core.world.bridge import clock, weather

if TYPE_CHECKING:
    from lantern_core.world.bridge.people import Cast
    from lantern_core.world.bridge.town import Town

HOME_KIND = "house"

# (hour the slot begins, per mille who are at home, ((kind of place, weight), ...) for the rest)
SLOTS: tuple[tuple[int, int, tuple[tuple[str, int], ...]], ...] = (
    (6, 800, (("market", 3), ("temple", 2), ("bridge", 1), ("bank", 1))),
    (
        9,
        250,
        (
            ("market", 5),
            ("workshop", 3),
            ("bridge", 3),
            ("bank", 2),
            ("ferry", 2),
            ("school", 1),
            ("post", 1),
        ),
    ),
    (12, 600, (("teahouse", 3), ("tavern", 2), ("market", 2), ("bank", 1))),
    (
        15,
        350,
        (
            ("market", 4),
            ("bridge", 3),
            ("bank", 3),
            ("ferry", 2),
            ("teahouse", 3),
            ("lane", 1),
            ("hall", 1),
        ),
    ),
    (
        18,
        300,
        (("teahouse", 5), ("tavern", 4), ("bridge", 4), ("bank", 3), ("hall", 1), ("temple", 1)),
    ),
)
NIGHT_SLOT = len(SLOTS)
SLOTS_A_DAY = NIGHT_SLOT + 1
HEAVY_RAIN_STAYS = 300  # more per mille who stay at home in a heavy rain
BIG_HOME_SHARE, SMALL_HOME_SHARE = 4, 1  # a house with a family's side in it, and any other


@dataclass(frozen=True, slots=True, eq=False)
class Layout:
    """The districts, the homes, and which side of the two families each home leans to.

    ``places`` are the ids of the districts in map order. ``homes`` are the indices of the
    districts that are houses, ``home_share`` the relative number of townsfolk who live in each
    and ``home_lean`` the side of the families it leans to: -1 for the first family of the cast, 1
    for the second, 0 for neither. ``side`` gives the same for a family id.
    """

    places: tuple[str, ...]
    index: dict[str, int]
    indoor: tuple[bool, ...]
    kinds: tuple[str, ...]
    homes: tuple[int, ...]
    home_share: tuple[int, ...]
    home_lean: tuple[int, ...]
    side: dict[str, int]


def _sign(x: int) -> int:
    return (x > 0) - (x < 0)


@functools.cache
def layout(town: Town, cast: Cast) -> Layout:
    """The districts of ``town`` and the homes among them, with the side each home leans to."""
    places = tuple(p.id for p in town.places.values() if p.door is not None)
    index = {place_id: i for i, place_id in enumerate(places)}
    families = [family["id"] for family in cast.data["families"]]
    side = {family: -1 if i == 0 else 1 for i, family in enumerate(families[:2])}
    pull_of_home: dict[str, int] = {}
    for person in cast.people:
        if person.family in side:
            pull_of_home[person.home] = pull_of_home.get(person.home, 0) + side[person.family]
    homes = tuple(i for i, place_id in enumerate(places) if town.places[place_id].kind == HOME_KIND)
    lean = tuple(_sign(pull_of_home.get(places[i], 0)) for i in homes)
    share = tuple(SMALL_HOME_SHARE if x == 0 else BIG_HOME_SHARE for x in lean)
    return Layout(
        places=places,
        index=index,
        indoor=tuple(town.places[place_id].indoor for place_id in places),
        kinds=tuple(town.places[place_id].kind for place_id in places),
        homes=homes,
        home_share=share,
        home_lean=lean,
        side=side,
    )


def slot_at(now: clock.Now) -> int:
    """The slot of the day that ``now`` is in: 0 to 4 by day, ``NIGHT_SLOT`` at night."""
    if now.phase != clock.DAY:
        return NIGHT_SLOT
    slot = 0
    for i, (first_hour, _, _) in enumerate(SLOTS):
        if now.hour >= first_hour:
            slot = i
    return slot


def slot_key(now: clock.Now) -> int:
    """A number that changes when the slot does: the day and the slot together."""
    return now.day * SLOTS_A_DAY + slot_at(now)


def stay_at_home(slot: int, weather_kind: str) -> int:
    """Per mille of the townsfolk who stay at home in ``slot`` in this weather."""
    if slot == NIGHT_SLOT:
        return 1000
    stay = SLOTS[slot][1]
    if weather_kind == weather.HEAVY_RAIN:
        stay = min(1000, stay + HEAVY_RAIN_STAYS)
    return stay


@functools.cache
def destinations(
    lay: Layout, slot: int, weather_kind: str
) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """The districts that those who go out may go to in ``slot``, and their weights.

    Both are empty if there is nowhere to go, in which case everyone stays at home.
    """
    if slot == NIGHT_SLOT:
        return (), ()
    wanted = dict(SLOTS[slot][2])
    chosen: list[int] = []
    weights: list[int] = []
    for i, kind in enumerate(lay.kinds):
        weight = wanted.get(kind, 0)
        if weight and not lay.indoor[i]:
            if weather_kind == weather.HEAVY_RAIN:
                weight = 0
            elif weather_kind == weather.LIGHT_RAIN:
                weight = max(1, weight // 2)
        if weight:
            chosen.append(i)
            weights.append(weight)
    return tuple(chosen), tuple(weights)
