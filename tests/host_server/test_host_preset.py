"""A game of the core by name: ``slice``, the game the opening page starts, asked for in a hello or
a new-game, and set as the default of the server with ``--preset``. The config of a preset has keys
that are texts (``variant``, ``opening`` and ``goods``), which ``--config`` takes too."""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import signal
import subprocess
import sys

import aiohttp
import pytest
from host_helpers import Client, make_web_dir, read_first_line, serving

from lantern_core.api import preset
from lantern_core.replay import rebuild
from lantern_eve import cli
from lantern_eve.session import GameSpec

SLICE = preset("slice")


def run(coro):
    return asyncio.run(coro)


async def started(host, **hello) -> tuple[Client, dict, dict]:
    """A connected client that has said hello, with its welcome and its first state."""
    client = await Client.connect(host)
    await client.hello(**hello)
    welcome = await client.recv()
    state = await client.recv()
    assert (welcome["type"], state["type"]) == ("welcome", "state")
    return client, welcome, state


async def close_code(client: Client) -> int | None:
    """The code of the close message the server sends, after any messages still on the way."""
    while True:
        message = await asyncio.wait_for(client.ws.receive(), 5)
        if message.type == aiohttp.WSMsgType.CLOSE:
            return message.data
        if message.type != aiohttp.WSMsgType.TEXT:
            return None


def test_a_hello_with_a_preset_starts_the_game_of_the_core_by_that_name(tmp_path):
    async def main():
        async with serving(tmp_path, config=None) as host:
            client, welcome, _ = await started(host, preset="slice")
            # The seed and the scenario of the core, whatever the hello says of its own.
            assert (welcome["seed"], welcome["scenario"]) == (492, "bridge")
            session = host.sessions[welcome["session"]]
            assert session.spec == GameSpec(SLICE["seed"], SLICE["scenario"], SLICE["config"])
            config = session.game.header()["config"]
            assert (config["variant"], config["opening"], config["weather_heavy"]) == (
                "v_boat",
                "op_li_er_hearsay",
                0,
            )
            # And it is the slice: the first task of the game is followed from the first frame.
            (first,) = await client.frames(1)
            assert first["frame"]["tracked"] == "t_bamboo_first"
            await client.close()

    run(main())


def test_a_preset_wins_over_the_hello_and_the_config_of_the_server_wins_over_the_preset(tmp_path):
    async def main():
        async with serving(tmp_path, config={"weather_light": 10}) as host:
            client, welcome, _ = await started(host, seed=7, scenario="m0", preset="slice")
            assert (welcome["seed"], welcome["scenario"]) == (492, "bridge")
            spec = host.sessions[welcome["session"]].spec
            assert spec.config == {**SLICE["config"], "weather_light": 10}
            await client.close()

    run(main())


def test_a_preset_the_core_does_not_know_refuses_the_hello(tmp_path):
    async def main():
        async with serving(tmp_path, config=None) as host:
            client = await Client.connect(host)
            await client.hello(preset="nowhere")
            fatal = await client.recv()
            assert fatal["type"] == "fatal" and fatal["code"] == "bad_game"
            assert "nowhere" in fatal["message"]
            assert await close_code(client) == 4001
            assert host.sessions == {}
            await client.close()

    run(main())


def test_the_preset_of_the_server_is_the_game_of_a_page_that_names_no_seed(tmp_path):
    async def main():
        async with serving(tmp_path, config=None, default_preset="slice") as host:
            client, welcome, _ = await started(host)  # the hello names no seed
            assert (welcome["seed"], welcome["scenario"]) == (492, "bridge")
            assert host.sessions[welcome["session"]].spec.config == SLICE["config"]
            await client.close()
            # A page that names a seed plays that seed, and no preset is laid over it.
            other, welcome, _ = await started(host, seed=5, scenario="m0")
            assert (welcome["seed"], welcome["scenario"]) == (5, "m0")
            assert host.sessions[welcome["session"]].spec.config is None
            await other.close()

    run(main())


