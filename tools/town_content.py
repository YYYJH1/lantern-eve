"""Check the town map and the cast of a scenario, and compile them.

Build time only, like ``check_content``: the core never imports pydantic or yaml. This module is
called by ``check_content.validate`` and adds three kinds of output to what that function makes:

- ``map_<id>.json`` for each file of ``content/maps``, the terrain, the places and the barriers.
- ``cast_<id>.json`` for each file of ``content/cast``, the people with their traits, routines
  and holdings.
- ``core/lantern_core/world/<scenario>/data.py`` for each scenario in ``SCENARIOS``: the same
  two documents as Python data, with the compiled tables and the compiled script that the
  cast names, for the cognition model. The core cannot read a file, and the browser loads it
  as a wheel, so the content that a world needs travels inside the package. The module is
  generated and checked for staleness like the JSON, and a test holds it equal to the JSON.

What is checked, in short: the terrain uses only characters of its legend; every place has
cells that can be walked on and reached from the bridge; a building's footprint is solid and its
door is next to it; the barriers close what they say; every person's names agree with
``entities.yaml`` when the id is in it, every person has a bio there (what the town says of them,
which the compiled cast carries to the scene and to the prompts), every routine runs round the clock
and ends at home, every place a routine names exists, and the people and places of the scenario's
script are all in the town.
"""

from __future__ import annotations

import json
import re
from collections import deque
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from lantern_core import canon

# scenario -> (map id, cast id, path of the generated module relative to the repository root)
SCENARIOS = {
    "bridge": ("bridge_town", "bridge_v0", "core/lantern_core/world/bridge/data.py"),
}
PLACE_KINDS = (
    "house",
    "teahouse",
    "tavern",
    "hall",
    "temple",
    "school",
    "workshop",
    "post",
    "market",
    "bridge",
    "ferry",
    "lane",
    "bank",
    "water",
)
ROLE_TAGS = ("hub", "bridge", "gatekeeper", "witness")
DAWN_HOUR = 6  # the day of a routine starts here
OPS = ("level", "sharpen", "assimilate", "fill")
ID_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789_")
# the marks no sentence of the game uses, and the pronouns no sentence says of a person
BANNED = ("；", ";", "—", "–", "―", "－", "--", " - ")
PRONOUNS = {"zh": re.compile("[他她]"), "en": re.compile(r"\b(?:he|she|his|her|hers|him)\b", re.I)}
INTRO_LIMIT = {"zh": 60, "en": 200}  # characters of the one line the town says of a person
# What a person can ask in return for a favour: the promises of ``world/bridge/pledges.py`` (a test
# holds these equal to the core's), the rows of stalls, the roles, the wages the offers make and
# the places in the programme.
ASK_KINDS = ("stall", "role", "wage", "slot")
ASK_STALLS = ("front", "back")
ASK_ROLES = ("t_honor_light", "lead_lanterns", "stage_words")
ASK_WAGES = (10, 20)
ASK_SLOTS = 5


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------------------
# Models of the YAML
# --------------------------------------------------------------------------------------


class Named(Strict):
    id: str
    zh: str
    en: str


class LegendEntry(Strict):
    id: str
    zh: str
    en: str
    cost: int = Field(ge=0)


class PlaceIn(Strict):
    id: str
    zh: str
    en: str
    kind: str
    indoor: bool
    rect: list[int]
    door: list[int] | None = None
    stands: list[list[int]] = []
    footprints: list[list[int]] = []
    cells: list[list[int]] = []


class BarrierIn(Strict):
    id: str
    zh: str
    en: str
    place: str
    cells: list[list[int]]
    closed: str
    open: str


class TownFile(Strict):
    id: str
    zh: str
    en: str
    legend: dict[str, LegendEntry]
    rows: str
    weather: list[Named]
    phases: list[Named]
    places: list[PlaceIn]
    barriers: list[BarrierIn] = []


class Label(Strict):
    zh: str
    en: str


class Token(Strict):
    zh: str
    en: str


class Traits(Strict):
    gossip: int = Field(ge=0, le=100)
    conformity: int = Field(ge=0, le=100)
    suspicion: int = Field(ge=0, le=100)
    warmth: int = Field(ge=0, le=100)


