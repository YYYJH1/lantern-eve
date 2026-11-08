"""The queue of the OpenAI-compatible transport: order, limits, time and cancels."""

from __future__ import annotations

import asyncio

from provider_helpers import outcomes, req, running, until

ZERO = {"input_tokens": 0, "output_tokens": 0}
CLASSES = {"reply": 1, "prefetch": 2, "director": 3, "nightly": 4}


def run(coro):
    return asyncio.run(coro)


def test_the_best_class_goes_first_and_inside_a_class_the_first_to_arrive():
    async def main():
        async with running(concurrency={"cheap": 1}, classes=CLASSES) as rig:
            t = rig.transport
            t.start(req(0, "hold g"), 0)  # takes the one slot
            await rig.cloud.until_seen(1)
            arrivals = [
                ("nightly a", "nightly"),
                ("director a", "director"),
                ("plain a", "not listed"),  # a category that is not listed is class 3
                ("prefetch a", "prefetch"),
                ("reply a", "reply"),
                ("nightly b", "nightly"),
                ("reply b", "reply"),
                ("director b", "director"),
                ("prefetch b", "prefetch"),
            ]
            for n, (content, category) in enumerate(arrivals, 1):
                t.start(req(n, content, category=category), 0)
            await asyncio.sleep(0.05)
            assert rig.cloud.contents() == ["hold g"]  # the limit holds them all back
            rig.cloud.gate("g").set()
            got = await outcomes(t, 1 + len(arrivals))
            assert {o.status for o in got} == {"ok"}
            assert rig.cloud.contents() == [
                "hold g",
                "reply a",
                "reply b",
                "prefetch a",
                "prefetch b",
                "director a",
                "plain a",
                "director b",
                "nightly a",
                "nightly b",
            ]

    run(main())


def test_a_better_class_does_not_push_out_a_call_that_is_running():
    async def main():
        async with running(concurrency={"cheap": 1}, classes=CLASSES) as rig:
            t = rig.transport
            t.start(req(1, "hold g", category="nightly"), 0)
            await rig.cloud.until_seen(1)
            t.start(req(2, "ok urgent", category="reply"), 0)
            await asyncio.sleep(0.05)
            assert rig.cloud.contents() == ["hold g"] and t.poll(0) == []
            rig.cloud.gate("g").set()
            await outcomes(t, 2)
            assert rig.cloud.contents() == ["hold g", "ok urgent"]

    run(main())


def test_each_tier_has_its_own_limit_and_the_default_is_eight_and_three():
    async def main():
        async with running(strong_apart=True) as rig:
            t = rig.transport
            for n in range(10):
                t.start(req(n, "hold a"), 0)
            for n in range(10, 15):
                t.start(req(n, "hold b", tier="strong"), 0)
            await until(lambda: len(rig.cloud.seen) == 8 and len(rig.strong.seen) == 3)
            await asyncio.sleep(0.1)
            # The cheap tier is full at eight and the strong tier at three, at the same time.
            assert (len(rig.cloud.seen), len(rig.strong.seen)) == (8, 3)
            rig.cloud.release_all()
            rig.strong.release_all()
            got = await outcomes(t, 15)
            assert {o.status for o in got} == {"ok"}
            assert (rig.cloud.peak, rig.strong.peak) == (8, 3)

    run(main())


def test_the_limits_are_configurable():
    async def main():
        async with running(strong_apart=True, concurrency={"cheap": 2, "strong": 1}) as rig:
            t = rig.transport
            for n in range(6):
                t.start(req(n, "hold a"), 0)
            for n in range(6, 9):
                t.start(req(n, "hold b", tier="strong"), 0)
            await until(lambda: len(rig.cloud.seen) == 2 and len(rig.strong.seen) == 1)
            await asyncio.sleep(0.05)
            rig.cloud.release_all()
            rig.strong.release_all()
            await outcomes(t, 9)
            assert (rig.cloud.peak, rig.strong.peak) == (2, 1)

    run(main())


