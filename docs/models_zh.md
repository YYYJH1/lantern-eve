<p align="center"><a href="models.md">English</a> · <b>简体中文</b></p>

# 模型

镇上的人说什么，总管的话能说动人家几分，都由游戏规则决定。有模型的时候，模型只做一件事，就是把这句回话换成这个人自己的口气。没有模型的一局，镇上的人说的是写好的台词。

一局游戏可以请阿里云百炼、DeepSeek、本机的 vLLM 或本机的 Ollama 替镇上的人说话。在浏览器里，玩家在菜单的「模型来源」里选提供方。在服务端宿主上，`lantern-eve play` 能调用任何兼容 OpenAI chat-completions 协议的服务。哪一档请求由哪个服务、哪个模型来答，云端各档什么价钱，调用怎么排队、怎么计时，都写在一份提供方文件里。

## 在浏览器里

页面的菜单里列着下面几个提供方。一个都不选，游戏就用写好的台词，一次调用也不发。要密钥的提供方，用的是玩家自己的密钥。页面把密钥放在 worker 的内存里，只发给那一个提供方。只有勾了「记在这台设备上」，密钥才会写进浏览器。Ollama 在玩家自己的机器上跑，不要密钥。

| 提供方 | 地址 | 便宜档的模型 | 强档的模型 |
|---|---|---|---|
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-flash` | `qwen-plus` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` | `deepseek-v4-pro` |
| Ollama | `http://localhost:11434/v1` | 页面里填的模型（一开始是 `qwen3.5:4b`） | 同左 |

请求是流式的 `POST {地址}/chat/completions`。一次调用开始 8 秒后还没完，游戏就不再等它，改用一句写好的台词来说这句回话。一局给模型调用留一笔预算，默认 3 元。在浏览器里，不管选的是哪个提供方，Ollama 也一样，预算都按 `qwen-flash` 和 `qwen-plus` 的标价来算。预算用到 70%，强档就停了。用到 90%，所有模型都停，从这时起镇上的人只说写好的台词。

Ollama 要先放行页面所在的源。`localhost` 和 `127.0.0.1` 上的页面默认放行。别的源，比如 https://yyyjh1.github.io 这个站点，要在启动 Ollama 时写进 `OLLAMA_ORIGINS`。公网上的 https 页面访问 `http://localhost`，算是本地网络请求，Chrome 要等玩家在权限提示里点了同意才放行。

## 在服务端宿主上

把 `configs/providers.example.toml` 复制成 `configs/providers.toml`，这个文件不进 git。按需要改好以后，用环境变量把密钥交给进程，变量名写在文件里。

```bash
cp configs/providers.example.toml configs/providers.toml
export DASHSCOPE_API_KEY=...        # 密钥不写进任何文件
uv run lantern-eve play --provider-config configs/providers.toml --open
```

`play` 先打印地址，再每档打印一行，写着模型、提供方和它的地址，还有价格。用提供方文件启动的一局，在 welcome 消息里报的传输方式是 `openai`。加上 `--transport mock`，就还用 mock，价格照样从文件里取。模型名和价格都会变。游戏按提供方文件里的价格算预算，所以要拿提供方网页上的价格核对一遍。

只用本机模型的一局，不要密钥，也不花钱。把两个云端档都放到本机的提供方上，价格写 0，因为云端档一定要有价格。

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

`uv run lantern-eve batch --provider-config FILE` 从不调用模型，因为锁步的一局按拍计时，mock 也按拍作答。它把文件里的价格和上限带进这一局，也就写进了录像的文件头。

## 提供方文件

文件用 TOML 写。这里没列出的键都算错，免得把手误当成设置。顶层还可以写 `version = 1`，版本号只有 1 这一个。

### 提供方

每个 `[providers.<name>]` 表是一个服务。`kind` 会补上地址、密钥变量的名字和关掉思考的字段，每一项都能改成别的值。

| kind | 地址 | 密钥变量 | 关掉思考的字段 |
|---|---|---|---|
| `bailian` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` | `enable_thinking: false` |
| `deepseek` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | `thinking: {"type": "disabled"}` |
| `ollama` | `http://localhost:11434/v1` | 无 | `reasoning_effort: "none"` |
| `vllm` | `http://localhost:8000/v1` | 无 | `chat_template_kwargs: {"enable_thinking": false}` |
| `openai` | 要自己写 `base_url` | `OPENAI_API_KEY` | 无 |

