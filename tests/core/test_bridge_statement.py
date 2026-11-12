"""The statement card: the options and what bears for and against them, choosing, the full statement
and its three judgements apart, the cost of a wrong one, the replay, and the audit of the frame.

The card is made from the notebook and the choices alone, so the tests write notes to the notebook
(``bear``, ``know``) and choose with the player action, as a page does. The full statement is made
at the teahouse on the fourth evening, where the slice has eight or nine named people; the tests
that speak earlier have the meeting open (``the_meeting_is_open``).
"""

from __future__ import annotations

import json
import re

import pytest
from agenda_helpers import frame_now, idle, slice_game
from bridge_helpers import at, run_to, state_of, world_of
from dealings_helpers import know, talking, trust_of
from player_helpers import acks, act, me, put
from statement_helpers import (
    RIGHT,
    VARIANTS,
    bear,
    fill,
    state_it,
    stated,
    statement_parts,
    tell,
)
from truth_helpers import TruthRoute, hidden_changes

from bots.base import Obs
from lantern_core import canon
from lantern_core.api import Game, preset
from lantern_core.cognition.beliefs import Belief
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import (
    assembly,
    clarify,
    goals_ending,
    notebook,
    notes,
    projection,
    statement,
)
from lantern_core.world.bridge.lore import PLAYER, lore

TEAHOUSE = "p_teahouse"
LO = lore()
SCRIPT_PARTS = {
    "cause": ["boat", "flood", "drunk", "li_er"],
    "course": ["boat_night", "flood_night", "drunk_night", "li_er_night"],
    "rumour": ["grew", "seen", "invented", "smear"],
}
WRONG = {  # an option of each part that is not right in the story
    "v_boat": {"cause": "flood", "course": "flood_night", "rumour": "seen"},
    "v_flood": {"cause": "boat", "course": "boat_night", "rumour": "seen"},
    "v_drunk": {"cause": "boat", "course": "boat_night", "rumour": "seen"},
}
PROOF = {  # a set of evidence that tells the story apart, and one item of it alone, which does not
    "v_boat": (["e_gengfu_boat", "e_boat_scratches"], ["e_xiaoman_testimony"]),
    "v_flood": (["e_flood_debris", "e_gengfu_flood"], ["e_flood_debris"]),
    "v_drunk": (["e_gengfu_dalang"], ["e_footprint"]),
}


def evening(variant="v_drunk", hour=18, minute=5, day=4, proof=True, trusting=True):
    """The slice in a story, at the teahouse on an evening, with the evidence of the story in hand
    (a set that tells it apart, or one item that does not) and the town trusting the manager."""
    game = slice_game(variant=variant)
    run_to(game, at(day, hour, minute))
    put(game, *world_of(game).town.places[TEAHOUSE].door)
    me(game)["evidence"].extend(PROOF[variant][0 if proof else 1])
    if trusting:
        convince(game)
    return game


def convince(game):
    """Everyone trusts the manager, and holds no false belief about how the rail broke."""
    section = me(game)
    section["trust"] = [100] * len(section["trust"])
    social = state_of(game)["social"]
    view = notebook.view(social)
    for beliefs in social["beliefs"].values():
        for prop in [p for p in beliefs if p in view and goals_ending.about_the_conflict(view[p])]:
            del beliefs[prop]


def frame(game):
    return frame_now(game)["statement"]


def option(card, part, name):
    (one,) = [
        o for p in card["parts"] if p["part"] == part for o in p["options"] if o["id"] == name
    ]
    return one


# ------------------------------------------------------------------------------ the options


def test_the_card_has_three_parts_of_four_options_written_in_both_languages_and_the_same_for_all():
    assert statement_parts() == SCRIPT_PARTS
    assert statement.PARTS == ("cause", "course", "rumour")
    for part in statement.parts():
        assert set(part["title"]) == {"zh", "en"} and part["title"]["zh"] and part["title"]["en"]
        for one in part["options"]:
            assert one["text"]["zh"] and one["text"]["en"]
            assert not re.search(r"\b(he|she|his|her|him)\b", one["text"]["en"])
            assert "他" not in one["text"]["zh"] and "她" not in one["text"]["zh"]
        # the right option of each story is one and the same list for all three
        for variant in VARIANTS:
            assert statement.right_option(part, variant)["id"] == RIGHT[variant][part["id"]]
    assert statement.opens() == (4, 17)


