"""Entrusting: the hard conditions and the score, Granny Li's three ways to the bamboo, and what
each kind of request does in the town. (Her first way is that she knows the rumour was cleared in
public, and her yes does not send Li Da: he is asked himself, see ``test_bridge_clarify``.)"""

import json

import pytest
from bridge_helpers import state_of
from dealings_helpers import acks, act, believe, events, know, me, talking, trust
from player_helpers import beside, plain, seed_of, silence
from voice_helpers import says

from lantern_core.inputs import InputError
from lantern_core.world.bridge import (
    assembly,
    clarify,
    goals,
    notebook,
    persuade,
    pledges,
    repute,
    tasks,
)
from lantern_core.world.bridge.lore import lore

LO = lore()
RUMOURS = ["pr_li_damaged", "pr_li_damaged_jealous", "pr_li_damaged_on_purpose"]
BAMBOO = {"kind": "lend"}


def cleared_for_her(game, confidence=90):
    """Granny Li has seen the rumour cleared in public herself (she took the clarification in)."""
    believe(game, "li_laotai", clarify.CLAIM, confidence, "saw")


def ask(game, **fields):
    return act(game, "entrust", **fields)


def verdict(out):
    (event,) = events(out, "entrusted")
    return event


def granny(trust_in=40, **config):
    game = talking("li_laotai", **config)
    trust(game, "li_laotai", trust_in)
    return game


def bamboo_posted(game):
    return [t for t in state_of(game)["tasks"]["queue"] if t["npc"] == "li_da"]


def persuade_min():
    """How sure she has to be of the clarification (``min`` of the first way, in the script)."""
    (cond,) = persuade.hard_condition("hc_li_bamboo")["any"][0]["all"]
    return cond["min"]


def dealings(game):
    """What a request can change: the manager's section without the words on show, the goals, the
    errands and what the townsfolk believe of each other and the manager."""
    state = state_of(game)
    kept = {k: v for k, v in state["player"].items() if k != "line"}
    return json.dumps(
        [kept, state["goals"], state["tasks"]["queue"], state["social"]["beliefs"]], sort_keys=True
    )


# ------------------------------------------------------------------------------ the three ways


def test_without_any_of_the_three_ways_granny_does_not_lend_whatever_she_thinks_of_the_manager():
    game = granny(trust_in=100)
    out = ask(game, **BAMBOO)
    assert acks(out) == [("rejected", "hard")] and verdict(out)["result"] == "hard"
    assert verdict(out)["way"] == "" and not bamboo_posted(game) and "bamboo" not in me(game)["nod"]
    says(out, "li_laotai", "hard_hc_li_bamboo")


def test_the_first_way_is_the_rumour_cleared_in_public_which_she_has_seen_herself():
    game = granny(trust_in=30)
    cleared_for_her(game)
    out = ask(game, **BAMBOO)
    assert acks(out) == [("applied", None)]
    assert verdict(out)["way"] == "hc_rumor_cleared" and verdict(out)["result"] == "agreed"
    assert "bamboo" in me(game)["nod"]
    assert not bamboo_posted(game) and not events(out, "agreed")  # Li Da is not sent by her word


def test_what_the_town_was_told_is_not_what_she_knows():
    game = granny(trust_in=100)
    me(game)["public"]["refuted"] = list(RUMOURS)  # all of it, in front of everyone else
    assert persuade.open_way(state_of(game), "hc_li_bamboo") is None
    assert acks(ask(game, **BAMBOO)) == [("rejected", "hard")]
    cleared_for_her(game, persuade_min() - 1)  # and she has heard of it, and hardly believes it
    assert persuade.open_way(state_of(game), "hc_li_bamboo") is None
    cleared_for_her(game, persuade_min())
    assert persuade.open_way(state_of(game), "hc_li_bamboo") == "hc_rumor_cleared"
    assert acks(ask(game, **BAMBOO)) == [("applied", None)]  # the door was shut, and is not now


