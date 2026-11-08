"""Where a player who only follows the task card gets stuck.

Plays the follower bot (``tools/bots/follower.py``) to the end of the fifth day on a list of games
and writes, for each game, how it ended, the timeline of the tasks, and every stall the bot met,
each with the hour and what the frame showed. The games are the one the opening page starts (the
preset ``slice``: seed 492 and its config), the same config with other seeds, and the default
config.

    python tools/follow_report.py --out RUNDIR [--slice 492,1-4] [--default 1-2] [--jobs 4]
                                  [--mode tracked|list] [--variant v_flood=1-4 ...]

``--variant ID=SEEDS`` (it may be given more than once) adds games of the slice rules with another
story true, as ``api.preset("slice", seed=..., variant=...)`` makes them: ``--variant
v_flood=1-4 --variant v_drunk=1-4`` plays four seeds of each of the other two truths.

``RUNDIR`` gets ``follow_report.md`` (for people) and ``follow_games.json`` (the same, as data),
and the console gets one line for each game. A game of the follower takes about ten seconds. The
bot follows the task that the game follows (``--mode tracked``, the default), as a player does who
reads the top bar; ``--mode list`` lets it pick its own card each call, for diagnosis.

The bot sees only what a page sees. This module is the referee, as ``balance`` is: it reads the
ending and the flags after the fact, and does not tell the bot anything.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from collections.abc import Sequence
from concurrent.futures import ProcessPoolExecutor
from multiprocessing import get_context
from pathlib import Path
from typing import Any

import balance
from bots.follower import MODES

KINDS = (
    "no_live_task",
    "blocked_long",
    "rejected",
    "cannot_carry_out",
    "no_effect",
    "no_next_step",
)
SLICE, DEFAULT = "slice", "default"
DEFAULT_SLICE_SEEDS, DEFAULT_OTHER_SEEDS = "492,1-4", "1-2"
SAME_VISIT = 100  # ticks (fifty minutes of daylight) between two acts of one visit


# ---------------------------------------------------------------------------- one game


def plan_games(
    slice_seeds: Sequence[int],
    default_seeds: Sequence[int],
    mode: str = "tracked",
    variants: Sequence[tuple[str, Sequence[int]]] = (),
) -> list[dict[str, Any]]:
    """The games to play, in the order of the report: the slice, the slice with another story
    true (``variants``: a variant id and the seeds to play it at), then the default config."""
    from lantern_core.api import preset

    slice_config = dict(preset(SLICE)["config"])
    games = [
        {"label": f"{SLICE}-{seed}", "seed": seed, "config": slice_config, "kind": SLICE}
        for seed in slice_seeds
    ]
    for variant, seeds in variants:
        for seed in seeds:
            named = preset(SLICE, seed=seed, variant=variant)
            games.append(
                {
                    "label": f"{SLICE}-{variant}-{seed}",
                    "seed": named["seed"],
                    "config": named["config"],
                    "kind": SLICE,
                    "variant": variant,
                }
            )
    games += [
        {"label": f"{DEFAULT}-{seed}", "seed": seed, "config": None, "kind": DEFAULT}
        for seed in default_seeds
    ]
    for game in games:
        game["mode"] = mode
    return games


ROW_KEYS = (
    "bridge_state",
    "work_percent",
    "helpers",
    "crew_day",
    "promises",
    "promises_kept",
    "promises_broken",
    "truth_day",
    "bamboo_day",
    "timber_day",
    "households",
    "turnout",
    "actions",
    "rejected",
    "ticks",
    "hash",
)


def play(game: dict[str, Any]) -> dict[str, Any]:
    """Play one game with the follower and distil what the report needs, as plain data. A game
    that raises is reported as such, with its traceback, and does not take the others with it."""
    try:
        return distil(game)
    except Exception:
        return {
            "label": game["label"],
            "seed": game["seed"],
            "kind": game["kind"],
            "variant": game.get("variant", ""),
            "mode": game.get("mode", "tracked"),
            "seconds": 0.0,
            "ending": "none",
            "passage": "",
            "row": dict.fromkeys(ROW_KEYS, ""),
            "flags": {},
            "deliveries": [],
            "tasks": {},
            "timeline": [],
            "stalls": [],
            "notes": [],
            "statements": [],
            "error": traceback.format_exc(limit=-6),
        }


def distil(game: dict[str, Any]) -> dict[str, Any]:
    log: list[Any] = []
    started = time.perf_counter()
    row, _ = balance.play_game(
        game["seed"],
        "follower",
        label=game["label"],
        days=game.get("days", 5),
        config=game["config"],
        sample_every=10**9,  # the report has no use for the spread of the rumour
        log=log,
        bot_options={"mode": game.get("mode", "tracked")},
    )
    seconds = time.perf_counter() - started
    bot = log.pop()[1]
    return {
        "label": game["label"],
        "seed": game["seed"],
        "kind": game["kind"],
        "variant": game.get("variant", ""),
        "mode": game.get("mode", "tracked"),
        "seconds": round(seconds, 1),
        "ending": row["ending"],
        "passage": row["passage"],
        "row": {k: row[k] for k in ROW_KEYS},
        "flags": dict(bot.flags),
        "deliveries": bot.deliveries,
        "tasks": bot.tasks,
        "timeline": bot.timeline,
        "stalls": bot.stalls,
        "notes": bot.notes,
        "statements": [
            {key: event[key] for key in ("tick", "named", "accepted", "proof", "told", "wrong")}
            for event in bot.stated
        ],
    }


def play_all(games: Sequence[dict[str, Any]], jobs: int) -> list[dict[str, Any]]:
    if jobs <= 1:
        return [play(game) for game in games]
    tools = str(Path(__file__).resolve().parent)
    with ProcessPoolExecutor(
        max_workers=jobs,
        mp_context=get_context("spawn"),
        initializer=balance._start_worker,  # the same set-up as its own workers
        initargs=(None, tools),
    ) as pool:
        return list(pool.map(play, games, chunksize=1))


# ---------------------------------------------------------------------------- words


def clock(tick: int) -> str:
    return balance.clock_text(tick)


def hour_of(result: dict[str, Any], *flags: str) -> str:
    """The hour of the first of these flags that was raised, else ``never``."""
    ticks = [result["flags"][f] for f in flags if f in result["flags"]]
    return clock(min(ticks)) if ticks else "never"


def counts(stalls: Sequence[dict[str, Any]]) -> str:
    """``rejected 2, no_effect 1``: how many stalls of each kind, passing refusals apart."""
    parts = []
    for kind in KINDS:
        mine = [s for s in stalls if s["kind"] == kind]
        if not mine:
            continue
        passing = sum(1 for s in mine if s.get("transient"))
        text = f"{kind} {len(mine)}"
        parts.append(text + (f" ({passing} passing)" if passing else ""))
    return ", ".join(parts) or "none"


def bridge_text(result: dict[str, Any]) -> str:
    """When the bridge was mended, else when the detour was ready, else ``never``."""
    if "bridge_fixed" in result["flags"]:
        return clock(result["flags"]["bridge_fixed"])
    if "detour_done" in result["flags"]:
        return "detour " + clock(result["flags"]["detour_done"])
    return "never"


def summary(result: dict[str, Any]) -> str:
    """One line for the console."""
    if "error" in result:
        return f"{result['label']:<12} CRASHED: {result['error'].strip().splitlines()[-1]}"
    first = next((d for d in result["deliveries"] if d["item"] == "bamboo"), None)
    bamboo = clock(first["tick"]) if first else "never"
    return (
        f"{result['label']:<12} {result['ending']:<14} bridge {bridge_text(result):<16}"
        f" truth {hour_of(result, 'truth_told'):<9} peace {hour_of(result, 'reconciled'):<9}"
        f" first bamboo {bamboo:<9} helpers {result['row']['helpers']}"
        f" promises kept {result['row']['promises_kept']}/{result['row']['promises']}"
        f" stalls: {counts(result['stalls'])}  ({result['seconds']} s)"
    )


def task_line(task: dict[str, Any]) -> str:
    text = f"{task['id']} {task['state']}"
    action = task["action"]
    if action:
        text += " [" + " ".join(f"{k}={v}" for k, v in action.items()) + "]"
    window = task["window"]
    if window:
        text += f" window d{window['day']} {window['from']}-{window['to']} {window['place']}"
    for key in ("blocker", "next"):
        if task[key]:
            text += f"; {key}: {task[key]}"
    return text


def frame_lines(frame: dict[str, Any]) -> list[str]:
    bridge = frame["bridge"]
    head = (
        f"frame at {frame['clock']}: player at {frame['at'][0]},{frame['at'][1]}, "
        f"following {frame['tracked']}, bridge {bridge.get('state')} {bridge.get('percent')}%, "
        f"jobs open: {', '.join(frame['jobs_open']) or 'none'}"
    )
    return [head, *(f"  - {task_line(t)}" for t in frame["tasks"])]


def stall_lines(number: int, stall: dict[str, Any]) -> list[str]:
    note = ""
    if stall.get("transient"):
        note = " (passing: not now)"
    elif stall.get("explained"):
        note = " (the card changed at once and says why)"
    again = f", {stall['count']} times, last {clock(stall['last'])}" if stall["count"] > 1 else ""
    head = f"{number}. **{stall['frame']['clock']} {stall['kind']}**"
    head += f" `{stall['task'] or '-'}` {stall['reason']}{note}{again}"
    return [head, f"   {stall['detail']}", *(f"   {line}" for line in frame_lines(stall["frame"]))]


def what_game(result: dict[str, Any]) -> str:
    if result["kind"] == DEFAULT:
        return "default config"
    if result.get("variant"):
        return f"slice rules, {result['variant']} true, seed {result['seed']}"
    return "the opening page's game" if result["seed"] == 492 else "slice config, another seed"


def timeline_lines(timeline: Sequence[dict[str, Any]]) -> list[str]:
    """The timeline in order, the acts of one kind that came together in one line."""
    entries = sorted(timeline, key=lambda e: e["tick"])
    lines, i = [], 0
    while i < len(entries):
        entry = entries[i]
        task = f"`{entry['task'] or '-'}`"
        if entry["kind"] != "did":
            lines.append(f"- {entry['clock']} {entry['kind']} {task} {entry['detail']}".rstrip())
            i += 1
            continue
        run = [entry]
        while (
            i + len(run) < len(entries)
            and entries[i + len(run)]["kind"] == "did"
            and entries[i + len(run)]["task"] == entry["task"]
            and entries[i + len(run)]["verb"] == entry["verb"]
            and entries[i + len(run)]["tick"] - run[-1]["tick"] <= SAME_VISIT
        ):
            run.append(entries[i + len(run)])
        i += len(run)
        if len(run) == 1:
            lines.append(f"- {entry['clock']} did {task} {entry['detail']}")
            continue
        fields = ", ".join(e["detail"].split(": ")[0].split(" ", 1)[1] for e in run)
        results = {e["outcome"] for e in run}
        outcome = "ok" if results == {"ok"} else ", ".join(e["outcome"] for e in run)
        lines.append(
            f"- {entry['clock']} did {task} {entry['verb']} x{len(run)} ({fields}): {outcome}"
        )
    return lines


def game_lines(number: int, result: dict[str, Any]) -> list[str]:
    if "error" in result:
        title = f"## {number}. {result['label']} ({what_game(result)})"
        return [
            title,
            "",
            "The game raised an exception:",
            "",
            "```",
            result["error"].strip(),
            "```",
            "",
        ]
    row = result["row"]
    first = next((d for d in result["deliveries"] if d["item"] == "bamboo"), None)
    if first is None:
        bamboo = "not delivered"
    else:
        there = "the bot was at the bridge" if first["stood_there"] else "the bot was elsewhere"
        bamboo = f"delivered {clock(first['tick'])} ({there})"
    kind = what_game(result)
    lines = [
        f"## {number}. {result['label']} ({kind})",
        "",
        f"- ending: {result['ending']}, passage {result['passage'] or 'none'}; "
        f"turnout {row['turnout']}, households {row['households']}, helpers {row['helpers']}"
        f" (the crew ready on day {row['crew_day'] or 'never'}), promises made "
        f"{row['promises']}, kept {row['promises_kept']}, broken {row['promises_broken']}",
        f"- bridge: {row['bridge_state']} {row['work_percent']}%; mended: "
        f"{hour_of(result, 'bridge_fixed')}; detour ready: {hour_of(result, 'detour_done')}",
        f"- truth told: {hour_of(result, 'truth_told')}; "
        f"reconciled: {hour_of(result, 'reconciled')}",
        "- full statements: "
        + (
            ", ".join(
                f"{clock(s['tick'])} ({'told' if s['told'] else 'did not tell'}"
                + (f", parts that did not hold: {'/'.join(s['wrong'])}" if s["wrong"] else "")
                + (", proof short" if not s["proof"] else "")
                + ")"
                for s in result.get("statements", [])
            )
            or "none"
        ),
        f"- first bamboo: {bamboo}; timber: "
        + ("delivered on day " + str(row["timber_day"]) if row["timber_day"] != "" else "never"),
        f"- flags: {', '.join(f'{f} {clock(t)}' for f, t in result['flags'].items()) or 'none'}",
        f"- stalls: {counts(result['stalls'])}; {row['actions']} actions, "
        f"{row['rejected']} refused; {result['seconds']} s",
        "",
        "### Timeline of the tasks",
        "",
    ]
    lines += timeline_lines(result["timeline"])
    lines += ["", "### Stalls", ""]
    if not result["stalls"]:
        lines.append("None.")
    for number, stall in enumerate(result["stalls"], start=1):
        lines += stall_lines(number, stall)
    if result["notes"]:
        lines += ["", "### Where the card did not say and the bot picked", ""]
        lines += [
            f"- {n['clock']} `{n['task']}` {n['what']}: {n['detail']}" for n in result["notes"]
        ]
    return [*lines, ""]


def render(results: Sequence[dict[str, Any]]) -> str:
    modes = sorted({r.get("mode", "tracked") for r in results})
    how = {
        "tracked": "following the task the game follows",
        "list": "picking its own card from the list",
    }
    lines = [
        "# What the follower met",
        "",
        f"The bot played {' and '.join(how[m] for m in modes)}. "
        "One line per game, then each game in full.",
        "",
    ]
    lines += [f"- {summary(r)}" for r in results]
    lines.append("")
    for number, result in enumerate(results, start=1):
        lines += game_lines(number, result)
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------- command line


def _variant_arg(text: str) -> tuple[str, list[int]]:
    """``v_flood=1-4``: a variant of the script and the seeds to play it at."""
    from lantern_core.world.bridge.world import CHOICE_CONFIG

    variant, _, seeds = text.partition("=")
    if variant not in CHOICE_CONFIG["variant"] or not seeds:
        raise argparse.ArgumentTypeError(
            f"{text!r}: write ID=SEEDS with ID one of {', '.join(CHOICE_CONFIG['variant'])}"
        )
    return variant, balance.parse_seeds(seeds)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="follow_report", description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", required=True, help="the directory the report is written to")
    parser.add_argument(
        "--slice", default=DEFAULT_SLICE_SEEDS, help="seeds of the slice config (empty for none)"
    )
    parser.add_argument(
        "--default",
        default=DEFAULT_OTHER_SEEDS,
        help="seeds of the default config (empty for none)",
    )
    parser.add_argument(
        "--variant",
        action="append",
        default=[],
        metavar="ID=SEEDS",
        type=_variant_arg,
        help="games of the slice rules with the story ID true at these seeds, such as "
        "v_flood=1-4; may be given more than once",
    )
    parser.add_argument("--jobs", type=int, default=4)
    parser.add_argument("--days", type=int, default=5)
    parser.add_argument(
        "--mode",
        choices=MODES,
        default=MODES[0],
        help="tracked: follow the task the game follows; list: pick a card of its own each call",
    )
    args = parser.parse_args(argv)
    if args.jobs > 8:
        raise SystemExit("follow_report: at most 8 processes")
    games = plan_games(
        balance.parse_seeds(args.slice) if args.slice else [],
        balance.parse_seeds(args.default) if args.default else [],
        args.mode,
        args.variant,
    )
    for game in games:
        game["days"] = args.days
    started = time.perf_counter()
    results = play_all(games, args.jobs)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "follow_report.md").write_text(render(results), encoding="utf-8")
    (out / "follow_games.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    for result in results:
        print(summary(result), flush=True)
    print(f"{len(results)} games in {time.perf_counter() - started:.0f} s; report in {out}")
    return 1 if any("error" in result for result in results) else 0


if __name__ == "__main__":
    sys.exit(main())
