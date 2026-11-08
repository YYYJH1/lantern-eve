"""The kernel's contract: validation, the order of a call, pause, actions, results, the ledger."""

import json
import re

import pytest
from core_helpers import call, first_request, rec, result, run_until

from lantern_core import canon
from lantern_core.api import HASH_EVERY, Game, InputError
from lantern_core.kernel import Ctx, Kernel

OUTPUT_KEYS = {"tick", "advanced", "frame", "events", "requests", "cancels", "clock"}


def summon(npc="npc00", x=4, y=7, action_id="a1"):
    return {"action_id": action_id, "type": "summon", "npc": npc, "x": x, "y": y}


def ledger(game):
    return json.loads(game.ledger_json())


# ------------------------------------------------------------------------- the contract


def test_a_signal_is_an_event_in_the_outputs_that_the_state_does_not_count():
    kernel = Kernel.create(1, "m0", None)
    ctx = Ctx(kernel)
    ctx.emit("counted", n=1)
    ctx.signal("not_counted", n=2)
    ctx.emit("counted_again")
    assert [event["kind"] for event in ctx.events] == ["counted", "not_counted", "counted_again"]
    assert ctx.events[1] == {"kind": "not_counted", "tick": 0, "n": 2}
    assert kernel.state["version"] == 2  # the signal is in the outputs and not in the state
    assert kernel.ending() is None  # a scenario without endings has none


def test_outputs_have_the_documented_keys_and_types():
    game = Game(1)
    out = call(game)
    assert set(out) >= OUTPUT_KEYS
    assert out["tick"] == 0 and out["advanced"] is True and game.tick == 1
    assert out["clock"] == {"paused": False, "rate": [1, 1]}
    assert out["events"] == [] and out["requests"] == [] and out["cancels"] == []
    npcs = out["frame"]["npcs"]
    assert len(npcs) == 12
    for npc in npcs:
        assert set(npc) == {"id", "x", "y"}
        assert isinstance(npc["id"], str)
        assert type(npc["x"]) is int and type(npc["y"]) is int


def test_the_hash_is_present_exactly_on_simulated_multiples_of_100():
    game = Game(2)
    for tick in range(250):
        out = call(game)
        assert out["tick"] == tick
        assert ("hash" in out) == (tick % HASH_EVERY == 0)


def test_a_paused_call_at_a_multiple_of_100_has_no_hash():
    game = Game(2)
    for _ in range(100):
        call(game)
    assert game.tick == 100
    paused = call(game, rec(0, "pause"))
    assert paused["tick"] == 100 and paused["advanced"] is False and "hash" not in paused
    resumed = call(game, rec(1, "resume"))
    assert resumed["advanced"] is True and resumed["hash"] == game.hash()


def test_hash_in_the_outputs_is_the_hash_after_the_tick():
    game = Game(3)
    out = call(game)
    assert out["hash"] == game.hash()
    assert game.last_hash == out["hash"]


def test_frame_has_the_clock_of_the_town():
    game = Game(4)
    first = call(game)
    assert first["frame"]["time"] == {"day": 1, "hour": 6, "minute": 0}
    for _ in range(149):
        out = call(game)
    assert game.tick == 150
    assert out["frame"]["time"] == {"day": 1, "hour": 7, "minute": 0}
    while game.tick < 1800:
        out = call(game)
    assert out["frame"]["time"] == {"day": 2, "hour": 6, "minute": 0}


def test_the_scene_describes_the_map_for_the_client():
    scene = json.loads(Game(1).scene_json())
    assert (scene["width"], scene["height"]) == (48, 32)
    assert len(scene["rows"]) == 32 and all(len(r) == 48 for r in scene["rows"])
    assert set("".join(scene["rows"])) <= set(scene["legend"])
    assert [n["id"] for n in scene["npcs"]] == [f"npc{i:02d}" for i in range(12)]
    assert scene["day_ticks"] == 1800 and scene["ticks_per_hour"] == 150


