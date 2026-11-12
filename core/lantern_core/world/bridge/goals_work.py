"""The work of the festival: materials for the bridge, the crew's hours, the lane and its lanterns.

Everything here asks people to do things through ``tasks.assign`` and reads the books of
``tasks`` to see what came of it.

*Materials.* The bamboo lies at the Li house and the timber at the Zhou house, and each can be
had from one man only. Once he has agreed (``agree_material``) he carries ``NEED[item]`` of it to
the bridge. The flag ``bamboo_delivered`` or ``timber_delivered`` is raised when that much lies at
the bridge, whoever brought it. In a game made with the config ``goods`` set to ``promised`` he
promises a batch for a time instead, and carries it then (``commitments``): the bridge may have to
be given the rest in more than one batch.

*Hours.* The bridge needs ``BRIDGE_HOURS`` person-hours. The ticks of work done at the bridge count
from day ``WORK_FROM_DAY`` on, whoever does them, but not in a heavy rain nor after the deadline of
the goal ``g_labor``, and never beyond what the bridge needs. Each morning of a working day the
helpers who have joined are asked to work ``WORK_HOURS`` hour at the bridge, if there are enough of
them, with at least one of each family (``goals_call.crew_ready``), and the work is not done. A
helper who still has such an errand in the queue, because a rain kept them off it, is not asked
again. So a morning's work is as many hours as there are helpers, an hour each: five helpers, the
crew the call is for, do five of the ten hours on the third morning and the rest on the fourth, a
morning lost to rain is a morning less, and the deadline (day 4, 18:00) can be missed. It takes ten
helpers to do it in one.

*The lane.* The temple keeper works ``LANE_HOURS`` hour at the lane when she has agreed
(``agree_lane``), and the barrier is open when she is done (``lane_opened``). Then, in the
afternoon, helpers are asked to hang lanterns there, an hour each, until ``DETOUR_WORKERS`` have
(``lamps_hung`` and the metric ``detour_workers``). A helper has one errand at a time: one who is
at the lane is not asked to the bridge the same morning, and one who is at the bridge is not asked
to the lane before they are done.
"""

from __future__ import annotations

import functools
from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import clock, goals_call, goals_rules, goals_state, tasks, weather

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

BRIDGE, LANE = "p_bridge", "p_temple_lane"
KEEPER = "miaozhu"

CREW = goals_call.CREW
BRIDGE_HOURS = 10  # person-hours of work the bridge needs
BRIDGE_TICKS = BRIDGE_HOURS * clock.DAY_TICKS_PER_HOUR
WORK_FROM_DAY = 3
WORK_START_HOUR, WORK_END_HOUR = 8, 12
WORK_HOURS = 1
LAMP_START_HOUR, LAMP_END_HOUR = 13, 17
LAMP_HOURS = 1
LANE_HOURS = 1
DETOUR_WORKERS = 3

# who brings what, and from where
SUPPLIERS = {
    "li_da": ("bamboo", "p_li_house"),
    "zhou_zhanggui": ("timber", "p_zhou_house"),
}
NEED = {"bamboo": 10, "timber": 8}  # how much of each the bridge needs
DELIVERED = {"bamboo": "bamboo_delivered", "timber": "timber_delivered"}
LANE_OPENED, LAMPS_HUNG = "lane_opened", "lamps_hung"
BRIDGE_FIXED, DETOUR_DONE = "bridge_fixed", "detour_done"

HANDS = {"zh": "人手", "en": "hands"}
BOTH_FAMILIES = {"zh": "两家的人", "en": "helpers from both families"}


@functools.cache
def labor_deadline() -> int:
    """The tick after which work on the bridge no longer counts: the deadline of ``g_labor``."""
    deadline = next(g.deadline for g in goals_rules.rules().goals if g.id == "g_labor")
    assert deadline is not None
    return deadline


def check_flags() -> None:
    """Fail if the script lacks a flag that this module raises."""
    known = goals_rules.rules().flags
    for flag in (*DELIVERED.values(), LANE_OPENED, LAMPS_HUNG, BRIDGE_FIXED, DETOUR_DONE):
        assert flag in known, flag


# ---------------------------------------------------------------------------- agreeing


def _open_ids(sim: Sim) -> list[int]:
    return [task["id"] for task in sim.state["tasks"]["queue"]]


def _outcome(sim: Sim, task_id: int) -> str | None:
    """How a task that is no longer in the queue ended: ``done`` or ``failed``."""
    for task in reversed(sim.state["tasks"]["done"]):
        if task["id"] == task_id:
            return str(task["status"])
    return None