| 键 | 含义 |
|---|---|
| `kind` | 上表里的一种，不写就是 `openai` |
| `base_url` | 调用发往 `{base_url}/chat/completions`。地址里不能带凭据、查询串或片段 |
| `api_key_env` | 放密钥的环境变量叫什么。空字符串表示不用密钥 |
| `extra_body` | 每个请求体里都加上的字段，关掉思考的开关就写在这里。它不能设 `model`、`messages`、`max_tokens`、`max_completion_tokens` 和 `stream` |
| `max_output_tokens` | 这个提供方每次调用的输出上限，只能比游戏要的上限低，不能更高 |
| `max_tokens_field` | `max_tokens`（默认）或 `max_completion_tokens`，看服务认哪一个 |

默认设置会关掉思考，也让每次调用的输出不超过游戏要的上限。一局的预算守得住，靠的就是每次调用花的钱不超过给它预留的数目。遇到不认识的字段就报错的模型，把 `extra_body` 设成 `{}`。提供方要用密钥，地址却是别的机器上的明文 `http`，读文件时就会报错。

### 档位

游戏按档位发请求，档位有 `cheap`、`strong` 和 `local` 三种。`[tiers.<tier>]` 表写明这一档用哪个 `provider` 和哪个 `model`。`cheap` 和 `strong` 一定要有，还要写 `price_in` 和 `price_out`，单位是元每百万 token。`local` 可以不写，它不花钱。宿主找到本机的模型以后（见下文），游戏才会向它发请求。本机档的请求只发给本机的提供方，不会发到别处。

### 价格与预算

这些价格会变成游戏配置里的 `price_cheap_in`、`price_cheap_out`、`price_strong_in` 和 `price_strong_out`，单位换成微元每百万 token，向上取整。`[game] budget_yuan` 变成 `budget_cap`。核心的闸门和每份录像的文件头都看得到它们。不给调用计价的场景（`m0`）不收这些键，宿主也不传给它。`--config KEY=VALUE` 设的值比文件里的优先。

`--prices FILE` 读一份 YAML 或 TOML 写的价目表，表名是 `prices`，每个模型一行。

```yaml
prices:
  qwen-flash:
    input_per_mtok: 0.15
    output_per_mtok: 1.5
    currency: CNY
```

价目表里有云端档那个模型的一行，就用这一行的价格，不用提供方文件里的。行里别的键都不管，币种不是 `CNY` 就拒绝。云端档要是哪里都没有价格，就是错误，程序从不自己假定一个价格。

### 队列与计时

调用分四级排队，1 级最先，4 级最后，级别只管谁先走。`[classes]` 给每类请求定一个级别，没列出的类别取 `default_class`。游戏只用一类请求，叫 `reply`，就是镇上的人对总管说的话，示例文件把它放在 1 级。测试用的演示世界 `m0` 用的是 `chatter`。空出一个名额，就给有请求在等、级别数字最小的那一级，同一级里先到先得。已经在跑的调用不会被挤掉。每一档同时在途的调用数各有上限。

| 键 | 默认 | 含义 |
|---|---|---|
| `[queue] timeout_s` | 8 | 从游戏提出请求到拿到回答，最多等几秒。过了这个时间，游戏收到 `timeout`，改用写好的台词 |
| `[queue.timeouts]` | 无 | 某一级单独的秒数，比如 `4 = 30`，给 8 秒不合适的级用 |
| `[queue] thinking_s` | 3 | 1 级的回话晚到这么多秒，就给页面发一条 `thinking` 通知 |
| `[queue] late_s` | 30 | 已经超时的调用，还能再等它多久做完 |
| `[queue] connect_s` | 4 | 建立连接最多用几秒 |
| `[queue] probe_s` | 15 | 服务连不上时，隔几秒再去看一次 |
| `[queue] down_after` | 3 | 连续几次网络故障，就当这个服务连不上了 |
| `[queue] max_calls` | 0 | 一局最多调用几次，0 表示不限 |
| `[queue] default_class` | 3 | 没列出的类别算哪一级 |
| `[queue.concurrency]` | cheap 8，strong 3，local 2 | 每一档同时在途的调用数 |
| `[classes]` | 空 | 给每类请求定一个 1 到 4 的级别。示例文件写了 `reply = 1` 和 `chatter = 3` |

超时算的是排队加调用的总时间。从没出过队列的请求不花钱，记账时按零 token 算。已经发出去的调用，用量先记成不明，核心把给它预留的钱整笔算进去。这样的调用不会被中止，也不会换个模型重试。它要是在 `late_s` 之内做完了，宿主会带着真实用量把答案报上来。核心不用这个答案，只把用量另记一笔，不算在哪一档名下，钱也不再扣一次。超时以后才失败的调用不上报。一次调用的名额一直占到它真正结束，所以一个卡住的服务只会占满自己的名额，调用不会越堆越多。

