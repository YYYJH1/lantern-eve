"""The festival's goals: the call for helpers, the work on the bridge, the turnout and the ending.

This section turns what the town does into the state of the festival. The script
(``content/scripts/broken_bridge.yaml``) names the flags, the metrics, the goals and the table of
endings (``goals_rules``). Here is what raises them.

The call for helpers
    Nobody joins until the festival manager calls (the player action ``rally``). Then the people
    whose threshold is met join, round after round, until nobody more does or the crew is ready,
    five helpers with one of each family at least, since the call is for the crew the work takes
    and no more (``goals_call`` has the model). The spread is worked out at once when the call is
    made and whenever the joiners or a threshold change, and again at the top of every game hour
    in the day, in case the trust of someone in the manager (kept by ``player``) moved. A person
    who joins promises to come to the festival, and the household they live in hangs a lantern at
    its door. The persuasion that comes later moves people with ``join`` and ``lower_threshold``
    (and ``spread`` after it has changed a trust), and reads the call with ``joined``,
    ``threshold`` and ``waiting_for``. A person who is asked in person and whose threshold is met
    comes whether or not the crew is ready, so the helpers beyond the crew are the ones the manager
    asked for. Children do not join.

The work on the bridge, the materials and the detour
    See ``goals_work``. In short: from day 3 the helpers work at the bridge in the morning, in
    person-hours, when there are five of them and both families are among them. The bridge also
    needs bamboo and timber, which Li Da and Shopkeeper Zhou bring once they have agreed
    (``agree_material``). The temple keeper opens the lane when she has agreed (``agree_lane``),
    and then three helpers hang lanterns along it. The barrier of the lane opens in
    ``walking_grid``.

The truth and the peace
    Telling the truth in public and reconciling the families are not done here. The modules that
    do them call ``set_truth_cleared`` and ``set_reconciled`` (which raises ``reconcile_seen``).
    Peace also needs the grudge between the two family heads to be low, which this section reads
    from the bonds when the game is made and then every tick (the metric ``grudge``). Finer inputs
    of the goal ``g_truth`` come in through ``set_metric`` and ``set_flag``. A goal cannot be done
    after its deadline.

The ending
    On the night of the last day the table of endings of the script is evaluated on the flags: a
    base ending, and the hidden ones laid over it. The ``ending`` event carries the result and the
    reveal (``goals_ending``), and both are kept in the state. ``player`` and ``social`` can add
    their part to the reveal (how far the manager's words went, who said what about them) with a
    function ``ending_reveal(world_state)``. After the ending the section does nothing: no one is
    asked to work and the hooks refuse. The world itself goes on, quietly, and it is for the host
    to end the game. The event comes once. The frame of that call carries the same object in its
    key ``ending`` (``goals_ending.wire``), and every frame after it the compact form of it, which
    leaves out the reveal and the epilogue of the people who carry the days (``roles``), because
    the reveal is most of the ending and a host sends ten frames a second. A page that loads a game
    that is over, or comes back to one, gets the whole ending from its host, which has it from
    ``Game.ending_json`` (``ending`` here, with the kind and the tick); before the last night there
    is none.

State (``state["world"]["goals"]``)::

    {"flags": {flag: tick it was raised},
     "metrics": {metric: int},                every metric of the script
     "done": {goal: tick it was done},
     "call": {...},                            see goals_call
     "work": {"seen": ticks of work at the bridge when last looked,
              "ticks": ticks of work that count, "ordered": {helper: day they were asked}},
     "supply": {item: id of the delivery that was agreed},
     "lane": {"task": the keeper's task or 0, "lamps": {helper: task} asked, "hung": [helper] done},
     "ending": {}}                            until the last night

Player actions: ``rally`` (``{"action_id", "type": "rally"}``) and, only when the config
``dev_actions`` is 1, ``dev_goal`` (``{"action_id", "type": "dev_goal", "op", "npc"?,
"value"?}``) whose ops are ``join``, ``material`` and ``lane`` (each with an ``npc``), ``truth``,
``reconcile`` and ``grudge`` (with a ``value`` from 0 to 100 for the grudge between the family
heads). Both answer with ``action_ack``.

Events: ``rally``; ``joined`` (``npc``, ``round``, ``how``: call, persuasion or dev); ``promised``
(``household``); ``agreed`` (``npc``, ``what``: bamboo, timber or lane); ``flag`` (``flag``);
``goal`` (``goal``); and ``ending`` (``ending``, ``label``, ``hidden``, ``inputs``, ``passage``,
``promised``, ``turnout``, ``reveal``, ``epilogue``; ``label`` and the ``label`` of each of
``hidden`` are ``{"zh", "en"}``, and so is every label of the reveal).

The frame: ``ending`` is null until the last night. In the frame of the call that made the ending
it is the ending event, ``{"kind", "tick", "ending", "label", "hidden", "inputs", "passage",
"promised", "turnout", "reveal", "epilogue"}``, and in every frame after it the same without the
``reveal`` and the ``epilogue`` (the compact form). A call that only pauses, on the tick after the
ending, simulates nothing, and its frame is still the first. ``lanterns`` are ``{"household",
"place", "x", "y"}``, one for each household that promised, in the order they did, hung at its
door. The ``hud`` gets
``promised`` (the households), ``turnout`` (the people expected, see ``turnout``), ``bridge``
and ``ending``. ``bridge`` is
``{"done": helpers who joined, at most ``need``, "need", "percent", "hours", "hours_need", "state":
broken, repairing, mended or detour, "lacking"?: an item id, or ``{"zh", "en"}`` for hands}`` and
``ending`` the id of the ending, or the empty string. Once the game has ended they stay as they
were on the last night. The verb ``rally`` is added to ``hud.verbs`` while the player is free to
walk and the call has not been made.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.inputs import InputError, int_field
from lantern_core.world.bridge import (
    bonds,
    clock,
    crowd,
    goals_call,
    goals_ending,
    goals_rules,
    goals_state,
    goals_work,
    weather,
)
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld
    from lantern_core.world.grid import Grid

SECTION = "goals"

LANE_BARRIER = "lane_barrier"
TRUTH_TOLD, RECONCILE_SEEN, ELDER_ACCEPTS = "truth_told", "reconcile_seen", "elder_accepts"
OUTSIDE_FLAGS = (TRUTH_TOLD, RECONCILE_SEEN, ELDER_ACCEPTS)  # the flags other modules raise
ALIASES = {"truth_cleared": TRUTH_TOLD}  # the flag of the script by another name
FESTIVAL_KEYS = frozenset({"flags", "metrics", "done", "call", "work", "ending"})  # of the section

# the expected turnout, see ``turnout``: people to a household and to a keen townsperson, the
# passage and the sky as per mille factors
HOUSEHOLD_PEOPLE, KEEN_PEOPLE, MAX_TURNOUT = 4, 50, 10_000
PASSAGE = {"mended": 1000, "detour": 800, "none": 500}
SKY = {weather.CLEAR: 1000, weather.LIGHT_RAIN: 800, weather.HEAVY_RAIN: 500}

DEV_OPS = ("join", "material", "lane", "truth", "reconcile", "grudge")
NEEDS_NPC = ("join", "material", "lane")


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    """The section at the start of a game: no flag up, nobody joined, the thresholds set."""
    table = goals_rules.rules()
    goals_work.check_flags()
    for flag in OUTSIDE_FLAGS:
        assert flag in table.flags, flag
    return {
        "flags": {},
        "metrics": {name: low for name, (low, _) in sorted(table.metrics.items())},
        "done": {},
        "call": goals_call.seed(world, rng),
        "work": {"seen": 0, "ticks": 0, "ordered": {}},
        "supply": {},
        "lane": {"task": 0, "lamps": {}, "hung": []},
        "ending": {},
    }


def start(world: BridgeWorld, state: dict[str, Any]) -> None:
    """Look at the first moment of the game, once every section is made: the grudge between the
    heads of the two families, which the first tick sets from then on, is set now, so that a
    frame before the first tick (a game that opens held, behind the tutorial) says what it is
    and not 0."""
    if keeps_the_goals(state):
        goals_state.set_metric(state[SECTION], "grudge", grudge_of(state))


# ---------------------------------------------------------------------------- reading


def keeps_the_goals(world_state: dict[str, Any]) -> bool:
    """Whether the section ``goals`` is the festival's. A world may stand something else in its
    place (a test world gives the name to a subsystem of its own), and then what reads the call, the
    work or the metrics of the festival has nothing to read: the frame has no ``board``, and the
    terms of the tasks that read the helpers or the work hold nothing."""
    section = world_state.get("goals")
    return isinstance(section, dict) and section.keys() >= FESTIVAL_KEYS


def flag_up(world_state: dict[str, Any], flag: str) -> bool:
    """Whether the flag is raised. ``truth_cleared`` is another name for ``truth_told``."""
    return ALIASES.get(flag, flag) in world_state["goals"]["flags"]


def metric(world_state: dict[str, Any], name: str) -> int:
    return int(world_state["goals"]["metrics"][name])


def joined(world_state: dict[str, Any]) -> list[str]:
    """Who has joined the call, in the order they did."""
    return goals_call.joined_ids(world_state["goals"]["call"])


def threshold(world_state: dict[str, Any], person: str) -> int:
    """How many acquaintances must have joined before ``person`` does, as things stand."""
    return goals_call.threshold(world_state, person)


def waiting_for(world: BridgeWorld, world_state: dict[str, Any], person: str) -> int:
    """How many more of their acquaintances ``person`` wants to see join (0 if they are in)."""
    return goals_call.waiting_for(world, world_state, person)


def promised(world_state: dict[str, Any]) -> list[str]:
    """The households that promised to come, in the order they did."""
    return list(world_state["goals"]["call"]["households"])


def crew_ready(world: BridgeWorld, world_state: dict[str, Any]) -> bool:
    """Whether five helpers have joined, with at least one of each family."""
    return goals_call.crew_ready(world, world_state["goals"]["call"])


def turnout(households: int, keen: int, how: str, sky: str) -> int:
    """The people expected at the festival.

    ``(households * 4 + keen * 50) * passage * sky``, with ``keen`` the townsfolk who are keen
    for it (``crowd.keen_count``), the passage 1, 0.8 or 0.5 by whether the bridge is mended
    (``mended``), the detour is ready (``detour``) or there is no way (``none``), and the sky 1,
    0.8 or 0.5 for clear weather, light rain and heavy rain. The factors are per mille, the
    product is rounded down once, and it stops at 10,000.
    """
    people = households * HOUSEHOLD_PEOPLE + keen * KEEN_PEOPLE
    return min(MAX_TURNOUT, people * PASSAGE[how] * SKY[sky] // 1_000_000)


def walking_grid(world: BridgeWorld, state: dict[str, Any]) -> Grid:
    """The grid people walk on: the town, with the lane behind the temple open once it is.

    ``state`` is the world state. A world whose section is not this one's is the closed town.
    """
    section = state.get("goals")
    flags = section.get("flags") if isinstance(section, dict) else None
    if isinstance(flags, dict) and goals_work.LANE_OPENED in flags:
        return world.town.grid_with_open((LANE_BARRIER,))
    return world.town.grid


# ---------------------------------------------------------------------------- flags from outside


def set_flag(sim: Sim, flag: str) -> bool:
    """Raise a flag that other modules own: ``truth_told`` (also called ``truth_cleared``),
    ``reconcile_seen`` and ``elder_accepts``. The others follow from the state of the town.

    False if it is up already, it is not one of these, the deadline of the goal that sets it has
    passed, or the game ended.
    """
    g = goals_state.live(sim)
    flag = ALIASES.get(flag, flag)
    if g is None or flag not in OUTSIDE_FLAGS:
        return False
    if goals_state.expired(flag, sim.ctx.tick):
        return False
    return goals_state.raise_flag(sim, g, flag)


def set_metric(sim: Sim, name: str, value: int) -> bool:
    """Set a metric that another module owns (``audience_named``, ``accept_ratio``), held to the
    range the script gives it. False if the metric is unknown or the game ended."""
    g = goals_state.live(sim)
    if g is None or name not in goals_rules.rules().metrics or type(value) is not int:
        return False
    goals_state.set_metric(g, name, value)
    return True


def set_truth_cleared(sim: Sim) -> bool:
    """The truth about the bridge was told in public and taken: raises ``truth_told``.

    False if it was up already, the deadline of the goal has passed, or the game ended.
    """
    return set_flag(sim, TRUTH_TOLD)


def set_reconciled(sim: Sim) -> bool:
    """A reconciliation of the families was seen: raises ``reconcile_seen``.

    The flag ``reconciled`` follows when the grudge between the family heads is low enough too (the
    goal ``g_reconcile``), now or whenever it falls. False if it was up already or the game ended.
    """
    return set_flag(sim, RECONCILE_SEEN)


# ---------------------------------------------------------------------------- the call


def _announce(sim: Sim, person: str, rnd: int, how: str, household: str | None) -> None:
    sim.emit("joined", npc=person, round=rnd, how=how)
    if household is not None:
        sim.emit("promised", household=household)


def _spread(sim: Sim, g: dict[str, Any]) -> None:
    """Let the call spread, if it is out."""
    call = g["call"]
    if call["open"] < 0:
        return
    for person, rnd, household in goals_call.cascade(sim.world, sim.state, sim.ctx.tick):
        _announce(sim, person, rnd, goals_call.CALL, household)


def spread(sim: Sim) -> None:
    """Let the call spread again, if it is out: after trust (the player's) or a threshold moved.

    The call is worked out again at the top of every game hour in the day anyway.
    """
    g = goals_state.live(sim)
    if g is not None:
        _spread(sim, g)


def rally(sim: Sim) -> str | None:
    """The manager calls for helpers. Returns ``None``, or why it was refused: ``over`` or
    ``already_open``. The people whose threshold is met join at once."""
    g = goals_state.live(sim)
    if g is None:
        return "over"
    if g["call"]["open"] >= 0:
        return "already_open"
    g["call"]["open"] = sim.ctx.tick
    sim.emit("rally")
    _spread(sim, g)
    return None


def join(sim: Sim, person: str, how: str = goals_call.PERSUASION) -> bool:
    """``person`` agrees to help, whatever their threshold (a persuasion that worked).

    They promise to come to the festival, their household hangs its lantern, and if the call is
    out the people who were waiting for them may follow. False if they were in already, cannot
    help (a child, or not of the cast), or the game ended.
    """
    g = goals_state.live(sim)
    if g is None:
        return False
    new, household = goals_call.add(
        sim.world, g["call"], person, sim.ctx.tick, goals_call.ROUND_PERSUADED, how
    )
    if not new:
        return False
    _announce(sim, person, goals_call.ROUND_PERSUADED, how, household)
    _spread(sim, g)
    return True


def lower_threshold(sim: Sim, person: str, steps: int = 1) -> int:
    """Take ``steps`` off the threshold of ``person`` (a persuasion that made them wait for fewer).

    Returns the threshold now, or -1 if ``person`` cannot help or the game ended. The people the
    call now reaches join at once, and so does ``person`` if the call is out and the people they
    know who are helping now meet the threshold: they were asked, and the crew being ready is no
    reason to say no.
    """
    g = goals_state.live(sim)
    if g is None or person not in g["call"]["shift"] or type(steps) is not int:
        return -1
    shift = g["call"]["shift"][person] - steps
    g["call"]["shift"][person] = max(-goals_call.MAX_SHIFT, min(goals_call.MAX_SHIFT, shift))
    _spread(sim, g)
    _come_if_asked(sim, g, person)
    return goals_call.threshold(sim.state, person)


def _come_if_asked(sim: Sim, g: dict[str, Any], person: str) -> None:
    """``person``, asked in person, comes if the call is out and their threshold is met."""
    call = g["call"]
    if call["open"] < 0 or goals_call.waiting_for(sim.world, sim.state, person) > 0:
        return
    new, household = goals_call.add(
        sim.world, call, person, sim.ctx.tick, goals_call.ROUND_PERSUADED, goals_call.PERSUASION
    )
    if new:
        _announce(sim, person, goals_call.ROUND_PERSUADED, goals_call.PERSUASION, household)
        _spread(sim, g)


# ---------------------------------------------------------------------------- errands


def agree_material(sim: Sim, person: str) -> int:
    """Li Da or Shopkeeper Zhou agrees to bring the bamboo or the timber to the bridge.

    The delivery is posted as a ``carry`` errand through ``tasks.assign``. Returns the id of the
    task. Zero if ``person`` brings nothing, the delivery is agreed (and has not failed) or done,
    the errand cannot be posted, or the game ended.
    """
    g = goals_state.live(sim)
    return 0 if g is None else goals_work.agree_material(sim, g, person)


def agree_lane(sim: Sim, person: str) -> int:
    """The temple keeper agrees to open the lane behind the temple.

    She works an hour there, and when it is done the barrier opens (``lane_opened``). Returns the
    id of the task, or zero if ``person`` is not the keeper, it is under way or done, or the game
    ended.
    """
    g = goals_state.live(sim)
    return 0 if g is None else goals_work.agree_lane(sim, g, person)


# ---------------------------------------------------------------------------- one tick


def grudge_of(world_state: dict[str, Any]) -> int:
    """The grudge between the heads of the two families: the larger of what each holds."""
    first, second = goals_call.HEADS
    social, lore_ = world_state["social"], lore()
    if "bonds" not in social:  # a world without the talk between neighbours
        return 0
    return max(
        bonds.value(social, lore_, first, second, bonds.GRUDGE),
        bonds.value(social, lore_, second, first, bonds.GRUDGE),
    )


def tick(sim: Sim) -> None:
    """One tick of the section: the errands, the call, the orders, the numbers and the goals."""
    g = goals_state.live(sim)
    if g is None:
        return
    now = sim.now
    goals_work.watch(sim, g)
    if now.phase == clock.DAY:
        if now.phase_tick % clock.DAY_TICKS_PER_HOUR == 0:
            _spread(sim, g)
        goals_work.orders(sim, g)
    goals_work.numbers(sim, g)
    goals_state.set_metric(g, "grudge", grudge_of(sim.state))
    if now.phase == clock.NIGHT and now.phase_tick == 0:
        goals_state.set_metric(g, "false_belief_share", goals_ending.false_belief_share(sim.state))
    goals_state.evaluate(sim, g)
    if now.day >= sim.world.config["days"] and now.phase == clock.NIGHT and now.phase_tick == 0:
        _finish(sim, g)


def _finish(sim: Sim, g: dict[str, Any]) -> None:
    """The last night: the ending, the reveal, and the numbers of the festival kept as they are.

    The state keeps ``{"tick", "id", "hidden": [ids], "inputs": {flag: bool}, "passage", "weather",
    "promised", "turnout", "reveal", "epilogue": [[person, entry]]}`` (the epilogue is the entries
    of the lists of the people who carry the days that the last night chose, see ``roles``), and the
    event ``ending`` the same with the names of the endings in both languages and the epilogue in
    words (``goals_ending.wire`` makes it, for the event and for the frames).
    """
    from lantern_core.world.bridge import roles  # not at the top: it reads the goals

    state = sim.state
    base, hidden = goals_rules.ending_of(g["flags"], g["metrics"])
    how, sky = goals_work.passage(g["flags"]), weather.today(state)
    households = len(g["call"]["households"])
    expected = turnout(households, crowd.keen_count(state), how, sky)
    inputs = {name: name in g["flags"] for name in goals_rules.rules().inputs}
    reveal = goals_ending.reveal(sim.world, state)
    g["ending"] = {
        "tick": sim.ctx.tick,
        "id": base.id,
        "hidden": [row.id for row in hidden],
        "inputs": inputs,
        "passage": how,
        "weather": sky,
        "promised": households,
        "turnout": expected,
        "reveal": reveal,
        "epilogue": roles.epilogue(sim.world, state, sim.now),
    }
    sim.emit("ending", **goals_ending.wire(g["ending"]))


# ---------------------------------------------------------------------------- the frame


def ending(world_state: dict[str, Any], *, compact: bool = False) -> dict[str, Any] | None:
    """The ending as the ``ending`` event carried it, or ``None`` before the last night.

    With ``compact`` the ``reveal`` is left out (see ``goals_ending.wire``). ``world_state`` is
    ``state["world"]``.
    """
    done = world_state["goals"]["ending"]
    if not done:
        return None
    return {"kind": "ending", "tick": done["tick"], **goals_ending.wire(done, compact=compact)}


def frame(world: BridgeWorld, state: dict[str, Any], out: dict[str, Any]) -> None:
    """The lanterns at the doors of the households that promised, and the festival's numbers."""
    world_state = state["world"]
    g = world_state["goals"]
    layout = goals_call.lay(world)
    for household in g["call"]["households"]:
        home = layout.household[household]
        out["lanterns"].append(
            {"household": home.id, "place": home.place, "x": home.door[0], "y": home.door[1]}
        )
    hud = out["hud"]
    if g["ending"]:
        hud["promised"] = g["ending"]["promised"]
        hud["turnout"] = g["ending"]["turnout"]
        hud["ending"] = g["ending"]["id"]
    else:
        hud["promised"] = len(g["call"]["households"])
        how = goals_work.passage(g["flags"])
        hud["turnout"] = turnout(
            hud["promised"], crowd.keen_count(world_state), how, out["weather"]
        )
        hud["ending"] = ""
    hud["bridge"] = goals_work.bridge_hud(world, g)
    done = g["ending"]
    # the whole ending in the frame of the call that made it, and without its reveal after that
    out["ending"] = ending(world_state, compact=bool(done) and state["tick"] != done["tick"] + 1)
    verbs = hud.get("verbs")
    if isinstance(verbs, list) and "move" in verbs and not g["ending"] and g["call"]["open"] < 0:
        from lantern_core.world.bridge import player  # not at the top: player may use goals

        hud["verbs"] = [v for v in player.VERB_ORDER if v in (*verbs, "rally")]


# ---------------------------------------------------------------------------- the actions


def validate_rally(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    return {"action_id": body["action_id"], "type": "rally"}


def apply_rally(sim: Sim, body: dict[str, Any]) -> None:
    reason = rally(sim)
    sim.emit(
        "action_ack",
        action_id=body["action_id"],
        result="applied" if reason is None else "rejected",
        reason=reason,
    )


def validate_dev(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    """Check a ``dev_goal`` body. It exists only when the config ``dev_actions`` is 1."""
    where = "player action dev_goal"
    if world.config["dev_actions"] != 1:
        raise InputError(f"player action: unknown type {body.get('type')!r}")
    op = body.get("op")
    if op not in DEV_OPS:
        raise InputError(f"{where}: op must be one of {', '.join(DEV_OPS)}")
    npc = body.get("npc", "")
    if op in NEEDS_NPC and (not isinstance(npc, str) or npc not in world.cast.index):
        raise InputError(f"{where}: unknown npc {npc!r}")
    value = int_field(body.get("value", 0), where, "value", 0, 100) if op == "grudge" else 0
    return {
        "action_id": body["action_id"],
        "type": "dev_goal",
        "op": op,
        "npc": npc if op in NEEDS_NPC else "",
        "value": value,
    }


def _set_grudge(sim: Sim, value: int) -> None:
    """Bring the grudge each family head holds against the other to ``value``."""
    social, lore_ = sim.state["social"], lore()
    first, second = goals_call.HEADS
    for holder, target in ((first, second), (second, first)):
        while (now := bonds.value(social, lore_, holder, target, bonds.GRUDGE)) != value:
            bonds.nudge(social, lore_, holder, target, bonds.GRUDGE, value - now)


def apply_dev(sim: Sim, body: dict[str, Any]) -> None:
    op, npc = body["op"], body["npc"]
    done = False
    if op == "join":
        done = join(sim, npc, goals_call.DEV)
    elif op == "material":
        done = agree_material(sim, npc) > 0
    elif op == "lane":
        done = agree_lane(sim, npc) > 0
    elif op == "truth":
        done = set_truth_cleared(sim)
    elif op == "reconcile":
        done = set_reconciled(sim)
    elif op == "grudge" and goals_state.live(sim) is not None:
        _set_grudge(sim, body["value"])
        done = True
    sim.emit(
        "action_ack",
        action_id=body["action_id"],
        result="applied" if done else "rejected",
        reason=None if done else "no_change",
    )


ACTIONS = {
    "rally": (validate_rally, apply_rally),
    "dev_goal": (validate_dev, apply_dev),
}
