"""Errands: fetch an item at a place, carry it, put it down at another, or go and work somewhere.

An errand is a *task*, and tasks come from outside this module. A package that decides that
someone should do something (the player asked a person to bring bamboo to the bridge and the
person agreed) calls ``assign``. No model decides a task, and this module draws no random
number. ``assign`` turns the request into a plan with the planner in ``goap`` and queues it.

Each tick the runner takes, for every person who has a queued task, the first task in the
order they were assigned, and works through its steps:

- ``goto`` is done when the person stands near the place (within one cell of their own cell
  there, see ``Town.stand``).
- ``take`` removes the quantity from the stock at the place and puts it in the person's hands.
  It fails if the stock is short (``no_stock``) or the hands are full (``hands_full``).
- ``drop`` puts the load down into the stock at the place. It fails if the hands hold nothing,
  or not the item the step names (``wrong_hands``).
- ``work`` counts one tick of work for each tick the person stands at the place, and is done
  when it has counted the ticks asked for.

A step whose place the person has left is walked back to: the runner sets the person's *job*,
the place to be at, and the behaviour tree (``bt``) sends them. Errands only run in the day.
At night the jobs are cleared, the curfew sends everyone home, and the errand picks up again at
dawn. A heavy rain keeps people from errands whose place is outdoors in the same way.

State (``state["world"]["tasks"]``)::

    {"next_id": the id the next task gets,
     "queue": [task, ...]        tasks not finished, in the order they were assigned,
     "done": [task, ...]         tasks finished or failed, in the order they ended,
     "jobs": {npc id: {"task": id, "act": str, "place": place id}}
                                 what each person with an open task should do this tick,
     "stock": {place id: {item: quantity}}
                                 what lies at each place, from the holdings of the cast,
     "worked": {place id: ticks} the ticks of work done at each place so far}

A task is ``{"id", "npc", "kind", "steps", "i", "progress", "status", "reason", "started",
"ended"}``: ``steps`` is the plan, ``i`` the step in hand, ``progress`` the ticks worked in a
``work`` step, ``status`` one of ``queued``, ``active``, ``done`` and ``failed``, and
``started`` and ``ended`` the ticks of those moments (-1 until they happen). A failed task says
why in ``reason``.

Events: ``task_start``, ``task_done``, ``task_fail`` (with ``reason``), each with the ``task``
id, the ``npc`` and the kind of task as ``goal``, and ``taken`` and ``delivered`` (with the
``item``, ``qty`` and ``place``), each with the ``task`` id and the ``npc``. An errand that keeps a
promise to the manager (``commitments``) has the number of the promise in its spec as ``commit``,
and its ``delivered`` event has the ``id`` of the promise and the ``amount`` too.

Dicts here are only looked up by key, or walked in sorted order, because a restored dict comes
back in sorted key order.

The player action ``assign``, ``{"action_id", "type": "assign", "npc", "task": {...}}`` with
the fields of ``assign``'s spec, exists only when the config key ``dev_actions`` is 1. It lets
a test or a tool post an errand through the ordinary input path, and replays record it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.inputs import InputError, int_field
from lantern_core.world.bridge import clock, goap

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "tasks"

QUEUED, ACTIVE, DONE, FAILED = "queued", "active", "done", "failed"
NEAR = 1  # Chebyshev distance that counts as being at a place
MAX_QTY = 1000
MAX_HOURS = 24
KIND_FIELDS = {
    "goto": ("place",),
    "fetch": ("item", "place", "qty"),
    "deliver": ("place",),
    "carry": ("item", "src", "dst", "qty"),
    "work": ("place", "hours"),
}


class TaskError(ValueError):
    """A task that cannot be assigned. The message starts with a short reason code."""


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    stock: dict[str, dict[str, int]] = {}
    for person in world.cast.data["people"]:
        for holding in person["holdings"]:
            at = stock.setdefault(holding["at"], {})
            at[holding["item"]] = at.get(holding["item"], 0) + holding["qty"]
    return {"next_id": 1, "queue": [], "done": [], "jobs": {}, "stock": stock, "worked": {}}


# ---------------------------------------------------------------------------- assigning


def goal_of(world: BridgeWorld, spec: dict[str, Any]) -> dict[str, Any]:
    """The planner's goal for ``spec``, after checking every field against the content."""
    kind = spec.get("kind")
    if kind not in KIND_FIELDS:
        raise TaskError(f"bad_kind: {kind!r}")
    missing = [f for f in KIND_FIELDS[kind] if f not in spec]
    if missing:
        raise TaskError(f"missing: {missing}")
    goal: dict[str, Any] = {"kind": kind}
    for name in ("place", "src", "dst"):
        if name in KIND_FIELDS[kind]:
            place = world.town.places.get(spec[name])
            if place is None or place.door is None:
                raise TaskError(f"bad_place: {spec[name]!r}")
            goal[name] = spec[name]
    if "item" in KIND_FIELDS[kind]:
        if spec["item"] not in world.cast.items:
            raise TaskError(f"bad_item: {spec['item']!r}")
        goal["item"] = spec["item"]
    if "qty" in KIND_FIELDS[kind]:
        if type(spec["qty"]) is not int or not 1 <= spec["qty"] <= MAX_QTY:
            raise TaskError(f"bad_qty: {spec['qty']!r}")
        goal["qty"] = spec["qty"]
    if "hours" in KIND_FIELDS[kind]:
        if type(spec["hours"]) is not int or not 1 <= spec["hours"] <= MAX_HOURS:
            raise TaskError(f"bad_hours: {spec['hours']!r}")
        goal["ticks"] = spec["hours"] * clock.DAY_TICKS_PER_HOUR
    return goal


