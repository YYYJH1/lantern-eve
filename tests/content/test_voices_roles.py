"""The lists of the ten people who carry the days: their content, their compiled form, and what the
checker refuses (a condition it does not know, a list with no last resort, a text that breaks the
rules of the words of the game, a belief read for a person whom a story blames)."""

from __future__ import annotations

import copy
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

import check_content as cc
import voice_content as vc
from lantern_core import canon
from lantern_core.world.bridge import voice_data

ROOT = Path(__file__).resolve().parents[2]
COMPILED = ROOT / "content" / "compiled"
BASE = cc.load_sources(ROOT)
DOC = canon.loads((COMPILED / "voices.json").read_bytes())
TEN = [
    "cha_laoban",
    "gengfu",
    "li_da",
    "li_er",
    "li_laotai",
    "old_he",
    "zhou_dalang",
    "zhou_huoji",
    "zhou_zhanggui",
    "zuzhang",
]


def check(mutate: Callable[[cc.Sources], None]) -> list[str]:
    """Apply ``mutate`` to a copy of the sources and return the errors of the checker."""
    src = copy.deepcopy(BASE)
    mutate(src)
    return cc.validate(src).errors


def has(errors: list[str], *needles: str) -> bool:
    return any(all(n in e for n in needles) for e in errors)


def greet(src: cc.Sources, person: str = "li_laotai") -> list[dict[str, Any]]:
    return src.voices[person]["greet"]


# ------------------------------------------------------------------------------ the content


def test_the_content_passes_the_checker_and_the_ten_are_those_who_have_the_lists():
    assert check(lambda src: None) == []
    carrying = sorted(p for p, voice in DOC.items() if "epilogue" in voice)
    assert carrying == TEN
    for person, voice in DOC.items():
        assert voice_data.VOICES[person] == voice
        assert ("greet" in voice) == ("chat" in voice) == (person in TEN)


@pytest.mark.parametrize("person", TEN)
def test_each_list_is_compiled_with_its_ids_conditions_and_words(person):
    voice = DOC[person]
    for kind in ("greet", "chat"):
        for entry in voice[kind]:
            assert sorted(entry) == ["id", "lines", "when"]
            assert entry["lines"] and all(sorted(pair) == ["en", "zh"] for pair in entry["lines"])
    for entry in voice["epilogue"]:
        assert sorted(entry) == ["id", "text", "when"] and sorted(entry["text"]) == ["en", "zh"]


@pytest.mark.parametrize("person", TEN)
def test_no_text_of_the_lists_has_a_semicolon_a_dash_a_pronoun_or_a_slot(person):
    texts = []
    for kind in ("greet", "chat"):
        for entry in DOC[person][kind]:
            texts += entry["lines"]
    texts += [entry["text"] for entry in DOC[person]["epilogue"]]
    for pair in texts:
        for lang, text in pair.items():
            assert not any(mark in text for mark in ("；", ";", "—", "–", "―", "--", " - ")), text
            assert not vc.has_pronoun(lang, text), text
            assert not re.search(r"[{}\[\]]", text), text
            assert text[-1] in ("。！？…）" if lang == "zh" else ".!?)"), text
        assert ("？" in pair["zh"]) == ("?" in pair["en"]), pair
        assert ("！" in pair["zh"]) == ("!" in pair["en"]), pair


def test_a_name_that_reads_as_a_pronoun_is_a_name():
    assert not vc.has_pronoun("en", "Boatman He spoke up in the hall.")
    assert vc.has_pronoun("en", "He spoke up in the hall.")
    assert vc.has_pronoun("en", "Boatman He said that he saw it.")
    assert vc.has_pronoun("zh", "他看见了。") and vc.has_pronoun("zh", "她看见了。")
    assert not vc.has_pronoun("zh", "老何看见了。")


# ------------------------------------------------------------------------------ what is refused


def test_a_list_whose_last_entry_has_a_condition_is_refused():
    def mutate(src):
        greet(src)[-1]["when"] = [{"kind": "flag", "flag": "truth_told"}]

    assert has(check(mutate), "li_laotai.yaml", "last entry of greet has no condition")


def test_an_entry_with_no_condition_before_the_last_is_refused_because_it_would_hide_the_rest():
    def mutate(src):
        greet(src)[0]["when"] = []

    assert has(check(mutate), "greet 'new' has no condition and is not the last")


def test_an_id_that_is_used_twice_or_is_not_a_word_is_refused():
    def twice(src):
        greet(src)[1]["id"] = greet(src)[0]["id"]

    def shouting(src):
        greet(src)[0]["id"] = "New Friend"

    assert has(check(twice), "greet has the id 'new' twice")
    assert has(check(shouting), "id 'New Friend' is not a lower-case snake_case word")


def test_a_person_who_has_one_list_has_all_three():
    def mutate(src):
        del src.voices["li_da"]["chat"]

    assert has(check(mutate), "li_da.yaml", "all three lists, missing chat")


def test_a_term_that_is_not_in_the_vocabulary_of_the_lists_is_refused():
    def unknown(src):
        greet(src)[1]["when"] = [{"kind": "nonsense"}]

    def of_the_tasks_but_not_for_the_lists(src):
        greet(src)[1]["when"] = [{"kind": "note", "props": ["pr_set_straight"]}]

    assert has(check(unknown), "greet broken", "unknown term 'nonsense'")
    assert has(check(of_the_tasks_but_not_for_the_lists), "unknown term 'note'")