class Ops(Strict):
    level: int = Field(ge=0, le=100)
    sharpen: int = Field(ge=0, le=100)
    assimilate: int = Field(ge=0, le=100)
    fill: int = Field(ge=0, le=100)


class Holding(Strict):
    item: str
    qty: int = Field(ge=1)
    at: str | None = None


class RoutineEntry(Strict):
    hour: int = Field(ge=0, le=23)
    act: str
    place: str


class ActivityIn(Named):
    system: bool = False


class AskIn(Strict):
    """The one return a person asks of the manager when they are asked for a favour: a promise the
    manager can make (``pledges``). A stall has its row (``front`` or ``back``), a role its id, a
    wage its coins, and a place in the programme may name its number or leave it to the first
    free one."""

    what: str
    item: str | None = None
    amount: int | None = None


class PersonIn(Strict):
    id: str
    zh: str
    en: str
    role: Label
    token: Token
    family: str | None
    tags: list[str]
    night_shift: bool = False
    home: str
    work: str
    traits: Traits
    ops: Ops
    # what the town says in one line of who the person is (public, the same in every game), the
    # small things they like and dislike, and the one return they ask for a favour
    intro: Label
    likes: list[str]
    dislikes: list[str]
    ask: AskIn
    holdings: list[Holding]
    routine: list[RoutineEntry]


class CastFile(Strict):
    id: str
    scenario: str
    script: str
    size: int
    items: list[Named]
    activities: list[ActivityIn]
    people: list[PersonIn]


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------


def bad_id(text: str) -> bool:
    return not text or text[0].isdigit() or any(ch not in ID_CHARS for ch in text)


def model_errors(where: str, exc: ValidationError) -> list[str]:
    out = []
    for err in exc.errors():
        loc = ".".join(str(part) for part in err["loc"])
        out.append(f"{where}: {loc}: {err['msg']}")
    return out


def day_order(hour: int) -> int:
    """Where an hour of the clock falls in a game day, which starts at 06:00."""
    return (hour - DAWN_HOUR) % 24


def cell_ok(cell: list[int]) -> bool:
    return len(cell) == 2 and all(type(v) is int for v in cell)


@dataclass
class Town:
    """The checked terrain of a map: what the people check needs to know about it."""

    id: str
    rows: list[str]
    cost: dict[str, int]  # terrain character -> cost
    places: dict[str, PlaceIn]
    compiled: dict[str, Any]

    @property
    def width(self) -> int:
        return len(self.rows[0])

    @property
    def height(self) -> int:
        return len(self.rows)

    def inside(self, x: int, y: int) -> bool:
        return 0 <= x < self.width and 0 <= y < self.height

    def walkable(self, x: int, y: int) -> bool:
        return self.cost[self.rows[y][x]] > 0


# --------------------------------------------------------------------------------------
# The town
# --------------------------------------------------------------------------------------


def check_town(name: str, raw: dict[str, Any], ents: Any, errors: list[str]) -> Town | None:
    start = len(errors)
    try:
        tf = TownFile.model_validate(raw)
    except ValidationError as exc:
        errors += model_errors(f"maps/{name}", exc)
        return None
    where = f"maps/{name}"
    if tf.id != name:
        errors.append(f"{where}: the id '{tf.id}' must match the file name")
    rows = [line for line in tf.rows.split("\n") if line != ""]
    if not rows:
        errors.append(f"{where}: no rows")
        return None
    if len({len(r) for r in rows}) != 1:
        errors.append(f"{where}: rows are not all of the same width")
        return None
    for ch, entry in tf.legend.items():
        if len(ch) != 1:
            errors.append(f"{where}: legend key {ch!r} is not one character")
        if bad_id(entry.id):
            errors.append(f"{where}: legend id '{entry.id}' is not lower-case snake_case")
    if len({e.id for e in tf.legend.values()}) != len(tf.legend):
        errors.append(f"{where}: two legend entries share an id")
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch not in tf.legend:
                errors.append(f"{where}: ({x}, {y}) is {ch!r}, which the legend does not list")
    if len(errors) > start:
        return None
    cost = {ch: entry.cost for ch, entry in tf.legend.items()}
    char_of = {entry.id: ch for ch, entry in tf.legend.items()}
    town = Town(tf.id, rows, cost, {}, {})
    if "building" not in char_of:
        errors.append(f"{where}: the legend needs an entry with id 'building'")
        return None
    for group, items in (("weather", tf.weather), ("phases", tf.phases)):
        if len({n.id for n in items}) != len(items) or not items:
            errors.append(f"{where}: {group} must list distinct ids")
    barrier_cells = {tuple(c) for b in tf.barriers for c in b.cells if cell_ok(c)}
    _check_places(where, tf, town, char_of, ents, barrier_cells, errors)
    _check_barriers(where, tf, town, errors)
    if len(errors) > start:
        return None
    _check_reach(where, tf, town, errors)
    if len(errors) > start:
        return None
    town.compiled = compile_town(tf, rows)
    return town


