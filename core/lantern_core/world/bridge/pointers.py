"""Pointing the way: what a person says when they know nothing of what the manager asks.

A person who holds nothing on a topic does not just say so. They name a direction, following what
they know and nothing else, in this order:

1. someone they heard talk about it: the person who last told them something about the matter
   (``point_heard``);
2. otherwise a hub that the script marks, the person in town who keeps up with everything said
   (``hubs`` in the script, the teahouse keeper), unless the hub is the person asked
   (``point_hub``);
3. otherwise nobody, and they say that they do not know, as before (``unknown``).

The topic is a prop (the matter is the same story, or the same thing said again) or a subject (a
person, a place or a thing the prop names). A telling counts when the person was the listener of it
and the speaker is neither them nor the manager. A person who keeps something back says nothing
here, as before (``evade``), and one who feigns not to know is treated as one who does not, so that
the direction does not tell the two apart: it is made from whom they heard, and not from what they
hold.

The line is the code of ``phrases`` (``point_heard`` or ``point_hub``), said in the voice of the
person, with the name of the person it points to, which the state keeps as the line (``converse``).
Nothing here reads which story is true, and nothing draws from the RNG.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from lantern_core.cognition.props import Prop, lineage
from lantern_core.world.bridge import notebook, notes
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import PLAYER, lore

HEARD, HUB = "point_heard", "point_hub"


@dataclass(frozen=True, slots=True)
class Pointer:
    """Where a person sends the manager: the code of the line, and whom it names."""

    code: str
    who: str


def _about(topic: str, said: Prop, props: Mapping[str, Prop]) -> bool:
    """Whether a prop that was told is about the topic: the topic is a prop and the told one is the
    same thing or the same story, or it is an entity that the told one names."""
    asked = props.get(topic)
    if asked is None:
        return topic in {entity for _, entity in said.args}
    if said.id == asked.id or said.same_fact(asked):
        return True
    first, second = lineage(said.id, props), lineage(asked.id, props)
    return bool(first) and bool(second) and first[-1] == second[-1]


def heard_from(world_state: Mapping[str, Any], person: str, topic: str) -> str | None:
    """The person who last told ``person`` something about the topic, or None."""
    social = world_state["social"]
    props = notebook.view(social)
    found: tuple[int, str] | None = None
    for claim_id, note in social["claims"].items():
        claim = notes.decode_claim(claim_id, note)
        if claim.listeners[0] != person or claim.speaker in (person, PLAYER):
            continue
        if claim.prop in props and _about(topic, props[claim.prop], props):
            number = int(claim_id[1:])
            if found is None or number > found[0]:
                found = (number, claim.speaker)
    return None if found is None else found[1]


def direction(world_state: Mapping[str, Any], person: str, topic: str) -> Pointer | None:
    """Where ``person`` sends the manager who asked about ``topic``, or None for nowhere."""
    heard = heard_from(world_state, person, topic)
    if heard is not None and heard in lore().names:
        return Pointer(HEARD, heard)
    for hub in SCRIPT["hubs"]:
        if hub not in (person, PLAYER) and hub in lore().names:
            return Pointer(HUB, hub)
    return None
