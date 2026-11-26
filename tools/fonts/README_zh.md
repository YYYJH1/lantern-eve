<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# 字体

网页正文使用霞鹜文楷（LXGW WenKai），中英文共用这套字。标题使用马善政（Ma Shan Zheng）。两款源字体分别为 26 MB 和 6 MB。构建时，脚本收集游戏会显示的字，把子集保存为 WOFF2，连同 SIL 开源字体许可证 1.1 放进 `web/public/fonts/`。

| 字体 | 文件 | 大小 | 字数 |
|---|---|---|---|
| 霞鹜文楷 常规 | `lxgw-wenkai/LXGWWenKai-Regular.subset.woff2` | 约 290 KB | 约 1,400 |
| 霞鹜文楷 中粗 | `lxgw-wenkai/LXGWWenKai-Medium.subset.woff2` | 约 290 KB | 约 1,400 |
| 马善政 | `ma-shan-zheng/MaShanZheng-titles.subset.woff2` | 约 80 KB | 约 270 |

每次裁出的确切大小和字数记在 `subsets.json` 里。

正文默认用文楷常规，强调处用中粗。马善政用于游戏名、《镇报》报头、红签上的任务名和空状态、账簿事项名、办妥卡的标题，以及谈话和人物卡上的姓氏印。标题子集收进这些地方出现的人名、印上的字和可打印的 ASCII 字符。

## 游戏里的文字

`chars.py` 从编译后的内容、网页消息表、组件、样式表、`index.html`、核心和服务端宿主收集玩家可见的字。注释、文档字符串、正则表达式和模型提示词会跳过。源字体里缺的字列在 `subsets.json` 的 `unavailable` 下，由字体栈里的下一款字体显示。`tests/test_fonts.py` 允许每款缺至多六个字符，同时要求覆盖所有用到的汉字。

## 取得完整字体

先下载完整的源字体。`build.py` 会用固定的校验值检查每个文件。

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

`pyproject.toml` 的 `dev` 组含有带 `woff` 扩展的 fontTools。改完游戏文字后运行检查。遇到新字缺失，就重新裁剪。`tests/test_fonts.py` 核对已生成的字体和 `subsets.json`，无需完整源字体。

## 使用

```css
@font-face { font-family: "WenKai"; src: url("/fonts/lxgw-wenkai/LXGWWenKai-Regular.subset.woff2") format("woff2"); font-weight: 400; font-display: swap; }
@font-face { font-family: "WenKai"; src: url("/fonts/lxgw-wenkai/LXGWWenKai-Medium.subset.woff2") format("woff2"); font-weight: 500; font-display: swap; }
@font-face { font-family: "Brush"; src: url("/fonts/ma-shan-zheng/MaShanZheng-titles.subset.woff2") format("woff2"); font-weight: 400; font-display: swap; }
```

字体子集保留中文排版用到的 OpenType 特性，包括竖排字形（`vert`）、标点的上下文间距（`chws`、`vchw`）、半角标点（`halt`、`vhal`）以及 `calt` 和 `ccmp`。裁剪会去掉分数、上标和其他风格集。按照文楷许可证，仅以网页字体形式分发的子集可以沿用原字族名。

## 用作图形的字形轮廓

`glyph_paths.py` 把选定的马善政字形导出成以 em 方格计的 SVG 路径。精灵工具包用它画见闻簿签条和族长印（`tools/sprite-kit/src/page/glyphs.js`），水墨界面用它画印记。这些图形可以直接渲染。
