"""The session: the loop, the inputs, pausing, model calls and the record, on a virtual clock."""

from __future__ import annotations

import asyncio
import json

import pytest
from host_helpers import (
    SUMMON,
    VirtualClock,
    drive,
    drive_to_tick,
    frames,
    kinds,
    make_session,
    wake_gaps,
)

from lantern_core import canon
from lantern_core.replay import rebuild
from lantern_eve import __version__
from lantern_eve.clock import NS_PER_MS
from lantern_eve.session import GameSpec, Session
from lantern_eve.transport import MockTransport, mock_factory


def test_ticks_follow_the_clock_and_not_how_often_the_loop_wakes():
    results = {}
    for name, gaps in {
        "every 7 ms": [7] * 1000,
        "every 70 ms": [70] * 100,
        "irregular": wake_gaps(7000, seed=3),
    }.items():
        session, clock, _ = make_session(5)
        drive(session, clock, gaps)
        results[name] = (session.next_tick, session.game.hash())
    assert {tick for tick, _ in results.values()} == {70}
    assert len({digest for _, digest in results.values()}) == 1


def test_real_time_is_the_game_that_lockstep_plays():
    # Model answers are due at ticks, so a session on an irregular clock and a lockstep run are
    # the same game: same hash, same tape, same number of requests and cancels.
    ticks = 1500
    live, clock, _ = make_session(7)
    drive(live, clock, wake_gaps(ticks * 100, seed=11))
    assert live.next_tick == ticks

    lock, _, _ = make_session(7)
    lock.run_lockstep(ticks)
    assert lock.next_tick == ticks
    assert live.game.hash() == lock.game.hash()
    assert live.recorder.records == lock.recorder.records
    assert live.recorder.hashes == lock.recorder.hashes
    assert live.transport.counts == lock.transport.counts
    # The run is not empty: the core asked for models, and the mock answered in all its ways.
    counts = lock.transport.counts
    assert counts["ok"] > 10 and counts["timeout"] > 0 and counts["aborted"] > 0


def test_the_loop_runs_at_the_rate_the_core_reports():
    # The rate is read from the outputs of every call, so a world that speeds up or slows down
    # is followed from the next call on. The outputs are rewritten here, which needs no core help.
    def at_rate(num, den):
        session, clock, out = make_session(5)
        drive_to_tick(session, clock, 10)
        real = session.recorder.step

        def rewritten(text):
            outputs = json.loads(real(text))
            outputs["clock"]["rate"] = [num, den]
            return json.dumps(outputs)

        session.recorder.step = rewritten  # type: ignore[method-assign]
        clock.advance_ms(100)
        session.pump()  # the first call under the new rate
        start = session.next_tick
        drive(session, clock, [10] * 100)  # one second
        return session.next_tick - start, frames(out)[-1]["clock"]["rate"]

    assert at_rate(1, 1) == (10, [1, 1])
    assert at_rate(2, 1) == (20, [2, 1])
    assert at_rate(1, 2) == (5, [1, 2])
    assert at_rate(3, 2) == (15, [3, 2])
    assert at_rate(0, 1) == (0, [0, 1])  # time stopped by the world, not paused by the player


def test_a_burst_is_limited_and_the_rest_is_taken_on_the_next_pass():
    session, clock, _ = make_session(2)
    clock.advance_ms(1500)  # 15 ticks are owed, a pass takes at most 10
    delay = session.pump()
    assert session.next_tick == 10 and delay == 0.0
    session.pump()
    assert session.next_tick == 15


def test_a_stall_loses_game_time_instead_of_building_a_backlog():
    session, clock, _ = make_session(2)
    clock.advance_ms(30_000)
    for _ in range(5):
        session.pump()
    assert session.next_tick == 20  # two seconds of game time, the cap, and no more
    assert session.stats()["droppedMs"] == 28_000


