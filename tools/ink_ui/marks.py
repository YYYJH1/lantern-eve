#!/usr/bin/env python3
"""The brush marks of the interface, as path data in a TypeScript module.

A tick for a line that is done, a circle round a word, a short stroke that strikes a number
out, the strokes of 正 that count, an underline for a word to act on, and the seals 「办妥」 and
「送到」. All are drawn as filled outlines with uneven widths, by ``brush.py``. They are data and
not pictures, so that the page fills them with the colour of its ink, of its rouge or of the lamp,
whatever the theme is, and so that nothing is fetched. The module they go to is
``web/src/page/ui/marks.ts``.

    uv run python tools/ink_ui/marks.py            write the module
    uv run python tools/ink_ui/marks.py --check    fail when the module is not what this makes

The seals carry the outlines of their characters from Ma Shan Zheng (``seal_glyphs.json``, made by
``tools/fonts/glyph_paths.py``), so that no font is asked when a seal is drawn.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import re
import sys
from pathlib import Path

try:
    from ink_ui import brush
except ImportError:  # run as a script from another folder
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from ink_ui import brush

Point = brush.Point
Mark = dict[str, object]

HERE = Path(__file__).resolve().parent
OUT = HERE.parents[1] / "web" / "src" / "page" / "ui" / "marks.ts"


def mark(paths: list[str], w: float, h: float, **extra: object) -> Mark:
    return {"w": round(w), "h": round(h), "paths": paths, **extra}


# ---------------------------------------------------------------- strokes


def tick(seed: int, s: float = 1.0) -> Mark:
    """The tick of a done line: a short pressed stroke down, then a long stroke flicked up."""
    a = brush.stroke(
        [(2.0 * s, 11.0 * s), (5.0 * s, 14.5 * s), (8.2 * s, 18.2 * s)],
        1.4 * s,
        3.1 * s,
        3.4 * s,
        press=0.2,
        taper=0.9,
        seed=seed,
        wobble=0.1,
        per=10,
    )
    b = brush.stroke(
        [(7.6 * s, 18.0 * s), (12.5 * s, 11.5 * s), (18.0 * s, 5.0 * s), (24.0 * s, 1.2 * s)],
        3.4 * s,
        2.8 * s,
        0.35 * s,
        press=0.1,
        taper=0.35,
        seed=seed + 7,
        wobble=0.2,
        per=14,
    )
    return mark([brush.path(a), brush.path(b)], 26 * s, 21 * s)


def strike(length: float, seed: int, tilt: float = -1.5) -> Mark:
    """A stroke that is nearly level and a little lifted at its end."""
    pts = [
        (1.5, 6.0 - tilt * 0.3),
        (length * 0.35, 5.2),
        (length * 0.7, 4.6 + tilt * 0.4),
        (length - 1.5, 3.4 + tilt),
    ]
    s = brush.stroke(pts, 1.0, 2.4, 0.4, press=0.15, taper=0.5, seed=seed, wobble=0.25, per=14)
    return mark([brush.path(s)], length, 10)


def underline(length: float, seed: int, thick: float, tilt: float = 0.0) -> Mark:
    """A brush underline: pressed at its start, a little heavy, thinning with a flick at its end."""
    pts = [
        (1.5, 4.8),
        (length * 0.30, 5.4 + tilt * 0.3),
        (length * 0.65, 5.0 + tilt * 0.7),
        (length - 2, 4.2 + tilt),
    ]
    s = brush.stroke(pts, thick * 0.55, thick, 0.3, press=0.10, taper=0.55, seed=seed, wobble=0.35)
    return mark([brush.path(s)], length, 10)


def circle(w: float, h: float, seed: int, thick: float = 2.4) -> Mark:
    """A circle drawn by hand round something w by h in size, starting upper left, overshooting."""
    rng = random.Random(seed)
    cx, cy, rx, ry = w / 2, h / 2, w / 2 - 2, h / 2 - 2
    pts: list[Point] = []
    a0, a1 = -2.55, 3.95
    for i in range(13):
        a = a0 + (a1 - a0) * i / 12
        k = 1 + 0.035 * math.sin(a * 2 + 1.0) + rng.uniform(-0.012, 0.012) + 0.04 * (i / 12)
        pts.append((cx + rx * k * math.cos(a), cy + ry * k * math.sin(a)))
    s = brush.stroke(
        pts, thick * 0.6, thick, 0.3, press=0.1, taper=0.6, seed=seed, wobble=0.2, per=8
    )
    return mark([brush.path(s)], w, h)


# The five strokes of 正 in the order they are written: the top bar, the stem, the middle bar, the
# short foot on the left and the bottom bar. Each has the centre line and the widths at its start,
# in its middle and at its end.
TALLY = [
    ([(2, 3.2), (9, 2.6), (15, 2.9), (23, 2.4)], (1.0, 2.7, 0.6)),
    ([(12.4, 3.0), (12.1, 10.5), (12.6, 18.0), (12.3, 26.0)], (1.6, 2.5, 0.5)),
    ([(12.6, 12.2), (16.0, 11.9), (20.5, 12.3)], (1.1, 2.3, 0.7)),
    ([(5.0, 12.6), (4.8, 18.5), (5.3, 24.0)], (1.2, 2.3, 0.6)),
    ([(0.8, 26.4), (8.0, 26.0), (16.0, 26.6), (24.5, 25.9)], (1.4, 2.9, 0.7)),
]


def tally(count: int, seed: int = 7) -> Mark:
    """The first ``count`` strokes of 正, for a count of one to five. Each stroke is fixed."""
    paths = []
    for i, (pts, (w0, wm, w1)) in enumerate(TALLY[:count]):
        s = brush.stroke(
            pts, w0, wm, w1, press=0.14, taper=0.55, seed=seed + 13 * i, wobble=0.15, per=12
        )
        paths.append(brush.path(s))
    return mark(paths, 26, 30)


def rule(length: float, seed: int, thick: float = 2.0) -> Mark:
    """A level line ruled with a brush: the line of a ledger."""
    pts = [(0, 2.5), (length * 0.3, 2.1), (length * 0.7, 2.7), (length, 2.3)]
    s = brush.stroke(
        pts,
        thick * 0.8,
        thick,
        thick * 0.7,
        press=0.04,
        taper=0.9,
        seed=seed,
        wobble=0.3,
        jitter=0.18,
        per=30,
    )
    return mark([brush.path(s)], length, 5)


def vertical_rule(length: float, seed: int, thick: float = 2.0) -> Mark:
    """A plumb line ruled with a brush: the edge of a column."""
    pts = [(2.5, 0), (2.1, length * 0.3), (2.7, length * 0.7), (2.3, length)]
    s = brush.stroke(
        pts,
        thick * 0.8,
        thick,
        thick * 0.7,
        press=0.04,
        taper=0.9,
        seed=seed,
        wobble=0.3,
        jitter=0.18,
        per=30,
    )
    return mark([brush.path(s)], 5, length)


def pause_glyph() -> Mark:
    a = brush.stroke(
        [(7, 3), (7.3, 11), (6.8, 21)], 1.5, 2.8, 1.8, press=0.15, taper=0.7, seed=10, wobble=0.15
    )
    b = brush.stroke(
        [(17, 2.6), (16.6, 11), (17.2, 21.4)],
        1.5,
        2.9,
        1.9,
        press=0.15,
        taper=0.7,
        seed=11,
        wobble=0.15,
    )
    return mark([brush.path(a), brush.path(b)], 24, 24)


def menu_glyph() -> Mark:
    paths = []
    for i, y in enumerate((5.5, 12.0, 18.5)):
        s = brush.stroke(
            [(2.5, y), (10, y - 0.5 + i * 0.3), (21.5, y + 0.2)],
            1.3,
            2.3,
            1.0,
            press=0.12,
            taper=0.7,
            seed=11 + i,
            wobble=0.15,
        )
        paths.append(brush.path(s))
    return mark(paths, 24, 24)


def play_glyph() -> Mark:
    a = brush.stroke(
        [(6, 4), (7, 12), (6.4, 20)], 1.8, 3.2, 2.2, press=0.12, taper=0.7, seed=12, wobble=0.12
    )
    b = brush.stroke(
        [(6.4, 4.4), (14, 8.4), (20.5, 12.0)],
        2.4,
        3.0,
        0.8,
        press=0.1,
        taper=0.5,
        seed=13,
        wobble=0.12,
    )
    c = brush.stroke(
        [(20.5, 12.0), (13, 16.0), (6.6, 19.8)],
        0.8,
        2.8,
        2.2,
        press=0.1,
        taper=0.5,
        seed=14,
        wobble=0.12,
    )
    return mark([brush.path(a), brush.path(b), brush.path(c)], 24, 24)


# ---------------------------------------------------------------- seals

# Path data as the font tools write it: absolute M, L, H, V, Q, C and Z.
TOKEN = re.compile(r"([MLHVQCZ])|(-?\d+(?:\.\d+)?)")
Contour = list[tuple[str, list[Point]]]


def parse(data: str) -> list[Contour]:
    """Path data as contours, each a list of (command, points). H and V become L."""
    contours: list[Contour] = []
    cmd, nums = "", []
    cur: Point = (0.0, 0.0)
    pending: list[tuple[str, list[float]]] = []
    for m in TOKEN.finditer(data):
        if m.group(1):
            if cmd:
                pending.append((cmd, nums))
            cmd, nums = m.group(1), []
        else:
            nums.append(float(m.group(2)))
    if cmd:
        pending.append((cmd, nums))
    contour: Contour = []
    sizes = {"M": 2, "L": 2, "H": 1, "V": 1, "Q": 4, "C": 6, "Z": 0}
    for cmd, nums in pending:
        step = sizes[cmd]
        chunks = [nums[i : i + step] for i in range(0, len(nums), step)] if step else [[]]
        for chunk in chunks:
            if cmd == "H":
                cur, chunk, cmd2 = (chunk[0], cur[1]), [chunk[0], cur[1]], "L"
            elif cmd == "V":
                cur, chunk, cmd2 = (cur[0], chunk[0]), [cur[0], chunk[0]], "L"
            else:
                cmd2 = cmd
                if chunk:
                    cur = (chunk[-2], chunk[-1])
            if cmd2 == "M" and contour:
                contours.append(contour)
                contour = []
            points = [(chunk[i], chunk[i + 1]) for i in range(0, len(chunk), 2)]
            contour.append((cmd2, points))
    if contour:
        contours.append(contour)
    return contours


def polygon(contour: Contour, steps: int = 6) -> list[Point]:
    """A contour flattened to a polygon, for a test of what is inside it."""
    out: list[Point] = []
    cur: Point = (0.0, 0.0)
    for cmd, pts in contour:
        if cmd in "ML":
            out.append(pts[0])
            cur = pts[0]
        elif cmd == "Q":
            (cx, cy), (x, y) = pts
            for i in range(1, steps + 1):
                t = i / steps
                out.append(
                    (
                        (1 - t) ** 2 * cur[0] + 2 * (1 - t) * t * cx + t * t * x,
                        (1 - t) ** 2 * cur[1] + 2 * (1 - t) * t * cy + t * t * y,
                    )
                )
            cur = (x, y)
        elif cmd == "C":
            (c1x, c1y), (c2x, c2y), (x, y) = pts
            for i in range(1, steps + 1):
                t = i / steps
                u = 1 - t
                out.append(
                    (
                        u**3 * cur[0] + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t**3 * x,
                        u**3 * cur[1] + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t**3 * y,
                    )
                )
            cur = (x, y)
    return out


def inside(point: Point, polygons: list[list[Point]]) -> bool:
    """Whether the point is inside the polygons together (even-odd)."""
    x, y = point
    count = 0
    for poly in polygons:
        for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1], strict=True):
            if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
                count += 1
    return count % 2 == 1


def write(contours: list[Contour]) -> str:
    """Path data for the contours; a run of line segments shares one L."""
    parts: list[str] = []
    for contour in contours:
        last = ""
        for cmd, pts in contour:
            coords = " ".join(f"{brush.number(x)} {brush.number(y)}" for x, y in pts)
            if cmd == "L" and last == "L":
                parts.append(" " + coords)
            else:
                parts.append(cmd + coords)
            last = cmd
        if last != "Z":
            parts.append("Z")
    return "".join(parts)


def move(contours: list[Contour], fn: object) -> list[Contour]:
    """The contours with every point put through ``fn``."""
    return [[(cmd, [fn(p) for p in pts]) for cmd, pts in contour] for contour in contours]  # type: ignore[operator]


def closed(points: list[Point]) -> Contour:
    return [("M", [points[0]]), *[("L", [p]) for p in points[1:]], ("Z", [])]


def rough_rect(
    w: float, h: float, r: float, seed: int, jit: float = 0.7, step: float = 3.0
) -> list[Point]:
    """The outline of a stamp: a rectangle with rounded corners and a hand-pressed edge."""
    rng = random.Random(seed)
    pts: list[Point] = []

    def edge(x0: float, y0: float, x1: float, y1: float) -> None:
        n = max(2, int(math.hypot(x1 - x0, y1 - y0) / step))
        for i in range(n):
            t = i / n
            pts.append(
                (
                    x0 + (x1 - x0) * t + rng.uniform(-jit, jit) * 0.6,
                    y0 + (y1 - y0) * t + rng.uniform(-jit, jit) * 0.6,
                )
            )

    def corner(cx: float, cy: float, a0: float) -> None:
        for k in range(5):
            a = a0 + k * (math.pi / 2) / 4
            pts.append(
                (
                    cx + math.cos(a) * r + rng.uniform(-jit, jit) * 0.4,
                    cy + math.sin(a) * r + rng.uniform(-jit, jit) * 0.4,
                )
            )

    m = 0.8
    corner(r + m, r + m, math.pi)
    edge(r + m, m, w - r - m, m)
    corner(w - r - m, r + m, 1.5 * math.pi)
    edge(w - m, r + m, w - m, h - r - m)
    corner(w - r - m, h - r - m, 0)
    edge(w - r - m, h - m, r + m, h - m)
    corner(r + m, h - r - m, 0.5 * math.pi)
    edge(m, h - r - m, m, r + m)
    return pts


def frame_ring(x: float, y: float, w: float, h: float, thick: float, seed: int) -> list[Contour]:
    """A thin ruled frame as a ring: the outer and inner outlines, each a little uneven."""
    rng = random.Random(seed)

    def outline(grow: float) -> list[Point]:
        pts: list[Point] = []
        for (ax, ay), (bx, by) in (
            ((x - grow, y - grow), (x + w + grow, y - grow)),
            ((x + w + grow, y - grow), (x + w + grow, y + h + grow)),
            ((x + w + grow, y + h + grow), (x - grow, y + h + grow)),
            ((x - grow, y + h + grow), (x - grow, y - grow)),
        ):
            n = max(2, int(math.hypot(bx - ax, by - ay) / 4))
            for i in range(n):
                t = i / n
                pts.append(
                    (
                        ax + (bx - ax) * t + rng.uniform(-0.25, 0.25),
                        ay + (by - ay) * t + rng.uniform(-0.25, 0.25),
                    )
                )
        return pts

    return [closed(outline(thick / 2)), closed(outline(-thick / 2))]


def seal(
    chars: str, glyphs: dict[str, str], w: float, h: float, layout: str, tilt: float, seed: int
) -> Mark:
    """A seal in the old way: a solid block of ink, a thin frame and the characters cut out of it.

    It is one path to fill with the even-odd rule. The cut parts show the paper through, and a few
    specks are left out of the ink as a stamp pressed by hand leaves them.
    """
    rng = random.Random(seed)
    outer = rough_rect(w, h, min(5.0, h * 0.14), seed)
    holes: list[Contour] = frame_ring(
        w * 0.075, h * 0.09, w * 0.85, h * 0.82, max(1.0, w / 60), seed + 1
    )
    letters: list[list[Point]] = []
    n = len(chars)
    inner_w, inner_h = w * 0.85 - 5, h * 0.82 - 5
    size = min(inner_w / n, inner_h) if layout == "h" else min(inner_w, inner_h / n)
    size *= 1.04  # the outline of a character fills about nine tenths of its square
    for i, ch in enumerate(chars):
        cx, cy = (w * (i + 0.5) / n, h / 2) if layout == "h" else (w / 2, h * (i + 0.5) / n)
        polys = [polygon(c, 5) for c in parse(glyphs[ch])]
        box = [p for poly in polys for p in poly]
        bx = (min(p[0] for p in box) + max(p[0] for p in box)) / 2
        by = (min(p[1] for p in box) + max(p[1] for p in box)) / 2
        k = size / 1000
        xs = 1.0 if layout == "h" else 1.3  # stacked, the characters are widened to fill the frame
        for poly in polys:
            moved = [(cx + (x - bx) * k * xs, cy + (y - by) * k) for x, y in poly]
            letters.append(brush.simplify(moved, 0.07))
    specks: list[Contour] = []
    for _ in range(int(w * h / 100)):
        x, y = rng.uniform(1.5, w - 1.5), rng.uniform(1.5, h - 1.5)
        if inside((x, y), letters):
            continue
        r = rng.uniform(0.3, 0.8)
        a0 = rng.uniform(0, 2 * math.pi)
        specks.append(
            closed(
                [
                    (
                        x + r * rng.uniform(0.7, 1.3) * math.cos(a0 + k * 1.2566),
                        y + r * rng.uniform(0.7, 1.3) * math.sin(a0 + k * 1.2566),
                    )
                    for k in range(5)
                ]
            )
        )
    contours_all = [closed(outer), *holes, *[closed(poly) for poly in letters], *specks]
    cx0, cy0 = w / 2, h / 2
    sin, cos = math.sin(math.radians(tilt)), math.cos(math.radians(tilt))
    turned = move(
        contours_all,
        lambda p: (
            cx0 + (p[0] - cx0) * cos - (p[1] - cy0) * sin,
            cy0 + (p[0] - cx0) * sin + (p[1] - cy0) * cos,
        ),
    )
    return mark([write(turned)], w, h, evenodd=True)


# ---------------------------------------------------------------- the module


def marks() -> dict[str, object]:
    glyphs = json.loads((HERE / "seal_glyphs.json").read_text(encoding="utf-8"))
    return {
        "TICKS": [tick(1, 1.0), tick(5, 0.94), tick(9, 1.06)],
        "CIRCLES": {
            "round": circle(36, 36, 6),
            "wide": circle(72, 34, 11),
            "long": circle(132, 32, 12),
        },
        "STRIKES": [strike(24, 2), strike(28, 5), strike(32, 8)],
        "STRIKE_LINES": [strike(120, 3), strike(120, 6, tilt=-0.8), strike(120, 9, tilt=-2.2)],
        "TALLY": [tally(n) for n in range(1, 6)],
        "UNDERLINES": [
            underline(120, 3, 2.6),
            underline(120, 9, 3.0, tilt=0.8),
            underline(120, 14, 2.4, tilt=-0.5),
        ],
        "SEALS": {
            "done": {
                "wide": seal("办妥", glyphs, 64, 44, "h", -3, 21),
                "square": seal("办妥", glyphs, 52, 52, "v", -3, 22),
            },
            "delivered": {
                "wide": seal("送到", glyphs, 64, 44, "h", 2.5, 31),
                "square": seal("送到", glyphs, 52, 52, "v", 2.5, 32),
            },
        },
        "RULES": [rule(300, 9), rule(300, 10, 1.6)],
        "VERTICAL_RULES": [vertical_rule(300, 19), vertical_rule(300, 20, 1.6)],
        "GLYPHS": {"pause": pause_glyph(), "play": play_glyph(), "menu": menu_glyph()},
    }


def literal(value: object, depth: int = 0) -> str:
    pad = "  " * depth
    if isinstance(value, dict):
        if "paths" in value:
            body = ", ".join(
                f"{k}: {literal(v, depth + 1)}" for k, v in value.items() if k != "paths"
            )
            paths = ",\n".join(f'{pad}    "{p}"' for p in value["paths"])  # type: ignore[attr-defined]
            return f"{{ {body}, paths: [\n{paths},\n{pad}  ] }}"
        items = ",\n".join(f"{pad}  {k}: {literal(v, depth + 1)}" for k, v in value.items())
        return "{\n" + items + f",\n{pad}}}"
    if isinstance(value, list):
        items = ",\n".join(f"{pad}  {literal(v, depth + 1)}" for v in value)
        return "[\n" + items + f",\n{pad}]"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


HEADER = """/**
 * The brush marks of the interface: a tick, a circle, strokes that strike and count, an underline,
 * the seals.
 *
 * Every mark is filled outlines with uneven widths, in a box of `w` by `h` pixels at its natural
 * size. Draw them as SVG paths with `fill="currentColor"`, so that the page chooses the colour
 * (ink, rouge, the lamp). They are not pictures and nothing is fetched. A seal is one path to
 * fill with `fill-rule="evenodd"`: the characters and the frame are cut out of the ink. A mark
 * that has to be longer or shorter than its box (a rule, a strike, an underline) is drawn in an
 * `<svg preserveAspectRatio="none">` of the length it needs and the height of its box.
 *
 * The characters of the seals are outlines of Ma Shan Zheng, under the SIL Open Font License 1.1
 * (the licence is in `web/public/fonts/ma-shan-zheng/OFL.txt`).
 *
 * This file is written by `tools/ink_ui/marks.py`. Do not edit it by hand.
 */

