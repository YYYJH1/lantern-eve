"""One call to an OpenAI-compatible service, against a server on 127.0.0.1."""

from __future__ import annotations

import asyncio
import socket

import pytest
from aiohttp import web
from fake_provider import FakeProvider

from lantern_eve import chat
from lantern_eve.chat import ZERO_USAGE, CallResult, ChatClient, request_body
from lantern_eve.providers import KINDS, Provider
from lantern_eve.scrub import Scrubber

KEY = "sk-chatclient-0123456789"


def run(coro):
    return asyncio.run(coro)


def request(content: str = "ok", max_tokens: int = 48) -> dict:
    return {
        "request_id": "r0-1",
        "tier": "cheap",
        "category": "chatter",
        "max_tokens": max_tokens,
        "hold": 123,
        "messages": [
            {"role": "system", "content": "You are a villager."},
            {"role": "user", "content": content},
        ],
    }


def provider_for(fake: FakeProvider, kind: str = "openai", **fields) -> Provider:
    base = KINDS[kind]
    return Provider(
        name="p",
        kind=kind,
        base_url=fake.base_url,
        api_key_env=fields.pop("api_key_env", "SOME_KEY"),
        extra_body=fields.pop("extra_body", dict(base.extra_body)),
        **fields,
    )


async def call(fake: FakeProvider, content: str, *, key: str | None = KEY, **fields) -> CallResult:
    provider = provider_for(fake, **fields)
    client = ChatClient(4.0, Scrubber())
    try:
        body = request_body(provider, "fake-model", request(content), provider.max_output_tokens)
        return await client.complete(provider, key, body)
    finally:
        await client.aclose()


def with_fake(coro_fn, **kwargs):
    async def main():
        fake = await FakeProvider(**kwargs).start()
        try:
            return await coro_fn(fake)
        finally:
            await fake.stop()

    return run(main())


def test_an_answer_gives_its_text_and_the_usage_the_service_reports():
    async def body(fake):
        result = await call(fake, "ok The tea is good.")
        assert result == CallResult(
            "ok", "The tea is good.", {"input_tokens": 20, "output_tokens": 5}, None, True
        )
        (seen,) = fake.seen
        assert seen.path == "/v1/chat/completions"
        assert seen.headers["authorization"] == f"Bearer {KEY}"
        assert seen.headers["content-type"] == "application/json"
        assert seen.headers["user-agent"].startswith("lantern-eve/")
        assert seen.body["model"] == "fake-model" and seen.body["stream"] is False
        assert seen.body["max_tokens"] == 48
        assert [m["role"] for m in seen.body["messages"]] == ["system", "user"]
        # What the core keeps for itself does not leave the host.
        assert not {"request_id", "tier", "hold", "category"} & set(seen.body)

    with_fake(body)


def test_a_provider_without_a_key_is_sent_none():
    async def body(fake):
        result = await call(fake, "ok", key=None)
        assert result.status == "ok"
        assert "authorization" not in fake.seen[0].headers

    with_fake(body)


@pytest.mark.parametrize(
    ("kind", "switch"),
    [
        ("bailian", {"enable_thinking": False}),
        ("deepseek", {"thinking": {"type": "disabled"}}),
        ("ollama", {"reasoning_effort": "none"}),
        ("vllm", {"chat_template_kwargs": {"enable_thinking": False}}),
        ("openai", {}),
    ],
)
def test_each_kind_of_provider_gets_its_own_switch_that_turns_thinking_off(kind, switch):
    async def body(fake):
        await call(fake, "ok", kind=kind)
        sent = fake.seen[0].body
        for key, value in switch.items():
            assert sent[key] == value
        assert set(sent) == {"model", "messages", "max_tokens", "stream", *switch}

    with_fake(body)


