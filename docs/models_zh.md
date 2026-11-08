<p align="center"><a href="models.md">English</a> · <b>简体中文</b></p>

# 模型

游戏里，镇上的人说什么、总管的话能让他们动几分，都由规则决定。有模型时，模型把这句回话说成这个人自己的口吻，别的事不问模型；没有模型的一局，镇上的人说的是事先写好的话。

一局游戏可以让阿里云百炼、DeepSeek、本机的 vLLM 或本机的 Ollama 替镇上的人说话。在浏览器里，由玩家在菜单的「模型来源」里选提供方。在服务端宿主上，`lantern-eve play` 能调用任何遵守 OpenAI chat-completions 协议的服务，一份提供方文件说明：请求的每一档由哪个服务、哪个模型来答，云端各档的价格是多少，调用怎样排队、怎样计时。

## 在浏览器里

页面的菜单列出下面几个提供方。一个也不选时，游戏用写好的话，不发任何调用。需要密钥的提供方用的是玩家自己的密钥：页面把它放在 worker 的内存里，只发给那个提供方，只有勾选「记在这台设备上」时才会写进浏览器。Ollama 在玩家自己的机器上运行，不需要密钥。

| 提供方 | 地址 | 快答用的模型 | 强答用的模型 |
|---|---|---|---|
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-flash` | `qwen-plus` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` | `deepseek-v4-pro` |
| Ollama | `http://localhost:11434/v1` | 页面里写的模型（起初是 `qwen3.5:4b`） | 同左 |

请求是流式的 `POST {地址}/chat/completions`。一次调用开始 8 秒后还没结束就放弃，游戏改用一句写好的话来说这句回话。一局给模型调用留一笔预算，默认 3 元。在浏览器里，不论选哪个提供方（Ollama 也一样），都按 `qwen-flash` 和 `qwen-plus` 的标价计算：用到 70% 关掉强模型，到 90% 关掉所有模型，此后镇上的人说写好的话。

Ollama 必须放页面的源进来。`localhost` 和 `127.0.0.1` 上的页面默认允许，别的源，比如 https://yyyjh1.github.io 这个站点，要在启动 Ollama 时用 `OLLAMA_ORIGINS` 加进去。公网的 https 页面访问 `http://localhost`，属于本地网络请求，Chrome 要玩家点同意权限提示之后才放行。

## 在服务端宿主上

把 `configs/providers.example.toml` 复制成 `configs/providers.toml`（git 忽略这个名字），按需修改，再把密钥放进文件里指明的环境变量，交给进程：

```bash
cp configs/providers.example.toml configs/providers.toml
export DASHSCOPE_API_KEY=...        # 密钥永远不写进文件
uv run lantern-eve play --provider-config configs/providers.toml --open
```

`play` 先打印地址，再为每一档打印一行：模型、提供方及其地址、价格。用提供方文件启动的游戏，在 welcome 消息里报告的传输层是 `openai`；`--transport mock` 则继续用 mock，同时仍从文件里取价格。模型名和价格会变。玩之前拿提供方页面上的价格核对提供方文件，游戏按这些价格算预算。

只用本机模型的游戏不需要密钥，也不花钱。把两个云端档都放到本机提供方上，价格设为 0（云端档必须有价格）：

```toml
[providers.home]
kind = "ollama"

[tiers.cheap]
provider = "home"
model = "qwen3.5:4b"
price_in = 0
price_out = 0

[tiers.strong]
provider = "home"
model = "qwen3.5:4b"
price_in = 0
price_out = 0
```

`uv run lantern-eve batch --provider-config FILE` 从不调用模型：锁步的游戏以拍计时，mock 也以拍作答。它把文件里的价格和额度带进游戏，也就带进录像的文件头。

## 提供方文件

文件是 TOML。这里没有列出的键都算错误，免得把手误当成设置。文件顶层还可以写 `version = 1`，版本号只能是 1。

### 提供方

每个 `[providers.<name>]` 表是一个服务。`kind` 补全地址、密钥变量的名字和关闭思考的字段，每一项都可以改成别的值。

| kind | 地址 | 密钥变量 | 关闭思考的字段 |
|---|---|---|---|
| `bailian` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` | `enable_thinking: false` |
| `deepseek` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | `thinking: {"type": "disabled"}` |
| `ollama` | `http://localhost:11434/v1` | 无 | `reasoning_effort: "none"` |
| `vllm` | `http://localhost:8000/v1` | 无 | `chat_template_kwargs: {"enable_thinking": false}` |
| `openai` | 必须给出 `base_url` | `OPENAI_API_KEY` | 无 |

