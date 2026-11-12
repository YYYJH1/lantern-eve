"""The lines of the townsfolk: their content, their compiled form, and what the checker refuses."""

from __future__ import annotations

import copy
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import check_content as cc
import sentence_content as sc
from lantern_core import canon
from lantern_core.cognition.lines import Lines
from lantern_core.cognition.props import Tables
from lantern_core.cognition.script import ScriptBook
from lantern_core.world.bridge import data, sentences

ROOT = Path(__file__).resolve().parents[2]
COMPILED = ROOT / "content" / "compiled"
BASE = cc.load_sources(ROOT)
DOC = canon.loads((COMPILED / "sentences.json").read_bytes())
TABLES = Tables.loads((COMPILED / "tables.json").read_bytes())
SCRIPTS = ("broken_bridge", "lost_lantern", "stranger")
CJK = re.compile(r"[㐀-鿿]")


def check(mutate: Callable[[dict[str, Any]], None]) -> list[str]:
    """Apply ``mutate`` to a copy of the lines and return the errors of the checker."""
    src = copy.deepcopy(BASE)
    mutate(src.sentences)
    return cc.validate(src).errors


def has(errors: list[str], *needles: str) -> bool:
    return any(all(n in e for n in needles) for e in errors)


# ------------------------------------------------------------------------------ the content


def test_every_predicate_and_every_motive_has_words_in_both_languages():
    assert sorted(DOC["predicates"]) == sorted(TABLES.predicates)
    assert sorted(DOC["motives"]) == sorted(TABLES.motives)
    for line in DOC["predicates"].values():
        for pair in (line, line["neg"]):
            assert CJK.search(pair["zh"]) and not CJK.search(pair["en"])
            assert not pair["en"][0].isupper()
    assert all(CJK.search(p["zh"]) and not CJK.search(p["en"]) for p in DOC["motives"].values())
    assert set(DOC["when"]) == {"last_night", "lately", "this_morning"}
    assert set(DOC["frames"]) == set(sc.FRAME_SLOTS)


def test_the_compiled_file_the_module_and_the_tool_agree():
    report = cc.validate(copy.deepcopy(BASE))
    assert report.errors == []
    assert report.outputs["sentences.json"] == (COMPILED / "sentences.json").read_bytes()
    assert sentences.SENTENCES == DOC
    module = (ROOT / sc.MODULE).read_bytes()
    assert report.generated[sc.MODULE] == module
    assert module.decode("utf-8").count('"""') == 4  # the docstring, and the raw string


def test_every_prop_of_every_script_is_said_in_two_languages_without_gaps():
    lines = Lines(DOC)
    for name in SCRIPTS:
        book = ScriptBook.loads((COMPILED / f"{name}.json").read_bytes())
        names = lines.names(book.registry)
        for pid in book.props:
            said = lines.say(
                book.props[pid],
                names,
                modality="assert",
                claimed_source="unknown",
                speaker="nobody",
            )
            for lang, text in said.items():
                assert text and not re.search(r"[{}\[\]]", text), (name, pid, lang, text)
            assert CJK.search(said["zh"]) and not CJK.search(said["en"]), (name, pid, said)
            assert said["en"][0].isupper(), (name, pid, said)
            assert said["zh"].endswith("。") and said["en"].endswith("."), (name, pid, said)


def test_the_generated_module_is_the_one_the_bridge_world_reads():
    book = ScriptBook.from_canon(data.SCRIPT)
    lines = Lines(sentences.SENTENCES)
    names = lines.names(book.registry)
    said = lines.say(
        book.props["pr_liner_at_bridge"],
        names,
        modality="assert",
        claimed_source="zhou_huoji",
        speaker="zhou_zhanggui",
    )
    assert said == {
        "zh": "周家伙计跟我说，李二昨晚在桥边。",
        "en": "Zhou's Clerk told me that Li Er was at the bridge last night.",
    }


# ------------------------------------------------------------------------------ the checker


def test_the_checker_passes_the_lines():
    assert check(lambda s: None) == []


def test_a_missing_or_stray_line_or_phrase_is_refused():
    assert has(check(lambda s: s["predicates"].pop("drank")), "predicate 'drank' has no line")
    assert has(
        check(lambda s: s["predicates"].update(sing=s["predicates"]["at"])),
        "'sing' is not a predicate",
    )
    assert has(check(lambda s: s["motives"].pop("greed")), "motive 'greed' has no phrase")
    assert has(
        check(lambda s: s["motives"].update(envy=s["motives"]["greed"])),
        "'envy' is not a motive",
    )


def test_a_file_that_is_missing_or_has_the_wrong_shape_is_refused():
    assert has(check(lambda s: s.clear()), "sentences.yaml: missing or empty")
    assert has(check(lambda s: s.pop("frames")), "frames")
    assert has(check(lambda s: s.update(extra=1)), "extra")
    assert has(check(lambda s: s["predicates"]["at"].pop("neg")), "at", "neg")


def test_a_template_may_only_name_the_slots_of_its_predicate_and_the_time():
    def wrong_slot(s: dict[str, Any]) -> None:
        s["predicates"]["at"]["zh"] = "{who}[{when}]在{where}{what}"

    assert has(check(wrong_slot), "at line (zh)", "{what} is not a slot")

    def empty_slot(s: dict[str, Any]) -> None:
        s["predicates"]["at"]["en"] = "{who} was at {}"

    assert has(check(empty_slot), "at line (en)")

    def stray_brace(s: dict[str, Any]) -> None:
        s["predicates"]["at"]["en"] = "{who} was at {where"

    assert has(check(stray_brace), "stray brace")


