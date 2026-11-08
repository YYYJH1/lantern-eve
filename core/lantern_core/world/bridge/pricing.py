"""Money in the budget gate: micro-yuan, what a call costs, and where an occupancy stands.

Every amount of money in the core is an int number of micro-yuan, a millionth of a yuan, so
nothing here is ever rounded to a float. A price is micro-yuan per million tokens, which makes the
cost of one token a fraction of a micro-yuan, and the cost of a call is rounded *up* for each of
its two parts. A call is therefore never cheaper than it was priced, and the price of a
reservation (the most a call can use) is never below the price of what it used. That is what
lets the cap hold: when a result settles, its cost is no more than its reservation was.

The three stages of the cap are set by the *occupancy*, which is the money already spent plus the
reservations of every request in flight, against the cap of the game:

- ``NORMAL`` below 70 percent of the cap: every tier is open.
- ``NO_STRONG`` from 70 up to 90 percent: the strong tier is off, and its requests go cheap.
- ``NO_CLOUD`` from 90 percent on: the cloud is off, and requests go to a local model or to a
  template line.

The limits are compared by cross-multiplication, so a cap of zero puts the game in ``NO_CLOUD``
from the first tick, which is how a game with no budget at all plays offline.
"""

from __future__ import annotations

from typing import Any

MICRO = 1_000_000  # micro-yuan in a yuan, and tokens in a million
NORMAL, NO_STRONG, NO_CLOUD = 0, 1, 2
STAGES = (NORMAL, NO_STRONG, NO_CLOUD)
STRONG_OFF_PERCENT = 70
CLOUD_OFF_PERCENT = 90
# A bound on the money counted, far above any cap, so that a host that reports absurd usage
# cannot push the state out of the integers that a snapshot can carry.
MAX_SPENT = 2**50

# The config keys that price each cloud tier: (input price, output price) in micro-yuan per
# million tokens. The local tier and the template cost nothing.
PRICE_KEYS = {
    "cheap": ("price_cheap_in", "price_cheap_out"),
    "strong": ("price_strong_in", "price_strong_out"),
}


def _ceil_div(numerator: int, denominator: int) -> int:
    return -(-numerator // denominator)


def cost(config: dict[str, Any], tier: str, input_tokens: int, output_tokens: int) -> int:
    """The cost in micro-yuan of a call on ``tier`` that used these tokens.

    Each part is rounded up to a whole micro-yuan. A tier that is not priced (``local``) is free.
    """
    keys = PRICE_KEYS.get(tier)
    if keys is None:
        return 0
    return _ceil_div(input_tokens * config[keys[0]], MICRO) + _ceil_div(
        output_tokens * config[keys[1]], MICRO
    )


def stage_of(occupied: int, cap: int) -> int:
    """Where an occupancy stands against the cap: ``NORMAL``, ``NO_STRONG`` or ``NO_CLOUD``."""
    if occupied * 100 < cap * STRONG_OFF_PERCENT:
        return NORMAL
    if occupied * 100 < cap * CLOUD_OFF_PERCENT:
        return NO_STRONG
    return NO_CLOUD
