"""The card of a person: what the player knows of them, for the side panel.

One card for each person the player has met (talked with) or heard of (named in the notebook as
the one who told something, as the source it names, along its trail, or in what it says). The card
has only what the player has been shown or has asked, so a person the player has not met has no
place to find, and a want the player has not learned is not there::

    {"id": cast id,
     "name": {"zh", "en"}, "role": {"zh", "en"}, "family": family id | null,     the identity
     "met": bool,                                  whether the player has talked with them
     "find": [{"from": minute of the day, "place": id, "act": id, "now"?: true,
               "tomorrow"?: true}] | null,
     "wants": [{"id", "text": {"zh", "en"}}],      those of the script that the player has learned
     "favours": int,                               the balance of favours, + if they owe the player
     "stance": {"text": {"zh", "en"}, "tick", "at": {"day", "hour", "minute"},
                "how": {"zh", "en"}, "kind": "told" | "overheard", "entry": id | null,
                "rival"?: {"text": {"zh", "en"}, "who": {"zh", "en", "id"}}} | null,
     "agreed": [commitment id]}                    what they promised the player (``commitments``)

*Identity* is public, the cast of the scene. *Find* is where the routine of the person puts them,
from the entry in force now and the two after it, only for a person the player has met. It is the
routine, which a person who has an errand or runs from the rain does not keep (``tomorrow`` marks
an entry that is the start of the next day). *Wants* are the ``wants`` of the script whose
conditions hold for the player (``agenda``). *Favours* is the ledger of favours
(``pledges.balance``). *Stance* is the latest thing the person told the player about who or what
broke the rail, from the claims the player was given or overheard: the tick, and whether they said
it to the player (``told``) or the player overheard them say it (``overheard``). What was told of
them by someone else is not their stance, since it may not be what they said. ``rival`` is the
account somebody else told them and they did not take in, when they said it to the player in the
same answer as the stance (``notebook.pair_rival``) or in an earlier answer about the same belief:
the account, and who they say told them. The key is there only then: a stance that was overheard,
and one they never gave with it, has none, and it is never worked out from what the person holds,
so that a person who keeps a rival account and did not say so has none.
"""

from __future__ import annotations

import functools
from collections.abc import Mapping
from typing import Any

from lantern_core.cognition.beliefs import Claim
from lantern_core.cognition.props import Prop
from lantern_core.world.bridge import clock, goals_ending, notebook, notes, pledges
from lantern_core.world.bridge.lore import lore

HOW = {
    "told": {"zh": "亲口告诉你的", "en": "They told you themselves"},
    "overheard": {"zh": "你听到他们说的", "en": "You overheard them"},
}
NEXT_ENTRIES = 3  # the routine entry in force and the ones after it that a card shows


def known(world_state: dict[str, Any], props: Mapping[str, Prop] | None) -> list[int]:
    """The cast indexes of the people who have a card: met, or heard of. In cast order.

    ``props`` is every prop of the game (``notebook.view``), needed once the notebook has an entry.
    """
    lo, section = lore(), world_state["player"]
    found = {index for index, day in enumerate(section["talked"]) if day}
    if section["notebook"] and props is not None:
        for entry in section["notebook"]:
            belief = notebook.belief_of(entry)
            names = [belief.teller, belief.claimed_source]
            for hop in entry["trail"]:
                names += [hop[0], hop[1]]
            names += [entity for _, entity in props[entry["prop"]].args]
            found.update(lo.index[name] for name in names if name in lo.index)
    return sorted(found)


@functools.lru_cache(maxsize=64)
def _routine(cast: Any, index: int) -> tuple[tuple[int, ...], tuple[tuple[int, str, str], ...]]:
    """The start ticks of the routine of a person, and each entry as (minute of the day it starts,
    act, place). Static, like the cast."""
    routine = cast.people[index].routine
    entries = []
    for start, act, place in routine:
        began = clock.at(start)
        entries.append((began.hour * 60 + began.minute, act, place))
    return tuple(entry[0] for entry in routine), tuple(entries)


def find(world: Any, index: int, tick: int) -> list[dict[str, Any]]:
    """Where the routine of a person puts them from now: the entry in force, then the next two."""
    starts, entries = _routine(world.cast, index)
    cycle, current = clock.at(tick).cycle_tick, -1  # -1: the entry in force is the day before's
    for number, start in enumerate(starts):
        if start > cycle:
            break
        current = number
    out = []
    for step in range(min(NEXT_ENTRIES, len(entries))):
        began, act, place = entries[(current + step) % len(entries)]
        entry: dict[str, Any] = {"from": began, "place": place, "act": act}
        if step == 0:
            entry["now"] = True
        elif current + step >= len(entries):
            entry["tomorrow"] = True  # the routine has come round to the start of the next day
        out.append(entry)
    return out


