"""Guessing rules and lie templates: the shapes they load from, what they refuse, how they match."""

import copy

import pytest
from cog_world import LIES, NIGHT, PROPS, REGISTRY, RULES, TABLES

from lantern_core import canon
from lantern_core.cognition._fields import ShapeError
from lantern_core.cognition.props import Prop, PropBook
from lantern_core.cognition.rules import (
    SOURCE_KINDS,
    LieEnvelope,
    LieSource,
    LieTemplate,
    Pattern,
    Relation,
    SpecRule,
)

RULE = RULES["grudge_at_scene"]


def rule_dict(**change):
    raw = copy.deepcopy(RULE.to_canon())
    raw.update(change)
    return raw


def prop(id, pred, args, **kw):
    return Prop.of(id, pred, args, **kw)


# ------------------------------------------------------------------ patterns


def test_a_pattern_fits_a_prop_that_has_its_slots_and_may_have_more():
    pattern = Pattern.of("broke", {"who": "$X", "what": "rail"})
    assert pattern.match(PROPS["li_broke"], {}) == {"X": "li2"}
    assert pattern.match(PROPS["r1_broke"], {}) == {"X": "li2"}  # r1_broke also has a place
    assert pattern.match(PROPS["he_broke"], {"X": "he"}) == {"X": "he"}
    assert pattern.match(PROPS["he_broke"], {"X": "li2"}) is None  # $X is li2 already
    assert pattern.match(PROPS["li_broke"], {"Y": "he"}) == {"Y": "he", "X": "li2"}
    assert Pattern.of("broke", {"who": "$X", "what": "boat"}).match(PROPS["li_broke"], {}) is None
    assert Pattern.of("broke", {"when": "$X"}).match(PROPS["li_broke"], {}) is None  # no such slot
    assert Pattern.of("at", {"who": "$X"}).match(PROPS["li_broke"], {}) is None  # another predicate


def test_a_pattern_never_matches_a_negation_and_one_variable_is_one_entity():
    assert Pattern.of("broke", {"who": "$X"}).match(PROPS["li_not_broke"], {}) is None
    twice = Pattern.of("at", {"who": "$X", "where": "$X"})
    assert twice.match(PROPS["he_home"], {}) is None
    same = prop("s", "damaged", {"who": "li2", "what": "li2"})  # one entity in two slots
    assert Pattern.of("damaged", {"who": "$X", "what": "$X"}).match(same, {}) == {"X": "li2"}


def test_a_new_variable_can_be_refused_so_a_conclusion_cannot_invent_one():
    pattern = Pattern.of("broke", {"who": "$X", "what": "$T"})
    assert pattern.match(PROPS["li_broke"], {"X": "li2"}, bind_new=False) is None
    both = {"X": "li2", "T": "rail"}
    assert pattern.match(PROPS["li_broke"], both, bind_new=False) == both


def test_a_pattern_lists_its_variables_and_round_trips():
    pattern = Pattern.of("damaged", {"who": "$X", "what": "$T", "where": "$X"})
    assert pattern.variables() == ("T", "X")  # in slot order: what, where, who
    assert Pattern.from_canon(pattern.to_canon()) == pattern
    assert pattern.to_canon() == {
        "pred": "damaged",
        "args": {"who": "$X", "what": "$T", "where": "$X"},
    }
    assert Pattern.of("broken", {"what": "rail"}).variables() == ()


@pytest.mark.parametrize(
    "raw",
    [
        {"pred": "at"},
        {"pred": "at", "args": [], "neg": False},
        {"pred": "at", "args": ["who", "$X"]},
        {"pred": "at", "args": {"who": ""}},
        {"pred": "at", "args": {"who": "$"}},  # a variable needs a name
        {"pred": "", "args": {}},
        {"pred": "at", "args": {"who": "$X"}, "neg": False},  # no polarity: rules match facts
    ],
)
def test_a_pattern_that_is_not_well_formed_is_refused(raw):
    with pytest.raises(ShapeError):
        Pattern.from_canon(raw)