def _check_places(
    where: str,
    tf: TownFile,
    town: Town,
    char_of: dict[str, str],
    ents: Any,
    barrier_cells: set[tuple[int, int]],
    errors: list[str],
) -> None:
    seen: set[str] = set()
    building = char_of["building"]
    for p in tf.places:
        at = f"{where}: place {p.id}"
        if bad_id(p.id) or not p.id.startswith("p_"):
            errors.append(f"{at}: the id must be lower-case snake_case and start with 'p_'")
        if p.id in seen:
            errors.append(f"{at}: duplicate id")
        seen.add(p.id)
        town.places[p.id] = p
        if not p.zh.strip() or not p.en.strip():
            errors.append(f"{at}: needs a Chinese and an English name")
        if p.kind not in PLACE_KINDS:
            errors.append(f"{at}: kind '{p.kind}' is not one of {list(PLACE_KINDS)}")
        if p.id in ents.kind:
            if ents.kind[p.id] != "place":
                errors.append(f"{at}: entities.yaml lists this id as a {ents.kind[p.id]}")
            elif (p.zh, p.en) != (ents.label[p.id], ents.label_en[p.id]):
                errors.append(
                    f"{at}: names ({p.zh} / {p.en}) differ from entities.yaml "
                    f"({ents.label[p.id]} / {ents.label_en[p.id]})"
                )
        if len(p.rect) != 4 or not all(type(v) is int for v in p.rect):
            errors.append(f"{at}: rect must be [x, y, w, h]")
            continue
        rx, ry, rw, rh = p.rect
        if rw < 1 or rh < 1 or not (town.inside(rx, ry) and town.inside(rx + rw - 1, ry + rh - 1)):
            errors.append(f"{at}: rect {p.rect} is not inside the map")
            continue

        def in_rect(x: int, y: int, rx: int = rx, ry: int = ry, rw: int = rw, rh: int = rh) -> bool:
            return rx <= x < rx + rw and ry <= y < ry + rh

        if p.kind == "water":
            if p.door is not None or p.stands or p.footprints:
                errors.append(f"{at}: a water place has no door, stands or footprints")
            for y in range(ry, ry + rh):
                for x in range(rx, rx + rw):
                    if town.walkable(x, y):
                        errors.append(f"{at}: ({x}, {y}) is in the water place but can be walked")
            continue
        if p.door is None or not cell_ok(p.door):
            errors.append(f"{at}: needs a door [x, y]")
            continue
        stands = [tuple(c) for c in p.stands]
        if not all(cell_ok(c) for c in p.stands):
            errors.append(f"{at}: every stand must be [x, y]")
            continue
        cells = [tuple(p.door), *stands]
        if len(set(cells)) != len(cells):
            errors.append(f"{at}: the door and the stands must be distinct cells")
        for x, y in cells:
            if not town.inside(x, y):
                errors.append(f"{at}: ({x}, {y}) is outside the map")
            elif not town.walkable(x, y):
                errors.append(f"{at}: ({x}, {y}) is not walkable")
            elif not in_rect(x, y):
                errors.append(f"{at}: ({x}, {y}) is outside the rect")
        feet: list[tuple[int, int]] = []
        for fp in p.footprints:
            if len(fp) != 4 or not all(type(v) is int for v in fp):
                errors.append(f"{at}: a footprint must be [x, y, w, h]")
                continue
            fx, fy, fw, fh = fp
            for y in range(fy, fy + fh):
                for x in range(fx, fx + fw):
                    if not town.inside(x, y) or not in_rect(x, y):
                        errors.append(f"{at}: footprint cell ({x}, {y}) is outside the rect")
                    elif town.rows[y][x] != building:
                        errors.append(f"{at}: footprint cell ({x}, {y}) is not a building cell")
                    else:
                        feet.append((x, y))
        if p.indoor:
            if not feet:
                errors.append(f"{at}: an indoor place needs a footprint")
            elif not any(max(abs(p.door[0] - x), abs(p.door[1] - y)) <= 1 for x, y in feet):
                errors.append(f"{at}: the door is not next to a footprint")
        for c in p.cells:
            if not cell_ok(c) or not town.inside(c[0], c[1]):
                errors.append(f"{at}: cell {c} is outside the map")
            elif not town.walkable(c[0], c[1]) and (c[0], c[1]) not in barrier_cells:
                errors.append(f"{at}: cell {c} is not walkable and is no barrier cell")


