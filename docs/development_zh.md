<p align="center"><a href="development.md">English</a> · <b>简体中文</b></p>

# 开发说明

## 一份核心，两种宿主

<p align="center"><picture>
<source media="(prefers-color-scheme: dark)" srcset="assets/architecture-zh-dark.png">
<img alt="一份 Python 核心，两种宿主（浏览器里用 Pyodide 的 Worker 和 Python 服务端），一个网页客户端，录像逐拍重放" src="assets/architecture-zh-light.png" width="920"></picture></p>

世界是 `lantern_core`，一个纯状态机：每次调用把一拍的输入以 JSON 交进去，再以 JSON 拿回这一拍的输出，核心里不读时钟、不读文件、不联网。会改变世界的输入（玩家动作、模型结果、暂停）到达时都由宿主编号并记下，所以录像能逐拍重放。状态里没有浮点数，只有整数、字符串、布尔值和 null，装在列表和对象里，它的 SHA-256 在 CPython 和 Pyodide 下完全相同。

浏览器宿主在模块 Worker 里用 Pyodide 跑核心，服务端宿主用 CPython 加 asyncio 跑核心。两者遵守同一份契约，写在 `core/lantern_core/api.py` 的文档字符串里。

`lantern-eve` 命令运行服务端宿主。`lantern-eve play` 在 127.0.0.1 上提供构建好的网页客户端，并为每局游戏运行一个会话。会话用 Python 运行浏览器宿主的那套循环：它在收到输入时编号，用定步长累加器推进核心，把模型请求交给传输层，并记录核心已应用的内容。页面通过 WebSocket 与它通信，用的是浏览器宿主的消息，外加几条它自己的消息（记录在 `host_server/lantern_eve/protocol.py` 的文档字符串里）。每局游戏的录像以浏览器宿主的格式写到 `runs/`，所以 `lantern_core.replay.rebuild` 能原样读取它。[web/README_zh.md](../web/README_zh.md) 说明了如何让网页客户端连上它。

## 目录

| 路径 | 内容 |
|---|---|
| `core/` | `lantern_core`，世界本身。只用标准库，同一个 wheel 在 CPython 和 Pyodide 里都能跑 |
| `host_server/` | `lantern_eve`，服务端宿主：asyncio、模型传输、WebSocket 推帧、批跑 |
| `web/` | 网页客户端（TypeScript、PixiJS、Preact）和浏览器宿主 |
| `configs/` | `providers.example.toml`，服务端宿主的提供方文件示例（见 [models_zh.md](models_zh.md)） |
| `content/` | 封闭的谓词表与动机表、实体、剧本、镇上人说话用的中英双语句子、小镇的地图和人物表、给模型的提示词，以及编译好的 JSON |
| `tools/` | `check_content.py`，校验并编译内容；`sprite-kit/`，烘焙小镇地图的精灵和页面角落里的物件（见 [tools/sprite-kit/README_zh.md](../tools/sprite-kit/README_zh.md)）；`fonts/`，把页面的字体裁成游戏里用到的字（见 [tools/fonts/README_zh.md](../tools/fonts/README_zh.md)）；`ink_ui/`，画界面的纸边和笔画记号（见 [tools/ink_ui/README_zh.md](../tools/ink_ui/README_zh.md)）；`readme_assets/`，做两份 README 里的配图（见 [tools/readme_assets/README_zh.md](../tools/readme_assets/README_zh.md)）；以及 `bots/`（按规则办事的总管，无头跑完整局）和 `balance.py`、`follow_report.py`（让它们跑，再统计各局怎样收场） |
| `tests/` | 核心、内容与两种宿主的 pytest，以及跨宿主的哈希比对 |
| `docs/` | 文档，以及它们展示的配图（在 `docs/assets/`） |

## 检查

```bash
uv sync
npm ci --prefix tests/cross_host
uv run ruff check .
uv run ruff format --check .
uv run python tools/check_content.py --check
uv run python tools/fonts/build.py --check
uv run pytest -q -n 8
uv run lantern-eve batch --seeds 1-3 --ticks 500
npm --prefix web ci
npm --prefix web exec -- playwright install chromium
npm --prefix web run test:e2e
```

`-n 8` 让测试分八个进程并行跑（pytest-xdist）。`npm ci --prefix tests/cross_host` 跑过之前，pytest 会跳过跨宿主的测试；`web/dist` 构建出来之前，也会跳过检查构建产物的那一项。`lantern-eve batch` 以无头方式跑演示世界 `m0` 的这些种子（`--scenario bridge` 跑小镇），每拍调用一次核心，并为每个种子打印一行：最终的拍号和状态哈希。同样的种子每次打印的行都相同。

CI 在每次推送到 main 和每个 pull request 时运行，也可以在 Actions 页面手动启动，每周还会单独跑一次浏览器测试。它在 Python 3.12 和 3.14 上跑 ruff、内容与字体检查和 pytest，在 Node 22 和 Pyodide 314 上跑跨宿主比对（被跳过也算失败），在 Chromium 里跑网页构建和浏览器测试。
