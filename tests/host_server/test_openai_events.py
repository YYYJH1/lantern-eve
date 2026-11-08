"""What the OpenAI-compatible transport tells the game about its providers."""

from __future__ import annotations

import asyncio
import logging

from provider_helpers import KEY, outcomes, req, running, until

from lantern_eve.openai_transport import OpenAITransport


def run(coro):
    return asyncio.run(coro)


async def events(transport: OpenAITransport, n: int, timeout: float = 5.0) -> list[str]:
    """Wait until ``n`` host events have been handed over, and return them in order."""
    got: list[str] = []

    def enough() -> bool:
        got.extend(transport.host_events(0))
        return len(got) >= n

    await until(enough, timeout)
    return got


async def one(transport: OpenAITransport, n: int, content: str):
    """Make one call and wait for its outcome."""
    transport.start(req(n, content), 0)
    (outcome,) = await outcomes(transport, 1)
    return outcome


def test_a_local_model_that_lists_itself_is_reported_up_once_when_the_game_starts():
    async def main():
        async with running(local=True) as rig:
            rig.transport.open()
            assert await events(rig.transport, 1) == ["local_up"]
            await asyncio.sleep(0.2)  # the probe is over: it says nothing more
            assert rig.transport.host_events(0) == []
            assert rig.local.model_lists == 1
            assert rig.cloud.model_lists == 0 and rig.cloud.seen == []

    run(main())


def test_a_tag_less_model_name_matches_the_latest_tag_of_the_list():
    async def main():
        async with running(local=True, local_models=("local-model:latest",)) as rig:
            rig.transport.open()
            assert await events(rig.transport, 1) == ["local_up"]

    run(main())


def test_a_local_model_that_is_not_there_yet_is_looked_for_until_it_is():
    async def main():
        async with running(local=True, local_models=("something-else",)) as rig:
            rig.transport.open()
            await until(lambda: rig.local.model_lists >= 3)  # looked at again and again
            assert rig.transport.host_events(0) == []
            rig.local.models.append("local-model")
            assert await events(rig.transport, 1) == ["local_up"]

    run(main())


def test_a_local_service_that_is_broken_or_absent_is_not_reported_up():
    async def main():
        async with running(local=True) as rig:
            rig.local.models_status = 503
            rig.transport.open()
            await until(lambda: rig.local.model_lists >= 3)
            assert rig.transport.host_events(0) == []
            rig.local.models_status = 200
            rig.local.models_body = {"unexpected": "shape"}
            seen = rig.local.model_lists
            await until(lambda: rig.local.model_lists >= seen + 2)
            assert rig.transport.host_events(0) == []
            rig.local.models_body = None
            assert await events(rig.transport, 1) == ["local_up"]

        async with running(local=True) as rig:
            port = rig.local.port
            await rig.local.stop()
            rig.transport.open()
            await asyncio.sleep(0.3)
            assert rig.transport.host_events(0) == []
            await rig.local.start(port)  # the player starts the model
            assert await events(rig.transport, 1) == ["local_up"]

    run(main())


def test_with_no_local_model_configured_nothing_is_looked_for():
    async def main():
        async with running() as rig:
            rig.transport.open()
            await asyncio.sleep(0.2)
            assert rig.transport.host_events(0) == []
            assert rig.cloud.model_lists == 0

    run(main())


def test_the_cloud_is_down_after_three_network_failures_in_a_row_and_not_before():
    async def main():
        async with running(queue={"probe_s": 60}) as rig:
            t = rig.transport
            t.open()
            assert (await one(t, 1, "drop")).code == "network"
            assert (await one(t, 2, "drop")).code == "network"
            assert t.host_events(0) == []
            assert (await one(t, 3, "ok")).status == "ok"  # a call that gets through starts over
            await one(t, 4, "drop")
            await one(t, 5, "drop")
            assert t.host_events(0) == []
            await one(t, 6, "drop")
            assert t.host_events(0) == ["cloud_down"]
            await one(t, 7, "drop")
            assert t.host_events(0) == []  # it says so once

    run(main())


def test_the_number_of_failures_that_takes_the_cloud_down_is_configurable():
    async def main():
        async with running(queue={"probe_s": 60, "down_after": 1}) as rig:
            await one(rig.transport, 1, "drop")
            assert rig.transport.host_events(0) == ["cloud_down"]

    run(main())


