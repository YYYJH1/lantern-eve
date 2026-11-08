"""Helpers for the tests of the night: beliefs set by hand, chains of tellings, a game at the eve of
a night, and the plans of a pass."""

from __future__ import annotations

import functools
from typing import Any

from bridge_helpers import CLEAR, at, bridge, run_to, state_of, world_of

from lantern_core.api import Game
from lantern_core.cognition.beliefs import SELF_SEEN, Belief, Claim
from lantern_core.kernel import Ctx
from lantern_core.world.bridge import clock, notes, reflection
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.sim import Sim

LORE = lore()
EVE = at(1, 23) - 1  # the last tick before the first pass
PAGE = {"opening": "op_li_er_hearsay", **CLEAR}  # the rules of the opening page, with clear skies


def sim_of(game: Game) -> Sim:
    """A ``Sim`` on the live state of ``game``, at the tick it stands at."""
    return Sim(world_of(game), Ctx(game._kernel))


@functools.cache
def _eve(config_items: tuple[tuple[str, Any], ...], seed: int, tick: int) -> str:
    game = bridge(seed, **dict(config_items))
    run_to(game, tick)
    return game.snapshot_json()


def game_at(tick: int = EVE, seed: int = 3, **config: Any) -> Game:
    """A game of ``seed`` with ``config`` (the rules of the page and clear skies if none is given)
    played to ``tick``, made from a snapshot kept for the next test that asks."""
    items = tuple(sorted((config or PAGE).items()))
    return Game.from_snapshot_json(_eve(items, seed, tick))


def forget(game: Game, *people: str) -> None:
    """Make the named people hold nothing at all."""
    social = state_of(game)["social"]
    for who in people:
        social["beliefs"][who].clear()


def hold(
    game: Game,
    holder: str,
    prop: str,
    confidence: int,
    source: str = "saw",
    modality: str = "assert",
    tick: int = 0,
) -> None:
    """Make ``holder`` hold ``prop`` first-hand, or as a conclusion of their own."""
    social = state_of(game)["social"]
    notes.hold(
        social, Belief(holder, prop, modality, confidence, source, None, None, 0, tick, None)
    )


def give(
    game: Game,
    prop: str,
    chain: list[str],
    confidence: int = 60,
    tick: int = 1000,
) -> None:
    """Make ``prop`` travel along ``chain``: the first of them saw it, and each tells the next, the
    last of them holding it at ``confidence``. The claims are written as the talk writes them, so
    that the walk back of ``provenance`` goes from the last one to the first."""
    social = state_of(game)["social"]
    first = chain[0]
    notes.hold(social, Belief(first, prop, "assert", 90, "saw", None, None, 0, 0, None))
    claimed = SELF_SEEN
    for hop, (speaker, listener) in enumerate(zip(chain, chain[1:], strict=False), start=1):
        claim_id = f"c{social['seq']}"
        social["seq"] += 1
        claim = Claim(claim_id, speaker, (listener,), prop, "assert", claimed, tick, "belief")
        social["claims"][claim_id] = notes.encode_claim(claim)
        here = confidence if listener == chain[-1] else 70
        notes.hold(
            social,
            Belief(listener, prop, "assert", here, "heard", speaker, claimed, hop, tick, claim_id),
        )
        claimed = speaker


def confidence_of(game: Game, holder: str, prop: str) -> int:
    return notes.confidence_of(state_of(game)["social"]["beliefs"][holder][prop])


def belief_of(game: Game, holder: str, prop: str) -> Belief | None:
    return notes.store(state_of(game)["social"], holder).get(prop)


def set_bond(game: Game, a: str, b: str, kind: int, value: int) -> None:
    """Set what ``a`` feels toward ``b`` (one of the ``bonds`` kinds)."""
    state_of(game)["social"]["bonds"][a][4 * LORE.index[b] + kind] = value


def night_day(game: Game) -> reflection.Day:
    """The planning of the night the game stands in."""
    return reflection.Day(sim_of(game))


def pass_at_hand(game: Game) -> None:
    """Make the pass of this night now, whatever the hour, on the live state."""
    reflection.night_pass(sim_of(game))


def base_of(day: int) -> int:
    return (day - 1) * clock.CYCLE_TICKS
