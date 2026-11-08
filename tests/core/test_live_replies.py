"""A short talk with a real provider. Skipped unless the environment asks for it.

    LANTERN_LIVE_PROVIDER=bailian DASHSCOPE_API_KEY=... \\
        uv run pytest tests/core/test_live_replies.py -s

``LANTERN_LIVE_PROVIDER`` is bailian, deepseek, ollama or vllm. The key variable of a provider that
needs one (DASHSCOPE_API_KEY, DEEPSEEK_API_KEY) must be set as well. ``LANTERN_LIVE_MODEL`` names
one model for both tiers (it is required for vllm), and ``LANTERN_LIVE_BASE_URL`` replaces the
address of the provider.

The test puts the festival manager in a talk with a townsperson of the bridge town and plays it in
real time: an ask, a tell, an entrust with words of the manager's own (which sends a judge first)
and a promise. The transport of the server host is allowed 8 calls in all, each capped at 400 tokens
of output, and answers every later request itself, at no cost. It prints the status, the latency
and the tokens of each call, what the gate made of each reply, and both languages of each line that
landed, and nothing else the provider said. It costs a few cents on a cloud provider.
"""

from __future__ import annotations

import asyncio
import os

import pytest
from live_replies_helpers import MAX_CALLS, MAX_TOKENS, live_config, play_talk

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


def test_a_talk_plays_against_the_real_provider_within_eight_capped_calls():
    config = live_config(PROVIDER, os.environ)
    report = asyncio.run(play_talk(config, os.environ))
    print()
    print(f"provider: {PROVIDER}")
    for line in report.lines():
        print(line)

    assert report.failure is None, report.failure
    made = [c for c in report.calls if c["code"] != "call_cap"]
    answered = [c for c in made if c["status"] == "ok"]
    codes = sorted({c["code"] for c in report.calls if c["code"]})
    assert answered, f"no call was answered; the errors were {codes}"
    # the cap on the calls, and on the output of each, held
    assert len(made) <= MAX_CALLS
    assert all(c["output_tokens"] is None or c["output_tokens"] <= MAX_TOKENS for c in answered)
    # usage came from the provider, and the core booked it
    assert all(c["input_tokens"] and c["output_tokens"] for c in answered)
    booked = report.ledger["cheap"]["ok"] + report.ledger["strong"]["ok"]
    assert booked >= 1
    # every reply that came was either shown after the gate or left to the rules
    assert report.answers and all(a["result"] in ("line", "template") for a in report.answers)
    key = os.environ.get(KEY_VARIABLE or "", "")
    assert not key or key not in "\n".join(report.lines())