def test_a_flag_a_person_a_state_or_a_cause_that_the_script_does_not_have_is_refused():
    def flag(src):
        greet(src)[1]["when"] = [{"kind": "flag", "flag": "bridge_flew"}]

    def meeting(src):
        greet(src)[0]["when"] = [{"kind": "acquainted", "is": "someday"}]

    def state(src):
        greet(src)[1]["when"] = [{"kind": "promised", "state": "lost"}]

    def cause(src):
        src.voices["old_he"]["epilogue"][0]["when"] = [{"kind": "told_cause", "is": "ghost"}]

    def person(src):
        greet(src)[1]["when"] = [
            {"kind": "commitment", "by": "nobody", "item": "bamboo", "state": "delivered"}
        ]

    assert has(check(flag), "unknown flag 'bridge_flew'")
    assert has(check(meeting), "acquainted.is", "someday")
    assert has(check(state), "promised.state", "lost")
    assert has(check(cause), "told_cause.is", "ghost")
    assert has(check(person), "nobody")


def test_only_a_greeting_may_ask_if_the_talk_is_a_first_one():
    def mutate(src):
        src.voices["li_laotai"]["chat"][0]["when"] = [{"kind": "acquainted", "is": "new"}]

    assert has(check(mutate), "chat broken", "only a greeting knows if the talk is a first one")


def test_a_person_some_story_blames_reads_no_belief_and_the_others_may():
    def culprit(src):
        src.voices["old_he"]["greet"][1]["when"] = [{"kind": "knows", "props": ["pr_set_straight"]}]

    def zhou_dalang(src):
        src.voices["zhou_dalang"]["chat"][0]["when"] = [
            {"kind": "knows", "props": ["pr_set_straight"]}
        ]

    def innocent(src):
        src.voices["li_da"]["chat"][0]["when"] = [{"kind": "knows", "props": ["pr_set_straight"]}]

    assert has(check(culprit), "old_he", "may be the one the truth blames", "'knows'")
    assert has(check(zhou_dalang), "zhou_dalang", "may be the one the truth blames")
    assert check(innocent) == []


def test_only_a_claim_that_was_made_in_public_may_be_asked_after():
    def mutate(src):
        src.voices["li_da"]["chat"][0]["when"] = [{"kind": "knows", "props": ["pr_boat_damaged"]}]

    assert has(check(mutate), "pr_boat_damaged", "was not made in public")


def test_a_term_that_reads_what_the_manager_holds_is_not_for_the_lists():
    def mutate(src):
        greet(src)[1]["when"] = [{"kind": "evidence", "items": ["e_boat_scratches"]}]

    assert has(check(mutate), "unknown term 'evidence'")


def test_a_text_that_breaks_the_rules_of_the_words_of_the_game_is_refused():
    def semicolon(src):
        greet(src)[0]["lines"][0]["zh"] = "你好；总管。"

    def dash(src):
        greet(src)[0]["lines"][0]["en"] = "Hello — Manager."

    def pronoun(src):
        src.voices["li_er"]["epilogue"][0]["text"]["en"] = "Li Er held his head up."

    def pronoun_zh(src):
        src.voices["li_er"]["epilogue"][0]["text"]["zh"] = "李二抬起了头，他笑了。"

    def slot(src):
        greet(src)[0]["lines"][0]["en"] = "Hello, {name}."

    def long(src):
        greet(src)[0]["lines"][0]["zh"] = "好" * 70 + "。"

    def mood(src):
        greet(src)[0]["lines"][0]["en"] = "So you are the Manager!"

    def three(src):
        src.voices["li_er"]["epilogue"][0]["text"] = {
            "zh": "甲来了。乙来了。丙来了。",
            "en": "A came. B came. C came.",
        }

    errors = check(semicolon)
    assert has(errors, "greet new #1 (zh)") and has(errors, "'；'")
    assert has(check(dash), "greet new #1 (en)", "'—'")
    assert has(check(pronoun), "epilogue full (en)", "a person is never he or she")
    assert has(check(pronoun_zh), "epilogue full (zh)", "a person is never he or she")
    assert has(check(slot), "greet new #1 (en)", "no slots")
    assert has(check(long), "longer than 60 characters")
    assert has(check(mood), "a question in one language must be a question in the other")
    assert has(check(three), "an epilogue is at most 2 sentences")


def test_no_person_says_one_text_twice_or_a_text_of_their_fixed_lines_in_a_list():
    def twice(src):
        src.voices["li_laotai"]["chat"][0]["lines"][0] = dict(greet(src)[0]["lines"][0])

    def fixed(src):
        fixed_line = src.voices["li_laotai"]["lines"]["busy"][0]
        greet(src)[0]["lines"][0] = dict(fixed_line)

    assert has(check(twice), "li_laotai.yaml", "are the same words")
    assert has(check(fixed), "li_laotai.yaml", "greet new #1 and a fixed line are the same words")


def test_no_two_people_say_the_same_words_in_the_lists():
    def mutate(src):
        src.voices["li_er"]["greet"][0]["lines"][0] = dict(greet(src)[0]["lines"][0])

    errors = check(mutate)
    assert has(errors, "li_er greet new #1", "li_laotai greet new #1", "are the same words")


def test_a_want_that_calls_a_person_he_or_she_is_refused():
    def mutate(src):
        src.scripts["broken_bridge"]["wants"][2]["text"]["en"] = "To see his mother nod"

    assert has(check(mutate), "w_li_da_nod en", "a person is never he or she")