def test_the_second_way_is_an_honour_for_her_family_and_her_trust_at_forty_five():
    game = granny(trust_in=20)
    assert acks(act(game, "promise", what="role", item="t_honor_light", due=3)) == [
        ("applied", None)
    ]
    trust(game, "li_laotai", 44)
    assert acks(ask(game, **BAMBOO)) == [("rejected", "hard")]  # an honour, and not enough trust
    trust(game, "li_laotai", 45)
    out = ask(game, **BAMBOO)
    assert acks(out) == [("applied", None)] and verdict(out)["way"] == "hc_honor_and_trust"
    assert "bamboo" in me(game)["nod"] and not bamboo_posted(game)


def test_an_honour_that_the_manager_gave_to_the_other_family_does_not_count():
    game = talking("zhou_zhanggui")
    assert acks(act(game, "promise", what="role", item="t_honor_light", due=3)) == [
        ("applied", None)
    ]
    assert pledges.honoured(me(game), "t_honor_light", "fam_zhou")
    assert not pledges.honoured(me(game), "t_honor_light", "fam_li")
    act(game, "leave")
    beside(game, "li_laotai")
    silence(game)
    act(game, "talk", npc="li_laotai")
    trust(game, "li_laotai", 100)
    assert acks(ask(game, **BAMBOO)) == [("rejected", "hard")]


def test_the_honour_of_a_person_of_her_family_is_the_honour_of_her_family():
    game = talking("li_xiaomei")
    assert acks(act(game, "promise", what="role", item="t_honor_light", due=3)) == [
        ("applied", None)
    ]
    assert pledges.honoured(me(game), "t_honor_light", "fam_li")
    assert pledges.honoured(me(game), "t_honor_light", "li_xiaomei")
    assert not pledges.honoured(me(game), "t_honor_light", "li_laotai")  # a person, not the family


def test_the_third_way_is_the_clan_elder_asked_and_won_over_to_ask_her_himself():
    game = talking("zuzhang")
    trust(game, "zuzhang", 60)
    out = ask(game, kind="persuade", target="li_laotai")
    assert acks(out) == [("applied", None)] and verdict(out)["result"] == "agreed"
    assert [row[:2] for row in me(game)["asks"]] == [["zuzhang", "li_laotai"]]
    assert "zuzhang" in me(game)["won"]
    act(game, "leave")
    beside(game, "li_laotai")
    silence(game)
    act(game, "talk", npc="li_laotai")
    trust(game, "li_laotai", 30)
    out = ask(game, **BAMBOO)
    assert acks(out) == [("applied", None)] and verdict(out)["way"] == "hc_elder_asks"
    assert "bamboo" in me(game)["nod"] and not bamboo_posted(game)


def test_the_elder_won_over_for_something_else_is_not_the_third_way_until_he_has_asked_her():
    game = talking("zuzhang")
    trust(game, "zuzhang", 80)
    assert acks(ask(game, kind="join")) == [("applied", None)]
    assert "zuzhang" in me(game)["won"] and me(game)["asks"] == []
    cond = persuade.hard_condition("hc_li_bamboo")["any"][2]["all"]
    assert [persuade.condition_holds(state_of(game), c) for c in cond] == [True, False]
    assert persuade.open_way(state_of(game), "hc_li_bamboo") is None


def test_a_way_that_is_open_and_a_score_that_is_short_is_a_refusal_and_not_a_closed_door():
    game = granny(trust_in=0)
    cleared_for_her(game)
    out = ask(game, **BAMBOO)
    event = verdict(out)
    assert acks(out) == [("rejected", "refused")]
    assert (event["result"], event["way"]) == ("refused", "hc_rumor_cleared")
    assert event["total"] == -1 and event["need"] == 20  # her nature takes a point off
    says(out, "li_laotai", "turned_down")
    trust(game, "li_laotai", 21)  # exactly the price
    assert verdict(ask(game, **BAMBOO))["result"] == "agreed"


def test_li_da_will_not_carry_the_bamboo_until_his_mother_has_agreed_and_he_knows_of_the_clearing():
    game = talking("li_da")
    trust(game, "li_da", 60)
    out = ask(game, kind="material")
    assert acks(out) == [("rejected", "needs_nod")]
    says(out, "li_da", "needs_nod")
    me(game)["nod"]["bamboo"] = game.tick  # his mother has agreed: it is not enough
    out = ask(game, kind="material")
    assert acks(out) == [("rejected", "unaware")]
    says(out, "li_da", "hard_hc_li_bamboo")
    believe(game, "li_da", clarify.CLAIM, 90, "saw")  # and he has heard it cleared in public
    out = ask(game, kind="material")
    assert acks(out) == [("applied", None)] and events(out, "agreed")[0]["what"] == "bamboo"


