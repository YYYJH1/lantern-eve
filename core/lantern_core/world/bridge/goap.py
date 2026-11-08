"""A small goal-oriented action planner for the errands people run.

A goal says what should be true at the end and a start says what is true now. The planner has a
few actions, each with a precondition and an effect, and finds the shortest list of them that
reaches the goal, by breadth-first search over a state of three facts. It is the textbook GOAP
loop made small: the search space is a few dozen states, so the answer is exact and it costs
microseconds. Nothing here is random, nothing is asked of a model, and a plan is a plain list
that sits in the world state.

The facts of a state are ``(at, holding, done)``: the place the person is at (``""`` when
unknown, at the start of an errand), the item in their hands (``""`` for none), and whether the
goal's closing act (a delivery or a spell of work) has happened.

The actions, with ``P`` the place they name:

=========  ===========================  ===========================================
action     precondition                 effect
=========  ===========================  ===========================================
goto P     not already at P             at = P
take P     at P, hands empty            holding = the item
drop P     at P, holding something      holding = nothing, done
work P     at P                         done
=========  ===========================  ===========================================

Goals: ``goto`` (be at a place), ``fetch`` (hold an item taken at a place), ``deliver`` (put
what is in the hands down at a place), ``carry`` (take an item at one place and put it down at
another), ``work`` (spend a number of ticks at a place).

A step is ``[op, place, item, number]`` with ``number`` the quantity of a ``take`` and the ticks
of a ``work``, and ``""`` and ``0`` where they mean nothing. The ``drop`` of a ``carry`` names
the item, so that a person who holds something else cannot finish it by putting that down. The
runner is in ``tasks``.
"""

from __future__ import annotations

from collections import deque
from typing import Any

GOTO, TAKE, DROP, WORK = "goto", "take", "drop", "work"
GOALS = ("goto", "fetch", "deliver", "carry", "work")

State = tuple[str, str, bool]
Step = list[Any]


class PlanError(ValueError):
    """The goal cannot be reached from where the person stands."""


def _applicable(step: Step, state: State) -> bool:
    op, place, item = step[0], step[1], step[2]
    at, holding, _ = state
    if op == GOTO:
        return at != place
    if op == TAKE:
        return at == place and holding == ""
    if op == DROP:
        # a drop that names an item puts down that item only; one that does not, anything
        return at == place and holding != "" and (item == "" or holding == item)
    return at == place  # work


def _apply(step: Step, state: State) -> State:
    op, place, item = step[0], step[1], step[2]
    at, holding, done = state
    if op == GOTO:
        return (place, holding, done)
    if op == TAKE:
        return (at, item, done)
    if op == DROP:
        return (at, "", True)
    return (at, holding, True)  # work


def _actions(goal: dict[str, Any]) -> list[Step]:
    """The actions that can matter for ``goal``, in the order the search tries them."""
    kind = goal["kind"]
    if kind == "goto":
        return [[GOTO, goal["place"], "", 0]]
    if kind == "fetch":
        return [[GOTO, goal["place"], "", 0], [TAKE, goal["place"], goal["item"], goal["qty"]]]
    if kind == "deliver":
        return [[GOTO, goal["place"], "", 0], [DROP, goal["place"], "", 0]]
    if kind == "carry":
        return [
            [GOTO, goal["src"], "", 0],
            [GOTO, goal["dst"], "", 0],
            [TAKE, goal["src"], goal["item"], goal["qty"]],
            [DROP, goal["dst"], goal["item"], 0],
        ]
    if kind == "work":
        return [[GOTO, goal["place"], "", 0], [WORK, goal["place"], "", goal["ticks"]]]
    raise PlanError(f"unknown goal {kind!r}")


def _reached(goal: dict[str, Any], state: State) -> bool:
    at, holding, done = state
    kind = goal["kind"]
    if kind == "goto":
        return at == goal["place"]
    if kind == "fetch":
        return holding == goal["item"]
    if kind == "carry":
        return done and holding == ""
    return done  # deliver, work


def plan(goal: dict[str, Any], holding: str = "") -> list[Step]:
    """The shortest list of steps that reaches ``goal`` for a person holding ``holding``.

    Raises ``PlanError`` if there is none, such as a delivery with empty hands.
    """
    actions = _actions(goal)
    start: State = ("", holding, False)
    parents: dict[State, tuple[State, Step] | None] = {start: None}
    queue = deque([start])
    while queue:
        state = queue.popleft()
        if _reached(goal, state):
            steps: list[Step] = []
            link = parents[state]
            while link is not None:
                state, step = link
                steps.append(list(step))
                link = parents[state]
            steps.reverse()
            return steps
        for step in actions:
            if _applicable(step, state):
                nxt = _apply(step, state)
                if nxt not in parents:
                    parents[nxt] = (state, step)
                    queue.append(nxt)
    raise PlanError(f"no plan for {goal['kind']} from holding {holding!r}")