def agree_material(sim: Sim, g: dict[str, Any], person: str) -> int:
    """Post the delivery of the bamboo or the timber by the man who has it. The task id, or 0.

    In a game made with the config ``goods`` set to ``promised`` he promises it for a time instead
    (``commitments.promise``), and the number returned is that of the promise."""
    supplier = SUPPLIERS.get(person)
    if supplier is None:
        return 0
    item, source = supplier
    if DELIVERED[item] in g["flags"]:
        return 0
    from lantern_core.world.bridge import commitments  # not at the top: it reads this module

    if commitments.promises_goods(sim.world):  # the goods are promised for a time, not sent now
        return commitments.promise(sim, g, person)
    before = g["supply"].get(item)
    if before and (before in _open_ids(sim) or _outcome(sim, before) == tasks.DONE):
        return 0
    try:
        task = tasks.assign(
            sim.world,
            sim.state,
            {
                "npc": person,
                "kind": "carry",
                "item": item,
                "qty": NEED[item],
                "src": source,
                "dst": BRIDGE,
            },
        )
    except tasks.TaskError:
        return 0
    g["supply"][item] = task
    sim.emit("agreed", npc=person, what=item)
    return task


def agree_lane(sim: Sim, g: dict[str, Any], person: str) -> int:
    """Post the temple keeper's hour of work at the lane. The task id, or 0."""
    if person != KEEPER or LANE_OPENED in g["flags"] or g["lane"]["task"]:
        return 0
    try:
        task = _ask(sim, person, LANE, LANE_HOURS)
    except tasks.TaskError:
        return 0
    g["lane"]["task"] = task
    sim.emit("agreed", npc=person, what="lane")
    return task


def _ask(sim: Sim, person: str, place: str, hours: int) -> int:
    return tasks.assign(
        sim.world, sim.state, {"npc": person, "kind": "work", "place": place, "hours": hours}
    )


# ---------------------------------------------------------------------------- watching


def watch(sim: Sim, g: dict[str, Any]) -> None:
    """See what the errands came to: the lane, the lanterns, the materials and the hours."""
    _watch_lane(sim, g)
    at_bridge = sim.state["tasks"]["stock"].get(BRIDGE, {})
    for item, flag in DELIVERED.items():
        if flag not in g["flags"] and at_bridge.get(item, 0) >= NEED[item]:
            goals_state.raise_flag(sim, g, flag)
    _count_work(sim, g)


def _watch_lane(sim: Sim, g: dict[str, Any]) -> None:
    lane = g["lane"]
    if not lane["task"] and not lane["lamps"]:
        return
    open_ids = _open_ids(sim)
    if lane["task"] and lane["task"] not in open_ids:
        if _outcome(sim, lane["task"]) == tasks.DONE:
            goals_state.raise_flag(sim, g, LANE_OPENED)
        lane["task"] = 0
    for person in sorted(lane["lamps"]):
        task = lane["lamps"][person]
        if task in open_ids:
            continue
        if _outcome(sim, task) == tasks.DONE and person not in lane["hung"]:
            lane["hung"].append(person)
        del lane["lamps"][person]


def _count_work(sim: Sim, g: dict[str, Any]) -> None:
    """Count the ticks of work at the bridge since the last look, if they count."""
    work = g["work"]
    worked = sim.state["tasks"]["worked"].get(BRIDGE, 0)
    new, work["seen"] = worked - work["seen"], worked
    if new <= 0 or sim.now.day < WORK_FROM_DAY:
        return
    if sim.ctx.tick > labor_deadline() or weather.today(sim.state) == weather.HEAVY_RAIN:
        return
    work["ticks"] = min(BRIDGE_TICKS, work["ticks"] + new)


