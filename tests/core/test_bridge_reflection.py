"""The night: each named person thinks over the day by rules and chooses an errand for tomorrow.

The first tests are about the two bounded steps of the pass on a state made by hand, and the rules
that make them: what a belief heard from two first sources gains and what a sight takes away
(``consolidate``), the guess the script's rules give to a suspicious person with news
(``speculate``). Then the errands: the closed list, what makes each one possible, where and when it
may be done, how it is carried out. Last, the pass on whole games (once a night, in order, nothing
shown of it), the paper's one line of street talk, and the replays.
"""

from __future__ import annotations

import json

import pytest
from bridge_helpers import CAST, CYCLE, at, bridge, run_to, state_of, step, world_of
from reflection_helpers import (
    EVE,
    LORE,
    PAGE,
    base_of,
    belief_of,
    confidence_of,
    forget,
    game_at,
    give,
    hold,
    night_day,
    pass_at_hand,
    set_bond,
    sim_of,
)

from lantern_core.api import Game
from lantern_core.cognition import paths
from lantern_core.cognition.beliefs import Claim
from lantern_core.world.bridge import (
    bonds,
    clock,
    gazette,
    goals_ending,
    gossip,
    notes,
    projection,
    reflection,
    repute,
    telling,
)
from lantern_core.world.bridge.data import SCRIPT

DAMAGED = "pr_liner_damaged"  # Li Er broke the rail
ON_PURPOSE = "pr_liner_damaged_on_purpose"  # ... on purpose: the same fact with more said
AT_BRIDGE = "pr_liner_at_bridge"
DALANG_DAMAGED = "pr_dalang_damaged"
FLOOD_DAMAGED = "pr_flood_damaged"
BOAT_DAMAGED = "pr_boat_damaged"
HOLDER = "zhou_niangzi"  # a neutral person, for the beliefs made by hand
PEOPLE = [p["id"] for p in CAST.data["people"]]


def cycle_ticks_of(tick: int) -> int:
    return clock.at(tick).cycle_tick


# ------------------------------------------------------------------------------ the numbers


def test_a_guess_is_held_under_the_lines_of_believing_and_over_the_one_of_not_passing_on():
    assert gossip.MIN_CONFIDENCE <= reflection.GUESS_AT
    assert reflection.GUESS_AT < goals_ending.BELIEVE_AT <= repute.BELIEVE_AT
    assert reflection.GUESS_AT < reflection.PREMISE_AT


def test_a_heard_belief_cannot_get_as_firm_as_a_sight_and_the_steps_are_small():
    assert reflection.HEARD_CEILING < 90  # what a person saw is held at 90
    assert 0 < reflection.FIRM_STEP <= 10 and 0 < reflection.DOUBT_STEP <= 10
    assert reflection.DOUBT_FLOOR < gossip.MIN_CONFIDENCE  # a doubted belief ends up not passed on


def test_the_errand_list_is_the_four_kinds_and_the_streets_sees_three_of_them():
    assert reflection.KINDS == ("tell", "help", "avoid", "look")
    assert set(reflection.KIND_WEIGHT) == set(reflection.ACTS) == set(reflection.KINDS)
    assert reflection.PUBLIC_KINDS == ("tell", "help", "look")
    cast_acts = {act["id"] for act in CAST.data["activities"]}
    assert set(reflection.ACTS.values()) <= cast_acts
    assert set(reflection.FREE_ACTS) <= cast_acts


# ------------------------------------------------------------------------------ consolidate


def test_a_belief_heard_from_two_first_sources_gets_firmer_and_so_does_the_other():
    game = game_at()
    forget(game, HOLDER)
    give(game, DAMAGED, ["zhou_huoji", "zhou_zhanggui", HOLDER], confidence=50)
    give(game, ON_PURPOSE, ["li_er", "cha_laoban", HOLDER], confidence=55)
    assert reflection.consolidate(sim_of(game), HOLDER) == (2, 0)
    assert confidence_of(game, HOLDER, DAMAGED) == 50 + reflection.FIRM_STEP
    assert confidence_of(game, HOLDER, ON_PURPOSE) == 55 + reflection.FIRM_STEP


def test_a_rumour_that_goes_round_has_one_first_source_however_many_mouths_it_passed_through():
    game = game_at()
    forget(game, HOLDER)
    give(game, DAMAGED, ["zhou_huoji", "zhou_zhanggui", HOLDER], confidence=50)
    give(game, ON_PURPOSE, ["zhou_huoji", "cha_laoban", "mujiang", HOLDER], confidence=55)
    assert reflection.consolidate(sim_of(game), HOLDER) == (0, 0)
    assert confidence_of(game, HOLDER, DAMAGED) == 50
    assert confidence_of(game, HOLDER, ON_PURPOSE) == 55


def test_what_the_person_saw_themselves_is_a_second_source_and_a_sight_is_left_as_it_is():
    game = game_at()
    forget(game, HOLDER)
    give(game, DAMAGED, ["zhou_huoji", "zhou_zhanggui", HOLDER], confidence=50)
    hold(game, HOLDER, ON_PURPOSE, 90)
    assert reflection.consolidate(sim_of(game), HOLDER) == (1, 0)
    assert confidence_of(game, HOLDER, DAMAGED) == 50 + reflection.FIRM_STEP
    assert confidence_of(game, HOLDER, ON_PURPOSE) == 90


def test_only_the_same_fact_is_a_second_source_not_another_fact_of_the_same_story():
    game = game_at()
    forget(game, HOLDER)
    give(game, DAMAGED, ["zhou_huoji", "zhou_zhanggui", HOLDER], confidence=50)
    give(game, AT_BRIDGE, ["li_er", "cha_laoban", HOLDER], confidence=55)
    assert reflection.consolidate(sim_of(game), HOLDER) == (0, 0)


def test_a_belief_does_not_get_firmer_than_the_ceiling_and_a_firm_one_stays():
    game = game_at()
    forget(game, HOLDER)
    top = reflection.HEARD_CEILING
    give(game, DAMAGED, ["zhou_huoji", "zhou_zhanggui", HOLDER], confidence=top - 2)
    give(game, ON_PURPOSE, ["li_er", "cha_laoban", HOLDER], confidence=top)
    assert reflection.consolidate(sim_of(game), HOLDER) == (1, 0)
    assert confidence_of(game, HOLDER, DAMAGED) == top
    assert confidence_of(game, HOLDER, ON_PURPOSE) == top
    assert reflection.consolidate(sim_of(game), HOLDER) == (0, 0)


def test_a_belief_heard_once_that_a_sight_excludes_gets_less_firm():
    game = game_at()
    forget(game, HOLDER)
    give(game, DAMAGED, ["zhou_huoji", "zhou_zhanggui", HOLDER], confidence=50)
    hold(game, HOLDER, FLOOD_DAMAGED, 90)  # the rail was broken by the flood: not by Li Er
    assert LORE.excludes(LORE.book.props[FLOOD_DAMAGED], LORE.book.props[DAMAGED])
    assert reflection.consolidate(sim_of(game), HOLDER) == (0, 1)
    assert confidence_of(game, HOLDER, DAMAGED) == 50 - reflection.DOUBT_STEP
    assert confidence_of(game, HOLDER, FLOOD_DAMAGED) == 90


def test_a_sight_that_an_item_of_evidence_holds_against_the_rumour_does_the_same_unexcluded():
    """The clerk who saw Li Er looking for his lantern: the testimony that shows it refutes the
    rumour, though the two can be true together."""
    game = game_at()
    forget(game, HOLDER)
    seen, rumour = LORE.book.props[AT_BRIDGE], LORE.book.props[DAMAGED]
    assert not LORE.excludes(seen, rumour)
    give(game, DAMAGED, ["zhou_zhanggui", "cha_laoban", HOLDER], confidence=50)
    hold(game, HOLDER, AT_BRIDGE, 90)
    assert reflection.consolidate(sim_of(game), HOLDER) == (0, 1)
    assert confidence_of(game, HOLDER, DAMAGED) == 50 - reflection.DOUBT_STEP


