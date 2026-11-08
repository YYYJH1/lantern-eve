"""One scripted run of the m0 game, written to run unchanged under CPython and under Pyodide.

``Driver`` plays the part of a host: it feeds a ``Game`` the answers of a ``MockModelHost`` and
a fixed script of pauses and player actions, one ``step`` per call. ``run`` returns the state
hash after every call, which is what the cross-host test compares tick for tick. This module
is plain Python on top of ``lantern_core`` and ``mock_host``, and nothing in it depends on the
interpreter beyond them.
"""

from __future__ import annotations

import copy
import hashlib
import json
import time
from typing import Any

from mock_host import MockModelHost

from lantern_core.api import Game

SEED = 2026
HOST_SEED = 7
TICKS = 2000
# Meetings are denser and chats likelier than in the scenario's defaults, so that a short run
# has many requests in flight at once.
CONFIG = {"encounter_cooldown": 200, "chatter_per_mille": 850}

# tick -> player actions as (action_id, npc, x, y), applied by the first call at that tick
ACTIONS = {
    300: [("a-300", "npc03", 31, 10)],
    301: [("a-300", "npc03", 31, 10)],  # a resend of the action above: it acts once
    900: [("a-900", "npc05", 12, 20)],
    1500: [("a-1500", "npc01", 22, 5)],  # a cell in the river: rejected
    1800: [("a-1800", "npc08", 40, 28)],
}
# tick -> calls the world stays paused before the resume. The host keeps calling meanwhile.
PAUSES = {700: 6, 1200: 3}


class Driver:
    """A host loop with its own state, copyable to fork a run."""

    def __init__(
        self, seed: int = SEED, host_seed: int = HOST_SEED, config: dict[str, int] | None = None
    ) -> None:
        self.game = Game(seed, config=CONFIG if config is None else config)
        self.host = MockModelHost(host_seed)
        self.seq = 0
        self.done: list[int] = []  # ticks whose scripted inputs have been sent
        self.resume_in = 0
        self.calls = 0

    def clone(self) -> Driver:
        """A driver that continues from here, on a game restored from this one's snapshot."""
        other = Driver.__new__(Driver)
        other.game = Game.from_snapshot_json(self.game.snapshot_json())
        other.host = copy.deepcopy(self.host)
        other.seq = self.seq
        other.done = list(self.done)
        other.resume_in = self.resume_in
        other.calls = self.calls
        return other

    def _scripted(self, tick: int) -> list[tuple[str, dict[str, Any]]]:
        if self.resume_in:
            self.resume_in -= 1
            return [("resume", {})] if self.resume_in == 0 else []
        if tick in self.done:
            return []
        scripted: list[tuple[str, dict[str, Any]]] = []
        for action_id, npc, x, y in ACTIONS.get(tick, ()):
            body = {"action_id": action_id, "type": "summon", "npc": npc, "x": x, "y": y}
            scripted.append(("player", body))
        if tick in PAUSES:
            scripted.append(("pause", {}))
            self.resume_in = PAUSES[tick]
        if scripted:
            self.done.append(tick)
        return scripted

    def inputs(self, extra: list[tuple[str, dict[str, Any]]] = ()) -> list[dict[str, Any]]:
        """The records of the next call: arrived answers, then ``extra``, then the script."""
        pairs = [("model_result", body) for body in self.host.deliver()]
        pairs += list(extra) + self._scripted(self.game.tick)
        records = []
        for kind, body in pairs:
            records.append({"seq": self.seq, "kind": kind, "body": body})
            self.seq += 1
        return records

    def call(
        self, extra: list[tuple[str, dict[str, Any]]] = (), step: Any = None
    ) -> tuple[str, dict[str, Any]]:
        """One call of the game. Returns the outputs as text and parsed.

        ``step`` replaces ``game.step``, for a recorder that wraps it.
        """
        text = json.dumps(self.inputs(extra), separators=(",", ":"))
        out_json = (step or self.game.step)(text)
        outputs = json.loads(out_json)
        self.host.accept(outputs)
        self.calls += 1
        return out_json, outputs

    def run_to(self, tick: int, step: Any = None) -> None:
        while self.game.tick < tick:
            self.call(step=step)


def summarize(driver: Driver, kinds: dict[str, int], voids: dict[str, int], cancels: int) -> dict:
    return {
        "calls": driver.calls,
        "events": kinds,
        "voids": voids,
        "cancels": cancels,
        "ledger": json.loads(driver.game.ledger_json()),
        "host": dict(driver.host.stats),
        "in_flight": driver.game.in_flight(),
    }


def run(seed: int = SEED, ticks: int = TICKS, host_seed: int = HOST_SEED) -> dict[str, Any]:
    """Run to ``ticks`` and return the state hash after every call, plus a digest of the outputs.

    The summary counts what happened (events by kind, voids by reason, cancels), so a test can
    check that the run covered the cases it was written to cover.
    """
    driver = Driver(seed, host_seed)
    hashes: list[str] = []
    outputs_digest = hashlib.sha256()
    kinds: dict[str, int] = {}
    voids: dict[str, int] = {}
    cancels = 0
    while driver.game.tick < ticks:
        out_json, outputs = driver.call()
        outputs_digest.update(out_json.encode("utf-8"))
        hashes.append(driver.game.hash())
        cancels += len(outputs["cancels"])
        for event in outputs["events"]:
            kinds[event["kind"]] = kinds.get(event["kind"], 0) + 1
            if event["kind"] == "void":
                voids[event["reason"]] = voids.get(event["reason"], 0) + 1
    return {
        "hashes": hashes,
        "outputs_digest": outputs_digest.hexdigest(),
        "final_tick": driver.game.tick,
        "summary": summarize(driver, kinds, voids, cancels),
    }


def bench(seed: int = SEED, ticks: int = TICKS, host_seed: int = HOST_SEED) -> dict[str, Any]:
    """Time a run of the scripted driver. Seconds in ``Game.step``, in ``hash``, and in total.

    ``worst_step_seconds`` is the slowest single call of ``Game.step``.

    The hash is taken after every call, as the cross-host test does, but the game only needs
    it every 100 ticks, so ``total_seconds`` leaves it out.
    """
    driver = Driver(seed, host_seed)
    in_step = in_hash = worst = 0.0
    started = time.perf_counter()
    while driver.game.tick < ticks:
        text = json.dumps(driver.inputs(), separators=(",", ":"))
        before = time.perf_counter()
        out_json = driver.game.step(text)
        spent = time.perf_counter() - before
        in_step += spent
        worst = max(worst, spent)
        before = time.perf_counter()
        driver.game.hash()
        in_hash += time.perf_counter() - before
        driver.host.accept(json.loads(out_json))
        driver.calls += 1
    total = time.perf_counter() - started - in_hash
    return {
        "ticks": driver.game.tick,
        "calls": driver.calls,
        "step_seconds": in_step,
        "worst_step_seconds": worst,
        "hash_seconds": in_hash,
        "total_seconds": total,
    }
