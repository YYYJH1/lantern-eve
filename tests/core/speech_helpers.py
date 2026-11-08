"""Helpers for the tests of what a model says for a townsperson.

``reply`` writes a reply the way a model would, ``say`` runs it through the gate for a speaker of a
real game, and ``install`` puts a stand-in for the code that asks for replies in the place of the
subsystem of the section ``speech``, with a ``Host`` that plays the model from a script. No model
is called.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

from bridge_helpers import run_to, state_of
from gate_helpers import Wire

from lantern_core.api import Game
from lantern_core.cognition import contract
from lantern_core.cognition.beliefs import Belief
from lantern_core.world.bridge import notes, order, speech

PLAYER = "player"
PLAIN_UNKNOWN = {"source": "unknown", "modality": "assert"}


def new_game(seed: int = 1, ticks: int = 5) -> Game:
    game = Game(seed, "bridge")
    run_to(game, ticks)
    return game


def hold(
    game: Game,
    holder: str,
    prop: str,
    source: str = "saw",
    modality: str = "assert",
    confidence: int = 90,
    teller: str | None = None,
    claimed: str | None = None,
    hop: int = 0,
    tick: int = 0,
    claim: str | None = None,
) -> None:
    """Write a belief of ``holder`` into the game, the way the talk between neighbours would."""
    belief = Belief(holder, prop, modality, confidence, source, teller, claimed, hop, tick, claim)
    notes.hold(state_of(game)["social"], belief)


def belief(prop: str, source: str, modality: str = "assert", **extra: Any) -> dict[str, Any]:
    """An act of the belief path."""
    return {"path": "belief", "prop": prop, "modality": modality, "source": source, **extra}


def unnamed(prop: str) -> dict[str, Any]:
    """A plain act: a belief said without naming where it came from."""
    return belief(prop, "unknown")


def reply(
    acts: Sequence[Any] = (),
    zh: str | None = None,
    en: str | None = None,
    **extra: Any,
) -> str:
    """A reply as text. A line is given by ``zh`` and ``en``."""
    body: dict[str, Any] = {"acts": list(acts)}
    if zh is not None or en is not None:
        body["line"] = {"zh": zh or "", "en": en or ""}
    body.update(extra)
    return json.dumps(body, ensure_ascii=False)


def speaker(
    game: Game,
    who: str,
    listeners: Sequence[str] = (PLAYER,),
    tick: int | None = None,
    pick: int = 0,
) -> contract.Speaker:
    return speech.speaker_for(
        state_of(game), who, listeners, game.tick if tick is None else tick, pick
    )


def say(
    game: Game,
    who: str,
    text: str,
    listeners: Sequence[str] = (PLAYER,),
    tick: int | None = None,
    pick: int = 0,
) -> contract.Gated:
    """What the gate makes of ``text`` as a reply of ``who`` to ``listeners``."""
    return contract.gate(text, speaker(game, who, listeners, tick, pick), speech.script())


def errors(gated: contract.Gated) -> list[tuple[str, str, str]]:
    """The errors of a result as ``(type, where, code)``, which is what a test asserts on."""
    return [(e.type, e.where, e.code) for e in gated.errors]


# ----------------------------------------------------------------------------- the stand-in


@dataclass
class Ask:
    """One request for a reply that the stand-in makes at a tick."""

    speaker: str
    interaction: str
    messages: list[dict[str, str]]
    listeners: tuple[str, ...] = (PLAYER,)
    tier: str = "cheap"
    max_tokens: int = 300
    valid_if: list[dict[str, Any]] = field(default_factory=list)


def prompt(quoted: str = "Hello.") -> list[dict[str, str]]:
    """The messages of a request: the instruction, then the player's words as quoted data."""
    return [
        {"role": "system", "content": "You are a townsperson. Reply with one JSON object."},
        {"role": "user", "content": f'Someone in town said: "{quoted}"'},
    ]


class Patches:
    """What pytest's ``monkeypatch`` does for ``install``, for a driver that runs without pytest."""

    def __init__(self) -> None:
        self.undo: list[tuple[Any, str, Any]] = []

    def setattr(self, target: Any, name: str, value: Any) -> None:
        self.undo.append((target, name, getattr(target, name)))
        setattr(target, name, value)

    def restore(self) -> None:
        for target, name, old in reversed(self.undo):
            setattr(target, name, old)
        self.undo.clear()


