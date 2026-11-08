"""What tools/ink_ui draws for the ink-and-paper interface: the paper edges and the brush marks.

The pictures are checked for what a page needs of them: the size (a 2x picture is a 1x picture twice
as large), the colours of the page, an edge that has no seam where the bands meet and no paper on
the outermost pixels. The marks module is checked against the script that writes it.
"""

from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path

import pytest

from ink_ui import brush, marks, paper

REPO = Path(__file__).resolve().parents[1]
PAPER = REPO / "web" / "public" / "ui" / "paper"
INDEX = json.loads((PAPER / "index.json").read_text(encoding="utf-8"))


def read_png(path: Path) -> tuple[int, int, list[bytes]]:
    """A PNG of straight 8-bit RGBA, as ``(width, height, rows)``. It reads what paper.py writes."""
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, width, height = 8, b"", 0, 0
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind, body = data[pos + 4 : pos + 8], data[pos + 8 : pos + 8 + length]
        if kind == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", body[:10])
            assert (depth, colour) == (8, 6)
        elif kind == b"IDAT":
            idat += body
        pos += 12 + length
    raw = zlib.decompress(idat)
    stride = width * 4 + 1
    rows = []
    for y in range(height):
        assert raw[y * stride] == 0  # no filter: paper.py writes none
        rows.append(raw[y * stride + 1 : (y + 1) * stride])
    return width, height, rows


def pixel(rows: list[bytes], x: int, y: int) -> tuple[int, int, int, int]:
    r = rows[y]
    return r[4 * x], r[4 * x + 1], r[4 * x + 2], r[4 * x + 3]


def hex_rgb(value: str) -> tuple[int, int, int]:
    return int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16)


FILES = sorted(INDEX["files"])


def parts(name: str) -> tuple[str, str, int]:
    """The grade, the palette and the scale of a file name such as ``page-day-ink-2x.png``."""
    grade, rest = name[: -len(".png")].split("-", 1)
    palette, scale = rest.rsplit("-", 1)
    return grade, palette, int(scale[:-1])


def test_every_grade_palette_and_scale_has_its_file_and_the_index_lists_them_all() -> None:
    expected = {
        paper.name_of(grade, palette, scale)
        for grade in paper.GRADES
        for palette in paper.PALETTES
        for scale in paper.SCALES
    }
    assert set(FILES) == expected
    assert {p.name for p in PAPER.glob("*.png")} == expected
    assert INDEX["scales"] == list(paper.SCALES)
    for grade, params in paper.GRADES.items():
        assert INDEX["grades"][grade] == {
            "slice": params["corner"],
            "period": params["period"],
            "size": 2 * params["corner"] + params["period"],
        }
    # Only the named colours of the page are used, and a line is never darker than the ink.
    for palette, (paper_name, line_name) in paper.PALETTES.items():
        assert INDEX["palettes"][palette] == {
            "paper": paper.COLOURS[paper_name],
            "line": paper.COLOURS[line_name],
        }
    assert set(paper.COLOURS.values()) == {"#f3f9f1", "#eedeb0", "#392f41", "#758a99"}


@pytest.mark.parametrize("name", FILES)
def test_a_picture_is_square_the_size_of_its_grade_and_twice_that_at_2x(name: str) -> None:
    grade, _palette, scale = parts(name)
    size = INDEX["grades"][grade]["size"] * scale
    width, height, rows = read_png(PAPER / name)
    assert (width, height) == (size, size)
    assert len(rows) == size
    assert (PAPER / name).stat().st_size < 24_000


@pytest.mark.parametrize("name", FILES)
def test_the_middle_is_flat_paper_and_the_outermost_pixels_are_clear(name: str) -> None:
    grade, palette, scale = parts(name)
    width, _height, rows = read_png(PAPER / name)
    colour = hex_rgb(INDEX["palettes"][palette]["paper"])
    mid = width // 2
    # Everything well inside the line is the colour of the paper, to the last bit, and opaque, so
    # that `fill` can stretch the middle over a sheet of any size.
    inner = (INDEX["grades"][grade]["slice"] + 2) * scale
    for y in range(inner, width - inner, 5):
        for x in range(inner, width - inner, 5):
            assert pixel(rows, x, y) == (*colour, 255), (x, y)
    assert pixel(rows, mid, mid) == (*colour, 255)
    # The picture has room round the rough edge: the outermost ring of pixels is clear, so that
    # no band is clipped.
    for i in range(width):
        assert pixel(rows, i, 0)[3] == 0
        assert pixel(rows, i, width - 1)[3] == 0
        assert pixel(rows, 0, i)[3] == 0
        assert pixel(rows, width - 1, i)[3] == 0


