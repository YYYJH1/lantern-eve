"""The ledger of model usage, kept per tier and counted in tokens.

Every ``model_result`` the core accepts is booked against the tier of the request it answers.
An entry says how many calls were made, how each ended and how many tokens were charged. Money
is not part of it: a price turns tokens into a cost at the point where a budget is checked.
Tokens are charged as the result reports them. When a result carries no usage (``usage`` is
null, as after a timeout or an abort, when the host cannot know), the full reservation made when
the request went out is charged, because that is the most the call can have cost. A result that
answers nothing in flight, such as an answer that arrives after its request timed out, is booked
as ``unattributed``: its usage is real, its tier is not known.

The ``local`` tier is a model on the player's own machine. A world may ask for it, and a world
with a budget gate sends a request there when the cloud is off (see ``world.bridge.budget``). It
is booked like the others and costs nothing. A request that a gate turns into a template line
never goes out and is not booked at all.
"""

from __future__ import annotations

from typing import Any

TIERS = ("cheap", "strong", "local")


def new() -> dict[str, dict[str, int]]:
    """An empty ledger: one entry per tier and one for results that answer nothing."""
    ledger = {tier: _empty_tier() for tier in TIERS}
    ledger["unattributed"] = {"results": 0, "input_tokens": 0, "output_tokens": 0}
    return ledger


def _empty_tier() -> dict[str, int]:
    return {
        "issued": 0,
        "settled": 0,
        "ok": 0,
        "timeout": 0,
        "cancelled": 0,
        "error": 0,
        "voided": 0,
        "input_tokens": 0,
        "output_tokens": 0,
    }


def charge(entry: dict[str, int], usage: dict[str, int] | None, reserve: dict[str, Any]) -> None:
    """Book the tokens of one settled call: its usage, or the whole reservation if unknown."""
    tokens = reserve if usage is None else usage
    entry["input_tokens"] += tokens["input_tokens"]
    entry["output_tokens"] += tokens["output_tokens"]
