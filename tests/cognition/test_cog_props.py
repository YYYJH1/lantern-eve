"""Tables, entities and props: what loads, what is refused, and what is true of the world."""

import copy

import pytest
from cog_world import (
    EVENING,
    GROUPS,
    NIGHT,
    PROP_DICTS,
    PROPS,
    REGISTRY,
    RULES,
    TABLES,
)

from lantern_core import canon
from lantern_core.cognition._fields import ShapeError
from lantern_core.cognition.props import (
    Event,
    ExclusiveGroups,
    Predicate,
    Prop,
    PropBook,
    PropError,
    Registry,
    Slot,
    Tables,
    check_event,
    check_prop,
    is_true,
    mutation_problem,
    spans_overlap,
    validate_prop,
)


def prop(id, pred, args, **kw):
    return Prop.of(id, pred, args, **kw)


def problems(p, book=None):
    return check_prop(p, TABLES, REGISTRY, book)


# ------------------------------------------------------------------ tables and entities


def test_tables_and_registry_round_trip_through_canonical_json():
    assert Tables.loads(canon.dumps(TABLES.to_canon())) == TABLES
    assert Registry.loads(canon.dumps(REGISTRY.to_canon())) == REGISTRY
    assert REGISTRY.type_of("li2") == "person" and REGISTRY.type_of("nobody") is None
    assert [e.id for e in REGISTRY.of_type("family")] == ["fam_li", "fam_he"]
    assert TABLES.predicates["at"].slot("where").types == ("place",)


def predicate(raw, pred_id):
    return next(p for p in raw["predicates"] if p["id"] == pred_id)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda t: t["predicates"].append(copy.deepcopy(t["predicates"][0])),
        lambda t: t["motives"].append({"id": "revenge", "label": "again"}),
        lambda t: t["predicates"][0]["slots"].append(t["predicates"][0]["slots"][0]),
        lambda t: t["predicates"][0]["slots"][0].update(type="animal"),
        lambda t: t["predicates"][0]["slots"][0].update(type=["person", "animal"]),
        lambda t: t["predicates"][0]["slots"][0].update(type=[]),
        lambda t: t["predicates"][0]["slots"][0].update(type=["person", "person"]),
        lambda t: t["predicates"][0]["slots"][0].update(type=7),
        lambda t: t["predicates"][0]["slots"][0].update(required="yes"),
        lambda t: t["predicates"][0].update(extra=1),
        lambda t: t["predicates"][0].update(level_to="nowhere"),
        lambda t: t["predicates"][0].update(level_to="at"),  # itself
        lambda t: t["predicates"][0].update(heavier=7),
        lambda t: predicate(t, "damaged").update(heavier="at"),  # other slot names
        lambda t: predicate(t, "at").update(level_to="looked_for"),  # needs slots at lacks
        lambda t: t.pop("motives"),
    ],
)
def test_tables_refuse_a_broken_file(mutate):
    raw = copy.deepcopy(TABLES.to_canon())
    mutate(raw)
    with pytest.raises(ShapeError):
        Tables.from_canon(raw)


def test_a_slot_takes_one_type_or_a_list_of_them_and_writes_back_the_same():
    one = Slot.from_canon({"name": "who", "type": "person", "required": True})
    two = Slot.from_canon({"name": "who", "type": ["person", "family"], "required": False})
    assert one.types == ("person",) and two.types == ("person", "family")
    assert one.allows("person") and not one.allows("family") and two.allows("family")
    assert one.to_canon()["type"] == "person"
    assert two.to_canon()["type"] == ["person", "family"]
    listed = Slot.from_canon({"name": "who", "type": ["person"], "required": True})
    assert listed == one and listed.to_canon() == one.to_canon()  # one in a list is just one
    with pytest.raises(ShapeError):
        Slot("who", (), True)
    with pytest.raises(ShapeError):
        Slot("who", ("person", "ghost"), True)


