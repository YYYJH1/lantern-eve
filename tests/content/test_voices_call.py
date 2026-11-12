"""The names a person uses for others in ``content/lines``: what the checker lets in, what it
refuses, and how a table is compiled into the voices of the person.

These tests put tables into a copy of the sources. The tables of the content are not read here.
"""

from __future__ import annotations

import copy
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest

import check_content as cc
import voice_content as vc
from lantern_core import canon

ROOT = Path(__file__).resolve().parents[2]
COMPILED = ROOT / "content" / "compiled"
BASE = cc.load_sources(ROOT)
DOC = canon.loads((COMPILED / "voices.json").read_bytes())
CAST = canon.loads((COMPILED / "cast_bridge_v0.json").read_bytes())
PEOPLE = [p["id"] for p in CAST["people"]]
FAMILY = {p["id"]: p.get("family") for p in CAST["people"]}
FAMILIES = sorted({f for f in FAMILY.values() if f})
MOTHER = "li_laotai"
TABLE = {
    "zhou_zhanggui": {"zh": "周家那个掌柜", "en": "that Zhou shopkeeper"},
    "li_er": {"zh": "老二", "en": "Er"},
    "li_da": {"zh": "老大", "en": "Da"},
}


def check(mutate: Callable[[cc.Sources], None]) -> list[str]:
    """Apply ``mutate`` to a copy of the sources and return the errors of the checker."""
    src = copy.deepcopy(BASE)
    mutate(src)
    return cc.validate(src).errors


def has(errors: list[str], *needles: str) -> bool:
    return any(all(n in e for n in needles) for e in errors)


def given(table: Any, person: str = MOTHER) -> Callable[[cc.Sources], None]:
    """The change that gives ``person`` the table."""

    def put(src: cc.Sources) -> None:
        src.voices[person]["call"] = copy.deepcopy(table)

    return put


def one(other: str, **name: str) -> dict[str, Any]:
    """A table of one name; ``zh`` and ``en`` are the good ones unless they are given."""
    return {other: {"zh": "老二", "en": "Er", **name}}


# ------------------------------------------------------------------------------ what is let in


def test_a_table_is_let_in_and_compiled_for_that_person_alone():
    src = copy.deepcopy(BASE)
    given(TABLE)(src)
    report = cc.validate(src)
    assert report.errors == []
    doc = canon.loads(report.outputs["voices.json"])
    assert doc[MOTHER]["call"] == TABLE
    assert list(doc[MOTHER]["call"]) == sorted(TABLE)  # in the order of the ids
    assert [p for p in doc if "call" in doc[p] and p != MOTHER] == [
        p for p in DOC if "call" in DOC[p] and p != MOTHER
    ]  # nobody else gained one
    assert set(doc[MOTHER]) - {"call"} == set(DOC[MOTHER]) - {"call"}  # and nothing else moved
    module = report.generated[vc.MODULE].decode("utf-8")
    assert '"call"' in module and "周家那个掌柜" in module
    names: dict[str, Any] = {}
    exec(compile(module, "voice_data.py", "exec"), names)  # the module the core imports
    assert names["VOICES"] == doc
    assert any(line.startswith("calls: ") and " names" in line for line in report.coverage), (
        report.coverage
    )


def test_the_compiled_document_has_a_table_for_the_people_who_have_one_in_the_sources():
    assert {p for p in DOC if "call" in DOC[p]} == {p for p in PEOPLE if BASE.voices[p].get("call")}
    for person in PEOPLE:
        for other, pair in DOC[person].get("call", {}).items():
            assert other in PEOPLE + FAMILIES and other != person and sorted(pair) == ["en", "zh"]


def test_a_person_without_a_table_has_the_voice_they_had_and_the_checker_passes():
    assert check(lambda s: None) == []
    src = copy.deepcopy(BASE)
    for voice in src.voices.values():
        voice.pop("call", None)
    report = cc.validate(src)
    assert report.errors == []
    assert all("call" not in v for v in canon.loads(report.outputs["voices.json"]).values())
    assert not any(line.startswith("calls: ") for line in report.coverage)


