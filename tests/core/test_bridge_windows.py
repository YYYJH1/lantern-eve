"""The times and places the cards offer are those of days on which the act can be done.

A task of the script may have a window of one ``day``, of every day, or of every day between two
``days``; and conditions, ``unless``, that spend the time of today. The statement in public is made
from the evening of the fourth day and once a day, the helpers do not work in a heavy rain, and a
promise that falls due today has no time left once the person is at home for the night. A frame
offers a time for none of these when it cannot be used, and the paper and the night, which are made
from the frame, offer none either.

The follower's games, hour by hour, are in ``tests/balance/test_follower_windows.py``.
"""

from __future__ import annotations

from agenda_helpers import frame_now, meet, slice_game, tasks_of
from bridge_helpers import at, run_to, state_of, world_of
from player_helpers import acks, act, me, put
from statement_helpers import fill, state_it

from lantern_core.world.bridge import agenda, goals_call

TEAHOUSE, BRIDGE = "p_teahouse", "p_bridge"
TELL, PEACE, WORK_3, WORK_4 = "t_tell_town", "t_make_peace", "t_work_3", "t_work_4"
LI_DA = "li_da"
EVENING = {"from": 17, "to": 19, "place": TEAHOUSE}


def window_of(game, task_id: str) -> dict | None:
    return tasks_of(frame_now(game))[task_id]["window"]


# ------------------------------------------------------------------------------ the days


def test_a_window_of_every_day_between_two_days_is_the_next_time_inside_them():
    world = world_of(slice_game())
    window = {**EVENING, "days": [4, 5]}
    for tick, day in (
        (at(1, 6), 4),  # the days before the first
        (at(3, 18), 4),
        (at(3, 22), 4),  # the night of the third day
        (at(4, 6), 4),
        (at(4, 18, 59), 4),
        (at(4, 19), 5),  # the fourth evening is over
        (at(4, 2), 5),  # the small hours belong to the day before, whose evening is over
        (at(5, 18, 59), 5),
        (at(5, 19), None),  # no day is left
    ):
        assert agenda.next_day(world, window, tick) == day, tick
    one = {**EVENING, "days": [2, 2]}
    assert [agenda.next_day(world, one, at(d, 8)) for d in (1, 2, 3)] == [2, 2, None]


def test_the_statement_and_the_table_name_the_fourth_evening_until_it_comes():
    """The paper of the third morning listed the statement for the evening of that day, when the
    full statement is not possible: no card names a time before the fourth evening."""
    game = slice_game()
    me(game)["evidence"].append("e_footprint")
    for task_id in (TELL, PEACE):
        found = {}
        for tick in (at(2, 12), at(3, 8), at(3, 17, 30), at(3, 21, 30), at(4, 6, 30)):
            run_to(game, tick)
            if task_id in tasks_of(frame_now(game)):
                found[tick] = window_of(game, task_id)
        assert found, task_id
        assert {w["day"] for w in found.values()} == {4}, (task_id, found)
        assert all((w["from"], w["to"], w["place"]) == (17, 19, TEAHOUSE) for w in found.values())


def test_the_paper_and_the_night_do_not_offer_the_statement_for_the_third_evening():
    game = slice_game()
    me(game)["evidence"].append("e_footprint")
    papers, nights = [], []

    def look(out):
        frame = out["frame"]
        if frame.get("gazette"):
            papers.append(frame["gazette"])
        if frame.get("night"):
            nights.append(frame["night"])

    run_to(game, at(4, 8), each=look)
    assert [p["day"] for p in papers] == [2, 3, 4]
    for kept in papers:
        listed = [m["id"] for m in kept["more"]] + [kept["today"]["id"]]
        assert TELL not in listed and PEACE not in listed, kept["day"]
    assert [n["day"] for n in nights] == [1, 2, 3]
    for kept in nights:  # tomorrow's first step is the earliest window of the day after
        step = kept["step"]
        assert step is None or step["window"] is None or step["window"]["day"] == kept["day"] + 1


# ------------------------------------------------------------------------------ spent


def at_the_teahouse(day: int, hour: int, minute: int):
    """The slice in the story where a drunk man did it, the manager at the teahouse with one item
    of evidence that does not tell the story apart (so the statement is made, and not told)."""
    game = slice_game(variant="v_drunk")
    run_to(game, at(day, hour, minute))
    put(game, *world_of(game).town.places[TEAHOUSE].door)
    me(game)["evidence"].append("e_footprint")
    return game


