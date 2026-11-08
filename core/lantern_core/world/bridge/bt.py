"""A small behaviour tree for deciding where a person should be and what they are doing there.

A tree is plain data, nested tuples of three kinds of node:

- ``("select", (child, ...))`` tries its children in order and returns the first decision.
- ``("when", condition, child)`` runs its child only if the named condition holds.
- ``("act", action)`` is a leaf: the named action returns a decision, or ``None`` for none.

A *decision* is ``(mode, act, place)``: which branch decided (``"curfew"``, ``"shelter"``,
``"task"``, ``"detour"`` or ``"routine"``), what the person is doing there, and the id of the
place. The conditions and the actions are functions of a ``Mind`` (see below) that live in the
tables ``CONDITIONS`` and ``ACTIONS``, so the tree reads as a list of rules, the first one that
applies wins, and the order of the rules is the priority:

1. At night everyone but the night shift goes home and sleeps (the curfew).
2. In heavy rain someone who would be out in the open goes to the nearest roof.
3. Someone with an errand to run goes and runs it.
4. Someone on a detour that the night's thinking over chose (``reflection``) goes and takes it.
5. Otherwise the routine says.

Nothing in a tree is random and nothing asks a model. A tree is evaluated once per person per
tick, which is cheap, so no one holds a decision between ticks that could go stale.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import clock, weather

if TYPE_CHECKING:
    from lantern_core.world.bridge.people import Person
    from lantern_core.world.bridge.sim import Sim

Node = tuple[Any, ...]
Decision = tuple[str, str, str]

SELECT, WHEN, ACT = "select", "when", "act"
CURFEW, SHELTER, TASK, DETOUR, ROUTINE = "curfew", "shelter", "task", "detour", "routine"
MODES = (CURFEW, SHELTER, TASK, DETOUR, ROUTINE)
DETOURS = (
    "reflection"  # the section that holds the detours in hand (``going``), if the world has it
)

TREE: Node = (
    SELECT,
    (
        (WHEN, "is_curfew", (ACT, "go_home")),
        (WHEN, "is_caught_out_in_heavy_rain", (ACT, "take_shelter")),
        (WHEN, "has_an_errand", (ACT, "run_the_errand")),
        (WHEN, "is_on_a_detour", (ACT, "take_the_detour")),
        (ACT, "follow_the_routine"),
    ),
)


class Mind:
    """What the rules of the tree look at: the person, their state, and the world around."""

    __slots__ = ("job", "npc", "person", "routine", "sim")

    def __init__(self, sim: Sim, person: Person, npc: dict[str, Any]) -> None:
        self.sim = sim
        self.person = person
        self.npc = npc
        # the errand the task runner set for this person this tick, or None
        self.job: dict[str, Any] | None = sim.state["tasks"]["jobs"].get(person.id)
        self.routine = person.entry_at(sim.now.cycle_tick)

    def intended_place(self) -> str:
        """Where the person would go if nothing interfered: the errand's place or the routine's."""
        return self.job["place"] if self.job is not None else self.routine[2]


def is_curfew(mind: Mind) -> bool:
    return mind.sim.now.phase == clock.NIGHT and not mind.person.night_shift


def is_caught_out_in_heavy_rain(mind: Mind) -> bool:
    if weather.today(mind.sim.state) != weather.HEAVY_RAIN:
        return False
    return not mind.sim.world.town.places[mind.intended_place()].indoor


def has_an_errand(mind: Mind) -> bool:
    return mind.job is not None


def detour_of(sim: Sim, person_id: str) -> list[Any] | None:
    """The detour ``person_id`` is on, ``[place, until, act, x, y]``, or None. It is kept by the
    section ``reflection``, which says when it begins and when it is over."""
    section = sim.state.get(DETOURS)
    going = section.get("going") if isinstance(section, dict) else None
    return going.get(person_id) if going else None


def is_on_a_detour(mind: Mind) -> bool:
    return detour_of(mind.sim, mind.person.id) is not None


def go_home(mind: Mind) -> Decision:
    return (CURFEW, "sleep", mind.person.home)


def take_shelter(mind: Mind) -> Decision:
    npc = mind.npc
    if not npc["shelter"]:
        world = mind.sim.world
        grid = world.walking_grid(mind.sim.state)
        npc["shelter"] = world.town.nearest_shelter(npc["x"], npc["y"], grid)
    return (SHELTER, "shelter", npc["shelter"])


def run_the_errand(mind: Mind) -> Decision | None:
    job = mind.job
    return None if job is None else (TASK, job["act"], job["place"])


def take_the_detour(mind: Mind) -> Decision | None:
    going = detour_of(mind.sim, mind.person.id)
    return None if going is None else (DETOUR, going[2], going[0])


def follow_the_routine(mind: Mind) -> Decision:
    return (ROUTINE, mind.routine[1], mind.routine[2])


CONDITIONS = {
    "is_curfew": is_curfew,
    "is_caught_out_in_heavy_rain": is_caught_out_in_heavy_rain,
    "has_an_errand": has_an_errand,
    "is_on_a_detour": is_on_a_detour,
}
ACTIONS = {
    "go_home": go_home,
    "take_shelter": take_shelter,
    "run_the_errand": run_the_errand,
    "take_the_detour": take_the_detour,
    "follow_the_routine": follow_the_routine,
}


def run(node: Node, mind: Mind) -> Decision | None:
    """Evaluate ``node`` for ``mind``: the first decision of the tree, or ``None``."""
    kind = node[0]
    if kind == SELECT:
        for child in node[1]:
            decision = run(child, mind)
            if decision is not None:
                return decision
        return None
    if kind == WHEN:
        return run(node[2], mind) if CONDITIONS[node[1]](mind) else None
    return ACTIONS[node[1]](mind)


def decide(sim: Sim, person: Person, npc: dict[str, Any]) -> Decision:
    """What ``person`` does this tick. The routine always has an answer."""
    decision = run(TREE, Mind(sim, person, npc))
    assert decision is not None
    return decision
