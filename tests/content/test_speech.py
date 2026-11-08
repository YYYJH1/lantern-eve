"""The words a model's reply is held to: their content, their compiled form, and what the tool
refuses."""

from __future__ import annotations

import copy
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import check_content as cc
import speech_content as sp
from lantern_core import canon
from lantern_core.cognition.props import Tables
from lantern_core.world.bridge import speech_data

ROOT = Path(__file__).resolve().parents[2]
COMPILED = ROOT / "content" / "compiled"
BASE = cc.load_sources(ROOT)
DOC = canon.loads((COMPILED / "speech.json").read_bytes())
TABLES = Tables.loads((COMPILED / "tables.json").read_bytes())
CJK = re.compile(r"[㐀-鿿]")


def check(mutate: Callable[[dict[str, Any]], None]) -> list[str]:
    """Apply ``mutate`` to a copy of the lexicon and return the errors of the checker."""
    src = copy.deepcopy(BASE)
    mutate(src.speech)
    return cc.validate(src).errors


def has(errors: list[str], *needles: str) -> bool:
    return any(all(n in e for n in needles) for e in errors)


# ------------------------------------------------------------------------------ the content


def test_the_lexicon_has_the_six_classes_each_in_both_languages():
    assert sorted(DOC["words"]) == sorted(sp.CLASSES)
    for cls, group in DOC["words"].items():
        assert group["zh"] and group["en"], cls
        assert all(CJK.search(w) for w in group["zh"]), cls
        assert not any(CJK.search(w) for w in group["en"]), cls
        assert all(w == w.lower() for w in group["en"]), cls


def test_every_predicate_and_every_motive_has_words_that_say_it():
    assert sorted(DOC["events"]) == sorted(TABLES.predicates)
    assert sorted(DOC["motives"]) == sorted(TABLES.motives)
    for table in (DOC["events"], DOC["motives"]):
        for key, group in table.items():
            assert group["zh"] and group["en"], key


def test_no_word_is_in_two_classes():
    owner: dict[tuple[str, str], str] = {}
    for cls, group in DOC["words"].items():
        for lang in ("zh", "en"):
            for word in group[lang]:
                assert owner.setdefault((lang, word), cls) == cls, word


def test_a_mask_holds_a_word_of_its_class_and_none_is_a_word_itself():
    for cls, group in DOC["words"].items():
        for lang in ("zh", "en"):
            for mask in group["mask"][lang]:
                assert mask not in group[lang], (cls, mask)
                assert any(word in mask for word in group[lang]), (cls, mask)


def test_the_moods_and_the_forms_of_address_have_a_plain_member_that_says_nothing():
    assert DOC["moods"][sp.PLAIN_MOOD] == {"en": "", "zh": ""}
    assert DOC["addresses"][sp.NO_ADDRESS] == {"en": "", "zh": ""}
    for key, pair in DOC["moods"].items():
        if key != sp.PLAIN_MOOD:
            assert CJK.search(pair["zh"]) and pair["zh"][-1] in "。！？"
            assert not CJK.search(pair["en"]) and pair["en"][-1] in ".!?"
    for key, pair in DOC["addresses"].items():
        if key != sp.NO_ADDRESS:
            assert CJK.search(pair["zh"]) and not CJK.search(pair["en"]) and pair["en"]


def test_the_compiled_file_the_module_and_the_tool_agree():
    report = cc.validate(copy.deepcopy(BASE))
    assert report.errors == []
    assert report.outputs["speech.json"] == (COMPILED / "speech.json").read_bytes()
    assert speech_data.SPEECH == DOC
    module = (ROOT / sp.MODULE).read_bytes()
    assert report.generated[sp.MODULE] == module
    assert module.decode("utf-8").count('"""') == 4  # the docstring, and the raw string


# ------------------------------------------------------------------------------ the checker


def test_the_checker_passes_the_lexicon():
    assert check(lambda s: None) == []


def test_a_missing_or_stray_table_is_refused():
    assert has(check(lambda s: s.clear()), "speech.yaml: missing or empty")
    assert has(check(lambda s: s.pop("events")), "events")
    assert has(check(lambda s: s.update(extra=1)), "extra")
    assert has(check(lambda s: s["words"].pop("hedge")), "words.hedge is missing")
    assert has(
        check(lambda s: s["words"].update(vow=s["words"]["seen"])), "words.vow is not a class"
    )
    assert has(check(lambda s: s["events"].pop("drank")), "events.drank is missing")
    assert has(check(lambda s: s["events"].update(sing=s["events"]["at"])), "events.sing is not in")
    assert has(check(lambda s: s["motives"].pop("greed")), "motives.greed is missing")
    assert has(
        check(lambda s: s["motives"].update(envy=s["motives"]["greed"])), "motives.envy is not in"
    )