@pytest.mark.parametrize("name", FILES)
def test_the_bands_have_no_seam_where_they_meet(name: str) -> None:
    """Laid end to end, the band repeats: the picture one period further along is the same."""
    grade, _palette, scale = parts(name)
    corner, period = (
        INDEX["grades"][grade]["slice"] * scale,
        INDEX["grades"][grade]["period"] * scale,
    )
    _w, _h, rows = read_png(PAPER / name)
    worst = 0
    for y in range(
        corner
    ):  # the top band: the columns at corner and at corner + period are one column
        a, b = pixel(rows, corner, y), pixel(rows, corner + period, y)
        worst = max(worst, *(abs(p - q) for p, q in zip(a, b, strict=True)))
    for x in range(corner):  # the left band: the same, down the rows
        a, b = pixel(rows, x, corner), pixel(rows, x, corner + period)
        worst = max(worst, *(abs(p - q) for p, q in zip(a, b, strict=True)))
    assert worst <= 3, f"the edge does not repeat: the columns differ by {worst} levels"


def test_a_line_is_in_the_ink_of_its_palette() -> None:
    for palette, (_paper, line) in paper.PALETTES.items():
        rows = read_png(PAPER / paper.name_of("page", palette, 2))[2]
        darkest = min(
            (
                pixel(rows, x, y)
                for y in range(len(rows))
                for x in range(len(rows))
                if rows[y][4 * x + 3] == 255
            ),
            key=lambda p: sum(p[:3]),
        )
        ink = hex_rgb(paper.COLOURS[line])
        assert all(abs(a - b) <= 2 for a, b in zip(darkest[:3], ink, strict=True)), (
            palette,
            darkest,
        )


def test_the_picture_is_the_same_every_time() -> None:
    params = paper.GRADES["slip"]
    one = paper.render(params, 1, 1, (243, 249, 241), (57, 47, 65))
    two = paper.render(params, 1, 1, (243, 249, 241), (57, 47, 65))
    assert one == two
    other = paper.render(params, 2, 1, (243, 249, 241), (57, 47, 65))
    assert other != one


def test_the_marks_module_is_what_the_script_writes() -> None:
    written = (REPO / "web" / "src" / "page" / "ui" / "marks.ts").read_text(encoding="utf-8")
    assert marks.render() == written, "run: uv run python tools/ink_ui/marks.py"


def test_the_marks_are_made_the_same_way_every_time() -> None:
    assert marks.marks() == marks.marks()
    seals = marks.marks()["SEALS"]
    assert isinstance(seals, dict)
    assert seals["done"]["wide"]["paths"] != seals["delivered"]["wide"]["paths"]


def test_a_stroke_has_the_widths_it_was_asked_for() -> None:
    outline = brush.stroke(
        [(0, 0), (20, 0)], 1.0, 3.0, 0.5, press=0.2, taper=0.6, jitter=0, wobble=0
    )
    half = len(outline) // 2
    left, right = outline[:half], outline[half:][::-1]
    widths = [abs(a[1] - b[1]) for a, b in zip(left, right, strict=True)]
    assert widths[0] == pytest.approx(1.0)
    assert max(widths) == pytest.approx(3.0)
    assert widths[-1] == pytest.approx(0.5)


def test_simplify_keeps_the_ends_and_the_corners_and_drops_the_points_on_a_line() -> None:
    line = [(float(i), 0.0) for i in range(10)] + [(9.0, 5.0)]
    assert brush.simplify(line, 0.01) == [(0.0, 0.0), (9.0, 0.0), (9.0, 5.0)]