def test_the_header_names_everything_a_replay_needs():
    game = Game(77, config={"chat_window": 90})
    header = game.header()
    assert header["format"] == 1 and header["scenario"] == "m0" and header["seed"] == 77
    assert header["config"]["chat_window"] == 90
    assert re.fullmatch(r"[0-9a-f]{64}", header["content_hash"])
    assert header["core_version"]
    canon.check(header)


# ------------------------------------------------------------------------- validation


def test_seq_must_increase_within_and_across_calls():
    game = Game(5)
    call(game, rec(0, "pause"), rec(1, "resume"))
    for bad in (
        [rec(1, "pause")],
        [rec(2, "pause"), rec(2, "resume")],
        [rec(5, "pause"), rec(4, "resume")],
    ):
        before = game.snapshot_json()
        with pytest.raises(InputError):
            call(game, *bad)
        assert game.snapshot_json() == before
    call(game, rec(7, "pause"))  # gaps are fine
    with pytest.raises(InputError):
        call(game, rec(7, "resume"))
    call(game, rec(8, "resume"))


BAD_RECORDS = [
    "not a record",
    {"kind": "pause"},
    {"seq": 0},
    {"seq": True, "kind": "pause"},
    {"seq": -1, "kind": "pause"},
    {"seq": 0, "kind": "teleport"},
    {"seq": 0, "kind": 7},
    {"seq": 0, "kind": "pause", "body": "x"},
    {"seq": 0, "kind": "pause", "body": {"extra": 1}},
    {"seq": 0, "kind": "resume", "body": {"extra": 1}},
    {"seq": 0, "kind": "player", "body": {}},
    {"seq": 0, "kind": "player", "body": {"action_id": ""}},
    {"seq": 0, "kind": "player", "body": {"action_id": "a", "type": "fly"}},
    {"seq": 0, "kind": "player", "body": summon(npc="npc99")},
    {"seq": 0, "kind": "player", "body": summon(x=48)},
    {"seq": 0, "kind": "player", "body": summon(y=-1)},
    {"seq": 0, "kind": "player", "body": {**summon(), "x": True}},
    {"seq": 0, "kind": "player", "body": {**summon(), "action_id": "x" * 65}},
    {"seq": 0, "kind": "model_result", "body": {}},
    {"seq": 0, "kind": "model_result", "body": result("r0-0", status="done")},
    {"seq": 0, "kind": "model_result", "body": {**result("r0-0"), "text": 5}},
    {"seq": 0, "kind": "model_result", "body": {**result("r0-0"), "usage": 5}},
    {
        "seq": 0,
        "kind": "model_result",
        "body": {**result("r0-0"), "usage": {"input_tokens": -1, "output_tokens": 0}},
    },
    {"seq": 0, "kind": "model_result", "body": {**result("r0-0"), "usage": {"input_tokens": 1}}},
    {"seq": 0, "kind": "model_result", "body": {**result("r0-0"), "latency_ms": -5}},
    {"seq": 0, "kind": "model_result", "body": {**result("r0-0"), "latency_ms": True}},
    {"seq": 0, "kind": "model_result", "body": {**result("r0-0"), "text": "半个字\ud800"}},
    {"seq": 0, "kind": "model_result", "body": result("r\udfff-0")},
    {"seq": 0, "kind": "player", "body": {**summon(), "action_id": "\ud83d"}},
]


@pytest.mark.parametrize("record", BAD_RECORDS, ids=range(len(BAD_RECORDS)))
def test_a_bad_record_is_refused_and_changes_nothing(record):
    game = Game(6)
    before = game.snapshot_json()
    with pytest.raises(InputError):
        game.step(json.dumps([record]))
    assert game.snapshot_json() == before


@pytest.mark.parametrize(
    "text", ["{}", "5", '"pause"', "null", "[1.5]", "[NaN]", "nonsense", "", "[" * 100_000]
)
def test_input_that_is_not_a_list_of_canonical_json_is_an_input_error(text):
    game = Game(6)
    before = game.snapshot_json()
    with pytest.raises(InputError):
        game.step(text)
    assert game.snapshot_json() == before


