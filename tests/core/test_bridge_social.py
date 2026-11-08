"""The talk between neighbours in the bridge town, played over the three variants of the script.

The first part is the start of a game: which variant is true, who knows what, how people stand
toward each other. The second is who speaks and what they say, the third how a story changes on
its way, and the fourth what the checker did with it. The last is what the client sees and how
the street joins in. A game of five days is played once per seed and shared (``social_helpers``).
"""

from __future__ import annotations

import copy
import dataclasses
import inspect
import json
import re
from collections import Counter

import pytest
from bridge_helpers import CAST, CYCLE, TOWN, bridge, state_of, step
from social_helpers import LORE, VARIANTS, played, seeds_of, told, variant_of
from voice_helpers import claim_wordings

from lantern_core.api import Game
from lantern_core.cognition import paths
from lantern_core.cognition.beliefs import Belief, BeliefStore, Claim
from lantern_core.cognition.props import Prop, check_prop, lineage, mutation_problem
from lantern_core.cognition.provenance import walk_back
from lantern_core.kernel import Ctx
from lantern_core.world.bridge import bonds, crowd, gossip, notes, retell, social, telling
from lantern_core.world.bridge.sim import Sim

PEOPLE = LORE.people
BOOK = LORE.book


def who_holds(stores, prop_id):
    return sorted(holder for holder, store in stores.items() if prop_id in store)


# ------------------------------------------------------------------------------ the start


def test_the_true_variant_is_drawn_from_the_seed_and_kept_in_the_section():
    assert {variant_of(seed) for seed in range(40)} == set(VARIANTS)
    assert variant_of(7) == variant_of(7)
    section = state_of(bridge(7))["social"]
    assert section["variant"] in VARIANTS and section["variant"] in LORE.variants
    assert set(section) == {
        "variant", "bonds", "beliefs", "props", "claims", "seq",
        "next", "busy", "talks", "bubbles", "counts", "refusals",
    }  # fmt: skip
    assert section["seq"] == 1 and section["claims"] == {} and section["props"] == {}


def test_everyone_starts_with_the_public_facts_the_town_knows():
    assert LORE.public == ("pr_flooded", "pr_he_owns_boat", "pr_rail_broken", "pr_rail_located")
    section = state_of(bridge(1))["social"]
    stores = social.stores(section)
    for holder in PEOPLE:
        for prop_id in LORE.public:
            belief = stores[holder].get(prop_id)
            assert belief is not None and belief.modality == "assert"
            assert belief.hop == 0 and belief.tick == 0 and belief.claim is None
    # the headline is read in the paper, the lie of the land is known by sight
    assert {stores[p].get("pr_rail_broken").source for p in PEOPLE} == {"paper"}
    assert {stores[p].get("pr_rail_located").source for p in PEOPLE} == {"saw"}
    assert {stores[p].get("pr_rail_broken").confidence for p in PEOPLE} == {95}


@pytest.mark.parametrize("variant", VARIANTS)
def test_what_each_person_saw_the_night_before_is_true_in_the_variant(variant):
    section = state_of(bridge(seeds_of(variant)[0]))["social"]
    assert section["variant"] == variant
    stores = social.stores(section)
    for holder, store in stores.items():
        for belief in store:
            assert belief.source in ("saw", "paper") and belief.hop == 0 and belief.tick == 0
            assert BOOK.holds(variant, belief.prop), (holder, belief.prop)
    # the cover story is a sighting in every variant: Li Er looked for his lantern at the
    # bridge, and the Zhou clerk saw him
    for holder in ("li_er", "zhou_huoji"):
        assert {"pr_liner_looking", "pr_liner_at_bridge"} <= {b.prop for b in stores[holder]}
    assert who_holds(stores, "pr_liner_looking") == ["li_er", "zhou_huoji"]


def test_the_opening_of_the_boat_variant_is_the_one_in_the_design():
    stores = social.stores(state_of(bridge(seeds_of("v_boat")[0]))["social"])
    # the boatman did it and hides it, and only the child who fishes at night saw (and the
    # watchman saw a boatman's shadow under the bridge)
    assert who_holds(stores, "pr_boat_damaged") == ["old_he", "xiao_man"]
    assert who_holds(stores, "pr_he_under_bridge") == ["gengfu", "old_he", "xiao_man"]
    assert who_holds(stores, "pr_flood_damaged") == []
    assert who_holds(stores, "pr_dalang_damaged") == []
    assert stores["old_he"].get("pr_boat_scratched").source == "saw"
    assert stores["xiao_man"].get("pr_boat_damaged").confidence == 90


def test_the_opening_of_the_other_two_variants_has_other_eyewitnesses():
    flood = social.stores(state_of(bridge(seeds_of("v_flood")[0]))["social"])
    assert who_holds(flood, "pr_flood_damaged") == ["gengfu"]
    assert who_holds(flood, "pr_boat_damaged") == [] and who_holds(flood, "pr_he_home")
    drunk = social.stores(state_of(bridge(seeds_of("v_drunk")[0]))["social"])
    assert who_holds(drunk, "pr_dalang_damaged") == ["zhou_dalang"]
    assert who_holds(drunk, "pr_dalang_at_bridge") == ["gengfu", "zhou_dalang"]
    assert who_holds(drunk, "pr_boat_damaged") == []


# ------------------------------------------------------------------------------ the relations


def test_every_ordered_pair_has_four_bounded_ints():
    section = state_of(bridge(3))["social"]
    assert sorted(section["bonds"]) == sorted(PEOPLE)
    for a in PEOPLE:
        row = section["bonds"][a]
        assert len(row) == 4 * len(PEOPLE) and all(type(v) is int for v in row)
        for b in PEOPLE:
            values = [bonds.value(section, LORE, a, b, kind) for kind in range(4)]
            if a == b:
                assert values == [0, 0, 0, 0]
                continue
            for value, (low, high) in zip(values, bonds.BOUNDS, strict=True):
                assert low <= value <= high, (a, b, values)


