#!/usr/bin/env python3
"""Rough paper edges as nine-slice images, for CSS ``border-image``.

A sheet of paper in the page has a hand-cut edge and a line of ink drawn a little inside it. The
page does not make that edge at run time (an SVG filter on a large page is slow). This script
draws it once, in the palettes of the page, at 1x and 2x, and the page lays the pictures round
its sheets:

    border-image: url("slip-day-ink-1x.png") 12 fill / 12px round;

The picture is a square of ``2 * corner + period`` pixels. Its four corners are the corners of the
sheet. The four bands between them are one ``period`` long, and the edge in a band is a periodic
function of the distance along it, so that bands laid end to end (``round`` or ``repeat``) show no
seam. The middle is flat paper, so that ``fill`` can stretch it over a sheet of any size. The paper
grain, if a page wants one, is a background of its own.

Only the standard library is used. The picture is rendered by scanline with eight samples to a pixel
vertically and exact coverage horizontally, then written as a PNG.

    uv run python tools/ink_ui/paper.py                 write web/public/ui/paper/
"""

from __future__ import annotations

import argparse
import json
import math
import random
import struct
import sys
import zlib
from collections.abc import Callable
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "web" / "public" / "ui" / "paper"

# The named colours of the page that a sheet of paper uses.
COLOURS = {
    "chabai": "#f3f9f1",  # 荼白, paper by day
    "yase": "#eedeb0",  # 牙色, paper under a lamp
    "wuhei": "#392f41",  # 乌黑, ink
    "mohui": "#758a99",  # 墨灰, the light ink of a line
}

# palette -> (paper, line). By day the line is black ink or the grey of a faint rule; at night the
# paper is the colour of paper under a lamp and the line is the grey.
PALETTES = {
    "day-ink": ("chabai", "wuhei"),
    "day-grey": ("chabai", "mohui"),
    "night": ("yase", "mohui"),
}

# The two grades of sheet, in pixels at 1x. ``corner`` is the slice, ``period`` the length of a
# band, ``margin`` the clear space between the picture and the roughest the paper gets, and
# ``inset`` where the line runs, inside the paper. The other four are the largest deviations: of
# the paper edge (a slow wobble and a short fibre), of the line, and the change of its width.
GRADES = {
    "slip": {
        "corner": 12,
        "period": 64,
        "margin": 2.9,
        "inset": 3.8,
        "line": 1.25,
        "wobble": 1.4,
        "fibre": 0.35,
        "drift": 0.5,
        "swell": 0.35,
    },
    "page": {
        "corner": 20,
        "period": 160,
        "margin": 3.8,
        "inset": 5.2,
        "line": 1.7,
        "wobble": 2.0,
        "fibre": 0.5,
        "drift": 0.75,
        "swell": 0.5,
    },
}

SCALES = (1, 2)
SAMPLES = 8  # sub-scanlines to a pixel


def rgb(name: str) -> tuple[int, int, int]:
    value = COLOURS[name]
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


# ---------------------------------------------------------------- the edge


def periodic(
    rng: random.Random, period: float, wavelengths: tuple[float, float], peak: float
) -> Callable[[float], float]:
    """A random function of one variable with the given period, and no value beyond ``peak``.

    A sum of sines that each make a whole number of cycles in the period, with wavelengths
    between the given ones (in pixels), scaled so that the largest value it reaches is ``peak``.
    """
    kmin = max(1, round(period / wavelengths[1]))
    kmax = max(kmin, int(period / wavelengths[0]))
    terms = [(k, rng.uniform(0, 2 * math.pi), rng.uniform(0.5, 1.0)) for k in range(kmin, kmax + 1)]

    def raw(x: float) -> float:
        return sum(a * math.sin(2 * math.pi * k * x / period + p) for k, p, a in terms)

    top = max(abs(raw(i * period / 400)) for i in range(400)) or 1.0
    return lambda x: peak * raw(x) / top


Side = Callable[[float], float]


