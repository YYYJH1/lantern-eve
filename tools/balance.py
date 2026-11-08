"""Balance runs of the bridge game: rule-based managers play headless, and the games are tallied.

``run`` plays every seed with every bot in lockstep (one call of the core per tick), in parallel
processes, and writes one row per game to ``games.csv`` and the spread of the rumour over time to
``reach.csv``. ``report`` prints the tables of a run.

    python tools/balance.py run --seeds 1-50 --bots all --jobs 12 --out RUNDIR
    python tools/balance.py report RUNDIR [OTHER_RUNDIR]
    python tools/balance.py play SEED BOT

A bot sees only what a page sees (the scene, and the frame and events of each call). This module
reads the state of the game as well, after the fact: it is the referee, and the numbers it
tallies (who believed the rumour, who lied to whom) are not the bots' to see.

``--set module.NAME=value`` replaces a named constant of ``lantern_core.world.bridge.<module>``
for the games of a run, to try a setting without editing the core. ``--core DIR`` plays against
another copy of the ``lantern_core`` package (the directory that holds it), for a run of an earlier
version beside a run of this one.
"""

from __future__ import annotations

import argparse
import ast
import csv
import importlib
import json
import os
import sys
import time
from collections.abc import Iterable, Sequence
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from multiprocessing import get_context
from pathlib import Path
from typing import Any

TICKS_PER_DAY = 2070
TEXT_KEYS = ("opening",)  # the config keys whose value is a name and not a number
DAY_TICKS = 1800
SAMPLE_EVERY = 60  # ticks between two looks at who believes what
MAX_STILL_CALLS = 1000  # calls in a row in which the world stands still, past which a bot is stuck
HIDDEN = "hidden_legend_of_lie"
TIPPED_AT = 10  # helpers who have joined when the work can be done in one morning (the hours)
CREW = 5
WEATHER_LETTER = {"clear": "C", "light_rain": "L", "heavy_rain": "H"}
RUMOUR_ROOT = "pr_liner_damaged"  # the rumour of the scene: that Li Er broke the rail
CHAIN_ROOT = "pr_liner_at_bridge"  # the first step of the clerk's story
# the events a person follows when they read a game: what the manager does and what comes of it
FOLLOWED = frozenset(
    {
        "rally",
        "joined",
        "promised",
        "agreed",
        "flag",
        "goal",
        "ending",
        "inspected",
        "look_refused",
        "declined",
        "entrusted",
        "entrust_done",
        "entrust_withdrawn",
        "testified",
        "convened",
        "pledged",
        "pledge_kept",
        "pledge_broken",
        "pledge_empty",
        "spoke",
        "feast",
        "lie_caught",
        "told",
    }
)

COLUMNS = (
    "label",
    "bot",
    "seed",
    "variant",
    "weather",
    "ending",
    "hidden",
    "bridge_fixed",
    "detour_done",
    "truth_told",
    "reconciled",
    "passage",
    "bridge_state",
    "work_percent",
    "truth_day",
    "bamboo_day",
    "timber_day",
    "crew_day",
    "tipped_day",
    "helpers",
    "helpers_persuaded",
    "households",
    "turnout",
    "tellings",
    "lies_told",
    "lies_caught",
    "promises",
    "promises_kept",
    "promises_broken",
    "trust_mean",
    "stars",
    "false_share",
    "reach_d1",
    "reach_d2",
    "reach_d3",
    "reach_d4",
    "reach_d5",
    "blame_d1",
    "blame_d2",
    "blame_d3",
    "blame_d4",
    "blame_d5",
    "hub_hour",
    "hub_chain_hour",
    "night_firmer",
    "night_weaker",
    "night_guesses",
    "errands_planned",
    "errands_done",
    "actions",
    "rejected",
    "ticks",
    "ms_per_tick",
    "hash",
)
REACH_COLUMNS = ("label", "bot", "seed", "tick", "chain", "blame", "false_share")


# ---------------------------------------------------------------------------- constants to try


