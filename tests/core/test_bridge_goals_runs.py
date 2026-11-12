"""Whole games with the goals at work: the three endings, determinism, replay and snapshots."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from bridge_helpers import at
from goals_helpers import (
    LAST_NIGHT,
    Hand,
    crew_of_five,
    dev,
    hand,
    rally,
)

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import goals

TESTS = Path(__file__).resolve().parents[1]
ALL_CLEAR = {"weather_clear": 1, "weather_light": 0, "weather_heavy": 0}


def plain(value, path="$"):
    """Fail on any type that would not survive a snapshot as itself: tuples, sets, floats."""
    if isinstance(value, dict):
        for key, item in value.items():
            assert type(key) is str, (path, key)
            plain(item, f"{path}.{key}")
    elif isinstance(value, list):
        for i, item in enumerate(value):
            plain(item, f"{path}[{i}]")
    else:
        assert value is None or type(value) in (str, int, bool), (path, type(value))


def play(h: Hand, script, until=LAST_NIGHT + 1) -> Hand:
    """Play a game: ``script`` is a list of ``(tick, [player actions])``."""
    for tick, bodies in script:
        h.run_to(tick)
        h.send(*bodies)
    h.run_to(until)
    return h


def mend_the_bridge():
    """The actions that get the bridge mended on day 4: a crew, and both materials."""
    return [
        (100, [rally(), *[dev("join", npc=p) for p in crew_of_five()]]),
        (120, [dev("material", npc="li_da"), dev("material", npc="zhou_zhanggui")]),
    ]


def make_peace():
    return [(at(2, 10), [dev("truth"), dev("reconcile"), dev("grudge", value=10)])]


def hang_the_lanterns():
    return [
        (100, [dev("join", npc=p) for p in ("li_er", "zhou_dalang", "old_he")]),
        (110, [dev("lane", npc="miaozhu")]),
    ]


def ending(h: Hand):
    (event,) = h.kinds("ending")
    return event


# ------------------------------------------------------------------------------ the endings


def test_a_mended_bridge_with_the_truth_told_and_the_families_reconciled_is_a_perfect_night():
    h = play(hand(3), [*mend_the_bridge(), *make_peace()])
    event = ending(h)
    assert event["ending"] == "ending_full" and event["label"]["zh"] == "圆满"
    assert event["inputs"] == {
        "bridge_fixed": True,
        "detour_done": False,
        "truth_told": True,
        "reconciled": True,
    }
    assert event["passage"] == "mended"
    assert h.goals["flags"]["bridge_fixed"] < at(4, 18)
    assert h.frame["hud"]["bridge"]["state"] == "mended"
    assert h.frame["hud"]["ending"] == "ending_full"
    assert event["promised"] == len(h.frame["lanterns"]) == h.frame["hud"]["promised"] > 2
    assert h.frame["hud"]["turnout"] == event["turnout"] > 0


def test_the_detour_alone_gets_the_festival_through_but_only_just():
    h = play(hand(3), [*hang_the_lanterns(), *make_peace()])
    event = ending(h)
    assert event["ending"] == "ending_barely" and event["passage"] == "detour"
    assert event["inputs"]["bridge_fixed"] is False and event["inputs"]["detour_done"] is True
    assert event["inputs"]["truth_told"] and event["inputs"]["reconciled"]  # still not the full one
    assert h.frame["hud"]["bridge"]["state"] == "detour"
    assert h.goals["flags"]["detour_done"] < at(2, 6)


def test_a_mended_bridge_without_the_truth_or_the_peace_is_just_enough_too():
    h = play(hand(3), mend_the_bridge())
    event = ending(h)
    assert event["ending"] == "ending_barely" and event["passage"] == "mended"
    assert event["inputs"]["truth_told"] is False and event["inputs"]["reconciled"] is False


def test_with_no_way_through_the_families_light_their_lamps_apart_whatever_else_was_done():
    h = play(hand(3), [(100, [dev("join", npc="li_da")]), *make_peace()])
    event = ending(h)
    assert event["ending"] == "ending_split" and event["passage"] == "none"
    assert event["inputs"]["truth_told"] and event["inputs"]["reconciled"]
    assert event["label"]["zh"] == "两家各点各的灯"
    assert h.frame["hud"]["bridge"]["state"] == "broken"


def test_a_crew_that_is_ready_only_on_day_4_cannot_do_ten_hours_before_the_deadline():
    late = [
        (at(4, 7), [dev("join", npc=p) for p in crew_of_five()]),
        (at(4, 7, 5), [dev("material", npc="li_da"), dev("material", npc="zhou_zhanggui")]),
    ]
    h = play(hand(3), late)
    assert ending(h)["ending"] == "ending_split"
    assert h.goals["work"]["ticks"] == 5 * 120 and "bridge_fixed" not in h.goals["flags"]
    assert h.goals["flags"].keys() >= {"bamboo_delivered", "timber_delivered"}


# ------------------------------------------------------------------------------ determinism


def scripted(seed=3):
    h = hand(seed)
    script = [
        (100, [rally(), dev("join", npc="cha_laoban"), dev("join", npc="zhou_niangzi")]),
        (130, [dev("material", npc="li_da"), dev("material", npc="zhou_zhanggui")]),
        (at(1, 9), [dev("lane", npc="miaozhu")]),
        (at(2, 7), [dev("truth"), dev("reconcile")]),
    ]
    return h, script


def test_the_state_of_a_game_with_the_goals_at_work_is_plain_data():
    h, script = scripted()
    play(h, script, until=at(3, 12))
    plain(h.game._kernel.state)
    assert json.loads(h.game.snapshot_json()) == h.game._kernel.state
    assert goals.joined(h.state) and h.goals["flags"]


def test_two_games_with_the_same_seed_and_inputs_have_the_same_state_all_the_way():
    runs = []
    for _ in range(2):
        h, script = scripted()
        hashes = []
        for tick, bodies in script:
            while h.game.tick < tick:
                h.send()
                if h.game.tick % 10 == 0:
                    hashes.append(h.game.hash())
            h.send(*bodies)
            hashes.append(h.game.hash())
        while h.game.tick < at(3, 11):
            h.send()
            if h.game.tick % 10 == 0:
                hashes.append(h.game.hash())
        runs.append(hashes)
    assert runs[0] == runs[1] and len(runs[0]) > 400
    other, script = scripted(seed=4)
    play(other, script, until=at(1, 6))
    assert other.game.hash() != hand(3).game.hash()


def test_replaying_the_input_log_gives_the_state_of_the_live_run_at_every_tick():
    game = Game(12, "bridge", {"dev_actions": 1, **ALL_CLEAR})
    recorder = Recorder(game)
    seq = 0
    live = {}
    script = {
        100: [rally(), dev("join", npc="mujiang"), dev("join", npc="zhou_niangzi")],
        130: [dev("material", npc="li_da")],
        400: [dev("lane", npc="miaozhu")],
    }
    while game.tick < 2300:
        tick = game.tick
        records = []
        for body in script.get(tick, []):
            records.append({"seq": seq, "kind": "player", "body": {"action_id": f"s{seq}", **body}})
            seq += 1
        recorder.step(json.dumps(records))
        live[tick] = game.hash()
    recording = recorder.recording()
    replayed = {}
    rebuild(recording, on_step=lambda g, tick, out: replayed.__setitem__(tick, g.hash()))
    assert replayed == live
    final = rebuild(recording)
    assert final.snapshot_json() == game.snapshot_json()
    assert "lane_opened" in json.loads(final.snapshot_json())["world"]["goals"]["flags"]


@pytest.mark.parametrize("at_tick", [at(2, 21), at(3, 9, 30), LAST_NIGHT - 1])
def test_a_game_restored_from_a_snapshot_goes_on_exactly_as_the_original_did(at_tick):
    h, script = scripted()
    play(h, script, until=at_tick)
    twin = Game.from_snapshot_json(h.game.snapshot_json())
    assert twin.hash() == h.game.hash()
    for _ in range(400):
        a, b = h.game.step(), twin.step()
        assert a == b
    assert twin.snapshot_json() == h.game.snapshot_json()


def test_a_game_restored_just_before_the_last_night_ends_it_the_same_way():
    h, script = scripted()
    play(h, script, until=LAST_NIGHT)
    twin = Game.from_snapshot_json(h.game.snapshot_json())
    assert h.game.step() == twin.step()
    assert twin.snapshot_json() == h.game.snapshot_json()
    assert json.loads(twin.snapshot_json())["world"]["goals"]["ending"]["reveal"]


@pytest.mark.parametrize("hash_seed", ["0", "7"])
def test_the_run_does_not_depend_on_the_string_hash_seed(hash_seed):
    code = (
        "import json, goals_helpers as g\n"
        "h = g.hand(3)\n"
        "h.run_to(100)\n"
        "h.send(g.rally(), *[g.dev('join', npc=p) for p in g.crew_of_five()])\n"
        "h.send(g.dev('material', npc='li_da'), g.dev('material', npc='zhou_zhanggui'))\n"
        "h.run_to(2 * 2070 + 1000)\n"
        "print(h.game.hash())\n"
    )
    env = dict(os.environ, PYTHONHASHSEED=hash_seed)
    env["PYTHONPATH"] = os.pathsep.join([str(TESTS / "cross_host"), str(TESTS / "core")])
    done = subprocess.run(
        [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
    )
    h = hand(3)
    h.run_to(100)
    h.send(rally(), *[dev("join", npc=p) for p in crew_of_five()])
    h.send(dev("material", npc="li_da"), dev("material", npc="zhou_zhanggui"))
    h.run_to(2 * 2070 + 1000)
    assert done.stdout.strip() == h.game.hash()
    assert canon.digest(h.game._kernel.state) == h.game.hash()