def _check_barriers(where: str, tf: TownFile, town: Town, errors: list[str]) -> None:
    seen: set[str] = set()
    for b in tf.barriers:
        at = f"{where}: barrier {b.id}"
        if bad_id(b.id) or b.id in seen:
            errors.append(f"{at}: the id must be unique lower-case snake_case")
        seen.add(b.id)
        if b.place not in town.places:
            errors.append(f"{at}: unknown place '{b.place}'")
        for ch in (b.closed, b.open):
            if ch not in town.cost:
                errors.append(f"{at}: {ch!r} is not in the legend")
        if b.closed in town.cost and town.cost[b.closed] != 0:
            errors.append(f"{at}: the closed character must block")
        if b.open in town.cost and town.cost[b.open] == 0:
            errors.append(f"{at}: the open character must be walkable")
        for c in b.cells:
            if not cell_ok(c) or not town.inside(c[0], c[1]):
                errors.append(f"{at}: cell {c} is outside the map")
            elif town.rows[c[1]][c[0]] != b.closed:
                errors.append(f"{at}: cell {c} is not closed in the rows")


def reach(town: Town, start: tuple[int, int]) -> set[tuple[int, int]]:
    """Every walkable cell that can be reached from ``start`` by steps along the axes."""
    seen = {start}
    queue = deque([start])
    while queue:
        x, y = queue.popleft()
        for dx, dy in ((0, -1), (1, 0), (0, 1), (-1, 0)):
            nx, ny = x + dx, y + dy
            if town.inside(nx, ny) and (nx, ny) not in seen and town.walkable(nx, ny):
                seen.add((nx, ny))
                queue.append((nx, ny))
    return seen


def _check_reach(where: str, tf: TownFile, town: Town, errors: list[str]) -> None:
    walkers = [p for p in tf.places if p.door is not None]
    if not walkers:
        errors.append(f"{where}: no place has a door")
        return
    first = walkers[0]
    assert first.door is not None
    seen = reach(town, (first.door[0], first.door[1]))
    for p in walkers:
        assert p.door is not None
        for x, y in [tuple(p.door), *(tuple(c) for c in p.stands)]:
            if (x, y) not in seen:
                errors.append(f"{where}: place {p.id}: ({x}, {y}) cannot be reached")


def compile_town(tf: TownFile, rows: list[str]) -> dict[str, Any]:
    places = []
    for p in tf.places:
        places.append(
            {
                "id": p.id,
                "zh": p.zh,
                "en": p.en,
                "kind": p.kind,
                "indoor": p.indoor,
                "rect": list(p.rect),
                "door": None if p.door is None else list(p.door),
                "stands": [list(c) for c in p.stands],
                "footprints": [list(f) for f in p.footprints],
                "cells": [list(c) for c in p.cells],
            }
        )
    return {
        "id": tf.id,
        "zh": tf.zh,
        "en": tf.en,
        "width": len(rows[0]),
        "height": len(rows),
        "rows": list(rows),
        "legend": [
            {"char": ch, "id": e.id, "zh": e.zh, "en": e.en, "cost": e.cost}
            for ch, e in tf.legend.items()
        ],
        "weather": [{"id": n.id, "zh": n.zh, "en": n.en} for n in tf.weather],
        "phases": [{"id": n.id, "zh": n.zh, "en": n.en} for n in tf.phases],
        "places": places,
        "barriers": [
            {
                "id": b.id,
                "zh": b.zh,
                "en": b.en,
                "place": b.place,
                "cells": [list(c) for c in b.cells],
                "closed": b.closed,
                "open": b.open,
            }
            for b in tf.barriers
        ],
    }


