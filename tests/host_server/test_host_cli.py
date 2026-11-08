"""The ``lantern-eve`` command: batch lines, and play as a process that serves and stops."""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import urllib.request

import pytest
from host_helpers import CSP, Client, make_web_dir, read_first_line

from lantern_core.replay import rebuild
from lantern_eve import cli
from lantern_eve.batch import parse_seeds, run_game
from lantern_eve.session import GameSpec, Session
from lantern_eve.transport import mock_factory

LINE = re.compile(r"^seed=(\d+) tick=(\d+) hash=([0-9a-f]{64})$")


def test_seeds_are_ranges_and_lists():
    assert parse_seeds("1-3") == [1, 2, 3]
    assert parse_seeds("5") == [5]
    assert parse_seeds("7,2-4, 9") == [7, 2, 3, 4, 9]
    for bad in ("", "3-1", "a", "1,,2", "1-3,2", "-2", "1-"):
        with pytest.raises(ValueError):
            parse_seeds(bad)


def test_batch_prints_one_line_per_seed_with_the_final_tick_and_hash(capsys):
    assert cli.main(["batch", "--seeds", "1-3", "--ticks", "400"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 3
    parsed = [LINE.match(line) for line in lines]
    assert all(parsed)
    assert [(m.group(1), m.group(2)) for m in parsed] == [("1", "400"), ("2", "400"), ("3", "400")]
    assert len({m.group(3) for m in parsed}) == 3


def test_batch_is_the_same_every_time_and_is_the_game_a_live_session_plays(capsys, tmp_path):
    cli.main(["batch", "--seeds", "4-5", "--ticks", "700", "--runs-dir", str(tmp_path)])
    first = capsys.readouterr().out
    cli.main(["batch", "--seeds", "4-5", "--ticks", "700"])
    assert capsys.readouterr().out == first

    # The same game, played by a session in lockstep, and rebuilt from the replay batch wrote.
    for line in first.splitlines():
        seed, tick, digest = LINE.match(line).groups()
        session = Session("s", GameSpec(int(seed), "m0", None), mock_factory())
        session.start()
        session.run_lockstep(int(tick))
        assert session.game.hash() == digest
        (path,) = tmp_path.glob(f"*-seed{seed}-batch-{seed}.json")
        replay = json.loads(path.read_text(encoding="utf-8"))
        assert replay["host"]["name"] == "server" and replay["final"]["hash"] == digest
        assert rebuild(replay).hash() == digest


def test_the_mock_seed_and_the_config_change_the_game(capsys):
    def hashes(*extra):
        cli.main(["batch", "--seeds", "1", "--ticks", "900", *extra])
        return capsys.readouterr().out

    base = hashes()
    assert hashes("--host-seed", "99") != base
    assert hashes("--config", "chatter_per_mille=900") != base
    assert hashes("--host-seed", "1") == base  # the mock is seeded from the game's seed
    # The mock's latencies are in the game: the requests show in the count of the result.
    quiet = run_game(1, 900, config={"chatter_per_mille": 0})
    busy = run_game(1, 900, config={"chatter_per_mille": 900})
    assert quiet.requests == 0 < busy.requests


def test_batch_refuses_what_it_cannot_run(capsys):
    for argv in (
        ["batch", "--seeds", "3-1", "--ticks", "10"],
        ["batch", "--seeds", "1", "--ticks", "-5"],
        ["batch", "--seeds", "1", "--ticks", "10", "--scenario", "nowhere"],
        ["batch", "--seeds", "1", "--ticks", "10", "--config", "ticks_per_hour=1"],
    ):
        with pytest.raises(SystemExit) as caught:
            cli.main(argv)
        assert caught.value.code not in (0, None), argv
    with pytest.raises(SystemExit):
        cli.main(["batch", "--seeds", "1", "--ticks", "10", "--config", "oops"])
    assert capsys.readouterr().out == ""


def test_the_module_and_the_command_are_the_same_program():
    module = subprocess.run(
        [sys.executable, "-m", "lantern_eve", "batch", "--seeds", "2", "--ticks", "200"],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert module.returncode == 0, module.stderr
    command = subprocess.run(
        [
            os.path.join(os.path.dirname(sys.executable), "lantern-eve"),
            "batch",
            "--seeds",
            "2",
            "--ticks",
            "200",
        ],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert command.returncode == 0, command.stderr
    assert module.stdout == command.stdout and LINE.match(module.stdout.strip())


def test_play_serves_the_page_and_the_game_and_stops_cleanly_on_sigterm(tmp_path):
    web = make_web_dir(tmp_path / "web")
    runs = tmp_path / "runs"
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "lantern_eve",
            "play",
            "--port",
            "0",
            "--web-dir",
            str(web),
            "--runs-dir",
            str(runs),
            "--pace",
            "20",
            "--config",
            "chatter_per_mille=900",
        ],  # fmt: skip
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        line = read_first_line(proc)
        match = re.search(r"(http://127\.0\.0\.1:(\d+)/)\?host=ws$", line)
        assert match, line
        base, port = match.group(1), int(match.group(2))

        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(base, timeout=10) as page:
            assert page.status == 200 and "stand-in" in page.read().decode()
            assert page.headers["Content-Security-Policy"] == CSP

        async def play():
            client = await Client.connect_port(port)
            await client.hello(seed=21)
            welcome = await client.recv()
            assert welcome["type"] == "welcome" and welcome["seed"] == 21
            frames = await client.frames(50)
            assert [f["seq"] for f in frames] == list(range(1, 51))
            await client.close()
            return welcome["session"]

        session = asyncio.run(play())
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            out, err = proc.communicate(timeout=30)
        except subprocess.TimeoutExpired:  # pragma: no cover
            proc.kill()
            out, err = proc.communicate()
            pytest.fail("the server did not stop on SIGTERM")
    assert proc.returncode == 0, err
    (path,) = runs.glob(f"*-seed21-{session}.json")
    replay = json.loads(path.read_text(encoding="utf-8"))
    assert rebuild(replay).hash() == replay["final"]["hash"]


def test_play_does_not_open_a_browser_unless_asked_and_binds_a_free_port_by_default():
    args = cli.build_parser().parse_args(["play"])
    assert args.open is False and args.port == 0
    assert cli.build_parser().parse_args(["play", "--open", "--port", "8123"]).open is True
    # Nothing is named, so play makes the mock. A provider file would make it the real one.
    assert args.pace == 1 and args.transport is None and args.provider_config is None
