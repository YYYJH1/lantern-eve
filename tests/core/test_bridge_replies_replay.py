"""A game in which a model answers is a function of the seed and of the inputs, results included:
the same on every run, under any string hash seed, and the same when it is replayed, restored or
forked."""

from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import reply_driver
from bridge_helpers import state_of
from dealings_helpers import trust
from reply_helpers import Room, notice_act, say

from lantern_core import canon
from lantern_core.replay import Recorder, ReplayDivergence, fork, rebuild

TESTS = Path(__file__).resolve().parents[1]
WHO = "cha_laoban"
WORDS = "Please, the bridge needs you."
GOOD = say("好，听说了。", "All right, I heard.", notice_act())


def record(restores: bool = False):
    """The first day of the game of the cross-host test, recorded."""
    driver = reply_driver.Driver(restores=restores)
    recorder = Recorder(driver.game)
    while driver.game.tick < reply_driver.TICKS:
        driver.call(recorder.step)
    return driver, recorder


@pytest.fixture(scope="module")
def session():
    driver, recorder = record()
    return driver, copy.deepcopy(recorder.recording())


def test_the_session_has_results_of_every_kind_in_its_record(session):
    driver, recording = session
    results = [body for _, _, kind, body in recording["records"] if kind == "model_result"]
    assert {body["status"] for body in results} == {"ok", "timeout", "error"}
    assert any("score" in body["text"] for body in results)
    assert any(body["text"].startswith('{"acts"') for body in results)
    assert len(results) > 15 and recording["hashes"]
    assert driver.game.in_flight() == []


def test_replaying_the_record_gives_the_game_it_was_hash_for_hash(session):
    driver, recording = session
    game = rebuild(recording)  # checks every recorded hash on the way
    assert game.hash() == driver.game.hash()
    assert game.snapshot_json() == driver.game.snapshot_json()


def test_replaying_from_a_snapshot_with_requests_in_flight_gives_the_same_game(session):
    driver, recording = session
    # a snapshot of the record at a moment when something is out
    flying = []
    for tick, text in recording["snapshots"]:
        if json.loads(text)["requests"]:
            flying.append(tick)
    assert flying, "the session has no snapshot with a request in flight"
    game = rebuild(recording, seek=True)
    assert game.hash() == driver.game.hash()
    midway = rebuild(recording, until=flying[0], seek=True)
    assert midway.tick == flying[0] and midway.in_flight()


def test_the_results_are_part_of_the_record_so_an_altered_one_shows_up_as_a_divergence(session):
    _, recording = session
    altered = copy.deepcopy(recording)
    for row in altered["records"]:
        if row[2] == "model_result" and row[3]["status"] == "ok":
            row[3]["text"] = "{"
    with pytest.raises(ReplayDivergence):
        rebuild(altered)


def test_the_same_session_twice_is_the_same_game():
    first = reply_driver.run()
    second = reply_driver.run()
    assert first["hashes"] == second["hashes"]
    assert (
        first["outputs_digest"] == second["outputs_digest"]
        and first["summary"] == second["summary"]
    )


def run_in_another_interpreter(hash_seed: str) -> dict:
    env = dict(os.environ, PYTHONHASHSEED=hash_seed)
    env["PYTHONPATH"] = os.pathsep.join([str(TESTS / "cross_host"), str(TESTS / "core")])
    code = (
        "import json, reply_driver\n"
        "run = reply_driver.run()\n"
        "print(json.dumps({'hashes': run['hashes'][-50:], 'digest': run['outputs_digest']}))\n"
    )
    done = subprocess.run(
        [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
    )
    return json.loads(done.stdout)


@pytest.mark.parametrize("hash_seed", ["0", "1", "31337"])
def test_the_session_does_not_depend_on_the_string_hash_seed(hash_seed):
    ours = reply_driver.run()
    theirs = run_in_another_interpreter(hash_seed)
    assert theirs == {"hashes": ours["hashes"][-50:], "digest": ours["outputs_digest"]}


def test_a_game_restored_in_the_middle_of_the_session_goes_on_the_same():
    with_restore = reply_driver.run(restores=True)
    without = reply_driver.run(restores=False)
    assert with_restore["hashes"] == without["hashes"]
    assert with_restore["summary"]["restored_talking"] == 1


def test_a_snapshot_is_plain_canonical_data_with_requests_in_flight():
    room = Room(WHO)
    trust(room.game, WHO, 18)
    room.act("ask", topic="t_rail")
    room.act("entrust", kind="join", words=WORDS)
    text = room.game.snapshot_json()
    assert canon.dumps_str(canon.loads(text)) == text
    state = json.loads(text)
    assert sorted(r["interaction_id"].split(":")[0] for r in state["requests"]) == ["ask", "judge"]
    assert sorted(state["world"]["speech"]["pending"]) == [
        r["interaction_id"] for r in state["requests"]
    ]


# ------------------------------------------------------------------------------ forking


def test_a_fork_cancels_what_was_out_and_the_branch_goes_on_by_the_rules():
    room = Room(WHO)
    trust(room.game, WHO, 24)
    room.act("ask", topic="t_rail")
    room.act("entrust", kind="join", words=WORDS)
    assert len(room.flying) == 2
    branch, cancels = fork(room.game.snapshot_json())
    assert len(cancels) == 2 and {c["body"]["status"] for c in cancels} == {"cancelled"}
    out = json.loads(branch.step(json.dumps(cancels)))
    events = [e for e in out["events"] if e["kind"] in ("entrusted", "action_ack", "answered")]
    (decided,) = [e for e in events if e["kind"] == "entrusted"]
    assert decided["result"] == "agreed" and "wording" not in decided  # with nothing added
    assert [e["result"] for e in events if e["kind"] == "action_ack"] == ["applied"]
    pending = state_of(branch)["speech"]["pending"]
    assert [row["verb"] for row in pending.values()] == ["entrust"]  # the verdict is asked anew
    assert len(branch.in_flight()) == 1 and out["frame"]["player"]["thinking"] == WHO
    # and the old branch is as it was
    assert len(room.flying) == 2