def test_nothing_held_bears_on_anything_at_the_start_and_every_part_is_a_gap():
    game = slice_game()
    card = frame(game)
    assert [(p["part"], p["options"], p["chosen"], p["gap"]) for p in card["parts"]] == [
        ("cause", [], None, True),
        ("course", [], None, True),
        ("rumour", [], None, True),
    ]
    assert (card["can_state"], card["used_today"], card["last"]) == (False, False, None)
    assert card["why_not"]["en"] == "The statement has to wait for the evening of the fourth day"
    assert card["why_not"]["zh"] == "要等第四天傍晚，才能照讲稿当众说"


def test_an_option_is_shown_once_a_note_bears_on_it_and_the_counts_are_the_notes_for_and_against():
    game = slice_game()
    know(game, "pr_boat_damaged")  # Boatman He's boat hit the rail: for the boat, against the rest
    card = frame(game)
    cause = {o["id"]: (o["support"], o["against"]) for o in card["parts"][0]["options"]}
    assert cause == {"boat": (1, 0), "flood": (0, 1), "drunk": (0, 1), "li_er": (0, 1)}
    course = {o["id"]: (o["support"], o["against"]) for o in card["parts"][1]["options"]}
    assert course == {
        "boat_night": (1, 0),
        "flood_night": (0, 1),
        "drunk_night": (0, 1),
        "li_er_night": (0, 1),
    }
    # the boat is against "Li Er really did it", so that option is shown for the talk; the rest not
    assert [o["id"] for o in card["parts"][2]["options"]] == ["seen"]
    assert [p["gap"] for p in card["parts"]] == [False, False, False]
    know(game, "pr_boat_scratched")
    know(game, "pr_flood_damaged")  # the water: for the flood, against the boat
    cause = {o["id"]: (o["support"], o["against"]) for o in frame(game)["parts"][0]["options"]}
    assert cause == {"boat": (2, 1), "flood": (1, 1), "drunk": (0, 2), "li_er": (0, 2)}


def test_the_entries_of_an_option_are_the_notes_that_bear_on_it_in_the_order_of_the_notebook():
    game = slice_game()
    first = know(game, "pr_flood_damaged")
    second = know(game, "pr_boat_damaged")
    third = know(game, "pr_boat_scratched")
    boat = option(frame(game), "cause", "boat")
    assert boat["entries"] == [
        first["id"],
        second["id"],
        third["id"],
    ]  # the order they were written
    assert (boat["support"], boat["against"]) == (2, 1)
    li_er = option(frame(game), "cause", "li_er")
    assert li_er["entries"] == sorted(li_er["entries"], key=lambda n: int(n[1:]))


def test_the_same_notes_give_the_same_card_in_every_story():
    """Nothing in the card reads the story that is true: the same notes, the same options, in the
    same order, with the same counts, whichever it is."""
    cards = []
    for variant in VARIANTS:
        game = slice_game(variant=variant)
        for name in ("boat", "flood_night", "grew", "li_er"):
            bear(game, name)
        act(game, "statement", op="choose", part="cause", option="boat")
        cards.append(frame(game))
    assert cards[0] == cards[1] == cards[2]
    assert cards[0]["parts"][0]["chosen"] == "boat"


# ------------------------------------------------------------------------------ choosing


