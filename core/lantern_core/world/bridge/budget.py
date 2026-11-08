"""What this game may spend on model calls, and the gate that keeps it there.

A game has a cap on what its calls to a paid model may cost, ``budget_cap`` in the config, in
micro-yuan (see ``pricing``). The default is 3,000,000, which is three yuan, for a game of five
days. The prices of the two cloud tiers are in the config too, in micro-yuan per million tokens
(``price_cheap_in``, ``price_cheap_out``, ``price_strong_in``, ``price_strong_out``), so they
are in the header of every recording, and a host that runs other models on the tiers sets their
prices when it makes the game. The core never sees the name of a model, only the tier.

How it works
------------
The gate reserves before it spends and settles afterwards. Every request that goes out holds the
most it can cost: its reserved tokens at the prices of its tier, in ``request["hold"]``. When the
result comes, the hold is released and the cost of what was used is added to the money spent. A
result with unknown usage (a timeout, an abort, a broken stream) is charged its whole
reservation, and the money is not given back. An answer that arrives after its request was
settled is not charged again.

The *occupancy* is the money spent plus the holds of every request in flight. Where it stands
against the cap decides which tiers are open (``pricing`` has the limits): under 70 percent all
of them, from 70 up to 90 percent not the strong tier, from 90 percent on no cloud tier. A request
is judged on the occupancy it *would* make, that is, the occupancy now plus its own hold:

1. If the tier it asks for is open at that occupancy, it goes out on it, and its hold counts.
2. Otherwise it moves down one tier, strong to cheap to local to a template line, its hold is
   worked out again for the new tier, and the same question is asked again.

A request only ever moves down, and there are four tiers, so the walk stops after at most three
steps and the outcome of a request is unique. The local tier is open when the host has said that a
local model is there. A template line needs no model: the request is not sent, and the world gets
its template outcome at once (``Kernel._answer_templates``) as an ``error`` result whose text is
the reason, ``budget``, ``cloud_down`` or ``local_down``.

An example. The cap is 5 yuan and the occupancy 3.49. A strong request holds 0.10, which would
make 3.59, in the second stage, where the strong tier is off. It moves down to cheap, whose hold
is 0.02. That makes 3.51, still in the second stage, and the cheap tier is open there. The
request goes out on the cheap tier and holds 0.02.

The cap cannot be passed. A cloud request is only let out if the occupancy it would make is under
90 percent of the cap, and a result costs no more than the hold that was released for it, so the
occupancy stays under 90 percent however many requests are in flight at once. This rests on the
prices in the config being those of the models behind the tiers, and on the host keeping every call
to the ``max_tokens`` it was given and counting tokens no lower than the reservation does (one input
token to the byte), so that the hold bounds the cost. A host that reports more usage than was
reserved is charged what it reports.

The host tells the core what the core cannot see, with ``host`` inputs (``inputs.HOST_EVENTS``):
``cloud_down`` and ``cloud_up`` say whether the model service can be reached, ``local_up`` and
``local_down`` whether a local model can take requests. A game starts with the cloud up and no
local model. While the cloud is down no cloud tier is open, whatever the occupancy. A limit on
what a key may spend in a day is the host's to keep: it sends ``cloud_down`` when the day's money
is gone. All of it is input, so a replay makes the same decisions at the same ticks and never
probes anything.

State (``state["world"]["budget"]``)::

    {"spent": micro-yuan settled, "cloud": bool, "local": bool,
     "stage": the stage last announced, "downgraded": requests that went out on a lower tier
     or were turned away, "templated": requests turned into a template line}

Events: ``downgrade`` (``request_id``, ``interaction_id``, ``asked``, ``tier``, ``reason``) for
each request that does not go out on the tier it asked for, where ``tier`` may be ``template``,
and ``budget_stage`` (``stage``, ``previous``, ``spent``, ``held``, ``cap``) whenever the
occupancy crosses a limit, up or down, announced at the end of the tick.

The frame's ``hud`` gets ``spent`` (micro-yuan settled), ``held`` (the holds in flight), ``cap``,
``stage`` (0 normal, 1 strong tier off, 2 cloud off, of the occupancy now), and ``cloud`` and
``local`` (what the host last said).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import pricing

if TYPE_CHECKING:
    from lantern_core.kernel import Ctx
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "budget"

ORDER = ("strong", "cheap", "local")  # the tiers from the best to the last, a request moves down
TEMPLATE = "template"  # what a request that finds no open tier gets: a line from the script
BUDGET, CLOUD_DOWN, LOCAL_DOWN = "budget", "cloud_down", "local_down"  # why a request moved


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    """The section at the start of a game: nothing spent, the cloud up and no local model."""
    return {
        "spent": 0,
        "cloud": True,
        "local": False,
        "stage": pricing.stage_of(0, world.config["budget_cap"]),
        "downgraded": 0,
        "templated": 0,
    }


# ---------------------------------------------------------------------------- the books


def held(state: dict[str, Any]) -> int:
    """The money reserved for the requests in flight. ``state`` is the kernel's state."""
    return sum(request["hold"] for request in state["requests"])


