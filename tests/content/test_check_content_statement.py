"""What the content checker holds of the statement card: three parts in order, every prop real, and
in each story exactly one right option in each part, whose claims hold in that story and which no
real evidence of that story is against.

Like the other tests of the checker these edit the parsed YAML in memory and run ``validate``.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import check_content as cc

ROOT = Path(__file__).resolve().parents[2]
BASE = cc.load_sources(ROOT)


def check(mutate: Callable[[dict[str, Any]], None]) -> list[str]:
    """Apply ``mutate`` to the statement of a copy of the parsed sources and return the errors."""
    src = copy.deepcopy(BASE)
    mutate(src.scripts["broken_bridge"]["statement"])
    return cc.validate(src).errors


def has(errors: list[str], *needles: str) -> bool:
    return any(all(n in e for n in needles) for e in errors)


def option(card: dict[str, Any], part: str, name: str) -> dict[str, Any]:
    (found,) = [
        o for p in card["parts"] if p["id"] == part for o in p["options"] if o["id"] == name
    ]
    return found


def test_the_statement_of_the_script_is_sound():
    assert check(lambda card: None) == []


def test_the_card_has_the_three_parts_in_order_and_opens_in_the_game():
    def swap(card):
        card["parts"][0], card["parts"][1] = card["parts"][1], card["parts"][0]

    assert has(check(swap), "the parts must be cause, course, rumour")
    assert has(check(lambda card: card["parts"].pop()), "parts")
    assert has(check(lambda card: card["opens"].update(day=9)), "after the game")


def test_every_story_has_exactly_one_right_option_in_each_part():
    def two(card):
        option(card, "cause", "flood")["right"] = ["v_boat", "v_flood"]

    def none(card):
        option(card, "course", "drunk_night")["right"] = []

    def stranger(card):
        option(card, "rumour", "grew")["right"].append("v_ghost")

    assert has(check(two), "statement cause", "2 right options in v_boat")
    assert has(check(none), "statement course", "0 right options in v_drunk")
    assert has(check(stranger), "'v_ghost' is not a variant")


def test_what_an_option_states_holds_in_the_story_it_is_right_in_and_not_in_the_others():
    def lies(card):
        option(card, "cause", "boat")["claims"] = ["pr_flood_damaged"]

    errors = check(lies)
    assert has(errors, "statement cause option boat", "do not hold in v_boat")
    assert has(
        errors, "statement cause option flood", "hold in v_boat", "not the right one"
    ) or has(errors, "statement cause option boat", "hold in v_flood")


def test_nothing_real_in_a_story_is_against_the_right_option_of_it():
    def against(card):
        option(card, "cause", "boat")["against"].append("pr_boat_scratched")  # true in v_boat

    assert has(check(against), "pr_boat_scratched is against it and true in v_boat")


def test_an_option_names_props_of_the_script_once_and_a_note_could_bear_on_it():
    def unknown(card):
        option(card, "cause", "boat")["supports"].append("pr_nothing")

    def twice(card):
        option(card, "cause", "boat")["claims"] = ["pr_boat_damaged", "pr_boat_damaged"]

    def both(card):
        option(card, "cause", "boat")["against"].append("pr_boat_damaged")

    def bare(card):
        found = option(card, "rumour", "grew")
        found["supports"], found["against"] = [], []

    assert has(check(unknown), "unknown prop 'pr_nothing'")
    assert has(check(twice), "claims lists a prop twice")
    assert has(check(both), "both for and against")
    assert has(check(bare), "no note could ever bear on it")


def test_the_ids_and_the_words_of_the_card_are_well_formed():
    def duplicate(card):
        card["parts"][0]["options"][1]["id"] = "boat"

    def slot(card):
        option(card, "cause", "boat")["text"]["en"] = "The {boat} did it"

    def bad(card):
        option(card, "cause", "boat")["id"] = "Boat"

    assert has(check(duplicate), "duplicate")
    assert has(check(slot), "the text has no slots")
    assert has(check(bad), "not a lower-case snake_case id")


def test_the_vocabulary_has_the_card_the_kind_the_verb_and_the_codes_of_the_core():
    from lantern_core.world.bridge import agenda_terms, assembly

    assert "statement" in cc.SPEAK_KINDS and tuple(cc.SPEAK_KINDS) == assembly.KINDS
    assert tuple(cc.MISSED_CODES) == assembly.MISSED
    assert {"card_filled", "card_fillable", "stated_today"} <= set(cc.TASK_TERMS)
    assert {k: v for k, v in agenda_terms.spec().items()} == cc.TASK_TERMS
    assert "stated" in cc.EVENT_KINDS
    assert tuple(cc.STATEMENT_PARTS) == ("cause", "course", "rumour")


def test_the_compiled_script_carries_the_card_and_a_script_without_one_carries_none():
    compiled = json.loads((ROOT / "content" / "compiled" / "broken_bridge.json").read_text("utf-8"))
    assert [p["id"] for p in compiled["statement"]["parts"]] == ["cause", "course", "rumour"]
    assert compiled["statement"]["opens"] == {"day": 4, "hour": 17}
    other = json.loads((ROOT / "content" / "compiled" / "lost_lantern.json").read_text("utf-8"))
    assert "statement" not in other
