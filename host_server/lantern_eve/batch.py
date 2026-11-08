"""Headless lockstep games, for experiments and as the reference a live game is checked against.

A lockstep run has no clock. It makes one call of the core per tick, and before each call it
takes the outcomes the transport has due at that tick, which is what the live loop does. With
the mock transport, whose delays are in ticks and come from a seed, a seed gives the same game
every time and the same game as a live session that no player touches. That is also the
property that lets an experiment simulate real-time latency without a clock.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from lantern_eve.session import GameSpec, Session
from lantern_eve.transport import mock_factory


@dataclass(frozen=True)
class BatchResult:
    seed: int
    tick: int
    hash: str
    requests: int
    calls: int

    def line(self) -> str:
        return f"seed={self.seed} tick={self.tick} hash={self.hash}"


def parse_seeds(text: str) -> list[int]:
    """Seeds from ``1-3``, ``1,3,5`` or ``1-3,7``. Order is kept and repeats are an error."""
    seeds: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            raise ValueError("empty seed in the list")
        low, dash, high = part.partition("-")
        try:
            first, last = int(low), int(high) if dash else int(low)
        except ValueError:
            raise ValueError(f"not a seed or a range of seeds: {part!r}") from None
        if first < 0 or last < first:
            raise ValueError(f"not a range of seeds: {part!r}")
        seeds.extend(range(first, last + 1))
    if len(set(seeds)) != len(seeds):
        raise ValueError("a seed is listed twice")
    return seeds


def run_game(
    seed: int,
    ticks: int,
    *,
    scenario: str = "m0",
    config: dict[str, int] | None = None,
    host_seed: int | None = None,
    runs_dir: Path | None = None,
) -> BatchResult:
    """Play one game to ``ticks`` in lockstep with the mock transport."""
    session = Session(
        f"batch-{seed}",
        GameSpec(seed, scenario, config),
        mock_factory(host_seed),
        runs_dir=runs_dir,
    )
    session.start()
    requests = 0

    def count(outputs: dict) -> None:
        nonlocal requests
        requests += len(outputs["requests"])

    session.on_outputs = count
    session.run_lockstep(ticks)
    result = BatchResult(seed, session.next_tick, session.game.hash(), requests, session.call_count)
    session.stop()
    return result


def run_batch(seeds: list[int], ticks: int, **options) -> list[BatchResult]:
    return [run_game(seed, ticks, **options) for seed in seeds]
