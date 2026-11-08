<p align="center"><b>English</b> · <a href="README_zh.md">简体中文</a></p>

# Fonts

The page sets its text in LXGW WenKai, a Kai face with Latin letters in the same family, and its titles in Ma Shan Zheng, a brush face. The full faces weigh 26 MB and 6 MB. The page does not load them. This tool cuts them down to the characters that the game can show and writes the cuts as WOFF2 into `web/public/fonts/`, each beside its licence (SIL Open Font License 1.1).

| Face | File | Size | Characters |
|---|---|---|---|
| LXGW WenKai Regular | `lxgw-wenkai/LXGWWenKai-Regular.subset.woff2` | about 310 KB | about 1,500 |
| LXGW WenKai Medium | `lxgw-wenkai/LXGWWenKai-Medium.subset.woff2` | about 310 KB | about 1,500 |
| Ma Shan Zheng | `ma-shan-zheng/MaShanZheng-titles.subset.woff2` | about 80 KB | about 280 |

`subsets.json` holds the exact size and character count of each cut.

The two WenKai faces are for the body of the page: Regular for the text and Medium for what stands out. Ma Shan Zheng is for the titles only: the name of the game, the masthead of the Town Gazette, the names of the tasks on the slips (and what a slip says while there is no task), the names of the jobs on the ledger, the titles of the cards that say a job is done, and the seal of a surname at the corner of the talk. It has the characters of those words, the names of the people in them, the character of every seal and the printable ASCII.

## The text of the game

`chars.py` reads every place where text for the player lives: the compiled content, the strings of the page (the message tables, the components, the style sheets and `index.html`), and the strings of the core and of the server host. It leaves out comments, docstrings, the patterns of regular expressions and the prompts for the language models. The result is a little more than what is shown, and never less. A character that a full face lacks is listed under `unavailable` in `subsets.json` and drawn by the next face of the font stack. `tests/test_fonts.py` allows at most six of them for each face, and none may be a Chinese character.

## Fetch the full faces

The faces are not in the repository. The cut checks every file against the hash pinned in `build.py`, so a different version is refused.

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

The cut needs fontTools with the `woff` extra, which is in the dev group of `pyproject.toml`. `tests/test_fonts.py` asks the same question with the same code. A change to a text that needs a new character fails it, and then the cut has to be run again. The tests read the faces on disk and `subsets.json`, so they need no full face.

## Use

```css
@font-face { font-family: "WenKai"; src: url("/fonts/lxgw-wenkai/LXGWWenKai-Regular.subset.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "WenKai"; src: url("/fonts/lxgw-wenkai/LXGWWenKai-Medium.subset.woff2") format("woff2"); font-weight: 500; font-display: swap; }
@font-face { font-family: "Brush"; src: url("/fonts/ma-shan-zheng/MaShanZheng-titles.subset.woff2") format("woff2"); font-weight: 400; font-display: swap; }
```

The cut keeps the vertical forms of the glyphs (`vert`) for text set downwards, the contextual spacing of punctuation (`chws`) and the half width forms (`halt`, `vhal`). The licence of WenKai lets a subset keep the family name when it is made for the web only and is not offered as an installable font.

## Outlines for shapes

`glyph_paths.py` writes the outline of a few characters of Ma Shan Zheng as SVG path data, in the em square of the font. The sprite kit uses it for the character on the elder's seal and for the label of the notebook (`tools/sprite-kit/src/page/glyphs.js`), and `tools/ink_ui` for the seals of the brush marks, so that drawing them needs no font.
