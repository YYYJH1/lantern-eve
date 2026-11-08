"""Looking: inspecting a place or a thing for evidence, by the retrieval model of the script.

Every item of evidence in the script says how it is got (its ``acquire``): where it is (``from``, a
thing, a place or a person), who guards it (``gatekeeper``) and how far that person has to trust the
player (``min_trust``), the hours of the day it can be got in (``daily``, minutes of the clock), how
long it takes (``minutes`` of game time), from when and until when (``since`` and ``until``, minutes
counted from 00:00 of day 1) and what the player must hold first (``needs``). A person's testimony
is asked of the person. ``since`` is what the script's table of opportunities is made of: the same
places, people and hours in every story, and what is there to be had from which day (a witness
who will not speak yet, water too high to see the pier). An item before its ``since`` is as shut as
one out of hours (``closed``), and a holder that is turned away for it is not marked as looked at.
What a ``look`` is for is the items that a thing or a place holds: the scratches on a boat, the
upstream timber stuck under the bridge, the footprint by the rail, the ledger.

Looking. The player has to be within ``REACH`` cells of the place (of the place a thing lies at, see
``LOCATION``). The gates are those of the script and nothing about the truth of the game: the hour
of the day and ``until``, the evidence that has to be in hand, and the trust of the gatekeeper in
the player (``section["trust"]``). A gate that is shut turns the player away at once: ``closed``,
``needs`` or ``refused``, and a gatekeeper who refuses says so over their head. Otherwise the player
is busy for the ``minutes`` of the items that are there (``busy`` in the section), and at the end of
that time the items that are real in the variant of the game are found: the player writes down, as
seen, every prop such an item supports, and keeps the item. What the items would have shown in
another variant is not there to be found. Either way the items are looked at (``looked``): a
holder the player has looked at, or whose items are gone for good (past their ``until``), is not
offered again, and the offer does not say whether there was anything to find.
"""

from __future__ import annotations

import functools
from typing import Any

from lantern_core.world.bridge import clock, notebook
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

REACH = 1  # cells from the rectangle of the place
LOCATION = {  # the place each thing that holds evidence lies at
    "t_rail": "p_bridge",
    "t_he_boat": "p_ferry",
    "t_repair_ledger": "p_accountant_home",
}
DAY_MINUTES = 24 * 60


def items_at(entity_id: str) -> list[dict[str, Any]]:
    """The items of evidence the script puts in ``entity_id``, in the order of the script."""
    return [ev for ev in SCRIPT["evidence"] if ev["acquire"]["from"] == entity_id]


@functools.cache
def holders() -> tuple[str, ...]:
    """The things and places that hold evidence a ``look`` can find, sorted."""
    registry = lore().book.registry
    found = {
        ev["acquire"]["from"]
        for ev in SCRIPT["evidence"]
        if registry.type_of(ev["acquire"]["from"]) in ("thing", "place")
    }
    return tuple(sorted(found))


def place_of(world: Any, entity_id: str) -> str | None:
    """The place a thing or a place is at, or None if it is nowhere on the map."""
    if entity_id in world.town.places:
        return entity_id
    return LOCATION.get(entity_id)


def within_reach(world: Any, section: dict[str, Any], entity_id: str) -> bool:
    place_id = place_of(world, entity_id)
    place = world.town.places.get(place_id) if place_id else None
    if place is None:
        return False
    x, y, w, h = place.rect
    dx = max(x - section["x"], 0, section["x"] - (x + w - 1))
    dy = max(y - section["y"], 0, section["y"] - (y + h - 1))
    return max(dx, dy) <= REACH


def gone(item: dict[str, Any], now: clock.Now) -> bool:
    """Whether the item can no longer be got at all, as against not at this hour."""
    until = item["acquire"]["until"]
    return until is not None and game_minute(now) >= until


def not_yet(item: dict[str, Any], now: clock.Now) -> bool:
    """Whether the item cannot be got yet, as against not at this hour: its day has not come."""
    since = item["acquire"].get("since")
    return since is not None and game_minute(now) < since


