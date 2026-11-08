"""A time and a place are offered only where the act can be done: the follower's games by the hour.

The frame offers a time and a place in four ways: the ``window`` of a task (the task card and the
top bar), the task of the day and the other chances of the day in the paper of the morning
(``gazette.today`` and ``gazette.more``), and the first step of tomorrow in the summary of the night
(``night.step``). A time offered before the act is possible is of no use, and sends the player to
a place where they are told it is too early: the paper of the third morning once listed the full
statement in public for the evening of that day, and it is made from the evening of the fourth.

The follower (``tools/bots/follower.py``) plays whole games of the rules that the opening page
starts, doing what the top bar says and nothing else. This module records every call of such a
game, and checks at each of them that every window it shows

- is not of a day that is over, nor over by more than an hour (a window is told in whole hours, and
  its end is the hour it ends in);
- can be used then or later the same day (the day of the window): the card of its task is done
  within it, or offers an act within it that is not a preparation (opening the statement card,
  judging two lines or following a task are done at any hour), except for a task that waits for a
  promise to be kept and has nothing to do, or that keeps one (their acts are the delivery and the
  keeping, which the tests of the promises follow);
- is the same in the paper and in the summary of the night as it is on the card of its task, and
  the statement in public is not offered before it is possible.

The checks are plain functions of a recording, so the first tests here feed them recordings made by
hand, one of them with the fault of the third morning.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

import balance
import bots
from lantern_core.api import Game, preset
from lantern_core.world.bridge import statement
from lantern_core.world.bridge.data import SCRIPT

LIVE = ("open", "blocked")
GRACE = (
    60  # minutes after its hour of ending that a window may still be shown (told in whole hours)
)
PREPARATION = {"state", "judge", "track", "hint"}  # what is done at any hour, in no window
GAMES = (
    (492, None),  # the game of the opening page
    (1, None),
    (2, "v_flood"),
    (3, "v_drunk"),
    (5, "v_boat"),
)
TEAHOUSE = "p_teahouse"


# ---------------------------------------- the tasks that wait on a promise


def promised(task: dict[str, Any]) -> bool:
    """Whether the window of a task may be that of a promise that it waits on: its reasons or its
    appearance name a commitment that is promised (``agenda.promise_waited``)."""
    terms = [*task["appears"]]
    for option in task["why"]:
        terms += option["when"]
    return any(t.get("kind") == "commitment" and t.get("state") == "promised" for t in terms)


WAITING_ON_PROMISES = {t["id"] for t in SCRIPT["tasks"] if promised(t)}


def kept_by_the_game(task_id: str) -> bool:
    """The task of a promise made to a person: its window is the day it falls due."""
    return task_id.startswith("t_keep_")


# ---------------------------------------- a recording


def minutes(row: dict[str, Any]) -> int:
    """The minute of the day of a call, counted from midnight, the small hours after the evening."""
    return (row["hour"] + (24 if row["hour"] < 6 else 0)) * 60 + row["minute"]


def condense(out: dict[str, Any]) -> dict[str, Any]:
    """What a call says about times and places, and nothing more."""
    frame = out["frame"]
    when = frame["time"]
    paper, night = frame.get("gazette"), frame.get("night")
    return {
        "day": when["day"],
        "hour": when["hour"],
        "minute": when["minute"],
        "tasks": {
            task["id"]: {
                "state": task["state"],
                "window": task["window"],
                "verb": None if task["action"] is None else task["action"]["verb"],
            }
            for task in frame.get("tasks", [])
        },
        "paper": None
        if paper is None
        else {"day": paper["day"], "today": paper["today"], "more": paper["more"]},
        "night": None if night is None else {"day": night["day"], "step": night["step"]},
    }


def walk(seed: int, variant: str | None = None) -> list[dict[str, Any]]:
    """Play the follower, doing what the top bar says, from the opening of the game to its ending,
    and keep what every call says about times and places."""
    named = preset("slice", seed=seed, variant=variant) if variant else preset("slice", seed=seed)
    game = Game(named["seed"], named["scenario"], {"days": 5, "budget_cap": 0, **named["config"]})
    bot = bots.make("follower", json.loads(game.scene_json()), named["seed"], mode="tracked")
    out = json.loads(game.step("[]"))
    rows, obs, still = [condense(out)], bots.Obs(out), 0
    while game.tick < 5 * balance.TICKS_PER_DAY + 60:
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        out = json.loads(game.step(json.dumps(records)))
        obs = bots.Obs(out)
        rows.append(condense(out))
        still = 0 if out["advanced"] else still + 1
        assert still <= balance.MAX_STILL_CALLS, f"seed {seed}: the world stood still"
        if any(event["kind"] == "ending" for event in out["events"]):
            break
    return rows


# ---------------------------------------- the checks


def shown(row: dict[str, Any]) -> list[tuple[str, str, dict[str, Any]]]:
    """Every window a call shows: ``(where, task id, window)``."""
    found = [
        ("task", task_id, task["window"])
        for task_id, task in row["tasks"].items()
        if task["state"] in LIVE and task["window"] is not None
    ]
    paper = row["paper"]
    if paper is not None:
        if paper["today"] is not None and paper["today"]["window"] is not None:
            found.append(("paper today", paper["today"]["id"], paper["today"]["window"]))
        found += [("paper more", m["id"], m["window"]) for m in paper["more"] if m["window"]]
    step = None if row["night"] is None else row["night"]["step"]
    if step is not None and step["window"] is not None:
        found.append(("night step", step["id"], step["window"]))
    return found


def offered(rows: list[dict[str, Any]], at: int, task_id: str, window: dict[str, Any]) -> bool:
    """Whether the card of a task is done, or offers an act that is no preparation, in the hours of
    the window (its day, and from the call ``at`` on if that is today), as far as the recording
    goes. A window that the recording does not reach is taken as used."""
    start, end = window["from"] * 60, window["to"] * 60 + GRACE
    if window["day"] == rows[at]["day"]:
        start = max(start, minutes(rows[at]))
    reached = False
    for row in rows[at:]:
        if row["day"] > window["day"]:
            break
        if row["day"] < window["day"] or not start <= minutes(row) <= end:
            continue
        reached = True
        task = row["tasks"].get(task_id)
        if task is not None and (
            task["state"] == "done" or (task["verb"] and task["verb"] not in PREPARATION)
        ):
            return True
    return not reached


def problems(rows: list[dict[str, Any]]) -> list[str]:
    """What is wrong with the times and places a recording shows, one line for each. Empty if
    nothing is."""
    found: list[str] = []
    seen: set[tuple[Any, ...]] = set()
    for at, row in enumerate(rows):
        for where, task_id, window in shown(row):
            key = (where, task_id, tuple(window.values()), row["day"], row["hour"])
            if key in seen:
                continue
            seen.add(key)
            label = (
                f"day {row['day']} {row['hour']:02d}:{row['minute']:02d}, {where}, {task_id}: "
                f"day {window['day']} {window['from']}-{window['to']} {window['place']}"
            )
            late = window["day"] < row["day"] or (
                window["day"] == row["day"] and minutes(row) >= window["to"] * 60
            )
            over = late and (window["day"] < row["day"] or minutes(row) > window["to"] * 60 + GRACE)
            waits = task_id in WAITING_ON_PROMISES and row["tasks"][task_id]["verb"] is None
            if over:
                found.append(f"{label} is over")
            elif late:
                pass  # the hour after its end, in which a window told in whole hours may be shown
            elif (
                where == "task"
                and not (kept_by_the_game(task_id) or waits)
                and not offered(rows, at, task_id, window)
            ):
                found.append(f"{label} is never used")
            if task_id == "t_tell_town" and (window["day"], window["to"]) <= statement.opens():
                found.append(f"{label} is before the statement can be made")
            same = row["tasks"].get(task_id, {}).get("window")
            if where != "task" and same != window:
                found.append(f"{label} is not the window of the card ({same})")
    return found


# ---------------------------------------- the checks on recordings made by hand


def card(window: dict[str, Any] | None, verb: str | None = None, state: str = "open") -> dict:
    return {"state": state, "window": window, "verb": verb}


def call(day: int, hour: int, minute: int = 0, **tasks: dict[str, Any]) -> dict[str, Any]:
    return {
        "day": day,
        "hour": hour,
        "minute": minute,
        "tasks": tasks,
        "paper": None,
        "night": None,
    }


def evening(day: int) -> dict[str, Any]:
    return {"day": day, "from": 17, "to": 19, "place": TEAHOUSE}


def test_a_window_on_a_day_when_the_act_is_not_to_be_had_is_found():
    """The fault of the third morning: the statement in public was offered for the evening of that
    day, when the card offers nothing at the teahouse and the core says it is too early."""
    rows = [
        call(3, 8, t_tell_town=card(evening(3))),
        call(3, 17, t_tell_town=card(evening(3))),
        call(3, 18, t_tell_town=card(evening(3))),
        call(4, 17, t_tell_town=card(evening(4), "move")),
    ]
    found = problems(rows)
    assert any("day 3 08:00" in line and "never used" in line for line in found)
    assert any("before the statement can be made" in line for line in found)
    assert all(line.startswith("day 3") for line in found)


def test_a_window_that_the_card_offers_an_act_in_is_no_fault_and_no_preparation_is_an_act():
    rows = [
        call(2, 12, t_tell_town=card(evening(4))),
        call(4, 17, t_tell_town=card(evening(4), "move")),
    ]
    assert problems(rows) == []
    rows[1] = call(4, 17, t_tell_town=card(evening(4), "state"))  # the card is opened at any hour
    assert [line for line in problems(rows) if "never used" in line]


def test_a_window_that_is_over_is_found_an_hour_after_it_ends_and_not_before():
    work = {"day": 3, "from": 8, "to": 12, "place": "p_bridge"}
    rows = [
        call(3, 9, t_work_3=card(work, "move")),
        call(3, 12, t_work_3=card(work, "move")),
        call(3, 12, 59, t_work_3=card(work, "move")),
        call(3, 13, t_work_3=card(work)),
    ]
    assert problems(rows) == []  # told in whole hours: shown until the hour after its end
    rows += [call(3, 14, t_work_3=card(work)), call(4, 8, t_work_3=card(work, "move"))]
    assert [line.split(",")[0] for line in problems(rows) if "over" in line] == [
        "day 3 14:00",
        "day 4 08:00",
    ]


def test_a_window_that_a_card_uses_later_the_same_day_is_used_and_one_it_does_not_is_not():
    window = {"day": 4, "from": 8, "to": 12, "place": "p_bridge"}
    rows = [
        call(4, 6, t_work_4=card(window)),
        call(4, 9, t_work_4=card(window, "move")),
        call(4, 14, t_work_4=card(None, state="done")),
    ]
    assert problems(rows) == []
    rows[1] = call(4, 9, t_work_4=card(window))
    assert any("never used" in line for line in problems(rows))
    rows[2] = call(4, 11, t_work_4=card(window, state="done"))
    assert problems(rows) == []


def test_the_paper_and_the_night_name_the_window_of_the_card_and_no_other():
    window = {"day": 4, "from": 8, "to": 12, "place": "p_bridge"}
    task = card(window, "move")
    rows = [call(3, 21, t_work_4=task), call(4, 9, t_work_4=task)]
    rows[0]["night"] = {"day": 3, "step": {"id": "t_work_4", "window": {**window, "day": 5}}}
    rows[1]["paper"] = {"day": 4, "today": {"id": "t_work_4", "window": window}, "more": []}
    found = problems(rows)
    assert len(found) == 1 and "night step" in found[0] and "not the window of the card" in found[0]


# ---------------------------------------- the follower's games


@pytest.fixture(
    scope="module", params=GAMES, ids=lambda game: f"seed{game[0]}-{game[1] or 'slice'}"
)
def game_rows(request) -> list[dict[str, Any]]:
    seed, variant = request.param
    return walk(seed, variant)


def test_every_window_the_follower_is_shown_can_be_used_then_or_later_the_same_day(game_rows):
    assert problems(game_rows) == []


def test_the_games_show_the_windows_the_checks_are_for(game_rows):
    """The checks are not empty: the tasks, the paper and the night show windows in the games, and
    the statement in public and the table for the heads are offered for the evenings of the fourth
    and the fifth days only, from the second day on."""
    assert {"task", "paper today", "night step"} <= {w for r in game_rows for w, _, _ in shown(r)}
    for task_id in ("t_tell_town", "t_make_peace"):
        days = {
            r["tasks"][task_id]["window"]["day"]
            for r in game_rows
            if task_id in r["tasks"] and r["tasks"][task_id]["window"] is not None
        }
        assert days and min(days) >= 4 and max(days) <= 5, task_id
        early = [
            r for r in game_rows if r["day"] <= 3 and r["tasks"].get(task_id, {}).get("window")
        ]
        assert early, task_id  # before the fourth day the card names the fourth evening


def test_the_paper_of_the_third_morning_lists_neither_the_statement_nor_the_table(game_rows):
    papers = [r["paper"] for r in game_rows if r["paper"] is not None and r["paper"]["day"] == 3]
    assert len(papers) == 1
    listed = [m["id"] for m in papers[0]["more"]]
    listed += [] if papers[0]["today"] is None else [papers[0]["today"]["id"]]
    assert "t_tell_town" not in listed and "t_make_peace" not in listed