def test_a_pattern_keeps_its_slots_sorted_and_unique():
    with pytest.raises(ShapeError):
        Pattern("at", (("who", "$X"), ("where", "$P")))
    with pytest.raises(ShapeError):
        Pattern("at", (("who", "$X"), ("who", "$Y")))


# ------------------------------------------------------------------ relations and rules


def test_a_relation_names_the_kind_the_holder_and_a_variable_target():
    relation = Relation.from_canon({"kind": "grudge", "holder": "speaker", "target": "$X"})
    assert Relation.from_canon(relation.to_canon()) == relation
    for raw in (
        {"kind": "grudge", "holder": "listener", "target": "$X"},
        {"kind": "grudge", "holder": "speaker", "target": "X"},
        {"kind": "grudge", "holder": "speaker", "target": "$"},
        {"kind": "", "holder": "speaker", "target": "$X"},
        {"kind": "grudge", "holder": "speaker"},
    ):
        with pytest.raises(ShapeError):
            Relation.from_canon(raw)


def test_rules_round_trip_through_canonical_json_exactly_as_the_content_writes_them():
    for rule in RULES.values():
        raw = rule.to_canon()
        assert SpecRule.from_canon(canon.loads(canon.dumps(raw))) == rule
        assert SpecRule.from_canon(raw).to_canon() == raw
    plain = SpecRule.from_canon(rule_dict(relation=None))
    assert plain.relation is None and plain.to_canon()["relation"] is None
    assert RULE.hedge == ("我猜", "怕是") and RULE.min_suspicion == 30


def test_the_variables_of_a_rule_are_kept_sorted_with_their_types():
    assert RULE.vars == (("P", "place"), ("T", "thing"), ("X", "person"))
    assert RULE.relation == Relation("grudge", "speaker", "$X")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda r: r.update(premises=[]),
        lambda r: r["conclusion"]["args"].update(what="$Z"),  # undeclared
        lambda r: r["vars"].update(Z="thing"),  # declared, never used
        lambda r: r["vars"].pop("P"),  # used, not declared
        lambda r: r["vars"].update(T="animal"),
        lambda r: r["vars"].update(X="family"),  # the relation target must be a person
        lambda r: r["relation"].update(target="$P"),  # a place
        lambda r: r["relation"].update(target="$Q"),  # not declared
        lambda r: r.update(hedge=[]),
        lambda r: r.update(hedge=["我猜", "  "]),
        lambda r: r.update(min_suspicion=101),
        lambda r: r.update(min_suspicion=-1),
        lambda r: r.update(min_suspicion="30"),
        lambda r: r.update(label=""),
        lambda r: r.update(extra=1),
        lambda r: r.pop("relation"),
        lambda r: r.update(vars=[]),
    ],
)
def test_a_rule_that_is_not_well_formed_is_refused(mutate):
    raw = rule_dict()
    mutate(raw)
    with pytest.raises(ShapeError):
        SpecRule.from_canon(raw)


def test_a_conclusion_variable_no_premise_binds_is_refused_with_the_name():
    raw = rule_dict()
    raw["premises"] = [{"pred": "at", "args": {"who": "$X", "where": "$P"}}]
    raw["vars"] = {"X": "person", "P": "place", "T": "thing"}
    with pytest.raises(ShapeError, match=r"\$T, which no premise binds"):
        SpecRule.from_canon(raw)


# ------------------------------------------------------------------ matching


def test_a_premise_binds_variables_and_a_variable_keeps_its_entity_from_premise_to_premise():
    env = RULE.bind(0, PROPS["li_at_bridge"], {}, REGISTRY)
    assert env == {"X": "li2", "P": "bridge_side"}
    env = RULE.bind(1, PROPS["rail_located"], env, REGISTRY)
    assert env == {"X": "li2", "P": "bridge_side", "T": "rail"}
    assert RULE.bind(2, PROPS["rail_broken"], env, REGISTRY) == env
    assert RULE.bind(2, PROPS["rail_located"], env, REGISTRY) is None  # another predicate
    elsewhere = prop("e", "located", {"what": "rail", "where": "market"})
    assert RULE.bind(1, elsewhere, {"P": "bridge_side"}, REGISTRY) is None
    assert RULE.concludes(PROPS["li_broke"], env, REGISTRY)
    assert not RULE.concludes(PROPS["he_broke"], env, REGISTRY)
    assert not RULE.concludes(PROPS["li_broke"], {"X": "li2"}, REGISTRY)  # $T is not bound


