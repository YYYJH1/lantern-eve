"""What the town makes of the festival manager: how far each person trusts them, and the stars.

Trust is the list ``trust`` of the section ``player``: an int from 0 to 100 for each person of the
cast, in cast order, that starts at ``STRANGER`` and moves by what the manager does (see
``converse``, ``speak``, ``lies``, ``pledges`` and ``assembly`` for what moves it, and ``player``
for the small trust that a talk earns). Everything that reads it, the call for helpers included
(``goals_call``), reads the same list.

The reputation is the town's trust in the manager boiled down for the side panel: the mean of the
twenty numbers, as ``STAR_LINES`` cut it, from 0 to 3 stars.

What the town says of the manager is made of props about a person who is not of the cast, so the
props are made here: "the manager lied" and "the manager broke a promise", each with the manager
named in the slot ``who`` by the id ``"player"``. The person who saw the lie or the broken word
holds the prop first-hand, and the talk between neighbours carries it from there. When a person
comes to believe such a prop, their trust in the manager falls once for it (``watch``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.cognition.beliefs import Belief
from lantern_core.cognition.props import Prop
from lantern_core.world.bridge import notes
from lantern_core.world.bridge.lore import PLAYER, lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim

STRANGER = 10
STAR_LINES = (12, 25, 40)  # the mean trust at which the first, second and third star light
LIED, BROKE = "m_lied", "m_broke_promise"
MADE = {LIED: "lied", BROKE: "broke_promise"}  # the props the town can come to say of the manager
FIRST_HAND = 90  # how sure a person is of a lie or a broken word they met themselves
BELIEVE_AT = 50  # a belief this sure counts as believing
HEARSAY_DROP = {LIED: 8, BROKE: 6}  # trust lost in the manager by a person who comes to believe it
WATCH_STRIDE = 10  # ticks between two looks at what the town believes of the manager


# ---------------------------------------------------------------------------- trust


def trust(section: dict[str, Any], index: int) -> int:
    """How far the person at cast index ``index`` trusts the manager."""
    return int(section["trust"][index])


def nudge(section: dict[str, Any], index: int, delta: int, why: str = "other") -> int:
    """Move a person's trust by ``delta``, within 0 and 100. Returns the trust now.

    ``why`` is the reason, one of ``hearts.WHY``: the hearts of the person say it if they move
    (``hearts.sync`` reads it from the key ``why`` of the section, where it waits)."""
    value = max(0, min(100, section["trust"][index] + delta))
    if value != section["trust"][index]:
        note(section, index, why)
    section["trust"][index] = value
    return value


def note(section: dict[str, Any], index: int, why: str) -> None:
    """Keep the reason the trust of the person at ``index`` moves, until the hearts are next looked
    at (``hearts.sync``)."""
    section.setdefault("why", {})[lore().people[index]] = why


def stars(section: dict[str, Any]) -> int:
    """The reputation from 0 to 3 stars: the mean trust of the town against ``STAR_LINES``."""
    mean = sum(section["trust"]) // len(section["trust"])
    return sum(1 for line in STAR_LINES if mean >= line)


# ---------------------------------------------------------------------------- what is said of them


def prop(social: dict[str, Any], prop_id: str) -> Prop:
    """The prop "the manager <did this>", made on first use and kept with the props of the game."""
    if prop_id not in social["props"]:
        made = Prop.of(prop_id, MADE[prop_id], {"who": PLAYER})
        social["props"][prop_id] = notes.encode_prop(made)
    return notes.decode_prop(prop_id, social["props"][prop_id])


def believes(social: dict[str, Any], person: str, prop_id: str) -> bool:
    """Whether ``person`` believes the prop about the manager."""
    note = social["beliefs"][person].get(prop_id)
    return note is not None and notes.confidence_of(note) >= BELIEVE_AT


def learn(social: dict[str, Any], person: str, prop_id: str, tick: int) -> None:
    """``person`` knows the prop about the manager first-hand: they were there when it happened."""
    prop(social, prop_id)
    belief = Belief(person, prop_id, "assert", FIRST_HAND, "saw", None, None, 0, tick)
    notes.hold(social, belief)


def mark(section: dict[str, Any], prop_id: str, person: str) -> bool:
    """Note that ``person`` has paid in trust for the prop. False if they had already."""
    paid = section["wary"].setdefault(prop_id, [])
    if person in paid:
        return False
    paid.append(person)
    return True


def watch(sim: Sim) -> None:
    """A person who comes to believe the manager lied, or broke their word, trusts them less.

    Once for each person and prop: the one who met it first-hand paid more at the time, and is
    marked then. The look is taken every ``WATCH_STRIDE`` ticks.
    """
    if sim.ctx.tick % WATCH_STRIDE:
        return
    section, social = sim.state["player"], sim.state["social"]
    for prop_id in sorted(MADE):
        if prop_id not in social.get("props", ()):  # none yet, or a world without the town's talk
            continue
        for index, person in enumerate(lore().people):
            if believes(social, person, prop_id) and mark(section, prop_id, person):
                nudge(section, index, -HEARSAY_DROP[prop_id], "hearsay")
