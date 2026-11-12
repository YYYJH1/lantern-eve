"""Plays one first morning of the slice under each of the three stories that can be true and writes the frame at the end of it, for each.

Usage: python people_frames.py OUT.json

The manager does the same in every game: talks with the Zhou shopkeeper (asking for his timber, which he turns down), with Granny Li (asking for
the bamboo, and giving her pastries), with the teahouse madam and with the Zhou clerk (asking them about Li Er). The only thing that differs
between the games is which story is true, so the frames differ in what the town does behind the manager's back (where people stand, what they say
to each other) and in nothing the manager has been told. The last line on stdout is the path the frames were written to.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
for sub in ("core", "tools", "tests/core", "tests/cross_host"):
    sys.path.insert(0, str(REPO / sub))

from agenda_helpers import frame_now, meet, slice_game  # noqa: E402
from bridge_helpers import at, run_to  # noqa: E402
from player_helpers import act  # noqa: E402

VARIANTS = ("v_boat", "v_flood", "v_drunk")
ROUTE = (
    ("zhou_zhanggui", [("entrust", {"kind": "material"})]),
    ("li_laotai", [("entrust", {"kind": "lend"}), ("gift", {"item": "pastry"})]),
    ("cha_laoban", [("ask", {"topic": "li_er"})]),
    ("zhou_huoji", [("ask", {"topic": "li_er"})]),
)


def morning(variant: str) -> dict:
    game = slice_game(variant=variant)
    run_to(game, at(1, 8))
    for who, doings in ROUTE:
        meet(game, who)
        for kind, fields in doings:
            act(game, kind, **fields)
        act(game, "leave")
    return frame_now(game)


def main(argv: list[str]) -> int:
    out = Path(argv[1])
    out.write_text(json.dumps({variant: morning(variant) for variant in VARIANTS}), encoding="utf-8")
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