def test_a_belief_does_not_get_less_firm_than_the_floor():
    game = game_at()
    forget(game, HOLDER)
    give(game, DAMAGED, ["zhou_huoji", "zhou_zhanggui", HOLDER], confidence=15)
    hold(game, HOLDER, FLOOD_DAMAGED, 90)
    sim = sim_of(game)
    assert reflection.consolidate(sim, HOLDER) == (0, 1)
    assert confidence_of(game, HOLDER, DAMAGED) == reflection.DOUBT_FLOOR
    assert reflection.consolidate(sim, HOLDER) == (0, 0)
    assert confidence_of(game, HOLDER, DAMAGED) == reflection.DOUBT_FLOOR


def test_a_belief_held_from_two_first_sources_is_not_also_doubted():
    game = game_at()
    forget(game, HOLDER)
    give(game, DAMAGED, ["zhou_huoji", "zhou_zhanggui", HOLDER], confidence=50)
    give(game, ON_PURPOSE, ["li_er", "cha_laoban", HOLDER], confidence=55)
    hold(game, HOLDER, FLOOD_DAMAGED, 90)
    firmer, weaker = reflection.consolidate(sim_of(game), HOLDER)
    assert (firmer, weaker) == (2, 0)


def test_a_belief_set_aside_is_left_alone_and_so_is_what_was_not_heard():
    game = game_at()
    forget(game, HOLDER)
    give(game, DAMAGED, ["zhou_huoji", "zhou_zhanggui", HOLDER], confidence=0)
    hold(game, HOLDER, FLOOD_DAMAGED, 90)
    hold(game, HOLDER, AT_BRIDGE, 70, source="inferred", modality="speculate")
    hold(game, HOLDER, "pr_dalang_drank", 80, source="street")
    before = dict(state_of(game)["social"]["beliefs"][HOLDER])
    assert reflection.consolidate(sim_of(game), HOLDER) == (0, 0)
    assert state_of(game)["social"]["beliefs"][HOLDER] == before


def test_each_belief_moves_one_step_a_night_and_nobody_else_is_touched():
    game = game_at()
    forget(game, HOLDER)
    give(game, DAMAGED, ["zhou_huoji", "zhou_zhanggui", HOLDER], confidence=50)
    hold(game, HOLDER, FLOOD_DAMAGED, 90)
    others = {p: dict(state_of(game)["social"]["beliefs"][p]) for p in PEOPLE if p != HOLDER}
    sim = sim_of(game)
    for night in (1, 2, 3):
        assert reflection.consolidate(sim, HOLDER) == (0, 1)
        assert confidence_of(game, HOLDER, DAMAGED) == 50 - night * reflection.DOUBT_STEP
    assert {p: state_of(game)["social"]["beliefs"][p] for p in others} == others


# ------------------------------------------------------------------------------ speculate


def news_for(game, who: str, prop: str, confidence: int = 70, tick: int = 1000) -> None:
    """``who`` heard ``prop`` today from a neighbour who saw it."""
    teller = next(p for p in PEOPLE if p not in (who, "li_er"))
    give(game, prop, [teller, who], confidence=confidence, tick=tick)


def test_a_suspicious_person_with_a_grudge_and_news_comes_to_a_guess_by_the_rule_of_the_script():
    game = game_at()
    forget(game, "zhou_zhanggui")
    set_bond(game, "zhou_zhanggui", "li_er", bonds.GRUDGE, 70)
    news_for(game, "zhou_zhanggui", AT_BRIDGE)
    sim = sim_of(game)
    assert reflection.speculate(sim, "zhou_zhanggui", since=0) == DAMAGED
    guess = belief_of(game, "zhou_zhanggui", DAMAGED)
    assert (guess.modality, guess.source, guess.confidence, guess.hop) == (
        "speculate",
        "inferred",
        reflection.GUESS_AT,
        0,
    )
    assert (guess.teller, guess.claimed_source) == (None, None)


def test_the_guess_passes_the_checker_every_hop_of_the_town_passes():
    game = game_at()
    forget(game, "zhou_zhanggui")
    set_bond(game, "zhou_zhanggui", "li_er", bonds.GRUDGE, 70)
    news_for(game, "zhou_zhanggui", AT_BRIDGE)
    sim = sim_of(game)
    assert reflection.speculate(sim, "zhou_zhanggui", since=0) == DAMAGED
    social = state_of(game)["social"]
    claim = Claim(
        "g1",
        "zhou_zhanggui",
        ("li_er",),
        DAMAGED,
        "speculate",
        "zhou_zhanggui",
        sim.ctx.tick,
        "speculation",
        rule_id="sr_presence_grudge",
        premises=(AT_BRIDGE, "pr_rail_located", "pr_rail_broken"),
    )
    verdict = paths.authorize(
        claim,
        notes.store(social, "zhou_zhanggui"),
        notes.PropView(notes.made_props(social), LORE.book.props),
        tables=LORE.tables,
        registry=LORE.book.registry,
        rules=LORE.book.rules,
        suspicion=LORE.traits["zhou_zhanggui"]["suspicion"],
        relation=bonds.grudge_check(social, LORE),
        public=LORE.public,
    )
    assert verdict == (True, "ok")


def test_the_guess_needs_news_a_premise_the_person_came_to_hold_since_the_last_pass():
    game = game_at()
    forget(game, "zhou_zhanggui")
    set_bond(game, "zhou_zhanggui", "li_er", bonds.GRUDGE, 70)
    news_for(game, "zhou_zhanggui", AT_BRIDGE, tick=1000)
    assert reflection.speculate(sim_of(game), "zhou_zhanggui", since=1000) == ""
    assert DAMAGED not in notes.store(state_of(game)["social"], "zhou_zhanggui")
    assert reflection.speculate(sim_of(game), "zhou_zhanggui", since=999) == DAMAGED


def test_everyone_knows_the_flood_and_the_broken_rail_and_that_alone_is_no_news():
    game = game_at(tick=at(1, 23) - 1)
    for who in PEOPLE:
        forget(game, who)
        assert reflection.speculate(sim_of(game), who, since=0) == "", who


def test_a_guess_needs_the_standing_the_rule_asks_for_a_grudge():
    game = game_at()
    forget(game, "zhou_zhanggui")
    set_bond(game, "zhou_zhanggui", "li_er", bonds.GRUDGE, bonds.GRUDGE_ENOUGH - 1)
    news_for(game, "zhou_zhanggui", AT_BRIDGE)
    assert reflection.speculate(sim_of(game), "zhou_zhanggui", since=0) == ""


def test_a_guess_needs_a_temper_for_it_the_rule_says_how_suspicious():
    rule = LORE.book.rules["sr_presence_grudge"]
    mild = next(p for p in PEOPLE if LORE.traits[p]["suspicion"] < rule.min_suspicion)
    game = game_at()
    forget(game, mild)
    set_bond(game, mild, "li_er", bonds.GRUDGE, 90)
    news_for(game, mild, AT_BRIDGE)
    assert reflection.speculate(sim_of(game), mild, since=0) == ""


def test_nobody_comes_to_a_guess_about_themselves():
    game = game_at()
    forget(game, "zhou_dalang")
    hold(game, "zhou_dalang", "pr_dalang_drank", 90, tick=1000)
    assert (
        LORE.traits["zhou_dalang"]["suspicion"]
        >= LORE.book.rules["sr_drunk_reckless"].min_suspicion
    )
    assert reflection.speculate(sim_of(game), "zhou_dalang", since=0) == ""