class Sheet:
    """The geometry of one sheet at one grade: four sides for the paper and four for the line."""

    def __init__(self, grade: dict[str, float], seed: int) -> None:
        g = grade
        self.corner, self.period = int(g["corner"]), int(g["period"])
        self.size = 2 * self.corner + self.period
        rng = random.Random(seed)
        shift = self.corner  # the bands start here: the edge is a function of (distance - corner)

        def side(peak_slow: float, peak_fine: float, middle: bool) -> Side:
            # A slow wave and the short fibre of paper. A cut edge also has bumps a few finger
            # widths long, so the paper edge (``middle``) takes some of its slow part there.
            share = 0.35 if middle else 1.0
            slow = periodic(rng, self.period, (self.period / 3, self.period), peak_slow * share)
            bumps = periodic(rng, self.period, (8.0, 24.0), peak_slow * (1 - share))
            fine = periodic(rng, self.period, (1.6, 5.0), peak_fine)
            return lambda t: slow(t - shift) + bumps(t - shift) + fine(t - shift)

        near, far = g["margin"], self.size - g["margin"]
        ink_near, ink_far = near + g["inset"], far - g["inset"]
        sides = ("top", "bottom", "left", "right")
        self.paper = {n: side(g["wobble"], g["fibre"], True) for n in sides}  # offsets
        self.drift = {n: side(g["drift"], g["drift"] / 6, True) for n in self.paper}
        width = g["line"]
        self.swell = {
            n: periodic(rng, self.period, (self.period / 2, self.period), g["swell"])
            for n in self.paper
        }
        self.near, self.far, self.ink_near, self.ink_far, self.width = (
            near,
            far,
            ink_near,
            ink_far,
            width,
        )

    def sides(self, ink: float | None) -> tuple[Side, Side, Side, Side]:
        """The top, bottom, left and right of the paper (``ink`` None) or of one edge of the line.

        ``ink`` is -1 for the outer edge of the line and +1 for the inner edge.
        """
        if ink is None:
            p = self.paper
            return (
                lambda x: self.near + p["top"](x),
                lambda x: self.far - p["bottom"](x),
                lambda y: self.near + p["left"](y),
                lambda y: self.far - p["right"](y),
            )
        d, s, w, sh = self.drift, self.swell, self.width, self.corner

        def half(name: str, t: float) -> float:
            return ink * (w + s[name](t - sh)) / 2

        return (
            lambda x: self.ink_near + d["top"](x) + half("top", x),
            lambda x: self.ink_far - d["bottom"](x) - half("bottom", x),
            lambda y: self.ink_near + d["left"](y) + half("left", y),
            lambda y: self.ink_far - d["right"](y) - half("right", y),
        )

    def loop(self, ink: float | None, step: float) -> list[tuple[float, float]]:
        """The closed outline, clockwise from the top left corner, sampled every ``step`` pixels."""
        top, bottom, left, right = self.sides(ink)

        def corner(fx: Side, fy: Side, x: float, y: float) -> tuple[float, float]:
            for _ in range(5):
                x = fx(y)
                y = fy(x)
            return x, y

        tl, tr = corner(left, top, 0, 0), corner(right, top, self.size, 0)
        br, bl = corner(right, bottom, self.size, self.size), corner(left, bottom, 0, self.size)
        pts: list[tuple[float, float]] = []

        def walk(a: float, b: float, f: Callable[[float], tuple[float, float]]) -> None:
            # Samples lie on a grid of ``step`` that the period is a whole number of, so that every
            # band of the edge is sampled in the same places and the bands match to the last pixel.
            lo, hi = (a, b) if a < b else (b, a)
            run = [
                lo,
                *(k * step for k in range(math.floor(lo / step) + 1, math.ceil(hi / step))),
                hi,
            ]
            for v in run if a < b else run[::-1]:
                pts.append(f(v))
            pts.pop()  # the last point is the first of the next side

        walk(tl[0], tr[0], lambda x: (x, top(x)))
        walk(tr[1], br[1], lambda y: (right(y), y))
        walk(br[0], bl[0], lambda x: (x, bottom(x)))
        walk(bl[1], tl[1], lambda y: (left(y), y))
        return pts


# ---------------------------------------------------------------- the rasteriser


