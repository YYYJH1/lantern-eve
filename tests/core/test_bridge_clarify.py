"""The clarification at the teahouse, Granny Li's objection and Li Da's word.

The first evening of the slice: the manager has been to Granny Li, the madam and the clerk, and
stands at the teahouse, where the elder, the madam, the clerk, Granny Li and her eldest son are
together. They say in public that what the madam told Granny Li goes beyond what the clerk saw (the
action ``speak`` with the kind ``clarify``). Whoever is there takes a stand and says why. Granny Li,
if she took it in, withdraws her objection to lending the bamboo, and Li Da agrees to bring it only
once he knows of it himself.

The snapshot of the evening is made once and every test starts from it. The notebook of the manager
there is ``n1`` the madam's version (heard from Granny Li at six hands), ``n2`` that Li Er was at
the bridge (what the clerk saw), ``n3`` the clerk's own hearsay that it was on purpose and ``n4``
that Li Er was looking for his lantern.
"""

from __future__ import annotations

import json
import random

import pytest
import slice_driver
from agenda_helpers import frame_now, meet, slice_game, tasks_of
from bridge_helpers import TOWN, at, npc_of, run_to, state_of, step
from dealings_helpers import believe, know, stored, talking, tell, trust, trust_of
from player_helpers import acks, act, beside, events, me, plain, silence
from voice_helpers import says

from bots.base import Obs
from lantern_core import canon
from lantern_core.api import Game
from lantern_core.inputs import InputError
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import (
    agenda_terms,
    assembly,
    clarify,
    clock,
    commitments,
    judge,
    notebook,
    notes,
    objection,
    opening,
    pace,
    persuade,
    voices,
)
from lantern_core.world.bridge.lore import lore

LO = lore()
CLAIM = clarify.CLAIM
SEED = 492
FIVE = ("zuzhang", "cha_laoban", "zhou_huoji", "li_laotai", "li_da")
LI = ("li_laotai", "li_da")
JEALOUS, AT_BRIDGE = "pr_liner_damaged_jealous", "pr_liner_at_bridge"
RUMOURS = ["pr_li_damaged", "pr_li_damaged_on_purpose", "pr_li_damaged_jealous"]


# ------------------------------------------------------------------------------ the evening


@pytest.fixture(scope="module")
def snapshot():
    """The slice at the teahouse in the evening (five to six), after the day of the route."""
    game = slice_game()
    bot = slice_driver.Evening(json.loads(game.scene_json()), SEED)
    bot.stay = -1
    obs = Obs(json.loads(game.step("[]")))
    while game.tick < at(1, 18, 30) and "speak" not in obs.verbs:
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        obs = Obs(json.loads(game.step(json.dumps(records))))
    assert "speak" in obs.verbs and not obs.talking
    return game.snapshot_json()


@pytest.fixture
def evening(snapshot):
    return Game.from_snapshot_json(snapshot)


def clarify_(game, claim="n1", basis=("n2",), **fields):
    """The manager says in public that the claim goes beyond the basis."""
    return act(game, "speak", kind="clarify", claim=claim, basis=list(basis), **fields)


def stands(out):
    """The stand of each person who was there, by person, from the one ``clarified`` event."""
    (event,) = events(out, "clarified")
    return {row["npc"]: row for row in event["audience"]}


def holders(game):
    return sorted(p for p in LO.people if stored(game, p, CLAIM) is not None)


def send_away(game, who, place="p_li_house"):
    """Put a person at a place of their own, out of the teahouse (they would walk back in time)."""
    npc = npc_of(game, who)
    x, y = TOWN.stand(place, LO.index[who])
    npc["place"], npc["x"], npc["y"], npc["goal"] = place, x, y, [x, y]


def confidence_of(game, who, prop):
    belief = stored(game, who, prop)
    return None if belief is None else belief.confidence


def ticks(game, count):
    """Let ``count`` ticks pass and return the outputs of each."""
    return [json.loads(game.step()) for _ in range(count)]


def li_da_asked(game):
    meet(game, "li_da")
    return act(game, "entrust", kind="material")


def promises(game):
    """The promises made to the manager: ``(by, item, amount, state, day, hour)`` of each. The slice
    has the goods promised for a time, so that Li Da's yes is a promise for the next morning and
    no errand yet."""
    return [
        (r["by"], r["item"], r["amount"], r["state"], r["due"]["day"], r["due"]["hour"])
        for r in state_of(game)["commitments"]["list"]
    ]


# ------------------------------------------------------------------------------ the route


def test_the_evening_is_where_the_route_left_it(evening):
    assert clock.at(evening.tick).hour == 17 and evening.tick < at(1, 18, 30)
    section = me(evening)
    assert [e["id"] for e in section["notebook"]] == ["n1", "n2", "n3", "n4"]
    assert not section["talk"] and "clarified" not in section["public"]
    here = assembly.audience(state_of(evening), "p_teahouse")
    assert set(FIVE) <= set(here) and "old_he" not in here  # he comes at twenty-five to seven
    frame = frame_now(evening)
    assert tasks_of(frame)["t_bamboo_first"]["state"] == "blocked"  # Granny Li said no at dawn
    assert tasks_of(frame)["t_tea_tonight"]["state"] == "open"


def test_the_speech_and_li_das_yes_fit_in_the_evening_of_the_teahouse(evening):
    """The five are at the teahouse from the moment the manager can speak, five to six, until Granny
    Li and the elder go at seven. The speech takes half an hour and Li Da's request twenty minutes
    more, and both are over before they go. (The culprit comes at twenty-five to seven, while the
    request is paid for: the speech was made before.)"""
    assert (clock.at(evening.tick).hour, clock.at(evening.tick).minute) == (17, 55)
    assert set(FIVE) <= set(assembly.audience(state_of(evening), "p_teahouse"))
    assert "old_he" not in assembly.audience(state_of(evening), "p_teahouse")
    assert acks(clarify_(evening)) == [("applied", None)]  # the five are there when it is made
    assert li_da_asked(evening) is not None
    act(evening, "leave")
    pay(evening)
    over = clock.at(evening.tick)
    assert (over.hour, over.minute) < (18, 55)  # half an hour and twenty minutes from five to six
    assert [(r["by"], r["due"]["day"], r["due"]["hour"]) for r in promises_rows(evening)] == [
        ("li_da", 2, 7)
    ]


def promises_rows(game):
    return state_of(game)["commitments"]["list"]