# --------------------------------------------------------------------------------------
# The cast
# --------------------------------------------------------------------------------------


def check_cast(
    name: str,
    raw: dict[str, Any],
    town: Town | None,
    ents: Any,
    scripts: dict[str, list[str]],
    errors: list[str],
    gifts: tuple[str, ...] = (),
) -> dict[str, Any] | None:
    start = len(errors)
    where = f"cast/{name}"
    try:
        cf = CastFile.model_validate(raw)
    except ValidationError as exc:
        errors += model_errors(where, exc)
        return None
    if cf.id != name:
        errors.append(f"{where}: the id '{cf.id}' must match the file name")
    if town is None:
        errors.append(f"{where}: the town of scenario '{cf.scenario}' did not check out")
        return None
    if len(cf.people) != cf.size:
        errors.append(f"{where}: size says {cf.size} people and the file lists {len(cf.people)}")
    items = {i.id for i in cf.items}
    acts = {a.id: a for a in cf.activities}
    for group, ids in (("items", [i.id for i in cf.items]), ("activities", list(acts))):
        if len(set(ids)) != len(ids) or any(bad_id(i) for i in ids):
            errors.append(f"{where}: {group} need distinct lower-case snake_case ids")
    if cf.script not in scripts:
        errors.append(f"{where}: unknown script '{cf.script}'")
    ids = [p.id for p in cf.people]
    if len(set(ids)) != len(ids):
        errors.append(f"{where}: a person is listed twice")
    for p in cf.people:
        _check_person(where, p, town, ents, items, acts, errors, gifts)
    if cf.script in scripts:
        listed = set(ids)
        for ent in scripts[cf.script]:
            kind = ents.kind.get(ent)
            if kind == "person" and ent not in listed:
                errors.append(f"{where}: {ent} is in the cast of script {cf.script} and not here")
            if kind == "place" and ent not in town.places:
                errors.append(
                    f"{where}: {ent} is in the cast of script {cf.script}, not on the map"
                )
    if len(errors) > start:
        return None
    return compile_cast(cf, ents)


def _check_person(
    where: str,
    p: PersonIn,
    town: Town,
    ents: Any,
    items: set[str],
    acts: dict[str, ActivityIn],
    errors: list[str],
    gifts: tuple[str, ...] = (),
) -> None:
    at = f"{where}: {p.id}"
    if bad_id(p.id):
        errors.append(f"{at}: the id must be lower-case snake_case")
    if not p.zh.strip() or not p.en.strip():
        errors.append(f"{at}: needs a Chinese and an English name")
    if p.id in ents.kind:
        if ents.kind[p.id] != "person":
            errors.append(f"{at}: entities.yaml lists this id as a {ents.kind[p.id]}")
        else:
            if (p.zh, p.en) != (ents.label[p.id], ents.label_en[p.id]):
                errors.append(
                    f"{at}: names ({p.zh} / {p.en}) differ from entities.yaml "
                    f"({ents.label[p.id]} / {ents.label_en[p.id]})"
                )
            if p.family != ents.family.get(p.id):
                errors.append(f"{at}: family {p.family} differs from entities.yaml")
    elif p.family is not None and ents.kind.get(p.family) != "family":
        errors.append(f"{at}: unknown family '{p.family}'")
    if p.id not in ents.bio:
        errors.append(f"{at}: needs a bio in entities.yaml, in both languages")
    if len(p.token.zh) != 1 or not (len(p.token.en) == 1 and p.token.en.isupper()):
        errors.append(f"{at}: the token is one Chinese character and one capital letter")
    if len(set(p.tags)) != len(p.tags) or any(t not in ROLE_TAGS for t in p.tags):
        errors.append(f"{at}: tags must be distinct and from {list(ROLE_TAGS)}")
    if sum(getattr(p.ops, op) for op in OPS) != 100:
        errors.append(f"{at}: the operator weights must add up to 100")
    for field_name, place_id in (("home", p.home), ("work", p.work)):
        place = town.places.get(place_id)
        if place is None or place.door is None:
            errors.append(f"{at}: {field_name} '{place_id}' is not a place people can go to")
    for h in p.holdings:
        place_id = h.at or p.home
        place = town.places.get(place_id)
        if h.item not in items:
            errors.append(f"{at}: holds unknown item '{h.item}'")
        if place is None or place.door is None:
            errors.append(f"{at}: keeps {h.item} at '{place_id}', which is not a place")
    _check_routine(at, p, town, acts, errors)
    _check_intro(at, p, errors)
    _check_tastes(at, p, gifts, errors)
    _check_ask(at, p.ask, errors)


