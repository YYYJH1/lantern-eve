"""The first day of the festival manager's game with a model answering, written to run unchanged
under CPython and under Pyodide.

``Driver`` is the driver of ``persuade_driver`` (the manager's actions, a restore from a snapshot in
a conversation) with a host that answers the requests of the core. The manager's words go with the
actions that take words, so that the judge of the wording is asked as well. The host is a table:
what a request gets, and how many calls later, depends only on its id and on how many requests came
before it, so a run is a function of the seed. A request is answered with a line that passes, a line
that is refused and then repaired, a line that is refused twice, text that is no reply at all, a
timeout or an error; a judgement with a score, a score past the limit, something that is no
judgement, or nothing at all.

``run`` returns the state hash after every call, which is what the cross-host test compares call for
call, and a summary of what happened.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import persuade_driver as base

SEED = base.SEED
TICKS = 2070  # the first day: the talks with the head of the Zhou family, Granny Li, the watchman
CONFIG = base.CONFIG
WORDS = {
    "ask": "Tell me what you know, friend.",
    "tell": "Take my word for it.",
    "promise": "You have my word, and a good place.",
    "entrust": "Please, the bridge needs every pair of hands.",
}

WINDY = '{"acts": [], "line": {"zh": "今天风很大。", "en": "Windy today."}}'
NOTICE = {"path": "belief", "prop": "pr_rail_broken", "modality": "assert", "source": "unknown"}
HEARD = json.dumps(
    {
        "acts": [NOTICE],
        "line": {"zh": "听说栏杆坏了。", "en": "I heard the rail is broken."},
        "mood": "warm",
    },
    ensure_ascii=False,
)
SPLICE = json.dumps(
    {
        "acts": [NOTICE],
        "line": {
            "zh": "桥下涨水了，因而栏杆坏了。",
            "en": "The water is up, therefore the rail broke.",
        },
    },
    ensure_ascii=False,
)
# what a first try gets, in turn; and what a repair gets after a first try that failed
REPLIES = (WINDY, HEARD, SPLICE, "no json here", ("timeout", ""), ("error", "http_500"), HEARD)
JUDGEMENTS = ('{"score": 7}', ("timeout", ""), '{"score": -4}', '{"score": 25}', "nothing useful")
DELAYS = (1, 2, 4, 1, 3, 6)


def with_words() -> list[base.Beat]:
    """The beats of the first game, with the manager's words in the actions that take them."""
    out = base.beats()
    for beat in out:
        if isinstance(beat, base.Do) and beat.type in WORDS and "words" not in beat.fields:
            beat.fields["words"] = WORDS[beat.type]
    return out


class Host:
    """The model of the host: it keeps every request and answers it after a while."""

    def __init__(self) -> None:
        self.waiting: list[tuple[int, dict[str, Any], str, str]] = []
        self.taken = 0
        self.counts = {"judge": 0, "repair": 0, "reply": 0}
        self.kinds: dict[str, int] = {}

    def take(self, requests: list[dict[str, Any]], calls: int) -> None:
        for request in requests:
            n = self.taken
            self.taken += 1
            verb = request["interaction_id"].split(":", 1)[0]
            repair = request["messages"][-1]["content"].startswith("[contract check]")
            kind = "judge" if verb == "judge" else "repair" if repair else "reply"
            table = {"judge": JUDGEMENTS, "repair": (WINDY, "{"), "reply": REPLIES}[kind]
            item = table[self.counts[kind] % len(table)]
            self.counts[kind] += 1
            status, text = ("ok", item) if isinstance(item, str) else item
            key = f"{kind}:{status}"
            self.kinds[key] = self.kinds.get(key, 0) + 1
            self.waiting.append((calls + DELAYS[n % len(DELAYS)], request, status, text))

    def due(self, calls: int) -> list[dict[str, Any]]:
        """The bodies of the results that fall due at the next call."""
        out, rest = [], []
        for entry in self.waiting:
            (out if entry[0] <= calls else rest).append(entry)
        self.waiting = rest
        bodies = []
        for _, request, status, text in out:
            usage = None if status != "ok" else {"input_tokens": 300, "output_tokens": 40}
            bodies.append(
                {
                    "request_id": request["request_id"],
                    "status": status,
                    "text": text,
                    "usage": usage,
                    "latency_ms": 5,
                }
            )
        return bodies


class Driver(base.Driver):
    """The driver of the game of the persuasion test, with a host that answers the model calls."""

    def __init__(self, seed: int = SEED, restores: bool = True) -> None:
        super().__init__(seed, CONFIG, restores)
        self.script = base.Script(json.loads(self.game.scene_json()), with_words())
        self.host = Host()

    def inputs(self) -> list[dict[str, Any]]:
        records = super().inputs()
        for body in self.host.due(self.calls):
            records.append({"seq": self.seq, "kind": "model_result", "body": body})
            self.seq += 1
        return records

    def call(self, step: Any = None) -> tuple[str, dict[str, Any]]:
        out_json, out = super().call(step)
        self.host.take(out["requests"], self.calls)
        return out_json, out


def run(seed: int = SEED, ticks: int = TICKS, host_seed: int = 0, restores: bool = True) -> dict:
    """Run to ``ticks`` and return the state hash after every call, plus a digest of the outputs.

    ``host_seed`` is not used. It is there so that the runner can call every driver alike.
    """
    driver = Driver(seed, restores=restores)
    hashes: list[str] = []
    digest = hashlib.sha256()
    kinds: dict[str, int] = {}
    tiers: dict[str, int] = {}
    answered: dict[str, int] = {}
    thinking = 0
    while driver.game.tick < ticks:
        out_json, out = driver.call()
        digest.update(out_json.encode("utf-8"))
        hashes.append(driver.game.hash())
        thinking += out["frame"]["player"]["thinking"] is not None
        for request in out["requests"]:
            tiers[request["tier"]] = tiers.get(request["tier"], 0) + 1
        for event in out["events"]:
            kinds[event["kind"]] = kinds.get(event["kind"], 0) + 1
            if event["kind"] == "answered":
                key = f"{event['verb']}:{event['result']}:{event['by']}:{event['cause']}"
                answered[key] = answered.get(key, 0) + 1
    world = driver.game._kernel.state["world"]
    speech = world["speech"]
    return {
        "hashes": hashes,
        "outputs_digest": digest.hexdigest(),
        "final_tick": driver.game.tick,
        "summary": {
            "calls": driver.calls,
            "restored": driver.restored,
            "restored_talking": driver.restored_talking,
            "events": kinds,
            "tiers": tiers,
            "answered": dict(sorted(answered.items())),
            "model": dict(sorted(driver.host.kinds.items())),
            "thinking": thinking,
            "left": len(driver.script.beats),
            "results": {k: list(v) for k, v in sorted(driver.script.results.items())},
            "speech": {k: speech[k] for k in sorted(speech) if k != "pending"},
            "pending": sorted(speech["pending"]),
            "in_flight": driver.game.in_flight(),
            "ledger": json.loads(driver.game.ledger_json()),
            "final": hashlib.sha256(driver.game.snapshot_json().encode("utf-8")).hexdigest(),
        },
    }
