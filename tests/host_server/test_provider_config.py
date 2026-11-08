"""The provider file: kinds and their defaults, strict keys, prices in micro-yuan, price lists."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

import pytest

from lantern_core.api import Game
from lantern_eve import providers
from lantern_eve.providers import ConfigError, load, load_prices, loads

REPO = Path(__file__).resolve().parents[2]
EXAMPLE = REPO / "configs" / "providers.example.toml"

MINIMAL = """
[providers.cloud]
kind = "bailian"

[tiers.cheap]
provider = "cloud"
model = "qwen-flash"
price_in = 0.15
price_out = 1.5

[tiers.strong]
provider = "cloud"
model = "qwen-plus"
price_in = 0.8
price_out = 8
"""


def minimal(extra: str = "") -> providers.ProviderConfig:
    return loads(MINIMAL + extra)


def test_the_example_file_loads_and_says_what_the_docs_say():
    config = load(EXAMPLE)
    assert set(config.providers) == {"bailian", "ollama"}
    assert set(config.tiers) == {"cheap", "strong", "local"}
    cheap, strong, local = (config.tiers[t] for t in ("cheap", "strong", "local"))
    assert (cheap.model, strong.model, local.model) == ("qwen-flash", "qwen-plus", "qwen3.5:4b")
    assert (cheap.price_in, cheap.price_out) == (Decimal("0.15"), Decimal("1.5"))
    assert (strong.price_in, strong.price_out) == (Decimal("0.8"), Decimal("8"))
    assert local.price_in is None
    queue = config.queue
    assert queue.timeout_s == 8 and queue.thinking_s == 3 and queue.late_s == 30
    assert dict(queue.concurrency) == {"cheap": 8, "strong": 3, "local": 2}
    assert queue.timeout_for(4) == 30 and queue.timeout_for(1) == 8
    assert config.budget_yuan == 3
    assert config.source == str(EXAMPLE)


def test_a_kind_fills_in_the_address_the_key_variable_and_the_thinking_switch():
    expected = {
        "bailian": (
            "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "DASHSCOPE_API_KEY",
            {"enable_thinking": False},
        ),
        "deepseek": (
            "https://api.deepseek.com",
            "DEEPSEEK_API_KEY",
            {"thinking": {"type": "disabled"}},
        ),
        "ollama": ("http://localhost:11434/v1", None, {"reasoning_effort": "none"}),
        "vllm": (
            "http://localhost:8000/v1",
            None,
            {"chat_template_kwargs": {"enable_thinking": False}},
        ),
    }
    for kind, (url, env, body) in expected.items():
        config = minimal(f'\n[providers.p]\nkind = "{kind}"\n')
        provider = config.providers["p"]
        assert (provider.base_url, provider.api_key_env, dict(provider.extra_body)) == (
            url,
            env,
            body,
        )
        assert provider.loopback is (kind in ("ollama", "vllm"))


def test_everything_a_kind_decides_can_be_set_instead():
    config = minimal(
        """
[providers.mine]
kind = "openai"
base_url = "https://llm.example.org/v1/"
api_key_env = "MY_KEY"
extra_body = { think = false }
max_tokens_field = "max_completion_tokens"
max_output_tokens = 64

