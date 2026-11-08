"""The elder's call: why he refused every time, what it takes now, and what the card says of it.

The elder calls the clan to the hall before five in the afternoon, for the public meeting, and
weighs the request as any other (``persuade``): his trust in the manager, the people of his
acquaintance who have joined the helpers, what the manager promised him and what they cite. The
price was 40 and the trust that a talk a day earns stops at 20, so with the whole town behind the
manager the sum was 35 and no card could get a yes without a promise, which the bridge had used up.
It is 30 now. And he will not call the clan for nothing: the manager has to hold some evidence (else
``needs``).

The clan takes an hour to come, and the hall opens on the first full hour that is at least that long
after the call (the cards look again on the hour).
"""

from __future__ import annotations

import json

import pytest
from agenda_helpers import frame_now, idle, meet, slice_game, tasks_of
from bridge_helpers import at, run_to, state_of, world_of
from dealings_helpers import talking
from player_helpers import acks, act, events, me, run_on

from lantern_core.world.bridge import assembly, clock, entrust, goals_call, persuade
from lantern_core.world.bridge.lore import lore

LO = lore()
ELDER = assembly.ELDER


def join_friends(game, count: int = 4) -> None:
    """Set up the case: ``count`` of the elder's acquaintances have joined the helpers."""
    friends = goals_call.lay(world_of(game)).knows[ELDER]
    for who in friends[:count]:
        act(game, "dev_goal", op="join", npc=who)


def trust_of(game, value: int) -> None:
    me(game)["trust"][LO.index[ELDER]] = value


def ask_for_the_hall(game):
    out = act(game, "entrust", kind="convene")
    return acks(out), out


def with_the_elder(day: int = 3, hour: int = 9, minute: int = 0, evidence=("e_footprint",), **cfg):
    """A talk with the elder at the hall (he is there from eight until noon, and from one), with
    some evidence in hand."""
    game = talking(ELDER, seed=1, hour=hour, day=day, minute=minute, dev_actions=1, **cfg)
    me(game)["evidence"].extend(evidence)
    return game


# ------------------------------------------------------------------------------ the price


def test_the_price_of_the_call_is_thirty():
    assert persuade.NEED["convene"] == 30


def test_the_whole_town_behind_the_manager_and_a_talk_a_day_get_the_call():
    """Four of his acquaintances have joined (16), and after a talk on each of three days his trust
    is 16 (a first talk earns 3 and stops at 20): 16 + 16 - 1 is 31, one over the price."""
    game = with_the_elder()
    join_friends(game)
    trust_of(game, 16)
    weighed = entrust.weigh_request(world_of(game), state_of(game), ELDER, "convene", "").weighed
    assert dict(weighed.parts)["crowd"] == 16
    assert (weighed.total, weighed.need) == (31, 30)
    got, out = ask_for_the_hall(game)
    assert got == [("applied", None)]
    assert events(out, "convened")


def test_a_stranger_with_the_town_behind_them_is_not_enough_and_the_numbers_are_in_the_event():
    game = with_the_elder()
    join_friends(game)
    trust_of(game, 13)  # one talk
    got, out = ask_for_the_hall(game)
    assert got == [("rejected", "refused")]
    (said,) = events(out, "entrusted")
    assert (said["result"], said["total"], said["need"]) == ("refused", 28, 30)


def test_without_the_town_behind_them_the_talks_of_the_days_do_not_reach_the_price():
    game = with_the_elder()
    trust_of(game, 20)  # the most a talk a day can earn
    got, _ = ask_for_the_hall(game)
    assert got == [("rejected", "refused")]


def test_a_promise_in_hand_or_a_citation_tips_it():
    game = with_the_elder()
    join_friends(game)
    trust_of(game, 13)
    assert ask_for_the_hall(game)[0] == [("rejected", "refused")]
    act(game, "promise", op="make", what="stall", item="front", due=5)
    got, _ = ask_for_the_hall(game)
    assert got == [("applied", None)]


# ------------------------------------------------------------------------------ the reason


def test_the_elder_will_not_call_the_clan_for_nothing():
    game = with_the_elder(evidence=())
    join_friends(game)
    trust_of(game, 60)
    got, out = ask_for_the_hall(game)
    assert got == [("rejected", "needs")]
    assert not events(out, "entrusted") and not events(out, "convened")
    assert state_of(game)["player"]["meeting"] == {}
    me(game)["evidence"].append("e_footprint")
    assert ask_for_the_hall(game)[0] == [("applied", None)]


def test_what_the_elder_says_to_a_manager_with_nothing_in_hand_is_the_plain_refusal():
    game = with_the_elder(evidence=())
    trust_of(game, 60)
    act(game, "entrust", kind="convene")
    line = state_of(game)["player"]["line"]
    assert line and line[0] == ELDER


