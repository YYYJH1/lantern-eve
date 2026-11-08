"""Plays the follower on the game the opening page starts and writes the recording of it.

Usage: python follower_recording.py OUT.json DAY HOUR [MINUTE]

The follower (tools/bots/follower.py) does only what the task card says: it follows the top bar. The
game is the preset ``slice`` (seed 492), played to ``DAY`` ``HOUR``:``MINUTE`` of the game clock, and
the recording is what ``lantern_core.replay.Recorder`` makes of it. A page can load it as a save and
show the real frames of the days after the first, with no frame made by hand. The recording has the key
``final`` (the tick and the hash at its end) that the browser host writes and checks a load by. The
last line on stdout is one line of JSON: the tick it reached and the hash of the game there.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "tools"))  # the bots are tools, not part of the package

from bots import make  # noqa: E402
from bots.base import Obs  # noqa: E402
from lantern_core import canon  # noqa: E402
from lantern_core.api import Game, preset  # noqa: E402
from lantern_core.replay import Recorder  # noqa: E402

DAY_TICKS = 1800  # the day phase: 06:00 to 21:00 at 120 ticks an hour
CYCLE_TICKS = 2070  # a game day: the day phase and the night


def tick_of(day: int, hour: int, minute: int) -> int:
    """The tick at which the clock reads this time of the day phase."""
    return (day - 1) * CYCLE_TICKS + (hour - 6) * 120 + minute * 2


def main(argv: list[str]) -> int:
    out = Path(argv[1])
    day, hour = int(argv[2]), int(argv[3])
    minute = int(argv[4]) if len(argv) > 4 else 0
    started = preset("slice")
    game = Game(started["seed"], started["scenario"], {"budget_cap": 0, **started["config"]})
    recorder = Recorder(game)
    bot = make("follower", json.loads(game.scene_json()), started["seed"])
    obs = Obs(json.loads(recorder.step("[]")))
    until = tick_of(day, hour, minute)
    while game.tick < until:
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        obs = Obs(json.loads(recorder.step(json.dumps(records))))
    recording = recorder.recording()
    recording["final"] = {"tick": game.tick, "hash": game.hash()}  # as the browser host writes it
    out.write_text(canon.dumps_str(recording), encoding="utf-8")
    print(json.dumps({"tick": game.tick, "hash": game.hash()}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
