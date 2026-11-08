"""Play m0 for a few hundred ticks against a real provider, with a hard cap on the calls.

``test_live_transport.py`` runs this against the provider named in the environment. The same
routine runs against a fake service in ``test_live_routine.py``, so that it is known to work
before it is pointed at a real one and a real key.

What it reports is statuses, latencies, token counts and the ledger of the core. It never reports
the words of a model, an address or a key.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from host_helpers import DENSE

from lantern_eve import providers
from lantern_eve.openai_transport import openai_factory
from lantern_eve.providers import ProviderConfig
from lantern_eve.session import GameSpec, Session

MAX_CALLS = 5
MAX_TOKENS = 48
# The models that the web host uses for each provider (web/src/shared/providers.ts).
DEFAULT_MODELS = {
    "bailian": ("qwen-flash", "qwen-plus"),
    "deepseek": ("deepseek-flash", "deepseek-v4-pro"),
    "ollama": ("qwen3.5:4b", "qwen3.5:4b"),
}
# Chats that last long enough for a reply to come, and meetings that come early.
CONFIG = {**DENSE, "chat_window": 400}


def live_config(provider: str, env: Mapping[str, str]) -> ProviderConfig:
    """The provider file for a short, capped run on ``provider`` (a key of ``KINDS``).

    Both cloud tiers use the provider, with the models named by ``LANTERN_LIVE_MODEL`` (one for
    both) or the defaults of the provider. The price is zero: m0 has no budget gate and keeps its
    ledger in tokens, so it does not matter here, and no price is invented for it.
    """
    cheap, strong = DEFAULT_MODELS.get(provider, ("", ""))
    if env.get("LANTERN_LIVE_MODEL"):
        cheap = strong = env["LANTERN_LIVE_MODEL"]
    if not cheap:
        raise ValueError(f"set LANTERN_LIVE_MODEL: there is no default model for {provider}")
    lines = ["[providers.live]", f'kind = "{provider}"', f"max_output_tokens = {MAX_TOKENS}"]
    if env.get("LANTERN_LIVE_BASE_URL"):
        lines.append(f'base_url = "{env["LANTERN_LIVE_BASE_URL"]}"')
    for tier, model in (("cheap", cheap), ("strong", strong)):
        lines += [f"[tiers.{tier}]", 'provider = "live"', f'model = "{model}"']
        lines += ["price_in = 0", "price_out = 0"]
    lines += ["[queue]", f"max_calls = {MAX_CALLS}"]
    return providers.loads("\n".join(lines), source=f"live {provider}")


@dataclass
class LiveReport:
    ticks: int = 0
    # One dict per model_result input: request_id, status, latency_ms, tokens, code.
    calls: list[dict[str, Any]] = field(default_factory=list)
    host_events: list[str] = field(default_factory=list)
    ledger: dict[str, Any] = field(default_factory=dict)
    models: dict[str, int] = field(default_factory=dict)
    failure: dict[str, str] | None = None
    replay_text: str = ""

    def lines(self) -> list[str]:
        """The report as lines of statuses, latencies and counts."""
        out = [f"ticks played: {self.ticks}", f"host events: {self.host_events}"]
        made = [call for call in self.calls if call["code"] != "call_cap"]
        for call in made:
            code = f" {call['code']}" if call["code"] else ""
            out.append(
                f"call {call['request_id']}: {call['status']}{code} {call['latency_ms']} ms,"
                f" {call['input_tokens']} tokens in, {call['output_tokens']} out"
            )
        if len(made) < len(self.calls):
            out.append(f"{len(self.calls) - len(made)} more requests refused by the call cap")
        out.append(f"session counters: {json.dumps(self.models, sort_keys=True)}")
        out.append(f"ledger: {json.dumps(self.ledger, sort_keys=True)}")
        return out


async def play_live(
    config: ProviderConfig,
    env: Mapping[str, str],
    *,
    ticks: int = 500,
    pace: int = 4,
    seed: int = 1,
    seconds: float = 90.0,
) -> LiveReport:
    """Play m0 in real time until ``ticks`` have been simulated or ``seconds`` have passed."""
    session = Session("live", GameSpec(seed, "m0", CONFIG), openai_factory(config, env), pace=pace)
    session.start()
    session.start_loop()
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds
    try:
        while loop.time() < deadline and session.mode == "running":
            await asyncio.sleep(0.05)
            if session.next_tick >= ticks and session.models["inflight"] == 0:
                break
        # Hold the world and let the calls that are out come in, the late ones as well.
        session.pause("user")
        settle = min(loop.time() + 12.0, deadline + 12.0)
        while session.models["inflight"] and loop.time() < settle:
            await asyncio.sleep(0.05)
        await asyncio.sleep(0.2)
    finally:
        report = LiveReport(
            ticks=session.next_tick,
            ledger=json.loads(session.game.ledger_json()),
            models=dict(session.models),
            failure=session.failure,
        )
        for _tick, _seq, kind, body in session.recorder.records:
            if kind == "model_result":
                usage = body["usage"] or {}
                report.calls.append(
                    {
                        "request_id": body["request_id"],
                        "status": body["status"],
                        "latency_ms": body["latency_ms"],
                        "input_tokens": usage.get("input_tokens"),
                        "output_tokens": usage.get("output_tokens"),
                        # An error's text is its short code. A model's words are not reported.
                        "code": body["text"] if body["status"] == "error" else "",
                    }
                )
            elif kind == "host":
                report.host_events.append(body["event"])
        report.replay_text = session.replay_text()
        await session.aclose()
    return report
