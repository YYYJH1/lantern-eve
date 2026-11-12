"""Getting caught lying.

A lie of the manager (a thing made up, or a thing only heard that was told as seen) goes into the
record of the town like any telling, and into the ledger ``lies`` of the section ``player``::

    [claim id, listener, prop id, how, tick]

Nobody here "knows" a lie to be one. A person catches the manager only by what they hold, by the
same two conditions at any moment:

- they hold a belief in the lie that they know the manager told (it was told to them, or the
  person who told them named the manager), and
- they hold another belief that cannot be true together with it (``Lore.excludes``) and is more
  confident than their belief in the lie. Seen with their own eyes is sure; so is what they heard
  from a person they trust more than the manager. The belief in the lie may have been set aside
  when they heard it, because they trusted their own more: that is a catch on the spot.

A person who catches the manager sets the lie aside, trusts the manager much less (``EXPOSED_DROP``)
and holds first-hand that the manager lied (``repute.LIED``), which the talk between neighbours
then carries on, so the town trusts the manager less too (``repute.watch``). The look is taken at
once after a telling, for the listener, and at ``LOOK_STRIDE`` ticks for everyone.

A lie that nobody holds anything against is not caught, and so is one told to someone who never
learns better. Telling things as they are is always safe.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.cognition.beliefs import Claim
from lantern_core.world.bridge import converse, notebook, notes, repute
from lantern_core.world.bridge.lore import PLAYER, lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim

EXPOSED_DROP = 25
LOOK_STRIDE = 20


def log(section: dict[str, Any], claim: Claim, how: str) -> None:
    """Put a lie of the manager's in the ledger."""
    section["lies"].append([claim.id, claim.listeners[0], claim.prop, how, claim.tick])


def is_caught(section: dict[str, Any], prop_id: str, person: str) -> bool:
    return any(row[0] == prop_id and row[1] == person for row in section["caught"])


def uncaught_to(section: dict[str, Any], person: str) -> list[list[Any]]:
    """The lies told to ``person`` that they have not caught, in the order they were told."""
    return [
        row
        for row in section["lies"]
        if row[1] == person and not is_caught(section, row[2], person)
    ]


def check(sim: Sim, person: str) -> bool:
    """Whether ``person`` catches the manager in a lie now. They do, once for each lie."""
    section, social = sim.state["player"], sim.state["social"]
    if not section["lies"]:
        return False
    lo = lore()
    mine = social["beliefs"][person]
    caught = False
    for prop_id in sorted({row[2] for row in section["lies"]}):
        note = mine.get(prop_id)
        if note is None or is_caught(section, prop_id, person):
            continue
        belief = notes.decode_belief(person, prop_id, note)
        if PLAYER not in (belief.teller, belief.claimed_source):
            continue  # they do not know who said it
        view = notebook.view(social)  # afresh: a catch before this one has made a prop
        prop = view[prop_id]
        store = notes.store(social, person)
        if any(
            held.prop != prop_id
            and held.confidence > belief.confidence
            and lo.excludes(prop, view[held.prop])
            for held in store
        ):
            catch(sim, person, prop_id)
            caught = True
    return caught


def catch(sim: Sim, person: str, prop_id: str) -> None:
    """``person`` catches the manager in the lie ``prop_id``."""
    section, social, tick = sim.state["player"], sim.state["social"], sim.ctx.tick
    index = lore().index[person]
    section["caught"].append([prop_id, person, tick])
    note = social["beliefs"][person][prop_id]
    social["beliefs"][person][prop_id] = notes.with_confidence(note, 0)
    notes.forget_rivals(social, person, prop=prop_id)  # a lie that is found out is no rival account
    repute.learn(social, person, repute.LIED, tick)
    repute.mark(section, repute.LIED, person)
    value = repute.nudge(section, index, -EXPOSED_DROP, "lie")
    sim.emit("lie_caught", npc=person, prop=prop_id, trust=value)
    talk = section["talk"]
    if talk and talk["npc"] == person:
        converse.reply(sim, "caught")


def watch(sim: Sim) -> None:
    """Every ``LOOK_STRIDE`` ticks, let everyone see whether they now know better than a lie."""
    if sim.ctx.tick % LOOK_STRIDE or not sim.state["player"]["lies"]:
        return
    for person in lore().people:
        check(sim, person)
