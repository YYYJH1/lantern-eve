"""The prompts that ask a model for the words of a townsperson: their content, their compiled form,
and what the tool refuses."""

from __future__ import annotations

import copy
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import check_content as cc
import prompt_content as pc
from lantern_core import canon
from lantern_core.world.bridge import prompt_data

ROOT = Path(__file__).resolve().parents[2]
COMPILED = ROOT / "content" / "compiled"
BASE = cc.load_sources(ROOT)
DOC = canon.loads((COMPILED / "prompts.json").read_bytes())
PLACE = re.compile(r"\{\{(\w+)\}\}")


def check(mutate: Callable[[dict[str, Any]], None]) -> list[str]:
    """Apply ``mutate`` to a copy of the prompts and return the errors of the checker."""
    src = copy.deepcopy(BASE)
    mutate(src.prompts)
    return cc.validate(src).errors


def has(errors: list[str], *needles: str) -> bool:
    return any(all(n in e for n in needles) for e in errors)


# ------------------------------------------------------------------------------ the content


def test_the_module_of_the_core_is_the_compiled_document():
    assert prompt_data.PROMPTS == DOC
    assert sorted(DOC) == [
        "hows",
        "outcomes",
        "promises",
        "requests",
        "standing",
        "templates",
        "voices",
    ]


def test_every_template_fills_exactly_the_places_it_is_allowed_to():
    assert sorted(DOC["templates"]) == sorted(pc.TEMPLATES)
    for name, text in DOC["templates"].items():
        allowed, required = pc.TEMPLATES[name]
        found = PLACE.findall(text)
        assert set(found) == required <= allowed, name
        assert len(found) == len(set(found)), name
        assert text.isascii() and text == text.strip(), name


def test_the_tables_have_the_keys_the_core_asks_for():
    assert tuple(DOC["outcomes"]) == tuple(sorted(pc.OUTCOMES))
    assert tuple(DOC["hows"]) == tuple(sorted(pc.HOWS))
    assert tuple(DOC["standing"]) == tuple(sorted(pc.STANDING))
    for table in ("outcomes", "hows", "standing"):
        for key, text in DOC[table].items():
            assert text.isascii() and "\n" not in text and "{{" not in text, (table, key)


def test_every_person_has_a_note_on_how_they_speak_in_both_languages():
    people = [p["id"] for p in BASE.casts["bridge_v0"]["people"]]
    assert sorted(DOC["voices"]) == sorted(people)
    for person in people:
        note = DOC["voices"][person]
        assert note == {k: BASE.voices[person]["voice"][k].strip() for k in ("zh", "en")}
        assert note["zh"] and note["en"] and not note["zh"].isascii() and note["en"].isascii()


def test_the_reply_prompt_holds_the_contract_and_the_checks():
    system = DOC["templates"]["reply_system"]
    for needle in ('"acts"', '"line"', '"mood"', '"address"', "JSON", "quotation marks"):
        assert needle in system, needle
    for needle in ("Chinese", "English", "second refusal"):
        assert needle in system, needle
    for step in ("1. ", "2. ", "3. "):
        assert step in system, step
    judge = DOC["templates"]["judge_system"]
    assert '{"score": N}' in judge and "-10" in judge and "10" in judge
    assert "quotation marks" in judge


# ------------------------------------------------------------------------------ what is refused


def test_the_content_passes_the_checker():
    assert check(lambda p: None) == []


def test_a_template_with_a_place_it_may_not_fill_is_refused():
    errors = check(lambda p: p.update(situation_ask=p["situation_ask"] + " {{nope}}"))
    assert has(errors, "situation_ask", "nope", "is not a place here")


def test_a_template_that_leaves_out_a_place_it_must_fill_is_refused():
    errors = check(lambda p: p.update(reply_user=p["reply_user"].replace("{{facts}}", "")))
    assert has(errors, "reply_user", "{{facts}}", "must be written")


def test_a_place_written_twice_is_refused():
    errors = check(lambda p: p.update(judge_user=p["judge_user"] + " {{words}}"))
    assert has(errors, "judge_user", "{{words}}", "more than once")


def test_a_stray_double_brace_is_refused():
    errors = check(lambda p: p.update(words_none=p["words_none"] + " {{ oops"))
    assert has(errors, "words_none", "stray double brace")


def test_a_prompt_that_is_not_plain_ascii_is_refused():
    errors = check(lambda p: p.update(words_none=p["words_none"] + " —"))
    assert has(errors, "words_none", "plain ASCII")


def test_a_template_that_is_missing_is_refused():
    errors = check(lambda p: p.pop("judge_user"))
    assert has(errors, "judge_user")


def test_an_outcome_that_is_missing_or_is_not_one_the_core_asks_for_is_refused():
    errors = check(lambda p: p["outcomes"].pop("agreed"))
    assert has(errors, "outcomes.agreed", "is missing")
    errors = check(lambda p: p["outcomes"].update(maybe="Perhaps."))
    assert has(errors, "outcomes.maybe", "is not one the core asks for")


def test_a_sentence_of_a_table_with_a_place_or_a_second_line_is_refused():
    errors = check(lambda p: p["hows"].update(faithful="as it is {{topic}}"))
    assert has(errors, "hows.faithful", "no place can be filled")
    errors = check(lambda p: p["standing"].update(close="one\ntwo"))
    assert has(errors, "standing.close", "one line")


def test_a_person_without_a_note_on_how_they_speak_is_refused():
    def lose(src: cc.Sources) -> None:
        del src.voices["li_er"]["voice"]

    src = copy.deepcopy(BASE)
    lose(src)
    errors = cc.validate(src).errors
    assert has(errors, "li_er", "voice")