def test_required_slots_are_written_in_the_open_and_optional_ones_in_brackets():
    def hidden(s: dict[str, Any]) -> None:
        s["predicates"]["at"]["zh"] = "{who}[在{where}]"

    assert has(check(hidden), "required slot {where} must be written outside the brackets")

    def bare(s: dict[str, Any]) -> None:
        s["predicates"]["damaged"]["en"] = "{who} damaged {what} at {where}"

    assert has(check(bare), "optional slot {where} needs brackets")

    def twice(s: dict[str, Any]) -> None:
        s["predicates"]["damaged"]["en"] = "{who} damaged {what} at {where}[ at {where}]"

    assert has(check(twice), "written both inside and outside brackets")

    def empty_group(s: dict[str, Any]) -> None:
        s["predicates"]["at"]["en"] = "{who} was at {where}[ lately]"

    assert has(check(empty_group), "holds no slot")

    def nested(s: dict[str, Any]) -> None:
        s["predicates"]["at"]["en"] = "{who} was at {where}[ [{when}]]"

    assert has(check(nested), "unbalanced or nested")


def test_a_line_at_home_names_the_person_and_the_time_and_not_the_place():
    def names_the_place(s: dict[str, Any]) -> None:
        s["predicates"]["at"]["home"]["en"] = "{who} was at {where}[ {when}]"

    assert has(check(names_the_place), "at home line (en)", "{where} is not a slot")

    def no_denial(s: dict[str, Any]) -> None:
        s["predicates"]["at"]["home"].pop("neg")

    assert has(check(no_denial), "home", "neg")

    def homeless(s: dict[str, Any]) -> None:
        s["predicates"]["wanted"]["home"] = {
            "zh": "有人在家找{who}",
            "en": "someone at home is looking for {who}",
            "neg": {"zh": "没人在家找{who}", "en": "nobody at home is looking for {who}"},
        }

    assert has(check(homeless), "wanted", "no who and where")


def test_the_languages_are_kept_apart_and_an_english_line_starts_in_lower_case():
    assert has(
        check(lambda s: s["predicates"]["at"].update(zh="{who} was at {where}")),
        "at line",
        "must be Chinese",
    )
    assert has(
        check(lambda s: s["predicates"]["at"].update(en="{who}在{where}")),
        "at line",
        "must be English",
    )
    assert has(
        check(lambda s: s["predicates"]["at"].update(en="Somebody was at {where}")),
        "starts in lower case",
    )
    assert has(
        check(lambda s: s["motives"]["greed"].update(en="贪财")), "motive greed", "must be English"
    )
    assert has(
        check(lambda s: s["when"]["lately"].update(zh="lately")), "when lately", "must be Chinese"
    )


def test_a_frame_needs_its_line_and_its_teller_and_has_no_optional_parts():
    assert has(
        check(lambda s: s["frames"]["seen"].update(en="I saw it myself.")),
        "frame seen (en)",
        "{line}",
    )
    assert has(
        check(lambda s: s["frames"]["heard"].update(zh="听人说，{line}。")),
        "frame heard (zh)",
        "{teller}",
    )
    assert has(
        check(lambda s: s["frames"]["guess_own"].update(en="Perhaps {line}.")),
        "frame guess_own (en)",
        "{hedge}",
    )
    assert has(
        check(lambda s: s["frames"]["seen"].update(zh="我看见[{line}]。")),
        "frame seen (zh)",
        "no optional parts",
    )
    assert has(
        check(lambda s: s["frames"]["seen"].update(zh="{teller}看见，{line}。")),
        "frame seen (zh)",
        "{teller} is not a slot",
    )


def test_a_form_is_bare_words_of_a_place_or_a_thing_and_a_predicate_form_is_of_a_predicate():
    def own(s, pred, entity, pair):
        s.setdefault("predicate_forms", {}).setdefault(pred, {})[entity] = pair

    assert has(check(lambda s: s["forms"].update(li_er={"zh": "老二", "en": "Er"})), "not a place")
    assert has(
        check(lambda s: s["forms"].update(p_bridge={"zh": "{where}边", "en": "the bridge"})),
        "a form is bare words",
    )
    assert has(
        check(lambda s: own(s, "sing", "p_bridge", {"zh": "桥上", "en": "the bridge"})),
        "predicate_forms: 'sing' is not a predicate",
    )
    assert has(
        check(lambda s: own(s, "located", "li_er", {"zh": "老二", "en": "Er"})),
        "predicate_forms located li_er",
        "not a place or a thing",
    )
    assert has(
        check(lambda s: own(s, "located", "p_bridge", {"zh": "the bridge", "en": "the bridge"})),
        "predicate_forms located p_bridge",
    )


def test_the_hedges_and_the_people_with_an_article_are_checked():
    assert has(check(lambda s: s["hedges"].update(zh=[])), "hedges.zh needs")
    assert has(check(lambda s: s["hedges"].update(en=["我猜"])), "hedges.en must be English")
    assert has(check(lambda s: s["hedges"].update(zh=["maybe"])), "hedges.zh must be Chinese")
    assert has(check(lambda s: s["the"].append("t_rail")), "'t_rail' is not a person")
    assert has(check(lambda s: s["the"].append("gengfu")), "lists a person twice")
