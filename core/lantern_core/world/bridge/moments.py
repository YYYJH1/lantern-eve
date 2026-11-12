"""The moments of the festival: three things worth a picture that stop the world for the page.

A moment is something that happens in the course of a game and that the page shows to the player
(it moves the camera there and puts a line of words over the map). There are three, each at most
once in a game, and each is made from the state of the game and nothing else:

``echo``           the manager hears a telling, in a conversation or by listening, whose chain
                   has the manager as an earlier teller: words they said went through at least
                   ``MIN_TELLINGS`` tellings and came back. Every telling counts that the manager
                   was given: the answer of the rules, the account that the person keeps in mind
                   against it when they say that too, and what the words that a model wrote for
                   them say. It carries ``prop`` (what was heard) and ``from`` (who said it to the
                   manager), and no count of the tellings: a page says who brought it back and
                   never how far it went. It is shown where the speaker is (``place``) and where
                   the manager stands (``x``, ``y``).
``together_work``  the first morning on which helpers of both families finished an hour of work at
                   the bridge (the deed ``work_together`` of ``peace``). It carries ``round``, the
                   game day of that morning.
``both_banks``     the first tick at which a lantern hangs at the door of a household that
                   promised on each bank of the river: the doors are told apart by the side of
                   the river their column is on.

The page asks for them. A game has no moments, and the section of them is not in its state, until
the page says that it will show them (the player action ``moment`` with ``"op": "watch"``, which
the page sends once, as its game begins). A game that nobody watches is the game it always was,
which keeps every bot and every test as they are. Once a game is watched:

* the section is ``state["world"]["goals"]["moments"]``, ``{"list": [moment], "held": [kind]}``;
* a moment that happens is added to ``list``, once, as ``{"kind", "tick", "place", "x", "y"}``
  and the fields of its kind, and the event ``moment`` says it: ``{"kind": "moment", "tick",
  "moment": kind, "place", "x", "y", ...}`` (the event has a ``kind`` of its own, so the kind of
  the moment is ``moment`` in it);
* it is also added to ``held``, and while ``held`` is not empty the world holds its own clock, as
  it does in a conversation (``BridgeWorld.halted``): the call that made the moment is the last
  that simulates, so the frame the page has is the frame of the moment. The page lets the world go
  with the action ``{"type": "moment", "op": "release", "kind": kind}`` for each kind held, in any
  order. It is an input like any other, so a recording has it at the tick it was made, and a
  replay is held and let go in the same call;
* the frame has two keys more: ``moments``, the list so far in the shape above, and
  ``moment_hold``, the kinds still held. A page that loads a game, or is taken to a position of a
  recording, sees the moments that were and does not show them again, and lets go of what is held.

Conditions are read at the end of every tick, after every action of the manager and when the words
of a model land, so a moment that comes on in a call that simulates nothing (an act in a
conversation) is not late. A page that begins to watch late (a game from before the moments) is
shown at once those whose cause already stands. A tick can make more than one; they wait in
``held`` together. Nothing here draws from the RNG.

Rejections of the action ``moment``: ``over`` (the festival is held), ``watching`` (``watch``
again), ``not_watching`` (``release`` in a game that does not watch), ``not_held`` (``release`` of
a kind that is not held).

The chain of a telling is walked back with ``provenance.walk_back`` from the speaker's belief, on
the real edges of the town's record, so that naming another source or hiding it changes nothing.
The walk reads the beliefs, claims and props it needs one by one and not the whole record.
"""

from __future__ import annotations

import functools
from collections.abc import Iterator, Mapping
from typing import TYPE_CHECKING, Any

from lantern_core.cognition.beliefs import BeliefStore, Claim
from lantern_core.cognition.props import Prop
from lantern_core.cognition.provenance import walk_back
from lantern_core.inputs import InputError
from lantern_core.world.bridge import goals_call, goals_state, goals_work, notes, peace
from lantern_core.world.bridge.converse import ack
from lantern_core.world.bridge.lore import PLAYER, lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.town import Town
    from lantern_core.world.bridge.world import BridgeWorld

KEY = "moments"  # the key of the section in ``state["world"]["goals"]``
ECHO, TOGETHER_WORK, BOTH_BANKS = "echo", "together_work", "both_banks"
KINDS = (ECHO, TOGETHER_WORK, BOTH_BANKS)
OPS = ("watch", "release")
WEST, EAST = "west", "east"
# the tellings a story goes through before it comes back, for the manager to hear it as an echo
MIN_TELLINGS = 2
BRIDGE = goals_work.BRIDGE  # where the moments of the town as a whole are shown
REJECTIONS = ("over", "watching", "not_watching", "not_held")


