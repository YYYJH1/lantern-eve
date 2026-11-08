"""Granny Li's objection to lending the bamboo, and what Li Da has to know before he moves.

Granny Li keeps the bamboo while the town says that her second son broke the rail and the manager
says nothing (the hard condition ``hc_li_bamboo`` of the script, see ``persuade``). The first of her
three ways is that the rumour is cleared in public, and that is a thing she has to know herself: she
was there and took the clarification in (``clarify``), or one of her family told her of it. The
condition reads her beliefs and not what the town as a whole has been told.

*Withdrawing.* When that way holds for her, she withdraws her objection, once: the event
``objection_withdrawn`` (``npc``, ``what``: the bamboo) and her line of that name, over her head
unless the manager is in a talk (their talk has the line on show). The task of the bamboo is
blocked by her objection (``t_bamboo_first``), and this event is what unblocks it. ``check`` looks
for it after a speech, and ``watch`` every ``WATCH_STRIDE`` ticks, since a telling can bring it too.
The state kept is ``public["withdrawn"]``, the people who have.

*Li Da.* The bamboo is his, and he is not sent by his mother's word. He agrees to bring it to the
bridge only if all three hold (``gate`` says which does not, as the reason the request cannot be
made):

- his mother no longer objects (``needs_nod``): she has withdrawn her objection, or she has agreed
  to lend (a way to the bamboo that is open for her, and that nobody has asked her about, is not
  her word);
- he knows of the clarification himself (``unaware``): he was there when it was made, or was told;
- he trusts the manager ``TRUST_MIN`` or more (``distrust``).

What he weighs after that, and what he does when he agrees, is that of ``entrust``. The first batch
he gives is the first promise of the commitments (``batches`` in the script, see ``commitments``):
four poles of the ten the bridge needs, for the next morning.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import clarify, converse, gossip, persuade, repute
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim

LENDER, CARRIER, BAMBOO = "li_laotai", "li_da", "bamboo"
HARD, WAY = "hc_li_bamboo", "hc_rumor_cleared"
TRUST_MIN = 12
WATCH_STRIDE = 10


def withdrawn(section: dict[str, Any]) -> bool:
    """Whether Granny Li has withdrawn her objection."""
    return LENDER in section["public"].get("withdrawn", ())


def way_holds(world_state: dict[str, Any]) -> bool:
    """Whether the way of her hard condition that is the rumour cleared holds for her."""
    for alternative in persuade.hard_condition(HARD)["any"]:
        if alternative["id"] == WAY:
            return all(persuade.condition_holds(world_state, c) for c in alternative["all"])
    return False


def check(sim: Sim) -> None:
    """Granny Li withdraws her objection if the way holds for her and she has not yet."""
    section = sim.state["player"]
    if "beliefs" not in sim.state["social"]:  # a world without the talk of the town
        return
    if withdrawn(section) or not way_holds(sim.state):
        return
    section["public"].setdefault("withdrawn", []).append(LENDER)
    sim.emit("objection_withdrawn", npc=LENDER, what=BAMBOO)
    if not section["talk"]:
        until = sim.ctx.tick + gossip.BUBBLE_TICKS
        converse.say(section, LENDER, until, "text", "objection_withdrawn")


def watch(sim: Sim) -> None:
    """Every ``WATCH_STRIDE`` ticks, see whether she has come to know what clears the rumour."""
    if sim.ctx.tick % WATCH_STRIDE == 0:
        check(sim)


def objection_gone(world_state: dict[str, Any]) -> bool:
    """Whether Granny Li no longer stands in the way of the bamboo: she withdrew her objection, or
    she agreed to lend it."""
    section = world_state["player"]
    return withdrawn(section) or BAMBOO in section["nod"]


GAPS = ("needs_nod", "unaware", "distrust")  # what can stand between the manager and Li Da's yes


def gaps(world_state: dict[str, Any]) -> list[str]:
    """Everything that stands between the manager and Li Da's yes now, in the order of ``GAPS``:
    his mother still objects (``needs_nod``), he has not heard of the clarification (``unaware``),
    he does not trust the manager enough (``distrust``). Empty when he can be asked."""
    found: list[str] = []
    if not objection_gone(world_state):
        found.append("needs_nod")
    if not clarify.knows_claim(world_state, CARRIER):
        found.append("unaware")
    if repute.trust(world_state["player"], lore().index[CARRIER]) < TRUST_MIN:
        found.append("distrust")
    return found


def gate(world_state: dict[str, Any]) -> str | None:
    """Why Li Da will not be asked for the bamboo yet: the first of ``gaps``, else None."""
    found = gaps(world_state)
    return found[0] if found else None
