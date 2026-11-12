"""The hearts: how close each person stands to the festival manager, for the page to show.

Each person has a row of five hearts, kept as ``hearts``, a whole number from 0 to 10 in half
hearts. It is a way of showing the trust and the favours that are in the state already, and it is
not read by anything: no rule of the town looks at the hearts, so they are no threshold for a person
to agree to a request, and a request is weighed as it ever was (``persuade``).

The formula, in integers::

    points = trust - STRANGER + FAVOUR_STEP * owed
    hearts = clamp((points + STEP // 2) // STEP, 0, MAX_HEARTS)

``trust`` is how far the person trusts the manager (0 to 100, ``repute``) and ``STRANGER`` the trust
everyone starts at, so a stranger has no heart. ``owed`` is the favours the person owes the manager
(the positive part of ``pledges.balance``, which a promise that is kept adds to), each worth
``FAVOUR_STEP`` points of trust. What the manager owes the person for a favour is on the card of the
person and takes no heart away. ``STEP`` points make half a heart, so the first talk of a day with a
stranger (three points) earns the half heart, a promise made earns one or two, and a lie that is
found out (25 points) takes four or five.

When a heart is gained or lost, the event ``hearts`` is sent (``sync``), ``{"npc", "delta",
"hearts", "why"}``, with ``delta`` in half hearts and ``why`` one of ``WHY``. It is a signal, which
the state does not count, so it moves no version and no hash. The state keeps what the frame shows
of it: the hearts last shown (``hearts``), and for each person the last ``KEPT`` changes
(``warm``: ``[tick, delta, why]``). Both keys of the section ``player`` are there only once a heart
has moved.

The reason of a change is set by whatever moves the trust (``repute.nudge`` takes it and keeps it in
the key ``why`` of the section until the next look), and the change itself is found by comparing the
hearts with the ones last shown, at the end of every action of the manager and of every tick, so
that a trust that moves for two reasons in one call is one change with the last of them.

``why`` is one of: ``talk`` (the first talk of a day), ``promise`` (a promise made to the person),
``kept`` (a promise kept), ``broken`` (a promise that lapsed), ``gift`` (a small thing given),
``cleared`` (a clarification in public that the person took in), ``spoke`` (proof shown in public
that the person accepted), ``meal`` (a table laid for the two families), ``statement`` (a statement
in public that did not hold), ``overclaim`` (a claim that went further than what a witness saw),
``lie`` (a lie of the manager's that the person caught), ``hearsay`` (the person came to believe
that the manager lied or broke their word), ``blame`` (the manager spoke ill of the person or their
own) and ``other``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import pledges, repute
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim

STEP = 6  # points of trust to a half heart
FAVOUR_STEP = 4  # points of trust that a favour owed to the manager is worth
MAX_HEARTS = 10  # five hearts, in halves
KEPT = 5  # changes kept for the card of a person
WHY = (
    "talk",
    "promise",
    "kept",
    "broken",
    "gift",
    "cleared",
    "spoke",
    "meal",
    "statement",
    "overclaim",
    "lie",
    "hearsay",
    "blame",
    "other",
)
OTHER = "other"


def owed_to(section: dict[str, Any]) -> list[int]:
    """The favours each person owes the manager, in cast order: the positive part of the balance
    of ``pledges.balance``, worked out for everyone in one pass."""
    people = lore().people
    totals = dict.fromkeys(people, 0)
    if not section["deeds"]:
        return [0] * len(people)
    for _, deed in sorted(section["deeds"].items()):
        if deed[0] in totals:
            totals[deed[0]] += deed[1] * deed[2]
    return [max(0, min(pledges.MAX_BALANCE, totals[person])) for person in people]


def count(trust: int, owed: int) -> int:
    """The hearts, in half hearts, of a person whom ``trust`` points of trust and ``owed`` favours
    stand for."""
    points = trust - repute.STRANGER + FAVOUR_STEP * owed
    return max(0, min(MAX_HEARTS, (points + STEP // 2) // STEP))


def now(section: dict[str, Any]) -> list[int]:
    """The hearts of everyone, in cast order, as the state stands."""
    owed = owed_to(section)
    return [count(int(trust), owed[i]) for i, trust in enumerate(section["trust"])]


def shown(section: dict[str, Any]) -> list[int]:
    """The hearts the page was last told, in cast order (all 0 before any moved)."""
    found = section.get("hearts")
    return list(found) if found is not None else [0] * len(section["trust"])


def log_of(section: dict[str, Any], person: str) -> list[list[Any]]:
    """The last changes of the hearts of ``person``, oldest first: ``[tick, delta, why]``."""
    return [list(row) for row in section.get("warm", {}).get(person, ())]


def sync(sim: Sim) -> None:
    """Find the hearts that moved since they were last shown, say so, and keep the last changes.

    Called at the end of every action of the manager and of every tick of the player section. The
    state is touched only when a heart moved.
    """
    section = sim.state["player"]
    reasons = section.pop("why", {})  # what moved the trust since the last look, if anything did
    current = now(section)
    old = section.get("hearts")
    if old is None:
        if not any(current):
            return
        old = [0] * len(current)
    if current == old:
        return
    people = lore().people
    warm = section.setdefault("warm", {})
    for index, person in enumerate(people):
        delta = current[index] - old[index]
        if not delta:
            continue
        why = reasons.get(person, OTHER)
        rows = warm.setdefault(person, [])
        rows.append([sim.ctx.tick, delta, why])
        del rows[:-KEPT]
        sim.signal("hearts", npc=person, delta=delta, hearts=current[index], why=why)
    section["hearts"] = current
