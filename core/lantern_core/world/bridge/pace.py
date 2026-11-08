"""How long the acts of the manager take, and the world standing still while they talk.

The rule of time in a conversation, as the player sees it:

* The world stands still. While a conversation is open the world holds its own clock
  (``BridgeWorld.halted``, and ``clock.paused`` of a call says so), so no tick goes by of its own.
  Reading what a person said, going through the notebook, looking at what an act would cost and
  waiting for a model to word an answer take no time. A request to a model stays in flight, and
  its result lands in the world as it is held.
* An act takes the time written for it. ``ask``, ``ask_source``, ``tell``, ``entrust`` and
  ``promise`` in a conversation, and ``speak`` outside one, cost the game minutes that the script
  gives them (``act_minutes``: 10, 10, 15, 20, 20 and 30). The rules answer first, as they always
  did, and then the world owes that time: it runs for as many minutes of its own clock, at
  ``clock.DEBT_RATE``, and holds again when they are paid if the conversation is still open. An
  act that the person did not answer (a body that is refused, a question about nothing) costs
  nothing, and one that they answered with a no costs as much as one with a yes. Debts add up: a
  second act while the first is being paid costs its own minutes on top.
* The person goes when their routine says. A conversation opens knowing the tick at which the
  person's next routine entry starts (``Person.leaves_at``, kept as ``talk["until"]`` and shown to
  the page as ``player.talk.leaves_at``). The tick that brings the clock to it ends the
  conversation: the person says that they have to go (the phrase ``timeout``) and the routine
  goes on, and what is still owed is let go, because the person is gone and the world is back to
  its normal pace. Ending the conversation with ``leave`` lets nothing go. The minutes of the act
  were spent, so an act cannot be had for nothing by leaving at once.
* The frame says what each act costs. ``player.talk.costs`` has the five acts of a conversation
  while one is open, and ``player.costs`` has all six, speaking in public too, in every frame.

Nothing here reads the host. A host that pauses the world pauses the payment too, and a ``resume``
does not open a held conversation. All of it is in the state (the debt in the ``clock`` section,
the conversation in ``player``), so a game that is saved or replayed in the middle of it goes on
exactly. The acts go through ``timed`` below and the charge for one through ``charge``, and
``minutes`` is the one place that answers what an act costs.

What a script that plays the manager has to know. A held world goes on only when the manager does
something: an act that the person answers, or ``leave``. A script (a bot, a driver, a test) that
waits for the clock while a conversation is open waits for ever, and if it keeps what each call
returned it grows without end, which is how a run of the tests once filled the memory of the
machine. Such a script leaves the conversation before it waits, and acts when ``clock.paused`` is
true. The drivers of the cross-host tests stop after ``MAX_STILL`` calls in a row that simulated no
tick, and so does every test of ``tests/core`` and ``tests/cross_host`` (``stall_guard``).

A dev mode of six acts a day (three stretches of the day, two acts in each) hooks in at
``minutes`` and nowhere else. It would be the config key ``dev_pace``, 0 or 1, listed with
``dev_actions``, and while it is on ``minutes(act)`` would answer from how many acts the stretch
has seen: the minutes up to the middle of the stretch for the first, and to the start of the next
for the second. The count is a key of the ``clock`` section that is there only in that mode, as the
debt is only there while it is owed. The mode is not part of this module.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any, NamedTuple

from lantern_core.world.bridge import clock
from lantern_core.world.bridge.data import SCRIPT

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim

Apply = Callable[["Sim", dict[str, Any]], None]

IN_TALK = ("ask", "ask_source", "tell", "entrust", "promise")  # the keys of ``player.talk.costs``
SPEAK = "speak"


def minutes(act: str) -> int:
    """What the act costs in game minutes now: the script's ``act_minutes``."""
    return int(SCRIPT["act_minutes"][act])


def costs() -> dict[str, int]:
    """The minutes of each act of a conversation, as ``player.talk.costs`` shows them."""
    return {act: minutes(act) for act in IN_TALK}


def table() -> dict[str, int]:
    """The minutes of every act, speaking in public included: ``player.costs``, which every frame
    has (the speech has no conversation to show its cost in)."""
    return {act: minutes(act) for act in (*IN_TALK, SPEAK)}


class Mark(NamedTuple):
    """Where a call stood before an act: how many events it had, and how many answers."""

    events: int
    replies: int


def mark(sim: Sim) -> Mark:
    return Mark(len(sim.ctx.events), sim.replies)


def carried_out(sim: Sim, act: str, since: Mark) -> bool:
    """Whether an act was carried out in this call, since ``since``: the person answered it
    (``Sim.replies``, which counts the answers, and not the signal that tells the host), or, for
    speaking in public, its acknowledgement is ``applied``."""
    if act == SPEAK:
        events = sim.ctx.events[since.events :]
        return any(e["kind"] == "action_ack" and e["result"] == "applied" for e in events)
    return sim.replies > since.replies


def charge(sim: Sim, act: str, since: Mark) -> None:
    """The world owes the minutes of ``act`` if it was carried out in this call (``since`` is how
    the call stood before it)."""
    if not carried_out(sim, act, since):
        return
    clock.owe(sim.state, minutes(act) * 60)
    section = sim.state["player"]
    line = section["line"]
    if not section["talk"] and line and line[1] > sim.ctx.tick:
        # What a person says outside a conversation (the elder after a speech) is on show for a
        # while of the world's time, and the world runs fast now: the words last as long again.
        line[1] += clock.ticks_owed(sim.state, sim.now)


def timed(act: str, apply: Apply) -> Apply:
    """``apply``, an act of the manager, followed by the charge for it."""

    def run(sim: Sim, body: dict[str, Any]) -> None:
        since = mark(sim)
        sim.act_seconds = minutes(act) * 60  # what is made in the act is made when it is over
        try:
            apply(sim, body)
        finally:
            sim.act_seconds = 0
        charge(sim, act, since)

    return run
