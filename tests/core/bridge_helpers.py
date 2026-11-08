"""Small helpers for tests of the bridge scenario."""

from __future__ import annotations

import json
from typing import Any

from lantern_core.api import Game
from lantern_core.world.bridge import clock
from lantern_core.world.bridge.world import BridgeWorld, static

CLEAR = {"weather_clear": 1, "weather_light": 0, "weather_heavy": 0}
LIGHT = {"weather_clear": 0, "weather_light": 1, "weather_heavy": 0}
HEAVY = {"weather_clear": 0, "weather_light": 0, "weather_heavy": 1}
CYCLE = clock.CYCLE_TICKS
TOWN, CAST = static()
PEOPLE = CAST.people


def bridge(seed: int = 1, **config: int) -> Game:
    """A new bridge game. Config keys are given as keyword arguments."""
    return Game(seed, "bridge", config or None)


def state_of(game: Game) -> dict[str, Any]:
    """The live world state of ``game``. Reading it is cheap, and a test must not write to it
    except to set up a case."""
    return game._kernel.state["world"]


def world_of(game: Game) -> BridgeWorld:
    return game._kernel.world


def step(game: Game, *records: dict[str, Any]) -> dict[str, Any]:
    """One call with the given input records; the parsed outputs."""
    return json.loads(game.step(json.dumps(list(records))))


def run_to(game: Game, tick: int, each=None) -> None:
    """Call ``step`` until the game stands at ``tick``; ``each(outputs)`` sees every call.

    A stopped world (paused by the host, or held by a conversation with nothing owed) does not get
    there by being stepped, so that is an error here and not a loop that never ends."""
    while game.tick < tick:
        if game.paused:
            raise AssertionError(f"the world is stopped at tick {game.tick}, before tick {tick}")
        out = json.loads(game.step())
        if each is not None:
            each(out)


def at(day: int, hour: int, minute: int = 0) -> int:
    """The tick at which the clock reads ``hour:minute`` of game day ``day`` (06:00 starts it)."""
    base = (day - 1) * CYCLE + clock.hour_start(hour)
    if clock.DAWN_HOUR <= hour < clock.DUSK_HOUR:
        return base + minute * clock.DAY_TICKS_PER_HOUR // 60
    return base + minute * clock.NIGHT_TICKS_PER_HOUR // 60


def assign_body(action_id: str, npc: str, **task: Any) -> dict[str, Any]:
    """The body of the dev player action that posts an errand."""
    return {"action_id": action_id, "type": "assign", "npc": npc, "task": task}


def player(seq: int, body: dict[str, Any]) -> dict[str, Any]:
    return {"seq": seq, "kind": "player", "body": body}


def near(npc: dict[str, Any], cell: tuple[int, int], radius: int = 1) -> bool:
    return max(abs(npc["x"] - cell[0]), abs(npc["y"] - cell[1])) <= radius


def person(npc_id: str):
    return PEOPLE[CAST.index[npc_id]]


def stand(npc_id: str, place: str) -> tuple[int, int]:
    return TOWN.stand(place, CAST.index[npc_id])


def npc_of(game: Game, npc_id: str) -> dict[str, Any]:
    return state_of(game)["npcs"]["list"][CAST.index[npc_id]]


def seed_with_weather(plan: list[str], limit: int = 400) -> int:
    """The first seed whose weather plan starts with ``plan``."""
    for seed in range(limit):
        if state_of(Game(seed, "bridge"))["weather"]["plan"][: len(plan)] == plan:
            return seed
    raise AssertionError(f"no seed below {limit} has the weather {plan}")