def test_the_ladder_of_a_predicate_is_optional_and_always_written_back():
    plain = {"id": "p", "label": "p", "slots": [{"name": "w", "type": "person", "required": True}]}
    got = Predicate.from_canon(plain)
    assert (got.level_to, got.heavier) == (None, None)
    assert got.to_canon() == {**plain, "level_to": None, "heavier": None}
    assert Predicate.from_canon(got.to_canon()) == got
    assert TABLES.predicates["looked_for"].level_to == "at"
    assert TABLES.predicates["damaged"].heavier == "broke"
    assert Tables.from_canon(TABLES.to_canon()) == TABLES


@pytest.mark.parametrize(
    "mutate",
    [
        lambda e: e.append(dict(e[0])),  # duplicate id
        lambda e: e.append({"id": "x", "type": "thing", "label": "x", "family": "fam_li"}),
        lambda e: e.append({"id": "x", "type": "person", "label": "x", "family": "rail"}),
        lambda e: e.append({"id": "x", "type": "person", "label": "x", "family": "nope"}),
        lambda e: e.append({"id": "x", "type": "ghost", "label": "x"}),
    ],
)
def test_registry_refuses_a_broken_file(mutate):
    raw = copy.deepcopy(REGISTRY.to_canon())
    mutate(raw)
    with pytest.raises(ShapeError):
        Registry.from_canon(raw)


def test_an_entity_may_carry_an_english_label_that_survives_a_round_trip():
    plain = Registry.from_canon([{"id": "t", "type": "thing", "label": "灯"}])
    assert plain.get("t").label_en is None and "label_en" not in plain.get("t").to_canon()
    raw = [{"id": "t", "type": "thing", "label": "灯", "label_en": "Lantern"}]
    named = Registry.from_canon(raw)
    assert named.get("t").label_en == "Lantern"
    assert named.to_canon() == raw
    assert Registry.loads(canon.dumps(named.to_canon())) == named != plain
    person = Registry.from_canon(
        [
            {"id": "fam", "type": "family", "label": "李家", "label_en": "Li Family"},
            {"id": "p", "type": "person", "label": "李二", "label_en": "Li Er", "family": "fam"},
        ]
    )
    assert [e.label_en for e in person] == ["Li Family", "Li Er"]
    assert Registry.from_canon(person.to_canon()) == person
    for bad in ("", 3, ["Lantern"]):
        with pytest.raises(ShapeError):
            Registry.from_canon([{"id": "t", "type": "thing", "label": "灯", "label_en": bad}])
    with pytest.raises(ShapeError):  # keys other than label_en are still refused
        Registry.from_canon([{"id": "t", "type": "thing", "label": "灯", "label_fr": "Lanterne"}])


def test_every_compiled_entity_has_an_english_label():
    from pathlib import Path

    compiled = Path(__file__).resolve().parents[2] / "content" / "compiled" / "entities.json"
    registry = Registry.loads(compiled.read_bytes())
    assert len(registry) > 0 and all(e.label_en for e in registry)


# ------------------------------------------------------------------ props


def test_the_contract_json_survives_a_round_trip_unchanged():
    for raw in PROP_DICTS:
        assert Prop.from_canon(raw).to_canon() == raw
    # a root prop has no parent or op keys, a mutated one has both
    assert "parent" not in PROPS["li_broke"].to_canon()
    assert PROPS["r1_broke"].to_canon()["op"] == "sharpen"


def test_args_are_kept_sorted_so_that_ids_and_hashes_do_not_depend_on_dict_order():
    a = prop("x", "damaged", {"what": "rail", "who": "li2"})
    b = prop("x", "damaged", {"who": "li2", "what": "rail"})
    assert a == b and hash(a) == hash(b)
    assert a.args == (("what", "rail"), ("who", "li2"))
    assert canon.dumps(a.to_canon()) == canon.dumps(b.to_canon())


def test_same_fact_ignores_the_id_and_the_parent():
    a = PROPS["r1_broke"]
    b = prop("other", "broke", a.args_dict(), span=NIGHT)
    assert a.same_fact(b) and not a.same_fact(PROPS["r2_revenge"])


