"""Which tier answers for a person, fixed when a talk opens.

When to ask a model, and which tier to ask, is a fixed rule of the game and never the output of a
model. The rule has two inputs, both known when the talk opens, and the answer holds until the talk
ends. The budget gate may still send a request down a tier (``budget``) and a result may fail, but
the rule is not asked again.

======================  =========================  ==========================
the person is           near the manager           far from the manager
======================  =========================  ==========================
central to the plot     ``strong``                 ``strong``
anyone else             ``cheap``                  ``rule`` (no model is asked)
======================  =========================  ==========================

*Near* is within ``NEAR`` cells (twice the range in which the manager hears two people talk, the
distance at which a reply is made ahead for someone who may be spoken to next). A person in a talk
with the manager is within ``player.TALK_RANGE`` of them, so every talk is near. The far column is
for whatever else asks the same question about a person at a distance.

*Central to the plot* is read off the script, which does not mark it:

- the person has something to hide, a scripted lie of their own (``Lore.book.lies``);
- a hard condition of the script rests on them: they hold it, or it names them as the one to be won
  over, to ask, or to be given something;
- they are the doer or the subject of a prop the story turns on (``speech.plot_critical``).

In the town of the bridge that is Li Er, Old He, Shopkeeper Zhou and his eldest son, Granny Li
and the elder.
"""

from __future__ import annotations

import functools

from lantern_core.world.bridge import overhear, speech
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

RULE, CHEAP, STRONG = "rule", "cheap", "strong"
TIERS = (RULE, CHEAP, STRONG)
NEAR = 2 * overhear.HEARING  # cells, as the king walks
CONDITION_PEOPLE = ("holder", "who", "of", "to")  # the fields of a hard condition that name people


@functools.cache
def central() -> frozenset[str]:
    """The people the plot turns on (see the module docstring), in no particular order."""
    lo = lore()
    found = {env.holder for env in lo.book.lies}
    for row in SCRIPT["hard_conditions"]:
        found.add(row["holder"])
        for alternative in row["any"]:
            for condition in alternative["all"]:
                found.update(
                    condition[key]
                    for key in CONDITION_PEOPLE
                    if isinstance(condition.get(key), str)
                )
    for prop_id in sorted(lo.book.props):
        prop = lo.book.props[prop_id]
        if speech.plot_critical(lo, prop):
            found.update(entity for _, entity in prop.args)
    return frozenset(found & set(lo.people))


def of(person: str, distance: int) -> str:
    """The tier for ``person`` at ``distance`` cells from the manager: ``strong``, ``cheap`` or
    ``rule`` (see the module docstring)."""
    if person in central():
        return STRONG
    return CHEAP if distance <= NEAR else RULE
