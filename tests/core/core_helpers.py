"""Small helpers for talking to a ``Game`` in tests."""

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any

from lantern_core.api import Game


def rec(seq: int, kind: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"seq": seq, "kind": kind, "body": body or {}}


def call(game: Game, *records: dict[str, Any]) -> dict[str, Any]:
    """One ``step`` with the given records. Returns the parsed outputs."""
    return json.loads(game.step(json.dumps(list(records))))


def result(
    request_id: str,
    status: str = "ok",
    text: str = "好茶",
    usage: dict[str, int] | None = None,
    latency_ms: int = 100,
) -> dict[str, Any]:
    """The body of a ``model_result`` input."""
    if usage is None and status == "ok":
        usage = {"input_tokens": 120, "output_tokens": 9}
    return {
        "request_id": request_id,
        "status": status,
        "text": text,
        "usage": usage,
        "latency_ms": latency_ms,
    }


def run_until(
    game: Game, found: Callable[[dict[str, Any]], bool], limit: int = 4000
) -> dict[str, Any]:
    """Call ``step`` with no inputs until ``found(outputs)``. Returns those outputs."""
    for _ in range(limit):
        outputs = call(game)
        if found(outputs):
            return outputs
    raise AssertionError(f"nothing found within {limit} calls")


def first_request(game: Game) -> dict[str, Any]:
    """Run until the core sends a request, and return it. The game stands right after it."""
    return run_until(game, lambda out: bool(out["requests"]))["requests"][0]


def live_run(ticks: int, seed: int | None = None, config: dict[str, int] | None = None):
    """Run the scripted driver to ``ticks`` under a recorder.

    Returns ``(driver, recording, hashes)`` where ``hashes[t]`` is the state hash after the last
    call that was made at tick ``t``, which is the state a one-call-per-tick replay has to match.
    """
    import m0_driver as drivers  # the cross-host driver, put on sys.path by conftest.py

    from lantern_core.replay import Recorder

    run = drivers.Driver(drivers.SEED if seed is None else seed, config=config)
    recorder = Recorder(run.game)
    hashes: dict[int, str] = {}

    def step(text: str) -> str:
        tick = run.game.tick
        outputs = recorder.step(text)
        hashes[tick] = run.game.hash()
        return outputs

    run.run_to(ticks, step=step)
    return run, recorder.recording(), hashes