def stance(
    world: Any, world_state: dict[str, Any], person: str, props: Mapping[str, Prop] | None
) -> dict[str, Any] | None:
    """The latest thing ``person`` said to the player, or that the player overheard them say,
    about the conflict. Null if there is none."""
    section, social = world_state["player"], world_state["social"]
    if props is None or not (section["claims"] or section["heard"]):
        return None
    tails = set(section.get("twins", {}).values())  # the accounts said after a belief: no stance
    said: list[tuple[Claim, str, str]] = [
        (notebook.answer(section, claim_id), "told", claim_id)
        for claim_id in sorted(section["claims"], key=lambda c: int(c[1:]))
        if claim_id not in tails
    ]
    said += [
        (notes.decode_claim(claim_id, social["claims"][claim_id]), "overheard", claim_id)
        for claim_id in section["heard"]
    ]
    latest: tuple[int, int, Claim, str, str] | None = None  # (tick, number, claim, how, id)
    for number, (claim, kind, claim_id) in enumerate(said):
        if claim.speaker != person or not goals_ending.about_the_conflict(props[claim.prop]):
            continue
        if latest is None or (claim.tick, number) > latest[:2]:
            latest = (claim.tick, number, claim, kind, claim_id)
    if latest is None:
        return None
    tick, _, claim, kind, claim_id = latest
    entry = notebook.by_prop(section, claim.prop)
    when = clock.at(tick)
    out = {
        "text": notebook.sentence(props[claim.prop]),
        "tick": tick,
        "at": {"day": when.day, "hour": when.hour, "minute": when.minute},
        "how": dict(HOW[kind]),
        "kind": kind,
        "entry": None if entry is None else entry["id"],
    }
    if kind == "told":  # the same belief, said before: asked about again, or who told them
        same = [
            said_id
            for said_claim, said_kind, said_id in reversed(said)
            if said_kind == "told"
            and said_claim.speaker == person
            and said_claim.prop == claim.prop
        ]
        rival = _rival(world, section, props, same)
        if rival is not None:
            out["rival"] = rival
    return out


def _rival(
    world: Any, section: Mapping[str, Any], props: Mapping[str, Prop], answers: list[str]
) -> dict[str, Any] | None:
    """The account the person said after their stand, in the newest of ``answers`` that had one,
    and who they say told them."""
    for claim_id in answers:
        twin = notebook.twin_of(section, claim_id)
        if twin is None:
            continue
        rival = notebook.answer(section, twin)
        if rival.claimed_source not in world.cast.index:
            return None
        return {
            "text": notebook.sentence(props[rival.prop]),
            "who": notebook.name_of(world, rival.claimed_source),
        }
    return None


def wire(world: Any, world_state: dict[str, Any], tick: int) -> list[dict[str, Any]]:
    """The cards as the frame has them, in cast order."""
    from lantern_core.world.bridge import agenda

    lo, section = lore(), world_state["player"]
    wanting = section["notebook"] or section["claims"] or section["heard"]
    props = notebook.view(world_state["social"]) if wanting else None
    people = known(world_state, props)
    if not people:
        return []
    learned = world_state["agenda"]["wants"]
    wants: dict[str, list[dict[str, Any]]] = {}
    for want in agenda.book().wants:
        if want["id"] in learned:
            wants.setdefault(want["person"], []).append(
                {"id": want["id"], "text": agenda.words(want["text"])}
            )
    out = []
    for index in people:
        person = world.cast.people[index]
        met = bool(section["talked"][index])
        out.append(
            {
                "id": person.id,
                "name": {"zh": person.zh, "en": person.en},
                "role": dict(world.cast.data["people"][index]["role"]),
                "family": lo.family[person.id],
                "met": met,
                "find": find(world, index, tick) if met else None,
                "wants": wants.get(person.id, []),
                "favours": pledges.balance(section, person.id),
                "stance": stance(world, world_state, person.id, props),
                "agreed": [
                    row["id"]
                    for row in world_state["commitments"]["list"]
                    if row["by"] == person.id
                ],
            }
        )
    return out
