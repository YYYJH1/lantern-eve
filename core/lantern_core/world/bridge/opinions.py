"""The opinions of the townsfolk without names, and the integer arithmetic that moves them.

A townsperson holds two opinions, each a bounded int:

- ``enthusiasm`` for the lantern festival, from 0 (none) to 100 (fervent);
- ``stance`` between the two families, from -100 (wholly with the first family of the cast, the
  Li) to 100 (wholly with the second, the Zhou), and 0 for neither.

Two things move them. When two townsfolk in the same district meet, each opinion follows the
model of bounded confidence of Deffuant, Neau, Amblard and Weisbuch (2000), "Mixing beliefs among
interacting agents", Advances in Complex Systems 3: if the two opinions differ by less than a
confidence bound, each moves toward the other by a fraction ``mu`` of the gap, and if they differ
by more, neither moves. So people with views that are close draw closer, and people whose views
are far apart do not talk each other round, which is how a town splits into camps. Here the
fraction is an int number of per mille and the move is rounded toward zero, so both move by the
same amount and their sum does not change. A gap too small to move a whole unit (three or less,
at the default ``mu``) stays as it is. Each of the two opinions has a bound and moves on its own:
a pair may agree about the festival and part ways over the families.

When a named person speaks in the street, the opinions of the townsfolk who hear it are *pulled*
toward the speaker's by a fraction of the gap (``pull``), with no bound: it is the speaker who
chooses to be heard, not a meeting of equals.
"""

from __future__ import annotations

ENTHUSIASM_MIN, ENTHUSIASM_MAX = 0, 100
STANCE_MIN, STANCE_MAX = -100, 100

MU = 250  # per mille of the gap that each of two townsfolk who meet moves, at most 500
ENTHUSIASM_BOUND = 12  # two townsfolk talk about the festival if their enthusiasm differs by less
STANCE_BOUND = 30  # and about the families if their stance differs by less

assert 0 < MU <= 500  # beyond half the gap the two would pass each other


def _share(gap: int, per_mille: int) -> int:
    """``per_mille`` thousandths of ``gap``, rounded toward zero."""
    if gap >= 0:
        return gap * per_mille // 1000
    return -(-gap * per_mille // 1000)


def meet(a: int, b: int, bound: int, mu: int = MU) -> tuple[int, int]:
    """Two opinions after their holders meet: each moves ``mu`` per mille of the gap toward the
    other if the gap is less than ``bound``, and neither moves otherwise.

    The sum of the two is the same afterwards, and both stay between the old values.
    """
    gap = b - a
    if abs(gap) >= bound:
        return a, b
    move = _share(gap, mu)
    return a + move, b - move


def pull(x: int, target: int, per_mille: int) -> int:
    """``x`` pulled toward ``target`` by ``per_mille`` thousandths of the gap, rounded toward it."""
    return x + _share(target - x, per_mille)


def clamp(x: int, low: int, high: int) -> int:
    return low if x < low else high if x > high else x