核心发来取消时，宿主关掉连接，马上上报 `cancelled`。还在排队的请求，用量记零。已经发出去的请求，用量记为不明。已经做完的调用，答案照样交回来。核心不用这个答案，但照样记账。

服务端宿主的调用不用流式。每次调用拿回一个 JSON 响应，核心按响应里的 `usage` 记账。页面要等核心把整句话查完才显示，所以一次调用的字提前拿到也没用。计时器走的是真实时间，世界暂停时也照走。这些上限都按一局算，服务器同时跑几局，总数就翻几倍。

## 游戏怎么知道提供方的情况

有两件事核心自己看不到，由宿主告诉它。核心把每一条都记成一个 `host` 输入，所以重放时不用再去探测，也会做出同样的选择。

- `local_up`：配置了本机的提供方，它的模型列表（`GET {base_url}/models`）有回应，而且列出了本机档要用的模型。游戏开始时读一次列表，之后每隔 `probe_s` 秒再读，直到列表里有这个模型。模型名不带标签时，也能对上它的 `:latest`。本机档连续 `down_after` 次网络故障，就发 `local_down`。等列表又有回应，或者有一次调用通了，再发 `local_up`。
- `cloud_down`：cheap 和 strong 两档合起来连续 `down_after` 次网络故障，就发 `cloud_down`。云端连不上的这段时间，宿主每隔 `probe_s` 秒查看一遍它的各个服务，都有回应了就发 `cloud_up`。有一次调用通了，也会发 `cloud_up`。

网络故障指连不上、连接被切断，或者代理不肯建隧道。超时、429 和 5xx 都不算网络故障，因为服务还在，碰上慢的或忙的服务怎么办，由游戏决定。`thinking` 通知不是核心的输入，而是发给页面的一条消息，里面写着是哪个请求，页面可以把它显示成镇上的人在想。

## 密钥

- 文件里只写环境变量的名字，从不写密钥。一局开始时读一次密钥。
- 密钥只写进发给它那家提供方的调用里，放在 `Authorization` 头上，别处都不放。页面设不了密钥。宿主不理会 `configure` 消息，只回一条通知。
- 日志、回溯、错误信息和回话文字写出去之前，里面的密钥都换成 `[key]`。错误只带一个简短的代码，从不带服务说的原话。录像里没有密钥。
- 遇到重定向不跟过去。

## 代理

本机的提供方一律直连，不管环境变量怎么设。远程的提供方走 `HTTPS_PROXY`、`HTTP_PROXY` 和 `NO_PROXY` 指定的代理。`ALL_PROXY` 里的 SOCKS 代理不用。

## 错误代码

| 代码 | 含义 | 记账的用量 |
|---|---|---|
| `no_key` | 提供方的密钥变量是空的，什么也没发 | 零 |
| `no_provider` | 文件里没给这一档配提供方，什么也没发 | 零 |
| `call_cap` | 已经调用了 `max_calls` 次，什么也没发 | 零 |
| `http_<status>` | 服务回了这个状态码 | 4xx 记零，其余记不明 |
| `network` | 没连上，连接被切断，或者代理不肯建隧道 | 请求没发出去记零，否则记不明 |
| `bad_body` | 回答不是 JSON，没有候选项，或者大得离谱 | 不明 |
| `provider_error` | 回答是一个 `error` 对象 | 不明 |
| `timeout` | 到了宿主的超时，调用已经发出去了 | 不明 |
| `queue_timeout` | 到了宿主的超时，请求还在排队 | 零 |

## 几次真实调用

`tests/host_server/test_live_transport.py` 对着真实的提供方把 `m0` 跑几百拍。传输层一共最多调用 5 次，每次输出最多 48 个 token。测试只打印状态、延迟、token 数和核心的账本，模型说的话一句也不打印。环境里没指定提供方，测试就跳过。提供方要密钥的，还得在环境里给出密钥。

```bash
LANTERN_LIVE_PROVIDER=bailian uv run pytest tests/host_server/test_live_transport.py -s
```

`LANTERN_LIVE_PROVIDER` 取 `bailian`、`deepseek`、`ollama` 或 `vllm`。`LANTERN_LIVE_MODEL` 给两个云端档指定同一个模型，用 `vllm` 时必须设。`LANTERN_LIVE_BASE_URL` 换掉地址。