def install(monkeypatch: Any, plan: dict[int, list[Ask]]) -> None:
    """Put a subsystem that owns the section ``speech`` in place of the real one: it asks on
    ``plan`` (tick to asks) and takes the results as the real one does, handing each to
    ``speech.land`` and showing what comes back.

    The section keeps ``asked`` (who each interaction is for), ``log`` (a row for each result
    that landed: the request, the kind, the cause) and ``shown`` (a row for each line put on
    screen: tick, speaker, kind, by, zh, en). Only the lines that ``land`` returns are shown.
    """

    def init(world: Any, rng: Any) -> dict[str, Any]:
        return {**speech.fresh(), "asked": {}, "log": [], "shown": [], "alive": True}

    def alive(world: Any, state: dict[str, Any], condition: dict[str, Any]) -> bool:
        return bool(state["world"][speech.SECTION]["alive"])

    def tick(sim: Any) -> None:
        mine = sim.state[speech.SECTION]
        for ask in plan.get(sim.ctx.tick, ()):
            sim.ctx.issue(
                interaction_id=ask.interaction,
                tier=ask.tier,
                category="reply",
                messages=ask.messages,
                max_tokens=ask.max_tokens,
                valid_if=ask.valid_if,
            )
            mine["asked"][ask.interaction] = [ask.speaker, *ask.listeners]

    def land(sim: Any, request: dict[str, Any], status: str, text: str) -> None:
        mine = sim.state[speech.SECTION]
        who, *to = mine["asked"][request["interaction_id"]]
        landed = speech.land(sim, request, status, text, speaker=who, listeners=to)
        mine["log"].append([request["request_id"], landed.kind, landed.cause, landed.repair or ""])
        if landed.line is not None:
            row = [sim.ctx.tick, who, landed.kind, landed.by, landed.line["zh"], landed.line["en"]]
            mine["shown"].append(row)

    def frame(world: Any, state: dict[str, Any], out: dict[str, Any]) -> None:
        for now, who, _, _, zh, en in state["world"][speech.SECTION]["shown"]:
            if now <= state["tick"] < now + 60:
                out["bubbles"].append({"npc": who, "until": now + 60, "text": {"zh": zh, "en": en}})

    stand_in = SimpleNamespace(
        SECTION=speech.SECTION,
        init=init,
        tick=tick,
        frame=frame,
        RESULTS={"reply": land},
        CONDITIONS={"alive": alive},
    )
    # the stand-in takes the place of the subsystem of the section, which asks for nothing here
    rest = tuple(m for m in order.SUBSYSTEMS if m.SECTION != speech.SECTION)
    monkeypatch.setattr(order, "SUBSYSTEMS", (*rest[:-1], stand_in, rest[-1]))


Model = Callable[[dict[str, Any]], tuple[str, str]]


def scripted(replies: dict[str, Sequence[Any]]) -> Model:
    """A model that answers each interaction from a list: the first item for the first try and
    the second for the repair. An item is a text, or ``(status, text)`` for a result that is not ok.
    An interaction that is not listed gets an error."""

    def model(request: dict[str, Any]) -> tuple[str, str]:
        given = replies.get(request["interaction_id"])
        if given is None:
            return "error", "no script"
        item = given[1 if speech.is_repair(request) else 0]
        return ("ok", item) if isinstance(item, str) else item

    return model


class Host:
    """The part of the host that matters here: it plays the model from a script, and keeps every
    request that went out and every frame it was given."""

    def __init__(self, game: Game, model: Model, step: Callable[[str], str] | None = None) -> None:
        self.game, self.model = game, model
        self.wire = Wire(game, step)
        self.todo: list[tuple[str, dict[str, Any]]] = []
        self.requests: list[dict[str, Any]] = []
        self.frames: list[dict[str, Any]] = []
        self.events: list[dict[str, Any]] = []

    def step(self) -> dict[str, Any]:
        out = self.wire.step(*self.todo)
        self.todo = []
        for request in out["requests"]:
            self.requests.append(request)
            status, text = self.model(request)
            usage = {"input_tokens": 20, "output_tokens": 20} if status == "ok" else None
            self.todo.append(self.wire.result(request["request_id"], status, usage, text))
        self.frames.append(out["frame"])
        self.events += out["events"]
        return out

    def run_to(self, tick: int) -> None:
        while self.game.tick < tick:
            if self.game.paused:  # nothing but an act of the manager starts a held world again
                raise AssertionError(
                    f"the world is stopped at tick {self.game.tick}, before {tick}"
                )
            self.step()

    def section(self) -> dict[str, Any]:
        return state_of(self.game)[speech.SECTION]

    def shown(self) -> list[list[Any]]:
        return self.section()["shown"]

    def bubble_texts(self) -> list[dict[str, str]]:
        """Every text any frame ever showed over a head."""
        return [b["text"] for frame in self.frames for b in frame["bubbles"]]