def test_an_unknown_kind_is_an_error_even_after_valid_records():
    game = Game(6)
    before = game.snapshot_json()
    with pytest.raises(InputError, match="unknown kind 'cheat'"):
        call(game, rec(0, "pause"), rec(1, "cheat"))
    assert game.snapshot_json() == before and not game.paused


def test_extra_keys_from_the_host_are_ignored_and_not_logged():
    game = Game(6)
    out = game.step(json.dumps([{"seq": 0, "kind": "pause", "body": {}, "tick": 99, "note": "x"}]))
    assert json.loads(out)["clock"]["paused"] is True
    assert game.last_inputs == [{"seq": 0, "kind": "pause", "body": {}}]
    body = {**result("r0-0", status="timeout"), "model": "some-model"}
    game.step(json.dumps([{"seq": 1, "kind": "model_result", "body": body}]))
    assert "model" not in game.last_inputs[0]["body"]


def test_missing_optional_result_fields_get_defaults():
    game = Game(6)
    game.step(
        json.dumps(
            [
                {
                    "seq": 0,
                    "kind": "model_result",
                    "body": {"request_id": "r9-9", "status": "timeout"},
                }
            ]
        )
    )
    assert game.last_inputs[0]["body"] == {
        "request_id": "r9-9",
        "status": "timeout",
        "text": "",
        "usage": None,
        "latency_ms": 0,
    }


@pytest.mark.parametrize("seed", [-1, 2**53, 1.5, True, "7", None])
def test_bad_seeds_are_refused(seed):
    with pytest.raises(ValueError):
        Game(seed)


@pytest.mark.parametrize(
    "config",
    [
        {"nope": 1},
        {"move_period": 0},
        {"move_period": 1.5},
        {"chatter_per_mille": 1001},
        {"ticks_per_hour": 99},
        {"max_in_flight": True},
    ],
)
def test_bad_config_is_refused(config):
    with pytest.raises(ValueError):
        Game(1, config=config)


def test_an_unknown_scenario_is_refused():
    with pytest.raises(ValueError, match="unknown scenario"):
        Game(1, scenario="m9")


# ------------------------------------------------------------------------- pause and resume


def test_pause_holds_the_tick_and_resume_continues_it():
    game = Game(8)
    for _ in range(10):
        call(game)
    paused = call(game, rec(0, "pause"))
    assert (paused["tick"], paused["advanced"], paused["clock"]["paused"]) == (10, False, True)
    frame = paused["frame"]
    held = game.hash()
    for _ in range(5):
        again = call(game)
        assert (again["tick"], again["advanced"]) == (10, False)
        assert again["frame"] == frame
        assert game.hash() == held
    resumed = call(game, rec(1, "resume"))
    assert (resumed["tick"], resumed["advanced"], resumed["clock"]["paused"]) == (10, True, False)
    assert game.tick == 11


def test_pause_and_resume_in_one_call_still_simulates_the_tick():
    game = Game(8)
    out = call(game, rec(0, "pause"), rec(1, "resume"))
    assert out["advanced"] is True and game.tick == 1
    out = call(game, rec(2, "resume"))  # resume on a running world is harmless
    assert out["advanced"] is True


def test_pausing_twice_is_harmless():
    game = Game(8)
    call(game, rec(0, "pause"))
    call(game, rec(1, "pause"))
    assert game.paused and game.tick == 0


def test_a_world_that_holds_its_own_clock_is_stopped_whatever_the_host_says(monkeypatch):
    """``halted`` is the world's own stop: the host's ``resume`` does not lift it, and an input
    that does lift it starts the world in the very call that carries it."""
    from lantern_core.world.m0 import M0World

    monkeypatch.setattr(
        M0World, "halted", lambda self, state: state["world"].get("hold", False), raising=False
    )
    applied = M0World.apply_player

    def lift(self, ctx, body):  # a player action ends the hold, as an act that is paid for would
        ctx.state["world"].pop("hold", None)
        applied(self, ctx, body)

    monkeypatch.setattr(M0World, "apply_player", lift)
    game = Game(8)
    call(game)
    game._kernel.state["world"]["hold"] = True
    assert game.paused and not game._kernel.state["paused"]
    out = call(game)
    assert (out["tick"], out["advanced"], out["clock"]["paused"]) == (1, False, True)
    held = json.dumps(game._kernel.state["world"], sort_keys=True)
    call(game, rec(0, "pause"))
    # the host lets go of its own pause, and the hold is the world's
    out = call(game, rec(1, "resume"))
    assert (out["advanced"], out["clock"]["paused"]) == (False, True)
    assert json.dumps(game._kernel.state["world"], sort_keys=True) == held
    assert not game._kernel.state["paused"] and game.tick == 1
    restored = Game.from_snapshot_json(game.snapshot_json())  # it is in the state
    assert restored.paused and call(restored)["advanced"] is False
    out = call(game, rec(2, "player", summon()))
    assert (out["advanced"], out["clock"]["paused"], game.tick) == (True, False, 2)


