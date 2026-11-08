"""Helpers for the tests of the festival's goals: a host in miniature, and cases to set up."""

from __future__ import annotations

import json
from typing import Any

from bridge_helpers import CLEAR, CYCLE, bridge, state_of

from lantern_core.api import Game
from lantern_core.kernel import Ctx
from lantern_core.world.bridge import clock
from lantern_core.world.bridge.sim import Sim

DT = clock.DAY_TICKS_PER_HOUR
LI = ("li_laotai", "li_da", "li_er", "li_xiaomei")  # the Li who can help (Shitou is a child)
ZHOU = ("zhou_zhanggui", "zhou_niangzi", "zhou_dalang", "zhou_erlang", "zhou_huoji")
NEUTRAL = (
    "cha_laoban",
    "sishu_xiansheng",
    "old_he",
    "zuzhang",
    "zhangfang",
    "miaozhu",
    "gengfu",
    "mujiang",
    "zhadeng_shifu",
)
HELPERS = (*LI, *ZHOU, *NEUTRAL)
LAST_NIGHT = 4 * CYCLE + clock.DAY_TICKS  # the first tick of the night of day 5
DEV = {"dev_actions": 1}


class Hand:
    """A host in miniature: it numbers the inputs, keeps every event, and plays player actions."""

    def __init__(self, game: Game) -> None:
        self.game = game
        self.events: list[dict[str, Any]] = []
        self.frame: dict[str, Any] = {}

    def send(self, *bodies: dict[str, Any]) -> dict[str, Any]:
        """One call with the given player actions. Returns the parsed outputs.

        An action without an ``action_id`` gets one from the number of its input, so that the
        same script gives the same game wherever it is played.
        """
        seq = self.game.next_seq
        records = [
            {"seq": seq + i, "kind": "player", "body": {"action_id": f"a{seq + i}", **body}}
            for i, body in enumerate(bodies)
        ]
        out = json.loads(self.game.step(json.dumps(records)))
        self.events += out["events"]
        self.frame = out["frame"]
        return out

    def run_to(self, tick: int) -> None:
        while self.game.tick < tick:
            if self.game.paused:  # nothing but an act of the manager starts a held world again
                raise AssertionError(
                    f"the world is stopped at tick {self.game.tick}, before {tick}"
                )
            self.send()

    def kinds(self, kind: str) -> list[dict[str, Any]]:
        return [e for e in self.events if e["kind"] == kind]

    def acks(self, out: dict[str, Any]) -> list[tuple[str, str | None]]:
        return [(e["result"], e["reason"]) for e in out["events"] if e["kind"] == "action_ack"]

    @property
    def state(self) -> dict[str, Any]:
        return state_of(self.game)

    @property
    def goals(self) -> dict[str, Any]:
        return self.state["goals"]


def body(type_: str, **fields: Any) -> dict[str, Any]:
    """A player action. ``Hand.send`` gives it an action id if it has none."""
    return {"type": type_, **fields}


def rally() -> dict[str, Any]:
    return body("rally")


def dev(op: str, **fields: Any) -> dict[str, Any]:
    return body("dev_goal", op=op, **fields)


def hand(seed: int = 3, **config: int) -> Hand:
    """A new game, with the dev actions on and a clear sky unless the config says otherwise."""
    return Hand(bridge(seed, **{**DEV, **CLEAR, **config}))


def set_sky(h: Hand, *days: str) -> None:
    """Fix the weather of the first days (``clear``, ``light_rain`` or ``heavy_rain``)."""
    plan = h.state["weather"]["plan"]
    for i, kind in enumerate(days):
        plan[i] = kind
    h.state["weather"]["kind"] = plan[0]


def crew_of_five() -> tuple[str, ...]:
    """Five helpers, three Li and two Zhou, who are quick to reach the bridge."""
    return ("li_da", "li_er", "li_xiaomei", "zhou_dalang", "zhou_erlang")


def join_all(h: Hand, people: tuple[str, ...]) -> None:
    h.send(*[dev("join", npc=p) for p in people])


def flat(game: Game) -> dict[str, Any]:
    return json.loads(game.snapshot_json())


def sim_of(h: Hand) -> Sim:
    """A ``Sim`` on the live game, for calling the hooks that other modules will call. What it
    emits is dropped, what it changes in the state stays."""
    kernel = h.game._kernel
    return Sim(kernel.world, Ctx(kernel))
