"""A stand-in that asks for model calls on a script, to test the budget gate on its own.

The bridge world does not ask for any call by itself yet, so a test adds a subsystem that owns
the reserved section ``goals`` and asks on a plan: a function from the tick to the asks of that
tick. The module sits just before ``budget`` in the order, as the modules that talk will.
``Wire`` is a host in miniature: it numbers the inputs of the calls it makes.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

from lantern_core.api import Game
from lantern_core.world.bridge import order

PROBE = "probe"
# One micro-yuan per token on the cheap tier and five on the strong one: a call of 20,000 tokens
# holds 0.02 yuan on the first and 0.10 on the second: round numbers to check by hand.
ROUND_PRICES = {
    "price_cheap_in": 1_000_000,
    "price_cheap_out": 1_000_000,
    "price_strong_in": 5_000_000,
    "price_strong_out": 5_000_000,
}


def ask(
    tier: str = "cheap",
    size: int = 96,
    max_tokens: int = 100,
    valid_if: list[dict[str, Any]] | None = None,
    then: Any = None,
) -> dict[str, Any]:
    """One ask of the plan. A request of ``size`` bytes reserves ``size + 4`` input tokens.

    ``then(sim)``, if given, runs right after the ask, still inside the tick.
    """
    return {
        "tier": tier,
        "size": size,
        "max_tokens": max_tokens,
        "valid_if": valid_if or [],
        "then": then,
    }


def plan_at(table: dict[int, list[dict[str, Any]]]) -> Any:
    """A plan that makes the asks the table lists for a tick, and none on the others."""
    return lambda tick: table.get(tick, [])


def plan_every(period: int, *asks: dict[str, Any], first: int = 1, last: int = 10**9) -> Any:
    """A plan that makes the same asks every ``period`` ticks from tick ``first`` to ``last``."""

    def plan(tick: int) -> list[dict[str, Any]]:
        due = first <= tick <= last and (tick - first) % period == 0
        return list(asks) if due else []

    return plan


def install(monkeypatch: Any, plan: Any, on_land: Any = None) -> None:
    """Add the asking subsystem to the order. ``plan(tick)`` lists the asks of that tick.

    ``on_land(sim, request, status, text)``, if given, runs when a result lands, after it is logged.
    """

    def init(world: Any, rng: Any) -> dict[str, Any]:
        return {"asked": [], "landed": [], "alive": True}

    def tick(sim: Any) -> None:
        section = sim.state["goals"]
        for n, wanted in enumerate(plan(sim.ctx.tick)):
            request_id = sim.ctx.issue(
                interaction_id=f"i{sim.ctx.tick}-{n}",
                tier=wanted["tier"],
                category=PROBE,
                messages=[{"role": "user", "content": "x" * wanted["size"]}],
                max_tokens=wanted["max_tokens"],
                valid_if=wanted["valid_if"],
            )
            section["asked"].append(request_id)
            if wanted["then"] is not None:
                wanted["then"](sim)

    def land(sim: Any, request: dict[str, Any], status: str, text: str) -> None:
        sim.state["goals"]["landed"].append([request["request_id"], status, text, request["tier"]])
        if on_land is not None:
            on_land(sim, request, status, text)

    def alive(world: Any, state: dict[str, Any], condition: dict[str, Any]) -> bool:
        return state["world"]["goals"]["alive"]

    stand_in = SimpleNamespace(
        SECTION="goals", init=init, tick=tick, RESULTS={PROBE: land}, CONDITIONS={"alive": alive}
    )
    # the stand-in is to be the only thing that asks for calls: the talk between people goes
    rest = tuple(m for m in order.SUBSYSTEMS if m.SECTION not in ("goals", "social"))
    monkeypatch.setattr(order, "SUBSYSTEMS", (*rest[:-1], stand_in, rest[-1]))


class Wire:
    """Calls ``Game.step`` the way a host does: numbered inputs in, parsed outputs back."""

    def __init__(self, game: Game, step: Any = None) -> None:
        self.game = game
        self.seq = 0
        self._step = game.step if step is None else step

    def step(self, *inputs: tuple[str, dict[str, Any]]) -> dict[str, Any]:
        records = []
        for kind, body in inputs:
            records.append({"seq": self.seq, "kind": kind, "body": body})
            self.seq += 1
        return json.loads(self._step(json.dumps(records)))

    def event(self, name: str) -> tuple[str, dict[str, Any]]:
        return ("host", {"event": name})

    def result(
        self,
        request_id: str,
        status: str = "ok",
        usage: dict[str, int] | None = None,
        text: str = "好",
    ) -> tuple[str, dict[str, Any]]:
        body = {"request_id": request_id, "status": status, "text": text, "usage": usage}
        return ("model_result", body)


def budget_of(game: Game) -> dict[str, Any]:
    """The live ``budget`` section of the game (read it, do not write it except to set up)."""
    return game._kernel.state["world"]["budget"]


def goals_of(game: Game) -> dict[str, Any]:
    """The live section of the stand-in: the ids it asked with and the results that landed."""
    return game._kernel.state["world"]["goals"]


def requests_of(game: Game) -> list[dict[str, Any]]:
    """The requests in flight, as the state keeps them."""
    return game._kernel.state["requests"]