def test_another_who_hears_that_the_drinker_was_out_that_night_comes_to_the_guess():
    game = game_at()
    forget(game, "li_laotai")
    news_for(game, "li_laotai", "pr_dalang_drank")
    assert reflection.speculate(sim_of(game), "li_laotai", since=0) == DALANG_DAMAGED


def test_a_guess_is_not_made_against_a_belief_the_person_holds_as_firmly():
    game = game_at()
    forget(game, "li_laotai")
    news_for(game, "li_laotai", "pr_dalang_drank")
    hold(game, "li_laotai", FLOOD_DAMAGED, 90)
    assert LORE.excludes(LORE.book.props[DALANG_DAMAGED], LORE.book.props[FLOOD_DAMAGED])
    assert reflection.speculate(sim_of(game), "li_laotai", since=0) == ""
    assert DALANG_DAMAGED not in notes.store(state_of(game)["social"], "li_laotai")


def test_a_guess_that_a_weaker_belief_excludes_sets_that_belief_aside_as_a_hearing_would():
    game = game_at()
    forget(game, "li_laotai")
    news_for(game, "li_laotai", "pr_dalang_drank")
    hold(game, "li_laotai", FLOOD_DAMAGED, reflection.GUESS_AT - 1, source="street")
    assert reflection.speculate(sim_of(game), "li_laotai", since=0) == DALANG_DAMAGED
    assert confidence_of(game, "li_laotai", FLOOD_DAMAGED) == 0


def test_a_guess_that_repeats_a_fact_the_person_holds_is_not_made_again():
    game = game_at()
    forget(game, "li_laotai")
    news_for(game, "li_laotai", "pr_dalang_drank")
    hold(game, "li_laotai", DALANG_DAMAGED, 20, source="street")
    assert reflection.speculate(sim_of(game), "li_laotai", since=0) == ""


def test_at_most_one_guess_a_night_and_two_that_exclude_each_other_are_not_held_together():
    game = game_at()
    forget(game, "zhou_zhanggui")
    set_bond(game, "zhou_zhanggui", "li_er", bonds.GRUDGE, 70)
    news_for(game, "zhou_zhanggui", AT_BRIDGE)
    news_for(game, "zhou_zhanggui", "pr_dalang_drank")
    sim = sim_of(game)
    before = set(notes.store(state_of(game)["social"], "zhou_zhanggui")._beliefs)
    first = reflection.speculate(sim, "zhou_zhanggui", since=0)
    after = set(notes.store(state_of(game)["social"], "zhou_zhanggui")._beliefs)
    assert first in (DAMAGED, DALANG_DAMAGED) and after - before == {first}
    # the other guess says that someone else broke the rail: the first is as firm, so it stays
    assert LORE.excludes(LORE.book.props[DAMAGED], LORE.book.props[DALANG_DAMAGED])
    assert reflection.speculate(sim, "zhou_zhanggui", since=0) == ""


def test_the_guess_is_a_belief_like_any_and_can_be_told_on():
    game = game_at()
    forget(game, "li_laotai", "li_da")
    news_for(game, "li_laotai", "pr_dalang_drank")
    sim = sim_of(game)
    assert reflection.speculate(sim, "li_laotai", since=0) == DALANG_DAMAGED
    state = state_of(game)["social"]
    told = telling.tell(sim, state, LORE, "li_laotai", "li_da", DALANG_DAMAGED)
    assert told is not None
    heard = belief_of(game, "li_da", told.prop.id)
    assert (heard.source, heard.teller, heard.hop) == ("heard", "li_laotai", 1)
    if told.claim.path == "belief":  # said as it was held, as a guess
        assert told.claim.modality == "speculate" and heard.modality == "speculate"


# ------------------------------------------------------------------------------ the errands: which


HEAVY_PAGE = {**PAGE, "weather_clear": 0, "weather_light": 0, "weather_heavy": 1}
PROMISE = {
    "id": "m1",
    "by": "li_laotai",
    "item": "bamboo",
    "amount": 4,
    "made": 1000,
    "due": {"day": 1, "hour": 15},
    "start": 1000,
    "due_at": 1100,
    "late_at": 1500,
    "task": 0,
    "state": "delivered",
    "reason": "",
    "ended": EVE - 200,
}


def calm(game, *people: str) -> None:
    """Nothing is told to anyone, nothing is held against anyone: the plans of the test are the
    only ones a person could make."""
    for who in people:
        for other in PEOPLE:
            if other != who:
                set_bond(game, who, other, bonds.TRUST, 0)
                set_bond(game, who, other, bonds.GRUDGE, 0)


def promise_of(game, **fields) -> None:
    state_of(game)["commitments"]["list"].append({**PROMISE, **fields})


def test_the_chance_of_an_errand_is_a_fifth_and_half_the_gossip_trait():
    assert reflection.chance_of(LORE, "cha_laoban") == 20 + 92 // 2
    assert reflection.chance_of(LORE, "zhangfang") == 20 + 10 // 2
    assert all(0 < reflection.chance_of(LORE, who) < 100 for who in PEOPLE)


def test_what_a_person_tells_is_what_they_hold_most_firmly_that_the_other_has_not_heard():
    game = game_at()
    forget(game, "li_laotai", "li_da")
    hold(game, "li_laotai", "pr_dalang_drank", 90)
    hold(game, "li_laotai", "pr_gengfu_round", 70)
    hold(game, "li_laotai", "pr_xiaoman_riverbank", 40)  # held too loosely to be worth a call
    day = night_day(game)
    assert reflection.what_to_tell(day, "li_laotai", "li_da") == "pr_dalang_drank"
    hold(game, "li_da", "pr_dalang_drank", 20)  # heard already, however loosely
    assert reflection.what_to_tell(night_day(game), "li_laotai", "li_da") == "pr_gengfu_round"
    forget(game, "li_da")
    give(game, "pr_gengfu_round", ["gengfu", "li_da", "li_laotai"], confidence=80)  # had from them
    hold(game, "li_laotai", "pr_dalang_drank", 90)
    assert reflection.what_to_tell(night_day(game), "li_laotai", "li_da") == "pr_dalang_drank"
    forget(game, "li_laotai")
    hold(game, "li_laotai", "pr_xiaoman_riverbank", 40)
    assert reflection.what_to_tell(night_day(game), "li_laotai", "li_da") == ""


def test_a_person_does_not_carry_what_they_keep_to_themselves_or_what_everyone_knows():
    game = game_at()
    forget(game, "old_he", "zuzhang")
    hold(game, "old_he", "pr_boat_damaged", 90)  # it blames the boatman
    hold(game, "old_he", "pr_he_under_bridge", 90)  # what his own story says was not so
    hold(game, "old_he", "pr_rail_broken", 95, source="paper")  # the town knows it
    day = night_day(game)
    assert LORE.guards("old_he", LORE.book.props["pr_boat_damaged"])
    assert LORE.guards("old_he", LORE.book.props["pr_he_under_bridge"])
    assert reflection.what_to_tell(day, "old_he", "zuzhang") == ""
    hold(game, "old_he", "pr_gengfu_round", 60)
    assert reflection.what_to_tell(night_day(game), "old_he", "zuzhang") == "pr_gengfu_round"