@pytest.mark.parametrize(
    "mutate",
    [
        lambda d: d.update(span=[5]),
        lambda d: d.update(span=[300, -180]),
        lambda d: d.update(span=[0.5, 3]),
        lambda d: d.update(span=[True, 3]),
        lambda d: d.update(neg="no"),
        lambda d: d.update(id=""),
        lambda d: d.update(args={"who": ""}),
        lambda d: d.update(args=["who", "li2"]),
        lambda d: d.update(parent="li_broke", op="fill", id="li_broke"),
        lambda d: d.update(colour="red"),
        lambda d: d.pop("motive"),
    ],
)
def test_a_prop_that_is_not_even_well_formed_is_refused_on_load(mutate):
    raw = copy.deepcopy(PROP_DICTS[0])
    mutate(raw)
    with pytest.raises(ShapeError):
        Prop.from_canon(raw)


def test_validation_accepts_the_whole_fixture_book():
    assert PROPS.check(TABLES, REGISTRY) == []


@pytest.mark.parametrize(
    ("bad", "fragment"),
    [
        (prop("p", "fly", {"who": "li2"}), "unknown predicate"),
        (prop("p", "at", {"who": "li2"}), "missing required slot 'where'"),
        (prop("p", "at", {"who": "li2", "where": "market", "how": "rail"}), "no slot 'how'"),
        (prop("p", "at", {"who": "rail", "where": "market"}), "needs a person"),
        (prop("p", "at", {"who": "li2", "where": "li3"}), "needs a place"),
        (prop("p", "at", {"who": "li2", "where": "atlantis"}), "unknown entity"),
        (prop("p", "at", {"who": "li2", "where": "market"}, motive="boredom"), "unknown motive"),
        (prop("p", "at", {"who": "li2", "where": "market"}, parent="li_at_bridge"), "together"),
        (prop("p", "at", {"who": "li2", "where": "market"}, op="level"), "together"),
        (
            prop("p", "at", {"who": "li2", "where": "market"}, parent="x", op="shout"),
            "unknown operator",
        ),
    ],
)
def test_validation_names_what_is_wrong(bad, fragment):
    found = problems(bad)
    assert any(fragment in msg for msg in found), found


def test_validation_reports_every_problem_and_the_raising_form_lists_them():
    bad = prop("p", "at", {"who": "rail"}, motive="boredom")
    found = problems(bad)
    assert len(found) == 3
    with pytest.raises(PropError) as info:
        validate_prop(bad, TABLES, REGISTRY)
    assert str(info.value).count(";") == 2
    validate_prop(PROPS["li_broke"], TABLES, REGISTRY)


def test_parent_must_exist_when_a_book_is_given():
    orphan = prop(
        "o", "broke", {"who": "li2", "what": "rail"}, span=NIGHT, parent="ghost", op="level"
    )
    assert problems(orphan) == []  # no book, nothing to look up
    assert any("unknown parent" in m for m in problems(orphan, PROPS))


# ------------------------------------------------------------------ the four operators


def child_of(parent_id, **change):
    p = PROPS[parent_id]
    kw = {
        "args": p.args_dict(),
        "span": p.span,
        "neg": p.neg,
        "motive": p.motive,
        "pred": p.pred,
    }
    kw.update(change)
    return Prop.of("c", kw.pop("pred"), kw.pop("args"), parent=parent_id, **kw)


def problem(parent, op, rule=None, book=None, **change):
    child = child_of(parent, **change)
    return mutation_problem(PROPS[parent], child, op, TABLES, REGISTRY, rule, book=book)


LOOKED = {"who": "li2", "where": "bridge_side"}
DAMAGE = {"who": "li2", "what": "rail", "where": "bridge_side"}


