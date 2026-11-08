"""A scripted run of the budget gate and the street talk, written to run unchanged under CPython
and under Pyodide.

The bridge world asks for no model call of its own yet, so ``run`` adds a subsystem that asks on
a script, makes named people speak out in the open now and then, and empties the outbox of the
crowd. Around it a host answers the requests a few calls later, some of them with a timeout, and
sends the events of the cloud and the local model at fixed ticks. The cap is small enough for the
game to pass through all three stages and to turn requests away. The talk between named people is
left out, so that the run is that of the gate and the crowd alone.

``run`` returns the state hash after every call, which is what the cross-host test compares call
for call. Nothing here depends on the interpreter beyond ``lantern_core``.
"""

from __future__ import annotations

import hashlib
import json
from types import SimpleNamespace
from typing import Any

from lantern_core.api import Game
from lantern_core.world.bridge import crowd, order

SEED = 2031
TICKS = 3000
# One micro-yuan per token on the cheap tier and five on the strong one, and a cap of 0.12 yuan.
CONFIG = {
    "budget_cap": 120_000,
    "price_cheap_in": 1_000_000,
    "price_cheap_out": 1_000_000,
    "price_strong_in": 5_000_000,
    "price_strong_out": 5_000_000,
}
EVENTS = {
    400: "cloud_down",
    700: "local_up",
    1100: "cloud_up",
    1500: "local_down",
    2200: "cloud_down",
    2400: "cloud_up",
}
SPOTS = ("p_market", "p_riverbank", "p_bridge", "p_ferry", "p_temple_lane")
SPEAKERS = ("zhou_niangzi", "li_da", "cha_laoban", "zuzhang", "old_he")


def asks(tick: int) -> list[tuple[str, int, int]]:
    """The calls asked for at ``tick``: (tier, bytes of message, max tokens)."""
    if tick % 9 != 1:
        return []
    mix = tick * 2654435761 % 4294967296
    return [("strong" if mix % 5 == 0 else "cheap", 200 + mix % 3000, 50 + mix % 400)]


def asker() -> Any:
    """The subsystem that asks, speaks and empties the outbox. It owns the reserved ``goals``."""

    def init(world: Any, rng: Any) -> dict[str, Any]:
        return {"asked": 0, "landed": {}, "passed": 0, "heard": 0}

    def tick(sim: Any) -> None:
        now = sim.ctx.tick
        section = sim.state["goals"]
        outbox = sim.state["crowd"]["outbox"]
        section["passed"] += len(outbox)
        outbox.clear()
        for n, (tier, size, max_tokens) in enumerate(asks(now)):
            sim.ctx.issue(
                interaction_id=f"i{now}-{n}",
                tier=tier,
                category="probe",
                messages=[{"role": "user", "content": "x" * size}],
                max_tokens=max_tokens,
                valid_if=[],
            )
            section["asked"] += 1
        if now % 53 == 20:
            which = now // 53
            spot, speaker = SPOTS[which % len(SPOTS)], SPEAKERS[which % len(SPEAKERS)]
            section["heard"] += crowd.hear(sim, spot, f"pr{now}", speaker)

    def land(sim: Any, request: dict[str, Any], status: str, text: str) -> None:
        key = f"{request['tier']}:{status}"
        sim.state["goals"]["landed"][key] = sim.state["goals"]["landed"].get(key, 0) + 1

    return SimpleNamespace(SECTION="goals", init=init, tick=tick, RESULTS={"probe": land})


class Host:
    """Answers each request a few calls after it came, and sends the events of the script."""

    def __init__(self) -> None:
        self.seq = 0
        self.waiting: list[tuple[int, dict[str, Any]]] = []
        self.calls = 0
        self.taken = 0

    def inputs(self, tick: int) -> list[dict[str, Any]]:
        records = []
        if tick in EVENTS:
            records.append(self._record("host", {"event": EVENTS[tick]}))
        due = [r for call, r in self.waiting if call <= self.calls]
        self.waiting = [(call, r) for call, r in self.waiting if call > self.calls]
        for request in due:
            if request["fate"] == "timeout":  # no word of what it cost
                body = {"request_id": request["request_id"], "status": "timeout", "usage": None}
            else:
                reserve = request["reserve"]
                usage = {
                    "input_tokens": reserve["input_tokens"] // 2,
                    "output_tokens": reserve["output_tokens"] // 2,
                }
                body = {"request_id": request["request_id"], "status": "ok", "usage": usage}
            records.append(self._record("model_result", {"text": "好", "latency_ms": 5, **body}))
        return records

    def take(self, requests: list[dict[str, Any]]) -> None:
        """Take note of the requests that came. Every seventh one will time out."""
        for request in requests:
            self.taken += 1
            fate = "timeout" if self.taken % 7 == 0 else "ok"
            number = sum(ord(c) for c in request["request_id"])
            self.waiting.append((self.calls + 2 + number % 30, {**request, "fate": fate}))

    def _record(self, kind: str, body: dict[str, Any]) -> dict[str, Any]:
        record = {"seq": self.seq, "kind": kind, "body": body}
        self.seq += 1
        return record


def run(seed: int = SEED, ticks: int = TICKS, host_seed: int = 0) -> dict[str, Any]:
    """Run to ``ticks`` and return the state hash after every call, plus a digest of the outputs.

    The summary counts what happened, so that a test can check that the run covered what it was
    written for. ``host_seed`` is not used. It is there so that the runner can call every driver
    alike.
    """
    saved = order.SUBSYSTEMS
    rest = tuple(m for m in saved if m.SECTION not in ("social", "goals"))
    order.SUBSYSTEMS = (*rest[:-1], asker(), rest[-1])
    try:
        game = Game(seed, "bridge", CONFIG)
        host = Host()
        hashes: list[str] = []
        digest = hashlib.sha256()
        events: dict[str, int] = {}
        tiers: dict[str, int] = {}
        reasons: dict[str, int] = {}
        stages: list[list[int]] = []
        while game.tick < ticks:
            tick = game.tick
            text = json.dumps(host.inputs(tick), separators=(",", ":"))
            out_json = game.step(text)
            out = json.loads(out_json)
            host.calls += 1
            host.take(out["requests"])
            digest.update(out_json.encode("utf-8"))
            hashes.append(game.hash())
            for request in out["requests"]:
                tiers[request["tier"]] = tiers.get(request["tier"], 0) + 1
            for event in out["events"]:
                events[event["kind"]] = events.get(event["kind"], 0) + 1
                if event["kind"] == "downgrade":
                    key = f"{event['asked']}>{event['tier']}:{event['reason']}"
                    reasons[key] = reasons.get(key, 0) + 1
                elif event["kind"] == "budget_stage":
                    stages.append([tick, event["previous"], event["stage"]])
        state = game._kernel.state["world"]
        return {
            "hashes": hashes,
            "outputs_digest": digest.hexdigest(),
            "final_tick": game.tick,
            "summary": {
                "events": events,
                "tiers": tiers,
                "reasons": reasons,
                "stages": stages,
                "budget": state["budget"],
                "goals": state["goals"],
                "ledger": json.loads(game.ledger_json()),
                "keen": crowd.keen_count(game._kernel.state),
                "final": hashlib.sha256(game.snapshot_json().encode("utf-8")).hexdigest(),
            },
        }
    finally:
        order.SUBSYSTEMS = saved
