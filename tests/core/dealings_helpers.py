"""Helpers for the tests of what the festival manager tells, asks and promises in a conversation."""

from __future__ import annotations

from typing import Any

from bridge_helpers import CAST, CLEAR, at, bridge, run_to, state_of, step
from player_helpers import acks, act, beside, events, me, silence

from lantern_core.api import Game
from lantern_core.cognition.beliefs import Belief
from lantern_core.world.bridge import clock, notebook, notes
from lantern_core.world.bridge.lore import PLAYER, lore

LO = lore()


def talking(
    who: str = "cha_laoban", seed: int = 1, hour: int = 8, day: int = 1, minute: int = 0, **config
) -> Game:
    """A game with the manager in a conversation with ``who`` on the morning of ``day`` (at
    ``hour`` o'clock, and ``minute``). The townsfolk tell each other nothing new, so that a case
    set up by hand stays as it is."""
    game = bridge(seed, **{**CLEAR, **config})
    run_to(game, at(day, hour, minute))
    for _ in range(80):  # someone in the middle of telling a neighbour has to finish first
        beside(game, who)
        silence(game)
        out = act(game, "talk", npc=who)
        if acks(out) != [("rejected", "busy")]:
            break
    assert acks(out) == [("applied", None)], (who, acks(out))
    return game


def believe(
    game: Game,
    who: str,
    prop_id: str,
    confidence: int = 90,
    source: str = "saw",
    teller: str | None = None,
    claimed: str | None = None,
    hop: int | None = None,
    claim: str | None = None,
) -> None:
    """Give a person a belief, as a case is set up."""
    heard = source == "heard"
    belief = Belief(
        who,
        prop_id,
        "assert",
        confidence,
        source,
        teller if heard else None,
        (claimed or teller) if heard else None,
        (1 if hop is None else hop) if heard else 0,
        0,
        claim if heard else None,
    )
    notes.hold(state_of(game)["social"], belief)


def stored(game: Game, who: str, prop_id: str) -> Belief | None:
    """What a person believes about a prop, or None."""
    return notes.store(state_of(game)["social"], who).get(prop_id)


def know(
    game: Game,
    prop_id: str,
    source: str = "saw",
    teller: str | None = None,
    hop: int = 1,
    claimed: str | None = None,
    tick: int = 0,
) -> dict[str, Any]:
    """Write something in the manager's notebook: seen, or heard from ``teller`` at ``hop`` (who
    names ``claimed`` as the source, else themselves)."""
    section = me(game)
    if source == "saw":
        entry, _ = notebook.add_seen(section, prop_id, tick)
    else:
        assert teller is not None
        belief = Belief(
            PLAYER, prop_id, "assert", 60, "heard", teller, claimed or teller, hop, tick
        )
        entry, _ = notebook.add_heard(section, belief)
    return entry


def trust(game: Game, who: str, value: int) -> None:
    """Set how far a person trusts the manager, as a case is set up. The hearts follow at once,
    so that the next look at them finds nothing moved by the set-up."""
    me(game)["trust"][CAST.index[who]] = value
    settle_hearts(game)


def settle_hearts(game: Game) -> None:
    """Bring the hearts the page was last told up to the trust that was set by hand."""
    from lantern_core.kernel import Ctx
    from lantern_core.world.bridge import hearts
    from lantern_core.world.bridge.sim import Sim

    hearts.sync(Sim(game._kernel.world, Ctx(game._kernel)))


def trust_of(game: Game, who: str) -> int:
    return int(me(game)["trust"][CAST.index[who]])


def tell(game: Game, entry: str | None = None, how: str = "faithful", **fields: Any):
    """One ``tell``. The parsed outputs."""
    if entry is not None:
        fields["entry"] = entry
    return act(game, "tell", how=how, **fields)


def told_event(out: dict[str, Any]) -> dict[str, Any]:
    (only,) = events(out, "told")
    return only


def claim_of(game: Game, claim_id: str):
    return notes.decode_claim(claim_id, state_of(game)["social"]["claims"][claim_id])


def at_hour(game: Game, hour: int, day: int | None = None) -> None:
    """Run the game on to ``hour`` o'clock of ``day`` (of today, by default)."""
    day = clock.at(game.tick).day if day is None else day
    run_to(game, at(day, hour))
    silence(game)


__all__ = [
    "LO",
    "acks",
    "act",
    "at_hour",
    "believe",
    "claim_of",
    "events",
    "know",
    "me",
    "state_of",
    "step",
    "stored",
    "talking",
    "tell",
    "told_event",
    "trust",
    "trust_of",
]