# ---------------------------------------------------------------------------- reading


def section(world_state: dict[str, Any]) -> dict[str, Any] | None:
    """The section of the moments, or None in a game that nobody watches (and in a world whose
    section ``goals`` is not the festival's)."""
    goals = world_state.get("goals")
    return goals.get(KEY) if isinstance(goals, dict) else None


def watching(world_state: dict[str, Any]) -> bool:
    """Whether the page said that it shows the moments of this game."""
    return section(world_state) is not None


def entries(world_state: dict[str, Any]) -> list[dict[str, Any]]:
    """The moments so far, in the order they happened (empty if the game is not watched)."""
    found = section(world_state)
    return [] if found is None else [dict(item) for item in found["list"]]


def held(world_state: dict[str, Any]) -> list[str]:
    """The kinds of moment the world is held for, oldest first."""
    found = section(world_state)
    return [] if found is None else list(found["held"])


def holding(world_state: dict[str, Any]) -> bool:
    """Whether the world holds its own clock for a moment (``BridgeWorld.halted``)."""
    found = section(world_state)
    return found is not None and bool(found["held"])


def _fired(found: dict[str, Any], kind: str) -> bool:
    return any(item["kind"] == kind for item in found["list"])


def _live(sim: Sim) -> dict[str, Any] | None:
    """The section while the game is watched and the festival is not held yet."""
    found = section(sim.state)
    return found if found is not None and goals_state.live(sim) is not None else None


# ---------------------------------------------------------------------------- where


@functools.cache
def river(town: Town) -> tuple[int, int]:
    """The first and the last column of the river on the map."""
    water = next(entry["char"] for entry in town.data["legend"] if entry["id"] == "river")
    columns = [x for row in town.data["rows"] for x, char in enumerate(row) if char == water]
    return min(columns), max(columns)


def bank_of(town: Town, x: int) -> str:
    """The bank a column is on: ``west`` before the river, ``east`` after it, and for a column
    between its first and last, the nearer side of its middle."""
    first, last = river(town)
    if x < first:
        return WEST
    if x > last:
        return EAST
    return WEST if 2 * x < first + last else EAST


def _spot(world: BridgeWorld, place_id: str) -> tuple[str, int, int]:
    """A place, and the cell of its door."""
    door = world.town.places[place_id].door
    assert door is not None
    return place_id, door[0], door[1]


# ------------------------------------------------------------------------- the chain of a telling


class _Stores(Mapping[str, BeliefStore]):
    """What each person believes, read one person at a time."""

    def __init__(self, social: dict[str, Any]) -> None:
        self._social = social
        self._made: dict[str, BeliefStore] = {}

    def __getitem__(self, holder: str) -> BeliefStore:
        if holder not in self._social["beliefs"]:
            raise KeyError(holder)
        if holder not in self._made:
            self._made[holder] = notes.store(self._social, holder)
        return self._made[holder]

    def __iter__(self) -> Iterator[str]:
        return iter(sorted(self._social["beliefs"]))

    def __len__(self) -> int:
        return len(self._social["beliefs"])


class _Claims(Mapping[str, Claim]):
    """The claims of the town's record, read one at a time."""

    def __init__(self, social: dict[str, Any]) -> None:
        self._social = social

    def __getitem__(self, claim_id: str) -> Claim:
        return notes.decode_claim(claim_id, self._social["claims"][claim_id])

    def __iter__(self) -> Iterator[str]:
        return iter(sorted(self._social["claims"], key=lambda cid: int(cid[1:])))

    def __len__(self) -> int:
        return len(self._social["claims"])


class _Made(Mapping[str, Prop]):
    """The props made on the way, read one at a time."""

    def __init__(self, social: dict[str, Any]) -> None:
        self._social = social

    def __getitem__(self, prop_id: str) -> Prop:
        return notes.decode_prop(prop_id, self._social["props"][prop_id])

    def __iter__(self) -> Iterator[str]:
        return iter(sorted(self._social["props"]))

    def __len__(self) -> int:
        return len(self._social["props"])


def tellings_since(world_state: dict[str, Any], speaker: str, prop_id: str) -> int:
    """How many tellings a telling of ``prop_id`` by ``speaker`` has gone through since the manager
    told it, the speaker being the first of them: 0 if the manager is not upstream of it. The
    count decides whether it is an echo and is not kept or shown.

    The way back is that of the speaker's belief in the prop they say (``provenance.walk_back``),
    and the manager is upstream where a hop was delivered by a claim of the manager's.
    """
    social = world_state["social"]
    if "beliefs" not in social:  # a world without the talk between neighbours
        return 0
    props = notes.PropView(_Made(social), lore().book.props)
    trace = walk_back(speaker, prop_id, _Stores(social), _Claims(social), props)
    for k, hop in enumerate(trace.hops):
        if hop.claim is not None and hop.claim.speaker == PLAYER:
            return k + 1
    return 0


