<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# web

《灯会前夕》的网页客户端用 PixiJS 绘制地图，用 Preact 显示界面，支持中英文和深浅主题。默认宿主是模块 Web Worker，核心由 Pyodide 运行。页面也能连接运行 CPython 的服务端宿主。浏览器从页面所在的源加载资源，模型请求发往玩家选择的提供方。

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

在地址中加 `?host=ws`，页面会在 worker 加载资源前终止它。`client.ts` 将同样的消息交给 `src/page/ws-source.ts`，再经 WebSocket 发给服务端宿主。

```
页面（主线程）                        服务端宿主（lantern-eve play）
  client.ts   -- WebSocket /ws -->      server.py
  ws-source.ts                            Session       循环、输入日志、模型调用
  ui/, map/        <-- 帧 ---             CPython       lantern_core.api.Game.step
                                          transport     提供方文件里的服务，或者 mock
                                          runs/         录像
```

Pyodide 由浏览器宿主管理，主线程只收宿主的帧。`src/shared/` 使用 TypeScript，所用的浏览器全局对象有 `fetch`、`AbortController`、`TextDecoder`、`indexedDB`、`performance` 和定时器。单元测试在 Node 中用替身 `Game` 运行这部分代码。服务端宿主不保存进度。连接服务端宿主时，页面的模型选择只显示提示，模型提供方和密钥由服务端配置。消息类型见 `src/shared/protocol.ts`，协议说明见 [`host_server/lantern_eve/protocol.py`](../host_server/lantern_eve/protocol.py)。

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

`npm run test:unit` 在 Node 里跑 `unit` 项目。`npm run test:e2e` 构建生产版和带测试钩子的测试版，再跑单元测试和浏览器测试。`chromium` 项目打开 `npm run build:e2e` 构建到 `dist-e2e/` 的页面，测试夹具会自行在空闲端口上启动服务。多数测试用替身宿主发预制帧，另一些通过 Pyodide 跑真实核心，需要更长时间。可以用 `npx playwright test --project=chromium test/e2e/<文件>` 单跑一个文件。部分用例会核对游戏时钟，因此浏览器默认逐个跑用例（`workers: 1`）。

浏览器 spec 分在 `test/groups/` 的两张清单里。`fake.txt` 列的是用替身宿主驱动页面的 spec。`real.txt` 列的是跑真核心的 spec，大部分时间都花在它们身上。`test/e2e/` 里的每个 spec 都在其中一张清单里，而且只在一张里。每张清单又切成几份，每份在 CI 运行机的两个核上用时差不多（`fake-1.txt`、`fake-2.txt`……`real-1.txt`……）。CI 的每个任务跑一份，单元测试跟着 `fake` 的第一份一起跑。`fake` 的每一份一次跑两个 spec，每个核一个。`real` 的每一份一次只跑一个。清单不按个数来切，因为跑整局游戏的 spec 比别的要久好几倍。要跑一张清单或其中一份，就把里面的文件交给 Playwright。

```bash
npx playwright test --project=chromium $(sed 's|^|test/e2e/|' test/groups/real-1.txt)
```

新加的 spec 放进一张清单，再放进用时最少的那一份。每个 spec 都得进一张清单，每张清单得正好等于它各份之和，工作流也得把每一份都跑到。有一条没做到，`test/unit/groups.spec.ts` 就会失败。

`LANTERN_TIME_SCALE` 按同一倍数放宽测试、断言、操作和 `test.setTimeout` 的超时上限。`.github/workflows/ci.yml` 为较慢的双核运行机设置了这个值。需要卡在游戏里某个时刻时，直接控制对应的时钟。

- 想停在指定拍，用 `?until=`。用例需要镇上暂时安静时，可关掉 `localStorage` 里的 `lantern.hints`。开启提示时，闲置 600 拍后族长会来问一声。
- 要找只在几个游戏小时内出现的人，把节奏设为 1 或更慢。第一夜的小结约在 2300 拍出现，会暂停游戏并挡住后续完成卡。节奏为 20 时约十二秒就能到这一拍。等待单独一张任务卡时，可以把节奏降到 2 或更慢。
- 镜头只在页面上停留几秒。双核运行机有时每秒只画两帧。用 `showclock=manual` 和 `test/support/festival.ts` 的 `advance` 推进演出时钟。要在指定时刻查地图人物，设置 `view.clock` 后调用 `view.redraw()`。谈话刚开始时要读红签，用 `test/support/note.ts` 的 `openTheNote` 等绘制帧。
- 便条五秒后会消失，可以用 `textsInBothLanguages` 一次读完两种语言。提示信号亮九秒，查之前可以用 `test/support/slice.ts` 的 `relight` 再点亮。其他计时器可用 `stretchTimer` 延长。用例与菜单无关时，可以用 `switchLang`、`switchTheme` 直接在页面上切换语言和主题。

## 密钥

密钥只放在 worker 的内存里，只发往它那家提供方的地址。只有勾了「记在这台设备上」，密钥才会写进 `localStorage`。录像、存档和导出的文件里都不会有密钥。服务端宿主收不到密钥。

## 内容安全策略

`npm run build` 把策略用 `<meta>` 标签写进 `dist/index.html`。`<meta>` 里的策略只管文档本身。worker 的策略取自它那个脚本的响应头。所以发布网站的服务器只要能设响应头，就该在每个响应上都带上策略（`npm run csp` 会把它打印出来）。`npm run preview` 是这样做的，`lantern-eve play` 也是。服务器发 `.wasm` 文件时，类型必须是 `application/wasm`。

## 许可证

构建出的站点带着哪些东西，它们的许可证文本都在 `public/licenses/` 里。构建时这些文本会复制进 `dist/licenses/`，那里的 `README.txt` 说明每个文件是什么。各个组件和它们的版本列在 [THIRD_PARTY_zh.md](../THIRD_PARTY_zh.md) 里。
