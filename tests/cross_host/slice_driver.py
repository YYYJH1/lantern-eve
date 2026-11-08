"""One scripted game of the preset ``slice``, the game the opening page starts, to run unchanged
under CPython and under Pyodide.

The game is ``preset("slice")``: seed 492, the boatman as the truth, the opening of the script (the
rumour about Li Er already going round the Zhou house and the teahouse) and no heavy rain. A
``Route`` plays the festival manager the way a page would, from what the last call's outputs show
and nothing else, from the dawn of the first day to the morning of the second (2,700 ticks):

- it goes to Granny Li, asks her for the bamboo and is refused with the words that name the rumour,
  asks her about Li Er, and follows the lead that asks who started the talk (the action ``track``);
- it goes to the madam of the teahouse and asks her about Li Er, and asks who told her, and then to
  the clerk of the Zhou shop, whom it asks who told the madam (he says what he saw himself, which
  ends the lead it follows, and the core follows the next), and three times about Li Er (what he
  heard from the second son, where he saw him, and what Li Er was doing there);
- it asks for a hint, and judges that what the clerk saw (that Li Er was at the bridge) does not
  show what the madam's version says, which the core finds right, and ends the lead it follows
  (neither takes any time);
- it sets out for the teahouse at twenty to six and is there at six, where the elder, the madam,
  the clerk, Granny Li and her eldest son are together, and says in public that the madam's version
  goes beyond what the clerk saw (the action ``speak`` with the kind ``clarify``, which takes half
  an hour). Granny Li withdraws her objection, and Li Da, who heard it, is asked for the bamboo: he
  promises the first batch for seven o'clock the next morning. The manager lets the night pass, and
  the morning: Li Da sets out at dawn, the four poles lie at the bridge before seven, and the recap
  of the morning is made;
- at half past seven it asks Li Da for the next batch. He turns it down, since the manager owes him
  the favour of the first, and says so again to the same request (nothing has moved). A small
  promise to him, kept at once, moves the score: he promises four more for the middle of the
  morning, and asked once more while that promise is open he answers with the line that says what
  he promised and by when (the amount, the item, the day and the hour filled in by the core). The
  second batch lies at the bridge by ten, and the tasks of the bridge for the second day (the rest
  of the bamboo, the timber, the helpers) are in the frames.

The world stands still while the manager is in a conversation and runs fast for the minutes an act
takes (``lantern_core.world.bridge.pace``), so a call does not always simulate a tick, and a host
that is paying for an act sees a rate of ``[20, 1]``. The driver does what a host does about that:
it calls the core once per tick while the clock runs and brings it an input when it has one.

``run`` hashes the state after every call and throws the game away five times for one restored from
its snapshot: with the clerk, once while the world is still paying for his answers and once when it
is paid for and the conversation holds the clock; while the speech in public is being paid for, with
nobody to talk to; in the night between the promise and the dawn; and on the road in the morning
with the bamboo in Li Da's hands. The snapshot carries the config with the three texts of the
slice, the tasks the manager follows, the time that is owed, the promise and the errand. In the
middle of the first conversation the host also pauses the page, polls the core three times and
resumes, which leaves the debt and the hold as they were. Just before the first restore it asks the
core for the previews of six requests to the clerk (``PREVIEWS``), which must leave the hash as it
was and be the same again from the restored game. CPython runs it in this process and Pyodide in
Node, and the lists of hashes, the digest of every output, the previews and the summary must be
equal.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

try:
    from bots.base import Bot, Obs
except ImportError:  # under Pyodide the file is written next to the driver
    from base import Bot, Obs

from lantern_core.api import Game, preset

TICKS = 2700
STORY = "pr_liner_looking"
# Calls in a row that simulate no tick, past which the route is stuck: the world stands still while
# the manager is in a conversation, and a route that does not act in it would call for ever.
MAX_STILL = 1000
NIGHT, ROAD = 2000, 2100  # the ticks at which the game is carried over, after the promise
# what the page would ask the core about, in the talk with the clerk
PREVIEWS = (
    {"verb": "ask", "npc": "zhou_huoji", "topic": "li_er"},
    {"verb": "ask_source", "npc": "zhou_huoji", "entry": "n1"},
    {"verb": "tell", "npc": "zhou_huoji", "entry": "n2", "how": "as_seen"},
    {"verb": "entrust", "npc": "zhou_huoji", "kind": "testify"},
    {"verb": "entrust", "npc": "zhou_huoji", "kind": "join"},
    {"verb": "promise", "npc": "zhou_huoji", "op": "make", "what": "wage", "amount": 10, "due": 2},
)


def look(game: Game) -> list[dict[str, Any]]:
    """The previews of ``PREVIEWS`` now, which leave the game as it was."""
    before = game.hash()
    found = [json.loads(game.preview_json(json.dumps(action))) for action in PREVIEWS]
    assert game.hash() == before
    return found


class Evening(Bot):
    """The first day of the slice, from the dawn to the teahouse in the evening."""

    name = "slice"

    def play(self):
        yield from self.wait_until(1, 6, 30)
        if (yield from self.meet("li_laotai")):
            yield from self.entrust("lend")
            yield from self.act("ask", topic="li_er")
            yield from self.act("track", task="t_who_said")
            yield from self.leave()
        if (yield from self.meet("cha_laoban")):
            yield from self.act("ask", topic="li_er")
            yield from self.act("ask_source", entry=self.o.notebook[0]["id"])
            yield from self.leave()
        if (yield from self.meet("zhou_huoji")):
            yield from self.act("ask_source", entry=self.o.notebook[0]["id"])
            for _ in range(3):
                yield from self.act("ask", topic="li_er")
            yield from self.act("hint")
            seen = next(e for e in self.o.notebook if e["text"]["en"].startswith("Li Er was at"))
            yield from self.act(
                "judge", a=seen["id"], b=self.o.notebook[0]["id"], relation="unsupported"
            )
            self.stay = (
                self.o.tick
            )  # the game is carried over here, in the conversation, owing time
            while self.o.talking and not self.o.out["clock"]["paused"]:
                yield None  # the clock runs while the answers are paid for
            self.held = self.o.tick  # and here, where the conversation holds the clock
            yield from self.wait(5)
            yield from self.leave()
        yield from self.wait_until(1, 17, 38)
        yield from self.goto("p_teahouse")


class Route(Evening):
    """The first day of the slice and the night: the evening, then the clarification, and Li Da."""

    def play(self):
        yield from Evening.play(self)
        # n1 is what the madam told Granny Li, and n2 what the clerk saw: he is there, and says so
        yield from self.act("speak", kind="clarify", claim="n1", basis=["n2"])
        self.speech = self.o.tick  # the game is carried over while the speech is paid for
        if (yield from self.meet("li_da")):
            yield from self.entrust("material")
            yield from self.leave()
        # the morning after: the next batch is turned down (the manager owes him a favour now), a
        # small promise kept at once moves the score and he agrees, and the same request while that
        # promise is open is answered with the line that names it
        yield from self.wait_until(2, 7, 30)
        if (yield from self.meet("li_da")):
            yield from self.persuade("material")
            yield from self.entrust("material")
            yield from self.leave()
        while True:
            yield None


def record(game: Game, kind: str, body: dict[str, Any]) -> dict[str, Any]:
    return {"seq": game.next_seq, "kind": kind, "body": body}


def run(
    seed: int = 492, ticks: int = TICKS, host_seed: int = 0, restores: bool = True
) -> dict[str, Any]:
    """Run to ``ticks``, and return the state hash after every call, a digest of the outputs and a
    summary of what happened. ``seed`` and ``host_seed`` are there for the runner and are not used:
    the game is the preset. The restores from the snapshot are left out with ``restores=False``."""
    started = preset("slice")
    game = Game(started["seed"], started["scenario"], started["config"])
    bot = Route(json.loads(game.scene_json()), started["seed"])
    bot.stay = bot.held = bot.speech = -1
    out = json.loads(game.step("[]"))
    hashes = [game.hash()]
    outputs = hashlib.sha256()
    kinds: dict[str, int] = {}
    asked: list[list[Any]] = []
    entrusted: list[list[Any]] = []
    clarified: list[list[Any]] = []
    changes: list[list[Any]] = []
    answers: list[list[Any]] = []
    recap: list[Any] = []
    paper: list[Any] = []
    hints: list[dict[str, Any]] = []
    previews: list[dict[str, Any]] = []
    seen = {
        "restored": 0, "talking": 0, "owing": 0, "held": 0, "alone": 0, "pauses": 0,
        "calls_held": 0, "far": 0, "near": 0,
    }  # fmt: skip
    carried: set[int] = set()  # the ticks at which the game was carried over, night and road
    still = 0  # calls in a row that simulated no tick

    def call(records: list[dict[str, Any]]) -> None:
        """One call of the core, hashed, digested and counted."""
        nonlocal out, still
        text = game.step(json.dumps(records, separators=(",", ":")))
        outputs.update(text.encode("utf-8"))
        out = json.loads(text)
        hashes.append(game.hash())
        seen["calls_held"] += not out["advanced"]
        still = 0 if out["advanced"] else still + 1
        if still > MAX_STILL:
            raise RuntimeError(f"the world has stood still for {still} calls at tick {game.tick}")
        frame = out["frame"]
        if frame["recap"] is not None:
            recap.append([out["tick"], frame["recap"]])
        if frame["gazette"] is not None or frame["night"] is not None:
            paper.append([out["tick"], frame["gazette"], frame["night"]])
        seen["far"] += sum(1 for b in frame["bubbles"] if b["text"] is None)
        seen["near"] += sum(1 for b in frame["bubbles"] if b["text"] is not None)
        if frame["hint"] is not None and (not hints or hints[-1] != frame["hint"]):
            hints.append(frame["hint"])
        for event in out["events"]:
            kinds[event["kind"]] = kinds.get(event["kind"], 0) + 1
            if event["kind"] == "action_ack" and event["reason"] == "said_already":
                said = [b["text"] for b in frame["bubbles"] if b["npc"] == "li_da"]
                answers.append([out["tick"], said])
            if event["kind"] == "asked":
                asked.append([event["npc"], event["topic"], event["prop"], event["source"]])
            elif event["kind"] == "entrusted":
                entrusted.append([event["npc"], event["request"], event["result"], event["way"]])
            elif event["kind"] == "clarified":
                stands = [[row["npc"], row["before"], row["after"]] for row in event["audience"]]
                clarified.append([event["claim"], event["basis"], event["accepted"], stands])
            elif event["kind"] == "task_changed":
                changes.append([event["from"], event["to"], event["cause"], event["reason"]["en"]])

    def throw_away() -> None:
        """Swap the game for one restored from its snapshot, and count what it was caught in."""
        nonlocal game
        snapshot = game.snapshot_json()
        state = json.loads(snapshot)
        talk = bool(state["world"]["player"]["talk"])
        owing = "debt" in state["world"]["clock"]
        seen["talking"] += talk
        seen["owing"] += owing
        seen["held"] += talk and not owing
        seen["alone"] += owing and not talk
        game = Game.from_snapshot_json(snapshot)
        seen["restored"] += 1

    obs = Obs(out)
    while game.tick < ticks:
        action = bot.decide(obs)
        call([] if action is None else [record(game, "player", action)])
        obs = Obs(out)
        talking, fast = obs.talking, out["clock"]["rate"] == [20, 1]
        if talking and fast and not seen["pauses"]:
            # the host pauses the page in the middle of a payment, polls, and comes back
            for kind in ("pause", None, None, None, "resume"):
                call([] if kind is None else [record(game, kind, {})])
            seen["pauses"] += 1
            obs = Obs(out)
        if bot.stay > 0 and game.tick == bot.stay + 10 and talking:
            previews = look(game)
            if restores:
                throw_away()
                assert look(game) == previews  # and a game restored previews what it did
        if restores and bot.held > 0 and obs.talking and out["clock"]["paused"]:
            bot.held = -1
            throw_away()
        if restores and bot.speech > 0 and game.tick == bot.speech + 10 and not talking and fast:
            bot.speech = -1
            throw_away()
        if restores and game.tick in (NIGHT, ROAD) and game.tick not in carried:
            carried.add(game.tick)
            throw_away()
    state = json.loads(game.snapshot_json())
    social = state["world"]["social"]
    return {
        "hashes": hashes,
        "outputs_digest": outputs.hexdigest(),
        "final_tick": game.tick,
        "summary": {
            "events": kinds,
            "asked": asked,
            "entrusted": entrusted,
            "clarified": clarified,
            "changes": changes,
            "answers": answers,
            "tasks": {t["id"]: t["state"] for t in out["frame"]["tasks"]},
            "tracked": out["frame"]["tracked"],
            "commitments": out["frame"]["commitments"],
            "site": out["frame"]["site"],
            "recap": recap,
            "paper": paper,
            "cards": [c["id"] for c in out["frame"]["cards"]],
            "restored": seen["restored"],
            "restored_talking": seen["talking"],
            "restored_owing": seen["owing"],
            "restored_held": seen["held"],
            "restored_owing_alone": seen["alone"],
            "host_pauses": seen["pauses"],
            "calls_held": seen["calls_held"],
            "claims": len(social["claims"]),
            "judgments": state["world"]["player"]["judgments"],
            "hints": hints,
            "previews": hashlib.sha256(
                json.dumps(previews, sort_keys=True, ensure_ascii=False).encode("utf-8")
            ).hexdigest(),
            "costs": [p["cost"] for p in previews],
            "odds": [p["odds"] for p in previews],
            "blockers": [[b["en"] for b in p["blockers"]] for p in previews],
            "far_bubbles": seen["far"],
            "near_bubbles": seen["near"],
            "told": social["counts"]["told"],
            "config": state["config"],
            "notebook": [
                [e["id"], e["text"]["en"], e["source"].get("hand"), e["marks"]]
                for e in out["frame"]["notebook"]
            ],
            "final": hashlib.sha256(game.snapshot_json().encode("utf-8")).hexdigest(),
        },
    }


def bench(seed: int = 492, ticks: int = TICKS, host_seed: int = 0) -> dict[str, Any]:
    """Time the run: the seconds in ``Game.step`` and in total."""
    import time

    started = time.perf_counter()
    result = run(seed, ticks, host_seed)
    return {"ticks": result["final_tick"], "total_seconds": time.perf_counter() - started}