def test_every_class_and_every_predicate_needs_words_in_both_languages():
    assert has(check(lambda s: s["words"]["negation"].update(zh=[])), "words.negation", "both")
    assert has(check(lambda s: s["words"]["seen"].update(en=[])), "words.seen", "both")
    assert has(check(lambda s: s["events"]["took"].update(en=[])), "events.took", "both")
    assert has(check(lambda s: s["motives"]["spite"].update(zh=[])), "motives.spite", "both")


def test_a_word_is_in_the_right_language_and_written_once():
    assert has(
        check(lambda s: s["words"]["seen"]["zh"].append("saw")), "words.seen (zh) 'saw'", "Chinese"
    )
    assert has(
        check(lambda s: s["words"]["seen"]["en"].append("看见")),
        "words.seen (en) '看见'",
        "must not hold Chinese",
    )
    assert has(
        check(lambda s: s["words"]["seen"]["en"].append("I Saw")),
        "words.seen (en) 'I Saw'",
        "lower case",
    )
    assert has(
        check(lambda s: s["words"]["seen"]["en"].append("i’ve seen it")),
        "plain one",
    )
    assert has(
        check(lambda s: s["words"]["seen"]["zh"].append("亲眼")), "words.seen (zh) '亲眼'", "twice"
    )
    assert has(
        check(lambda s: s["words"]["seen"]["zh"].append(" 亲眼看 ")), "empty, or stray spaces"
    )
    assert has(check(lambda s: s["words"]["seen"]["zh"].append("看{见}")), "holds one of")


def test_a_word_cannot_be_in_two_classes():
    assert has(
        check(lambda s: s["words"]["seen"]["zh"].append("可能")),
        "words.seen (zh) '可能'",
        "also in the class hedge",
    )


def test_a_mask_must_do_something():
    assert has(
        check(lambda s: s["words"]["negation"]["mask"]["zh"].append("花好月圆")),
        "mask (zh) '花好月圆'",
        "holds no word of the class",
    )
    assert has(
        check(lambda s: s["words"]["negation"]["mask"]["zh"].append("不")),
        "is a word of the class itself",
    )


def test_an_alias_names_one_entity_and_no_name_belongs_to_two():
    assert has(
        check(lambda s: s["aliases"].update(nobody=dict(zh=["某人"], en=[]))),
        "aliases.nobody",
        "not an entity",
    )
    assert has(
        check(lambda s: s["aliases"].update(li_er=dict(zh=["周掌柜"], en=[]))),
        "'周掌柜'",
        "also a name of",
    )
    assert has(
        check(lambda s: s["aliases"]["old_he"]["en"].append("Granny Li")),
        "'granny li'",
        "also a name of",
    )
    assert has(
        check(lambda s: s["aliases"]["old_he"]["en"].append("the old man")),
        "write the name without 'the'",
    )
    assert has(
        check(lambda s: s["aliases"]["old_he"]["zh"].append("李二")),
        "'李二'",
        "also a name of li_er",
    )


def test_a_secret_belongs_to_a_person_of_the_cast():
    assert has(
        check(lambda s: s["secrets"].update(t_rail=dict(zh=["栏杆"], en=[]))),
        "secrets.t_rail",
        "not a person of the cast",
    )


def test_the_moods_and_addresses_are_checked():
    assert has(check(lambda s: s["moods"].pop("plain")), "moods needs 'plain'")
    assert has(check(lambda s: s["moods"]["plain"].update(zh="嗯。")), "moods.plain", "empty")
    assert has(check(lambda s: s["addresses"].pop("none")), "addresses needs 'none'")
    assert has(
        check(lambda s: s["moods"]["sad"].update(zh="唉")), "moods.sad (zh)", "end a sentence"
    )
    assert has(
        check(lambda s: s["moods"]["sad"].update(en="Alas")), "moods.sad (en)", "end a sentence"
    )
    assert has(
        check(lambda s: s["addresses"]["friend"].update(en="朋友")),
        "addresses.friend",
        "must be English",
    )
    assert has(check(lambda s: s["moods"].update(Bad=s["moods"]["sad"])), "snake_case")
