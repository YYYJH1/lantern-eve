"""One game and the loop that drives it: the server twin of the browser host's HostRuntime.

A ``Session`` owns one ``Game``. It numbers every input in the order it receives it, applies the
inputs it holds at the next call, and records what the core applied with ``replay.Recorder``.
It steps the core at 10 Hz times the rate the core reports, on a fixed-timestep accumulator
(``clock.py``), so game time follows real time however often the event loop wakes. It hands the
model requests of the core to a transport and the outcomes back as ``model_result`` inputs, and
it tells the core's cancels to the transport.

The class is plain synchronous code. ``pump()`` does one pass of the loop at the time its clock
reports, and ``run()`` is the asyncio task that calls it. Tests give the session a virtual clock
and call ``pump()`` themselves. ``run_lockstep()`` steps without a clock for headless batches:
one call per tick, with the transport's outcomes delivered at the tick they are due.

The transport has a clock of its own, ``transport_tick``, and it is what every call to the
transport carries (``start``, ``cancel``, ``poll`` and ``host_events``). While the world runs it is
the game tick. A world that holds its own clock, as the bridge does while the manager is in a
conversation, does not move the game tick, and an outcome that is due at a tick would never
arrive. So the transport clock goes on, at the normal rate times ``pace`` from the clock of the
session, for as long as the world is held and the host has not asked for a pause. The ticks it has
gone on for are ``held_ticks``, and the transport clock is the game tick plus those: it never goes
back, and in a game in which the world was never held it is the game tick. While the host pauses
the world it stands still.

Messages for a client go to a ``sink``, a function that must not block. They are plain dicts of
the shapes in ``protocol.py``.
"""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import lantern_eve
from lantern_core import __version__ as CORE_VERSION
from lantern_core import canon
from lantern_core.api import FORMAT as CORE_FORMAT
from lantern_core.api import Game, InputError
from lantern_core.replay import Recorder
from lantern_eve.calls import CallTracker
from lantern_eve.clock import NS_PER_MS, FixedStepClock
from lantern_eve.scrub import SCRUBBER, guard
from lantern_eve.transport import ModelOutcome, Transport

REPLAY_FORMAT = 1
HOST_NAME = "server"
# Calls made in one pass of the loop at most, so that messages and timers get their turn.
MAX_BURST = 10
# The longest sleep between passes while a tick is coming, and the poll interval while paused.
MAX_IDLE_S = 0.025
PAUSED_POLL_S = 0.05
STATS_EVERY_NS = 500 * NS_PER_MS
# Inputs that may wait for the next call. A client that sends more is told to slow down.
MAX_PENDING = 1000
# Frames whose events a reconnecting client can ask for again.
EVENT_BACKLOG = 200
SAMPLES = 2048

LOG = guard(logging.getLogger("lantern_eve"))
Sink = Callable[[dict[str, Any]], None]
IDLE, RUNNING, FAILED, CLOSED = "idle", "running", "failed", "closed"


@dataclass(frozen=True)
class GameSpec:
    """The arguments of the ``Game`` constructor."""

    seed: int
    scenario: str = "m0"
    # Ints, and for the bridge two texts (``variant`` and ``opening``, see its docstring).
    config: dict[str, int | str] | None = None


class Samples:
    """The last ``capacity`` samples of a number: enough for a mean, a p95 and a maximum."""

    def __init__(self, capacity: int = SAMPLES) -> None:
        self.values: deque[float] = deque(maxlen=capacity)

    def push(self, value: float) -> None:
        self.values.append(value)

    def mean(self) -> float:
        return sum(self.values) / len(self.values) if self.values else 0.0

    def max(self) -> float:
        return max(self.values, default=0.0)

    def p95(self) -> float:
        if not self.values:
            return 0.0
        ordered = sorted(self.values)
        return ordered[min(len(ordered) - 1, int(len(ordered) * 0.95))]


