"""The peace between the two families, made of deeds the town can see.

The goal ``g_reconcile`` is met when the grudge between the heads of the two families (the metric
``grudge``, the larger of what each holds against the other, from 0 to 100) is under thirty and a
reconciliation was seen (a table for both heads with witnesses, ``assembly``). No one deed does it.
Three kinds lower the grudge, and the board lists them as ``peace.acts`` in the order a player
does them:

``stop_blaming``    a clarification that somebody took in is made in front of a head of a family
                    (``assembly``), or a head who was not there comes to know of it (the town
                    carries it on from the people who were): the head, who hears the town say
                    that the claim went beyond what the witness saw, stops accusing in public,
                    and their grudge falls by ``STOP_DROP``, once. The act is done as well once
                    the truth is told in public (the heads who accept it let go of
                    ``assembly.GRUDGE_DROP`` each).
``work_together``   from the third day, on a morning when helpers of both families finish an hour
                    of work at the bridge (the errands ``tasks`` keeps as done), the grudge of
                    both heads falls by ``WORK_DROP``. The first ``WORK_MORNINGS`` such mornings
                    count, each once. A morning of heavy rain, or without a helper of one of the
                    families, does not.
``witnessed_meal``  the table for both heads with at least three others there (``assembly``):
                    ``assembly.MEAL_DROP``, or ``assembly.MEAL_DROP_AFTER_TRUTH`` once the truth
                    is told. It raises the flag ``reconcile_seen``.

So a meal alone does not make the peace: with the grudge at 67 the table after the truth takes it to
43, and it takes the clarification and a morning of work besides to bring it under thirty. The deeds
are public (a clarification, the helpers at the bridge, a table), and none reads what is true in the
game.

State. The deeds already done are kept in the public record of the speeches of the manager
(``state["world"]["player"]["public"]["eased"]``, there once a deed has been done) as ``{"stop":
[the heads who stopped accusing], "work": [the days of the mornings counted]}``. Event: ``eased``
(``act``, and ``npc`` for the head who stopped accusing or ``day`` for the morning, and ``amount``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import bonds, clock, goals_call, goals_work, tasks
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

STOP, WORK, MEAL = "stop_blaming", "work_together", "witnessed_meal"
ACTS = (STOP, WORK, MEAL)  # in the order a player does them
HEADS = goals_call.HEADS
STOP_DROP = 8
WORK_DROP = 10
WORK_MORNINGS = 2
WATCH_STRIDE = 10
NOTE = "eased"


# ---------------------------------------------------------------------------- the grudge


def lower_grudge(world_state: dict[str, Any], head: str, amount: int) -> None:
    """Lower the grudge of one family head against the other by ``amount``."""
    lo, social = lore(), world_state["social"]
    other = HEADS[1] if head == HEADS[0] else HEADS[0]
    left = amount
    while left > 0:
        step = min(bonds.MAX_STEP, left)
        bonds.nudge(social, lo, head, other, bonds.GRUDGE, -step)
        left -= step


# ---------------------------------------------------------------------------- what is done


def eased(world_state: dict[str, Any]) -> dict[str, list[Any]]:
    """The deeds done so far: the heads who stopped accusing, the days of the mornings counted."""
    found = world_state["player"]["public"].get(NOTE)
    if not found:
        return {"stop": [], "work": []}
    return {"stop": list(found["stop"]), "work": list(found["work"])}


def _record(world_state: dict[str, Any]) -> dict[str, list[Any]]:
    record: dict[str, list[Any]] = world_state["player"]["public"].setdefault(
        NOTE, {"stop": [], "work": []}
    )
    return record


def _stop(sim: Sim, head: str) -> None:
    _record(sim.state)["stop"].append(head)
    lower_grudge(sim.state, head, STOP_DROP)
    sim.emit("eased", act=STOP, npc=head, amount=STOP_DROP)


def stop_blaming(sim: Sim, here: list[str]) -> list[str]:
    """A clarification that somebody took in was made in front of ``here``: every head who is there
    stops accusing in public, once. The heads who did."""
    stopped: list[str] = []
    for head in HEADS:
        if head not in here or head in eased(sim.state)["stop"]:
            continue
        _stop(sim, head)
        stopped.append(head)
    return stopped


def hear_of_it(sim: Sim) -> list[str]:
    """A head who was not there when a clarification was made, and has come to know of it since,
    stops accusing in public as well, once. The heads who did."""
    # not at the top: clarify reads the terms, which read this module
    from lantern_core.world.bridge import clarify

    stopped: list[str] = []
    for head in HEADS:
        if head in eased(sim.state)["stop"] or not clarify.knows_claim(sim.state, head):
            continue
        _stop(sim, head)
        stopped.append(head)
    return stopped


def side_by_side(world: BridgeWorld, world_state: dict[str, Any]) -> dict[int, set[str]]:
    """The mornings of work at the bridge, by day: the families whose helpers finished an hour of
    it, read off the errands that are done. Only from the third day on."""
    family = goals_call.lay(world).family
    found: dict[int, set[str]] = {}
    for task in world_state["tasks"]["done"]:
        steps = task["steps"]
        if task["kind"] != "work" or task["status"] != tasks.DONE or not steps:
            continue
        if steps[-1][1] != goals_work.BRIDGE:
            continue
        day = clock.at(task["ended"]).day
        kin = family.get(task["npc"])
        if day >= goals_work.WORK_FROM_DAY and kin is not None:
            found.setdefault(day, set()).add(kin)
    return found


def watch(sim: Sim) -> None:
    """Every ``WATCH_STRIDE`` ticks: a head who has come to know of the clarification stops
    accusing, and a morning of work with helpers of both families that has not been counted yet
    lowers the grudge of both heads."""
    if sim.ctx.tick % WATCH_STRIDE:
        return
    if "bonds" not in sim.state["social"]:  # a world without the talk of the town
        return
    hear_of_it(sim)
    if sim.now.day < goals_work.WORK_FROM_DAY:
        return
    mornings = side_by_side(sim.world, sim.state)
    both = len(goals_call.lay(sim.world).families)
    for day in sorted(mornings):
        done = eased(sim.state)["work"]
        if len(mornings[day]) < both or day in done or len(done) >= WORK_MORNINGS:
            continue
        _record(sim.state)["work"].append(day)
        for head in HEADS:
            lower_grudge(sim.state, head, WORK_DROP)
        sim.emit("eased", act=WORK, day=day, amount=WORK_DROP)


# ---------------------------------------------------------------------------- for the board


def done(world_state: dict[str, Any]) -> dict[str, bool]:
    """Which of the deeds of ``ACTS`` are done."""
    flags = world_state["goals"]["flags"]
    record = eased(world_state)
    return {
        STOP: bool(record["stop"]) or "truth_told" in flags,
        WORK: bool(record["work"]),
        MEAL: "reconcile_seen" in flags,
    }
