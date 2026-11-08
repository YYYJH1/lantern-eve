"""The record a server host writes is the record the other checks read, tick for tick.

Three readers look at the same file or the same tape: ``lantern_core.replay.rebuild`` under
CPython, ``web/test/support/replay_check.py``, which the browser tests use, and
``web/src/shared/replay.ts``, the code the browser itself loads saves with, here over the core in
Pyodide 314 (Python 3.14). All of them must reach the hashes the server host recorded.
"""

from __future__ import annotations

import asyncio
import copy
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from host_helpers import SUMMON, Client, drive_to_tick, make_session, serving

from lantern_core.api import Game
from lantern_core.replay import ReplayDivergence, rebuild
from lantern_eve import __version__

ROOT = Path(__file__).resolve().parents[2]
CHECK = ROOT / "web" / "test" / "support" / "replay_check.py"
BROWSER_CHECKER = Path(__file__).with_name("browser_checker.mjs")
PYODIDE = ROOT / "tests" / "cross_host" / "node_modules" / "pyodide" / "pyodide.mjs"
TICKS = 2000

# The script of the cross-host test (tests/cross_host/m0_driver.py), played through the session:
# player actions, a resend, an action into the river, and two pauses with the host calling on.
ACTIONS = {
    300: [("a-300", "npc03", 31, 10)],
    301: [("a-300", "npc03", 31, 10)],
    900: [("a-900", "npc05", 12, 20)],
    1500: [("a-1500", "npc01", 22, 5)],
    1800: [("a-1800", "npc08", 40, 28)],
}
PAUSES = {700: 6, 1200: 3}


def play_script(session, clock) -> None:
    sent, paused = set(), set()
    while session.next_tick < TICKS:
        tick = session.next_tick
        if tick not in sent:
            sent.add(tick)
            for action_id, npc, x, y in ACTIONS.get(tick, ()):
                body = {"action_id": action_id, "type": "summon", "npc": npc, "x": x, "y": y}
                session.player(body)
        if tick in PAUSES and tick not in paused:
            paused.add(tick)
            session.pause("user")
            for _ in range(PAUSES[tick]):
                clock.advance_ms(100)
                session.pump()  # the host calls on while the world is held: nothing moves
            session.resume("user")
        if tick == 1000 and 1000 not in paused:
            paused.add(1000)
            session.pause("hidden")  # a tab sent to the background for a second
            clock.advance_ms(1000)
            session.pump()
            session.resume("hidden")
        clock.advance_ms(100)
        session.pump()


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    """One scripted game of 2,000 ticks: its session, and the replay file it wrote."""
    root = tmp_path_factory.mktemp("replay")
    session, clock, _ = make_session(2026, runs_dir=root)
    play_script(session, clock)
    path = session.write_replay()
    assert path is not None
    return session, path


def seen_hashes(replay) -> dict[int, str]:
    seen: dict[int, str] = {}

    def on_step(game, tick, outputs_json):
        if game.last_hash is not None:
            seen[tick] = game.last_hash

    rebuild(replay, on_step=on_step)
    return seen


def test_the_script_covers_every_kind_of_input(run):
    session, path = run
    replay = json.loads(path.read_text(encoding="utf-8"))
    kinds = [r[2] for r in replay["records"]]
    assert {"player", "pause", "resume", "model_result"} <= set(kinds)
    statuses = {r[3]["status"] for r in replay["records"] if r[2] == "model_result"}
    assert statuses == {"ok", "timeout", "cancelled", "error"}
    results = [r for r in replay["records"] if r[2] == "player"]
    assert [r[3]["action_id"] for r in results] == ["a-300", "a-300", "a-900", "a-1500", "a-1800"]
    # Pauses held calls at one tick: several inputs share a tick.
    assert [(r[0], r[2]) for r in replay["records"] if r[2] in ("pause", "resume")][:2] == [
        (700, "pause"),
        (700, "resume"),
    ]
    assert replay["end_tick"] == TICKS == session.next_tick