[providers.nokey]
kind = "bailian"
api_key_env = ""
extra_body = {}
"""
    )
    mine, nokey = config.providers["mine"], config.providers["nokey"]
    assert mine.base_url == "https://llm.example.org/v1"  # no trailing slash
    assert (mine.api_key_env, dict(mine.extra_body)) == ("MY_KEY", {"think": False})
    assert (mine.max_tokens_field, mine.max_output_tokens) == ("max_completion_tokens", 64)
    assert nokey.api_key_env is None and dict(nokey.extra_body) == {}


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ("\n[queue]\ntimeout = 8\n", "queue: unknown key 'timeout'"),
        ("\n[game]\nbudget = 3\n", "game: unknown key 'budget'"),
        ('\n[providers.x]\nkind = "bailian"\nbase = "u"\n', "providers.x: unknown key 'base'"),
        ('\n[providers.x]\nkind = "gpt"\n', "providers.x.kind must be one of"),
        ('\n[providers.x]\nkind = "openai"\n', "needs a base_url"),
        ('\n[providers.x]\nkind = "openai"\nbase_url = "ftp://h/v1"\n', "http or https"),
        (
            '\n[providers.x]\nkind = "openai"\nbase_url = "https://u:p@h/v1"\n',
            "must not carry credentials",
        ),
        (
            '\n[providers.x]\nkind = "openai"\nbase_url = "http://h.example.org/v1"\n',
            "would travel unencrypted",
        ),
        ('\n[providers.x]\nkind = "bailian"\napi_key_env = "not a name"\n', "environment variable"),
        (
            '\n[providers.x]\nkind = "bailian"\nextra_body = { model = "m" }\n',
            "must not set 'model'",
        ),
        ('\n[providers.x]\nkind = "bailian"\nmax_tokens_field = "n"\n', "max_tokens_field"),
        ('\n[providers.x]\nkind = "bailian"\nmax_output_tokens = 0\n', "max_output_tokens"),
        ("\n[providers.'a b']\nkind = 'bailian'\n", "is not a name"),
        ("\n[queue]\ntimeout_s = 0\n", "queue.timeout_s must be above 0"),
        ("\n[queue]\ntimeout_s = true\n", "queue.timeout_s must be a number of seconds"),
        ("\n[queue]\nlate_s = -1\n", "queue.late_s"),
        ("\n[queue]\ndown_after = 0\n", "queue.down_after"),
        ("\n[queue]\ndefault_class = 5\n", "queue.default_class"),
        ("\n[queue.concurrency]\nfast = 2\n", "unknown tier 'fast'"),
        ("\n[queue.concurrency]\ncheap = 0\n", "queue.concurrency.cheap"),
        ("\n[queue.timeouts]\n5 = 1\n", "not a queue class"),
        ("\n[classes]\nchatter = 0\n", "classes.chatter"),
        ("\n[game]\nbudget_yuan = -1\n", "must not be negative"),
    ],
)
def test_a_wrong_key_or_value_is_named_and_refused(patch, message):
    with pytest.raises(ConfigError, match=message):
        minimal(patch)


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("unknown = 1\n" + MINIMAL, "the file: unknown key 'unknown'"),
        ("version = 2\n" + MINIMAL, "version must be 1"),
        ("", "no \\[providers"),
        (MINIMAL.replace("[tiers.strong]", "[tiers.other]"), "tiers: unknown key 'other'"),
        (MINIMAL.split("[tiers.strong]")[0], "no \\[tiers.strong\\] table"),
        (MINIMAL.replace('provider = "cloud"', 'provider = "gone"', 1), "not in \\[providers\\]"),
        (MINIMAL.replace('model = "qwen-flash"\n', ""), "tiers.cheap.model must be"),
        (MINIMAL.replace("price_out = 1.5\n", ""), "price_in and price_out go together"),
        (
            MINIMAL.replace("price_in = 0.15\nprice_out = 1.5\n", ""),
            "there is no price for the model 'qwen-flash'",
        ),
        (
            MINIMAL
            + '[tiers.local]\nprovider = "cloud"\nmodel = "m"\nprice_in = 1\nprice_out = 1\n',
            "free and takes no price",
        ),
        ("not toml = = =", "<memory>"),
    ],
)
def test_the_tiers_must_be_complete_and_priced(text, message):
    with pytest.raises(ConfigError, match=message):
        loads(text)


def test_load_names_the_file_in_its_errors(tmp_path):
    with pytest.raises(ConfigError, match="cannot read .*missing.toml"):
        load(tmp_path / "missing.toml")
    broken = tmp_path / "broken.toml"
    broken.write_text("[providers\n", encoding="utf-8")
    with pytest.raises(ConfigError, match="broken.toml"):
        load(broken)
    wrong = tmp_path / "wrong.toml"
    wrong.write_text(MINIMAL + "[queue]\nbogus = 1\n", encoding="utf-8")
    with pytest.raises(ConfigError, match=r"wrong.toml: queue: unknown key 'bogus'"):
        load(wrong)


def test_queue_classes_come_from_a_table_and_default_to_three():
    config = minimal("\n[classes]\nreply = 1\nnightly = 4\n[queue]\ndefault_class = 2\n")
    queue = config.queue
    assert [queue.class_of(c) for c in ("reply", "nightly", "other")] == [1, 4, 2]
    assert queue.class_of(None) == 2 and queue.class_of(7) == 2
    assert minimal().queue.class_of("chatter") == 3
    assert minimal().queue.class_of("anything") == 3


def test_prices_become_micro_yuan_and_are_rounded_up_never_down():
    assert providers.micro(Decimal("0.15")) == 150_000
    assert providers.micro(Decimal("1.5")) == 1_500_000
    assert providers.micro(Decimal("8")) == 8_000_000
    assert providers.micro(Decimal("0.1234561")) == 123_457
    assert providers.micro(Decimal("0")) == 0


def test_the_game_gets_the_prices_and_the_cap_in_micro_yuan_where_the_scenario_takes_them():
    config = minimal("\n[game]\nbudget_yuan = 2.5\n")
    cfg = config.game_config("bridge")
    assert cfg == {
        "price_cheap_in": 150_000,
        "price_cheap_out": 1_500_000,
        "price_strong_in": 800_000,
        "price_strong_out": 8_000_000,
        "budget_cap": 2_500_000,
    }
    # m0 does not meter its calls and refuses these keys, so it is given none.
    assert config.game_config("m0") == {}
    assert config.game_config("no-such-scenario") == {}
    # The cap is left to the scenario when the file does not set it.
    assert "budget_cap" not in minimal().game_config("bridge")
    # The core takes the keys, and the header of a replay carries them.
    game = Game(1, "bridge", cfg)
    header = game.header()["config"]
    assert all(header[key] == value for key, value in cfg.items())
    Game(1, "m0", config.game_config("m0"))


YAML_PRICES = """
version: 1
exchange_rates:
  CNY: {units_per_usd: 6.6529}
