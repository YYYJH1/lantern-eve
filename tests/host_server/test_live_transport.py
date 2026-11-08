"""A few real calls to a real provider. Skipped unless the environment asks for them.

    LANTERN_LIVE_PROVIDER=bailian DASHSCOPE_API_KEY=... \\
        uv run pytest tests/host_server/test_live_transport.py -s

``LANTERN_LIVE_PROVIDER`` is bailian, deepseek, ollama or vllm. The key variable of a provider
that needs one (DASHSCOPE_API_KEY, DEEPSEEK_API_KEY) must be set as well. ``LANTERN_LIVE_MODEL``
names one model for both tiers (it is required for vllm), and ``LANTERN_LIVE_BASE_URL`` replaces
the address of the provider.

The test plays m0 for a few hundred ticks. The transport is allowed 5 calls in all, each capped at
48 tokens of output, and answers every later request itself, at no cost. It prints statuses,
latencies, token counts and the ledger of the core, and nothing a model said.
"""

from __future__ import annotations

import asyncio
import json
import os

import pytest
from live_helpers import MAX_CALLS, MAX_TOKENS, live_config, play_live

from lantern_core.replay import rebuild
from lantern_eve.providers import KINDS

PROVIDER = os.environ.get("LANTERN_LIVE_PROVIDER", "")
KIND = KINDS.get(PROVIDER)
KEY_VARIABLE = KIND.api_key_env if KIND is not None else None

if not PROVIDER:
    REASON = "set LANTERN_LIVE_PROVIDER (bailian, deepseek, ollama or vllm) to make real calls"
elif PROVIDER not in ("bailian", "deepseek", "ollama", "vllm"):
    REASON = f"LANTERN_LIVE_PROVIDER={PROVIDER!r} is not bailian, deepseek, ollama or vllm"
elif KEY_VARIABLE and not os.environ.get(KEY_VARIABLE):
    REASON = f"set {KEY_VARIABLE} to make real calls to {PROVIDER}"
else:
    REASON = ""

pytestmark = pytest.mark.skipif(bool(REASON), reason=REASON or "live")


def test_m0_plays_against_the_real_provider_within_five_capped_calls():
    config = live_config(PROVIDER, os.environ)
    report = asyncio.run(play_live(config, os.environ))
    print()
    print(f"provider: {PROVIDER}")
    for line in report.lines():
        print(line)

    assert report.failure is None, report.failure
    answered = [c for c in report.calls if c["status"] == "ok"]
    codes = sorted({c["code"] for c in report.calls if c["code"]})
    assert answered, f"no call was answered; the errors were {codes}"
    # The cap on the calls, and on the output of each, held.
    made = [c for c in report.calls if c["code"] != "call_cap"]
    assert len(made) <= MAX_CALLS
    assert all(c["output_tokens"] is None or c["output_tokens"] <= MAX_TOKENS for c in answered)
    # Usage came from the provider, and the core booked it.
    assert all(c["input_tokens"] and c["output_tokens"] for c in answered)
    booked = report.ledger["cheap"]
    assert booked["ok"] >= 1 and booked["input_tokens"] > 0 and booked["output_tokens"] > 0
    # No key in the replay, and the replay rebuilds the game.
    key = os.environ.get(KEY_VARIABLE or "", "")
    assert not key or key not in report.replay_text
    assert rebuild(json.loads(report.replay_text)).tick == report.ticks
