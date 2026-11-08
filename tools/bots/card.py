"""Filling in the statement card the way a player who reasons from what it shows would.

The card (the frame key ``statement``) lists, in each part, the options that a note bears on, with
the notes for each and against it. A player takes in each part the option with the most notes for it
and none against. Where every option has something against it, the one with the most for it
beyond what is against it. An option that no note speaks for is never taken, whatever is against
the others: the part is left empty until something is found that bears for an option. An option that
was stated and did not hold is not chosen again: the next best is. Nothing here reads more than the
frame.
"""

from __future__ import annotations

from typing import Any


def rank(option: dict[str, Any]) -> tuple[bool, int, int]:
    """How well an option stands, the larger the better: nothing against it first, then the notes
    for it (less the notes against, where something is), then the fewer against."""
    clean = option["against"] == 0
    support = option["support"] if clean else option["support"] - option["against"]
    return clean, support, -option["against"]


def best(part: dict[str, Any], rejected: set[str]) -> str | None:
    """The option of the part to take, leaving out those that were stated and did not hold and those
    that no note speaks for, or None if the part has no option left to take."""
    options = [
        option
        for option in part["options"]
        if option["id"] not in rejected and option["support"] > 0
    ]
    if not options:
        return None
    return max(options, key=rank)["id"]


def changes(statement: dict[str, Any], rejected: dict[str, set[str]]) -> list[tuple[str, str]]:
    """The choices to make on the card to fill it in as above: ``(part, option)`` for each part
    whose best option is not the one chosen."""
    found = []
    for part in statement["parts"]:
        choice = best(part, rejected.get(part["part"], set()))
        if choice is not None and choice != part["chosen"]:
            found.append((part["part"], choice))
    return found