def test_relations_start_from_families_and_traits_and_are_not_symmetric():
    sections = [state_of(bridge(seed))["social"] for seed in range(8)]
    for section in sections:

        def get(a, b, kind, section=section):
            return bonds.value(section, LORE, a, b, kind)

        # a family likes and trusts its own, and is cold toward the other
        assert get("li_da", "li_er", bonds.AFFINITY) > get("li_da", "zhou_dalang", bonds.AFFINITY)
        assert get("li_da", "li_er", bonds.TRUST) > get("li_da", "zhou_dalang", bonds.TRUST)
        assert get("li_da", "li_er", bonds.GRUDGE) < get("li_da", "zhou_dalang", bonds.GRUDGE)
        # the shopkeeper holds a grudge against the Li family, which is what his guess rests on
        assert get("zhou_zhanggui", "li_er", bonds.GRUDGE) >= bonds.GRUDGE_ENOUGH
        assert get("li_laotai", "zhou_zhanggui", bonds.GRUDGE) >= bonds.GRUDGE_ENOUGH - 6
        # the two who are secretly fond of each other hold no grudge
        assert get("li_xiaomei", "zhou_erlang", bonds.GRUDGE) < 5
        assert get("zhou_erlang", "li_xiaomei", bonds.AFFINITY) > 30
        # the gatekeepers are trusted: more than the average person is
        mean = sum(get(a, "mujiang", bonds.TRUST) for a in PEOPLE if a != "mujiang") // 19
        assert get("li_er", "zuzhang", bonds.TRUST) > mean - 10
    assert any(
        bonds.value(s, LORE, a, b, k) != bonds.value(s, LORE, b, a, k)
        for s in sections
        for a in PEOPLE
        for b in PEOPLE
        for k in range(4)
    )


def test_two_seeds_do_not_have_the_same_town():
    rows = [state_of(bridge(seed))["social"]["bonds"] for seed in (1, 2, 3)]
    assert rows[0] != rows[1] != rows[2] != rows[0]
    # and the same seed has the same one
    assert rows[0] == state_of(bridge(1))["social"]["bonds"]


def test_relations_stay_in_bounds_and_change_only_between_those_who_spoke():
    run = played(seeds_of("v_drunk")[0])
    start = state_of(bridge(run.seed))["social"]
    now = run.section
    spoke = {(e["speaker"], e["listener"]) for e in told(run)}
    spoke |= {(b, a) for a, b in spoke}
    changed = 0
    for a in PEOPLE:
        for b in PEOPLE:
            for kind, (low, high) in enumerate(bonds.BOUNDS):
                after = bonds.value(now, LORE, a, b, kind)
                assert low <= after <= high
                if after != bonds.value(start, LORE, a, b, kind):
                    changed += 1
                    assert (a, b) in spoke, (a, b, kind)
    assert changed > 20


# ------------------------------------------------------------------------------ the notes


def test_a_note_reads_back_into_the_belief_claim_or_prop_it_was_made_from():
    run = played(seeds_of("v_boat")[1])
    section = run.section
    count = 0
    for holder, held in section["beliefs"].items():
        for prop_id, note in held.items():
            belief = notes.decode_belief(holder, prop_id, note)
            assert notes.encode_belief(belief) == note
            assert Belief.from_canon(belief.to_canon()) == belief  # and it is a legal belief
            assert notes.confidence_of(note) == belief.confidence
            count += 1
    for claim_id, note in section["claims"].items():
        claim = notes.decode_claim(claim_id, note)
        assert notes.encode_claim(claim) == note and claim.id == claim_id
        assert Claim.from_canon(claim.to_canon()) == claim
        count += 1
    for prop_id, note in section["props"].items():
        prop = notes.decode_prop(prop_id, note)
        assert notes.encode_prop(prop) == note and prop.id == prop_id
        assert Prop.from_canon(prop.to_canon()) == prop
        count += 1
    assert count > 200
    # a prop of the script, with every field the note has, reads back too
    for prop in BOOK.props.values():
        assert notes.decode_prop(prop.id, notes.encode_prop(prop)) == prop


def test_the_notes_and_the_stores_made_from_them_are_the_same_in_order_and_content():
    run = played(seeds_of("v_flood")[1])
    section = run.section
    assert list(run.claims()) == sorted(section["claims"], key=lambda c: int(c[1:]))
    for holder, store in run.stores().items():
        assert [b.prop for b in store] == sorted(section["beliefs"][holder])
        assert BeliefStore.from_canon(store.to_canon()) == store
    book = run.book()
    assert list(book) == sorted({*BOOK.props, *section["props"]})
    assert len(book) == len(BOOK.props) + len(section["props"])
    assert "no_such_prop" not in book and book.get("no_such_prop") is None


# ------------------------------------------------------------------------------ who speaks


def stand_apart(me, you):
    """Whether two people are neither on neighbouring cells nor together at an indoor place."""
    close = max(abs(me["x"] - you["x"]), abs(me["y"] - you["y"])) <= gossip.NEAR
    room = (
        TOWN.places[me["place"]].indoor
        and me["place"] == you["place"]
        and gossip.at_goal(me)
        and gossip.at_goal(you)
    )
    return not (close or room)


def test_only_neighbours_talk_and_nobody_asleep():
    seen = 0
    for variant in VARIANTS:
        run = played(seeds_of(variant)[0])
        for event in told(run):
            where = run.told_at[event["claim"]]
            assert not stand_apart(where["speaker"], where["listener"]), event
            assert not gossip.asleep(where["speaker"]) and not gossip.asleep(where["listener"])
            assert event["speaker"] != event["listener"]
            seen += 1
    assert seen > 150


def test_people_take_their_turn_one_tick_in_four_and_rest_between_tellings():
    run = played(seeds_of("v_boat")[0])
    last: dict[str, int] = {}
    # a call that a person made on an errand (the night's thinking over) is no idle talk: it keeps
    # the turn and does not wait for the rest
    calls = {
        (e["tick"], e["npc"], e["to"])
        for e in run.events
        if e["kind"] == "errand" and e["errand"] == "tell" and e["state"] == "done"
    }
    for event in told(run):
        speaker = event["speaker"]
        assert (event["tick"] + CAST.index[speaker]) % gossip.STRIDE == 0
        if speaker in last and (event["tick"], speaker, event["listener"]) not in calls:
            assert event["tick"] - last[speaker] >= gossip.cooldown(LORE, speaker), event
        last[speaker] = event["tick"]
    assert len(last) >= 15  # most of the town speaks in five days


def test_nobody_is_in_two_tellings_at_once():
    run = played(seeds_of("v_flood")[0])
    for _, _, dots in run.shown:
        ends = [end for dot in dots for end in (dot["from"], dot["to"])]
        assert len(ends) == len(set(ends)), dots


def test_those_who_gossip_more_speak_more():
    tally = {name: 0 for name in PEOPLE}
    for variant in VARIANTS:
        for seed in seeds_of(variant)[:2]:
            for event in told(played(seed)):
                tally[event["speaker"]] += 1
    assert tally["cha_laoban"] > 2 * tally["zhangfang"]
    assert tally["cha_laoban"] > tally["zuzhang"] and tally["zhou_huoji"] > tally["miaozhu"]
    assert sum(1 for n in tally.values() if n > 0) >= 17  # nearly everyone speaks in five days


# ------------------------------------------------------------------------------ what is said


def fresh(variant):
    game = bridge(seeds_of(variant)[0])
    section = state_of(game)["social"]
    return section, social.book(section)


