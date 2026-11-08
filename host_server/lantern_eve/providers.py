"""Which model answers each tier: the provider file of the server host.

A provider file is TOML (``configs/providers.example.toml`` is a complete one). It has these
tables, and any other key is an error, so that a typo does not pass for a setting:

``[providers.<name>]``
    One OpenAI-compatible service. ``kind`` is ``bailian``, ``deepseek``, ``ollama``, ``vllm`` or
    ``openai`` (any other service, which needs a ``base_url``). The kind fills in ``base_url``,
    ``api_key_env`` (the *name* of the environment variable that holds the key, never the key) and
    ``extra_body``, the fields added to every request to switch thinking off. Each can be set to
    something else. ``max_output_tokens`` caps the output of every call to this provider below
    what the request asks for, and ``max_tokens_field`` names the field that carries the cap.

``[tiers.cheap]``, ``[tiers.strong]`` and ``[tiers.local]``
    The ``provider`` and the ``model`` behind a tier. The two cloud tiers also carry their price,
    ``price_in`` and ``price_out``, in yuan per million tokens, unless a price list gives it. The
    local tier is free and has no price. A game can run without the local tier.

``[queue]``, ``[queue.concurrency]``, ``[queue.timeouts]`` and ``[classes]``
    How calls are queued and timed (see ``openai_transport``), and which queue class each category
    of request belongs to.

``[game]``
    ``budget_yuan``, what a game may spend on the cloud tiers. Without it the scenario's own
    default holds.

A price list (``--prices``) is a YAML or TOML file with a ``prices`` table of models, each with
``input_per_mtok`` and ``output_per_mtok`` in yuan per million tokens and, if it names one,
``currency: CNY``. Other keys of a row are ignored. A row for the model of a cloud tier takes the
place of the price in the provider file.
"""

from __future__ import annotations

import ipaddress
import math
import re
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from decimal import ROUND_CEILING, Decimal, InvalidOperation
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

TIERS = ("cheap", "strong", "local")
CLOUD_TIERS = ("cheap", "strong")
CLASSES = (1, 2, 3, 4)
MICRO = 1_000_000
FORMAT = 1
# The config keys of the core that set the price of a cloud tier, in micro-yuan per million tokens.
PRICE_KEYS = {
    "cheap": ("price_cheap_in", "price_cheap_out"),
    "strong": ("price_strong_in", "price_strong_out"),
}
# Fields of a request body that the host decides and a provider's extra_body may not touch.
RESERVED_BODY_KEYS = ("model", "messages", "max_tokens", "max_completion_tokens", "stream")
NAME = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
ENV_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")
LOOPBACK_NAMES = ("localhost",)


class ConfigError(ValueError):
    """The provider file or the price list cannot be used."""


@dataclass(frozen=True)
class Kind:
    """What a kind of provider means when the file says nothing else."""

    base_url: str | None
    api_key_env: str | None
    # The fields that switch thinking off, as measured for each service (see docs/models.md).
    extra_body: Mapping[str, Any]


KINDS: dict[str, Kind] = {
    "bailian": Kind(
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "DASHSCOPE_API_KEY",
        {"enable_thinking": False},
    ),
    "deepseek": Kind(
        "https://api.deepseek.com", "DEEPSEEK_API_KEY", {"thinking": {"type": "disabled"}}
    ),
    "ollama": Kind("http://localhost:11434/v1", None, {"reasoning_effort": "none"}),
    "vllm": Kind(
        "http://localhost:8000/v1", None, {"chat_template_kwargs": {"enable_thinking": False}}
    ),
    "openai": Kind(None, "OPENAI_API_KEY", {}),
}


@dataclass(frozen=True)
class Provider:
    name: str
    kind: str
    base_url: str
    api_key_env: str | None = None
    extra_body: Mapping[str, Any] = field(default_factory=dict)
    max_tokens_field: str = "max_tokens"
    max_output_tokens: int | None = None

    @property
    def loopback(self) -> bool:
        """Whether the service runs on this machine, which is also where no proxy is used."""
        return is_loopback(self.base_url)


