"""A deterministic stand-in for the model transports of a host.

``MockModelHost`` answers every request the core sends, after a delay of ``k`` calls where ``k``
comes from its own seeded PCG32 (not the core's), so that thousands of ticks run with requests
in flight, landing, timing out, being cancelled and arriving late. It is plain Python on ints
and the core's ``Pcg32``, so it behaves the same under CPython and Pyodide, and a host can be
copied with ``copy.deepcopy`` to fork a run.

A host loop looks like this, once per call of ``Game.step``::

    bodies = host.deliver()           # model_result bodies that arrive now
    outputs = game.step(...)          # with those bodies among the inputs
    host.accept(outputs)              # schedule the new requests, act on the cancels

What the mock does with a request:

- most are answered ``ok`` after 2 to 45 calls, with a line of talk and plausible usage;
- some end ``error`` quickly, and some ``timeout`` after ``timeout_after`` calls with unknown
  usage, and half of the timeouts are followed by a late ``ok`` that the core must void;
- a cancel is honoured with probability 70%: the pending answer is dropped and a ``cancelled``
  result arrives next call. Otherwise the abort came too late and the real answer still lands.
"""

from __future__ import annotations

from typing import Any

from lantern_core.rng import Pcg32

LINES = (
    "今天的茶不错。",
    "桥上风大，当心些。",
    "听说码头来了新货。",
    "你吃过了吗？",
    "下午怕是要下雨。",
    "灯会的事你听说了吗？",
)
STREAM = 0x6D6F636B  # "mock"


class MockModelHost:
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
        self.rng = Pcg32(seed, STREAM)
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.error_per_mille = error_per_mille
        self.timeout_per_mille = timeout_per_mille
        self.late_per_mille = late_per_mille
        self.abort_fails_per_mille = abort_fails_per_mille
        self.timeout_after = timeout_after
        self.frame = 0
        self.order = 0
        self.pending: list[dict[str, Any]] = []
        self.stats = {
            "ok": 0,
            "error": 0,
            "timeout": 0,
            "late": 0,
            "aborted": 0,
            "abort_failed": 0,
        }

    def deliver(self) -> list[dict[str, Any]]:
        """The ``model_result`` bodies that arrive in this call, in the order they were due."""
        ready = [p for p in self.pending if p["due"] <= self.frame]
        self.pending = [p for p in self.pending if p["due"] > self.frame]
        ready.sort(key=lambda p: (p["due"], p["order"]))
        return [p["body"] for p in ready]

    def accept(self, outputs: dict[str, Any]) -> None:
        """Read the outputs of the call just made, then move to the next call."""
        for request in outputs["requests"]:
            self._schedule(request)
        for request_id in outputs["cancels"]:
            self._abort(request_id)
        self.frame += 1

    def in_flight(self) -> list[str]:
        """Ids of requests with an answer still on the way, without repeats."""
        seen: list[str] = []
        for p in self.pending:
            if p["body"]["request_id"] not in seen:
                seen.append(p["body"]["request_id"])
        return seen

    def _put(self, due: int, body: dict[str, Any]) -> None:
        self.pending.append({"due": due, "order": self.order, "body": body})
        self.order += 1

    def _schedule(self, request: dict[str, Any]) -> None:
        rng = self.rng
        request_id = request["request_id"]
        delay = self.min_delay + rng.below(self.max_delay - self.min_delay + 1)
        roll = rng.below(1000)
        if roll < self.error_per_mille:
            self.stats["error"] += 1
            self._put(self.frame + 1 + delay // 4, self._body(request_id, "error", "", None, 100))
        elif roll < self.error_per_mille + self.timeout_per_mille:
            self.stats["timeout"] += 1
            after = self.timeout_after
            self._put(self.frame + after, self._body(request_id, "timeout", "", None, after * 100))
            if rng.below(1000) < self.late_per_mille:
                self.stats["late"] += 1
                late = self.frame + after + 1 + rng.below(25)
                self._put(late, self._ok(request, delay + after))
        else:
            self.stats["ok"] += 1
            self._put(self.frame + delay, self._ok(request, delay))

    def _ok(self, request: dict[str, Any], delay: int) -> dict[str, Any]:
        prompt_chars = sum(len(m["content"]) for m in request["messages"])
        usage = {
            "input_tokens": prompt_chars * 2,
            "output_tokens": 1 + self.rng.below(request["max_tokens"]),
        }
        text = self.rng.choice(LINES)
        return self._body(request["request_id"], "ok", text, usage, delay * 100)

    def _abort(self, request_id: str) -> None:
        if not any(p["body"]["request_id"] == request_id for p in self.pending):
            return
        if self.rng.below(1000) < self.abort_fails_per_mille:
            self.stats["abort_failed"] += 1
            return
        self.stats["aborted"] += 1
        self.pending = [p for p in self.pending if p["body"]["request_id"] != request_id]
        self._put(self.frame + 1, self._body(request_id, "cancelled", "", None, 0))

    @staticmethod
    def _body(
        request_id: str, status: str, text: str, usage: dict[str, int] | None, latency_ms: int
    ) -> dict[str, Any]:
        return {
            "request_id": request_id,
            "status": status,
            "text": text,
            "usage": usage,
            "latency_ms": latency_ms,
        }
