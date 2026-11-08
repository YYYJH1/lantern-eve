"""A compiled script as the core reads it: what loads, what is true, what is wrong with it."""

import copy

import pytest
from cog_world import SCRIPT_DICT, TABLES

from lantern_core import canon
from lantern_core.cognition.script import ScriptBook


def script_dict(mutate=None):
    raw = copy.deepcopy(SCRIPT_DICT)
    if mutate is not None:
        mutate(raw)
    return raw


def problems(mutate=None):
    return ScriptBook.from_canon(script_dict(mutate)).problems(TABLES)


def has(found, *needles):
    return any(all(n in m for n in needles) for m in found)


BOOK = ScriptBook.from_canon(SCRIPT_DICT)


# ------------------------------------------------------------------ loading


def test_a_script_loads_and_has_nothing_wrong_with_it():
    assert BOOK.problems(TABLES) == []
    assert (BOOK.id, BOOK.days, BOOK.truth_fixed_at) == ("fixture", 3, 0)
    assert len(BOOK.props) == len(SCRIPT_DICT["props"]) and len(BOOK.registry) == 16
    assert sorted(BOOK.rules) == ["grudge_at_scene", "scene_damage"]
    assert sorted(BOOK.templates) == ["he_at_home", "he_knows_nothing"]
    assert [c.id for c in BOOK.chains] == ["ch_rumour", "ch_rule"]
    assert BOOK.chains[1].hops[1].via == "scene_damage"


def test_a_script_reads_from_json_text_and_writes_back_what_it_reads():
    again = ScriptBook.loads(canon.dumps(SCRIPT_DICT))
    assert again.to_canon() == BOOK.to_canon()
    assert ScriptBook.from_canon(BOOK.to_canon()).to_canon() == BOOK.to_canon()
    assert "summary" not in BOOK.to_canon()  # sections the core does not read are not kept


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r.update(extra=1),  # a section the core has not been taught
        lambda r: r.pop("variants"),
        lambda r: r.pop("chains"),
        lambda r: r.update(variants=[]),
        lambda r: r["variants"].append(copy.deepcopy(r["variants"][0])),
        lambda r: r["variants"][0].update(extra=1),
        lambda r: r["variants"][0].pop("true_negations"),
        lambda r: r["chains"].append(copy.deepcopy(r["chains"][0])),
        lambda r: r["chains"][0].update(hops=r["chains"][0]["hops"][:1]),  # a root alone
        lambda r: r["chains"][0]["hops"].clear(),
        lambda r: r["chains"][0]["hops"][1].pop("via"),
        lambda r: r["speculation"].append(copy.deepcopy(r["speculation"][0])),
        lambda r: r["lies"].append(copy.deepcopy(r["lies"][0])),
        lambda r: r.update(days=0),
        lambda r: r.update(truth_fixed_at=-1),
        lambda r: r.update(id=""),
        lambda r: (
            r["props"].append(copy.deepcopy(r["props"][0])) or r["props"][-1].update(pred="at")
        ),
    ],
)
def test_a_script_that_does_not_have_the_shape_is_refused(mutate):
    with pytest.raises(ValueError):  # a ShapeError, or a PropError for a repeated id
        ScriptBook.from_canon(script_dict(mutate))


# ------------------------------------------------------------------ truth


def test_the_variants_say_which_props_and_denials_are_true():
    assert BOOK.true_props("v_li") == (
        "he_home",
        "li_at_bridge",
        "li_broke",
        "rail_broken",
        "rail_located",
    )
    assert BOOK.true_negations("v_li") == ()
    assert BOOK.true_negations("v_he") == ("li_not_broke",)
    assert BOOK.holds("v_he", "li_not_broke") and BOOK.holds("v_he", "he_broke")
    assert not BOOK.holds("v_li", "li_not_broke") and not BOOK.holds("v_li", "he_broke")
    assert not BOOK.holds("v_li", "r1_broke")  # a rumour nobody started from the truth
    with pytest.raises(KeyError):
        BOOK.variant("v_nobody")


# ------------------------------------------------------------------ what is wrong with a script


