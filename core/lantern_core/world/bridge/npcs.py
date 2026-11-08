"""The people: where each one is, what the behaviour tree decided, and the walking.

Each tick every person is run through the tree in ``bt``, which gives a place and an activity,
and then walks one cell along the cheapest route to the cell they stand on there. The routes
are shortest-path fields over the town grid (``grid.Grid``), one per goal cell, cached and
shared, as in m0. A person walks on the ticks where ``(tick + index) % period == 0``, with the
period ``move_day`` by day and ``move_night`` by night, so the town does not step as one body.
A night tick is four times as long in game time as a day tick, which is why the pace at night is
the faster one in ticks. A person who has reached the goal and is not asleep fidgets, with
probability ``fidget_per_mille`` / 1000 per turn, one cell off the goal and comes back; that is
the only random draw here.

State (``state["world"]["npcs"]``)::

    {"list": [{"id", "x", "y",
               "goal": [x, y]     the cell the person is heading for,
               "place": str       the place they are heading for,
               "act": str         what they do there,
               "mode": str        which rule of the tree decided: curfew, shelter, task, detour,
                                  routine,
               "shelter": str     the roof they chose in a heavy rain, or "",
               "carry": item id or None, "qty": int}, ...]}

in cast order. At the start everyone is at home, on the cell where the last entry of their
routine puts them.

A person is *at* a place when they are within one cell of the goal. The ``activity`` of a frame
is the ``act`` once they are there, ``walk`` on the way, and ``carry`` on the way with a load.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import bt, clock, weather

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "npcs"

FIDGET_RADIUS = 1
NEAR = 1

STATUS_SLEEP, STATUS_LOAD, STATUS_UMBRELLA = "sleep", "load", "umbrella"


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    people = []
    for person in world.cast.people:
        act, place = person.routine[-1][1], person.routine[-1][2]
        x, y = world.town.stand(place, person.index)
        people.append(
            {
                "id": person.id,
                "x": x,
                "y": y,
                "goal": [x, y],
                "place": place,
                "act": act,
                "mode": bt.ROUTINE,
                "shelter": "",
                "carry": None,
                "qty": 0,
            }
        )
    return {"list": people}


def is_at_goal(npc: dict[str, Any]) -> bool:
    """Whether the person is within a cell of the goal."""
    return max(abs(npc["x"] - npc["goal"][0]), abs(npc["y"] - npc["goal"][1])) <= NEAR


def tick(sim: Sim) -> None:
    world, now, ctx = sim.world, sim.now, sim.ctx
    town = world.town
    grid = world.walking_grid(sim.state)
    period = world.move_day if now.phase == clock.DAY else world.move_night
    fidget = world.config["fidget_per_mille"]
    rng = ctx.rng
    for i, npc in enumerate(sim.state["npcs"]["list"]):
        person = world.cast.people[i]
        mode, act, place = bt.decide(sim, person, npc)
        if mode != bt.SHELTER and npc["shelter"]:
            npc["shelter"] = ""
        goal_x, goal_y = town.stand(place, i)
        if mode == bt.DETOUR:  # a detour may name the cell, to stand by the person it is to call on
            cell = bt.detour_of(sim, person.id)
            if cell is not None and cell[3] >= 0:
                goal_x, goal_y = cell[3], cell[4]
        npc["place"], npc["act"], npc["mode"] = place, act, mode
        if npc["goal"][0] != goal_x or npc["goal"][1] != goal_y:
            npc["goal"] = [goal_x, goal_y]
        if (ctx.tick + i) % period:
            continue
        here = grid.index(npc["x"], npc["y"])
        goal = grid.index(goal_x, goal_y)
        if here == goal:
            if act != "sleep" and fidget and rng.below(1000) < fidget:
                near = [
                    n
                    for n in grid.neighbours(here)
                    if max(abs(grid.xy(n)[0] - goal_x), abs(grid.xy(n)[1] - goal_y))
                    <= FIDGET_RADIUS
                ]
                if near:
                    npc["x"], npc["y"] = grid.xy(near[rng.below(len(near))])
            continue
        step = grid.best_step(here, grid.field(goal))
        if step != here:
            npc["x"], npc["y"] = grid.xy(step)


def activity(npc: dict[str, Any]) -> str:
    """What the person is seen doing: the act at the goal, walking (or carrying) on the way."""
    if is_at_goal(npc):
        return npc["act"]
    return "carry" if npc["carry"] else "walk"


def status_icon(world: BridgeWorld, npc: dict[str, Any], kind: str) -> str | None:
    """The small icon above the head of a person, or None. Sleep, then a load, then rain."""
    at_goal = is_at_goal(npc)
    if at_goal and npc["act"] == "sleep":
        return STATUS_SLEEP
    if npc["carry"]:
        return STATUS_LOAD
    if kind != weather.CLEAR and not (at_goal and world.town.places[npc["place"]].indoor):
        return STATUS_UMBRELLA
    return None


def frame(world: BridgeWorld, state: dict[str, Any], out: dict[str, Any]) -> None:
    """Fill ``out["npcs"]``: id, cell, activity, what is carried, and an optional status icon."""
    kind = out["weather"]
    people = []
    for npc in state["world"]["npcs"]["list"]:
        entry: dict[str, Any] = {
            "id": npc["id"],
            "x": npc["x"],
            "y": npc["y"],
            "activity": activity(npc),
            "carrying": npc["carry"],
        }
        icon = status_icon(world, npc, kind)
        if icon is not None:
            entry["status"] = icon
        people.append(entry)
    out["npcs"] = people