def test_a_call_is_planned_on_the_trusted_person_where_they_are_by_the_routine():
    game = game_at()
    forget(game, "li_laotai", "li_er")
    calm(game, "li_laotai")
    hold(game, "li_laotai", "pr_dalang_drank", 90)
    set_bond(game, "li_laotai", "li_er", bonds.TRUST, reflection.TELL_TRUST)
    day = night_day(game)
    plan = reflection.feasible(day, "li_laotai")["tell"]
    assert (plan["to"], plan["prop"], plan["day"], plan["state"]) == (
        "li_er",
        "pr_dalang_drank",
        2,
        "planned",
    )
    assert plan["act"] == "chat" and plan["at"] == 0
    # where the other is: the routine of Li Er has him at that place through the stretch
    li_er = world_of(game).cast.people[LORE.index["li_er"]]
    there = [s for s in reflection.stretches(li_er, 2) if s.place == plan["place"]]
    assert any(s.start <= plan["from"] and plan["until"] <= s.end for s in there)
    assert plan["cell"] == list(world_of(game).town.stand(plan["place"], LORE.index["li_er"]))


def test_a_person_is_not_called_on_below_the_trust_that_it_asks():
    game = game_at()
    forget(game, "li_laotai", "li_er")
    calm(game, "li_laotai")
    hold(game, "li_laotai", "pr_dalang_drank", 90)
    set_bond(game, "li_laotai", "li_er", bonds.TRUST, reflection.TELL_TRUST - 1)
    assert "tell" not in reflection.feasible(night_day(game), "li_laotai")


def test_the_trusted_person_is_the_one_trusted_most_who_lacks_something():
    game = game_at()
    forget(game, "li_laotai", "li_er", "li_da")
    calm(game, "li_laotai")
    hold(game, "li_laotai", "pr_dalang_drank", 90)
    set_bond(game, "li_laotai", "li_er", bonds.TRUST, 60)
    set_bond(game, "li_laotai", "li_da", bonds.TRUST, 80)
    assert reflection.feasible(night_day(game), "li_laotai")["tell"]["to"] == "li_da"
    hold(game, "li_da", "pr_dalang_drank", 50)  # he has heard it: the next one is called on
    assert reflection.feasible(night_day(game), "li_laotai")["tell"]["to"] == "li_er"


def test_a_visit_to_the_bridge_is_planned_for_whoever_has_heard_how_it_broke_and_believes_it():
    game = game_at()
    forget(game, "li_laotai")
    calm(game, "li_laotai")
    give(game, DALANG_DAMAGED, ["gengfu", "li_laotai"], confidence=reflection.LOOK_DOUBT)
    plan = reflection.feasible(night_day(game), "li_laotai")["look"]
    assert (plan["place"], plan["act"], plan["stay"], plan["to"]) == (
        "p_bridge",
        "rest",
        reflection.LOOK_TICKS,
        "",
    )
    assert plan["cell"] == list(world_of(game).town.stand("p_bridge", LORE.index["li_laotai"]))


@pytest.mark.parametrize(
    "case",
    ["firm enough but not heard", "heard but too loosely", "not about how it broke", "mended"],
)
def test_and_for_no_one_else_nor_once_the_bridge_is_mended(case):
    game = game_at()
    forget(game, "li_laotai")
    calm(game, "li_laotai")
    if case == "firm enough but not heard":
        hold(game, "li_laotai", DALANG_DAMAGED, 90)
    elif case == "heard but too loosely":
        give(game, DALANG_DAMAGED, ["gengfu", "li_laotai"], confidence=reflection.LOOK_DOUBT - 1)
    elif case == "not about how it broke":
        give(game, "pr_dalang_drank", ["gengfu", "li_laotai"], confidence=80)
    else:
        give(game, DALANG_DAMAGED, ["gengfu", "li_laotai"], confidence=80)
        state_of(game)["goals"]["flags"]["bridge_fixed"] = EVE - 10
    assert "look" not in reflection.feasible(night_day(game), "li_laotai")


def test_a_hand_at_the_bridge_is_planned_for_whoever_joined_the_call_for_the_helpers():
    game = game_at()
    forget(game, "li_laotai", "zhou_niangzi")
    calm(game, "li_laotai", "zhou_niangzi")
    assert reflection.feasible(night_day(game), "li_laotai") == {}
    state_of(game)["goals"]["call"]["joined"].append(["li_laotai", 300, 0, "call"])
    plan = reflection.feasible(night_day(game), "li_laotai")["help"]
    assert (plan["place"], plan["act"], plan["stay"]) == (
        "p_bridge",
        "work",
        reflection.HELP_TICKS,
    )
    assert reflection.feasible(night_day(game), "zhou_niangzi") == {}  # who did not join
    state_of(game)["goals"]["flags"]["bridge_fixed"] = EVE - 10  # nothing left to lend a hand to
    assert reflection.feasible(night_day(game), "li_laotai") == {}


def test_a_hand_at_the_bridge_is_planned_for_whoever_kept_a_promise_to_the_manager_lately():
    game = game_at()
    forget(game, "li_laotai")
    calm(game, "li_laotai")
    promise_of(game)
    plan = reflection.feasible(night_day(game), "li_laotai")["help"]
    assert (plan["place"], plan["act"], plan["stay"]) == (
        "p_bridge",
        "work",
        reflection.HELP_TICKS,
    )


@pytest.mark.parametrize(
    ("case", "fields"),
    [
        ("long ago", {"ended": EVE - 3 * CYCLE}),
        ("somebody else", {"by": "li_da"}),
        ("not kept", {"state": "broken", "reason": "late"}),
    ],
)
def test_and_for_no_one_else(case, fields):
    game = game_at()
    forget(game, "li_laotai")
    calm(game, "li_laotai")
    promise_of(game, **fields)
    assert "help" not in reflection.feasible(night_day(game), "li_laotai")


def test_staying_home_is_planned_for_whoever_would_meet_a_person_they_hold_a_grudge_against():
    game = game_at()
    plans = {}
    for who in PEOPLE:
        calm(game, who)
        for other in PEOPLE:
            if other != who:
                set_bond(game, who, other, bonds.GRUDGE, reflection.AVOID_AT)
    day = night_day(game)
    for who in PEOPLE:
        plan = reflection.avoid_plan(day, who)
        if plan is not None:
            plans[who] = plan
    assert plans, "somebody meets somebody in a free stretch of the routine"
    for who, plan in plans.items():
        mine = [s for s in day.free(who) if s.start == plan["from"] and s.end == plan["until"]]
        assert mine and mine[0].place != LORE.home[who]
        assert plan["place"] == LORE.home[who] and plan["act"] == "rest" and plan["prop"] == ""
        foe = world_of(game).cast.people[LORE.index[plan["to"]]]
        assert any(
            s.place == mine[0].place and min(s.end, mine[0].end) - max(s.start, mine[0].start) > 0
            for s in reflection.stretches(foe, 2)
        )
    for who in PEOPLE:  # one point under: no grudge is enough to keep away
        for other in PEOPLE:
            if other != who:
                set_bond(game, who, other, bonds.GRUDGE, reflection.AVOID_AT - 1)
    assert all(reflection.avoid_plan(night_day(game), who) is None for who in PEOPLE)


def all_the_kinds(game, who: str):
    """Set up ``who`` so that every kind can be done, and the plans they would make."""
    forget(game, who, "li_er")
    calm(game, who)
    hold(game, who, "pr_dalang_drank", 90)
    set_bond(game, who, "li_er", bonds.TRUST, 70)
    give(game, DALANG_DAMAGED, ["gengfu", who], confidence=60)
    promise_of(game, by=who)
    return reflection.feasible(night_day(game), who)


def test_a_person_with_a_task_in_hand_or_a_promise_still_open_is_sent_nowhere():
    game = game_at(dev_actions=1, **PAGE)
    base = all_the_kinds(game, "li_laotai")
    assert {"tell", "help", "look"} <= set(base)
    from bridge_helpers import assign_body, player

    step(game, player(0, assign_body("a1", "li_laotai", kind="goto", place="p_bridge")))
    assert reflection.feasible(night_day(game), "li_laotai") == {}
    other = game_at(dev_actions=1, **PAGE)
    all_the_kinds(other, "li_laotai")
    promise_of(other, id="m2", by="li_laotai", state="promised", ended=-1)
    assert reflection.feasible(night_day(other), "li_laotai") == {}


