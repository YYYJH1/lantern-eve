"""The same inputs give the same game: across runs, restores, replays, forks and interpreters."""

import copy
import json
import os
import subprocess
import sys
from pathlib import Path

import m0_driver as driver
import pytest
from core_helpers import live_run
from mock_host import MockModelHost

from lantern_core.api import Game
from lantern_core.kernel import Kernel
from lantern_core.replay import fork, rebuild

TESTS = Path(__file__).resolve().parents[1]


def continue_to(run, tick):
    """Call the driver until the game reaches ``tick``; the hash after every call."""
    hashes = []
    while run.game.tick < tick:
        run.call()
        hashes.append(run.game.hash())
    return hashes


def test_the_same_seed_twice_gives_the_same_hash_after_every_call():
    first, second = driver.run(), driver.run()
    assert first["hashes"] == second["hashes"]
    assert first["outputs_digest"] == second["outputs_digest"]
    assert len(first["hashes"]) > driver.TICKS  # the pauses add calls


def test_another_seed_gives_another_game():
    other = driver.run(seed=driver.SEED + 1)
    assert other["hashes"][0] != driver.run(ticks=1)["hashes"][0]
    assert other["hashes"][-1] != driver.run()["hashes"][-1]


def test_another_host_seed_changes_only_the_answers():
    base = driver.run(ticks=600)
    other = driver.run(ticks=600, host_seed=driver.HOST_SEED + 1)
    assert base["hashes"][:150] == other["hashes"][:150]  # no request has been answered yet
    assert base["hashes"][-1] != other["hashes"][-1]


@pytest.mark.parametrize("at", [1, 99, 150, 700, 703, 1200, 1500, 1999])
def test_a_game_restored_from_a_snapshot_continues_bit_for_bit(at):
    original = driver.Driver()
    original.run_to(at)
    restored = original.clone()  # a game from the snapshot, with a copy of the host's state
    assert restored.game.hash() == original.game.hash()
    assert continue_to(restored, driver.TICKS) == continue_to(original, driver.TICKS)
    assert restored.game.snapshot_json() == original.game.snapshot_json()


def test_a_game_restored_in_the_middle_of_a_pause_continues_bit_for_bit():
    original = driver.Driver()
    original.run_to(700)
    original.call()  # the pause
    original.call()
    assert original.game.paused and original.game.tick == 700
    restored = original.clone()
    assert restored.game.paused
    assert continue_to(restored, 1500) == continue_to(original, 1500)


def flipped(value):
    """The same value with every dict's keys in reverse order. Lists keep theirs."""
    if isinstance(value, dict):
        return {key: flipped(value[key]) for key in reversed(list(value))}
    if isinstance(value, list):
        return [flipped(item) for item in value]
    return value


def test_nothing_depends_on_the_order_of_a_dicts_keys():
    original = driver.Driver()
    original.run_to(900)
    state = json.loads(original.game.snapshot_json())
    assert list(flipped(state["world"]["pairs"])) != list(state["world"]["pairs"])
    assert list(flipped(state)) != list(state)
    restored = original.clone()
    restored.game = Game.__new__(Game)
    restored.game._kernel = Kernel.restore(flipped(state))
    assert restored.game.hash() == original.game.hash()
    assert continue_to(restored, 2200) == continue_to(original, 2200)


def test_replaying_the_input_log_gives_the_state_of_the_live_run_at_every_tick():
    run, recording, live = live_run(driver.TICKS)
    replayed = {}
    rebuild(recording, on_step=lambda game, tick, out: replayed.__setitem__(tick, game.hash()))
    assert sorted(replayed) == list(range(driver.TICKS))
    assert replayed == live
    assert len(recording["records"]) < run.calls


@pytest.mark.parametrize("target", [150, 700, 701, 1212, 1999])
def test_replaying_from_the_nearest_snapshot_gives_the_same_state(target):
    _, recording, live = live_run(driver.TICKS)
    plain = rebuild(recording, until=target)
    seeked = rebuild(recording, until=target, seek=True)
    assert plain.snapshot_json() == seeked.snapshot_json()
    assert plain.hash() == live[target - 1]  # the live state after the last call of tick target-1