def test_choosing_an_option_keeps_it_and_clearing_a_part_takes_it_away_and_both_take_no_time():
    game = slice_game()
    bear(game, "flood")
    before = state_of(game)["clock"].copy()
    out = act(game, "statement", op="choose", part="cause", option="flood")
    assert acks(out) == [("applied", None)]
    assert frame(game)["parts"][0]["chosen"] == "flood"
    assert state_of(game)["player"]["statement"] == {"cause": "flood"}
    out = act(game, "statement", op="choose", part="cause", option="li_er")
    assert acks(out) == [("applied", None)]  # another option replaces the first
    assert frame(game)["parts"][0]["chosen"] == "li_er"
    assert acks(act(game, "statement", op="clear", part="cause")) == [("applied", None)]
    assert frame(game)["parts"][0]["chosen"] is None
    assert acks(act(game, "statement", op="clear", part="cause")) == [("applied", None)]
    assert state_of(game)["clock"].get("debt") == before.get("debt")  # nothing owed: no time


def test_an_option_no_note_bears_on_a_part_that_is_not_there_and_a_malformed_choice_are_refused():
    game = slice_game()
    assert acks(act(game, "statement", op="choose", part="cause", option="boat")) == [
        ("rejected", "not_shown")
    ]
    assert acks(act(game, "statement", op="choose", part="cause", option="nothing")) == [
        ("rejected", "unknown_option")
    ]
    assert acks(act(game, "statement", op="choose", part="colour", option="boat")) == [
        ("rejected", "unknown_part")
    ]
    assert acks(act(game, "statement", op="clear", part="colour")) == [("rejected", "unknown_part")]
    assert "statement" not in state_of(game)["player"]  # a refusal changes nothing
    from lantern_core.inputs import InputError

    for fields in (
        {"op": "pick", "part": "cause"},
        {"op": "choose", "part": "cause"},
        {"op": "clear"},
    ):
        with pytest.raises(InputError, match="player action statement"):
            act(game, "statement", **fields)


def test_the_card_can_be_filled_in_a_talk_as_well_as_out_of_one():
    game = talking("cha_laoban", hour=10)
    bear(game, "boat")
    assert me(game)["talk"]
    assert acks(act(game, "statement", op="choose", part="cause", option="boat")) == [
        ("applied", None)
    ]
    assert me(game)["talk"]  # still there: nothing was spent
    assert frame(game)["parts"][0]["chosen"] == "boat"


def test_the_choices_are_in_the_state_and_in_a_save_and_come_back_with_it():
    game = slice_game(variant="v_flood")
    fill(game)
    saved = game.snapshot_json()
    again = Game.from_snapshot_json(saved)
    assert state_of(again)["player"]["statement"] == RIGHT["v_flood"]
    assert frame(again) == frame(game) and again.hash() == game.hash()
    assert frame(again)["parts"][1]["chosen"] == "flood_night"


def test_a_recording_with_choices_in_it_is_replayed_to_the_same_game():
    started = preset("slice")
    config = {**started["config"], "dev_actions": 1}  # the route has the helpers agree
    game = Game(started["seed"], started["scenario"], config)
    recorder = Recorder(game)
    bot = TruthRoute(json.loads(game.scene_json()), started["seed"])
    obs = Obs(json.loads(recorder.step("[]")))
    while "filled" not in bot.marks and game.tick < at(5, 19):
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        obs = Obs(json.loads(recorder.step(json.dumps(records))))
    assert state_of(game)["player"].get("statement")  # the route filled in what it could
    again = rebuild(canon.loads(canon.dumps_str(recorder.recording())))
    assert again.hash() == game.hash() and again.snapshot_json() == game.snapshot_json()
    assert frame(again) == frame(game)


# ------------------------------------------------------------------------------ stating


def test_the_full_statement_waits_for_the_fourth_evening_and_says_so():
    game = slice_game(variant="v_drunk")
    run_to(game, at(3, 18, 5))
    put(game, *world_of(game).town.places[TEAHOUSE].door)
    fill(game)
    card = frame(game)
    assert (card["can_state"], card["why_not"]["en"]) == (False, statement.too_early_words()["en"])
    assert acks(state_it(game)) == [("rejected", "too_early")]
    assert state_of(game)["player"]["public"]["speeches"] == []  # and nothing was spent
    run_to(game, at(4, 16, 59))
    assert frame(game)["why_not"] == statement.too_early_words()
    run_to(game, at(4, 17, 1))
    assert "why_not" in frame(game) and frame(game)["why_not"] != statement.too_early_words()


