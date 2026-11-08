"""The OpenAI-compatible transport against fakes on 127.0.0.1: single calls, errors and routing."""

from __future__ import annotations

import asyncio
import json
import logging

import pytest
from provider_helpers import KEY, by_id, outcomes, req, running, until

from lantern_core import canon
from lantern_core.api import Game
from lantern_eve import providers
from lantern_eve.openai_transport import OpenAITransport
from lantern_eve.transport import Transport

ZERO = {"input_tokens": 0, "output_tokens": 0}


def run(coro):
    return asyncio.run(coro)


def test_an_answer_is_reported_with_its_text_usage_and_latency():
    async def main():
        async with running() as rig:
            transport = rig.transport
            assert isinstance(transport, Transport)
            assert transport.precheck(req(1)) is None
            transport.start(req(1, "ok the tea is good"), 0)
            (outcome,) = await outcomes(transport, 1)
            assert outcome.request_id == "r0-1" and outcome.status == "ok"
            assert outcome.text == "the tea is good" and outcome.code is None
            assert outcome.usage == {"input_tokens": 20, "output_tokens": 5}
            assert 0 <= outcome.latency_ms < 2000
            # The body is the model_result of the core, and the core takes it.
            body = outcome.body()
            canon.check(body)
            Game(1).step(json.dumps([{"seq": 0, "kind": "model_result", "body": body}]))
            assert transport.poll(0) == [] and transport.host_events(0) == []
            assert transport.notices() == []

    run(main())


def test_the_model_of_the_tier_the_key_and_the_cap_go_out_and_nothing_else_does():
    async def main():
        async with running(cap=16) as rig:
            transport = rig.transport
            transport.start(req(1, "ok a", tier="cheap", max_tokens=48), 0)
            transport.start(req(2, "ok b", tier="strong", max_tokens=8), 0)
            await outcomes(transport, 2)
            cheap, strong = sorted(rig.cloud.seen, key=lambda s: s.content)
            assert (cheap.model, strong.model) == ("cheap-model", "strong-model")
            assert cheap.headers["authorization"] == f"Bearer {KEY}"
            # The provider's cap lowers what the core asked for, and never raises it.
            assert (cheap.body["max_tokens"], strong.body["max_tokens"]) == (16, 8)
            assert cheap.body["enable_thinking"] is False and cheap.body["stream"] is False

    run(main())


def test_a_request_the_host_cannot_make_is_refused_before_any_io_at_zero_cost():
    async def main():
        async with running(key=None) as rig:
            transport = rig.transport
            refused = transport.precheck(req(1))
            assert refused is not None
            assert (refused.status, refused.code, refused.text) == ("error", "no_key", "no_key")
            assert refused.usage == ZERO
            assert transport.precheck(req(2, tier="local")).code == "no_provider"
            assert transport.precheck(req(3, tier="gold")).code == "no_provider"
            # start() on a request that would be refused reports the refusal and sends nothing.
            transport.start(req(4), 0)
            assert [o.code for o in transport.poll(0)] == ["no_key"]
            await asyncio.sleep(0.05)
            assert rig.cloud.seen == []
            assert "key" not in repr(transport).replace("keys set for []", "")

    run(main())


def test_a_provider_that_needs_no_key_is_called_without_one():
    async def main():
        async with running(key=None, cloud_key=False) as rig:
            transport = rig.transport
            assert transport.precheck(req(1)) is None
            transport.start(req(1, "ok hi"), 0)
            (outcome,) = await outcomes(transport, 1)
            assert outcome.status == "ok"
            assert "authorization" not in rig.cloud.seen[0].headers

    run(main())


@pytest.mark.parametrize(
    ("command", "status", "code", "usage"),
    [
        ("status 401", "error", "http_401", ZERO),
        ("status 429", "error", "http_429", ZERO),
        ("status 400", "error", "http_400", ZERO),
        ("status 500", "error", "http_500", None),
        ("status 503", "error", "http_503", None),
        ("garbage", "error", "bad_body", None),
        ("errorbody", "error", "provider_error", None),
        ("drop", "error", "network", None),
    ],
)
def test_a_failure_is_one_error_with_a_short_code_and_is_never_retried(
    command, status, code, usage, caplog
):
    async def main():
        async with running() as rig:
            transport = rig.transport
            transport.start(req(1, command), 0)
            (outcome,) = await outcomes(transport, 1)
            assert (outcome.status, outcome.code, outcome.text) == (status, code, code)
            assert outcome.usage == usage
            await asyncio.sleep(0.1)  # a retry would have shown by now
            assert len(rig.cloud.seen) == 1 and transport.poll(0) == []

    with caplog.at_level(logging.DEBUG):
        run(main())
    assert KEY not in caplog.text