def test_inputs_applied_while_paused_take_effect_without_a_tick():
    game = Game(9)
    call(game, rec(0, "pause"))
    out = call(game, rec(1, "player", summon()))
    assert out["advanced"] is False and game.tick == 0
    assert [e["result"] for e in out["events"] if e["kind"] == "action_ack"] == ["applied"]


def test_one_call_with_all_of_a_ticks_inputs_equals_the_calls_a_host_made_while_paused():
    live, replayed = Game(10), Game(10)
    for game in (live, replayed):
        for _ in range(20):
            call(game)
    call(live, rec(0, "pause"))
    call(live)
    call(live, rec(1, "player", summon(action_id="p1")))
    call(live, rec(2, "player", summon(npc="npc05", x=9, y=7, action_id="p2")))
    call(live, rec(3, "resume"))
    call(
        replayed,
        rec(0, "pause"),
        rec(1, "player", summon(action_id="p1")),
        rec(2, "player", summon(npc="npc05", x=9, y=7, action_id="p2")),
        rec(3, "resume"),
    )
    assert live.tick == replayed.tick == 21
    assert live.snapshot_json() == replayed.snapshot_json()


# ------------------------------------------------------------------------- player actions


def test_an_action_id_acts_once():
    game = Game(11)
    first = call(game, rec(0, "player", summon(action_id="same", x=4, y=7)))
    assert [(e["result"], e["reason"]) for e in first["events"] if e["kind"] == "action_ack"] == [
        ("applied", None)
    ]
    before = game.snapshot_json()
    again = call(game, rec(1, "player", summon(action_id="same", x=20, y=20)))
    acks = [e for e in again["events"] if e["kind"] == "action_ack"]
    assert [(a["action_id"], a["result"]) for a in acks] == [("same", "duplicate")]
    state = json.loads(game.snapshot_json())["world"]["npcs"][0]
    assert state["goal"] == [4, 7]
    assert json.loads(before)["actions_seen"] == {"same": 0}


def test_a_summoned_npc_walks_there_waits_and_goes_back():
    game = Game(12, config={"summon_hold": 200, "fidget_per_mille": 0, "detour_per_mille": 0})
    call(game, rec(0, "player", summon(npc="npc02", x=16, y=7)))
    positions = []
    for _ in range(400):
        out = call(game)
        npc = next(n for n in out["frame"]["npcs"] if n["id"] == "npc02")
        positions.append((npc["x"], npc["y"]))
    assert (16, 7) in positions[:150]
    first_there = positions.index((16, 7))
    assert all(p == (16, 7) for p in positions[first_there : first_there + 100])
    state = json.loads(game.snapshot_json())["world"]["npcs"][2]
    assert state["hold"] == 0 and state["goal"] == state["sched"]


@pytest.mark.parametrize(
    ("x", "y", "reason"), [(22, 5, "blocked"), (3, 4, "blocked"), (46, 29, "unreachable")]
)
def test_an_action_that_cannot_be_carried_out_is_rejected_not_an_error(x, y, reason):
    game = Game(13)
    out = call(game, rec(0, "player", summon(x=x, y=y)))
    ack = next(e for e in out["events"] if e["kind"] == "action_ack")
    assert (ack["result"], ack["reason"]) == ("rejected", reason)
    assert json.loads(game.snapshot_json())["world"]["npcs"][0]["hold"] == 0