def test_the_clarification_the_withdrawal_and_li_das_word_make_the_route_of_the_slice(evening):
    before = {p: trust_of(evening, p) for p in FIVE}
    out = clarify_(evening)
    assert acks(out) == [("applied", None)]
    (event,) = events(out, "clarified")
    assert (event["claim"], event["basis"], event["venue"]) == ("n1", ["n2"], "p_teahouse")
    assert event["prop"] == JEALOUS and event["accepted"] >= 5
    for row in event["audience"]:  # each of them says why in their own voice
        assert row["before"] in ("against", "unsure", "for")
        assert row["after"] in ("against", "unsure", "for")
        assert set(row["reason"]) == {"zh", "en"} and row["reason"]["zh"] and row["reason"]["en"]
    taken = stands(out)
    assert {p for p in FIVE if taken[p]["after"] == "for"} == set(FIVE)
    for person in FIVE:
        assert trust_of(evening, person) == before[person] + clarify.ACCEPT_TRUST
    # Granny Li withdraws her objection and says so, and the task of the bamboo is free again
    (withdrawn,) = events(out, "objection_withdrawn")
    assert (withdrawn["npc"], withdrawn["what"]) == ("li_laotai", "bamboo")
    (bubble,) = (b for b in out["frame"]["bubbles"] if b["npc"] == "li_laotai")
    assert bubble["text"] in voices.variants("li_laotai", "objection_withdrawn")
    tasks = tasks_of(out["frame"])
    bamboo = tasks["t_bamboo_first"]
    assert bamboo["state"] == "open" and bamboo["blocker"] is None
    # and it is Li Da they are sent to now, since the bamboo is his to bring
    assert bamboo["action"] == {"verb": "entrust", "npc": "li_da", "item": "bamboo"}
    assert "李大" in bamboo["next"]["zh"] and "Li Da" in bamboo["next"]["en"]
    assert tasks["t_tea_tonight"]["state"] == "done"  # the evening was spent, and spent well
    assert tasks["t_what_proves"]["state"] == "done"  # judged on the way: nothing is left to prove
    assert tasks["t_clear_rumour"]["state"] == "done"  # and it has been set straight in public
    # Li Da was there, so he knows, and when he is asked he agrees
    out = li_da_asked(evening)
    assert acks(out) == [("applied", None)]
    (asked,) = events(out, "entrusted")
    assert (asked["result"], asked["total"], asked["need"]) == ("agreed", 18, 15)
    assert [(e["npc"], e["what"]) for e in events(out, "agreed")] == [("li_da", "bamboo")]
    first = commitments.rules().batches[
        "bamboo"
    ]  # the one place that says how much he brings first
    assert first == 4 and promises(evening) == [("li_da", "bamboo", first, "promised", 2, 7)]
    assert not state_of(evening)["tasks"]["queue"]  # he sets out at dawn


def test_a_clarification_is_a_speech_in_public_and_the_manager_has_spoken(evening):
    assert persuade.refusal(state_of(evening), "hc_li_bamboo") == "hard_hc_li_bamboo_rumour"
    out = clarify_(evening)
    (event,) = events(out, "clarified")
    (row,) = me(evening)["public"]["speeches"]
    assert row == [evening.tick - 1, "p_teahouse", len(event["audience"]), event["accepted"], 2, 0]
    assert persuade.refusal(state_of(evening), "hc_li_bamboo") == "hard_hc_li_bamboo"  # not silent


def test_the_other_kinds_of_speech_are_as_they_were_and_the_new_one_has_its_fields():
    game = talking("cha_laoban", seed=1)
    world = game._kernel.world
    plain = {"action_id": "a", "type": "speak"}
    assert world.validate_player(plain) == {
        **plain,
        "kind": "evidence",
        "evidence": [],
        "entry": "",
    }
    meal = world.validate_player({**plain, "kind": "meal"})
    assert meal == {**plain, "kind": "meal", "evidence": [], "entry": ""}
    said = world.validate_player({**plain, "kind": "clarify", "claim": "n1", "basis": ["n2"]})
    assert said == {**meal, "kind": "clarify", "claim": "n1", "basis": ["n2"]}
    with_relation = {**plain, "kind": "clarify", "claim": "n1", "basis": [], "judgment": "mismatch"}
    assert world.validate_player(with_relation)["judgment"] == "mismatch"


# ------------------------------------------------------------------------------ the numbers


def test_with_the_witness_there_all_five_of_the_named_take_it_in_and_the_shopkeeper_does_not(
    evening,
):
    taken = stands(clarify_(evening))
    assert [p for p in FIVE if taken[p]["after"] == "for"] == list(FIVE)
    assert taken["zhou_huoji"]["before"] == "against"  # he held the second son's version of it
    assert taken["zhou_huoji"]["reason"] in voices.variants("zhou_huoji", "witness_in_public")
    assert taken["zuzhang"]["reason"] in voices.variants("zuzhang", "elder_yes")
    assert taken["cha_laoban"]["before"] == taken["li_laotai"]["before"] == "unsure"
    # the master of the Zhou house is sure that Li Er did it, and a Zhou: it is not enough for him
    assert taken["zhou_zhanggui"]["before"] == taken["zhou_zhanggui"]["after"] == "against"
    assert taken["zhou_zhanggui"]["reason"] in voices.variants("zhou_zhanggui", "doubted")
    assert confidence_of(evening, "zhou_zhanggui", "pr_liner_damaged") == 87
    assert stored(evening, "zhou_zhanggui", CLAIM) is None


def test_the_target_of_the_slice_with_the_witness_at_least_four_of_the_five_named_accept(evening):
    # by the score alone the clerk falls short (45: he holds at 63 what the second son told him),
    # and he takes it in as the witness, so it is four by the score and five in all
    state = state_of(evening)
    held = clarify.held_against(state, "zhou_huoji", JEALOUS, [AT_BRIDGE])
    assert (held, score(evening, "zhou_huoji", 80, held).accepts) == (63, False)
    by_score = [
        p
        for p in FIVE
        if score(evening, p, 80, clarify.held_against(state, p, JEALOUS, [AT_BRIDGE])).accepts
    ]
    assert by_score == ["zuzhang", "cha_laoban", "li_laotai", "li_da"]
    taken = stands(clarify_(evening))
    assert sum(taken[p]["after"] == "for" for p in FIVE) >= 4
    assert [p for p in FIVE if taken[p]["after"] == "for"] == list(FIVE)


def test_the_target_of_the_slice_with_only_his_words_cited_both_of_the_li_family_accept(evening):
    send_away(evening, "zhou_huoji", "p_zhou_house")
    taken = stands(clarify_(evening))
    assert all(taken[p]["after"] == "for" for p in LI)
    state = state_of(evening)
    for person in LI:  # and at the lowest trust there is, because nothing is held against it
        assert clarify.held_against(state, person, JEALOUS, [AT_BRIDGE]) == 0
        assert score(evening, person, clarify.STRENGTH_CITED, 0).total >= clarify.ACCEPT_AT


def test_with_only_his_words_cited_the_two_of_the_li_family_still_take_it_in(evening):
    send_away(evening, "zhou_huoji", "p_zhou_house")
    assert "zhou_huoji" not in assembly.audience(state_of(evening), "p_teahouse")
    taken = stands(clarify_(evening))
    assert "zhou_huoji" not in taken
    assert all(taken[p]["after"] == "for" for p in LI)
    named = [p for p in FIVE if p in taken]
    assert [p for p in named if taken[p]["after"] == "for"] == ["zuzhang", "cha_laoban", *LI]
    assert stored(evening, "zhou_huoji", CLAIM) is None  # and he, who was away, knows nothing of it


def score(game, person, strength, held):
    return clarify.score_of(state_of(game), person, strength, held)


def test_the_parts_of_a_score_are_the_strength_half_the_trust_and_half_what_is_held():
    assert clarify.Score(80, 31, 70, 10).total == 80 + 15 - 35 - 10 == 50
    assert clarify.Score(60, 0, 0, 0).accepts and not clarify.Score(59, 0, 0, 0).accepts
    assert clarify.ACCEPT_AT == 60
    assert (clarify.STRENGTH_WITNESS, clarify.STRENGTH_CITED) == (80, 60)


def test_a_score_of_sixty_takes_it_in_and_one_point_less_does_not(evening):
    """The elder is sure of the accusation (70) and the witness is there (80): 45 + trust // 2."""
    believe(evening, "zuzhang", "pr_liner_damaged", 70, "heard", "zhou_huoji", "zhou_huoji")
    trust(evening, "zuzhang", 29)
    low = score(evening, "zuzhang", clarify.STRENGTH_WITNESS, 70)
    assert (low.total, low.accepts) == (59, False)
    trust(evening, "zuzhang", 30)
    high = score(evening, "zuzhang", clarify.STRENGTH_WITNESS, 70)
    assert (high.total, high.accepts) == (60, True)
    twin = Game.from_snapshot_json(evening.snapshot_json())  # and so it goes in the speech itself
    trust(twin, "zuzhang", 29)
    assert stands(clarify_(twin))["zuzhang"]["after"] == "against"
    assert stands(clarify_(evening))["zuzhang"]["after"] == "for"


