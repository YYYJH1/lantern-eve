<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# 精灵工具包

工具包在构建时渲染小镇地图上的人物、地点和道具。内置的 WebGL2 光线步进器使用有向距离场、卡通着色和墨线，无需第三方库或模型文件。网页按清单从图集取出对应的帧。

```
node tools/sprite-kit/bake.mjs [--jobs 4] [--only char.li_da,place.bridge] [--scales 1,2] [--px 56] [--out out] [--kmax N]
```

使用 Node 22 和 `web/` 下 Playwright 安装的 Chromium。脚本默认从 `../../web` 找 Playwright，可以用 `KIT_PLAYWRIGHT_FROM` 指向另一个目录。软件 WebGL 就能运行，有显卡会更快。`--jobs` 设置并行浏览器数，`--scales` 选图集倍率（`1,2`），`--px` 设 1 倍图里每世界单位的像素数。`--only` 按精灵 ID 或前缀筛选，`--kmax N` 只画各动画的前 N 帧。这两个选项会生成不完整的清单，发布时要完整烘焙。脚本先画最大的帧，2 倍渲染中每加一个任务可能多占几 GB 内存。

## 它写出什么

`out/` 里有无损的 1 倍图集（`atlas-1x.webp`）、无损的 2 倍图集、`manifest.json`、展示各精灵锚点和占地的 `contact-sheet.png`，以及 `walk4.gif`。2 倍图集超过 4,096 像素高时拆成 `atlas-2x-1.webp` 和 `atlas-2x-2.webp`。耗时写进 `bake.mjs` 旁边的 `bake-report.json`。Git 会忽略输出目录和报告。

网页从清单（`schema: lantern-eve/sprite-kit@1`）读取图集文件、相机和单位。一个地面格在屏幕上宽 32 像素，深 25.22 像素。高度每升一个世界单位，画面上移 34.48 像素。各精灵条目给出帧大小、锚点、帧在图集里的位置，以及摆放时还要用到的数据。

- 人物有 `idle`、`walk` 和 `talk` 三套动画，搬东西的人物还有 `carry`。每套动画有 `down`、`up`、`left`、`right` 四个朝向，各自单独渲染。`walk` 记着一步迈出多少像素。锚点是两脚中间的地面点。工具包给人物表上的二十个人和总管各做了一个小人，另有三个镇上的路人，一男一女一个孩子。谁用哪个小人，写在 `web/src/page/map/sprites.ts` 里。
- 地方有按格子算的占地，锚点在占地西南角的地面上。房子记着两盏门灯挂在哪里。有窗的建筑写明它亮窗的精灵（`lights`，见下文），桥记着人走上桥面时要抬高多少。
- 道具或特效有占地，或者有混合模式。灯笼记着光晕放在哪里。树、长青苔的石堆和杂物堆都是道具，各占一格。

帧大小、锚点和偏移都按 1 倍图的像素算。2 倍图集里是同样的帧，大小是两倍。页面画两种图集时，都按 1 倍的逻辑大小来画。

## 夜里的窗

有窗的建筑用同一模型再渲染一个 `fx.windows.<name>`。在光线步进的 `uMode 1` 下，亮窗和灯笼纸是平涂的暖色，其他表面虽透明，仍会遮住后方，因此窗棂保持暗色。夜里网页按建筑本身的锚点叠上 `lights` 指定的亮窗精灵。精灵条目的 `spots` 以 `[x, y, w, h]` 记录光晕矩形，从锚点起算，单位为 1 倍图像素，y 向下。同一种房屋共用亮窗精灵，摊位和桥没有。

## 页面角落里的物件

页面角落里总管的用具占四个精灵。`prop.elder_seal` 是刻着「族」字、印钮上系红绳的石印。`prop.notebook` 是右边有书脊、贴着「见闻簿」签条的线装书。`prop.incense_unlit` 和 `prop.incense_lit` 是同一只青铜香炉，一只香未点，另一只香头发亮、上方冒烟。四件都用地图的相机和光源，1 倍图高 57 至 71 像素，有锚点，无占地。两只香炉的锚点和下方留白一致，页面换成点着的样式时，只有上方多出一缕烟。

