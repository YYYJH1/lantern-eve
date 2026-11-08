"""Which task the manager follows, when the player does not say.

The game is the slice, played on a script of a few tasks made for the case (``book``): each is
written as the compiled script has it, with a window of the clock or none, an action on show at
some hours or none, and a state. The rule is in ``agenda.standing`` and ``agenda.follow``. A task
whose window is open now comes first, the one that closes soonest, and only if there is something
to do in it. Then comes the most urgent task with an action on show, and last the tasks that only
wait, those with a window still to come first. The task followed is changed when another stands
better, with the reason in both languages; and a task the player picked stays picked until it ends
or they pick another.
"""

from __future__ import annotations

from typing import Any

import pytest
from agenda_helpers import changed, frame_now, idle, slice_game, tasks_of
from bridge_helpers import at, state_of
from player_helpers import ack, act

from lantern_core.world.bridge import agenda
from lantern_core.world.bridge.data import SCRIPT

OPEN_ALL_DAY = {"day": 1, "from": 6, "to": 21}


def words(zh: str, en: str, *, when: tuple = ()) -> dict[str, Any]:
    return {"zh": zh, "en": en, "when": list(when)}


def todo(*, hours: tuple[int, int] | None = None, place: str = "p_bridge") -> dict[str, Any]:
    """An action option of a task: go to a place, at the hours given or whenever."""
    when = [] if hours is None else [{"kind": "hours", "from": hours[0], "to": hours[1]}]
    return {"verb": "move", "npc": None, "place": place, "item": None, "follow": [], "when": when}


