"""The model transport interface and the deterministic mock."""

import json

from lantern_core import canon
from lantern_core.api import Game
from lantern_eve.transport import LINES, MockTransport, ModelOutcome, Transport


def request(n: int, tick: int = 0, max_tokens: int = 48) -> dict:
    messages = [{"role": "user", "content": "你好"}]
    return {"request_id": f"r{tick}-{n}", "messages": messages, "max_tokens": max_tokens}


def drain(
    transport: MockTransport, start: int = 0, ticks: int = 300
) -> list[tuple[int, ModelOutcome]]:
    """Every outcome that arrives from tick ``start`` on, with the tick it arrived at."""
    return [(t, o) for t in range(start, start + ticks) for o in transport.poll(t)]


def test_the_same_seed_gives_the_same_answers_and_another_seed_does_not():
    def run(seed):
        mock = MockTransport(seed)
        for n in range(30):
            mock.start(request(n), 0)
        return drain(mock)

    assert run(1) == run(1)
    assert run(1) != run(2)


def test_nothing_arrives_before_its_tick_and_polls_consume():
    mock = MockTransport(3, min_delay=5, max_delay=5, error_per_mille=0, timeout_per_mille=0)
    mock.start(request(1), 10)
    assert [mock.poll(t) for t in range(10, 15)] == [[]] * 5
    (outcome,) = mock.poll(15)
    assert outcome.status == "ok" and outcome.request_id == "r0-1"
    assert mock.poll(15) == [] and mock.poll(99) == []


def test_bodies_are_canonical_and_the_core_accepts_them():
    mock = MockTransport(4)
    for n in range(60):
        mock.start(request(n), 0)
    outcomes = [o for _, o in drain(mock, ticks=400)]
    assert {o.status for o in outcomes} == {"ok", "error", "timeout"}
    game = Game(1)
    records = [{"seq": i, "kind": "model_result", "body": o.body()} for i, o in enumerate(outcomes)]
    for record in records:
        canon.check(record["body"])
        assert set(record["body"]) == {"request_id", "status", "text", "usage", "latency_ms"}
    game.step(json.dumps(records))  # no InputError: the core takes every body


def test_ok_carries_text_and_usage_and_the_others_carry_no_usage():
    mock = MockTransport(5, timeout_per_mille=400, error_per_mille=200)
    for n in range(80):
        mock.start(request(n), 0)
    by_status: dict[str, list[ModelOutcome]] = {}
    for _, outcome in drain(mock, ticks=500):
        by_status.setdefault(outcome.status, []).append(outcome)
    assert all(o.text in LINES and o.usage["output_tokens"] >= 1 for o in by_status["ok"])
    assert all(o.usage is None for o in by_status["timeout"] + by_status["error"])
    assert all(o.text == "" for o in by_status["timeout"])


def test_a_request_gets_one_answer_unless_it_timed_out_and_the_late_one_follows():
    mock = MockTransport(4, timeout_per_mille=1000, late_per_mille=1000, error_per_mille=0)
    mock.start(request(1), 0)
    assert [o.status for _, o in drain(mock)] == ["timeout", "ok"]
    mock = MockTransport(4, timeout_per_mille=0, error_per_mille=0)
    for n in range(25):
        mock.start(request(n), 0)
    ids = [o.request_id for _, o in drain(mock)]
    assert sorted(ids) == sorted(f"r0-{n}" for n in range(25))


def test_a_cancel_is_honoured_or_arrives_too_late_by_the_dice():
    honoured = MockTransport(
        6,
        abort_fails_per_mille=0,
        min_delay=30,
        max_delay=30,
        error_per_mille=0,
        timeout_per_mille=0,
    )
    honoured.start(request(1), 0)
    honoured.cancel("r0-1", 5)
    assert [(t, o.status) for t, o in drain(honoured, start=5)] == [(5, "cancelled")]
    assert honoured.counts["aborted"] == 1

    late = MockTransport(
        6,
        abort_fails_per_mille=1000,
        min_delay=30,
        max_delay=30,
        error_per_mille=0,
        timeout_per_mille=0,
    )
    late.start(request(1), 0)
    late.cancel("r0-1", 5)
    assert [(t, o.status) for t, o in drain(late, start=5)] == [(30, "ok")]
    assert late.counts["abort_failed"] == 1


def test_a_cancel_for_an_id_with_nothing_pending_is_ignored_and_draws_nothing():
    a, b = MockTransport(7), MockTransport(7)
    a.cancel("r0-9", 3)
    for transport in (a, b):
        transport.start(request(1), 0)
    assert drain(a) == drain(b)


def test_discard_all_drops_everything_without_a_word():
    mock = MockTransport(8)
    for n in range(10):
        mock.start(request(n), 0)
    assert mock.in_flight()
    mock.discard_all()
    assert mock.in_flight() == [] and drain(mock) == []


def test_the_mock_is_a_transport_and_prechecks_nothing_and_has_nothing_to_tell():
    mock = MockTransport(9)
    assert isinstance(mock, Transport)
    assert mock.precheck(request(1)) is None
    mock.open()
    assert mock.host_events(0) == [] and mock.notices() == []
