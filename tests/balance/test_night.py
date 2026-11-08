"""What the night does to the balance of the game: the town settles and hardens a little, the rumour
keeps its pace, and the player who does what the task list says ends the game as well as without it.

The targets are those of a run over many seeds, with room for the few games that stand in for
them."""

from __future__ import annotations

import balance
import follow_report

DAY = balance.TICKS_PER_DAY
HEARSAY = {"opening": "op_li_er_hearsay"}
SEEDS = list(range(1, 7))


def test_the_night_is_made_in_a_played_game_and_not_when_the_config_turns_it_off():
    on, _ = balance.run_games(SEEDS, ["passive"], jobs=3, config=HEARSAY, stop_tick=4 * DAY)
    off, _ = balance.run_games(
        SEEDS, ["passive"], jobs=3, config={**HEARSAY, "reflect": 0}, stop_tick=4 * DAY
    )
    assert all(row["errands_planned"] != "" for row in on)
    assert sum(row["errands_done"] for row in on) >= 4 * len(SEEDS)  # a few a day, in every game
    assert sum(row["night_weaker"] for row in on) > 0 and sum(row["night_firmer"] for row in on) > 0
    assert all(row["errands_planned"] == 0 and row["night_weaker"] == 0 for row in off)
    assert [r["hash"] for r in on] != [r["hash"] for r in off]


def test_the_night_leaves_the_pace_of_the_rumour_in_its_band():
    """Half the town hears the clerk's story in a morning at the soonest and three quarters between
    one day and two, with the errands of the days after the first and the guesses in the town."""
    _, series = balance.run_games(SEEDS, ["passive"], jobs=3, stop_tick=3 * DAY)
    rows = [{key: str(value) for key, value in row.items()} for row in series]
    hours = balance.reach_times(rows, "chain")
    assert hours["passive.t50"] >= 6 and 24 <= hours["passive.t75"] <= 48, hours


def test_the_follower_ends_the_game_the_page_starts_full_with_the_night_as_without_it():
    """The night sends people about in their free hours and never into the hours of the work, the
    meetings or the promises, so the player who does what the top bar says finds the people where
    the cards say, and ends the game perfect with it as without it (the same days, too)."""
    games = follow_report.plan_games([492, 1], [], variants=[("v_flood", [1]), ("v_drunk", [2])])
    off = [{**g, "config": {**g["config"], "reflect": 0}} for g in games]
    for result_on, result_off in zip(
        follow_report.play_all(games, jobs=4), follow_report.play_all(off, jobs=4), strict=True
    ):
        assert "error" not in result_on and "error" not in result_off, result_on["label"]
        assert result_on["ending"] == result_off["ending"] == "ending_full", result_on["label"]
        assert result_on["passage"] == result_off["passage"] == "mended", result_on["label"]
        assert result_on["row"]["truth_day"] == result_off["row"]["truth_day"] == 4, result_on[
            "label"
        ]