def test_the_output_is_capped_by_the_lower_of_the_request_and_the_provider():
    kinds = Provider("p", "openai", "http://127.0.0.1:1/v1", max_output_tokens=16)
    assert request_body(kinds, "m", request(max_tokens=48), 16)["max_tokens"] == 16
    assert request_body(kinds, "m", request(max_tokens=8), 16)["max_tokens"] == 8
    assert request_body(kinds, "m", request(max_tokens=48), None)["max_tokens"] == 48
    newer = Provider(
        "p", "openai", "http://127.0.0.1:1/v1", max_tokens_field="max_completion_tokens"
    )
    sent = request_body(newer, "m", request(max_tokens=48), None)
    assert sent["max_completion_tokens"] == 48 and "max_tokens" not in sent


def test_the_fields_of_the_host_are_not_overridden_by_the_provider_ones():
    # The file refuses these keys, and the body puts them after the extra fields all the same.
    odd = Provider(
        "p", "openai", "http://127.0.0.1:1/v1", extra_body={"model": "x", "stream": True}
    )
    sent = request_body(odd, "real", request(), None)
    assert sent["model"] == "real" and sent["stream"] is False


@pytest.mark.parametrize(
    ("status", "zero"),
    [(400, True), (401, True), (404, True), (429, True), (500, False), (503, False)],
)
def test_an_error_status_is_a_short_code_and_the_words_of_the_service_are_dropped(status, zero):
    async def body(fake):
        result = await call(fake, f"status {status}")
        assert result.status == "error" and result.code == f"http_{status}"
        assert result.text == f"http_{status}" and result.reached is True
        # A 4xx turned the call away and cost nothing. After a 5xx nobody knows.
        assert result.usage == (ZERO_USAGE if zero else None)
        assert KEY not in repr(result)

    with_fake(body)


def test_a_redirect_is_not_followed_and_the_key_goes_nowhere_else():
    async def main():
        target = await FakeProvider().start()
        app = web.Application()

        async def redirect(request):
            raise web.HTTPTemporaryRedirect(f"{target.base_url}/chat/completions")

        app.router.add_post("/v1/chat/completions", redirect)
        runner = web.AppRunner(app)
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        port = runner.addresses[0][1]
        client = ChatClient(4.0, Scrubber())
        try:
            provider = Provider("p", "openai", f"http://127.0.0.1:{port}/v1", api_key_env="K")
            result = await client.complete(
                provider, KEY, request_body(provider, "m", request(), None)
            )
            assert (result.status, result.code, result.usage) == ("error", "http_307", None)
            assert target.seen == []
        finally:
            await client.aclose()
            await runner.cleanup()
            await target.stop()

    run(main())


@pytest.mark.parametrize(
    ("command", "code", "usage"),
    [
        ("garbage", "bad_body", None),
        ("nochoice", "bad_body", None),
        ("errorbody", "provider_error", None),
        ("huge", "bad_body", None),
    ],
)
def test_a_body_that_cannot_be_used_is_an_error_with_unknown_usage(command, code, usage):
    async def body(fake):
        result = await call(fake, command)
        assert (result.status, result.code, result.usage, result.reached) == (
            "error",
            code,
            usage,
            True,
        )

    with_fake(body)


def test_usage_that_is_missing_or_not_counts_is_unknown_and_absurd_counts_are_capped():
    async def body(fake):
        assert (await call(fake, "nousage")).usage is None
        assert (await call(fake, "badusage")).usage is None
        big = await call(fake, "bigusage")
        assert big.status == "ok"
        assert big.usage == {"input_tokens": chat.MAX_COUNT, "output_tokens": chat.MAX_COUNT}

    with_fake(body)


def test_a_null_content_is_an_empty_text_and_a_lone_surrogate_is_replaced():
    async def body(fake):
        null = await call(fake, "nullcontent")
        assert (null.status, null.text) == ("ok", "") and null.usage is not None
        odd = await call(fake, "surrogate")
        assert odd.status == "ok" and odd.text == "x\ufffdy"
        odd.text.encode("utf-8")  # the core takes only text that has a UTF-8 form

    with_fake(body)