def test_on_a_day_of_heavy_rain_nobody_is_sent_anywhere():
    game = game_at(**HEAVY_PAGE)
    assert night_day(game).raining()
    base = game_at()
    all_the_kinds(base, "li_laotai")
    for who in PEOPLE:
        assert reflection.feasible(night_day(game), who) == {}
    pass_at_hand(game)
    assert state_of(game)["reflection"]["plans"] == {}


def test_a_person_chosen_by_the_chance_picks_the_kind_the_draw_names_among_those_that_can_be_done():
    game = game_at()
    found = all_the_kinds(game, "li_laotai")
    kinds = [kind for kind in reflection.KINDS if kind in found]
    assert len(kinds) >= 3
    day = night_day(game)
    chance = reflection.chance_of(LORE, "li_laotai")
    for drawn, kind in enumerate(kinds):
        assert reflection.choose(day, "li_laotai", 0, drawn)["kind"] == kind
    assert reflection.choose(day, "li_laotai", chance, 0) is None
    assert reflection.choose(day, "li_laotai", 99, 0) is None
    assert reflection.choose(day, "li_laotai", chance - 1, 0) is not None


def test_a_plan_never_asks_a_person_to_leave_work_a_meal_a_meeting_or_the_night():
    game = game_at()
    day = night_day(game)
    base = base_of(2)
    free = {p: day.free(p) for p in PEOPLE}
    assert sum(len(v) for v in free.values()) >= 20
    for who, stretches in free.items():
        person = world_of(game).cast.people[LORE.index[who]]
        for s in stretches:
            assert s.start >= base + reflection.START_FROM and s.end <= base + reflection.HOME_BY
            assert s.end - s.start >= reflection.MIN_STRETCH
            routine = [r for r in reflection.stretches(person, 2) if r.start <= s.start < r.end]
            assert routine and routine[0].act in reflection.FREE_ACTS
            if routine[0].place in reflection.MEETING_PLACES:
                assert s.end <= base + reflection.MEETING_FROM
    # a person in the middle of the evening at the teahouse stays there
    teahouse_evening = [
        (who, s)
        for who, stretches in free.items()
        for s in stretches
        if s.place in reflection.MEETING_PLACES and s.end > base + reflection.MEETING_FROM
    ]
    assert teahouse_evening == []


def test_nobody_is_sent_out_of_the_hours_the_table_of_evidence_expects_them_at_their_place():
    """The night watchman has his three items from three in the afternoon of the fourth day, the boy
    by the river his from five on the third, and so on: in those hours, from those days, they are
    where the routine puts them, and no detour is made of a stretch that falls in them."""
    cast = world_of(bridge(1)).cast
    held = 0
    for item in SCRIPT["evidence"]:
        acquire = item["acquire"]
        for who in (acquire["from"],):
            if who not in LORE.index:
                continue
            low, high = acquire["daily"]
            for day in range(1, 6):
                began = (day - 1) * 1440
                if began + high <= acquire.get("since", 0):
                    continue
                if acquire.get("until") is not None and began + low >= acquire["until"]:
                    continue
                window = (
                    base_of(day) + (low - 360) * 2,
                    base_of(day) + (high - 360) * 2,
                )
                for stretch in reflection.free_stretches(cast.people[LORE.index[who]], day):
                    assert stretch.end <= window[0] or stretch.start >= window[1], (who, day)
                    held += 1
    assert held >= 5
    gengfu = cast.people[LORE.index["gengfu"]]
    assert reflection.free_stretches(gengfu, 3) and not reflection.free_stretches(gengfu, 4)


def test_the_hour_of_the_meeting_is_half_past_four_and_the_walk_home_is_done_by_half_past_eight():
    assert reflection.MEETING_FROM == 10 * clock.DAY_TICKS_PER_HOUR + 60
    assert reflection.HOME_BY == 14 * clock.DAY_TICKS_PER_HOUR + 60
    assert (
        clock.at(reflection.MEETING_FROM).hour == 16
        and clock.at(reflection.MEETING_FROM).minute == 30
    )
    assert clock.at(reflection.HOME_BY).hour == 20 and clock.at(reflection.HOME_BY).minute == 30


# ------------------------------------------------------------------------------ the errands: done


def cheb(npc: dict, cell) -> int:
    return max(abs(npc["x"] - cell[0]), abs(npc["y"] - cell[1]))


def npc_of(game, who: str) -> dict:
    return next(n for n in state_of(game)["npcs"]["list"] if n["id"] == who)


def run_plan(game, who: str, plan: dict, after: int = 60):
    """Give ``who`` the errand ``plan`` as the pass would have, and play on past its end: the
    events, the frames and, tick by tick, what the person was doing and where they stood."""
    section = state_of(game)["reflection"]
    section["plans"][who] = plan
    section["last"] = 1  # the pass of the night is as good as made
    events, frames, trail = [], [], []
    while game.tick < plan["until"] + after:
        out = step(game)
        events += out["events"]
        frames.append(out["frame"])
        npc = npc_of(game, who)
        trail.append((game.tick, npc["mode"], npc["place"], npc["act"], dict(npc)))
    return events, frames, trail


def errands_in(events: list) -> list:
    return [e for e in events if e["kind"] == "errand"]


def test_a_call_is_carried_out_where_the_other_is_and_the_telling_is_the_towns_own():
    game = game_at()
    forget(game, "li_laotai", "li_er")
    calm(game, "li_laotai")
    hold(game, "li_laotai", "pr_dalang_drank", 90)
    set_bond(game, "li_laotai", "li_er", bonds.TRUST, 70)
    plan = reflection.feasible(night_day(game), "li_laotai")["tell"]
    events, frames, trail = run_plan(game, "li_laotai", plan)
    (done,) = errands_in(events)
    assert (done["npc"], done["errand"], done["state"], done["to"]) == (
        "li_laotai",
        "tell",
        "done",
        "li_er",
    )
    told = [e for e in events if e["kind"] == "told" and e["listener"] == "li_er"]
    assert len(told) >= 1 and told[0]["speaker"] == "li_laotai"
    assert plan["from"] <= told[0]["tick"] <= plan["until"]
    # the two stood together when it was said, and she had been on a detour to get there
    at_the_telling = [row for row in trail if row[0] == told[0]["tick"] + 1][0]
    assert any(row[1] == "detour" for row in trail if row[0] <= told[0]["tick"] + 1)
    assert cheb(at_the_telling[4], plan["cell"]) <= 1 and at_the_telling[2] == plan["place"]
    # a dot goes from one to the other, like any telling of the town
    dots = [d for f in frames for d in f["dots"] if d["from"] == "li_laotai" and d["to"] == "li_er"]
    assert dots and dots[0]["topic"] in ("blame", "clear", "other")
    heard = [b for b in notes.store(state_of(game)["social"], "li_er") if b.teller == "li_laotai"]
    assert heard and heard[0].source == "heard" and heard[0].hop >= 1
    assert state_of(game)["reflection"]["log"][-1][1:] == ["tell", "li_laotai", "li_er"]
    # she is back at the routine once it is done
    assert trail[-1][1] == "routine"