def test_a_variable_binds_only_an_entity_of_its_type():
    rule = SpecRule.from_canon(
        {
            "id": "blame",
            "label": "有人弄坏了东西，就推测是他",
            "vars": {"X": "person", "T": "thing"},
            "premises": [{"pred": "damaged", "args": {"who": "$X", "what": "$T"}}],
            "relation": None,
            "conclusion": {"pred": "broke", "args": {"who": "$X", "what": "$T"}},
            "hedge": ["我猜"],
            "min_suspicion": 0,
        }
    )
    person = prop("p", "damaged", {"who": "li2", "what": "rail"}, span=NIGHT)
    family = prop("f", "damaged", {"who": "fam_li", "what": "rail"}, span=NIGHT)  # a family
    assert rule.bind(0, person, {}, REGISTRY) == {"X": "li2", "T": "rail"}
    assert rule.bind(0, family, {}, REGISTRY) is None


def derive(rule, parent, child, pool):
    return list(rule.derivations(PROPS[parent], PROPS[child], [PROPS[p] for p in pool], REGISTRY))


POOL = ["li_at_bridge", "he_home", "rail_located", "rail_broken", "li_broke"]


def test_a_rule_turns_a_parent_into_a_child_when_the_other_premises_are_in_the_pool():
    scene = RULES["scene_damage"]
    env = {"X": "li2", "P": "bridge_side", "T": "rail"}
    assert derive(scene, "li_at_bridge", "li_damaged_by_rule", POOL) == [env]
    assert scene.step_problem(PROPS["li_at_bridge"], PROPS["li_damaged_by_rule"], [], REGISTRY)
    assert derive(scene, "li_at_bridge", "li_damaged_by_rule", ["rail_located"]) == []
    assert derive(scene, "li_at_bridge", "li_damaged_by_rule", ["rail_broken"]) == []
    assert derive(scene, "he_home", "li_damaged_by_rule", POOL) == []  # he is not at the bridge
    he_did_it = prop("h", "damaged", {"who": "he", "what": "rail"}, span=NIGHT)
    assert list(scene.derivations(PROPS["li_at_bridge"], he_did_it, PROPS.values(), REGISTRY)) == []
    # the conclusion names the slots it fixes, so a child may carry a place besides
    assert derive(scene, "li_at_bridge", "r0_damaged", POOL) == [env]


def test_the_parent_may_fill_any_premise_and_the_others_still_have_to_be_found():
    flipped = SpecRule.from_canon(
        rule_dict(id="flipped", premises=list(reversed(RULE.to_canon()["premises"])))
    )
    env = {"X": "li2", "P": "bridge_side", "T": "rail"}
    got = list(
        flipped.derivations(PROPS["li_at_bridge"], PROPS["li_broke"], PROPS.values(), REGISTRY)
    )
    assert got == [env]
    # the parent can also be the located fact, and the person comes from the pool
    got = list(
        flipped.derivations(PROPS["rail_located"], PROPS["li_broke"], PROPS.values(), REGISTRY)
    )
    assert got and all(e["T"] == "rail" for e in got)
    with_he = PropBook(
        [PROPS["rail_located"], PROPS["rail_broken"], PROPS["he_home"], PROPS["he_broke"]]
    )
    assert (
        list(
            flipped.derivations(
                PROPS["rail_located"], PROPS["he_broke"], with_he.values(), REGISTRY
            )
        )
        == []
    )


def test_a_conclusion_with_a_literal_entity_must_match_it():
    raw = rule_dict(id="onto_rail")
    raw["conclusion"] = {"pred": "broke", "args": {"who": "$X", "what": "boat"}}
    raw["vars"].pop("T")
    raw["premises"] = [
        {"pred": "at", "args": {"who": "$X", "where": "$P"}},
        {"pred": "located", "args": {"what": "rail", "where": "$P"}},
    ]
    boat = prop("b", "broke", {"who": "li2", "what": "boat"}, span=NIGHT)
    rule = SpecRule.from_canon(raw)
    pool = [PROPS["rail_located"]]
    assert list(rule.derivations(PROPS["li_at_bridge"], boat, pool, REGISTRY))
    assert not list(rule.derivations(PROPS["li_at_bridge"], PROPS["li_broke"], pool, REGISTRY))