def test_the_preview_says_what_is_missing():
    game = with_the_elder(evidence=())
    trust_of(game, 60)
    shown = json.loads(
        game.preview_json(json.dumps({"verb": "entrust", "npc": ELDER, "kind": "convene"}))
    )
    assert [b["en"] for b in shown["blockers"]] == ["Something else has to be in hand first"]
    me(game)["evidence"].append("e_footprint")
    join_friends(game)
    shown = json.loads(
        game.preview_json(json.dumps({"verb": "entrust", "npc": ELDER, "kind": "convene"}))
    )
    assert shown["blockers"] == [] and shown["odds"] == "high"


# ------------------------------------------------------------------------------ the hall


@pytest.mark.parametrize(
    ("called", "opens"),
    [((3, 9, 0), (3, 10, 0)), ((3, 9, 20), (3, 11, 0)), ((3, 15, 59), (3, 17, 0))],
)
def test_the_hall_opens_on_the_first_full_hour_that_is_an_hour_after_the_call(called, opens):
    game = with_the_elder(day=called[0], hour=called[1], minute=called[2])
    join_friends(game)
    trust_of(game, 40)
    tick = game.tick
    assert ask_for_the_hall(game)[0] == [("applied", None)]
    meeting = state_of(game)["player"]["meeting"]
    assert meeting["tick"] == at(*opens) == assembly.opens_at(clock.at(tick))
    assert meeting["tick"] - tick >= assembly.GATHER_TICKS  # an hour at least
    assert meeting["until"] == tick + assembly.MEETING_TICKS


def test_the_clan_is_called_but_the_hall_is_not_open_while_it_comes():
    game = with_the_elder(hour=9, minute=20)
    join_friends(game)
    trust_of(game, 40)
    ask_for_the_hall(game)
    meeting = state_of(game)["player"]["meeting"]
    section = me(game)
    assert assembly.clan_called(section, game.tick)
    assert not assembly.meeting_open(section, game.tick)
    # asking again while it comes is answered "I have said it already"
    got, _ = ask_for_the_hall(game)
    assert got == [("rejected", "said_already")]
    act(game, "leave")
    run_on(game, meeting["tick"] - 1)
    assert not assembly.meeting_open(me(game), game.tick)
    run_on(game, meeting["tick"])
    assert assembly.meeting_open(me(game), game.tick)
    run_on(game, meeting["until"] + 1)
    assert not assembly.meeting_open(me(game), game.tick)
    assert not assembly.clan_called(me(game), game.tick)


def test_the_clan_is_at_the_hall_when_it_opens():
    game = with_the_elder(hour=9, minute=0)
    join_friends(game)
    trust_of(game, 40)
    ask_for_the_hall(game)
    act(game, "leave")
    meeting = state_of(game)["player"]["meeting"]
    run_to(game, meeting["tick"] + 1)
    here = assembly.audience(state_of(game), assembly.HALL)
    assert ELDER in here and len(here) >= assembly.MIN_NAMED


def test_after_five_in_the_afternoon_the_elder_calls_nobody():
    game = with_the_elder(hour=17, minute=10)
    join_friends(game)
    trust_of(game, 60)
    assert ask_for_the_hall(game)[0] == [("rejected", "too_late")]


def test_a_yes_makes_the_next_request_a_new_round_and_a_no_does_not():
    """The card's question (``turned_down``) holds while the last answer was a no and nothing moved.
    After a yes it is not a no, whatever the numbers."""
    game = with_the_elder()
    join_friends(game)
    trust_of(game, 13)
    ask_for_the_hall(game)
    env = None
    from lantern_core.world.bridge import agenda_terms

    kernel = game._kernel
    env = agenda_terms.Env(kernel.world, kernel.state["world"], clock.at(kernel.state["tick"]))
    cond = {"kind": "turned_down", "npc": ELDER, "request": "convene"}
    assert agenda_terms.holds(env, cond)  # a no: nothing has moved
    trust_of(game, 20)
    assert not agenda_terms.holds(env, cond)  # a number moved
    assert ask_for_the_hall(game)[0] == [("applied", None)]
    assert not agenda_terms.holds(env, cond)  # a yes is not a no


# ------------------------------------------------------------------------------ the cards


def at_the_clan_day(day: int, hour: int = 7):
    """The slice on the morning of ``day``, with the evidence the lead would have had by the evening
    of the fourth day in hand (what is held bears on how the rail broke) and the lead followed
    through."""
    game = slice_game(dev_actions=1)
    run_to(game, at(day, hour))
    return game


def follow_through_the_lead(game) -> None:
    section = me(game)
    section["evidence"].extend(["e_footprint", "e_boat_scratches"])
    section["looked"].extend(["e_footprint", "e_boat_scratches", "e_flood_debris"])
    state_of(game)["agenda"]["seen"].append(
        ["entrusted", game.tick, {"npc": "gengfu", "request": "testify", "result": "agreed"}]
    )
    game._kernel.state["version"] += 1
    idle(game)