def _check_intro(at: str, p: PersonIn, errors: list[str]) -> None:
    """The line the town says of a person: text of its own language, on one line, short, with no
    semicolon or dash, and no pronoun (the cast does not fix the sex of everyone)."""
    for lang in ("zh", "en"):
        text = getattr(p.intro, lang)
        if not text.strip():
            errors.append(f"{at}: intro ({lang}) is empty")
            continue
        if text != text.strip() or "\n" in text:
            errors.append(f"{at}: intro ({lang}) is one line, without blank space at the ends")
        if len(text) > INTRO_LIMIT[lang]:
            errors.append(
                f"{at}: intro ({lang}) has {len(text)} characters, at most {INTRO_LIMIT[lang]}"
            )
        if any(mark in text for mark in BANNED):
            errors.append(f"{at}: intro ({lang}) has a semicolon or a dash, write another sentence")
        if PRONOUNS[lang].search(text):
            errors.append(f"{at}: intro ({lang}) says he or she of a person")
    if not any("\u4e00" <= ch <= "\u9fff" for ch in p.intro.zh):
        errors.append(f"{at}: intro (zh) must be Chinese text")
    if any("\u4e00" <= ch <= "\u9fff" for ch in p.intro.en):
        errors.append(f"{at}: intro (en) must be English text")


def _check_tastes(at: str, p: PersonIn, gifts: tuple[str, ...], errors: list[str]) -> None:
    for name, ids in (("likes", p.likes), ("dislikes", p.dislikes)):
        if len(set(ids)) != len(ids):
            errors.append(f"{at}: {name} lists a thing twice")
        for item in ids:
            if item not in gifts:
                errors.append(
                    f"{at}: {name} lists '{item}', which is not a small thing of the script"
                )
    if set(p.likes) & set(p.dislikes):
        errors.append(f"{at}: likes and dislikes share a thing")
    if not p.likes:
        errors.append(f"{at}: likes at least one small thing")


def _check_ask(at: str, ask: AskIn, errors: list[str]) -> None:
    """The return a person asks has to be something the manager can promise."""
    what = f"{at}: ask {ask.what}"
    if ask.what not in ASK_KINDS:
        errors.append(f"{at}: ask must be one of {list(ASK_KINDS)}, got '{ask.what}'")
    elif ask.what == "stall":
        if ask.item not in ASK_STALLS or ask.amount is not None:
            errors.append(f"{what}: needs item front or back and no amount")
    elif ask.what == "role":
        if ask.item not in ASK_ROLES or ask.amount is not None:
            errors.append(f"{what}: needs item {list(ASK_ROLES)} and no amount")
    elif ask.what == "wage":
        if ask.amount not in ASK_WAGES or ask.item is not None:
            errors.append(f"{what}: needs an amount of {list(ASK_WAGES)} and no item")
    elif ask.amount is not None or (
        ask.item is not None and ask.item not in tuple(str(n) for n in range(1, ASK_SLOTS + 1))
    ):
        errors.append(f"{what}: names no amount, and a place 1 to {ASK_SLOTS} or none")


