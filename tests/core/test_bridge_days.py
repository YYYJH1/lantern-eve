"""The tasks of the bridge for the days after the first, followed to the end.

The game is the slice (``api.preset("slice")``). The route starts where the first day ends: the
manager has asked Li Da for the bamboo in the evening, and the first batch of four poles lies at the
bridge in the morning. From there the tests do what the card says, and nothing else: the action of
the most urgent task of the bridge that has one, with what a yes needs put in by hand (the trust of
the person, Li Da's knowing of the clarification and his mother's nod: winning those is another
package's), and let the clock run when no task has anything to do. The card has to lead to a bridge
that is mended before the deadline of the work, or, when it cannot be, to the detour.

Two tests do without the hand: they start from the end of the route that the cross-host driver plays
(``slice_driver.Route``, with the second batch of bamboo at the bridge), and follow the card alone.
Every no is then the game's own, and after each the card says to promise and to ask again.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
import slice_driver
from agenda_helpers import frame_now, meet, slice_game, tasks_of
from bridge_helpers import at, run_to, state_of
from dealings_helpers import believe, trust
from player_helpers import acks, act, events, me

from bots.base import SWEETENERS, Obs
from lantern_core.api import Game
from lantern_core.world.bridge import (
    agenda,
    agenda_facts,
    clarify,
    clock,
    commitments,
    goals_call,
    goals_work,
)

LIVE = ("open", "blocked")
LI_DA, ZHOU, KEEPER = "li_da", "zhou_zhanggui", "miaozhu"
SEED = 492
DEADLINE = goals_work.labor_deadline()  # day 4, 18:00


def win(game: Game, who: str) -> None:
    """What a case needs for the person to say yes: their trust, and for Li Da, his mother's nod and
    his knowing of the clarification."""
    trust(game, who, 60)
    if who == LI_DA:
        me(game)["nod"]["bamboo"] = game.tick
        believe(game, LI_DA, clarify.CLAIM, 90, "saw")


def request(game: Game, who: str, kind: str, by_hand: bool = True, **fields: Any) -> dict[str, Any]:
    """The manager walks up to ``who``, wins them as far as a case needs (unless ``by_hand`` is
    off, and the answer is what the game makes of it), asks for ``kind`` and leaves. The outputs of
    the call that carried the request."""
    meet(game, who)
    if by_hand:
        win(game, who)
    out = act(game, "entrust", kind=kind, **fields)
    act(game, "leave")
    return out


def the_first_batch_is_at_the_bridge() -> Game:
    """The slice at half past seven in the morning of the second day: Li Da asked for the bamboo on
    the first evening and his first batch is at the bridge. (A talk with someone ends when their
    routine takes them elsewhere, which Li Da's does at seven.)"""
    game = slice_game()
    run_to(game, at(1, 18, 20))
    assert acks(request(game, LI_DA, "material")) == [("applied", None)]
    run_to(game, at(2, 7, 30))
    assert frame_now(game)["site"] == {"bamboo": 4, "timber": 0}
    return game


def bridge_tasks(game: Game) -> dict[str, dict[str, Any]]:
    return {t["id"]: t for t in frame_now(game)["tasks"] if t["job"] == "bridge"}


def next_action(game: Game, only: tuple[str, ...] = ()) -> dict[str, Any] | None:
    """The task of the bridge that is the most urgent and has something to do with a person or a
    call: the first one of the frame, which lists the most urgent first. With ``only``, one of
    those tasks."""
    for task in frame_now(game)["tasks"]:
        action = task["action"]
        if only and task["id"] not in only:
            continue
        live = task["job"] == "bridge" and task["state"] in LIVE
        if live and action is not None and action["verb"] in ("entrust", "rally", "promise"):
            return task
    return None


def do(game: Game, task: dict[str, Any], by_hand: bool = True) -> list[tuple[str, str | None]]:
    """What the card says to do: the action of the task, through the core. A promise is the
    cheapest thing the frame offers the manager to promise (the order the bots spend them in)."""
    action = task["action"]
    if action["verb"] == "rally":
        return acks(act(game, "rally"))
    if action["verb"] == "promise":
        meet(game, action["npc"])
        offers = frame_now(game)["player"]["offers"].get("promise", [])
        found = next(
            (o for prefix in SWEETENERS for o in offers if o["id"].startswith(prefix)), None
        )
        assert found is not None, "the manager has nothing left to promise"
        out = act(game, "promise", **found["body"])
        act(game, "leave")
        return acks(out)
    fields: dict[str, Any] = {}
    if "target" in action:
        fields["target"] = action["target"]
    kind = action.get("request", "material")
    if kind == "material":
        assert action["item"] in ("bamboo", "timber")
    return acks(request(game, action["npc"], kind, by_hand, **fields))


def follow_the_card(
    game: Game,
    until: int,
    done=lambda game: False,
    only: tuple[str, ...] = (),
    limit: int = 200,
    by_hand: bool = True,
) -> list:
    """Do what the tasks of the bridge say, one action after the other, and let the clock run half
    an hour when they have none. Returns ``(tick, task, action, result)`` for each action."""
    taken: list = []
    for _ in range(limit):
        if game.tick >= until or done(game):
            break
        task = next_action(game, only)
        if task is None:
            run_to(game, min(until, game.tick + 60))
            continue
        taken.append((game.tick, task["id"], dict(task["action"]), do(game, task, by_hand)))
    return taken


def answer(result: list[tuple[str, str | None]]) -> str:
    """What came of an action in a word: ``applied``, or the reason it was turned down."""
    status, reason = result[0]
    return reason or status


def flags(game: Game) -> dict[str, int]:
    return state_of(game)["goals"]["flags"]


def mended(game: Game) -> bool:
    return "bridge_fixed" in flags(game)


# ------------------------------------------------------------------------------ the route


def test_following_the_card_from_the_first_batch_mends_the_bridge_before_the_deadline():
    game = the_first_batch_is_at_the_bridge()
    morning = bridge_tasks(game)
    assert morning["t_bamboo_first"]["state"] == "done"
    # the rest of the bamboo and the timber come first on the morning of the second day: the
    # helpers are asked for once a batch after the first is promised, or from the afternoon
    assert {tid: t["state"] for tid, t in morning.items()} == {
        "t_bamboo_first": "done",
        "t_bamboo_rest": "open",
        "t_li_da_promise": "done",
        "t_timber": "open",
    }
    taken = follow_the_card(game, until=at(4, 18), done=mended)
    steps = [
        (task, action["verb"], action.get("npc"), action.get("request"))
        for _, task, action, _ in taken
    ]
    assert steps == [
        ("t_bamboo_rest", "entrust", LI_DA, None),  # batch two
        ("t_timber", "entrust", ZHOU, None),
        ("t_helpers", "rally", None, None),
        (
            "t_helpers",
            "entrust",
            LI_DA,
            "join",
        ),  # the person the card names, of the family with none
        ("t_bamboo_rest", "entrust", LI_DA, None),  # batch three, when two has come
    ]
    assert all(result == [("applied", None)] for *_, result in taken)
    assert mended(game) and flags(game)["bridge_fixed"] < DEADLINE
    # nothing was lacking in the end, and every number of the card is the number of the hud
    bridge = frame_now(game)["hud"]["bridge"]
    assert (bridge["state"], bridge["hours"], bridge["percent"]) == ("mended", 10, 100)
    assert frame_now(game)["site"] == {"bamboo": 10, "timber": 8}
    batches = [
        (c["id"], c["item"], c["amount"], c["state"]) for c in frame_now(game)["commitments"]
    ]
    assert batches == [
        ("m1", "bamboo", 4, "delivered"),
        ("m2", "bamboo", 4, "delivered"),
        ("m3", "timber", 8, "delivered"),
        ("m4", "bamboo", 2, "delivered"),  # what the bridge still lacked, not another four
    ]
    states = {tid: t["state"] for tid, t in bridge_tasks(game).items()}
    assert states == {
        "t_bamboo_first": "done",
        "t_bamboo_rest": "done",
        "t_li_da_promise": "done",
        "t_timber": "done",
        "t_helpers": "done",
        "t_work_3": "stale",  # five helpers give five hours of the ten on the third morning
        "t_work_4": "done",  # and the fourth morning does the rest
    }  # the detour never came: it was not needed
    assert clock.at(flags(game)["bridge_fixed"]).day == 4


def test_a_rainy_third_morning_makes_the_detour_necessary_and_the_cards_lead_to_it():
    """The morning of the third day is a heavy rain, and no work is done in it. Five helpers cannot
    do ten hours on the one morning that is left, so the detour is offered at one o'clock of the
    third day, a day before the deadline, and the cards lead to it: the temple keeper opens the
    lane, three helpers hang the lamps, and the night is the lesser one."""
    game = the_first_batch_is_at_the_bridge()
    state_of(game)["weather"]["plan"][2] = "heavy_rain"
    taken = follow_the_card(game, until=at(3, 13) - 1)
    assert "t_detour" not in tasks_of(frame_now(game))  # the morning of the rain is not over
    assert goals_work_progress(game) == 0
    taken += follow_the_card(game, until=at(3, 13) + 2, limit=20)
    assert tasks_of(frame_now(game))["t_detour"]["state"] in LIVE  # offered as the morning is over
    taken += follow_the_card(
        game, until=at(5, 17), done=lambda g: "detour_done" in flags(g), limit=400
    )
    assert "detour_done" in flags(game) and not mended(game)
    steps = [(task, action["verb"], action.get("request")) for _, task, action, _ in taken]
    assert ("t_detour", "entrust", "lane") in steps  # the keeper is asked as the card says
    assert [r for *_, r in taken if r != [("applied", None)]] == []
    assert flags(game)["detour_done"] < at(5, 17)
    assert goals_work_progress(game) <= 50  # five hours of the fourth morning, at most
    ending = None
    while game.tick < at(5, 21) + 5 and ending is None:
        out = json.loads(game.step())
        ending = next(iter(events(out, "ending")), None)
    assert ending is not None and ending["passage"] == "detour"
    assert ending["ending"] == "ending_barely"


def goals_work_progress(game: Game) -> int:
    return state_of(game)["goals"]["metrics"]["work_progress"]


def test_the_helpers_of_the_route_are_enough_and_of_both_families():
    game = the_first_batch_is_at_the_bridge()
    follow_the_card(
        game,
        until=at(2, 13),
        done=lambda g: tasks_of(frame_now(g)).get("t_helpers", {}).get("state") == "done",
    )
    call = state_of(game)["goals"]["call"]
    count, per_family = goals_call.crew(game._kernel.world, call)
    assert count >= goals_call.CREW and all(n >= 1 for n in per_family.values())
    assert goals_call.crew_ready(game._kernel.world, call)
    assert tasks_of(frame_now(game))["t_helpers"]["state"] == "done"


def test_the_card_names_the_family_with_nobody_yet_and_the_words_carry_the_numbers():
    game = the_first_batch_is_at_the_bridge()
    assert "t_helpers" not in tasks_of(frame_now(game))  # the bamboo and the timber come first
    run_to(game, at(2, 13, 5))  # and the helpers from the afternoon
    helpers = tasks_of(frame_now(game))["t_helpers"]
    assert helpers["action"] == {"verb": "rally"}
    assert helpers["why"] == {
        "zh": "修桥要五个帮手，李家、周家至少各出一个。",
        "en": "The bridge takes 5 helpers, at least one from each family.",
    }
    assert helpers["next"]["en"] == "Call for helpers first, and those who are willing will come."
    act(game, "rally")  # one person comes, of the Zhou family
    helpers = tasks_of(frame_now(game))["t_helpers"]
    assert helpers["next"] == {
        "zh": "请李家的人来帮忙。",
        "en": "Ask someone from the Li family to help.",
    }
    assert helpers["action"]["verb"] == "entrust" and helpers["action"]["request"] == "join"
    assert helpers["action"]["npc"] in goals_call.lay(game._kernel.world).helpers


def played_by_the_route(until: int) -> Game:
    """The slice as the cross-host route plays it, with nothing set by hand, stopped at ``until``
    and out of any conversation."""
    game = slice_game()
    bot = slice_driver.Route(json.loads(game.scene_json()), SEED)
    bot.stay = bot.held = bot.speech = -1
    obs = Obs(json.loads(game.step("[]")))
    while game.tick < until:
        action = bot.decide(obs)
        records = [] if action is None else [slice_driver.record(game, "player", action)]
        obs = Obs(json.loads(game.step(json.dumps(records))))
    if me(game)["talk"]:
        act(game, "leave")
    return game


def test_from_the_end_of_the_slice_route_the_card_alone_mends_the_bridge_before_the_deadline():
    """Nothing is set by hand. Li Da's yes and Shopkeeper Zhou's no are what the game makes of the
    route's own dealings, and after each no the card says what to do: a promise, and the question
    again. The timber is refused four times, and after the third promise the card waits for the
    helpers; with the town behind the manager the fifth time it is a yes."""
    game = played_by_the_route(slice_driver.TICKS)
    assert frame_now(game)["site"] == {"bamboo": 8, "timber": 0}  # the second batch is there
    assert {tid: t["state"] for tid, t in bridge_tasks(game).items()} == {
        "t_bamboo_first": "done",
        "t_bamboo_rest": "open",
        "t_li_da_promise": "done",
        "t_timber": "open",
        "t_helpers": "open",
    }
    taken = follow_the_card(game, until=at(4, 18), done=mended, by_hand=False)
    steps = [
        (task, action["verb"], action.get("npc"), action.get("request"), answer(result))
        for _, task, action, result in taken
    ]
    assert steps == [
        ("t_bamboo_rest", "entrust", LI_DA, None, "applied"),  # batch three
        ("t_timber", "entrust", ZHOU, None, "refused"),
        ("t_timber", "promise", ZHOU, None, "applied"),
        ("t_timber", "entrust", ZHOU, None, "refused"),
        ("t_timber", "promise", ZHOU, None, "applied"),
        ("t_timber", "entrust", ZHOU, None, "refused"),
        ("t_timber", "promise", ZHOU, None, "applied"),
        ("t_timber", "entrust", ZHOU, None, "refused"),  # and nothing more to promise to him
        ("t_helpers", "rally", None, None, "applied"),
        ("t_timber", "entrust", ZHOU, None, "refused"),  # the town came, and it is not enough yet
        ("t_helpers", "entrust", LI_DA, "join", "refused"),
        ("t_helpers", "promise", LI_DA, None, "applied"),
        ("t_helpers", "entrust", LI_DA, "join", "applied"),  # a yes that waits for friends
        ("t_helpers", "promise", LI_DA, None, "applied"),
        ("t_helpers", "entrust", LI_DA, "join", "applied"),  # and now he joins, with his friends
        ("t_timber", "entrust", ZHOU, None, "applied"),
    ]
    assert mended(game) and flags(game)["bridge_fixed"] < DEADLINE
    mended_at = clock.at(flags(game)["bridge_fixed"])
    assert (mended_at.day, mended_at.hour) == (4, 9)  # five helpers: the third and fourth mornings
    bridge = frame_now(game)["hud"]["bridge"]
    assert (bridge["state"], bridge["hours"], bridge["percent"]) == ("mended", 10, 100)
    assert frame_now(game)["site"] == {"bamboo": 10, "timber": 8}
    batches = [
        (c["id"], c["item"], c["amount"], c["state"]) for c in frame_now(game)["commitments"]
    ]
    assert batches == [
        ("m1", "bamboo", 4, "delivered"),
        ("m2", "bamboo", 4, "delivered"),
        ("m3", "bamboo", 2, "delivered"),
        ("m4", "timber", 8, "delivered"),
    ]
    assert {tid: t["state"] for tid, t in bridge_tasks(game).items()} == {
        "t_bamboo_first": "done",
        "t_bamboo_rest": "done",
        "t_li_da_promise": "done",
        "t_timber": "done",
        "t_helpers": "done",
        "t_work_3": "stale",
        "t_work_4": "done",
    }


def test_after_three_promises_the_timber_card_waits_until_something_moves():
    game = played_by_the_route(slice_driver.TICKS)
    follow_the_card(game, until=game.tick + 240, only=("t_timber",), by_hand=False, limit=12)
    assert agenda.promised_to(state_of(game), ZHOU) == agenda.PROMISE_LIMIT
    timber = tasks_of(frame_now(game))["t_timber"]
    assert timber["state"] == "blocked" and timber["action"] is None  # nothing to do but wait
    assert timber["blocker"] == {
        "zh": "周掌柜不肯出木料",
        "en": "Shopkeeper Zhou will not give the timber",
    }
    assert timber["next"] == {
        "zh": "等更多人站到你这边，再请周掌柜送木料。",
        "en": "Ask Shopkeeper Zhou again when more of the town is with you.",
    }
    run_to(game, game.tick + 240)  # the hours pass and nothing moves: still the same
    assert tasks_of(frame_now(game))["t_timber"]["state"] == "blocked"
    act(game, "rally")  # people come, which is a number of his score
    timber = tasks_of(frame_now(game))["t_timber"]
    assert timber["state"] == "open"
    assert timber["action"] == {"verb": "entrust", "npc": ZHOU, "item": "timber"}


def test_each_promise_of_li_da_has_its_own_round_of_the_promise_task():
    game = the_first_batch_is_at_the_bridge()
    seen = [tasks_of(frame_now(game))["t_li_da_promise"]["state"]]
    # batch two: the task opens again with the promise, with the hours of that promise
    assert acks(request(game, LI_DA, "material")) == [("applied", None)]
    task = tasks_of(frame_now(game))["t_li_da_promise"]
    seen.append(task["state"])
    row = state_of(game)[commitments.SECTION]["list"][-1]
    assert task["window"] == {
        "day": 2,
        "from": clock.at(row["start"]).hour,
        "to": row["due"]["hour"],
        "place": "p_bridge",
    }
    run_to(game, at(2, 12))
    seen.append(tasks_of(frame_now(game))["t_li_da_promise"]["state"])
    assert acks(request(game, LI_DA, "material")) == [("applied", None)]
    seen.append(tasks_of(frame_now(game))["t_li_da_promise"]["state"])
    run_to(game, at(2, 17))
    seen.append(tasks_of(frame_now(game))["t_li_da_promise"]["state"])
    assert seen == ["done", "open", "done", "open", "done"]


def test_a_batch_that_breaks_is_asked_for_again_and_the_promise_task_goes_stale_and_returns():
    game = slice_game(weather_clear=0, weather_light=0, weather_heavy=1)
    run_to(game, at(1, 18, 20))
    assert acks(request(game, LI_DA, "material")) == [("applied", None)]
    run_to(game, at(2, 10) + 1)  # the rain kept the goods off the road
    rows = frame_now(game)["commitments"]
    assert [(c["id"], c["state"]) for c in rows] == [("m1", "broken")]
    assert tasks_of(frame_now(game))["t_li_da_promise"]["state"] == "stale"
    assert acks(request(game, LI_DA, "material")) == [("applied", None)]  # asked for again
    assert [(c["id"], c["state"]) for c in frame_now(game)["commitments"]] == [
        ("m1", "broken"),
        ("m2", "promised"),
    ]
    assert tasks_of(frame_now(game))["t_li_da_promise"]["state"] == "open"  # a new round


# ------------------------------------------------------------------------------ the detour


def idle_to(game: Game, tick: int) -> None:
    run_to(game, tick)


def test_the_detour_is_offered_on_the_morning_of_the_fourth_day_and_leads_to_the_lesser_ending():
    game = the_first_batch_is_at_the_bridge()
    idle_to(game, at(3, 13) - 1)
    assert "t_detour" not in tasks_of(frame_now(game))  # the bridge may still be mended
    idle_to(game, at(3, 13) + 2)  # nobody has joined, and the mornings that are left are one
    assert tasks_of(frame_now(game))["t_detour"]["state"] == "open"
    idle_to(game, at(4, 8) + 2)
    detour = tasks_of(frame_now(game))["t_detour"]
    assert detour["state"] == "open" and detour["kind"] == "need" and detour["job"] == "bridge"
    assert detour["action"] == {"verb": "entrust", "npc": KEEPER, "request": "lane"}
    # the night cannot be a full success, said without the name of an ending
    assert "算不上圆满" in detour["why"]["zh"] and "cannot be perfect" in detour["why"]["en"]
    assert "勉强" not in detour["why"]["zh"] and "Just enough" not in detour["why"]["en"]
    assert detour["next"] == {
        "zh": "请庙祝打开庙后的夹道。",
        "en": "Ask the temple keeper to open the lane behind the temple.",
    }
    assert detour["window"]["day"] == 4  # where and when to find the temple keeper
    assert acks(request(game, KEEPER, "lane")) == [("applied", None)]
    agreed = tasks_of(frame_now(game))["t_detour"]  # she has agreed, and the lane opens in a while
    assert agreed["action"] is None and agreed["next"]["zh"] == "等一会儿，夹道就开了。"
    run_to(game, at(4, 11))
    assert "lane_opened" in flags(game)
    detour = tasks_of(frame_now(game))["t_detour"]
    # the lane is open and nobody has joined: the card asks for hands, then sends the manager to
    # watch the lamps go up in the afternoon
    assert detour["action"]["request"] == "join" and "下午帮手会去夹道挂灯" in detour["next"]["zh"]
    taken = follow_the_card(
        game,
        until=at(4, 12),
        only=("t_detour",),
        done=lambda g: tasks_of(frame_now(g))["t_detour"]["action"]["verb"] != "entrust",
    )
    assert len(taken) == goals_work.DETOUR_WORKERS and all(
        r == [("applied", None)] for *_, r in taken
    )
    assert tasks_of(frame_now(game))["t_detour"]["action"] == {"verb": "move", "place": "p_temple"}
    run_to(game, at(4, 18))
    assert {"lane_opened", "lamps_hung", "detour_done"} <= set(flags(game))
    assert tasks_of(frame_now(game))["t_detour"]["state"] == "done"
    assert not mended(game)
    # and the festival ends as the card said it would: the way is open, the rest was left undone
    ending = None
    while game.tick < at(5, 21) + 5 and ending is None:
        out = json.loads(game.step())
        ending = next(iter(events(out, "ending")), None)
    assert ending is not None and ending["passage"] == "detour"
    assert ending["ending"] == "ending_barely" and ending["label"] == {
        "zh": "勉强",
        "en": "Just enough",
    }


def test_the_keeper_who_says_no_is_asked_for_a_promise_first_and_the_lane_opens_after():
    game = the_first_batch_is_at_the_bridge()
    idle_to(game, at(4, 8) + 2)
    meet(game, KEEPER)
    trust(game, KEEPER, 0)
    out = act(game, "entrust", kind="lane")
    act(game, "leave")
    assert acks(out) == [("rejected", "refused")]
    detour = tasks_of(frame_now(game))["t_detour"]
    assert detour["state"] == "blocked" and detour["action"] == {"verb": "promise", "npc": KEEPER}
    assert detour["blocker"] == {
        "zh": "庙祝还不肯打开夹道",
        "en": "The temple keeper will not open the lane yet",
    }
    assert acks(request(game, KEEPER, "lane", by_hand=False)) == [("rejected", "said_already")]
    assert do(game, detour) == [("applied", None)]  # a promise, as the card says
    detour = tasks_of(frame_now(game))["t_detour"]  # and it is a new question
    assert detour["state"] == "open"
    assert detour["action"] == {"verb": "entrust", "request": "lane", "npc": KEEPER}
    assert acks(request(game, KEEPER, "lane")) == [("applied", None)]  # she was won in the meantime
    assert tasks_of(frame_now(game))["t_detour"]["state"] == "open"


def short_of_hands_and_materials(**config: int) -> Game:
    """A slice in which the crew is ready and the pile at the bridge is complete as far as the
    card can tell (the flags), so that only the work can be behind."""
    game = slice_game(dev_actions=1, **config)
    for who in ("li_da", "li_laotai", "zhou_zhanggui", "zhou_niangzi", "cha_laoban"):
        assert acks(act(game, "dev_goal", op="join", npc=who)) == [("applied", None)]
    assert goals_call.crew_ready(game._kernel.world, state_of(game)["goals"]["call"])
    for flag in ("bamboo_delivered", "timber_delivered"):
        flags(game)[flag] = 0
    return game


def test_the_detour_is_offered_when_the_rain_keeps_the_work_behind():
    game = short_of_hands_and_materials(weather_clear=0, weather_light=0, weather_heavy=1)
    run_to(game, at(3, 10))
    work = tasks_of(frame_now(game))["t_work_3"]
    assert work["state"] == "blocked"
    assert work["blocker"] == {
        "zh": "今天下大雨，桥上开不了工",
        "en": "Heavy rain today, so there is no work on the bridge",
    }
    assert work["window"] is None  # no time is offered for a morning with no work in it
    assert work["action"] is None  # there is nothing to go and see in the rain
    assert frame_now(game)["board"]["window"] == {
        "day": 4,
        "from": 8,
        "to": 12,
        "place": "p_bridge",
    }  # the next morning of work is the next day's, as the board says it too
    assert "t_detour" not in tasks_of(frame_now(game))  # the morning is not over
    run_to(game, at(3, 13) + 2)
    assert tasks_of(frame_now(game))["t_work_3"]["state"] == "stale"
    # five helpers cannot do ten hours in the one morning that is left: the detour is offered
    # as soon as the morning lost to the rain is over, a day before the deadline
    assert tasks_of(frame_now(game))["t_detour"]["state"] == "open"
    run_to(game, at(4, 10))
    assert tasks_of(frame_now(game))["t_work_4"]["state"] == "blocked"
    run_to(game, at(4, 13) + 2)
    assert state_of(game)["goals"]["metrics"]["work_progress"] == 0
    tasks = tasks_of(frame_now(game))
    assert tasks["t_detour"]["state"] == "open" and tasks["t_work_4"]["state"] == "stale"


def test_five_helpers_need_two_mornings_and_the_task_of_each_says_how_far_the_work_is():
    game = short_of_hands_and_materials(weather_clear=1, weather_light=0, weather_heavy=0)
    run_to(game, at(3, 6))
    work = tasks_of(frame_now(game))["t_work_3"]
    assert work["state"] == "open" and work["action"] is None  # the button comes an hour before
    run_to(game, at(3, 7, 2))
    work = tasks_of(frame_now(game))["t_work_3"]
    assert work["state"] == "open" and work["action"] == {"verb": "move", "place": "p_bridge"}
    assert work["window"] == {"day": 3, "from": 8, "to": 12, "place": "p_bridge"}
    # an hour each: ten hours at five a morning, said in mornings (the hours are on the board)
    assert work["why"]["en"] == "With these helpers, two more mornings and the bridge is done."
    assert work["why"]["zh"] == "照这几个帮手，再干两个早上桥就修完了。"
    run_to(game, at(3, 13) + 2)
    assert state_of(game)["goals"]["metrics"]["work_progress"] == 50  # five hours of ten
    tasks = tasks_of(frame_now(game))
    assert tasks["t_work_3"]["state"] == "stale" and tasks["t_work_4"]["state"] == "open"
    # five of the ten are done, and the last morning, tomorrow's, does the rest
    assert tasks["t_work_4"]["why"]["zh"] == "明早是最后一个早上。照这几个帮手，明早就能把桥修完。"
    assert tasks["t_work_4"]["window"] == {"day": 4, "from": 8, "to": 12, "place": "p_bridge"}
    assert "t_detour" not in tasks  # five hours more on the last morning is enough
    run_to(game, at(4, 13) + 2)
    tasks = tasks_of(frame_now(game))
    assert tasks["t_work_4"]["state"] == "done" and "t_detour" not in tasks
    assert state_of(game)["goals"]["metrics"]["work_progress"] == 100
    assert mended(game)  # the pile was complete as far as the flags go


def test_the_board_and_the_cards_of_the_bridge_say_the_same_numbers_at_every_step():
    """The board of the frame and the words of the tasks of the bridge are made by the same
    functions of ``agenda_facts`` and the same tables of ``goals_work``: the helpers, the hours, the
    next morning of work, the deadline and the need of each item are one set of numbers."""
    game = short_of_hands_and_materials(weather_clear=1, weather_light=0, weather_heavy=0)
    world = game._kernel.world
    for tick, window in (
        (at(3, 7), {"day": 3, "from": 8, "to": 12, "place": "p_bridge"}),
        (at(3, 10), {"day": 3, "from": 8, "to": 12, "place": "p_bridge"}),
        (at(3, 13) + 2, {"day": 4, "from": 8, "to": 12, "place": "p_bridge"}),
        (at(4, 9), {"day": 4, "from": 8, "to": 12, "place": "p_bridge"}),
        (at(4, 13) + 2, None),  # the work is done: no morning is left
    ):
        run_to(game, tick)
        frame = frame_now(game)
        board, facts = frame["board"], agenda_facts.Facts(world, state_of(game))
        counts = {row["family"]: row["count"] for row in board["helpers"]}
        assert sum(counts.values()) == facts["helpers"] == 5
        assert (counts["fam_li"], counts["fam_zhou"]) == (
            facts["li_helpers"],
            facts["zhou_helpers"],
        )
        assert board["need"] == facts["crew"] and board["both"] is True
        assert board["hours"] == {"done": facts["hours"], "need": facts["hours_need"]}
        when = commitments.when_words(board["deadline"]["day"], board["deadline"]["hour"])
        assert when == facts["deadline"] and board["deadline"] == {"day": 4, "hour": 18}
        assert board["needs"] == {"bamboo": facts["bamboo_need"], "timber": facts["timber_need"]}
        assert board["window"] == window
        for task in frame["tasks"]:
            if task["id"] in ("t_work_3", "t_work_4") and task["state"] in LIVE:
                assert task["window"] == board["window"]  # the card shows the board's morning
                left = board["hours"]["need"] - board["hours"]["done"]
                assert left == facts["hours_left"]
                assert facts["morning"] == facts["helpers"]  # an hour each
                if task["id"] == "t_work_3":  # the work that is left, in mornings at that pace
                    said = agenda_facts.work_mornings_words(left, facts["morning"])
                    assert said["en"] in task["why"]["en"] and said["zh"] in task["why"]["zh"]
                else:  # whether the last morning finishes it, at that pace
                    done = left <= facts["morning"]
                    assert ("the bridge will be done" in task["why"]["en"]) == done
                    assert ("能把桥修完" in task["why"]["zh"]) == done
    assert tasks_of(frame_now(game))["t_work_4"]["state"] == "done"


def test_the_windows_of_the_two_mornings_of_work_are_those_of_the_work_itself():
    """The script writes the window of each morning of work down, and the work is done by the hours
    of ``goals_work``: a change of the one has to be a change of the other."""
    book = {task["id"]: task for task in agenda.book().tasks}
    for task_id, day in (
        ("t_work_3", goals_work.WORK_FROM_DAY),
        ("t_work_4", goals_work.WORK_FROM_DAY + 1),
    ):
        assert book[task_id]["window"] == {
            "day": day,
            "from": goals_work.WORK_START_HOUR,
            "to": goals_work.WORK_END_HOUR,
            "place": goals_work.BRIDGE,
            "unless": [{"kind": "weather", "is": "heavy_rain"}],  # no work, so no time, in the rain
        }
    assert clock.at(DEADLINE).day == goals_work.WORK_FROM_DAY + 1  # the second morning is the last


def test_without_hands_the_fourth_morning_brings_the_detour_and_no_work_task():
    game = the_first_batch_is_at_the_bridge()
    idle_to(game, at(3, 14))
    assert not {"t_work_3", "t_work_4"} & set(tasks_of(frame_now(game)))  # no crew: no work to see
    idle_to(game, at(4, 8) + 2)
    assert tasks_of(frame_now(game))["t_detour"]["state"] == "open"
    assert tasks_of(frame_now(game))["t_helpers"]["state"] == "open"  # and hands are still wanted


# ------------------------------------------------------------------------------ the truth stays out


def what_the_card_says(game: Game) -> list:
    """The tasks of a frame as the player reads them, all of what each one says."""
    return [
        (
            t["id"],
            t["state"],
            t["kind"],
            t["why"],
            t["next"],
            t["blocker"],
            t["action"],
            t["window"],
        )
        for t in frame_now(game)["tasks"]
    ]


def along_the_days(variant: str) -> list:
    """What the card says at the same points of the same route, with that story true."""
    game = slice_game(variant=variant)
    run_to(game, at(1, 18, 20))
    win(game, LI_DA)
    request(game, LI_DA, "material")
    said = []
    for stop in (at(2, 7, 30), at(2, 9), at(2, 13), at(3, 7), at(3, 9)):
        run_to(game, stop)
        said.append(what_the_card_says(game))
        if stop in (at(2, 7, 30), at(2, 13)):  # and the route does what the card says
            follow_the_card(game, until=stop + 30)
            said.append(what_the_card_says(game))
    return said


@pytest.mark.parametrize("variant", ["v_flood", "v_drunk"])
def test_the_tasks_of_the_bridge_are_the_same_whichever_story_is_true(variant):
    """The bamboo, the timber, the helpers and the work are the same errands in every story, and
    the card says nothing of which one is true: the same words, actions and windows at the same
    points of the same route."""
    assert along_the_days(variant) == along_the_days("v_boat")