def _fresh_counters() -> dict[str, int]:
    keys = ("started", "ok", "error", "timeout", "cancelled", "inflight", "discarded")
    return {**dict.fromkeys(keys, 0), "cancelUnknown": 0}


class Session:
    def __init__(
        self,
        session_id: str,
        spec: GameSpec,
        transport_factory: Callable[[GameSpec], Transport],
        *,
        now_ns: Callable[[], int] = time.monotonic_ns,
        wall_clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        pace: int = 1,
        runs_dir: Path | None = None,
        snapshot_every: int | None = None,
        sink: Sink | None = None,
        config_for: Callable[[str], dict[str, int]] | None = None,
    ) -> None:
        if type(pace) is not int or pace < 1:
            raise ValueError("pace must be an int of at least 1")
        self.id = session_id
        self.spec = spec
        self.transport_factory = transport_factory
        self.now_ns = now_ns
        self.wall_clock = wall_clock
        self.pace = pace
        self.runs_dir = runs_dir
        self.snapshot_every = snapshot_every
        self.sink = sink
        # The config keys a game of a scenario gets from the host (the prices), for the games
        # that ``new_game`` starts. The first game's spec carries its own.
        self.config_for = config_for
        self.mode = IDLE
        # Called with the parsed outputs of every call of the core, for tests and batch summaries.
        self.on_outputs: Callable[[dict[str, Any]], None] | None = None

        self.game: Game
        self.recorder: Recorder
        self.transport: Transport
        self.started_at = wall_clock()
        self.clock = FixedStepClock()
        # The ticks that the transport's clock has gone on for while the world held its own clock,
        # and the accumulator that counts them from real time.
        self.held_ticks = 0
        self.hold_clock = FixedStepClock()
        self.pending: list[dict[str, Any]] = []
        self.next_seq = 0
        self.next_tick = 0
        self.core_paused = False
        self.rate: tuple[int, int] = (1, 1)
        # Why the world should be paused. It runs when this is empty.
        self.reasons: list[str] = []
        self.pause_sent = False
        self.calls: set[str] = set()
        self.call_count = 0
        self.models = _fresh_counters()
        self.last_model: dict[str, Any] | None = None
        # The list of model calls of the game that is running.
        self.tracker: CallTracker
        self.py_ms = Samples()
        self.host_ms = Samples()
        self.last_stats_ns = 0
        # Frame messages are numbered from 1. ``seq`` is the number of the latest one.
        self.seq = 0
        self.last_frame: dict[str, Any] | None = None
        self.last_hash: tuple[int, str] | None = None
        self.recent_events: deque[tuple[int, list[dict[str, Any]]]] = deque(maxlen=EVENT_BACKLOG)
        self._task: asyncio.Task[None] | None = None
        self._retired: set[asyncio.Task[None]] = set()
        self._failure: dict[str, str] | None = None
        self._replay_name = ""

    # --- Lifecycle ----------------------------------------------------------------------------

    def start(self, hidden: bool = False) -> None:
        """Build the game and bring the world in line with the reasons to pause it.

        Raises ``ValueError`` if the spec cannot be played, and then the session is as it was.
        """
        game, recorder = self._build(self.spec)
        self.reasons = ["hidden"] if hidden else []
        self._reset(self.spec, game, recorder)

    def _build(self, spec: GameSpec) -> tuple[Game, Recorder]:
        try:
            game = Game(spec.seed, spec.scenario, spec.config)
            return game, Recorder(game, self.snapshot_every)
        except (ValueError, KeyError, TypeError) as err:
            raise ValueError(f"cannot start that game: {err}") from err

    def _reset(self, spec: GameSpec, game: Game, recorder: Recorder) -> None:
        self.transport_discard()
        self._retire_transport()
        self.spec = spec
        self.game = game
        self.recorder = recorder
        self.pending = []
        self.next_seq = 0
        self.next_tick = 0
        self.held_ticks = 0
        self.core_paused = False
        self.rate = (1, 1)
        self.pause_sent = False
        self.calls = set()
        self.call_count = 0
        self.models = _fresh_counters()
        self.last_model = None
        self.py_ms = Samples()
        self.host_ms = Samples()
        self.seq = 0
        self.last_frame = None
        self.last_hash = None
        self.recent_events.clear()
        self._failure = None
        self.started_at = self.wall_clock()
        self._replay_name = ""
        self.clock = FixedStepClock()
        self.hold_clock = FixedStepClock()
        self.transport = self.transport_factory(spec)
        self.transport.open()
        self.tracker = CallTracker(game.header()["config"], self.transport.model_of)
        self.mode = RUNNING
        self.clock.reset(self.now_ns())
        self.hold_clock.reset(self.now_ns())
        self._reconcile_pause()
        self._post_stats(force=True)

    def new_game(
        self, seed: int, scenario: str | None = None, config: dict[str, int | str] | None = None
    ) -> None:
        """Finish this game, write its replay, and start another in the same session.

        ``config`` is laid over the keys the host adds to a game of the scenario (the prices): it
        is how a preset brings its own. Raises ``ValueError`` if the new game cannot be played,
        and then nothing has changed.
        """
        name = scenario or self.spec.scenario
        base: dict[str, int | str] = (
            dict(self.config_for(name)) if self.config_for is not None else {}
        )
        base.update(config or {})
        spec = GameSpec(seed, name, base or None)
        game, recorder = self._build(spec)
        self.write_replay()
        self.emit({"type": "reset", "seed": spec.seed, "scenario": spec.scenario})
        self._reset(spec, game, recorder)

    def stop(self) -> None:
        """End the loop and the calls and write the replay. The session is not used again."""
        if self._task is not None:
            self._task.cancel()
            self._task = None
        was = self.mode
        self.transport_discard()
        if was in (RUNNING, FAILED):
            self.write_replay()
        self.mode = CLOSED

    def transport_discard(self) -> None:
        """End every call in flight without reporting it."""
        transport = getattr(self, "transport", None)
        if transport is not None:
            self.models["discarded"] += len(self.calls)
            transport.discard_all()
            self.calls.clear()
            self.models["inflight"] = 0

    def _retire_transport(self) -> None:
        """Let go of the transport of the game that ends, off the loop's turn if there is one."""
        old = getattr(self, "transport", None)
        if old is None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return  # no event loop: a transport that needs one was never started
        task = loop.create_task(old.aclose())
        self._retired.add(task)
        task.add_done_callback(self._retired.discard)

    async def aclose(self) -> None:
        """``stop``, then release what the transport holds."""
        self.stop()
        await self.transport.aclose()

    def emit(self, message: dict[str, Any]) -> None:
        if self.sink is not None:
            self.sink(message)

    # --- Clients ------------------------------------------------------------------------------

    def attach(self, sink: Sink) -> None:
        """Send this session's messages to ``sink``. A world held for want of one runs again."""
        self.sink = sink
        self.resume("offline")
        self._post_stats(force=True)

    def detach(self, sink: Sink) -> None:
        """Forget ``sink`` if it is the current one. With no client the world is held."""
        if self.sink != sink:  # bound methods are equal, not identical
            return
        self.sink = None
        self.pause("offline")
        if self.mode != CLOSED:
            self.write_replay()

    # --- Inputs from a client -----------------------------------------------------------------

    def pause(self, reason: str) -> None:
        if reason not in self.reasons:
            self.reasons.append(reason)
        self._reconcile_pause()

    def resume(self, reason: str) -> None:
        if reason in self.reasons:
            self.reasons.remove(reason)
        self._reconcile_pause()

    def set_hidden(self, hidden: bool) -> None:
        self.pause("hidden") if hidden else self.resume("hidden")

    def player(self, body: dict[str, Any]) -> None:
        """Queue a player action: a paused world applies it at once, a running one next tick."""
        if self.mode != RUNNING:
            return
        action_id = body.get("action_id") if isinstance(body, dict) else None
        refusal = None
        if not isinstance(body, dict):
            refusal = "the action is not an object"
        elif len(self.pending) >= MAX_PENDING:
            refusal = "too many inputs are waiting"
        else:
            try:
                canon.check(body)
            except canon.CanonError as err:
                refusal = f"the action is not canonical JSON: {err}"
        if refusal is not None:
            self._refuse([{"kind": "player", "body": {"action_id": action_id}}], refusal)
            return
        self._enqueue("player", body)
        self._flush_if_paused()

    def _enqueue(self, kind: str, body: dict[str, Any]) -> None:
        """Number an input in the order it arrives. Numbers are never reused."""
        self.pending.append({"seq": self.next_seq, "kind": kind, "body": body})
        self.next_seq += 1

    def _reconcile_pause(self) -> None:
        """Bring the world in line with the reasons to pause, by a pause or resume input."""
        if self.mode != RUNNING:
            return
        want = bool(self.reasons)
        if want == self.pause_sent:
            return
        self.pause_sent = want
        self._enqueue("pause" if want else "resume", {})
        if not want:
            self.clock.reset(self.now_ns())
            self.hold_clock.reset(self.now_ns())
        self._flush()
        self._post_stats(force=True)

    def _flush_if_paused(self) -> None:
        if self.mode == RUNNING and self.core_paused and self.pending:
            self._flush()

    def _flush(self) -> None:
        if self.mode != RUNNING:
            return
        inputs, self.pending = self.pending, []
        self._step_once(inputs)

    # --- The loop -----------------------------------------------------------------------------

    def start_loop(self) -> asyncio.Task[None]:
        """Run the loop as a task of the running event loop."""
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(
                self.run(), name=f"session-{self.id}"
            )
        return self._task

    async def run(self) -> None:
        while self.mode == RUNNING:
            try:
                delay = self.pump()
            except Exception as err:  # a bug in the host: end the session with an error
                self._fail("host_error", err)
                return
            await asyncio.sleep(delay)

    def pump(self) -> float:
        """One pass of the loop. Returns the seconds to wait before the next one."""
        if self.mode != RUNNING:
            return PAUSED_POLL_S
        now = self.now_ns()
        delay = PAUSED_POLL_S
        if self.core_paused:
            self.clock.reset(now)
            self._advance_transport_clock(now)
            self._collect_results()
            self._flush_if_paused()
        else:
            num, den = self.rate
            self.clock.update(now, num, den, self.pace)
            done = 0
            while (
                done < MAX_BURST
                and self.clock.due() >= 1
                and self.mode == RUNNING
                and not self.core_paused
            ):
                self.clock.consume(1)
                self._collect_results()
                self._flush()
                done += 1
            if self.core_paused:
                self.clock.reset(now)
                self.hold_clock.reset(now)
            if done >= MAX_BURST and self.clock.due() >= 1:
                delay = 0.0
            else:
                wait = self.clock.seconds_until_next(*self.rate, self.pace)
                delay = MAX_IDLE_S if wait is None else max(0.001, min(MAX_IDLE_S, wait))
        if self.mode == RUNNING and now - self.last_stats_ns >= STATS_EVERY_NS:
            self._post_stats(force=True)
        return delay

    def run_lockstep(self, ticks: int) -> None:
        """Step without a clock until the world has simulated ``ticks`` ticks.

        Each call delivers the outcomes the transport has due at its tick, as the loop does, so a
        run with no player input and no pause is the same game as one in real time.
        """
        while self.mode == RUNNING and self.next_tick < ticks:
            if self.core_paused:
                raise RuntimeError(
                    "the world is stopped, paused by the host or held by a conversation, and "
                    "a lockstep run has nobody to resume it or to act in it"
                )
            self._collect_results()
            self._flush()

    # --- The clock of the transport -----------------------------------------------------------

    @property
    def transport_tick(self) -> int:
        """The tick that the transport is told: the game tick, plus the ticks it went on for while
        the world held its own clock."""
        return self.next_tick + self.held_ticks

    def _advance_transport_clock(self, now: int) -> None:
        """Go on with the clock of the transport while the world is stopped: at the normal rate
        (times ``pace``) if the world holds its own clock, and not at all if the host paused it."""
        if self.reasons:
            self.hold_clock.reset(now)
            return
        self.hold_clock.update(now, 1, 1, self.pace)
        due = self.hold_clock.due()
        if due:
            self.hold_clock.consume(due)
            self.held_ticks += due

    # --- One call of the core -----------------------------------------------------------------

    def _step_once(self, inputs: list[dict[str, Any]]) -> dict[str, Any] | None:
        """One call to ``Game.step`` through the recorder.

        What the core applies is recorded only if the call succeeds, so the record only ever holds
        inputs the core accepted. A list the core refuses (``InputError``) leaves the game as it
        was. If it holds player actions they are dropped with a refusal and the call is made again
        without them: a malformed action must not end the session. Anything else is fatal.
        """
        started = time.perf_counter_ns()
        applied = inputs
        raw = ""
        for attempt in range(2):
            try:
                text = canon.dumps_str(applied)
                t0 = time.perf_counter_ns()
                raw = self.recorder.step(text)
                self.py_ms.push((time.perf_counter_ns() - t0) / 1e6)
                break
            except InputError as err:
                players = [i for i in applied if i["kind"] == "player"]
                if attempt == 0 and players:
                    applied = [i for i in applied if i["kind"] != "player"]
                    self._refuse(players, str(err)[:300])
                    continue
                self._fail("core_error", err)
                return None
            except Exception as err:  # the core failed: the record up to here is kept
                self._fail("core_error", err)
                return None
        out = json.loads(raw)
        if out["tick"] != self.next_tick:
            msg = f"the core applied a call at tick {out['tick']}, expected {self.next_tick}"
            self._fail("tick_mismatch", RuntimeError(msg))
            return None
        self.next_tick = out["tick"] + 1 if out["advanced"] else out["tick"]
        self.core_paused = out["clock"]["paused"]
        self.rate = (out["clock"]["rate"][0], out["clock"]["rate"][1])
        self.call_count += 1
        self.seq += 1
        frame = {
            "type": "frame",
            "seq": self.seq,
            "tick": out["tick"],
            "advanced": out["advanced"],
            "frame": out["frame"],
            "events": out["events"],
            "clock": out["clock"],
        }
        if "hash" in out:
            frame["hash"] = out["hash"]
            if out["advanced"]:
                self.last_hash = (out["tick"], out["hash"])
        self.last_frame = frame
        if out["events"]:
            self.recent_events.append((self.seq, out["events"]))
        for event in out["events"]:
            if event["kind"] == "action_ack":
                self.emit(
                    {
                        "type": "ack",
                        "action_id": event["action_id"],
                        "result": event["result"],
                        "reason": event["reason"],
                        "tick": event["tick"],
                    }
                )
        # The calls come before the frame, so that the money in the list is there when the frame
        # says what was spent.
        changed = self.tracker.observe(out, self.game.last_inputs)
        if changed:
            self.emit({"type": "model-calls", "replace": False, "calls": changed})
        self.emit(frame)
        if self.on_outputs is not None:
            self.on_outputs(out)
        for request in out["requests"]:
            self._submit_request(request)
        self._cancel_requests(out["cancels"])
        self.host_ms.push((time.perf_counter_ns() - started) / 1e6)
        return out

    def _refuse(self, players: list[dict[str, Any]], reason: str) -> None:
        """Tell the client that player actions did not reach the core."""
        for item in players:
            body = item["body"]
            action_id = body.get("action_id") if isinstance(body, dict) else None
            self.emit(
                {
                    "type": "ack",
                    "action_id": action_id if isinstance(action_id, str) else None,
                    "result": "refused",
                    "reason": reason,
                    "tick": self.next_tick,
                }
            )
        plural = "" if len(players) == 1 else "s"
        self.emit(
            {
                "type": "notice",
                "code": "input_refused",
                "message": f"the core refused {len(players)} player input{plural}: {reason}",
            }
        )

    # --- Model calls --------------------------------------------------------------------------

    def _submit_request(self, request: dict[str, Any]) -> None:
        request_id = request["request_id"]
        if request_id in self.calls:
            return
        self.models["started"] += 1
        refused = self.transport.precheck(request)
        if refused is not None:
            # No call is made. The answer is queued now and goes to the core with the next call.
            self._record_result(refused)
            return
        self.calls.add(request_id)
        self.models["inflight"] = len(self.calls)
        self.transport.start(request, self.transport_tick)

    def _cancel_requests(self, request_ids: list[str]) -> None:
        """Abort the calls the core cancelled. A call that had finished keeps its real result."""
        for request_id in request_ids:
            if request_id in self.calls:
                self.transport.cancel(request_id, self.transport_tick)
            elif not any(
                p["kind"] == "model_result" and p["body"]["request_id"] == request_id
                for p in self.pending
            ):
                self.models["cancelUnknown"] += 1

    def _collect_results(self) -> None:
        transport = self.transport
        for outcome in transport.poll(self.transport_tick):
            self._record_result(outcome)
        for event in transport.host_events(self.transport_tick):
            self._record_host_event(event)
        for code, message in transport.notices():
            self.emit({"type": "notice", "code": code, "message": message})

    def _record_host_event(self, event: str) -> None:
        """Queue something the transport learned about its providers as a ``host`` input."""
        LOG.info("session %s: host event %s", self.id, event)
        self._enqueue("host", {"event": event})

    def _record_result(self, outcome: ModelOutcome) -> None:
        """Count an outcome and queue it as a ``model_result`` input."""
        self.calls.discard(outcome.request_id)
        self.models["inflight"] = len(self.calls)
        self.models[outcome.status] += 1
        usage = outcome.usage or {}
        self.last_model = {
            "request_id": outcome.request_id,
            "status": outcome.status,
            "latency_ms": outcome.latency_ms,
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
        }
        if outcome.code is not None:
            self.last_model["code"] = outcome.code
        self._enqueue("model_result", outcome.body())

    # --- Failure and statistics ---------------------------------------------------------------

    def _fail(self, code: str, err: BaseException) -> None:
        message = SCRUBBER.scrub(f"{type(err).__name__}: {err}")
        self._failure = {"code": code, "message": message}
        self.mode = FAILED
        self.transport_discard()
        self.emit({"type": "fatal", "code": code, "message": message})
        self._post_stats(force=True)
        self.write_replay()

    @property
    def failure(self) -> dict[str, str] | None:
        return self._failure

    def stats(self) -> dict[str, Any]:
        return {
            "nextTick": self.next_tick,
            "calls": self.call_count,
            "pyMeanMs": self.py_ms.mean(),
            "pyP95Ms": self.py_ms.p95(),
            "pyMaxMs": self.py_ms.max(),
            "hostMeanMs": self.host_ms.mean(),
            "hostMaxMs": self.host_ms.max(),
            "droppedMs": round(float(self.clock.dropped) / NS_PER_MS),
            "inputsLogged": len(self.recorder.records) if hasattr(self, "recorder") else 0,
            "pending": len(self.pending),
            "paused": self.core_paused,
            "reasons": list(self.reasons),
            "rate": list(self.rate),
            "models": dict(self.models),
            "lastModel": self.last_model,
        }

    def _post_stats(self, force: bool = False) -> None:
        now = self.now_ns()
        if not force and now - self.last_stats_ns < STATS_EVERY_NS:
            return
        self.last_stats_ns = now
        if self.sink is not None:
            self.emit({"type": "stats", "stats": self.stats()})

    # --- The full state, for a client that has none or has lost frames ------------------------

    def ending(self) -> dict[str, Any] | None:
        """The whole ending of the game with its reveal, or None before it has ended.

        The frames of a game that is over carry the ending without its reveal, so a client that
        has not seen the call that made it gets the reveal from here.
        """
        return json.loads(self.game.ending_json())

    def preview(self, action: dict[str, Any]) -> dict[str, Any] | None:
        """What ``action`` would ask, give and cost, as ``Game.preview_json`` has it, or None in a
        game that has no previews. It only reads: nothing is recorded and the hash of the game is
        the same after as before. An action the core cannot read is an ``InputError``."""
        return json.loads(self.game.preview_json(canon.dumps_str(action)))

    def state_message(self, since: int | None = None) -> dict[str, Any]:
        """What a client needs to draw from scratch, and the events it missed after ``since``."""
        last = self.last_frame
        events: list[dict[str, Any]] = []
        if since is not None:
            for seq, batch in self.recent_events:
                if seq > since:
                    events.extend(batch)
        return {
            "type": "state",
            "seq": self.seq,
            "tick": None if last is None else last["tick"],
            "advanced": False if last is None else last["advanced"],
            "nextTick": self.next_tick,
            "frame": None if last is None else last["frame"],
            "ending": self.ending(),
            "clock": {"paused": self.core_paused, "rate": list(self.rate)},
            "hash": None if self.last_hash is None else self.last_hash[1],
            "hashTick": None if self.last_hash is None else self.last_hash[0],
            "stateHash": self.game.hash(),
            "calls": self.tracker.snapshot(),
            "events": events,
            "reasons": list(self.reasons),
            "seed": self.spec.seed,
            "scenario": self.spec.scenario,
            "scene": json.loads(self.game.scene_json()),
        }

    # --- The replay ---------------------------------------------------------------------------

    def _replay_view(self) -> dict[str, Any]:
        """The replay of the game so far. It shares its lists with the recorder."""
        recording = self.recorder.recording()
        failed = self.mode == FAILED
        return {
            **recording,
            "host": {
                "name": HOST_NAME,
                "version": lantern_eve.__version__,
                "replayFormat": REPLAY_FORMAT,
            },
            "final": {
                "tick": recording["end_tick"],
                "hash": "" if failed else self.game.hash(),
            },
        }

    def replay(self) -> dict[str, Any]:
        """The replay of the game so far, in the browser host's format, as a copy."""
        return copy.deepcopy(self._replay_view())

    def replay_text(self) -> str:
        return canon.dumps_str(self._replay_view())

    def replay_path(self) -> Path | None:
        if self.runs_dir is None:
            return None
        if not self._replay_name:
            stamp = self.started_at.astimezone(UTC).strftime("%Y%m%dT%H%M%SZ")
            self._replay_name = f"{stamp}-seed{self.spec.seed}-{self.id}.json"
        return self.runs_dir / self._replay_name

    def write_replay(self) -> Path | None:
        """Write the replay of the game so far to ``runs_dir``, replacing the earlier write."""
        path = self.replay_path()
        if path is None or not hasattr(self, "recorder"):
            return None
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            partial = path.with_name(path.name + ".part")
            partial.write_text(self.replay_text(), encoding="utf-8")
            os.replace(partial, path)
        except OSError as err:
            # A game must not end because its record cannot be kept.
            LOG.warning("session %s: the replay could not be written to %s: %s", self.id, path, err)
            return None
        return path

    def core_info(self) -> dict[str, Any]:
        return {"version": CORE_VERSION, "format": CORE_FORMAT}