# ------------------------------------------------------------------------------ the score


def test_the_score_is_trust_favour_promises_in_hand_acquaintances_cites_and_nature():
    game = talking("zhou_zhanggui")
    world = game._kernel.world
    state = state_of(game)
    trust(game, "zhou_zhanggui", 30)
    parts = dict(persuade.weigh(world, state, "zhou_zhanggui", "join").parts)
    # his nature: (suspicion 65 - warmth 35) // 5 = 6 off; the wording is nothing offline
    assert parts == {
        "trust": 30,
        "favour": 0,
        "hand": 0,
        "crowd": 0,
        "cite": 0,
        "personality": -6,
        "wording": 0,
    }
    assert persuade.WORDING == 0
    pledges.add_deed(me(game), "gift", "zhou_zhanggui", 2, 1, 0)
    pledges.add_deed(me(game), "owed", "zhou_zhanggui", 1, -1, 0)
    act(game, "promise", what="role", item="stage_words", due=3)  # size 3: 4 * 3 in hand
    act(game, "promise", what="slot", item="2", due=3)  # size 1 more
    parts = dict(persuade.weigh(world, state, "zhou_zhanggui", "join").parts)
    assert parts["favour"] == 4 * (2 - 1) and parts["hand"] == 16
    state["goals"]["call"]["joined"].append(["zhou_zhanggui", 0, 0, "x"])
    for other in ("zhou_niangzi", "zhou_huoji", "li_laotai"):  # two acquaintances, and a stranger
        state["goals"]["call"]["joined"].append([other, 0, 1, "call"])
    assert dict(persuade.weigh(world, state, "zhou_zhanggui", "join").parts)["crowd"] == 8


def test_a_request_is_agreed_at_its_price_and_not_one_point_under():
    # the night watchman: suspicion 55 and warmth 40, so his nature takes 3 off; joining is 30
    game = talking("gengfu", hour=19)
    trust(game, "gengfu", 32)
    event = verdict(ask(game, kind="join"))
    assert (event["total"], event["need"], event["result"]) == (29, 30, "refused")
    trust(game, "gengfu", 33)
    event = verdict(ask(game, kind="join"))
    assert (event["total"], event["need"], event["result"]) == (30, 30, "agreed")


@pytest.mark.parametrize(
    ("prop", "source", "teller", "held", "worth"),
    [
        ("pr_boat_scratched", "saw", None, "agrees", 5),  # she believes what it says
        ("pr_boat_damaged", "saw", None, "clashes", -8),  # she believes it cannot be so
        ("pr_boat_scratched", "saw", None, None, 4),  # she knows nothing of it, and it was seen
        ("pr_boat_scratched", "heard", "li_er", None, 2),  # and it was only heard
    ],
)
def test_a_cited_entry_is_worth_what_it_is_to_the_person_who_hears_it(
    prop, source, teller, held, worth
):
    game = talking("cha_laoban")
    entry = know(game, prop, source, teller)
    if held == "agrees":
        believe(game, "cha_laoban", prop, 70, "saw")
    elif held == "clashes":
        believe(game, "cha_laoban", "pr_flood_damaged", 70, "saw")
    assert persuade.cite_credit(state_of(game), "cha_laoban", (entry["id"],)) == worth
    weighed = persuade.weigh(
        game._kernel.world, state_of(game), "cha_laoban", "join", (entry["id"],)
    )
    assert dict(weighed.parts)["cite"] == worth
    assert verdict(ask(game, kind="join", cite=[entry["id"]]))["total"] == weighed.total


def test_at_most_three_entries_are_counted_and_the_credit_is_held_to_nine():
    props = ("pr_boat_scratched", "pr_gengfu_round", "pr_xiaoman_riverbank", "pr_dalang_drank")
    game = talking("cha_laoban")
    heard = [know(game, prop, "heard", "li_er")["id"] for prop in props]
    world_state = state_of(game)
    assert persuade.cite_credit(world_state, "cha_laoban", tuple(heard[:3])) == 6
    assert persuade.cite_credit(world_state, "cha_laoban", tuple(heard)) == 6  # the fourth is left
    for prop in props[:3]:
        believe(game, "cha_laoban", prop, 70, "saw")
    assert persuade.cite_credit(world_state, "cha_laoban", tuple(heard)) == 9  # 15, held to 9


