"""Helpers for the tests of the statement card: notes that make an option show, the card of each
story filled in right, and the full statement.

The card is filled with the player actions only: a note that bears on an option is written to the
notebook (``know``), and the option is chosen (``statement``, ``choose``), as the page does.
"""

from __future__ import annotations

from typing import Any

from bridge_helpers import state_of
from dealings_helpers import know
from player_helpers import acks, act, events

from lantern_core.api import Game
from lantern_core.world.bridge import statement

VARIANTS = ("v_boat", "v_flood", "v_drunk")
# the option of each part that is right in each story
RIGHT = {
    "v_boat": {"cause": "boat", "course": "boat_night", "rumour": "grew"},
    "v_flood": {"cause": "flood", "course": "flood_night", "rumour": "grew"},
    "v_drunk": {"cause": "drunk", "course": "drunk_night", "rumour": "grew"},
}
# a prop of a note that bears for each option (the first thing found for it)
NOTE = {
    "boat": "pr_boat_damaged",
    "flood": "pr_flood_damaged",
    "drunk": "pr_dalang_damaged",
    "li_er": "pr_liner_damaged",
    "boat_night": "pr_he_under_bridge",
    "flood_night": "pr_flooded",
    "drunk_night": "pr_dalang_at_bridge",
    "li_er_night": "pr_liner_at_bridge",
    "grew": "pr_liner_at_bridge",
    "seen": "pr_liner_damaged",
    "invented": "pr_liner_not_bridge",
    "smear": "pr_li_damaged_on_purpose",
}


def statement_parts() -> dict[str, list[str]]:
    return {part["id"]: [o["id"] for o in part["options"]] for part in statement.parts()}


def part_of(option: str) -> str:
    return next(part for part, ids in statement_parts().items() if option in ids)


def variant_of(game: Game) -> str:
    return state_of(game)["social"]["variant"]


def bear(game: Game, option: str) -> None:
    """Write a note to the notebook that bears for the option, so that the option is shown."""
    know(game, NOTE[option])


def choose(game: Game, option: str, part: str | None = None) -> dict[str, Any]:
    """Choose an option (its note is written first, if no note bears on it yet)."""
    part = part or part_of(option)
    card = state_of(game)["player"]
    found = statement.option_of(statement.part_of(part), option)
    assert found is not None
    if not statement.is_shown(card, statement.part_of(part), found):
        bear(game, option)
    return act(game, "statement", op="choose", part=part, option=option)


def fill(game: Game, picks: dict[str, str] | None = None) -> None:
    """Fill the card with the right option of each part in the story of the game, or with these."""
    picks = picks or RIGHT[variant_of(game)]
    for part, option in picks.items():
        out = choose(game, option, part)
        assert acks(out) == [("applied", None)], (part, option, acks(out))


def state_it(game: Game, **fields: Any) -> dict[str, Any]:
    """Make the full statement where the manager stands."""
    return act(game, "speak", kind="statement", **fields)


def tell(game: Game, picks: dict[str, str] | None = None, **fields: Any) -> dict[str, Any]:
    """Fill the card (right, by default) and make the full statement."""
    fill(game, picks)
    return state_it(game, **fields)


def stated(out: dict[str, Any]) -> dict[str, Any]:
    (event,) = events(out, "stated")
    return event
