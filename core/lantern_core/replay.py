"""Recording a game, rebuilding it from the record, and forking it.

A recording is a dict of canonical values, so ``canon.dumps_str`` turns it into a file::

    {"header":    {"format", "core_version", "content_hash", "scenario", "config", "seed"},
     "base":      None, or {"tick", "snapshot"} when the record starts from a snapshot,
     "records":   [[tick, seq, kind, body], ...]   every input the core accepted, in order,
     "hashes":    [[tick, hash], ...]              the state hash of every tick that is a
                                                   multiple of 100,
     "snapshots": [[tick, snapshot_json], ...]     one per game hour of ticks,
     "end_tick":  the tick the game had reached when the recording was taken}

A ``Recorder`` wraps a game and logs what it applies: the host calls ``Recorder.step`` where it
would call ``Game.step``. ``rebuild`` makes the game again by grouping the records per tick and
calling ``step`` once per tick, which gives the same world as the host's calls did, including
the extra calls it made while the world was paused (see the kernel docstring). It checks every
recorded hash on the way, and a record that was altered shows up as a ``ReplayDivergence`` at
the next hash. Seeking starts from the latest snapshot at or before the target tick.

A fork is a restored snapshot plus the cancellation of every request that was in flight, since
the new branch must not read answers that belong to the old one.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from lantern_core import canon
from lantern_core.api import FORMAT, Game


class ReplayError(ValueError):
    """The recording cannot be replayed."""


class ReplayDivergence(ReplayError):
    """The replayed state hash differs from the recorded one."""


class Recorder:
    """A game, with a log of what it was given."""

    def __init__(self, game: Game, snapshot_every: int | None = None) -> None:
        """Start recording ``game`` from its present state.

        A snapshot is kept whenever the game reaches a multiple of ``snapshot_every`` ticks,
        which is one game hour unless told otherwise.
        """
        self.game = game
        self.snapshot_every = game.ticks_per_hour if snapshot_every is None else snapshot_every
        if self.snapshot_every < 1:
            raise ValueError("snapshot_every must be at least 1")
        self.header = game.header()
        self.base: dict[str, Any] | None = None
        fresh = Game(self.header["seed"], self.header["scenario"], self.header["config"])
        if fresh.snapshot_json() != game.snapshot_json():
            self.base = {"tick": game.tick, "snapshot": game.snapshot_json()}
        self.records: list[list[Any]] = []
        self.hashes: list[list[Any]] = []
        self.snapshots: list[list[Any]] = []

    def step(self, inputs_json: str = "[]") -> str:
        """``Game.step``, with the applied inputs, the hash and any due snapshot recorded."""
        game = self.game
        tick = game.tick
        outputs = game.step(inputs_json)
        for record in game.last_inputs:
            self.records.append([tick, record["seq"], record["kind"], record["body"]])
        if game.last_hash is not None:
            self.hashes.append([tick, game.last_hash])
        if game.tick != tick and game.tick % self.snapshot_every == 0:
            self.snapshots.append([game.tick, game.snapshot_json()])
        return outputs

    def recording(self) -> dict[str, Any]:
        """The recording so far. It shares its lists with the recorder, so copy it to keep it."""
        return {
            "header": self.header,
            "base": self.base,
            "records": self.records,
            "hashes": self.hashes,
            "snapshots": self.snapshots,
            "end_tick": self.game.tick,
        }


def rebuild(
    recording: dict[str, Any],
    *,
    until: int | None = None,
    seek: bool = False,
    verify: bool = True,
    on_step: Callable[[Game, int, str], None] | None = None,
) -> Game:
    """Replay a recording and return the game.

    With ``until=None`` the whole record is replayed and the game ends where the live one did.
    With ``until=t`` it stops at the moment the tick counter reaches ``t``, before the inputs of
    tick ``t`` are applied. ``seek=True`` starts from the latest snapshot that is not after the
    target instead of from the beginning. ``verify`` compares each state hash the replay
    produces with the recorded one. ``on_step(game, tick, outputs_json)`` is called after every
    call, for tests and tools that watch the replay.
    """
    header = recording["header"]
    if header["format"] != FORMAT:
        raise ReplayError(f"recording format {header['format']!r}, expected {FORMAT}")
    end_tick = recording["end_tick"]
    target = end_tick if until is None else until
    game, start = _starting_point(recording, target, seek)
    if start > target:
        raise ReplayError(f"the recording starts at tick {start}, after the target {target}")
    groups: dict[int, list[dict[str, Any]]] = {}
    for tick, seq, kind, body in recording["records"]:
        if tick >= start:
            groups.setdefault(tick, []).append({"seq": seq, "kind": kind, "body": body})
    hashes = {tick: digest for tick, digest in recording["hashes"]}
    while True:
        tick = game.tick
        if until is not None and tick >= until:
            break
        group = groups.pop(tick, [])
        if not group:
            if tick >= end_tick:
                break
            if game.paused:
                raise ReplayError(f"paused at tick {tick} with no input left to resume the game")
        outputs = game.step(canon.dumps_str(group))
        recorded = hashes.get(tick)
        if verify and recorded is not None and game.last_hash not in (None, recorded):
            raise ReplayDivergence(
                f"state hash at tick {tick}: recorded {recorded}, replayed {game.last_hash}"
            )
        if on_step is not None:
            on_step(game, tick, outputs)
    if until is None and groups:
        raise ReplayError(f"records for ticks {sorted(groups)[:5]} were never reached")
    return game


def _starting_point(recording: dict[str, Any], target: int, seek: bool) -> tuple[Game, int]:
    header = recording["header"]
    base = recording["base"]
    candidates: list[tuple[int, str]] = []
    if base is not None:
        candidates.append((base["tick"], base["snapshot"]))
    if seek:
        candidates.extend((tick, text) for tick, text in recording["snapshots"] if tick <= target)
    if candidates:
        tick, text = max(candidates, key=lambda c: c[0])
        return Game.from_snapshot_json(text), tick
    return Game(header["seed"], header["scenario"], header["config"]), 0


def fork(snapshot_json: str) -> tuple[Game, list[dict[str, Any]]]:
    """Restore a snapshot as a new branch, and the inputs that cancel its requests in flight.

    The records are ``model_result`` inputs with status ``cancelled`` and known zero usage, so
    the new branch does not pay for calls that were made on the old one. The caller passes them
    as the first inputs of the branch's first call, which logs them like any other input.
    """
    game = Game.from_snapshot_json(snapshot_json)
    seq = game.next_seq
    cancels = []
    for request_id in game.in_flight():
        body = {
            "request_id": request_id,
            "status": "cancelled",
            "text": "",
            "usage": {"input_tokens": 0, "output_tokens": 0},
            "latency_ms": 0,
        }
        cancels.append({"seq": seq, "kind": "model_result", "body": body})
        seq += 1
    return game, cancels