def _check_routine(
    at: str, p: PersonIn, town: Town, acts: dict[str, ActivityIn], errors: list[str]
) -> None:
    routine = p.routine
    if not routine:
        errors.append(f"{at}: the routine is empty")
        return
    if routine[0].hour != DAWN_HOUR:
        errors.append(f"{at}: the routine must start at {DAWN_HOUR:02d}:00")
    order = [day_order(e.hour) for e in routine]
    if any(b <= a for a, b in zip(order, order[1:], strict=False)):
        errors.append(
            f"{at}: the hours of the routine must increase from {DAWN_HOUR:02d}:00 round the clock"
        )
    for i, e in enumerate(routine):
        if e.act not in acts:
            errors.append(f"{at}: routine act '{e.act}' is not in the activities")
        elif acts[e.act].system:
            errors.append(f"{at}: routine act '{e.act}' is for the world to use, not a routine")
        place = town.places.get(e.place)
        if place is None or place.door is None:
            errors.append(f"{at}: routine place '{e.place}' is not a place people can go to")
        prev = routine[i - 1]
        if i > 0 and (prev.act, prev.place) == (e.act, e.place):
            errors.append(f"{at}: the routine repeats {e.act} at {e.place} at {e.hour:02d}:00")
    last = routine[-1]
    if last.place != p.home:
        errors.append(f"{at}: the routine must end at home ({p.home}), not at {last.place}")
    if not p.night_shift and last.act != "sleep":
        errors.append(f"{at}: the routine of a day person ends with sleep")


def _ask_fields(ask: AskIn) -> dict[str, Any]:
    """The fields of the return a person asks that are set, in the compiled cast."""
    return {
        key: value
        for key, value in (("item", ask.item), ("amount", ask.amount))
        if value is not None
    }


def compile_cast(cf: CastFile, ents: Any) -> dict[str, Any]:
    families = sorted({p.family for p in cf.people if p.family is not None})
    people = []
    for p in cf.people:
        people.append(
            {
                "id": p.id,
                "zh": p.zh,
                "en": p.en,
                "role": {"zh": p.role.zh, "en": p.role.en},
                "bio": dict(ents.bio[p.id]),
                "intro": {"zh": p.intro.zh, "en": p.intro.en},
                "likes": list(p.likes),
                "dislikes": list(p.dislikes),
                "ask": {"what": p.ask.what, **_ask_fields(p.ask)},
                "token": {"zh": p.token.zh, "en": p.token.en},
                "family": p.family,
                "tags": sorted(p.tags),
                "night_shift": p.night_shift,
                "home": p.home,
                "work": p.work,
                "traits": p.traits.model_dump(),
                "ops": p.ops.model_dump(),
                "holdings": [
                    {"item": h.item, "qty": h.qty, "at": h.at or p.home} for h in p.holdings
                ],
                "routine": [{"hour": e.hour, "act": e.act, "place": e.place} for e in p.routine],
            }
        )
    return {
        "id": cf.id,
        "scenario": cf.scenario,
        "script": cf.script,
        "size": cf.size,
        "items": [{"id": i.id, "zh": i.zh, "en": i.en} for i in cf.items],
        "activities": [
            {"id": a.id, "zh": a.zh, "en": a.en, "system": a.system} for a in cf.activities
        ],
        "families": [{"id": f, "zh": ents.label[f], "en": ents.label_en[f]} for f in families],
        "people": people,
    }


# --------------------------------------------------------------------------------------
# The module that carries the content into the core
# --------------------------------------------------------------------------------------


def pretty(value: Any, indent: int = 0, width: int = 88, lead: int = 0) -> str:
    """JSON in a form that diffs well: a list or object that fits on one line stays on it.

    ``lead`` is how much of the line is taken before the value, by the key it is the value of."""
    flat = json.dumps(value, ensure_ascii=False, sort_keys=True)
    pad = "  " * indent
    if len(flat) + len(pad) + lead <= width or not isinstance(value, dict | list):
        return flat
    inner = "  " * (indent + 1)
    if isinstance(value, dict):
        body = []
        for k, v in sorted(value.items()):
            key = json.dumps(k, ensure_ascii=False)
            body.append(f"{inner}{key}: {pretty(v, indent + 1, width, len(key) + 2)}")
        return "{\n" + ",\n".join(body) + f"\n{pad}}}"
    body = [f"{inner}{pretty(v, indent + 1, width)}" for v in value]
    return "[\n" + ",\n".join(body) + f"\n{pad}]"