@dataclass(frozen=True)
class TierSpec:
    tier: str
    provider: str
    model: str
    # Yuan per million tokens. None for the local tier, which is free.
    price_in: Decimal | None = None
    price_out: Decimal | None = None
    # Where the price came from, for the line printed at start.
    price_source: str = ""


@dataclass(frozen=True)
class QueueSettings:
    """How calls are queued and timed. ``docs/models.md`` explains each setting."""

    # How long the host waits for a call, from the moment the core asks, before it says timeout.
    timeout_s: float = 8.0
    # The same per queue class, for classes that should wait longer or less.
    class_timeouts: Mapping[int, float] = field(default_factory=dict)
    # A reply the player waits for (class 1) that is not in by now is announced to the page.
    thinking_s: float = 3.0
    # How long a call that has timed out may still finish and be reported, so that its tokens are
    # booked. After that it is aborted without a word.
    late_s: float = 30.0
    connect_s: float = 4.0
    # How often a provider that is marked down is looked at again.
    probe_s: float = 15.0
    # The consecutive network failures that mark a provider down.
    down_after: int = 3
    # A hard cap on the calls a game may make, 0 for none.
    max_calls: int = 0
    concurrency: Mapping[str, int] = field(
        default_factory=lambda: {"cheap": 8, "strong": 3, "local": 2}
    )
    classes: Mapping[str, int] = field(default_factory=dict)
    default_class: int = 3

    def class_of(self, category: Any) -> int:
        """The queue class (1 first, 4 last) of a request of this category."""
        if isinstance(category, str):
            return self.classes.get(category, self.default_class)
        return self.default_class

    def timeout_for(self, queue_class: int) -> float:
        return self.class_timeouts.get(queue_class, self.timeout_s)


@dataclass(frozen=True)
class ProviderConfig:
    providers: Mapping[str, Provider]
    tiers: Mapping[str, TierSpec]
    queue: QueueSettings = field(default_factory=QueueSettings)
    budget_yuan: Decimal | None = None
    source: str = "<memory>"

    def game_config(self, scenario: str) -> dict[str, int]:
        """The config keys of the core that carry the prices and the cap, for ``scenario``.

        They are micro-yuan, so the core's gate and the header of a replay see them. A scenario
        that does not meter its calls (m0) takes none of them and gets an empty dict.
        """
        from lantern_core.world import create_world

        try:
            known = create_world(scenario, None).config
        except ValueError:
            return {}  # an unknown scenario is the game's to refuse
        config: dict[str, int] = {}
        for tier, (key_in, key_out) in PRICE_KEYS.items():
            spec = self.tiers[tier]
            if key_in in known and spec.price_in is not None and spec.price_out is not None:
                config[key_in] = micro(spec.price_in)
                config[key_out] = micro(spec.price_out)
        if self.budget_yuan is not None and "budget_cap" in known:
            config["budget_cap"] = micro(self.budget_yuan)
        return config

    def describe(self) -> list[str]:
        """One line per tier for the console. There is nothing secret in it."""
        lines = []
        for tier in TIERS:
            spec = self.tiers.get(tier)
            if spec is None:
                continue
            provider = self.providers[spec.provider]
            price = ""
            if spec.price_in is not None and spec.price_out is not None:
                price = f", {spec.price_in:f} / {spec.price_out:f} yuan per million tokens"
                if spec.price_source == "the price list":
                    price += " (from the price list)"
            lines.append(f"{tier}: {spec.model} on {spec.provider} ({provider.base_url}){price}")
        return lines


# --- Numbers --------------------------------------------------------------------------------


def micro(yuan: Decimal) -> int:
    """Micro-yuan in an amount of yuan, rounded up so that a price is never understated."""
    return int((yuan * MICRO).to_integral_value(rounding=ROUND_CEILING))


