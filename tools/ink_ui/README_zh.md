<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# 水墨界面

页面这套水墨纸面的画风，有两样材料是用脚本画的，不是手画的。一样是纸张毛糙的边，做成九宫格图片。另一样是毛笔的笔画记号，有勾、圈、计数的笔画和印，存成路径数据。两样都只用标准库。

```bash
uv run python tools/ink_ui/paper.py     # 写出 web/public/ui/paper/ 下的纸边图和 index.json
uv run python tools/ink_ui/marks.py     # 写出 web/src/page/ui/marks.ts，加 --check 时，文件不是最新就失败
```

## 纸边

一张纸有手裁的毛边，边往里一点有一道墨线。页面不在运行时现做这些，因为给一大张纸套滤镜很慢。`paper.py` 一次画好，1 倍和 2 倍各一套，用的是页面的颜色。白天是荼白（#f3f9f1）的纸，配乌黑（#392f41）或墨灰（#758a99）的线。灯下是牙色（#eedeb0）的纸，配墨灰的线。纸分两档。签用在小东西上，比如纸签、标签、匾。页用在大东西上，比如账簿和见闻簿。

| 档 | 切片 | 条带 | 1 倍文件 | 2 倍文件 |
|---|---|---|---|---|
| 签（`slip`） | 12 | 64 | 88×88 像素，约 3 KB | 176×176 像素，约 6 KB |
| 页（`page`） | 20 | 160 | 200×200 像素，约 7 KB | 400×400 像素，约 17 KB |

文件名是 `<grade>-<palette>-<scale>x.png`，`grade` 是上表里的 `slip` 或 `page`，配色有 `day-ink`、`day-grey` 和 `night` 三种。图是一个正方形。四个角各是一个切片大小，角和角之间是四段边，每段一个条带长。条带里那段毛边的起伏是一段一段重复的，首尾正好对得上，所以接起来看不出接缝。中间是平平的纸色，`fill` 能把它拉满任意大小的纸面。2 倍图是同一条边按两倍大小重新画的，不是把 1 倍图放大。`index.json` 列出切片、颜色和文件。

```css
.sheet { border-image: url("/ui/paper/page-day-ink-1x.png") 20 fill / 20px round; }
@media (min-resolution: 2dppx) {
  .sheet { border-image-source: url("/ui/paper/page-day-ink-2x.png"); border-image-slice: 40 fill; }
}
```

2 倍图的切片是 1 倍图的两倍，边框的宽度按页面像素算不变。页面想要纸纹，就另加一层背景。

## 笔画记号

`marks.py` 写出 `web/src/page/ui/marks.ts`。每个记号都是粗细不匀的填充轮廓，起笔压一下，中段最重，收笔变细，笔道还带一点慢慢的抖动。记号是数据，不是图片，所以颜色由页面来定，可以是墨色、胭脂或灯下的颜色，也不用去取任何文件。

| 导出 | 是什么 |
|---|---|
| `TICKS` | 一行办完时打的勾，有三种 |
| `CIRCLES` | `round`、`wide` 和 `long`，手画的圈，圈住一个词或一个短语 |
| `STRIKES`、`STRIKE_LINES` | 划掉一个数的短笔，划掉一整行的长笔 |
| `TALLY`、`tally(n)`、`tallies(n)` | 按笔顺写的「正」字，从一笔到五笔，以及任意数目的计数 |
| `UNDERLINES` | 点了就去办的那句话下面的线 |
| `SEALS` | 「办妥」（`done`）和「送到」（`delivered`）两方印，各有 `wide` 和 `square` 两种。每方印是一条路径，按奇偶规则填充 |
| `RULES`、`VERTICAL_RULES` | 账簿上的横线和竖线 |
| `GLYPHS` | 右上角的 `pause`、`play` 和 `menu` |
| `pick(variants, key)` | 同一个 `key` 每次都挑出同一个变体 |

每个记号有一个 `w` 乘 `h` 的框，`paths` 用 `currentColor` 填充。笔画、横线或下划线要比框长或短时，就画在一个 `<svg preserveAspectRatio="none">` 里，长度取需要的长度，高度取框的高度。

```tsx
import type { Mark } from "./marks.ts";

const Brush = ({ mark, width, height, stretch }: { mark: Mark; width?: number; height?: number; stretch?: boolean }) => (
  <svg viewBox={`0 0 ${mark.w} ${mark.h}`} width={width ?? mark.w} height={height ?? mark.h} fill="currentColor"
       fill-rule={mark.evenodd ? "evenodd" : undefined} preserveAspectRatio={stretch ? "none" : undefined} aria-hidden="true">
    {mark.paths.map((d) => <path d={d} />)}
  </svg>
);
```

印上的字用的是马善政的轮廓（`seal_glyphs.json`，由 `tools/fonts/glyph_paths.py` 生成），画印时用不着字体。一方印是一块墨，里面有一道细框，字从墨里镂空出来。印上留着几个没沾上墨的小点，像手按出来的那样，整方印还微微歪着。白天用胭脂色填，夜里用灯下的红。
