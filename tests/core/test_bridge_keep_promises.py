"""The tasks that keep the manager's promises: what was promised to whom and by when, the action on
the day it falls due, the bar when it is kept or lapses, in both languages.

A stall, a role of honour, a wage or a place in the programme that the manager promises is owed
until it is kept in person, by the day it falls due (``pledges``). Each of the first twenty promises
(all that the offers can make) has a task of its own, ``t_keep_1`` to ``t_keep_20``: it appears when
the promise is made, has the action (a talk with the person, the promise ready to keep) from the
morning of the day it is due, is done when the promise is kept, and goes stale, with the bar saying
what it cost, when it is not.
"""

from __future__ import annotations

import pytest
from agenda_helpers import changed, frame_now, meet, slice_game, tasks_of
from bridge_helpers import at, run_to, state_of
from dealings_helpers import trust_of
from player_helpers import acks, act, me

from lantern_core.world.bridge import agenda, agenda_facts, pledges, repute

LI_DA, ZHOU, KEEPER = "li_da", "zhou_zhanggui", "miaozhu"


def make(game, who, what="stall", item="front", due=4, amount=0):
    """The manager walks up to ``who``, promises, and leaves. The outputs of the promise."""
    meet(game, who)
    out = act(game, "promise", op="make", what=what, item=item, amount=amount, due=due)
    act(game, "leave")
    return out


def keep(game, who, number):
    """The manager walks up to ``who`` and keeps the promise ``k<number>``."""
    meet(game, who)
    out = act(game, "promise", op="keep", id=f"k{number}")
    act(game, "leave")
    return out


def task(game, number):
    return tasks_of(frame_now(game))[f"t_keep_{number}"]


def game_with_a_promise(who=LI_DA, **kwargs):
    game = slice_game()
    run_to(game, at(2, 10))
    assert acks(make(game, who, **kwargs)) == [("applied", None)]
    return game


# ------------------------------------------------------------------------------ the task appears


def test_a_promise_gets_a_task_that_says_what_was_promised_to_whom_and_by_when():
    game = slice_game()
    run_to(game, at(2, 10))
    assert "t_keep_1" not in tasks_of(frame_now(game))
    assert acks(make(game, LI_DA)) == [("applied", None)]
    found = task(game, 1)
    assert (found["kind"], found["job"], found["state"]) == ("promise", None, "open")
    assert found["text"] == {"zh": "兑现对李大的许诺", "en": "Keep the promise to Li Da"}
    assert found["why"] == {
        "zh": "你答应给李大灯会上的前排摊位，最迟第四天要当面给。到时不给，李大就不信你了。",
        "en": (
            "You promised Li Da a front-row stall at the festival, to give in person by day 4. "
            "If you do not, Li Da will trust you less."
        ),
    }
    assert found["next"] == {
        "zh": "第四天去找李大当面兑现，早点去也行。",
        "en": "On day 4, go to Li Da and keep it in person, or sooner.",
    }
    # nothing to do with it before the day: the bar stays on what it was
    assert found["action"] is None and found["blocker"] is None
    assert frame_now(game)["tracked"] != "t_keep_1"
    # where and when to find the person on the day it falls due
    assert found["window"]["day"] == 4 and found["window"]["place"] == "p_li_house"


def test_each_promise_has_its_own_task():
    game = slice_game()
    run_to(game, at(2, 10))
    for _ in range(2):
        assert acks(make(game, LI_DA, "stall", "front")) == [("applied", None)]
    assert acks(make(game, ZHOU, "role", "lead_lanterns")) == [("applied", None)]
    found = tasks_of(frame_now(game))
    assert [found[f"t_keep_{n}"]["state"] for n in (1, 2, 3)] == ["open"] * 3
    assert found["t_keep_3"]["text"]["en"] == "Keep the promise to Shopkeeper Zhou"
    assert "the role of honour of leading the lantern parade" in found["t_keep_3"]["why"]["en"]
    assert "领游灯" in found["t_keep_3"]["why"]["zh"]
    assert "t_keep_4" not in found


def test_there_is_a_task_for_every_promise_the_offers_can_make():
    """Two front stalls and four back ones, three roles, five places in the programme and the wages
    the purse holds, in the offers of ten and twenty coins: twenty promises at most."""
    most = sum(pledges.STALLS.values()) + len(pledges.ROLES) + pledges.SLOTS + pledges.PURSE // 10
    assert pledges.CARDS == most == 20