def test_inputs_are_numbered_in_the_order_they_arrive():
    session, clock, _ = make_session(3)
    drive_to_tick(session, clock, 20)
    session.player({**SUMMON, "action_id": "a-1"})
    session.pause("user")
    session.player({**SUMMON, "action_id": "a-2"})
    session.resume("user")
    drive_to_tick(session, clock, 60)
    records = session.recorder.records
    assert [r[1] for r in records] == list(range(len(records)))
    arrived = [r[2] for r in records if r[2] != "model_result"]
    assert arrived == ["player", "pause", "player", "resume"]
    assert [r[3]["action_id"] for r in records if r[2] == "player"] == ["a-1", "a-2"]


def test_a_running_world_applies_an_input_at_the_next_tick_and_a_paused_one_at_once():
    session, clock, _ = make_session(3)
    drive_to_tick(session, clock, 10)
    calls = session.call_count
    session.player({**SUMMON, "action_id": "a-1"})
    assert session.call_count == calls  # waits for its tick
    clock.advance_ms(100)
    session.pump()
    assert session.call_count == calls + 1
    assert session.recorder.records[-1][:3] == [10, session.recorder.records[-1][1], "player"]

    session.pause("user")
    tick = session.next_tick
    calls = session.call_count
    session.player({**SUMMON, "action_id": "a-2"})
    assert session.call_count == calls + 1  # applied at once
    assert session.next_tick == tick  # and the tick did not move
    assert session.recorder.records[-1][0] == tick


def test_a_paused_world_does_not_move_however_long_it_is_held():
    session, clock, out = make_session(4)
    drive_to_tick(session, clock, 30)
    session.pause("user")
    held = session.next_tick
    seen = len(frames(out))
    for _ in range(200):
        clock.advance_ms(100)
        session.pump()
    assert session.next_tick == held and len(frames(out)) == seen
    assert out[-1]["type"] != "frame"
    session.resume("user")
    # The 20 s of the pause are not owed: the first tick is taken at once, the rest on time.
    assert session.next_tick == held + 1
    drive_to_tick(session, clock, held + 11)
    assert session.stats()["droppedMs"] == 0


def test_the_world_runs_only_when_every_reason_to_pause_is_gone():
    session, clock, _ = make_session(4, hidden=True)
    assert session.core_paused and session.reasons == ["hidden"]
    session.pause("user")
    session.resume("hidden")
    assert session.core_paused
    session.resume("user")
    assert not session.core_paused
    drive_to_tick(session, clock, 5)
    # Only a change between running and paused reaches the core.
    assert kinds(session) == [(0, "pause"), (0, "resume")]
    session.pause("user")
    session.pause("hidden")
    session.resume("hidden")
    session.resume("hidden")
    assert kinds(session)[2:] == [(session.next_tick, "pause")]


def test_cancels_reach_the_transport_and_nothing_else_does():
    started, cancelled, wanted = [], [], []

    class Spy(MockTransport):
        def start(self, request, tick):
            started.append(request["request_id"])
            super().start(request, tick)

        def cancel(self, request_id, tick):
            cancelled.append(request_id)
            super().cancel(request_id, tick)

    session, clock, _ = make_session(7, factory=lambda spec: Spy(spec.seed))
    session.on_outputs = lambda out: wanted.extend(out["cancels"])
    drive_to_tick(session, clock, 2500)
    assert wanted and cancelled, "the run should make the core cancel something"
    # Each id the transport was told to cancel is one the core listed and one that went out, and
    # they come in the order the core listed them. The core's other cancels were for calls that
    # had answered already, and the host counts those instead of passing them on.
    positions = [wanted.index(request_id) for request_id in cancelled]
    assert positions == sorted(positions)
    assert set(cancelled) <= set(wanted) & set(started)
    assert len(cancelled) + session.models["cancelUnknown"] <= len(wanted)
    # The transport answered: an honoured cancel with a cancelled result, a late one with its own.
    counts = session.transport.counts
    assert counts["aborted"] + counts["abort_failed"] == len(cancelled)
    results = [r[3] for r in session.recorder.records if r[2] == "model_result"]
    assert sum(r["status"] == "cancelled" for r in results) == counts["aborted"]


