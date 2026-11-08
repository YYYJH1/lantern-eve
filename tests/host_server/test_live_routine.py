"""The routine of the live test, run against a fake service so that it is known to work."""

from __future__ import annotations

import asyncio
import json

import pytest
from fake_provider import FakeProvider
from live_helpers import MAX_CALLS, MAX_TOKENS, live_config, play_live

from lantern_core.replay import rebuild
from lantern_eve.providers import KINDS


def test_the_live_routine_plays_m0_with_at_most_five_calls_capped_at_48_tokens():
    async def main():
        fake = await FakeProvider(models=("qwen-flash", "qwen-plus")).start()
        try:
            env = {
                "LANTERN_LIVE_BASE_URL": fake.base_url,
                "DASHSCOPE_API_KEY": "sk-routine-0123456789",
            }
            config = live_config("bailian", env)
            report = await play_live(config, env, ticks=450, pace=8)
            return fake, report
        finally:
            await fake.stop()

    fake, report = asyncio.run(main())
    assert report.failure is None
    made = [c for c in report.calls if c["code"] != "call_cap"]
    refused = [c for c in report.calls if c["code"] == "call_cap"]
    assert len(made) == len(fake.seen) == MAX_CALLS and refused  # the cap held, and bit
    assert {c["status"] for c in made} <= {"ok", "cancelled"} and any(
        c["status"] == "ok" for c in made
    )
    assert all(seen.body["max_tokens"] <= MAX_TOKENS for seen in fake.seen)
    assert all(seen.model in ("qwen-flash", "qwen-plus") for seen in fake.seen)
    assert report.ledger["cheap"]["input_tokens"] > 0
    lines = "\n".join(report.lines())
    assert "fake reply" not in lines and "sk-routine" not in lines and "127.0.0.1" not in lines
    assert "ledger:" in lines and " ms," in lines
    assert "sk-routine-0123456789" not in report.replay_text
    assert rebuild(json.loads(report.replay_text)).tick == report.ticks


def test_the_defaults_of_the_live_config_and_its_refusals():
    config = live_config("bailian", {})
    assert [config.tiers[t].model for t in ("cheap", "strong")] == ["qwen-flash", "qwen-plus"]
    assert config.queue.max_calls == MAX_CALLS
    assert config.providers["live"].max_output_tokens == MAX_TOKENS
    assert live_config("deepseek", {}).providers["live"].base_url == KINDS["deepseek"].base_url
    one = live_config("vllm", {"LANTERN_LIVE_MODEL": "m"})
    assert {one.tiers["cheap"].model, one.tiers["strong"].model} == {"m"}
    with pytest.raises(ValueError, match="LANTERN_LIVE_MODEL"):
        live_config("vllm", {})