def occupancy(state: dict[str, Any]) -> int:
    """The money spent plus the money held, in micro-yuan. ``state`` is the kernel's state."""
    return state["world"]["budget"]["spent"] + held(state)


def stage(world: BridgeWorld, state: dict[str, Any]) -> int:
    """The stage of the occupancy now (``pricing.NORMAL``, ``NO_STRONG`` or ``NO_CLOUD``)."""
    return pricing.stage_of(occupancy(state), world.config["budget_cap"])


# ---------------------------------------------------------------------------- the gate


def _lower(tier: str) -> str:
    """The tier below ``tier``: the next in ``ORDER``, or ``TEMPLATE`` below the last."""
    i = ORDER.index(tier) + 1
    return ORDER[i] if i < len(ORDER) else TEMPLATE


def _refusal(tier: str, at: int, section: dict[str, Any]) -> str | None:
    """Why ``tier`` is not open at an occupancy that stands at stage ``at``, or None if it is."""
    if tier == "local":
        return None if section["local"] else LOCAL_DOWN
    if not section["cloud"]:
        return CLOUD_DOWN
    if at >= pricing.NO_CLOUD or (tier == "strong" and at >= pricing.NO_STRONG):
        return BUDGET
    return None


def decide(
    config: dict[str, Any], section: dict[str, Any], occupied: int, request: dict[str, Any]
) -> tuple[str, int, str | None]:
    """The tier a request goes out on, the money it holds there and why it moved, if it did.

    ``occupied`` is the occupancy before the request. The tier is ``TEMPLATE`` if every tier
    below the one asked for is closed too, and then the hold is zero.
    """
    reserve = request["reserve"]
    cap = config["budget_cap"]
    tier, why = request["tier"], None
    while tier != TEMPLATE:
        hold = pricing.cost(config, tier, reserve["input_tokens"], reserve["output_tokens"])
        refusal = _refusal(tier, pricing.stage_of(occupied + hold, cap), section)
        if refusal is None:
            return tier, hold, why
        why = why or refusal
        tier = _lower(tier)
    return TEMPLATE, 0, why


def admit(world: BridgeWorld, ctx: Ctx, request: dict[str, Any]) -> str | None:
    """The kernel's gate for a request about to go out (see ``kernel.Gate``).

    Sets ``tier`` and ``hold`` of the request. Returns None if it goes out, or the reason it was
    turned away, in which case the world gets the template outcome instead.
    """
    section = ctx.state["world"]["budget"]
    asked = request["tier"]
    tier, hold, why = decide(world.config, section, occupancy(ctx.state), request)
    request["tier"], request["hold"] = tier, hold
    if tier != asked:
        section["downgraded"] += 1
        ctx.emit(
            "downgrade",
            request_id=request["request_id"],
            interaction_id=request["interaction_id"],
            asked=asked,
            tier=tier,
            reason=why,
        )
    if tier == TEMPLATE:
        section["templated"] += 1
        return why
    return None


def settle(
    world: BridgeWorld, ctx: Ctx, request: dict[str, Any], usage: dict[str, int] | None
) -> None:
    """Charge a settled request: what it used, or the whole reservation if that is unknown."""
    tokens = request["reserve"] if usage is None else usage
    section = ctx.state["world"]["budget"]
    cost = pricing.cost(
        world.config, request["tier"], tokens["input_tokens"], tokens["output_tokens"]
    )
    section["spent"] = min(section["spent"] + cost, pricing.MAX_SPENT)


def on_host(world: BridgeWorld, ctx: Ctx, body: dict[str, Any]) -> None:
    """Take in what the host says about the cloud and the local model."""
    section = ctx.state["world"]["budget"]
    event = body["event"]
    if event in ("cloud_down", "cloud_up"):
        section["cloud"] = event == "cloud_up"
    else:
        section["local"] = event == "local_up"


# ---------------------------------------------------------------------------- the subsystem


def tick(sim: Sim) -> None:
    """Announce a change of stage. It runs last, after every request of the tick was made."""
    section = sim.state["budget"]
    now = pricing.stage_of(occupancy(sim.ctx.state), sim.world.config["budget_cap"])
    if now != section["stage"]:
        sim.emit(
            "budget_stage",
            stage=now,
            previous=section["stage"],
            spent=section["spent"],
            held=held(sim.ctx.state),
            cap=sim.world.config["budget_cap"],
        )
        section["stage"] = now


def frame(world: BridgeWorld, state: dict[str, Any], out: dict[str, Any]) -> None:
    """Put the money in the ``hud``: spent, held, the cap, the stage, and what the host said."""
    section = state["world"]["budget"]
    on_hold = held(state)
    cap = world.config["budget_cap"]
    hud = out["hud"]
    hud["spent"] = section["spent"]
    hud["held"] = on_hold
    hud["cap"] = cap
    hud["stage"] = pricing.stage_of(section["spent"] + on_hold, cap)
    hud["cloud"] = section["cloud"]
    hud["local"] = section["local"]
