"""How the townsfolk stand toward each other: four numbers for every ordered pair.

Each person holds four bounded ints toward every other, and the pair is not symmetric (A may
like B more than B likes A):

- ``affinity`` in [-100, 100]: how much A likes B.
- ``trust`` in [0, 100]: how far A believes what B says.
- ``favour`` in [0, 100]: how much A owes B.
- ``grudge`` in [0, 100]: how much A holds against B.

They start from families and traits, with a jitter drawn from the game's RNG so that two seeds
do not have the same town. Families like each other and trust each other, and are cold toward
the other family, which holds a grudge that grows with a person's suspicion and conformity and
shrinks with warmth. The two who are tagged ``bridge`` across the families are fond of each other
and hold no grudge. Gatekeepers are trusted and owed, and hubs are known to everyone.

They change only by the rules in ``telling`` and by nothing a model says, and a single event
moves a number by at most ``MAX_STEP``. In the state a person's row is a flat list of four ints
for each person of the cast in cast order, so A's feeling toward the person of index ``j`` is
``row[4 * j + kind]``, and the diagonal is zeros.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.lore import Lore

AFFINITY, TRUST, FAVOUR, GRUDGE = 0, 1, 2, 3
KINDS = ("affinity", "trust", "favour", "grudge")
BOUNDS = ((-100, 100), (0, 100), (0, 100), (0, 100))
MAX_STEP = 10
GRUDGE_ENOUGH = 54  # the grudge a rule that blames the one held against asks for
JITTER = 6


def _clamp(kind: int, value: int) -> int:
    low, high = BOUNDS[kind]
    return max(low, min(high, value))


def _base(lore: Lore, a: str, b: str) -> tuple[int, int, int, int]:
    """What A feels toward B before the jitter, from the families and the traits of A."""
    ta = lore.traits[a]
    fa, fb = lore.family[a], lore.family[b]
    same = fa is not None and fa == fb
    cross = fa is not None and fb is not None and fa != fb
    lovers = cross and "bridge" in lore.tags[a] and "bridge" in lore.tags[b]
    affinity = (45 if same else -15 if cross else 10) + (ta["warmth"] - 50) // 5
    trust = 70 if same else 25 if cross else 45
    trust += (ta["warmth"] - 50) // 4 - (ta["suspicion"] - 50) // 4
    favour = 0
    grudge = (
        ta["suspicion"] * 4 // 5 + ta["conformity"] // 5 - ta["warmth"] // 5 + 5 if cross else 0
    )
    if lovers:
        affinity, trust, grudge = affinity + 55, trust + 25, 0
    if "gatekeeper" in lore.tags[b]:
        trust, favour = trust + 12, favour + 8
    if "hub" in lore.tags[b]:
        affinity, trust = affinity + 5, trust + 4
    return affinity, trust, favour, grudge


def seed(lore: Lore, rng: Pcg32) -> dict[str, list[int]]:
    """Every person's row, drawn from ``rng`` in cast order."""
    rows: dict[str, list[int]] = {}
    for a in lore.people:
        row: list[int] = []
        for b in lore.people:
            if a == b:
                row += [0, 0, 0, 0]
                continue
            affinity, trust, favour, grudge = _base(lore, a, b)
            affinity += rng.below(2 * JITTER + 1) - JITTER
            trust += rng.below(2 * JITTER + 1) - JITTER
            favour += rng.below(JITTER + 1)
            grudge += rng.below(2 * JITTER + 1) - JITTER if grudge else rng.below(4)
            row += [_clamp(k, v) for k, v in enumerate((affinity, trust, favour, grudge))]
        rows[a] = row
    return rows


def value(social: dict[str, Any], lore: Lore, a: str, b: str, kind: int) -> int:
    """What ``a`` feels toward ``b``: one of ``AFFINITY``, ``TRUST``, ``FAVOUR`` and ``GRUDGE``."""
    return social["bonds"][a][4 * lore.index[b] + kind]


def nudge(social: dict[str, Any], lore: Lore, a: str, b: str, kind: int, delta: int) -> int:
    """Move what ``a`` feels toward ``b`` by ``delta`` (at most ``MAX_STEP``), within the bounds."""
    step = max(-MAX_STEP, min(MAX_STEP, delta))
    row = social["bonds"][a]
    at = 4 * lore.index[b] + kind
    row[at] = _clamp(kind, row[at] + step)
    return row[at]


def grudge_check(social: dict[str, Any], lore: Lore) -> Callable[[str, str, str], bool]:
    """The answer ``paths.authorize`` asks for when a rule wants a grudge of the speaker."""

    def holds(kind: str, holder: str, target: str) -> bool:
        if kind != "grudge" or holder not in lore.index or target not in lore.index:
            return False
        return value(social, lore, holder, target, GRUDGE) >= GRUDGE_ENOUGH

    return holds
