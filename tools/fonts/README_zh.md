<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# 字体

页面的正文用霞鹜文楷（LXGW WenKai）。这是一款楷体，拉丁字母也在同一个字族里。标题用马善政（Ma Shan Zheng），一款毛笔字。两款字体的完整文件分别有 26 MB 和 6 MB，页面不加载它们。这个工具把它们裁到只剩游戏可能显示的字，写成 WOFF2 放进 `web/public/fonts/`，每款字体旁边都放着它的许可证（SIL 开源字体许可证 1.1）。

| 字体 | 文件 | 大小 | 字数 |
|---|---|---|---|
| 霞鹜文楷 常规 | `lxgw-wenkai/LXGWWenKai-Regular.subset.woff2` | 约 290 KB | 约 1,400 |
| 霞鹜文楷 中粗 | `lxgw-wenkai/LXGWWenKai-Medium.subset.woff2` | 约 290 KB | 约 1,400 |
| 马善政 | `ma-shan-zheng/MaShanZheng-titles.subset.woff2` | 约 80 KB | 约 270 |

每次裁出的确切大小和字数记在 `subsets.json` 里。

正文用文楷的常规和中粗两个字重。一般的字用常规，要突出的字用中粗。马善政只用在标题上，包括游戏名、《镇报》的报头、签上的事项名（没有事项时签上写的话也算）、账簿上各件事的名字、一件事办成时那张卡片的标题，以及谈话角上和人物卡上的姓氏印。马善政的子集里有这些词用到的字、词里提到的人名、每枚印上的字，以及可打印的 ASCII 字符。

## 游戏里的文字

`chars.py` 会把给玩家看的文字所在的地方都读一遍，包括编译后的内容，页面的字符串（消息表、各个组件、样式表和 `index.html`），以及核心和服务端宿主的字符串。注释、文档字符串、正则表达式和给语言模型的提示词都不算。这样读出来的字只会比实际显示的多一点，不会少。完整字体里没有的字，列在 `subsets.json` 的 `unavailable` 里，由字体栈里排在后面的字体来画。`tests/test_fonts.py` 规定每款字体最多只能有六个这样的字，而且不能有汉字。

## 取得完整字体

仓库里没有完整字体。裁剪时会拿 `build.py` 里写定的哈希逐个核对文件，版本不对就拒绝。

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

`src/` 不进 git。

## 裁剪与检查

```bash
uv run python tools/fonts/build.py --src tools/fonts/src   # 裁剪字体，写出 subsets.json
uv run python tools/fonts/build.py --check                 # 磁盘上的字体，是不是已经有了现在要用的每一个字？
```

裁剪要用带 `woff` 扩展的 fontTools，它在 `pyproject.toml` 的 dev 组里。`tests/test_fonts.py` 用同一份代码问同一个问题。哪里的文字改了，用到了新字，这个测试就会失败，这时要重新裁一次。测试读的是磁盘上裁好的字体和 `subsets.json`，用不着完整字体。

## 使用

```css
@font-face { font-family: "WenKai"; src: url("/fonts/lxgw-wenkai/LXGWWenKai-Regular.subset.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "WenKai"; src: url("/fonts/lxgw-wenkai/LXGWWenKai-Medium.subset.woff2") format("woff2"); font-weight: 500; font-display: swap; }
@font-face { font-family: "Brush"; src: url("/fonts/ma-shan-zheng/MaShanZheng-titles.subset.woff2") format("woff2"); font-weight: 400; font-display: swap; }
```

裁剪时留下了中文页面要用的几项 OpenType 特性，有竖排用的竖排字形（`vert`），标点的上下文间距（`chws`、`vchw`），标点的半角字形（`halt`、`vhal`），还有 `calt` 和 `ccmp`。分数、上标和别的风格集都去掉了。文楷的许可证允许只给网页用的子集沿用字族名，条件是不把它当成可安装的字体提供。

## 用作图形的字形轮廓

`glyph_paths.py` 把马善政里几个字的轮廓写成 SVG 路径数据，坐标用的是字体的 em 方格。精灵工具包拿它画族长印上的字和见闻簿的签条（`tools/sprite-kit/src/page/glyphs.js`），`tools/ink_ui` 拿它画笔画记号里的印。这样画这些东西时，就用不着字体了。