def coverage(
    polygons: list[list[tuple[float, float]]], width: int, height: int
) -> list[list[float]]:
    """How much of each pixel the polygons cover together (even-odd), by eight samples down."""
    rows = [[0.0] * width for _ in range(height)]
    hits: dict[int, list[float]] = {}
    for poly in polygons:
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1], strict=True):
            if y0 == y1:
                continue
            lo, hi = (y0, y1) if y0 < y1 else (y1, y0)
            first = max(0, math.ceil(lo * SAMPLES - 0.5))
            last = min(height * SAMPLES - 1, math.floor(hi * SAMPLES - 0.5))
            slope = (x1 - x0) / (y1 - y0)
            for j in range(first, last + 1):
                y = (j + 0.5) / SAMPLES
                hits.setdefault(j, []).append(x0 + (y - y0) * slope)
    for j, xs in hits.items():
        xs.sort()
        row = rows[j // SAMPLES]
        for a, b in zip(xs[0::2], xs[1::2], strict=False):
            a, b = max(a, 0.0), min(b, float(width))
            if b <= a:
                continue
            ia, ib = int(a), min(int(b), width - 1)
            if ia == ib:
                row[ia] += (b - a) / SAMPLES
                continue
            row[ia] += (ia + 1 - a) / SAMPLES
            for x in range(ia + 1, ib):
                row[x] += 1 / SAMPLES
            row[ib] += (b - ib) / SAMPLES
    return rows


def render(
    grade: dict[str, float],
    seed: int,
    scale: int,
    paper: tuple[int, int, int],
    ink: tuple[int, int, int],
) -> tuple[int, int, bytes]:
    """The picture as straight RGBA, ``(width, height, bytes)``."""
    sheet = Sheet(grade, seed)
    size = sheet.size * scale
    step = 0.5 / scale

    def scaled(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
        return [(x * scale, y * scale) for x, y in points]

    paper_cover = coverage([scaled(sheet.loop(None, step))], size, size)
    ring = coverage([scaled(sheet.loop(-1, step)), scaled(sheet.loop(1, step))], size, size)
    out = bytearray()
    for cp_row, ci_row in zip(paper_cover, ring, strict=True):
        for cp, ci in zip(cp_row, ci_row, strict=True):
            cp, ci = min(cp, 1.0), min(ci, 1.0)
            alpha = ci + cp * (1 - ci)
            if alpha <= 0:
                out += b"\0\0\0\0"
                continue
            colour = [(ink[i] * ci + paper[i] * cp * (1 - ci)) / alpha for i in range(3)]
            out += bytes([round(c) for c in colour]) + bytes([round(alpha * 255)])
    return size, size, bytes(out)


def png(width: int, height: int, rgba: bytes) -> bytes:
    """A PNG file of straight 8-bit RGBA."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    raw = b"".join(b"\0" + rgba[y * width * 4 : (y + 1) * width * 4] for y in range(height))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


# ---------------------------------------------------------------- the files


def name_of(grade: str, palette: str, scale: int) -> str:
    return f"{grade}-{palette}-{scale}x.png"


def build(out: Path) -> dict[str, object]:
    out.mkdir(parents=True, exist_ok=True)
    files: dict[str, dict[str, object]] = {}
    for gi, (grade, params) in enumerate(GRADES.items()):
        for pi, (palette, (paper, line)) in enumerate(PALETTES.items()):
            for scale in SCALES:
                # One seed to a grade and palette: the 1x and the 2x pictures show the same edge.
                width, height, rgba = render(
                    params, 100 * gi + pi + 1, scale, rgb(paper), rgb(line)
                )
                name = name_of(grade, palette, scale)
                data = png(width, height, rgba)
                (out / name).write_bytes(data)
                files[name] = {"width": width, "height": height, "bytes": len(data)}
                print(f"{name}: {width}x{height}, {len(data)} bytes")
    index = {
        "schema": "lantern-eve/paper-edges@1",
        "grades": {
            g: {
                "slice": int(p["corner"]),
                "period": int(p["period"]),
                "size": 2 * int(p["corner"]) + int(p["period"]),
            }
            for g, p in GRADES.items()
        },
        "palettes": {
            n: {"paper": COLOURS[paper], "line": COLOURS[line]}
            for n, (paper, line) in PALETTES.items()
        },
        "scales": list(SCALES),
        "files": files,
    }
    (out / "index.json").write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    return index


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--out", type=Path, default=OUT, help="the folder of the pictures")
    build(parser.parse_args().out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