def test_every_request_gets_a_result_and_the_late_ones_are_voided():
    issued = []
    session, clock, out = make_session(7)
    session.on_outputs = lambda o: issued.extend(r["request_id"] for r in o["requests"])
    drive_to_tick(session, clock, 3000)
    results = [r[3] for r in session.recorder.records if r[2] == "model_result"]
    assert {r["status"] for r in results} >= {"ok", "timeout", "cancelled", "error"}
    answered = {r["request_id"] for r in results}
    in_flight = set(session.game.in_flight())
    # Whatever the core asked for was answered, or is still on its way.
    assert set(issued) == answered | in_flight
    assert in_flight == session.calls | {r["request_id"] for r in session.pending}
    voids = [e for m in frames(out) for e in m["events"] if e["kind"] == "void"]
    assert {v["reason"] for v in voids} >= {"unknown_request", "cancelled"}
    ledger = json.loads(session.game.ledger_json())
    assert ledger["unattributed"]["results"] > 0


def test_a_refused_action_is_dropped_with_a_word_and_the_session_goes_on():
    session, clock, out = make_session(5)
    drive_to_tick(session, clock, 10)
    session.player({"action_id": "bad-1", "type": "summon", "npc": "nobody", "x": 1, "y": 1})
    session.player({**SUMMON, "action_id": "good-1"})
    clock.advance_ms(100)
    session.pump()
    acks = [m for m in out if m["type"] == "ack"]
    assert {(a["action_id"], a["result"]) for a in acks} == {
        ("bad-1", "refused"),
        ("good-1", "refused"),
    }
    assert "unknown npc" in acks[0]["reason"]
    (notice,) = [m for m in out if m["type"] == "notice"]
    assert notice["code"] == "input_refused" and "2 player inputs" in notice["message"]
    assert session.mode == "running"
    assert not [r for r in session.recorder.records if r[2] == "player"]
    # The next call works, and the actions can be sent again.
    session.player({**SUMMON, "action_id": "good-2"})
    drive_to_tick(session, clock, 15)
    assert [(a["action_id"], a["result"]) for a in out if a["type"] == "ack"][-1] == (
        "good-2",
        "applied",
    )


def test_an_action_that_is_not_json_the_core_can_hold_is_refused_before_it_is_numbered():
    session, clock, out = make_session(5)
    drive_to_tick(session, clock, 5)
    numbered = session.next_seq
    session.player({"action_id": "f-1", "type": "summon", "npc": "npc03", "x": 1.5, "y": 2})
    session.player({"action_id": "f-2", "x": 2**60})
    session.player("summon")  # type: ignore[arg-type]
    assert session.next_seq == numbered
    refusals = [m for m in out if m["type"] == "ack"]
    assert [a["result"] for a in refusals] == ["refused"] * 3
    assert refusals[2]["action_id"] is None


def test_a_resent_action_acts_once_and_is_acknowledged_each_time():
    session, clock, out = make_session(5)
    drive_to_tick(session, clock, 10)
    body = {**SUMMON, "action_id": "a-7"}
    session.player(body)
    drive_to_tick(session, clock, 12)
    session.player(dict(body))  # the same action again, as a client does after a reconnect
    session.player(dict(body))
    drive_to_tick(session, clock, 20)
    acks = [(a["action_id"], a["result"]) for a in out if a["type"] == "ack"]
    assert acks == [("a-7", "applied"), ("a-7", "duplicate"), ("a-7", "duplicate")]
    applied = [e for m in frames(out) for e in m["events"] if e["kind"] == "action_ack"]
    assert [e["result"] for e in applied] == ["applied", "duplicate", "duplicate"]
    npc = session.game._kernel.state["world"]["npcs"][3]
    assert npc["hold"] == 10 + 300  # held once, at the tick of the first one