def test_the_card_must_be_filled_in_and_there_must_be_a_town_to_hear_it():
    game = evening()
    bear(game, "drunk")
    card = frame(game)
    assert (card["can_state"], card["why_not"]["en"]) == (
        False,
        "The three parts are not all filled in",
    )
    assert acks(state_it(game)) == [("rejected", "incomplete")]
    fill(game)
    assert frame(game)["can_state"] is True and frame(game)["why_not"] is None
    put(game, *world_of(game).town.places[TEAHOUSE].door)
    run_to(game, game.tick + 30)  # people near the manager: a talk can be opened
    act(game, "talk", npc="cha_laoban")
    if me(game)["talk"]:
        assert frame(game)["why_not"] == statement.WHY_NOT["talking"]
        assert acks(state_it(game)) == [("rejected", "talking")]
        act(game, "leave")
    away = evening()
    fill(away)
    put(away, *world_of(away).town.places["p_bridge"].cells[0])
    assert frame(away)["why_not"] == statement.WHY_NOT["no_venue"]
    assert acks(state_it(away)) == [("rejected", "no_venue")]
    for reason in statement.WHY_NOT.values():
        assert set(reason) == {"zh", "en"} and reason["zh"] and reason["en"]


def test_a_statement_takes_the_time_of_a_speech_and_there_is_one_a_day():
    game = evening()
    fill(game)
    out = state_it(game)
    assert acks(out) == [("applied", None)]
    assert state_of(game)["clock"]["debt"] > 0  # the 30 minutes of a speech, owed
    assert frame(game)["used_today"] is True and frame(game)["can_state"] is False
    assert frame(game)["why_not"]["en"] == "A statement has been made today already"
    assert acks(state_it(game)) == [("rejected", "stated_today")]
    assert len(state_of(game)["player"]["public"]["speeches"]) == 1
    run_to(game, at(5, 17, 30))  # the next day is another
    put(game, *world_of(game).town.places[TEAHOUSE].door)
    assert frame(game)["used_today"] is False
    assert statement.block(world_of(game), state_of(game), assembly.clock.at(game.tick)) in (
        None,
        "few_present",
    )


def test_a_statement_is_for_the_hall_while_the_clan_is_called_too(the_meeting_is_open):
    game = talking("zuzhang", seed=1, hour=9, day=1)
    for index in range(len(me(game)["trust"])):
        me(game)["trust"][index] = 100
    me(game)["evidence"].extend(PROOF["v_drunk"][0])  # the elder wants some proof in hand to call
    assert acks(act(game, "entrust", kind="convene")) == [("applied", None)]
    queue = state_of(game)["tasks"]["queue"]
    queue[:] = [
        t
        for t in queue
        if t["npc"]
        in ("li_laotai", "zhou_zhanggui", "cha_laoban", "old_he", "zhangfang", "zuzhang")
    ]
    act(game, "leave")
    for _ in range(1200):  # the clan comes, and the hall opens an hour after the call
        idle(game)
        here = assembly.audience(state_of(game), "p_clan_hall")
        if assembly.meeting_open(me(game), game.tick) and len(here) >= 6:
            break
    fill(game, RIGHT[state_of(game)["social"]["variant"]])
    event = stated(state_it(game))
    assert event["venue"] == "p_clan_hall" and event["named"] >= assembly.MIN_NAMED


# ----------------------------------------------------------------------------- the three judgements


@pytest.mark.parametrize("variant", VARIANTS)
def test_a_statement_with_the_parts_right_and_the_proof_and_the_town_tells_the_truth(variant):
    game = evening(variant)
    out = tell(game)
    event = stated(out)
    assert event["wrong"] == [] and event["proof"] is True and event["told"] is True
    assert event["elder"] == 2 and event["percent"] >= assembly.ACCEPT_PERCENT
    flags = state_of(game)["goals"]["flags"]
    assert {"truth_told", "elder_accepts"} <= set(flags)
    last = frame(game)["last"]
    assert (last["told"], last["wrong"], last["why"]) == (True, [], None)
    assert (last["day"], last["hour"], last["venue"]) == (4, 18, TEAHOUSE)
    # the town now believes what happened, and the story is the one that was true
    truth = goals_ending.true_conflict_props(variant)[0].id
    believers = [
        p
        for p in assembly.audience(state_of(game), TEAHOUSE)
        if (b := notes.store(state_of(game)["social"], p).get(truth)) and b.confidence >= 85
    ]
    assert len(believers) >= 5


