"""Helpers for the tests of the talk between neighbours: games played once and kept."""

from __future__ import annotations

import functools
import json
from dataclasses import dataclass, field
from typing import Any
from unittest import mock

from bridge_helpers import CAST, CYCLE, bridge, state_of

from lantern_core.world.bridge import social
from lantern_core.world.bridge.lore import lore

LORE = lore()
VARIANTS = ("v_boat", "v_flood", "v_drunk")
DAYS = 5


def variant_of(seed: int) -> str:
    return state_of(bridge(seed))["social"]["variant"]


@functools.cache
def seeds_of(variant: str, count: int = 3) -> tuple[int, ...]:
    """The first ``count`` seeds whose game draws ``variant`` for the truth."""
    found: list[int] = []
    seed = 0
    while len(found) < count:
        if variant_of(seed) == variant:
            found.append(seed)
        seed += 1
        assert seed < 200, f"no seed below 200 draws {variant}"
    return tuple(found)


@dataclass
class Played:
    """A game played to the end of its five days, with what it said on the way."""

    seed: int
    game: Any
    events: list[dict[str, Any]] = field(default_factory=list)
    shown: list[tuple[int, list[dict[str, Any]], list[dict[str, Any]]]] = field(
        default_factory=list
    )  # (tick of the frame, its bubbles, its dots) for each frame that has either
    told_at: dict[str, dict[str, Any]] = field(default_factory=dict)  # claim id -> who stood where
    hashes: list[str] = field(default_factory=list)

    @property
    def state(self) -> dict[str, Any]:
        return state_of(self.game)

    @property
    def section(self) -> dict[str, Any]:
        return self.state["social"]

    def stores(self):
        return social.stores(self.section)

    def claims(self):
        return social.claims(self.section)

    def book(self):
        return social.book(self.section)


@functools.cache
def played(seed: int, ticks: int = DAYS * CYCLE) -> Played:
    """Play ``seed`` for ``ticks`` ticks. The result is shared, so a test must only read it."""
    game = bridge(seed)
    run = Played(seed, game)
    # The manager stands on the bridge and hears only what is said near it. These tests are about
    # what the town says, so every telling shows its words (the filter is tested on its own).
    hear_everything = mock.patch.object(social, "near", lambda state, who: True)
    hear_everything.start()
    try:
        _play(run, game, ticks)
    finally:
        hear_everything.stop()
    return run


def _play(run: Played, game: Any, ticks: int) -> None:
    while game.tick < ticks:
        out = json.loads(game.step())
        run.events += out["events"]
        frame = out["frame"]
        if frame["bubbles"] or frame["dots"]:
            run.shown.append((game.tick, frame["bubbles"], frame["dots"]))
        for event in out["events"]:
            if event["kind"] == "told":
                npcs = state_of(game)["npcs"]["list"]
                me = npcs[CAST.index[event["speaker"]]]
                you = npcs[CAST.index[event["listener"]]]
                run.told_at[event["claim"]] = {"speaker": dict(me), "listener": dict(you)}
        if game.tick % 500 == 0:
            run.hashes.append(game.hash())


def told(run: Played) -> list[dict[str, Any]]:
    return [e for e in run.events if e["kind"] == "told"]
