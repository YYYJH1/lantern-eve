"""A rumour told from person to person, with every hop authorized, then walked back."""

from cog_world import (
    GROUPS,
    PROPS,
    PUBLIC,
    REGISTRY,
    RULES,
    TABLES,
    TEMPLATES,
    has_grudge,
)

from lantern_core import canon
from lantern_core.cognition.beliefs import Belief, BeliefStore, Claim
from lantern_core.cognition.paths import (
    authorize,
    lie_notes,
    listener_belief,
    speaker_belief,
)
from lantern_core.cognition.provenance import walk_back
from lantern_core.cognition.relations import (
    EXCLUSIVE,
    NO_SUPPORT,
    SOURCE_MISMATCH,
    UNCONFIRMED,
    marks,
)


class Town:
    """The stores and the claim log of a few people, written to the way the core will."""

    def __init__(self, *people):
        self.stores = {p: BeliefStore(p) for p in people}
        self.claims = {}

    def sees(self, who, prop, tick):
        self.stores[who].put(Belief(who, prop, "assert", 95, "saw", None, None, 0, tick, None))

    def tell(self, speaker, listeners, prop, path, modality, claimed, tick, **extra):
        claim = Claim(
            f"c{len(self.claims) + 1}",
            speaker,
            tuple(listeners),
            prop,
            modality,
            claimed,
            tick,
            path,
            **extra,
        )
        ok, reason = authorize(
            claim,
            self.stores[speaker],
            PROPS,
            tables=TABLES,
            registry=REGISTRY,
            rules=RULES,
            templates=TEMPLATES,
            suspicion=99,
            relation=has_grudge,
            public=PUBLIC,
        )
        assert ok, reason
        mine = speaker_belief(claim, self.stores[speaker], PROPS, public=PUBLIC)
        heard = [
            listener_belief(claim, who, self.stores[speaker], PROPS, confidence=60)
            for who in listeners
        ]
        if mine is not None:
            self.stores[speaker].put(mine)
        for note in lie_notes(claim):
            self.stores[speaker].note_lie(note)
        for belief in heard:
            self.stores[belief.holder].put(belief)
        self.claims[claim.id] = claim
        return claim

    def walk(self, holder, prop):
        return walk_back(holder, prop, self.stores, self.claims, PROPS)


def rumour():
    """The clerk saw the rail damaged. Each retelling changes it: sharpen, fill, assimilate."""
    town = Town("clerk", "zhou", "wang", "liu")
    town.sees("clerk", "r0_damaged", tick=10)
    town.tell("clerk", ["zhou"], "r1_broke", "mutation", "assert", "self_seen", 100, op="sharpen")
    town.tell("zhou", ["wang"], "r2_revenge", "mutation", "assert", "clerk", 200, op="fill")
    town.tell("wang", ["liu"], "r3_li3", "mutation", "assert", "zhou", 300, op="assimilate")
    return town


def test_a_three_hop_mutated_rumour_walks_back_to_the_witness():
    town = rumour()
    trace = town.walk("liu", "r3_li3")
    assert trace.end == "saw" and trace.origin == "clerk"
    assert [(h.holder, h.belief.prop, h.belief.hop) for h in trace.hops] == [
        ("liu", "r3_li3", 3),
        ("wang", "r2_revenge", 2),
        ("zhou", "r1_broke", 1),
        ("clerk", "r0_damaged", 0),
    ]
    assert [h.belief.teller for h in trace.hops] == ["wang", "zhou", "clerk", None]
    assert [h.claim.id if h.claim else None for h in trace.hops] == ["c3", "c2", "c1", None]
    # the props are a tree the same walk climbs, one operator per hop
    assert [m[1:] for m in trace.mutations] == [
        ("wang", "assimilate"),
        ("zhou", "fill"),
        ("clerk", "sharpen"),
    ]
    assert PROPS.lineage("r3_li3") == [h.belief.prop for h in trace.hops]
    changed = trace.first_change()
    assert changed.claim.speaker == "clerk" and changed.claim.op == "sharpen"