def is_loopback(url: str) -> bool:
    host = urlsplit(url).hostname or ""
    if host in LOOPBACK_NAMES:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _decimal(value: Any, where: str) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ConfigError(f"{where} must be a number")
    try:
        number = Decimal(str(value))
    except InvalidOperation:
        raise ConfigError(f"{where} must be a number") from None
    if not number.is_finite() or number < 0:
        raise ConfigError(f"{where} must not be negative")
    return number


def _seconds(value: Any, where: str, *, zero: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ConfigError(f"{where} must be a number of seconds")
    if value < 0 or (value == 0 and not zero):
        raise ConfigError(f"{where} must be {'at least 0' if zero else 'above 0'}")
    return float(value)


def _int(value: Any, where: str, low: int, high: int | None = None) -> int:
    if type(value) is not int or value < low or (high is not None and value > high):
        span = f"at least {low}" if high is None else f"from {low} to {high}"
        raise ConfigError(f"{where} must be a whole number {span}")
    return value


def _table(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ConfigError(f"{where} must be a table")
    return value


def _only(table: Mapping[str, Any], allowed: tuple[str, ...], where: str) -> None:
    extra = sorted(set(table) - set(allowed))
    if extra:
        raise ConfigError(f"{where}: unknown key {extra[0]!r} (the keys are {', '.join(allowed)})")


def _text(value: Any, where: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(f"{where} must be a non-empty string")
    return value.strip()


# --- The provider file ----------------------------------------------------------------------


def _base_url(raw: str, where: str) -> str:
    parts = urlsplit(raw)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ConfigError(f"{where} must be an http or https URL")
    if parts.username is not None or parts.password is not None:
        raise ConfigError(f"{where} must not carry credentials: the key comes from api_key_env")
    if parts.query or parts.fragment:
        raise ConfigError(f"{where} must not have a query or a fragment")
    return raw.rstrip("/")


def _provider(name: str, raw: Any) -> Provider:
    where = f"providers.{name}"
    table = _table(raw, where)
    _only(
        table,
        ("kind", "base_url", "api_key_env", "extra_body", "max_tokens_field", "max_output_tokens"),
        where,
    )
    kind_name = _text(table.get("kind", "openai"), f"{where}.kind")
    kind = KINDS.get(kind_name)
    if kind is None:
        raise ConfigError(f"{where}.kind must be one of {', '.join(KINDS)}")
    base = table.get("base_url", kind.base_url)
    if base is None:
        raise ConfigError(f"{where}: a provider of kind {kind_name!r} needs a base_url")
    base_url = _base_url(_text(base, f"{where}.base_url"), f"{where}.base_url")
    env = table.get("api_key_env", kind.api_key_env)
    if env == "":
        env = None
    if env is not None and not ENV_NAME.match(_text(env, f"{where}.api_key_env")):
        raise ConfigError(f"{where}.api_key_env must be the name of an environment variable")
    if env is not None and base_url.startswith("http://") and not is_loopback(base_url):
        raise ConfigError(f"{where}: a key would travel unencrypted to {base_url}; use https")
    body = _table(table.get("extra_body", dict(kind.extra_body)), f"{where}.extra_body")
    for key in RESERVED_BODY_KEYS:
        if key in body:
            raise ConfigError(f"{where}.extra_body must not set {key!r}: the host decides it")
    field_name = _text(table.get("max_tokens_field", "max_tokens"), f"{where}.max_tokens_field")
    if field_name not in ("max_tokens", "max_completion_tokens"):
        raise ConfigError(f"{where}.max_tokens_field must be max_tokens or max_completion_tokens")
    cap = table.get("max_output_tokens")
    return Provider(
        name=name,
        kind=kind_name,
        base_url=base_url,
        api_key_env=env,
        extra_body=body,
        max_tokens_field=field_name,
        max_output_tokens=None if cap is None else _int(cap, f"{where}.max_output_tokens", 1),
    )


def _queue(raw: Any, classes_raw: Any) -> QueueSettings:
    table = _table(raw, "queue")
    _only(
        table,
        (
            "timeout_s",
            "thinking_s",
            "late_s",
            "connect_s",
            "probe_s",
            "down_after",
            "max_calls",
            "default_class",
            "concurrency",
            "timeouts",
        ),
        "queue",
    )
    base = QueueSettings()
    concurrency = dict(base.concurrency)
    for tier, value in _table(table.get("concurrency", {}), "queue.concurrency").items():
        if tier not in TIERS:
            raise ConfigError(f"queue.concurrency: unknown tier {tier!r}")
        concurrency[tier] = _int(value, f"queue.concurrency.{tier}", 1, 1000)
    class_timeouts: dict[int, float] = {}
    for key, value in _table(table.get("timeouts", {}), "queue.timeouts").items():
        if key not in {str(c) for c in CLASSES}:
            raise ConfigError(f"queue.timeouts: {key!r} is not a queue class (1 to 4)")
        class_timeouts[int(key)] = _seconds(value, f"queue.timeouts.{key}")
    classes: dict[str, int] = {}
    for category, value in _table(classes_raw, "classes").items():
        classes[category] = _int(value, f"classes.{category}", 1, 4)
    return QueueSettings(
        timeout_s=_seconds(table.get("timeout_s", base.timeout_s), "queue.timeout_s"),
        class_timeouts=class_timeouts,
        thinking_s=_seconds(table.get("thinking_s", base.thinking_s), "queue.thinking_s"),
        late_s=_seconds(table.get("late_s", base.late_s), "queue.late_s", zero=True),
        connect_s=_seconds(table.get("connect_s", base.connect_s), "queue.connect_s"),
        probe_s=_seconds(table.get("probe_s", base.probe_s), "queue.probe_s"),
        down_after=_int(table.get("down_after", base.down_after), "queue.down_after", 1, 1000),
        max_calls=_int(table.get("max_calls", base.max_calls), "queue.max_calls", 0),
        concurrency=concurrency,
        classes=classes,
        default_class=_int(
            table.get("default_class", base.default_class), "queue.default_class", 1, 4
        ),
    )


def _tier(tier: str, raw: Any, providers: Mapping[str, Provider]) -> TierSpec:
    where = f"tiers.{tier}"
    table = _table(raw, where)
    _only(table, ("provider", "model", "price_in", "price_out"), where)
    name = _text(table.get("provider"), f"{where}.provider")
    if name not in providers:
        raise ConfigError(f"{where}.provider names {name!r}, which is not in [providers]")
    model = _text(table.get("model"), f"{where}.model")
    if tier == "local":
        if "price_in" in table or "price_out" in table:
            raise ConfigError(f"{where}: the local tier is free and takes no price")
        return TierSpec(tier, name, model)
    if ("price_in" in table) != ("price_out" in table):
        raise ConfigError(f"{where}: price_in and price_out go together")
    if "price_in" not in table:
        return TierSpec(tier, name, model)
    return TierSpec(
        tier,
        name,
        model,
        _decimal(table["price_in"], f"{where}.price_in"),
        _decimal(table["price_out"], f"{where}.price_out"),
        "the provider file",
    )


def loads(
    text: str,
    *,
    source: str = "<memory>",
    prices: Mapping[str, tuple[Decimal, Decimal]] | None = None,
) -> ProviderConfig:
    """The provider configuration in a TOML text, with the rows of a price list laid over it."""
    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as err:
        raise ConfigError(f"{source}: {err}") from None
    try:
        return _build(data, source, prices or {})
    except ConfigError as err:
        raise ConfigError(f"{source}: {err}") from None


def load(path: Path | str, prices: Path | str | None = None) -> ProviderConfig:
    """Read a provider file, and a price list if one is given."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as err:
        raise ConfigError(f"cannot read {path}: {err.strerror or err}") from None
    return loads(text, source=str(path), prices=None if prices is None else load_prices(prices))


def _build(
    data: dict[str, Any], source: str, prices: Mapping[str, tuple[Decimal, Decimal]]
) -> ProviderConfig:
    _only(data, ("version", "game", "queue", "classes", "providers", "tiers"), "the file")
    if data.get("version", FORMAT) != FORMAT:
        raise ConfigError(f"version must be {FORMAT}")
    providers_raw = _table(data.get("providers", {}), "providers")
    if not providers_raw:
        raise ConfigError("there is no [providers.<name>] table")
    providers: dict[str, Provider] = {}
    for name, raw in providers_raw.items():
        if not NAME.match(name):
            raise ConfigError(f"providers: {name!r} is not a name (letters, digits, _ and -)")
        providers[name] = _provider(name, raw)
    tiers_raw = _table(data.get("tiers", {}), "tiers")
    _only(tiers_raw, TIERS, "tiers")
    for tier in CLOUD_TIERS:
        if tier not in tiers_raw:
            raise ConfigError(f"there is no [tiers.{tier}] table")
    tiers = {tier: _tier(tier, raw, providers) for tier, raw in tiers_raw.items()}
    for tier in CLOUD_TIERS:
        tiers[tier] = _priced(tiers[tier], prices)
    game = _table(data.get("game", {}), "game")
    _only(game, ("budget_yuan",), "game")
    budget = game.get("budget_yuan")
    return ProviderConfig(
        providers=providers,
        tiers=tiers,
        queue=_queue(data.get("queue", {}), data.get("classes", {})),
        budget_yuan=None if budget is None else _decimal(budget, "game.budget_yuan"),
        source=source,
    )


def _priced(spec: TierSpec, prices: Mapping[str, tuple[Decimal, Decimal]]) -> TierSpec:
    """The tier with its price: the row of the price list for its model, else its own."""
    row = prices.get(spec.model)
    if row is not None:
        return replace(spec, price_in=row[0], price_out=row[1], price_source="the price list")
    if spec.price_in is None or spec.price_out is None:
        raise ConfigError(
            f"tiers.{spec.tier}: there is no price for the model {spec.model!r}. Set price_in and "
            "price_out (yuan per million tokens) or pass a price list with --prices"
        )
    return spec


# --- The price list -------------------------------------------------------------------------


def _parse_yaml(text: str, path: Path) -> Any:
    import yaml

    try:
        return yaml.safe_load(text)
    except yaml.YAMLError as err:
        raise ConfigError(f"{path}: {err}") from None


def load_prices(path: Path | str) -> dict[str, tuple[Decimal, Decimal]]:
    """The input and output price, in yuan per million tokens, of every model in a price list."""
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as err:
        raise ConfigError(f"cannot read {path}: {err.strerror or err}") from None
    suffix = path.suffix.lower()
    if suffix in (".yaml", ".yml"):
        data = _parse_yaml(text, path)
    elif suffix == ".toml":
        try:
            data = tomllib.loads(text)
        except tomllib.TOMLDecodeError as err:
            raise ConfigError(f"{path}: {err}") from None
    else:
        raise ConfigError(f"{path}: a price list is a .yaml, .yml or .toml file")
    rows = data.get("prices") if isinstance(data, dict) else None
    if not isinstance(rows, dict) or not rows:
        raise ConfigError(f"{path}: there is no prices table")
    out: dict[str, tuple[Decimal, Decimal]] = {}
    for model, row in rows.items():
        where = f"{path}: prices.{model}"
        if not isinstance(row, dict):
            raise ConfigError(f"{where} must be a table")
        currency = row.get("currency", "CNY")
        if currency != "CNY":
            raise ConfigError(
                f"{where} is in {currency}: only CNY is accepted, because no rate is assumed"
            )
        try:
            out[str(model)] = (
                _decimal(row["input_per_mtok"], f"{where}.input_per_mtok"),
                _decimal(row["output_per_mtok"], f"{where}.output_per_mtok"),
            )
        except KeyError as err:
            raise ConfigError(f"{where} has no {err.args[0]}") from None
    return out
