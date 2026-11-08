"""One scripted run of the bridge game, written to run unchanged under CPython and under Pyodide.

``Driver`` plays the part of a host for a whole five-day game, 10,350 ticks. It feeds a ``Game``
the errands of a fixed script (through the ``assign`` player action, which the config
``dev_actions`` turns on), two pauses, and a resend of an action. It also plays the festival
manager with a ``Bot``, which reads each call's outputs the way a page does: it walks the town,
listens, talks, asks, asks who told it what and looks. Three times the driver throws the game
away and carries on with one restored from the snapshot: in the middle of each pause, and in the
middle of the third day. The bot is in the middle of a conversation at the first two (the world
stands still while it is not paid for an act, and the other person is held in place), which is how
a reloaded page or a restarted server picks up a game. ``run`` returns the state hash after every
call, which is what the cross-host test compares call for call, and the same run without the
restores has to give the same hashes.

A call does not always simulate a tick: the world is held while the manager is in a conversation
and nothing is owed. The driver does what a host does, which is to call the core again with the
bot's next act when the last outputs say that the clock is paused, and with nothing while the
clock runs. The inputs that belong to a tick (the errands, the pauses, the restore) go in the first
call at it.

The seed is one whose five days have clear days, a heavy rain on the second and a light rain on
the third and fourth. This module is plain Python on top of ``lantern_core`` and nothing in it
depends on the interpreter beyond that.
"""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from lantern_core.api import Game

SEED = 2015
TICKS = 5 * 2070
CONFIG = {"dev_actions": 1}
DAY = 2070
# Calls in a row that simulate no tick, past which the script is stuck: the world stands still while
# the manager is in a conversation, and a script that does not act in it would call for ever.
MAX_STILL = 1000