def test_frames_are_numbered_and_carry_the_core_outputs():
    session, clock, out = make_session(6)
    drive_to_tick(session, clock, 250)
    fs = frames(out)
    assert [f["seq"] for f in fs] == list(range(1, len(fs) + 1))
    assert [f["tick"] for f in fs] == list(range(len(fs)))
    assert all(f["advanced"] for f in fs)
    assert set(fs[1]) == {"type", "seq", "tick", "advanced", "frame", "events", "clock"}
    assert set(fs[0]) == set(fs[1]) | {"hash"}  # tick 0 is a multiple of 100
    assert fs[1]["clock"] == {"paused": False, "rate": [1, 1]}
    assert len(fs[1]["frame"]["npcs"]) == 12
    with_hash = [f for f in fs if "hash" in f]
    assert [f["tick"] for f in with_hash] == [0, 100, 200]
    assert session.seq == len(fs)


def test_the_state_message_is_the_world_as_it_is_now():
    session, clock, out = make_session(6)
    empty = session.state_message()
    assert empty["seq"] == 0 and empty["frame"] is None and empty["tick"] is None
    drive_to_tick(session, clock, 230)
    state = session.state_message()
    last = frames(out)[-1]
    assert state["seq"] == last["seq"] == session.seq
    assert state["frame"] == last["frame"] and state["tick"] == last["tick"]
    assert state["nextTick"] == session.next_tick == 230
    assert (state["hashTick"], state["hash"]) == (200, frames(out)[200]["hash"])
    assert state["scene"]["width"] == 48 and len(state["scene"]["npcs"]) == 12
    assert state["clock"] == {"paused": False, "rate": [1, 1]}
    canon.check(state)
    # Its state hash is the hash of the game as a replay rebuilds it to the same tick.
    rebuilt = rebuild(session.replay(), until=state["nextTick"], seek=True)
    assert state["stateHash"] == rebuilt.hash()


def test_the_state_message_of_a_game_that_is_over_has_the_whole_ending_and_the_frames_a_light_one():
    session, _, out = make_session(3, scenario="bridge", config={"days": 1})
    session.run_lockstep(1700)
    before = session.state_message()
    assert before["ending"] is None and before["frame"]["ending"] is None
    session.run_lockstep(1830)  # the last night comes at tick 1800, and the game goes on quietly
    fs = frames(out)
    (event,) = [e for f in fs for e in f["events"] if e["kind"] == "ending"]
    (made,) = [f for f in fs if any(e["kind"] == "ending" for e in f["events"])]
    assert made["tick"] == event["tick"] == 1800 and made["frame"]["ending"] == event
    light = {key: value for key, value in event.items() if key not in ("reveal", "epilogue")}
    later = [f for f in fs if f["tick"] > made["tick"]]
    assert len(later) == 29 and all(f["frame"]["ending"] == light for f in later)
    # the state has the whole ending, which the frame it holds does not
    state = session.state_message()
    assert state["ending"] == event == session.ending() and state["frame"]["ending"] == light
    canon.check(state)
    # what a client is sent for each frame of a game that is over is much less than it was
    whole = len(json.dumps({**later[-1], "frame": {**later[-1]["frame"], "ending": event}}))
    assert len(json.dumps(later[-1])) < whole - 0.9 * len(json.dumps(event))
    # a new game has none
    session.new_game(4, "bridge")
    assert session.state_message()["ending"] is None and session.ending() is None


def test_a_game_without_endings_has_none_in_its_state():
    session, clock, _ = make_session(6)
    drive_to_tick(session, clock, 30)
    assert session.state_message()["ending"] is None and session.ending() is None


def test_the_state_message_carries_the_events_after_the_last_frame_a_client_saw():
    session, clock, out = make_session(6)
    drive_to_tick(session, clock, 400)
    fs = frames(out)
    mid = fs[150]["seq"]
    expected = [e for f in fs if f["seq"] > mid for e in f["events"]]
    assert expected
    assert session.state_message(since=mid)["events"] == expected
    assert session.state_message(since=None)["events"] == []
    assert session.state_message(since=fs[-1]["seq"])["events"] == []


