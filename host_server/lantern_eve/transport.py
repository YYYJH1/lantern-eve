"""Model transports: what the host loop calls with the requests and cancels of the core.

The loop never waits for a model. Once per call it does three things with a transport:

- ``start(request, tick)`` for every request the core emitted, and ``cancel(request_id, tick)``
  for every id the core listed in ``cancels``. Neither blocks. A transport that talks to a
  provider starts a task and returns at once.
- ``poll(tick)`` before the next call, to collect the outcomes that have arrived. Each outcome
  becomes a ``model_result`` input, numbered when the loop collects it.

``tick`` is the clock of the transport (``Session.transport_tick``). While the world runs it is
the tick at which the next call of the core applies its inputs. A world that holds its own clock
(the bridge does while the manager is in a conversation) does not move that tick, so the clock of
the transport goes on in real time for as long as the world is held, and stands still while the
host has paused the world. A transport that keeps game time (the mock) reads it from here and
never from a clock. A run with the mock is then a function of the seed and the inputs alone, in
real time as in lockstep, as long as the world is never held. The ticks of a held world come from
the clock of the session, and the replay has the answers that landed in them.

``precheck(request)`` lets a transport refuse a request without any I/O (no provider, no key).
The loop then books the answer at once, which keeps a session without a model deterministic.

Three more hooks let a transport that has a life of its own tell the loop things. ``open()`` is
called once, right after the transport is made, and may start background work such as looking
for a local model. ``host_events(tick)`` hands over what the transport learned about its
providers (``cloud_down``, ``cloud_up``, ``local_up``, ``local_down``), and the loop records
each one as a ``host`` input of the core, so a replay makes the same choices without probing
anything. ``notices()`` hands over messages for the page that are not part of the game, such as
a reply that is slow in coming. The mock has nothing to say through any of them.

Outcome statuses are the ones the core knows: ``ok``, ``timeout``, ``cancelled`` and ``error``.
``usage`` is ``None`` where the cost cannot be known (after a timeout, say), which makes the core
book the whole reservation of the request.
"""

from __future__ import annotations

import abc
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from lantern_core.rng import Pcg32

if TYPE_CHECKING:
    from lantern_eve.session import GameSpec

Status = Literal["ok", "timeout", "cancelled", "error"]


@dataclass(frozen=True)
class ModelOutcome:
    """How a model call ended, in the shape of a ``model_result`` body."""

    request_id: str
    status: Status
    text: str = ""
    usage: Mapping[str, int] | None = None
    latency_ms: int = 0
    # A short code for an error, for logs and the page. The core only sees the text.
    code: str | None = None

    def body(self) -> dict[str, Any]:
        """The body of the ``model_result`` input for this outcome."""
        return {
            "request_id": self.request_id,
            "status": self.status,
            "text": self.text,
            "usage": None if self.usage is None else dict(self.usage),
            "latency_ms": self.latency_ms,
        }


class Transport(abc.ABC):
    """The interface between the host loop and whatever answers model requests."""

    def precheck(self, request: Mapping[str, Any]) -> ModelOutcome | None:  # noqa: B027
        """An outcome for a request that cannot be made at all, or None. No I/O."""
        return None

    @abc.abstractmethod
    def start(self, request: Mapping[str, Any], tick: int) -> None:
        """Begin a call for a request of the core. Must not block."""

    @abc.abstractmethod
    def cancel(self, request_id: str, tick: int) -> None:
        """Abort the call for ``request_id`` if it is still running. Must not block.

        An aborted call ends as a ``cancelled`` outcome. A call that had already finished keeps
        its real outcome, which the core voids and still books.
        """

    @abc.abstractmethod
    def poll(self, tick: int) -> list[ModelOutcome]:
        """The outcomes that have arrived since the last poll, in the order they arrived."""

    @abc.abstractmethod
    def discard_all(self) -> None:
        """End every call without reporting it: the world the calls belonged to is gone."""

    def open(self) -> None:  # noqa: B027
        """Called once by the loop right after the transport is made. Must not block.

        A transport that probes a provider starts its background work here. It may be called
        with no event loop running (a headless batch), in which case a transport that needs one
        waits for its first call to ``start``.
        """

    def host_events(self, tick: int) -> list[str]:  # noqa: B027
        """The host events that arose since the last call, oldest first, each handed over once.

        Every one is one of ``lantern_core.inputs.HOST_EVENTS``. The loop turns each into a
        ``host`` input.
        """
        return []

    def notices(self) -> list[tuple[str, str]]:  # noqa: B027
        """``(code, message)`` pairs for the page, oldest first, each handed over once."""
        return []

    def model_of(self, request: Mapping[str, Any]) -> str | None:  # noqa: B027
        """The model that answers a request, for the list of calls the page shows, or None."""
        return None

    async def aclose(self) -> None:  # noqa: B027
        """Release connections and tasks. The transport is not used again."""


LINES = (
    "今天的茶不错。",
    "桥上风大，当心些。",
    "听说码头来了新货。",
    "你吃过了吗？",
    "下午怕是要下雨。",
    "灯会的事你听说了吗？",
)
MOCK_STREAM = 0x6D6F636B  # "mock"