@pytest.mark.parametrize(("kind", "act"), [("look", "rest"), ("help", "work")])
def test_a_visit_is_made_at_the_bridge_for_a_while_and_the_person_goes_back_to_the_routine(
    kind, act
):
    game = game_at()
    forget(game, "li_laotai")
    calm(game, "li_laotai")
    give(game, DALANG_DAMAGED, ["gengfu", "li_laotai"], confidence=60)
    promise_of(game)
    plan = reflection.feasible(night_day(game), "li_laotai")[kind]
    events, _, trail = run_plan(game, "li_laotai", plan)
    (done,) = errands_in(events)
    assert (done["errand"], done["state"], done["place"]) == (kind, "done", "p_bridge")
    bridge_cell = world_of(game).town.stand("p_bridge", LORE.index["li_laotai"])
    there = [row for row in trail if row[1] == "detour" and cheb(row[4], bridge_cell) <= 1]
    assert len(there) >= reflection.LOOK_TICKS // 2
    assert all(row[3] == act for row in there)
    assert state_of(game)["reflection"]["plans"]["li_laotai"]["at"] > 0
    assert state_of(game)["reflection"]["going"] == {}
    assert trail[-1][1] == "routine" and trail[-1][2] != "p_bridge"


def test_a_stretch_to_keep_away_is_spent_at_home():
    game = game_at()
    day = None
    found = None
    for who in PEOPLE:
        calm(game, who)
        for other in PEOPLE:
            if other != who:
                set_bond(game, who, other, bonds.GRUDGE, 80)
    day = night_day(game)
    for who in PEOPLE:
        found = reflection.avoid_plan(day, who)
        if found is not None:
            break
    assert found is not None
    events, _, trail = run_plan(game, who, found)
    (done,) = errands_in(events)
    assert (done["errand"], done["state"]) == ("avoid", "done")
    middle = [row for row in trail if found["from"] + 60 <= row[0] < found["until"]]
    assert middle and all(row[1] == "detour" and row[2] == LORE.home[who] for row in middle)
    assert trail[-1][1] in ("routine", "curfew")


def test_an_errand_that_is_not_done_in_time_lapses_and_the_person_is_back_to_the_routine():
    game = game_at()
    forget(game, "li_laotai")
    calm(game, "li_laotai")
    give(game, DALANG_DAMAGED, ["gengfu", "li_laotai"], confidence=60)
    plan = reflection.feasible(night_day(game), "li_laotai")["look"]
    short = {**plan, "until": plan["from"] + 6}  # no time to get there
    events, _, trail = run_plan(game, "li_laotai", short, after=40)
    (lapsed,) = errands_in(events)
    assert (lapsed["state"], lapsed["why"]) == ("lapsed", "time")
    assert state_of(game)["reflection"]["log"] == []
    assert trail[-1][1] == "routine"


def test_a_call_on_a_person_who_is_not_there_lapses_when_the_stretch_is_over():
    game = game_at()
    forget(game, "li_laotai", "cha_laoban")
    calm(game, "li_laotai")
    hold(game, "li_laotai", "pr_dalang_drank", 90)
    plan = reflection.visit_plan(night_day(game), "li_laotai", "look")
    far = {**plan, "kind": "tell", "act": "chat", "to": "cha_laoban", "prop": "pr_dalang_drank"}
    events, _, _ = run_plan(game, "li_laotai", far, after=20)
    (lapsed,) = errands_in(events)
    assert (lapsed["errand"], lapsed["state"], lapsed["why"]) == ("tell", "lapsed", "time")
    assert not [e for e in events if e["kind"] == "told" and e["listener"] == "cha_laoban"]


def test_a_call_whose_news_the_other_has_had_from_someone_else_since_is_given_up():
    game = game_at()
    forget(game, "li_laotai", "li_er")
    calm(game, "li_laotai")
    hold(game, "li_laotai", "pr_dalang_drank", 90)
    set_bond(game, "li_laotai", "li_er", bonds.TRUST, 70)
    plan = reflection.feasible(night_day(game), "li_laotai")["tell"]
    hold(game, "li_er", "pr_dalang_drank", 30, source="street")  # heard in the meantime
    events, _, _ = run_plan(game, "li_laotai", plan)
    (lapsed,) = errands_in(events)
    assert (lapsed["state"], lapsed["why"]) == ("lapsed", "moot")
    assert not [e for e in events if e["kind"] == "told" and e["speaker"] == "li_laotai"]


def test_a_task_that_is_posted_comes_first_and_the_errand_waits_for_it():
    from bridge_helpers import assign_body, player

    game = game_at(dev_actions=1, **PAGE)
    forget(game, "li_laotai")
    calm(game, "li_laotai")
    give(game, DALANG_DAMAGED, ["gengfu", "li_laotai"], confidence=60)
    plan = reflection.feasible(night_day(game), "li_laotai")["look"]
    section = state_of(game)["reflection"]
    section["plans"]["li_laotai"] = plan
    section["last"] = 1
    run_to(game, plan["from"] - 5)
    step(game, player(0, assign_body("a1", "li_laotai", kind="goto", place="p_ferry")))
    waited = []
    while state_of(game)["tasks"]["queue"] and game.tick < plan["until"]:
        step(game)
        if state_of(game)["tasks"]["queue"]:
            waited.append((section["plans"]["li_laotai"]["state"], dict(section["going"])))
    assert waited and all(row == ("planned", {}) for row in waited)
    for _ in range(3):
        step(game)
    assert section["plans"]["li_laotai"]["state"] == "going"
    assert "li_laotai" in section["going"]
    assert npc_of(game, "li_laotai")["mode"] == "detour"


def test_an_errand_of_a_day_of_heavy_rain_is_given_up_at_once():
    game = game_at(**HEAVY_PAGE)
    forget(game, "li_laotai")
    calm(game, "li_laotai")
    plan = reflection.visit_plan(night_day(game), "li_laotai", "look")
    assert plan is not None
    events, _, trail = run_plan(game, "li_laotai", plan, after=20)
    (lapsed,) = errands_in(events)
    assert (lapsed["state"], lapsed["why"]) == ("lapsed", "rain")
    assert all(row[1] != "detour" for row in trail)


def test_the_world_with_no_reflection_has_no_pass_and_no_errand():
    game = game_at(reflect=0, **PAGE)
    assert state_of(game)["reflection"]["last"] == 0
    seen = []
    run_to(game, at(2, 12), each=lambda out: seen.extend(e["kind"] for e in out["events"]))
    assert "reflected" not in seen and "errand" not in seen
    section = state_of(game)["reflection"]
    assert section["plans"] == {} and section["going"] == {} and not any(section["counts"].values())
    assert world_of(game).config["reflect"] == 0


# ------------------------------------------------------------------------------ whole games


class Played:
    """A game of the page's rules with no manager, played through four nights: the events, what the
    pass planned each night, when each person was on a detour, and the paper of each morning."""

    def __init__(self, seed: int, nights: int = 4, **config) -> None:
        self.seed = seed
        self.game = bridge(seed, **(config or PAGE))
        self.events: list[dict] = []
        self.plans: dict[int, dict] = {}  # by the day the pass was made for
        self.before: dict[int, dict] = {}  # the plans of the day, as they stood at the pass
        self.detours: dict[str, list[tuple[int, str]]] = {}
        self.papers: list[tuple[int, list[str], list[str]]] = []
        self.frames: list[dict] = []
        self.teahouse: dict[int, list[str]] = {}  # who stood at the teahouse at five past six
        end = nights * CYCLE + at(1, 7)
        while self.game.tick < end:
            tick = self.game.tick
            if clock.at(tick).hour == 23 and clock.at(tick).phase_tick % 30 == 0:
                self.before[clock.at(tick).day] = json.loads(json.dumps(self.section["plans"]))
            out = step(self.game)
            self.events += out["events"]
            frame = out["frame"]
            if out["tick"] % 7 == 0:
                self.frames.append(frame)
            if any(e["kind"] == "reflected" for e in out["events"]):
                day = clock.at(tick).day
                self.plans[day] = json.loads(json.dumps(self.section["plans"]))
            if frame["gazette"] is not None:
                self.papers.append(
                    (
                        out["tick"],
                        [row["kind"] for row in frame["gazette"]["talk"]],
                        [frame["gazette"]["head"]["kind"]]
                        + [row["kind"] for row in frame["gazette"]["news"]],
                    )
                )
            for npc in state_of(self.game)["npcs"]["list"]:
                if npc["mode"] == "detour":
                    self.detours.setdefault(npc["id"], []).append((tick, npc["place"]))
            now = clock.at(tick)
            if (now.hour, now.minute) == (18, 4) and now.phase == "day":
                self.teahouse[now.day] = [
                    n["id"]
                    for n in state_of(self.game)["npcs"]["list"]
                    if n["place"] == "p_teahouse" and gossip.at_goal(n) and not gossip.asleep(n)
                ]

    @property
    def section(self) -> dict:
        return state_of(self.game)["reflection"]


