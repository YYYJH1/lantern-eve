<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# 水墨界面

这两个 Python 脚本用标准库生成网页的纸边和笔画记号。纸边是九宫格切片图。勾、圈、正字笔画和印记用 SVG 路径表示。

```bash
uv run python tools/ink_ui/paper.py     # 写出 web/public/ui/paper/ 下的纸边图和 index.json
uv run python tools/ink_ui/marks.py     # 写出 web/src/page/ui/marks.ts，加 --check 时，文件不是最新就失败
```

## 纸边

`paper.py` 把毛边和里面那道墨线分别画成 1 倍和 2 倍图，页面展开大张纸时就不用现算滤镜。白天的荼白纸（#f3f9f1）配乌黑（#392f41）或墨灰（#758a99）的线，灯下换牙色纸（#eedeb0）配墨灰。标签和匾用 `slip`，账簿、见闻簿这样的大张纸用 `page`。

| 档 | 切片 | 条带 | 1 倍文件 | 2 倍文件 |
|---|---|---|---|---|
| 签（`slip`） | 12 | 64 | 88×88 像素，约 3 KB | 176×176 像素，约 6 KB |
| 页（`page`） | 20 | 160 | 200×200 像素，约 7 KB | 400×400 像素，约 17 KB |

切片、配色和文件名见 `index.json`。文件名按 `<grade>-<palette>-<scale>x.png` 排，配色有 `day-ink`、`day-grey` 和 `night`。正方形分成四个角和四条边，每条边的形状会重复，首尾贴合。中间是整块纸色，用 `fill` 拉满纸面。脚本沿同一条边另画一份 2 倍图。

```css
.sheet { border-image: url("/ui/paper/page-day-ink-1x.png") 20 fill / 20px round; }
@media (min-resolution: 2dppx) {
  .sheet { border-image-source: url("/ui/paper/page-day-ink-2x.png"); border-image-slice: 40 fill; }
}
```

换成 2 倍图时，把 `border-image-slice` 翻倍，CSS 里的边框宽度照旧。纸纹可以另铺一层背景。

## 笔画记号

`marks.py` 把路径写进 `web/src/page/ui/marks.ts`。笔道起笔有压力，中段稍重，收笔变细，边沿略有起伏。页面按当前主题选墨色或红色填充。

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

SVG 的视框用记号的 `w` 和 `h`，以 `currentColor` 填充 `paths`。要拉长或缩短笔画、横线或下划线时，改宽度，保留原高度，并设置 `preserveAspectRatio="none"`。

```tsx
import type { Mark } from "./marks.ts";

const Brush = ({ mark, width, height, stretch }: { mark: Mark; width?: number; height?: number; stretch?: boolean }) => (
  <svg viewBox={`0 0 ${mark.w} ${mark.h}`} width={width ?? mark.w} height={height ?? mark.h} fill="currentColor"
       fill-rule={mark.evenodd ? "evenodd" : undefined} preserveAspectRatio={stretch ? "none" : undefined} aria-hidden="true">
    {mark.paths.map((d) => <path d={d} />)}
  </svg>
);
```

印上的字取自马善政的字形轮廓，由 `tools/fonts/glyph_paths.py` 生成 `seal_glyphs.json`。印面略微倾斜，细框里把字和几处漏印的小点留空。白天填胭脂色，夜里填灯下的红。
