"""A session and a server host playing m0 through the OpenAI-compatible transport."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime

from fake_provider import FakeProvider
from host_helpers import DENSE, Client, VirtualClock, serving, wait_for
from provider_helpers import KEY, make_config

from lantern_core.replay import rebuild
from lantern_eve.openai_transport import openai_factory
from lantern_eve.server import HostOptions
from lantern_eve.session import GameSpec, Session


def run(coro):
    return asyncio.run(coro)


class Rig:
    """Fakes for the three tiers, a session on a virtual clock, and the messages it sent."""

    def __init__(self, *, config: dict | None = None, key: str | None = KEY, **options) -> None:
        self.options = options
        self.config = DENSE if config is None else config
        self.key = key
        self.messages: list[dict] = []

    async def __aenter__(self) -> Rig:
        self.cloud = await FakeProvider(models=("cheap-model", "strong-model")).start()
        self.local = await FakeProvider(models=("local-model",)).start()
        self.clock = VirtualClock()
        options = dict(self.options)
        configure = options.pop("fakes", None)
        if configure is not None:
            configure(self.cloud, self.local)
        provider_config = make_config(self.cloud, local=self.local, **options)
        env = {} if self.key is None else {"CLOUD_KEY": self.key}
        self.session = Session(
            "s-live",
            GameSpec(5, "m0", self.config),
            openai_factory(provider_config, env),
            now_ns=self.clock,
            wall_clock=lambda: datetime(2026, 11, 2, 12, 0, 0, tzinfo=UTC),
            sink=self.messages.append,
        )
        self.session.start()
        return self

    async def __aexit__(self, *exc) -> None:
        await self.session.aclose()
        await self.cloud.stop()
        await self.local.stop()

    async def play(self, ticks: int, step_ms: int = 100, nap: float = 0.002) -> None:
        """Run the world to ``ticks``, letting real time pass so that the calls can finish."""
        while self.session.next_tick < ticks:
            self.clock.advance_ms(step_ms)
            self.session.pump()
            await asyncio.sleep(nap)

    async def play_until(self, condition, ticks: int = 3000) -> None:
        """Run the world until ``condition()`` holds. Fails if ``ticks`` come first."""
        while not condition():
            assert self.session.next_tick < ticks, "the condition did not come true"
            self.clock.advance_ms(100)
            self.session.pump()
            await asyncio.sleep(0.002)

    async def settle(self, seconds: float) -> None:
        """Let calls finish with the world standing still, as a paused game does."""
        self.session.pause("user")
        await asyncio.sleep(seconds)
        self.clock.advance_ms(100)
        self.session.pump()

    def results(self) -> list[dict]:
        return [r[3] for r in self.session.recorder.records if r[2] == "model_result"]

    def chatter(self) -> list[dict]:
        return [
            e
            for m in self.messages
            if m["type"] == "frame"
            for e in m["events"]
            if e["kind"] == "chatter"
        ]

    def ledger(self) -> dict:
        return json.loads(self.session.game.ledger_json())


def test_a_game_is_played_through_real_calls_and_its_replay_rebuilds():
    async def main():
        async with Rig() as rig:
            await rig.play(600)
            await rig.settle(0.2)
            session = rig.session
            results = rig.results()
            assert len(results) >= 5
            assert {r["status"] for r in results} == {"ok"}
            assert {json.dumps(r["usage"], sort_keys=True) for r in results} == {
                '{"input_tokens": 20, "output_tokens": 5}'
            }
            lines = rig.chatter()
            assert lines and {(e["source"], e["text"]) for e in lines} == {("model", "fake reply")}
            # The core booked what the service reported, per tier.
            cheap = rig.ledger()["cheap"]
            assert cheap["ok"] >= 5 and cheap["input_tokens"] == 20 * cheap["settled"]
            assert cheap["output_tokens"] == 5 * cheap["settled"]
            # What went out: the model of the tier, the cap of the request, thinking off, the key.
            assert len(rig.cloud.seen) >= 5
            for seen in rig.cloud.seen:
                assert seen.model == "cheap-model" and seen.body["max_tokens"] == 48
                assert seen.body["enable_thinking"] is False and seen.body["stream"] is False
                assert seen.headers["authorization"] == f"Bearer {KEY}"
            assert rig.local.seen == []
            # A model result is an input like any other, so the game replays without the service.
            replay = session.replay()
            assert rebuild(replay).hash() == session.game.hash()
            assert session.models["ok"] == len(results) and session.models["inflight"] == 0

    run(main())


def test_the_calls_are_listed_with_the_model_that_answered_each():
    async def main():
        async with Rig() as rig:
            await rig.play(600)
            await rig.settle(0.2)
            listed = {
                c["id"]: c for m in rig.messages if m["type"] == "model-calls" for c in m["calls"]
            }
            assert len(listed) >= 5
            assert {c["model"] for c in listed.values()} == {"cheap-model"}
            done = [c for c in listed.values() if c["status"] == "ok"]
            assert len(done) >= 5 and all(c["latency_ms"] is not None for c in done)
            assert all(c["usage"] == {"input_tokens": 20, "output_tokens": 5} for c in done)

    run(main())


def test_the_local_model_found_at_the_start_is_a_recorded_host_input():
    async def main():
        async with Rig() as rig:

            def hosts():
                return [(r[0], r[3]) for r in rig.session.recorder.records if r[2] == "host"]

            await rig.play_until(hosts)
            await rig.play(rig.session.next_tick + 20)  # nothing more follows
            assert [body for _, body in hosts()] == [{"event": "local_up"}]
            assert rig.local.model_lists == 1
            assert rebuild(rig.session.replay()).hash() == rig.session.game.hash()

    run(main())


def test_calls_that_time_out_become_template_lines_and_their_late_answers_are_voided_and_booked():
    def slow(cloud, local):
        cloud.delay = 0.4

    async def main():
        async with Rig(fakes=slow, queue={"timeout_s": 0.15, "late_s": 3}) as rig:
            await rig.play(500)
            await rig.settle(0.8)
            results = rig.results()
            statuses = [r["status"] for r in results]
            assert statuses.count("timeout") >= 2 and statuses.count("ok") >= 2
            # Every timeout was followed by its late answer, for the same request.
            ids = {r["request_id"] for r in results if r["status"] == "timeout"}
            assert ids == {r["request_id"] for r in results if r["status"] == "ok"}
            lines = rig.chatter()
            assert lines and {e["source"] for e in lines} == {"template"}
            events = [e for m in rig.messages if m["type"] == "frame" for e in m["events"]]
            voids = [e for e in events if e["kind"] == "void"]
            assert voids and {e["reason"] for e in voids} == {"unknown_request"}
            ledger = rig.ledger()
            assert ledger["unattributed"]["results"] == len(voids)
            assert ledger["unattributed"]["input_tokens"] == 20 * len(voids)
            # The timeout booked the whole reservation, which is more than the answers used.
            assert ledger["cheap"]["timeout"] == statuses.count("timeout")
            assert ledger["cheap"]["input_tokens"] > 20 * ledger["cheap"]["settled"]
            assert rebuild(rig.session.replay()).hash() == rig.session.game.hash()

    run(main())


def test_a_cancel_of_the_core_closes_the_call_at_the_service():
    def slow(cloud, local):
        cloud.delay = 30.0

    async def main():
        async with Rig(fakes=slow, queue={"timeout_s": 60, "late_s": 1}) as rig:
            await rig.play(900)
            await rig.settle(0.2)
            results = rig.results()
            cancelled = [r for r in results if r["status"] == "cancelled"]
            assert cancelled and all(r["usage"] is None for r in cancelled)
            for _ in range(500):  # the service sees the connection close a moment later
                if len(rig.cloud.aborted) >= len(cancelled):
                    break
                await asyncio.sleep(0.01)
            assert len(rig.cloud.aborted) >= len(cancelled)
            assert rig.ledger()["cheap"]["cancelled"] == len(cancelled)
            assert rig.session.models["cancelled"] == len(cancelled)
            assert rebuild(rig.session.replay()).hash() == rig.session.game.hash()

    run(main())


def test_a_key_never_reaches_a_log_a_replay_a_frame_or_an_error(caplog):
    leaked = "sk-leaky-key-0123456789"

    def leaks(cloud, local):
        cloud.leak_key = True  # the service writes the key it was sent into its answers

    async def good_key():
        async with Rig(fakes=leaks, key=leaked) as rig:
            await rig.play(500)
            await rig.settle(0.4)
            assert rig.chatter() and all("[key]" in e["text"] for e in rig.chatter())
            return rig

    def wrong(cloud, local):
        cloud.key = "the-key-the-service-wants-0123"  # every call gets a 401 that quotes the header

    async def wrong_key():
        async with Rig(fakes=wrong, key=leaked) as rig:
            await rig.play(500)
            await rig.settle(0.4)
            assert {r["status"] for r in rig.results()} == {"error"}
            assert {r["text"] for r in rig.results()} == {"http_401"}
            return rig

    with caplog.at_level(logging.DEBUG):
        for scenario in (good_key, wrong_key):
            rig = run(scenario())
            assert leaked not in rig.session.replay_text()
            assert leaked not in json.dumps(rig.messages)
            assert leaked not in json.dumps(rig.session.stats())
            assert leaked not in repr(rig.session.transport)
    assert leaked not in caplog.text


def test_a_server_host_plays_with_the_real_transport_and_gives_new_games_their_prices(tmp_path):
    async def main():
        cloud = await FakeProvider(models=("cheap-model", "strong-model")).start()
        try:
            config = make_config(cloud)
            async with serving(
                tmp_path,
                transport_factory=openai_factory(config, {"CLOUD_KEY": KEY}),
                transport_name="openai",
                game_config=config.game_config,
                pace=20,
            ) as host:
                client = await Client.connect(host)
                await client.hello(seed=7)
                welcome = await client.recv()
                assert welcome["transport"] == "openai"
                stats = await client.until("stats")
                assert "models" in stats["stats"]
                await wait_for(lambda: len(cloud.seen) >= 3, timeout=20)
                last = None
                while last is None or last["stats"]["models"]["ok"] < 1:
                    last = await client.until("stats")
                assert last["stats"]["lastModel"]["status"] == "ok"
                # m0 takes no prices, and the bridge scenario takes them from the file.
                await client.send({"type": "new-game", "seed": 8, "scenario": "bridge"})
                await client.until("reset", scenario="bridge")
                await client.send({"type": "call", "reqId": 1, "call": {"op": "export"}})
                reply = await client.until("reply", reqId=1)
                header = reply["result"]["header"]["config"]
                assert (
                    header["price_cheap_in"] == 150_000 and header["price_strong_out"] == 8_000_000
                )
                await client.close()
        finally:
            await cloud.stop()

    run(main())


def test_the_options_of_a_server_host_keep_their_defaults_for_the_mock():
    options = HostOptions()
    assert options.game_config is None and options.transport_factory is None


def test_a_slow_reply_the_player_waits_for_is_announced_to_the_page_and_never_recorded():
    def slow(cloud, local):
        cloud.delay = 0.4

    async def main():
        async with Rig(
            fakes=slow, queue={"thinking_s": 0.1, "timeout_s": 5}, classes={"chatter": 1}
        ) as rig:
            await rig.play(400)
            await rig.settle(0.6)
            notices = [m for m in rig.messages if m["type"] == "notice"]
            assert notices and {m["code"] for m in notices} == {"thinking"}
            assert all(m["message"].startswith("a reply is taking a while (r") for m in notices)
            # It is a message to the page, not an input of the core.
            assert {r[2] for r in rig.session.recorder.records} <= {
                "model_result",
                "host",
                "pause",
                "resume",
                "player",
            }
            assert not [r for r in rig.session.recorder.records if "thinking" in json.dumps(r)]

    run(main())


def test_a_new_game_ends_the_calls_of_the_old_one_at_the_service_and_hears_nothing_of_them():
    def hang(cloud, local):
        cloud.delay = 30.0

    async def main():
        async with Rig(fakes=hang, queue={"timeout_s": 60}) as rig:
            session = rig.session
            await rig.play_until(lambda: session.models["inflight"] >= 2)
            old = session.transport
            out = len(rig.cloud.seen)
            assert out >= 2
            session.new_game(6)
            assert session.transport is not old and session.models["inflight"] == 0
            for _ in range(500):
                if len(rig.cloud.aborted) >= out:
                    break
                await asyncio.sleep(0.01)
            assert len(rig.cloud.aborted) >= out  # every call the old game had out was closed
            await asyncio.sleep(0.1)
            assert [r for r in session.recorder.records if r[2] == "model_result"] == []
            assert session.models["cancelled"] == 0 and session.models["discarded"] == 0
            # The new game has a transport of its own, and it works.
            await rig.play_until(lambda: session.models["inflight"] >= 1)

    run(main())