| 键 | 含义 |
|---|---|
| `kind` | 上表中的一种，省略时为 `openai` |
| `base_url` | 调用发往 `{base_url}/chat/completions`。里面不能带凭据、查询串或片段 |
| `api_key_env` | 存放密钥的环境变量的名字。空字符串表示不用密钥 |
| `extra_body` | 加到每个请求体里的字段，关闭思考的开关就在这里。不能设 `model`、`messages`、`max_tokens`、`max_completion_tokens` 和 `stream` |
| `max_output_tokens` | 对这个提供方每次调用的输出设一个上限，只会比游戏要求的低，不会比它高 |
| `max_tokens_field` | `max_tokens`（默认）或 `max_completion_tokens`，看服务要哪一个 |

默认值让思考保持关闭，并让每次调用都不超过游戏要求的输出上限，因为一局的预算守得住，靠的是每次调用的花费都不超过它预留的数目。会拒绝陌生字段的模型，就把 `extra_body` 设成 `{}`。密钥若要经明文 `http` 发往不在本机的主机，会被拒绝。

### 档位

游戏请求一个档位：`cheap`、`strong` 或 `local`。`[tiers.<tier>]` 表写明它背后的 `provider` 和 `model`。`cheap` 和 `strong` 必须有，并带 `price_in` 和 `price_out`，单位是元每百万 token。`local` 可有可无，而且免费：宿主找到模型之后（见下文），游戏才会向它发请求，本机档的请求只发往本机提供方，不会去别处。

### 价格与预算

价格会变成游戏配置里的 `price_cheap_in`、`price_cheap_out`、`price_strong_in` 和 `price_strong_out`，单位是微元每百万 token，向上取整。`[game] budget_yuan` 会变成 `budget_cap`。核心的闸门和每份录像的文件头都看得到它们。不计量调用的场景（`m0`）不收这些键，宿主也不会传给它。`--config KEY=VALUE` 设的值优先于文件。

`--prices FILE` 读一份 YAML 或 TOML 的价格表，也就是一张 `prices` 表，每个模型一行：

```yaml
prices:
  qwen-flash:
    input_per_mtok: 0.15
    output_per_mtok: 1.5
    currency: CNY
```

云端档所用模型在价格表里有一行，就取代提供方文件里的价格。行里的其他键被忽略，币种不是 `CNY` 会被拒绝，云端档完全没有价格则是错误：程序不会替你假定价格。

### 队列与计时

调用按四级排队，1 级最先、4 级最后，级别只决定谁先走。`[classes]` 给每个请求类别指定级别，没列出的类别取 `default_class`。游戏只用一个类别 `reply`（镇上的人对总管说的话），示例文件把它放在 1 级；测试用的演示世界 `m0` 用的是 `chatter`。空出一个名额，就给有请求在等的最小的级，同级里给先到的那个。正在跑的调用不会被挤掉。每一档各有自己的在途调用上限。

| 键 | 默认 | 含义 |
|---|---|---|
| `[queue] timeout_s` | 8 | 从游戏提出请求到拿到回答的秒数。过了这个时间，游戏收到 `timeout`，改用模板台词 |
| `[queue.timeouts]` | 无 | 某一级的秒数，如 `4 = 30`，用于 8 秒不合适的级 |
| `[queue] thinking_s` | 3 | 第 1 级回话晚到这个时间，就以 `thinking` 通知告知页面 |
| `[queue] late_s` | 30 | 已经超时的调用还可以继续完成多久 |
| `[queue] connect_s` | 4 | 建立连接的秒数 |
| `[queue] probe_s` | 15 | 对已经不可用的服务，两次查看之间的秒数 |
| `[queue] down_after` | 3 | 连续多少次网络故障就判定服务不可用 |
| `[queue] max_calls` | 0 | 一局游戏调用次数的硬上限，0 表示不设 |
| `[queue] default_class` | 3 | 未列出的类别所属的级 |
| `[queue.concurrency]` | cheap 8，strong 3，local 2 | 每档的在途调用数 |
| `[classes]` | 空 | 为每个请求类别指定 1 到 4 的级。示例文件列了 `reply = 1` 和 `chatter = 3` |