def sort_by_salience(section, view, speaker, listener, tick=0):
    """Brute force: what the speaker could tell, best first, by the definition of salience."""
    held = section["beliefs"][listener]
    out = []
    for prop_id, note in section["beliefs"][speaker].items():
        belief = notes.decode_belief(speaker, prop_id, note)
        if prop_id in held or belief.confidence < gossip.MIN_CONFIDENCE:
            continue
        if belief.source == "saw" and LORE.guards(speaker, view[prop_id]):
            continue
        knows = lineage(prop_id, view)[-1] in {lineage(p, view)[-1] for p in held}
        score = gossip.salience(LORE, section, belief, view[prop_id], listener, tick, knows)
        if score >= gossip.MIN_SALIENCE:
            out.append((-score, prop_id))
    return [prop_id for _, prop_id in sorted(out)]


def test_what_is_told_is_the_belief_with_the_highest_salience_for_that_listener():
    section, view = fresh("v_boat")
    for speaker, listener in (
        ("zhou_huoji", "zhou_zhanggui"),
        ("li_er", "li_da"),
        ("old_he", "cha_laoban"),
        ("xiao_man", "mujiang"),
        ("gengfu", "zhou_dalang"),
    ):
        ranked = sort_by_salience(section, view, speaker, listener)
        best = gossip.best_belief(LORE, section, view, speaker, listener, 0)
        assert best == (ranked[0] if ranked else None), (speaker, listener, ranked)
    # the clerk tells the shopkeeper what he saw of Li Er, and nothing the whole town knows
    ranked = sort_by_salience(section, view, "zhou_huoji", "zhou_zhanggui")
    assert set(ranked) == {"pr_liner_looking", "pr_liner_at_bridge", "pr_dalang_at_home"}
    assert not set(ranked) & set(LORE.public)


def test_salience_is_importance_freshness_relevance_and_trust():
    section, view = fresh("v_boat")
    accuse = view["pr_liner_damaged"]
    stood = view["pr_liner_at_bridge"]
    assert gossip.importance(LORE, accuse) == 100 > gossip.importance(LORE, stood) == 70
    assert gossip.importance(LORE, view["pr_dalang_at_home"]) == 30  # nothing to do with the bridge
    assert gossip.importance(LORE, view["pr_li_damaged_jealous"]) == 100  # a motive, and the bridge
    assert gossip.freshness(0) == 100 and gossip.freshness(-5) == 100
    assert gossip.freshness(2 * CYCLE) < gossip.freshness(CYCLE) < 100
    assert gossip.freshness(10 * CYCLE) == 10
    # news that is about the listener's own is more to the listener than other news
    kin = gossip.relevance(LORE, "li_da", stood, False)
    other = gossip.relevance(LORE, "zhou_zhanggui", stood, False)
    assert kin == 80 > other == 40
    assert gossip.relevance(LORE, "li_da", stood, True) == kin // gossip.KNOWN_STORY
    belief = notes.decode_belief("zhou_huoji", "pr_liner_at_bridge", "assert|90|saw|||0|0|")
    base = gossip.salience(LORE, section, belief, stood, "zhou_zhanggui", 0, False)
    trust = bonds.value(section, LORE, "zhou_huoji", "zhou_zhanggui", bonds.TRUST)
    assert base == 70 * 100 * 40 * min(100, trust + 20) // 100_000
    later = gossip.salience(LORE, section, belief, stood, "zhou_zhanggui", 2 * CYCLE, False)
    assert later < base
    bonds.nudge(section, LORE, "zhou_huoji", "zhou_zhanggui", bonds.TRUST, 10)
    assert gossip.salience(LORE, section, belief, stood, "zhou_zhanggui", 0, False) >= base


def test_nothing_is_told_that_is_held_doubted_heard_from_the_listener_or_guarded():
    section, view = fresh("v_boat")
    best = gossip.best_belief(LORE, section, view, "zhou_huoji", "zhou_zhanggui", 0)
    assert best in ("pr_liner_looking", "pr_liner_at_bridge")
    # held by the listener already
    notes_of = section["beliefs"]["zhou_zhanggui"]
    notes_of[best] = "assert|50|heard|nobody|nobody|1|0|c0"
    second = gossip.best_belief(LORE, section, view, "zhou_huoji", "zhou_zhanggui", 0)
    assert second != best and second is not None
    # the listener told it to the speaker
    mine = section["beliefs"]["zhou_huoji"]
    mine["pr_gossip_x"] = "assert|50|heard|zhou_zhanggui|zhou_zhanggui|1|0|c0"
    assert gossip.best_belief(LORE, section, view, "zhou_huoji", "zhou_zhanggui", 0) == second
    # too little believed, too little worth, too old
    for prop_id in list(mine):
        mine[prop_id] = notes.with_confidence(mine[prop_id], gossip.MIN_CONFIDENCE - 1)
    assert gossip.best_belief(LORE, section, view, "zhou_huoji", "zhou_zhanggui", 0) is None


def test_a_guarded_secret_is_never_told_whatever_its_salience():
    section, view = fresh("v_boat")
    mine = section["beliefs"]["old_he"]
    assert "pr_boat_damaged" in mine and "pr_he_under_bridge" in mine
    for prop_id in list(mine):  # leave only the secrets and what everyone knows
        if prop_id not in ("pr_boat_damaged", "pr_he_under_bridge") and prop_id not in LORE.public:
            del mine[prop_id]
    assert LORE.guards("old_he", view["pr_boat_damaged"])
    assert LORE.guards("old_he", view["pr_he_under_bridge"])
    for listener in PEOPLE:
        if listener != "old_he":
            assert gossip.best_belief(LORE, section, view, "old_he", listener, 0) is None
    # what he pretends not to know of he does not talk about at all, however he heard it
    mine["pr_liner_damaged"] = "assert|60|heard|zhou_zhanggui|zhou_zhanggui|2|0|c0"
    assert gossip.best_belief(LORE, section, view, "old_he", "cha_laoban", 0) is None
    # but what has nothing to do with it he passes on, heard or seen
    mine["pr_liner_at_bridge"] = "assert|60|heard|zhou_huoji|zhou_huoji|1|0|c0"
    assert (
        gossip.best_belief(LORE, section, view, "old_he", "cha_laoban", 0) == "pr_liner_at_bridge"
    )


@pytest.mark.parametrize(
    ("variant", "speaker", "secrets"),
    [
        ("v_boat", "old_he", {"pr_boat_damaged", "pr_he_under_bridge"}),
        ("v_drunk", "zhou_dalang", {"pr_dalang_at_bridge", "pr_dalang_damaged", "pr_dalang_drank"}),
        ("v_drunk", "li_er", {"pr_liner_at_bridge"}),
    ],
)
def test_the_secrets_of_the_guilty_and_the_ashamed_stay_with_them_in_a_whole_game(
    variant, speaker, secrets
):
    said = 0
    for seed in seeds_of(variant):
        run = played(seed)
        view = run.book()
        for claim in run.claims().values():
            if claim.speaker != speaker:
                continue
            said += 1
            prop = view[claim.prop]
            assert claim.prop not in secrets and prop.parent not in secrets, claim
            if claim.path == "mutation":  # and nobody gives a secret away by changing it
                assert not LORE.guards(speaker, prop), claim
    assert said >= 3


