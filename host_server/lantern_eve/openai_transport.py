"""The transport for OpenAI-compatible services: a queue in front of ``ChatClient``.

A request of the core names a tier. The provider file says which provider and model answer that
tier (``providers.py``), and this module decides when the call goes out, how long the game waits
for it and what the game is told about the provider.

The queue
---------
Each tier has its own limit on the calls in flight (``queue.concurrency``, 8 for ``cheap``, 3 for
``strong``). A request that finds the limit reached waits in one of four classes, which the
category of the request decides (``classes``, and class 3 for a category that is not listed). When
a call ends, the waiting request of the lowest class goes next, and inside a class the one that
arrived first. The classes only say who goes first. They change nothing about a call, and a
request that waits is not moved to another tier.

Time
----
The host timeout runs from the moment the core asks, so it covers the wait in the queue as well
as the call. When it passes, the game is told ``timeout`` and goes on with a template line. A
request that never left the queue cost nothing and is booked at zero tokens. A call that was out
costs what it costs, which nobody knows yet, so it is booked unknown and the core charges the whole
reservation. That call is not aborted, and not retried on another model. It is left to finish for
up to ``queue.late_s`` seconds. If it finishes with an answer the answer is reported late with its
real usage, which the core voids and books. A late failure says nothing the game can use and is
not reported. The slot of the call stays taken until it really ends.

A reply the player waits for (class 1) that is not in after ``queue.thinking_s`` is announced to
the page as a ``thinking`` notice, so that the townsperson can look as if they are thinking.

A cancel from the core aborts the call: the connection is closed, and ``cancelled`` is reported
at once. A request that was still waiting is booked at zero tokens, one that was out as unknown.
A call that has already finished keeps its real outcome, which the core voids and still books.

What the game is told about the providers
-----------------------------------------
Two things are recorded as ``host`` inputs (see ``Transport.host_events``). A local model is
reported ``local_up`` when its model list answers and names the model of the local tier, which is
looked for once when the game starts and again every ``queue.probe_s`` seconds until it is found.
The cloud is reported ``cloud_down`` after ``queue.down_after`` network failures in a row, and
``local_down`` likewise for the local model. A service that is down is looked at every
``queue.probe_s`` seconds, and ``cloud_up`` or ``local_up`` follows as soon as it answers, which a
call that gets through also brings about. Only network failures count: a connection that cannot be
made or is cut, and a proxy that will not tunnel. A timeout, a 429 or a 5xx does not, because the
service is there. Then the game decides what to do with a slow or busy one.

A transport is made for one game and lives in one event loop. The limits are those of the game,
so a server with several games at once multiplies them.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import time
from collections import deque
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING, Any

from lantern_eve.chat import ZERO_USAGE, CallResult, ChatClient, request_body
from lantern_eve.providers import CLOUD_TIERS, ProviderConfig
from lantern_eve.scrub import SCRUBBER, Scrubber, guard
from lantern_eve.transport import ModelOutcome, Transport

if TYPE_CHECKING:
    from lantern_eve.session import GameSpec

LOG = guard(logging.getLogger("lantern_eve.models"))

QUEUED, RUNNING = "queued", "running"
# How long a look at a model list may take.
PROBE_TIMEOUT_S = 3.0
SIDES = {"cheap": "cloud", "strong": "cloud", "local": "local"}


@dataclass(eq=False)
class _Call:
    request: Mapping[str, Any]
    id: str
    tier: str
    queue_class: int
    started: float
    state: str = QUEUED
    # An outcome has been handed to the game for it, so that none will be again.
    reported: bool = False
    timed_out: bool = False
    discarded: bool = False
    task: asyncio.Task[CallResult] | None = None
    timeout_handle: asyncio.TimerHandle | None = None
    thinking_handle: asyncio.TimerHandle | None = None
    late_handle: asyncio.TimerHandle | None = None


@dataclass
class _Side:
    """What the transport has told the game about the cloud, or about the local model."""

    name: str
    up: bool
    failures: int = 0
    probe: asyncio.Task[None] | None = None


class OpenAITransport(Transport):
    def __init__(
        self,
        config: ProviderConfig,
        *,
        env: Mapping[str, str] | None = None,
        scrubber: Scrubber = SCRUBBER,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.config = config
        self.queue = config.queue
        self._scrubber = scrubber
        self._clock = clock
        environment = os.environ if env is None else env
        # The keys, by provider. They are read once, here, and go nowhere but the headers.
        self._keys: dict[str, str] = {}
        for provider in config.providers.values():
            value = (
                environment.get(provider.api_key_env, "").strip() if provider.api_key_env else ""
            )
            if value:
                self._keys[provider.name] = value
                scrubber.register(value)
        self._loop: asyncio.AbstractEventLoop | None = None
        self._client: ChatClient | None = None
        self._closed = False
        self._accepted = 0
        self._calls: dict[str, _Call] = {}
        self._queues: dict[str, list[deque[_Call]]] = {
            tier: [deque() for _ in range(4)] for tier in config.tiers
        }
        self._running = dict.fromkeys(config.tiers, 0)
        self._tasks: set[asyncio.Task[Any]] = set()
        self._reported_errors: set[tuple[str, str]] = set()
        self._outbox: list[ModelOutcome] = []
        self._events: list[str] = []
        self._notices: list[tuple[str, str]] = []
        # A game starts with the cloud up and no local model.
        self.cloud = _Side("cloud", up=True)
        self.local = _Side("local", up=False)

    def __repr__(self) -> str:
        tiers = ", ".join(
            f"{tier}={spec.model}@{spec.provider}" for tier, spec in self.config.tiers.items()
        )
        return f"OpenAITransport({tiers}; keys set for {sorted(self._keys)})"

    # --- The interface ------------------------------------------------------------------------

    def open(self) -> None:
        # With no event loop yet, the first call to start() opens the transport.
        with contextlib.suppress(RuntimeError):
            self._ensure_started()

    def precheck(self, request: Mapping[str, Any]) -> ModelOutcome | None:
        tier = request.get("tier")
        spec = self.config.tiers.get(tier) if isinstance(tier, str) else None
        code = None
        if spec is None:
            code = "no_provider"
        elif (
            self.config.providers[spec.provider].api_key_env is not None
            and spec.provider not in self._keys
        ):
            code = "no_key"
        elif self.queue.max_calls and self._accepted >= self.queue.max_calls:
            code = "call_cap"
        if code is None:
            return None
        # Nothing leaves the host in any of these cases, so the cost is known to be nothing.
        return ModelOutcome(request["request_id"], "error", code, dict(ZERO_USAGE), 0, code=code)

    def start(self, request: Mapping[str, Any], tick: int) -> None:
        loop = self._ensure_started()
        request_id = request["request_id"]
        if request_id in self._calls:
            return
        refused = self.precheck(request)
        if refused is not None:
            self._outbox.append(refused)
            return
        self._accepted += 1
        queue_class = self.queue.class_of(request.get("category"))
        call = _Call(request, request_id, request["tier"], queue_class, self._clock())
        self._calls[request_id] = call
        self._queues[call.tier][queue_class - 1].append(call)
        call.timeout_handle = loop.call_later(
            self.queue.timeout_for(queue_class), self._on_timeout, call
        )
        if queue_class == 1:
            call.thinking_handle = loop.call_later(self.queue.thinking_s, self._on_thinking, call)
        self._dispatch(call.tier)

    def cancel(self, request_id: str, tick: int) -> None:
        call = self._calls.get(request_id)
        if call is None or call.discarded:
            return
        if call.reported:
            if call.timed_out:
                self._abort(call)  # the game has settled it: nobody wants the late answer
            return
        if call.state == QUEUED:
            self._dequeue(call)
            self._report(
                call, ModelOutcome(call.id, "cancelled", "", dict(ZERO_USAGE), self._ms(call))
            )
        else:
            self._report(call, ModelOutcome(call.id, "cancelled", "", None, self._ms(call)))
            self._abort(call)

    def poll(self, tick: int) -> list[ModelOutcome]:
        out, self._outbox = self._outbox, []
        return out

    def host_events(self, tick: int) -> list[str]:
        out, self._events = self._events, []
        return out

    def model_of(self, request: Mapping[str, Any]) -> str | None:
        tier = request.get("tier")
        spec = self.config.tiers.get(tier) if isinstance(tier, str) else None
        return None if spec is None else spec.model

    def notices(self) -> list[tuple[str, str]]:
        out, self._notices = self._notices, []
        return out

    def discard_all(self) -> None:
        for call in list(self._calls.values()):
            call.discarded = True
            self._stop_timers(call)
            self._abort(call)
        self._calls.clear()
        for classes in self._queues.values():
            for waiting in classes:
                waiting.clear()
        self._outbox.clear()
        self._events.clear()
        self._notices.clear()
        for side in (self.cloud, self.local):
            if side.probe is not None:
                side.probe.cancel()
                side.probe = None

    async def aclose(self) -> None:
        self.discard_all()
        self._closed = True
        tasks = list(self._tasks)
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        if self._client is not None:
            await self._client.aclose()

    # --- Starting up --------------------------------------------------------------------------

    def _ensure_started(self) -> asyncio.AbstractEventLoop:
        """The event loop, and the first time the client and the look for a local model."""
        if self._loop is None:
            loop = asyncio.get_running_loop()  # RuntimeError where there is none
            self._loop = loop
            self._client = ChatClient(self.queue.connect_s, self._scrubber)
            if "local" in self.config.tiers:
                self._start_probe(self.local, immediate=True)
        return self._loop

    def _spawn(self, coro: Any) -> asyncio.Task[Any]:
        assert self._loop is not None
        task = self._loop.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    # --- The queue ----------------------------------------------------------------------------

    def _dispatch(self, tier: str) -> None:
        """Start the waiting requests of ``tier`` that the limit allows, best class first."""
        if self._closed:
            return
        limit = self.queue.concurrency[tier]
        while self._running[tier] < limit:
            call = self._next(tier)
            if call is None:
                return
            self._running[tier] += 1
            call.state = RUNNING
            call.task = self._spawn(self._complete(call))
            call.task.add_done_callback(partial(self._ended, call))

    def _next(self, tier: str) -> _Call | None:
        for waiting in self._queues[tier]:
            if waiting:
                return waiting.popleft()
        return None

    def _dequeue(self, call: _Call) -> None:
        self._queues[call.tier][call.queue_class - 1].remove(call)
        self._calls.pop(call.id, None)

    async def _complete(self, call: _Call) -> CallResult:
        assert self._client is not None
        spec = self.config.tiers[call.tier]
        provider = self.config.providers[spec.provider]
        body = request_body(provider, spec.model, call.request, provider.max_output_tokens)
        return await self._client.complete(provider, self._keys.get(provider.name), body)

    def _ended(self, call: _Call, task: asyncio.Task[CallResult]) -> None:
        """A call is over: free its slot, settle what it leaves, and start the next."""
        self._running[call.tier] -= 1
        self._calls.pop(call.id, None)
        if call.late_handle is not None:
            call.late_handle.cancel()
            call.late_handle = None
        if not task.cancelled() and not call.discarded:
            err = task.exception()
            if err is None:
                self._finish(call, task.result())
            else:  # a bug in the host: the game still gets an answer
                LOG.error("model call %s: %s: %s", call.id, type(err).__name__, err)
                self._finish(call, CallResult("error", "host_error", None, "host_error"))
        self._dispatch(call.tier)

    def _finish(self, call: _Call, result: CallResult) -> None:
        self._observe(call.tier, result)
        # The first time a kind of error comes on a tier is worth a line, the rest are not.
        kind = (call.tier, result.code)
        if result.status == "error" and kind not in self._reported_errors:
            self._reported_errors.add(kind)
            LOG.warning("the %s tier: a call ended in %s", call.tier, result.code)
        outcome = ModelOutcome(
            call.id, result.status, result.text, result.usage, self._ms(call), result.code
        )
        LOG.debug(
            "model call %s on %s: %s in %d ms",
            call.id,
            call.tier,
            result.status,
            outcome.latency_ms,
        )
        if not call.reported:
            self._report(call, outcome)
        elif call.timed_out and result.status == "ok":
            self._outbox.append(outcome)  # late: the core voids it and books the tokens

    def _report(self, call: _Call, outcome: ModelOutcome) -> None:
        call.reported = True
        for name in ("timeout_handle", "thinking_handle"):
            handle = getattr(call, name)
            if handle is not None:
                handle.cancel()
                setattr(call, name, None)
        self._outbox.append(outcome)

    def _abort(self, call: _Call) -> None:
        if call.task is not None and not call.task.done():
            call.task.cancel()

    def _stop_timers(self, call: _Call) -> None:
        for name in ("timeout_handle", "thinking_handle", "late_handle"):
            handle = getattr(call, name)
            if handle is not None:
                handle.cancel()
                setattr(call, name, None)

    def _ms(self, call: _Call) -> int:
        return max(0, round((self._clock() - call.started) * 1000))

    # --- Timers -------------------------------------------------------------------------------

    def _on_timeout(self, call: _Call) -> None:
        call.timeout_handle = None
        if call.reported or call.discarded:
            return
        assert self._loop is not None
        if call.state == QUEUED:
            self._dequeue(call)
            outcome = ModelOutcome(
                call.id, "timeout", "", dict(ZERO_USAGE), self._ms(call), code="queue_timeout"
            )
            self._report(call, outcome)
            return
        call.timed_out = True
        self._report(
            call, ModelOutcome(call.id, "timeout", "", None, self._ms(call), code="timeout")
        )
        if self.queue.late_s > 0:
            call.late_handle = self._loop.call_later(self.queue.late_s, self._on_late_end, call)
        else:
            self._abort(call)

    def _on_late_end(self, call: _Call) -> None:
        call.late_handle = None
        self._abort(call)

    def _on_thinking(self, call: _Call) -> None:
        call.thinking_handle = None
        if not call.reported and not call.discarded:
            self._notices.append(("thinking", f"a reply is taking a while ({call.id})"))

    # --- What the game is told about the providers --------------------------------------------

    def _observe(self, tier: str, result: CallResult) -> None:
        """Take in how a call that ran to its end went, for the health of its provider."""
        side = self.local if SIDES[tier] == "local" else self.cloud
        if result.reached:
            self._mark_up(side)
        elif result.code == "network":
            side.failures += 1
            if side.up and side.failures >= self.queue.down_after:
                self._mark_down(side)

    def _mark_up(self, side: _Side) -> None:
        side.failures = 0
        if not side.up:
            side.up = True
            self._events.append(f"{side.name}_up")
            LOG.info("the %s is up", side.name)

    def _mark_down(self, side: _Side) -> None:
        side.up = False
        self._events.append(f"{side.name}_down")
        LOG.warning("the %s is down after %d network failures", side.name, side.failures)
        self._start_probe(side, immediate=False)

    def _start_probe(self, side: _Side, *, immediate: bool) -> None:
        if side.probe is None or side.probe.done():
            side.probe = self._spawn(self._probe(side, immediate))

    async def _probe(self, side: _Side, immediate: bool) -> None:
        """Look at a provider that is not known to be up, until it answers."""
        if not immediate:
            await asyncio.sleep(self.queue.probe_s)
        while not side.up:
            try:
                found = await self._reachable(side)
            except Exception as err:  # the look must go on whatever it meets
                LOG.warning("looking at the %s: %s: %s", side.name, type(err).__name__, err)
                found = False
            if found:
                self._mark_up(side)
                return
            await asyncio.sleep(self.queue.probe_s)

    async def _reachable(self, side: _Side) -> bool:
        """Whether the providers of a side answer: the local one by naming its model."""
        assert self._client is not None
        tiers = ("local",) if side is self.local else CLOUD_TIERS
        for name in dict.fromkeys(self.config.tiers[tier].provider for tier in tiers):
            provider = self.config.providers[name]
            answer = await self._client.models(provider, self._keys.get(name), PROBE_TIMEOUT_S)
            if answer is None:
                return False
            if side is self.local:
                status, data = answer
                model = self.config.tiers["local"].model
                if status != 200 or not _lists(data, model):
                    if status == 200:
                        LOG.warning("the model list of %s does not name %s", name, model)
                    return False
        return True


def _lists(data: Any, model: str) -> bool:
    """Whether a model list names ``model`` (a tag-less name means the latest)."""
    entries = data.get("data") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        return False
    ids = {entry.get("id") for entry in entries if isinstance(entry, dict)}
    return model in ids or f"{model}:latest" in ids


def openai_factory(
    config: ProviderConfig, env: Mapping[str, str] | None = None
) -> Callable[[GameSpec], Transport]:
    """OpenAI-compatible transports for a session to make, one for each game."""

    def make(spec: GameSpec) -> Transport:
        return OpenAITransport(config, env=env)

    return make