@pytest.mark.parametrize(
    ("parent", "op", "change", "ok"),
    [
        # sharpen: a heavier predicate with the motive kept, or an unstated motive made on_purpose
        ("r0_damaged", "sharpen", {"pred": "broke"}, True),
        ("r0_damaged", "sharpen", {"pred": "broke", "motive": "revenge"}, False),
        ("r0_damaged", "sharpen", {"pred": "broke", "span": None}, False),
        ("r0_damaged", "sharpen", {"args": {"who": "li3", "what": "rail"}}, False),
        ("r0_damaged", "sharpen", {"pred": "broke", "neg": True}, False),
        ("r0_damaged", "sharpen", {"motive": "on_purpose"}, True),
        ("r0_damaged", "sharpen", {"motive": "revenge"}, False),  # that is fill
        ("r1_broke", "sharpen", {"pred": "damaged"}, False),  # lighter, and not a rung
        ("r1_broke", "sharpen", {"pred": "at", "args": LOOKED}, False),
        ("r1_broke", "sharpen", {}, False),  # changes nothing
        # fill: only the motive, and a concrete one
        ("r1_broke", "fill", {"motive": "jealousy"}, True),
        ("r2_revenge", "fill", {"motive": "jealousy"}, False),  # the parent has one already
        ("r1_broke", "fill", {"motive": "accident"}, False),
        ("r1_broke", "fill", {"motive": "on_purpose"}, False),
        ("r1_broke", "fill", {"motive": "boredom"}, False),  # not in the table
        ("r1_broke", "fill", {"motive": "jealousy", "span": None}, False),
        ("r1_broke", "fill", {"motive": "jealousy", "pred": "damaged"}, False),
        ("r1_broke", "fill", {}, False),
        # assimilate with the predicate kept: some argument replaced by one the slot takes
        ("r1_broke", "assimilate", {"args": {**DAMAGE, "who": "li3"}}, True),
        ("r1_broke", "assimilate", {"args": {**DAMAGE, "who": "fam_li"}}, True),  # a family
        ("r1_broke", "assimilate", {"args": {**DAMAGE, "who": "he", "what": "boat"}}, True),
        ("r1_broke", "assimilate", {"args": {**DAMAGE, "who": "rail"}}, False),  # not an actor
        ("r1_broke", "assimilate", {"args": {**DAMAGE, "who": "ghost"}}, False),
        ("r1_broke", "assimilate", {"args": {"who": "li3", "what": "rail"}}, False),  # dropped
        ("r1_broke", "assimilate", {"args": {**DAMAGE, "when": "market"}}, False),  # added
        ("r1_broke", "assimilate", {"motive": "jealousy"}, False),
        ("r1_broke", "assimilate", {"span": None}, False),
        ("r1_broke", "assimilate", {"neg": True}, False),
        ("r1_broke", "assimilate", {}, False),  # replaces nothing
        # assimilate that changes the predicate needs a rule
        ("r1_broke", "assimilate", {"pred": "damaged"}, False),
        # level: keep a part of what was said. Keeping all of it is allowed.
        ("r1_broke", "level", {"args": {"who": "li2", "what": "rail"}}, True),  # drops a slot
        ("r2_revenge", "level", {"motive": None}, True),  # drops the motive
        ("r1_broke", "level", {"span": None}, True),  # drops the time
        ("r1_broke", "level", {}, True),  # drops nothing, how a guess loses its hedge
        ("r1_broke", "level", {"args": {"who": "he", "what": "rail"}}, False),  # changes a value
        ("r1_broke", "level", {"args": {**DAMAGE, "when": "market"}}, False),  # adds a slot
        ("r1_broke", "level", {"args": {"what": "rail"}}, False),  # leaves out a required slot
        ("r1_broke", "level", {"motive": "revenge"}, False),  # adds, not drops
        ("r2_revenge", "level", {"motive": "jealousy"}, False),  # changes
        ("r1_broke", "level", {"span": (0, 10)}, False),  # a span is kept or dropped, not widened
        ("r1_broke", "level", {"neg": True}, False),
        ("r1_broke", "level", {"pred": "damaged"}, False),  # not the level_to of broke
        # level to the predicate the table names
        ("li_looked", "level", {"pred": "at", "args": LOOKED}, True),
        ("li_looked", "level", {"pred": "at", "args": LOOKED, "span": None}, True),
        ("li_looked", "level", {"pred": "at", "args": {"who": "li2"}}, False),  # needs where
        ("li_looked", "level", {"pred": "at", "args": {**LOOKED, "where": "market"}}, False),
        ("li_looked", "level", {"pred": "at", "args": {**LOOKED, "what": "boat"}}, False),
        ("li_looked", "level", {"pred": "at", "args": LOOKED, "motive": "revenge"}, False),
        ("li_looked", "level", {"pred": "broke"}, False),
    ],
)
def test_each_operator_has_a_shape_and_other_shapes_are_refused(parent, op, change, ok):
    got = problem(parent, op, **change)
    assert (got is None) is ok, got