def assign(world: BridgeWorld, world_state: dict[str, Any], spec: dict[str, Any]) -> int:
    """Queue a task for a person and return its id. This is the hook for other subsystems.

    ``spec`` has ``npc`` and ``kind`` and the fields of the kind: ``goto`` and ``deliver`` a
    ``place``; ``fetch`` an ``item``, a ``qty`` and the ``place`` it lies at; ``carry`` an
    ``item``, a ``qty``, the place to take it from (``src``) and the place to put it down
    (``dst``); ``work`` a ``place`` and a number of game ``hours``. Raises ``TaskError`` if the
    person or a field is unknown, or the person's hands rule the errand out (a ``fetch`` or a
    ``carry`` with hands full, a ``deliver`` with hands empty).
    """
    npc_id = spec.get("npc")
    index = world.cast.index.get(npc_id) if isinstance(npc_id, str) else None
    if index is None:
        raise TaskError(f"bad_npc: {npc_id!r}")
    goal = goal_of(world, spec)
    queue = world_state["tasks"]["queue"]
    # what the person will hold when the tasks ahead of this one are done
    holding = world_state["npcs"]["list"][index]["carry"] or ""
    for task in queue:
        if task["npc"] == npc_id:
            holding = _holding_after(task, holding)
    try:
        steps = goap.plan(goal, holding)
    except goap.PlanError as exc:
        raise TaskError(f"no_plan: {exc}") from None
    section = world_state["tasks"]
    task_id = section["next_id"]
    section["next_id"] = task_id + 1
    queue.append(
        {
            "id": task_id,
            "npc": npc_id,
            "kind": goal["kind"],
            "steps": steps,
            "i": 0,
            "progress": 0,
            "status": QUEUED,
            "reason": "",
            "started": -1,
            "ended": -1,
        }
    )
    if "commit" in spec:  # the promise this errand keeps (see ``commitments``)
        queue[-1]["commit"] = spec["commit"]
    return task_id


def _holding_after(task: dict[str, Any], holding: str) -> str:
    """What the hands hold once ``task`` is over, if it goes through."""
    for step in task["steps"]:
        if step[0] == goap.TAKE:
            holding = step[2]
        elif step[0] == goap.DROP:
            holding = ""
    return holding


def open_tasks(world_state: dict[str, Any], npc_id: str) -> list[dict[str, Any]]:
    """The tasks of a person that are not finished, in the order they were assigned."""
    return [t for t in world_state["tasks"]["queue"] if t["npc"] == npc_id]


# ---------------------------------------------------------------------------- the runner


def tick(sim: Sim) -> None:
    section = sim.state["tasks"]
    section["jobs"] = {}
    queue = section["queue"]
    if not queue or sim.now.phase != clock.DAY:
        return
    busy: list[str] = []
    for task in queue:
        if task["npc"] in busy:
            continue
        busy.append(task["npc"])
        _advance(sim, task)
    if any(t["status"] in (DONE, FAILED) for t in queue):
        section["done"].extend(t for t in queue if t["status"] in (DONE, FAILED))
        section["queue"] = [t for t in queue if t["status"] in (QUEUED, ACTIVE)]