def test_what_a_person_hardly_believes_does_not_count_against_it(evening):
    """Granny Li holds the madam's version at 45: she knows the town says it, and is not sure."""
    state = state_of(evening)
    assert confidence_of(evening, "li_laotai", JEALOUS) == 45
    assert clarify.held_against(state, "li_laotai", JEALOUS, [AT_BRIDGE]) == 0
    assert clarify.held_against(state, "zhou_zhanggui", JEALOUS, [AT_BRIDGE]) == 87
    believe(evening, "li_laotai", JEALOUS, 50, "heard", "cha_laoban", "zhou_huoji", 5)
    assert clarify.held_against(state, "li_laotai", JEALOUS, [AT_BRIDGE]) == 50
    believe(evening, "li_laotai", "pr_liner_damaged", 80, "heard", "cha_laoban", "zhou_huoji", 5)
    assert clarify.held_against(state, "li_laotai", JEALOUS, [AT_BRIDGE]) == 80  # any version


def test_a_zhou_who_holds_a_grudge_against_the_li_family_takes_ten_off(evening):
    state = state_of(evening)
    assert clarify.grudge_penalty(state, "zhou_zhanggui") == clarify.GRUDGE_PENALTY == 10
    assert clarify.grudge_penalty(state, "zuzhang") == 0  # of no family
    assert clarify.grudge_penalty(state, "li_da") == 0  # a Li
    assert score(evening, "zhou_zhanggui", 80, 87).total == 80 + 5 - 43 - 10


# ------------------------------------------------------------------------------ the acceptors


def test_an_acceptor_drops_the_claim_trusts_more_and_takes_in_what_was_said_in_public(evening):
    out = clarify_(evening)
    taken = stands(out)
    for person in ("cha_laoban", "li_laotai"):  # the madam's version, at 45 before
        assert confidence_of(evening, person, JEALOUS) < 20
    assert confidence_of(evening, "zhou_huoji", "pr_liner_damaged_on_purpose") < 20  # and his own
    for person, row in taken.items():
        belief = stored(evening, person, CLAIM)
        if row["after"] == "for":
            assert belief is not None and belief.source == "saw" and belief.hop == 0
            assert belief.confidence == 90 and belief.teller is None  # first hand: they were there
        else:
            assert belief is None
    entry = notebook.by_prop(me(evening), CLAIM)  # and the manager has it in the notebook
    assert entry is not None and entry["id"] == "n5"
    shown = step(evening)["frame"]["notebook"][-1]
    assert shown["id"] == "n5" and shown["source"] == {"kind": "seen"}
    assert shown["text"]["en"] == (
        "Zhou's Clerk only saw Li Er looking for the Lost Lantern at the Stone Bridge, "
        "and this has been made clear in public."
    )
    assert (
        shown["text"]["zh"].startswith("周家伙计只看见李二") and "当众说清" in shown["text"]["zh"]
    )


def test_the_claim_has_a_story_of_its_own_so_the_quiet_of_the_opening_does_not_hold_it(evening):
    props = notebook.view(state_of(evening)["social"])
    assert props[CLAIM].parent is None and props[CLAIM].pred == "set_straight"
    roots = opening.quiet_roots(evening._kernel.world, LO, 0)
    assert roots == {"pr_liner_looking"} and CLAIM not in roots
    assert CLAIM not in LO.story_roots["op_li_er_hearsay"]


def test_it_is_carried_on_in_the_evening_because_the_talk_of_the_town_is_not_quiet_for_it(evening):
    """The quiet of the opening holds the story of the rumour until seven (``quiet_roots``, above)
    and not the claim, which is a story of its own: the people who were there tell it on, and when
    the first does is for the talk of the town to say (here at half past seven)."""
    clarify_(evening)
    told = []
    while evening.tick < at(1, 21, 0):
        told += [e for e in json.loads(evening.step())["events"] if e["kind"] == "told"]
    told = [e for e in told if e["prop"] == CLAIM]
    assert told, "nobody passed it on in the evening"
    assert all(e["tick"] < at(1, 21, 0) for e in told)


# ------------------------------------------------------------------------------ nobody else


def test_t06_only_the_people_there_know_and_the_rest_wait_for_a_telling(evening):
    here = set(assembly.audience(state_of(evening), "p_teahouse"))
    taken = stands(clarify_(evening))
    knowing = set(holders(evening))
    assert knowing == {p for p, row in taken.items() if row["after"] == "for"} <= here
    assert {"li_er", "li_xiaomei", "old_he", "gengfu"} <= set(LO.people) - here
    assert not (set(LO.people) - here) & knowing
    # they know it when a telling brings it, and then it is hearsay and not their own eyes
    told = []
    while evening.tick < at(1, 19, 30):
        for e in json.loads(evening.step())["events"]:
            if e["kind"] == "told" and e["prop"] == CLAIM:
                told.append((e["speaker"], e["listener"]))
    learned = set(holders(evening)) - knowing
    assert learned and learned == {listener for _, listener in told}
    for speaker, listener in told:
        belief = stored(evening, listener, CLAIM)
        assert (belief.source, belief.teller, belief.hop) == ("heard", speaker, 1)
        assert listener not in knowing


# ------------------------------------------------------------------------------ the objection


def test_granny_lis_hard_condition_reads_what_she_knows_and_not_what_the_town_was_told(evening):
    state = state_of(evening)
    first = persuade.hard_condition("hc_li_bamboo")["any"][0]
    assert first["id"] == "hc_rumor_cleared" and first["all"][0]["kind"] == "knows"
    me(evening)["public"]["refuted"] = list(RUMOURS)  # what the whole town was told, once
    assert persuade.open_way(state, "hc_li_bamboo") is None and not objection.objection_gone(state)
    assert not events(json.loads(evening.step()), "objection_withdrawn")
    floor = first["all"][0]["min"]
    believe(evening, "li_laotai", CLAIM, floor - 1, "heard", "li_da", "self_seen", 1)  # hardly
    assert persuade.open_way(state, "hc_li_bamboo") is None
    believe(evening, "li_laotai", CLAIM, floor, "heard", "li_da", "self_seen", 1)
    assert persuade.open_way(state, "hc_li_bamboo") == "hc_rumor_cleared"


def test_a_member_of_her_family_who_tells_her_is_enough_and_she_withdraws_once(evening):
    send_away(evening, "li_laotai")  # she is not there to hear it
    out = clarify_(evening)
    assert "li_laotai" not in stands(out) and not events(out, "objection_withdrawn")
    assert tasks_of(out["frame"])["t_bamboo_first"]["state"] == "blocked"
    assert stored(evening, "li_laotai", CLAIM) is None and not objection.withdrawn(me(evening))
    believe(evening, "li_laotai", CLAIM, 80, "heard", "li_da", "self_seen", 1)  # her son tells her
    seen = []
    for out in ticks(evening, 40):
        seen += events(out, "objection_withdrawn")
    assert [(e["npc"], e["what"]) for e in seen] == [
        ("li_laotai", "bamboo")
    ]  # once, not four times
    assert me(evening)["public"]["withdrawn"] == ["li_laotai"]
    assert tasks_of(frame_now(evening))["t_bamboo_first"]["state"] == "open"