def numbers(sim: Sim, g: dict[str, Any]) -> None:
    """Set the metrics this module owns, and raise ``lamps_hung`` when enough lanterns are hung."""
    goals_state.set_metric(g, "work_progress", g["work"]["ticks"] * 100 // BRIDGE_TICKS)
    goals_state.set_metric(g, "detour_workers", len(g["lane"]["hung"]))
    if lamps_hung(g):
        goals_state.raise_flag(sim, g, LAMPS_HUNG)


# ---------------------------------------------------------------------------- orders


def orders(sim: Sim, g: dict[str, Any]) -> None:
    """Ask people to work: the crew in the morning, the lantern-hangers in the afternoon."""
    if weather.today(sim.state) == weather.HEAVY_RAIN:
        return
    hour = sim.now.hour
    if WORK_START_HOUR <= hour < WORK_END_HOUR:
        _work_orders(sim, g)
    elif LAMP_START_HOUR <= hour < LAMP_END_HOUR:
        _lamp_orders(sim, g)


def _work_orders(sim: Sim, g: dict[str, Any]) -> None:
    now, call = sim.now, g["call"]
    if now.day < WORK_FROM_DAY or sim.ctx.tick > labor_deadline() or "g_labor" in g["done"]:
        return
    if not call["joined"] or not goals_call.crew_ready(sim.world, call):
        return
    ordered = g["work"]["ordered"]
    for person in goals_call.joined_ids(call):
        if ordered.get(person) == now.day or person in g["lane"]["lamps"]:
            continue  # asked already, or at the lane: one errand at a time
        ordered[person] = now.day
        if not _at_the_bridge(sim, person):
            _ask(sim, person, BRIDGE, WORK_HOURS)


def _lamp_orders(sim: Sim, g: dict[str, Any]) -> None:
    lane = g["lane"]
    if LANE_OPENED not in g["flags"]:
        return
    short = DETOUR_WORKERS - len(lane["hung"]) - len(lane["lamps"])
    for person in goals_call.joined_ids(g["call"]):
        if short <= 0:
            return
        if person in lane["hung"] or person in lane["lamps"] or _at_the_bridge(sim, person):
            continue
        lane["lamps"][person] = _ask(sim, person, LANE, LAMP_HOURS)
        short -= 1


def _at_the_bridge(sim: Sim, person: str) -> bool:
    """Whether ``person`` still has an hour of work at the bridge in the queue."""
    return any(
        task["kind"] == "work" and task["steps"][-1][1] == BRIDGE
        for task in tasks.open_tasks(sim.state, person)
    )


# ---------------------------------------------------------------------------- the bridge


def lamps_hung(g: dict[str, Any]) -> bool:
    """Whether enough lanterns have been hung along the lane."""
    return len(g["lane"]["hung"]) * LAMP_HOURS >= DETOUR_WORKERS


def passage(flags: dict[str, int]) -> str:
    """How the festival can walk: ``mended``, ``detour`` or ``none``."""
    return "mended" if BRIDGE_FIXED in flags else "detour" if DETOUR_DONE in flags else "none"


def bridge_state(g: dict[str, Any]) -> str:
    """``broken``, ``repairing``, ``mended`` or ``detour``."""
    how = passage(g["flags"])
    if how != "none":
        return how
    return "repairing" if g["work"]["ticks"] else "broken"


def lacking(world: BridgeWorld, g: dict[str, Any]) -> str | dict[str, str] | None:
    """What stops the bridge from being mended: a material (its item id), hands, or nothing."""
    for item in ("bamboo", "timber"):
        if DELIVERED[item] not in g["flags"]:
            return item
    call = g["call"]
    if goals_call.crew_ready(world, call):
        return None
    return HANDS if len(call["joined"]) < CREW else BOTH_FAMILIES


def shortfall(world: BridgeWorld, g: dict[str, Any]) -> tuple[int, list[str]]:
    """How many helpers the work still lacks for the next morning, and the families with nobody in
    the crew yet. Both are nothing once the crew is ready, and once the bridge is mended or the
    detour is done.

    The crew is ``CREW`` helpers with one of each family at least (``goals_call.crew_ready``), so
    the helpers still lacking are the larger of the places of the crew not filled and the families
    that have nobody: five helpers of one family lack one, from the other."""
    if passage(g["flags"]) != "none" or "g_labor" in g["done"]:
        return 0, []
    call = g["call"]
    if goals_call.crew_ready(world, call):
        return 0, []
    count, per_family = goals_call.crew(world, call)
    missing = [family for family in goals_call.lay(world).families if per_family[family] == 0]
    return max(CREW - count, len(missing)), missing


def bridge_hud(world: BridgeWorld, g: dict[str, Any]) -> dict[str, Any]:
    """The ``bridge`` entry of the hud."""
    short, missing = shortfall(world, g)
    out: dict[str, Any] = {
        "done": min(len(g["call"]["joined"]), CREW),
        "need": CREW,
        "percent": g["metrics"]["work_progress"],
        "hours": g["work"]["ticks"] // clock.DAY_TICKS_PER_HOUR,
        "hours_need": BRIDGE_HOURS,
        "state": bridge_state(g),
        "short": short,
        "families_missing": missing,
    }
    if passage(g["flags"]) == "none":
        lack = lacking(world, g)
        if lack is not None:
            out["lacking"] = lack
    return out