def test_a_slow_call_times_out_unknown_and_its_late_answer_is_reported_with_its_usage():
    async def main():
        async with running(queue={"timeout_s": 0.3, "late_s": 3}) as rig:
            t = rig.transport
            t.start(req(1, "sleep 0.8"), 0)
            got = await outcomes(t, 2)
            timeout, late = got
            assert (timeout.status, timeout.code, timeout.text) == ("timeout", "timeout", "")
            assert timeout.usage is None and timeout.latency_ms >= 250
            assert (late.status, late.request_id) == ("ok", "r0-1")
            assert late.usage == {"input_tokens": 20, "output_tokens": 5}
            assert late.latency_ms >= 750
            assert len(rig.cloud.seen) == 1  # the timeout did not retry on anything

    run(main())


def test_a_call_that_may_not_finish_late_is_aborted_and_a_late_failure_is_not_reported():
    async def main():
        async with running(queue={"timeout_s": 0.2, "late_s": 0}) as rig:
            t = rig.transport
            t.start(req(1, "sleep 5"), 0)
            (timeout,) = await outcomes(t, 1)
            assert timeout.status == "timeout"
            await until(lambda: rig.cloud.aborted == ["sleep 5"])
            await asyncio.sleep(0.05)
            assert t.poll(0) == []

        async with running(queue={"timeout_s": 0.2, "late_s": 3}) as rig:
            t = rig.transport
            t.start(req(1, "slow500 0.5"), 0)
            (timeout,) = await outcomes(t, 1)
            assert timeout.status == "timeout"
            await until(lambda: rig.cloud.completed == ["slow500 0.5"])
            await asyncio.sleep(0.1)
            assert t.poll(0) == []  # the call did end, in a 500, and that is of no use to anyone

    run(main())


def test_a_hung_call_is_aborted_after_its_late_time_and_only_then_is_its_slot_free():
    async def main():
        async with running(
            concurrency={"cheap": 1}, queue={"timeout_s": 0.2, "late_s": 1.2}
        ) as rig:
            t = rig.transport
            t.start(req(1, "hang"), 0)
            (timeout,) = await outcomes(t, 1)
            assert (timeout.request_id, timeout.status) == ("r0-1", "timeout")
            t.start(req(2, "ok too soon"), 0)  # the slot is still taken by the hung call
            (waited,) = await outcomes(t, 1)
            assert (waited.request_id, waited.status, waited.code) == (
                "r0-2",
                "timeout",
                "queue_timeout",
            )
            assert waited.usage == ZERO  # it never left the queue, so it cost nothing
            await until(lambda: rig.cloud.aborted == ["hang"])
            t.start(req(3, "ok in time"), 0)
            (last,) = await outcomes(t, 1)
            assert (last.request_id, last.status, last.text) == ("r0-3", "ok", "in time")
            assert rig.cloud.contents() == ["hang", "ok in time"]

    run(main())


def test_the_timeout_counts_the_wait_in_the_queue_and_a_request_that_never_left_it_is_free():
    async def main():
        async with running(concurrency={"cheap": 1}, queue={"timeout_s": 0.25}) as rig:
            t = rig.transport
            t.start(req(1, "hold g"), 0)
            t.start(req(2, "ok never sent"), 0)
            await rig.cloud.until_seen(1)
            first, second = await outcomes(t, 2)
            assert (first.request_id, first.status, first.usage) == ("r0-1", "timeout", None)
            assert (second.request_id, second.status, second.usage) == ("r0-2", "timeout", ZERO)
            assert second.code == "queue_timeout"
            rig.cloud.gate("g").set()
            late = await outcomes(t, 1)
            assert [(o.request_id, o.status) for o in late] == [("r0-1", "ok")]
            await asyncio.sleep(0.05)
            assert rig.cloud.contents() == ["hold g"]  # the timed-out request left the queue

    run(main())


