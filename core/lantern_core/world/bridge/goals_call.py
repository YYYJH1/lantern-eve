"""The call for helpers: a threshold model of who joins, and the households that promise to come.

Each adult of the town has an integer *threshold*, the number of acquaintances who must have
joined before they do (Granovetter, 1978). Nobody joins until the festival manager has called
(``goals.rally``), and a person who is persuaded joins at once whatever their threshold
(``goals.join``). When the call is out, the people whose threshold is met join in rounds: in a round
every person who is not yet in is checked against the people who joined before it began, and those
whose count is high enough join, in the order of the cast. The next round counts them, and so on
until nobody more joins. The call is for the crew the work takes and no more: it stops as soon as
there are ``CREW`` helpers with at least one of each family (``crew_ready``), and once it has
``CREW`` it brings only people of a family that has nobody yet (``wanted``). So the people it would
have brought after that stay where they are, with their thresholds met, until the manager asks
them in person. A person who is asked in person comes if the people they know who are helping
meet their threshold, once it has been lowered by a step (``goals.lower_threshold``), whether the
crew is ready or not; if not, they come one step nearer. Who joined, and in which round of its
spread, is kept in order, so the way the call went can be read back.

The threshold is made of three things and a shift::

    threshold = BASE + conformity // 25        a follower waits for others to go first
              + 1 if the person heads a family  the feud between the families weighs on them most
              - 1 for the clan elder            who sent for the manager
              + a draw of -1, 0 or +1           from the seed, so the eager differ from game to game
              - trust // TRUST_STEP             the person's trust in the manager (``player``)
              + shift                           what a persuasion took off (negative) or put on

and it stays between 0 and ``MAX_THRESHOLD``. The trust is the one the ``player`` section keeps,
``state["world"]["player"]["trust"]`` in cast order, so whatever raises it lowers the threshold, and
a game whose player section has none counts it as zero. The draws come from a generator of the
section's own, seeded from the state of the game's generator at the start without taking a number
from it, so adding them moved none of the numbers other sections draw.

Whom a person counts as an acquaintance is fixed by the cast: kin, and those whose days put them in
the same place for ``MIN_TOGETHER`` hours or more by the schedules of the cast, but nobody of the
other family, but for the two who are fond of each other (the ones tagged ``bridge`` in both
families). The children cannot be helpers.

A *household* is the people who live under one roof (their ``home`` place). It has promised to come
to the festival when any of its people has joined, and then a lantern hangs at its door.

State (``state["world"]["goals"]["call"]``)::

    {"open": the tick of the call, -1 until it is made,
     "joined": [[person, tick, round, how], ...]   in the order of joining; ``round`` is 0 for a
                                                   person who was persuaded; ``how`` is "call",
                                                   "persuasion" or "dev",
     "base": {person: int}, "shift": {person: int}   every possible helper,
     "households": [household id, ...]   the households that promised, in the order they did}
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from lantern_core.rng import Pcg32
from lantern_core.world.bridge import clock
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.people import Cast, Person
    from lantern_core.world.bridge.town import Town
    from lantern_core.world.bridge.world import BridgeWorld

CHILDREN = ("shitou", "xiao_man")
HEADS = ("li_laotai", "zhou_zhanggui")  # the head of the first family of the cast, then the second
ELDER = "zuzhang"  # the clan elder sent for the manager, and waits for one person fewer
MIN_TOGETHER = 2  # hours a day in the same place for two people to be acquainted
CREW = 5  # helpers the bridge needs, with at least one from each family
BASE = 1
CONFORMITY_STEP = 25
MAX_THRESHOLD = 6
TRUST_STEP = 30
MAX_SHIFT = 6

_SALT = 0x63616C6C6F7574  # the section's seed is the state of the game's generator mixed with this
_STREAM = 0x6A6F696E  # and its increment is this
JITTER = (-1, 0, 0, 1)

ROUND_PERSUADED = 0
CALL, PERSUASION, DEV = "call", "persuasion", "dev"


@dataclass(frozen=True, slots=True)
class Household:
    """The people under one roof: its id, its place, who lives there and the cell of its door."""

    id: str
    place: str
    members: tuple[str, ...]
    door: tuple[int, int]


@dataclass(frozen=True, slots=True, eq=False)
class Layout:
    """Who can help, whom each one knows, and the households of the town. A function of the cast."""

    helpers: tuple[str, ...]  # everyone who is not a child, in cast order
    family: dict[str, str | None]
    families: tuple[str, ...]
    knows: dict[str, tuple[str, ...]]  # the acquaintances of each helper, in cast order
    households: tuple[Household, ...]
    household_of: dict[str, str]  # person id -> household id
    household: dict[str, Household]  # household id -> household


def _hours(person: Person) -> dict[str, int]:
    """The whole hours of a day that ``person`` spends at each place, by their schedule."""
    spent: dict[str, int] = {}
    for hour in range(24):
        per_hour = (
            clock.DAY_TICKS_PER_HOUR
            if clock.DAWN_HOUR <= hour < clock.DUSK_HOUR
            else clock.NIGHT_TICKS_PER_HOUR
        )
        place = person.entry_at(clock.hour_start(hour) + per_hour // 2)[2]
        spent[place] = spent.get(place, 0) + 1
    return spent


@functools.cache
def layout(town: Town, cast: Cast) -> Layout:
    """The helpers, their acquaintances and the households of ``cast``."""
    people = cast.people
    helpers = tuple(p.id for p in people if p.id not in CHILDREN)
    family = {p.id: p.family for p in people}
    tags = {p.id: p.tags for p in people}
    spent = {p.id: _hours(p) for p in people}
    for head in HEADS:
        if head not in family:
            raise ValueError(f"the head of a family, {head!r}, is not in the cast")

    def acquainted(a: str, b: str) -> bool:
        if family[a] is not None and family[a] == family[b]:
            return True
        cross = family[a] is not None and family[b] is not None
        if cross and not ("bridge" in tags[a] and "bridge" in tags[b]):
            return False
        together = sum(min(hours, spent[b].get(place, 0)) for place, hours in spent[a].items())
        return together >= MIN_TOGETHER

    knows = {a: tuple(b for b in helpers if b != a and acquainted(a, b)) for a in helpers}
    by_home: dict[str, list[str]] = {}
    for person in people:
        by_home.setdefault(person.home, []).append(person.id)
    households = []
    for place, members in by_home.items():
        kin = family[members[0]] if all(family[m] == family[members[0]] for m in members) else None
        door = town.places[place].door
        assert door is not None
        households.append(Household(kin or members[0], place, tuple(members), door))
    household_of = {m: h.id for h in households for m in h.members}
    return Layout(
        helpers,
        family,
        tuple(f["id"] for f in cast.data["families"]),
        knows,
        tuple(households),
        household_of,
        {h.id: h for h in households},
    )


def lay(world: BridgeWorld) -> Layout:
    return layout(world.town, world.cast)


# ---------------------------------------------------------------------------- the start


def seed(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    """The section ``call`` of a game: nobody has joined, and each helper's threshold is set.

    Reads the game's generator, and does not draw from it.
    """
    own = Pcg32(rng.state ^ _SALT, _STREAM)
    base: dict[str, int] = {}
    for person in world.cast.people:  # every person, so the draws do not depend on who may help
        jitter = JITTER[own.below(len(JITTER))]
        if person.id in CHILDREN:
            continue
        wait = BASE + person.traits["conformity"] // CONFORMITY_STEP + jitter
        wait += (person.id in HEADS) - (person.id == ELDER)
        base[person.id] = max(0, min(MAX_THRESHOLD, wait))
    return {
        "open": -1,
        "joined": [],
        "base": base,
        "shift": {pid: 0 for pid in base},
        "households": [],
    }


# ---------------------------------------------------------------------------- reading


def trust_of(state: dict[str, Any], person: str) -> int:
    """How far ``person`` trusts the manager: the entry of the ``player`` section, or 0 if it has
    none. ``state`` is the world state."""
    trust = state.get("player", {}).get("trust")
    return int(trust[lore().index[person]]) if isinstance(trust, list) else 0


def threshold(state: dict[str, Any], person: str) -> int:
    """How many acquaintances must have joined before ``person`` does, as things stand.

    ``state`` is the world state.
    """
    call = state["goals"]["call"]
    value = call["base"][person] + call["shift"][person] - trust_of(state, person) // TRUST_STEP
    return max(0, min(MAX_THRESHOLD, value))


def joined_ids(call: dict[str, Any]) -> list[str]:
    """Who has joined, in the order they did."""
    return [entry[0] for entry in call["joined"]]


def has_joined(call: dict[str, Any], person: str) -> bool:
    return any(entry[0] == person for entry in call["joined"])


def known_to_have_joined(world: BridgeWorld, call: dict[str, Any], person: str) -> int:
    """How many of the acquaintances of ``person`` have joined."""
    joined = joined_ids(call)
    return sum(1 for other in lay(world).knows[person] if other in joined)


def waiting_for(world: BridgeWorld, state: dict[str, Any], person: str) -> int:
    """How many more acquaintances ``person`` still wants to see join. Zero if they are in."""
    call = state["goals"]["call"]
    if has_joined(call, person):
        return 0
    return max(0, threshold(state, person) - known_to_have_joined(world, call, person))


def crew(world: BridgeWorld, call: dict[str, Any]) -> tuple[int, dict[str, int]]:
    """The number of helpers who have joined, and how many of them are of each family."""
    per_family = {family: 0 for family in lay(world).families}
    joined = joined_ids(call)
    for person in joined:
        family = lay(world).family[person]
        if family in per_family:
            per_family[family] += 1
    return len(joined), per_family


def crew_ready(world: BridgeWorld, call: dict[str, Any]) -> bool:
    """Whether there are enough helpers, with at least one of each family."""
    count, per_family = crew(world, call)
    return count >= CREW and all(n >= 1 for n in per_family.values())


# ---------------------------------------------------------------------------- joining


def add(
    world: BridgeWorld, call: dict[str, Any], person: str, tick: int, rnd: int, how: str
) -> tuple[bool, str | None]:
    """Put ``person`` among the joiners. Returns whether they were new, and the household that
    promised because of it (``None`` if its lantern was already hung, or the person was not new)."""
    if person not in call["base"] or has_joined(call, person):
        return False, None
    call["joined"].append([person, tick, rnd, how])
    household = lay(world).household_of[person]
    if household in call["households"]:
        return True, None
    call["households"].append(household)
    return True, household


def wanted(world: BridgeWorld, call: dict[str, Any], person: str) -> bool:
    """Whether the call still has a place for ``person``: it is for ``CREW`` helpers, and past that
    only for a person of a family that has nobody among them yet."""
    count, per_family = crew(world, call)
    return count < CREW or per_family.get(lay(world).family[person], 1) == 0


def cascade(
    world: BridgeWorld, state: dict[str, Any], tick: int
) -> list[tuple[str, int, str | None]]:
    """Let the call spread until nobody more joins or the crew is ready. Returns ``(person, round,
    household)`` for each new joiner in the order they joined, ``household`` being the one that
    promised."""
    call = state["goals"]["call"]
    found: list[tuple[str, int, str | None]] = []
    rnd = 0
    while not crew_ready(world, call):
        rnd += 1
        batch = [
            person
            for person in lay(world).helpers
            if not has_joined(call, person)
            and known_to_have_joined(world, call, person) >= threshold(state, person)
        ]
        added = 0
        for person in batch:
            if crew_ready(world, call):  # the call is for the crew and no more
                break
            if wanted(world, call, person):
                _, household = add(world, call, person, tick, rnd, CALL)
                found.append((person, rnd, household))
                added += 1
        if not added:
            break
    return found