def test_nobody_volunteers_a_rumour_that_names_them_as_the_one_who_did_it():
    for variant in VARIANTS:
        run = played(seeds_of(variant)[0])
        book = run.book()
        for claim in run.claims().values():
            prop = book[claim.prop]
            assert not (prop.pred == "damaged" and prop.arg("who") == claim.speaker), claim


# ------------------------------------------------------------------------------ how a story changes


def hold(holder, prop_id, source="saw", modality="assert", confidence=90, teller=None, hop=0):
    if source == "heard":
        hop = hop or 1
        return Belief(holder, prop_id, modality, confidence, source, teller, teller, hop, 0, "c0")
    return Belief(holder, prop_id, modality, confidence, source, None, None, hop, 0, None)


def changes_for(holder, prop_id, extra=(), grudge=True, suspicion=None, **belief):
    """What each operator makes of ``prop_id`` for ``holder``, settled, by operator."""
    book = notes.PropView({p.id: p for p in extra}, BOOK.props)
    mine = hold(holder, prop_id, **belief)
    store = BeliefStore(holder, [mine, *(hold(holder, pid, "paper") for pid in LORE.public)])
    suspicion = LORE.traits[holder]["suspicion"] if suspicion is None else suspicion
    found = retell.changes(
        LORE,
        book,
        book[prop_id],
        mine,
        store,
        suspicion=suspicion,
        relation=lambda kind, who, target: grudge,
    )
    return {c.op: (c, retell.settle(LORE, {p.id: p for p in extra}, c.prop)) for c in found}


def test_each_operator_changes_the_story_as_the_script_has_it_change():
    # the clerk levels "looking for a lantern at the bridge" to "at the bridge"
    ops = changes_for("zhou_huoji", "pr_liner_looking")
    assert list(ops) == ["level"] and ops["level"][1].id == "pr_liner_at_bridge"
    # the shopkeeper, who holds a grudge, concludes that Li Er broke it, by the rule
    ops = changes_for("zhou_zhanggui", "pr_liner_at_bridge", source="heard", teller="zhou_huoji")
    assert list(ops) == ["level", "assimilate"]
    change, child = ops["assimilate"]
    assert (child.id, change.rule) == ("pr_liner_damaged", "sr_presence_grudge")
    assert ops["level"][1].span is None and ops["level"][1].id == "pr_liner_at_bridge__lv"
    # whoever hears it swaps the man for his family, sharpens it, and gives it the usual motive
    ops = changes_for("cha_laoban", "pr_liner_damaged", source="heard", teller="zhou_zhanggui")
    assert list(ops) == ["level", "sharpen", "assimilate", "fill"]
    assert ops["assimilate"][1].id == "pr_li_damaged" and ops["assimilate"][0].rule is None
    assert ops["sharpen"][1].motive == "on_purpose" and ops["fill"][1].motive == "jealousy"
    ops = changes_for("cha_laoban", "pr_li_damaged", source="heard", teller="zhou_zhanggui")
    assert ops["sharpen"][1].id == "pr_li_damaged_on_purpose"
    ops = changes_for("cha_laoban", "pr_li_damaged_on_purpose", source="heard", teller="mujiang")
    assert ops["fill"][1].id == "pr_li_damaged_jealous"  # the script's own last step
    assert "sharpen" not in ops  # it is on purpose already


def test_every_change_is_a_legal_step_of_its_operator_and_is_made_the_same_way_each_time():
    for holder, prop_id in (
        ("cha_laoban", "pr_liner_damaged"),
        ("zhou_zhanggui", "pr_liner_at_bridge"),
        ("mujiang", "pr_boat_damaged"),
        ("zhou_niangzi", "pr_boat_scratched"),
        ("zhou_dalang", "pr_dalang_at_bridge"),
    ):
        again = changes_for(holder, prop_id, source="heard", teller="gengfu")
        once = changes_for(holder, prop_id, source="heard", teller="gengfu")
        assert {k: v[1] for k, v in again.items()} == {k: v[1] for k, v in once.items()}
        assert once, (holder, prop_id)
        for op, (change, child) in once.items():
            rule = BOOK.rules.get(change.rule)
            problem = mutation_problem(
                BOOK.props[prop_id], child, op, LORE.tables, BOOK.registry, rule, book=BOOK.props
            )
            assert problem is None, (holder, prop_id, op, problem)
            assert child.parent == prop_id and child.op == op


def test_a_leveled_story_loses_one_thing_in_a_fixed_order_until_nothing_is_left():
    one = changes_for("zhou_zhanggui", "pr_boat_damaged", source="heard", teller="gengfu")
    level = one["level"][1]
    assert (level.id, level.motive, level.span) == ("pr_boat_damaged__lv", None, (-45, -35))
    two = changes_for("mujiang", level.id, (level,), source="heard", teller="gengfu")
    flat = two["level"][1]
    assert (flat.id, flat.motive, flat.span) == ("pr_boat_damaged__lv__lv", None, None)
    last = changes_for("mujiang", flat.id, (level, flat), source="heard", teller="gengfu")
    assert "level" not in last  # nothing left to drop, and it is no guess


def test_a_guess_that_is_leveled_says_it_flat_even_when_there_is_nothing_to_drop():
    guess = changes_for(
        "cha_laoban", "pr_liner_damaged", source="heard", teller="mujiang", modality="speculate"
    )
    assert guess["level"][0].drops_hedge and guess["level"][1].span is None
    flat = guess["level"][1]
    bare = changes_for(
        "cha_laoban", flat.id, (flat,), source="heard", teller="mujiang", modality="speculate"
    )
    assert bare["level"][0].drops_hedge
    assert bare["level"][1].same_fact(flat) and bare["level"][1].id == flat.id + "__lv"
    sure = changes_for("cha_laoban", flat.id, (flat,), source="heard", teller="mujiang")
    assert "level" not in sure