def test_the_replay_rebuilds_to_the_same_hashes():
    session, clock, _ = make_session(8)
    drive_to_tick(session, clock, 400)
    session.player({**SUMMON, "action_id": "a-1"})
    drive_to_tick(session, clock, 700)
    session.pause("user")
    session.player({**SUMMON, "action_id": "a-2", "x": 12, "y": 20, "npc": "npc05"})
    session.resume("user")
    drive_to_tick(session, clock, 1500)
    replay = session.replay()
    assert set(replay) == {
        "header", "base", "records", "hashes", "snapshots", "end_tick", "host", "final",
    }  # fmt: skip
    assert replay["base"] is None and replay["end_tick"] == session.next_tick
    assert replay["final"] == {"tick": session.next_tick, "hash": session.game.hash()}
    assert replay["hashes"] and replay["snapshots"]

    seen = {}
    game = rebuild(replay, on_step=lambda g, t, o: g.last_hash and seen.__setitem__(t, g.last_hash))
    assert game.tick == session.next_tick and game.hash() == replay["final"]["hash"]
    assert seen == dict((t, h) for t, h in replay["hashes"])
    # A snapshot of the record starts the same game from the middle.
    assert rebuild(replay, seek=True).hash() == game.hash()


def test_the_replay_file_is_canonical_json_in_the_browser_format(tmp_path):
    session, clock, _ = make_session(8, runs_dir=tmp_path / "runs")
    drive_to_tick(session, clock, 350)
    path = session.write_replay()
    assert path is not None and path.parent == tmp_path / "runs"
    assert path.name == "20261102T120000Z-seed8-s-test.json"
    assert [p.name for p in path.parent.iterdir()] == [path.name]  # no partial file is left
    text = path.read_text(encoding="utf-8")
    assert text == canon.dumps_str(canon.loads(text))
    replay = json.loads(text)
    assert replay["host"] == {"name": "server", "version": __version__, "replayFormat": 1}
    assert replay["header"]["seed"] == 8 and replay["header"]["scenario"] == "m0"
    assert all(len(r) == 4 for r in replay["records"])
    # Writing again replaces the file.
    drive_to_tick(session, clock, 360)
    assert session.write_replay() == path
    assert json.loads(path.read_text(encoding="utf-8"))["end_tick"] == 360


def test_a_replay_that_cannot_be_written_does_not_end_the_game(tmp_path, caplog):
    blocker = tmp_path / "a-file"
    blocker.write_text("not a directory", encoding="utf-8")
    session, clock, out = make_session(8, runs_dir=blocker / "runs")
    drive_to_tick(session, clock, 20)
    assert session.write_replay() is None
    assert "could not be written" in caplog.text
    session.pause("user")
    session.detach(lambda message: None)  # not the current sink: nothing happens
    assert session.mode == "running" and not [m for m in out if m["type"] == "fatal"]
    session.stop()  # writes nothing, and does not raise either


def test_a_session_without_a_runs_dir_writes_nothing():
    session, clock, _ = make_session(8)
    drive_to_tick(session, clock, 5)
    assert session.write_replay() is None


def test_with_no_client_the_world_is_held_and_the_replay_saved(tmp_path):
    session, clock, out = make_session(9, runs_dir=tmp_path, sink=None)
    mine: list[dict] = []
    session.attach(mine.append)
    drive_to_tick(session, clock, 40)
    session.detach(mine.append)
    assert session.core_paused and session.reasons == ["offline"]
    assert (tmp_path / "20261102T120000Z-seed9-s-test.json").exists()
    held = session.next_tick
    drive(session, clock, [100] * 50)
    assert session.next_tick == held
    session.attach(mine.append)
    assert not session.core_paused and session.reasons == []
    drive_to_tick(session, clock, held + 10)
    assert [k for _, k in kinds(session)] == ["pause", "resume"]
    # A detach for a sink that is not the current one changes nothing.
    session.detach(lambda message: None)
    assert not session.core_paused


def test_new_game_writes_the_old_replay_and_starts_another(tmp_path):
    session, clock, out = make_session(10, runs_dir=tmp_path)
    drive_to_tick(session, clock, 120)
    first_hash = session.game.hash()
    session.new_game(77)
    assert (tmp_path / "20261102T120000Z-seed10-s-test.json").exists()
    assert out[-2]["type"] == "reset" or any(m["type"] == "reset" for m in out)
    assert session.spec.seed == 77 and session.next_tick == 0 and session.seq == 0
    assert session.game.hash() != first_hash
    drive_to_tick(session, clock, 30)
    assert [f["seq"] for f in frames(out)][-1] == 30
    replay = session.replay()
    assert replay["header"]["seed"] == 77 and replay["end_tick"] == 30
    session.stop()
    assert (tmp_path / "20261102T120000Z-seed77-s-test.json").exists()