def test_a_table_may_use_the_cast_s_own_name_for_the_same_person_and_another_s_alias():
    # the lantern maker's word for the second Li son is the town's alias of the second Zhou son
    assert check(given({"li_er": {"zh": "二郎", "en": "Erlang"}}, "zhadeng_shifu")) == []
    assert check(given({"li_er": {"zh": "李二", "en": "Li Er"}})) == []  # the cast's, for him


def test_a_harmless_compound_that_holds_a_word_of_a_class_is_let_in():
    assert check(given(one("li_er", zh="不错的老二"))) == []  # 不错 is a mask of the negations


def test_tables_of_the_manner_of_the_content_pass():
    tables = {
        "li_laotai": TABLE,
        "zhou_zhanggui": {
            "zhou_niangzi": {"zh": "我家那口子", "en": "my wife"},
            "zhou_dalang": {"zh": "大郎", "en": "Dalang"},
            "li_er": {"zh": "李家老二", "en": "the Li boy"},
        },
        "zhou_huoji": {
            "zhou_zhanggui": {"zh": "掌柜的", "en": "the master"},
            "zhou_dalang": {"zh": "大少爷", "en": "young master"},
        },
        "shitou": {
            "li_er": {"zh": "二叔", "en": "Uncle Er"},
            "old_he": {"zh": "老何", "en": "Boatman He"},
        },
    }

    def put(src: cc.Sources) -> None:
        for person, table in tables.items():
            src.voices[person]["call"] = copy.deepcopy(table)

    assert check(put) == []


# ------------------------------------------------------------------------------ what is refused


@pytest.mark.parametrize(
    ("table", "needle"),
    [
        ({"nobody": {"zh": "老二", "en": "Er"}}, "nobody is not a person or a family of the cast"),
        ({"li_laotai": {"zh": "老二", "en": "Er"}}, "a person does not name themself"),
        ({"player": {"zh": "东家", "en": "boss"}}, "no table names player"),
        (one("li_er", en=""), "the English must be English text"),
        (one("li_er", zh=""), "the Chinese must be Chinese text"),
        (one("li_er", en="老二"), "the English must be English text"),
        (one("li_er", zh="Er"), "the Chinese must be Chinese text"),
        (one("li_er", zh="老二Er"), "a name is bare words"),
        (one("li_er", zh="老二。"), "a name is bare words"),
        (one("li_er", zh="老二，"), "a name is bare words"),
        (one("li_er", zh="{who}"), "the Chinese must be Chinese text"),
        (one("li_er", zh="老{who}二"), "a name is bare words"),
        (one("li_er", zh="[老二]"), "a name is bare words"),
        (one("li_er", zh="“老二”"), "a name is bare words"),
        (one("li_er", en="Er."), "a name is bare words"),
        (one("li_er", en="Er, the boy"), "a name is bare words"),
        (one("li_er", en="{who}"), "a name is bare words"),
        (one("li_er", en='the "boy"'), "a name is bare words"),
        (one("li_er", en="Er\nDa"), "a name is bare words"),
        (one("li_er", en="9 Er"), "a name is bare words"),
        (one("li_er", zh=" 老二"), "stray spaces"),
        (one("li_er", en="Er "), "stray spaces"),
        (one("li_er", en="the  boy"), "stray spaces"),
        (one("li_er", en="the boy - Er"), "no dash in a name"),
        (one("li_er", en="Er--Da"), "no dash in a name"),
        (one("li_er", zh="老二" * 7), "longer than 12 characters"),
        (one("li_er", en="the second son of my husband and his late wife"), "longer than 40"),
        (one("li_er", zh="他二叔"), "never he or she"),
        (one("li_er", zh="她"), "never he or she"),
        (one("li_er", en="his brother"), "never he or she"),
        (one("li_er", en="she"), "never he or she"),
        (one("li_er", zh="没脸的"), "holds '没', a negation word"),
        (one("li_er", en="nobody"), "holds 'nobody', a negation word"),
        (one("li_er", zh="肯定二哥"), "holds '肯定', a certain word"),
        (one("li_er", en="so and so"), "holds 'so', a connective word"),
        (one("li_er", zh="听说二哥"), "holds '听说', a hearsay word"),
        (one("li_er", zh="我猜二哥"), "holds '我猜', a hedge word"),
    ],
)
def test_a_name_that_is_not_a_few_bare_words_of_a_person_is_refused(table, needle):
    errors = check(given(table))
    assert has(errors, "lines/li_laotai.yaml: call", needle), errors