def test_only_network_failures_count_a_slow_or_busy_service_is_still_there():
    async def main():
        async with running(queue={"probe_s": 60, "down_after": 2, "timeout_s": 0.15}) as rig:
            t = rig.transport
            for n, command in enumerate(
                ["status 503", "status 503", "status 429", "status 429", "status 401", "garbage"]
                * 2
            ):
                await one(t, n, command)
            for n in (100, 101, 102):
                t.start(req(n, "sleep 0.4"), 0)
            await outcomes(t, 6)  # three timeouts, and their late answers
            assert t.host_events(0) == []

    run(main())


def test_a_call_that_gets_through_brings_the_cloud_back():
    async def main():
        async with running(queue={"probe_s": 60}) as rig:
            t = rig.transport
            for n in range(3):
                await one(t, n, "drop")
            assert t.host_events(0) == ["cloud_down"]
            assert (await one(t, 10, "ok")).status == "ok"
            assert t.host_events(0) == ["cloud_up"]
            await one(t, 11, "ok")
            assert t.host_events(0) == []

    run(main())


def test_a_service_that_answers_a_probe_brings_the_cloud_back_without_a_call():
    async def main():
        async with running(queue={"probe_s": 0.1}) as rig:
            t = rig.transport
            for n in range(3):
                await one(t, n, "drop")
            assert t.host_events(0) == ["cloud_down"]
            assert await events(t, 1) == ["cloud_up"]
            assert rig.cloud.model_lists >= 1

    run(main())


def test_a_cloud_that_is_really_gone_stays_down_until_it_answers_again():
    async def main():
        async with running(queue={"probe_s": 0.1}) as rig:
            t = rig.transport
            port = rig.cloud.port
            await rig.cloud.stop()
            for n in range(3):
                outcome = await one(t, n, "ok")
                assert (outcome.code, outcome.usage) == (
                    "network",
                    {"input_tokens": 0, "output_tokens": 0},
                )
            assert t.host_events(0) == ["cloud_down"]
            await asyncio.sleep(0.4)  # looked at several times, and nobody home
            assert t.host_events(0) == []
            await rig.cloud.start(port)
            assert await events(t, 1) == ["cloud_up"]

    run(main())


def test_the_cloud_is_back_only_when_every_service_behind_it_answers():
    async def main():
        async with running(strong_apart=True, queue={"probe_s": 0.1}) as rig:
            t = rig.transport
            strong_port = rig.strong.port
            await rig.strong.stop()
            for n in range(3):
                await one(t, n, "drop")  # the cheap service drops the connection
            assert t.host_events(0) == ["cloud_down"]
            await asyncio.sleep(0.4)  # the cheap one answers the probe, the strong one does not
            assert t.host_events(0) == []
            await rig.strong.start(strong_port)
            assert await events(t, 1) == ["cloud_up"]

    run(main())


def test_the_local_model_goes_down_and_comes_back_by_its_own_rules():
    async def main():
        async with running(local=True, queue={"probe_s": 0.3}) as rig:
            t = rig.transport
            t.open()
            assert await events(t, 1) == ["local_up"]
            for n in range(3):
                t.start(req(n, "drop", tier="local"), 0)
            await outcomes(t, 3)
            assert t.host_events(0) == ["local_down"]
            assert await events(t, 1) == ["local_up"]  # the next look finds the model
            # The cloud has its own count: none of this touched it.
            await one(t, 9, "ok")
            assert t.host_events(0) == []

    run(main())


def test_discarding_the_calls_ends_the_looking_and_forgets_what_was_not_handed_over():
    async def main():
        async with running(local=True, local_models=("something-else",)) as rig:
            t = rig.transport
            t.open()
            await until(lambda: rig.local.model_lists >= 2)
            t.discard_all()
            looked = rig.local.model_lists
            await asyncio.sleep(0.3)
            assert rig.local.model_lists <= looked + 1
            assert t.host_events(0) == [] and t.notices() == []

    run(main())


def test_events_are_logged_without_the_key(caplog):
    async def main():
        async with running(queue={"probe_s": 60}) as rig:
            for n in range(3):
                await one(rig.transport, n, "drop")

    with caplog.at_level(logging.INFO):
        run(main())
    assert "the cloud is down after 3 network failures" in caplog.text
    assert KEY not in caplog.text