def test_a_rule_needs_the_speakers_suspicion_and_grudge_and_a_family_swap_a_stranger():
    args = {"source": "heard", "teller": "zhou_huoji"}
    assert "assimilate" in changes_for("zhou_zhanggui", "pr_liner_at_bridge", **args)
    assert "assimilate" not in changes_for(
        "zhou_zhanggui", "pr_liner_at_bridge", grudge=False, **args
    )
    assert "assimilate" not in changes_for(
        "zhou_zhanggui", "pr_liner_at_bridge", suspicion=29, **args
    )
    # the rule that blames the owner of a scratched boat asks for no grudge, only suspicion
    scratched = changes_for("zhou_niangzi", "pr_boat_scratched", grudge=False, **args)
    change, child = scratched["assimilate"]
    assert change.rule == "sr_scratched_boat" and (child.pred, child.arg("who")) == (
        "damaged",
        "old_he",
    )
    assert "assimilate" not in changes_for("zhangfang", "pr_boat_scratched", suspicion=19, **args)
    # a Li does not blame the Li family, and a Zhou or somebody of no family does
    blame = {"source": "heard", "teller": "mujiang"}
    assert "assimilate" not in changes_for("li_da", "pr_liner_damaged", **blame)
    assert (
        changes_for("zhou_dalang", "pr_liner_damaged", **blame)["assimilate"][1].id
        == "pr_li_damaged"
    )
    assert changes_for("gengfu", "pr_liner_damaged", **blame)["assimilate"][1].id == "pr_li_damaged"


def test_sharpen_and_fill_are_for_acts_and_an_accident_becomes_on_purpose():
    ops = changes_for("mujiang", "pr_boat_damaged", source="heard", teller="gengfu")
    assert ops["sharpen"][1].motive == "on_purpose" and "fill" not in ops  # it was an accident
    for prop_id in ("pr_liner_at_bridge", "pr_dalang_drank", "pr_rail_located"):
        ops = changes_for("mujiang", prop_id, source="heard", teller="gengfu")
        assert "sharpen" not in ops and "fill" not in ops, prop_id


def test_a_made_prop_keeps_the_scripts_id_or_is_named_for_its_parent_and_operator():
    ops = changes_for("cha_laoban", "pr_liner_damaged", source="heard", teller="mujiang")
    draft = ops["fill"][0].prop
    assert draft.id == "_" and ops["fill"][1].id == "pr_liner_damaged__fl"
    again = retell.settle(LORE, {"pr_liner_damaged__fl": ops["fill"][1]}, draft)
    assert again == ops["fill"][1]  # the same step is the same prop
    # another step by the same operator that makes something else gets the next number
    other = dataclasses.replace(draft, motive="spite")
    assert retell.settle(LORE, {"pr_liner_damaged__fl": ops["fill"][1]}, other).id == (
        "pr_liner_damaged__fl2"
    )
    # and the script's own child is found by content, whoever makes it
    swap = retell.settle(LORE, {}, ops["assimilate"][0].prop)
    assert swap is BOOK.props["pr_li_damaged"]
    assert ops["sharpen"][1] is BOOK.props["pr_liner_damaged_on_purpose"]  # the opening's step


# ------------------------------------------------------------------------------ the checker


def play_spied(seed, monkeypatch):
    """Play a whole game with a spy on ``paths.authorize``: the claims it judged, and how."""
    judged = []
    real = paths.authorize

    def spy(claim, *args, **kwargs):
        verdict = real(claim, *args, **kwargs)
        judged.append((claim, verdict))
        return verdict

    monkeypatch.setattr(paths, "authorize", spy)
    game = bridge(seed)
    while game.tick < 5 * CYCLE:
        game.step()
    return game, judged


@pytest.mark.parametrize("variant", VARIANTS)
def test_every_claim_that_was_applied_passed_authorize_and_none_was_refused(variant, monkeypatch):
    game, judged = play_spied(seeds_of(variant)[1], monkeypatch)
    section = state_of(game)["social"]
    claims = social.claims(section)
    assert len(claims) == len(judged) > 50
    assert all(verdict == (True, "ok") for _, verdict in judged)
    assert [c.id for c, _ in judged] == list(claims) and [c for c, _ in judged] == list(
        claims.values()
    )
    assert section["counts"]["told"] == len(claims) and section["counts"]["refused"] == 0
    assert section["refusals"] == {}


def sim_of(game):
    """A ``Sim`` for one tick of ``game`` that the test drives by hand."""
    kernel = game._kernel
    return Sim(kernel.world, Ctx(kernel))


class Forced:
    """A random source that always draws the last of the weights, which is what is offered last."""

    def weighted(self, weights):
        return len(weights) - 1


def test_a_refused_claim_is_never_applied_and_is_counted(monkeypatch):
    real = retell.changes

    def with_a_forgery(lore, view, parent, belief, store, **kwargs):
        found = real(lore, view, parent, belief, store, **kwargs)
        who = parent.arg("who")
        # a guess that the rule does not allow: at the bridge to broke the rail, naming no rule
        args = (("what", "t_rail"), ("who", who))
        forged = dataclasses.replace(
            parent, id="_", parent=parent.id, op="assimilate", pred="damaged", args=args
        )
        return [*found, retell.Change("assimilate", forged)]

    monkeypatch.setattr(retell, "changes", with_a_forgery)
    game = bridge(seeds_of("v_boat")[0])
    sim = sim_of(game)
    sim.ctx.rng = Forced()
    section = sim.state["social"]
    before = copy.deepcopy(section)
    told = telling.tell(sim, section, LORE, "zhou_huoji", "zhou_zhanggui", "pr_liner_at_bridge")
    assert told is None
    # nothing was written but the count and the reason
    assert section["counts"]["refused"] == 1 and section["refusals"] == {"extras": 1}
    assert [e["kind"] for e in sim.ctx.events] == ["refused"]
    event = sim.ctx.events[0]
    assert (event["speaker"], event["listener"], event["code"]) == (
        "zhou_huoji",
        "zhou_zhanggui",
        "extras",
    )
    assert event["prop"] == "pr_liner_damaged" and event["path"] == "mutation"
    section["counts"]["refused"] = 0
    section["refusals"] = {}
    assert section == before  # no claim, no belief, no prop, no change in anyone's feelings