def test_she_says_her_line_over_her_head_unless_the_manager_is_in_a_talk(evening):
    send_away(evening, "li_laotai")
    clarify_(evening)
    meet(evening, "zuzhang")
    believe(evening, "li_laotai", CLAIM, 80, "heard", "li_da", "self_seen", 1)
    line = list(me(evening)["line"])
    seen = []
    while not seen:
        seen += events(json.loads(evening.step()), "objection_withdrawn")
    assert me(evening)["line"] == line  # the line of the partner stays on show in a talk
    assert me(evening)["talk"]["npc"] == "zuzhang"


def pay(game):
    """Let the world pay what it owes (it runs while it owes, even in a talk)."""
    while clock.owed(state_of(game)):
        game.step()


def owes(game):
    """The game seconds the world owes, and the rate its last call told the host."""
    return clock.owed(state_of(game))


def test_a_clarification_that_is_made_takes_half_an_hour_and_one_that_is_refused_takes_none(
    evening,
):
    tick = evening.tick
    for fields, reason in (
        ({"judgment": "contradicts"}, "overclaim"),
        ({"basis": ()}, "overclaim"),
        ({"claim": "n2", "basis": ("n1",)}, "not_shown"),
        ({"basis": ("n3",)}, "no_witness"),
        ({"claim": "n99"}, "no_entry"),
    ):
        out = clarify_(evening, **fields)
        assert acks(out) == [("rejected", reason)], fields
        assert owes(evening) == 0 and out["clock"]["rate"] == [1, 1], fields
    assert evening.tick - tick == 5  # five calls, a tick each: the world was not held by anything
    out = clarify_(evening)
    assert acks(out) == [("applied", None)]
    assert out["clock"]["rate"] == [20, 1]
    day_tick = clock.TICK_SECONDS[clock.DAY]
    assert pace.minutes("speak") * 60 - day_tick <= owes(evening) <= pace.minutes("speak") * 60
    pay(evening)
    assert acks(clarify_(evening)) == [("rejected", "said_already")] and owes(evening) == 0


def test_li_das_no_is_an_answer_and_costs_what_a_yes_costs_and_a_body_turned_down_costs_nothing(
    evening,
):
    """His mother has not let go yet, so he turns the request down himself, in his own words, and
    the world owes the twenty minutes of the act as for any answer. A request that is not one is
    turned down by the core and nobody answers."""
    meet(evening, "li_da")
    assert owes(evening) == 0
    out = act(evening, "entrust", kind="teleport")
    assert acks(out) == [("rejected", "no_request")] and owes(evening) == 0
    out = act(evening, "entrust", kind="material")
    assert acks(out) == [("rejected", "needs_nod")]
    says(out, "li_da", "needs_nod")
    day_tick = clock.TICK_SECONDS[clock.DAY]
    assert pace.minutes("entrust") * 60 - day_tick <= owes(evening) <= pace.minutes("entrust") * 60