def test_a_twenty_first_promise_has_no_task_of_its_own():
    """It is possible only by sending the action by hand, for a coin of wages at a time."""
    game = slice_game()
    run_to(game, at(2, 10))
    section = me(game)
    for n in range(1, 22):
        section["pledges"].append(
            {"id": f"k{n}", "to": LI_DA, "what": "wage", "item": "", "amount": 1, "size": 1,
             "made": game.tick, "due": 4, "state": pledges.OPEN, "ended": -1}
        )  # fmt: skip
    section["pseq"] = 22
    run_to(game, at(2, 11, 5))  # the next look
    found = tasks_of(frame_now(game))
    assert "t_keep_20" in found and "t_keep_21" not in found
    assert found["t_keep_20"]["why"]["en"].startswith("You promised Li Da 1 coins in wages")


# ------------------------------------------------------------------------------ its day


def test_from_the_morning_it_falls_due_the_task_has_the_action_and_the_bar_follows_it():
    game = game_with_a_promise()
    run_to(game, at(3, 10))
    assert task(game, 1)["action"] is None  # a day too early
    run_to(game, at(4, 6, 5))
    found = task(game, 1)
    assert found["action"] == {"verb": "promise", "npc": LI_DA, "item": "k1", "kind": "keep"}
    assert found["why"]["en"].startswith(
        "You promised Li Da a front-row stall at the festival. It is due today"
    )
    assert found["next"] == {
        "zh": "今天去找李大，当面兑现。",
        "en": "Go to Li Da today and keep it in person.",
    }
    assert frame_now(game)["tracked"] == "t_keep_1"


def test_the_bar_changes_to_it_when_its_day_comes_and_says_why():
    game = game_with_a_promise()
    run_to(game, at(3, 12))
    seen = []
    run_to(game, at(4, 8), lambda out: seen.extend(changed(out)))
    to_it = [e for e in seen if e["to"] == "t_keep_1"]
    assert [e["cause"] for e in to_it] == ["window"]
    assert to_it[0]["reason"] == {
        "zh": "「兑现对李大的许诺」的时间到了，先办这件",
        "en": "It is time for “Keep the promise to Li Da”. On to it",
    }


def test_the_card_offers_the_promise_to_keep_in_a_talk_with_the_person():
    game = game_with_a_promise()
    run_to(game, at(4, 7))
    meet(game, LI_DA)
    offers = frame_now(game)["player"]["offers"]["promise"]
    keep_offer = next(o for o in offers if o["id"] == "keep:k1")
    assert keep_offer["body"] == {"op": "keep", "id": "k1"}
    # the card's action names it the same way: the item is the id of the promise
    assert task(game, 1)["action"]["item"] == keep_offer["body"]["id"]


# ------------------------------------------------------------------------------ kept


def test_keeping_the_promise_ends_the_task_and_earns_trust():
    game = game_with_a_promise()
    run_to(game, at(4, 7))
    before = trust_of(game, LI_DA)
    out = keep(game, LI_DA, 1)
    assert acks(out) == [("applied", None)]
    assert task(game, 1)["state"] == "done"
    assert task(game, 1)["action"] is None and task(game, 1)["window"] is None
    assert trust_of(game, LI_DA) > before
    assert me(game)["pledges"][0]["state"] == pledges.KEPT


def test_a_promise_can_be_kept_before_its_day_and_the_task_is_done_then():
    game = game_with_a_promise()
    run_to(game, at(2, 12))
    keep(game, LI_DA, 1)
    assert me(game)["pledges"][0]["state"] == pledges.KEPT
    assert task(game, 1)["state"] == "done"
    run_to(game, at(5, 7))
    assert task(game, 1)["state"] == "done"  # it stays done: it is not broken later


# ------------------------------------------------------------------------------ lapsed


def lapse_events(game, until):
    seen = []
    run_to(game, until, lambda out: seen.extend(changed(out)))
    return seen


def test_a_promise_not_kept_by_its_day_goes_stale_and_the_bar_says_what_it_cost():
    game = game_with_a_promise(due=3)
    act(game, "track", task="t_keep_1")  # the one followed stays so until it ends
    run_to(game, at(3, 12))
    seen = lapse_events(game, at(4, 8))
    assert task(game, 1)["state"] == "stale"
    assert me(game)["pledges"][0]["state"] == pledges.BROKEN
    gone = [e for e in seen if e["from"] == "t_keep_1" and e["cause"] == "stale"]
    assert len(gone) == 1
    assert gone[0]["reason"]["en"].startswith(
        "You promised Li Da a front-row stall at the festival by day 3 and did not keep it. "
        "Li Da trusts you less now. Word of it will go round the town. Now on to"
    )
    assert gone[0]["reason"]["zh"].startswith(
        "你答应最迟第三天给李大的灯会上的前排摊位，没给成。李大更不信你了。这事还会在镇上传开。改办"
    )


