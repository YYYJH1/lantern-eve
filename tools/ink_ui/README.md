<p align="center"><b>English</b> · <a href="README_zh.md">简体中文</a></p>

# Ink UI

Two kinds of material for the ink-and-paper look of the page are drawn by script here and not by hand: the rough edge of a sheet of paper, as nine-slice pictures, and the marks of a brush (a tick, a circle, strokes that count, a seal), as path data. Both use the standard library only.

```bash
uv run python tools/ink_ui/paper.py     # web/public/ui/paper/: the edges and index.json
uv run python tools/ink_ui/marks.py     # web/src/page/ui/marks.ts (--check: fail if it is not up to date)
```

## Paper edges

A sheet of paper has a hand-cut edge and a line of ink a little inside it. The page does not make that at run time, because a filter on a large sheet is slow. `paper.py` draws it once, at 1x and 2x, in the colours of the page: off-white (荼白, #f3f9f1) paper with a black (乌黑, #392f41) or ink-grey (墨灰, #758a99) line by day, and ivory (牙色, #eedeb0) paper with an ink-grey line under a lamp. There are two grades. A slip is for small things (a slip, a tag, a plaque) and a page for large ones (a ledger, a notebook).

| Grade | Slice | Band | File at 1x | File at 2x |
|---|---|---|---|---|
| slip | 12 | 64 | 88 by 88 px, about 3 KB | 176 by 176 px, about 6 KB |
| page | 20 | 160 | 200 by 200 px, about 7 KB | 400 by 400 px, about 17 KB |

The files are `<grade>-<palette>-<scale>x.png` with the palettes `day-ink`, `day-grey` and `night`. The picture is a square: four corners of the slice, and between them four bands one `Band` long. The edge in a band is a periodic function of the distance along it, so bands laid end to end show no seam, and the middle is flat paper that `fill` can stretch over a sheet of any size. The 2x picture is the same edge drawn again at twice the size, not the 1x one enlarged. `index.json` lists the slices, the colours and the files.

```css
.sheet { border-image: url("/ui/paper/page-day-ink-1x.png") 20 fill / 20px round; }
@media (min-resolution: 2dppx) {
  .sheet { border-image-source: url("/ui/paper/page-day-ink-2x.png"); border-image-slice: 40 fill; }
}
```

The slice of the 2x picture is twice that of the 1x one, and the width of the border stays the same in pixels of the page. A paper grain, if a page wants one, is a background of its own.

## Brush marks

`marks.py` writes `web/src/page/ui/marks.ts`. Every mark is filled outlines with uneven widths: pressed at the start, heavy in the middle, thinning at the end, with a slow wobble. They are data and not pictures, so that the page chooses the colour (ink, rouge, the lamp) and nothing is fetched.

| Export | What it is |
|---|---|
| `TICKS` | the tick of a line that is done, three of them |
| `CIRCLES` | `round`, `wide` and `long`: a circle drawn by hand round a word or a phrase |
| `STRIKES`, `STRIKE_LINES` | a short stroke that strikes a number out, and a long one that strikes a line through |
| `TALLY`, `tally(n)`, `tallies(n)` | the strokes of 正 in the order they are written, one to five, and the tally of any number |
| `UNDERLINES` | the underline of a word to act on |
| `SEALS` | the seals `done` (办妥) and `delivered` (送到), each `wide` and `square`; one path to fill with the even-odd rule |
| `RULES`, `VERTICAL_RULES` | level and plumb ruled lines for a ledger |
| `GLYPHS` | `pause`, `play` and `menu` for the top right |
| `pick(variants, key)` | the same variant for the same key every time |

A mark has a box, `w` by `h`, and `paths` to fill with `currentColor`. A stroke, a rule or an underline that must be longer or shorter than its box is drawn in an `<svg preserveAspectRatio="none">` of the length it needs and the height of its box.

```tsx
import type { Mark } from "./marks.ts";

const Brush = ({ mark, width, height, stretch }: { mark: Mark; width?: number; height?: number; stretch?: boolean }) => (
  <svg viewBox={`0 0 ${mark.w} ${mark.h}`} width={width ?? mark.w} height={height ?? mark.h} fill="currentColor"
       fill-rule={mark.evenodd ? "evenodd" : undefined} preserveAspectRatio={stretch ? "none" : undefined} aria-hidden="true">
    {mark.paths.map((d) => <path d={d} />)}
  </svg>
);
```

The seals carry the outlines of their characters from Ma Shan Zheng (`seal_glyphs.json`, made by `tools/fonts/glyph_paths.py`), so that drawing a seal needs no font. A seal is a block of ink with a thin frame and the characters cut out of it, a few specks left out as a stamp pressed by hand leaves them, and a slight tilt. Fill it with the rouge by day and the lamp red at night.
