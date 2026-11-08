"""The mock model host, which the determinism and cross-host tests rely on."""

import copy

from mock_host import MockModelHost

from lantern_core import canon


def request(n):
    messages = [{"role": "user", "content": "你好"}]
    return {"request_id": f"r{n}-0", "messages": messages, "max_tokens": 48}


def outputs(requests=(), cancels=()):
    return {"requests": list(requests), "cancels": list(cancels)}


def drain(host, frames=200):
    """Every body the host delivers over the next ``frames`` calls, with the frame it came in."""
    delivered = []
    for frame in range(frames):
        delivered += [(frame, body) for body in host.deliver()]
        host.accept(outputs())
    return delivered


def test_the_same_seed_gives_the_same_answers_and_another_seed_does_not():
    def run(seed):
        host = MockModelHost(seed)
        host.deliver()
        host.accept(outputs(request(n) for n in range(30)))
        return drain(host)

    assert run(1) == run(1)
    assert run(1) != run(2)


def test_answers_are_plain_canonical_values():
    host = MockModelHost(3)
    host.deliver()
    host.accept(outputs(request(n) for n in range(40)))
    for _, body in drain(host):
        canon.check(body)
        assert set(body) == {"request_id", "status", "text", "usage", "latency_ms"}


def test_a_request_gets_one_answer_unless_it_timed_out_and_the_late_one_follows():
    host = MockModelHost(4, timeout_per_mille=1000, late_per_mille=1000)
    host.deliver()
    host.accept(outputs([request(1)]))
    answers = [body["status"] for _, body in drain(host)]
    assert answers == ["timeout", "ok"]
    host = MockModelHost(4, timeout_per_mille=0, error_per_mille=0)
    host.deliver()
    host.accept(outputs(request(n) for n in range(25)))
    ids = [body["request_id"] for _, body in drain(host)]
    assert sorted(ids) == sorted(f"r{n}-0" for n in range(25))


def test_a_timeout_carries_no_usage_and_an_ok_does():
    host = MockModelHost(5, timeout_per_mille=500, error_per_mille=0)
    host.deliver()
    host.accept(outputs(request(n) for n in range(40)))
    by_status = {}
    for _, body in drain(host):
        by_status.setdefault(body["status"], []).append(body)
    assert all(b["usage"] is None for b in by_status["timeout"])
    assert all(b["usage"]["output_tokens"] >= 1 for b in by_status["ok"])
    assert all(b["text"] for b in by_status["ok"])


def test_a_cancel_is_honoured_or_arrives_too_late_by_the_dice():
    honoured = MockModelHost(6, abort_fails_per_mille=0, min_delay=30, max_delay=30)
    honoured.deliver()
    honoured.accept(outputs([request(1)]))
    honoured.deliver()
    honoured.accept(outputs(cancels=["r1-0"]))
    assert [(f, b["status"]) for f, b in drain(honoured)] == [(0, "cancelled")]
    late = MockModelHost(6, abort_fails_per_mille=1000, min_delay=30, max_delay=30)
    late.deliver()
    late.accept(outputs([request(1)]))
    late.deliver()
    late.accept(outputs(cancels=["r1-0"]))
    assert [b["status"] for _, b in drain(late)] == ["ok"]
    assert late.stats["abort_failed"] == 1


def test_a_cancel_for_an_answer_that_already_came_does_nothing():
    host = MockModelHost(7, timeout_per_mille=0, error_per_mille=0)
    host.deliver()
    host.accept(outputs([request(1)]))
    drain(host)
    host.deliver()
    host.accept(outputs(cancels=["r1-0"]))
    assert host.in_flight() == [] and host.stats["aborted"] == 0


def test_a_copy_of_the_host_continues_independently():
    host = MockModelHost(8)
    host.deliver()
    host.accept(outputs(request(n) for n in range(20)))
    twin = copy.deepcopy(host)
    assert drain(host) == drain(twin)
    host.accept(outputs([request(99)]))
    assert twin.in_flight() == []
