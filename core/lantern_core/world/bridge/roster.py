"""The people, one row for each of the twenty, for the page that shows who is who: the key
``people`` of the frame.

::

    "people": [{"id", "known": bool, "hearts": 0..10,
                "likes_known": [{"item", "like"}], "gifts": int, "card": {...} | null,
                "met": [{...}], "asked": {...} | null}, ...]

in the order of the cast. ``known`` is whether the manager has talked with the person (the people
the manager has only heard of have a card in ``cards`` and are not known here). What the town says
in a line of who a person is (``intro``) is static, public content: it is in the scene
(``cast[].intro``), and not in every frame, which would carry it twenty times over at each step. A
test holds the whole key to what the manager has done: two games in which the manager did the same
and the story that is true is another have the same ``people``, to the word.

``hearts`` are the hearts of ``hearts`` (half hearts, 0 to 10, display only). ``likes_known`` is
what the manager has learned of what the person likes and dislikes (``gifts``), ``gifts`` the number
of gifts they have taken.

``card`` is the facts for the card that opens on the hearts, and only for a person who is known
(null for anyone else)::

    {"trust": "stranger" | "acquainted" | "friendly" | "close",   how far they trust the manager,
                                                                 in words (``prompts.standing``)
     "owes_you": int, "you_owe": int,        the favours the person owes the manager and the
                                             manager owes the person, each from 0 to 6
     "you_promised": [{"id", "what", "item", "amount", "due"}],   the open promises to the person
     "promised_you": [commitment],           what the person promised the manager, as in
                                             ``commitments`` of the frame
     "changes": [{"tick", "day", "hour", "minute", "delta", "why"}],   the last five changes of the
                                             hearts, oldest first, ``why`` one of ``hearts.WHY``
     "waiting": int | null,                  how many more acquaintances the person wants to see
                                             join the helpers before they do (``goals_call``): 0
                                             if they are in, and also if the friends they wait
                                             for are in and the crew was full before them; null
                                             for a child and before the call
     "joined": bool}                         whether the person is among the helpers (false for a
                                             child and before the call): ``waiting`` of 0 does not
                                             say it

``met`` is where and when the manager began their talks with the person, the last few and oldest
first, each ``{"tick", "day", "hour", "minute", "place"}`` with ``place`` an id of the town or null
for the street, and ``asked`` is the return the person asked in a talk, once they did::

    {"what": {"zh", "en"},        the return, as the town says it ("a front-row stall at the
                                  festival")
     "for": {"zh", "en"},         the request they turned down for want of weight, naming them
     "tick", "day", "hour", "minute"}   when they asked it (the last time)

Both are written down by ``encounters`` and only from what the manager did and was told: a person
who asked no return has null here, however the script has them.

What a person believes, what is true and what they know of the case are in none of it. The trust
and the favours are the manager's own dealings with the person, which the hearts show; the promises
are the manager's and the person's to each other.
"""

from __future__ import annotations

from typing import Any

from lantern_core.world.bridge import (
    clock,
    commitments,
    encounters,
    gifts,
    goals_call,
    hearts,
    offers,
    pledges,
    prompts,
    repute,
)
from lantern_core.world.bridge.lore import lore


def trust_word(trust: int) -> str:
    """How far a person trusts the manager, in a word: the lines of ``prompts.STANDING_LINES``."""
    for line, key in prompts.STANDING_LINES:
        if trust < line:
            return key
    return "close"


def favours(section: dict[str, Any]) -> list[tuple[int, int]]:
    """For each person in cast order, the favours they owe the manager and the manager owes them,
    each from 0 to ``pledges.MAX_BALANCE``."""
    people = lore().people
    owed = dict.fromkeys(people, 0)
    owing = dict.fromkeys(people, 0)
    for _, deed in sorted(section["deeds"].items()):
        size = deed[1] * deed[2]
        if deed[0] not in owed:
            continue
        if size > 0:
            owed[deed[0]] += size
        else:
            owing[deed[0]] -= size
    cap = pledges.MAX_BALANCE
    return [(min(cap, owed[p]), min(cap, owing[p])) for p in people]


def changes(section: dict[str, Any], person: str) -> list[dict[str, Any]]:
    out = []
    for tick, delta, why in hearts.log_of(section, person):
        when = clock.at(tick)
        out.append(
            {
                "tick": tick,
                "day": when.day,
                "hour": when.hour,
                "minute": when.minute,
                "delta": delta,
                "why": why,
            }
        )
    return out


def waiting(world: Any, world_state: dict[str, Any], person: str) -> int | None:
    """How many acquaintances ``person`` still waits for, or None for someone who cannot help (a
    child) and before the call for helpers is made."""
    call = world_state["goals"]["call"]
    if call["open"] < 0 or person not in call["base"]:
        return None
    return goals_call.waiting_for(world, world_state, person)


def card(
    world: Any, world_state: dict[str, Any], index: int, ledger: tuple[int, int]
) -> dict[str, Any]:
    section = world_state["player"]
    person = world.cast.people[index].id
    return {
        "trust": trust_word(repute.trust(section, index)),
        "owes_you": ledger[0],
        "you_owe": ledger[1],
        "you_promised": [
            {k: p[k] for k in ("id", "what", "item", "amount", "due")}
            for p in section["pledges"]
            if p["to"] == person and p["state"] == pledges.OPEN
        ],
        "promised_you": [
            commitments.wire(world, row)
            for row in world_state[commitments.SECTION]["list"]
            if row["by"] == person
        ],
        "changes": changes(section, person),
        "waiting": waiting(world, world_state, person),
        "joined": goals_call.has_joined(world_state["goals"]["call"], person),
    }


def asked(world: Any, section: dict[str, Any], person: str) -> dict[str, Any] | None:
    """The return ``person`` asked in a talk, as the frame says it, or None if they have not."""
    row = section.get("wanted", {}).get(person)
    if row is None:
        return None
    tick, what, item, amount, kind, target = row
    request = {"kind": kind, **({"target": target} if kind == "persuade" else {})}
    return {
        "what": prompts.promise_text(world, what, item, amount, town=True),
        "for": offers.request_label(person, request),
        **encounters.time_of(tick),
    }


def wire(world: Any, world_state: dict[str, Any]) -> list[dict[str, Any]]:
    """The key ``people`` of the frame."""
    section = world_state["player"]
    shown, ledger = hearts.now(section), favours(section)
    out = []
    for index, person in enumerate(world.cast.people):
        known = bool(section["talked"][index])
        out.append(
            {
                "id": person.id,
                "known": known,
                "hearts": shown[index],
                "likes_known": gifts.known(section, person.id),
                "gifts": gifts.taken_by(section, person.id),
                "card": card(world, world_state, index, ledger[index]) if known else None,
                "met": encounters.met_rows(section, person.id) if known else [],
                "asked": asked(world, section, person.id) if known else None,
            }
        )
    return out