# ------------------------------------------------------------------------- model requests


def test_a_chatter_request_has_everything_the_contract_names():
    game = Game(14)
    request = first_request(game)
    assert re.fullmatch(r"r\d+-\d+", request["request_id"])
    assert request["tier"] == "cheap" and request["category"] == "chatter"
    assert 1 <= request["max_tokens"] <= 64
    assert request["issued_tick"] == game.tick - 1
    assert request["request_id"] == f"r{request['issued_tick']}-0"
    assert type(request["state_version"]) is int
    messages = request["messages"]
    assert 1 <= len(messages) <= 3
    assert all(set(m) == {"role", "content"} and m["role"] in ("system", "user") for m in messages)
    assert all(isinstance(m["content"], str) and m["content"] for m in messages)
    ops = {c["op"] for c in request["valid_if"]}
    assert ops == {"adjacent", "open"}
    interaction = next(c["interaction_id"] for c in request["valid_if"] if c["op"] == "open")
    assert interaction == request["interaction_id"]
    reserve = request["reserve"]
    assert reserve["output_tokens"] == request["max_tokens"]
    assert reserve["input_tokens"] >= sum(len(m["content"].encode()) for m in messages)
    canon.check(request)


def test_request_ids_and_interaction_ids_are_unique():
    game = Game(
        15, config={"encounter_cooldown": 100, "chatter_per_mille": 1000, "max_in_flight": 50}
    )
    ids, interactions = [], []
    for _ in range(1500):
        out = call(game)
        ids += [r["request_id"] for r in out["requests"]]
        interactions += [r["interaction_id"] for r in out["requests"]]
    assert len(ids) > 20
    assert len(set(ids)) == len(ids) and len(set(interactions)) == len(interactions)


def test_requests_in_flight_never_exceed_the_cap():
    game = Game(
        16, config={"max_in_flight": 2, "encounter_cooldown": 100, "chatter_per_mille": 1000}
    )
    peak = 0
    for _ in range(1500):
        call(game)
        peak = max(peak, len(game.in_flight()))
    assert peak == 2


def test_an_ok_result_is_shown_as_chatter_and_booked():
    game = Game(17)
    request = first_request(game)
    usage = {"input_tokens": 120, "output_tokens": 9}
    out = call(
        game,
        rec(0, "model_result", result(request["request_id"], text=" 好茶，好茶。 ", usage=usage)),
    )
    chatter = [e for e in out["events"] if e["kind"] == "chatter"]
    assert [(e["text"], e["source"], e["interaction_id"]) for e in chatter] == [
        ("好茶，好茶。", "model", request["interaction_id"])
    ]
    ends = [e for e in out["events"] if e["kind"] == "interaction_end"]
    assert [e["outcome"] for e in ends] == ["chatted"]
    entry = ledger(game)["cheap"]
    assert (entry["issued"], entry["settled"], entry["ok"], entry["voided"]) == (1, 1, 1, 0)
    assert (entry["input_tokens"], entry["output_tokens"]) == (120, 9)
    assert game.in_flight() == []


@pytest.mark.parametrize("status", ["timeout", "error"])
def test_a_timeout_or_error_becomes_a_template_line_and_charges_the_reservation(status):
    game = Game(17)
    request = first_request(game)
    out = call(game, rec(0, "model_result", result(request["request_id"], status=status, text="")))
    chatter = [e for e in out["events"] if e["kind"] == "chatter"]
    assert len(chatter) == 1 and chatter[0]["source"] == "template" and chatter[0]["text"]
    entry = ledger(game)["cheap"]
    assert entry[status] == 1 and entry["voided"] == 0
    assert entry["input_tokens"] == request["reserve"]["input_tokens"]
    assert entry["output_tokens"] == request["reserve"]["output_tokens"]


def test_known_usage_is_charged_even_on_a_timeout():
    game = Game(17)
    request = first_request(game)
    usage = {"input_tokens": 50, "output_tokens": 0}
    call(game, rec(0, "model_result", result(request["request_id"], status="timeout", usage=usage)))
    assert (ledger(game)["cheap"]["input_tokens"], ledger(game)["cheap"]["output_tokens"]) == (
        50,
        0,
    )