def test_the_seed_of_the_server_says_which_seed_its_preset_is_played_at(tmp_path):
    async def main():
        async with serving(tmp_path, config=None, default_preset="slice", default_seed=7) as host:
            client = await Client.connect(host)
            await client.hello()
            welcome = await client.recv()
            assert (welcome["seed"], welcome["scenario"]) == (7, "bridge")
            assert host.sessions[welcome["session"]].spec.config == SLICE["config"]
            await client.close()

    run(main())


def test_a_new_game_by_preset_needs_no_seed_and_starts_the_core_s_game(tmp_path):
    async def main():
        async with serving(tmp_path, config=None) as host:
            client, welcome, _ = await started(host, seed=5, scenario="m0")
            await client.send({"type": "new-game", "preset": "slice"})
            reset = await client.until("reset")
            assert (reset["seed"], reset["scenario"]) == (492, "bridge")
            state = await client.until("state")
            assert state["scene"]["name"]["en"] and state["scenario"] == "bridge"
            session = host.sessions[welcome["session"]]
            assert session.spec == GameSpec(492, "bridge", SLICE["config"])
            # A new game needs a seed or a preset. One that names no game of the core is refused.
            await client.send({"type": "new-game"})
            assert (await client.until("notice"))["code"] == "bad_message"
            await client.send({"type": "new-game", "preset": "nowhere"})
            assert (await client.until("notice", code="bad_game"))["code"] == "bad_game"
            assert session.spec.seed == 492
            await client.close()

    run(main())


def test_a_new_game_by_preset_may_say_which_seed_and_which_story_it_is_played_at(tmp_path):
    async def main():
        async with serving(tmp_path, config=None) as host:
            client, welcome, _ = await started(host, preset="slice")
            await client.send(
                {"type": "new-game", "preset": "slice", "seed": 7, "variant": "v_flood"}
            )
            reset = await client.until("reset")
            assert (reset["seed"], reset["scenario"]) == (7, "bridge")
            await client.until("state")
            session = host.sessions[welcome["session"]]
            # The rules of the slice, at another seed and with another story true.
            assert session.spec == GameSpec(7, "bridge", {**SLICE["config"], "variant": "v_flood"})
            header = session.game.header()
            assert header["seed"] == 7
            assert header["config"].items() >= {**SLICE["config"], "variant": "v_flood"}.items()
            # The record of the game says both, as it says the preset's own.
            await client.send({"type": "call", "reqId": 1, "call": {"op": "export"}})
            replay = (await client.until("reply", reqId=1))["result"]
            assert replay["header"]["seed"] == 7
            assert replay["header"]["config"]["variant"] == "v_flood"
            assert replay["header"]["config"]["opening"] == "op_li_er_hearsay"
            # A seed alone keeps the preset's story, and a story alone keeps its seed.
            await client.send({"type": "new-game", "preset": "slice", "seed": 8})
            assert (await client.until("reset"))["seed"] == 8
            await client.until("state")
            assert session.spec == GameSpec(8, "bridge", SLICE["config"])
            await client.send({"type": "new-game", "preset": "slice", "variant": "v_drunk"})
            assert (await client.until("reset"))["seed"] == 492
            await client.until("state")
            assert session.spec.config["variant"] == "v_drunk"
            # A story the core does not know changes nothing and is said so, and so is a seed it
            # cannot play; a story with no game by name is not a message.
            await client.send({"type": "new-game", "preset": "slice", "variant": "v_nothing"})
            assert (await client.until("notice", code="bad_game"))["code"] == "bad_game"
            await client.send({"type": "new-game", "seed": 5, "variant": "v_flood"})
            assert (await client.until("notice", code="bad_message"))["code"] == "bad_message"
            assert session.spec.seed == 492 and session.spec.config["variant"] == "v_drunk"
            await client.close()

    run(main())