def test_when_another_task_is_followed_the_lapse_is_said_all_the_same_without_a_change():
    game = game_with_a_promise(due=3)
    run_to(game, at(3, 12))
    seen = lapse_events(game, at(4, 8))
    assert task(game, 1)["state"] == "stale"
    lapsed = [e for e in seen if e["cause"] == "lapsed"]
    assert len(lapsed) == 1
    assert lapsed[0]["from"] == lapsed[0]["to"] == frame_now(game)["tracked"]  # nothing changes
    assert lapsed[0]["reason"]["zh"] == (
        "你答应最迟第三天给李大的灯会上的前排摊位，没给成。李大更不信你了。这事还会在镇上传开。"
    )
    assert lapsed[0]["reason"]["en"].startswith("You promised Li Da a front-row stall")
    assert "Now on to" not in lapsed[0]["reason"]["en"]


def test_the_cost_is_the_trust_of_the_person_and_a_fact_that_spreads():
    game = game_with_a_promise(due=3)
    before = trust_of(game, LI_DA)
    run_to(game, at(4, 8))
    broke = [p for p in me(game)["pledges"] if p["state"] == pledges.BROKEN]
    assert [p["id"] for p in broke] == ["k1"]
    assert trust_of(game, LI_DA) < before  # the words say so, and they are not a number
    assert tuple(pledges.BROKEN_DROP.values()) == (10, 14, 18)
    # and the person holds first-hand that the manager broke their word, which then spreads
    assert repute.believes(state_of(game)["social"], LI_DA, repute.BROKE)


# ------------------------------------------------------------------------------ the words


@pytest.mark.parametrize(
    ("what", "item", "amount", "zh", "en"),
    [
        ("stall", "back", 0, "灯会上的后排摊位", "a back-row stall at the festival"),
        ("role", "t_honor_light", 0, "灯会上点主灯的体面差事", "lighting the main lantern"),
        ("wage", "", 20, "二十文工钱", "20 coins in wages"),
        ("slot", "2", 0, "节目单上的第二位", "place 2 in the programme"),
    ],
)
def test_the_words_name_each_kind_of_promise(what, item, amount, zh, en):
    game = game_with_a_promise(what=what, item=item, amount=amount)
    facts = agenda_facts.Facts(game._kernel.world, state_of(game))
    assert facts["pledge1_what"]["zh"] == zh
    assert en in facts["pledge1_what"]["en"]
    assert facts["pledge1_to"] == {"zh": "李大", "en": "Li Da"}
    assert facts["pledge1_due"] == {"zh": "第四天", "en": "day 4"}
    assert zh in task(game, 1)["why"]["zh"] and en in task(game, 1)["why"]["en"]


def test_a_name_with_no_promise_behind_it_reads_as_a_blank_not_an_error():
    facts = agenda_facts.Facts(slice_game()._kernel.world, state_of(slice_game()))
    assert facts["pledge5_to"] == {"zh": "对方", "en": "that person"}
    assert facts["pledge8_due"] == {"zh": "到期那天", "en": "the day it falls due"}


def test_the_action_names_a_person_only_for_a_promise_there_is():
    game = slice_game()
    option = {"verb": "promise", "npc": f"{agenda.PLEDGE}3", "kind": "keep", "item": None,
              "place": None, "when": []}  # fmt: skip
    env = agenda.Env(game._kernel.world, state_of(game), agenda.clock.at(0))
    assert agenda.usable(env, option) is False


# ------------------------------------------------------------------------------ the truth stays out


def what_it_says(game):
    """The task of the first promise as the player reads it, all of what it says."""
    found = task(game, 1)
    return (found[key] for key in ("text", "why", "next", "state", "action", "window", "blocker"))


@pytest.mark.parametrize("variant", ["v_flood", "v_drunk"])
def test_the_task_of_a_promise_is_the_same_whichever_story_is_true(variant):
    """It reads what the manager promised, who it was to and the days: nothing of which story is
    true, so at the same points of the same moves it says the same in every story."""

    def along(story):
        game = slice_game(variant=story)
        run_to(game, at(2, 10))
        make(game, LI_DA)
        said = [list(what_it_says(game))]
        for stop in (at(3, 12), at(4, 6, 5), at(4, 20), at(5, 8)):
            run_to(game, stop)
            said.append(list(what_it_says(game)))
        said.append(frame_now(game)["tracked"])
        return said

    assert along(variant) == along("v_boat")