def test_a_claim_the_speaker_may_not_make_is_refused_for_the_reason_the_checker_gives(monkeypatch):
    real = retell.changes

    def with_a_rule_that_does_not_hold(lore, view, parent, belief, store, **kwargs):
        found = real(lore, view, parent, belief, store, **kwargs)
        draft = dataclasses.replace(
            parent, id="_", parent=parent.id, op="assimilate", pred="damaged",
            args=(("what", "t_rail"), ("who", parent.arg("who"))),
        )  # fmt: skip
        return [*found, retell.Change("assimilate", draft, rule="sr_presence_grudge")]

    monkeypatch.setattr(retell, "changes", with_a_rule_that_does_not_hold)
    game = bridge(seeds_of("v_boat")[0])
    sim = sim_of(game)
    sim.ctx.rng = Forced()
    section = sim.state["social"]
    # the clerk is suspicious enough for the rule (40 against 30) but holds no grudge against Li Er
    assert bonds.value(section, LORE, "zhou_huoji", "li_er", bonds.GRUDGE) < bonds.GRUDGE_ENOUGH
    told = telling.tell(sim, section, LORE, "zhou_huoji", "zhou_zhanggui", "pr_liner_at_bridge")
    assert told is None and section["refusals"] == {"relation": 1}
    assert section["claims"] == {} and "pr_liner_damaged" not in section["beliefs"]["zhou_zhanggui"]
    # the same claim from the shopkeeper, who does, passes
    sim = sim_of(game)
    sim.ctx.rng = Forced()
    section["beliefs"]["zhou_zhanggui"]["pr_liner_at_bridge"] = (
        "assert|52|heard|zhou_huoji|self_seen|1|0|c0"
    )
    told = telling.tell(sim, section, LORE, "zhou_zhanggui", "cha_laoban", "pr_liner_at_bridge")
    assert told is not None and told.claim.rule_id == "sr_presence_grudge"
    assert told.prop is BOOK.props["pr_liner_damaged"] and section["refusals"] == {"relation": 1}


def test_a_belief_that_contradicts_a_held_one_is_kept_only_if_it_is_the_more_confident():
    class Recorder:
        def __init__(self):
            self.events = []

        def emit(self, kind, **fields):
            self.events.append({"kind": kind, **fields})

    def hear(held_conf, new_conf, held="pr_boat_damaged", new="pr_liner_damaged"):
        section = state_of(bridge(seeds_of("v_boat")[0]))["social"]
        section["beliefs"]["mujiang"][held] = f"assert|{held_conf}|heard|gengfu|gengfu|1|0|c0"
        view = social.book(section)
        sim = Recorder()
        belief = Belief(
            "mujiang", new, "assert", new_conf, "heard", "cha_laoban", "cha_laoban", 2, 5, "c1"
        )
        written = telling._hold(sim, section, LORE, view, BOOK.props[new], belief, "c1")
        return written, section["beliefs"]["mujiang"], sim.events, section["counts"]["conflicts"]

    written, mine, events, count = hear(60, 40)  # the held one wins, and the new is set aside
    assert not written and notes.confidence_of(mine["pr_liner_damaged"]) == 0
    assert notes.confidence_of(mine["pr_boat_damaged"]) == 60 and count == 1
    assert events == [
        {"kind": "conflict", "holder": "mujiang", "new": "pr_liner_damaged",
         "held": "pr_boat_damaged", "kept": "held", "claim": "c1"}
    ]  # fmt: skip
    written, mine, events, _ = hear(60, 61)  # the new one wins, and the held one is set aside
    assert written and notes.confidence_of(mine["pr_liner_damaged"]) == 61
    assert notes.confidence_of(mine["pr_boat_damaged"]) == 0 and events[0]["kept"] == "new"
    written, mine, _, _ = hear(60, 60)  # a tie goes to what is held
    assert not written and notes.confidence_of(mine["pr_boat_damaged"]) == 60
    # a story that does not exclude what is held is simply held
    written, mine, events, count = hear(60, 20, new="pr_liner_at_bridge")
    assert written and events == [] and count == 0
    assert notes.confidence_of(mine["pr_boat_damaged"]) == 60
    # a prop made on the way says what its likeness in the script says, and excludes what that does
    one = Belief("mujiang", "pr_liner_damaged__lv", "assert", 70, "heard", "x", "x", 2, 5, "c1")
    section = state_of(bridge(seeds_of("v_boat")[0]))["social"]
    section["beliefs"]["mujiang"]["pr_boat_damaged"] = "assert|60|heard|gengfu|gengfu|1|0|c0"
    made = dataclasses.replace(
        BOOK.props["pr_liner_damaged"],
        id="pr_liner_damaged__lv",
        parent="pr_liner_damaged",
        op="level",
        span=None,
    )
    view = notes.PropView({made.id: made}, BOOK.props)
    assert LORE.excludes(made, BOOK.props["pr_boat_damaged"])
    assert not LORE.excludes(made, BOOK.props["pr_liner_damaged"])  # the same thing said less
    assert not LORE.excludes(made, BOOK.props["pr_liner_at_bridge"])
    assert telling._hold(Recorder(), section, LORE, view, made, one, "c1")


# ------------------------------------------------------------------------------ a whole game


ALL_RUNS = [(variant, seed) for variant in VARIANTS for seed in seeds_of(variant)]
# The town tells about a third of the stories it once did, so the clerk's story seldom goes the
# whole way to "out of jealousy" in five days. These games are some that do (played from seed 0 to
# 59, about one in eight), one for each variant of the truth.
RUMOUR_RUNS = [("v_boat", 10), ("v_drunk", 12), ("v_flood", 42)]
CHAIN = ("pr_liner_at_bridge", "pr_liner_damaged", "pr_li_damaged")
CHAIN += ("pr_li_damaged_on_purpose", "pr_li_damaged_jealous")


def rumour_holders(run, hop=2):
    """Who holds a version of the clerk's rumour, heard at least ``hop`` hands from its source."""
    book, found = run.book(), set()
    for holder, store in run.stores().items():
        for belief in store:
            story = lineage(belief.prop, book)[-1]
            if story == "pr_liner_looking" and belief.source == "heard" and belief.hop >= hop:
                found.add(holder)
    return found


@pytest.mark.parametrize(("variant", "seed"), ALL_RUNS)
def test_the_clerks_rumour_spreads_beyond_its_first_hop_within_the_five_days(variant, seed):
    run = played(seed)
    assert run.section["variant"] == variant
    far = rumour_holders(run) - {"zhou_huoji", "li_er"}
    assert len(far) >= 5, sorted(far)
    # it got out of the Zhou house, and over to the other family
    assert far - {p for p in PEOPLE if LORE.family[p] == "fam_zhou"}
    assert far & {p for p in PEOPLE if LORE.family[p] == "fam_li"}


@pytest.mark.parametrize(("variant", "seed"), ALL_RUNS)
def test_every_prop_made_on_the_way_is_a_legal_step_from_a_belief_the_speaker_held(variant, seed):
    run = played(seed)
    book = run.book()
    made = run.section["props"]
    assert made and all(pid in book for pid in made)
    assert len(made) < 120  # the cycles are cut: a story cannot go on changing for ever
    for pid in made:
        assert check_prop(book[pid], LORE.tables, BOOK.registry, book) == []
    stores = run.stores()
    for claim in run.claims().values():
        prop = book[claim.prop]
        held = stores[claim.speaker].get(prop.parent if claim.path == "mutation" else prop.id)
        assert held is not None and held.tick <= claim.tick
        if claim.path == "mutation":
            assert claim.op == prop.op and prop.parent is not None
            rule = BOOK.rules.get(claim.rule_id)
            problem = mutation_problem(
                book[prop.parent], prop, prop.op, LORE.tables, BOOK.registry, rule, book=book
            )
            assert problem is None, (claim, problem)
            # a rule is named exactly when an assimilate changes the predicate
            changes_pred = prop.op == "assimilate" and prop.pred != book[prop.parent].pred
            assert (claim.rule_id is not None) == changes_pred
        else:
            assert claim.op is None and claim.rule_id is None


