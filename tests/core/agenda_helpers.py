"""Helpers for the tests of the tasks, the cards of the people and the projection of the frame."""

from __future__ import annotations

import json
from typing import Any

from bridge_helpers import state_of, step
from player_helpers import acks, act, beside, me, silence

from lantern_core.api import Game, preset

SLICE = preset("slice")


def slice_game(**config: Any) -> Game:
    """The game of the slice, with ``config`` laid over its keys."""
    return Game(SLICE["seed"], SLICE["scenario"], {**SLICE["config"], **config})


def meet(game: Game, who: str) -> dict[str, Any]:
    """End the conversation there is, and open one with ``who``, next to them."""
    if me(game)["talk"]:
        act(game, "leave")
    for _ in range(80):  # someone in the middle of telling a neighbour has to finish first
        beside(game, who)
        silence(game)
        out = act(game, "talk", npc=who)
        if acks(out) != [("rejected", "busy")]:
            break
    assert acks(out) == [("applied", None)], (who, acks(out))
    return out


def idle(game: Game) -> dict[str, Any]:
    """One call with nothing in it. The parsed outputs."""
    return json.loads(game.step())


def frame_now(game: Game) -> dict[str, Any]:
    """The frame the game would show now, without a tick: the world makes it from the state."""
    kernel = game._kernel
    return kernel.world.frame(kernel.state)


def tasks_of(frame: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The tasks of a frame by id."""
    return {task["id"]: task for task in frame["tasks"]}


def states(frame: dict[str, Any]) -> dict[str, str]:
    """Where each task of a frame stands, by id."""
    return {task["id"]: task["state"] for task in frame["tasks"]}


def zh(words: dict[str, str] | None) -> str | None:
    return None if words is None else words["zh"]


def changed(out: dict[str, Any]) -> list[dict[str, Any]]:
    """The ``task_changed`` events of a call."""
    return [e for e in out["events"] if e["kind"] == "task_changed"]


def without(game: Game, *sections: str) -> dict[str, Any]:
    """The state of the world with some sections left out."""
    return {k: v for k, v in state_of(game).items() if k not in sections}


def pause(game: Game) -> dict[str, Any]:
    return step(game, {"seq": game.next_seq, "kind": "pause", "body": {}})


def resume(game: Game) -> dict[str, Any]:
    return step(game, {"seq": game.next_seq, "kind": "resume", "body": {}})
