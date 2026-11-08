"""Recording, rebuilding, seeking and forking."""

import copy
import json

import pytest
from core_helpers import call, live_run, rec

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.replay import Recorder, ReplayDivergence, ReplayError, fork, rebuild

TICKS = 2000


@pytest.fixture(scope="module")
def recorded():
    return live_run(TICKS)


def test_the_header_matches_the_game(recorded):
    run, recording, _ = recorded
    assert recording["header"] == run.game.header()
    assert recording["base"] is None and recording["end_tick"] == TICKS


def test_records_are_the_applied_inputs_in_order_with_their_tick(recorded):
    _, recording, _ = recorded
    records = recording["records"]
    assert len(records) > 50
    ticks = [r[0] for r in records]
    seqs = [r[1] for r in records]
    assert ticks == sorted(ticks)
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs)
    assert {r[2] for r in records} == {"pause", "resume", "player", "model_result"}
    assert [r[0] for r in records if r[2] == "pause"] == [700, 1200]
    assert all(isinstance(r[3], dict) for r in records)


def test_hashes_come_every_hundred_ticks_and_snapshots_every_game_hour(recorded):
    _, recording, _ = recorded
    assert [h[0] for h in recording["hashes"]] == list(range(0, TICKS, 100))
    assert [s[0] for s in recording["snapshots"]] == list(range(150, TICKS + 1, 150))
    for tick, text in recording["snapshots"]:
        assert Game.from_snapshot_json(text).tick == tick


def test_the_snapshot_interval_can_be_set():
    game = Game(1)
    recorder = Recorder(game, snapshot_every=40)
    for _ in range(130):
        recorder.step("[]")
    assert [s[0] for s in recorder.recording()["snapshots"]] == [40, 80, 120]
    with pytest.raises(ValueError):
        Recorder(Game(1), snapshot_every=0)


def test_the_recording_is_canonical_and_survives_a_round_trip(recorded):
    _, recording, _ = recorded
    text = canon.dumps_str(recording)
    again = canon.loads(text)
    assert again == json.loads(json.dumps(recording))
    assert rebuild(again, until=300).tick == 300


def test_a_refused_call_is_not_recorded():
    game = Game(2)
    recorder = Recorder(game)
    recorder.step(json.dumps([rec(0, "pause")]))
    with pytest.raises(ValueError):
        recorder.step(json.dumps([rec(0, "resume")]))
    assert [r[2] for r in recorder.recording()["records"]] == ["pause"]


def test_rebuild_makes_one_call_per_tick_and_reaches_the_same_state(recorded):
    run, recording, _ = recorded
    calls = []
    game = rebuild(recording, on_step=lambda g, tick, out: calls.append(tick))
    assert (
        calls == list(range(TICKS)) and run.calls > TICKS
    )  # the host made extra calls while paused
    assert game.snapshot_json() == run.game.snapshot_json()


def test_rebuild_until_stops_before_the_inputs_of_that_tick(recorded):
    _, recording, hashes = recorded
    game = rebuild(recording, until=700)
    assert game.tick == 700 and not game.paused
    assert game.hash() == live_run(700)[0].game.hash()
    after = rebuild(recording, until=701)
    assert after.tick == 701 and not after.paused  # the pause and the resume cancelled out
    assert after.hash() == hashes[700]


def test_seeking_starts_from_the_latest_snapshot_and_gives_the_same_state(recorded):
    _, recording, _ = recorded
    calls = []
    game = rebuild(recording, until=1000, seek=True, on_step=lambda g, t, o: calls.append(t))
    assert calls == list(range(900, 1000))  # the snapshot at 900, then 100 ticks
    assert game.hash() == rebuild(recording, until=1000).hash()
    calls.clear()
    at_snapshot = rebuild(recording, until=900, seek=True, on_step=lambda g, t, o: calls.append(t))
    assert at_snapshot.tick == 900 and calls == []
    assert rebuild(recording, seek=True).hash() == rebuild(recording).hash()