def test_a_part_that_notes_only_go_against_has_nothing_to_choose_in():
    """The footprint says the elder brother of the Zhou house was at the bridge and broke the rail.
    That bears for the cause and the course of the drunken kick and against the rumour that Li Er
    did it, so the part on where the talk came from shows that one option, with no note for it and
    one against. There is nothing to choose in it until something is found that speaks for an
    option."""
    section = {
        "notebook": [{"id": "n1", "prop": "pr_dalang_damaged"}],
        "statement": {},
    }
    assert statement.fillable(section)  # the cause and the course have an option with a note for it
    section["statement"] = {"cause": "drunk", "course": "drunk_night"}
    (rumour,) = [p for p in statement.parts() if p["id"] == "rumour"]
    shown = statement.shown(section, rumour)
    assert [(o["id"], o["support"], o["against"]) for o in shown] == [("seen", 0, 1)]
    assert not statement.fillable(section)  # (it was fillable while the card showed that option)
    # the clerk's word that he saw Li Er at the bridge speaks for how the talk grew
    section["notebook"].append({"id": "n2", "prop": "pr_liner_at_bridge"})
    assert statement.fillable(section)


@pytest.mark.parametrize("variant", VARIANTS)
def test_the_three_are_judged_apart_so_one_that_fails_does_not_hide_the_others(variant):
    # the parts are right, the town accepts, the proof is short
    game = evening(variant, proof=False)
    event = stated(tell(game))
    assert (event["wrong"], event["proof"], event["told"]) == ([], False, False)
    assert event["percent"] >= assembly.ACCEPT_PERCENT and event["elder"] == 2
    assert "truth_told" not in state_of(game)["goals"]["flags"]
    assert assembly.missed(state_of(game)) == "proof"
    assert frame(game)["last"]["why"] == statement.PROOF.copy()
    # the proof is there, the town accepts, a part is wrong
    game = evening(variant)
    event = stated(tell(game, {**RIGHT[variant], "course": WRONG[variant]["course"]}))
    assert event["wrong"] == ["course"] and event["proof"] is True and event["told"] is False
    assert "truth_told" not in state_of(game)["goals"]["flags"]
    assert assembly.missed(state_of(game)) == "parts"
    # the parts are right, the proof is there, the town does not accept
    game = evening(variant, trusting=False)
    for beliefs in state_of(game)["social"]["beliefs"].values():
        beliefs.pop("pr_liner_damaged", None)
    me(game)["trust"] = [0] * len(me(game)["trust"])
    for person in assembly.audience(state_of(game), TEAHOUSE):
        notes.hold(
            state_of(game)["social"],
            Belief(
                person, "pr_liner_damaged", "assert", 99, "heard", "zhou_huoji", "zhou_huoji", 1, 0
            ),
        )
    event = stated(tell(game))
    assert event["wrong"] == [] and event["proof"] is True and event["told"] is False
    assert event["percent"] < assembly.ACCEPT_PERCENT
    assert assembly.missed(state_of(game)) in ("accepted", "elder_refused")


def test_the_proof_persuades_in_full_only_as_far_as_the_cause_stated_is_the_true_one():
    """A set that tells the boat apart persuades a town that is told the boat, and not one that is
    told the flood: it refutes the rumour, and no more."""
    right = evening("v_boat")
    wrong = evening("v_boat")
    for game in (right, wrong):
        for beliefs in state_of(game)["social"]["beliefs"].values():
            beliefs.pop("pr_liner_damaged", None)
        me(game)["trust"] = [20] * len(me(game)["trust"])
    a = stated(tell(right))
    b = stated(tell(wrong, {"cause": "flood", "course": "flood_night", "rumour": "grew"}))
    assert a["accepted"] > b["accepted"]


