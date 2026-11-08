"""Rule-based festival managers that play the bridge game through player actions alone."""

from __future__ import annotations

from typing import Any

from bots.base import Bot, Obs
from bots.dealer import Dealer
from bots.follower import Follower
from bots.hubber import Hubber
from bots.investigator import Investigator
from bots.late_liar import LateLiar
from bots.liar import Liar
from bots.passive import Passive
from bots.rallier import Rallier
from bots.talker import Talker

BOTS: dict[str, type[Bot]] = {
    cls.name: cls
    for cls in (
        Dealer,
        Follower,
        Hubber,
        Investigator,
        Liar,
        LateLiar,
        Passive,
        Rallier,
        Talker,
    )
}


def make(name: str, scene: dict[str, Any], seed: int = 0, **options: Any) -> Bot:
    """A bot of the given name, ready to play the game whose scene is ``scene``. ``options`` are
    the keyword arguments a bot takes besides those (the follower takes its ``mode``)."""
    try:
        cls = BOTS[name]
    except KeyError:
        raise ValueError(f"unknown bot {name!r}; the bots are {', '.join(BOTS)}") from None
    return cls(scene, seed, **options)


__all__ = ["BOTS", "Bot", "Obs", "make"]
