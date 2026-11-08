"""The model calls of a game as the page lists them: the twin of ``web/src/shared/model-calls.ts``.

``CallTracker`` keeps one record for each request the core makes, from the moment it goes out to
the moment the core books its result. It works from what the core reports, so that a replay of
the game lists the same calls: the ``requests`` of a call (the tier the request goes out on, its
category, the money held for it), the ``downgrade`` events (the tier it was asked on and why it
moved, and the requests the gate turned into script lines, which never go out), the
``model_result`` inputs the call applied (the outcome, the latency, the tokens) and the ``void``
events (an answer the core threw away).

The cost of a call is what the core booked when it settled the request, worked out with the
core's own ``pricing.cost``: the tokens the result reports, or the whole reservation where they
are unknown, at the prices of the game's config. A result for a request that is not in flight any
more (an answer that comes after a timeout) is booked by nobody, and the record only says that it
was late. The sum of ``cost`` over every call is therefore the ``spent`` of the budget in the
frame, and money is in micro-yuan throughout.

A record is a dict of these keys: ``id``, ``tick``, ``category``, ``asked``, ``tier``,
``reason``, ``model``, ``hold``, ``status`` (``pending``, one of the four outcomes, or
``template``), ``code``, ``latency_ms``, ``usage``, ``cost``, ``settled``, ``late`` and
``voided``. ``ModelCallRecord`` in ``web/src/shared/protocol.ts`` documents each.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from lantern_core.world.bridge import pricing

# How many calls are kept: the oldest go first. The page keeps as many.
MAX_CALLS = 200
STATUSES = ("ok", "timeout", "cancelled", "error")
CODE_CHARS = 40


def call_cost(config: Mapping[str, Any], tier: str, tokens: Mapping[str, int]) -> int | None:
    """What a call on ``tier`` that used ``tokens`` costs, or None where the game has no prices.

    A tier without a price (the local one) is free, as it is for the core.
    """
    keys = pricing.PRICE_KEYS.get(tier)
    if keys is not None and not all(type(config.get(key)) is int for key in keys):
        return None
    return pricing.cost(dict(config), tier, tokens["input_tokens"], tokens["output_tokens"])


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _count(value: Any) -> int:
    return max(0, int(value)) if _is_number(value) else 0


def _usage(value: Any) -> dict[str, int] | None:
    if not isinstance(value, dict):
        return None
    return {
        "input_tokens": _count(value.get("input_tokens")),
        "output_tokens": _count(value.get("output_tokens")),
    }


class CallTracker:
    def __init__(
        self,
        config: Mapping[str, Any],
        model_of: Callable[[Mapping[str, Any]], str | None] | None = None,
    ) -> None:
        self.config = config
        self.model_of = model_of or (lambda request: None)
        self._records: dict[str, dict[str, Any]] = {}
        self._reserves: dict[str, dict[str, int]] = {}

    def has(self, request_id: str) -> bool:
        return request_id in self._records

    def snapshot(self) -> list[dict[str, Any]]:
        """The records, oldest first, as copies."""
        return [_copy(record) for record in self._records.values()]

    def observe(
        self, out: Mapping[str, Any], applied: Sequence[Mapping[str, Any]]
    ) -> list[dict[str, Any]]:
        """Take in one call of the core and return the records that changed, as copies.

        The results it applied settle the requests they answer, the requests the gate turned away
        are listed, and the requests that went out are opened.
        """
        tick = out["tick"]
        changed: dict[str, dict[str, Any]] = {}
        moved: dict[str, dict[str, Any]] = {}
        voids: dict[str, str] = {}
        for event in out["events"]:
            request_id = event.get("request_id")
            if not isinstance(request_id, str):
                continue
            if event["kind"] == "downgrade":
                category = event.get("category")
                moved[request_id] = {
                    "asked": event["asked"]
                    if isinstance(event.get("asked"), str)
                    else str(event.get("tier")),
                    "reason": event["reason"] if isinstance(event.get("reason"), str) else None,
                    "tier": str(event.get("tier")),
                    "category": category if isinstance(category, str) else None,
                }
            elif event["kind"] == "void" and isinstance(event.get("reason"), str):
                voids[request_id] = event["reason"]

        for item in applied:
            body = item["body"]
            if item["kind"] != "model_result" or not isinstance(body.get("request_id"), str):
                continue
            record = self._records.get(body["request_id"])
            if record is None:
                continue
            why = voids.get(record["id"])
            if record["status"] != "pending" or why == "unknown_request":
                if not record["late"]:
                    record["late"] = True
                    changed[record["id"]] = record
                continue
            self._settle(record, body, tick)
            if why in ("cancelled", "invalid"):
                record["voided"] = why
            changed[record["id"]] = record

        for request_id, move in moved.items():
            if move["tier"] != "template" or request_id in self._records:
                continue
            record = {
                "id": request_id,
                "tick": tick,
                "category": move["category"],
                "asked": move["asked"],
                "tier": "template",
                "reason": move["reason"],
                "model": None,
                "hold": 0,
                "status": "template",
                "code": None,
                "latency_ms": None,
                "usage": None,
                "cost": 0,
                "settled": tick,
                "late": False,
                "voided": "invalid" if voids.get(request_id) == "invalid" else None,
            }
            self._put(record)
            changed[request_id] = record

        for request in out["requests"]:
            record = self._open(request, moved.get(request["request_id"]))
            if record is not None:
                changed[record["id"]] = record
        return [_copy(r) for r in changed.values() if self._records.get(r["id"]) is r]

    def _open(
        self, request: Mapping[str, Any], move: Mapping[str, Any] | None
    ) -> dict[str, Any] | None:
        request_id = request["request_id"]
        if request_id in self._records:
            return None
        self._reserves[request_id] = _usage(request.get("reserve")) or {
            "input_tokens": 0,
            "output_tokens": _count(request.get("max_tokens")),
        }
        category = request.get("category")
        hold = request.get("hold")
        record = {
            "id": request_id,
            "tick": _count(request.get("issued_tick")),
            "category": category if isinstance(category, str) else (move or {}).get("category"),
            "asked": move["asked"] if move else request["tier"],
            "tier": request["tier"],
            "reason": move["reason"] if move else None,
            "model": self.model_of(request),
            "hold": _count(hold) if _is_number(hold) else None,
            "status": "pending",
            "code": None,
            "latency_ms": None,
            "usage": None,
            "cost": None,
            "settled": None,
            "late": False,
            "voided": None,
        }
        self._put(record)
        return record

    def _settle(self, record: dict[str, Any], body: Mapping[str, Any], tick: int) -> None:
        status = body.get("status")
        usage = _usage(body.get("usage"))
        tokens = (
            usage or self._reserves.get(record["id"]) or {"input_tokens": 0, "output_tokens": 0}
        )
        text = body.get("text")
        record["status"] = status if status in STATUSES else "error"
        record["code"] = (
            text[:CODE_CHARS] if status == "error" and isinstance(text, str) and text else None
        )
        record["latency_ms"] = _count(body.get("latency_ms"))
        record["usage"] = usage
        record["cost"] = call_cost(self.config, record["tier"], tokens)
        record["settled"] = tick
        self._reserves.pop(record["id"], None)

    def _put(self, record: dict[str, Any]) -> None:
        self._records[record["id"]] = record
        while len(self._records) > MAX_CALLS:
            oldest = next(iter(self._records))
            del self._records[oldest]
            self._reserves.pop(oldest, None)


def _copy(record: Mapping[str, Any]) -> dict[str, Any]:
    out = dict(record)
    if out["usage"] is not None:
        out["usage"] = dict(out["usage"])
    return out
