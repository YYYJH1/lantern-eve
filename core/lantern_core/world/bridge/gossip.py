"""Who talks to whom, and about what.

Two people may talk when they are neighbours: on cells next to each other, or both at the same
indoor place. Each person gets a turn every ``STRIDE`` ticks, staggered like the walking, and a
person who is free, awake and has a neighbour speaks with a chance that grows with the gossip
trait. The neighbour they speak to is drawn by how much they like them. A person who has told
something is busy for the ticks the telling takes, and does not speak again until a rest has
passed, which is shorter the more they gossip. Nobody speaks to someone asleep or in the middle of
a telling, and a person who finds nothing to tell looks again after a short while.

What they say is the belief with the highest salience for that listener, all ints::

    salience = importance * freshness * relevance * trust // 100,000        (at most 1,000)

- importance, 5 to 100: what the prop is about (blaming someone is weightier than where they
  stood), more if it has a motive, and more if it touches the incident that opened the story.
- freshness, 10 to 100: it falls over two game days from the tick the speaker came to hold it.
- relevance, 13 to 80: more if it names the listener or their kin, or the listener's home or work,
  and a third of that if the listener already holds a version of the same story, which is to say a
  prop of the same root, since a story is news once and a version of it hardly is.
- trust, 20 to 100: the speaker's trust in the listener, and 20 more.

Nothing is told that the listener already holds, that the listener told the speaker, that the
speaker hardly believes, that the speaker guards (see ``Lore.guards``: what a lie of theirs would
deny, what they pretend not to know of, what blames them), or whose salience is below
``MIN_SALIENCE``. Nor is anything told of a story that is quiet now, which a game opened from an
opening of the script may have for a while (``opening``).
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from typing import TYPE_CHECKING, Any

from lantern_core.cognition.beliefs import Belief
from lantern_core.cognition.props import ACCIDENT, Prop, lineage
from lantern_core.world.bridge import bonds, notes

if TYPE_CHECKING:
    from lantern_core.world.bridge.lore import Lore
    from lantern_core.world.bridge.town import Town

STRIDE = 4
TELL_TICKS = 16  # how long a telling takes, for the dot that carries it
BUBBLE_TICKS = 60  # how long the speaker's words stay over their head
SPEAK_PER_MILLE = 2  # the chance in a turn, per point of the gossip trait
COOLDOWN = 800  # ticks, and up to 100 more for someone who hardly gossips
RETRY = 30  # ticks before a person who had nothing to tell looks again
MIN_CONFIDENCE = 25
MIN_SALIENCE = 20
FRESH_SPAN = 4140  # ticks: two game days
KNOWN_STORY = 3
NEAR = 1

IMPORTANCE = {
    "damaged": 90,
    "stole": 90,
    "lied": 70,
    "broke_promise": 70,
    "hid": 80,
    "took": 70,
    "flood_damaged": 60,
    "missing": 60,
    "fled_from": 50,
    "wanted": 50,
    "left_at": 40,
    "repaired": 40,
    "broken": 40,
    "gave": 30,
    "refused": 30,
    "came_from": 30,
    "looked_for": 30,
    "drank": 30,
    "scratched": 30,
    "at": 30,
    "made": 20,
    "flooded": 20,
    "located": 5,
    "owns": 5,
}
DEFAULT_IMPORTANCE = 20
MOTIVE_BONUS = 10
INCIDENT_BONUS = 40


# ----------------------------------------------------------------------------- who is near


def at_goal(npc: Mapping[str, Any]) -> bool:
    return max(abs(npc["x"] - npc["goal"][0]), abs(npc["y"] - npc["goal"][1])) <= NEAR


def asleep(npc: Mapping[str, Any]) -> bool:
    return npc["act"] == "sleep" and at_goal(npc)


def neighbours(town: Town, npcs: list[dict[str, Any]], i: int) -> list[int]:
    """The indices of the people next to person ``i`` who are awake, in cast order."""
    me = npcs[i]
    indoors = at_goal(me) and town.places[me["place"]].indoor
    out = []
    for j, other in enumerate(npcs):
        if j == i or asleep(other):
            continue
        close = max(abs(me["x"] - other["x"]), abs(me["y"] - other["y"])) <= NEAR
        together = indoors and other["place"] == me["place"] and at_goal(other)
        if close or together:
            out.append(j)
    return out


def speak_per_mille(lore: Lore, speaker: str) -> int:
    """The chance, in a thousand, that a free person with a neighbour speaks in their turn."""
    return lore.traits[speaker]["gossip"] * SPEAK_PER_MILLE


def cooldown(lore: Lore, speaker: str) -> int:
    return COOLDOWN + (100 - lore.traits[speaker]["gossip"])


# ----------------------------------------------------------------------------- what is told


def importance(lore: Lore, prop: Prop) -> int:
    base = IMPORTANCE.get(prop.pred, DEFAULT_IMPORTANCE)
    if prop.motive not in (None, ACCIDENT):
        base += MOTIVE_BONUS
    if lore.incident & {entity for _, entity in prop.args}:
        base += INCIDENT_BONUS
    return min(100, base)


def freshness(age: int) -> int:
    return max(10, 100 - max(0, age) * 90 // FRESH_SPAN)


def relevance(lore: Lore, listener: str, prop: Prop, knows_story: bool) -> int:
    named = {entity for _, entity in prop.args}
    if named & lore.kin[listener]:
        near = 80
    elif named & {lore.home[listener], lore.work[listener]}:
        near = 60
    else:
        near = 40
    return near // KNOWN_STORY if knows_story else near


def salience(
    lore: Lore,
    social: dict[str, Any],
    belief: Belief,
    prop: Prop,
    listener: str,
    tick: int,
    knows_story: bool,
) -> int:
    trust = min(100, bonds.value(social, lore, belief.holder, listener, bonds.TRUST) + 20)
    return (
        importance(lore, prop)
        * freshness(tick - belief.tick)
        * relevance(lore, listener, prop, knows_story)
        * trust
        // 100_000
    )


def best_belief(
    lore: Lore,
    social: dict[str, Any],
    view: Mapping[str, Prop],
    speaker: str,
    listener: str,
    tick: int,
    quiet: Collection[str] = (),
) -> str | None:
    """The prop the speaker would tell the listener now, or ``None`` if there is nothing.

    ``quiet`` lists the roots of the stories nobody passes on now: a prop of one of them is left
    out.
    """
    roots: dict[str, str] = {}

    def story(prop_id: str) -> str:
        if prop_id not in roots:
            roots[prop_id] = lineage(prop_id, view)[-1]
        return roots[prop_id]

    held = social["beliefs"][listener]
    stories = {
        story(prop_id)
        for prop_id in held
        if prop_id in view and notes.confidence_of(held[prop_id]) > 0
    }
    best: tuple[int, str] | None = None
    notes_of = social["beliefs"][speaker]
    for prop_id in sorted(notes_of):
        if prop_id in held or prop_id not in view:
            continue
        belief = notes.decode_belief(speaker, prop_id, notes_of[prop_id])
        if belief.confidence < MIN_CONFIDENCE or belief.teller == listener:
            continue
        prop = view[prop_id]
        if lore.guards(speaker, prop) or (quiet and story(prop_id) in quiet):
            continue
        knows_story = story(prop_id) in stories
        score = salience(lore, social, belief, prop, listener, tick, knows_story)
        if score >= MIN_SALIENCE and (best is None or score > best[0]):
            best = (score, prop_id)
    return None if best is None else best[1]
