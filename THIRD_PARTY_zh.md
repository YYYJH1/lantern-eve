<p align="center"><a href="THIRD_PARTY.md">English</a> · <b>简体中文</b></p>

# 第三方组件

游戏本身采用 MIT 许可证（见 `LICENSE`）。构建出的站点 https://yyyjh1.github.io/lantern-eve/ 还带有下列组件，各自遵循自己的许可证。站点把它们的许可证文本放在 `licenses/`（npm 包、Pyodide 和 Python）以及每个字体旁边（`OFL.txt`）。小镇的图片和纸边由本仓库自己的工具（`tools/sprite-kit`、`tools/ink_ui`）绘制。

## 页面的脚本

| 包 | 版本 | 许可证 | 用途 | 来源 |
|---|---|---|---|---|
| PixiJS（`pixi.js`） | 8.22.0 | MIT | 绘制小镇地图 | https://github.com/pixijs/pixijs |
| Preact（`preact`） | 11.1.1 | MIT | 地图周围的界面 | https://github.com/preactjs/preact |
| `@pixi/colord` | 2.9.6 | MIT | PixiJS 内部的颜色转换 | https://github.com/omgovich/colord |
| `earcut` | 3.2.4 | ISC | PixiJS 内部的多边形三角剖分 | https://github.com/mapbox/earcut |
| `eventemitter3` | 5.0.4 | MIT | PixiJS 内部的事件 | https://github.com/primus/eventemitter3 |
| `ismobilejs` | 1.1.1 | MIT | PixiJS 内部的设备检测 | https://github.com/kaimallea/isMobile |
| `parse-svg-path` | 0.2.0 | MIT | PixiJS 内部读取 SVG 路径 | https://github.com/jkroso/parse-svg-path |
| `tiny-lru` | 11.4.7 | BSD-3-Clause | PixiJS 内部的缓存 | https://github.com/avoidwork/tiny-lru |
| `gifuct-js` | 2.1.2 | MIT | PixiJS 可用的 GIF 解码器，不在脚本里 | https://github.com/matt-way/gifuct-js |
| `js-binary-schema-parser` | 2.0.3 | MIT | 由 `gifuct-js` 使用，不在脚本里 | https://github.com/matt-way/jsBinarySchemaParser |
| `@xmldom/xmldom` | 0.8.15 | MIT | PixiJS 可用的 XML 解析器，不在脚本里 | https://github.com/xmldom/xmldom |
| `@types/earcut` | 3.0.0 | MIT | 只有类型声明，不在脚本里 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/earcut |
| `@webgpu/types` | 0.1.74 | BSD-3-Clause | 只有类型声明，不在脚本里 | https://github.com/gpuweb/types |

版本与 `web/package-lock.json` 里锁定的一致。页面依赖的某个包不在本表里，或者版本对不上，`tests/test_third_party.py` 就会失败。标为「不在脚本里」的五个包随 PixiJS 一起安装，但不会打包进页面脚本，它们的许可证文本照样放在 `licenses/npm/`。Vite（MIT）的模块预加载辅助代码有几行在主脚本里，其余构建工具都不属于站点。

## Python 运行时

游戏的核心是 Python。在浏览器里它跑在 worker 中的 Pyodide 上，页面除了解释器和核心的 wheel（本仓库自己的代码）之外不加载任何 Pyodide 包。

| 组件 | 版本 | 许可证 | 用途 | 来源 |
|---|---|---|---|---|
| Pyodide（`pyodide`） | 314.0.7 | MPL-2.0 | 在浏览器里运行 Python，站点 `pyodide/` 里的文件原样取自该 npm 包 | https://github.com/pyodide/pyodide |
| CPython | 3.14.2 | PSF-2.0 | Pyodide 里的解释器和标准库 | https://github.com/python/cpython |

二进制文件 `pyodide.asm.wasm` 里还有 Python 标准模块背后的 C 库，包括 zlib 1.3.1、expat 2.7.3、libmpdec、bzip2、XZ Utils、Zstandard、SQLite 和 HACL*，以及 Emscripten 5.0.3 的运行时。它们分别采用 MIT、BSD、zlib、Apache-2.0、NCSA 和公有领域条款。相应的声明在 Pyodide 和 CPython 的源码里，Python 文档在「Licenses and Acknowledgements」一节列出了所含的软件。

## 字体

| 组件 | 版本 | 许可证 | 用途 | 来源 |
|---|---|---|---|---|
| 霞鹜文楷（LXGW WenKai），常规和中粗两个字重 | 1.530 | OFL-1.1 | 页面两种语言的正文 | https://github.com/lxgw/LxgwWenKai |
| 马善政（Ma Shan Zheng） | Google Fonts 提交 6c1dbe2 | OFL-1.1 | 标题 | https://github.com/google/fonts/tree/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/mashanzheng |

`tools/fonts` 把两套字体裁到游戏用得到的字符，只输出供网页使用的 WOFF2 文件。文楷许可证的附加许可要求，保留字体族名的子集不能作为可安装字体提供，所以这些文件只给网页用。文楷基于 Klee One（OFL-1.1，https://github.com/fontworks-fonts/Klee），它的许可证文件同时写明了两个项目。几个马善政字符的轮廓还被当作图形画进了族长印、见闻簿的签条和毛笔笔画记号里的印。

## 许可证文本在哪里

- 站点里的 `licenses/npm/index.txt` 列出各 npm 包及其许可证文件。在仓库里，`npm run assets` 会从 `node_modules` 把它们写进 `web/public/licenses/npm/`。
- `web/public/licenses/pyodide-MPL-2.0.txt` 和 `web/public/licenses/cpython-PSF.txt` 是 Pyodide 和 Python 的文本。
- `web/public/fonts/lxgw-wenkai/OFL.txt` 和 `web/public/fonts/ma-shan-zheng/OFL.txt` 是两个字体的许可证。