页面画它们，就像画清单里别的精灵一样。`frames` 给出图集里的 `[page, x, y]`，`frame` 是 1 倍图的像素大小，`anchor` 是帧里的地面点。

这些物件有自己的着色器程序。`src/shaders/objects.glsl` 里是它们的三个模型、材质和挑模型的代码，`engine.js` 把它编译成名为 `objects` 的程序。这个程序用同一个步进器和同一套人物代码，只是拿这些模型换掉了地方的模型。烘焙其余精灵的那个程序里没有这些模型，它的贴字画布里也没有，所以往工具包里加物件，不会改动图集里已有的任何精灵。印上的字和签条上的字是马善政的轮廓（`src/page/glyphs.js`，由 `tools/fonts/glyph_paths.py` 生成），由 `places.js` 里的 `makeObjectsDecal` 画在它们自己的贴字画布上。

## 比较两次烘焙

```
node tools/sprite-kit/compare.mjs web/public/sprites tools/sprite-kit/out [--partial]
```

比较脚本用 Chromium 解码两套图集，逐个精灵、逐帧核对像素字节和清单条目。图集里的帧位置可能随打包改变，所以跳过位置字段。新烘焙多出来的 ID 会列出，少 ID 时可用 `--partial` 容许 `--only` 的输出。参与比较的内容都相同时，退出码为 0。

## 美术放在哪里

`web/public/sprites/` 里放着页面要加载的文件，有图集和 `manifest.json`。图集是 `atlas-1x.webp`，2 倍图集一页 4096 像素放不下时，还有 `atlas-2x-1.webp` 和 `atlas-2x-2.webp`。烘焙完以后，先把那里的旧图集删掉，再把新文件从 `out/` 复制过去。

```
rm web/public/sprites/atlas-*.webp
cp tools/sprite-kit/out/atlas-*.webp tools/sprite-kit/out/manifest.json web/public/sprites/
```

页面读清单，不从固定的位置取帧。清单里新加的精灵，只要 `web/src/page/map/sprites.ts` 写明它画的是谁或什么，就不用改代码。

## 烘焙是确定的

同一套源文件和选项会生成逐字节相同的文件。打包前对帧排序，浏览器完成任务的先后不会影响顺序。构建也会去掉 Chromium 加入的色彩配置，并把耗时写在 `out/` 之外。因此，`web/public/sprites/` 里的图集和 `manifest.json` 发生变化时，可以回查源文件或选项。

## 源文件

- `bake.mjs` 启动浏览器，把帧分给它们，再打包图集、写出文件。
- `src/shaders/` 是 GLSL。`march.glsl` 是光线步进器，`figures.glsl` 画人，`places.glsl` 画茶馆、两家的宅子、栈桥、石桥、竹竿堆、灯笼和垂柳，`town.glsl` 画其余的建筑。普通房子共用一个主体，每座建筑另有一个函数，写它自己的样子。`trees.glsl` 画树、石堆和杂物堆。`dispatch.glsl` 决定一个地方用哪个模型，并给出地方材质的反照率，还有夜里的灯光。`common.glsl` 是它们共用的函数，`post.glsl` 画墨线，做最后一遍处理。
- `src/shaders/objects.glsl` 是页面角落物件的程序，`compare.mjs` 比较两次烘焙。
- `src/page/` 在浏览器页面里跑。`config.js` 管单位、相机、光照和调色板，`engine.js` 是 WebGL2 引擎，`catalog.js` 写着人物和各自的动画。`places.js` 写着地方和道具，以及它们的占地（取自 `content/maps/bridge_town.yaml`），还有据此做出的亮窗。`bake.js` 烘焙一帧，`compose.js` 裁剪并打包各帧，还找出夜里亮窗的位置，`gif.js` 做预览，`glyphs.js` 存着印上和签条上那几个字的轮廓。
