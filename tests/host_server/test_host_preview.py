"""A request is previewed through the server host: the call ``preview`` of the page reaches
``Game.preview_json`` and the answer comes back as the reply of the call.

The preview only reads. The tests hold it to that at the two places the server touches it, the
session (on a virtual clock, to a talk with the madam of the teahouse on the first morning, where
the version of a preview is the one an action then carries) and the WebSocket (a page that asks, the
errors it gets, a game that has no previews). The shape of the answer is the core's, and the tests
of the core hold it (``tests/core/test_bridge_preview.py``).
"""

from __future__ import annotations

import asyncio

import pytest
from host_helpers import Client, drive_to_tick, make_session, serving

from lantern_eve import protocol

CLEAR = {"weather_clear": 1, "weather_light": 0, "weather_heavy": 0}
WHO = "cha_laoban"  # at the teahouse from seven until noon
KEYS = {"version", "cost", "asks", "gives", "blockers", "odds", "reasons"}
ASK = {"verb": "ask", "npc": WHO, "topic": "t_rail"}
LEND = {"verb": "entrust", "npc": "li_laotai", "kind": "lend"}


def run(coro):
    return asyncio.run(coro)


def open_talk():
    """A bridge game at eight in the morning with the manager in a talk with the madam."""
    session, clock, out = make_session(1, scenario="bridge", config=CLEAR)
    drive_to_tick(session, clock, 230)
    session.player({"action_id": "move-1", "type": "move", "place": "p_teahouse"})
    for _ in range(200):
        clock.advance_ms(100)
        session.pump()
        me = session.last_frame["frame"]["player"]
        madam = next(n for n in session.last_frame["frame"]["npcs"] if n["id"] == WHO)
        if max(abs(me["x"] - madam["x"]), abs(me["y"] - madam["y"])) <= 2:
            break
    session.player({"action_id": "talk-1", "type": "talk", "npc": WHO})
    clock.advance_ms(100)
    session.pump()
    assert session.core_paused and session.last_frame["frame"]["player"]["talk"]["npc"] == WHO
    return session, clock, out


# ------------------------------------------------------------------------------ the session


def test_a_preview_says_what_an_act_costs_and_leaves_the_game_and_the_record_as_they_were():
    session, clock, _ = open_talk()
    before = (session.game.hash(), session.next_tick, list(session.recorder.records))
    seen = [session.preview(ASK) for _ in range(5)]
    assert all(set(p) == KEYS for p in seen) and all(p == seen[0] for p in seen)
    assert seen[0]["cost"] == 10 and seen[0]["blockers"] == [] and seen[0]["odds"] is None
    assert {"zh", "en"} == set(seen[0]["asks"])
    # the preview of a request weighs it as the core would, and has reasons the manager may be told
    asked = session.preview({"verb": "entrust", "npc": WHO, "kind": "join"})
    assert asked["cost"] == 20 and asked["odds"] in {"high", "mid", "low"}
    assert asked["reasons"] and all(r["sign"] in (1, -1) for r in asked["reasons"])
    assert (session.game.hash(), session.next_tick, list(session.recorder.records)) == before
    # and a world that is held stays held: asking took no time, from the page or the clock
    for _ in range(20):
        clock.advance_ms(100)
        session.pump()
    assert session.game.hash() == before[0] and session.core_paused


def test_the_version_of_a_preview_is_the_one_an_action_then_carries_and_an_old_one_is_stale():
    session, clock, out = open_talk()
    preview = session.preview(ASK)
    # a world that is held keeps the version for as long as nothing happens in it
    assert session.preview(ASK)["version"] == preview["version"]
    session.player(
        {"action_id": "ask-1", "type": "ask", "topic": "t_rail", "version": preview["version"]}
    )
    clock.advance_ms(100)
    session.pump()
    acks = [m for m in out if m["type"] == "ack" and m["action_id"] == "ask-1"]
    assert [(m["result"], m["reason"]) for m in acks] == [("applied", None)]
    # the act is paid for, and then the state is another: the version of before is stale
    for _ in range(200):
        clock.advance_ms(100)
        session.pump()
        if session.core_paused and session.preview(ASK)["version"] != preview["version"]:
            break
    assert session.preview(ASK)["version"] > preview["version"]
    session.player(
        {"action_id": "ask-2", "type": "ask", "topic": "t_rail", "version": preview["version"]}
    )
    clock.advance_ms(100)
    session.pump()
    again = [m for m in out if m["type"] == "ack" and m["action_id"] == "ask-2"]
    assert [(m["result"], m["reason"]) for m in again] == [("rejected", "stale")]


def test_an_action_the_core_cannot_read_is_an_input_error_and_changes_nothing():
    session, _, _ = open_talk()
    before = session.game.hash()
    for action in (
        {"verb": "dance", "npc": WHO},
        {"verb": "ask", "npc": "nobody", "topic": "t_rail"},
        {"verb": "ask", "npc": WHO},
        {"verb": "ask", "npc": WHO, "topic": 3},
    ):
        with pytest.raises(ValueError):
            session.preview(action)
    assert session.game.hash() == before