# ---------------------------------------------------------------------------- making a moment


def _fire(
    sim: Sim, found: dict[str, Any], kind: str, place: str, x: int, y: int, **more: Any
) -> None:
    """Add a moment, once, and hold the world for it."""
    if _fired(found, kind):
        return
    fields: dict[str, Any] = {"place": place, "x": x, "y": y, **more}
    found["list"].append({"kind": kind, "tick": sim.ctx.tick, **fields})
    found["held"].append(kind)
    sim.emit("moment", moment=kind, **fields)


def _both_banks(sim: Sim, found: dict[str, Any]) -> None:
    if _fired(found, BOTH_BANKS):
        return
    lay, town = goals_call.lay(sim.world), sim.world.town
    households = sim.state["goals"]["call"]["households"]
    banks = {bank_of(town, lay.household[home].door[0]) for home in households}
    if banks >= {WEST, EAST}:
        _fire(sim, found, BOTH_BANKS, *_spot(sim.world, BRIDGE))


def _together_work(sim: Sim, found: dict[str, Any]) -> None:
    if _fired(found, TOGETHER_WORK):
        return
    days = peace.eased(sim.state)["work"]
    if days:
        _fire(sim, found, TOGETHER_WORK, *_spot(sim.world, BRIDGE), round=days[0])


def _echo(sim: Sim, found: dict[str, Any], speaker: str, prop_id: str) -> None:
    if _fired(found, ECHO):
        return
    if tellings_since(sim.state, speaker, prop_id) >= MIN_TELLINGS:
        me = sim.state["player"]
        place = sim.state["npcs"]["list"][sim.world.cast.index[speaker]]["place"]
        _fire(sim, found, ECHO, place, me["x"], me["y"], prop=prop_id, **{"from": speaker})


def look(sim: Sim) -> None:
    """The moments that come on with the state of the town: the lanterns on both banks and the
    morning of work by both families. Called at the end of every tick and after every action."""
    found = _live(sim)
    if found is not None:
        _together_work(sim, found)
        _both_banks(sim, found)


def after_action(sim: Sim, events: list[dict[str, Any]]) -> None:
    """Look at what an action of the manager made (``events``, those it emitted) or the words of a
    person that landed (a result of a model): each telling the manager was given may be an echo, and
    the town may have changed so that another moment is due.

    The tellings are those the call put in ``Sim.told``, in the order they were said: the answer of
    the rules to a question, with the account that a person keeps in mind against it when they said
    that too, and the claims in the words that a model wrote for the person. A telling heard by
    listening (``heard``) is read from the event."""
    found = _live(sim)
    if found is None:
        return
    for speaker, prop in sim.told:
        _echo(sim, found, speaker, prop)
    for event in events:
        if event["kind"] == "heard":
            _echo(sim, found, event["speaker"], event["prop"])
    look(sim)


# ---------------------------------------------------------------------------- the action


def validate(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    """``{"op": "watch"}`` or ``{"op": "release", "kind": kind}``."""
    where = "player action moment"
    op = body.get("op")
    if op not in OPS:
        raise InputError(f"{where}: op must be one of {', '.join(OPS)}")
    out: dict[str, Any] = {"action_id": body["action_id"], "type": "moment", "op": op}
    if op == "release":
        kind = body.get("kind")
        if kind not in KINDS:
            raise InputError(f"{where}: kind must be one of {', '.join(KINDS)}")
        out["kind"] = kind
    return out


def apply(sim: Sim, body: dict[str, Any]) -> None:
    """``watch`` begins the section, once; ``release`` lets the world go on from a moment."""
    if goals_state.live(sim) is None:
        return ack(sim, body, "over")
    found = section(sim.state)
    if body["op"] == "watch":
        if found is not None:
            return ack(sim, body, "watching")
        sim.state["goals"][KEY] = {"list": [], "held": []}
        return ack(sim, body)
    if found is None:
        return ack(sim, body, "not_watching")
    if body["kind"] not in found["held"]:
        return ack(sim, body, "not_held")
    found["held"].remove(body["kind"])
    ack(sim, body)


ACTIONS = {"moment": (validate, apply)}


# ---------------------------------------------------------------------------- the frame


def frame(world_state: dict[str, Any], out: dict[str, Any]) -> None:
    """``moments`` and ``moment_hold``, in the frame of a game that is watched (and in no other)."""
    if watching(world_state):
        out["moments"] = entries(world_state)
        out["moment_hold"] = held(world_state)