prices:
  qwen-flash:
    input_per_mtok: 0.2
    output_per_mtok: 2
    currency: CNY
    as_of: 2026-11-01
    note: a row with extra keys, as the price list of a night has
  qwen-max:
    input_per_mtok: 9
    output_per_mtok: 90
"""


def test_a_price_list_takes_the_place_of_the_price_in_the_file(tmp_path):
    path = tmp_path / "prices.yaml"
    path.write_text(YAML_PRICES, encoding="utf-8")
    prices = load_prices(path)
    assert prices["qwen-flash"] == (Decimal("0.2"), Decimal("2"))
    assert prices["qwen-max"] == (Decimal("9"), Decimal("90"))

    provider_file = tmp_path / "providers.toml"
    provider_file.write_text(MINIMAL, encoding="utf-8")
    config = load(provider_file, prices=path)
    assert (config.tiers["cheap"].price_in, config.tiers["cheap"].price_source) == (
        Decimal("0.2"),
        "the price list",
    )
    # No row for qwen-plus: the price in the file stands.
    assert config.tiers["strong"].price_in == Decimal("0.8")
    assert config.game_config("bridge")["price_cheap_in"] == 200_000

    toml_prices = tmp_path / "prices.toml"
    toml_prices.write_text(
        '[prices.qwen-plus]\ninput_per_mtok = 1\noutput_per_mtok = 10\ncurrency = "CNY"\n',
        encoding="utf-8",
    )
    assert load_prices(toml_prices) == {"qwen-plus": (Decimal("1"), Decimal("10"))}


def test_a_price_list_fills_a_tier_that_the_file_leaves_unpriced(tmp_path):
    unpriced = MINIMAL.replace("price_in = 0.15\nprice_out = 1.5\n", "").replace(
        "price_in = 0.8\nprice_out = 8\n", ""
    )
    path = tmp_path / "prices.yaml"
    path.write_text(YAML_PRICES.replace("qwen-max", "qwen-plus"), encoding="utf-8")
    config = loads(unpriced, prices=load_prices(path))
    assert config.tiers["strong"].price_out == Decimal("90")


@pytest.mark.parametrize(
    ("name", "text", "message"),
    [
        (
            "p.yaml",
            "prices:\n  m:\n    input_per_mtok: 1\n    output_per_mtok: 1\n    currency: USD\n",
            "only CNY",
        ),
        ("p.yaml", "prices:\n  m:\n    input_per_mtok: 1\n", "has no output_per_mtok"),
        ("p.yaml", "prices:\n  m: 3\n", "must be a table"),
        ("p.yaml", "prices:\n  m:\n    input_per_mtok: -1\n    output_per_mtok: 1\n", "negative"),
        ("p.yaml", "other: 1\n", "no prices table"),
        ("p.yaml", "prices: [unclosed\n", "p.yaml"),
        ("p.toml", "prices = = 1\n", "p.toml"),
        ("p.txt", "prices: {}\n", "a .yaml, .yml or .toml file"),
    ],
)
def test_a_bad_price_list_is_refused(tmp_path, name, text, message):
    path = tmp_path / name
    path.write_text(text, encoding="utf-8")
    with pytest.raises(ConfigError, match=message):
        load_prices(path)
    with pytest.raises(ConfigError, match="cannot read"):
        load_prices(tmp_path / "gone.yaml")


def test_the_console_lines_name_models_and_prices_and_nothing_secret():
    lines = load(EXAMPLE).describe()
    assert lines[0].startswith("cheap: qwen-flash on bailian (https://dashscope.aliyuncs.com")
    assert "0.15 / 1.5 yuan per million tokens" in lines[0]
    assert lines[2] == "local: qwen3.5:4b on ollama (http://localhost:11434/v1)"
    assert all("price list" not in line for line in lines)


def test_the_console_says_which_prices_came_from_a_price_list(tmp_path):
    path = tmp_path / "prices.yaml"
    path.write_text(YAML_PRICES, encoding="utf-8")
    lines = load(EXAMPLE, prices=path).describe()
    assert lines[0].endswith("0.2 / 2 yuan per million tokens (from the price list)")
    assert lines[1].endswith("0.8 / 8 yuan per million tokens")
