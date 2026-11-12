"""One scripted run of a three-day game that its page watches, to run unchanged under CPython and
under Pyodide.

It is the run of ``goals_driver`` (the call, the helpers of both families on both banks of the
river, the work on the bridge on the morning of the third day, the truth, the peace and the last
night) with the page's part added. The page says in its first call that it shows the moments of the
festival (the player action ``moment``, ``watch``). A moment then holds the world, and the driver
lets it go the way a page does: after ``STILL_CALLS`` calls in which the world stood still (a page
shows the moment for three seconds meanwhile), with the action ``moment``, ``release``. In the
middle of the first hold the game is thrown away for one restored from its snapshot, so a world
that is held and a world that is held and restored have to be the same world.

``run`` returns the state hash after every call, a digest of the outputs, and a summary of what the
run covered: the moments in the order they came, the holds the driver saw, the calls in which the
world stood still, and the festival of the ending. This module is plain Python on top of
``lantern_core`` and ``goals_driver``.
"""

from __future__ import annotations

import hashlib
from typing import Any

import goals_driver as base

SEED, TICKS = base.SEED, base.TICKS
STILL_CALLS = 3  # calls in a row that stand still before the page lets the world go on


class Driver(base.Driver):
    """The host loop of ``goals_driver`` with a page that watches the moments."""

    def __init__(self, seed: int = SEED, restores: bool = True) -> None:
        super().__init__(seed, restores=restores)
        self.held: list[str] = []
        self.still = 0
        self.watched = False
        self.holds: list[list[Any]] = []  # [tick, kinds] each time a hold is first seen
        self.stills = 0
        self.restored_held = 0

    def inputs(self) -> list[dict[str, Any]]:
        if self.held and self.restores and self.still == 1 and not self.restored_held:
            self.restore()  # in the middle of the first hold
            self.restored_held += 1
        records = super().inputs()
        extra: list[tuple[str, dict[str, Any]]] = []
        if not self.watched:
            self.watched = True
            extra.append(("player", base.act("page-watch", "moment", op="watch")))
        if self.held:
            self.still += 1
            if self.still >= STILL_CALLS:
                kind = self.held[0]
                release = {"action_id": f"page-release-{kind}", "type": "moment"}
                extra.append(("player", {**release, "op": "release", "kind": kind}))
                self.still = 0
        for kind, body in extra:
            records.append({"seq": self.seq, "kind": kind, "body": body})
            self.seq += 1
        return records

    def call(self) -> tuple[str, dict[str, Any]]:
        out_json, out = super().call()
        held = list(out["frame"].get("moment_hold") or [])
        if held and not self.held:
            self.holds.append([self.game.tick, held])
        if not out["advanced"] and not self.resume_in:
            self.stills += 1
        self.held = held
        if not held:
            self.still = 0
        return out_json, out


def run(seed: int = SEED, ticks: int = TICKS, host_seed: int = 0, restores: bool = True) -> dict:
    """Run to ``ticks`` and return the state hash after every call, plus a digest of the outputs and
    a summary (see the module). ``host_seed`` is not used: the runner calls every driver alike."""
    driver = Driver(seed, restores=restores)
    hashes: list[str] = []
    outputs_digest = hashlib.sha256()
    kinds: dict[str, int] = {}
    acks: dict[str, int] = {}
    moments: list[dict[str, Any]] = []
    ending: dict[str, Any] = {}
    while driver.game.tick < ticks:
        out_json, outputs = driver.call()
        outputs_digest.update(out_json.encode("utf-8"))
        hashes.append(driver.game.hash())
        for event in outputs["events"]:
            kinds[event["kind"]] = kinds.get(event["kind"], 0) + 1
            if event["kind"] == "action_ack":
                key = event["result"] if event["reason"] is None else event["reason"]
                acks[key] = acks.get(key, 0) + 1
            elif event["kind"] == "moment":
                moments.append({k: event[k] for k in sorted(event)})
            elif event["kind"] == "ending":
                ending = {k: event[k] for k in sorted(event) if k not in ("reveal", "epilogue")}
    state = driver.game._kernel.state["world"]["goals"]
    return {
        "hashes": hashes,
        "outputs_digest": outputs_digest.hexdigest(),
        "final_tick": driver.game.tick,
        "summary": {
            "calls": driver.calls,
            "restored": driver.restored,
            "restored_held": driver.restored_held,
            "events": kinds,
            "acks": acks,
            "moments": moments,
            "listed": state["moments"]["list"],
            "held": state["moments"]["held"],
            "holds": driver.holds,
            "stills": driver.stills,
            "ending": ending,
            "final": hashlib.sha256(driver.game.snapshot_json().encode("utf-8")).hexdigest(),
        },
    }