class Bot:
    """The festival manager as a host plays them: by what the last outputs show, and nothing else.

    It walks a tour of the town (or goes where ``walks`` sends it, by tick), listens when the frame
    says there is something to hear, looks when it stands by something to look at in the hours the
    place is open, opens a conversation with whoever is next to it (every ``every`` ticks, or, with
    ``windows``, by the first tick of a span at which someone is within reach), asks about a few
    topics and who told it what, and leaves after ninety ticks of the conversation. It acts in a
    conversation when the clock is paused, which is when the world is held and the last act is paid
    for, so it takes about one act in twenty ticks. A conversation opened in a span of ``windows``
    it never leaves: it goes on asking until the person says they have to go.
    Every choice is a function of the last outputs and the tick, so two games given the same bot
    are the same.
    """

    TOUR = ("p_bridge", "p_teahouse", "p_market", "p_ferry", "p_clan_hall", "p_tavern", "p_bridge")
    TOPICS = ("p_bridge", "t_rail", "li_er", "old_he", "pr_liner_damaged", "pr_he_under_bridge")
    STAY = 90  # ticks of a conversation before the bot leaves it

    def __init__(
        self,
        walks: dict[int, str] | None = None,
        windows: tuple[tuple[int, int], ...] = (),
        every: int = 40,
    ) -> None:
        self.walks = walks
        self.walked: set[int] = set()  # the ticks of ``walks`` whose walk the bot has set out on
        self.windows = windows
        self.every = every
        self.stop = 0  # the tour stop the bot is bound for
        self.talk_from = 0
        self.stays = True
        self.asked = 0
        self.looked: set[str] = set()

    def _near(self, frame: dict[str, Any]) -> list[tuple[int, str]]:
        me = frame["player"]
        found = (
            (max(abs(n["x"] - me["x"]), abs(n["y"] - me["y"])), n["id"]) for n in frame["npcs"]
        )
        return sorted(item for item in found if item[0] <= 2)

    def _converse(self, tick: int, out: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
        if not out["clock"]["paused"]:
            return None  # the world runs to pay for the last act
        spent = tick - self.talk_from
        if spent >= self.STAY and self.stays:
            return "leave", {}
        frame = out["frame"]
        traceable = [e for e in frame["notebook"] if e["chain"] and e["chain"][-1] is None]
        self.asked += 1
        if traceable and "ask_source" in frame["hud"]["verbs"] and self.asked % 2 == 1:
            return "ask_source", {"entry": traceable[0]["id"]}
        return "ask", {"topic": self.TOPICS[self.asked % len(self.TOPICS)]}

    def choose(self, tick: int, out: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
        frame = out["frame"]
        verbs, me = frame["hud"]["verbs"], frame["player"]
        if me["talk"]:
            return self._converse(tick, out)
        if "move" not in verbs:
            return None  # inspecting
        due = [] if self.walks is None else [t for t in self.walks if t <= tick]
        if due and max(due) not in self.walked:
            # a walk waits for the bot to be free: it may have been in a conversation at its tick
            self.walked.update(due)
            return "move", {"place": self.walks[max(due)]}
        if "listen" in verbs:
            return "listen", {}
        hour = frame["time"]["hour"]
        if "look" in verbs and 8 <= hour < 17 and me["look"][0] not in self.looked:
            self.looked.add(me["look"][0])
            return "look", {"at": me["look"][0]}
        near = self._near(frame)
        waiting = any(low <= tick < high for low, high in self.windows)
        if "talk" in verbs and near and (waiting or self._at_will(tick)):
            self.talk_from = tick
            self.stays = not waiting
            return "talk", {"npc": near[0][1]}
        if self.walks is None and me["activity"] == "rest" and tick % 30 == 0:
            self.stop += 1
            return "move", {"place": self.TOUR[self.stop % len(self.TOUR)]}
        return None

    def _at_will(self, tick: int) -> bool:
        return not self.windows and tick % self.every == 0


def assign(action_id: str, npc: str, **task: Any) -> dict[str, Any]:
    return {"action_id": action_id, "type": "assign", "npc": npc, "task": task}


# tick -> player actions that the first call at that tick carries
ACTIONS = {
    130: [
        assign(
            "a-bamboo",
            "li_da",
            kind="carry",
            item="bamboo",
            qty=10,
            src="p_li_house",
            dst="p_bridge",
        )
    ],
    131: [  # a resend of the action above: it acts once
        assign(
            "a-bamboo",
            "li_da",
            kind="carry",
            item="bamboo",
            qty=10,
            src="p_li_house",
            dst="p_bridge",
        )
    ],
    200: [
        assign(
            "a-timber",
            "zhou_zhanggui",
            kind="carry",
            item="timber",
            qty=8,
            src="p_zhou_house",
            dst="p_bridge",
        )
    ],
    600: [assign("a-brace", "mujiang", kind="work", place="p_bridge", hours=2)],
    1000: [  # more than there is: the errand fails when the person gets there
        assign("a-greedy", "li_er", kind="fetch", item="bamboo", place="p_li_house", qty=500)
    ],
    1200: [assign("a-empty", "gengfu", kind="deliver", place="p_bridge")],  # empty hands: rejected
    1500: [  # five hours of work from 18:05: the night comes first and the errand waits
        assign("a-late", "zhadeng_shifu", kind="work", place="p_bridge", hours=5)
    ],
    DAY + 80: [assign("a-bench", "li_xiaomei", kind="work", place="p_workshop", hours=2)],
    DAY + 230: [  # a heavy rain: the load stays put until the weather lets the carrier out
        assign(
            "a-tools",
            "miaozhu",
            kind="carry",
            item="tools",
            qty=1,
            src="p_workshop",
            dst="p_temple_lane",
        )
    ],
    2 * DAY + 60: [
        assign(
            "a-bamboo-2",
            "li_er",
            kind="carry",
            item="bamboo",
            qty=5,
            src="p_li_house",
            dst="p_bridge",
        )
    ],
}
# tick -> calls the world stays paused before the resume
PAUSES = {3000: 5, 7000: 4}
# The game is restored from its snapshot before the first call at tick 5200, and in the middle
# of each pause, when this many of its calls are left.
RESTORE_AT = 5200
RESTORE_IN_PAUSE = 2
# The manager: where it walks, and when it talks to whoever it has come to stand beside. It is in a
# conversation when the game is restored in the pause at 3000 and at 5200, and it lets one run out.
WALKS = {
    100: "p_teahouse",
    1000: "p_bridge",
    1500: "p_market",
    2500: "p_ferry",
    2800: "p_teahouse",
    3400: "p_bridge",
    5000: "p_teahouse",
    5500: "p_ferry",
    6500: "p_bridge",
    7400: "p_teahouse",
    8200: "p_market",
    9000: "p_teahouse",
}
# spans of ticks in which it starts a conversation when someone is within reach: the first two
# contain the restores, and the third lets the conversation run out
WINDOWS = ((400, 420), (2940, 3000), (5130, 5200), (7450, 7500), (9050, 9100))


class Driver:
    """A host loop with its own state."""

    def __init__(
        self, seed: int = SEED, config: dict[str, int] | None = None, restores: bool = True
    ) -> None:
        self.game = Game(seed, "bridge", CONFIG if config is None else config)
        self.bot = Bot(WALKS, WINDOWS)
        self.last: dict[str, Any] | None = None  # the outputs of the last call
        self.restores = restores
        self.seq = 0
        self.done: list[int] = []  # ticks whose scripted inputs have been sent
        self.resume_in = 0
        self.calls = 0
        self.restored = 0
        self.restored_talking = 0  # restores made in the middle of a conversation
        self.still = 0  # calls in a row that simulated no tick

    def restore(self) -> None:
        """Carry on with a game rebuilt from the snapshot of this one."""
        snapshot = self.game.snapshot_json()
        self.restored_talking += bool(json.loads(snapshot)["world"]["player"]["talk"])
        self.game = Game.from_snapshot_json(snapshot)
        self.restored += 1

    def _scripted(self, tick: int) -> list[tuple[str, dict[str, Any]]]:
        if self.resume_in:
            self.resume_in -= 1
            if self.resume_in == 0:
                return [("resume", {})]
            if self.restores and self.resume_in == RESTORE_IN_PAUSE:
                self.restore()
            return []
        scripted: list[tuple[str, dict[str, Any]]] = []
        first = tick not in self.done  # a held world gets more than one call at a tick
        if first:
            if self.restores and tick == RESTORE_AT:
                self.restore()
            scripted = [("player", a) for a in ACTIONS.get(tick, ())]
        choice = None if self.last is None else self.bot.choose(tick, self.last)
        if choice is not None:
            kind, fields = choice
            scripted.append(
                ("player", {"action_id": f"m{tick}-{self.seq}", "type": kind, **fields})
            )
        if first and tick in PAUSES:
            scripted.append(("pause", {}))
            self.resume_in = PAUSES[tick]
        if first and (scripted or tick == RESTORE_AT):
            self.done.append(tick)
        return scripted

    def inputs(self) -> list[dict[str, Any]]:
        """The records of the next call."""
        records = []
        for kind, body in self._scripted(self.game.tick):
            records.append({"seq": self.seq, "kind": kind, "body": body})
            self.seq += 1
        return records

    def call(self, step: Any = None) -> tuple[str, dict[str, Any]]:
        """One call of the game. Returns the outputs as text and parsed.

        ``step`` replaces ``game.step``, for a recorder that wraps it.
        """
        text = json.dumps(self.inputs(), separators=(",", ":"))
        out_json = (step or self.game.step)(text)
        self.calls += 1
        self.last = json.loads(out_json)
        self.still = 0 if self.last["advanced"] else self.still + 1
        if self.still > MAX_STILL:
            raise RuntimeError(
                f"the world has stood still for {self.still} calls at tick {self.game.tick}: "
                "the script does not act in a conversation"
            )
        return out_json, self.last

    def run_to(self, tick: int, step: Any = None) -> None:
        while self.game.tick < tick:
            self.call(step=step)


def run(
    seed: int = SEED,
    ticks: int = TICKS,
    host_seed: int = 0,
    restores: bool = True,
    driver_class: type[Driver] | None = None,
) -> dict:
    """Run to ``ticks`` and return the state hash after every call, plus a digest of the outputs.

    The summary counts what happened (events by kind, how the errands ended, the weather of each
    day, the restores), so that a test can check that the run covered what it was written for.
    ``host_seed`` is not used. It is there so that the runner can call every driver alike.
    ``driver_class`` is for a test that plays the game with another host loop.
    """
    driver = (driver_class or Driver)(seed, restores=restores)
    hashes: list[str] = []
    outputs_digest = hashlib.sha256()
    kinds: dict[str, int] = {}
    errands: dict[str, str] = {}
    acks: dict[str, int] = {}
    weather: list[str] = []
    activities: dict[str, int] = {}
    while driver.game.tick < ticks:
        out_json, outputs = driver.call()
        outputs_digest.update(out_json.encode("utf-8"))
        hashes.append(driver.game.hash())
        for event in outputs["events"]:
            kinds[event["kind"]] = kinds.get(event["kind"], 0) + 1
            if event["kind"] == "task_done":
                errands[f"{event['npc']}#{event['task']}"] = "done"
            elif event["kind"] == "task_fail":
                errands[f"{event['npc']}#{event['task']}"] = event["reason"]
            elif event["kind"] == "action_ack":
                key = event["result"] if event["reason"] is None else event["reason"]
                acks[key] = acks.get(key, 0) + 1
            elif event["kind"] == "weather":
                weather.append(event["weather"])
        if outputs["advanced"]:
            for npc in outputs["frame"]["npcs"]:
                activities[npc["activity"]] = activities.get(npc["activity"], 0) + 1
    return {
        "hashes": hashes,
        "outputs_digest": outputs_digest.hexdigest(),
        "final_tick": driver.game.tick,
        "summary": {
            "calls": driver.calls,
            "restored": driver.restored,
            "restored_talking": driver.restored_talking,
            "events": kinds,
            "errands": errands,
            "acks": acks,
            "weather": weather,
            "activities": activities,
            "final": hashlib.sha256(driver.game.snapshot_json().encode("utf-8")).hexdigest(),
        },
    }


def bench(seed: int = SEED, ticks: int = TICKS, host_seed: int = 0) -> dict[str, Any]:
    """Time a run of the scripted driver. Seconds in ``Game.step``, in ``hash``, and in total.

    ``worst_step_seconds`` is the slowest single call of ``Game.step``. The hash is taken after
    every call, as the cross-host test does, but the game only needs it every 100 ticks, so
    ``total_seconds`` leaves it out.
    """
    driver = Driver(seed, restores=False)
    in_step = in_hash = worst = 0.0
    started = time.perf_counter()
    while driver.game.tick < ticks:
        text = json.dumps(driver.inputs(), separators=(",", ":"))
        before = time.perf_counter()
        out_json = driver.game.step(text)
        spent = time.perf_counter() - before
        in_step += spent
        worst = max(worst, spent)
        driver.last = json.loads(out_json)
        driver.still = 0 if driver.last["advanced"] else driver.still + 1
        if driver.still > MAX_STILL:
            raise RuntimeError(f"the world has stood still for {driver.still} calls")
        before = time.perf_counter()
        driver.game.hash()
        in_hash += time.perf_counter() - before
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