def prop_with(id, parent_id, **change):
    """A prop like ``parent_id`` in everything but ``change``, whose parent is ``parent_id``."""
    base = PROPS[parent_id]
    kw = {"span": base.span, "neg": base.neg, "motive": base.motive}
    kw.update(change)
    pred = kw.pop("pred", base.pred)
    args = kw.pop("args", base.args_dict())
    return Prop.of(id, pred, args, **kw)


def test_the_motive_ladder_runs_from_nothing_or_an_accident_to_on_purpose_to_a_concrete_one():
    def step(parent, child, op):
        return mutation_problem(parent, child, op, TABLES, REGISTRY)

    plain = PROPS["r1_broke"]
    accident = prop_with("acc", "r1_broke", motive="accident")
    purpose = prop_with("pur", "r1_broke", motive="on_purpose")
    jealous = prop_with("jel", "r1_broke", motive="jealousy")
    assert step(plain, purpose, "sharpen") is None
    assert step(accident, purpose, "sharpen") is None  # an accident made on purpose
    assert "sharpen" in step(purpose, purpose, "sharpen")
    assert step(jealous, purpose, "sharpen") is not None  # a concrete motive is not undone
    assert step(plain, accident, "sharpen") is not None  # nor is an accident added
    assert step(plain, jealous, "fill") is None
    assert step(purpose, jealous, "fill") is None  # on_purpose is filled with a reason
    assert step(accident, jealous, "fill") is not None  # an accident has its reason already
    assert step(jealous, prop_with("rev", "r1_broke", motive="revenge"), "fill") is not None


def test_a_motive_unknown_to_the_table_is_not_a_fill():
    odd = prop_with("odd", "r1_broke", motive="boredom")
    assert "unknown motive" in mutation_problem(PROPS["r1_broke"], odd, "fill", TABLES, REGISTRY)


def test_an_unknown_operator_or_predicate_is_a_problem_and_not_a_crash():
    child = child_of("r1_broke", motive="jealousy")
    assert "unknown operator" in mutation_problem(
        PROPS["r1_broke"], child, "mock", TABLES, REGISTRY
    )
    stray = Prop.of("stray", "teleport", {"who": "li2"}, parent="r1_broke", op="level")
    assert mutation_problem(PROPS["r1_broke"], stray, "level", TABLES, REGISTRY) is not None
    assert mutation_problem(stray, PROPS["r1_broke"], "sharpen", TABLES, REGISTRY) is not None
    assert mutation_problem(stray, PROPS["r1_broke"], "level", TABLES, REGISTRY) is not None


def test_a_rule_licenses_an_assimilation_that_changes_the_predicate():
    parent, child = PROPS["li_at_bridge"], PROPS["li_damaged_by_rule"]
    rule = RULES["scene_damage"]

    def judged(parent=parent, child=child, rule=rule, book=PROPS):
        return mutation_problem(parent, child, "assimilate", TABLES, REGISTRY, rule, book=book)

    assert judged() is None
    # the other premises must be props of the book
    assert "no binding" in judged(book=PropBook([parent, PROPS["rail_located"]]))
    assert "no binding" in judged(book=None)
    # the rule must conclude the child's predicate and have a premise for the parent's
    assert "concludes 'broke'" in judged(rule=RULES["grudge_at_scene"])
    other = prop_with("other", "r3_li3", pred="damaged")
    assert "no premise about 'broke'" in judged(parent=PROPS["r3_li3"], child=other)
    # the bindings must reach the child: another person, another thing, or a thing not broken
    wrong_person = prop_with("c", "li_damaged_by_rule", args={"who": "he", "what": "rail"})
    assert "no binding" in judged(child=wrong_person)
    wrong_thing = prop_with("c", "li_damaged_by_rule", args={"who": "li2", "what": "boat"})
    assert "no binding" in judged(child=wrong_thing)
    # span, polarity and motive stay under every assimilation
    assert "keeps the span" in judged(child=prop_with("c", "li_damaged_by_rule", span=None))
    assert "keeps the span" in judged(child=prop_with("c", "li_damaged_by_rule", motive="revenge"))
    # a variable only binds an entity of its type: a family is no person for $X
    wide = Prop.of("wide", "at", {"who": "fam_li", "where": "bridge_side"}, span=NIGHT)
    assert not any(RULES["scene_damage"].derivations(wide, child, PROPS.values(), REGISTRY))