@dataclass(order=True)
class _Due:
    due: int
    order: int
    outcome: ModelOutcome = field(compare=False)


class MockTransport(Transport):
    """A deterministic stand-in for a model, for tests and for playing without one.

    Delays are in ticks of the transport clock and come from the transport's own PCG32 (not the
    core's), drawn in the order the requests and cancels arrive. What happens to a request:

    - most are answered ``ok`` after ``min_delay`` to ``max_delay`` ticks, with a line of talk
      and plausible usage;
    - some end ``error`` early, and some ``timeout`` after ``timeout_after`` ticks with unknown
      usage, and about half of the timeouts are followed by a late ``ok`` that the core voids;
    - a cancel is honoured with probability ``1 - abort_fails_per_mille / 1000``: the pending
      answer is dropped and a ``cancelled`` outcome arrives at the next call. Otherwise the
      abort came too late and the real answer still lands.

    The mock reads no clock and does no I/O. Outcomes are due at ticks of the clock the session
    gives it. That clock stands still while the host has paused the world, so nothing arrives during
    a pause. It goes on while a conversation holds the world, which does not tick, so an answer
    still lands there.
    """

    def __init__(
        self,
        seed: int,
        *,
        min_delay: int = 2,
        max_delay: int = 45,
        error_per_mille: int = 30,
        timeout_per_mille: int = 100,
        late_per_mille: int = 500,
        abort_fails_per_mille: int = 300,
        timeout_after: int = 60,
    ) -> None:
        if not 0 <= min_delay <= max_delay:
            raise ValueError("min_delay must not exceed max_delay")
        self.rng = Pcg32(seed, MOCK_STREAM)
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.error_per_mille = error_per_mille
        self.timeout_per_mille = timeout_per_mille
        self.late_per_mille = late_per_mille
        self.abort_fails_per_mille = abort_fails_per_mille
        self.timeout_after = timeout_after
        self._order = 0
        self._pending: list[_Due] = []
        self.counts = {
            "ok": 0,
            "error": 0,
            "timeout": 0,
            "late": 0,
            "aborted": 0,
            "abort_failed": 0,
        }

    def start(self, request: Mapping[str, Any], tick: int) -> None:
        rng = self.rng
        delay = self.min_delay + rng.below(self.max_delay - self.min_delay + 1)
        roll = rng.below(1000)
        if roll < self.error_per_mille:
            self.counts["error"] += 1
            outcome = ModelOutcome(request["request_id"], "error", "mock_error", None, 100)
            self._put(tick + 1 + delay // 4, outcome)
        elif roll < self.error_per_mille + self.timeout_per_mille:
            self.counts["timeout"] += 1
            after = self.timeout_after
            outcome = ModelOutcome(request["request_id"], "timeout", "", None, after * 100)
            self._put(tick + after, outcome)
            if rng.below(1000) < self.late_per_mille:
                self.counts["late"] += 1
                late = tick + after + 1 + rng.below(25)
                self._put(late, self._ok(request, delay + after))
        else:
            self.counts["ok"] += 1
            self._put(tick + delay, self._ok(request, delay))

    def cancel(self, request_id: str, tick: int) -> None:
        if not any(p.outcome.request_id == request_id for p in self._pending):
            return
        if self.rng.below(1000) < self.abort_fails_per_mille:
            self.counts["abort_failed"] += 1
            return
        self.counts["aborted"] += 1
        self._pending = [p for p in self._pending if p.outcome.request_id != request_id]
        self._put(tick, ModelOutcome(request_id, "cancelled"))

    def poll(self, tick: int) -> list[ModelOutcome]:
        ready = sorted(p for p in self._pending if p.due <= tick)
        if ready:
            self._pending = [p for p in self._pending if p.due > tick]
        return [p.outcome for p in ready]

    def discard_all(self) -> None:
        self._pending = []

    def in_flight(self) -> list[str]:
        """Ids with an outcome still on the way, without repeats, in the order they were due."""
        seen: list[str] = []
        for p in sorted(self._pending):
            if p.outcome.request_id not in seen:
                seen.append(p.outcome.request_id)
        return seen

    def _put(self, due: int, outcome: ModelOutcome) -> None:
        self._pending.append(_Due(due, self._order, outcome))
        self._order += 1

    def _ok(self, request: Mapping[str, Any], delay: int) -> ModelOutcome:
        prompt_chars = sum(len(m["content"]) for m in request["messages"])
        usage = {
            "input_tokens": prompt_chars * 2,
            "output_tokens": 1 + self.rng.below(request["max_tokens"]),
        }
        text = self.rng.choice(LINES)
        return ModelOutcome(request["request_id"], "ok", text, usage, delay * 100)


def mock_factory(host_seed: int | None = None) -> Callable[[GameSpec], Transport]:
    """Mock transports for a session to make, each seeded from its game's seed unless given one."""

    def make(spec: GameSpec) -> Transport:
        return MockTransport(spec.seed if host_seed is None else host_seed)

    return make