def test_the_rule_against_the_tables_and_entities():
    for rule in RULES.values():
        assert rule.problems(TABLES, REGISTRY) == []

    def found(mutate):
        raw = rule_dict()
        mutate(raw)
        return SpecRule.from_canon(raw).problems(TABLES, REGISTRY)

    assert any(
        "unknown predicate" in m for m in found(lambda r: r["premises"][2].update(pred="smashed"))
    )
    assert any(
        "no slot 'when'" in m for m in found(lambda r: r["premises"][2]["args"].update(when="$T"))
    )
    # $P declared as a thing, but located.where needs a place
    assert any("$P is a thing" in m for m in found(lambda r: r["vars"].update(P="thing")))
    # a literal that is not an entity, or the wrong kind of one
    assert any(
        "unknown entity" in m
        for m in found(lambda r: r["premises"][1]["args"].update(what="ghost"))
    )
    assert any(
        "'market' is a place" in m
        for m in found(lambda r: r["premises"][1]["args"].update(what="market"))
    )

    # the conclusion must be a whole prop, the premises may name a part
    def thin(r):
        r["conclusion"]["args"].pop("what")
        r["premises"][2]["args"] = {"what": "$T"}

    assert any("missing required slot 'what'" in m for m in found(thin))
    # a slot that takes a family accepts a rule variable typed as one
    ok = found(lambda r: (r["vars"].update(X="person"),))
    assert ok == []


# ------------------------------------------------------------------ lies


def envelope_dict(**change):
    raw = copy.deepcopy(LIES[0].to_canon())
    raw.update(change)
    return raw


def test_the_content_shapes_of_a_lie_envelope_load_and_write_back_the_same():
    envelope = LIES[0]
    assert LieEnvelope.from_canon(canon.loads(canon.dumps(envelope.to_canon()))) == envelope
    claim, feign = envelope.templates
    assert (claim.id, claim.holder, claim.kind, claim.prop) == (
        "he_at_home",
        "he",
        "claim",
        "he_home",
    )
    assert claim.source == LieSource("witnessed") and not claim.source_only
    assert (feign.kind, feign.about, feign.prop, feign.source) == (
        "feign_ignorance",
        "damaged",
        None,
        None,
    )
    assert LieTemplate.from_canon(claim.to_canon(), "he") == claim
    assert envelope.preds == ("at",) and envelope.objects == ("he", "home_he", "market")


@pytest.mark.parametrize(
    ("kind", "told_by", "holder", "named"),
    [
        ("witnessed", None, "he", "self_seen"),
        ("heard", "zhou", "he", "zhou"),
        ("guessed", None, "he", "he"),
        ("gossip", None, "he", "unknown"),
        ("gazette", None, "he", "unknown"),
        ("guessed", None, "wang", "wang"),
    ],
)
def test_each_source_kind_maps_to_one_claimed_source(kind, told_by, holder, named):
    assert LieSource(kind, told_by).claimed(holder) == named
    assert set(SOURCE_KINDS) == {"witnessed", "heard", "guessed", "gossip", "gazette"}


def test_a_source_names_whom_it_was_heard_from_if_and_only_if_it_was_heard():
    for bad in (("heard", None), ("witnessed", "zhou"), ("gossip", "zhou"), ("rumour", None)):
        with pytest.raises(ShapeError):
            LieSource(*bad)
    with pytest.raises(ShapeError):
        LieSource.from_canon({"kind": "witnessed"})
    assert LieSource.from_canon({"kind": "heard", "from": "zhou"}) == LieSource("heard", "zhou")


def test_a_template_carries_the_source_the_core_records():
    claim, feign = LIES[0].templates
    assert claim.claimed_source == "self_seen" and feign.claimed_source is None


