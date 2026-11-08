"""The tasks of the helpers and the work by day: when the helpers are asked for, what the helpers
give in a morning, and when the hours that are left are more than the mornings can do.

The morning of the second day has the bamboo and the timber first: the helpers' task comes once a
batch after the first is promised (or the timber is agreed), or from the afternoon. The two mornings
of work say how many hours the helpers give in one, and the detour is offered as soon as the
mornings that are left cannot do the hours that are.
"""

from __future__ import annotations

import pytest
from agenda_helpers import frame_now, meet, slice_game, tasks_of
from bridge_helpers import at, run_to, state_of
from dealings_helpers import believe, trust
from goals_helpers import crew_of_five
from player_helpers import acks, act, me

from lantern_core.api import Game
from lantern_core.world.bridge import agenda_facts, agenda_terms, clarify, clock, goals_work
from lantern_core.world.bridge.agenda_terms import Env

LI_DA, ZHOU = "li_da", "zhou_zhanggui"


def win(game: Game, who: str) -> None:
    trust(game, who, 60)
    if who == LI_DA:
        me(game)["nod"]["bamboo"] = game.tick
        believe(game, LI_DA, clarify.CLAIM, 90, "saw")


def ask_for_goods(game: Game, who: str) -> None:
    meet(game, who)
    win(game, who)
    assert acks(act(game, "entrust", kind="material")) == [("applied", None)]
    act(game, "leave")


def facts_of(game: Game) -> agenda_facts.Facts:
    return agenda_facts.Facts(game._kernel.world, state_of(game))


# -------------------------------------------------------------------------- when they are asked for


def test_the_helpers_are_not_asked_for_on_the_second_morning_before_a_batch_is_promised():
    game = slice_game()
    run_to(game, at(1, 18, 20))
    ask_for_goods(game, LI_DA)  # the first batch of the bamboo, which comes in the morning
    run_to(game, at(2, 9))
    found = tasks_of(frame_now(game))
    assert {"t_bamboo_rest", "t_timber"} <= set(found) and "t_helpers" not in found
    # the bar and the list put the bamboo first
    assert frame_now(game)["tracked"] == "t_bamboo_rest"
    order = [t["id"] for t in frame_now(game)["tasks"] if t["state"] in ("open", "blocked")]
    assert order.index("t_bamboo_rest") < order.index("t_timber")
    assert "t_helpers" not in order


def test_they_are_asked_for_once_a_batch_after_the_first_is_promised():
    game = slice_game()
    run_to(game, at(1, 18, 20))
    ask_for_goods(game, LI_DA)
    run_to(game, at(2, 9))
    assert "t_helpers" not in tasks_of(frame_now(game))
    ask_for_goods(game, LI_DA)  # the second batch is the second promise anyone made
    assert tasks_of(frame_now(game))["t_helpers"]["state"] == "open"


def test_they_are_asked_for_once_the_timber_is_agreed_whatever_became_of_the_bamboo():
    game = slice_game()
    run_to(game, at(2, 7))
    assert "t_helpers" not in tasks_of(frame_now(game))
    ask_for_goods(game, ZHOU)
    assert tasks_of(frame_now(game))["t_helpers"]["state"] == "open"


def test_they_are_asked_for_from_the_afternoon_of_the_second_day_in_any_case():
    game = slice_game()
    run_to(game, at(2, 12, 59))
    assert "t_helpers" not in tasks_of(frame_now(game))
    run_to(game, at(2, 13, 2))
    assert tasks_of(frame_now(game))["t_helpers"]["state"] == "open"


def test_in_a_game_that_carries_the_goods_at_once_the_agreement_is_what_brings_them_in():
    game = Game(3, "bridge", {"dev_actions": 1})  # the default config: no promised batches
    run_to(game, at(2, 7))
    assert "t_helpers" not in tasks_of(frame_now(game))
    assert acks(act(game, "dev_goal", op="material", npc=ZHOU)) == [("applied", None)]
    assert tasks_of(frame_now(game))["t_helpers"]["state"] == "open"


# ------------------------------------------------------------------------------ what they give


def test_the_hours_the_helpers_give_in_a_morning_are_none_without_a_crew_and_one_each_with_one():
    game = Game(3, "bridge", {"dev_actions": 1})
    assert (facts_of(game)["morning"], facts_of(game)["hours_left"]) == (0, 10)
    for who in ("li_da", "li_er", "zhou_dalang", "zhou_erlang"):
        act(game, "dev_goal", op="join", npc=who)
    assert facts_of(game)["morning"] == 0  # four are not a crew: the work does not begin
    act(game, "dev_goal", op="join", npc="old_he")
    assert facts_of(game)["morning"] == 5
    for who in ("mujiang", "cha_laoban"):
        act(game, "dev_goal", op="join", npc=who)
    assert facts_of(game)["morning"] == 7