def test_the_static_check_does_not_judge_the_rule_behind_a_changed_predicate():
    assert check_prop(PROPS["li_damaged_by_rule"], TABLES, REGISTRY, PROPS) == []
    skewed = Prop.of(
        "s", "damaged", {"who": "li2", "what": "rail"}, parent="li_at_bridge", op="assimilate"
    )  # the parent has a span, this has none
    found = check_prop(skewed, TABLES, REGISTRY, PROPS)
    assert found and "keeps the span" in found[0]  # what needs no rule is still held to


def test_the_fixture_chain_is_consistent_with_its_operators():
    for pid in ("r1_broke", "r2_revenge", "r3_li3", "r2_nowhere", "r0_fam", "li_looked_at"):
        p = PROPS[pid]
        assert mutation_problem(PROPS[p.parent], p, p.op, TABLES, REGISTRY) is None, pid
    p = PROPS["li_damaged_by_rule"]
    rule = RULES["scene_damage"]
    assert mutation_problem(PROPS[p.parent], p, p.op, TABLES, REGISTRY, rule, book=PROPS) is None


# ------------------------------------------------------------------ book and groups


def test_book_refuses_two_different_props_under_one_id_and_iterates_in_id_order():
    book = PropBook([PROPS["li_broke"]])
    book.add(PROPS["li_broke"])  # the same prop again is fine
    with pytest.raises(PropError):
        book.add(prop("li_broke", "at", {"who": "li2", "where": "market"}))
    assert list(PROPS) == sorted(PROPS)


def test_book_lineage_children_root_and_order_independent_round_trip():
    assert PROPS.lineage("r3_li3") == ["r3_li3", "r2_revenge", "r1_broke", "r0_damaged"]
    assert PROPS.root("r3_li3") == "r0_damaged"
    assert [p.id for p in PROPS.children("r1_broke")] == ["r1_same", "r2_nowhere", "r2_revenge"]
    shuffled = PropBook(reversed([PROPS[i] for i in PROPS]))
    assert shuffled.to_canon() == PROPS.to_canon()
    assert PropBook.from_canon(PROPS.to_canon()).to_canon() == PROPS.to_canon()
    canon.dumps(PROPS.to_canon())  # all canonical types


def test_lineage_survives_a_cycle_in_bad_data():
    a = Prop.of("a", "broke", {"who": "li2", "what": "rail"}, parent="b", op="level")
    b = Prop.of("b", "broke", {"who": "li2", "what": "rail"}, parent="a", op="level")
    assert PropBook([a, b]).lineage("a") == ["a", "b"]


def test_groups_pair_up_different_props_in_one_group_only():
    assert GROUPS.together("li_broke", "he_broke")
    assert not GROUPS.together("li_broke", "li_broke")
    assert not GROUPS.together("li_broke", "li_at_bridge")
    assert GROUPS.check(PROPS) == []
    assert ExclusiveGroups.from_canon(GROUPS.to_canon()).groups == GROUPS.groups
    bad = ExclusiveGroups.from_canon([{"id": "g", "props": ["li_broke", "ghost"]}])
    assert bad.check(PROPS) == ["group g: unknown prop 'ghost'"]
    for raw in ([{"id": "g", "props": ["one"]}], [{"id": "g", "props": ["a", "a"]}]):
        with pytest.raises(ShapeError):
            ExclusiveGroups.from_canon(raw)


# ------------------------------------------------------------------ events and truth


def event(id, tick, *props):
    return Event(id, tick, tuple(props))