def test_the_rumour_of_the_script_comes_up_by_itself_with_the_grudge_that_the_rule_asks_for():
    props, ruled = set(), []
    for _, seed in [*ALL_RUNS, *RUMOUR_RUNS]:
        run = played(seed)
        props |= {c.prop for c in run.claims().values()}
        ruled += [c for c in run.claims().values() if c.rule_id == "sr_presence_grudge"]
    assert set(CHAIN) <= props
    assert {c.speaker for c in ruled} >= {"zhou_zhanggui"}
    for claim in ruled:
        assert LORE.traits[claim.speaker]["suspicion"] >= 30


@pytest.mark.parametrize(("variant", "seed"), ALL_RUNS)
def test_every_belief_that_was_passed_on_walks_back_to_somebody_who_saw_it(variant, seed):
    run = played(seed)
    stores, claims, book = run.stores(), run.claims(), run.book()
    walked = 0
    for holder, store in stores.items():
        for belief in store:
            if belief.source not in ("heard", "inferred"):
                continue
            trace = walk_back(holder, belief.prop, stores, claims, book)
            walked += 1
            if trace.end == "inferred":
                # nobody saw it: it is a guess that somebody came to in the night, and says so
                guess = stores[trace.origin].get(trace.hops[-1].belief.prop)
                assert guess.modality == "speculate" and guess.claim is None, (holder, belief.prop)
                assert guess.confidence >= 0 and trace.origin == guess.holder
                continue
            assert trace.end == "saw", (holder, belief.prop, trace.end)
            first_hand = stores[trace.origin].get(trace.hops[-1].belief.prop)
            assert first_hand is not None and first_hand.source == "saw"
            if (
                belief.source == "heard"
            ):  # one more for each speaker who took a change for their own
                assert len(trace.hops) >= belief.hop + 1
    assert walked > 60
    # the changed rumour in particular leads back to one of the two who saw Li Er at the bridge
    for holder, store in stores.items():
        for belief in store:
            if belief.prop == "pr_liner_damaged" and belief.source == "heard":
                trace = walk_back(holder, belief.prop, stores, claims, book)
                if (
                    trace.end == "inferred"
                ):  # or it is the guess of one who holds a grudge, by night
                    continue
                assert trace.origin in ("zhou_huoji", "li_er")
                ops = [op for _, _, op in trace.mutations]
                assert "assimilate" in ops  # the step where "at the bridge" became "broke it"
                assert trace.first_change() is not None


def test_a_belief_walked_back_shows_where_the_story_changed_shape():
    hits = 0
    for _, seed in [*ALL_RUNS, *RUMOUR_RUNS]:
        run = played(seed)
        stores, claims, book = run.stores(), run.claims(), run.book()
        for holder, store in stores.items():
            for belief in store:
                if belief.prop in ("pr_li_damaged_jealous", "pr_li_damaged_on_purpose"):
                    if belief.source != "heard":
                        continue
                    trace = walk_back(holder, belief.prop, stores, claims, book)
                    steps = {op for _, _, op in trace.mutations}
                    assert {"assimilate", "sharpen"} <= steps or {"assimilate", "fill"} <= steps
                    hits += 1
    assert hits > 0


# ------------------------------------------------------------------------------ the frame

TOPICS = {"blame", "clear", "other"}
CJK = re.compile(r"[㐀-鿿]")


def test_the_colour_of_a_dot_follows_what_the_telling_says_and_not_which_story_is_true():
    topic = LORE.topic
    for pid in ("pr_liner_damaged", "pr_li_damaged", "pr_li_damaged_jealous"):
        assert topic(BOOK.props[pid]) == "blame"  # the rumour about the Li family
    for pid in ("pr_boat_damaged", "pr_dalang_damaged"):
        assert topic(BOOK.props[pid]) == "blame"  # whoever did it, saying so is blaming them
    assert topic(BOOK.props["pr_dalang_not_bridge"]) == "clear"  # a denial
    assert topic(BOOK.props["pr_flood_damaged"]) == "clear"  # a cause that is nobody's doing
    assert topic(BOOK.props["pr_liner_at_bridge"]) == "other"
    assert topic(BOOK.props["pr_boat_scratched"]) == "other"
    made = dataclasses.replace(BOOK.props["pr_liner_damaged"], id="pr_liner_damaged__sh")
    assert topic(made) == "blame"  # what was made on the way is judged by what it says
    # the colour has no variant to be made with
    assert list(inspect.signature(LORE.topic).parameters) == ["prop"]


@pytest.mark.parametrize(("variant", "seed"), RUMOUR_RUNS)
def test_a_dot_carries_each_telling_for_sixteen_ticks_and_a_bubble_shows_its_words(variant, seed):
    run = played(seed)
    claims = run.claims()
    by_claim = {e["claim"]: e for e in told(run)}
    by_voice = {(e["speaker"], e["tick"]): e for e in told(run)}
    last = run.game.tick
    dots_seen, bubbles_seen, topics = Counter(), Counter(), set()
    for tick, bubbles, dots in run.shown:
        ends = [end for dot in dots for end in (dot["from"], dot["to"])]
        assert len(ends) == len(set(ends))  # nobody is in two tellings
        for dot in dots:
            assert set(dot) == {"id", "from", "to", "topic", "progress"}
            claim, event = claims[dot["id"]], by_claim[dot["id"]]
            assert (dot["from"], dot["to"]) == (claim.speaker, claim.listeners[0])
            assert type(dot["progress"]) is int and 0 < dot["progress"] <= 1000
            assert dot["progress"] == (tick - event["tick"]) * 1000 // gossip.TELL_TICKS
            assert dot["topic"] in TOPICS
            topics.add(dot["topic"])
            dots_seen[dot["id"]] += 1
        speakers = [b["npc"] for b in bubbles]
        assert len(speakers) == len(set(speakers))  # one bubble over a head at a time
        for bubble in bubbles:
            assert set(bubble) == {"npc", "until", "text"} and set(bubble["text"]) == {"zh", "en"}
            assert bubble["until"] > tick
            event = by_voice[(bubble["npc"], bubble["until"] - gossip.BUBBLE_TICKS)]
            claim = claims[event["claim"]]
            said = claim_wordings(
                run.book()[claim.prop], claim.modality, claim.claimed_source, claim.speaker,
                int(claim.id[1:]),
            )  # fmt: skip
            assert bubble["text"] in said  # in one of the speaker's own ways of saying it
            zh, en = bubble["text"]["zh"], bubble["text"]["en"]
            assert zh.endswith(("。", "！", "？")) and CJK.search(zh) and not CJK.search(en)
            assert en.endswith((".", "!", "?")) and en[0].isupper() and en.isascii() or "'" in en
            bubbles_seen[(bubble["npc"], bubble["until"])] += 1
    for claim_id, frames in dots_seen.items():
        if by_claim[claim_id]["tick"] + gossip.TELL_TICKS <= last:
            assert frames == gossip.TELL_TICKS
    for (npc, until), frames in bubbles_seen.items():
        if until <= last:
            # the frame of the tick it was said at is the first, and `until` is not shown
            assert frames == gossip.BUBBLE_TICKS - 1, (npc, until)
    assert "other" in topics and len(topics) >= 2 and len(dots_seen) > 80 and len(bubbles_seen) > 80