def test_a_changed_input_shows_up_at_the_next_hash(recorded):
    _, recording, _ = recorded
    tampered = copy.deepcopy(recording)
    action = next(r for r in tampered["records"] if r[2] == "player" and r[0] == 300)
    action[3]["x"] = 40
    with pytest.raises(ReplayDivergence, match=r"tick 300"):
        rebuild(tampered)
    skipped = rebuild(tampered, verify=False)
    assert skipped.hash() != rebuild(recording).hash()


def test_a_changed_hash_is_caught(recorded):
    _, recording, _ = recorded
    tampered = copy.deepcopy(recording)
    tampered["hashes"][3][1] = "0" * 64
    with pytest.raises(ReplayDivergence, match="tick 300"):
        rebuild(tampered)


def test_logs_that_cannot_have_happened_are_refused(recorded):
    _, recording, _ = recorded
    wrong_format = copy.deepcopy(recording)
    wrong_format["header"]["format"] = 9
    with pytest.raises(ReplayError, match="format"):
        rebuild(wrong_format)
    stuck = copy.deepcopy(recording)
    stuck["records"] = [r for r in stuck["records"] if not (r[2] == "resume" and r[0] == 700)]
    with pytest.raises(ReplayError):
        rebuild(stuck, verify=False)
    ahead = copy.deepcopy(recording)
    ahead["records"].append([5000, 10**6, "pause", {}])
    with pytest.raises(ReplayError, match="never reached"):
        rebuild(ahead)
    with pytest.raises(ReplayError, match="starts at tick"):
        late = live_run(300)[1]
        base = copy.deepcopy(late)
        base["base"] = {"tick": 200, "snapshot": late["snapshots"][0][1]}
        rebuild(base, until=100)


def test_a_log_may_end_while_the_game_is_paused():
    game = Game(3)
    recorder = Recorder(game)
    for _ in range(50):
        recorder.step("[]")
    recorder.step(json.dumps([rec(0, "pause")]))
    recorder.step(
        json.dumps(
            [rec(1, "player", {"action_id": "a", "type": "summon", "npc": "npc00", "x": 4, "y": 7})]
        )
    )
    recording = recorder.recording()
    rebuilt = rebuild(recording)
    assert rebuilt.paused and rebuilt.tick == 50
    assert rebuilt.snapshot_json() == game.snapshot_json()


def test_a_recorder_on_a_restored_game_keeps_a_base():
    run, _, _ = live_run(600)
    restored = Game.from_snapshot_json(run.game.snapshot_json())
    clone = run.clone()
    recorder = Recorder(clone.game)
    assert recorder.base == {"tick": 600, "snapshot": restored.snapshot_json()}
    clone.run_to(1100, step=recorder.step)
    recording = recorder.recording()
    again = rebuild(recording)
    assert again.snapshot_json() == clone.game.snapshot_json()
    assert rebuild(recording, until=900, seek=True).tick == 900
    with pytest.raises(ReplayError):
        rebuild(recording, until=300)


def test_a_fresh_game_needs_no_base():
    assert Recorder(Game(4)).base is None


def test_a_fork_restores_the_snapshot_and_cancels_what_was_in_flight():
    run, _, _ = live_run(1000)
    while not run.game.in_flight():  # a moment with requests on the wire
        run.call()
    snapshot = run.game.snapshot_json()
    in_flight = run.game.in_flight()
    branch, cancels = fork(snapshot)
    assert branch.snapshot_json() == snapshot
    assert [c["body"]["request_id"] for c in cancels] == in_flight
    first = branch.next_seq
    assert [c["seq"] for c in cancels] == list(range(first, first + len(cancels)))
    before = json.loads(branch.ledger_json())["cheap"]
    out = call(branch, *cancels)
    assert out["advanced"] is True
    assert branch.in_flight() == []
    after = json.loads(branch.ledger_json())["cheap"]
    assert after["cancelled"] == before["cancelled"] + len(in_flight)
    tokens = ("input_tokens", "output_tokens")
    assert [after[k] for k in tokens] == [before[k] for k in tokens]  # known zero usage


def test_a_fork_of_a_game_with_nothing_in_flight_has_nothing_to_cancel():
    game = Game(5)
    branch, cancels = fork(game.snapshot_json())
    assert cancels == [] and branch.hash() == game.hash()
