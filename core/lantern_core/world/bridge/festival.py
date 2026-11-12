"""The festival of the last night as the ending tells it: the facts a page needs to stage it.

The ending says how the night went by a label (a full night, just enough, scattered). The
parade that the page shows is made from what the game really came to, and the label sets only the
mood. ``build`` makes the block ``festival`` of the ending, in the night's first tick, and the
ending keeps it with the rest (``goals._finish``). It is in the event, in the frame of the call that
made the ending and in every frame after it (``goals_ending.wire``), in the whole form and in the
compact one, so a page that loads a game that is over, or is taken to the end of a recording, has
it.

    {"route": "bridge" | "lane" | "none",
     "together": bool,
     "lighter": [person],
     "bearers": {place: int},
     "named": [{"npc": person, "place": place}]}

``route`` is the way the parade goes: over the mended bridge, along the lane behind the temple (the
detour is done), or nowhere (there is no way across). ``together`` is whether the families made
peace (the flag ``reconciled``), which is a fact of its own and not of the label: a night that is
only just enough can have the two families side by side, and a full night cannot be said of a
game in which they are not. ``lighter`` is who lights the main lantern: the heads of both families
if there is a way and the peace was made, the clan elder alone if there is a way and it was not,
and nobody if there is none.

``bearers`` is the crowd for the picture, by the district it lives in. The townsfolk without names
who are keen for the festival (``crowd.KEEN_LINE``, the ``keen`` of the ``hud``) are counted by
their home district and scaled by the largest remainder to the people expected (``turnout``) up to
``MAX_BEARERS``, so that the numbers add up to the smaller of the two. The real turnout stays in
the ending's ``turnout``; this is a sample that a page draws. If nobody is keen the people who
come are those of the households that promised, one share for each. ``named`` is the place each of
the twenty named people is bound for at that tick, in the order of the cast.

Nothing here draws from the RNG, and it reads no belief of anybody.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import crowd, districts, goals_call

if TYPE_CHECKING:
    from lantern_core.world.bridge.world import BridgeWorld

MAX_BEARERS = 120  # the most people the picture draws, whatever the turnout
ROUTES = {"mended": "bridge", "detour": "lane", "none": "none"}  # by ``goals_work.passage``
NONE = "none"


def scale(weights: dict[str, int], total: int, order: tuple[str, ...]) -> dict[str, int]:
    """``total`` shared out in proportion to ``weights`` by the largest remainder, in whole
    numbers that add up to ``total``. A tie goes to the place that comes first in ``order``. The
    places with nothing are left out. Nothing is shared out if there are no weights."""
    whole = sum(weights.values())
    if whole <= 0 or total <= 0:
        return {}
    rank = {place: i for i, place in enumerate(order)}
    shares = {place: weight * total // whole for place, weight in weights.items()}
    left = total - sum(shares.values())
    by_rest = sorted(weights, key=lambda place: (-(weights[place] * total % whole), rank[place]))
    for place in by_rest[:left]:
        shares[place] += 1
    return {place: shares[place] for place in sorted(shares, key=rank.__getitem__) if shares[place]}


def bearers(world: BridgeWorld, world_state: dict[str, Any], turnout: int) -> dict[str, int]:
    """The crowd of the picture by home district (see the module)."""
    lay = districts.layout(world.town, world.cast)
    section = world_state["crowd"]
    weights: dict[str, int] = {}
    for k, enthusiasm in enumerate(section["enthusiasm"]):
        if enthusiasm >= crowd.KEEN_LINE:
            place = lay.places[section["home"][k]]
            weights[place] = weights.get(place, 0) + 1
    if not weights:
        households = goals_call.lay(world).household
        for home in world_state["goals"]["call"]["households"]:
            weights[households[home].place] = 1
    return scale(weights, min(MAX_BEARERS, turnout), lay.places)


def lighters(route: str, together: bool) -> list[str]:
    """Who lights the main lantern (see the module)."""
    if route == NONE:
        return []
    return list(goals_call.HEADS) if together else [goals_call.ELDER]


def build(
    world: BridgeWorld, world_state: dict[str, Any], passage: str, together: bool, turnout: int
) -> dict[str, Any]:
    """The block ``festival`` of the ending, from how the festival can walk (``passage``), whether
    the families made peace and the people expected."""
    route = ROUTES[passage]
    return {
        "route": route,
        "together": together,
        "lighter": lighters(route, together),
        "bearers": bearers(world, world_state, turnout),
        "named": [
            {"npc": person["id"], "place": person["place"]}
            for person in world_state["npcs"]["list"]
        ],
    }
