"""Brush strokes as filled outlines with uneven widths. Standard library only, seeded.

A stroke is a centre line, a smooth curve through a few points, and a width along it: pressed at
the start, thick in the middle, thinning to the end, with a slow wobble of the line and of the width
so that no mark is the same as another and none has the width of a ruler. ``stroke`` returns the
outline as a list of points. ``path`` writes points as SVG path data.
"""

from __future__ import annotations

import math
import random

Point = tuple[float, float]


def _spline(p0: Point, p1: Point, p2: Point, p3: Point, t: float, a: int) -> float:
    t2, t3 = t * t, t * t * t
    return 0.5 * (
        2 * p1[a]
        + (-p0[a] + p2[a]) * t
        + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2
        + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3
    )


def catmull_rom(points: list[Point], per: int = 18) -> list[Point]:
    """A smooth curve through the points, as a dense polyline (uniform Catmull-Rom)."""
    if len(points) == 2:
        (x0, y0), (x1, y1) = points
        return [(x0 + (x1 - x0) * i / per, y0 + (y1 - y0) * i / per) for i in range(per + 1)]
    p = [points[0], *points, points[-1]]
    out: list[Point] = []
    for i in range(1, len(p) - 2):
        for k in range(per):
            t = k / per
            out.append((_spline(*p[i - 1 : i + 3], t, 0), _spline(*p[i - 1 : i + 3], t, 1)))
    out.append(points[-1])
    return out


def smoothstep(a: float, b: float, x: float) -> float:
    t = max(0.0, min(1.0, (x - a) / (b - a) if b != a else 1.0))
    return t * t * (3 - 2 * t)


def stroke(
    points: list[Point],
    w0: float = 1.2,
    wmax: float = 3.0,
    w1: float = 0.5,
    press: float = 0.18,
    taper: float = 0.55,
    seed: int = 1,
    wobble: float = 0.35,
    jitter: float = 0.12,
    per: int = 18,
) -> list[Point]:
    """The outline of one stroke through ``points``.

    The width is ``w0`` at the start, grows to ``wmax`` over the first ``press`` of the length,
    stays there until ``taper`` and then falls to ``w1``. ``wobble`` moves the line sideways and
    ``jitter`` varies the width.
    """
    rng = random.Random(seed)
    c = catmull_rom(points, per)
    n = len(c)
    along = [0.0]
    for i in range(1, n):
        along.append(along[-1] + math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]))
    total = along[-1] or 1.0
    ph = [rng.uniform(0, 6.283) for _ in range(4)]
    left: list[Point] = []
    right: list[Point] = []
    for i in range(n):
        t = along[i] / total
        a, b = c[max(i - 1, 0)], c[min(i + 1, n - 1)]
        tx, ty = b[0] - a[0], b[1] - a[1]
        d = math.hypot(tx, ty) or 1.0
        nx, ny = -ty / d, tx / d
        if t < press:
            w = w0 + (wmax - w0) * smoothstep(0, press, t)
        elif t < taper:
            w = wmax
        else:
            w = wmax + (w1 - wmax) * smoothstep(taper, 1.0, t)
        w *= 1 + jitter * (
            math.sin(total * t * 0.35 + ph[0]) * 0.6 + math.sin(total * t * 0.9 + ph[1]) * 0.4
        )
        w = max(w, 0.25)
        off = wobble * (
            math.sin(total * t * 0.12 + ph[2]) * 0.7 + math.sin(total * t * 0.31 + ph[3]) * 0.3
        )
        x, y = c[i][0] + nx * off, c[i][1] + ny * off
        left.append((x + nx * w / 2, y + ny * w / 2))
        right.append((x - nx * w / 2, y - ny * w / 2))
    return left + right[::-1]


def number(value: float) -> str:
    """A coordinate with one decimal and no trailing zero (and no minus sign on zero)."""
    text = f"{value:.1f}"
    if text in ("-0.0", "0.0"):
        return "0"
    return text[:-2] if text.endswith(".0") else text


def simplify(points: list[Point], tol: float) -> list[Point]:
    """The polyline without the points within ``tol`` of the line between their neighbours (RDP)."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = points[a], points[b]
        dx, dy = bx - ax, by - ay
        length = math.hypot(dx, dy)
        far, at = 0.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            d = (
                math.hypot(px - ax, py - ay)
                if length == 0
                else abs(dy * (px - ax) - dx * (py - ay)) / length
            )
            if d > far:
                far, at = d, i
        if at >= 0 and far > tol:
            keep[at] = True
            stack += [(a, at), (at, b)]
    return [p for p, k in zip(points, keep, strict=True) if k]


def path(points: list[Point], tol: float = 0.04) -> str:
    """Closed path data through the points, with those that change nothing at ``tol`` left out."""
    pts = simplify(points, tol)
    first = f"{number(pts[0][0])} {number(pts[0][1])}"
    rest = " ".join(f"{number(x)} {number(y)}" for x, y in pts[1:])
    return f"M{first}L{rest}Z"