超时把在队列里等的时间也算进去。从未离开队列的请求没有花钱，按零 token 记账。已经发出去的调用按用量未知记账，核心会把整份预留都记上。它既不会被中止，也不会换别的模型重试。它可以在 `late_s` 之内完成，这时到达的回答带着真实用量上报，核心会让它作废，并记为未归属账目。超时之后才失败的调用不上报。调用的名额一直占到它真正结束，所以挂住不动的服务只会占满它的名额，而不会堆出一大堆调用。

核心发来的取消会关闭连接，并立刻上报 `cancelled`：还在排队的请求用量为零，已经发出的请求用量未知。已经完成的调用保留它的回答，核心会让它作废，但仍然记账。

调用不用流式：每次调用一个 JSON 响应，核心记账依据的是其中的 `usage`。页面要等核心把整句检查完才显示，所以一次调用的文字提前拿到也没有用。计时器按真实时间走，世界暂停时也一样。这些上限按局计算，服务器同时跑几局，总量就是几倍。

## 游戏被告知的提供方状况

宿主把核心自己看不到的两件事告诉它，核心把每一条记成一个 `host` 输入，所以重放时无需探测，就能做出同样的选择。

- `local_up`：配置了本机提供方，它的模型列表（`GET {base_url}/models`）有回应，而且列出了本机档的模型。游戏开始时读一次列表，之后每隔 `probe_s` 秒再读，直到模型出现在其中。不带标签的模型名也匹配它的 `:latest`。本机档连续 `down_after` 次网络故障之后是 `local_down`；列表有回应或某次调用通了，就再发 `local_up`。
- `cloud_down`：cheap 和 strong 两档合起来连续 `down_after` 次网络故障之后发出。云端不可用期间，宿主每隔 `probe_s` 秒查看它的各个服务，全部有回应时发 `cloud_up`；有一次调用通了，也会让云端恢复。

网络故障指连接建立不了或被切断，或者代理不肯建立隧道。超时、429 和 5xx 都不算，因为服务还在：对慢的或忙的服务怎么办，由游戏决定。`thinking` 通知不是核心的输入，而是发给页面的消息，文字里带着那个请求，页面可以把它显示成镇上的人在思考。

## 密钥

- 文件里写的是环境变量的名字，从不写密钥。密钥在一局游戏开始时读取一次。
- 密钥只放进发往它所属提供方的调用的 `Authorization` 头，别处不放。页面不能设置密钥：`configure` 消息会被忽略，并以一条通知作答。
- 密钥在写出之前会被替换成 `[key]`，范围包括每一行日志、回溯、错误信息和回话文字；错误只带一个简短的代码，从不带服务说过的任何话。录像里没有密钥。
- 重定向不会被跟随。

## 代理

本机的提供方一律直连，不管环境变量怎么设。远程的提供方走 `HTTPS_PROXY`、`HTTP_PROXY` 和 `NO_PROXY` 指定的代理。`ALL_PROXY` 里的 SOCKS 代理不会被使用。

## 错误代码

| 代码 | 含义 | 记账的用量 |
|---|---|---|
| `no_key` | 提供方的密钥变量是空的。什么也没发 | 零 |
| `no_provider` | 这一档在文件里没有提供方。什么也没发 | 零 |
| `call_cap` | 已经调用了 `max_calls` 次。什么也没发 | 零 |
| `http_<status>` | 服务回了这个状态码 | 4xx 为零，其余未知 |
| `network` | 没连上、连接被切断，或者代理不肯建立隧道 | 请求没发出去则为零，否则未知 |
| `bad_body` | 回答不是 JSON、没有候选项，或者大得离谱 | 未知 |
| `provider_error` | 回答是一个 `error` 对象 | 未知 |
| `timeout` | 宿主超时的时候，调用已经发出 | 未知 |
| `queue_timeout` | 宿主超时的时候，请求还在排队 | 零 |

## 几次真实调用

`tests/host_server/test_live_transport.py` 对着真实的提供方把 `m0` 跑几百拍。传输层一共最多调用 5 次，每次输出封顶 48 个 token。测试只打印状态、延迟、token 数和核心的账本，不打印模型说的任何话。除非环境里指定了提供方（提供方需要密钥时，还要有它的密钥），否则测试会被跳过：

```bash
LANTERN_LIVE_PROVIDER=bailian uv run pytest tests/host_server/test_live_transport.py -s
```

`LANTERN_LIVE_PROVIDER` 取 `bailian`、`deepseek`、`ollama` 或 `vllm`。`LANTERN_LIVE_MODEL` 为两个云端档指定同一个模型（`vllm` 必须设），`LANTERN_LIVE_BASE_URL` 替换地址。
