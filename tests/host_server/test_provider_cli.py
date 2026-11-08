"""``--provider-config`` and ``--prices`` on ``play`` and ``batch``, and the lockstep that stays."""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import subprocess
import sys
from pathlib import Path

import pytest
from fake_provider import FakeProvider
from host_helpers import DENSE, Client, make_web_dir, read_first_line
from provider_helpers import KEY, config_text

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.replay import rebuild
from lantern_eve import cli
from lantern_eve.batch import run_game
from lantern_eve.transport import MockTransport

REPO = Path(__file__).resolve().parents[2]
EXAMPLE = str(REPO / "configs" / "providers.example.toml")
LINE = re.compile(r"^seed=(\d+) tick=(\d+) hash=([0-9a-f]{64})$")


def lockstep_reference(seed: int, ticks: int, config: dict[str, int] | None) -> str:
    """The state hash of a lockstep game with the mock, played by the plainest loop possible.

    It uses the core and the mock and nothing of the session, so a change to the session that
    changes what a lockstep game does shows here.
    """
    game, mock = Game(seed, "m0", config), MockTransport(seed)
    in_flight: set[str] = set()
    seq = tick = 0
    while tick < ticks:
        inputs = []
        for outcome in mock.poll(tick):
            in_flight.discard(outcome.request_id)
            inputs.append({"seq": seq, "kind": "model_result", "body": outcome.body()})
            seq += 1
        out = json.loads(game.step(canon.dumps_str(inputs)))
        tick = out["tick"] + 1 if out["advanced"] else out["tick"]
        for request in out["requests"]:
            if request["request_id"] not in in_flight:
                in_flight.add(request["request_id"])
                mock.start(request, tick)
        for request_id in out["cancels"]:
            if request_id in in_flight:
                mock.cancel(request_id, tick)
    return game.hash()


def test_lockstep_with_the_mock_is_the_game_it_always_was(capsys):
    for seed in (1, 2, 3):
        for config in (None, DENSE):
            assert run_game(seed, 1200, config=config).hash == lockstep_reference(
                seed, 1200, config
            )
    # And the command, with or without a provider file (m0 takes no prices), prints the same.
    argv = ["batch", "--seeds", "1-3", "--ticks", "700"]
    cli.main(argv)
    plain = capsys.readouterr().out
    cli.main([*argv, "--provider-config", EXAMPLE])
    assert capsys.readouterr().out == plain
    assert [LINE.match(line) is not None for line in plain.splitlines()] == [True] * 3


def write_prices(path: Path, cheap_in: float = 0.5, cheap_out: float = 5) -> Path:
    path.write_text(
        "prices:\n"
        "  qwen-flash:\n"
        f"    input_per_mtok: {cheap_in}\n"
        f"    output_per_mtok: {cheap_out}\n"
        "    currency: CNY\n",
        encoding="utf-8",
    )
    return path


def replay_header(tmp_path: Path) -> dict:
    (path,) = tmp_path.glob("*.json")
    return json.loads(path.read_text(encoding="utf-8"))["header"]["config"]


def test_a_bridge_game_gets_the_prices_and_the_cap_of_the_file_in_its_header(tmp_path, capsys):
    cli.main(["batch", "--seeds", "1", "--ticks", "200", "--scenario", "bridge"])
    plain = capsys.readouterr().out
    cli.main(
        [
            "batch",
            "--seeds",
            "1",
            "--ticks",
            "200",
            "--scenario",
            "bridge",
            "--provider-config",
            EXAMPLE,
            "--runs-dir",
            str(tmp_path / "a"),
        ]
    )
    # The rows of the example are the prices the core starts with, so the game is the same game.
    assert capsys.readouterr().out == plain
    header = replay_header(tmp_path / "a")
    assert (header["price_cheap_in"], header["price_strong_out"]) == (150_000, 8_000_000)
    assert header["budget_cap"] == 3_000_000

    prices = write_prices(tmp_path / "prices.yaml")
    base = [
        "batch",
        "--seeds",
        "1",
        "--ticks",
        "200",
        "--scenario",
        "bridge",
        "--provider-config",
        EXAMPLE,
    ]
    cli.main([*base, "--prices", str(prices), "--runs-dir", str(tmp_path / "b")])
    priced = capsys.readouterr().out
    header = replay_header(tmp_path / "b")
    assert (header["price_cheap_in"], header["price_cheap_out"]) == (500_000, 5_000_000)
    assert header["price_strong_in"] == 800_000  # no row for it in the list: the file's price
    assert priced != plain  # the prices are part of the game

    # What --config sets wins over the file and the list.
    cli.main(
        [
            *base,
            "--prices",
            str(prices),
            "--config",
            "price_cheap_in=1",
            "--runs-dir",
            str(tmp_path / "c"),
        ]
    )
    capsys.readouterr()
    assert replay_header(tmp_path / "c")["price_cheap_in"] == 1
    # The replay of such a game rebuilds, prices and all.
    (path,) = (tmp_path / "c").glob("*.json")
    assert rebuild(json.loads(path.read_text(encoding="utf-8"))).paused is False