def parse_set(items: Iterable[str]) -> tuple[tuple[str, str, Any], ...]:
    """``module.NAME=value`` items as ``(module, name, value)``, the value read as a literal."""
    out = []
    for item in items:
        target, equals, text = item.partition("=")
        module, dot, name = target.partition(".")
        if not (equals and dot and module and name):
            raise ValueError(f"{item!r}: expected module.NAME=value")
        try:
            value = ast.literal_eval(text)
        except (ValueError, SyntaxError):
            value = text
        out.append((module, name, value))
    return tuple(out)


def _bridge_module(module: str) -> Any:
    return importlib.import_module(f"lantern_core.world.bridge.{module}")


class Overrides:
    """Named constants of the bridge modules, set for a game and put back after it."""

    def __init__(self, items: Sequence[tuple[str, str, Any]]) -> None:
        self.items = items
        self._saved: list[tuple[Any, str, Any]] = []

    def __enter__(self) -> Overrides:
        for module, name, value in self.items:
            target = _bridge_module(module)
            if not hasattr(target, name):
                raise ValueError(f"lantern_core.world.bridge.{module} has no {name}")
            self._saved.append((target, name, getattr(target, name)))
            setattr(target, name, value)
        return self

    def __exit__(self, *exc: object) -> None:
        for target, name, value in reversed(self._saved):
            setattr(target, name, value)
        self._saved.clear()


# ---------------------------------------------------------------------------- the referee