def task(
    task_id: str,
    priority: int,
    *,
    action: list[dict[str, Any]] | None = None,
    window: dict[str, Any] | None = None,
    appears: list[dict[str, Any]] | None = None,
    blocked: list[dict[str, Any]] | None = None,
    done: list[dict[str, Any]] | None = None,
    stale: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """A task as the compiled script has it, with the title ``Task <id>`` in both languages."""
    return {
        "id": task_id,
        "kind": "need",
        "job": "bridge",
        "priority": priority,
        "text": {"zh": f"事项{task_id}", "en": f"Task {task_id}"},
        "why": [words(f"缘由{task_id}", f"Why {task_id}")],
        "next": [words(f"下一步{task_id}", f"Next {task_id}")],
        "action": action or [],
        "window": window,
        "expected": None,
        "appears": appears or [],
        "blocked": blocked or [],
        "done": done or [],
        "stale": stale or [],
    }


@pytest.fixture
def book(monkeypatch):
    """Play the game on a script that has only the tasks given."""

    def use(*tasks: dict[str, Any]) -> None:
        monkeypatch.setattr(agenda, "SCRIPT", {**SCRIPT, "tasks": list(tasks)})
        agenda.book.cache_clear()

    yield use
    monkeypatch.undo()
    agenda.book.cache_clear()


def at_the_hour(game, day: int, hour: int, minute: int = 0) -> list[dict[str, Any]]:
    """Run on to just past the time, and give the changes of the task followed on the way."""
    seen: list[dict[str, Any]] = []
    while game.tick <= at(day, hour, minute) + 1:
        seen += changed(idle(game))
    return seen


def tracked(game) -> str | None:
    return frame_now(game)["tracked"]


def who(event: dict[str, Any]) -> tuple[Any, Any, str]:
    return event["from"], event["to"], event["cause"]


# ---------------------------------------------------------------------------- the order


def test_a_window_that_is_open_comes_first_and_the_one_that_closes_soonest_before_the_others(book):
    long_window = {"day": 1, "from": 9, "to": 12, "place": "p_bridge"}
    short_window = {"day": 1, "from": 9, "to": 11, "place": "p_teahouse"}
    book(
        task("a", 10, action=[todo()]),
        task("b", 20, action=[todo()], window=long_window),
        task("c", 30, action=[todo(place="p_teahouse")], window=short_window),
    )
    game = slice_game()
    assert tracked(game) == "a"  # nothing is open yet: the most urgent with an action
    seen = at_the_hour(game, 1, 9)
    assert [who(e) for e in seen] == [("a", "c", "window")]  # both are open, "c" closes first
    assert tracked(game) == "c"
    seen = at_the_hour(game, 1, 11)
    assert [who(e) for e in seen] == [
        ("c", "b", "window")
    ]  # its window is over, and "b" has one open still
    seen = at_the_hour(game, 1, 12)
    assert [who(e) for e in seen] == [("b", "a", "ready")]  # and now the most urgent with an action
    assert tracked(game) == "a"


def test_without_a_window_the_most_urgent_task_with_an_action_is_followed_and_a_waiting_one_is_not(
    book,
):
    book(task("waits", 5), task("acts", 20, action=[todo()]))
    game = slice_game()
    assert tracked(game) == "acts"
    out = idle(game)
    assert changed(out) == []
    assert tasks_of(out["frame"])["waits"]["action"] is None


def test_among_tasks_that_only_wait_the_window_that_opens_first_is_followed_then_the_most_urgent(
    book,
):
    soon = {"day": 1, "from": 9, "to": 11, "place": "p_bridge"}
    later = {"day": 1, "from": 15, "to": 17, "place": "p_bridge"}
    book(task("none", 1), task("later", 2, window=later), task("soon", 3, window=soon))
    game = slice_game()
    assert tracked(game) == "soon"  # a time to be somewhere beats a task with no time at all


def test_a_window_with_nothing_to_do_in_it_is_not_open_for_the_choice(book):
    window = {"day": 1, "from": 8, "to": 12, "place": "p_bridge"}
    rain = {
        "when": [{"kind": "hours", "from": 6, "to": 21}],
        "blocker": {"zh": "下雨", "en": "Rain"},
        "why": [],
        "next": [],
        "action": [],
    }
    book(
        task("rained_off", 5, window=window, blocked=[rain]),
        task("quiet", 6, window=window),
        task("elsewhere", 20, action=[todo(place="p_teahouse")]),
    )
    game = slice_game()
    at_the_hour(game, 1, 9)  # the window is open; one task is blocked, the other has no action
    assert tracked(game) == "elsewhere"
    assert tasks_of(frame_now(game))["rained_off"]["state"] == "blocked"


def test_an_act_that_is_too_late_for_the_hour_is_not_offered_and_the_window_comes_in_its_time(book):
    """The elder is asked to call the clan before five, and the card offers it up to four, so that
    there is time for the act and the walk; from five the window of the teahouse is open, and the
    action is the one that fits it."""
    window = {"day": 1, "from": 17, "to": 19, "place": "p_teahouse"}
    book(
        task(
            "tell",
            10,
            action=[
                todo(hours=(17, 19), place="p_teahouse"),
                todo(hours=(6, 16), place="p_clan_hall"),
            ],
            window=window,
        ),
        task("other", 20, action=[todo()]),
    )
    game = slice_game()
    assert tracked(game) == "tell"
    assert tasks_of(frame_now(game))["tell"]["action"]["place"] == "p_clan_hall"
    seen = at_the_hour(game, 1, 16)
    assert [who(e) for e in seen] == [("tell", "other", "waiting")]  # the hour of the act is over
    assert tasks_of(frame_now(game))["tell"]["action"] is None
    seen = at_the_hour(game, 1, 17)
    assert [who(e) for e in seen] == [("other", "tell", "window")]
    assert tasks_of(frame_now(game))["tell"]["action"]["place"] == "p_teahouse"


# ---------------------------------------------------------------------------- the changes


def test_the_task_followed_turns_to_waiting_and_the_next_one_is_followed_with_the_reason(book):
    book(
        task("first", 5, action=[todo(hours=(6, 8))]),
        task("second", 20, action=[todo(place="p_teahouse")]),
    )
    game = slice_game()
    assert tracked(game) == "first"
    seen = at_the_hour(game, 1, 8)
    (event,) = seen
    assert who(event) == ("first", "second", "waiting")
    assert event["reason"] == {
        "zh": "「事项first」眼下只能等，先看「事项second」",
        "en": "“Task first” can only wait for now. Now following “Task second”",
    }


def test_it_is_followed_again_when_it_has_something_to_do(book):
    book(
        task("first", 5, action=[todo(hours=(6, 8)), todo(hours=(12, 14))]),
        task("second", 20, action=[todo(place="p_teahouse")]),
    )
    game = slice_game()
    at_the_hour(game, 1, 8)
    assert tracked(game) == "second"
    seen = at_the_hour(game, 1, 12)
    (event,) = seen
    assert who(event) == ("second", "first", "ready")
    assert event["reason"] == {
        "zh": "「事项first」有事可办了，改追踪它",
        "en": "There is something to do for “Task first” now. Now following it",
    }
    seen = at_the_hour(game, 1, 14)
    assert [who(e) for e in seen] == [("first", "second", "waiting")]


def test_the_time_of_another_task_coming_is_said_in_both_languages(book):
    window = {"day": 1, "from": 10, "to": 12, "place": "p_bridge"}
    book(task("always", 5, action=[todo()]), task("timed", 20, action=[todo()], window=window))
    game = slice_game()
    seen = at_the_hour(game, 1, 10)
    (event,) = seen
    assert who(event) == ("always", "timed", "window")
    assert event["reason"] == {
        "zh": "「事项timed」的时间到了，改追踪它",
        "en": "It is time for “Task timed”. Now following it",
    }


def test_a_task_that_ends_hands_over_by_the_order_and_says_so_as_before(book):
    book(
        task("one", 5, action=[todo()], stale=[{"kind": "after", "day": 1, "hour": 8}]),
        task("two", 20, action=[todo()]),
    )
    game = slice_game()
    (event,) = at_the_hour(game, 1, 8)
    assert who(event) == ("one", "two", "stale")
    assert event["reason"]["en"] == "“Task one” has lapsed. Now following “Task two”"


# ---------------------------------------------------------------------------- the player's pick


def test_a_task_the_player_picked_stays_picked_while_it_waits_and_others_come_first(book):
    book(
        task("waits", 30),
        task("acts", 10, action=[todo()]),
        task(
            "timed",
            20,
            action=[todo()],
            window={"day": 1, "from": 9, "to": 11, "place": "p_bridge"},
        ),
    )
    game = slice_game()
    assert tracked(game) == "acts"
    out = act(game, "track", task="waits")
    assert ack(out) == ("applied", None)
    assert [who(e) for e in changed(out)] == [("acts", "waits", "chosen")]
    assert "picked" in state_of(game)["agenda"]
    assert at_the_hour(game, 1, 10) == []  # the time of "timed" came, and nothing changed
    assert tracked(game) == "waits"


def test_picking_the_task_that_is_followed_already_keeps_it_too(book):
    book(
        task("a", 10, action=[todo()]),
        task("b", 20, action=[todo()], window={"day": 1, "from": 9, "to": 11, "place": "p_bridge"}),
    )
    game = slice_game()
    out = act(game, "track", task="a")  # it is the one followed: no change, but it is the pick now
    assert changed(out) == [] and ack(out) == ("applied", None)
    assert at_the_hour(game, 1, 10) == []
    assert tracked(game) == "a"


def test_a_pick_is_let_go_when_the_task_ends_and_the_order_takes_over(book):
    book(
        task("mine", 30, action=[todo()], stale=[{"kind": "after", "day": 1, "hour": 8}]),
        task("acts", 10, action=[todo()]),
        task(
            "timed",
            20,
            action=[todo()],
            window={"day": 1, "from": 9, "to": 11, "place": "p_bridge"},
        ),
    )
    game = slice_game()
    act(game, "track", task="mine")
    (event,) = at_the_hour(game, 1, 8)
    assert who(event) == ("mine", "acts", "stale")
    assert "picked" not in state_of(game)["agenda"]
    (event,) = at_the_hour(game, 1, 9)  # and the order follows the clock again
    assert who(event) == ("acts", "timed", "window")


def test_a_pick_of_another_task_is_the_new_pick(book):
    book(task("a", 10, action=[todo()]), task("b", 20), task("c", 30, action=[todo()]))
    game = slice_game()
    act(game, "track", task="b")
    out = act(game, "track", task="c")
    assert [who(e) for e in changed(out)] == [("b", "c", "chosen")]
    assert tracked(game) == "c"


# ---------------------------------------------------------------------------- the promise to see


def test_a_promise_to_be_there_for_comes_first_while_its_window_is_open_and_not_before(book):
    promised = {"kind": "commitment", "by": "li_da", "item": "bamboo", "state": "promised"}
    # the task that waits on a promise has no action: being there when it comes is all it asks
    book(task("arrival", 10, appears=[promised]), task("work", 20, action=[todo()]))
    game = slice_game()
    assert tracked(game) == "work"
    state_of(game)["commitments"]["list"].append(
        {
            "id": "m1",
            "by": "li_da",
            "item": "bamboo",
            "amount": 4,
            "made": game.tick,
            "due": {"day": 1, "hour": 12},
            "start": at(1, 9),
            "due_at": at(1, 12),
            "late_at": at(1, 15),
            "task": 0,
            "state": "promised",
            "reason": "",
            "ended": -1,
        }
    )
    assert at_the_hour(game, 1, 8) == []  # it is in, and waits for nine: the window is ahead
    assert tasks_of(frame_now(game))["arrival"]["window"] == {
        "day": 1,
        "from": 9,
        "to": 12,
        "place": "p_bridge",
    }
    (event,) = at_the_hour(game, 1, 9)
    assert who(event) == ("work", "arrival", "window")
    (event,) = at_the_hour(game, 1, 12)
    assert who(event) == ("arrival", "work", "waiting")  # the window is over: it only waits