def test_a_connection_that_is_refused_is_a_network_error_that_cost_nothing():
    async def main():
        async with running() as rig:
            await rig.cloud.stop()
            rig.transport.start(req(1), 0)
            (outcome,) = await outcomes(rig.transport, 1)
            assert (outcome.status, outcome.code, outcome.usage) == ("error", "network", ZERO)

    run(main())


def test_each_tier_goes_to_its_own_service_and_the_local_one_gets_its_own_switch():
    async def main():
        async with running(strong_apart=True, local=True) as rig:
            transport = rig.transport
            transport.start(req(1, "ok c", tier="cheap"), 0)
            transport.start(req(2, "ok s", tier="strong"), 0)
            transport.start(req(3, "ok l", tier="local"), 0)
            got = by_id(await outcomes(transport, 3))
            assert {o.status for o in got.values()} == {"ok"}
            assert rig.cloud.contents() == ["ok c"]
            assert rig.strong.contents() == ["ok s"]
            assert rig.local.contents() == ["ok l"]
            (local,) = rig.local.seen
            assert local.model == "local-model"
            assert local.body["reasoning_effort"] == "none"  # Ollama's switch, not Bailian's
            assert "enable_thinking" not in local.body
            assert "authorization" not in local.headers  # no key goes to a service that has none
            assert rig.cloud.seen[0].body["enable_thinking"] is False
            assert rig.strong.seen[0].headers["authorization"] == f"Bearer {KEY}"

    run(main())


def test_a_local_vllm_gets_the_chat_template_switch():
    async def main():
        async with running(local=True, local_kind="vllm") as rig:
            rig.transport.start(req(1, "ok l", tier="local"), 0)
            await outcomes(rig.transport, 1)
            body = rig.local.seen[0].body
            assert body["chat_template_kwargs"] == {"enable_thinking": False}

    run(main())


def test_a_second_start_of_the_same_request_is_ignored():
    async def main():
        async with running() as rig:
            rig.transport.start(req(1, "ok once"), 0)
            rig.transport.start(req(1, "ok once"), 0)
            await outcomes(rig.transport, 1)
            await asyncio.sleep(0.05)
            assert len(rig.cloud.seen) == 1

    run(main())


def test_the_call_cap_stops_calls_at_zero_cost_and_keeps_the_count_of_those_made():
    async def main():
        async with running(queue={"max_calls": 2}) as rig:
            transport = rig.transport
            for n in range(1, 4):
                refused = transport.precheck(req(n))
                if refused is None:
                    transport.start(req(n), 0)
                else:
                    assert (n, refused.code, refused.usage) == (3, "call_cap", ZERO)
            got = await outcomes(transport, 2)
            assert [o.status for o in got] == ["ok", "ok"] and len(rig.cloud.seen) == 2

    run(main())


def test_the_transport_opens_without_a_loop_and_needs_one_to_call():
    config = providers.loads(
        '[providers.p]\nkind="openai"\nbase_url="http://127.0.0.1:9/v1"\napi_key_env=""\n'
        '[tiers.cheap]\nprovider="p"\nmodel="m"\nprice_in=1\nprice_out=1\n'
        '[tiers.strong]\nprovider="p"\nmodel="m"\nprice_in=1\nprice_out=1\n'
    )
    transport = OpenAITransport(config, env={})
    transport.open()  # no event loop: it waits for the first call
    assert transport.poll(0) == [] and transport.host_events(0) == []
    with pytest.raises(RuntimeError):
        transport.start(req(1), 0)
    assert "OpenAITransport(" in repr(transport)


def test_discard_all_ends_every_call_without_a_word_and_close_leaves_no_task():
    async def main():
        async with running(concurrency={"cheap": 1}) as rig:
            transport = rig.transport
            transport.start(req(1, "hang"), 0)
            transport.start(req(2, "ok queued"), 0)
            await rig.cloud.until_seen(1)
            transport.discard_all()
            await until(lambda: rig.cloud.aborted == ["hang"])
            await asyncio.sleep(0.05)
            assert transport.poll(0) == [] and len(rig.cloud.seen) == 1
            # The transport is still good for a new game's calls.
            transport.start(req(3, "ok again"), 0)
            (outcome,) = await outcomes(transport, 1)
            assert outcome.request_id == "r0-3" and outcome.status == "ok"
        assert not [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]

    run(main())
