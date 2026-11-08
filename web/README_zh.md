<p align="center"><a href="README.md">English</a> · <b>简体中文</b></p>

# web

灯会前夕的网页客户端：游戏页面（PixiJS 画的地图，加上中英两种语言、深浅两套主题的 Preact 界面），以及浏览器宿主，浏览器宿主在模块 Web Worker 里用 Pyodide 运行 Python 世界核心。同一个页面也可以改由在 CPython 下运行核心的服务端宿主驱动。除了玩家选定的模型提供方，页面不会从自己的源之外取任何东西。

## 命令

需要 Node 22.18 或更新版本、npm，以及用来构建核心 wheel 的 [uv](https://docs.astral.sh/uv/)。

```bash
npm ci
npm run dev          # Vite 开发服务器。没有内容安全策略，没有测试钩子
npm run build        # 核心 wheel、复制 Pyodide、类型检查、在 dist/ 里做生产构建
npm run preview      # 用响应头带上策略来提供 dist/
npm run test:unit    # 只在 Node 里跑的测试，不开浏览器
npm run test:e2e     # 构建 dist/ 和 dist-e2e/，再跑单元测试和浏览器测试
npm run assets       # 把 Pyodide 运行时复制到 public/pyodide，把 wheel 构建到 public/core，并把各个包的许可证文本写进 public/licenses/npm
npm run wheel        # 只做 wheel 这一步：uv build --wheel ../core --out-dir public/core
npm run csp          # 打印内容安全策略
```

浏览器测试用 Playwright 的 Chromium。装一次就行：`npx playwright install chromium`。

`public/pyodide/`、`public/core/`、`public/licenses/npm/`、`dist/` 和 `dist-e2e/` 都是生成物，已被 git 忽略。

## 什么在哪里运行

页面默认启动浏览器宿主：

```
页面（主线程）                        宿主 worker（模块 worker）
  client.ts   ---- 消息 ---->           host.worker.ts
  ui/, map/        <-- 帧 ---             HostRuntime   循环、输入日志、存档、模型调用
                                          Pyodide       lantern_core.api.Game.step
                                          transport     fetch 到提供方，流式
                                          IndexedDB     存档
```

地址里带 `?host=ws` 时，页面在 worker 加载任何东西之前就把它关掉。`src/page/ws-source.ts` 给 `client.ts` 一个 worker 的接口，把同样的消息经 WebSocket 发给服务端宿主：

```
页面（主线程）                        服务端宿主（lantern-eve play）
  client.ts   -- WebSocket /ws -->      server.py
  ws-source.ts                            Session       循环、输入日志、模型调用
  ui/, map/        <-- 帧 ---             CPython       lantern_core.api.Game.step
                                          transport     提供方文件里的服务，或 mock
                                          runs/         录像
```

页面对 Pyodide 一无所知。`src/shared/` 是纯 TypeScript，除了 `fetch`、`AbortController`、`TextDecoder`、`indexedDB`、`performance` 和定时器之外不碰浏览器全局对象，所以单元测试在 Node 里对着一个替身 `Game` 就能跑它。服务端宿主不存档，页面对模型的选择只回一条提示，不会把提供方或密钥发给它。页面和宿主之间的消息写在 [`host_server/lantern_eve/protocol.py`](../host_server/lantern_eve/protocol.py) 的文档字符串里，类型定义在 `src/shared/protocol.ts`。

## 东西在哪里

| 路径 | 里面是什么 |
|---|---|
| `src/page/` | 主线程上的页面：`client.ts`（宿主的接口）、`ui/`（Preact 界面）、`map/`（PixiJS 地图）、`style/`（CSS），以及把一帧变成界面所显示内容的那些模块 |
| `src/worker/` | 浏览器宿主：`host.worker.ts` 和 `pyodide-game.ts` |
| `src/shared/` | 浏览器宿主和页面共用的部分：循环（`runtime.ts`）、通往提供方的传输（`transport.ts`、`providers.ts`）、录像（`replay.ts`、`player.ts`）、存档（`idb-saves.ts`）和对密钥的处理（`secrets.ts`） |
| `src/i18n/` | 界面的文字：`zh.ts` 和 `en.ts` 的键相同 |
| `public/` | 字体（裁成游戏可能显示的字，见 `tools/fonts`）、精灵图集（`tools/sprite-kit`）、纸张纹理和许可证文本 |
| `scripts/` | `prepare-assets.mjs`（复制 Pyodide、构建核心 wheel、写 npm 许可证）和 `print-csp.mjs` |
| `test/` | `unit/`（Node）、`e2e/`（浏览器）和 `support/`（它们共用的夹具、服务器和替身宿主） |

## 测试

`npm run test:unit` 跑 `unit` 项目：纯 TypeScript，在 Node 里跑，不开浏览器。`npm run test:e2e` 构建生产页面和一个带若干自用钩子的测试构建，再跑两个项目。浏览器项目 `chromium` 对着 `dist-e2e/` 里的测试构建（`npm run build:e2e`）运行。它的夹具会在空闲端口上启动所需的服务器，所以不必事先开着什么。多数浏览器测试用一个替身宿主来驱动页面，替身宿主给页面喂的是为测试做好的帧，在 Pyodide 里玩真核心的那些要久一些。只跑一个文件：`npx playwright test --project=chromium test/e2e/<文件>`。浏览器测试一次只跑一个（`workers: 1`），因为其中有些要量页面的时钟走得准不准。

## 密钥

密钥只在 worker 的内存里，只发往它所属提供方的地址。只有勾选「记在这台设备上」时才会写进 `localStorage`，它永远不会进入录像、存档或导出文件。服务端宿主收不到它。

## 内容安全策略

`npm run build` 把策略以 `<meta>` 标签写进 `dist/index.html`。`<meta>` 策略只管文档本身。worker 的策略取自它自己那个脚本的响应头，所以能发响应头的宿主应在每个响应上带上策略（`npm run csp` 会把它打印出来）。`npm run preview` 这样做，`lantern-eve play` 也一样。宿主必须把 `.wasm` 作为 `application/wasm` 提供。

## 许可证

构建出的站点所带内容的许可证文本在 `public/licenses/`，构建时复制进 `dist/licenses/`；那里的 `README.txt` 说明每个文件是什么。[THIRD_PARTY_zh.md](../THIRD_PARTY_zh.md) 列出各个组件和它们的版本。