def test_the_marks_on_the_last_hearers_entry_show_how_far_it_has_drifted():
    town = rumour()
    liu = town.stores["liu"]
    trace = town.walk("liu", "r3_li3")
    got = marks(liu.get("r3_li3"), liu, PROPS, GROUPS, TABLES, town.claims.values(), trace)
    # nobody saw this prop, though the chain reaches a witness of its great-grandparent, and
    # zhou is on record as having told wang something else than what wang passed on to liu
    assert got == (NO_SUPPORT, SOURCE_MISMATCH, UNCONFIRMED)
    assert EXCLUSIVE not in got
    # the witness's own entry has all the support there is
    clerk = town.stores["clerk"]
    assert marks(clerk.get("r0_damaged"), clerk, PROPS, GROUPS, TABLES, town.claims.values()) == ()


def test_an_unchanged_rumour_ends_at_the_witness_and_counts_as_confirmed_in_the_chain():
    town = Town("clerk", "zhou", "wang")
    town.sees("clerk", "r0_damaged", 10)
    town.tell("clerk", ["zhou"], "r0_damaged", "belief", "assert", "self_seen", 100)
    town.tell("zhou", ["wang"], "r0_damaged", "belief", "assert", "clerk", 200)
    trace = town.walk("wang", "r0_damaged")
    assert (trace.end, trace.origin, len(trace.hops)) == ("saw", "clerk", 3)
    assert trace.mutations == () and trace.first_change() is None
    wang = town.stores["wang"]
    got = marks(wang.get("r0_damaged"), wang, PROPS, GROUPS, TABLES, town.claims.values(), trace)
    assert got == (NO_SUPPORT,)  # wang saw nothing himself, but the chain has a witness


def test_hiding_the_source_does_not_hide_the_chain_from_the_core():
    town = Town("clerk", "zhou", "wang")
    town.sees("clerk", "r0_damaged", 10)
    town.tell("clerk", ["zhou"], "r0_damaged", "belief", "assert", "self_seen", 100)
    town.tell("zhou", ["wang"], "r0_damaged", "belief", "assert", "unknown", 200)
    wang = town.stores["wang"].get("r0_damaged")
    assert (wang.teller, wang.claimed_source) == ("zhou", "unknown")  # wang knows who told him
    assert town.walk("wang", "r0_damaged").origin == "clerk"  # and the real chain goes on


def test_a_changed_prop_the_speaker_now_holds_is_walked_through_to_its_parent():
    town = rumour()
    trace = town.walk("zhou", "r2_revenge")  # zhou's own record of what he changed and told
    assert [(h.holder, h.belief.prop) for h in trace.hops] == [
        ("zhou", "r2_revenge"),
        ("zhou", "r1_broke"),
        ("clerk", "r0_damaged"),
    ]
    assert trace.end == "saw"


def test_the_walk_ends_at_a_guess_a_lie_or_a_gap():
    town = Town("wang", "zhou", "he", "clerk")
    town.sees("wang", "li_at_bridge", 10)
    town.tell(
        "wang",
        ["zhou"],
        "li_broke",
        "speculation",
        "speculate",
        "wang",
        100,
        rule_id="grudge_at_scene",
        premises=("li_at_bridge", "rail_located", "rail_broken"),
    )
    guess = town.walk("zhou", "li_broke")
    assert (guess.end, guess.origin) == ("inferred", "wang")
    assert town.stores["zhou"].get("li_broke").modality == "speculate"

    town.tell("he", ["clerk"], "he_home", "lie", "lie", "self_seen", 120, template_id="he_at_home")
    told = town.walk("clerk", "he_home")
    assert (told.end, told.origin) == ("lie", "he")
    assert [(n.prop, n.listener) for n in town.stores["he"].lies] == [("he_home", "clerk")]

    assert town.walk("nobody", "he_home").end == "broken"
    del town.claims["c1"]
    assert town.walk("zhou", "li_broke").end == "broken"


def test_the_whole_state_is_canonical_and_does_not_depend_on_the_order_of_writing():
    town = rumour()
    state = {
        "stores": [town.stores[p].to_canon() for p in sorted(town.stores)],
        "claims": [town.claims[c].to_canon() for c in sorted(town.claims)],
        "props": PROPS.to_canon(),
    }
    again = {
        "stores": [
            BeliefStore.from_canon(canon.loads(canon.dumps(s))).to_canon() for s in state["stores"]
        ],
        "claims": [Claim.from_canon(c).to_canon() for c in state["claims"]],
        "props": state["props"],
    }
    assert canon.digest(again) == canon.digest(state)