def test_an_ok_result_with_no_text_falls_back_to_the_template():
    game = Game(17)
    request = first_request(game)
    out = call(game, rec(0, "model_result", result(request["request_id"], text="   ")))
    chatter = [e for e in out["events"] if e["kind"] == "chatter"]
    assert [e["source"] for e in chatter] == ["template"]


def test_a_long_line_is_cut():
    game = Game(17)
    request = first_request(game)
    out = call(game, rec(0, "model_result", result(request["request_id"], text="长" * 500)))
    line = next(e["text"] for e in out["events"] if e["kind"] == "chatter")
    assert line == "长" * 80


def test_a_cancelled_result_closes_the_chat_without_a_line():
    game = Game(17)
    request = first_request(game)
    body = result(request["request_id"], status="cancelled", text="")
    out = call(game, rec(0, "model_result", body))
    assert not [e for e in out["events"] if e["kind"] == "chatter"]
    assert [e["outcome"] for e in out["events"] if e["kind"] == "interaction_end"] == ["cancelled"]
    entry = ledger(game)["cheap"]
    assert entry["cancelled"] == 1 and entry["voided"] == 0
    assert entry["input_tokens"] == request["reserve"]["input_tokens"]


def test_a_result_for_a_request_that_is_not_in_flight_is_voided_and_unattributed():
    game = Game(18)
    out = call(
        game,
        rec(0, "model_result", result("r999-0", usage={"input_tokens": 30, "output_tokens": 4})),
    )
    voids = [e for e in out["events"] if e["kind"] == "void"]
    assert [(v["request_id"], v["reason"], v["status"]) for v in voids] == [
        ("r999-0", "unknown_request", "ok")
    ]
    assert ledger(game)["unattributed"] == {"results": 1, "input_tokens": 30, "output_tokens": 4}
    assert ledger(game)["cheap"]["settled"] == 0


def test_the_same_result_twice_applies_once():
    game = Game(19)
    request = first_request(game)
    body = result(request["request_id"])
    first = call(game, rec(0, "model_result", body))
    second = call(game, rec(1, "model_result", body))
    assert len([e for e in first["events"] if e["kind"] == "chatter"]) == 1
    assert [e["reason"] for e in second["events"] if e["kind"] == "void"] == ["unknown_request"]
    assert not [e for e in second["events"] if e["kind"] == "chatter"]


def test_a_result_that_lands_while_paused_is_applied_without_a_tick():
    game = Game(20)
    request = first_request(game)
    call(game, rec(0, "pause"))
    tick = game.tick
    out = call(game, rec(1, "model_result", result(request["request_id"])))
    assert out["advanced"] is False and game.tick == tick
    assert [e["source"] for e in out["events"] if e["kind"] == "chatter"] == ["model"]


def test_a_cancel_is_sent_once_and_the_result_that_still_lands_is_voided():
    game = Game(21)
    cancelled = []
    pending = {}
    for _ in range(2500):
        out = call(game)
        cancelled += out["cancels"]
        for request in out["requests"]:
            pending[request["request_id"]] = request
        if out["cancels"]:
            break
    assert cancelled, "no pair parted within 2500 ticks"
    for _ in range(300):
        cancelled += call(game)["cancels"]
    assert len(set(cancelled)) == len(cancelled)
    request_id = cancelled[0]
    assert request_id in game.in_flight()
    before = ledger(game)["cheap"]
    out = call(game, rec(0, "model_result", result(request_id)))
    voids = [e for e in out["events"] if e["kind"] == "void"]
    assert [(v["request_id"], v["reason"]) for v in voids] == [(request_id, "cancelled")]
    assert not [e for e in out["events"] if e["kind"] == "chatter"]
    after = ledger(game)["cheap"]
    assert after["voided"] == before["voided"] + 1 and after["ok"] == before["ok"] + 1
    assert after["input_tokens"] == before["input_tokens"] + 120