def test_a_part_that_did_not_hold_costs_trust_with_everyone_there_and_names_the_failure():
    game = evening("v_boat")
    here = assembly.audience(state_of(game), TEAHOUSE)
    before = {p: trust_of(game, p) for p in here}
    out = tell(game, WRONG["v_boat"])
    event = stated(out)
    assert event["wrong"] == ["cause", "course", "rumour"]
    after = {p: trust_of(game, p) for p in here}
    assert all(
        after[p] <= before[p] + assembly.ACCEPT_TRUST - statement.STATEMENT_COST for p in here
    )
    last = frame(game)["last"]
    assert last["wrong"] == ["cause", "course", "rumour"] and last["told"] is False
    for part in ("How the bridge broke", "What happened that night", "Why people got it wrong"):
        assert part in last["why"]["en"]
    assert (
        "桥是怎么坏的" in last["why"]["zh"]
        and "那晚的经过" in last["why"]["zh"]
        and "大家为什么会误会" in last["why"]["zh"]
    )


def test_a_right_statement_costs_nothing_and_a_wrong_one_costs_exactly_the_price():
    right, wrong = evening("v_drunk"), evening("v_drunk")
    here = assembly.audience(state_of(right), TEAHOUSE)
    start = {p: trust_of(right, p) for p in here}
    tell(right)
    assert all(trust_of(right, p) >= start[p] for p in here)
    tell(wrong, WRONG["v_drunk"])
    assert all(
        trust_of(wrong, p) <= start[p] - statement.STATEMENT_COST + assembly.ACCEPT_TRUST
        for p in here
    )
    assert statement.STATEMENT_COST > assembly.ACCEPT_TRUST  # a lie is never a gain


def test_a_wrong_statement_that_the_town_accepts_changes_what_it_believes_and_tells_nothing():
    game = evening("v_drunk")
    out = tell(game, {"cause": "boat", "course": "boat_night", "rumour": "grew"})
    event = stated(out)
    assert event["wrong"] == ["cause", "course"] and event["told"] is False
    assert event["accepted"] >= assembly.MIN_NAMED  # the town took it
    assert "truth_told" not in state_of(game)["goals"]["flags"]
    here = assembly.audience(state_of(game), TEAHOUSE)
    social = state_of(game)["social"]
    believers = [
        p
        for p in here
        if (b := notes.store(social, p).get("pr_boat_damaged")) and b.confidence >= 85
    ]
    assert len(believers) == event["accepted"]
    sides = goals_ending.believers(state_of(game))
    assert set(believers) <= set(sides["false"])  # what they hold is false in this story
    assert goals_ending.false_belief_share(state_of(game)) >= 100 * len(believers) // len(LO.people)
    # and the one the statement blames does not accept it
    assert assembly.blamed([lore().book.props["pr_dalang_damaged"]]) == "zhou_dalang"


def test_a_wrong_account_of_the_talk_that_is_accepted_is_taken_in_and_a_decoy_states_nothing():
    game = evening("v_flood")
    event = stated(tell(game, {**RIGHT["v_flood"], "rumour": "invented"}))
    assert event["wrong"] == ["rumour"] and event["told"] is False and event["accepted"] >= 5
    social = state_of(game)["social"]
    here = assembly.audience(state_of(game), TEAHOUSE)
    believing = [
        p
        for p in here
        if (b := notes.store(social, p).get("pr_liner_not_bridge")) and b.confidence >= 40
    ]
    # those who accepted came to believe what was said, except those who saw better themselves
    assert assembly.MIN_NAMED <= len(believing) <= event["accepted"]
    smear = statement.option_of(statement.part_of("rumour"), "smear")
    assert smear["claims"] == [] and smear["right"] == []  # the decoy says what no prop says
    again = evening("v_flood")
    event = stated(tell(again, {**RIGHT["v_flood"], "rumour": "smear"}))
    assert event["wrong"] == ["rumour"] and event["accepted"] >= 5