def test_the_server_replay_rebuilds_with_the_core_to_the_hashes_it_recorded(run):
    session, path = run
    replay = json.loads(path.read_text(encoding="utf-8"))
    assert [t for t, _ in replay["hashes"]] == list(range(0, TICKS, 100))
    game = rebuild(replay)  # raises ReplayDivergence at the first hash that differs
    assert game.tick == TICKS and game.hash() == replay["final"]["hash"] == session.game.hash()
    # Every recorded hash was produced by the replay, none was skipped.
    assert seen_hashes(replay) == {t: h for t, h in replay["hashes"]}
    # And from the snapshots the server kept, the same game.
    assert replay["snapshots"] and rebuild(replay, seek=True).hash() == game.hash()
    assert rebuild(replay, until=1234, seek=True).tick == 1234


def test_an_altered_input_is_caught_at_the_next_hash(run):
    _, path = run
    replay = json.loads(path.read_text(encoding="utf-8"))
    altered = copy.deepcopy(replay)
    record = next(
        r for r in altered["records"] if r[2] == "player" and r[3]["action_id"] == "a-900"
    )
    record[3]["x"] += 1
    with pytest.raises(ReplayDivergence):
        rebuild(altered)


def test_the_replay_checker_of_the_browser_tests_reaches_the_same_final_hash(run, tmp_path):
    session, path = run
    done = subprocess.run(
        [sys.executable, str(CHECK), str(path)],
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    report = json.loads(done.stdout.strip().splitlines()[-1])
    replay = json.loads(path.read_text(encoding="utf-8"))
    assert (
        report["ok"] is True and report["mismatches"] == [] and report["checkpoints_missing"] == []
    )
    assert report["final_tick"] == TICKS
    assert report["final_hash"] == report["expected_final_hash"] == session.game.hash()
    assert report["checkpoints_checked"] == len(replay["hashes"])
    assert report["records"] == len(replay["records"])


def test_the_same_tape_stepped_by_the_server_host_and_by_the_checker_gives_one_final_hash(
    run, tmp_path
):
    # The tape is what the server host applied. Hand it to the checker as nothing but a tape: the
    # header and the inputs, with no recorded hash and no final hash to compare with.
    session, path = run
    replay = json.loads(path.read_text(encoding="utf-8"))
    tape = {
        "header": replay["header"],
        "base": None,
        "records": replay["records"],
        "hashes": [],
        "snapshots": [],
        "end_tick": replay["end_tick"],
    }
    bare = tmp_path / "tape.json"
    bare.write_text(json.dumps(tape), encoding="utf-8")
    done = subprocess.run(
        [sys.executable, str(CHECK), str(bare)],
        capture_output=True,
        text=True,
        timeout=300,
    )
    report = json.loads(done.stdout.strip().splitlines()[-1])
    assert report["ok"] is True and report["checkpoints_checked"] == 0
    assert report["final_hash"] == session.game.hash()

    # And the other way round: the tape stepped call by call on a fresh game, the way the browser
    # host's loop would, one call per tick.
    game = Game(replay["header"]["seed"], replay["header"]["scenario"], replay["header"]["config"])
    by_tick: dict[int, list[dict]] = {}
    for tick, seq, kind, body in replay["records"]:
        by_tick.setdefault(tick, []).append({"seq": seq, "kind": kind, "body": body})
    while game.tick < TICKS:
        game.step(json.dumps(by_tick.get(game.tick, [])))
    assert game.hash() == session.game.hash()


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on the PATH")
@pytest.mark.skipif(
    not PYODIDE.exists(), reason="Pyodide is not installed: npm ci in tests/cross_host"
)
def test_the_browsers_own_replay_checker_over_pyodide_reaches_the_same_hashes(run):
    session, path = run
    done = subprocess.run(
        [
            "node",
            "--experimental-transform-types",
            "--no-warnings",
            str(BROWSER_CHECKER),
            str(path),
        ],
        capture_output=True,
        text=True,
        timeout=600,
        cwd=ROOT,
    )
    assert done.returncode == 0, done.stdout + done.stderr
    report = json.loads(done.stdout.strip().splitlines()[-1])
    replay = json.loads(path.read_text(encoding="utf-8"))
    assert report["python"].startswith("3.14"), report["python"]
    assert report["ok"] is True, report
    assert report["nextTick"] == TICKS
    assert report["hash"] == report["finalHash"] == session.game.hash()
    assert report["hashesChecked"] == report["hashesRecorded"] == len(replay["hashes"])
    assert report["host"] == {"name": "server", "version": __version__, "replayFormat": 1}


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on the PATH")
@pytest.mark.skipif(
    not PYODIDE.exists(), reason="Pyodide is not installed: npm ci in tests/cross_host"
)
def test_the_browsers_checker_refuses_a_server_replay_that_was_altered(run, tmp_path):
    _, path = run
    replay = json.loads(path.read_text(encoding="utf-8"))
    record = next(r for r in replay["records"] if r[2] == "player" and r[3]["action_id"] == "a-900")
    record[3]["y"] -= 1
    altered = tmp_path / "altered.json"
    altered.write_text(json.dumps(replay), encoding="utf-8")
    done = subprocess.run(
        [
            "node",
            "--experimental-transform-types",
            "--no-warnings",
            str(BROWSER_CHECKER),
            str(altered),
        ],
        capture_output=True,
        text=True,
        timeout=600,
        cwd=ROOT,
    )
    report = json.loads(done.stdout.strip().splitlines()[-1])
    assert done.returncode == 1 and report["ok"] is False and report["code"] == "hash_mismatch"


def test_a_session_played_over_the_socket_leaves_a_replay_that_rebuilds(tmp_path):
    async def main():
        async with serving(tmp_path, pace=50) as host:
            client = await Client.connect(host)
            await client.hello(seed=31)
            welcome = await client.recv()
            await client.until("frame", tick=150)
            await client.send({"type": "player", "body": {**SUMMON, "action_id": "w-1"}})
            await client.until("ack", action_id="w-1")
            await client.send({"type": "pause", "reason": "user"})
            await client.until("frame", clock={"paused": True, "rate": [1, 1]})
            await client.send({"type": "player", "body": {**SUMMON, "action_id": "w-1"}})
            await client.until("ack", action_id="w-1", result="duplicate")
            await client.send(
                {"type": "player", "body": {**SUMMON, "action_id": "w-2", "npc": "npc07"}}
            )
            await client.until("ack", action_id="w-2")
            await client.send({"type": "resume", "reason": "user"})
            await client.until("frame", tick=650)
            await client.drop()
            session = host.sessions[welcome["session"]]
            while session.sink is not None:
                await asyncio.sleep(0.01)
            return welcome["session"]

    sid = asyncio.run(main())
    (path,) = (tmp_path / "runs").glob(f"*-{sid}.json")
    replay = json.loads(path.read_text(encoding="utf-8"))
    kinds = [r[2] for r in replay["records"] if r[2] != "model_result"]
    assert kinds == ["player", "pause", "player", "player", "resume", "pause"]  # the last: offline
    game = rebuild(replay)
    assert game.hash() == replay["final"]["hash"] and game.tick == replay["end_tick"] >= 650
    done = subprocess.run(
        [sys.executable, str(CHECK), str(path)],
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert json.loads(done.stdout.strip().splitlines()[-1])["ok"] is True, done.stdout


def test_the_server_session_and_a_second_session_on_the_same_tape_agree(run):
    # Two sessions given the same inputs at the same ticks end in the same state: nothing in the
    # host leaks into the game (no clock, no object id, no dict order).
    first, _ = run
    other, clock, _ = make_session(2026)
    play_script(other, clock)
    assert other.game.hash() == first.game.hash()
    assert other.recorder.records == first.recorder.records
    drive_to_tick(other, clock, TICKS)
