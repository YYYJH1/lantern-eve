"""Helpers for the tests of the words a model writes for a person in a talk with the manager.

``Room`` is a game with the manager in a talk, and the part of a host that matters here: it sends
actions and results to the core one call at a time, keeps every request that went out, and leaves it
to the test to say when and how each request is answered, so that the state between a request and
its result can be looked at. ``reply`` writes a reply the way a model would, and ``Script`` plays a
model that answers from a table. No model is called.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

from dealings_helpers import talking
from player_helpers import acks, events, me
from speech_helpers import belief, reply, unnamed  # noqa: F401  (re-exported for the tests)

from lantern_core.api import Game
from lantern_core.world.bridge import speech

USAGE = {"input_tokens": 120, "output_tokens": 40}
PLAIN_ACT = "pr_rail_broken"  # said by anyone who read the notice, with the source hidden


def say(zh: str, en: str, *acts: dict[str, Any], **extra: Any) -> str:
    """A reply of acts and a line in both languages."""
    return reply(list(acts), zh=zh, en=en, **extra)


def notice_act(source: str = "unknown") -> dict[str, Any]:
    """The act that says the rail is broken, which everyone read on the notice."""
    return belief(PLAIN_ACT, source)


class Room:
    """A game with the manager in a talk with ``who``, and the calls that a host makes."""

    def __init__(self, who: str = "cha_laoban", seed: int = 1, **config: Any) -> None:
        self.who = who
        self.game: Game = talking(who, seed=seed, **config)
        self.outs: list[dict[str, Any]] = []
        self.requests: list[dict[str, Any]] = []
        self.actions = 0

    @classmethod
    def awake(cls, who: str, seed: int = 1, **config: Any) -> Room:
        """A room with the manager in a talk with ``who``, at the first hour of the day that they
        will talk."""
        for hour in (9, 10, 11, 12, 14, 15, 16):
            try:
                return cls(who, seed=seed, hour=hour, **config)
            except AssertionError:
                continue
        raise AssertionError(f"{who} would not talk at any hour")

    # -- calls

    def call(self, *records: tuple[str, dict[str, Any]]) -> dict[str, Any]:
        """One call of the core with the given ``(kind, body)`` inputs, numbered as a host would."""
        batch = []
        seq = self.game.next_seq
        for kind, body in records:
            batch.append({"seq": seq, "kind": kind, "body": body})
            seq += 1
        out = json.loads(self.game.step(json.dumps(batch)))
        self.outs.append(out)
        self.requests += out["requests"]
        return out

    def act(self, type_: str, **fields: Any) -> dict[str, Any]:
        """One call that carries one action of the manager."""
        self.actions += 1
        body = {"action_id": f"r{self.actions}", "type": type_, **fields}
        return self.call(("player", body))

    def result(
        self, request: dict[str, Any] | str, status: str = "ok", text: str = ""
    ) -> dict[str, Any]:
        """One call that carries the result of a request: ``text`` for an ``ok``."""
        request_id = request if isinstance(request, str) else request["request_id"]
        usage = USAGE if status == "ok" else None
        body = {"request_id": request_id, "status": status, "text": text, "usage": usage}
        return self.call(("model_result", body))

    def step(self, ticks: int = 1) -> dict[str, Any]:
        """Let the world run for ``ticks`` calls with nothing to say. The last outputs."""
        out: dict[str, Any] = {}
        for _ in range(ticks):
            out = self.call()
        return out

    # -- what there is to see

    @property
    def section(self) -> dict[str, Any]:
        return self.game._kernel.state["world"][speech.SECTION]

    @property
    def flying(self) -> list[dict[str, Any]]:
        """The requests in flight, as the state keeps them."""
        return self.game._kernel.state["requests"]

    def line(self) -> list[Any]:
        return list(me(self.game)["line"])

    def bubble(self, out: dict[str, Any]) -> dict[str, str] | None:
        """The words over the head of the person in the frame of ``out``."""
        for bubble in out["frame"]["bubbles"]:
            if bubble["npc"] == self.who:
                return bubble["text"]
        return None

    def thinking(self, out: dict[str, Any]) -> str | None:
        return out["frame"]["player"]["thinking"]

    def answered(self, out: dict[str, Any]) -> list[dict[str, Any]]:
        return events(out, "answered")

    def ack(self, out: dict[str, Any]) -> list[tuple[str, str | None]]:
        return acks(out)


class Script:
    """A model that answers each request from a table, and keeps what it was asked.

    ``replies`` maps the beginning of an interaction id (``ask``, ``tell``, ``entrust``,
    ``promise``, ``judge``) to what the model answers, in order: the first for the first try and
    the second for the repair. An item is a text (an ``ok``) or a ``(status, text)`` pair. The last
    item repeats. A request the table has no row for gets an ``error``.
    """

    def __init__(self, replies: dict[str, Sequence[Any]]) -> None:
        self.replies = replies
        self.asked: list[dict[str, Any]] = []
        self.used: dict[str, int] = {}

    def __call__(self, request: dict[str, Any]) -> tuple[str, str]:
        self.asked.append(request)
        verb = request["interaction_id"].split(":", 1)[0]
        items = self.replies.get(verb)
        if not items:
            return "error", "no script"
        key = request["interaction_id"]
        n = self.used.get(key, 0)
        self.used[key] = n + 1
        item = items[min(n, len(items) - 1)]
        return ("ok", item) if isinstance(item, str) else item

    def play(self, room: Room, out: dict[str, Any]) -> dict[str, Any]:
        """Answer every request in ``out`` (and the repairs that follow) one call each, and return
        the outputs of the last call."""
        todo = list(out["requests"])
        while todo:
            request = todo.pop(0)
            status, text = self(request)
            out = room.result(request, status, text)
            todo += out["requests"]
        return out