@dataclass
class Referee:
    """What the runner reads from the state of a game: who believes the rumour, and the like."""

    game: Any
    people: tuple[str, ...]
    samples: list[tuple[int, int, int, int]] = field(default_factory=list)
    by_day: dict[int, tuple[int, int]] = field(default_factory=dict)
    hub_blame: int = -1  # the first sampled tick at which a hub held the rumour proper
    hub_chain: int = -1  # and the first at which one held any step of the clerk's story

    def look(self, tick: int) -> tuple[int, int, int]:
        """Named people who hold the clerk's story, the rumour proper, and the share (percent)
        who believe a falsehood about the conflict."""
        from lantern_core.cognition.props import lineage
        from lantern_core.world.bridge import goals_ending, notes
        from lantern_core.world.bridge.lore import lore

        state = self.game._kernel.state["world"]
        social = state["social"]
        view = notes.PropView(notes.made_props(social), lore().book.props)
        roots: dict[str, set[str]] = {}

        def family(prop_id: str) -> set[str]:
            if prop_id not in roots:
                roots[prop_id] = set(lineage(prop_id, view))
            return roots[prop_id]

        hubs = {person for person, tags in lore().tags.items() if "hub" in tags}
        chain = blame = 0
        for person in self.people:
            held_chain = held_blame = False
            for prop_id, note in social["beliefs"][person].items():
                if notes.confidence_of(note) <= 0 or prop_id not in view:
                    continue
                kin = family(prop_id)
                if CHAIN_ROOT in kin or RUMOUR_ROOT in kin:
                    held_chain = True
                if RUMOUR_ROOT in kin:
                    held_blame = True
            chain += held_chain
            blame += held_blame
            if person in hubs:
                if held_chain and self.hub_chain < 0:
                    self.hub_chain = tick
                if held_blame and self.hub_blame < 0:
                    self.hub_blame = tick
        share = goals_ending.false_belief_share(state)
        return chain, blame, share

    def sample(self, tick: int) -> None:
        chain, blame, share = self.look(tick)
        self.samples.append((tick, chain, blame, share))
        if tick % TICKS_PER_DAY == DAY_TICKS:
            self.by_day[tick // TICKS_PER_DAY + 1] = (chain, blame)


def day_of(tick: int) -> int:
    return tick // TICKS_PER_DAY + 1


# ---------------------------------------------------------------------------- one game


def play_game(
    seed: int,
    bot_name: str,
    *,
    label: str = "",
    days: int = 5,
    config: dict[str, int] | None = None,
    overrides: Sequence[tuple[str, str, Any]] = (),
    sample_every: int = SAMPLE_EVERY,
    stop_tick: int | None = None,
    log: list[Any] | None = None,
    bot_options: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Play one game to its ending: the row of ``games.csv`` and the rows of ``reach.csv``.

    ``stop_tick`` ends the game early (for runs that only look at the spread of the rumour),
    ``log``, if given, receives ``(tick, event)`` for the events a person would follow and, last,
    the bot itself, and ``bot_options`` are the keyword arguments the bot is made with.
    """
    import bots
    from lantern_core.api import Game
    from lantern_core.world.bridge.lore import lore

    with Overrides(overrides):
        # the bots play with no model and no money for one, so no request is made for the words
        # of a person and the rules answer, as they always did
        merged = {"days": days, "budget_cap": 0, **(config or {})}
        game = Game(seed, "bridge", merged)
        scene = json.loads(game.scene_json())
        bot = bots.make(bot_name, scene, seed, **(bot_options or {}))
        referee = Referee(game, lore().people)
        limit = days * TICKS_PER_DAY + 60 if stop_tick is None else stop_tick
        ending: dict[str, Any] | None = None
        spent = 0.0  # seconds of the core and the bot, not of the referee's looking about
        started = time.perf_counter()
        out = json.loads(game.step("[]"))
        obs = bots.Obs(out)
        spent += time.perf_counter() - started
        referee.sample(0)
        still = 0
        while game.tick < limit and ending is None:
            started = time.perf_counter()
            action = bot.decide(obs)
            records = []
            if action is not None:
                records.append({"seq": game.next_seq, "kind": "player", "body": action})
            out = json.loads(game.step(json.dumps(records)))
            obs = bots.Obs(out)
            spent += time.perf_counter() - started
            # the world stands still while the manager is in a conversation and nothing is owed: a
            # bot that stays in one and does nothing would be here for ever
            still = 0 if out["advanced"] else still + 1
            if still > MAX_STILL_CALLS:
                raise RuntimeError(
                    f"seed {seed}, bot {bot_name}: the world has stood still for {still} calls"
                )
            for event in out["events"]:
                if event["kind"] == "ending":
                    ending = event
                if log is not None and event["kind"] in FOLLOWED:
                    log.append((out["tick"], event))
            tick = out["tick"]
            if tick % sample_every == 0 or tick % TICKS_PER_DAY == DAY_TICKS:
                referee.sample(tick)
        elapsed = spent
        if log is not None:
            log.append((game.tick, bot))
        row = tally(game, bot, ending, referee, seed, bot_name, label, elapsed)
        series = [
            {
                "label": label,
                "bot": bot_name,
                "seed": seed,
                "tick": tick,
                "chain": chain,
                "blame": blame,
                "false_share": share,
            }
            for tick, chain, blame, share in referee.samples
        ]
    return row, series


def tally(
    game: Any,
    bot: Any,
    ending: dict[str, Any] | None,
    referee: Referee,
    seed: int,
    bot_name: str,
    label: str,
    elapsed: float,
) -> dict[str, Any]:
    """The row of a finished game."""
    from lantern_core.world.bridge import repute
    from lantern_core.world.bridge.lore import lore

    lo = lore()
    state = game._kernel.state["world"]
    goals, me, social = state["goals"], state["player"], state["social"]
    flags = goals["flags"]
    joined = goals["call"]["joined"]
    row: dict[str, Any] = {column: "" for column in COLUMNS}
    row.update(label=label, bot=bot_name, seed=seed, variant=social["variant"])
    row["weather"] = "".join(WEATHER_LETTER[k] for k in state["weather"]["plan"])
    ended = ending is not None
    row["ending"] = ending["ending"] if ended else "none"
    row["hidden"] = ";".join(h["id"] for h in ending["hidden"]) if ended else ""
    inputs = ending["inputs"] if ended else {}
    for key in ("bridge_fixed", "detour_done", "truth_told", "reconciled"):
        row[key] = int(bool(inputs.get(key)))
    row["passage"] = ending["passage"] if ended else ""
    row["turnout"] = ending["turnout"] if ended else 0
    row["households"] = ending["promised"] if ended else len(goals["call"]["households"])
    percent = goals["metrics"]["work_progress"]
    row["work_percent"] = percent
    row["bridge_state"] = (
        "mended"
        if "bridge_fixed" in flags
        else "detour"
        if "detour_done" in flags
        else "repairing"
        if percent
        else "broken"
    )
    for key, flag in (("truth_day", "truth_told"), ("bamboo_day", "bamboo_delivered"),
                      ("timber_day", "timber_delivered")):  # fmt: skip
        row[key] = day_of(flags[flag]) if flag in flags else ""
    row["helpers"] = len(joined)
    row["helpers_persuaded"] = sum(1 for entry in joined if entry[3] != "call")
    families: set[str] = set()
    for count, entry in enumerate(joined, start=1):
        family = lo.family[entry[0]]
        if family:
            families.add(family)
        if count >= CREW and len(families) >= 2 and row["crew_day"] == "":
            row["crew_day"] = day_of(entry[1])
        if count == TIPPED_AT:
            row["tipped_day"] = day_of(entry[1])
    row["tellings"] = len(me["told"])
    row["lies_told"] = sum(1 for entry in me["told"] if entry[4])
    row["lies_caught"] = len(me["caught"])
    row["promises"] = len(me["pledges"])
    row["promises_kept"] = sum(1 for p in me["pledges"] if p["state"] == "kept")
    row["promises_broken"] = sum(1 for p in me["pledges"] if p["state"] == "broken")
    row["trust_mean"] = round(sum(me["trust"]) / len(me["trust"]), 1)
    row["stars"] = repute.stars(me)
    row["false_share"] = goals["metrics"]["false_belief_share"]
    for day in range(1, 6):
        chain, blame = referee.by_day.get(day, ("", ""))
        row[f"reach_d{day}"], row[f"blame_d{day}"] = chain, blame
    for key, tick in (("hub_hour", referee.hub_blame), ("hub_chain_hour", referee.hub_chain)):
        row[key] = round(ticks_to_hours(tick), 1) if tick >= 0 else ""
    night = state.get("reflection", {}).get("counts")  # (a core from before the night has none)
    if night is not None:
        row["night_firmer"], row["night_weaker"] = night["firmer"], night["weaker"]
        row["night_guesses"] = night["guesses"]
        row["errands_planned"] = sum(v for k, v in night.items() if k.startswith("planned_"))
        row["errands_done"] = sum(v for k, v in night.items() if k.startswith("done_"))
    row["actions"] = bot.sent
    row["rejected"] = sum(bot.rejections.values())
    row["ticks"] = game.tick
    row["ms_per_tick"] = round(elapsed * 1000 / max(1, game.tick), 3)
    row["hash"] = game.hash()[:16]
    return row


# ---------------------------------------------------------------------------- many games


def parse_seeds(text: str) -> list[int]:
    """Seeds from ``1-50``, ``1,3,5`` or ``1-3,7``."""
    seeds: list[int] = []
    for part in text.split(","):
        low, dash, high = part.strip().partition("-")
        first, last = int(low), int(high) if dash else int(low)
        if first < 0 or last < first:
            raise ValueError(f"not a range of seeds: {part!r}")
        seeds.extend(range(first, last + 1))
    return seeds


def _work(task: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    return play_game(**task)


def _start_worker(core: str | None, tools: str) -> None:
    for path in (tools, core):
        if path and path not in sys.path:
            sys.path.insert(0, path)
    os.nice(10)


def run_games(
    seeds: Sequence[int],
    bot_names: Sequence[str],
    *,
    jobs: int = 1,
    label: str = "",
    days: int = 5,
    config: dict[str, int] | None = None,
    overrides: Sequence[tuple[str, str, Any]] = (),
    core: str | None = None,
    stop_tick: int | None = None,
    progress: Any = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Every seed with every bot. The rows come back in the order seed, bot."""
    tasks = [
        {
            "seed": seed,
            "bot_name": name,
            "label": label,
            "days": days,
            "config": config,
            "overrides": tuple(overrides),
            "stop_tick": stop_tick,
        }
        for seed in seeds
        for name in bot_names
    ]
    rows: list[dict[str, Any]] = []
    series: list[dict[str, Any]] = []
    if jobs <= 1:
        for done, task in enumerate(tasks, start=1):
            row, rest = _work(task)
            rows.append(row)
            series.extend(rest)
            if progress:
                progress(done, len(tasks), row)
        return rows, series
    tools = str(Path(__file__).resolve().parent)
    with ProcessPoolExecutor(
        max_workers=jobs,
        mp_context=get_context("spawn"),
        initializer=_start_worker,
        initargs=(core, tools),
    ) as pool:
        for done, (row, rest) in enumerate(pool.map(_work, tasks, chunksize=1), start=1):
            rows.append(row)
            series.extend(rest)
            if progress:
                progress(done, len(tasks), row)
    return rows, series


def write_csv(path: Path, columns: Sequence[str], rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(columns))
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


# ---------------------------------------------------------------------------- the tables


def _share(rows: Sequence[dict[str, str]], test: Any) -> float:
    return 100 * sum(1 for r in rows if test(r)) / len(rows) if rows else 0.0


def _mean(rows: Sequence[dict[str, str]], key: str) -> float:
    values = [float(r[key]) for r in rows if r.get(key, "") != ""]
    return sum(values) / len(values) if values else 0.0


def summarise(rows: Sequence[dict[str, str]]) -> dict[str, dict[str, float]]:
    """The numbers of the table of each bot in a run."""
    out: dict[str, dict[str, float]] = {}
    for bot in dict.fromkeys(r["bot"] for r in rows):
        mine = [r for r in rows if r["bot"] == bot]
        out[bot] = {
            "n": len(mine),
            "full": _share(mine, lambda r: r["ending"] == "ending_full"),
            "barely": _share(mine, lambda r: r["ending"] == "ending_barely"),
            "split": _share(mine, lambda r: r["ending"] == "ending_split"),
            "hidden": _share(mine, lambda r: HIDDEN in r["hidden"]),
            "passable": _share(mine, lambda r: r["ending"] != "ending_split"),
            "truth": _share(mine, lambda r: r["truth_told"] == "1"),
            "reconciled": _share(mine, lambda r: r["reconciled"] == "1"),
            "crew": _share(mine, lambda r: r["crew_day"] != ""),
            "helpers": _mean(mine, "helpers"),
            "tellings": _mean(mine, "tellings"),
            "lies": _mean(mine, "lies_told"),
            "caught": _mean(mine, "lies_caught"),
            "caught_any": _share(mine, lambda r: int(r["lies_caught"] or 0) > 0),
            "trust": _mean(mine, "trust_mean"),
            "stars": _mean(mine, "stars"),
            "ms": _mean(mine, "ms_per_tick"),
            "firmer": _mean(mine, "night_firmer"),
            "weaker": _mean(mine, "night_weaker"),
            "guesses": _mean(mine, "night_guesses"),
            "planned": _mean(mine, "errands_planned"),
            "done": _mean(mine, "errands_done"),
        }
    return out


TABLE_HEAD = (
    f"{'bot':<13}{'n':>4}{'full':>7}{'barely':>8}{'split':>7}{'legend':>8}{'truth':>7}"
    f"{'peace':>7}{'crew':>6}{'helpers':>9}{'lies':>6}{'caught':>8}{'c>0':>6}{'trust':>7}"
    f"{'ms/tick':>9}"
)


def table(summary: dict[str, dict[str, float]]) -> str:
    lines = [TABLE_HEAD]
    for bot, s in summary.items():
        lines.append(
            f"{bot:<13}{s['n']:>4.0f}{s['full']:>6.0f}%{s['barely']:>7.0f}%{s['split']:>6.0f}%"
            f"{s['hidden']:>7.0f}%{s['truth']:>6.0f}%{s['reconciled']:>6.0f}%{s['crew']:>5.0f}%"
            f"{s['helpers']:>9.1f}{s['lies']:>6.1f}{s['caught']:>8.2f}{s['caught_any']:>5.0f}%"
            f"{s['trust']:>7.1f}{s['ms']:>9.2f}"
        )
    return "\n".join(lines)


NIGHT_HEAD = f"{'bot':<13}{'firmer':>8}{'weaker':>8}{'guesses':>9}{'errands':>9}{'done':>6}"


def night_table(summary: dict[str, dict[str, float]]) -> str:
    """What the night did in a game on average: beliefs that got firmer and less firm, guesses made,
    errands chosen and errands done (all nights of the game)."""
    lines = [NIGHT_HEAD]
    for bot, s in summary.items():
        lines.append(
            f"{bot:<13}{s['firmer']:>8.1f}{s['weaker']:>8.1f}{s['guesses']:>9.1f}"
            f"{s['planned']:>9.1f}{s['done']:>6.1f}"
        )
    return "\n".join(lines)


def reach_times(series: Sequence[dict[str, str]], column: str = "blame") -> dict[str, float]:
    """For each bot, the hours of the game at which the median game had ``column`` at half the
    townsfolk (10 of the 20) and at three quarters (15)."""
    out: dict[str, float] = {}
    for bot in dict.fromkeys(r["bot"] for r in series):
        games: dict[str, list[tuple[int, int]]] = {}
        for r in series:
            if r["bot"] == bot:
                games.setdefault(r["seed"], []).append((int(r["tick"]), int(r[column])))
        for name, level in (("t50", 10), ("t75", 15)):
            hours = []
            for points in games.values():
                hit = next((tick for tick, count in sorted(points) if count >= level), None)
                hours.append(ticks_to_hours(hit) if hit is not None else float("inf"))
            hours.sort()
            out[f"{bot}.{name}"] = hours[len(hours) // 2] if hours else float("inf")
    return out


def ticks_to_hours(tick: int) -> float:
    """Game hours since 06:00 of day 1 (the 24 hours of a day, the night included)."""
    day, rest = divmod(tick, TICKS_PER_DAY)
    if rest < DAY_TICKS:
        return day * 24 + rest / 120
    return day * 24 + 15 + (rest - DAY_TICKS) / 30


# ---------------------------------------------------------------------------- command line


def _progress(done: int, total: int, row: dict[str, Any]) -> None:
    if done % 20 == 0 or done == total:
        print(f"{done}/{total} {row['bot']} seed {row['seed']} {row['ending']}", flush=True)


def cmd_run(args: argparse.Namespace) -> int:
    from bots import BOTS

    names = list(BOTS) if args.bots == "all" else args.bots.split(",")
    for name in names:
        if name not in BOTS:
            raise SystemExit(f"unknown bot {name!r}; the bots are {', '.join(BOTS)}")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    config = dict(item.split("=") for item in args.config)  # type: ignore[arg-type]
    config_ints = {k: (v if k in TEXT_KEYS else int(v)) for k, v in config.items()} or None
    started = time.perf_counter()
    rows, series = run_games(
        parse_seeds(args.seeds),
        names,
        jobs=args.jobs,
        label=args.label,
        days=args.days,
        config=config_ints,
        overrides=parse_set(args.set),
        core=args.core,
        stop_tick=args.stop_day * TICKS_PER_DAY if args.stop_day else None,
        progress=_progress,
    )
    write_csv(out / "games.csv", COLUMNS, rows)
    write_csv(out / "reach.csv", REACH_COLUMNS, series)
    (out / "run.json").write_text(
        json.dumps(
            {
                "label": args.label,
                "seeds": args.seeds,
                "bots": names,
                "days": args.days,
                "set": args.set,
                "config": args.config,
                "core": args.core,
                "seconds": round(time.perf_counter() - started, 1),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(table(summarise([{k: str(v) for k, v in r.items()} for r in rows])))
    return 0


def cmd_report(args: argparse.Namespace) -> int:
    for path in args.runs:
        directory = Path(path)
        rows = read_csv(directory / "games.csv")
        print(f"== {directory.name} ({len(rows)} games)")
        summary = summarise(rows)
        print(table(summary))
        if any(r.get("errands_planned", "") != "" for r in rows):
            print(night_table(summary))
        series = read_csv(directory / "reach.csv")
        chain, blame = reach_times(series, "chain"), reach_times(series, "blame")
        for bot in dict.fromkeys(r["bot"] for r in rows):
            half, most = chain[f"{bot}.t50"], chain[f"{bot}.t75"]
            print(
                f"   {bot}: the clerk's story is at half of the town after {half:.1f} h and at "
                f"three quarters after {most:.1f} h (median game); the blame is at half after "
                f"{blame[f'{bot}.t50']:.1f} h"
            )
    return 0


def clock_text(tick: int) -> str:
    day, rest = divmod(tick, TICKS_PER_DAY)
    if rest < DAY_TICKS:
        hour, minute = 6 + rest // 120, rest % 120 // 2
    else:
        hour, minute = (21 + (rest - DAY_TICKS) // 30) % 24, (rest - DAY_TICKS) % 30 * 2
    return f"d{day + 1} {hour:02d}:{minute:02d}"


def cmd_play(args: argparse.Namespace) -> int:
    """Play one game and print what the bot did and what came of it."""
    log: list[Any] = []
    row, _ = play_game(
        args.seed,
        args.bot,
        days=args.days,
        overrides=parse_set(args.set),
        stop_tick=args.stop_tick,
        log=log,
    )
    bot = log.pop()[1]
    lines = [(tick, 0, f"{clock_text(tick)}  {text}  -> {why}") for tick, text, why in bot.trace]
    for tick, event in log:
        if event["kind"] == "told" and event.get("speaker") != "player":
            continue
        shown = {k: v for k, v in event.items() if k not in ("kind", "tick", "reveal", "label")}
        lines.append((tick, 1, f"{clock_text(tick)}    [{event['kind']}] {shown}"))
    for _, _, text in sorted(lines, key=lambda line: (line[0], line[1])):
        print(text)
    print({k: row[k] for k in COLUMNS if row[k] != ""})
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="balance", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run", help="play seeds with bots and write the tallies")
    run.add_argument("--seeds", default="1-50")
    run.add_argument("--bots", default="all", help="comma separated names, or all")
    run.add_argument("--jobs", type=int, default=8)
    run.add_argument("--days", type=int, default=5)
    run.add_argument("--label", default="")
    run.add_argument("--stop-day", type=int, default=None, help="end every game after this day")
    run.add_argument("--out", required=True)
    run.add_argument("--set", action="append", default=[], metavar="MODULE.NAME=VALUE")
    run.add_argument("--config", action="append", default=[], metavar="KEY=VALUE")
    run.add_argument("--core", default=None, metavar="DIR")
    run.set_defaults(func=cmd_run)
    report = sub.add_parser("report", help="print the tables of one or more runs")
    report.add_argument("runs", nargs="+")
    report.set_defaults(func=cmd_report)
    play = sub.add_parser("play", help="play one game and print what happened")
    play.add_argument("seed", type=int)
    play.add_argument("bot")
    play.add_argument("--days", type=int, default=5)
    play.add_argument("--stop-tick", type=int, default=None)
    play.add_argument("--set", action="append", default=[], metavar="MODULE.NAME=VALUE")
    play.set_defaults(func=cmd_play)
    args = parser.parse_args(argv)
    if getattr(args, "core", None):
        sys.path.insert(0, args.core)
    if args.command == "run" and args.jobs > 16:
        raise SystemExit("balance: at most 16 processes")
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