export interface Mark {
  /** The width and height of the box, in pixels at the natural size of the mark. */
  readonly w: number;
  readonly h: number;
  /** Filled shapes. Draw them all with the same fill. */
  readonly paths: readonly string[];
  /** The shapes have holes that the even-odd rule makes: set `fill-rule="evenodd"`. */
  readonly evenodd?: true;
}

/** One or more variants of a mark, a little different from one another. */
export type Variants = readonly [Mark, ...Mark[]];

"""

FOOTER = """
/**
 * A stable choice among variants: the same key gives the same variant, so a list keeps its marks
 * when it is drawn again.
 */
export function pick<T>(variants: readonly [T, ...T[]], key: number | string): T {
  let n = 7;
  for (const c of String(key)) n = (n * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
  return variants[n % variants.length] ?? variants[0];
}

/**
 * The tally of `count` in the strokes of 正, written in the order of the strokes. None for zero,
 * and one whole 正 for five or more.
 */
export function tally(count: number): Mark | null {
  const n = Math.min(Math.floor(count), TALLY.length);
  return n < 1 ? null : (TALLY[n - 1] ?? null);
}

/** The tally of a number past five: a whole 正 for each five, and the strokes that are left. */
export function tallies(count: number): Mark[] {
  const out: Mark[] = [];
  for (let left = Math.max(0, Math.floor(count)); left > 0; left -= 5) {
    const mark = tally(Math.min(left, 5));
    if (mark !== null) out.push(mark);
  }
  return out;
}
"""

DOCS = {
    "TICKS": "A tick for a line that is done. Three, a little different from one another.",
    "CIRCLES": "A circle drawn by hand round a word: round, wide (a phrase) and long (a line).",
    "STRIKES": "A short stroke that strikes a number out: 删去线 before the count against.",
    "STRIKE_LINES": "A long stroke to strike a line of text through. Stretch it to the line.",
    "TALLY": "The strokes of 正 that count. `TALLY[n - 1]` is the first n, in the order written.",
    "UNDERLINES": "An underline for a word to act on. Stretch it to the length of the word.",
    "SEALS": "The seals 办妥 (done) and 送到 (delivered), each wide and square. Fill with rouge.",
    "RULES": "A level ruled line, for the lines of a ledger. Stretch it to the page's width.",
    "VERTICAL_RULES": "A plumb ruled line, for the edge of a column. Stretch it to the page.",
    "GLYPHS": "Three small glyphs for the top right: pause, play and menu.",
}


TYPES = {
    "CIRCLES": 'Record<"round" | "wide" | "long", Mark>',
    "SEALS": 'Record<"done" | "delivered", Record<"wide" | "square", Mark>>',
    "GLYPHS": 'Record<"pause" | "play" | "menu", Mark>',
}


def render() -> str:
    parts = [HEADER]
    for name, value in marks().items():
        kind = TYPES.get(name, "Variants")
        parts.append(f"/** {DOCS[name]} */\n")
        parts.append(f"export const {name}: {kind} = {literal(value)};\n\n")
    parts.append(FOOTER.lstrip("\n"))
    return "".join(parts)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--out", type=Path, default=OUT, help="the module to write")
    parser.add_argument(
        "--check", action="store_true", help="fail when the module is not up to date"
    )
    args = parser.parse_args()
    text = render()
    if args.check:
        if not args.out.is_file() or args.out.read_text(encoding="utf-8") != text:
            print(f"{args.out} is not what tools/ink_ui/marks.py writes", file=sys.stderr)
            return 1
        return 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8")
    print(f"{args.out}: {len(text)} characters")
    return 0


if __name__ == "__main__":
    sys.exit(main())
