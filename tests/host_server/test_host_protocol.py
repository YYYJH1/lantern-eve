"""What the server accepts from a page, one message at a time."""

import json

import pytest

from lantern_eve import protocol
from lantern_eve.protocol import ProtocolError


def code_of(call, *args) -> str:
    with pytest.raises(ProtocolError) as caught:
        call(*args)
    return caught.value.code


def test_a_message_is_an_object_with_a_type_and_nothing_but_integers():
    assert protocol.parse('{"type": "pause", "reason": "user"}') == {
        "type": "pause",
        "reason": "user",
    }
    for text in (
        "{",
        "[]",
        '"pause"',
        "{}",
        '{"type": 3}',
        '{"type": "player", "body": {"x": 1.5}}',
        '{"type": "hello", "seed": 1e3}',
        '{"type": "hello", "seed": NaN}',
        '{"type": "new-game", "seed": 9007199254740993}',
        "[" * 100_000,
    ):
        assert code_of(protocol.parse, text) == "bad_message", text[:40]


def test_hello_is_checked_field_by_field():
    ok = protocol.hello_fields(
        {"type": "hello", "version": 1, "session": "s-1", "seed": 7, "scenario": "m0", "since": 4}
    )
    assert ok == {
        "session": "s-1",
        "seed": 7,
        "scenario": "m0",
        "preset": None,
        "hidden": False,
        "since": 4,
    }
    named = protocol.hello_fields({"type": "hello", "version": 1, "preset": "slice"})
    assert named["preset"] == "slice" and named["seed"] is None
    assert protocol.hello_fields({"type": "hello", "version": 1, "hidden": True})["hidden"] is True
    assert code_of(protocol.hello_fields, {"type": "hello"}) == "bad_version"
    assert code_of(protocol.hello_fields, {"type": "hello", "version": 2}) == "bad_version"
    assert code_of(protocol.hello_fields, {"type": "hello", "version": "1"}) == "bad_version"
    for field, value in {
        "hidden": "yes",
        "seed": True,
        "seed ": -1,
        "session": "",
        "scenario": "m" * 65,
        "preset": "",
        "since": "3",
    }.items():
        message = {"type": "hello", "version": 1, field.strip(): value}
        assert code_of(protocol.hello_fields, message) == "bad_message", field


def test_pause_reasons_are_the_three_the_page_has():
    assert protocol.pause_reason({"type": "pause", "reason": "user"}) == "user"
    assert protocol.pause_reason({"type": "resume", "reason": "hidden"}) == "hidden"
    assert protocol.pause_reason({"type": "pause", "reason": "page"}) == "page"
    for reason in ("offline", "", None, 1, ["user"]):
        assert code_of(protocol.pause_reason, {"type": "pause", "reason": reason}) == "bad_message"


def test_the_rest_of_the_messages():
    assert protocol.player_body({"type": "player", "body": {"action_id": "a"}}) == {
        "action_id": "a"
    }
    assert code_of(protocol.player_body, {"type": "player", "body": [1]}) == "bad_message"
    assert code_of(protocol.player_body, {"type": "player"}) == "bad_message"

    assert protocol.new_game_fields({"type": "new-game", "seed": 5}) == (5, None, None, None)
    assert protocol.new_game_fields({"type": "new-game", "seed": 0, "scenario": "m0"}) == (
        0,
        "m0",
        None,
        None,
    )
    # A game by name needs no seed, and any other does.
    assert protocol.new_game_fields({"type": "new-game", "preset": "slice"}) == (
        None,
        None,
        "slice",
        None,
    )
    assert code_of(protocol.new_game_fields, {"type": "new-game", "preset": ""}) == "bad_message"
    assert code_of(protocol.new_game_fields, {"type": "new-game"}) == "bad_message"
    assert code_of(protocol.new_game_fields, {"type": "new-game", "seed": 2**53}) == "bad_message"

    for op in protocol.CALL_OPS:
        assert protocol.call_fields({"type": "call", "reqId": 3, "call": {"op": op}}) == (3, op)
    assert (
        code_of(protocol.call_fields, {"type": "call", "reqId": 3, "call": {"op": "rm"}})
        == "bad_message"
    )
    assert (
        code_of(protocol.call_fields, {"type": "call", "call": {"op": "export"}}) == "bad_message"
    )
    assert (
        code_of(protocol.call_fields, {"type": "call", "reqId": 1, "call": "export"})
        == "bad_message"
    )

    # the action of a preview is an object, the core reads the rest
    call = {"op": "preview", "action": {"verb": "ask", "npc": "cha_laoban", "topic": "t_rail"}}
    assert protocol.call_action({"type": "call", "reqId": 3, "call": call}) == call["action"]
    for call in (
        {"op": "preview"},
        {"op": "preview", "action": [1]},
        {"op": "preview", "action": 3},
    ):
        assert (
            code_of(protocol.call_action, {"type": "call", "reqId": 3, "call": call})
            == "bad_message"
        )
    assert (
        code_of(protocol.call_action, {"type": "call", "reqId": 3, "call": "preview"})
        == "bad_message"
    )

    assert protocol.resync_since({"type": "resync"}) is None
    assert protocol.resync_since({"type": "resync", "since": 12}) == 12
    assert code_of(protocol.resync_since, {"type": "resync", "since": -1}) == "bad_message"


def test_a_message_the_page_sends_survives_json_dumps_unchanged():
    # The page builds these with JSON.stringify, which writes whole numbers without a point.
    sent = {"type": "player", "body": {"action_id": "t-0", "type": "summon", "x": 31, "y": 10}}
    assert protocol.parse(json.dumps(sent)) == sent


def test_a_game_by_name_may_say_which_seed_and_which_story_it_is_played_at():
    both = {"type": "new-game", "preset": "slice", "seed": 7, "variant": "v_flood"}
    assert protocol.new_game_fields(both) == (7, None, "slice", "v_flood")
    only_seed = {"type": "new-game", "preset": "slice", "seed": 0}
    assert protocol.new_game_fields(only_seed) == (0, None, "slice", None)
    only_story = {"type": "new-game", "preset": "slice", "variant": "v_drunk"}
    assert protocol.new_game_fields(only_story) == (None, None, "slice", "v_drunk")
    # A story is a story of a game by name; the text is the core's to judge, the protocol checks
    # only that it is a short text.
    assert code_of(
        protocol.new_game_fields, {"type": "new-game", "seed": 5, "variant": "v_boat"}
    ) == ("bad_message")
    for bad in ("", 7, ["v_boat"], "x" * 65):
        message = {"type": "new-game", "preset": "slice", "variant": bad}
        assert code_of(protocol.new_game_fields, message) == "bad_message", bad
    for bad_seed in (-1, 2**53, 1.5, "7", True):
        message = {"type": "new-game", "preset": "slice", "seed": bad_seed}
        assert code_of(protocol.new_game_fields, message) == "bad_message", bad_seed
