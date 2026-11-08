<p align="center"><b>English</b> · <a href="models_zh.md">简体中文</a></p>

# Models

In the game the rules decide what a townsperson says and how far the manager's words move them. A model, when there is one, puts that reply into the person's own words. It is asked for nothing else, and a game with no model plays from the lines written for the townsfolk.

A game can ask Alibaba Bailian, DeepSeek, a local vLLM or a local Ollama to speak for its townsfolk. In the browser the player picks the provider in the menu. On the server host, `lantern-eve play` calls any service that speaks the OpenAI chat-completions protocol, and a provider file says which service and which model answer each tier of a request, what the cloud tiers cost, and how calls are queued and timed.

## In the browser

The menu of the page lists the providers below. With none picked, the game plays from written lines and makes no call. A provider that needs a key gets the player's own: the page keeps it in the memory of its worker and sends it only to that provider, and it is written to the browser only when "remember on this device" is ticked. Ollama runs on the player's machine and needs no key.

| Provider | Address | Model for a quick reply | Model for a strong one |
|---|---|---|---|
| Alibaba Bailian | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-flash` | `qwen-plus` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-flash` | `deepseek-v4-pro` |
| Ollama | `http://localhost:11434/v1` | the model named in the page (`qwen3.5:4b` at first) | the same |

Requests are streamed `POST {address}/chat/completions` calls. A call that has not finished 8 seconds after it started is given up, and the game says the reply with a written line instead. A game keeps a budget for its model calls, 3 yuan by default. In the browser it is reckoned at the list prices of `qwen-flash` and `qwen-plus` whichever provider is picked, Ollama included: from 70 percent of it the strong model is off, from 90 percent every model, and the townsfolk speak written lines from then on.

Ollama has to let the origin of the page in. Pages on `localhost` and `127.0.0.1` are allowed by default, and any other origin, such as the site at https://yyyjh1.github.io, has to be added with `OLLAMA_ORIGINS` when Ollama starts. A public https page that talks to `http://localhost` is a local network request, which Chrome allows only after the player accepts its permission prompt.

## On the server host

Copy `configs/providers.example.toml` to `configs/providers.toml` (git ignores that name), change what you need, and give the key to the process in the environment variable the file names:

```bash
cp configs/providers.example.toml configs/providers.toml
export DASHSCOPE_API_KEY=...        # the key never goes in a file
uv run lantern-eve play --provider-config configs/providers.toml --open
```

`play` prints the address and then one line for each tier: the model, the provider with its address, and the price. A game that was started with a provider file reports `openai` as its transport in the welcome message, and `--transport mock` keeps the mock while still taking the prices from the file. Model names and prices change. Check the prices in your provider file against the provider's pages, since the game works out its budget from them.

A game that uses only a model on this machine needs no key and costs nothing. Put both cloud tiers on the local provider and give them the price 0, since a cloud tier must have a price:

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

`uv run lantern-eve batch --provider-config FILE` never calls a model, because a lockstep game counts time in ticks and the mock answers in ticks. It takes the prices and the cap of the file into the game, and so into the header of the replay.

## The provider file

The file is TOML. A key that is not listed here is an error, so that a typo does not pass for a setting. The top level may also hold `version = 1`, the only version there is.

### Providers

Each `[providers.<name>]` table is one service. `kind` fills in the address, the name of the key variable and the field that switches thinking off. Every one of them can be set to something else.

| kind | address | key variable | switches thinking off |
|---|---|---|---|
| `bailian` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `DASHSCOPE_API_KEY` | `enable_thinking: false` |
| `deepseek` | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | `thinking: {"type": "disabled"}` |
| `ollama` | `http://localhost:11434/v1` | none | `reasoning_effort: "none"` |
| `vllm` | `http://localhost:8000/v1` | none | `chat_template_kwargs: {"enable_thinking": false}` |
| `openai` | `base_url` is required | `OPENAI_API_KEY` | nothing |

| key | meaning |
|---|---|
| `kind` | one of the kinds above, `openai` if left out |
| `base_url` | calls go to `{base_url}/chat/completions`. No credentials, query or fragment in it |
| `api_key_env` | the name of the environment variable that holds the key. An empty string means no key |
| `extra_body` | the fields added to every request body. This is where the thinking switch lives. It may not set `model`, `messages`, `max_tokens`, `max_completion_tokens` or `stream` |
| `max_output_tokens` | a cap on the output of every call to this provider, below what the game asks for and never above it |
| `max_tokens_field` | `max_tokens` (the default) or `max_completion_tokens`, whichever the service wants |

The defaults keep thinking off and every call within the output cap the game asked for, because the budget of a game rests on a call never costing more than its reservation. For a model that rejects a field it does not know, set `extra_body = {}`. A key that would have to travel over plain `http` to a host that is not on this machine is refused.

### Tiers

The game asks for a tier, `cheap`, `strong` or `local`. The `[tiers.<tier>]` table names the `provider` and the `model` behind it. `cheap` and `strong` are required and carry `price_in` and `price_out`, in yuan per million tokens. `local` is optional and free: the game sends a request to it only after the host has found the model (see below), and a request for the local tier goes to the local provider and nowhere else.

### Prices and the budget

The prices become the config keys `price_cheap_in`, `price_cheap_out`, `price_strong_in` and `price_strong_out` of the game, in micro-yuan per million tokens, rounded up. `[game] budget_yuan` becomes `budget_cap`. The core's gate and the header of every replay see them. A scenario that does not meter its calls (`m0`) takes none of these keys and is given none. What `--config KEY=VALUE` sets wins over the file.

`--prices FILE` takes a price list in YAML or TOML, a `prices` table with a row for each model:

```yaml
prices:
  qwen-flash:
    input_per_mtok: 0.15
    output_per_mtok: 1.5
    currency: CNY
```

