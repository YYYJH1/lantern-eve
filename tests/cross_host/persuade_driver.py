"""One scripted game of the bridge scenario, played by the festival manager's actions alone, to run
unchanged under CPython and under Pyodide.

``Script`` plays the manager the way a page would, from what the last call's outputs show and
nothing else, and never uses a dev action (the config leaves ``dev_actions`` off). It mends the
bridge with the truth and with peace in five days:

- day 1: it talks to the head of the Zhou family, promises him a role, a stall and wages, and asks
  him to join the helpers, which he does; it calls for helpers (the call is for the crew of five and
  no more, and the others it brings are friends of his), and asks him for the timber. It asks
  Granny Li for her bamboo and is refused, and asks again and is told "I have told you already". It
  follows the rumour back from Granny Li to the madam and the clerk, and in the evening says at the
  teahouse, to the elder, the heads of both families, the clerk and Li Da, that what the madam told
  Granny Li goes beyond what the clerk saw. Granny Li lends the bamboo, and Li Da, who heard it,
  brings it. The Li family has nobody among the helpers yet, so it promises Li Da three things and
  asks him to join: the crew is ready. It has promised the night watchman a stall, for the day he
  will speak.
- days 2 to 4: it keeps a promise to the head of the Zhou family on the second day, the helpers
  work at the bridge on the third and the fourth, and on the fourth night the watchman, who is
  sober and speaks from then, says what he saw.
- day 5: it promises the clan elder an honour, asks him to call the clan to the hall, and when the
  clan has come and the hall is open, shows the evidence, fills in the card of the statement (the
  drunken kick, the night as it went, how the talk about Li Er grew) and makes the full statement,
  which tells the truth. It lays a table for the two families, and makes up that the boatman broke
  the rail, to someone who knows better since the statement, and is caught.

Along the way it asks, asks who told them, tells, promises (and one empty promise) and keeps one
promise. ``Driver`` is a host loop that feeds a ``Game`` the script's actions and a pause, and
throws the game away three times for one restored from its snapshot: in a conversation, in the
middle of the pause, and where the clan is called and the manager may speak.

The truth is the drunken kick, the testimony of the night watchman alone tells it apart, and the
head of the Zhou family joining brings four of his friends. The sky is clear, and the game starts
from the hearsay of the opening of the script.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from lantern_core.api import Game

SEED = 4
DAYS = 5
DAY = 2070
# Calls in a row that simulate no tick, past which the script is stuck: the world stands still while
# the manager is in a conversation, and a script that does not act in it would call for ever.
MAX_STILL = 1000
TICKS = DAYS * DAY
CONFIG = {
    "days": DAYS,
    "weather_clear": 1,
    "weather_light": 0,
    "weather_heavy": 0,
    "opening": "op_li_er_hearsay",  # the rumour is going round the Zhou house and the teahouse
    "variant": "v_drunk",  # and the truth is the drunken kick (the opening moves the seed's draw)
}
# The pause comes in the first conversation after this tick (on the second morning), at a moment
# when the script is not waiting for the answer to an action, and lasts this many calls.
PAUSE_AT = 2640
PAUSE_CALLS = 5

DONE = object()


def hm(frame: dict[str, Any]) -> tuple[int, int, int]:
    time = frame["time"]
    return time["day"], time["hour"], time["minute"]


class Note:
    """A field of an action that points at an entry of the manager's notebook: the one whose English
    words have ``words`` in them, whatever number it was given."""

    def __init__(self, words: str) -> None:
        self.words = words

    def find(self, out: dict[str, Any]) -> str:
        for entry in out["frame"]["notebook"]:
            if self.words in entry["text"]["en"]:
                return str(entry["id"])
        raise LookupError(f"no entry of the notebook has {self.words!r} in it")


def resolved(value: Any, out: dict[str, Any]) -> Any:
    """``value`` with each ``Note`` in it (or in a list in it) replaced by the id of its entry."""
    if isinstance(value, Note):
        return value.find(out)
    if isinstance(value, list):
        return [resolved(item, out) for item in value]
    return value


class Beat:
    """One step of the script. ``step`` returns an action, None to wait, or ``DONE``."""

    def step(self, script: Script, tick: int, out: dict[str, Any]) -> Any:
        raise NotImplementedError

    def waiting(self) -> bool:
        """Whether an action of this beat has been sent and its answer has not been read."""
        return False


class Wait(Beat):
    """Wait for a time of day (in the daytime hours of a game day). The world stands still while the
    manager is in a conversation, so they walk away from it first."""

    def __init__(self, day: int, hour: int, minute: int = 0) -> None:
        self.at = (day, hour, minute)

    def step(self, script: Script, tick: int, out: dict[str, Any]) -> Any:
        if hm(out["frame"]) >= self.at:
            return DONE
        return ("leave", {}) if out["frame"]["player"]["talk"] else None


class Leave(Beat):
    """Walk away from the conversation there is, so that the world goes on."""

    def step(self, script: Script, tick: int, out: dict[str, Any]) -> Any:
        return ("leave", {}) if out["frame"]["player"]["talk"] else DONE


class Go(Beat):
    """Walk to the door of a place."""

    def __init__(self, place: str) -> None:
        self.place = place
        self.sent = -100

    def step(self, script: Script, tick: int, out: dict[str, Any]) -> Any:
        me = out["frame"]["player"]
        if me["talk"]:
            return ("leave", {})
        door = script.doors[self.place]
        if (me["x"], me["y"]) == tuple(door):
            return DONE
        if me["activity"] != "walk" and tick - self.sent >= 6:
            self.sent = tick
            return ("move", {"place": self.place})
        return None


class Meet(Beat):
    """Start a conversation with a person, walking up to them first."""

    def __init__(self, npc: str) -> None:
        self.npc = npc
        self.sent = -100
        self.talked = -100

    def step(self, script: Script, tick: int, out: dict[str, Any]) -> Any:
        frame = out["frame"]
        me = frame["player"]
        if me["talk"]:
            return DONE if me["talk"]["npc"] == self.npc else ("leave", {})
        if me["activity"] == "work":
            return None
        there = next(n for n in frame["npcs"] if n["id"] == self.npc)
        near = max(abs(there["x"] - me["x"]), abs(there["y"] - me["y"])) <= 2
        if near and "talk" in frame["hud"]["verbs"] and tick - self.talked >= 12:
            self.talked = tick
            return ("talk", {"npc": self.npc})
        if not near and (me["activity"] != "walk" or tick - self.sent >= 24):
            self.sent = tick
            return ("move", {"x": there["x"], "y": there["y"]})
        return None


class Do(Beat):
    """Send an action, wait for its answer, and note it."""

    def __init__(self, label: str, type_: str, **fields: Any) -> None:
        self.label = label
        self.type = type_
        self.fields = fields
        self.id: str | None = None

    def waiting(self) -> bool:
        return self.id is not None

    def step(self, script: Script, tick: int, out: dict[str, Any]) -> Any:
        if self.id is None:
            self.id = f"{self.label}-{tick}"
            fields = {name: resolved(value, out) for name, value in self.fields.items()}
            return (self.type, {"_action_id": self.id, **fields})
        for event in out["events"]:
            if event["kind"] == "action_ack" and event["action_id"] == self.id:
                script.results[self.label] = (event["result"], event["reason"])
                return DONE
        return None


class Script:
    """The manager, as a list of beats played one after the other."""

    def __init__(self, scene: dict[str, Any], beats: list[Beat]) -> None:
        self.doors = {p["id"]: p["door"] for p in scene["places"]}
        self.beats = beats
        self.results: dict[str, tuple[str, str | None]] = {}

    def waiting(self) -> bool:
        return bool(self.beats) and self.beats[0].waiting()

    def choose(self, tick: int, out: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
        while self.beats:
            action = self.beats[0].step(self, tick, out)
            if action is DONE:
                self.beats.pop(0)
                continue
            return action
        return None


def beats() -> list[Beat]:
    """The game, beat by beat."""
    envy, at_bridge = Note("out of envy"), Note("Li Er was at the Stone Bridge last night.")
    return [
        # day 1, the morning: the head of the Zhou family
        Wait(1, 6, 30),
        Meet("zhou_zhanggui"),
        Do("zhou-ask-who", "ask", topic="pr_liner_damaged"),
        Do("zhou-role", "promise", what="role", item="lead_lanterns", due=5),
        Do("zhou-stall", "promise", what="stall", item="back", due=5),
        Do("zhou-wage", "promise", what="wage", amount=20, due=5),
        Do("zhou-join", "entrust", kind="join"),
        Do("rally", "rally"),
        Do("zhou-timber", "entrust", kind="material"),
        Do("zhou-empty", "promise", what="apology"),
        # Granny Li: no bamboo before the rumour is refuted, and the same asking draws no more
        Meet("li_laotai"),
        Do("granny-lend", "entrust", kind="lend"),
        Do("granny-lend-again", "entrust", kind="lend"),
        # where the talk came from: Granny Li, the madam, the clerk, who saw Li Er at the bridge
        Do("granny-ask", "ask", topic="li_er"),
        Meet("cha_laoban"),
        Do("madam-ask", "ask", topic="li_er"),
        Do("madam-source", "ask_source", entry=envy),
        Meet("zhou_huoji"),
        Do("clerk-source", "ask_source", entry=envy),
        Do("clerk-ask", "ask", topic="li_er"),
        Do("clerk-ask-again", "ask", topic="li_er"),
        # the evening at the teahouse: the people whose word counts are there by six
        Wait(1, 17, 38),
        Go("p_teahouse"),
        Wait(1, 18, 0),
        Do("clarify", "speak", kind="clarify", claim=envy, basis=[at_bridge]),
        Meet("li_laotai"),
        Do("granny-lend-now", "entrust", kind="lend"),
        # the bamboo is Li Da's, and he was there when it was cleared
        Meet("li_da"),
        Do("li-da-bamboo", "entrust", kind="material", cite=[Note("made clear in public")]),
        # the call was for the crew of five and the Li family had nobody in it: he is asked to join,
        # and joins once the manager has promised him three things
        Do("li-da-stall", "promise", what="stall", item="front", due=4),
        Do("li-da-wage", "promise", what="wage", amount=10, due=4),
        Do("li-da-wage-again", "promise", what="wage", amount=10, due=4),
        Do("li-da-join", "entrust", kind="join"),
        # the night watchman, who will speak from the fourth night, is promised a stall
        Wait(1, 19, 5),
        Meet("gengfu"),
        Do("watch-stall", "promise", what="stall", item="front", due=5),
        # day 2: a promise kept to the head of the Zhou family, and a lie that is caught
        Wait(2, 9, 0),
        Meet("zhou_zhanggui"),
        Do("zhou-keep", "promise", op="keep", id="k1"),
        Leave(),  # the helpers work at the bridge on the third and the fourth morning
        # day 4, after dark: the watchman, sober now, has seen the drunk man walk onto the bridge
        Wait(4, 19, 5),
        Meet("gengfu"),
        Do("watch-testify", "entrust", kind="testify"),
        Do("watch-tell", "tell", entry="n1", how="hide_source"),
        # day 5: the elder calls the clan, the evidence is shown, the families sit
        Wait(5, 8, 10),
        Meet("zuzhang"),
        Do("elder-honour", "promise", what="role", item="stage_words", due=5),
        Do("elder-convene", "entrust", kind="convene"),
        Go("p_clan_hall"),
        Wait(5, 10, 5),
        Do("hall-speak", "speak"),
        # the card of the statement is filled in from what the notebook holds (the watchman's word,
        # the rumour that was cleared) and the full statement is made at the hall, where the clan is
        Do("card-cause", "statement", op="choose", part="cause", option="drunk"),
        Do("card-course", "statement", op="choose", part="course", option="drunk_night"),
        Do("card-rumour", "statement", op="choose", part="rumour", option="grew"),
        Do("hall-statement", "speak", kind="statement"),
        Do("hall-meal", "speak", kind="meal"),
        # a lie: the boatman broke the rail. The town knows better since the statement, and so
        # does he
        Meet("old_he"),
        Do("old-lie", "tell", how="fabricate", pred="damaged", subject="old_he", object="t_rail"),
        Leave(),  # and the world goes on to the last night
    ]


class Driver:
    """A host loop with its own state."""

    # The game is restored from its snapshot at three moments, in this order: in a conversation
    # (with the night watchman, in the evening of the first day), in the middle of the pause (on the
    # second morning), and where the clan is called and the manager may speak (before they do).
    RESTORES = ("talk", "pause", "speak")

    def __init__(
        self, seed: int = SEED, config: dict[str, int] | None = None, restores: bool = True
    ) -> None:
        self.game = Game(seed, "bridge", CONFIG if config is None else config)
        self.script = Script(json.loads(self.game.scene_json()), beats())
        self.last: dict[str, Any] | None = None  # the outputs of the last call
        self.last_text = "[]"  # and the inputs it was given
        self.restores = restores
        self.seq = 0
        self.paused = 0
        self.pause_sent = False
        self.calls = 0
        self.restored = 0
        self.restored_talking = 0
        self.restored_meeting = 0
        self.actions: dict[str, int] = {}  # the actions the script sent, by type
        self.still = 0  # calls in a row that simulated no tick

    def restore(self) -> None:
        """Carry on with a game rebuilt from the snapshot of this one."""
        snapshot = self.game.snapshot_json()
        player = json.loads(snapshot)["world"]["player"]
        self.restored_talking += bool(player["talk"])
        self.restored_meeting += bool(player["meeting"])
        self.game = Game.from_snapshot_json(snapshot)
        self.restored += 1

    def _restore_due(self) -> bool:
        if not self.restores or self.last is None or self.restored >= len(self.RESTORES):
            return False
        frame = self.last["frame"]
        due = self.RESTORES[self.restored]
        if due == "talk":
            return bool(frame["player"]["talk"]) and self.game.tick >= 1560
        if due == "speak":
            meeting = self.game._kernel.state["world"]["player"]["meeting"]
            return "speak" in frame["hud"]["verbs"] and bool(meeting)  # the clan is called
        return False  # the pause restores by itself

    def _can_pause(self) -> bool:
        """In a conversation, and not between an action of the script and its answer."""
        return (
            self.last is not None
            and bool(self.last["frame"]["player"]["talk"])
            and not self.script.waiting()
        )

    def _scripted(self, tick: int) -> list[tuple[str, dict[str, Any]]]:
        if self.paused:
            self.paused -= 1
            if self.paused == 0:
                return [("resume", {})]
            if (
                self.restores
                and self.paused == 2
                and self.restored < len(self.RESTORES)
                and self.RESTORES[self.restored] == "pause"
            ):
                self.restore()
            return []
        if tick >= PAUSE_AT and not self.pause_sent and self._can_pause():
            self.pause_sent = True
            self.paused = PAUSE_CALLS
            return [("pause", {})]
        choice = None if self.last is None else self.script.choose(tick, self.last)
        if choice is None:
            return []
        kind, fields = choice
        action_id = fields.pop("_action_id", f"m{tick}")
        self.actions[kind] = self.actions.get(kind, 0) + 1
        return [("player", {"action_id": action_id, "type": kind, **fields})]

    def inputs(self) -> list[dict[str, Any]]:
        """The records of the next call."""
        if self._restore_due():
            self.restore()
        records = []
        for kind, body in self._scripted(self.game.tick):
            records.append({"seq": self.seq, "kind": kind, "body": body})
            self.seq += 1
        return records

    def call(self, step: Any = None) -> tuple[str, dict[str, Any]]:
        """One call of the game. Returns the outputs as text and parsed."""
        text = json.dumps(self.inputs(), separators=(",", ":"))
        out_json = (step or self.game.step)(text)
        self.calls += 1
        self.last_text = text
        self.last = json.loads(out_json)
        self.still = 0 if self.last["advanced"] else self.still + 1
        if self.still > MAX_STILL:
            raise RuntimeError(
                f"the world has stood still for {self.still} calls at tick {self.game.tick}: "
                "the script does not act in a conversation"
            )
        return out_json, self.last


def run(seed: int = SEED, ticks: int = TICKS, host_seed: int = 0, restores: bool = True) -> dict:
    """Run to ``ticks`` and return the state hash after every call, plus a digest of the outputs.

    The summary counts what happened, so that a test can check that the run covered what it was
    written for. ``host_seed`` is not used. It is there so that the runner can call every driver
    alike.
    """
    driver = Driver(seed, restores=restores)
    hashes: list[str] = []
    outputs_digest = hashlib.sha256()
    kinds: dict[str, int] = {}
    acks: dict[str, int] = {}
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
            elif event["kind"] == "ending":
                ending = {k: event[k] for k in sorted(event) if k not in ("reveal", "kind")}
                ending["spoke"] = event["reveal"]["player"]["spoke"]["tellings"]
    world = driver.game._kernel.state["world"]
    goals, me = world["goals"], world["player"]
    return {
        "hashes": hashes,
        "outputs_digest": outputs_digest.hexdigest(),
        "final_tick": driver.game.tick,
        "summary": {
            "calls": driver.calls,
            "restored": driver.restored,
            "restored_talking": driver.restored_talking,
            "restored_meeting": driver.restored_meeting,
            "events": kinds,
            "actions": dict(sorted(driver.actions.items())),
            "acks": acks,
            "results": {k: list(v) for k, v in sorted(driver.script.results.items())},
            "left": len(driver.script.beats),
            "flags": goals["flags"],
            "done": goals["done"],
            "metrics": goals["metrics"],
            "joined": len(goals["call"]["joined"]),
            "ending": ending,
            "trust": me["trust"],
            "pledges": [[p["id"], p["state"]] for p in me["pledges"]],
            "final": hashlib.sha256(driver.game.snapshot_json().encode("utf-8")).hexdigest(),
        },
    }
