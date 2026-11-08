<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# README 配图

`docs/assets/` 里两份 README 展示的配图，由本文件夹里的脚本生成。脚本需要 Node 22、ffmpeg 和一个无头 Chromium（「headless shell」版本），不给项目增加任何包。

```
export CHROME_BIN=/path/to/chrome-headless-shell
```

没有设置 `CHROME_BIN` 时，脚本使用 `npx playwright install chromium` 装在 Playwright 浏览器目录里的无头 shell：设了 `PLAYWRIGHT_BROWSERS_PATH` 就用它，没设就用 `~/.cache/ms-playwright`（仅限 Linux）。浏览器以 `--incognito` 启动，它的配置目录和临时文件放在 `--tmp` 指定的目录里（默认是系统的临时目录）。中文文字使用 Noto Sans CJK SC，所以要安装这个字体。ffmpeg 取自 `PATH`，或取自变量 `FFMPEG`。

## 插图

`figures/` 里每张图一个 HTML 文件：`banner` 和 `architecture`。每张图是一张圆角卡片。`figures.css` 把颜色定义成浅色和深色主题的变量。每段文字都写了两遍，分别是 `<span class="en">` 和 `<span class="zh">`，所以一份源文件能得到四张图。`connect.js` 画出方框之间的箭头。标题字体是游戏页面在 `web/public/fonts` 里自带的两款字体。

```
node tools/readme_assets/build.mjs
```

它按两倍的像素比写出 `docs/assets/<figure>-<en|zh>-<light|dark>.png`，调色板为 256 色。`--only banner`、`--lang zh`、`--theme dark`、`--colors N`（0 保留浏览器的真彩色 PNG）、`--out DIR` 和 `--tmp DIR` 用来缩小范围或改变输出位置，超过 400 KiB 的 PNG 会报错。要在浏览器里看一张图，打开 `figures/banner.html?theme=dark&lang=zh`。

## 页面的截图

`capture_page.mjs` 驱动真实的游戏页面：网页客户端的测试构建，背后是在 Pyodide 里运行的真实核心。它在 127.0.0.1 上提供 `web/dist-e2e`（端口由系统选定），通过 Chrome DevTools Protocol 在浏览器里打开页面，并截图。要先有测试构建：

```
(cd web && npm ci && npm run build:e2e)
node tools/readme_assets/capture_page.mjs
```

它做出三种图，每种都有浅色和深色两个主题、中文和英文两种语言：

- `play-<lang>-<theme>.gif` 是玩家遇到的第一天，一局的开头。页面打开时地址里不带游戏，所以它先显示开场页，再跑开场页开的那一局（有它自己的种子），停到按下「开始」才放开。影片先是开场页和族长的头两张卡片，然后总管照红签上带下划线的那句话走到李老太跟前，先看预览，再向她求竹料，她拒绝了。传言用标签和「问来源」的见闻列表顺着往回追，从李老太到茶馆老板娘，再到周家伙计，族长的卡片把一对话并排放进见闻簿，总管判定伙计看到的并不能证明镇上说的。接着剪到下午，是傍晚的茶馆：这一对话当众说出来，在场的人各用自己的话回答，李老太收回了阻拦。然后向李大求竹料，先看预览，他答应了。晚上九点，灯下的「夜里小结」先把世界停住，等到被收起；再剪过夜晚，就是次日早晨：早上的《镇报》摊开，接着是「第一天完成」的卡片，随后镜头移到桥边，竹料在那里堆成一堆，旁边的账簿写着答应了什么、到了什么。「剪」指脚本不截图、直接推进的一段拍数。GIF 由 ffmpeg 根据全部帧的调色板制作。
- `notebook-<lang>-<theme>.png` 是总管判完那一对话时的见闻簿，一本线装的册子：左页是笔记和判断，右页是陈述卡。图按册子的边截取，四周留一点边。
- `ending-<lang>-<theme>.png` 是一个结局的传话树，来自只有一天的一局：没人掌舵，一直跑到最后一夜。

图不取决于机器有多快。页面以 `?until=1` 打开，它让世界在第一拍之后停住。脚本再用页面自己的暂停和继续消息，一拍一拍地推进世界：宿主收到继续就走一拍，紧跟在后面的暂停在下一拍到期之前把世界停住。脚本发出的动作，在它发出的那一拍生效。核心是种子和每一拍所得输入的函数，所以同一个构建得出同一局。每次截图之前，脚本等到地图上没有东西在动，把地图自身动画的时钟固定下来，并结束页面的 CSS 动画。世界在两张图之间被停住时，暂停按钮旁边会显示「已暂停」，这是脚本造成的，所以脚本让页面显示「进行中」。谈话是例外。总管谈话时，核心自己把时钟停住，不管脚本对宿主说什么都不会有一拍到来，所以脚本在谈话里不推进：它用标签、选择列表或卡片上的按钮行事，或者告辞。每个动作要花掉几分钟的游戏时间，脚本把这些拍走完，谈话才再停住；谈话停住世界时还去推进一拍，会立刻报错并说明原因。谈话里页面保持游戏本来的样子，暂停按钮旁边的字写「时间静止」。

图里是 `web/dist-e2e` 中的核心。核心改动之后，要重新构建测试构建，再运行一次脚本。

- `--only gif,notebook,ending`、`--lang en,zh` 和 `--theme light,dark` 选择要做的图（默认全做）。`--seed N` 设置结局那一局的种子（默认 7）；第一天有它自己的种子。
- `--fps` 和 `--width` 设置 GIF 的帧率（10）和宽度（960）。GIF 必须在 `--max-mb`（4）以内，脚本会不断减少颜色数，直到满足。PNG 必须在 400 KiB 以内。
- `--jobs N` 同时做这么多张图（默认 2），每张图用自己的浏览器。
- `--out DIR` 和 `--dist DIR` 设置图的输出位置（默认 `docs/assets`）和提供哪一个测试构建（默认 `web/dist-e2e`）。`--chrome FILE`、`--tmp DIR` 和 `--keep` 设置浏览器、临时文件的目录，以及是否保留临时文件。
- `--help` 列出全部选项。
