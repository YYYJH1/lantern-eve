"""The four notebook marks: exclusive, no support, source mismatch, unconfirmed."""

import pytest
from cog_world import GROUPS, NIGHT, PROPS, TABLES

from lantern_core.cognition.beliefs import Belief, BeliefStore, Claim
from lantern_core.cognition.props import ExclusiveGroups, Prop, PropBook, Tables
from lantern_core.cognition.provenance import Hop, Trace
from lantern_core.cognition.relations import (
    EXCLUSIVE,
    NO_SUPPORT,
    SOURCE_MISMATCH,
    UNCONFIRMED,
    conflicts,
    marks,
    mutually_exclusive,
    no_support,
    source_mismatch,
    supported,
    unconfirmed,
)


def saw(holder, prop, tick=0):
    return Belief(holder, prop, "assert", 90, "saw", None, None, 0, tick, None)


def heard(holder, prop, teller, claimed, hop=1, tick=50, claim="c0"):
    return Belief(holder, prop, "assert", 60, "heard", teller, claimed, hop, tick, claim)


def exclusive(a, b, tables=TABLES, groups=GROUPS):
    return mutually_exclusive(PROPS[a], PROPS[b], groups, tables)


# ------------------------------------------------------------------ the document's example


def test_being_at_the_bridge_does_not_contradict_breaking_it_it_gives_no_support():
    me = BeliefStore(
        "player",
        [saw("player", "li_at_bridge", tick=5), heard("player", "li_broke", "zhou", "clerk")],
    )
    assert not exclusive("li_at_bridge", "li_broke")  # not contradicted
    assert conflicts(PROPS["li_broke"], me, PROPS, GROUPS, TABLES) == []
    assert no_support(PROPS["li_broke"], me, PROPS)  # but not supported either
    assert supported(PROPS["li_at_bridge"], me, PROPS)
    got = marks(me.get("li_broke"), me, PROPS, GROUPS, TABLES)
    assert EXCLUSIVE not in got and NO_SUPPORT in got


# ------------------------------------------------------------------ exclusive


def test_props_in_one_group_exclude_each_other_and_not_themselves():
    assert exclusive("li_broke", "he_broke") and exclusive("he_broke", "li_broke")
    assert not exclusive("li_broke", "li_broke")
    assert not exclusive("li_broke", "li_at_bridge")


def test_a_statement_and_its_denial_exclude_each_other_where_their_spans_overlap():
    assert exclusive("li_broke", "li_not_broke")
    plain = Prop.of("x", "broke", {"who": "li2", "what": "rail"})  # no time stated
    denied_then = Prop.of("y", "broke", {"who": "li2", "what": "rail"}, span=(1000, 1100), neg=True)
    denied_ever = Prop.of("z", "broke", {"who": "li2", "what": "rail"}, neg=True)
    early = Prop.of("e", "broke", {"who": "li2", "what": "rail"}, span=(0, 60))
    other = Prop.of("o", "broke", {"who": "he", "what": "rail"}, span=NIGHT, neg=True)
    book = PropBook([plain, denied_then, denied_ever, early, other])
    no_groups = ExclusiveGroups()

    def clash(a, b):
        return mutually_exclusive(book[a], book[b], no_groups)

    assert not clash("e", "y")  # the denial is for another time
    assert not clash("x", "y")  # a claim with no time is not refuted by a denial of one time
    assert clash("x", "z") and clash("e", "z")  # "never" refutes the thing at any time
    assert not clash("e", "o")  # another person


def test_one_person_cannot_be_in_two_places_at_overlapping_times():
    assert exclusive("he_home", "he_under_bridge")
    assert exclusive("he_home_evening", "he_under_bridge")  # the evening lies inside the night
    assert not exclusive("he_home", "he_market_late")  # the market is mid-morning on day 1
    assert not exclusive("he_home", "he_home")
    assert not exclusive("he_home", "li_at_bridge")  # two people


def test_the_two_places_rule_needs_the_at_predicate_in_the_tables():
    without_at = Tables.from_canon(
        {
            "predicates": [
                p.to_canon() | {"level_to": None}
                for p in TABLES.predicates.values()
                if p.id != "at"
            ],
            "motives": [],
        }
    )
    assert not exclusive("he_home", "he_under_bridge", tables=without_at)
    assert not exclusive("he_home", "he_under_bridge", tables=None)
    assert exclusive("he_home", "he_under_bridge", tables=TABLES)


def test_a_vague_place_claim_with_no_span_is_not_refuted_by_a_precise_one():
    vague = Prop.of("v", "at", {"who": "he", "where": "market"})
    precise = PROPS["he_home"]
    assert not mutually_exclusive(vague, precise, ExclusiveGroups(), TABLES)


def test_conflicts_lists_the_held_props_that_exclude_a_prop_in_id_order():
    s = BeliefStore(
        "zhou",
        [
            heard("zhou", "he_home", "he", "self_seen"),
            heard("zhou", "li_at_bridge", "wang", "wang"),
        ],
    )
    assert conflicts(PROPS["he_under_bridge"], s, PROPS, GROUPS, TABLES) == ["he_home"]
    assert conflicts(PROPS["he_home"], s, PROPS, GROUPS, TABLES) == []  # not itself


# ------------------------------------------------------------------ no support