def render_module(
    scenario: str,
    town: dict[str, Any],
    cast: dict[str, Any],
    tables: dict[str, Any],
    script: dict[str, Any],
) -> bytes:
    """The text of ``data.py``: the documents as JSON in raw strings, read back by ``json``."""
    parts = []
    for name, doc in (("TOWN", town), ("CAST", cast), ("TABLES", tables), ("SCRIPT", script)):
        text = pretty(doc)
        assert '"""' not in text and not text.endswith("\\")
        parts.append(f'_{name} = r"""\n{text}\n"""\n')
    head = (
        f'"""The content of the {scenario} scenario as Python data.\n\n'
        "``TOWN`` and ``CAST`` are the map and the cast. ``TABLES`` and ``SCRIPT`` are the\n"
        f"compiled tables and the compiled script ``{script['id']}`` that the cast names,\n"
        "which the cognition model reads (``Tables.from_canon`` and ``ScriptBook.from_canon``).\n\n"
        f"Generated by tools/check_content.py from content/maps/{town['id']}.yaml,\n"
        f"content/cast/{cast['id']}.yaml and the rest of content/. Do not edit it:\n"
        "change the YAML and run the tool. The core cannot read files, so the compiled content\n"
        "travels inside the package. A test holds it equal to the files of content/compiled.\n"
        '"""\n\n'
        "# ruff: noqa: E501\n\n"
        "import json\n\n"
    )
    tail = "".join(
        f"{name} = json.loads(_{name})\n" for name in ("TOWN", "CAST", "TABLES", "SCRIPT")
    )
    return (head + "\n".join(parts) + "\n" + tail).encode("utf-8")


# --------------------------------------------------------------------------------------
# Entry point for check_content
# --------------------------------------------------------------------------------------


def build(
    maps: dict[str, dict[str, Any]],
    casts: dict[str, dict[str, Any]],
    ents: Any,
    scripts: dict[str, list[str]],
    docs: dict[str, dict[str, Any]],
    errors: list[str],
) -> tuple[dict[str, bytes], dict[str, bytes], list[str]]:
    """Check every map and cast. Returns (json outputs, generated modules, coverage lines).

    ``ents`` has ``kind``, ``family``, ``label`` and ``label_en`` dicts keyed by entity id,
    ``scripts`` maps a script name to the entities of its cast, and ``docs`` holds the compiled
    ``tables`` and every compiled script by name, which go into the generated module.
    """
    outputs: dict[str, bytes] = {}
    generated: dict[str, bytes] = {}
    coverage: list[str] = []
    towns: dict[str, Town | None] = {}
    for name, raw in sorted(maps.items()):
        towns[name] = check_town(name, raw, ents, errors)
    cast_docs: dict[str, dict[str, Any]] = {}
    for name, raw in sorted(casts.items()):
        scenario = raw.get("scenario") if isinstance(raw, dict) else None
        map_id = SCENARIOS.get(scenario, (None,))[0]
        script_id = raw.get("script") if isinstance(raw, dict) else None
        gifts = tuple(g["id"] for g in docs.get(script_id, {}).get("gifts", []))
        doc = check_cast(name, raw, towns.get(map_id), ents, scripts, errors, gifts)
        if doc is not None:
            cast_docs[name] = doc
    for name, town in towns.items():
        if town is not None:
            outputs[f"map_{name}.json"] = canon.dumps(town.compiled)
    for name, doc in cast_docs.items():
        outputs[f"cast_{name}.json"] = canon.dumps(doc)
    for scenario, (map_id, cast_id, path) in SCENARIOS.items():
        town = towns.get(map_id)
        if town is not None and cast_id in cast_docs:
            cast = cast_docs[cast_id]
            generated[path] = render_module(
                scenario, town.compiled, cast, docs["tables"], docs[cast["script"]]
            )
            tags = {t: sum(t in p["tags"] for p in cast["people"]) for t in ROLE_TAGS}
            coverage.append(
                f"{scenario}: {len(cast['people'])} people, {len(town.places)} places on a "
                f"{town.width}x{town.height} map; tags {tags}"
            )
        elif map_id in maps or cast_id in casts:
            errors.append(
                f"scenario {scenario}: map '{map_id}' and cast '{cast_id}' must both check out"
            )
    return outputs, generated, coverage
