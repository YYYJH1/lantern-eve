"""The ``lantern-eve`` command: ``play`` serves the game, ``batch`` runs it headless."""

from __future__ import annotations

import argparse
import asyncio
import logging
import signal
import sys
import webbrowser
from pathlib import Path
from typing import TYPE_CHECKING

import lantern_eve
from lantern_core.api import preset
from lantern_core.world import create_world
from lantern_eve import batch as batch_module
from lantern_eve.openai_transport import openai_factory
from lantern_eve.providers import ConfigError, ProviderConfig
from lantern_eve.providers import load as load_providers
from lantern_eve.scrub import guard_handlers
from lantern_eve.static import WebDirError
from lantern_eve.transport import mock_factory

if TYPE_CHECKING:
    from lantern_eve.server import HostOptions

TRANSPORTS = ("mock", "openai")
CONFIG_HELP = (
    "a key of the game's config (repeatable): VALUE is an integer, or a text for the keys "
    "variant, opening and goods"
)


def _value(text: str) -> int | str:
    """An integer where the text is one, else the text: the bridge has three keys that are texts."""
    try:
        return int(text)
    except ValueError:
        return text


def _config(items: list[str]) -> dict[str, int | str] | None:
    config: dict[str, int | str] = {}
    for item in items:
        key, equals, value = item.partition("=")
        if not (key and equals and value):
            raise argparse.ArgumentTypeError(f"{item!r}: expected KEY=VALUE")
        config[key] = _value(value)
    return config or None


def _config_arg(item: str) -> str:
    _config([item])
    return item


def _provider_args(command: argparse.ArgumentParser) -> None:
    command.add_argument(
        "--provider-config",
        type=Path,
        metavar="FILE",
        help="TOML file that says which model answers each tier and what it costs "
        "(see configs/providers.example.toml)",
    )
    command.add_argument(
        "--prices",
        type=Path,
        metavar="FILE",
        help="a price list (YAML or TOML, yuan per million tokens) that takes the place of the "
        "prices in the provider file",
    )


def _providers(args: argparse.Namespace) -> ProviderConfig | None:
    """The provider file named on the command line, or None. Raises ``SystemExit`` if unusable."""
    if args.provider_config is None:
        if args.prices is not None:
            raise SystemExit(f"lantern-eve {args.command}: --prices needs --provider-config")
        return None
    try:
        return load_providers(args.provider_config, prices=args.prices)
    except ConfigError as err:
        raise SystemExit(f"lantern-eve {args.command}: {err}") from None


def _preset_arg(name: str) -> str:
    """A name of a game of the core, such as ``slice``."""
    try:
        preset(name)
    except ValueError as err:
        raise argparse.ArgumentTypeError(str(err)) from None
    return name


def _game_config(
    providers: ProviderConfig | None,
    scenario: str,
    explicit: dict[str, int | str] | None,
    base: dict[str, int | str] | None = None,
) -> dict[str, int | str] | None:
    """The config of a game: the prices from the provider file, and over them what --config sets.

    Raises ``SystemExit`` if the scenario would not take it.
    """
    config: dict[str, int | str] = dict(base or {})
    config.update(providers.game_config(scenario) if providers is not None else {})
    config.update(explicit or {})
    try:
        create_world(scenario, config or None)
    except ValueError as err:
        raise SystemExit(f"lantern-eve: {err}") from None
    return config or None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="lantern-eve", description="Lantern Eve: the server host."
    )
    parser.add_argument(
        "--version", action="version", version=f"lantern-eve {lantern_eve.__version__}"
    )
    commands = parser.add_subparsers(dest="command", required=True)

    play = commands.add_parser("play", help="serve the web client and the game on 127.0.0.1")
    play.add_argument(
        "--port", type=int, default=0, help="a port to listen on (default: a free one)"
    )
    play.add_argument(
        "--seed",
        type=int,
        help="the seed of a game whose page names none "
        "(for tests: the built page always names its game)",
    )
    play.add_argument(
        "--scenario",
        default="m0",
        help="the world of a game the page does not name: bridge (the town) or m0 "
        "(the demo world of the tests) (default: m0)",
    )
    play.add_argument(
        "--preset",
        type=_preset_arg,
        metavar="NAME",
        help="play a game of the core by name, such as slice (the game the opening page starts), "
        "for a page that names no seed: its seed, scenario and config. --seed and --config win "
        "over it",
    )
    play.add_argument(
        "--config",
        action="append",
        default=[],
        type=_config_arg,
        metavar="KEY=VALUE",
        help=CONFIG_HELP,
    )
    play.add_argument(
        "--web-dir",
        type=Path,
        help="the built web client (default: $LANTERN_WEB_DIR if it is set, else web/ in the "
        "package, else web/dist)",
    )
    play.add_argument(
        "--runs-dir",
        type=Path,
        default=Path("runs"),
        help="where replays go (default: runs)",
    )
    play.add_argument(
        "--transport",
        choices=TRANSPORTS,
        help="where model calls go (default: openai with a provider file, else mock)",
    )
    _provider_args(play)
    play.add_argument(
        "--host-seed", type=int, help="seed of the mock transport (default: the game's)"
    )
    play.add_argument("--pace", type=int, default=1, help="multiplies real time (for testing)")
    play.add_argument("--open", action="store_true", help="open the page in the default browser")
    play.set_defaults(func=_play)

    batch = commands.add_parser("batch", help="run headless lockstep games, one line per seed")
    batch.add_argument("--seeds", required=True, help="seeds, such as 1-3 or 1,3,5")
    batch.add_argument("--ticks", required=True, type=int, help="ticks to play")
    batch.add_argument(
        "--scenario",
        default="m0",
        help="the world to play: bridge (the town) or m0 (the demo world of the tests) "
        "(default: m0)",
    )
    batch.add_argument(
        "--config",
        action="append",
        default=[],
        type=_config_arg,
        metavar="KEY=VALUE",
        help=CONFIG_HELP,
    )
    batch.add_argument(
        "--host-seed", type=int, help="seed of the mock transport (default: the game's)"
    )
    batch.add_argument("--runs-dir", type=Path, help="write each game's replay here")
    _provider_args(batch)
    batch.set_defaults(func=_batch)
    return parser


