#!/usr/bin/env python3
"""Cuts the faces of the interface down to the characters of the game and writes them as WOFF2.

    LXGW WenKai Regular and Medium   the body of the page, Chinese and English in one family
    Ma Shan Zheng                    the titles: the game, the gazette, the tasks on the slips

Both are SIL Open Font License 1.1. The full faces are fetched once into a folder of your own
(the commands are in README.md), and this script checks them against the hashes pinned below before
it cuts.

    uv run python tools/fonts/build.py --src tools/fonts/src   cut the faces, write the record
    uv run python tools/fonts/build.py --check                 say whether the faces on disk have
                                                               every character of the text now

The characters come from ``chars.py``. After a change to any text that the player can see, run
``--check``: it fails when a character is new, and the cut is run again. ``tests/test_fonts.py``
asks the same question, so that the change cannot pass the tests without the faces.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

try:
    from fonts import chars
except ImportError:  # run as a script from another folder
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from fonts import chars

REPO = chars.REPO
RECORD = Path(__file__).resolve().with_name("subsets.json")
PUBLIC = REPO / "web" / "public" / "fonts"

# The OpenType features that a page of Chinese text uses: the vertical forms (the bookmarks on the
# edge are written downwards), the contextual spacing of punctuation and the half width forms of it.
# Fractions, superscripts and the other stylistic sets are left out.
FEATURES = ["calt", "ccmp", "chws", "halt", "vchw", "vert", "vhal"]

WENKAI = "https://github.com/lxgw/LxgwWenKai/releases/download/v1.530"
WENKAI_LICENCE = "https://raw.githubusercontent.com/lxgw/LxgwWenKai/v1.530/OFL.txt"
GOOGLE_FONTS = (
    "https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl"
)


@dataclass(frozen=True)
class Source:
    """A file to fetch: where from, and the hash that it must have."""

    name: str
    url: str
    sha256: str


@dataclass(frozen=True)
class Face:
    key: str
    family: str
    style: str
    version: str
    source: Source
    licence: Source
    folder: str
    output: str
    wanted: Callable[[], set[str]]


FACES = [
    Face(
        key="lxgw-wenkai-regular",
        family="LXGW WenKai",
        style="Regular",
        version="1.530",
        source=Source(
            "LXGWWenKai-Regular.ttf",
            f"{WENKAI}/LXGWWenKai-Regular.ttf",
            "2d73eea94ad808999d90c0000c239a84a33b09d4bc6ab6c5b8bbf1eda8a7fc8b",
        ),
        licence=Source(
            "LXGWWenKai-OFL.txt",
            WENKAI_LICENCE,
            "1a25e35da1031c6c3436fde545bb9cb5aca954e9873afe510c834b8b79bd21a0",
        ),
        folder="lxgw-wenkai",
        output="LXGWWenKai-Regular.subset.woff2",
        wanted=chars.game_chars,
    ),
    Face(
        key="lxgw-wenkai-medium",
        family="LXGW WenKai Medium",
        style="Regular",
        version="1.530",
        source=Source(
            "LXGWWenKai-Medium.ttf",
            f"{WENKAI}/LXGWWenKai-Medium.ttf",
            "f4b8a34d1f838fe411540cb7c97b1c384ac9738a876c4104500bc42508b2312a",
        ),
        licence=Source(
            "LXGWWenKai-OFL.txt",
            WENKAI_LICENCE,
            "1a25e35da1031c6c3436fde545bb9cb5aca954e9873afe510c834b8b79bd21a0",
        ),
        folder="lxgw-wenkai",
        output="LXGWWenKai-Medium.subset.woff2",
        wanted=chars.game_chars,
    ),
    Face(
        key="ma-shan-zheng",
        family="Ma Shan Zheng",
        style="Regular",
        version="google/fonts@6c1dbe27",
        source=Source(
            "MaShanZheng-Regular.ttf",
            f"{GOOGLE_FONTS}/mashanzheng/MaShanZheng-Regular.ttf",
            "6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb",
        ),
        licence=Source(
            "MaShanZheng-OFL.txt",
            f"{GOOGLE_FONTS}/mashanzheng/OFL.txt",
            "d7bdb1cee215b689e23c2f95672a6084c790542170648267a55114103d756a08",
        ),
        folder="ma-shan-zheng",
        output="MaShanZheng-titles.subset.woff2",
        wanted=chars.title_chars,
    ),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def cmap_of(path: Path) -> set[str]:
    """The characters that a font file (TTF or WOFF2) can draw."""
    font = TTFont(path, lazy=True)
    try:
        return {chr(code) for code in font.getBestCmap()}
    finally:
        font.close()


def cut(source: Path, wanted: set[str], target: Path) -> tuple[set[str], int]:
    """Writes the face with the characters of ``wanted`` that the source has.

    Returns the characters that the source lacks, and the size of the file."""
    # The timestamps stay as they are, so that the same input gives the same bytes.
    font = TTFont(source, recalcTimestamp=False)
    cmap = font.getBestCmap()
    kept = {c for c in wanted if ord(c) in cmap}
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = FEATURES
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.notdef_outline = True
    options.hinting = False
    subsetter = subset.Subsetter(options)
    subsetter.populate(text="".join(sorted(kept)))
    subsetter.subset(font)
    target.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(target)
    return wanted - kept, target.stat().st_size


def build(src: Path, out: Path) -> int:
    for face in FACES:
        for needed in (face.source, face.licence):
            path = src / needed.name
            if not path.is_file():
                print(f"missing {path}: fetch it as README.md says", file=sys.stderr)
                return 1
            if sha256(path) != needed.sha256:
                print(f"{path} is not the pinned file (sha256 {sha256(path)})", file=sys.stderr)
                return 1
    record: dict[str, object] = {}
    for face in FACES:
        wanted = face.wanted()
        target = out / face.folder / face.output
        lacking, size = cut(src / face.source.name, wanted, target)
        shutil.copyfile(src / face.licence.name, out / face.folder / "OFL.txt")
        print(
            f"{face.folder}/{face.output}: {size} bytes, {len(wanted) - len(lacking)} characters"
            + (f", not in the source: {''.join(sorted(lacking))}" if lacking else "")
        )
        record[face.key] = {
            "family": face.family,
            "style": face.style,
            "version": face.version,
            "source": {
                "file": face.source.name,
                "url": face.source.url,
                "sha256": face.source.sha256,
            },
            "licence": {"url": face.licence.url, "sha256": face.licence.sha256},
            "output": f"web/public/fonts/{face.folder}/{face.output}",
            "characters": len(wanted) - len(lacking),
            "unavailable": "".join(sorted(lacking)),
            "bytes": size,
        }
    if out.resolve() == PUBLIC.resolve():  # the record describes the faces of the web client
        RECORD.write_text(
            json.dumps({"faces": record}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    return 0


def check(out: Path) -> int:
    """Says which characters the faces on disk lack for the text as it is now. Needs no source."""
    recorded = json.loads(RECORD.read_text(encoding="utf-8"))["faces"]
    bad = 0
    for face in FACES:
        path = out / face.folder / face.output
        if not path.is_file():
            print(f"{path} is missing")
            bad += 1
            continue
        lacking = face.wanted() - cmap_of(path) - set(recorded[face.key]["unavailable"])
        if lacking:
            bad += 1
            print(f"{face.output} lacks {len(lacking)} characters: {''.join(sorted(lacking))}")
        else:
            print(f"{face.output}: ok, {path.stat().st_size} bytes")
    if bad:
        print("run: uv run python tools/fonts/build.py --src tools/fonts/src", file=sys.stderr)
    return 1 if bad else 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--src", type=Path, help="the folder with the full faces and their licences"
    )
    parser.add_argument(
        "--out", type=Path, default=PUBLIC, help="web/public/fonts of the web client"
    )
    parser.add_argument("--check", action="store_true", help="only check the faces on disk")
    args = parser.parse_args()
    if args.check:
        return check(args.out)
    if args.src is None:
        parser.error("--src is needed to cut the faces")
    return build(args.src, args.out)


if __name__ == "__main__":
    sys.exit(main())
