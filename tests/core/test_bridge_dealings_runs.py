"""The same inputs give the same game when the manager tells, asks, promises and speaks: across
runs, replays, restores and interpreters."""

import json
import os
import subprocess
import sys
from pathlib import Path

import persuade_driver as driver
import pytest
from bridge_helpers import step
from dealings_helpers import act, events, me, talking, tell, trust
from player_helpers import flipped, plain

from lantern_core.api import Game
from lantern_core.kernel import Kernel
from lantern_core.replay import Recorder, rebuild

TESTS = Path(__file__).resolve().parents[1]
LIE = {"how": "fabricate", "pred": "damaged", "subject": "zhou_dalang", "object": "t_rail"}
UNTIL = 3000  # the second morning: the rumour cleared, the bamboo lent and on its way
FOURTH_NIGHT = 7860  # the watchman has spoken and the manager has passed on what he said


def played(until=UNTIL, restores=False, step_with=None):
    run = driver.Driver(restores=restores)
    while run.game.tick < until:
        run.call(step=None if step_with is None else step_with(run))
    return run


def test_the_same_play_twice_gives_the_same_hash_after_every_call():
    first, second = driver.run(ticks=UNTIL), driver.run(ticks=UNTIL)
    assert (
        first["hashes"] == second["hashes"] and first["outputs_digest"] == second["outputs_digest"]
    )
    assert len(first["hashes"]) > UNTIL  # the pause adds calls
    assert first["summary"]["final"] == second["summary"]["final"]


def test_another_seed_is_another_game_whatever_the_manager_does():
    other = driver.run(seed=driver.SEED + 1, ticks=600)
    assert other["hashes"][-1] != driver.run(ticks=600)["hashes"][-1]


def test_the_state_after_the_dealings_is_plain_data_that_a_snapshot_carries_whole():
    run = played(FOURTH_NIGHT)
    state = run.game._kernel.state
    plain(state)
    section = state["world"]["player"]
    assert section["pledges"] and section["deeds"] and section["won"]
    assert section["public"]["speeches"] and len(section["told"]) == 1  # what the watchman said
    assert json.loads(run.game.snapshot_json()) == state
    assert Game.from_snapshot_json(run.game.snapshot_json()).hash() == run.game.hash()


def test_replaying_the_input_log_gives_the_state_of_the_live_run_at_every_tick():
    run = driver.Driver(restores=False)
    recorder = Recorder(run.game)
    live = {}
    while run.game.tick < FOURTH_NIGHT:
        tick = run.game.tick
        run.call(step=recorder.step)
        live[tick] = run.game.hash()
    recording = recorder.recording()
    replayed = {}
    rebuild(recording, on_step=lambda game, tick, out: replayed.__setitem__(tick, game.hash()))
    # the last hash of a tick is the one after its last call (the pause calls share a tick)
    assert replayed == live
    final = rebuild(recording)
    assert final.snapshot_json() == run.game.snapshot_json()
    kinds = {body["type"] for _, _, kind, body in recording["records"] if kind == "player"}
    assert {"entrust", "promise", "speak", "rally", "tell"} <= kinds


@pytest.mark.parametrize("moment", ["talk", "speak", "after"])
def test_a_game_restored_from_a_snapshot_goes_on_exactly_as_the_original_did(moment):
    run = driver.Driver(restores=False)
    while True:
        run.call()
        frame = run.last["frame"]
        if moment == "talk" and frame["player"]["talk"] and run.game.tick > 1560:
            break
        if moment == "speak" and "speak" in frame["hud"]["verbs"]:
            break
        if moment == "after" and "hall-meal" in run.script.results:
            break
    twin = Game.from_snapshot_json(run.game.snapshot_json())
    assert twin.hash() == run.game.hash()
    for _ in range(500):
        run.call()
        assert json.loads(twin.step(run.last_text)) == run.last
    assert twin.snapshot_json() == run.game.snapshot_json()


def lie_then_ask():
    """A game where a yes is waiting on a lie: a pending request, a lie in the ledger, a promise."""
    game = talking("cha_laoban", seed=3)
    trust(game, "cha_laoban", 80)
    assert events(tell(game, **LIE), "told")[0]["outcome"] == "took"
    act(game, "promise", what="stall", item="back", due=2)
    act(game, "entrust", kind="join")
    assert me(game)["pending"] and me(game)["lies"] and me(game)["pledges"]
    act(game, "leave")  # the world stands still in a conversation: the yes falls due outside it
    return game


def test_a_game_restored_with_a_yes_waiting_on_a_lie_acts_on_it_at_the_same_moment():
    game = lie_then_ask()
    twin = Game.from_snapshot_json(game.snapshot_json())
    done = []
    for _ in range(300):
        a, b = step(game), json.loads(twin.step())
        assert a == b
        done += events(a, "entrust_done")
    assert [e["npc"] for e in done] == ["cha_laoban"] and twin.hash() == game.hash()


def test_a_snapshot_with_its_keys_in_another_order_is_the_same_game():
    run = played(UNTIL - 600)
    state = json.loads(run.game.snapshot_json())
    section = state["world"]["player"]
    assert list(flipped(section["deeds"])) != list(section["deeds"])
    twin = Game.__new__(Game)
    twin._kernel = Kernel.restore(flipped(state))
    assert twin.hash() == run.game.hash()
    for _ in range(300):
        run.call()
        assert json.loads(twin.step(run.last_text)) == run.last
    assert twin.hash() == run.game.hash()


@pytest.mark.parametrize("hash_seed", ["0", "7"])
def test_the_play_does_not_depend_on_the_string_hash_seed(hash_seed):
    code = "import json, persuade_driver as d\nprint(json.dumps(d.run(ticks=2200)['hashes'][-1]))\n"
    env = dict(os.environ, PYTHONHASHSEED=hash_seed)
    env["PYTHONPATH"] = os.pathsep.join([str(TESTS / "cross_host"), str(TESTS / "core")])
    done = subprocess.run(
        [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
    )
    assert json.loads(done.stdout) == driver.run(ticks=2200)["hashes"][-1]