def test_the_person_a_statement_blames_never_accepts_it_whatever_they_think_of_the_manager():
    game = evening("v_boat")
    assert assembly.blamed([lore().book.props["pr_boat_damaged"]]) == "old_he"
    world = state_of(game)
    claimed = [lore().book.props["pr_dalang_damaged"]]
    culprit = assembly.blamed(claimed)
    me(game)["trust"] = [100] * len(me(game)["trust"])
    assert not assembly.accepts_claim(world, culprit, claimed, culprit, 100, [])
    assert assembly.accepts_claim(world, "li_laotai", claimed, culprit, 100, [])


# ------------------------------------------------------------------------------ the failures


def test_a_part_fails_as_contradicted_unseen_or_unsourced_from_the_notebook_alone():
    game = slice_game()
    section = me(game)
    cause = statement.part_of("cause")
    boat = statement.option_of(cause, "boat")
    assert statement.failure(section, "cause", boat) == ["cause", "unseen", ""]
    know(game, "pr_boat_scratched")  # seen by the manager: for the boat, but it shows no more
    assert statement.failure(section, "cause", boat) == ["cause", "unsourced", ""]
    know(game, "pr_flood_damaged", "heard", "gengfu", claimed=None)  # hearsay from the watchman
    assert statement.failure(section, "cause", boat) == ["cause", "unsourced", ""]
    seen = Belief(PLAYER, "pr_dalang_damaged", "assert", 60, "heard", "xiao_man", "self_seen", 1, 0)
    notebook.add_heard(section, seen)  # told by someone who says they saw it: first-hand
    assert statement.failure(section, "cause", boat) == ["cause", "contradicted", "xiao_man"]
    know(game, "pr_flood_damaged")  # replaced by what the manager saw (in order of the notebook)
    assert statement.failure(section, "cause", boat)[1] == "contradicted"
    words = statement.failure_words(world_of(game), ["cause", "contradicted", "xiao_man"])
    assert words == {  # the part, then what was wrong with it
        "zh": "「桥是怎么坏的」这一条，和小满亲眼看见的不一样",
        "en": "The part “How the bridge broke” goes against what Xiaoman saw with their own eyes",
    }
    own = statement.failure_words(world_of(game), ["cause", "contradicted", PLAYER])
    assert own["en"] == (
        "The part “How the bridge broke” goes against what you saw with your own eyes"
    )
    assert own["zh"] == "「桥是怎么坏的」这一条，和你亲眼看见的不一样"


# ------------------------------------------------------------------------------ the frame


def test_the_frame_has_the_card_in_the_shape_of_the_contract_in_both_languages():
    game = evening("v_boat")
    fill(game)
    card = frame(game)
    assert set(card) == {"parts", "can_state", "why_not", "used_today", "last"}
    for part in card["parts"]:
        assert set(part) == {"part", "title", "options", "chosen", "gap"}
        assert set(part["title"]) == {"zh", "en"}
        for one in part["options"]:
            assert set(one) == {"id", "text", "support", "against", "entries"}
            assert set(one["text"]) == {"zh", "en"} and one["text"]["zh"] and one["text"]["en"]
    assert json.loads(canon.dumps_str(card)) == card  # plain values only
    out = stated(tell(game))
    last = frame(game)["last"]
    assert set(last) == {
        "day", "hour", "venue", "named", "accepted", "percent", "elder", "told", "wrong", "why",
    }  # fmt: skip
    assert last["elder"] == "accepted" and last["told"] is True and out
    assert projection.problems(frame_now(game)) == []
    assert projection.mark_of("statement.parts[].options[].entries") == "known"
    assert projection.mark_of("statement.last.why.zh") == "known"
    board = frame_now(game)["board"]["statement"]
    assert [(c["part"], c["gap"]) for c in board] == [
        ("cause", False),
        ("course", False),
        ("rumour", False),
    ]
    assert all(c["against"] == 0 and c["support"] >= 1 for c in board)


def test_the_offers_of_the_page_have_the_full_statement_where_the_manager_may_speak():
    game = evening("v_boat")
    offers = frame_now(game)["player"]["offers"]["speak"]
    (one,) = [o for o in offers if o["id"] == "statement"]
    assert one["body"] == {"kind": "statement"} and one["label"]["zh"] and one["label"]["en"]


