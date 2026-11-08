"""Rebuilds a replay that the browser host exported, under CPython, and reports the hashes.

Usage: python replay_check.py REPLAY.json

The browser writes the recording that lantern_core.replay defines, plus two keys of its own
(`host` and `final`). This script hands it to lantern_core.replay.rebuild, which groups the
records by tick, makes one Game.step call per tick and compares every state hash on the way. It
then checks, on its own, that every recorded hash was reproduced and that the hash at the end is
the one the browser took. The report is one line of JSON on stdout. The exit status is 0 when
every hash matched.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from lantern_core.replay import ReplayError, rebuild


def check(recording: dict[str, Any]) -> dict[str, Any]:
    seen: dict[int, str] = {}
    counts = {"calls": 0, "requests": 0, "events": 0}

    def on_step(game: Any, tick: int, outputs_json: str) -> None:
        outputs = json.loads(outputs_json)
        counts["calls"] += 1
        counts["requests"] += len(outputs["requests"])
        counts["events"] += len(outputs["events"])
        if game.last_hash is not None:
            seen[tick] = game.last_hash

    game = rebuild(recording, on_step=on_step)

    expected = {tick: digest for tick, digest in recording["hashes"]}
    missing = sorted(tick for tick in expected if tick not in seen)
    mismatches = [
        {"tick": tick, "expected": expected[tick], "actual": seen[tick]}
        for tick in sorted(expected)
        if tick in seen and seen[tick] != expected[tick]
    ]
    final = recording.get("final", {"tick": recording["end_tick"], "hash": ""})
    actual = game.hash()
    ok = (
        not mismatches
        and not missing
        and game.tick == recording["end_tick"]
        and final["tick"] == game.tick
        and (final["hash"] == "" or final["hash"] == actual)
    )
    return {
        "ok": ok,
        "final_tick": game.tick,
        "expected_final_tick": recording["end_tick"],
        "final_hash": actual,
        "expected_final_hash": final["hash"],
        "checkpoints_checked": len(expected) - len(missing),
        "checkpoints_missing": missing,
        "mismatches": mismatches,
        "calls": counts["calls"],
        "requests_emitted": counts["requests"],
        "events_emitted": counts["events"],
        "records": len(recording["records"]),
    }


def main(argv: list[str]) -> int:
    with open(argv[1], encoding="utf-8") as handle:
        recording = json.load(handle)
    try:
        report = check(recording)
    except ReplayError as err:
        report = {"ok": False, "error": f"{type(err).__name__}: {err}"}
    print(json.dumps(report))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