def test_a_game_without_previews_answers_none():
    session, _, _ = make_session(5)  # the demo world
    assert session.preview(ASK) is None


# ------------------------------------------------------------------------------ the socket


async def started(host, **hello) -> tuple[Client, dict, dict]:
    client = await Client.connect(host)
    await client.hello(**{"seed": 5, **hello})
    welcome = await client.recv()
    state = await client.recv()
    assert (welcome["type"], state["type"]) == ("welcome", "state")
    return client, welcome, state


async def preview(client: Client, req_id: int, action) -> dict:
    await client.send(
        {"type": "call", "reqId": req_id, "call": {"op": "preview", "action": action}}
    )
    return await client.until("reply", reqId=req_id)


def test_a_page_asks_for_a_preview_and_gets_the_answer_of_the_core_as_the_reply(tmp_path):
    async def main():
        async with serving(tmp_path, config={}) as host:
            client, welcome, _ = await started(host, scenario="bridge", seed=3)
            await client.frames(3)
            # the call is known to the protocol, with the action beside the op
            assert "preview" in protocol.CALL_OPS
            # a world that is paused keeps its version, so that the answer can be held to the core's
            await client.send({"type": "pause", "reason": "user"})
            await client.until("stats", timeout=10)
            await client.quiet(0.3)
            session = host.sessions[welcome["session"]]
            before = session.game.hash()
            reply = await preview(client, 11, LEND)
            assert reply["ok"] is True and set(reply["result"]) == KEYS
            result = reply["result"]
            assert result["cost"] == 20 and isinstance(result["version"], int)
            assert result["asks"]["en"].startswith("Ask Granny Li")
            # the manager is not in a talk, which the blockers say in words the page shows
            assert result["blockers"][0]["en"].startswith("You are not talking to")
            assert result == session.preview(LEND)  # word for word what the core says
            assert session.game.hash() == before
            await client.close()

    run(main())


def test_the_preview_reads_without_a_trace_the_game_goes_on_and_the_replay_has_no_call_in_it(
    tmp_path,
):
    async def main():
        async with serving(tmp_path, config={}) as host:
            client, welcome, _ = await started(host, scenario="bridge", seed=3)
            await client.send({"type": "pause", "reason": "user"})
            await client.until("stats", timeout=10)
            session = host.sessions[welcome["session"]]
            await client.quiet(0.2)
            hash_before, records = session.game.hash(), list(session.recorder.records)
            for req_id in range(20, 30):
                reply = await preview(
                    client, req_id, {"verb": "ask", "npc": WHO, "topic": "t_rail"}
                )
                assert reply["ok"] is True
            assert session.game.hash() == hash_before
            assert session.recorder.records == records  # a preview is not an input
            await client.send({"type": "resume", "reason": "user"})
            more = await client.frames(5)
            assert [f["seq"] for f in more] == sorted(f["seq"] for f in more)
            await client.close()

    run(main())


def test_a_page_that_asks_for_what_the_core_cannot_read_gets_an_error_reply_and_the_game_goes_on(
    tmp_path,
):
    async def main():
        async with serving(tmp_path, config={}) as host:
            client, _, _ = await started(host, scenario="bridge", seed=3)
            for req_id, action in enumerate(
                (
                    {"verb": "dance", "npc": WHO},
                    {"verb": "entrust", "npc": "nobody", "kind": "lend"},
                    {"verb": "ask", "npc": WHO},
                ),
                start=40,
            ):
                reply = await preview(client, req_id, action)
                assert reply["ok"] is False and reply["error"]["code"] == "bad_action"
                assert reply["error"]["message"]
            # a call whose action is not an object is a message the server will not act on
            await client.send({"type": "call", "reqId": 50, "call": {"op": "preview"}})
            assert (await client.until("notice", code="bad_message"))["type"] == "notice"
            await client.send(
                {"type": "call", "reqId": 51, "call": {"op": "preview", "action": [1]}}
            )
            assert (await client.until("notice", code="bad_message"))["type"] == "notice"
            await client.frames(5)
            await client.close()

    run(main())


def test_a_game_that_has_no_previews_answers_with_null_so_that_the_page_knows(tmp_path):
    async def main():
        async with serving(tmp_path) as host:
            client, _, _ = await started(host, scenario="m0", seed=5)  # the demo world
            reply = await preview(client, 60, ASK)
            assert reply["ok"] is True and reply["result"] is None
            await client.close()

    run(main())


def test_the_frames_keep_coming_in_order_while_the_page_asks(tmp_path):
    async def main():
        async with serving(tmp_path, config={}) as host:
            client, _, _ = await started(host, scenario="bridge", seed=3)
            for req_id in range(70, 80):
                await client.send(
                    {"type": "call", "reqId": req_id, "call": {"op": "preview", "action": LEND}}
                )
            replies = [await client.until("reply", reqId=req_id) for req_id in range(70, 80)]
            assert all(r["ok"] for r in replies)
            got = await client.frames(30)
            assert [f["seq"] for f in got] == list(range(got[0]["seq"], got[0]["seq"] + 30))
            await client.close()

    run(main())
