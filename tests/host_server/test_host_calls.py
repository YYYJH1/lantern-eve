"""The list of model calls the server host sends to the page.

The core is the one that says what a call costs, so the tests of the money run the real bridge
world with a stand-in that asks for calls on a script (the bridge does not ask for any by itself
yet) and check that what the page is told adds up, frame by frame, to the money in the frame.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from host_helpers import drive_to_tick, make_session

from lantern_core.world.bridge import order, pricing
from lantern_eve.calls import MAX_CALLS, CallTracker, call_cost
from lantern_eve.transport import MockTransport, Transport

ROOT = Path(__file__).resolve().parents[2]
VECTORS = ROOT / "web" / "test" / "support" / "cost-vectors.json"

# One micro-yuan per token on the cheap tier and five on the strong one, and a cap of 0.12 yuan,
# so that the game passes through all three stages of the budget and turns requests away.
GATED = {
    "budget_cap": 120_000,
    "price_cheap_in": 1_000_000,
    "price_cheap_out": 1_000_000,
    "price_strong_in": 5_000_000,
    "price_strong_out": 5_000_000,
}


# --- What a call costs ------------------------------------------------------------------------


def test_the_cost_vectors_of_the_web_client_are_what_the_core_works_out():
    data = json.loads(VECTORS.read_text(encoding="utf-8"))
    assert len(data["vectors"]) > 50
    for prices, tier, tokens_in, tokens_out, cost in data["vectors"]:
        config = data["prices"][prices]
        assert pricing.cost(config, tier, tokens_in, tokens_out) == cost, (prices, tier)
        tokens = {"input_tokens": tokens_in, "output_tokens": tokens_out}
        assert call_cost(config, tier, tokens) == cost


def test_a_game_without_prices_has_no_cost_and_a_local_call_is_free():
    tokens = {"input_tokens": 5000, "output_tokens": 5000}
    assert call_cost({}, "cheap", tokens) is None
    assert call_cost({}, "local", tokens) == 0
    assert call_cost({"price_cheap_in": 3, "price_cheap_out": 7}, "cheap", tokens) == 2


# --- The tracker -------------------------------------------------------------------------------


def request(request_id: str, tier: str = "cheap", **extra: Any) -> dict[str, Any]:
    reserve = {"input_tokens": 96, "output_tokens": 100}
    rate = {"strong": 5, "cheap": 1}.get(tier, 0)
    return {
        "request_id": request_id,
        "tier": tier,
        "messages": [],
        "max_tokens": 100,
        "interaction_id": f"i-{request_id}",
        "issued_tick": 7,
        "category": "reply",
        "reserve": reserve,
        "hold": 196 * rate,
        **extra,
    }


def outputs(tick: int, events: list | None = None, requests: list | None = None) -> dict:
    return {"tick": tick, "events": events or [], "requests": requests or []}


def result(request_id: str, status: str, usage: dict | None, **extra: Any) -> dict[str, Any]:
    body = {
        "request_id": request_id,
        "status": status,
        "text": "",
        "usage": usage,
        "latency_ms": 40,
    }
    return {"seq": 0, "kind": "model_result", "body": body | extra}


def tracker(config: dict | None = None) -> CallTracker:
    return CallTracker(GATED if config is None else config, lambda r: f"model-{r['tier']}")


def test_a_request_that_goes_out_is_listed_with_its_tier_category_hold_and_model():
    calls = tracker()
    [record] = calls.observe(outputs(7, requests=[request("a", "strong", category="director")]), [])
    assert record == {
        "id": "a",
        "tick": 7,
        "category": "director",
        "asked": "strong",
        "tier": "strong",
        "reason": None,
        "model": "model-strong",
        "hold": 980,
        "status": "pending",
        "code": None,
        "latency_ms": None,
        "usage": None,
        "cost": None,
        "settled": None,
        "late": False,
        "voided": None,
    }


def test_the_cost_is_that_of_the_tokens_reported_or_of_the_whole_reservation_when_unknown():
    calls = tracker()
    calls.observe(outputs(7, requests=[request("a"), request("b", "strong")]), [])
    a, b = calls.observe(
        outputs(9),
        [
            result("a", "ok", {"input_tokens": 50, "output_tokens": 20}),
            result("b", "timeout", None, latency_ms=8000),
        ],
    )
    assert (a["status"], a["cost"], a["latency_ms"], a["settled"]) == ("ok", 70, 40, 9)
    assert (b["status"], b["cost"], b["hold"], b["usage"]) == ("timeout", 980, 980, None)


def test_an_error_keeps_its_short_code():
    calls = tracker()
    calls.observe(outputs(1, requests=[request("a")]), [])
    [a] = calls.observe(
        outputs(2), [result("a", "error", {"input_tokens": 0, "output_tokens": 0}, text="http_429")]
    )
    assert (a["status"], a["code"], a["cost"]) == ("error", "http_429", 0)


def test_the_tier_asked_for_and_the_reason_it_moved_come_from_the_downgrade_event():
    calls = tracker()
    moved = {
        "kind": "downgrade",
        "request_id": "a",
        "asked": "strong",
        "tier": "cheap",
        "reason": "budget",
    }
    [a] = calls.observe(outputs(7, [moved], [request("a", "cheap")]), [])
    assert (a["asked"], a["tier"], a["reason"], a["status"]) == (
        "strong",
        "cheap",
        "budget",
        "pending",
    )


def test_a_request_turned_into_a_script_line_is_listed_though_it_never_went_out():
    calls = tracker()
    turned = {
        "kind": "downgrade",
        "request_id": "r12-0",
        "asked": "cheap",
        "tier": "template",
        "reason": "cloud_down",
    }
    [line] = calls.observe(outputs(12, [turned]), [])
    assert (line["status"], line["tier"], line["asked"], line["reason"]) == (
        "template",
        "template",
        "cheap",
        "cloud_down",
    )
    assert (line["cost"], line["hold"], line["model"], line["tick"]) == (0, 0, None, 12)
    named = tracker().observe(outputs(12, [{**turned, "category": "paper"}]), [])
    assert named[0]["category"] == "paper"


def test_an_answer_after_the_request_was_settled_is_late_and_books_nothing():
    calls = tracker()
    calls.observe(outputs(1, requests=[request("a")]), [])
    calls.observe(outputs(3), [result("a", "timeout", None)])
    unknown = {"kind": "void", "request_id": "a", "status": "ok", "reason": "unknown_request"}
    [late] = calls.observe(
        outputs(6, [unknown]), [result("a", "ok", {"input_tokens": 9, "output_tokens": 9})]
    )
    assert (late["status"], late["cost"], late["late"]) == ("timeout", 196, True)
    assert calls.observe(outputs(7), [result("a", "ok", None)]) == []


def test_an_answer_the_core_threw_away_is_marked_though_it_was_booked():
    calls = tracker()
    calls.observe(outputs(1, requests=[request("a"), request("b")]), [])
    voids = [
        {"kind": "void", "request_id": "a", "status": "ok", "reason": "cancelled"},
        {"kind": "void", "request_id": "b", "status": "ok", "reason": "invalid"},
    ]
    done = calls.observe(
        outputs(3, voids),
        [
            result("a", "ok", {"input_tokens": 4, "output_tokens": 4}),
            result("b", "ok", {"input_tokens": 5, "output_tokens": 5}),
        ],
    )
    assert [(c["id"], c["voided"], c["cost"], c["late"]) for c in done] == [
        ("a", "cancelled", 8, False),
        ("b", "invalid", 10, False),
    ]


def test_a_result_for_a_request_never_seen_is_not_listed():
    calls = tracker()
    assert calls.observe(outputs(3), [result("ghost", "ok", None)]) == []
    assert calls.snapshot() == []


def test_a_game_without_prices_lists_calls_with_no_cost():
    calls = tracker({})
    calls.observe(outputs(1, requests=[request("a"), request("b", "local")]), [])
    a, b = calls.observe(
        outputs(2),
        [
            result("a", "ok", {"input_tokens": 3, "output_tokens": 3}),
            result("b", "ok", {"input_tokens": 3, "output_tokens": 3}),
        ],
    )
    assert a["cost"] is None
    assert (b["cost"], b["tier"]) == (0, "local")


def test_the_newest_calls_are_kept_and_the_records_handed_out_are_copies():
    calls = tracker()
    for i in range(MAX_CALLS + 5):
        calls.observe(outputs(i, requests=[request(f"c{i}")]), [])
    kept = calls.snapshot()
    assert len(kept) == MAX_CALLS
    assert (kept[0]["id"], kept[-1]["id"]) == ("c5", f"c{MAX_CALLS + 4}")
    kept[0]["status"] = "ok"
    assert calls.snapshot()[0]["status"] == "pending"


# --- The server host with the real core ---------------------------------------------------------


def install_asker(monkeypatch: pytest.MonkeyPatch) -> None:
    """A stand-in for the part of the bridge world that will ask a model, asking on a script."""

    def init(world: Any, rng: Any) -> dict[str, Any]:
        return {"asked": 0, "ending": None}

    def tick(sim: Any) -> None:
        now = sim.ctx.tick
        if now % 9 != 1:
            return
        mix = now * 2654435761 % 4294967296
        sim.ctx.issue(
            interaction_id=f"i{now}",
            tier="strong" if mix % 5 == 0 else "cheap",
            category="probe",
            messages=[{"role": "user", "content": "x" * (200 + mix % 3000)}],
            max_tokens=50 + mix % 400,
            valid_if=[],
        )
        sim.state["goals"]["asked"] += 1

    def land(sim: Any, request: dict[str, Any], status: str, text: str) -> None:
        return None

    stand_in = SimpleNamespace(SECTION="goals", init=init, tick=tick, RESULTS={"probe": land})
    rest = tuple(m for m in order.SUBSYSTEMS if m.SECTION not in ("goals", "social"))
    monkeypatch.setattr(order, "SUBSYSTEMS", (*rest[:-1], stand_in, rest[-1]))


class Scripted(MockTransport):
    """The mock model, and a host that reports on the cloud and the local model at set ticks."""

    SCRIPT = {
        400: "cloud_down",
        700: "local_up",
        1100: "cloud_up",
        1500: "local_down",
        2200: "cloud_down",
    }

    def __init__(self, seed: int) -> None:
        super().__init__(seed, timeout_per_mille=150, error_per_mille=60)
        self.script = sorted(self.SCRIPT.items())

    def host_events(self, tick: int) -> list[str]:
        out: list[str] = []
        while self.script and self.script[0][0] <= tick:
            out.append(self.script.pop(0)[1])
        return out

    def model_of(self, request: Any) -> str | None:
        return None if request["tier"] == "local" else f"mock-{request['tier']}"


def play_gated(monkeypatch: pytest.MonkeyPatch, ticks: int = 3000, seed: int = 11):
    install_asker(monkeypatch)
    session, clock, messages = make_session(
        seed, config=GATED, factory=lambda spec: Scripted(spec.seed), scenario="bridge"
    )
    drive_to_tick(session, clock, ticks)
    return session, messages


def test_what_the_page_is_told_adds_up_to_the_money_in_every_frame(monkeypatch):
    _, messages = play_gated(monkeypatch)
    records: dict[str, dict[str, Any]] = {}
    frames = 0
    for message in messages:
        if message["type"] == "model-calls":
            assert message["replace"] is False and message["calls"]
            for call in message["calls"]:
                records[call["id"]] = call
        elif message["type"] == "frame":
            frames += 1
            hud = message["frame"]["hud"]
            booked = sum(c["cost"] or 0 for c in records.values() if c["status"] != "pending")
            held = sum(c["hold"] or 0 for c in records.values() if c["status"] == "pending")
            assert booked == hud["spent"], (message["tick"], booked, hud["spent"])
            assert held == hud["held"], (message["tick"], held, hud["held"])
    assert frames >= 3000

    # The run covered what the list has to say about: every outcome, a call moved down for
    # each reason, a line from the script, an answer that came late, and every stage of the budget.
    listed = list(records.values())
    assert {"ok", "timeout", "template", "error"} <= {c["status"] for c in listed}
    assert {"budget", "cloud_down"} <= {c["reason"] for c in listed}
    assert any(c["asked"] != c["tier"] and c["status"] != "template" for c in listed)
    assert any(c["late"] for c in listed)
    assert any(c["tier"] == "local" for c in listed)
    stages = {m["frame"]["hud"]["stage"] for m in messages if m["type"] == "frame"}
    assert stages == {0, 1, 2}
    assert all(c["model"] is None for c in listed if c["tier"] in ("template", "local"))
    assert all(
        c["model"] == f"mock-{c['tier']}" for c in listed if c["tier"] in ("cheap", "strong")
    )


def test_the_calls_are_listed_before_the_frame_that_shows_their_money(monkeypatch):
    _, messages = play_gated(monkeypatch, ticks=600)
    kinds = [m["type"] for m in messages]
    for at, kind in enumerate(kinds):
        if kind == "model-calls":
            nxt = next(k for k in kinds[at + 1 :] if k != "ack")
            assert nxt == "frame"


def test_the_state_a_page_gets_back_has_the_list(monkeypatch):
    session, messages = play_gated(monkeypatch, ticks=1500)
    state = session.state_message()
    assert json.loads(json.dumps(state))["calls"] == session.tracker.snapshot()
    assert 0 < len(state["calls"]) <= MAX_CALLS
    streamed = {c["id"]: c for m in messages if m["type"] == "model-calls" for c in m["calls"]}
    # The list in the state is the latest word on each call it holds.
    for call in state["calls"]:
        assert streamed[call["id"]] == call


def test_a_demo_world_game_has_calls_without_money():
    session, clock, messages = make_session(5)
    drive_to_tick(session, clock, 600)
    calls = [c for m in messages if m["type"] == "model-calls" for c in m["calls"]]
    assert calls
    assert {c["category"] for c in calls} == {"chatter"}
    assert all(c["cost"] is None and c["model"] is None for c in calls)
    assert isinstance(session.transport, Transport)
