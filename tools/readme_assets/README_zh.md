<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# README 配图

这个目录里的脚本生成两份 README 用的配图，输出到 `docs/assets/`。运行需要 Node 22、ffmpeg 和 Chromium 的无头 shell，无需给项目安装额外的包。

```
export CHROME_BIN=/path/to/chrome-headless-shell
```

可以用 `CHROME_BIN` 指定浏览器。默认查找 `npx playwright install chromium` 安装的无头 shell。设了 `PLAYWRIGHT_BROWSERS_PATH` 就在那里找，否则在 Linux 上到 `~/.cache/ms-playwright` 下找。Chromium 以无痕模式启动，配置和临时文件放在 `--tmp` 指定的目录，默认用系统的临时目录。中文需要安装 Noto Sans CJK SC。若要使用 `PATH` 之外的 ffmpeg，设置 `FFMPEG`。

## 插图

`figures/` 里的 `banner` 和 `architecture` 各有一份 HTML，都是圆角卡片。每份文件用两种语言的 span 保存文字，`figures.css` 提供深浅配色，因此可以导出四张图。`connect.js` 负责画方框间的箭头。标题沿用 `web/public/fonts` 下的游戏字体。

```
node tools/readme_assets/build.mjs
```

脚本以 2 倍像素比、256 色调色板生成 `docs/assets/<figure>-<en|zh>-<light|dark>.png`。PNG 大于 400 KiB 会报错。用 `--only banner`、`--lang zh` 或 `--theme dark` 选图，`--colors 0` 保留真彩色，`--out DIR` 和 `--tmp DIR` 指定目录。要在浏览器里看源图，可以打开 `figures/banner.html?theme=dark&lang=zh`。

## 页面的截图

`capture_page.mjs` 用本地回环地址上的空闲端口提供 `web/dist-e2e`。脚本通过 Chrome DevTools Protocol 操作测试版页面并截图，游戏核心照常在 Pyodide 里运行。先构建测试版，再运行脚本。

```
(cd web && npm ci && npm run build:e2e)
node tools/readme_assets/capture_page.mjs
```

以下四种图都有中英文和深浅主题。

- `play-<lang>-<theme>.gif` 跟着首日带教走。族长托总管借料，李老太提起李二的传闻，总管一路问到周家伙计。到了茶馆，总管接住街坊的疑问，请伙计说说亲眼见到了什么。演示接着拍李大的应允和次日送料，最后由 ffmpeg 合成 GIF。
- `notebook-<lang>-<theme>.png` 是总管比完那两句话时的见闻簿，一本线装的册子。左页是记下的事，有拿来比的那句话、三个答案、答的结果、「帮我看看」和比过的几对。右页是还空着的讲稿。册子的高度，取页面上方没有带教或提示那一行时的高度。图在纸边里面那道墨线处截下，纸边是手裁的毛边。册子周围的东西都为这张图收了起来，有红签的纸条、谈话的纸带和人物的卡片。册子里的每一行都留着。册子的每一页都比册子高，「翻页」那句话又盖在页脚上，所以脚本像玩家那样把每一页滚到一个位置，使页的上沿和「翻页」那句话都不切断任何一条，不论是一个标题、一段话、列表里的一行，还是一个按钮。左页要能看见答的结果，右页要能看见讲稿的第三个空和它下面的全部说法。符合这些条件的位置不止一个时，脚本挑能看见最多「帮我看看」、比过的几对的标题和比过的那一对的，再取其中最靠上的。页面上有一道横线，要是它在「翻页」那句话的横线上方露出几个像素，脚本就让「翻页」那句话长到刚好盖住它，盖住的只有这道横线，没有字。拍完以后脚本再读一遍每一页的位置，有条目被切断就报错。加上 `--only notebook`，脚本拍完这张就停，不再演后面的一天。
- `ending-<lang>-<theme>.png` 取一局无人操作的一日游戏，截取结局里的传话树。标题提到传闻的最初和最后版本，树里的节点记录这局里确实听到的话。脚本核对标题和每个人名下的文字，标题里的最后一个版本没出现在树上时就报错。
- `festival-<lang>-<theme>.png` 取圆满结局的灯会夜。脚本在第一拍用测试动作召集两家、备好竹木料、说清真相并促成和解，接着让三天的游戏走到终夜。`--night-at` 在演出时钟上选时刻，默认截结束前三秒半。此时镜头已拉到全镇，游灯队伍往祠堂走，主灯已点亮，河灯顺水漂，画面上有结尾文字。窗口为 1280 × 640，成图宽 1,760 像素，是两份 README 显示宽度的两倍，256 色时体积小于 400 KiB。

录制从开场页开始，游戏先暂停。要点击按钮时先停住时钟，走路和谈话时逐拍推进。两个场景之间若隔着大半天，就让时钟快进，到下一张卡片或约好的时间再停。截图前等地图上的人走稳，固定动画时钟，并结束 CSS 过渡。

改了页面或核心，先重新构建 `web/dist-e2e`，再生成配图。

- `--only gif,notebook,ending,festival`、`--lang en,zh` 和 `--theme light,dark` 选要做哪些图，默认全做。`--seed N` 设结局那一局的种子，默认是 4927，这一局的树里有标题上的两句话。第一天和灯会夜各有自己的种子。`--night-at S` 取灯会夜的某一秒，也可以给一串秒数，这时每张图的文件名里带上它那一秒。
- `--fps` 和 `--width` 设 GIF 的帧率（默认 10）和宽度（默认 880，就是两份 README 显示它的宽度）。GIF 必须小于 `--max-mb`（默认 4），超了脚本就减少颜色数，直到够小。PNG 必须小于 400 KiB。
- `--jobs N` 设同时做几张图（默认 2），每张图用自己的浏览器。
- `--out DIR` 设图放在哪里（默认 `docs/assets`），`--dist DIR` 选用哪一个测试版（默认 `web/dist-e2e`）。`--chrome FILE`、`--tmp DIR` 和 `--keep` 设用哪个浏览器、临时文件放在哪个目录，以及要不要留下临时文件。
- `--help` 列出全部选项。