def test_only_first_hand_belief_supports_a_prop():
    s = BeliefStore("zhou", [heard("zhou", "li_broke", "clerk", "self_seen")])
    assert no_support(PROPS["li_broke"], s, PROPS)
    s.put(saw("zhou", "li_broke"))
    assert supported(PROPS["li_broke"], s, PROPS)


def test_a_sighting_of_the_same_statement_under_another_id_supports_it():
    twin = Prop.of("twin", "broke", {"who": "li2", "what": "rail"}, span=NIGHT)
    book = PropBook([*(PROPS[i] for i in PROPS), twin])
    s = BeliefStore("clerk", [saw("clerk", "twin")])
    assert supported(PROPS["li_broke"], s, book)


def test_a_witness_of_the_parent_does_not_support_the_changed_prop():
    s = BeliefStore("clerk", [saw("clerk", "r0_damaged")])
    for child in ("r1_broke", "r2_revenge", "r3_li3", "r2_nowhere"):
        assert no_support(PROPS[child], s, PROPS), child
    assert supported(PROPS["r0_damaged"], s, PROPS)


def test_changing_a_prop_back_to_its_parents_words_is_still_not_the_parents_sighting():
    there = Prop.of("a0", "broke", {"who": "li2", "what": "rail"}, span=NIGHT)
    away = Prop.of(
        "a1", "broke", {"who": "li3", "what": "rail"}, span=NIGHT, parent="a0", op="assimilate"
    )
    back = Prop.of(
        "a2", "broke", {"who": "li2", "what": "rail"}, span=NIGHT, parent="a1", op="assimilate"
    )
    book = PropBook([there, away, back])
    assert back.same_fact(there)
    s = BeliefStore("clerk", [saw("clerk", "a0")])
    assert no_support(back, s, book)
    assert supported(there, s, book)


# ------------------------------------------------------------------ source mismatch


def told(speaker, listener, prop, tick=10, id="t1"):
    return Claim(id, speaker, (listener,), prop, "assert", "self_seen", tick, "belief")


def test_the_named_source_having_said_something_else_is_a_mismatch():
    """Zhou says the clerk told him Li Er broke the rail. The clerk only said Li Er was there."""
    b = heard("player", "li_broke", "zhou", "clerk", tick=50)
    said = [told("clerk", "zhou", "li_at_bridge")]
    assert source_mismatch(b, said)
    assert not source_mismatch(b, [*said, told("clerk", "zhou", "li_broke", id="t2")])


@pytest.mark.parametrize(
    "claims",
    [
        [],  # nothing on record
        [told("clerk", "wang", "li_at_bridge")],  # said to someone else
        [told("wang", "zhou", "li_at_bridge")],  # said by someone else
        [told("clerk", "zhou", "li_at_bridge", tick=60)],  # said after the belief was written
    ],
)
def test_without_a_matching_record_nothing_is_known_and_there_is_no_mismatch(claims):
    assert not source_mismatch(heard("player", "li_broke", "zhou", "clerk", tick=50), claims)


def test_only_a_named_person_can_be_checked_and_same_content_agrees():
    said = [told("clerk", "zhou", "li_at_bridge")]
    for claimed in ("self_seen", "unknown"):
        assert not source_mismatch(heard("player", "li_broke", "zhou", claimed), said)
    assert not source_mismatch(saw("player", "li_broke"), said)
    twin = Prop.of("twin", "broke", {"who": "li2", "what": "rail"}, span=NIGHT)
    book = PropBook([*(PROPS[i] for i in PROPS), twin])
    b = heard("player", "li_broke", "zhou", "clerk")
    assert source_mismatch(b, [told("clerk", "zhou", "twin")])  # ids differ, no props to compare
    assert not source_mismatch(b, [told("clerk", "zhou", "twin")], book)  # same content


# ------------------------------------------------------------------ unconfirmed


def test_unconfirmed_until_someone_in_the_chain_saw_it():
    s = BeliefStore("zhou", [heard("zhou", "li_broke", "clerk", "self_seen")])
    p = PROPS["li_broke"]
    assert unconfirmed(p, s, PROPS)
    chain = Trace(
        (
            Hop("zhou", s.get("li_broke"), None),
            Hop("clerk", saw("clerk", "li_broke"), None),
        ),
        "saw",
        "clerk",
    )
    assert not unconfirmed(p, s, PROPS, chain)
    s.put(saw("zhou", "li_broke"))
    assert not unconfirmed(p, s, PROPS)


def test_a_witness_of_an_ancestor_further_up_the_chain_does_not_confirm_a_changed_prop():
    s = BeliefStore("liu", [heard("liu", "r3_li3", "wang", "zhou", hop=3)])
    chain = Trace(
        (
            Hop("liu", s.get("r3_li3"), None),
            Hop("clerk", saw("clerk", "r0_damaged"), None),
        ),
        "saw",
        "clerk",
    )
    assert unconfirmed(PROPS["r3_li3"], s, PROPS, chain)
    assert not unconfirmed(PROPS["r0_damaged"], s, PROPS, chain)


def test_marks_come_out_in_a_fixed_order():
    s = BeliefStore(
        "zhou",
        [
            heard("zhou", "he_under_bridge", "wang", "clerk"),
            heard("zhou", "he_home", "he", "self_seen"),
        ],
    )
    said = [told("clerk", "wang", "he_market_late")]
    got = marks(s.get("he_under_bridge"), s, PROPS, GROUPS, TABLES, said)
    assert got == (EXCLUSIVE, NO_SUPPORT, SOURCE_MISMATCH, UNCONFIRMED)
