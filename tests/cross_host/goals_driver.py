"""One scripted run of a three-day game with the goals at work, to run unchanged under CPython and
under Pyodide.

``Driver`` plays the part of a host for a game of three days, 6,210 ticks, in which the festival
manager calls for helpers (the player action ``rally``) and the dev action ``dev_goal`` stands in
for the persuasion that comes later: it wins over ten helpers (the call itself is for the crew of
five and no more, so the rest are asked one by one), has the bamboo and the timber brought to the
bridge, has the temple keeper open the lane, tells the truth in public and sees the families
reconciled. The helpers work on the bridge on the morning of the third day, the lanterns along
the lane are hung on the first, and the night of the third day is the last night: the ending and
the reveal. Actions are resent, refused and sent in a pause. The game is thrown away three times
for one restored from its snapshot: in the middle of the pause, in the middle of the work on the
third day, and just before the last night begins.

``run`` returns the state hash after every call, which is what the cross-host test compares call
for call, a digest of the outputs, and a summary of what the goals did. The same run without the
restores has to give the same hashes. The weather has no heavy rain. This module is plain Python
on top of ``lantern_core`` and nothing in it depends on the interpreter beyond that.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from lantern_core.api import Game

SEED = 2021
DAYS = 3
DAY = 2070
TICKS = DAYS * DAY
CONFIG = {
    "dev_actions": 1,
    "days": DAYS,
    "weather_clear": 3,
    "weather_light": 2,
    "weather_heavy": 0,
}


def act(action_id: str, kind: str, **fields: Any) -> dict[str, Any]:
    return {"action_id": action_id, "type": kind, **fields}


def dev(action_id: str, op: str, **fields: Any) -> dict[str, Any]:
    return act(action_id, "dev_goal", op=op, **fields)


# tick -> player actions that the first call at that tick carries
ACTIONS = {
    100: [
        act("rally", "rally"),
        dev("win-tea", "join", npc="cha_laoban"),
        dev("win-madam", "join", npc="zhou_niangzi"),
        *[
            dev(f"win-{who}", "join", npc=who)
            for who in (
                "li_da",
                "li_er",
                "li_xiaomei",
                "zhou_dalang",
                "zhou_erlang",
                "zhou_huoji",
                "old_he",
                "mujiang",
            )
        ],
    ],
    101: [act("rally", "rally")],  # a resend: it acts once
    102: [act("rally-again", "rally")],  # the call is out already: refused
    130: [dev("bamboo", "material", npc="li_da"), dev("timber", "material", npc="zhou_zhanggui")],
    131: [dev("bamboo-again", "material", npc="li_da")],  # on the way: refused
    360: [dev("lane", "lane", npc="miaozhu"), dev("lane-liar", "lane", npc="li_da")],
    DAY + 300: [
        dev("truth", "truth"),
        dev("peace", "reconcile"),
        dev("forgive", "grudge", value=12),
        dev("a-child", "join", npc="shitou"),  # a child cannot help: refused
    ],
}
# tick -> calls the world stays paused before the resume
PAUSES = {3000: 5}
# The game is restored from its snapshot in the middle of the pause (when this many of its calls
# are left) and before the first call at each tick of ``RESTORE_AT``: in the middle of the work
# of the third day, and at the first tick of the last night.
RESTORE_IN_PAUSE = 2
RESTORE_AT = (2 * DAY + 400, 2 * DAY + 1800)


class Driver:
    """A host loop with its own state."""

    def __init__(
        self, seed: int = SEED, config: dict[str, int] | None = None, restores: bool = True
    ) -> None:
        self.game = Game(seed, "bridge", CONFIG if config is None else config)
        self.restores = restores
        self.seq = 0
        self.done: list[int] = []  # ticks whose scripted inputs have been sent
        self.resume_in = 0
        self.calls = 0
        self.restored = 0

    def restore(self) -> None:
        """Carry on with a game rebuilt from the snapshot of this one."""
        self.game = Game.from_snapshot_json(self.game.snapshot_json())
        self.restored += 1

    def _scripted(self, tick: int) -> list[tuple[str, dict[str, Any]]]:
        if self.resume_in:
            self.resume_in -= 1
            if self.resume_in == 0:
                return [("resume", {})]
            if self.restores and self.resume_in == RESTORE_IN_PAUSE:
                self.restore()
            return []
        if tick in self.done:
            return []
        if self.restores and tick in RESTORE_AT:
            self.restore()
        scripted: list[tuple[str, dict[str, Any]]] = [("player", a) for a in ACTIONS.get(tick, ())]
        if tick in PAUSES:
            scripted.append(("pause", {}))
            self.resume_in = PAUSES[tick]
        if scripted or tick in RESTORE_AT:
            self.done.append(tick)
        return scripted

    def inputs(self) -> list[dict[str, Any]]:
        """The records of the next call."""
        records = []
        for kind, body in self._scripted(self.game.tick):
            records.append({"seq": self.seq, "kind": kind, "body": body})
            self.seq += 1
        return records

    def call(self) -> tuple[str, dict[str, Any]]:
        """One call of the game. Returns the outputs as text and parsed."""
        text = json.dumps(self.inputs(), separators=(",", ":"))  # may restore the game first
        out_json = self.game.step(text)
        self.calls += 1
        return out_json, json.loads(out_json)


def run(seed: int = SEED, ticks: int = TICKS, host_seed: int = 0, restores: bool = True) -> dict:
    """Run to ``ticks`` and return the state hash after every call, plus a digest of the outputs.

    The summary counts what happened (events by kind, how the actions were answered, who joined
    and in which round, the flags and goals and when, the ending), so that a test can check that
    the run covered what it was written for. ``host_seed`` is not used. It is there so that the
    runner can call every driver alike.
    """
    driver = Driver(seed, restores=restores)
    hashes: list[str] = []
    outputs_digest = hashlib.sha256()
    kinds: dict[str, int] = {}
    acks: dict[str, int] = {}
    errands: dict[str, int] = {}
    rounds: dict[str, int] = {}
    most_lanterns = 0
    ending: dict[str, Any] = {}
    last_hud: dict[str, Any] = {}
    while driver.game.tick < ticks:
        out_json, outputs = driver.call()
        outputs_digest.update(out_json.encode("utf-8"))
        hashes.append(driver.game.hash())
        for event in outputs["events"]:
            kinds[event["kind"]] = kinds.get(event["kind"], 0) + 1
            if event["kind"] == "action_ack":
                key = event["result"] if event["reason"] is None else event["reason"]
                acks[key] = acks.get(key, 0) + 1
            elif event["kind"] == "joined":
                rounds[event["npc"]] = event["round"]
            elif event["kind"] == "task_done":
                errands[event["goal"]] = errands.get(event["goal"], 0) + 1
            elif event["kind"] == "ending":
                ending = {k: event[k] for k in sorted(event) if k not in ("reveal", "kind")}
                ending["chains"] = len(event["reveal"]["chains"])
                ending["told"] = event["reveal"]["told"]
        frame = outputs["frame"]
        most_lanterns = max(most_lanterns, len(frame["lanterns"]))
        last_hud = {k: frame["hud"][k] for k in ("promised", "turnout", "bridge", "ending")}
    goals = driver.game._kernel.state["world"]["goals"]
    return {
        "hashes": hashes,
        "outputs_digest": outputs_digest.hexdigest(),
        "final_tick": driver.game.tick,
        "summary": {
            "calls": driver.calls,
            "restored": driver.restored,
            "events": kinds,
            "acks": acks,
            "errands": errands,
            "rounds": rounds,
            "flags": goals["flags"],
            "done": goals["done"],
            "metrics": goals["metrics"],
            "work": goals["work"],
            "lane": goals["lane"],
            "joined": len(goals["call"]["joined"]),
            "households": goals["call"]["households"],
            "most_lanterns": most_lanterns,
            "hud": last_hud,
            "ending": ending,
            "final": hashlib.sha256(driver.game.snapshot_json().encode("utf-8")).hexdigest(),
        },
    }