def test_once_a_statement_is_made_the_time_for_the_next_is_tomorrows():
    game = at_the_teahouse(4, 18, 5)
    fill(game)
    before = tasks_of(frame_now(game))[TELL]
    assert before["window"] == {"day": 4, **EVENING}
    assert before["expected"]
    assert acks(state_it(game)) == [("applied", None)]
    after = tasks_of(frame_now(game))[TELL]
    assert after["state"] in ("open", "blocked")
    assert after["window"] == {"day": 5, **EVENING}  # one a day: the evening of the fifth
    assert after["expected"]  # and who is expected then, with the time
    # the evening of the last day is the last: a statement made then leaves no time to offer
    run_to(game, at(5, 18, 5))
    put(game, *world_of(game).town.places[TEAHOUSE].door)
    fill(game)
    assert tasks_of(frame_now(game))[TELL]["window"] == {"day": 5, **EVENING}
    assert acks(state_it(game)) == [("applied", None)]
    last = tasks_of(frame_now(game))[TELL]
    assert last["window"] is None and "expected" not in last


# ------------------------------------------------------------------------------ the rain


def with_the_crew(**config: int):
    """A slice in which the crew is ready, so that the mornings of work are tasks."""
    game = slice_game(dev_actions=1, **config)
    for who in ("li_da", "li_laotai", "zhou_zhanggui", "zhou_niangzi", "cha_laoban"):
        assert acks(act(game, "dev_goal", op="join", npc=who)) == [("applied", None)]
    assert goals_call.crew_ready(game._kernel.world, state_of(game)["goals"]["call"])
    return game


def test_no_morning_of_work_is_offered_on_a_day_of_heavy_rain_and_the_board_names_the_next():
    game = with_the_crew(weather_clear=0, weather_light=0, weather_heavy=1)
    run_to(game, at(2, 22))  # the night before: the sky of tomorrow is not known
    assert window_of(game, WORK_3) == {"day": 3, "from": 8, "to": 12, "place": BRIDGE}
    papers = []
    run_to(game, at(3, 7, 30), each=lambda out: papers.append(out["frame"].get("gazette")))
    (paper,) = [p for p in papers if p]  # the paper of the morning is made at seven
    assert WORK_3 not in [m["id"] for m in paper["more"]]  # it is no other chance of the day
    assert paper["today"]["id"] != WORK_3 or paper["today"]["window"] is None
    frame = frame_now(game)
    work = tasks_of(frame)[WORK_3]
    assert work["state"] == "blocked" and work["window"] is None
    assert frame["board"]["window"] == {"day": 4, "from": 8, "to": 12, "place": BRIDGE}
    run_to(game, at(3, 13, 2))  # the morning is lost; the last one is the next
    run_to(game, at(4, 7, 30))
    work = tasks_of(frame_now(game))[WORK_4]
    assert work["state"] == "blocked" and work["window"] is None
    assert frame_now(game)["board"]["window"] is None  # and there is none after it


def test_a_morning_of_work_without_rain_has_its_window_all_morning():
    game = with_the_crew(weather_clear=1, weather_light=0, weather_heavy=0)
    for tick in (at(2, 22), at(3, 7, 30), at(3, 9), at(3, 11, 59)):
        run_to(game, tick)
        assert window_of(game, WORK_3) == {"day": 3, "from": 8, "to": 12, "place": BRIDGE}, tick
    assert frame_now(game)["board"]["window"] == window_of(game, WORK_3)


# ------------------------------------------------------------------------------ a promise


def test_the_card_of_a_promise_that_falls_due_today_has_no_time_once_the_day_is_over():
    game = slice_game()
    run_to(game, at(2, 10))
    meet(game, LI_DA)
    out = act(game, "promise", op="make", what="stall", item="front", amount=0, due=4)
    act(game, "leave")
    assert acks(out) == [("applied", None)]
    seen = {}
    for tick in (at(3, 10), at(4, 6, 5), at(4, 12), at(4, 20, 30), at(4, 21, 5), at(4, 23, 30)):
        run_to(game, tick)
        seen[tick] = window_of(game, "t_keep_1")
    assert seen[at(3, 10)]["day"] == seen[at(4, 6, 5)]["day"] == seen[at(4, 12)]["day"] == 4
    assert seen[at(4, 20, 30)]["day"] == 4  # Li Da is out until nine
    # at home for the night: the stretch of the next morning is when the promise has lapsed
    assert seen[at(4, 21, 5)] is None and seen[at(4, 23, 30)] is None
    run_to(game, at(5, 6, 5))
    assert tasks_of(frame_now(game))["t_keep_1"]["state"] == "stale"


def test_a_window_the_script_leaves_with_no_days_and_no_conditions_is_what_it_was():
    for task in agenda.book().tasks:
        window = task["window"]
        if window is None:
            continue
        extra = set(window) - {"day", "from", "to", "place"}
        assert extra <= {"days", "unless"}, task["id"]
        if task["id"] in ("t_clear_rumour", "t_tea_tonight", "t_festival_night"):
            assert not extra, task["id"]