def test_changing_what_is_hidden_changes_nothing_the_card_says():
    """The card is made from the notebook and the choices. Change the story that is true, what each
    person believes, how far they trust the manager: the card is as it was."""
    game = evening("v_flood", trusting=False)
    for name in ("flood", "flood_night", "grew"):
        bear(game, name)
    fill(game, RIGHT["v_flood"])
    base = frame(game)
    saved = game.snapshot_json()
    for name, change in hidden_changes().items():
        twin = Game.from_snapshot_json(saved)
        before = canon.digest(state_of(twin))
        change(state_of(twin))
        assert canon.digest(state_of(twin)) != before, name
        assert frame_now(twin)["statement"] == base, name
        assert frame_now(twin)["board"]["statement"] == frame_now(game)["board"]["statement"], name


def test_the_last_statement_is_known_to_the_player_so_it_may_say_which_part_held():
    """What a statement made says of the parts depends on the story, and that is the point of
    making it: the player is told. Before it is made the card says the same in every story."""
    cards = {}
    for variant in VARIANTS:
        game = evening(variant)
        fill(game)
        cards[variant] = frame(game)
    assert cards["v_boat"]["last"] is None and cards["v_flood"]["last"] is None
    for variant in VARIANTS:
        game = evening(variant)
        tell(game, {**RIGHT[variant], "cause": WRONG[variant]["cause"]})
        assert frame(game)["last"]["wrong"] == ["cause"], variant


# -------------------------------------------------------------------------- the people who heard it


@pytest.mark.parametrize("variant", VARIANTS)
def test_the_event_says_who_took_the_statement_in_and_why_as_a_clarification_does(variant):
    """``stated`` has the audience that ``clarified`` has: each person there, the stand they came
    with and the stand they leave with, and the fixed line they say in public."""
    game = evening(variant)
    event = stated(tell(game))
    audience = event["audience"]
    here = assembly.audience(state_of(game), TEAHOUSE)
    assert [row["npc"] for row in audience] == here and len(here) == event["named"]
    stands = {clarify.FOR, clarify.UNSURE, clarify.AGAINST}
    for row in audience:
        assert set(row) == {"npc", "before", "after", "reason"}
        assert row["before"] in stands and row["after"] in stands
        assert set(row["reason"]) == {"zh", "en"} and row["reason"]["zh"] and row["reason"]["en"]
    leaving = [row for row in audience if row["after"] == clarify.FOR]
    assert len(leaving) >= event["accepted"] > 0  # whoever accepted leaves for it
    assert event["told"] is True and event["elder"] == 2
    elder = next(row for row in audience if row["npc"] == assembly.ELDER)
    assert elder["after"] == clarify.FOR


def test_a_person_the_statement_blames_takes_no_stand_and_a_refusal_is_against_or_unsure():
    game = evening("v_drunk", trusting=False)
    picks = {**RIGHT["v_drunk"], "cause": "li_er"}  # blames Li Er: a wrong cause
    event = stated(tell(game, picks))
    assert "cause" in event["wrong"]
    by = {row["npc"]: row for row in event["audience"]}
    if "li_er" in by:  # the one blamed accepts nothing and stays where they were
        assert by["li_er"]["after"] == by["li_er"]["before"]
    for row in event["audience"]:
        if row["after"] != clarify.FOR:
            assert row["after"] in (clarify.AGAINST, clarify.UNSURE)


def test_the_audience_of_a_statement_is_the_same_whichever_story_is_true():
    """The stands are read from what the people there hold and what is stated, never from the
    variant: the same notes, the same card and the same trust give the same stands in every
    story."""
    seen = {}
    for variant in VARIANTS:
        game = evening(variant, proof=False)
        picks = {"cause": "boat", "course": "boat_night", "rumour": "grew"}
        event = stated(tell(game, picks))
        seen[variant] = [(row["npc"], row["before"]) for row in event["audience"]]
    assert seen["v_boat"] == seen["v_flood"] == seen["v_drunk"]