def test_the_card_of_the_third_morning_says_it_in_both_languages_and_so_does_the_fourth():
    game = Game(
        3, "bridge", {"dev_actions": 1, "weather_clear": 1, "weather_light": 0, "weather_heavy": 0}
    )
    for who in crew_of_five():
        act(game, "dev_goal", op="join", npc=who)
    run_to(game, at(3, 7, 30))
    work = tasks_of(frame_now(game))["t_work_3"]
    assert work["why"] == {
        "zh": "五个帮手一早上能做五个钟头，桥还差十个钟头。",
        "en": "5 helpers give 5 hours in a morning, and 10 are still to do.",
    }
    run_to(game, at(3, 14))
    last = tasks_of(frame_now(game))["t_work_4"]
    assert last["why"] == {
        "zh": "这是最后一个早上，帮手能做五个钟头，桥还差五个钟头。",
        "en": "The last morning: the helpers give 5 hours, and 5 are still to do.",
    }


# ------------------------------------------------------------------------------ the mornings left


@pytest.mark.parametrize(
    ("day", "hour", "sky", "left"),
    [
        (2, 10, "clear", 2),  # the third and the fourth
        (3, 7, "clear", 2),
        (3, 10, "clear", 2),  # the morning that is going on is one of them
        (3, 10, "heavy_rain", 1),  # but not in a heavy rain
        (3, 13, "clear", 1),
        (3, 13, "heavy_rain", 1),  # it is over: the sky of the morning that was does not matter
        (4, 7, "clear", 1),
        (4, 7, "heavy_rain", 0),
        (4, 13, "clear", 0),
    ],
)
def test_the_mornings_that_are_left_for_the_work_are_counted_as_far_as_the_player_can_tell(
    day, hour, sky, left
):
    game = Game(
        3, "bridge", {"dev_actions": 1, "weather_clear": 1, "weather_light": 0, "weather_heavy": 0}
    )
    run_to(game, at(day, hour))
    state_of(game)["weather"]["kind"] = sky  # the sky of today is seen; the days to come are not
    now = clock.at(game.tick)
    assert agenda_facts.mornings_left(game._kernel.world, state_of(game), now) == left


def env_of(game: Game) -> Env:
    return Env(game._kernel.world, state_of(game), clock.at(game.tick))


def test_the_hours_are_short_when_the_helpers_cannot_do_them_in_the_mornings_that_are_left():
    game = Game(
        3, "bridge", {"dev_actions": 1, "weather_clear": 1, "weather_light": 0, "weather_heavy": 0}
    )
    short = lambda: agenda_terms.holds(env_of(game), {"kind": "work_short"})  # noqa: E731
    run_to(game, at(2, 9))
    assert short()  # nobody has joined: nothing can be done in two mornings
    for who in crew_of_five():
        act(game, "dev_goal", op="join", npc=who)
    assert not short()  # five helpers, two mornings, ten hours: just enough
    run_to(game, at(3, 14))
    assert not short()  # five hours are done and the fourth morning gives the other five
    state_of(game)["goals"]["work"]["ticks"] = (
        0  # as if the third morning had been lost to the rain
    )
    assert short()
    state_of(game)["goals"]["work"]["ticks"] = 5 * goals_work.clock.DAY_TICKS_PER_HOUR
    assert not short()
    for who in ("li_laotai", "zhou_zhanggui", "mujiang", "old_he", "zhadeng_shifu"):
        act(game, "dev_goal", op="join", npc=who)
    state_of(game)["goals"]["work"]["ticks"] = 0
    assert not short()  # ten helpers do it in the one morning that is left


def test_the_detour_is_offered_by_the_hours_a_day_early_and_not_before_the_morning_is_over():
    game = Game(
        3, "bridge", {"dev_actions": 1, "weather_clear": 1, "weather_light": 0, "weather_heavy": 0}
    )
    for who in crew_of_five():
        act(game, "dev_goal", op="join", npc=who)
    state_of(game)["weather"]["plan"][2] = "heavy_rain"  # the third morning is lost
    run_to(game, at(3, 12, 59))
    assert "t_detour" not in tasks_of(frame_now(game))
    run_to(game, at(3, 13, 2))
    detour = tasks_of(frame_now(game))["t_detour"]
    assert detour["state"] == "open" and "桥怕是来不及修好了" in detour["why"]["zh"]
    assert "may not be mended in time" in detour["why"]["en"]
