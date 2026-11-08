<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# 字体

页面的正文用霞鹜文楷（LXGW WenKai，楷体，拉丁字母和汉字同属一个字族），标题用马善政（Ma Shan Zheng，毛笔楷）。完整的字体分别有 26 MB 和 6 MB，页面不会去加载它们。这个工具把它们裁成游戏里可能出现的字，写成 WOFF2 放进 `web/public/fonts/`，每个字体旁边附着它的许可证（SIL 开源字体许可证 1.1）。

| 字体 | 文件 | 大小 | 字数 |
|---|---|---|---|
| 霞鹜文楷 常规 | `lxgw-wenkai/LXGWWenKai-Regular.subset.woff2` | 约 310 KB | 约 1,500 |
| 霞鹜文楷 中粗 | `lxgw-wenkai/LXGWWenKai-Medium.subset.woff2` | 约 310 KB | 约 1,500 |
| 马善政 | `ma-shan-zheng/MaShanZheng-titles.subset.woff2` | 约 80 KB | 约 280 |

每次裁剪的确切大小和字数记在 `subsets.json` 里。

文楷的两个字重用于页面的正文：常规字重排文字，中粗用于要突出的地方。马善政只用于标题：游戏名、《镇报》的报头、签上的事项名（没有事项时签上写的话也算）、账簿上的事由名，说明一件事办妥了的卡片标题，以及谈话条角上的姓氏印。它带有这些词里的字、其中人物的名字、每枚印上的字，以及可打印的 ASCII。

## 游戏里的文字

`chars.py` 读取所有给玩家看的文字所在的地方：编译后的内容、页面的字符串（消息表、各个组件、样式表和 `index.html`），以及核心和服务端宿主的字符串。注释、文档字符串、正则表达式的模式和给语言模型的提示词不算在内。结果比实际显示的略多，绝不会少。完整字体里没有的字列在 `subsets.json` 的 `unavailable` 里，由字体栈里的下一个字体来画。`tests/test_fonts.py` 每个字体最多允许六个这样的字，而且不能是汉字。

## 取得完整字体

字体不在仓库里。裁剪时会逐个文件核对 `build.py` 里固定的哈希，换了版本就拒绝。

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

`src/` 被 git 忽略。

## 裁剪与检查

```bash
uv run python tools/fonts/build.py --src tools/fonts/src   # 裁剪字体，写出 subsets.json
uv run python tools/fonts/build.py --check                 # 磁盘上的字体有没有现在的每一个字？
```

裁剪需要带 `woff` 扩展的 fontTools，它在 `pyproject.toml` 的 dev 组里。`tests/test_fonts.py` 用同一份代码问同一个问题。某处文字改动用到了新字，这个测试就会失败，这时重新运行一次裁剪。测试读的是磁盘上的字体和 `subsets.json`，不需要完整字体。

## 使用

```css
@font-face { font-family: "WenKai"; src: url("/fonts/lxgw-wenkai/LXGWWenKai-Regular.subset.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "WenKai"; src: url("/fonts/lxgw-wenkai/LXGWWenKai-Medium.subset.woff2") format("woff2"); font-weight: 500; font-display: swap; }
@font-face { font-family: "Brush"; src: url("/fonts/ma-shan-zheng/MaShanZheng-titles.subset.woff2") format("woff2"); font-weight: 400; font-display: swap; }
```

裁剪保留了竖排文字用的竖排字形（`vert`）、标点的上下文间距（`chws`）和半角字形（`halt`、`vhal`）。文楷的许可证允许仅为网页分发而裁出的子集沿用字族名，条件是不把它作为可安装字体提供。

## 用作图形的字形轮廓

`glyph_paths.py` 把马善政里几个字的轮廓写成 SVG 路径数据，坐标在字体的 em 方格里。精灵工具包用它画族长印上的字和见闻簿的签条（`tools/sprite-kit/src/page/glyphs.js`），`tools/ink_ui` 用它画笔画记号里的印，这样画它们的时候不需要任何字体。
