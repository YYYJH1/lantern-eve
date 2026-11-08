"""The batch runner: games in lockstep, one row each, in parallel processes, and the tables."""

from __future__ import annotations

import csv
import json

import pytest

import balance

DAY = balance.TICKS_PER_DAY
COLUMNS = set(balance.COLUMNS)


def test_seeds_are_ranges_and_lists():
    assert balance.parse_seeds("1-3") == [1, 2, 3]
    assert balance.parse_seeds("7,2-4, 9") == [7, 2, 3, 4, 9]
    with pytest.raises(ValueError, match="range"):
        balance.parse_seeds("5-2")


def test_a_constant_to_try_is_a_module_a_name_and_a_literal():
    assert balance.parse_set(["gossip.COOLDOWN=90", "goals_call.JITTER=(0, 1)"]) == (
        ("gossip", "COOLDOWN", 90),
        ("goals_call", "JITTER", (0, 1)),
    )
    with pytest.raises(ValueError, match="module.NAME=value"):
        balance.parse_set(["COOLDOWN=90"])


def test_a_constant_is_set_for_a_game_and_put_back_after_it():
    from lantern_core.world.bridge import gossip

    before = gossip.COOLDOWN
    with balance.Overrides([("gossip", "COOLDOWN", 7)]):
        assert gossip.COOLDOWN == 7
    assert before == gossip.COOLDOWN
    with pytest.raises(ValueError, match="no NOPE"), balance.Overrides([("gossip", "NOPE", 1)]):
        pass


def test_a_changed_constant_changes_the_game_it_is_set_for():
    quick = balance.play_game(2, "passive", stop_tick=DAY, overrides=[("gossip", "COOLDOWN", 20)])
    slow = balance.play_game(2, "passive", stop_tick=DAY)
    assert quick[0]["hash"] != slow[0]["hash"]
    assert [r["chain"] for r in quick[1]] != [r["chain"] for r in slow[1]]


def test_two_seeds_and_two_bots_make_four_rows_in_order():
    rows, series = balance.run_games([1, 2], ["passive", "investigator"], stop_tick=DAY // 2)
    assert [(r["seed"], r["bot"]) for r in rows] == [
        (1, "passive"),
        (1, "investigator"),
        (2, "passive"),
        (2, "investigator"),
    ]
    assert all(set(r) == COLUMNS for r in rows)
    assert {r["variant"] for r in rows} <= {"v_boat", "v_flood", "v_drunk"}
    assert all(len(r["hash"]) == 16 and float(r["ms_per_tick"]) > 0 for r in rows)
    assert {(s["bot"], s["seed"]) for s in series} == {(r["bot"], r["seed"]) for r in rows}
    assert all(0 <= s["blame"] <= s["chain"] <= 20 for s in series)


def test_games_in_other_processes_are_the_games_in_this_one():
    here, series_here = balance.run_games([3], ["investigator", "liar"], stop_tick=DAY // 2)
    there, series_there = balance.run_games(
        [3], ["investigator", "liar"], stop_tick=DAY // 2, jobs=2
    )
    for a, b in zip(here, there, strict=True):
        a.pop("ms_per_tick"), b.pop("ms_per_tick")
    assert here == there
    assert series_here == series_there


def test_a_run_writes_a_row_a_game_and_the_spread_of_the_rumour(tmp_path, capsys):
    out = tmp_path / "run"
    code = balance.main(
        ["run", "--seeds", "1-2", "--bots", "passive,rallier", "--jobs", "1", "--stop-day", "1",
         "--label", "try", "--out", str(out)]
    )  # fmt: skip
    assert code == 0
    with (out / "games.csv").open(encoding="utf-8") as handle:
        games = list(csv.DictReader(handle))
    assert list(games[0]) == list(balance.COLUMNS)
    assert [(g["seed"], g["bot"], g["label"]) for g in games] == [
        ("1", "passive", "try"),
        ("1", "rallier", "try"),
        ("2", "passive", "try"),
        ("2", "rallier", "try"),
    ]
    reach = balance.read_csv(out / "reach.csv")
    assert list(reach[0]) == list(balance.REACH_COLUMNS)
    assert json.loads((out / "run.json").read_text(encoding="utf-8"))["bots"] == [
        "passive",
        "rallier",
    ]
    assert "passive" in capsys.readouterr().out


def test_a_run_can_start_from_the_opening_and_set_a_number_of_the_config(tmp_path):
    """``--config opening=NAME`` names the opening, whose value is a name, and ``--config days=5``
    is a number: the game of the opening page has the accusation against Li Er going round from
    the first tick, so more of the town holds it by the end of the first day than in the default
    config."""
    held = {}
    for label, config in (("default", []), ("hearsay", ["--config", "opening=op_li_er_hearsay"])):
        out = tmp_path / label
        code = balance.main(
            ["run", "--seeds", "1-2", "--bots", "passive", "--jobs", "1", "--stop-day", "1",
             "--config", "days=5", *config, "--out", str(out)]
        )  # fmt: skip
        assert code == 0
        rows = balance.read_csv(out / "games.csv")
        held[label] = sum(int(r["blame_d1"]) for r in rows)
    assert held["hearsay"] > held["default"]


def test_the_tables_say_how_the_games_ended_for_each_bot(tmp_path):
    rows = [
        {"bot": "a", "ending": "ending_full", "hidden": "", "truth_told": "1", "reconciled": "1",
         "crew_day": "1", "helpers": "10", "tellings": "0", "lies_told": "0", "lies_caught": "0",
         "trust_mean": "20", "stars": "1", "ms_per_tick": "0.5"},
        {"bot": "a", "ending": "ending_split", "hidden": "hidden_legend_of_lie", "truth_told": "0",
         "reconciled": "0", "crew_day": "", "helpers": "0", "tellings": "0", "lies_told": "4",
         "lies_caught": "2", "trust_mean": "10", "stars": "0", "ms_per_tick": "0.7"},
    ]  # fmt: skip
    summary = balance.summarise(rows)["a"]
    assert (summary["full"], summary["barely"], summary["split"]) == (50, 0, 50)
    assert (summary["hidden"], summary["crew"], summary["caught_any"]) == (50, 50, 50)
    assert summary["helpers"] == 5 and summary["lies"] == 2 and summary["trust"] == 15
    assert "50%" in balance.table({"a": summary})


def test_the_hours_of_a_game_run_through_the_night():
    assert balance.ticks_to_hours(0) == 0
    assert balance.ticks_to_hours(balance.DAY_TICKS) == 15
    assert balance.ticks_to_hours(balance.TICKS_PER_DAY) == 24
    assert balance.ticks_to_hours(balance.TICKS_PER_DAY + 120) == 25
