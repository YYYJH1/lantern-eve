"""Helpers for the tests of the OpenAI-compatible transport."""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

from fake_provider import FakeProvider

from lantern_eve import providers
from lantern_eve.openai_transport import OpenAITransport
from lantern_eve.providers import ProviderConfig
from lantern_eve.transport import ModelOutcome

KEY = "sk-test-0123456789abcdef"
# Short times, so that tests that wait for them stay quick. A test overrides what it is about.
FAST = {"timeout_s": 5, "late_s": 5, "probe_s": 0.05, "connect_s": 2, "thinking_s": 2}


def toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, str):
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return repr(value)


def toml_table(name: str, values: dict[str, Any]) -> str:
    lines = [f"[{name}]", *(f"{key} = {toml_value(value)}" for key, value in values.items())]
    return "\n".join(lines) + "\n"


def config_text(
    cloud: FakeProvider,
    *,
    strong: FakeProvider | None = None,
    local: FakeProvider | None = None,
    kind: str = "bailian",
    local_kind: str = "ollama",
    queue: dict[str, Any] | None = None,
    concurrency: dict[str, int] | None = None,
    timeouts: dict[int, float] | None = None,
    classes: dict[str, int] | None = None,
    cap: int | None = None,
    local_key: str | None = None,
    cloud_key: bool = True,
) -> str:
    """A provider file for fakes on 127.0.0.1: the cloud tiers on one or two, the local on one."""
    text = toml_table(
        "providers.cloud",
        {"kind": kind, "base_url": cloud.base_url, "api_key_env": "CLOUD_KEY" if cloud_key else ""}
        | ({"max_output_tokens": cap} if cap else {}),
    )
    strong_provider = "cloud"
    if strong is not None:
        strong_provider = "cloud2"
        text += toml_table(
            "providers.cloud2",
            {"kind": kind, "base_url": strong.base_url, "api_key_env": "CLOUD_KEY"},
        )
    prices = {"price_in": 0.15, "price_out": 1.5}
    text += toml_table("tiers.cheap", {"provider": "cloud", "model": "cheap-model", **prices})
    text += toml_table(
        "tiers.strong",
        {"provider": strong_provider, "model": "strong-model", "price_in": 0.8, "price_out": 8},
    )
    if local is not None:
        fields: dict[str, Any] = {"kind": local_kind, "base_url": local.base_url}
        if local_key:
            fields["api_key_env"] = local_key
        text += toml_table("providers.home", fields)
        text += toml_table("tiers.local", {"provider": "home", "model": "local-model"})
    text += toml_table("queue", {**FAST, **(queue or {})})
    if concurrency:
        text += toml_table("queue.concurrency", concurrency)
    if timeouts:
        text += toml_table("queue.timeouts", {str(k): v for k, v in timeouts.items()})
    if classes:
        text += toml_table("classes", classes)
    return text


def make_config(cloud: FakeProvider, **kwargs: Any) -> ProviderConfig:
    return providers.loads(config_text(cloud, **kwargs), source="test")


@dataclass
class Rig:
    """An OpenAI transport and the fake services behind its tiers."""

    transport: OpenAITransport
    cloud: FakeProvider
    strong: FakeProvider | None
    local: FakeProvider | None


@asynccontextmanager
async def running(
    *,
    key: str | None = KEY,
    strong_apart: bool = False,
    local: bool = False,
    local_models: tuple[str, ...] = ("local-model",),
    **config: Any,
):
    """A cloud fake (a second one for the strong tier, a local one) and a transport over them."""
    fakes: list[FakeProvider] = []

    async def fake(models: tuple[str, ...]) -> FakeProvider:
        fakes.append(await FakeProvider(models=models).start())
        return fakes[-1]

    cloud = await fake(("cheap-model", "strong-model"))
    strong = await fake(("strong-model",)) if strong_apart else None
    home = await fake(local_models) if local else None
    transport = OpenAITransport(
        make_config(cloud, strong=strong, local=home, **config),
        env={} if key is None else {"CLOUD_KEY": key},
    )
    try:
        yield Rig(transport, cloud, strong, home)
    finally:
        await transport.aclose()
        for item in fakes:
            await item.stop()


def req(
    n: int,
    content: str = "ok",
    *,
    tier: str = "cheap",
    category: str = "chatter",
    max_tokens: int = 48,
) -> dict[str, Any]:
    return {
        "request_id": f"r0-{n}",
        "tier": tier,
        "category": category,
        "max_tokens": max_tokens,
        "hold": 0,
        "messages": [
            {"role": "system", "content": "You are a villager."},
            {"role": "user", "content": content},
        ],
    }


async def until(condition, timeout: float = 5.0, step: float = 0.005) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not condition():
        if asyncio.get_running_loop().time() > deadline:
            raise TimeoutError("the condition did not come true")
        await asyncio.sleep(step)


async def outcomes(transport: OpenAITransport, n: int, timeout: float = 5.0) -> list[ModelOutcome]:
    """Poll until ``n`` outcomes have arrived, and return them in the order they did."""
    got: list[ModelOutcome] = []

    def enough() -> bool:
        got.extend(transport.poll(0))
        return len(got) >= n

    await until(enough, timeout)
    return got


def by_id(items: Iterable[ModelOutcome]) -> dict[str, ModelOutcome]:
    return {o.request_id: o for o in items}