def test_a_key_in_the_text_of_an_answer_is_scrubbed():
    async def body(fake):
        scrubber = Scrubber()
        scrubber.register(KEY)
        provider = provider_for(fake)
        client = ChatClient(4.0, scrubber)
        try:
            result = await client.complete(
                provider, KEY, request_body(provider, "m", request("echokey"), None)
            )
        finally:
            await client.aclose()
        assert result.status == "ok" and KEY not in result.text and "[key]" in result.text

    with_fake(body)


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def test_a_connection_that_is_refused_cost_nothing_and_one_that_is_cut_is_unknown():
    async def refused():
        provider = Provider("p", "openai", f"http://127.0.0.1:{free_port()}/v1")
        client = ChatClient(1.0, Scrubber())
        try:
            return await client.complete(
                provider, None, request_body(provider, "m", request(), None)
            )
        finally:
            await client.aclose()

    result = run(refused())
    assert (result.status, result.code, result.reached) == ("error", "network", False)
    assert result.usage == ZERO_USAGE

    async def body(fake):
        result = await call(fake, "drop")
        assert (result.status, result.code, result.reached) == ("error", "network", False)
        assert result.usage is None  # the request was out; what was generated is not known

    with_fake(body)


def test_a_call_that_is_cancelled_raises_and_closes_the_connection():
    async def body(fake):
        provider = provider_for(fake)
        client = ChatClient(4.0, Scrubber())
        try:
            task = asyncio.ensure_future(
                client.complete(provider, KEY, request_body(provider, "m", request("hang"), None))
            )
            await fake.until_seen(1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            for _ in range(200):
                if fake.aborted:
                    break
                await asyncio.sleep(0.01)
            assert fake.aborted == ["hang"]
        finally:
            await client.aclose()

    with_fake(body)


def test_the_model_list_is_read_and_a_service_that_does_not_answer_is_none():
    async def body(fake):
        provider = provider_for(fake)
        client = ChatClient(4.0, Scrubber())
        try:
            status, data = await client.models(provider, KEY, 2.0)
            assert status == 200 and [m["id"] for m in data["data"]] == ["fake-model"]
            fake.models_status = 503
            assert await client.models(provider, KEY, 2.0) == (503, None)
            fake.models_status = 200
            fake.models_body = "not an object"
            assert (await client.models(provider, KEY, 2.0))[0] == 200
            fake.models_delay = 1.0
            assert await client.models(provider, KEY, 0.1) is None
        finally:
            await client.aclose()
        gone = Provider("p", "openai", f"http://127.0.0.1:{free_port()}/v1")
        client = ChatClient(1.0, Scrubber())
        try:
            assert await client.models(gone, None, 1.0) is None
        finally:
            await client.aclose()

    with_fake(body)


def test_a_provider_on_this_machine_is_reached_directly_and_a_remote_one_goes_by_the_proxy(
    monkeypatch,
):
    async def main():
        fake = await FakeProvider().start()
        via: list[str] = []
        proxy_app = web.Application()

        async def proxied(request):
            via.append(str(request.url))
            return web.json_response(
                {"choices": [{"message": {"content": "from afar"}}], "usage": None}
            )

        proxy_app.router.add_route("*", "/{tail:.*}", proxied)
        runner = web.AppRunner(proxy_app)
        await runner.setup()
        await web.TCPSite(runner, "127.0.0.1", 0).start()
        proxy = f"http://127.0.0.1:{runner.addresses[0][1]}"
        for name in ("HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"):
            monkeypatch.setenv(name, proxy)
        for name in ("NO_PROXY", "no_proxy", "ALL_PROXY", "all_proxy"):
            monkeypatch.delenv(name, raising=False)
        client = ChatClient(4.0, Scrubber())
        try:
            local = provider_for(fake)
            assert (
                await client.complete(local, None, request_body(local, "m", request(), None))
            ).text == "fake reply"
            assert via == [] and len(fake.seen) == 1

            remote = Provider("r", "openai", "http://llm.example.test/v1", api_key_env=None)
            result = await client.complete(remote, None, request_body(remote, "m", request(), None))
            assert result.text == "from afar"
            assert via == ["http://llm.example.test/v1/chat/completions"]
        finally:
            await client.aclose()
            await runner.cleanup()
            await fake.stop()

    run(main())