def test_a_failing_core_ends_the_session_with_a_fatal_message_and_keeps_the_record(tmp_path):
    session, clock, out = make_session(11, runs_dir=tmp_path)
    drive_to_tick(session, clock, 50)
    real = session.recorder.step

    def broken(text):
        if session.next_tick >= 60:
            raise RuntimeError("the core fell over")
        return real(text)

    session.recorder.step = broken  # type: ignore[method-assign]
    drive_to_tick(session, clock, 60)
    clock.advance_ms(500)
    session.pump()
    assert session.mode == "failed"
    (fatal,) = [m for m in out if m["type"] == "fatal"]
    assert fatal["code"] == "core_error" and "fell over" in fatal["message"]
    assert session.pump() == 0.05 and session.next_tick == 60
    replay = json.loads(next(tmp_path.iterdir()).read_text(encoding="utf-8"))
    assert replay["final"] == {"tick": 60, "hash": ""}
    rebuild(replay)  # what was recorded still replays


def test_the_stats_have_the_shape_the_page_shows():
    session, clock, _ = make_session(6)
    drive_to_tick(session, clock, 300)
    stats = session.stats()
    assert set(stats) == {
        "nextTick", "calls", "pyMeanMs", "pyP95Ms", "pyMaxMs", "hostMeanMs", "hostMaxMs",
        "droppedMs", "inputsLogged", "pending", "paused", "reasons", "rate", "models",
        "lastModel",
    }  # fmt: skip
    assert stats["nextTick"] == 300 and stats["calls"] == 300
    # Each of these is one of the timings of the calls, or their mean, so none passes the slowest. A
    # single slow call can lift the mean above the 95th percentile, so the two are not compared.
    assert 0 < stats["pyMeanMs"] <= stats["pyMaxMs"] and 0 < stats["pyP95Ms"] <= stats["pyMaxMs"]
    assert set(stats["models"]) == {
        "started", "ok", "error", "timeout", "cancelled", "inflight", "discarded", "cancelUnknown",
    }  # fmt: skip
    assert stats["models"]["started"] > 0 and stats["inputsLogged"] == len(session.recorder.records)
    assert stats["lastModel"]["status"] in ("ok", "error", "timeout", "cancelled")


def test_stats_are_posted_twice_a_second_and_on_a_change_of_state():
    session, clock, out = make_session(6)
    posted = lambda: [m for m in out if m["type"] == "stats"]  # noqa: E731
    first = len(posted())
    drive(session, clock, [100] * 20)  # two seconds
    assert 3 <= len(posted()) - first <= 5
    before = len(posted())
    session.pause("user")
    assert len(posted()) == before + 1
    session.resume("user")
    assert len(posted()) == before + 2


def test_a_precheck_refusal_is_booked_without_a_call():
    from lantern_eve.transport import ModelOutcome, Transport

    class Refuses(Transport):
        def precheck(self, request):
            return ModelOutcome(
                request["request_id"],
                "error",
                "no_key",
                {"input_tokens": 0, "output_tokens": 0},
                0,
                code="no_key",
            )

        def start(self, request, tick):  # pragma: no cover
            raise AssertionError("no call may be made")

        def cancel(self, request_id, tick):
            pass

        def poll(self, tick):
            return []

        def discard_all(self):
            pass

    session, clock, out = make_session(7, factory=lambda spec: Refuses())
    drive_to_tick(session, clock, 600)
    results = [r for r in session.recorder.records if r[2] == "model_result"]
    assert results and {r[3]["status"] for r in results} == {"error"}
    assert session.models["started"] >= len(results) and session.models["inflight"] == 0
    assert session.last_model["code"] == "no_key"
    assert not [m for m in out if m["type"] == "fatal"]