@pytest.mark.parametrize(
    "mutate",
    [
        lambda t: t.update(kind="boast"),
        lambda t: t.update(prop=None),  # a claim needs its prop
        lambda t: t.update(source=None),
        lambda t: t.update(about="damaged"),  # a claim has no 'about'
        lambda t: t.update(source_only="yes"),
        lambda t: t.update(extra=1),
        lambda t: t.pop("source_only"),
        lambda t: t.update(id=""),
    ],
)
def test_a_claim_template_that_is_not_well_formed_is_refused(mutate):
    raw = copy.deepcopy(LIES[0].templates[0].to_canon())
    mutate(raw)
    with pytest.raises(ShapeError):
        LieTemplate.from_canon(raw, "he")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda t: t.update(about=None),
        lambda t: t.update(prop="he_home"),
        lambda t: t.update(source={"kind": "witnessed", "from": None}),
        lambda t: t.update(source_only=True),
    ],
)
def test_a_feigned_ignorance_names_the_act_and_nothing_else(mutate):
    raw = copy.deepcopy(LIES[0].templates[1].to_canon())
    mutate(raw)
    with pytest.raises(ShapeError):
        LieTemplate.from_canon(raw, "he")


@pytest.mark.parametrize(
    "mutate",
    [
        lambda e: e.update(templates=[]),
        lambda e: e["templates"].append(copy.deepcopy(e["templates"][0])),  # a repeated id
        lambda e: e["templates"][1].update(about="at"),  # not in the ignorance list
        lambda e: e.update(sources=["gossip"]),  # the claim names a source the envelope forbids
        lambda e: e.update(sources=["rumour"]),
        lambda e: e.update(extra=1),
        lambda e: e.pop("motive"),
        lambda e: e.update(holder=""),
        lambda e: e.update(preds="at"),
    ],
)
def test_an_envelope_that_is_not_well_formed_is_refused(mutate):
    raw = envelope_dict()
    mutate(raw)
    with pytest.raises(ShapeError):
        LieEnvelope.from_canon(raw)


def test_an_envelope_holds_only_the_templates_of_its_own_holder():
    other = LieTemplate.from_canon(LIES[0].templates[0].to_canon(), "wang")
    with pytest.raises(ShapeError):
        LieEnvelope("he", "fear", ("at",), (), ("he",), ("witnessed",), (other,))


def problems(**change):
    return LieEnvelope.from_canon(envelope_dict(**change)).problems(PROPS, TABLES, REGISTRY)


def test_an_envelope_is_checked_against_the_tables_the_entities_and_the_book():
    assert LIES[0].problems(PROPS, TABLES, REGISTRY) == []
    assert any("not a person" in m for m in problems(holder="rail"))
    assert any("unknown motive" in m for m in problems(motive="boredom"))
    assert any("unknown predicate" in m for m in problems(preds=["at", "teleport"]))
    assert any("unknown predicate" in m for m in problems(ignorance=["damaged", "teleport"]))
    assert any("unknown object" in m for m in problems(objects=["he", "home_he", "atlantis"]))
    # the claim goes outside the envelope: the predicate, or an entity it names
    assert any("may not claim 'at'" in m for m in problems(preds=["broke"]))
    assert any("may not name 'home_he'" in m for m in problems(objects=["he", "market"]))
    # the template names a prop that is not in the book
    tail = envelope_dict()
    tail["templates"][0]["prop"] = "ghost"
    assert any(
        "unknown prop 'ghost'" in m
        for m in LieEnvelope.from_canon(tail).problems(PROPS, TABLES, REGISTRY)
    )
    told = envelope_dict(sources=["witnessed", "heard"])
    told["templates"][0]["source"] = {"kind": "heard", "from": "rail"}
    assert any(
        "not a person" in m for m in LieEnvelope.from_canon(told).problems(PROPS, TABLES, REGISTRY)
    )
    bad_about = envelope_dict(ignorance=["teleport"])
    bad_about["templates"][1]["about"] = "teleport"
    assert any(
        "unknown predicate 'teleport'" in m
        for m in LieEnvelope.from_canon(bad_about).problems(PROPS, TABLES, REGISTRY)
    )