def in_reach(world: Any, section: dict[str, Any], now: clock.Now) -> list[str]:
    """The holders within reach that still have something the player has not looked for."""
    return [
        entity
        for entity in holders()
        if within_reach(world, section, entity)
        and any(ev["id"] not in section["looked"] and not gone(ev, now) for ev in items_at(entity))
    ]


def minute_of_day(now: clock.Now) -> int:
    return now.hour * 60 + now.minute


def game_minute(now: clock.Now) -> int:
    """Minutes since 00:00 of day 1. The small hours of the night belong to the next date."""
    after_midnight = now.phase == clock.NIGHT and now.hour < clock.DAWN_HOUR
    return (now.day - 1) * DAY_MINUTES + minute_of_day(now) + (DAY_MINUTES if after_midnight else 0)


def gate(world: Any, section: dict[str, Any], item: dict[str, Any], now: clock.Now) -> str | None:
    """Why the player cannot get ``item`` now: ``closed``, ``needs`` or ``refused``, else None."""
    acquire = item["acquire"]
    low, high = acquire["daily"]
    if not low <= minute_of_day(now) < high or gone(item, now) or not_yet(item, now):
        return "closed"
    if any(need not in section["evidence"] for need in acquire["needs"]):
        return "needs"
    keeper, needed = acquire["gatekeeper"], acquire["min_trust"]
    if keeper is not None and needed is not None:
        trust = section["trust"][world.cast.index[keeper]]
        return "refused" if trust < needed else None
    return None


def ticks_for(minutes: int, now: clock.Now) -> int:
    """How many ticks ``minutes`` of game time take at this hour of the day."""
    per_hour = clock.DAY_TICKS_PER_HOUR if now.phase == clock.DAY else clock.NIGHT_TICKS_PER_HOUR
    return max(1, minutes * per_hour // 60)


def begin(
    world: Any, section: dict[str, Any], entity_id: str, now: clock.Now, tick: int
) -> tuple[str | None, str | None]:
    """Start inspecting. Returns ``(reason, keeper)``: why not, and who turned the player away."""
    items = items_at(entity_id)
    if not items:
        return "nothing_here", None
    open_items, reasons = [], []
    for item in items:
        if item["id"] in section["looked"]:
            continue
        why = gate(world, section, item, now)
        if why is None:
            open_items.append(item)
        else:
            reasons.append((why, item))
    if not open_items:
        if not reasons:
            return "nothing_here", None
        for why in ("closed", "refused", "needs"):  # the first gate that shut, by this order
            for found, item in reasons:
                if found == why:
                    return why, item["acquire"]["gatekeeper"]
        raise AssertionError(reasons)
    minutes = sum(item["acquire"]["minutes"] for item in open_items)
    section["goal"] = [section["x"], section["y"]]
    section["dest"] = ""
    section["busy"] = {
        "kind": "look",
        "at": entity_id,
        "start": tick,
        "until": tick + ticks_for(minutes, now),
        "items": [item["id"] for item in open_items],
    }
    return None, None


def finish(world_state: dict[str, Any], tick: int) -> tuple[str, list[str], list[str]]:
    """End the inspection: ``(where, items found, ids of the entries written)``."""
    section = world_state["player"]
    busy = section["busy"]
    variant = world_state["social"].get("variant")
    found: list[str] = []
    written: list[str] = []
    section["looked"].extend(i for i in busy["items"] if i not in section["looked"])
    for item in SCRIPT["evidence"]:
        if item["id"] not in busy["items"] or variant not in item["real_in"]:
            continue
        found.append(item["id"])
        section["evidence"].append(item["id"])
        for prop_id in item["supports"]:
            entry, _ = notebook.add_seen(section, prop_id, tick)
            if entry["id"] not in written:
                written.append(entry["id"])
    section["busy"] = {}
    return busy["at"], found, written
