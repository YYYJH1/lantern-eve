<p align="center"><b>English</b> · <a href="THIRD_PARTY_zh.md">简体中文</a></p>

# Third-party components

The game is under the MIT licence (`LICENSE`). The built site at https://yyyjh1.github.io/lantern-eve/ also carries the components below, each under its own licence. The site holds their licence texts in `licenses/` (the npm packages, Pyodide and Python) and beside each font (`OFL.txt`). The pictures of the town and the paper edges are drawn by this repository's own tools (`tools/sprite-kit`, `tools/ink_ui`).

## Scripts of the page

| Package | Version | Licence | Used for | Source |
|---|---|---|---|---|
| PixiJS (`pixi.js`) | 8.22.0 | MIT | drawing the map of the town | https://github.com/pixijs/pixijs |
| Preact (`preact`) | 11.1.1 | MIT | the interface around the map | https://github.com/preactjs/preact |
| `@pixi/colord` | 2.9.6 | MIT | colour conversion inside PixiJS | https://github.com/omgovich/colord |
| `earcut` | 3.2.4 | ISC | polygon triangulation inside PixiJS | https://github.com/mapbox/earcut |
| `eventemitter3` | 5.0.4 | MIT | events inside PixiJS | https://github.com/primus/eventemitter3 |
| `ismobilejs` | 1.1.1 | MIT | device detection inside PixiJS | https://github.com/kaimallea/isMobile |
| `parse-svg-path` | 0.2.0 | MIT | reading SVG paths inside PixiJS | https://github.com/jkroso/parse-svg-path |
| `tiny-lru` | 11.4.7 | BSD-3-Clause | a cache inside PixiJS | https://github.com/avoidwork/tiny-lru |
| `gifuct-js` | 2.1.2 | MIT | a GIF decoder that PixiJS can use, not in the scripts | https://github.com/matt-way/gifuct-js |
| `js-binary-schema-parser` | 2.0.3 | MIT | used by `gifuct-js`, not in the scripts | https://github.com/matt-way/jsBinarySchemaParser |
| `@xmldom/xmldom` | 0.8.15 | MIT | an XML parser that PixiJS can use, not in the scripts | https://github.com/xmldom/xmldom |
| `@types/earcut` | 3.0.0 | MIT | types only, not in the scripts | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/earcut |
| `@webgpu/types` | 0.1.74 | BSD-3-Clause | types only, not in the scripts | https://github.com/gpuweb/types |

The versions are the ones pinned in `web/package-lock.json`, and `tests/test_third_party.py` fails when a package that the page depends on is missing from this table or listed with another version. The five packages marked as not in the scripts are installed with PixiJS and left out of the bundle, and their licence texts are in `licenses/npm/` all the same. A few lines of the module preload helper of Vite (MIT) are in the main script, and the other build tools are not part of the site.

## Python runtime

The core of the game is Python. In the browser it runs on Pyodide in a worker, and the page loads no Pyodide package besides the interpreter and the wheel of the core, which is this repository's own code.

| Component | Version | Licence | Used for | Source |
|---|---|---|---|---|
| Pyodide (`pyodide`) | 314.0.7 | MPL-2.0 | runs Python in the browser, with its files in `pyodide/` of the site copied unchanged from the npm package | https://github.com/pyodide/pyodide |
| CPython | 3.14.2 | PSF-2.0 | the interpreter and the standard library inside Pyodide | https://github.com/python/cpython |

The binary `pyodide.asm.wasm` also holds the C libraries behind the standard modules of Python, among them zlib 1.3.1, expat 2.7.3, libmpdec, bzip2, XZ Utils, Zstandard, SQLite and HACL*, and the runtime of Emscripten 5.0.3. They are under MIT, BSD, zlib, Apache-2.0, NCSA and public-domain terms. Their notices are in the sources of Pyodide and CPython, and the Python documentation lists the incorporated software under Licenses and Acknowledgements.

## Fonts

| Component | Version | Licence | Used for | Source |
|---|---|---|---|---|
| LXGW WenKai, Regular and Medium | 1.530 | OFL-1.1 | the text of the page in both languages | https://github.com/lxgw/LxgwWenKai |
| Ma Shan Zheng | Google Fonts commit 6c1dbe2 | OFL-1.1 | the titles | https://github.com/google/fonts/tree/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/mashanzheng |

`tools/fonts` cuts both faces down to the characters of the game and writes WOFF2 files for the web only. They are not offered as installable fonts, which is what the additional permission in the WenKai licence asks of a subset that keeps the family name. WenKai is based on Klee One (OFL-1.1, https://github.com/fontworks-fonts/Klee), and its licence file names both projects. The outlines of a few Ma Shan Zheng characters are also drawn as shapes into the seal of the clan elder, the label of the notebook and the seals of the brush marks.

## Where the texts are

- `licenses/npm/index.txt` in the site lists the npm packages with their licence files. In the repository `npm run assets` writes them into `web/public/licenses/npm/` from `node_modules`.
- `web/public/licenses/pyodide-MPL-2.0.txt` and `web/public/licenses/cpython-PSF.txt` hold the texts for Pyodide and Python.
- `web/public/fonts/lxgw-wenkai/OFL.txt` and `web/public/fonts/ma-shan-zheng/OFL.txt` hold the font licences.