def test_two_names_for_one_person_in_a_table_are_both_fine_and_two_people_one_name_is_not():
    both = {"li_er": {"zh": "老二", "en": "Er"}, "li_da": {"zh": "老二", "en": "Da"}}
    assert has(check(given(both)), "call li_da and li_er are the same name (zh)", "老二")
    same = {"li_er": {"zh": "老二", "en": "The Boy"}, "li_da": {"zh": "老大", "en": "the boy"}}
    assert has(check(given(same)), "call li_da and li_er are the same name (en)")
    article = {"li_er": {"zh": "老二", "en": "the boy"}, "li_da": {"zh": "老大", "en": "boy"}}
    assert has(check(given(article)), "are the same name (en)")  # an article does not tell apart
    assert (
        check(given({"li_er": {"zh": "老二", "en": "Er"}, "li_da": {"zh": "老大", "en": "Da"}}))
        == []
    )


def test_a_name_that_is_the_cast_s_name_for_somebody_else_is_refused():
    errors = check(given({"li_da": {"zh": "李二", "en": "Er"}}))
    assert has(errors, "call li_da (zh)", "'李二' is the name of li_er, not of li_da")
    errors = check(given({"li_da": {"zh": "老大", "en": "Li Er"}}))
    assert has(errors, "call li_da (en)", "is the name of li_er, not of li_da")
    errors = check(given({"li_da": {"zh": "老大", "en": "the Teahouse Keeper"}}))
    assert has(errors, "is the name of cha_laoban, not of li_da")  # an article does not hide it
    errors = check(given({"li_da": {"zh": "老大", "en": "teahouse   KEEPER"}}))
    assert has(errors, "is the name of cha_laoban, not of li_da")  # nor does the case


def test_a_pair_with_a_field_that_is_neither_language_and_a_table_that_is_no_table_are_refused():
    extra = {"li_er": {"zh": "老二", "en": "Er", "note": "his mother's word"}}
    assert has(check(given(extra)), "lines/li_laotai.yaml", "call", "li_er", "note")
    assert has(check(given(["li_er"])), "lines/li_laotai.yaml", "call")
    assert has(check(given({"li_er": "老二"})), "lines/li_laotai.yaml", "call")
    assert has(check(given({"li_er": {"zh": "老二"}})), "lines/li_laotai.yaml", "call", "en")


def test_nothing_is_written_when_a_table_is_refused():
    src = copy.deepcopy(BASE)
    given(one("nobody"))(src)
    report = cc.validate(src)
    assert report.errors and report.outputs == {} and report.generated == {}


# ------------------------------------------------------------------------------ a family


def test_a_family_is_said_as_we_by_its_own_members_and_by_nobody_else():
    ours = {"fam_li": {"zh": "我们家", "en": "our family"}}
    assert check(given({**TABLE, **ours})) == []  # the mother of the Li family
    errors = check(given(ours, "zhou_zhanggui"))
    assert has(errors, "lines/zhou_zhanggui.yaml: call fam_li", "only a member of fam_li"), errors
    # a family may be named by anyone in other words
    assert check(given({"fam_li": {"zh": "李家那边", "en": "the Li side"}}, "zhou_zhanggui")) == []


def test_every_member_of_a_family_names_it_and_the_family_says_we():
    """A family speaking of itself says 我们家; the clerk, who works for the Zhou house, says
    东家."""
    for person, family in FAMILY.items():
        if family is None:
            continue
        name = DOC[person].get("call", {}).get(family)
        assert name is not None, (person, family)
        if person == "zhou_huoji":
            assert name == {"zh": "东家", "en": "my employers"}
        else:
            assert name == {"zh": "我们家", "en": "our family"}, (person, name)