def test_pointing_at_what_a_person_has_just_said_is_worth_a_little_and_no_more():
    game = talking("cha_laoban")
    said = []
    for topic in ("p_bridge", "t_rail"):  # what a manager asks about to get a person talking
        out = act(game, "ask", topic=topic)
        (asked,) = events(out, "asked")
        assert asked["answer"] == "claim"
        said.append(asked["entry"])
        believe(game, "cha_laoban", notebook.find(me(game), asked["entry"])["prop"], 70, "saw")
    # the two things she told, 5 each, held to nine
    assert persuade.cite_credit(state_of(game), "cha_laoban", tuple(said)) == 9


@pytest.mark.parametrize("kind", persuade.KINDS)
def test_a_citation_cannot_carry_a_request_alone(kind):
    # a stranger whose nature adds nothing, and the three entries she holds herself, which are
    # the most that pointing at things can be worth: she is still short of even the cheapest price
    game = talking("zhou_niangzi")
    trust(game, "zhou_niangzi", repute.STRANGER)
    cites = []
    for prop in ("pr_boat_scratched", "pr_gengfu_round", "pr_xiaoman_riverbank"):
        cites.append(know(game, prop, "heard", "zhou_niangzi")["id"])
        believe(game, "zhou_niangzi", prop, 70, "saw")
    world, world_state = game._kernel.world, state_of(game)
    weighed = persuade.weigh(world, world_state, "zhou_niangzi", kind, tuple(cites))
    parts = dict(weighed.parts)
    assert parts["cite"] == persuade.CITE_LIMIT and parts["personality"] == 0
    assert weighed.total == repute.STRANGER + persuade.CITE_LIMIT
    assert not weighed.agrees, (kind, weighed.total, weighed.need)


def test_a_promise_carries_a_request_that_a_citation_leaves_short():
    # the night watchman: joining is 30, and his nature takes 3 off
    game = talking("gengfu", hour=19)
    trust(game, "gengfu", 18)
    cites = []
    for prop in ("pr_boat_scratched", "pr_gengfu_round", "pr_xiaoman_riverbank"):
        cites.append(know(game, prop, "heard", "gengfu")["id"])
        believe(game, "gengfu", prop, 70, "saw")
    cited = verdict(ask(game, kind="join", cite=cites))
    assert (cited["total"], cited["need"], cited["result"]) == (18 - 3 + 9, 30, "refused")
    act(game, "promise", what="role", item="stage_words", due=3)  # size 3: 4 * 3 in hand
    promised = verdict(ask(game, kind="join"))  # and nothing cited
    assert (promised["result"], promised["total"] >= promised["need"]) == ("agreed", True)
    assert persuade.HAND_MAX > persuade.CITE_LIMIT


def test_an_entry_that_is_not_in_the_notebook_cannot_be_cited():
    game = talking("cha_laoban")
    out = ask(game, kind="join", cite=["n7"])
    assert acks(out) == [("rejected", "no_entry")] and events(out, "entrusted") == []


# ------------------------------------------------------------------------------ "I have told you"


def test_the_same_request_with_nothing_new_gets_i_have_told_you_and_changes_nothing():
    game = granny(trust_in=0)
    cleared_for_her(game)
    first = ask(game, **BAMBOO)
    assert verdict(first)["result"] == "refused"
    before = dealings(game)
    again = ask(game, **BAMBOO)
    assert (
        acks(again) == [("rejected", "said_already")] and verdict(again)["result"] == "said_already"
    )
    says(again, "li_laotai", "said_already")
    assert dealings(game) == before  # not weighed again, and nothing moved
    assert acks(ask(game, **BAMBOO)) == acks(again) and dealings(game) == before