_PLAYED: dict[int, Played] = {}


def played(seed: int = 3) -> Played:
    if seed not in _PLAYED:
        _PLAYED[seed] = Played(seed)
    return _PLAYED[seed]


@pytest.fixture(scope="module", params=[3, 5])
def nights(request):
    return played(request.param)


def test_the_pass_is_made_once_a_night_at_eleven_for_the_twenty_in_cast_order_not_on_the_last(
    nights,
):
    reflected = [e for e in nights.events if e["kind"] == "reflected"]
    assert len(reflected) == 4 * 20
    assert sorted({e["tick"] for e in reflected}) == [at(d, 23) for d in (1, 2, 3, 4)]
    for night in range(4):
        assert [e["npc"] for e in reflected[night * 20 : (night + 1) * 20]] == PEOPLE
    assert nights.section["last"] == 4 and nights.section["counts"]["passes"] == 4
    assert nights.section["since"] == at(4, 23)


def test_the_counts_of_the_state_are_the_sum_of_what_the_events_say(nights):
    counts = nights.section["counts"]
    reflected = [e for e in nights.events if e["kind"] == "reflected"]
    assert counts["firmer"] == sum(e["firmer"] for e in reflected)
    assert counts["weaker"] == sum(e["weaker"] for e in reflected)
    assert counts["guesses"] == sum(1 for e in reflected if e["guess"])
    for kind in reflection.KINDS:
        assert counts[f"planned_{kind}"] == sum(1 for e in reflected if e["errand"] == kind)
        ended = [e for e in nights.events if e["kind"] == "errand" and e["errand"] == kind]
        assert counts[f"done_{kind}"] == sum(1 for e in ended if e["state"] == "done")
        assert counts[f"lapsed_{kind}"] == sum(1 for e in ended if e["state"] == "lapsed")
    assert set(counts) == set(reflection.COUNT_KEYS)


def test_somebody_gets_firmer_somebody_gets_less_firm_and_errands_are_made_and_done(nights):
    counts = nights.section["counts"]
    assert counts["weaker"] >= 1
    assert sum(counts[f"planned_{kind}"] for kind in reflection.KINDS) >= 8
    assert sum(counts[f"done_{kind}"] for kind in reflection.KINDS) >= 5
    assert counts["done_tell"] >= 1


def test_nobody_has_more_than_one_errand_a_night_and_every_one_is_on_the_closed_list(nights):
    assert sorted(nights.plans) == [1, 2, 3, 4]
    for day, plans in nights.plans.items():
        assert set(plans) <= set(PEOPLE)
        for plan in plans.values():
            assert plan["kind"] in reflection.KINDS and plan["day"] == day + 1
            assert plan["act"] == reflection.ACTS[plan["kind"]]
            assert set(plan) == {
                "kind", "day", "place", "act", "from", "until", "to", "prop", "cell", "stay",
                "state", "at",
            }  # fmt: skip
            assert (plan["to"] != "") == (plan["kind"] in ("tell", "avoid"))
            assert (plan["prop"] != "") == (plan["kind"] == "tell")
            assert (plan["stay"] > 0) == (plan["kind"] in ("look", "help"))


def test_every_errand_is_a_detour_of_a_free_stretch_and_is_over_before_the_evening_meeting(nights):
    cast = world_of(nights.game).cast
    for day, plans in nights.plans.items():
        base = base_of(day + 1)
        for who, plan in plans.items():
            free = reflection.free_stretches(cast.people[LORE.index[who]], day + 1)
            inside = [s for s in free if s.start <= plan["from"] and plan["until"] <= s.end]
            assert inside, (who, plan)
            assert plan["from"] >= base + reflection.START_FROM
            assert plan["until"] <= base + reflection.HOME_BY
            if inside[0].place in reflection.MEETING_PLACES:
                assert plan["until"] <= base + reflection.MEETING_FROM


def test_every_errand_has_ended_by_the_next_pass_and_none_is_left_going_at_night(nights):
    for day, plans in nights.before.items():
        for who, plan in plans.items():
            assert plan["state"] in reflection.ENDED, (day, who, plan)
    assert all(
        clock.at(tick).phase == "day" for rows in nights.detours.values() for tick, _ in rows
    )
    assert nights.section["going"] == {}


def test_a_person_is_on_a_detour_only_while_the_stretch_of_their_errand_is_open(nights):
    for who, rows in nights.detours.items():
        for tick, _ in rows:
            day = clock.at(tick).day
            plan = nights.plans.get(day - 1, {}).get(who)
            assert plan is not None, (who, tick)
            # (the walk is decided before the section sets the person off or calls them back)
            assert plan["from"] <= tick <= plan["until"], (who, tick, plan["from"], plan["until"])
    assert nights.detours, "somebody went on a detour"


def test_nobody_is_sent_to_the_teahouse_or_the_hall_for_the_evening_of_a_meeting(nights):
    for day, plans in nights.plans.items():
        for who, plan in plans.items():
            if plan["place"] in reflection.MEETING_PLACES:
                assert plan["until"] <= base_of(day + 1) + reflection.MEETING_FROM, (who, plan)


def test_those_at_the_teahouse_in_the_evening_are_the_ones_the_routine_puts_there(nights):
    cast = world_of(nights.game).cast
    assert sorted(nights.teahouse) == [1, 2, 3, 4]
    for day, there in nights.teahouse.items():
        tick = at(day, 18, 4)
        by_routine = sorted(
            p.id for p in cast.people if p.entry_at(clock.at(tick).cycle_tick)[2] == "p_teahouse"
        )
        assert sorted(there) == by_routine, (day, there, by_routine)


def test_every_call_that_was_done_was_an_ordinary_telling_to_the_person(nights):
    done = [
        e
        for e in nights.events
        if e["kind"] == "errand" and e["errand"] == "tell" and e["state"] == "done"
    ]
    assert done
    for call in done:
        told = [
            e
            for e in nights.events
            if e["kind"] == "told"
            and e["tick"] == call["tick"]
            and e["speaker"] == call["npc"]
            and e["listener"] == call["to"]
        ]
        assert len(told) == 1, call
        social = state_of(nights.game)["social"]
        assert told[0]["claim"] in social["claims"]


def test_the_events_of_the_pass_are_for_tools_and_the_frame_has_no_key_for_it(nights):
    for event in nights.events:
        if event["kind"] in ("reflected", "errand"):
            assert not projection.visible(event)
    assert projection.mark_of("gazette.talk[]") == "public"
    for frame in nights.frames:
        assert projection.problems(frame) == []
        assert "reflection" not in frame and "errands" not in frame


