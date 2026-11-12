<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# web

这是灯会前夕的网页客户端，里面有游戏页面和浏览器宿主。页面是一张 PixiJS 画的地图，上面是 Preact 写的界面，有中英两种语言和深浅两套主题。浏览器宿主在一个模块 Web Worker 里，用 Pyodide 跑 Python 写的世界核心。同一个页面也可以改由服务端宿主来驱动，服务端宿主用 CPython 跑核心。页面只从自己的源取东西，玩家选的模型提供方除外。

## 命令

要装 Node 22.18 或更新的版本和 npm。构建核心的 wheel 还要用 [uv](https://docs.astral.sh/uv/)。

```bash
npm ci
npm run dev          # 先备好资源，再起 Vite 开发服务器。不带内容安全策略，也没有测试钩子
npm run build        # 先备好资源，做类型检查，再把生产版构建到 dist/
npm run preview      # 用 dist/ 起一个服务，策略放在响应头里
npm run typecheck    # 只做类型检查，查页面、worker，以及在 Node 里跑的配置、脚本和测试
npm run build:e2e    # 先备好资源，再把测试版构建到 dist-e2e/。测试版就是同一个页面加上浏览器测试用的钩子
npm run test:unit    # 只在 Node 里跑的测试，不开浏览器
npm run test:e2e     # 构建 dist/ 和 dist-e2e/，再跑单元测试和浏览器测试
npm run assets       # 把 Pyodide 运行时复制到 public/pyodide，把 wheel 构建进 public/core，把各个包的许可证文本写进 public/licenses/npm
npm run wheel        # 只构建 wheel，命令是 uv build --wheel ../core --out-dir public/core
npm run csp          # 打印内容安全策略
```

浏览器测试用 Playwright 的 Chromium，先用 `npx playwright install chromium` 装一次。

`public/pyodide/`、`public/core/`、`public/licenses/npm/`、`dist/` 和 `dist-e2e/` 都是构建出来的，不进 git。

## 页面和宿主各在哪里跑

页面默认启动浏览器宿主。

```
页面（主线程）                        宿主 worker（模块 worker）
  client.ts   ---- 消息 ---->           host.worker.ts
  ui/, map/        <-- 帧 ---             HostRuntime   循环、输入日志、存档、模型调用
                                          Pyodide       lantern_core.api.Game.step
                                          transport     用 fetch 调提供方，流式返回
                                          IndexedDB     存档
```

地址里带上 `?host=ws`，页面会在 worker 加载任何东西之前把它停掉。这时由 `src/page/ws-source.ts` 顶替 worker。`client.ts` 照旧给它发消息，它再把消息经 WebSocket 转给服务端宿主。

```
页面（主线程）                        服务端宿主（lantern-eve play）
  client.ts   -- WebSocket /ws -->      server.py
  ws-source.ts                            Session       循环、输入日志、模型调用
  ui/, map/        <-- 帧 ---             CPython       lantern_core.api.Game.step
                                          transport     提供方文件里的服务，或者 mock
                                          runs/         录像
```

页面完全不碰 Pyodide。`src/shared/` 是纯 TypeScript，浏览器的全局对象只用 `fetch`、`AbortController`、`TextDecoder`、`indexedDB`、`performance` 和定时器，所以单元测试能在 Node 里拿一个替身 `Game` 来跑它。服务端宿主不存档。在服务端宿主上选模型，页面只回一条提示，提供方和密钥都不会发过去。页面和宿主之间有哪些消息，写在 [`host_server/lantern_eve/protocol.py`](../host_server/lantern_eve/protocol.py) 的文档字符串里，类型定义在 `src/shared/protocol.ts`。

## 各目录里有什么

| 路径 | 里面是什么 |
|---|---|
| `src/page/` | 主线程上的页面。`client.ts` 是页面这一头，给宿主发消息，记着宿主报来的最新状态。`ui/` 是 Preact 界面，`map/` 是 PixiJS 地图，`style/` 是 CSS，`audio/` 是用 Web Audio 合成的声音，`festival/` 是灯会夜的演出。其余的模块把一帧变成界面上显示的东西 |
| `src/worker/` | 浏览器宿主：`host.worker.ts` 和 `pyodide-game.ts` |
| `src/shared/` | 浏览器宿主和页面都用的代码：循环（`runtime.ts`），连到提供方的传输（`transport.ts`、`providers.ts`），录像（`replay.ts`、`player.ts`），存档（`idb-saves.ts`），密钥的处理（`secrets.ts`） |
| `src/i18n/` | 界面上的文字：`zh.ts` 和 `en.ts` 的键一一对应 |
| `public/` | 字体（只留游戏可能显示的字，见 `tools/fonts`），精灵图集（见 `tools/sprite-kit`），纸张纹理，许可证文本 |
| `scripts/` | `prepare-assets.mjs`（复制 Pyodide，构建核心 wheel，写 npm 许可证）和 `print-csp.mjs` |
| `test/` | `unit/`（在 Node 里跑），`e2e/`（在浏览器里跑），`support/`（两边共用的夹具、服务器和替身宿主），`groups/`（浏览器 spec 的清单，见下文），以及 `live.spec.ts`。`live.spec.ts` 向真实的提供方发三次很短的请求，没设 `LANTERN_LIVE_PROVIDER` 和 `LANTERN_LIVE_KEY` 就跳过 |

## 测试

`npm run test:unit` 跑 `unit` 项目，也就是在 Node 里跑纯 TypeScript，不开浏览器。`npm run test:e2e` 先构建生产版页面和带测试钩子的测试版，再把两个项目都跑一遍。浏览器项目 `chromium` 跑在 `dist-e2e/` 里的测试版上（`npm run build:e2e`）。它的夹具会在空闲端口上自己起服务器，事先不用开着什么。多数浏览器测试用替身宿主驱动页面，替身宿主喂给页面的是为测试做好的帧。在 Pyodide 里跑真核心的那些测试要久一些。只跑一个文件，用 `npx playwright test --project=chromium test/e2e/<文件>`。浏览器测试默认一次只跑一个（`workers: 1`），因为有些测试要量页面的时钟走得准不准。

浏览器 spec 分在 `test/groups/` 的两张清单里。`fake.txt` 列的是用替身宿主驱动页面的 spec。`real.txt` 列的是跑真核心的 spec，大部分时间都花在它们身上。`test/e2e/` 里的每个 spec 都在其中一张清单里，而且只在一张里。每张清单又切成几份，每份在 CI 运行机的两个核上用时差不多（`fake-1.txt`、`fake-2.txt`……`real-1.txt`……）。CI 的每个任务跑一份，单元测试跟着 `fake` 的第一份一起跑。`fake` 的每一份一次跑两个 spec，每个核一个。`real` 的每一份一次只跑一个。清单不按个数来切，因为跑整局游戏的 spec 比别的要久好几倍。要跑一张清单或其中一份，就把里面的文件交给 Playwright。

```bash
npx playwright test --project=chromium $(sed 's|^|test/e2e/|' test/groups/real-1.txt)
```

新加的 spec 放进一张清单，再放进用时最少的那一份。每个 spec 都得进一张清单，每张清单得正好等于它各份之和，工作流也得把每一份都跑到。有一条没做到，`test/unit/groups.spec.ts` 就会失败。

测试里的时间上限是照开发机定的。`LANTERN_TIME_SCALE` 把这些上限按同一个倍数放宽。CI 的运行机只有两个较慢的核，所以 `.github/workflows/ci.yml` 里设了它。放宽的上限包括一个测试的上限、一次断言的上限、一个动作的上限，以及测试用 `test.setTimeout` 给自己定的上限。除此之外，测试不能靠机器的快慢。游戏按自己的节奏走，测试不能指望页面追得上游戏。测试要是需要世界安安静静，就把提示关掉（`localStorage` 里的 `lantern.hints`），不然 600 拍里什么都没动，族长就会找上门来。有的时刻只持续几秒，测试要在那一刻看，就让宿主把世界停在那一拍（`?until=`）。测试要把总管领到一个人面前，而这个人只在游戏里的几个钟头内找得到，就让游戏以 1 或更慢的节奏跑。放着不管的游戏跑过大约 2300 拍，就到第一夜的夜里小结卡。这张卡把世界停住，一件事办成时的卡要排在它后面。节奏为 20 时这只要十二秒，所以测试要等自己那张卡，就让游戏以 2 或更慢的节奏跑。页面只亮几秒就收走的东西，要么一次读完，要么让它留得更久。镜头的演出（节日里的一个时刻、灯会夜）也只占页面时钟的几秒，而两个核上的页面每秒只画两帧，答复测试的一步就比这更久，所以测试用 `showclock=manual` 打开页面，手动拨动演出的时钟（`test/support/festival.ts` 里的 `advance`）。页面在谈话开始后过几帧才把红签的纸条折起来，两个核上几帧就是一秒，所以测试要纸条开着，就等页面的帧，不等几毫秒（`test/support/note.ts` 里的 `openTheNote`）。测试要在定好的时刻看地图上的人，就自己设地图的时钟，每看一次画一次地图（`view.clock` 和 `view.redraw()`），因为每秒只画两帧的页面会让所有的人在同一拍上变样。便条五秒后消失，所以测试用 `textsInBothLanguages` 一次读出它的两种语言。提示点亮的信号九秒后就熄，所以测试要先把它再点亮一次，再去看（`test/support/slice.ts` 里的 `relight`）。别的长度的计时器用 `stretchTimer` 放长。不是测菜单的地方，语言和主题用页面里的一次点击来选（`switchLang`、`switchTheme`）。

## 密钥

密钥只放在 worker 的内存里，只发往它那家提供方的地址。只有勾了「记在这台设备上」，密钥才会写进 `localStorage`。录像、存档和导出的文件里都不会有密钥。服务端宿主收不到密钥。

## 内容安全策略

`npm run build` 把策略用 `<meta>` 标签写进 `dist/index.html`。`<meta>` 里的策略只管文档本身。worker 的策略取自它那个脚本的响应头。所以发布网站的服务器只要能设响应头，就该在每个响应上都带上策略（`npm run csp` 会把它打印出来）。`npm run preview` 是这样做的，`lantern-eve play` 也是。服务器发 `.wasm` 文件时，类型必须是 `application/wasm`。

## 许可证

构建出的站点带着哪些东西，它们的许可证文本都在 `public/licenses/` 里。构建时这些文本会复制进 `dist/licenses/`，那里的 `README.txt` 说明每个文件是什么。各个组件和它们的版本列在 [THIRD_PARTY_zh.md](../THIRD_PARTY_zh.md) 里。