def test_a_request_is_weighed_again_when_the_situation_has_changed_or_there_is_new_evidence():
    game = granny(trust_in=0)
    cleared_for_her(game)
    assert verdict(ask(game, **BAMBOO))["result"] == "refused"
    assert verdict(ask(game, **BAMBOO))["result"] == "said_already"
    entry = know(game, "pr_boat_scratched")  # something to show
    out = ask(game, cite=[entry["id"]], **BAMBOO)
    assert verdict(out)["result"] == "refused" and verdict(out)["total"] == -1 + 4
    assert verdict(ask(game, cite=[entry["id"]], **BAMBOO))["result"] == "said_already"
    trust(game, "li_laotai", 10)  # the situation changed
    assert verdict(ask(game, cite=[entry["id"]], **BAMBOO))["result"] == "refused"
    trust(game, "li_laotai", 40)
    assert verdict(ask(game, cite=[entry["id"]], **BAMBOO))["result"] == "agreed"


def test_a_closed_door_is_the_same_door_until_the_way_opens():
    game = granny(trust_in=100)
    assert verdict(ask(game, **BAMBOO))["result"] == "hard"
    assert verdict(ask(game, **BAMBOO))["result"] == "said_already"
    cleared_for_her(game)
    assert verdict(ask(game, **BAMBOO))["result"] == "agreed"
    assert acks(ask(game, **BAMBOO)) == [("rejected", "said_already")]  # she has lent it


def test_asking_the_same_thing_of_another_person_or_another_thing_of_her_is_not_the_same_request():
    game = talking("cha_laoban")
    trust(game, "cha_laoban", 0)
    assert verdict(ask(game, kind="join"))["result"] == "refused"
    assert verdict(ask(game, kind="persuade", target="li_da"))["result"] == "refused"
    assert verdict(ask(game, kind="persuade", target="zhou_zhanggui"))["result"] == "refused"
    assert verdict(ask(game, kind="join"))["result"] == "said_already"


# ------------------------------------------------------------------------------ the kinds


def test_a_request_that_cannot_be_made_of_this_person_is_rejected_with_a_reason():
    game = talking("cha_laoban")
    for fields, reason in (
        ({"kind": "lane"}, "cannot"),
        ({"kind": "material"}, "cannot"),
        ({"kind": "lend"}, "cannot"),
        ({"kind": "convene"}, "cannot"),
        ({"kind": "persuade"}, "cannot"),  # whom?
        ({"kind": "persuade", "target": "shitou"}, "cannot"),  # a child cannot help
        ({"kind": "persuade", "target": "miaozhu"}, "cannot"),  # she does not know him
        ({"kind": "persuade", "target": "cha_laoban"}, "cannot"),
        ({"kind": "testify"}, "nothing_to_say"),
        ({"kind": "stand on one leg"}, "no_request"),
        ({}, "no_request"),
    ):
        assert acks(ask(game, **fields)) == [("rejected", reason)], fields
    assert me(game)["asked"] == {} and me(game)["deeds"] == {}


def test_the_state_is_unchanged_by_a_rejected_request_and_plain_after_a_granted_one():
    game = talking("cha_laoban")
    trust(game, "cha_laoban", 90)
    before = dealings(game)
    ask(game, kind="lane")
    assert dealings(game) == before
    assert verdict(ask(game, kind="join"))["result"] == "agreed"
    plain(game._kernel.state)


def test_joining_is_on_the_spot_when_the_score_is_ten_over_and_otherwise_a_wait_for_one_fewer():
    game = talking("cha_laoban")
    base = state_of(game)["goals"]["call"]["shift"]["cha_laoban"]
    trust(game, "cha_laoban", 33)  # her nature gives 6: a score of 39, price 30 and margin 10
    assert verdict(ask(game, kind="join"))["total"] == 39
    assert "cha_laoban" not in goals.joined(state_of(game))
    assert state_of(game)["goals"]["call"]["shift"]["cha_laoban"] == base - 1
    game = talking("cha_laoban")
    trust(game, "cha_laoban", 34)
    assert verdict(ask(game, kind="join"))["total"] == 40
    assert goals.joined(state_of(game)) == ["cha_laoban"]


