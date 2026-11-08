"""What a person has in mind when they speak: the facts they may say, and what has reached them
lately.

The people of the town hold their beliefs in the rule tier all the time, so nobody who turns to
speak is empty-handed. A model that words their reply is given two things from here, and neither
holds anything the person does not hold.

*Facts.* The beliefs the person may say, each with the act that says it (a ``belief`` act, in the
modality the belief allows and naming the source the belief gives), so that a model copies an act
and never makes one up. They are ranked by what the three of Generative Agents rank by, as ints:
relevance to what the manager is asking about, importance (``gossip.importance``) and recency
(``gossip.freshness``), as ``RELEVANCE * relevance + importance + recency``, the best first, ties
by the id of the prop. A belief the person hardly holds (``gossip.MIN_CONFIDENCE``), one that has
been set aside, and one the person keeps back (``Lore.guards``) are not facts.

*Lately.* The newest beliefs the person came to hold in the last ``CATCH_UP_TICKS`` ticks, newest
first, so that someone who has been away from the manager for a while arrives knowing what they
have heard since. What a person knew when the game began is not news. The beliefs are the
person's own: nothing here reads another person's.
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any

from lantern_core.cognition.beliefs import Belief
from lantern_core.cognition.props import Prop, lineage
from lantern_core.world.bridge import gossip, notebook, notes
from lantern_core.world.bridge.lore import lore

MAX_FACTS = 6
MAX_LATELY = 4
CATCH_UP_TICKS = 360  # three hours of the day
RELEVANCE = 3  # the weight of relevance against importance and recency, which weigh one each
TOPIC, STORY, SUBJECT = 100, 70, 50  # relevance to what is asked: the prop, its story, an entity

SOURCES = {
    "saw": "you saw it yourself",
    "inferred": "you worked it out yourself",
    "paper": "you read it on a notice",
    "street": "you heard it in the street",
}


@dataclass(frozen=True, slots=True)
class Fact:
    """A belief the person may say: the prop, its sentence in both languages, how they know it,
    and the act that says it."""

    prop: str
    text: Mapping[str, str]
    known: str
    act: Mapping[str, str]
    score: int


def known_how(belief: Belief) -> str:
    """How the holder came by the belief, as a clause addressed to them."""
    if belief.source == "heard":
        assert belief.teller is not None
        told = lore().names[belief.teller]["en"]
        return f"{told} told you" if belief.hop <= 1 else f"you heard it at second hand from {told}"
    return SOURCES[belief.source]


def act_of(belief: Belief, prop: Prop) -> dict[str, str]:
    """The ``belief`` act that says the belief as it is: its modality, and the source it gives."""
    modality = belief.modality
    if modality == "assert" and prop.neg:
        modality = "deny"
    return {
        "path": "belief",
        "prop": prop.id,
        "modality": modality,
        "source": belief.honest_source(),
    }


def relevance(
    prop: Prop, props: Mapping[str, Prop], topic: Collection[str], subjects: Collection[str]
) -> int:
    """How much the prop has to do with what is asked: it is the topic, it is of the topic's story
    (a version of it, or what it was made from), it names an entity that is asked about, or none
    of these (0)."""
    if prop.id in topic:
        return TOPIC
    roots = {lineage(pid, props)[-1] for pid in topic if pid in props}
    if lineage(prop.id, props)[-1] in roots:
        return STORY
    if {entity for _, entity in prop.args} & set(subjects):
        return SUBJECT
    return 0


def facts(
    world_state: Mapping[str, Any],
    person: str,
    tick: int,
    topic: Collection[str] = (),
    subjects: Collection[str] = (),
    limit: int = MAX_FACTS,
) -> list[Fact]:
    """The facts ``person`` may say about what is asked, the best first.

    ``topic`` is the props asked about (or told, or the manager's request rests on) and ``subjects``
    the entities. At most ``limit`` come back.
    """
    lo, social = lore(), world_state["social"]
    props = notebook.view(social)
    ranked: list[tuple[int, str, Fact]] = []
    for belief in notes.store(social, person):
        prop = props.get(belief.prop)
        if (
            prop is None
            or belief.confidence < gossip.MIN_CONFIDENCE
            or belief.tick > tick
            or lo.guards(person, prop)
        ):
            continue
        near = relevance(prop, props, topic, subjects)
        score = (
            RELEVANCE * near + gossip.importance(lo, prop) + gossip.freshness(tick - belief.tick)
        )
        fact = Fact(
            prop.id, notebook.sentence(prop), known_how(belief), act_of(belief, prop), score
        )
        ranked.append((score, prop.id, fact))
    ranked.sort(key=lambda row: (-row[0], row[1]))
    return [fact for _, _, fact in ranked[:limit]]


def lately(
    world_state: Mapping[str, Any], person: str, tick: int, limit: int = MAX_LATELY
) -> list[tuple[Belief, Prop]]:
    """The newest beliefs ``person`` came to hold in the last ``CATCH_UP_TICKS`` ticks, newest
    first, ties by the id of the prop. What the person keeps back is left out."""
    lo, social = lore(), world_state["social"]
    props = notebook.view(social)
    found: list[tuple[int, str, Belief, Prop]] = []
    for belief in notes.store(social, person):
        prop = props.get(belief.prop)
        if (
            prop is None
            or belief.confidence < gossip.MIN_CONFIDENCE
            or not max(1, tick - CATCH_UP_TICKS) <= belief.tick <= tick
            or lo.guards(person, prop)
        ):
            continue
        found.append((-belief.tick, prop.id, belief, prop))
    found.sort(key=lambda row: (row[0], row[1]))
    return [(belief, prop) for _, _, belief, prop in found[:limit]]
