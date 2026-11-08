#!/usr/bin/env python3
"""The outlines of a few characters as SVG path data, for what draws a character as a shape.

The seals of the brush marks and the baked objects of the sprite kit (the character cut in the
elder's seal, the label of the notebook) carry a character that no font has to draw when they are
shown. The outlines come from Ma Shan Zheng, which is SIL Open Font License 1.1 like the face the
page loads, and from the same pinned file that ``build.py`` cuts.

    uv run python tools/fonts/glyph_paths.py --src tools/fonts/src --chars 族见闻簿

prints one line of JSON, the character and its path. The path is in the em square of the font: x
from 0 to 1000 to the right, y from 0 to 1000 downwards, the top of the square being the ascender.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

try:
    from fonts import build
except ImportError:  # run as a script from another folder
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from fonts import build

FACE = next(face for face in build.FACES if face.key == "ma-shan-zheng")


def number(value: float) -> str:
    """A coordinate with at most one decimal, and no trailing zero."""
    text = f"{value:.1f}"
    return text[:-2] if text.endswith(".0") else text


def outline(font: TTFont, char: str) -> str:
    """The path data of one character, in the em square (y downwards)."""
    glyphs = font.getGlyphSet()
    name = font.getBestCmap()[ord(char)]
    ascent = font["hhea"].ascent
    pen = SVGPathPen(glyphs, ntos=number)
    glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, 0, ascent)))
    return pen.getCommands()


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--src", type=Path, required=True, help="the folder with the full faces")
    parser.add_argument("--chars", required=True, help="the characters to outline")
    parser.add_argument("--js", type=Path, help="write a script that defines GLYPHS, for the kit")
    args = parser.parse_args()
    path = args.src / FACE.source.name
    if build.sha256(path) != FACE.source.sha256:
        print(f"{path} is not the pinned file", file=sys.stderr)
        return 1
    font = TTFont(path, recalcTimestamp=False)
    paths = {c: outline(font, c) for c in args.chars}
    if args.js is None:
        print(json.dumps(paths, ensure_ascii=False))
        return 0
    lines = [f"  {json.dumps(c, ensure_ascii=False)}: {json.dumps(d)}," for c, d in paths.items()]
    args.js.write_text(
        "'use strict';\n"
        f"// The outlines of {args.chars} in the em square of Ma Shan Zheng (y down).\n"
        "// Made by tools/fonts/glyph_paths.py from the pinned face (SIL Open Font License 1.1)\n"
        "// (the licence is in web/public/fonts/ma-shan-zheng/OFL.txt). Do not edit by hand.\n"
        "const GLYPHS = {\n" + "\n".join(lines) + "\n};\n",
        encoding="utf-8",
    )
    print(f"{args.js}: {len(paths)} characters")
    return 0


if __name__ == "__main__":
    sys.exit(main())