def test_the_events_of_the_pass_carry_no_belief_in_the_frame_of_the_player(nights):
    """The player is shown people walking about and tellings, and what the paper says of them."""
    for frame in nights.frames:
        text = json.dumps(frame, sort_keys=True)
        for word in ("reflected", "firmer", "weaker", "guess"):
            assert word not in text


def test_the_paper_has_a_line_of_street_talk_for_the_errands_of_the_day_before_and_names_no_one(
    nights,
):
    said = SCRIPT["paper"]["talk"]
    walks = {"walk_look", "walk_call", "walk_hand"}
    seen = False
    for tick, talk, _ in nights.papers:
        done = [
            e
            for e in nights.events
            if e["kind"] == "errand"
            and e["state"] == "done"
            and e["errand"] in reflection.PUBLIC_KINDS
            and tick - clock.CYCLE_TICKS < e["tick"] <= tick
        ]
        kinds = [k for k in talk if k in walks]
        street = [k for k in talk if k not in walks]
        assert len(talk) <= gazette.TALK_LINES and len(kinds) <= 1, (tick, talk)
        if not done:
            assert kinds == [], (tick, talk)
        elif not kinds:  # no room: the street has two lines that are news
            assert len(street) == 2 and street[1] not in gazette.STANDING, (tick, talk)
        seen |= bool(kinds)
        if kinds:
            counts = {k: sum(1 for e in done if e["errand"] == k) for k in reflection.TALK_OF}
            top = max(counts.values())
            assert (
                kinds == [reflection.TALK_OF[k] for k in reflection.TALK_OF if counts[k] == top][:1]
            )
    assert seen
    for kind in walks:
        for lang in ("zh", "en"):
            words = said[kind][lang]
            assert not any(name in words for name in ("李", "周", "老何", "Zhou", "Li", "Granny"))
            assert "{" not in words and ";" not in words and "；" not in words


def test_the_paper_of_a_morning_says_the_same_of_the_news_whichever_story_is_true():
    """The street talk reads the errands, which differ with what people hold. The news does not."""
    heads = {}
    for variant in ("v_boat", "v_flood", "v_drunk"):
        game = bridge(3, variant=variant, **PAGE)
        rows = []
        while game.tick < at(3, 8):
            out = step(game)
            gaz = out["frame"]["gazette"]
            if gaz is not None:
                rows.append((out["tick"], gaz["head"], gaz["news"]))
        heads[variant] = rows
    assert heads["v_boat"] == heads["v_flood"] == heads["v_drunk"]
    assert heads["v_boat"]


def test_the_walkers_have_the_room_that_is_left_and_the_place_of_a_standing_line():
    room = gazette._room_for_the_walkers
    assert gazette.TALK_LINES == 2  # the card of the page has room for two
    assert room(["festival_warm"], ["walk_look"]) == ["festival_warm", "walk_look"]
    assert room(["festival_warm", "peace"], ["walk_look"]) == ["festival_warm", "peace"]
    assert room(["festival_cool", "li_more"], ["walk_call"]) == ["festival_cool", "li_more"]
    for standing in gazette.STANDING:
        assert room(["festival_cool", standing], ["walk_call"]) == ["festival_cool", "walk_call"]
        assert room(["festival_cool", standing], []) == ["festival_cool", standing]
    assert room([], ["walk_hand"]) == ["walk_hand"]


def test_street_kinds_say_the_kind_done_most_often_since_the_last_morning_and_nothing_else():
    rows = [
        [100, "look", "a", ""],
        [150, "tell", "b", "c"],
        [160, "tell", "d", "e"],
        [170, "help", "f", ""],
        [180, "avoid", "g", "h"],
    ]
    state = {"reflection": {"log": rows}}
    assert reflection.street_kinds(state, 0, 200) == ["walk_call"]
    assert reflection.street_kinds(state, 100, 200) == ["walk_call"]
    assert (
        reflection.street_kinds(state, 155, 200)
        == [
            "walk_call",
        ][:1]
    )
    assert reflection.street_kinds(state, 160, 200) == ["walk_hand"]
    assert reflection.street_kinds(state, 170, 200) == []
    assert reflection.street_kinds(state, 0, 120) == ["walk_look"]
    assert reflection.street_kinds(state, 200, 300) == []
    tie = {"reflection": {"log": [[10, "help", "a", ""], [11, "look", "b", ""]]}}
    assert reflection.street_kinds(tie, 0, 20) == ["walk_look"]
    assert reflection.street_kinds({}, 0, 20) == []


# ------------------------------------------------------------------------------ the card


def test_a_note_of_what_somebody_only_guesses_bears_on_nothing_on_the_statement_card():
    from lantern_core.cognition.beliefs import Belief
    from lantern_core.world.bridge import statement

    def entry(modality: str) -> dict:
        belief = Belief(
            "player", BOAT_DAMAGED, modality, 40, "heard", "li_laotai", "li_laotai", 1, 5, "c1"
        )
        return {"id": "n1", "prop": BOAT_DAMAGED, "note": notes.encode_belief(belief)}

    cause = statement.part_of("cause")
    told = {"notebook": [entry("assert")], "statement": {}}
    guessed = {"notebook": [entry("speculate")], "statement": {}}
    assert [o["id"] for o in statement.shown(told, cause) if o["support"]] == ["boat"]
    assert statement.shown(guessed, cause) == []
    assert statement.fillable(told) and not statement.fillable(guessed)
    bare = {"notebook": [{"id": "n1", "prop": BOAT_DAMAGED}], "statement": {}}  # no note kept
    assert [o["id"] for o in statement.shown(bare, cause) if o["support"]] == ["boat"]


# ------------------------------------------------------------------------------ replays


def test_two_games_of_one_seed_think_the_same_nights_and_another_seed_another():
    a, b = played(3), Played(3)
    assert a.game.hash() == b.game.hash()
    assert a.section == b.section and a.plans == b.plans and a.papers == b.papers
    assert played(3).section != played(11).section


def test_a_game_restored_in_the_middle_of_an_errand_goes_on_the_same():
    reference = played(3)
    going = next((tick for who, rows in reference.detours.items() for tick, _ in rows[20:21]), None)
    assert going is not None
    game = bridge(3, **PAGE)
    run_to(game, going)
    assert state_of(game)["reflection"]["going"], "an errand is in hand"
    twin = Game.from_snapshot_json(game.snapshot_json())
    assert twin.hash() == game.hash()
    for _ in range(400):
        step(game)
        step(twin)
        assert twin.hash() == game.hash()
    assert twin.snapshot_json() == game.snapshot_json()


def test_the_night_replays_from_the_record_of_the_game():
    from lantern_core.replay import Recorder, rebuild

    game = bridge(7, **PAGE)
    recorder = Recorder(game)
    while game.tick < at(2, 8):
        recorder.step("[]")
    recording = recorder.recording()
    again = rebuild(recording)
    assert again.hash() == game.hash()
    assert state_of(again)["reflection"] == state_of(game)["reflection"]
    assert state_of(game)["reflection"]["counts"]["passes"] == 1


def test_nothing_in_the_section_depends_on_the_order_of_the_keys_of_a_dict():
    from lantern_core.kernel import Kernel

    def flipped(value):
        if isinstance(value, dict):
            return {key: flipped(value[key]) for key in reversed(list(value))}
        if isinstance(value, list):
            return [flipped(item) for item in value]
        return value

    game = bridge(3, **PAGE)
    run_to(game, at(2, 10))
    state = json.loads(game.snapshot_json())
    assert state["world"]["reflection"]["plans"]
    twin = Game.__new__(Game)
    twin._kernel = Kernel.restore(flipped(state))
    assert twin.hash() == game.hash()
    for _ in range(600):
        step(game)
        step(twin)
    assert twin.hash() == game.hash()