def test_event_round_trip_and_refusals():
    e = event("e1", -60, PROPS["he_under_bridge"])
    assert Event.from_canon(e.to_canon()) == e
    with pytest.raises(ShapeError):
        Event("e2", 0, ())
    with pytest.raises(ShapeError):
        event("e3", 0, PROPS["li_not_broke"])  # events state what happened, not what did not


def test_a_prop_is_true_when_an_event_makes_it_true():
    events = [event("e1", -60, PROPS["he_under_bridge"], PROPS["li_broke"])]
    assert is_true(PROPS["he_under_bridge"], events)
    assert is_true(PROPS["li_broke"], events)
    assert not is_true(PROPS["he_home"], events)  # another place
    assert not is_true(PROPS["he_broke"], events)  # another person
    assert not is_true(PROPS["he_home"], [])


def test_spans_and_motives_decide_what_an_event_makes_true():
    real = prop("real", "broke", {"who": "li2", "what": "rail"}, span=(0, 60), motive="accident")
    events = [event("e1", 30, real)]

    def claim(span, motive=None):
        return prop("c", "broke", {"who": "li2", "what": "rail"}, span=span, motive=motive)

    assert is_true(claim((10, 50)), events)  # inside the real span
    assert is_true(claim(None), events)  # no time stated: it happened at some time
    assert not is_true(claim((10, 90)), events)  # runs past the real span
    assert not is_true(claim((100, 120)), events)
    assert is_true(claim(None, "accident"), events)
    assert not is_true(claim(None, "revenge"), events)  # the wrong motive is a false claim
    always = event("e2", 0, prop("always", "owns", {"family": "fam_li", "thing": "boat"}))
    assert is_true(prop("c", "owns", {"family": "fam_li", "thing": "boat"}, span=(5, 9)), [always])


def test_a_negation_is_true_when_no_event_makes_the_thing_happen_in_its_span():
    events = [event("e1", 0, prop("r", "broke", {"who": "li2", "what": "rail"}, span=(0, 60)))]

    def denial(span):
        return prop("n", "broke", {"who": "li2", "what": "rail"}, span=span, neg=True)

    assert not is_true(denial(NIGHT), events)  # it did happen inside the night
    assert not is_true(denial(None), events)  # "never" is false
    assert is_true(denial((100, 200)), events)  # not then
    assert is_true(prop("n2", "broke", {"who": "he", "what": "rail"}, neg=True), events)
    assert is_true(PROPS["li_not_broke"], [])  # nothing happened, so he did not


def test_an_unstated_span_overlaps_nothing():
    assert spans_overlap((0, 5), (5, 9)) and not spans_overlap((0, 5), (6, 9))
    assert not spans_overlap(None, (0, 5)) and not spans_overlap(None, None)
    assert EVENING[1] < NIGHT[1]


def test_an_event_is_checked_prop_by_prop():
    good = event("e1", 0, PROPS["he_home"], PROPS["li_broke"])
    assert check_event(good, TABLES, REGISTRY) == []
    bad = event("e2", 0, PROPS["he_home"], prop("b", "at", {"who": "rail", "where": "market"}))
    found = check_event(bad, TABLES, REGISTRY)
    assert len(found) == 1 and found[0].startswith("e2: b: slot 'who' needs a person")


def test_groups_compare_by_content():
    assert ExclusiveGroups.from_canon(GROUPS.to_canon()) == GROUPS
    assert ExclusiveGroups() != GROUPS


def test_files_may_hold_a_bare_list_or_an_object_with_the_one_key():
    raw_entities = REGISTRY.to_canon()
    assert Registry.from_canon({"entities": raw_entities}) == REGISTRY
    assert PropBook.from_canon({"props": PROP_DICTS}).to_canon() == PROPS.to_canon()
    assert PropBook.loads(canon.dumps(PROP_DICTS)).to_canon() == PROPS.to_canon()
    assert ExclusiveGroups.loads(canon.dumps(GROUPS.to_canon())) == GROUPS
    thing = Registry.from_canon([{"id": "t", "type": "thing", "label": "t", "family": None}])
    assert thing.get("t").family is None
    with pytest.raises(ShapeError):
        Registry.from_canon({"entities": [], "extra": 1})