def test_the_card_of_the_call_comes_on_the_fourth_morning_with_proof_in_hand():
    game = slice_game()
    me(game)["evidence"].append("e_footprint")
    for day, hour in ((2, 20), (3, 12), (3, 20)):
        run_to(game, at(day, hour))
        idle(game)
        assert "t_call_clan" not in tasks_of(frame_now(game))
    run_to(game, at(4, 6, 1))
    idle(game)
    card = tasks_of(frame_now(game))["t_call_clan"]
    assert (card["state"], card["kind"], card["job"]) == ("open", "venue", "truth")
    assert card["action"] is None  # the lead is not followed through


def test_without_proof_in_hand_the_card_does_not_come():
    game = slice_game()
    run_to(game, at(4, 8))
    idle(game)
    assert "t_call_clan" not in tasks_of(frame_now(game))


def test_the_card_asks_the_elder_once_the_lead_is_followed_through():
    game = at_the_clan_day(4, 7)
    follow_through_the_lead(game)
    card = tasks_of(frame_now(game))["t_call_clan"]
    assert card["action"] == {"verb": "entrust", "npc": ELDER, "request": "convene"}


def test_the_card_asks_the_elder_on_the_last_morning_whatever_was_followed():
    game = slice_game()
    me(game)["evidence"].append("e_footprint")
    run_to(game, at(4, 8))
    idle(game)
    assert tasks_of(frame_now(game))["t_call_clan"]["action"] is None
    run_to(game, at(5, 6, 30))
    idle(game)
    card = tasks_of(frame_now(game))["t_call_clan"]
    assert card["action"] == {"verb": "entrust", "npc": ELDER, "request": "convene"}


def test_the_card_goes_when_the_hours_for_a_call_have_gone_by_on_the_last_day():
    game = slice_game()
    me(game)["evidence"].append("e_footprint")
    run_to(game, at(5, 16, 1))
    idle(game)
    assert tasks_of(frame_now(game))["t_call_clan"]["state"] == "stale"


def test_a_refusal_blocks_the_card_and_it_says_to_talk_first_then_to_promise_then_to_wait():
    game = at_the_clan_day(5, 7)
    follow_through_the_lead(game)
    meet(game, ELDER)
    trust_of(game, 13)
    me(game)["talked"][LO.index[ELDER]] = 4  # not today
    out = act(game, "entrust", kind="convene")
    assert acks(out) == [("rejected", "refused")]
    idle(game)
    card = tasks_of(frame_now(game))["t_call_clan"]
    assert card["state"] == "blocked"
    assert card["blocker"]["en"] == "The elder will not call the clan yet"
    assert card["action"] == {"verb": "talk", "npc": ELDER}
    assert card["next"]["en"].startswith("Talk with the elder first")
    # the talk earns trust, which moves a number: the question is a new one and the card is open
    # again
    me(game)["talked"][LO.index[ELDER]] = 5
    trust_of(game, 16)
    game._kernel.state["version"] += 1  # (the tasks look again when something happens)
    idle(game)
    card = tasks_of(frame_now(game))["t_call_clan"]
    assert card["state"] == "open" and card["action"]["request"] == "convene"


def test_the_card_is_done_once_the_clan_is_called_and_comes_again_if_the_truth_is_still_untold():
    game = at_the_clan_day(4, 7)
    follow_through_the_lead(game)
    join_friends(game)
    meet(game, ELDER)
    trust_of(game, 40)
    assert acks(act(game, "entrust", kind="convene")) == [("applied", None)]
    act(game, "leave")
    meeting = state_of(game)["player"]["meeting"]
    idle(game)
    assert tasks_of(frame_now(game))["t_call_clan"]["state"] == "done"  # the clan is on its way
    run_to(game, meeting["tick"] + 2)
    idle(game)
    assert tasks_of(frame_now(game))["t_call_clan"]["state"] == "done"  # and the hall is open
    run_to(game, meeting["until"] + clock.DAY_TICKS_PER_HOUR)  # (the tasks look again on the hour)
    idle(game)
    assert tasks_of(frame_now(game))["t_call_clan"]["state"] == "open"  # the hours have gone by


def test_the_words_of_the_card_are_in_both_languages_and_name_nobody_by_sex():
    import re

    from lantern_core.world.bridge.data import SCRIPT

    task = next(t for t in SCRIPT["tasks"] if t["id"] == "t_call_clan")
    texts = [task["text"]["zh"], task["text"]["en"]]
    for key in ("why", "next"):
        for option in task[key]:
            texts += [option["zh"], option["en"]]
    for rule in task["blocked"]:
        texts += [rule["blocker"]["zh"], rule["blocker"]["en"]]
        for key in ("why", "next"):
            for option in rule[key]:
                texts += [option["zh"], option["en"]]
    for text in texts:
        assert text.strip()
        assert not re.search(r"[他她;；—]", text), text
        assert not re.search(r"\b(he|she|his|her|him)\b", text, re.I), text
