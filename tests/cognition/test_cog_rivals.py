"""The rival accounts a person keeps in mind: kept, bounded, and what they cost the belief they were
set against (its firmness)."""

import pytest

from lantern_core import canon
from lantern_core.cognition._fields import ShapeError
from lantern_core.cognition.beliefs import (
    RIVAL_DENT,
    RIVAL_DENT_CAP,
    RIVALS_MAX,
    Belief,
    BeliefStore,
    Rival,
)


def heard(prop="a", confidence=70, teller="clerk", holder="zhou"):
    return Belief(holder, prop, "assert", confidence, "heard", teller, teller, 1, 40, "c1")


def rival(prop="b", against="a", teller="madam", tick=50, claim="c2"):
    return Rival(prop, against, teller, tick, claim)


# ------------------------------------------------------------------ the shape


def test_a_rival_round_trips_through_canonical_json():
    for one in (rival(), rival(claim=None)):
        assert Rival.from_canon(one.to_canon()) == one
        assert Rival.from_canon(canon.loads(canon.dumps(one.to_canon()))) == one


@pytest.mark.parametrize(
    "bad",
    [
        {"prop": ""},
        {"against": ""},
        {"teller": ""},
        {"tick": True},
        {"tick": "5"},
        {"claim": ""},
        {"against": "b"},  # an account is not its own rival
    ],
)
def test_a_rival_that_is_not_well_formed_is_refused(bad):
    fields = {"prop": "b", "against": "a", "teller": "madam", "tick": 50, "claim": "c2", **bad}
    with pytest.raises(ShapeError):
        Rival(**fields)


def test_a_rival_document_with_a_key_missing_or_added_is_refused():
    doc = rival().to_canon()
    for key in doc:
        with pytest.raises(ShapeError):
            Rival.from_canon({k: v for k, v in doc.items() if k != key})
    with pytest.raises(ShapeError):
        Rival.from_canon({**doc, "extra": 1})


# ------------------------------------------------------------------ the memory


def test_a_store_remembers_rivals_in_the_order_it_was_told_them():
    store = BeliefStore("zhou", [heard()])
    assert store.rivals == ()
    store.note_rival(rival("b", tick=50))
    store.note_rival(rival("c", tick=60, teller="clerk"))
    assert [r.prop for r in store.rivals] == ["b", "c"]


def test_the_same_account_is_kept_once_and_as_the_newest():
    store = BeliefStore("zhou", [heard()])
    store.note_rival(rival("b", tick=50))
    store.note_rival(rival("c", tick=60))
    store.note_rival(rival("b", tick=70, teller="clerk"))
    assert [(r.prop, r.teller, r.tick) for r in store.rivals] == [
        ("c", "madam", 60),
        ("b", "clerk", 70),
    ]


def test_the_memory_is_short_and_the_oldest_go_first():
    store = BeliefStore("zhou", [heard()])
    for n in range(RIVALS_MAX + 3):
        store.note_rival(rival(f"b{n}", tick=50 + n))
    assert len(store.rivals) == RIVALS_MAX
    assert [r.prop for r in store.rivals] == [f"b{n}" for n in range(3, RIVALS_MAX + 3)]


def test_rivals_are_found_by_the_belief_they_are_held_against():
    store = BeliefStore("zhou", [heard("a"), heard("x")])
    store.note_rival(rival("b", against="a"))
    store.note_rival(rival("c", against="x"))
    store.note_rival(rival("d", against="a"))
    assert [r.prop for r in store.rivals_against("a")] == ["b", "d"]
    assert [r.prop for r in store.rivals_against("x")] == ["c"]
    assert store.rivals_against("nothing") == ()


def test_rivals_are_forgotten_by_account_or_by_the_belief_they_were_against():
    store = BeliefStore("zhou", [heard("a"), heard("x")])
    for one in (rival("b", against="a"), rival("c", against="x"), rival("d", against="a")):
        store.note_rival(one)
    store.forget_rivals(prop="b")
    assert [r.prop for r in store.rivals] == ["c", "d"]
    store.forget_rivals(against="a")
    assert [r.prop for r in store.rivals] == ["c"]
    store.forget_rivals()  # no criterion: nothing is forgotten
    assert [r.prop for r in store.rivals] == ["c"]


# ------------------------------------------------------------------ firmness


def test_a_belief_with_no_rival_is_as_firm_as_it_is_confident():
    store = BeliefStore("zhou", [heard("a", 70)])
    assert store.firmness("a") == 70
    assert store.firmness("nothing") == 0  # what is not held is not held at all


def test_each_rival_costs_the_belief_a_little_firmness():
    store = BeliefStore("zhou", [heard("a", 70)])
    store.note_rival(rival("b"))
    assert store.firmness("a") == 70 - RIVAL_DENT
    store.note_rival(rival("c"))
    assert store.firmness("a") == 70 - 2 * RIVAL_DENT


def test_the_cost_has_a_cap_however_many_rivals_there_are():
    store = BeliefStore("zhou", [heard("a", 70)])
    for n in range(RIVALS_MAX):
        store.note_rival(rival(f"b{n}"))
    assert RIVAL_DENT * RIVALS_MAX > RIVAL_DENT_CAP  # the cap is not just the memory's size
    assert store.firmness("a") == 70 - RIVAL_DENT_CAP


def test_a_rival_against_another_belief_costs_nothing_here():
    store = BeliefStore("zhou", [heard("a", 70), heard("x", 70)])
    store.note_rival(rival("b", against="x"))
    assert store.firmness("a") == 70 and store.firmness("x") == 70 - RIVAL_DENT


def test_firmness_never_goes_below_nothing():
    store = BeliefStore("zhou", [heard("a", 5)])
    for n in range(3):
        store.note_rival(rival(f"b{n}"))
    assert store.firmness("a") == 0


def test_firmness_is_worked_out_and_the_belief_is_left_as_it_was():
    store = BeliefStore("zhou", [heard("a", 70)])
    store.note_rival(rival("b"))
    assert store.get("a").confidence == 70  # nothing was written to it


# ------------------------------------------------------------------ the store as a document


def test_a_store_without_rivals_is_the_document_it_always_was():
    store = BeliefStore("zhou", [heard("a")])
    assert set(store.to_canon()) == {"holder", "beliefs", "lies"}
    assert BeliefStore.from_canon(store.to_canon()) == store


def test_a_store_with_rivals_carries_them_through_a_round_trip():
    store = BeliefStore("zhou", [heard("a")])
    store.note_rival(rival("b"))
    store.note_rival(rival("c", teller="clerk"))
    doc = store.to_canon()
    assert [r["prop"] for r in doc["rivals"]] == ["b", "c"]
    again = BeliefStore.from_canon(canon.loads(canon.dumps(doc)))
    assert again == store and again.rivals == store.rivals
    assert again.firmness("a") == store.firmness("a")


def test_stores_with_other_rivals_are_not_equal():
    one, other = BeliefStore("zhou", [heard("a")]), BeliefStore("zhou", [heard("a")])
    assert one == other
    one.note_rival(rival("b"))
    assert one != other
    other.note_rival(rival("b"))
    assert one == other


def test_a_store_made_with_rivals_keeps_them_bounded_and_in_order():
    rivals = [rival(f"b{n}", tick=n) for n in range(RIVALS_MAX + 2)]
    store = BeliefStore("zhou", [heard("a")], rivals=rivals)
    assert [r.prop for r in store.rivals] == [f"b{n}" for n in range(2, RIVALS_MAX + 2)]
