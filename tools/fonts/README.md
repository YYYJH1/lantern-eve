<p align="center"><b>English</b> · <a href="README_zh.md">简体中文</a></p>

# Fonts

The web client uses LXGW WenKai for body text in both languages and Ma Shan Zheng for titles. The source fonts are 26 MB and 6 MB. To build the client fonts, this tool keeps the characters the game can display and saves each subset as WOFF2 under `web/public/fonts/` alongside its SIL Open Font License 1.1.

| Face | File | Size | Characters |
|---|---|---|---|
| LXGW WenKai Regular | `lxgw-wenkai/LXGWWenKai-Regular.subset.woff2` | about 290 KB | about 1,400 |
| LXGW WenKai Medium | `lxgw-wenkai/LXGWWenKai-Medium.subset.woff2` | about 290 KB | about 1,400 |
| Ma Shan Zheng | `ma-shan-zheng/MaShanZheng-titles.subset.woff2` | about 80 KB | about 270 |

`subsets.json` holds the exact size and character count of each cut.

WenKai Regular is the default weight. Use Medium for emphasis. Ma Shan Zheng covers the game title, the Town Gazette masthead, task names and empty states on slips, job names on the ledger, titles on completion cards, and surname seals in talks and on person cards. The title subset includes any names that appear there, every seal character and printable ASCII.

## The text of the game

`chars.py` collects player-facing text from the compiled content, web message tables, components, stylesheets, `index.html`, the core and the server host. It skips comments, docstrings, regular expressions and language model prompts. For a character the source font lacks, `subsets.json` records it under `unavailable` and the browser uses the next face in the font stack. `tests/test_fonts.py` allows up to six missing characters per face and requires coverage for every Chinese character.

## Fetch the full faces

Download the full source fonts before building. `build.py` verifies each file against its pinned checksum.

```bash
mkdir -p tools/fonts/src
W=https://github.com/lxgw/LxgwWenKai/releases/download/v1.530
curl -fsSL -o tools/fonts/src/LXGWWenKai-Regular.ttf $W/LXGWWenKai-Regular.ttf
curl -fsSL -o tools/fonts/src/LXGWWenKai-Medium.ttf $W/LXGWWenKai-Medium.ttf
curl -fsSL -o tools/fonts/src/LXGWWenKai-OFL.txt https://raw.githubusercontent.com/lxgw/LxgwWenKai/v1.530/OFL.txt
G=https://raw.githubusercontent.com/google/fonts/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/mashanzheng
curl -fsSL -o tools/fonts/src/MaShanZheng-Regular.ttf $G/MaShanZheng-Regular.ttf
curl -fsSL -o tools/fonts/src/MaShanZheng-OFL.txt $G/OFL.txt
```

`src/` is ignored by git.

## Cut and check

```bash
uv run python tools/fonts/build.py --src tools/fonts/src   # cut the faces, write subsets.json
uv run python tools/fonts/build.py --check                 # do the faces on disk have every character now?
```

The `dev` group in `pyproject.toml` includes fontTools with the `woff` extra. Run the check after changing game text. If a new character is missing, rebuild the subsets. `tests/test_fonts.py` checks the same files and `subsets.json` without needing the source fonts.

## Use

```css
@font-face { font-family: "WenKai"; src: url("/fonts/lxgw-wenkai/LXGWWenKai-Regular.subset.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "WenKai"; src: url("/fonts/lxgw-wenkai/LXGWWenKai-Medium.subset.woff2") format("woff2"); font-weight: 500; font-display: swap; }
@font-face { font-family: "Brush"; src: url("/fonts/ma-shan-zheng/MaShanZheng-titles.subset.woff2") format("woff2"); font-weight: 400; font-display: swap; }
```

The subsets preserve the OpenType features used on the Chinese page, including vertical glyphs (`vert`), contextual punctuation spacing (`chws`, `vchw`), half-width punctuation (`halt`, `vhal`), `calt` and `ccmp`. The build drops fractions, superscripts and other stylistic sets. WenKai’s licence allows a web-only subset to keep the family name if it is distributed only as a web font.

## Outlines for shapes

`glyph_paths.py` exports selected Ma Shan Zheng glyph outlines as SVG paths in the font’s em square. The sprite kit uses the paths for the notebook label and the elder’s seal (`tools/sprite-kit/src/page/glyphs.js`). The ink UI uses them for its seals. Both can render those characters without loading the font.