@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["--prices", "p.yaml"], "--prices needs --provider-config"),
        (["--provider-config", "missing.toml"], "cannot read missing.toml"),
        (["--provider-config", "bad.toml"], "bad.toml: queue: unknown key 'bogus'"),
        (["--provider-config", EXAMPLE, "--prices", "missing.yaml"], "cannot read missing.yaml"),
        (["--provider-config", EXAMPLE, "--prices", "huge.yaml"], "price_cheap_in"),
    ],
)
def test_batch_refuses_a_provider_file_or_a_price_list_it_cannot_use(
    argv, message, tmp_path, monkeypatch, capsys
):
    monkeypatch.chdir(tmp_path)
    (tmp_path / "bad.toml").write_text(
        Path(EXAMPLE).read_text(encoding="utf-8").replace("[queue]\n", "[queue]\nbogus = 1\n"),
        encoding="utf-8",
    )
    write_prices(tmp_path / "p.yaml")
    write_prices(tmp_path / "huge.yaml", cheap_in=5000)
    with pytest.raises(SystemExit) as caught:
        cli.main(["batch", "--seeds", "1", "--ticks", "10", "--scenario", "bridge", *argv])
    assert message in str(caught.value)
    assert capsys.readouterr().out == ""


def test_play_refuses_the_real_transport_without_a_provider_file(capsys):
    with pytest.raises(SystemExit) as caught:
        cli.main(["play", "--transport", "openai"])
    assert "--transport openai needs --provider-config" in str(caught.value)
    with pytest.raises(SystemExit) as caught:
        cli.main(["play", "--provider-config", "nowhere.toml"])
    assert "cannot read nowhere.toml" in str(caught.value)


def test_play_serves_with_the_real_transport_and_a_provider_file_and_the_key_stays_secret(tmp_path):
    async def main():
        cloud = await FakeProvider(models=("cheap-model", "strong-model")).start()
        local = await FakeProvider(models=("local-model",)).start()
        web = make_web_dir(tmp_path / "web")
        provider_file = tmp_path / "providers.toml"
        provider_file.write_text(config_text(cloud, local=local), encoding="utf-8")
        runs = tmp_path / "runs"
        loop = asyncio.get_running_loop()
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
                "--provider-config",
                str(provider_file),
                "--pace",
                "20",
                "--config",
                "chatter_per_mille=900",
                "--config",
                "encounter_cooldown=200",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env={**os.environ, "CLOUD_KEY": KEY},
        )
        line = ""
        try:
            line = await loop.run_in_executor(None, read_first_line, proc)
            match = re.search(r"http://127\.0\.0\.1:(\d+)/\?host=ws$", line)
            assert match, line
            client = await Client.connect_port(int(match.group(1)))
            await client.hello(seed=31)
            welcome = await client.recv()
            assert welcome["type"] == "welcome" and welcome["transport"] == "openai"
            seen_ok = None
            while seen_ok is None:
                message = await client.until("stats", timeout=30)
                if message["stats"]["models"]["ok"] >= 2:
                    seen_ok = message
            await client.close()
            session = welcome["session"]
        finally:
            proc.send_signal(signal.SIGTERM)
            try:
                await loop.run_in_executor(None, lambda: proc.wait(timeout=30))
            except subprocess.TimeoutExpired:  # pragma: no cover
                proc.kill()
                proc.wait()
                pytest.fail("the server did not stop on SIGTERM")
            # communicate() would lose what the first read of the line already buffered.
            out = line + "\n" + proc.stdout.read()
            err = proc.stderr.read()
            await cloud.stop()
            await local.stop()
        return session, out, err, cloud, local

    session, out, err, cloud, local = asyncio.run(main())
    assert "cheap: cheap-model on cloud" in out and "local: local-model on home" in out
    (path,) = (tmp_path / "runs").glob(f"*-seed31-{session}.json")
    text = path.read_text(encoding="utf-8")
    replay = json.loads(text)
    kinds = [r[2] for r in replay["records"]]
    hosts = [r[3]["event"] for r in replay["records"] if r[2] == "host"]
    assert kinds.count("model_result") >= 2 and hosts == ["local_up"]
    assert rebuild(replay).hash() == replay["final"]["hash"]
    assert cloud.seen and cloud.seen[0].headers["authorization"] == f"Bearer {KEY}"
    assert local.seen == []
    for stream in (text, out, err):
        assert KEY not in stream
