"""The m0 scenario: twelve townsfolk on a river-town grid, and chatter that asks a model.

It exists to exercise the whole contract before any cognition does. Nobody here thinks. Twelve
NPCs follow integer schedules over a 48 by 32 grid with a river and one bridge: home at dawn,
work from the first hour, tea in the evening, home again. They walk along shortest-path fields
(``grid.py``), take small random detours and fidget when they stand still, and whenever two of
them are adjacent an ``encounter`` event fires, with a cooldown per pair. At some encounters a
fake ``chatter`` request goes out to a model. Its answer is shown as a line of talk, a timeout
becomes a template line, and the request is cancelled if the pair parts or the chat runs out
before it lands.

Time: at rate 1/1 a game day is ``12 * ticks_per_hour`` ticks, 1,800 by default, which is the
three real minutes of a day's daylight at 10 ticks a second. The day runs from 06:00 to 18:00
and wraps. The m0 world has no night. A game hour is a whole number of ticks, and the minute
shown on a frame is ``tick_in_hour * 60 // ticks_per_hour``, so nothing here is fractional.

State (``state["world"]``)::

    {"npcs": [{"id", "x", "y", "goal": [x, y], "sched": [x, y], "hold": tick or 0}, ...],
     "pairs": {"npc00|npc01": tick of their last encounter},
     "interactions": [{"id", "a", "b", "opened", "request"}, ...]}

``sched`` is where the schedule says the NPC should be, ``goal`` is where it is heading (the
same unless a player action holds it elsewhere until tick ``hold``). Lists keep their order
through a snapshot and dicts are only ever looked up by key, never walked, because a restored
dict comes back in sorted key order.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core import canon
from lantern_core.inputs import InputError, int_field
from lantern_core.rng import Pcg32
from lantern_core.world.grid import UNREACHABLE, Grid

if TYPE_CHECKING:
    from lantern_core.kernel import Ctx

WIDTH, HEIGHT = 48, 32
TERRAIN_COST = {".": 3, ",": 1, "=": 1, "#": 0, "~": 0}
LEGEND = {".": "grass", ",": "road", "=": "bridge", "#": "blocked", "~": "river"}
DAY_HOURS = 12
DAWN_HOUR = 6
# Hours after dawn at which the schedule changes, and the ticks by which the NPCs are staggered.
WORK_HOUR, TEA_HOUR, HOME_HOUR = 1, 9, 11
STAGGER_WORK, STAGGER_TEA, STAGGER_HOME = 7, 11, 8
DETOUR_SLACK = 4
FIDGET_RADIUS = 2
CHAT_TIER = "cheap"
CHAT_MAX_TOKENS = 48
MAX_CHATTER_CHARS = 80

DEFAULT_CONFIG: dict[str, int] = {
    "ticks_per_hour": 150,
    "move_period": 3,
    "detour_per_mille": 60,
    "fidget_per_mille": 40,
    "encounter_cooldown": 600,
    "chatter_per_mille": 600,
    "max_in_flight": 8,
    "chat_window": 120,
    "summon_hold": 300,
}
_CONFIG_RANGES = {
    "ticks_per_hour": (100, 100_000),
    "move_period": (1, 100),
    "detour_per_mille": (0, 1000),
    "fidget_per_mille": (0, 1000),
    "encounter_cooldown": (1, 1_000_000),
    "chatter_per_mille": (0, 1000),
    "max_in_flight": (1, 1000),
    "chat_window": (1, 1_000_000),
    "summon_hold": (1, 1_000_000),
}

# Top-left corners of the twelve 3x2 houses. The door is the cell below the middle.
HOUSES = (
    (3, 4), (8, 4), (13, 4), (3, 22), (8, 22), (13, 22),
    (28, 4), (33, 4), (38, 4), (28, 22), (33, 22), (38, 22),
)  # fmt: skip
TREES = (
    (1, 10), (1, 11), (2, 10), (5, 12), (5, 13), (6, 18), (7, 18), (6, 19), (16, 18), (17, 18),
    (38, 18), (39, 18), (39, 19), (44, 9), (44, 10), (45, 10), (44, 27), (45, 27), (12, 29),
    (13, 29), (13, 30), (30, 27), (31, 27), (31, 28),
    (46, 28), (45, 29), (47, 29), (46, 30),  # a walled garden around the walkable cell (46, 29)
)  # fmt: skip
WORK_CELLS = {
    "dock": ((20, 10), (20, 11), (20, 12)),
    "market": ((9, 12), (10, 12), (11, 12)),
    "forge": ((30, 19), (31, 19), (32, 19)),
    "mill": ((40, 12), (41, 12), (42, 12)),
}
SEATS = (
    (30, 10), (31, 10), (32, 10), (33, 10), (34, 10),
    (30, 11), (31, 11), (32, 11), (33, 11), (34, 11),
    (31, 12), (33, 12),
)  # fmt: skip
# Named areas as (id, x, y, width, height), for messages and for the client.
PLACES = (
    ("teahouse", 29, 9, 7, 5),
    ("bridge", 22, 15, 3, 2),
    ("dock", 20, 10, 1, 3),
    ("market", 9, 12, 3, 1),
    ("forge", 30, 19, 3, 1),
    ("mill", 40, 12, 3, 1),
)
# The parts of the day as (first hour that is no longer part of it, word for the prompt).
DAYPARTS = ((9, "清晨"), (12, "上午"), (15, "午后"), (24, "傍晚"))
PLACE_WORDS = {
    "teahouse": "茶馆里",
    "bridge": "桥上",
    "dock": "码头边",
    "market": "集市上",
    "forge": "铁匠铺前",
    "mill": "磨坊边",
}
# id, name, role, workplace. NPC i lives in house i.
NPCS = (
    ("npc00", "阿明", "船夫", "dock"),
    ("npc01", "小梅", "渔妇", "dock"),
    ("npc02", "老周", "杂货商", "market"),
    ("npc03", "春生", "裁缝", "market"),
    ("npc04", "秀兰", "铁匠", "forge"),
    ("npc05", "大壮", "磨坊工", "mill"),
    ("npc06", "阿福", "摆渡人", "dock"),
    ("npc07", "金宝", "木匠", "forge"),
    ("npc08", "玉娥", "织女", "mill"),
    ("npc09", "石头", "面点师", "market"),
    ("npc10", "三妹", "箍桶匠", "forge"),
    ("npc11", "老赵", "陶工", "mill"),
)
SYSTEM_PROMPT = "你是江南水乡小镇里的居民。请只写一句闲聊，不超过二十个字，不要加引号。"
TEMPLATES = (
    "{a}朝{b}点了点头。",
    "{a}和{b}聊起了天气。",
    "{a}问{b}吃过了没有。",
    "{a}和{b}互道了一声辛苦。",
)


def _river_span(y: int) -> tuple[int, int]:
    """The columns the river covers in row ``y``; it drifts east as it flows south."""
    if y < 10:
        return 21, 23
    if y < 22:
        return 22, 24
    return 23, 25


def _paint_map() -> list[str]:
    cells = [["."] * WIDTH for _ in range(HEIGHT)]

    def rect(char: str, x0: int, y0: int, x1: int, y1: int) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                cells[y][x] = char

    rect(",", 1, 15, 46, 16)  # the main road, over the bridge
    for y in (7, 25):
        rect(",", 2, y, 19, y)
        rect(",", 27, y, 45, y)
    rect(",", 19, 7, 19, 25)
    rect(",", 27, 7, 27, 25)
    rect(",", 10, 7, 10, 15)
    rect(",", 41, 7, 41, 15)
    rect(",", 31, 17, 31, 18)
    for y in range(HEIGHT):
        low, high = _river_span(y)
        rect("=" if y in (15, 16) else "~", low, y, high, y)
    for x0, y0 in HOUSES:
        rect("#", x0, y0, x0 + 2, y0 + 1)
    rect("#", 29, 9, 35, 13)  # the teahouse walls, then its floor and its door in the south wall
    rect(",", 30, 10, 34, 12)
    rect(",", 32, 13, 32, 14)
    for x, y in TREES:
        cells[y][x] = "#"
    return ["".join(row) for row in cells]


ROWS = _paint_map()
# One grid for every game in the process. Its cache of shortest-path fields is a pure function
# of the map, so sharing it changes how fast a game runs and nothing about what it does.
_GRID = Grid(ROWS, TERRAIN_COST)


def door(house: int) -> tuple[int, int]:
    x0, y0 = HOUSES[house]
    return x0 + 1, y0 + 2


def _work_cell(npc: int) -> tuple[int, int]:
    place = NPCS[npc][3]
    mates = [i for i, row in enumerate(NPCS) if row[3] == place]
    return WORK_CELLS[place][mates.index(npc)]


def _pair_key(a: str, b: str) -> str:
    return f"{a}|{b}"


class M0World:
    """The m0 scenario for a given config (see ``DEFAULT_CONFIG``)."""

    name = "m0"

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        merged = dict(DEFAULT_CONFIG)
        for key, value in (config or {}).items():
            if key not in DEFAULT_CONFIG:
                raise ValueError(f"unknown m0 config key {key!r}")
            merged[key] = value
        for key, (low, high) in _CONFIG_RANGES.items():
            if type(merged[key]) is not int or not low <= merged[key] <= high:
                raise ValueError(f"m0 config {key} must be an int in [{low}, {high}]")
        self.config = merged
        self.grid = _GRID
        self.ticks_per_hour = merged["ticks_per_hour"]
        self.day_ticks = DAY_HOURS * self.ticks_per_hour
        self.npc_index = {row[0]: i for i, row in enumerate(NPCS)}
        self.pair_keys = [[_pair_key(a[0], b[0]) for b in NPCS] for a in NPCS]
        self._content_hash: str | None = None
        # day tick -> ((npc, x, y), ...): where each NPC's schedule sends it at that tick
        due: dict[int, list[tuple[int, int, int]]] = {}
        tph = self.ticks_per_hour
        for i in range(len(NPCS)):
            stops = (
                (0, door(i)),
                (WORK_HOUR * tph + STAGGER_WORK * i, _work_cell(i)),
                (TEA_HOUR * tph + STAGGER_TEA * i, SEATS[i]),
                (HOME_HOUR * tph + STAGGER_HOME * i, door(i)),
            )
            for start, (x, y) in stops:
                due.setdefault(start, []).append((i, x, y))
        self._due = {start: tuple(rows) for start, rows in due.items()}

    # ------------------------------------------------------------------ static content

    def content(self) -> dict[str, Any]:
        """Everything about the scenario that does not depend on the config or the seed."""
        return {
            "scenario": self.name,
            "rows": ROWS,
            "costs": TERRAIN_COST,
            "houses": [list(h) for h in HOUSES],
            "work_cells": {k: [list(c) for c in v] for k, v in WORK_CELLS.items()},
            "seats": [list(s) for s in SEATS],
            "places": [list(p) for p in PLACES],
            "npcs": [list(n) for n in NPCS],
            "hours": [DAWN_HOUR, DAY_HOURS, WORK_HOUR, TEA_HOUR, HOME_HOUR],
            "stagger": [STAGGER_WORK, STAGGER_TEA, STAGGER_HOME],
            "prompt": SYSTEM_PROMPT,
            "templates": list(TEMPLATES),
            "words": {"dayparts": [list(d) for d in DAYPARTS], "places": PLACE_WORDS},
            "chat": [CHAT_TIER, CHAT_MAX_TOKENS, MAX_CHATTER_CHARS],
        }

    def content_hash(self) -> str:
        if self._content_hash is None:
            self._content_hash = canon.digest(self.content())
        return self._content_hash

    def scene(self) -> dict[str, Any]:
        """What a client needs to draw the town: the terrain rows, the places and the cast."""
        return {
            "scenario": self.name,
            "width": WIDTH,
            "height": HEIGHT,
            "rows": list(ROWS),
            "legend": dict(LEGEND),
            "places": [{"id": p[0], "x": p[1], "y": p[2], "w": p[3], "h": p[4]} for p in PLACES],
            "npcs": [{"id": n[0], "name": n[1], "role": n[2]} for n in NPCS],
            "ticks_per_hour": self.ticks_per_hour,
            "day_ticks": self.day_ticks,
            "dawn_hour": DAWN_HOUR,
        }

    # ------------------------------------------------------------------ state and inputs

    def new_state(self, rng: Pcg32) -> dict[str, Any]:
        npcs = []
        for i, row in enumerate(NPCS):
            x, y = door(i)
            npcs.append({"id": row[0], "x": x, "y": y, "goal": [x, y], "sched": [x, y], "hold": 0})
        return {"npcs": npcs, "pairs": {}, "interactions": []}

    def validate_player(self, body: dict[str, Any]) -> dict[str, Any]:
        """The m0 world's one player action is ``summon``: an NPC walks to a cell and waits."""
        where = "player action"
        kind = body.get("type")
        if kind != "summon":
            raise InputError(f"{where}: unknown type {kind!r}")
        npc = body.get("npc")
        if not isinstance(npc, str) or npc not in self.npc_index:
            raise InputError(f"{where}: unknown npc {npc!r}")
        return {
            "action_id": body["action_id"],
            "type": kind,
            "npc": npc,
            "x": int_field(body.get("x"), where, "x", 0, WIDTH - 1),
            "y": int_field(body.get("y"), where, "y", 0, HEIGHT - 1),
        }

    def apply_player(self, ctx: Ctx, body: dict[str, Any]) -> None:
        grid = self.grid
        npc = ctx.state["world"]["npcs"][self.npc_index[body["npc"]]]
        goal = grid.index(body["x"], body["y"])
        reason = None
        if not grid.walkable(goal):
            reason = "blocked"
        elif grid.field(goal)[grid.index(npc["x"], npc["y"])] >= UNREACHABLE:
            reason = "unreachable"
        if reason is None:
            npc["goal"] = [body["x"], body["y"]]
            npc["hold"] = ctx.tick + self.config["summon_hold"]
        ctx.emit(
            "action_ack",
            action_id=body["action_id"],
            result="applied" if reason is None else "rejected",
            reason=reason,
        )

    # ------------------------------------------------------------------ one tick

    def simulate(self, ctx: Ctx) -> None:
        self._follow_schedule(ctx)
        self._walk(ctx)
        self._close_interactions(ctx)
        self._meet(ctx)

    def _follow_schedule(self, ctx: Ctx) -> None:
        npcs = ctx.state["world"]["npcs"]
        for i, x, y in self._due.get(ctx.tick % self.day_ticks, ()):
            npcs[i]["sched"] = [x, y]
            if not npcs[i]["hold"]:
                npcs[i]["goal"] = [x, y]
        for npc in npcs:
            if npc["hold"] and ctx.tick >= npc["hold"]:
                npc["hold"] = 0
                npc["goal"] = list(npc["sched"])

    def _walk(self, ctx: Ctx) -> None:
        """Move every NPC whose turn it is by one cell: toward its goal, or a fidget in place.

        NPC ``i`` has its turn on the ticks where ``(tick + i) % move_period == 0``. Each turn
        draws one number from the RNG, and a second one to pick the cell when the first falls
        under the detour or fidget rate and there is a cell to pick from.
        """
        grid, rng, cfg = self.grid, ctx.rng, self.config
        period = cfg["move_period"]
        for i, npc in enumerate(ctx.state["world"]["npcs"]):
            if (ctx.tick + i) % period:
                continue
            here = grid.index(npc["x"], npc["y"])
            goal = grid.index(npc["goal"][0], npc["goal"][1])
            roll = rng.below(1000)
            if here == goal:
                if roll < cfg["fidget_per_mille"]:
                    gx, gy = npc["goal"]
                    near = [
                        n
                        for n in grid.neighbours(here)
                        if max(abs(grid.xy(n)[0] - gx), abs(grid.xy(n)[1] - gy)) <= FIDGET_RADIUS
                    ]
                    if near:
                        npc["x"], npc["y"] = grid.xy(near[rng.below(len(near))])
                continue
            field = grid.field(goal)
            step = grid.best_step(here, field)
            if roll < cfg["detour_per_mille"]:
                aside = [n for n in grid.detour_steps(here, field, DETOUR_SLACK) if n != step]
                if aside:
                    step = aside[rng.below(len(aside))]
            if step != here:
                npc["x"], npc["y"] = grid.xy(step)

    def _close_interactions(self, ctx: Ctx) -> None:
        """End the chats whose pair has parted or whose time is up."""
        world = ctx.state["world"]
        for interaction in list(world["interactions"]):
            a = world["npcs"][self.npc_index[interaction["a"]]]
            b = world["npcs"][self.npc_index[interaction["b"]]]
            if max(abs(a["x"] - b["x"]), abs(a["y"] - b["y"])) > 1:
                self._settle(ctx, interaction, "parted")
            elif ctx.tick - interaction["opened"] >= self.config["chat_window"]:
                self._settle(ctx, interaction, "ended")

    def _meet(self, ctx: Ctx) -> None:
        """Fire an encounter for every adjacent pair that has not had one for a while."""
        world = ctx.state["world"]
        npcs, pairs = world["npcs"], world["pairs"]
        cooldown = self.config["encounter_cooldown"]
        opened = 0
        for i in range(len(npcs) - 1):
            a = npcs[i]
            for j in range(i + 1, len(npcs)):
                b = npcs[j]
                if abs(a["x"] - b["x"]) > 1 or abs(a["y"] - b["y"]) > 1:
                    continue
                key = self.pair_keys[i][j]
                last = pairs.get(key)
                if last is not None and ctx.tick - last < cooldown:
                    continue
                pairs[key] = ctx.tick
                if self._encounter(ctx, i, j, opened):
                    opened += 1

    def _encounter(self, ctx: Ctx, i: int, j: int, opened: int) -> bool:
        """Announce a meeting and maybe start a chat. True if a chat was opened."""
        world = ctx.state["world"]
        a, b = world["npcs"][i], world["npcs"][j]
        chat = ctx.rng.below(1000) < self.config["chatter_per_mille"]
        chat = chat and len(ctx.state["requests"]) < self.config["max_in_flight"]
        chat = chat and not any(
            a["id"] in (it["a"], it["b"]) or b["id"] in (it["a"], it["b"])
            for it in world["interactions"]
        )
        interaction_id = f"i{ctx.tick}-{opened}" if chat else None
        ctx.emit(
            "encounter", a=a["id"], b=b["id"], x=a["x"], y=a["y"], interaction_id=interaction_id
        )
        if not chat:
            return False
        request_id = ctx.issue(
            interaction_id=interaction_id,
            tier=CHAT_TIER,
            category="chatter",
            messages=self._chat_messages(ctx.tick, i, j, a, b),
            max_tokens=CHAT_MAX_TOKENS,
            valid_if=[
                {"op": "adjacent", "a": a["id"], "b": b["id"]},
                {"op": "open", "interaction_id": interaction_id},
            ],
        )
        world["interactions"].append(
            {
                "id": interaction_id,
                "a": a["id"],
                "b": b["id"],
                "opened": ctx.tick,
                "request": request_id,
            }
        )
        return True

    def _chat_messages(
        self, tick: int, i: int, j: int, a: dict[str, Any], b: dict[str, Any]
    ) -> list[dict[str, str]]:
        hour = DAWN_HOUR + (tick % self.day_ticks) // self.ticks_per_hour
        when = next(word for limit, word in DAYPARTS if hour < limit)
        where = "街上"
        for place, px, py, w, h in PLACES:
            if px <= a["x"] < px + w and py <= a["y"] < py + h:
                where = PLACE_WORDS[place]
                break
        na, ra = NPCS[i][1], NPCS[i][2]
        nb, rb = NPCS[j][1], NPCS[j][2]
        user = f"{when}，{where}。{na}（{ra}）遇见了{nb}（{rb}）。{na}对{nb}说："
        return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]

    def _settle(self, ctx: Ctx, interaction: dict[str, Any], outcome: str) -> None:
        ctx.state["world"]["interactions"].remove(interaction)
        ctx.emit("interaction_end", interaction_id=interaction["id"], outcome=outcome)

    # ------------------------------------------------------------------ requests and frames

    def holds(self, state: dict[str, Any], condition: dict[str, Any]) -> bool:
        """Conditions of a chatter request: its pair is still adjacent, its chat still open."""
        op = condition["op"]
        world = state["world"]
        if op == "adjacent":
            a = world["npcs"][self.npc_index[condition["a"]]]
            b = world["npcs"][self.npc_index[condition["b"]]]
            return max(abs(a["x"] - b["x"]), abs(a["y"] - b["y"])) <= 1
        if op == "open":
            return any(it["id"] == condition["interaction_id"] for it in world["interactions"])
        raise ValueError(f"unknown condition {op!r}")

    def on_result(self, ctx: Ctx, request: dict[str, Any], status: str, text: str) -> None:
        interaction = None
        for candidate in ctx.state["world"]["interactions"]:
            if candidate["id"] == request["interaction_id"]:
                interaction = candidate
                break
        if interaction is None:
            return
        if status == "cancelled":
            self._settle(ctx, interaction, "cancelled")
            return
        line = text.strip()[:MAX_CHATTER_CHARS] if status == "ok" else ""
        source = "model"
        if not line:
            source = "template"
            name_a = NPCS[self.npc_index[interaction["a"]]][1]
            name_b = NPCS[self.npc_index[interaction["b"]]][1]
            line = ctx.rng.choice(TEMPLATES).format(a=name_a, b=name_b)
        ctx.emit(
            "chatter",
            interaction_id=interaction["id"],
            a=interaction["a"],
            b=interaction["b"],
            text=line,
            source=source,
        )
        self._settle(ctx, interaction, "chatted" if source == "model" else "template")

    def rate(self, state: dict[str, Any]) -> tuple[int, int]:
        """The m0 world always runs at the normal speed."""
        return (1, 1)

    def frame(self, state: dict[str, Any]) -> dict[str, Any]:
        tick = state["tick"]
        day_tick = tick % self.day_ticks
        tph = self.ticks_per_hour
        return {
            "npcs": [{"id": n["id"], "x": n["x"], "y": n["y"]} for n in state["world"]["npcs"]],
            "time": {
                "day": tick // self.day_ticks + 1,
                "hour": DAWN_HOUR + day_tick // tph,
                "minute": day_tick % tph * 60 // tph,
            },
        }