A row for the model of a cloud tier takes the place of the price in the provider file. Other keys of a row are ignored, a currency other than `CNY` is refused, and a cloud tier with no price at all is an error: no price is ever assumed.

### Queue and timing

Calls wait in four classes, 1 first and 4 last, which only decide who goes first. `[classes]` gives the class of each category of request, and a category it does not list gets `default_class`. The game asks under one category, `reply` (what a townsperson says to the manager), which the example file puts in class 1, and the demo world `m0` of the tests asks under `chatter`. A free slot goes to the lowest class that has a request waiting, and inside a class to the one that came first. A running call is never pushed out. Each tier has a limit on the calls in flight of its own.

| key | default | meaning |
|---|---|---|
| `[queue] timeout_s` | 8 | seconds from the moment the game asks to the answer. After that the game gets `timeout` and uses a template line |
| `[queue.timeouts]` | none | seconds for a class, such as `4 = 30`, where 8 is not right |
| `[queue] thinking_s` | 3 | a class 1 reply this late is announced to the page as a `thinking` notice |
| `[queue] late_s` | 30 | how long a call that has timed out may still finish |
| `[queue] connect_s` | 4 | seconds to open a connection |
| `[queue] probe_s` | 15 | seconds between looks at a service that is down |
| `[queue] down_after` | 3 | network failures in a row that mark a service down |
| `[queue] max_calls` | 0 | a hard cap on the calls of one game, 0 for none |
| `[queue] default_class` | 3 | the class of a category that is not listed |
| `[queue.concurrency]` | cheap 8, strong 3, local 2 | calls in flight per tier |
| `[classes]` | empty | a class from 1 to 4 for each category of request. The example file lists `reply = 1` and `chatter = 3` |

The timeout counts the wait in the queue as well as the call. A request that never left the queue cost nothing and is booked at zero tokens. A call that was out is booked with unknown usage, which the core charges as the whole reservation. It is neither aborted nor tried again on another model. It may finish within `late_s`, and an answer that comes then is reported with its real usage, which the core voids and books as unattributed. A call that fails after its timeout is not reported. The slot of the call stays taken until it ends, so a hanging service fills its slots instead of piling up calls.

A cancel from the core closes the connection and reports `cancelled` at once, with zero usage for a request that was still waiting and unknown usage for one that was out. A call that has already finished keeps its answer, which the core voids and still books.

Calls are not streamed: one JSON response per call, and its `usage` is what the core books. The page shows a sentence only after the core has checked it whole, so the words of a call are of no use earlier. The timers run in real time, also while the world is paused. The limits are those of one game, so a server that runs several games at once multiplies them.

## What the game is told about the providers

The host tells the core two things it cannot see, and the core records each as a `host` input, so a replay makes the same choices without probing anything.

- `local_up`: a local provider is configured and its model list (`GET {base_url}/models`) answers and names the model of the local tier. The list is read when the game starts and again every `probe_s` seconds until the model is in it. A model name without a tag also matches its `:latest`. `local_down` follows `down_after` network failures in a row on the local tier, and `local_up` again when the list answers or a call gets through.
- `cloud_down` after `down_after` network failures in a row on the cheap and strong tiers together. While the cloud is down the host looks at its services every `probe_s` seconds, and `cloud_up` follows when every one of them answers, which a call that gets through also brings about.

A network failure is a connection that cannot be made or is cut, or a proxy that will not tunnel. A timeout, a 429 or a 5xx is not one, because the service is there: the game decides what to do with a slow or busy one. A `thinking` notice is not an input of the core. It is a message to the page, with the request in its text, and the page may show it as the townsperson thinking.

## Keys

- The file holds the name of an environment variable, never a key. The key is read once, when a game starts.
- A key goes into the `Authorization` header of calls to the provider that names it, and nowhere else. A page cannot set one: a `configure` message is ignored and answered with a notice.
- A key is replaced by `[key]` in every log line, traceback, error message and reply text before they are written, and an error carries a short code and never a word the service said. Replays hold no key.
- A redirect is not followed.

## Proxies

A provider on this machine is reached directly, whatever the environment says. A remote provider goes through the proxy named by `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`. A SOCKS proxy in `ALL_PROXY` is not used.

## Error codes

| code | meaning | usage booked |
|---|---|---|
| `no_key` | the key variable of the provider is empty. Nothing was sent | zero |
| `no_provider` | the tier has no provider in the file. Nothing was sent | zero |
| `call_cap` | `max_calls` calls were made. Nothing was sent | zero |
| `http_<status>` | the service answered with that status | zero for 4xx, unknown otherwise |
| `network` | no connection, a connection cut, or a proxy that would not tunnel | zero if the request was not sent, unknown otherwise |
| `bad_body` | the answer was not JSON, had no choice, or was far too large | unknown |
| `provider_error` | the answer was an `error` object | unknown |
| `timeout` | the call was out when the host timeout passed | unknown |
| `queue_timeout` | the host timeout passed while the request still waited | zero |

## A few real calls

`tests/host_server/test_live_transport.py` plays `m0` for a few hundred ticks against a real provider. The transport may make 5 calls in all, each capped at 48 tokens of output. The test prints statuses, latencies, token counts and the ledger of the core, and nothing a model said. It is skipped unless the environment names a provider and, where the provider needs one, its key:

```bash
LANTERN_LIVE_PROVIDER=bailian uv run pytest tests/host_server/test_live_transport.py -s
```

`LANTERN_LIVE_PROVIDER` is `bailian`, `deepseek`, `ollama` or `vllm`. `LANTERN_LIVE_MODEL` names one model for both cloud tiers (it is required for `vllm`), and `LANTERN_LIVE_BASE_URL` replaces the address.
