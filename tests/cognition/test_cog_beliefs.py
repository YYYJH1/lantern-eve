"""Claims, beliefs and the store: shapes, order and canonical round trips."""

import pytest

from lantern_core import canon
from lantern_core.cognition._fields import ShapeError
from lantern_core.cognition.beliefs import (
    SELF_SEEN,
    UNKNOWN,
    Belief,
    BeliefError,
    BeliefStore,
    Claim,
    LieNote,
)


def claim(**kw):
    base = {
        "id": "c1",
        "speaker": "clerk",
        "listeners": ("zhou",),
        "prop": "r0_damaged",
        "modality": "assert",
        "claimed_source": SELF_SEEN,
        "tick": 40,
        "path": "belief",
    }
    base.update(kw)
    return Claim(**base)


def belief(**kw):
    base = {
        "holder": "zhou",
        "prop": "r1_broke",
        "modality": "assert",
        "confidence": 70,
        "source": "heard",
        "teller": "clerk",
        "claimed_source": SELF_SEEN,
        "hop": 1,
        "tick": 40,
        "claim": "c1",
    }
    base.update(kw)
    return Belief(**base)


def saw(holder="clerk", prop="r0_damaged", tick=10):
    return Belief(holder, prop, "assert", 95, "saw", None, None, 0, tick, None)


# ------------------------------------------------------------------ claims


def test_claim_round_trip_keeps_every_path_field():
    spec = claim(
        path="speculation",
        modality="speculate",
        rule_id="grudge_at_scene",
        premises=("li_at_bridge", "rail_located", "rail_broken"),
    )
    mut = claim(path="mutation", op="sharpen", listeners=("zhou", "wang"))
    lie = claim(path="lie", modality="lie", template_id="he_at_home")
    for c in (claim(), spec, mut, lie):
        assert Claim.from_canon(c.to_canon()) == c
        assert Claim.from_canon(canon.loads(canon.dumps(c.to_canon()))) == c
    assert mut.edges == (("clerk", "zhou"), ("clerk", "wang"))


@pytest.mark.parametrize(
    "bad",
    [
        {"listeners": ()},
        {"listeners": ("zhou", "zhou")},
        {"listeners": ("clerk",)},  # a speaker does not tell themselves
        {"modality": "shout"},
        {"path": "gossip"},
        {"claimed_source": ""},
        {"tick": 1.5},
        {"tick": True},
        {"premises": ["a"]},
    ],
)
def test_claim_refuses_a_malformed_value(bad):
    with pytest.raises(ShapeError):
        claim(**bad)


def test_claim_from_canon_refuses_missing_and_unknown_keys():
    raw = claim().to_canon()
    for broken in ({k: v for k, v in raw.items() if k != "op"}, {**raw, "mood": "sad"}):
        with pytest.raises(ShapeError):
            Claim.from_canon(broken)


# ------------------------------------------------------------------ beliefs


def test_belief_round_trip_and_honest_source():
    for b in (belief(), saw(), belief(source="inferred", teller=None, claimed_source=None, hop=0)):
        assert Belief.from_canon(b.to_canon()) == b
    assert saw().honest_source() == SELF_SEEN
    assert belief().honest_source() == "clerk"
    assert (
        belief(source="inferred", teller=None, claimed_source=None, hop=0).honest_source() == "zhou"
    )
    paper = belief(source="paper", teller=None, claimed_source=None, hop=0, claim=None)
    assert paper.honest_source() == UNKNOWN


@pytest.mark.parametrize(
    "bad",
    [
        {"confidence": 101},
        {"confidence": -1},
        {"confidence": 50.0},
        {"modality": "deny"},
        {"source": "dreamt"},
        {"hop": -1},
        {"teller": None},  # heard needs a teller
        {"claimed_source": None},
        {"hop": 0},  # heard is at least second-hand
        {"source": "saw"},  # saw has no teller
        {"source": "inferred"},  # nor has inferred
        {"source": "paper", "teller": None, "claimed_source": None, "hop": 0},  # paper has no claim
    ],
)
def test_belief_refuses_a_shape_its_source_does_not_allow(bad):
    with pytest.raises(ShapeError):
        belief(**bad)


def test_what_was_seen_is_first_hand_and_has_no_claim():
    with pytest.raises(ShapeError):
        Belief("clerk", "p", "assert", 90, "saw", None, None, 1, 0, None)
    with pytest.raises(ShapeError):
        Belief("clerk", "p", "assert", 90, "saw", None, None, 0, 0, "c9")


# ------------------------------------------------------------------ store


def test_store_iterates_in_prop_id_order_whatever_the_order_of_writing():
    ids = ["r2_nowhere", "li_broke", "r1_broke", "he_home"]
    a, b = BeliefStore("zhou"), BeliefStore("zhou")
    for pid in ids:
        a.put(belief(prop=pid))
    for pid in reversed(ids):
        b.put(belief(prop=pid))
    assert [x.prop for x in a] == sorted(ids)
    assert a == b
    assert canon.digest(a.to_canon()) == canon.digest(b.to_canon())


def test_put_replaces_the_belief_about_a_prop_and_refuses_another_holders():
    s = BeliefStore("zhou")
    s.put(belief(confidence=30))
    s.put(belief(confidence=80))
    assert len(s) == 1 and s.get("r1_broke").confidence == 80 and "r1_broke" in s
    assert s.get("nothing") is None
    with pytest.raises(BeliefError):
        s.put(belief(holder="wang"))


def test_store_records_lies_and_what_each_teller_told():
    s = BeliefStore("he")
    s.note_lie(LieNote("he_home", "zhou", "c7", 55))
    s.note_lie(LieNote("he_home", "wang", "c8", 60))
    assert [n.listener for n in s.lies] == ["zhou", "wang"]
    t = BeliefStore("zhou", [belief(prop="a"), belief(prop="b", teller="wang"), belief(prop="c")])
    assert [x.prop for x in t.heard_from("clerk")] == ["a", "c"]


def test_store_round_trip_through_canonical_json():
    s = BeliefStore("zhou", [belief(prop="b"), belief(prop="a", confidence=10)])
    s.note_lie(LieNote("a", "wang", "c3", 9))
    again = BeliefStore.from_canon(canon.loads(canon.dumps(s.to_canon())))
    assert again == s
    assert [b.prop for b in again] == ["a", "b"]
    with pytest.raises(ShapeError):
        BeliefStore.from_canon({"holder": "zhou", "beliefs": []})