def test_a_person_asked_to_talk_another_round_wins_a_kinsman_over_and_a_stranger_a_step():
    game = talking("li_da")
    trust(game, "li_da", 60)
    assert verdict(ask(game, kind="persuade", target="li_laotai"))["result"] == "agreed"
    assert "li_laotai" in goals.joined(state_of(game))  # her trust in her son, and he is kin
    assert me(game)["asks"][0][:2] == ["li_da", "li_laotai"]
    game = talking("zhou_huoji")
    trust(game, "zhou_huoji", 80)
    shift = state_of(game)["goals"]["call"]["shift"]["cha_laoban"]
    assert verdict(ask(game, kind="persuade", target="cha_laoban"))["result"] == "agreed"
    assert "cha_laoban" not in goals.joined(state_of(game))
    assert state_of(game)["goals"]["call"]["shift"]["cha_laoban"] == shift - 1


def test_a_person_who_has_joined_is_not_asked_twice_and_those_who_agreed_count_as_won_over():
    game = talking("cha_laoban")
    trust(game, "cha_laoban", 90)
    assert verdict(ask(game, kind="join"))["result"] == "agreed"
    assert acks(ask(game, kind="join")) == [("rejected", "said_already")]
    assert me(game)["won"] == ["cha_laoban"]
    assert "asked:cha_laoban|join|" in me(game)["deeds"]


def test_the_timber_comes_from_shopkeeper_zhou_and_the_lane_is_opened_by_the_temple_keeper():
    game = talking("zhou_zhanggui")
    trust(game, "zhou_zhanggui", 80)
    out = ask(game, kind="material")
    assert acks(out) == [("applied", None)] and events(out, "agreed")[0]["what"] == "timber"
    assert acks(ask(game, kind="material")) == [("rejected", "said_already")]
    game = talking("miaozhu")
    trust(game, "miaozhu", 60)
    out = ask(game, kind="lane")
    assert acks(out) == [("applied", None)] and events(out, "agreed")[0]["what"] == "lane"
    assert [t["kind"] for t in state_of(game)["tasks"]["queue"] if t["npc"] == "miaozhu"] == [
        "work"
    ]


def test_a_granted_request_is_a_favour_the_manager_owes_once():
    game = talking("zhou_zhanggui")
    trust(game, "zhou_zhanggui", 80)
    ask(game, kind="material")
    assert pledges.balance(me(game), "zhou_zhanggui") == -2
    ask(game, kind="material")
    assert pledges.balance(me(game), "zhou_zhanggui") == -2  # the same favour is not owed twice


def test_a_call_that_sends_nobody_is_no_meeting(monkeypatch):
    def nobody_can_come(*args, **kwargs):
        raise tasks.TaskError("bad_npc: nobody can come")

    monkeypatch.setattr(tasks, "assign", nobody_can_come)
    game = talking("zuzhang", hour=9)
    me(game)["evidence"].append("e_footprint")  # the elder calls the clan for a reason
    trust(game, "zuzhang", 90)
    out = ask(game, kind="convene")
    assert acks(out) == [("rejected", "cannot")] and not me(game)["meeting"]
    assert events(out, "convened") == []


def test_the_elder_calls_the_clan_in_the_morning_once():
    game = talking("zuzhang", hour=9)
    trust(game, "zuzhang", 90)
    assert acks(ask(game, kind="convene")) == [("rejected", "needs")]  # not for nothing
    me(game)["evidence"].append("e_footprint")
    out = ask(game, kind="convene")
    assert acks(out) == [("applied", None)] and len(events(out, "convened")[0]["invited"]) == 9
    assert assembly.clan_called(me(game), game.tick)  # the clan is on its way
    assert not assembly.meeting_open(me(game), game.tick)  # and the hall opens when it has come
    meeting, called = me(game)["meeting"], events(out, "convened")[0]["tick"]
    assert meeting["tick"] - called >= assembly.GATHER_TICKS  # an hour at least
    assert meeting["tick"] % 120 == 0  # on the hour (06:00 is tick 0 of a day of 2,070)
    assert meeting["until"] == called + assembly.MEETING_TICKS
    invited = [t["npc"] for t in state_of(game)["tasks"]["queue"] if t["kind"] == "work"]
    assert sorted(invited) == sorted(events(out, "convened")[0]["invited"])
    assert acks(ask(game, kind="convene")) == [("rejected", "said_already")]
    late = talking("zuzhang", hour=18)
    trust(late, "zuzhang", 90)
    out = ask(late, kind="convene")
    assert acks(out) == [("rejected", "too_late")] and not me(late)["meeting"]