def test_pace_multiplies_real_time_and_changes_nothing_else():
    slow, slow_clock, _ = make_session(12)
    fast, fast_clock, _ = make_session(12, pace=10)
    drive_to_tick(slow, slow_clock, 200, wake_ms=100)
    drive(fast, fast_clock, [20] * 100)  # 2 s of real time at ten times the speed
    assert fast.next_tick == 200
    assert fast.game.hash() == slow.game.hash()
    with pytest.raises(ValueError):
        make_session(1, pace=0)


def test_the_clock_is_read_from_the_injected_source_only():
    session, clock, _ = make_session(1)
    assert isinstance(clock, VirtualClock) and clock.ns == 0
    session.pump()
    assert session.next_tick == 0
    clock.ns += 100 * NS_PER_MS
    session.pump()
    assert session.next_tick == 1


def test_the_loop_task_runs_the_session_on_the_real_clock():
    async def main():
        session = Session("s-real", GameSpec(3, "m0", None), mock_factory(), pace=10)
        session.start()
        session.start_loop()
        await asyncio.sleep(0.5)  # ten times the speed: about fifty ticks
        ticks = session.next_tick
        session.stop()
        await asyncio.sleep(0.1)
        return ticks, session.next_tick, session.mode

    ticks, after, mode = asyncio.run(main())
    assert 25 <= ticks <= 51  # a busy machine may run the loop late, never early
    assert after == ticks and mode == "closed"  # a stopped session does not tick on


def test_a_transport_is_closed_when_its_game_ends_and_when_the_session_does():
    closed: list[str] = []

    class Closing(MockTransport):
        def __init__(self, seed):
            super().__init__(seed)
            self.name = f"seed {seed}"

        async def aclose(self):
            closed.append(self.name)

    async def main():
        session = Session("s-close", GameSpec(1, "m0", None), lambda spec: Closing(spec.seed))
        session.start()
        session.new_game(2)
        await asyncio.sleep(0)
        assert closed == ["seed 1"]
        await session.aclose()
        assert closed == ["seed 1", "seed 2"]

    asyncio.run(main())


class Talkative(MockTransport):
    """A mock that has host events and notices to hand over, and counts its ``open`` calls."""

    def __init__(self, seed):
        super().__init__(seed)
        self.opened = 0
        self.events: list[str] = []
        self.said: list[tuple[str, str]] = []

    def open(self):
        self.opened += 1

    def host_events(self, tick):
        out, self.events = self.events, []
        return out

    def notices(self):
        out, self.said = self.said, []
        return out


def test_host_events_are_recorded_as_host_inputs_and_notices_go_to_the_page_only():
    made: list[Talkative] = []

    def factory(spec):
        made.append(Talkative(spec.seed))
        return made[-1]

    session, clock, out = make_session(3, factory=factory)
    (transport,) = made
    assert transport.opened == 1
    drive_to_tick(session, clock, 20)
    transport.events += ["local_up", "cloud_down"]
    transport.said.append(("thinking", "a reply is slow"))
    drive_to_tick(session, clock, 25)
    hosts = [(r[0], r[3]) for r in session.recorder.records if r[2] == "host"]
    assert [body for _, body in hosts] == [{"event": "local_up"}, {"event": "cloud_down"}]
    assert 20 <= hosts[0][0] <= 22
    assert {"type": "notice", "code": "thinking", "message": "a reply is slow"} in out
    assert not [r for r in session.recorder.records if r[2] == "notice"]
    # The recorded events replay: the core takes them (m0 ignores them) and the hash agrees.
    replayed = rebuild(session.replay())
    assert replayed.hash() == session.game.hash()

    # A world held for a pause still takes them in, at the tick it is held at.
    session.pause("user")
    held_at = session.next_tick
    transport.events.append("cloud_up")
    session.pump()
    assert session.recorder.records[-1][2:] == ["host", {"event": "cloud_up"}]
    assert session.recorder.records[-1][0] == held_at

    # Each game gets a transport of its own, opened once.
    session.resume("user")
    session.new_game(4)
    assert len(made) == 2 and made[1].opened == 1 and made[0].opened == 1