def test_the_replay_of_a_game_of_another_seed_and_story_is_written_and_rebuilds(tmp_path):
    async def main():
        async with serving(tmp_path, config=None) as host:
            client, welcome, _ = await started(host, preset="slice")
            await client.frames(3)
            await client.send(
                {"type": "new-game", "preset": "slice", "seed": 11, "variant": "v_drunk"}
            )
            await client.until("reset")
            await client.until("state")
            await client.frames(30)
            await client.close()
            session = host.sessions[welcome["session"]]
            while session.sink is not None:
                await asyncio.sleep(0.01)
            return welcome["session"]

    sid = run(main())
    files = sorted((tmp_path / "runs").glob(f"*-{sid}.json"))
    assert len(files) == 2  # the first game, written when it was replaced, and the second
    games = [json.loads(f.read_text(encoding="utf-8")) for f in files]
    by_seed = {g["header"]["seed"]: g for g in games}
    assert set(by_seed) == {492, 11}
    second = by_seed[11]
    assert second["header"]["config"].items() >= {**SLICE["config"], "variant": "v_drunk"}.items()
    rebuilt = rebuild(second)
    assert rebuilt.hash() == second["final"]["hash"] and rebuilt.tick == second["end_tick"] >= 30


def test_config_takes_a_text_where_the_value_is_not_a_number():
    assert cli._config(["variant=v_flood", "days=3"]) == {"variant": "v_flood", "days": 3}
    assert cli._config([]) is None
    for bad in ("oops", "variant=", "=3"):
        with pytest.raises(argparse.ArgumentTypeError):
            cli._config([bad])


def test_the_preset_flag_names_a_game_of_the_core_and_refuses_any_other():
    parser = cli.build_parser()
    assert parser.parse_args(["play", "--preset", "slice"]).preset == "slice"
    assert parser.parse_args(["play"]).preset is None
    with pytest.raises(SystemExit):
        parser.parse_args(["play", "--preset", "nowhere"])


def test_a_batch_takes_the_texts_of_the_bridge_in_its_config(capsys):
    argv = ["batch", "--seeds", "492", "--ticks", "200", "--scenario", "bridge"]
    assert (
        cli.main([*argv, "--config", "variant=v_boat", "--config", "opening=op_li_er_hearsay"]) == 0
    )
    with_opening = capsys.readouterr().out
    assert cli.main(argv) == 0
    plain = capsys.readouterr().out
    assert re.match(r"^seed=492 tick=200 hash=[0-9a-f]{64}$", with_opening.strip())
    assert with_opening != plain  # the hearsay of the opening is in the game
    # A text that is not one of the ids of the script is refused, before anything runs.
    with pytest.raises(SystemExit):
        cli.main([*argv, "--config", "variant=v_nope"])
    assert capsys.readouterr().out == ""


def test_play_with_a_preset_serves_the_slice_to_a_page_that_names_no_seed(tmp_path):
    web = make_web_dir(tmp_path / "web")
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
            str(tmp_path / "runs"),
            "--preset",
            "slice",
            "--config",
            "weather_light=5",
        ],  # fmt: skip
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        line = read_first_line(proc)
        match = re.search(r"http://127\.0\.0\.1:(\d+)/\?host=ws$", line)
        assert match, line

        async def play():
            client = await Client.connect_port(int(match.group(1)))
            await client.hello()
            welcome = await client.recv()
            await client.recv()
            frames = await client.frames(3)
            await client.close()
            return welcome, frames

        welcome, frames = asyncio.run(play())
        assert (welcome["seed"], welcome["scenario"]) == (492, "bridge")
        assert frames[0]["frame"]["tracked"] == "t_bamboo_first"
    finally:
        proc.send_signal(signal.SIGTERM)
        try:
            _, err = proc.communicate(timeout=30)
        except subprocess.TimeoutExpired:  # pragma: no cover
            proc.kill()
            _, err = proc.communicate()
            pytest.fail("the server did not stop on SIGTERM")
    assert proc.returncode == 0, err