def _batch(args: argparse.Namespace) -> int:
    if args.ticks < 0:
        raise SystemExit("lantern-eve batch: --ticks must not be negative")
    # A batch never calls a model: the mock answers, in ticks. A provider file gives it the prices.
    config = _game_config(_providers(args), args.scenario, _config(args.config))
    try:
        seeds = batch_module.parse_seeds(args.seeds)
        results = batch_module.run_batch(
            seeds,
            args.ticks,
            scenario=args.scenario,
            config=config,
            host_seed=args.host_seed,
            runs_dir=args.runs_dir,
        )
    except ValueError as err:
        raise SystemExit(f"lantern-eve batch: {err}") from None
    for result in results:
        print(result.line(), flush=True)
    return 0


def _play(args: argparse.Namespace) -> int:
    from lantern_eve.server import HostOptions  # aiohttp is not needed for a batch

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    guard_handlers()  # a key never reaches a log line, whoever writes it

    providers = _providers(args)
    name = args.transport or ("openai" if providers is not None else "mock")
    if name == "openai" and providers is None:
        raise SystemExit("lantern-eve play: --transport openai needs --provider-config")
    explicit = _config(args.config)
    named = preset(args.preset) if args.preset is not None else None
    # Refuse a bad price, or a key the scenario does not have, before the first page.
    _game_config(
        providers,
        named["scenario"] if named else args.scenario,
        explicit,
        named["config"] if named else None,
    )
    options = HostOptions(
        web_dir=args.web_dir,
        runs_dir=args.runs_dir.resolve(),
        transport_factory=(
            openai_factory(providers)
            if name == "openai" and providers is not None
            else mock_factory(args.host_seed)
        ),
        transport_name=name,
        default_seed=args.seed,
        default_scenario=args.scenario,
        default_preset=args.preset,
        config=explicit,
        game_config=providers.game_config if providers is not None else None,
        pace=args.pace,
    )
    try:
        return asyncio.run(
            _serve(options, args.port, args.open, providers if name == "openai" else None)
        )
    except (WebDirError, ValueError, OSError) as err:
        raise SystemExit(f"lantern-eve play: {err}") from None


async def _serve(
    options: HostOptions, port: int, open_browser: bool, providers: ProviderConfig | None = None
) -> int:
    from lantern_eve.server import ServerHost

    host = ServerHost(options)
    await host.start(port)
    # The page names the server host with ?host=ws. Without it the page runs the browser host.
    url = f"{host.url}?host=ws"
    if host.web_dir is None:
        print(
            "no built web client found: run `npm run build` in web/ (only /ws is served)",
            file=sys.stderr,
        )
    print(f"lantern-eve {lantern_eve.__version__} serving {url}", flush=True)
    if providers is not None:
        for line in providers.describe():
            print(f"  {line}", flush=True)
    if open_browser:
        webbrowser.open(url)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    try:
        await stop.wait()
    finally:
        await host.stop()
        if options.runs_dir is not None:
            print(f"replays are in {options.runs_dir}", flush=True)
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