def test_the_truth_is_told_and_cleared_too():
    colours = Counter()
    for _, seed in ALL_RUNS:
        for _, _, dots in played(seed).shown:
            colours.update(d["topic"] for d in dots)
    assert colours["clear"] > 0 and colours["blame"] > 0 and colours["other"] > colours["clear"]


def test_a_telling_leaves_the_frame_when_it_is_over_and_a_snapshot_keeps_it():
    game = bridge(seeds_of("v_boat")[0])
    while not state_of(game)["social"]["talks"]:
        game.step()
    section = state_of(game)["social"]
    (claim_id, start, ticks) = section["talks"][0]
    again = Game.from_snapshot_json(game.snapshot_json())
    assert state_of(again)["social"]["talks"] == section["talks"]
    for _ in range(ticks):
        out = json.loads(game.step())
        back = json.loads(again.step())
        assert out["frame"] == back["frame"]
    assert all(t[0] != claim_id for t in state_of(game)["social"]["talks"])
    assert claim_id not in [d["id"] for d in out["frame"]["dots"]]


# ------------------------------------------------------------------------------ the street


def drive(game, *records):
    state_of(game)["crowd"]["outbox"] = list(records)
    return step(game)


def test_what_the_crowd_sends_becomes_beliefs_of_the_street_once():
    game = bridge(seeds_of("v_boat")[0])
    flood = {"to": "li_da", "prop": "pr_flood_damaged", "tick": 0}
    out = drive(
        game,
        flood,
        dict(flood),  # told again: he holds it by now
        {"to": "mujiang", "prop": "pr_dalang_at_bridge", "tick": -3},
        {"to": "nobody", "prop": "pr_flood_damaged", "tick": 0},  # no such person
        {"to": "li_da", "prop": "pr_nothing", "tick": 0},  # no such prop
        {"to": "li_da", "prop": "pr_flood_damaged"},  # not an entry of the outbox
        "junk",
    )
    section = state_of(game)["social"]
    assert state_of(game)["crowd"]["outbox"] == []
    stores = social.stores(section)
    belief = stores["li_da"].get("pr_flood_damaged")
    assert (belief.source, belief.confidence, belief.hop, belief.teller, belief.claim) == (
        "street", telling.STREET_CONFIDENCE, 1, None, None,
    )  # fmt: skip
    assert belief.tick == 0 and belief.modality == "assert"
    assert stores["mujiang"].get("pr_dalang_at_bridge").tick == 0  # never before the game
    assert section["counts"]["street"] == 2 and section["counts"]["street_skipped"] == 5
    assert [(e["holder"], e["prop"]) for e in out["events"] if e["kind"] == "street"] == [
        ("li_da", "pr_flood_damaged"),
        ("mujiang", "pr_dalang_at_bridge"),
    ]
    again = step(game)  # the list is empty now: nothing is added twice
    assert [e for e in again["events"] if e["kind"] == "street"] == []
    assert section["counts"]["street"] == 2


def test_a_street_belief_loses_to_what_a_person_holds_and_is_not_told_on():
    game = bridge(seeds_of("v_boat")[0])
    drive(game, {"to": "xiao_man", "prop": "pr_liner_damaged", "tick": 0})
    section = state_of(game)["social"]
    mine = social.stores(section)["xiao_man"]
    assert mine.get("pr_boat_damaged").confidence == 90  # she saw it
    assert mine.get("pr_liner_damaged").confidence == 0  # and set the street's word aside
    assert section["counts"]["conflicts"] == 1 and section["counts"]["street"] == 0
    assert section["counts"]["street_skipped"] == 1


def test_a_named_person_who_speaks_outdoors_is_heard_by_the_street(monkeypatch):
    calls = []
    real = crowd.hear

    def spy(sim, place_id, prop_id, speaker_id):
        calls.append((sim.ctx.tick, place_id, prop_id, speaker_id))
        return real(sim, place_id, prop_id, speaker_id)

    monkeypatch.setattr(crowd, "hear", spy)
    game = bridge(seeds_of("v_drunk")[0])
    outdoors, indoors = [], []
    while game.tick < 3 * CYCLE:
        out = json.loads(game.step())
        for event in out["events"]:
            if event["kind"] != "told":
                continue
            me = state_of(game)["npcs"]["list"][CAST.index[event["speaker"]]]
            room = TOWN.places[me["place"]]
            key = (event["tick"], room.id, event["prop"], event["speaker"])
            (indoors if room.indoor or not gossip.at_goal(me) else outdoors).append(key)
    assert outdoors and indoors
    assert calls == outdoors  # outdoors, and at the place, and nowhere else
    assert all(not TOWN.places[place].indoor for _, place, _, _ in calls)
    # what the crowd learns is a prop the game knows
    book = social.book(state_of(game)["social"])
    assert all(prop in book for _, _, prop, _ in calls)


def test_the_world_runs_the_same_without_a_street_that_listens(monkeypatch):
    monkeypatch.delattr(crowd, "hear")
    game = bridge(seeds_of("v_flood")[0])
    while game.tick < 2 * CYCLE:
        game.step()
    assert state_of(game)["social"]["counts"]["told"] > 30


# ------------------------------------------------------------------------------ determinism


def test_the_same_seed_tells_the_same_story_and_a_restored_game_carries_on_the_same():
    seed = seeds_of("v_drunk")[0]
    one, two = bridge(seed), bridge(seed)
    for _ in range(3000):
        assert one.step() == two.step()
    assert one.hash() == two.hash()
    restored = Game.from_snapshot_json(one.snapshot_json())
    for _ in range(1500):
        assert one.step() == restored.step()
    assert one.hash() == restored.hash() == two.hash() or two.tick != one.tick
    assert state_of(one)["social"] == state_of(restored)["social"]
    different = bridge(seed + 1)
    for _ in range(3000):
        different.step()
    assert different.hash() != two.hash()
