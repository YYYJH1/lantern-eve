<p align="center"><a href="THIRD_PARTY.md">English</a> · <b>简体中文</b></p>

# 第三方组件

游戏本身用 MIT 许可证（见 `LICENSE`）。构建出的站点 https://yyyjh1.github.io/lantern-eve/ 还带着下面这些组件，各用各的许可证。站点把 npm 包、Pyodide 和 Python 的许可证文本放在 `licenses/` 里，字体的许可证放在各自字体旁边（`OFL.txt`）。小镇的图和纸边是本仓库自己的工具画的（`tools/sprite-kit`、`tools/ink_ui`）。声音是页面自己用 Web Audio 合成的，站点里没有任何录音。

## 页面的脚本

| 包 | 版本 | 许可证 | 用途 | 来源 |
|---|---|---|---|---|
| PixiJS（`pixi.js`） | 8.22.0 | MIT | 画小镇的地图 | https://github.com/pixijs/pixijs |
| Preact（`preact`） | 11.1.1 | MIT | 地图周围的界面 | https://github.com/preactjs/preact |
| `@pixi/colord` | 2.9.6 | MIT | PixiJS 里做颜色换算 | https://github.com/omgovich/colord |
| `earcut` | 3.2.4 | ISC | PixiJS 里把多边形剖成三角形 | https://github.com/mapbox/earcut |
| `eventemitter3` | 5.0.4 | MIT | PixiJS 里的事件 | https://github.com/primus/eventemitter3 |
| `ismobilejs` | 1.1.1 | MIT | PixiJS 里判断是什么设备 | https://github.com/kaimallea/isMobile |
| `parse-svg-path` | 0.2.0 | MIT | PixiJS 里读 SVG 路径 | https://github.com/jkroso/parse-svg-path |
| `tiny-lru` | 11.4.7 | BSD-3-Clause | PixiJS 里的一个缓存 | https://github.com/avoidwork/tiny-lru |
| `gifuct-js` | 2.1.2 | MIT | PixiJS 可以用的 GIF 解码器，不在脚本里 | https://github.com/matt-way/gifuct-js |
| `js-binary-schema-parser` | 2.0.3 | MIT | `gifuct-js` 要用它，不在脚本里 | https://github.com/matt-way/jsBinarySchemaParser |
| `@xmldom/xmldom` | 0.8.15 | MIT | PixiJS 可以用的 XML 解析器，不在脚本里 | https://github.com/xmldom/xmldom |
| `@types/earcut` | 3.0.0 | MIT | 只有类型声明，不在脚本里 | https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/earcut |
| `@webgpu/types` | 0.1.74 | BSD-3-Clause | 只有类型声明，不在脚本里 | https://github.com/gpuweb/types |

版本就是 `web/package-lock.json` 里锁定的版本。页面依赖的包要是不在这张表里，或者版本对不上，`tests/test_third_party.py` 就会失败。标着「不在脚本里」的五个包，是跟着 PixiJS 一起装上的，没有打进页面的脚本，它们的许可证文本照样放在 `licenses/npm/` 里。主脚本里有几行 Vite（MIT）的模块预加载代码，别的构建工具都不在站点里。

## Python 运行时

游戏的核心是 Python 写的。在浏览器里，它跑在 worker 中的 Pyodide 上。页面只加载解释器和核心的 wheel，不加载别的 Pyodide 包，核心的 wheel 是本仓库自己的代码。

| 组件 | 版本 | 许可证 | 用途 | 来源 |
|---|---|---|---|---|
| Pyodide（`pyodide`） | 314.0.7 | MPL-2.0 | 在浏览器里跑 Python。站点 `pyodide/` 里的文件原样取自这个 npm 包 | https://github.com/pyodide/pyodide |
| CPython | 3.14.2 | PSF-2.0 | Pyodide 里的解释器和标准库 | https://github.com/python/cpython |

二进制文件 `pyodide.asm.wasm` 里还有 Python 标准模块背后的 C 库，包括 zlib 1.3.1、expat 2.7.3、libmpdec、bzip2、XZ Utils、Zstandard、SQLite 和 HACL*，以及 Emscripten 5.0.3 的运行时。它们用的是 MIT、BSD、zlib、Apache-2.0、NCSA 和公有领域的条款。相应的声明写在 Pyodide 和 CPython 的源码里，Python 文档的「Licenses and Acknowledgements」一节也列着这些收进来的软件。

## 字体

| 组件 | 版本 | 许可证 | 用途 | 来源 |
|---|---|---|---|---|
| 霞鹜文楷（LXGW WenKai），常规和中粗两个字重 | 1.530 | OFL-1.1 | 页面上两种语言的正文 | https://github.com/lxgw/LxgwWenKai |
| 马善政（Ma Shan Zheng） | Google Fonts 提交 6c1dbe2 | OFL-1.1 | 标题 | https://github.com/google/fonts/tree/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl/mashanzheng |

`tools/fonts` 把两款字体裁到只剩游戏用得到的字，只写出给网页用的 WOFF2 文件，不当作可安装的字体提供。文楷的许可证有一条附加许可，保留字族名的子集就得这样做。文楷是从 Klee One（OFL-1.1，https://github.com/fontworks-fonts/Klee）改出来的，它的许可证文件把两个项目都写上了。另外有几个马善政的字，轮廓被当作图形画进了族长印、见闻簿的签条和笔画记号里的印。

## 许可证文本在哪里

- 站点里的 `licenses/npm/index.txt` 列出各个 npm 包和它们的许可证文件。在仓库里，`npm run assets` 从 `node_modules` 把这些文件写进 `web/public/licenses/npm/`。
- `web/public/licenses/pyodide-MPL-2.0.txt` 和 `web/public/licenses/cpython-PSF.txt` 是 Pyodide 和 Python 的许可证文本。
- `web/public/fonts/lxgw-wenkai/OFL.txt` 和 `web/public/fonts/ma-shan-zheng/OFL.txt` 是两款字体的许可证。
