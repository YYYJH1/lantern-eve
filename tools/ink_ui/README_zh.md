<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# 水墨界面

水墨纸面这套画风有两类材料，是用脚本画出来的，不是在编辑器里手画：一张纸毛糙的边（九宫格图片），以及毛笔的笔画记号（勾、圈、计数的笔画和印的路径数据）。两者都只用标准库。

```bash
uv run python tools/ink_ui/paper.py     # web/public/ui/paper/：各张边框图和 index.json
uv run python tools/ink_ui/marks.py     # web/src/page/ui/marks.ts（--check：不是最新就失败）
```

## 纸边

一张纸有手裁的毛边，边里面一点是一道墨线。页面不在运行时做这个，因为大张纸上套滤镜很慢。`paper.py` 一次画好，1 倍和 2 倍各一套，用页面的颜色：白天是荼白（#f3f9f1）的纸配乌黑（#392f41）线或墨灰（#758a99）线，灯下是牙色（#eedeb0）的纸配墨灰线。分两档：签用在小东西上（纸签、标牌、匾），页用在大东西上（账簿、见闻簿）。

| 档 | 切片 | 条带 | 1 倍文件 | 2 倍文件 |
|---|---|---|---|---|
| 签 | 12 | 64 | 88×88 像素，约 3 KB | 176×176 像素，约 6 KB |
| 页 | 20 | 160 | 200×200 像素，约 7 KB | 400×400 像素，约 17 KB |

文件名是 `<档>-<配色>-<倍率>x.png`，配色有 `day-ink`、`day-grey` 和 `night`。图片是一个正方形：四个切片大小的角，角与角之间是四段一个「条带」长的边。条带里的边是沿边距离的周期函数，所以条带首尾相接没有接缝；中间是平的纸色，`fill` 可以把它拉到任意大小的纸面上。2 倍图是同一条边按两倍大小重新画的，不是把 1 倍图放大。`index.json` 列出切片、颜色和文件。

```css
.sheet { border-image: url("/ui/paper/page-day-ink-1x.png") 20 fill / 20px round; }
@media (min-resolution: 2dppx) {
  .sheet { border-image-source: url("/ui/paper/page-day-ink-2x.png"); border-image-slice: 40 fill; }
}
```

2 倍图的切片是 1 倍图的两倍，边框宽度按页面像素计保持不变。页面如果要纸纹，纸纹是另外的一层背景。

## 笔画记号

`marks.py` 写出 `web/src/page/ui/marks.ts`。每个记号都是宽窄不一的填充轮廓：起笔压住，中段加重，收笔变细，笔道带着缓慢的抖动。它们是数据，不是图片，所以颜色由页面决定（墨、胭脂、灯光），也不用去取任何文件。

| 导出 | 是什么 |
|---|---|
| `TICKS` | 办完的那一行用的勾，三个 |
| `CIRCLES` | `round`、`wide` 和 `long`：手画的圈，圈住一个词或一个短语 |
| `STRIKES`、`STRIKE_LINES` | 删掉一个数的短笔画，和删掉一整行的长笔画 |
| `TALLY`、`tally(n)`、`tallies(n)` | 按笔顺写的「正」字笔画，一笔到五笔，以及任意数目的计数 |
| `UNDERLINES` | 要去做的那个词下面的线 |
| `SEALS` | 「办妥」（`done`）和「送到」（`delivered`）两方印，各有 `wide` 和 `square`；一条路径，用奇偶规则填充 |
| `RULES`、`VERTICAL_RULES` | 账簿用的横线和竖线 |
| `GLYPHS` | 右上角的 `pause`、`play` 和 `menu` |
| `pick(variants, key)` | 同一个 `key` 每次都取同一个变体 |

一个记号有一个 `w` 乘 `h` 的框，以及用 `currentColor` 填充的 `paths`。笔画、线或下划线如果要比框长或者短，就画在一个 `<svg preserveAspectRatio="none">` 里，长度取需要的，高度取框的高度。

```tsx
import type { Mark } from "./marks.ts";

const Brush = ({ mark, width, height, stretch }: { mark: Mark; width?: number; height?: number; stretch?: boolean }) => (
  <svg viewBox={`0 0 ${mark.w} ${mark.h}`} width={width ?? mark.w} height={height ?? mark.h} fill="currentColor"
       fill-rule={mark.evenodd ? "evenodd" : undefined} preserveAspectRatio={stretch ? "none" : undefined} aria-hidden="true">
    {mark.paths.map((d) => <path d={d} />)}
  </svg>
);
```

印里的字用的是马善政的轮廓（`seal_glyphs.json`，由 `tools/fonts/glyph_paths.py` 生成），画印的时候不需要任何字体。一方印是一块墨，里面有细框，字在墨块里镂空，留着几点斑，像手按出来的印那样，还带一点倾斜。白天用胭脂填，夜里用灯下的红。
