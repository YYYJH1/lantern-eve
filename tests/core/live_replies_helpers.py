"""A short talk against a real provider, through the transport of the server host, with a hard cap
on the calls.

``tests/core/test_live_replies.py`` runs this against the provider named in the environment. The
same routine runs against a fake service in ``test_live_replies_routine.py``, so that it is known
to work before it is pointed at a real one and a real key.

The manager is put in a talk with a townsperson and does four things in turn, each when the one
before is over: asks about the rail, tells them something, asks them to join the helpers (with words
of their own, which sends a judge first) and promises them a stall. Every request of the core goes
to the transport, which sends it to the provider, and every result goes back to the core as a
``model_result`` input. What it reports is, for each call, the status, the latency and the tokens;
for each reply, what the gate made of it; and for each line that landed, both languages. It never
reports a key or an address.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from aiohttp import web
from dealings_helpers import know, trust
from reply_helpers import Room

from lantern_core.api import Game
from lantern_core.world.bridge import speech
from lantern_eve import providers
from lantern_eve.openai_transport import openai_factory
from lantern_eve.providers import ProviderConfig
from lantern_eve.session import GameSpec

MAX_CALLS = 8
MAX_TOKENS = 400
WHO = "cha_laoban"
# The models that the web host uses for each provider (web/src/shared/providers.ts).
DEFAULT_MODELS = {
    "bailian": ("qwen-flash", "qwen-plus"),
    "deepseek": ("deepseek-flash", "deepseek-v4-pro"),
    "ollama": ("qwen3.5:4b", "qwen3.5:4b"),
}
# Yuan per million tokens: those of the core for the two cloud tiers, and nothing for a model here.
PRICES = {"cheap": (0.15, 1.5), "strong": (0.8, 8.0), "local": (0, 0)}
PLAN = (
    ("ask", "ask", {"topic": "t_rail", "words": "What happened to the rail?"}),
    ("tell", "tell", {"entry": "n1", "how": "faithful", "words": "I saw the scratches myself."}),
    (
        "entrust",
        "entrust",
        {"kind": "join", "words": "Please, the bridge needs every pair of hands."},
    ),
    (
        "promise",
        "promise",
        {"what": "stall", "item": "front", "due": 3, "words": "A good place at the festival."},
    ),
)


def live_config(provider: str, env: Mapping[str, str]) -> ProviderConfig:
    """The provider file for a short, capped run on ``provider`` (a key of ``providers.KINDS``).

    Both cloud tiers use the provider, with the models named by ``LANTERN_LIVE_MODEL`` (one for
    both) or the defaults of the provider, at the prices of the core.
    """
    cheap, strong = DEFAULT_MODELS.get(provider, ("", ""))
    if env.get("LANTERN_LIVE_MODEL"):
        cheap = strong = env["LANTERN_LIVE_MODEL"]
    if not cheap:
        raise ValueError(f"set LANTERN_LIVE_MODEL: there is no default model for {provider}")
    lines = ["[providers.live]", f'kind = "{provider}"', f"max_output_tokens = {MAX_TOKENS}"]
    if env.get("LANTERN_LIVE_BASE_URL"):
        lines.append(f'base_url = "{env["LANTERN_LIVE_BASE_URL"]}"')
    local = provider in ("ollama", "vllm")
    for tier, model, (price_in, price_out) in (
        ("cheap", cheap, PRICES["local" if local else "cheap"]),
        ("strong", strong, PRICES["local" if local else "strong"]),
    ):
        lines += [f"[tiers.{tier}]", 'provider = "live"', f'model = "{model}"']
        lines += [f"price_in = {price_in}", f"price_out = {price_out}"]
    lines += ["[queue]", f"max_calls = {MAX_CALLS}", "timeout_s = 20.0"]
    return providers.loads("\n".join(lines), source=f"live {provider}")


@dataclass
class LiveReport:
    ticks: int = 0
    # One dict per model_result: request_id, what it was for, status, latency_ms, tokens, code.
    calls: list[dict[str, Any]] = field(default_factory=list)
    # One dict per line that landed or fell back: verb, result, by, cause, zh, en.
    answers: list[dict[str, Any]] = field(default_factory=list)
    host_events: list[str] = field(default_factory=list)
    counts: dict[str, Any] = field(default_factory=dict)
    actions: list[tuple[str, str, str | None]] = field(default_factory=list)
    ledger: dict[str, Any] = field(default_factory=dict)
    failure: str | None = None

    def lines(self) -> list[str]:
        """The report as lines of statuses, latencies, tokens, verdicts and the lines landed."""
        out = [f"ticks played: {self.ticks}", f"host events: {self.host_events}"]
        for label, result, reason in self.actions:
            out.append(f"action {label}: {result}{' ' + reason if reason else ''}")
        made = [call for call in self.calls if call["code"] != "call_cap"]
        for call in made:
            code = f" {call['code']}" if call["code"] else ""
            out.append(
                f"call {call['request_id']} ({call['for']}): {call['status']}{code}"
                f" {call['latency_ms']} ms, {call['input_tokens']} tokens in,"
                f" {call['output_tokens']} out; gate: {call['verdict']}"
            )
        if len(made) < len(self.calls):
            out.append(f"{len(self.calls) - len(made)} more requests refused by the call cap")
        for answer in self.answers:
            how = f"{answer['result']} by {answer['by']}" + (
                f" ({answer['cause']})" if answer["cause"] else ""
            )
            out.append(f"answer to {answer['verb']}: {how}")
            if answer["result"] == "line":
                out.append(f"    zh: {answer['zh']}")
                out.append(f"    en: {answer['en']}")
        out.append(f"counts of the gate: {json.dumps(self.counts, sort_keys=True)}")
        out.append(f"ledger: {json.dumps(self.ledger, sort_keys=True)}")
        return out


def verdict(before: dict[str, Any], after: dict[str, Any]) -> str:
    """What the gate made of the reply that landed between two readings of its counts."""
    judged = after["lines"] - before["lines"]
    if after["judge"]["scored"] > before["judge"]["scored"]:
        return "judge: scored"
    if after["judge"]["unscored"] > before["judge"]["unscored"]:
        return "judge: no score"
    if judged == 0:
        return "not judged"
    if after["passed"] > before["passed"]:
        return "passed"
    codes = {
        k: after["codes"][k] - before["codes"].get(k, 0)
        for k in sorted(after["codes"])
        if after["codes"][k] != before["codes"].get(k, 0)
    }
    repair = "; repair asked" if after["repairs"] > before["repairs"] else ""
    return f"refused ({', '.join(codes)}){repair}"


async def play_talk(
    config: ProviderConfig,
    env: Mapping[str, str],
    *,
    seed: int = 1,
    pace: float = 0.3,
    seconds: float = 120.0,
) -> LiveReport:
    """Play the talk in real time until the plan is done and nothing is out, or ``seconds`` pass.

    The world stands still in a talk, so a call of the core brings it an act or a result and
    simulates no tick. ``pace`` is the seconds between two such calls: the time a host waits for a
    model, polling the held world. While the world pays for an act (``clock.paused`` is false, at
    ``[20, 1]``) the host does not wait: it calls once per tick, as the drivers of the cross-host
    tests do.
    """
    spec_config = config.game_config("bridge")
    room = Room(WHO, seed=seed, **spec_config)
    game: Game = room.game
    trust(game, WHO, 40)
    know(game, "pr_boat_scratched")
    transport = openai_factory(config, env)(GameSpec(seed, "bridge", spec_config))
    transport.open()
    report = LiveReport()
    loop = asyncio.get_running_loop()
    deadline = loop.time() + seconds
    plan = list(PLAN)
    queued: list[tuple[str, dict[str, Any]]] = []
    purposes: dict[str, str] = {}
    made = 0
    settle = 0
    try:
        while loop.time() < deadline and report.failure is None:
            tick = game.tick
            for outcome in transport.poll(tick):
                queued.append(("model_result", outcome.body()))
            for event in transport.host_events(tick):
                report.host_events.append(event)
                queued.append(("host", {"event": event}))
            waiting = bool(game.in_flight()) or bool(queued)
            if plan and not waiting and made < MAX_CALLS:
                label, type_, fields = plan.pop(0)
                body = {"action_id": f"live-{label}", "type": type_, **fields}
                queued.append(("player", body))
                purposes[body["action_id"]] = label
            if not plan and not waiting:
                settle += 1
                if settle > 5:
                    break
            before = json.loads(json.dumps(room.section))
            records = []
            seq = game.next_seq
            for kind, body in queued:
                records.append({"seq": seq, "kind": kind, "body": body})
                seq += 1
            out = json.loads(game.step(json.dumps(records)))
            after = json.loads(json.dumps(room.section))
            landed = [body for kind, body in queued if kind == "model_result"]
            queued = []
            for kind, body in [(r["kind"], r["body"]) for r in records]:
                if kind == "model_result":
                    request = purposes.get(body["request_id"], "?")
                    usage = body["usage"] or {}
                    report.calls.append(
                        {
                            "request_id": body["request_id"],
                            "for": request,
                            "status": body["status"],
                            "latency_ms": body["latency_ms"],
                            "input_tokens": usage.get("input_tokens"),
                            "output_tokens": usage.get("output_tokens"),
                            # an error's text is its short code; a model's words are not reported
                            "code": body["text"] if body["status"] == "error" else "",
                            "verdict": verdict(before, after),
                        }
                    )
            for event in out["events"]:
                if event["kind"] == "action_ack" and event["action_id"] in purposes:
                    report.actions.append(
                        (purposes[event["action_id"]], event["result"], event["reason"])
                    )
                if event["kind"] == "answered":
                    line = {"zh": "", "en": ""}
                    for bubble in out["frame"]["bubbles"]:
                        if bubble["npc"] == event["npc"]:
                            line = bubble["text"]
                    report.answers.append({**event, "zh": line["zh"], "en": line["en"]})
            for request in out["requests"]:
                purposes[request["request_id"]] = f"{request['tier']} {request['interaction_id']}"
                refused = transport.precheck(request)
                if refused is not None:
                    queued.append(("model_result", refused.body()))
                else:
                    transport.start(request, game.tick)
                    made += 1
            for request_id in out["cancels"]:
                transport.cancel(request_id, game.tick)
            del landed
            await asyncio.sleep(pace if out["clock"]["paused"] else 0)
    except Exception as err:  # the core failed: say so, and keep what was seen
        report.failure = f"{type(err).__name__}: {str(err)[:300]}"
    finally:
        report.ticks = game.tick
        report.counts = {
            k: v for k, v in sorted(room.section.items()) if k not in ("pending", "turn")
        }
        report.ledger = json.loads(game.ledger_json())
        await transport.aclose()
    return report


# ----------------------------------------------------------------------------- a service to try on


class FakeService:
    """An OpenAI-compatible service on 127.0.0.1 that answers a reply with a line that passes and a
    judgement with a score, for the test of the routine."""

    def __init__(self, models: tuple[str, ...] = ("qwen-flash", "qwen-plus")) -> None:
        self.models = list(models)
        self.seen: list[dict[str, Any]] = []
        self._runner: web.AppRunner | None = None
        self.port = 0

    async def start(self) -> FakeService:
        app = web.Application(client_max_size=1 << 22)
        app.router.add_post("/v1/chat/completions", self._chat)
        app.router.add_get("/v1/models", self._models)
        self._runner = web.AppRunner(app, shutdown_timeout=0.2)
        await self._runner.setup()
        await web.TCPSite(self._runner, "127.0.0.1", 0).start()
        self.port = int(self._runner.addresses[0][1])
        return self

    async def stop(self) -> None:
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1"

    async def _models(self, request: web.Request) -> web.Response:
        data = [{"id": m, "object": "model"} for m in self.models]
        return web.json_response({"object": "list", "data": data})

    async def _chat(self, request: web.Request) -> web.Response:
        body = await request.json()
        self.seen.append(body)
        system = body["messages"][0]["content"]
        if system.startswith("You judge how far"):
            text = '{"score": 3}'
        else:
            text = json.dumps(
                {"acts": [], "line": {"zh": "今天风很大。", "en": "Windy today."}},
                ensure_ascii=False,
            )
        answer = {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "model": body.get("model", ""),
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 900, "completion_tokens": 30, "total_tokens": 930},
        }
        return web.json_response(answer)


__all__ = [
    "MAX_CALLS",
    "MAX_TOKENS",
    "FakeService",
    "LiveReport",
    "live_config",
    "play_talk",
    "speech",
]