# ------------------------------------------------------------------------------ testimony


def test_a_witness_who_is_asked_tells_what_they_saw_and_the_notebook_keeps_it_as_theirs():
    game = talking(
        "miaozhu", seed=seed_of("v_flood"), hour=9, day=4
    )  # the keeper speaks from the fourth
    trust(game, "miaozhu", 20)
    out = ask(game, kind="testify")
    assert acks(out) == [("applied", None)]
    (said,) = events(out, "testified")
    assert said["items"] == ["e_he_lamp"] and len(said["entries"]) == 1
    assert "e_he_lamp" in me(game)["evidence"]
    (entry,) = [e for e in out["frame"]["notebook"] if e["id"] == said["entries"][0]]
    assert entry["source"]["kind"] == "heard" and entry["source"]["who"]["id"] == "miaozhu"
    assert entry["source"]["hand"] == 1
    assert [name["id"] for name in entry["chain"]] == ["miaozhu"]  # who says they saw it themself
    assert entry["marks"] == []  # the notebook marks nothing the manager has not judged
    assert entry["text"]["en"] == "Boatman He was at home last night."
    again = ask(game, kind="testify")
    assert acks(again) == [("rejected", "said_already")]


def test_a_witness_with_nothing_to_tell_in_this_game_says_so_and_the_offer_does_not_give_it_away():
    game = talking("miaozhu", seed=seed_of("v_boat"), hour=9, day=4)
    trust(game, "miaozhu", 80)
    out = ask(game, kind="testify")
    assert acks(out) == [("rejected", "nothing_to_say")]
    says(out, "miaozhu", "nothing_to_say")
    assert any(o["id"] == "testify" for o in out["frame"]["player"]["offers"]["entrust"])


def test_the_gates_of_the_script_apply_to_testimony_the_hour_the_keeper_and_what_must_be_in_hand():
    game = talking("xiao_man", seed=seed_of("v_boat"), hour=10, day=3)
    trust(game, "xiao_man", 90)
    assert acks(ask(game, kind="testify")) == [("rejected", "closed")]  # she comes out at night
    game = talking("xiao_man", seed=seed_of("v_boat"), hour=19, day=2)
    trust(game, "xiao_man", 90)
    assert acks(ask(game, kind="testify")) == [
        ("rejected", "closed")
    ]  # and not before the third day
    game = talking("zhou_huoji", seed=seed_of("v_flood"), hour=9, day=3)
    trust(game, "zhou_huoji", 90)
    assert acks(ask(game, kind="testify")) == [("rejected", "refused")]  # his master keeps him
    trust(game, "zhou_zhanggui", 35)
    out = ask(game, kind="testify")
    assert acks(out) == [("applied", None)] and events(out, "testified")[0]["items"] == [
        "e_dalang_home"
    ]
    game = talking("zhou_huoji", seed=seed_of("v_drunk"), hour=9, day=3)
    trust(game, "zhou_huoji", 90)
    trust(game, "zhou_zhanggui", 90)
    assert acks(ask(game, kind="testify")) == [("rejected", "needs")]
    me(game)["evidence"].append("e_liner_testimony")
    assert acks(ask(game, kind="testify")) == [("applied", None)]


def test_a_person_must_be_willing_to_testify_as_to_anything():
    game = talking("miaozhu", seed=seed_of("v_flood"), hour=9, day=4)
    trust(game, "miaozhu", 10)
    assert acks(ask(game, kind="testify")) == [("rejected", "refused")]
    assert "e_he_lamp" not in me(game)["evidence"]


def test_a_malformed_request_is_an_error_and_an_unknown_kind_is_only_refused():
    game = talking("cha_laoban")
    for fields in ({"kind": 5}, {"kind": "join", "cite": "n1"}, {"kind": "join", "cite": [3]},
                   {"kind": "persuade", "target": 1}):  # fmt: skip
        with pytest.raises(InputError):
            ask(game, **fields)
    assert acks(act(game, "entrust")) == [("rejected", "no_request")]  # {} is no request
    act(game, "leave")
    assert acks(ask(game, kind="join")) == [("rejected", "not_talking")]
