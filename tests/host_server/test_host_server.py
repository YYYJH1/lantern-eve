"""A session over a real WebSocket on a free port."""

from __future__ import annotations

import asyncio
import json

import aiohttp
import pytest
from host_helpers import SUMMON, Client, serving, wait_for

from lantern_core.replay import rebuild
from lantern_eve import __version__, protocol
from lantern_eve.server import Connection


def run(coro):
    return asyncio.run(coro)


async def started(host, **hello) -> tuple[Client, dict, dict]:
    """A connected client that has said hello, with its welcome and its first state."""
    client = await Client.connect(host)
    await client.hello(**{"seed": 5, **hello})
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


def tape_of(replay) -> list[tuple[int, str]]:
    return [(r[0], r[2]) for r in replay["records"] if r[2] != "model_result"]


async def export(client: Client, req_id: int = 1) -> dict:
    await client.send({"type": "call", "reqId": req_id, "call": {"op": "export"}})
    reply = await client.until("reply", reqId=req_id)
    assert reply["ok"] is True
    return reply["result"]


def test_hello_gets_a_welcome_a_state_and_then_frames_in_sequence(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client = await Client.connect(host)
            await client.hello(seed=5, scenario="m0")
            welcome = await client.recv()
            state = await client.recv()
            assert welcome["type"] == "welcome" and welcome["version"] == protocol.PROTOCOL_VERSION
            assert welcome["resumed"] is False and welcome["seed"] == 5
            assert welcome["scenario"] == "m0" and welcome["transport"] == "mock"
            assert welcome["core"]["format"] == 1 and welcome["host"]["name"] == "server"
            assert welcome["session"] in host.sessions
            assert state["type"] == "state" and state["seq"] == 0 and state["frame"] is None
            assert state["scene"]["width"] == 48 and state["clock"]["paused"] is False

            frames = await client.frames(60)
            # Numbered from 1, no gaps, one frame per tick while the world runs.
            assert [f["seq"] for f in frames] == list(range(1, 61))
            assert [f["tick"] for f in frames] == list(range(60))
            assert all(f["advanced"] and len(f["frame"]["npcs"]) == 12 for f in frames)
            assert [f["tick"] for f in frames if "hash" in f] == [0]
            # The page also gets stats, and nothing it cannot read.
            stats = [m for m in client.received if m["type"] == "stats"]
            assert stats and stats[-1]["stats"]["rate"] == [1, 1]
            assert set(client.kinds()) <= {"welcome", "state", "frame", "stats", "ack", "notice"}
            await client.close()

    run(main())


def test_an_action_is_acknowledged_once_and_a_resend_acts_once(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, _, _ = await started(host)
            await client.frames(5)
            action = {**SUMMON, "action_id": "a-1"}
            await client.send({"type": "player", "body": action})
            first = await client.until("ack", action_id="a-1")
            assert (first["result"], first["reason"]) == ("applied", None)
            await client.frames(5)
            # The page lost the ack, or the connection, and sends the action again. Twice.
            await client.send({"type": "player", "body": dict(action)})
            await client.send({"type": "player", "body": dict(action)})
            await client.until("ack", action_id="a-1", result="duplicate")
            await client.until("ack", action_id="a-1", result="duplicate")
            await client.frames(5)
            acks = [(m["action_id"], m["result"]) for m in client.received if m["type"] == "ack"]
            assert acks == [("a-1", "applied"), ("a-1", "duplicate"), ("a-1", "duplicate")]
            # The core saw the same three, and the world acted on the first only.
            events = [
                e["result"]
                for m in client.received
                if m["type"] == "frame"
                for e in m["events"]
                if e["kind"] == "action_ack"
            ]
            assert events == ["applied", "duplicate", "duplicate"]
            replay = await export(client)
            players = [r for r in replay["records"] if r[2] == "player"]
            assert len(players) == 3 and {r[3]["action_id"] for r in players} == {"a-1"}
            await client.close()

    run(main())


def test_an_action_the_core_will_not_take_is_refused_and_the_game_goes_on(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, _, _ = await started(host)
            await client.send({"type": "player", "body": {"action_id": "x-1", "type": "dance"}})
            refused = await client.until("ack", action_id="x-1")
            assert refused["result"] == "refused" and "unknown type" in refused["reason"]
            notice = await client.until("notice", code="input_refused")
            assert "1 player input" in notice["message"]
            await client.send({"type": "player", "body": {**SUMMON, "action_id": "ok-1"}})
            assert (await client.until("ack", action_id="ok-1"))["result"] == "applied"
            replay = await export(client)
            assert [r[3]["action_id"] for r in replay["records"] if r[2] == "player"] == ["ok-1"]
            await client.close()

    run(main())


def test_the_page_pauses_and_resumes_the_world(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, _, _ = await started(host)
            await client.frames(10)
            await client.send({"type": "pause", "reason": "user"})
            held = await client.until("frame", clock={"paused": True, "rate": [1, 1]})
            assert held["advanced"] is False
            quiet = await client.quiet(0.6)
            assert not [m for m in quiet if m["type"] == "frame"], "frames arrived while paused"
            await client.send({"type": "pause", "reason": "hidden"})
            await client.send({"type": "resume", "reason": "user"})
            assert not [m for m in await client.quiet(0.3) if m["type"] == "frame"]
            await client.send({"type": "resume", "reason": "hidden"})
            running = await client.until("frame", clock={"paused": False, "rate": [1, 1]})
            assert running["advanced"] is True and running["tick"] == held["tick"]
            after = await client.frames(5)
            assert [f["tick"] for f in after] == list(
                range(running["tick"] + 1, running["tick"] + 6)
            )
            replay = await export(client)
            assert [k for _, k in tape_of(replay)] == ["pause", "resume"]
            assert tape_of(replay)[0][0] == tape_of(replay)[1][0] == held["tick"]
            await client.close()

    run(main())


def test_a_page_that_opens_hidden_starts_with_the_world_held(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, _, state = await started(host, hidden=True)
            assert state["reasons"] == ["hidden"]
            assert not [
                m for m in await client.quiet(0.4) if m["type"] == "frame" and m["advanced"]
            ]
            await client.send({"type": "resume", "reason": "hidden"})
            await client.frames(3)
            replay = await export(client)
            assert [k for _, k in tape_of(replay)] == ["pause", "resume"]
            await client.close()

    run(main())


def test_a_dropped_connection_holds_the_world_and_the_next_one_resumes_it(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, welcome, _ = await started(host)
            sid = welcome["session"]
            seen = await client.frames(40)
            last = seen[-1]["seq"]
            await client.drop()  # no closing handshake
            session = host.sessions[sid]
            await wait_for(lambda: session.sink is None)
            assert session.reasons == ["offline"] and session.core_paused
            held = session.next_tick
            files = list((tmp_path / "runs").glob(f"*-{sid}.json"))
            assert len(files) == 1, "the replay is written when the connection goes"
            await asyncio.sleep(0.3)
            assert session.next_tick == held  # nothing ran while nobody was there

            back = await Client.connect(host)
            await back.hello(seed=999, session=sid, since=last)
            welcome2 = await back.recv()
            state = await back.recv()
            assert welcome2["session"] == sid and welcome2["resumed"] is True
            assert welcome2["seed"] == 5, "the game is the old one, not the hello's seed"
            assert state["type"] == "state" and state["seq"] >= last
            # The world takes up where it was held, and the state already says so: the first tick
            # after a resume is taken at once.
            assert state["clock"]["paused"] is False and state["frame"]["npcs"]
            assert state["nextTick"] == held + 1 and state["tick"] == held
            assert state["reasons"] == []
            # The state is the world as a replay of the record reaches it.
            record = await export(back)
            assert [k for _, k in tape_of(record)] == ["pause", "resume"]
            assert rebuild(record, until=state["nextTick"]).hash() == state["stateHash"]
            # From here the frames run on in sequence, from the state's.
            frames = await back.frames(20)
            assert [f["seq"] for f in frames] == list(range(state["seq"] + 1, state["seq"] + 21))
            assert frames[0]["advanced"] and frames[0]["tick"] == held + 1
            await back.close()

    run(main())


def test_the_page_can_ask_for_the_state_again_when_it_sees_a_gap(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, _, _ = await started(host)
            frames = await client.frames(30)
            # The page throws away frames 11 to 25, as if they never came, and notices the gap.
            kept = [f for f in frames if not 11 <= f["seq"] <= 25]
            assert len(kept) < len(frames)
            await client.send({"type": "resync", "since": 10})
            state = await client.until("state")
            assert state["seq"] >= 30 and state["nextTick"] >= 30
            # It carries the events the page missed after frame 10 that the server still holds.
            expected = [
                e for f in frames if f["seq"] > 10 for e in f["events"]
            ]  # a lower bound: the state is newer than these frames
            assert state["events"][: len(expected)] == expected
            after = await client.until("frame")
            assert after["seq"] == state["seq"] + 1 and after["tick"] == state["nextTick"]
            record = await export(client)
            assert rebuild(record, until=state["nextTick"]).hash() == state["stateHash"]
            await client.close()

    run(main())


def test_a_page_that_reads_slowly_gets_the_state_in_place_of_the_frames_it_missed():
    class Gate:
        """A socket whose sends wait for the test, and a record of what went out."""

        def __init__(self):
            self.open = asyncio.Event()
            self.sent: list[dict] = []

        async def send_str(self, text):
            await self.open.wait()
            self.sent.append(json.loads(text))

    async def main():
        gate = Gate()
        conn = Connection(gate, queue_max=8)  # type: ignore[arg-type]
        counter = {"seq": 0}

        def frame():
            counter["seq"] += 1
            return {"type": "frame", "seq": counter["seq"], "tick": counter["seq"] - 1}

        conn.state_source = lambda since: {"type": "state", "seq": counter["seq"], "since": since}
        writer = asyncio.get_running_loop().create_task(conn.write_loop())
        conn.offer({"type": "ack", "action_id": "a", "result": "applied"})
        await asyncio.sleep(0)  # the writer takes the ack and waits on the socket
        for _ in range(50):
            conn.offer(frame())  # the queue overflows
        conn.offer({"type": "notice", "code": "x", "message": "kept"})
        gate.open.set()
        await wait_for(lambda: conn.last_seq == 50 and not conn.queue and not conn.needs_state)
        conn.offer(frame())
        await wait_for(lambda: gate.sent[-1]["type"] == "frame" and gate.sent[-1]["seq"] == 51)
        conn.closed = True
        conn.wake.set()
        await writer

        kinds = [m["type"] for m in gate.sent]
        assert kinds[0] == "ack" and "state" in kinds and kinds.count("state") == 1
        state = next(m for m in gate.sent if m["type"] == "state")
        assert state["seq"] == 50 and state["since"] == 0
        frames = [m["seq"] for m in gate.sent if m["type"] == "frame"]
        assert frames == sorted(frames) and all(s < 50 or s == 51 for s in frames)
        assert len(frames) < 10 and conn.dropped > 40
        assert gate.sent.index(state) < gate.sent.index(gate.sent[-1])
        assert {"type": "notice", "code": "x", "message": "kept"} in gate.sent

    run(main())


def test_a_page_that_never_reads_is_cut_off():
    class Stuck:
        async def send_str(self, text):
            await asyncio.Event().wait()

    async def main():
        conn = Connection(Stuck(), queue_max=4)  # type: ignore[arg-type]
        for n in range(20):
            conn.offer({"type": "ack", "action_id": str(n), "result": "applied"})
        assert conn.closed

    run(main())


def test_a_bad_hello_is_refused_with_a_fatal_message_and_a_close_code(tmp_path):
    async def refused(host, send) -> tuple[dict, int | None]:
        client = await Client.connect(host)
        await send(client)
        message = await client.recv()
        code = await close_code(client)
        await client.close()
        return message, code

    async def main():
        async with serving(tmp_path, hello_timeout_s=0.3) as host:
            cases = {
                "bad_message": lambda c: c.send({"type": "pause", "reason": "user"}),
                "bad_version": lambda c: c.send({"type": "hello", "version": 2}),
                "bad_game": lambda c: c.hello(seed=1, scenario="no-such-scenario"),
                "bad_hello": lambda c: asyncio.sleep(0),
            }
            for code, send in cases.items():
                message, close_code = await refused(host, send)
                assert (message["type"], message["code"]) == ("fatal", code), message
                assert close_code == protocol.CLOSE_BAD_HELLO
            assert host.sessions == {}

    run(main())


def test_messages_the_server_cannot_use_get_a_notice_and_the_connection_goes_on(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, _, _ = await started(host)
            await client.ws.send_str("{not json")
            await client.ws.send_str(json.dumps({"type": "player", "body": {"x": 1.5}}))
            await client.ws.send_str(json.dumps({"type": "teleport"}))
            await client.ws.send_str(json.dumps({"type": "pause", "reason": "bored"}))
            await client.ws.send_str(json.dumps({"type": "hello", "version": 1}))
            await client.ws.send_bytes(b"\x00\x01")
            await client.ws.send_str(json.dumps([1, 2]))
            await client.send({"type": "new-game", "seed": 2**60})
            codes = []
            while len(codes) < 8:
                codes.append((await client.until("notice"))["code"])
            assert codes == ["bad_message"] * 8
            await client.frames(5)
            await client.close()

    run(main())


def test_the_calls_the_server_host_has_no_use_for_are_answered_not_ignored(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, _, _ = await started(host)

            async def call(req_id, op):
                await client.send({"type": "call", "reqId": req_id, "call": {"op": op}})
                return await client.until("reply", reqId=req_id)

            assert (await call(1, "list-saves"))["result"] == []
            for req_id, op in enumerate(("save", "load", "delete-save"), start=2):
                reply = await call(req_id, op)
                assert reply["ok"] is False and reply["error"]["code"] == "unsupported"
            await client.send({"type": "e2e", "reqId": 9, "op": "stall"})
            assert (await client.until("reply", reqId=9))["error"]["code"] == "unsupported"
            await client.send(
                {"type": "configure", "provider": "bailian", "key": "sk-not-sent-here"}
            )
            assert (await client.until("notice", code="server_model"))["type"] == "notice"
            await client.send({"type": "call", "reqId": 7, "call": {"op": "format-disk"}})
            assert (await client.until("notice", code="bad_message"))["type"] == "notice"
            await client.close()

    run(main())


def test_a_page_that_comes_to_a_game_that_is_over_gets_the_whole_ending_with_its_state(tmp_path):
    async def main():
        # A game of one day, at fifty times the speed: the last night comes after a few seconds.
        async with serving(
            tmp_path, config={}, game_config=lambda name: {"days": 1}, pace=50
        ) as host:
            client, welcome, first = await started(host, scenario="bridge", seed=3)
            assert first["ending"] is None
            made = None
            while made is None:
                frame = await client.until("frame", timeout=60)
                made = next((e for e in frame["events"] if e["kind"] == "ending"), None)
            assert frame["frame"]["ending"] == made and "reveal" in made and "epilogue" in made
            # every frame after it has the ending without its reveal
            light = {key: value for key, value in made.items() if key not in ("reveal", "epilogue")}
            after = await client.frames(5)
            assert all(f["frame"]["ending"] == light for f in after)
            # the page can ask for the whole of it
            await client.send({"type": "call", "reqId": 3, "call": {"op": "ending"}})
            reply = await client.until("reply", reqId=3)
            assert reply["ok"] is True and reply["result"] == made
            await client.send({"type": "pause", "reason": "user"})
            await client.until("stats", timeout=10)

            # a page that comes back is sent the whole of it in the state, and none in the frame
            other = await Client.connect(host)
            await other.hello(session=welcome["session"], since=after[-1]["seq"])
            assert (await other.recv())["resumed"] is True
            state = await other.until("state")
            assert state["ending"] == made
            assert state["frame"]["ending"] == light
            await other.send({"type": "call", "reqId": 4, "call": {"op": "ending"}})
            assert (await other.until("reply", reqId=4))["result"] == made
            # a new game takes the ending away
            await other.send({"type": "new-game", "seed": 4, "scenario": "bridge"})
            assert (await other.until("state"))["ending"] is None
            await other.close()

    run(main())


def test_the_ending_of_a_game_that_has_none_yet_is_null_in_the_state_and_in_the_call(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, _, state = await started(host)
            assert state["ending"] is None
            await client.send({"type": "call", "reqId": 5, "call": {"op": "ending"}})
            reply = await client.until("reply", reqId=5)
            assert reply["ok"] is True and reply["result"] is None
            await client.close()

    run(main())


def test_export_returns_the_replay_and_it_rebuilds_to_the_same_hashes(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, _, _ = await started(host)
            await client.frames(5)
            await client.send({"type": "player", "body": {**SUMMON, "action_id": "e-1"}})
            await client.send({"type": "pause", "reason": "user"})
            await client.send({"type": "resume", "reason": "user"})
            await client.frames(300)
            replay = await export(client)
            assert replay["host"] == {"name": "server", "version": __version__, "replayFormat": 1}
            assert replay["final"]["tick"] == replay["end_tick"] >= 300
            game = rebuild(replay)
            assert game.hash() == replay["final"]["hash"]
            await client.close()

    run(main())


def test_a_newer_connection_takes_the_game_over_and_the_older_is_closed(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            first, welcome, _ = await started(host)
            await first.frames(10)
            second = await Client.connect(host)
            await second.hello(session=welcome["session"], since=5)
            assert (await second.recv())["resumed"] is True
            await second.recv()
            await second.frames(5)
            assert await close_code(first) == protocol.CLOSE_REPLACED
            # Taking over is not a pause: the world never stopped.
            session = host.sessions[welcome["session"]]
            assert session.reasons == [] and not session.core_paused
            await first.http.close()
            await second.close()

    run(main())


def test_new_game_ends_the_old_game_and_starts_another(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, welcome, _ = await started(host)
            await client.frames(20)
            await client.send({"type": "new-game", "seed": 77})
            reset = await client.until("reset")
            state = await client.until("state")
            assert (reset["seed"], reset["scenario"]) == (77, "m0")
            assert state["seed"] == 77 and state["seq"] == 0 and state["nextTick"] == 0
            frames = await client.frames(5)
            assert [f["seq"] for f in frames] == [1, 2, 3, 4, 5]
            assert len(list((tmp_path / "runs").glob("*-seed5-*.json"))) == 1
            replay = await export(client)
            assert replay["header"]["seed"] == 77 and replay["end_tick"] >= 5
            await client.send({"type": "new-game", "seed": 3, "scenario": "nowhere"})
            assert (await client.until("notice", code="bad_game"))["type"] == "notice"
            await client.frames(3)  # the game that was running is still running
            await client.close()
            assert welcome["session"] in host.sessions

    run(main())


def test_a_page_of_another_origin_or_another_host_is_turned_away(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            for headers in (
                {"Origin": "http://evil.example"},
                {"Origin": f"http://localhost:{host.port}"},  # same machine, another origin
                {"Host": "evil.example"},
            ):
                http = aiohttp.ClientSession()
                with pytest.raises(aiohttp.WSServerHandshakeError) as caught:
                    await http.ws_connect(f"ws://127.0.0.1:{host.port}/ws", headers=headers)
                assert caught.value.status == 403, headers
                await http.close()
            ok = await Client.connect(host, Origin=f"http://127.0.0.1:{host.port}")
            await ok.hello(seed=1)
            assert (await ok.recv())["type"] == "welcome"
            await ok.close()
            # No Origin header at all is a program, not a page: let it in.
            bare = await Client.connect(host)
            await bare.hello(seed=1)
            assert (await bare.recv())["type"] == "welcome"
            await bare.close()

    run(main())


def test_a_session_nobody_returns_to_is_closed_with_its_replay_written(tmp_path):
    async def main():
        async with serving(tmp_path, detached_ttl_s=0.3) as host:
            client, welcome, _ = await started(host)
            sid = welcome["session"]
            await client.frames(10)
            await client.close()
            await wait_for(lambda: sid not in host.sessions)
            assert len(list((tmp_path / "runs").glob(f"*-{sid}.json"))) == 1
            # The id is of no use now: the server starts a new game for it.
            late = await Client.connect(host)
            await late.hello(seed=8, session=sid)
            fresh = await late.recv()
            assert fresh["resumed"] is False and fresh["session"] != sid and fresh["seed"] == 8
            await late.close()

    run(main())


def test_coming_back_in_time_keeps_the_session(tmp_path):
    async def main():
        async with serving(tmp_path, detached_ttl_s=1.0) as host:
            client, welcome, _ = await started(host)
            sid = welcome["session"]
            await client.close()
            await wait_for(lambda: host.sessions[sid].sink is None)
            await asyncio.sleep(0.2)
            back = await Client.connect(host)
            await back.hello(session=sid)
            assert (await back.recv())["resumed"] is True
            await asyncio.sleep(1.2)  # longer than the time to live since the first connection left
            assert sid in host.sessions
            await back.close()

    run(main())


def test_stopping_the_server_writes_every_replay_and_says_goodbye(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            one, _, _ = await started(host, seed=1)
            two, _, _ = await started(host, seed=2)
            await one.frames(10)
            await two.frames(10)
            await host.stop()
            for client, seed in ((one, 1), (two, 2)):
                assert await close_code(client) == 1001
                await client.http.close()
                files = list((tmp_path / "runs").glob(f"*-seed{seed}-*.json"))
                assert len(files) == 1
                replay = json.loads(files[0].read_text(encoding="utf-8"))
                assert rebuild(replay).hash() == replay["final"]["hash"]

    run(main())


def test_the_server_refuses_as_many_games_as_it_is_set_to_run(tmp_path):
    async def main():
        async with serving(tmp_path, max_sessions=2) as host:
            a, _, _ = await started(host, seed=1)
            b, _, _ = await started(host, seed=2)
            c = await Client.connect(host)
            await c.hello(seed=3)
            fatal = await c.recv()
            assert (fatal["type"], fatal["code"]) == ("fatal", "busy")
            await asyncio.gather(a.close(), b.close(), c.close())

    run(main())


def test_the_client_message_sizes_are_bounded(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, _, _ = await started(host)
            await client.ws.send_str(json.dumps({"type": "player", "body": {"pad": "x" * 70_000}}))
            closing = await asyncio.wait_for(client.ws.receive(), 5)
            while closing.type == aiohttp.WSMsgType.TEXT:
                closing = await asyncio.wait_for(client.ws.receive(), 5)
            assert closing.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING)
            await client.http.close()

    run(main())
