"""The turnout of the festival follows what the manager does, and not the luck of the street.

The people expected at the festival are worked out from the households that promised and from the
townsfolk who are keen for it (``crowd.keen_count``: enthusiasm of 60 or more at the end). The
crowd places the townsfolk and lets them meet from a stream that depends on the seed and the tick
alone, and takes the street talk of the named people from generators made for each call (see the
top of ``crowd``). A manager who starts a quarter of an hour later, or does things in another
order, therefore changes the pulls of the street on the townsfolk by a little, and never deals
their meetings again.

The tests play whole games of the follower, the game the opening page starts, and put the start of
the manager off by some ticks, which changes everything the manager does after it and nothing
else.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

import balance
import bots
import follow_report
from lantern_core.api import Game, preset
from lantern_core.world.bridge import crowd
from lantern_core.world.bridge.data import CAST

DAY = balance.TICKS_PER_DAY
TRUTHS = ("v_boat", "v_flood", "v_drunk")
SEEDS = (492, 1, 2, 3, 4, 13)
LATE = (0, 14, 16, 30, 40)  # ticks that the manager stands still before the first act
BAND = 5  # keen townsfolk between the highest and lowest count over the late starts (4 measured)
GIFT_PERCENT = 3  # the most that the gifts of the follower may move the turnout


def play(
    seed: int, truth: str, late: int = 0, stop: int | None = None, gifts: bool = False
) -> tuple[Game, Any]:
    """The follower plays the game of the opening page of ``seed``, with ``truth`` true, after the
    manager has stood still for ``late`` ticks, to its ending or to tick ``stop``. With ``gifts``
    the follower gives each person a small thing that they like, as often as the town allows.

    Returns the game and the ending event (None if the game was stopped before it).
    """
    named = preset("slice", seed=seed, variant=truth)
    game = Game(named["seed"], named["scenario"], {"days": 5, "budget_cap": 0, **named["config"]})
    options: dict[str, Any] = {"mode": "tracked"}
    if gifts:
        options["gifts"] = {person["id"]: person["likes"][0] for person in CAST["people"]}
    bot = bots.make("follower", json.loads(game.scene_json()), named["seed"], **options)
    out = json.loads(game.step("[]"))
    for _ in range(late):
        out = json.loads(game.step("[]"))
    obs = bots.Obs(out)
    ending = None
    limit = 5 * DAY + 60 if stop is None else stop
    still = 0
    while game.tick < limit and ending is None:
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        out = json.loads(game.step(json.dumps(records)))
        obs = bots.Obs(out)
        still = 0 if out["advanced"] else still + 1
        assert still <= balance.MAX_STILL_CALLS, f"seed {seed}, {truth}: the world stood still"
        ending = next((e for e in out["events"] if e["kind"] == "ending"), None)
    return game, ending


def test_where_the_townsfolk_are_and_who_meets_whom_do_not_depend_on_what_the_manager_does():
    """Two managers who start 14 ticks apart do different things for three days. The townsfolk are
    in the same places and the stream of their meetings is at the same point in both games, and
    they differ in what the named people said to them in the street."""
    early, _ = play(492, "v_boat", 0, 3 * DAY)
    late, _ = play(492, "v_boat", 14, 3 * DAY)
    assert early.tick == late.tick == 3 * DAY
    assert early.hash() != late.hash()
    a, b = early._kernel.state["world"]["crowd"], late._kernel.state["world"]["crowd"]
    for name in ("rng", "at", "home", "slot"):
        assert a[name] == b[name], name
    assert a["enthusiasm"] != b["enthusiasm"] and a["stance"] != b["stance"]


@pytest.mark.parametrize("truth", TRUTHS)
def test_the_keen_count_of_the_opening_game_stays_in_a_band_when_the_manager_starts_late(truth):
    """The count that the turnout is worked out from, in the game the opening page starts, for a
    start put off by 0, 14, 16, 30 and 40 ticks. The way across is the same in all of them, and so
    are the households that promised."""
    keen, promised, passage = [], set(), set()
    for late in LATE:
        game, ending = play(492, truth, late)
        assert ending is not None and ending["ending"] == "ending_full", (truth, late)
        keen.append(crowd.keen_count(game._kernel.state))
        promised.add(ending["promised"])
        passage.add(ending["passage"])
    assert max(keen) - min(keen) <= BAND, (truth, keen)
    assert len(promised) == len(passage) == 1, (truth, promised, passage)


@pytest.mark.parametrize("seed", SEEDS)
@pytest.mark.parametrize("truth", TRUTHS)
def test_the_games_of_the_follower_end_full(seed, truth):
    """The regression of 18 games: six seeds, each with the three stories true."""
    (game,) = follow_report.plan_games([], [], variants=[(truth, [seed])])
    result = follow_report.play(game)
    assert "error" not in result, result.get("error")
    assert result["ending"] == "ending_full", (seed, truth)


@pytest.mark.parametrize("seed", SEEDS)
@pytest.mark.parametrize("truth", TRUTHS)
def test_the_gifts_of_the_follower_move_the_turnout_by_a_few_percent_at_most(seed, truth):
    """The gifts change whom the follower can win over, and so the households, and nothing about
    the townsfolk: the turnout of a game with them is that of the game without them to a few
    percent, and both end full."""
    _, plain = play(seed, truth)
    _, gifted = play(seed, truth, gifts=True)
    assert plain["ending"] == gifted["ending"] == "ending_full", (seed, truth)
    assert abs(gifted["turnout"] - plain["turnout"]) * 100 <= plain["turnout"] * GIFT_PERCENT, (
        seed,
        truth,
        plain["turnout"],
        gifted["turnout"],
    )