def _near(npc: dict[str, Any], cell: tuple[int, int]) -> bool:
    return max(abs(npc["x"] - cell[0]), abs(npc["y"] - cell[1])) <= NEAR


def _finish(sim: Sim, task: dict[str, Any], status: str, reason: str = "") -> None:
    task["status"] = status
    task["reason"] = reason
    task["ended"] = sim.ctx.tick
    if status == DONE:
        sim.emit("task_done", task=task["id"], npc=task["npc"], goal=task["kind"])
    else:
        sim.emit("task_fail", task=task["id"], npc=task["npc"], goal=task["kind"], reason=reason)


def _advance(sim: Sim, task: dict[str, Any]) -> None:
    section = sim.state["tasks"]
    world = sim.world
    index = world.cast.index[task["npc"]]
    npc = sim.state["npcs"]["list"][index]
    if task["status"] == QUEUED:
        task["status"] = ACTIVE
        task["started"] = sim.ctx.tick
        sim.emit("task_start", task=task["id"], npc=task["npc"], goal=task["kind"])
    steps = task["steps"]
    while task["i"] < len(steps):
        op, place, item, number = steps[task["i"]]
        cell = world.town.stand(place, index)
        if not _near(npc, cell):
            section["jobs"][task["npc"]] = {"task": task["id"], "act": "walk", "place": place}
            return
        if op == goap.GOTO:
            task["i"] += 1
        elif op == goap.TAKE:
            lying = section["stock"].get(place, {})
            if npc["carry"] or lying.get(item, 0) < number:
                reason = "hands_full" if npc["carry"] else "no_stock"
                _finish(sim, task, FAILED, reason)
                return
            lying[item] -= number
            npc["carry"], npc["qty"] = item, number
            sim.emit("taken", task=task["id"], npc=task["npc"], item=item, qty=number, place=place)
            task["i"] += 1
        elif op == goap.DROP:
            if not npc["carry"] or (item and npc["carry"] != item):
                _finish(sim, task, FAILED, "wrong_hands")
                return
            lying = section["stock"].setdefault(place, {})
            lying[npc["carry"]] = lying.get(npc["carry"], 0) + npc["qty"]
            kept = {"id": task["commit"], "amount": npc["qty"]} if "commit" in task else {}
            sim.emit(
                "delivered",
                task=task["id"],
                npc=task["npc"],
                item=npc["carry"],
                qty=npc["qty"],
                place=place,
                **kept,
            )
            npc["carry"], npc["qty"] = None, 0
            task["i"] += 1
        else:  # work
            task["progress"] += 1
            section["worked"][place] = section["worked"].get(place, 0) + 1
            if task["progress"] < number:
                section["jobs"][task["npc"]] = {"task": task["id"], "act": "work", "place": place}
                return
            task["i"] += 1
    _finish(sim, task, DONE)


# ---------------------------------------------------------------------------- the dev action


def validate_assign(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    """Check an ``assign`` body and return it normalized, or raise ``InputError``."""
    where = "player action assign"
    if world.config["dev_actions"] != 1:
        raise InputError(f"player action: unknown type {body.get('type')!r}")
    npc = body.get("npc")
    if not isinstance(npc, str) or npc not in world.cast.index:
        raise InputError(f"{where}: unknown npc {npc!r}")
    raw = body.get("task")
    if not isinstance(raw, dict) or raw.get("kind") not in KIND_FIELDS:
        raise InputError(f"{where}: task needs a kind of {sorted(KIND_FIELDS)}")
    task: dict[str, Any] = {"kind": raw["kind"]}
    for name in KIND_FIELDS[raw["kind"]]:
        value = raw.get(name)
        if name in ("qty", "hours"):
            top = MAX_QTY if name == "qty" else MAX_HOURS
            task[name] = int_field(value, where, name, 1, top)
        elif isinstance(value, str) and 1 <= len(value) <= 64:
            task[name] = value
        else:
            raise InputError(f"{where}: task.{name} must be a short string")
    return {"action_id": body["action_id"], "type": "assign", "npc": npc, "task": task}


def apply_assign(sim: Sim, body: dict[str, Any]) -> None:
    reason = None
    try:
        assign(sim.world, sim.state, {"npc": body["npc"], **body["task"]})
    except TaskError as exc:
        reason = str(exc).split(":")[0]
    sim.emit(
        "action_ack",
        action_id=body["action_id"],
        result="applied" if reason is None else "rejected",
        reason=reason,
    )


ACTIONS = {"assign": (validate_assign, apply_assign)}