def test_a_fork_matches_the_trunk_up_to_the_fork_and_diverges_after():
    trunk = driver.Driver()
    trunk.run_to(1000)
    at_fork = trunk.game.hash()
    same, other = trunk.clone(), trunk.clone()
    assert same.game.hash() == other.game.hash() == at_fork
    action = {"action_id": "fork-1", "type": "summon", "npc": "npc07", "x": 29, "y": 24}
    other.call(extra=[("player", action)])
    other_tail = [other.game.hash()] + continue_to(other, 1800)
    trunk_tail = continue_to(trunk, 1800)
    same_tail = continue_to(same, 1800)
    assert same_tail == trunk_tail  # a fork with no new input is the trunk
    assert len(other_tail) == len(trunk_tail)
    assert other_tail[0] != trunk_tail[0] and other_tail[-1] != trunk_tail[-1]
    assert sum(a != b for a, b in zip(other_tail, trunk_tail, strict=True)) > 700


def test_a_fork_that_cancels_what_was_in_flight_runs_on_without_the_old_answers():
    trunk = driver.Driver()
    trunk.run_to(1000)
    while not trunk.game.in_flight():
        trunk.call()
    old = trunk.game.in_flight()
    branch = trunk.clone()
    branch.host = MockModelHost(99)  # a new branch gets a new host, with none of the old answers
    game, cancels = fork(trunk.game.snapshot_json())
    assert game.hash() == branch.game.hash() and [c["body"]["request_id"] for c in cancels] == old
    cancelled_before = json.loads(branch.game.ledger_json())["cheap"]["cancelled"]
    _, out = branch.call(extra=[("model_result", c["body"]) for c in cancels])
    ledger = json.loads(branch.game.ledger_json())["cheap"]
    assert ledger["cancelled"] == cancelled_before + len(old)
    assert not set(old) & set(branch.game.in_flight())
    mentioned = []
    while branch.game.tick < 1800:
        _, out = branch.call()
        mentioned += [e["request_id"] for e in out["events"] if e["kind"] == "void"]
        mentioned += out["cancels"]
    assert not set(old) & set(mentioned)  # nothing the old branch waited for shows up here


@pytest.mark.parametrize("hash_seed", ["0", "1", "2", "31337"])
def test_the_run_does_not_depend_on_the_string_hash_seed(hash_seed):
    code = "import json, m0_driver as driver; print(json.dumps(driver.run(ticks=1200)['hashes']))"
    env = dict(os.environ, PYTHONHASHSEED=hash_seed)
    env["PYTHONPATH"] = os.pathsep.join([str(TESTS / "cross_host"), str(TESTS / "core")])
    done = subprocess.run(
        [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
    )
    assert json.loads(done.stdout) == driver.run(ticks=1200)["hashes"]


def test_the_scripted_run_exercises_every_outcome_the_tests_rely_on():
    summary = driver.run()["summary"]
    cheap = summary["ledger"]["cheap"]
    for outcome in ("ok", "timeout", "error", "cancelled", "voided"):
        assert cheap[outcome] > 0, outcome
    assert summary["voids"].keys() >= {"cancelled", "unknown_request"}
    assert summary["ledger"]["unattributed"]["results"] > 0
    assert summary["cancels"] > 0 and summary["calls"] > driver.TICKS
    assert summary["events"]["chatter"] > 0 and summary["events"]["action_ack"] == 5
    assert summary["host"]["aborted"] > 0 and summary["host"]["abort_failed"] > 0


def test_a_long_run_keeps_the_books_straight():
    run = driver.Driver()
    run.run_to(6000)
    cheap = json.loads(run.game.ledger_json())["cheap"]
    assert cheap["issued"] == cheap["settled"] + len(run.game.in_flight())
    assert cheap["settled"] == sum(cheap[k] for k in ("ok", "timeout", "cancelled", "error"))
    assert cheap["voided"] <= cheap["settled"]
    snapshot = copy.deepcopy(json.loads(run.game.snapshot_json()))
    assert len(json.dumps(snapshot)) < 40_000  # the state stays small while the game runs on
