"""What the parts of the section ``goals`` do to its state: raise flags, set metrics, finish goals.

``flags`` maps a flag to the tick it was raised, ``metrics`` maps a metric to its value and ``done``
maps a goal to the tick it was done. A flag is raised once and stays up, and a goal that is done
stays done. A goal cannot be done after its deadline (``goals_rules.Goal.deadline``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import goals_rules

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim


def live(sim: Sim) -> dict[str, Any] | None:
    """The section while the game is on, or ``None`` once the last night has ended it."""
    g: dict[str, Any] = sim.state["goals"]
    return None if g["ending"] else g


def finish_goal(sim: Sim, g: dict[str, Any], goal: goals_rules.Goal) -> None:
    """Mark ``goal`` done now, and raise the flag it sets."""
    g["done"][goal.id] = sim.ctx.tick
    sim.emit("goal", goal=goal.id)
    if goal.sets:
        raise_flag(sim, g, goal.sets)


def raise_flag(sim: Sim, g: dict[str, Any], flag: str) -> bool:
    """Raise a flag, once. Raising the flag that a goal sets makes that goal done."""
    if flag in g["flags"]:
        return False
    g["flags"][flag] = sim.ctx.tick
    sim.emit("flag", flag=flag)
    for goal in goals_rules.rules().goals:
        if goal.sets == flag and goal.id not in g["done"]:
            g["done"][goal.id] = sim.ctx.tick
            sim.emit("goal", goal=goal.id)
    return True


def set_metric(g: dict[str, Any], name: str, value: int) -> None:
    """Set a metric, held to the range the script gives it."""
    low, high = goals_rules.rules().metrics[name]
    g["metrics"][name] = max(low, min(high, value))


def expired(flag: str, tick: int) -> bool:
    """Whether the goal that sets ``flag`` has missed its deadline at ``tick``."""
    return any(
        goal.sets == flag and goal.deadline is not None and tick > goal.deadline
        for goal in goals_rules.rules().goals
    )


def evaluate(sim: Sim, g: dict[str, Any]) -> None:
    """Mark every goal whose condition now holds and whose deadline has not passed."""
    tick = sim.ctx.tick
    changed = True
    while changed:
        changed = False
        for goal in goals_rules.rules().goals:
            if goal.id in g["done"] or (goal.deadline is not None and tick > goal.deadline):
                continue
            if goals_rules.holds(goal.done_when, g["flags"], g["metrics"], g["done"]):
                finish_goal(sim, g, goal)
                changed = True