def test_telling_her_what_was_said_in_a_talk_has_her_let_go_while_the_telling_is_paid_for(evening):
    """She was not at the teahouse. A conversation holds the world, but a telling takes fifteen
    minutes and the world runs for them at twenty times the pace, with the watch of the objection
    every ten ticks: she lets go during the payment, with the talk open, and the world is held
    again when it is paid."""
    send_away(evening, "li_laotai")
    clarify_(evening)
    pay(evening)  # the half hour of the speech
    assert not objection.withdrawn(me(evening)) and stored(evening, "li_laotai", CLAIM) is None
    trust(evening, "li_laotai", 60)
    meet(evening, "li_laotai")
    held = evening.tick
    assert json.loads(evening.step())["advanced"] is False and evening.tick == held  # held
    assert acks(tell(evening, "n5", "faithful")) == [("applied", None)]
    assert clarify.knows_claim(state_of(evening), "li_laotai")  # she took it in
    assert not objection.withdrawn(me(evening))  # and has not let go yet: the watch is by the tick
    owed = clock.owed(state_of(evening))  # the fifteen minutes, but for the tick of the call
    day_tick = clock.TICK_SECONDS[clock.DAY]
    assert pace.minutes("tell") * 60 - day_tick <= owed <= pace.minutes("tell") * 60
    started, seen = evening.tick, []
    while clock.owed(state_of(evening)):
        out = json.loads(evening.step())
        assert me(evening)["talk"]["npc"] == "li_laotai"  # all of it in the conversation
        seen += [(evening.tick, e) for e in events(out, "objection_withdrawn")]
    ((tick, event),) = seen  # once
    assert (event["npc"], event["what"]) == ("li_laotai", "bamboo")
    first_watch = 0 < tick - started <= objection.WATCH_STRIDE
    assert first_watch  # right after the telling, at the first watch of the ticks that are paid
    assert evening.tick - started == -(-owed // day_tick) and tick < evening.tick  # in the payment
    assert objection.withdrawn(me(evening)) and "debt" not in state_of(evening)["clock"]
    assert json.loads(evening.step())["advanced"] is False  # and the world is held again
    assert tasks_of(frame_now(evening))["t_bamboo_first"]["state"] == "open"


def test_a_clarification_that_nobody_took_in_withdraws_nothing(evening):
    for person in assembly.audience(state_of(evening), "p_teahouse"):
        trust(evening, person, 0)
        believe(evening, person, "pr_liner_damaged", 95, "heard", "zhou_huoji", "zhou_huoji")
    out = clarify_(evening)
    assert events(out, "clarified")[0]["accepted"] == 1  # only the clerk, who saw it
    assert not events(out, "objection_withdrawn") and holders(evening) == ["zhou_huoji"]


# ------------------------------------------------------------------------------ Li Da


def test_li_das_word_needs_his_mother_to_have_let_go_first(evening):
    believe(evening, "li_da", CLAIM, 90)  # he knows, and trusts
    out = li_da_asked(evening)
    assert acks(out) == [("rejected", "needs_nod")]
    says(out, "li_da", "needs_nod")
    assert not state_of(evening)["tasks"]["queue"]
    assert objection.gate(state_of(evening)) == "needs_nod"


def test_a_way_that_is_open_for_her_and_that_nobody_asked_her_about_is_not_her_word(evening):
    believe(evening, "li_da", CLAIM, 90)  # he knows,
    trust(evening, "li_da", 14)  # and trusts the manager
    me(evening)["won"].append("zuzhang")  # the elder was won over and asked her himself
    me(evening)["asks"].append(["zuzhang", "li_laotai", evening.tick])
    state = state_of(evening)
    assert persuade.open_way(state, "hc_li_bamboo") == "hc_elder_asks"
    assert not objection.objection_gone(state) and objection.gate(state) == "needs_nod"
    meet(evening, "li_laotai")
    trust(evening, "li_laotai", 40)
    assert acks(act(evening, "entrust", kind="lend")) == [
        ("applied", None)
    ]  # she is asked: her nod
    assert objection.objection_gone(state) and objection.gate(state) is None


def test_t12_li_da_does_not_agree_before_he_knows_and_agrees_once_he_has_been_told(evening):
    send_away(evening, "li_da")  # his mother lets go, and he is not there to hear it
    out = clarify_(evening)
    assert "li_da" not in stands(out) and events(out, "objection_withdrawn")
    assert objection.objection_gone(state_of(evening)) and stored(evening, "li_da", CLAIM) is None
    out = li_da_asked(evening)
    assert acks(out) == [("rejected", "unaware")]
    says(out, "li_da", "hard_hc_li_bamboo")
    assert not state_of(evening)["tasks"]["queue"] and not events(out, "entrusted")
    # his mother's yes is not his: she has agreed to lend, and he still does not know
    me(evening)["nod"]["bamboo"] = evening.tick
    assert acks(act(evening, "entrust", kind="material")) == [("rejected", "unaware")]
    # the manager tells him what was said in public, as they saw it, and he takes it in
    assert acks(tell(evening, "n5", "faithful")) == [("applied", None)]
    assert (
        clarify.knows_claim(state_of(evening), "li_da")
        and objection.gate(state_of(evening)) is None
    )
    out = act(evening, "entrust", kind="material")  # and what he weighs is the ordinary weighing:
    assert acks(out) == [("rejected", "refused")]  # he did not hear it himself, and trusts less
    assert (events(out, "entrusted")[0]["total"], events(out, "entrusted")[0]["need"]) == (14, 15)
    trust(evening, "li_da", 14)
    assert acks(act(evening, "entrust", kind="material")) == [("applied", None)]
    assert [row[0] for row in promises(evening)] == ["li_da"]


def test_a_son_who_is_told_by_a_member_of_his_family_knows_as_well(evening):
    send_away(evening, "li_da")
    clarify_(evening)
    trust(evening, "li_da", 14)
    believe(
        evening, "li_da", CLAIM, 70, "heard", "li_laotai", "self_seen", 1
    )  # his mother tells him
    assert objection.gate(state_of(evening)) is None
    assert acks(li_da_asked(evening)) == [("applied", None)]


def test_what_he_has_only_barely_heard_is_not_knowing_it(evening):
    send_away(evening, "li_da")
    clarify_(evening)
    trust(evening, "li_da", 14)
    believe(evening, "li_da", CLAIM, clarify.KNOWS_AT - 1, "heard", "li_er", "self_seen", 1)
    assert objection.gate(state_of(evening)) == "unaware"
    believe(evening, "li_da", CLAIM, clarify.KNOWS_AT, "heard", "li_er", "self_seen", 1)
    assert objection.gate(state_of(evening)) is None


def test_li_da_does_not_move_for_a_manager_he_trusts_less_than_twelve(evening):
    """Twelve opens the door, and the rest is the ordinary weighing (15 for the bamboo)."""
    clarify_(evening)
    meet(evening, "li_da")  # the first talk of the day earns a little more
    trust(evening, "li_da", objection.TRUST_MIN - 1)
    assert objection.gate(state_of(evening)) == "distrust"
    out = act(evening, "entrust", kind="material")
    assert acks(out) == [("rejected", "distrust")] and not events(out, "entrusted")
    says(out, "li_da", "turned_down")
    trust(evening, "li_da", objection.TRUST_MIN)
    assert objection.gate(state_of(evening)) is None
    out = act(evening, "entrust", kind="material")
    assert acks(out) == [("rejected", "refused")]  # 12 and 1 for his nature: 13 of the 15 he asks
    assert (events(out, "entrusted")[0]["total"], events(out, "entrusted")[0]["need"]) == (13, 15)
    trust(evening, "li_da", objection.TRUST_MIN + 2)
    assert acks(act(evening, "entrust", kind="material")) == [("applied", None)]
    assert objection.TRUST_MIN == 12


def test_granny_lis_yes_no_longer_sends_him_with_the_bamboo(evening):
    clarify_(evening)
    meet(evening, "li_laotai")
    trust(evening, "li_laotai", 40)
    out = act(evening, "entrust", kind="lend")
    assert acks(out) == [("applied", None)]
    assert events(out, "entrusted")[0]["way"] == "hc_rumor_cleared"
    assert "bamboo" in me(evening)["nod"]
    assert not state_of(evening)["tasks"]["queue"] and not events(out, "agreed")
    assert acks(li_da_asked(evening)) == [("applied", None)]  # he is asked, and says yes himself


# ------------------------------------------------------------------------------ the same twice


def test_the_same_claim_and_basis_are_not_clarified_twice_whoever_came_since(evening):
    clarify_(evening)
    spent = {p: trust_of(evening, p) for p in LO.people}
    assert acks(clarify_(evening)) == [("rejected", "said_already")]
    assert {p: trust_of(evening, p) for p in LO.people} == spent
    assert me(evening)["public"]["clarified"] == [f"{JEALOUS}|{AT_BRIDGE}"]
    send_away(evening, "mujiang")  # who is there is not what the sign is made of
    assert acks(clarify_(evening)) == [("rejected", "said_already")]
    assert acks(clarify_(evening, basis=("n4",))) == [("applied", None)]  # another basis, another
    assert len(me(evening)["public"]["clarified"]) == 2
    assert acks(clarify_(evening, claim="n3", basis=("n4", "n2"))) == [("applied", None)]
    assert acks(clarify_(evening, claim="n3", basis=("n2", "n4"))) == [("rejected", "said_already")]


def test_a_clarification_that_nobody_took_in_is_not_made_and_can_be_said_again(evening):
    for person in assembly.audience(state_of(evening), "p_teahouse"):
        trust(evening, person, 0)
        believe(evening, person, "pr_liner_damaged", 95, "heard", "zhou_huoji", "zhou_huoji")
    send_away(evening, "zhou_huoji", "p_zhou_house")  # and nobody who saw it is there
    out = clarify_(evening)
    assert acks(out) == [("applied", None)] and events(out, "clarified")[0]["accepted"] == 0
    assert not me(evening)["public"]["clarified"] and holders(evening) == []
    assert notebook.by_prop(me(evening), CLAIM) is None
    for person in assembly.audience(state_of(evening), "p_teahouse"):
        trust(evening, person, 60)
        believe(evening, person, "pr_liner_damaged", 0, "heard", "zhou_huoji", "zhou_huoji")
    assert acks(clarify_(evening)) == [("applied", None)]  # better days: it is made now


# ------------------------------------------------------------------------------ overclaiming


def test_saying_that_li_er_is_innocent_is_no_clarification_and_the_clerk_says_he_never_said_so(
    evening,
):
    before = {p: trust_of(evening, p) for p in LO.people}
    out = clarify_(evening, judgment="contradicts")  # the clerk's words do not clear Li Er
    assert acks(out) == [("rejected", "overclaim")]
    assert not events(out, "clarified") and not events(out, "objection_withdrawn")
    assert trust_of(evening, "zhou_huoji") == before["zhou_huoji"] - clarify.OVERCLAIM_DROP
    assert all(trust_of(evening, p) == before[p] for p in LO.people if p != "zhou_huoji")
    (bubble,) = (b for b in out["frame"]["bubbles"] if b["npc"] == "zhou_huoji")
    assert bubble["text"] in voices.variants("zhou_huoji", "not_said")
    assert holders(evening) == [] and not me(evening)["public"].get("clarified")
    assert notebook.by_prop(me(evening), CLAIM) is None
    assert me(evening)["public"]["speeches"] == []  # the manager has not spoken in public yet


def test_saying_that_they_saw_it_themselves_is_overclaiming_too(evening):
    before = trust_of(evening, "zhou_huoji")
    out = clarify_(evening, basis=())  # nothing is cited: the manager's own word
    assert acks(out) == [("rejected", "overclaim")] and not events(out, "clarified")
    assert trust_of(evening, "zhou_huoji") == before - clarify.OVERCLAIM_DROP
    assert [b["npc"] for b in out["frame"]["bubbles"] if b["npc"] == "zhou_huoji"] == ["zhou_huoji"]


def test_two_notes_that_have_nothing_to_do_with_each_other_show_nothing(evening):
    know(evening, "pr_dalang_drank", "heard", "mujiang", 1, "self_seen")  # n5: Dalang drank
    out = clarify_(evening, claim="n1", basis=("n5",))
    assert acks(out) == [("rejected", "not_shown")]
    assert trust_of(evening, "zhou_huoji") == 13 - clarify.OVERCLAIM_DROP
    out = clarify_(evening, claim="n2", basis=("n1",))  # what is said less is not said beyond it
    assert acks(out) == [("rejected", "not_shown")]


def test_a_basis_that_nobody_says_they_saw_cannot_be_borne_out(evening):
    out = clarify_(evening, claim="n1", basis=("n3",))  # the clerk's hearsay, and no more
    assert acks(out) == [("rejected", "no_witness")]
    assert trust_of(evening, "zhou_huoji") == 13  # the claim does go beyond it: no fault
    assert not events(out, "clarified")


def test_an_entry_the_manager_has_not_is_refused(evening):
    assert acks(clarify_(evening, claim="n99")) == [("rejected", "no_entry")]
    assert acks(clarify_(evening, basis=("n2", "n98"))) == [("rejected", "no_entry")]


def test_after_overclaiming_they_can_say_it_again_with_what_they_can_show(evening):
    assert acks(clarify_(evening, judgment="contradicts")) == [("rejected", "overclaim")]
    out = clarify_(evening, judgment="unsupported")
    assert acks(out) == [("applied", None)] and events(out, "clarified")[0]["accepted"] >= 5


def test_the_relations_are_read_from_the_notebook_and_the_witness_is_who_says_they_saw_it(evening):
    state = state_of(evening)
    entry = lambda name: notebook.find(me(evening), name)  # noqa: E731
    props = notebook.view(state["social"])
    assert clarify.shown(state, entry("n1"), [entry("n2")]) == ("unsupported",)
    assert judge.adds_to(JEALOUS, AT_BRIDGE, props)
    assert not judge.adds_to(AT_BRIDGE, "pr_liner_looking", props)  # a level says less
    assert not judge.adds_to("pr_liner_looking", "pr_liner_looking", props)
    assert clarify.witnesses([entry("n2")]) == ["zhou_huoji"]
    assert clarify.witnesses([entry("n3")]) == []  # the clerk's hearsay
    assert clarify.witnesses([entry("n1")]) == []


def test_the_speech_and_the_judgement_agree_on_what_the_notebook_shows(evening):
    """The speech shows a relation between a claim and a note exactly when ``judge`` accepts it
    between them, for every pair of the notebook of the evening and for each of the relations."""
    state = state_of(evening)
    props, groups = judge.context(state)
    entries = me(evening)["notebook"]
    for claim in entries:
        for basis in entries:
            if basis is not claim:
                said = clarify.shown(state, claim, [basis])
                for relation in clarify.RELATIONS:
                    holds = judge.holds(relation, basis, claim, props, groups)
                    assert (relation in said) == holds, (basis["id"], claim["id"], relation)
    # what the judgement accepts, the manager can say in public
    out = act(evening, "judge", a="n2", b="n1", relation="unsupported")
    assert acks(out) == [("applied", None)]
    assert acks(clarify_(evening, claim="n1", basis=("n2",))) == [("applied", None)]


def test_a_claim_the_manager_saw_is_not_unsupported_by_a_basis_that_holds_the_sighting(evening):
    """The one thing the speech adds to the judgement: a basis that holds the manager's sighting of
    the claim itself makes it supported, whatever else is cited with it."""
    state = state_of(evening)
    props, groups = judge.context(state)
    entry = notebook.find(me(evening), "n1")
    assert judge.holds("unsupported", notebook.find(me(evening), "n2"), entry, props, groups)
    notebook.add_seen(me(evening), JEALOUS, evening.tick)  # n1 is a sighting of the manager's now
    assert clarify.shown(state_of(evening), entry, [notebook.find(me(evening), "n2")]) == (
        "unsupported",
    )  # the clerk's words alone still leave it so
    both = [notebook.find(me(evening), name) for name in ("n1", "n2")]
    assert clarify.shown(state_of(evening), entry, both) == ()
    assert acks(clarify_(evening, claim="n1", basis=("n1", "n2"))) == [("rejected", "not_shown")]


def test_an_unknown_relation_or_a_malformed_speech_is_refused_before_anything_happens(evening):
    for fields in (
        {"claim": "n1", "basis": ["n2"], "judgment": "innocent"},
        {"claim": "n1", "basis": "n2"},
        {"claim": "n1", "basis": ["n1", "n2", "n3", "n4", "n5"]},
        {"claim": 1, "basis": ["n2"]},
        {"basis": ["n2"]},
    ):
        before = evening.hash()
        with pytest.raises(InputError):
            act(evening, "speak", kind="clarify", **fields)
        assert evening.hash() == before


# ------------------------------------------------------------------------------ venue, culprit


def test_the_clarification_is_for_the_teahouse_in_the_evening_and_not_in_a_talk(snapshot):
    away = Game.from_snapshot_json(snapshot)
    me(away).update(x=1, y=1, goal=[1, 1])  # far from the teahouse and the hall
    assert acks(clarify_(away)) == [("rejected", "no_venue")]
    late = Game.from_snapshot_json(snapshot)
    run_to(late, at(1, 21, 30))  # the evening of the teahouse ends at nine
    assert acks(clarify_(late)) == [("rejected", "not_evening")]
    talking_ = Game.from_snapshot_json(snapshot)
    meet(talking_, "li_da")
    assert acks(clarify_(talking_)) == [("rejected", "talking")]


def test_the_one_the_truth_blames_keeps_his_stand_whatever_it_is_and_has_a_line_for_it(snapshot):
    """A man who has taken the clarification in before (he was told) is silent again, and the line
    for his stand is there: it was not, and the speech failed for want of it."""
    game = Game.from_snapshot_json(snapshot)
    run_to(game, at(1, 18, 40))
    believe(game, "old_he", CLAIM, 90, "saw")
    trusted = trust_of(game, "old_he")
    row = stands(clarify_(game))["old_he"]
    assert (row["before"], row["after"]) == ("for", "for")
    assert row["reason"] in voices.variants("old_he", "took_in")
    assert trust_of(game, "old_he") == trusted  # he accepted nothing, and trusts no more


def test_a_witness_who_takes_no_stand_lends_the_speech_no_strength(evening, monkeypatch):
    """Were the clerk the one the truth blames, he would be silent, and a silent witness is no
    strength: the wife of the master of the Zhou house, whom 80 takes in (75) and 60 does not (55),
    is unsure."""
    monkeypatch.setattr(assembly, "culprit_of", lambda variant: "zhou_huoji")
    taken = stands(clarify_(evening))
    assert taken["zhou_huoji"]["before"] == taken["zhou_huoji"]["after"] == "against"
    assert taken["zhou_niangzi"]["after"] == "unsure"
    assert all(taken[p]["after"] == "for" for p in LI)


def test_one_who_took_a_clarification_in_stays_with_it_when_the_next_does_not_convince_him(evening):
    send_away(evening, "zhou_huoji", "p_zhou_house")  # only his words are cited: 60
    believe(evening, "zhou_zhanggui", CLAIM, 90, "saw")  # the master was told, and took it in
    row = stands(clarify_(evening))["zhou_zhanggui"]
    assert (row["before"], row["after"]) == ("for", "for")
    assert row["reason"] in voices.variants("zhou_zhanggui", "took_in")
    assert confidence_of(evening, "zhou_zhanggui", "pr_liner_damaged") == 87  # he gave nothing up


def test_the_culprit_takes_no_stand_when_he_comes_in_and_never_accepts(snapshot):
    game = Game.from_snapshot_json(snapshot)
    run_to(game, at(1, 18, 40))  # he comes at twenty-five to seven
    here = assembly.audience(state_of(game), "p_teahouse")
    assert "old_he" in here and "zhou_huoji" in here  # and the clerk is still there
    taken = stands(clarify_(game))
    assert taken["old_he"]["before"] == taken["old_he"]["after"] == "unsure"
    assert taken["old_he"]["reason"] in voices.variants("old_he", "elder_no")  # as any unsure
    assert stored(game, "old_he", CLAIM) is None
    assert taken["zhou_huoji"]["after"] == "for"


def test_in_the_hall_it_is_the_same_with_the_cited_words_alone():
    game = talking("zuzhang", seed=1, hour=9)
    for index in range(len(LO.people)):
        me(game)["trust"][index] = 50
    me(game)["evidence"].append("e_footprint")  # the elder calls the clan for a reason
    assert acks(act(game, "entrust", kind="convene")) == [("applied", None)]
    queue = state_of(game)["tasks"]["queue"]
    queue[:] = [t for t in queue if t["npc"] in ("li_laotai", "cha_laoban", "zuzhang")]
    act(game, "leave")
    for _ in range(600):  # they come, and the hall opens on the hour after
        step(game)
        if len(assembly.audience(state_of(game), "p_clan_hall")) == 3 and assembly.meeting_open(
            me(game), game.tick
        ):
            break
    silence(game)
    assert sorted(assembly.audience(state_of(game), "p_clan_hall")) == [
        "cha_laoban",
        "li_laotai",
        "zuzhang",
    ]
    claim = know(game, "pr_liner_damaged", "heard", "cha_laoban", 3, "zhou_zhanggui")
    basis = know(game, AT_BRIDGE, "heard", "zhou_huoji", 1, "self_seen")
    believe(game, "cha_laoban", "pr_liner_damaged", 60, "heard", "zhou_zhanggui", "zhou_zhanggui")
    out = clarify_(game, claim=claim["id"], basis=(basis["id"],))
    assert acks(out) == [("applied", None)]
    taken = stands(out)
    assert events(out, "clarified")[0]["venue"] == "p_clan_hall"
    # the clerk is not there: 60 + 25 for the elder and Granny Li, and 60 + 25 - 30 for the madam
    assert {p: row["after"] for p, row in taken.items()} == {
        "cha_laoban": "against",
        "li_laotai": "for",
        "zuzhang": "for",
    }


# ------------------------------------------------------------------------------ evidence in public


def test_whoever_takes_the_evidence_in_has_also_seen_the_rumour_cleared_in_public(evening):
    """Evidence that tells the boat refutes the rumour about Li Er. Whoever accepts it holds what a
    clarification gives, so Granny Li, who is there, withdraws her objection as she does for it."""
    me(evening)["evidence"].extend(["e_xiaoman_testimony", "e_repair_record"])
    out = act(evening, "speak", kind="evidence")
    (spoke,) = events(out, "spoke")
    assert spoke["complete"] and spoke["accepted"] >= 5
    assert stored(evening, "li_laotai", CLAIM) is not None
    assert [e["npc"] for e in events(out, "objection_withdrawn")] == ["li_laotai"]
    assert persuade.open_way(state_of(evening), "hc_li_bamboo") == "hc_rumor_cleared"
    assert notebook.by_prop(me(evening), CLAIM) is not None  # the manager was there: they can tell


def test_evidence_that_too_few_took_in_has_not_cleared_the_rumour_in_public(evening):
    """Two named people are not the town (``MIN_NAMED`` is five): they believe the boat, and the
    rumour is not cleared in public, so nobody holds the claim and Granny Li keeps her objection."""
    for person in assembly.audience(state_of(evening), "p_teahouse"):
        if person not in ("li_laotai", "cha_laoban"):
            send_away(evening, person)
    me(evening)["evidence"].extend(["e_xiaoman_testimony", "e_repair_record"])
    out = act(evening, "speak", kind="evidence")
    (spoke,) = events(out, "spoke")
    assert (spoke["named"], spoke["accepted"], spoke["cleared"]) == (2, 2, False)
    assert holders(evening) == [] and me(evening)["public"]["refuted"] == []
    assert notebook.by_prop(me(evening), CLAIM) is None
    assert not events(out, "objection_withdrawn") and not objection.objection_gone(
        state_of(evening)
    )


def test_evidence_about_something_else_clears_nothing_for_anyone(evening):
    for person in assembly.audience(state_of(evening), "p_teahouse"):
        trust(evening, person, 100)  # they take in whatever they are shown
    me(evening)["evidence"].extend(["e_flood_debris"])  # the water, and not the rumour
    out = act(evening, "speak", kind="evidence")
    assert events(out, "spoke")[0]["accepted"] >= 5 and holders(evening) == []
    assert not events(out, "objection_withdrawn")


# ------------------------------------------------------------------------------ the term


def test_the_task_of_clearing_the_rumour_is_done_when_somebody_took_a_clarification_in(evening):
    """The task appears when the notebook has a judgement (the manager judged on the way), and it
    is done by the clarification that somebody took in."""
    assert tasks_of(frame_now(evening))["t_clear_rumour"]["state"] == "open"
    out = clarify_(evening)
    assert tasks_of(out["frame"])["t_clear_rumour"]["state"] == "done"


def term_env(game):
    return agenda_terms.Env(game._kernel.world, state_of(game), clock.at(game.tick))


def test_the_task_term_clarified_holds_once_somebody_took_a_clarification_in(evening):
    assert not agenda_terms.holds(term_env(evening), {"kind": "clarified"})
    clarify_(evening)
    assert agenda_terms.holds(term_env(evening), {"kind": "clarified"})
    cond = {"kind": "clarified", "props": [JEALOUS]}
    assert agenda_terms.holds(term_env(evening), cond)
    cond = {"kind": "clarified", "props": ["pr_liner_damaged"]}
    assert not agenda_terms.holds(term_env(evening), cond)
    assert agenda_terms.TERMS["clarified"].later == ""  # and it is no longer one of the later terms


def test_a_clarification_nobody_took_in_does_not_complete_the_task_of_the_evening(evening):
    send_away(evening, "zhou_huoji", "p_zhou_house")
    for person in assembly.audience(state_of(evening), "p_teahouse"):
        trust(evening, person, 0)
        believe(evening, person, "pr_liner_damaged", 95, "heard", "zhou_huoji", "zhou_huoji")
    out = clarify_(evening)
    assert events(out, "clarified")[0]["accepted"] == 0
    assert tasks_of(out["frame"])["t_tea_tonight"]["state"] == "open"
    assert tasks_of(out["frame"])["t_clear_rumour"]["state"] == "open"  # still to be set straight


# ------------------------------------------------------------------------------ replaying


def test_a_game_restored_after_the_clarification_goes_on_as_the_game_that_made_it(evening):
    clarify_(evening)
    twin = Game.from_snapshot_json(evening.snapshot_json())
    assert twin.hash() == evening.hash()
    again = Game.from_snapshot_json(evening.snapshot_json())
    assert acks(clarify_(again)) == [("rejected", "said_already")]  # the sign was kept
    for _ in range(300):
        evening.step()
        twin.step()
    assert twin.hash() == evening.hash() and holders(twin) == holders(evening)
    assert me(twin)["public"]["withdrawn"] == ["li_laotai"]


def test_the_same_game_played_twice_is_the_same_game(snapshot):
    def play():
        game = Game.from_snapshot_json(snapshot)
        out = clarify_(game)
        li_da_asked(game)
        act(game, "leave")  # a conversation holds the world: it runs once the manager has left
        run_to(game, at(1, 20, 0))
        return game.hash(), json.dumps(events(out, "clarified"), sort_keys=True)

    assert play() == play()


def test_the_variant_that_is_true_is_not_read_by_the_stands_of_those_who_are_not_blamed(snapshot):
    def stances(variant):
        game = Game.from_snapshot_json(snapshot)
        state_of(game)["social"]["variant"] = variant
        return {p: (r["before"], r["after"]) for p, r in stands(clarify_(game)).items()}

    assert stances("v_boat") == stances("v_flood") == stances("v_drunk")


def test_a_recording_of_the_evening_with_the_clarification_in_it_is_replayed_to_the_same_game():
    game = slice_game()
    recorder = Recorder(game)
    bot = slice_driver.Route(json.loads(game.scene_json()), SEED)
    bot.stay = -1
    obs = Obs(json.loads(recorder.step("[]")))
    while game.tick < at(1, 19, 30):
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        obs = Obs(json.loads(recorder.step(json.dumps(records))))
    recording = canon.loads(canon.dumps_str(recorder.recording()))  # as a file would carry it
    spoken = [r[3] for r in recording["records"] if r[2] == "player" and r[3]["type"] == "speak"]
    assert [(b["kind"], b["claim"], b["basis"]) for b in spoken] == [("clarify", "n1", ["n2"])]
    again = rebuild(recording)  # it checks every hash on the way
    assert again.hash() == game.hash() and again.snapshot_json() == game.snapshot_json()
    assert holders(again) == holders(game) and holders(game)


# ------------------------------------------------------------------------------ nothing twice


def test_an_entry_cited_twice_is_cited_once_and_the_speech_is_the_same_speech(evening):
    world = evening._kernel.world
    body = {
        "action_id": "a",
        "type": "speak",
        "kind": "clarify",
        "claim": "n1",
        "basis": ["n2"] * 2,
    }
    assert world.validate_player(body)["basis"] == ["n2"]
    assert acks(clarify_(evening, basis=("n2", "n2"))) == [("applied", None)]
    assert acks(clarify_(evening, basis=("n2",))) == [("rejected", "said_already")]
    assert me(evening)["public"]["clarified"] == [f"{JEALOUS}|{AT_BRIDGE}"]


def test_a_speech_that_differs_by_an_entry_of_the_basis_earns_no_more_trust(evening):
    clarify_(evening)
    spent = {p: trust_of(evening, p) for p in LO.people}
    out = clarify_(evening, basis=("n2", "n4"))  # the clerk's sight of the lantern as well
    assert acks(out) == [("applied", None)] and events(out, "clarified")[0]["accepted"] >= 5
    assert {
        p: trust_of(evening, p) for p in LO.people
    } == spent  # they knew it, and learned nothing
    assert len(me(evening)["public"]["clarified"]) == 2  # but it was a speech, and it is kept
    assert acks(clarify_(evening, basis=("n4", "n2"))) == [("rejected", "said_already")]


def test_one_who_was_told_and_is_there_to_hear_it_said_trusts_no_more_for_it(evening):
    believe(evening, "mujiang", CLAIM, 70, "heard", "li_laotai", "self_seen", 1)
    trusted = trust_of(evening, "mujiang")
    row = stands(clarify_(evening))["mujiang"]
    assert (row["before"], row["after"]) == ("for", "for")
    assert trust_of(evening, "mujiang") == trusted  # he had it already, and learned nothing
    assert stored(evening, "mujiang", CLAIM).source == "saw"  # but now he has seen it himself


# ------------------------------------------------------------------------------ random speeches

PROPS = [CLAIM, "pr_liner_damaged", JEALOUS, AT_BRIDGE, "pr_liner_looking"]
STANDS = ("against", "unsure", "for")


def sane(game):
    """The state is plain, trust and confidence are in bounds, nothing is kept twice."""
    state = game._kernel.state
    plain(state)
    section = state["world"]["player"]
    assert all(0 <= t <= 100 for t in section["trust"]), section["trust"]
    for held in state["world"]["social"]["beliefs"].values():
        assert all(0 <= notes.confidence_of(note) <= 100 for note in held.values())
    public = section["public"]
    for key in ("clarified", "withdrawn"):
        assert len(public.get(key, [])) == len(set(public.get(key, []))), key


def one_speech(game, rng):
    """A clarification mostly of the entries the manager has (rarely of one they have not), the call
    checked, and who it reached."""
    body = {"claim": rng.choice(["n1"] * 4 + ["n3"] * 3 + ["n2", "n4", "n5", "n99"])}
    pool = ["n2", "n2", "n2", "n4", "n4", "n3", "n1", "n5", "n98"]
    body["basis"] = list(dict.fromkeys(rng.choice(pool) for _ in range(rng.randint(1, 3))))
    if rng.random() < 0.2:
        body["judgment"] = rng.choice(["unsupported", "contradicts", "mismatch"])
    if rng.random() < 0.05:
        body["basis"] = []
    here = set(assembly.audience(state_of(game), "p_teahouse"))
    trusts = list(me(game)["trust"])
    knew = set(holders(game))
    try:
        out = act(game, "speak", kind="clarify", **body)
    except InputError:
        return  # too many in the basis, or the like: refused before anything was done
    (answer,) = acks(out)
    for event in events(out, "clarified"):
        assert answer == ("applied", None)
        people = [row["npc"] for row in event["audience"]]
        assert len(people) == len(set(people)) and set(people) <= here
        assert event["accepted"] <= len(people)
        for row in event["audience"]:
            assert row["before"] in STANDS and row["after"] in STANDS
            assert row["reason"]["zh"] and row["reason"]["en"]
    if answer[0] == "rejected":
        assert answer[1] in {
            "no_entry", "not_shown", "overclaim", "no_witness", "said_already",
            "no_venue", "not_evening", "empty_room", "talking",
        }, answer  # fmt: skip
    for index, person in enumerate(LO.people):  # nobody who was not there is touched
        if person not in here:
            assert me(game)["trust"][index] == trusts[index], person
    told = {e["listener"] for e in events(out, "told") if e["prop"] == CLAIM}
    assert set(holders(game)) - knew <= here | told


@pytest.mark.parametrize("seed", range(12))
def test_whatever_is_said_in_public_leaves_the_game_sound(snapshot, seed):
    """Speeches of any entries, evidence and a table, changes of mind and of trust, people who come
    and go and a few ticks, over the evening: no call fails and the state stays sound."""
    rng = random.Random(seed)
    game = Game.from_snapshot_json(snapshot)
    for _ in range(40):
        roll = rng.random()
        person = rng.choice(LO.people)
        if roll < 0.5:
            one_speech(game, rng)
        elif roll < 0.58:
            me(game)["evidence"].append(rng.choice(["e_xiaoman_testimony", "e_gengfu_boat"]))
            act(game, "speak", kind=rng.choice(["evidence", "meal"]))
        elif roll < 0.68:
            props = rng.sample(PROPS, k=2)
            for prop in props:
                believe(
                    game,
                    person,
                    prop,
                    rng.choice([0, 20, 49, 50, 90]),
                    "heard",
                    "li_da",
                    "self_seen",
                    1,
                )
        elif roll < 0.76:
            trust(game, person, rng.randint(0, 100))
        elif roll < 0.84:
            send_away(game, person, rng.choice(["p_li_house", "p_zhou_house", "p_market"]))
        elif roll < 0.92:
            ticks(game, rng.randint(1, 15))
        elif roll < 0.97 and game.tick < at(1, 20, 30):
            if not any(t["npc"] == "li_da" for t in state_of(game)["tasks"]["queue"]):
                li_da_asked(game)  # he does not talk on an errand
                act(game, "leave")
                beside(game, "cha_laoban")
        else:
            ticks(game, rng.randint(40, 90))
        sane(game)