def test_a_class_can_wait_longer_than_the_others():
    async def main():
        async with running(queue={"timeout_s": 0.2}, timeouts={4: 3.0}, classes=CLASSES) as rig:
            t = rig.transport
            t.start(req(1, "sleep 0.6", category="director"), 0)
            t.start(req(2, "sleep 0.6", category="nightly"), 0)
            got = [(o.request_id, o.status) for o in await outcomes(t, 3)]
            assert got[0] == ("r0-1", "timeout")  # the first to give up
            assert sorted(got[1:]) == [("r0-1", "ok"), ("r0-2", "ok")]  # r0-1 is the late one

    run(main())


def test_a_cancel_aborts_a_call_in_flight_at_once_and_frees_its_slot():
    async def main():
        async with running(concurrency={"cheap": 1}) as rig:
            t = rig.transport
            t.start(req(1, "hang"), 0)
            t.start(req(2, "ok next"), 0)
            await rig.cloud.until_seen(1)
            t.cancel("r0-1", 3)
            (cancelled,) = t.poll(0)
            assert (cancelled.request_id, cancelled.status) == ("r0-1", "cancelled")
            assert cancelled.usage is None  # it was out, so what it cost is not known
            await until(lambda: rig.cloud.aborted == ["hang"])
            (next_one,) = await outcomes(t, 1)
            assert (next_one.request_id, next_one.status) == ("r0-2", "ok")
            t.cancel("r0-1", 4)  # a second cancel says nothing more
            await asyncio.sleep(0.05)
            assert t.poll(0) == []

    run(main())


def test_a_cancel_takes_a_waiting_request_out_of_the_queue_at_zero_cost():
    async def main():
        async with running(concurrency={"cheap": 1}) as rig:
            t = rig.transport
            t.start(req(1, "hold g"), 0)
            t.start(req(2, "ok never sent"), 0)
            await rig.cloud.until_seen(1)
            t.cancel("r0-2", 3)
            (cancelled,) = t.poll(0)
            assert (cancelled.request_id, cancelled.status, cancelled.usage) == (
                "r0-2",
                "cancelled",
                ZERO,
            )
            rig.cloud.gate("g").set()
            (done,) = await outcomes(t, 1)
            assert done.request_id == "r0-1"
            await asyncio.sleep(0.05)
            assert rig.cloud.contents() == ["hold g"]

    run(main())


def test_a_cancel_that_comes_too_late_changes_nothing():
    async def main():
        async with running() as rig:
            t = rig.transport
            t.start(req(1, "ok done"), 0)
            await until(lambda: rig.cloud.completed == ["ok done"])
            await asyncio.sleep(0.05)
            t.cancel("r0-1", 3)  # the answer is in: the core voids it and books it
            t.cancel("r0-404", 3)  # nobody asked for this one
            (outcome,) = t.poll(0)
            assert (outcome.status, outcome.text) == ("ok", "done")
            assert t.poll(0) == []

    run(main())


def test_a_cancel_after_a_timeout_drops_the_late_call_without_a_word():
    async def main():
        async with running(queue={"timeout_s": 0.2, "late_s": 5}) as rig:
            t = rig.transport
            t.start(req(1, "sleep 3"), 0)
            (timeout,) = await outcomes(t, 1)
            assert timeout.status == "timeout"
            t.cancel("r0-1", 5)
            await until(lambda: rig.cloud.aborted == ["sleep 3"])
            await asyncio.sleep(0.05)
            assert t.poll(0) == []

    run(main())


def test_a_reply_the_player_waits_for_is_announced_after_the_thinking_time_and_only_that():
    async def main():
        async with running(queue={"thinking_s": 0.5, "timeout_s": 5}, classes={"reply": 1}) as rig:
            t = rig.transport
            t.start(req(1, "sleep 1.0", category="reply"), 0)
            t.start(req(2, "sleep 1.0", category="chatter"), 0)  # not a reply
            t.start(req(3, "ok fast", category="reply"), 0)  # in before the time
            await outcomes(t, 3)
            notices = t.notices()
            assert [code for code, _ in notices] == ["thinking"]
            assert "r0-1" in notices[0][1]
            assert t.notices() == []

    run(main())