def test_the_checks_of_every_part_are_run_and_named_after_the_script():
    found = problems(lambda r: r["props"][0].update(pred="teleport"))
    assert has(found, "fixture:", "li_broke", "unknown predicate")
    found = problems(lambda r: r["speculation"][0]["premises"][0]["args"].update(when="$P"))
    assert has(found, "fixture:", "rule grudge_at_scene", "no slot 'when'")
    found = problems(lambda r: r["lies"][0]["objects"].remove("home_he"))
    assert has(found, "fixture:", "lie template he_at_home", "may not name 'home_he'")
    found = problems(lambda r: r["exclusive"][0]["props"].append("ghost"))
    assert has(found, "group who_broke_rail", "unknown prop 'ghost'")


def test_a_variant_must_name_props_of_the_right_kind_and_keep_every_group_to_one():
    found = problems(lambda r: r["variants"][0]["true_props"].append("ghost"))
    assert has(found, "variant v_li", "unknown prop 'ghost'")
    found = problems(lambda r: r["variants"][0]["true_props"].append("li_not_broke"))
    assert has(found, "variant v_li", "li_not_broke is a negation", "true_props")
    found = problems(lambda r: r["variants"][0]["true_negations"].append("li_broke"))
    assert has(found, "variant v_li", "li_broke is not a negation", "true_negations")
    found = problems(lambda r: r["variants"][0]["true_props"].append("he_broke"))
    assert has(found, "group who_broke_rail", "variant v_li", "true together")


def test_a_lie_is_no_lie_when_it_is_true_everywhere_unless_only_its_source_is_false():
    def everywhere(r):
        r["variants"][1]["true_props"].append("he_home")
        r["variants"][1]["true_props"].remove("he_under_bridge")

    assert has(problems(everywhere), "lie template he_at_home", "true everywhere")

    def only_the_source(r):
        everywhere(r)
        r["lies"][0]["templates"][0]["source_only"] = True

    assert problems(only_the_source) == []

    def false_everywhere(r):
        r["variants"][0]["true_props"].remove("he_home")
        r["lies"][0]["templates"][0]["source_only"] = True

    assert has(
        problems(false_everywhere), "lie template he_at_home", "source_only", "false everywhere"
    )


def test_an_assimilation_that_changes_the_predicate_needs_a_rule_of_the_script():
    found = problems(lambda r: r.update(speculation=[]))
    assert has(found, "li_damaged_by_rule", "no rule of the script turns li_at_bridge into it")

    def wrong_rule(r):
        r["speculation"] = [s for s in r["speculation"] if s["id"] == "grudge_at_scene"]

    assert has(problems(wrong_rule), "li_damaged_by_rule", "no rule")


@pytest.mark.parametrize(
    ("mutate", "needles"),
    [
        (
            lambda r: r["chains"][0]["hops"][1].update(prop="ghost"),
            ("hop 2", "unknown prop 'ghost'"),
        ),
        (lambda r: r["chains"][0]["hops"][0].update(speaker="clerk"), ("hop 1", "the root")),
        (
            lambda r: r["chains"][0]["hops"][1].update(speaker="rail"),
            ("hop 2", "'rail' is not a person"),
        ),
        (
            lambda r: r["chains"][0]["hops"][2].update(listener=None),
            ("hop 3", "None is not a person"),
        ),
        (
            lambda r: r["chains"][0]["hops"].__setitem__(2, r["chains"][0]["hops"][3]),
            ("hop 3", "has parent 'r2_revenge'", "expects 'r1_broke'"),
        ),
        (
            lambda r: r["chains"][0]["hops"][1].update(via="scene_damage"),
            ("hop 2", "only an assimilate"),
        ),
        (lambda r: r["chains"][1]["hops"][1].update(via="made_up"), ("hop 2", "unknown rule")),
        (
            lambda r: r["chains"][1]["hops"][1].update(via="grudge_at_scene"),
            ("hop 2", "grudge_at_scene does not make li_damaged_by_rule"),
        ),
        (lambda r: r["chains"][1]["hops"][1].update(via=None), ()),  # the rule is not required here
    ],
)
def test_a_chain_is_checked_hop_by_hop(mutate, needles):
    found = problems(mutate)
    if needles:
        assert has(found, "chain", *needles), found
    else:
        assert found == []