def test_the_cancelled_confirmation_of_a_cancel_is_not_a_void():
    game = Game(21)
    out = run_until(game, lambda o: bool(o["cancels"]))
    request_id = out["cancels"][0]
    confirmed = call(game, rec(0, "model_result", result(request_id, status="cancelled", text="")))
    assert not [e for e in confirmed["events"] if e["kind"] == "void"]
    assert request_id not in game.in_flight()
    entry = ledger(game)["cheap"]
    assert entry["cancelled"] == 1 and entry["voided"] == 0


def test_a_result_is_checked_against_its_conditions_when_it_lands():
    game = Game(22, config={"fidget_per_mille": 0, "detour_per_mille": 0})
    request = first_request(game)
    pair = next(c for c in request["valid_if"] if c["op"] == "adjacent")
    state = json.loads(game.snapshot_json())
    moved = next(n for n in state["world"]["npcs"] if n["id"] == pair["b"])
    moved["x"], moved["y"] = (moved["x"] + 10) % 48, (moved["y"] + 10) % 32
    tampered = Game.from_snapshot_json(canon.dumps_str(state))
    out = call(tampered, rec(0, "model_result", result(request["request_id"])))
    voids = [e for e in out["events"] if e["kind"] == "void"]
    assert [(v["request_id"], v["reason"]) for v in voids] == [(request["request_id"], "invalid")]
    assert not [e for e in out["events"] if e["kind"] == "chatter"]
    assert ledger(tampered)["cheap"]["voided"] == 1


def test_a_settled_chat_makes_a_second_result_invalid():
    game = Game(23)
    request = first_request(game)
    state = json.loads(game.snapshot_json())
    state["world"]["interactions"] = []
    tampered = Game.from_snapshot_json(canon.dumps_str(state))
    out = call(tampered, rec(0, "model_result", result(request["request_id"])))
    assert [v["reason"] for v in out["events"] if v["kind"] == "void"] == ["invalid"]


def test_every_issued_request_is_either_in_flight_or_settled():
    game = Game(24, config={"encounter_cooldown": 150, "chatter_per_mille": 900})
    for tick in range(3000):
        call(game)
        if tick % 7 == 0 and game.in_flight():
            call(game, rec(game.next_seq, "model_result", result(game.in_flight()[0])))
    entry = ledger(game)["cheap"]
    assert entry["issued"] > 30
    assert entry["issued"] == entry["settled"] + len(game.in_flight())
    assert entry["settled"] == entry["ok"] + entry["timeout"] + entry["cancelled"] + entry["error"]


# ------------------------------------------------------------------------- snapshots


def test_the_snapshot_is_canonical_and_restores_the_same_state():
    game = Game(25)
    for _ in range(400):
        call(game)
    text = game.snapshot_json()
    assert canon.dumps_str(canon.loads(text)) == text
    restored = Game.from_snapshot_json(text)
    assert restored.hash() == game.hash() and restored.snapshot_json() == text
    assert restored.tick == game.tick and restored.next_seq == game.next_seq


def test_the_rng_state_is_two_hex_strings():
    state = json.loads(Game(26).snapshot_json())
    assert set(state["rng"]) == {"state", "inc"}
    assert all(re.fullmatch(r"[0-9a-f]{16}", v) for v in state["rng"].values())


@pytest.mark.parametrize(
    "edit",
    [
        lambda s: s.update(format=2),
        lambda s: s.pop("format"),
        lambda s: s.update(content_hash="0" * 64),
        lambda s: s.update(scenario="m9"),
        lambda s: s["rng"].update(inc="0000000000000002"),
    ],
)
def test_a_snapshot_that_does_not_fit_is_refused(edit):
    state = json.loads(Game(27).snapshot_json())
    edit(state)
    with pytest.raises(ValueError):
        Game.from_snapshot_json(canon.dumps_str(state))


def test_a_snapshot_that_is_not_an_object_is_refused():
    with pytest.raises(ValueError):
        Game.from_snapshot_json("[]")


def test_the_state_never_holds_a_float():
    game = Game(28)
    for _ in range(300):
        call(game)
    canon.check(json.loads(game.snapshot_json()))
