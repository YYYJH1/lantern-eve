"""The terms that the conditions of a task are written in, and what each one reads.

A task of the script (``tasks`` in ``content/scripts/broken_bridge.yaml``) says when it appears,
when it is blocked, when it is done and when it goes stale, and a want of a person says when the
player has learned it. Each is a list of conditions that must all hold, and a condition is a term,
``{"kind": ..., args}``, or ``{"all": [...]}``, ``{"any": [...]}`` and ``{"not": cond}`` of
conditions. An empty list of conditions holds, except for ``done`` and ``stale`` of a task, which
are never met by none (``agenda`` reads them so).

The vocabulary is closed. A term reads only what the player knows: their notebook, what they have
been through (the events ``agenda`` remembers), where they stand, the hour, the flags of the
festival. It never reads what is true in the game, which variant, or what another person believes,
so that a task cannot give the truth away (``projection`` has the audit, and the tests change the
hidden fields and compare).

==================  =================================================  ========================
term                holds when                                         arguments
==================  =================================================  ========================
``note``            the notebook has an entry of one of the props      ``props``
``note_first_hand`` the notebook has an entry of one of the props,     ``props``, ``by``
                    told by ``by``, who says they saw it
``event``           an event of that kind with those fields has been   ``event``, ``where``?
                    among the events ``agenda`` remembers
``refused``         ``npc`` turned the player down with a "no" (an     ``npc``, ``reason``?
                    ``entrusted`` event, ``hard`` or ``refused``),
                    for the reason, a fixed line of ``phrases``, if
                    one is given
``window``          the clock is within the hours of that day          ``day``, ``from``, ``to``
``after``           the clock has reached that hour of that day        ``day``, ``hour``
``at_place``        the player stands within reach of the place        ``place``
``flag``            the flag of the festival is up                     ``flag``
``judged``          the notebook has a judgment (judgments)            ``relation``?
``clarified``       a clarification was accepted (clarification)       ``props``?
``commitment``      somebody's commitment to the player is in that     ``by``, ``item``,
                    state (commitments), or with ``latest`` the        ``state``, ``latest``?
                    newest one of that person for that item is
``turned_down``     the last request to ``npc`` for the goods they     ``npc``, ``request``?
                    bring (``request: lane``: for the lane,
                    ``testify``: for what they saw) was a no, and
                    asking again would only be answered "I have
                    said it already" (entrust); with ``request:
                    look``, the last look at a thing of theirs was
                    refused and the manager has not promised them
                    anything or had a first talk with them on a
                    later day since
``can_promise``     the manager has something left to promise and      ``npc``
                    has made ``npc`` fewer than three promises
                    since first asking them for anything
``helper_waits``    the person to ask to join next answered with a no  (none)
                    or a yes that waits, and nothing was promised
                    to them since
``crew``            five people have agreed to help, and there is      (none)
                    one of each family among them
``helpers``         at least that many have agreed to help (of that    ``at_least``, ``family``?
                    family, if one is given)
``work``            the work done at the bridge has reached that       ``percent``
                    per cent
``work_short``      the helpers who have joined cannot do the hours    (none)
                    of work that are left in the mornings that are
                    left before the deadline (a heavy rain today
                    costs today's, the sky of a day to come is not
                    known)
``weather``         today's sky is that (``clear``, ``light_rain``     ``is``
                    or ``heavy_rain``)
``passed_on``       the manager has told ``npc`` a note of one of      ``npc``, ``props``
                    the props
``talked_today``    the manager has had a first talk with ``npc``      ``npc``
                    today (which earns a little of their trust)
``fresh_proof``     a statement of evidence at ``venue`` now would     ``venue``
                    not be answered "said already": the manager
                    holds some evidence that the last one there did
                    not show, or that one was made on an earlier day
``hours``           the hour of the clock is from ``from`` up to       ``from``, ``to``
                    ``to``, on any day
``looked``          the player has looked for one of these items of    ``items``
                    evidence, found or not (``evidence``)
``evidence``        the player holds one of these items of evidence    ``items``
``told``            the last statement of evidence in public           ``missed``?
                    (``assembly``) fell short of that condition of
                    the truth, or there has been one if none is named
``meeting``         the elder has called the clan, and the hall is     (none)
                    open
``grudge``          the grudge between the heads of the two families   ``below``
                    (the metric of the festival) is under that
``card_filled``     every part of the statement card has an option     (none)
                    chosen (statement)
``card_fillable``   some part of the card has no option chosen and     (none)
                    one that a note bears for, to choose
``stated_today``    a full statement was made today (one a day)        (none)
``pledge``          the manager's ``n``-th promise (``pledges``) has   ``n``, ``state``?,
                    been made, is in that state (``open``, ``kept``    ``due``?
                    or ``broken``) and falls due as said: ``today``
                    (the day it is due is the day going on) or
                    ``ahead`` (a later day)
``eased``           the deed of the peace is done (``peace``): a head   ``act``
                    stopped accusing in public (``stop_blaming``),
                    helpers of both families worked at the bridge the
                    same morning (``work_together``), or a meal for
                    both heads was seen (``witnessed_meal``)
``called``          the elder has called the clan and the hours of      (none)
                    the meeting have not gone by, whether the clan
                    has come to the hall yet or not
==================  =================================================  ========================

``judged``, ``clarified`` and ``commitment`` were in the vocabulary before the parts of the state
they read were there, so that content could use them, and they held nothing until the code that
added those parts called ``implement`` with the function that reads them. ``spec()`` is what
content is checked against (``tools/check_content.py`` keeps the same table, and a test holds the
two equal).

Adding a term. Write a function ``holds(env, cond)`` and register it with ``term`` (or ``implement``
for one that was registered with ``later``). It may read the world state in ``env.state`` and the
time in ``env.now``. Anything it reads must change together with an event, with the hour of the
clock or with the cell the player stands on, because ``agenda`` looks again only when one of those
has moved (and a thing that moves otherwise has to emit an event when it does, and a term that wants
the minutes has to change ``agenda.moved`` to say so). A term that is about events says which
fields of which event ``agenda`` is to keep (``records``).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any, NamedTuple

from lantern_core.cognition.beliefs import SELF_SEEN
from lantern_core.world.bridge import (
    clock,
    evidence,
    goals,
    goals_call,
    notebook,
    pledges,
    weather,
)

MINUTES_A_DAY = 24 * 60
ENTRUSTED = "entrusted"
REFUSALS = ("hard", "refused")  # the results of an ``entrusted`` event that are a "no"


class Env(NamedTuple):
    """What a term may look at: the world, its state (``state["world"]``) and the time."""

    world: Any
    state: dict[str, Any]
    now: clock.Now


Holds = Callable[[Env, dict[str, Any]], bool]
Records = Callable[[dict[str, Any]], dict[str, set[str]]]


class Term:
    """One term: the arguments it takes, how it holds, the events it needs kept, and the subsystem
    that owes it if it holds nothing yet."""

    __slots__ = ("holds", "later", "records", "spec")

    def __init__(
        self, spec: dict[str, str], holds: Holds, records: Records | None = None, later: str = ""
    ) -> None:
        self.spec = spec
        self.holds = holds
        self.records = records or (lambda cond: {})
        self.later = later


TERMS: dict[str, Term] = {}


def term(
    name: str, spec: dict[str, str], records: Records | None = None
) -> Callable[[Holds], Holds]:
    """Register ``name`` with the function that says when it holds."""

    def register(fn: Holds) -> Holds:
        TERMS[name] = Term(spec, fn, records)
        return fn

    return register


def never(env: Env, cond: dict[str, Any]) -> bool:
    return False


def later(name: str, subsystem: str, spec: dict[str, str]) -> None:
    """A term that nothing reads yet: in the vocabulary, and met by nothing."""
    TERMS[name] = Term(spec, never, later=subsystem)


def implement(name: str, fn: Holds, records: Records | None = None) -> None:
    """Say what a term that was read by nothing now reads."""
    old = TERMS[name]
    TERMS[name] = Term(old.spec, fn, records or old.records)


def spec() -> dict[str, dict[str, str]]:
    """The vocabulary as content is written in it: term -> {argument: kind of value}."""
    return {name: dict(t.spec) for name, t in TERMS.items()}


# ---------------------------------------------------------------------------- reading conditions


def holds(env: Env, cond: dict[str, Any]) -> bool:
    """Whether a condition holds: a term, or ``all``, ``any`` or ``not`` of conditions."""
    if "all" in cond:
        return all(holds(env, item) for item in cond["all"])
    if "any" in cond:
        return any(holds(env, item) for item in cond["any"])
    if "not" in cond:
        return not holds(env, cond["not"])
    return TERMS[cond["kind"]].holds(env, cond)


def holds_all(env: Env, conds: list[dict[str, Any]]) -> bool:
    """Whether every condition of the list holds (so an empty list does)."""
    return all(holds(env, cond) for cond in conds)


def leaves(conds: list[dict[str, Any]]) -> Iterator[dict[str, Any]]:
    """The terms in a list of conditions, whatever they are nested in."""
    for cond in conds:
        for key in ("all", "any"):
            if key in cond:
                yield from leaves(cond[key])
        if "not" in cond:
            yield from leaves([cond["not"]])
        if "kind" in cond:
            yield cond


def recorded(conds: list[dict[str, Any]]) -> dict[str, set[str]]:
    """The events that the conditions ask about, and the fields of each that they read."""
    found: dict[str, set[str]] = {}
    for leaf in leaves(conds):
        for kind, fields in TERMS[leaf["kind"]].records(leaf).items():
            found.setdefault(kind, set()).update(fields)
    return found


# ---------------------------------------------------------------------------- the clock


def minute_of(now: clock.Now) -> int:
    """Minutes since 06:00 of the first day, so that the small hours come after the evening."""
    return (now.day - 1) * MINUTES_A_DAY + (now.hour * 60 + now.minute - 360) % MINUTES_A_DAY


def minute_at(day: int, hour: int) -> int:
    """The same count for ``hour`` o'clock of ``day`` (24 is midnight at the end of the day)."""
    return (day - 1) * MINUTES_A_DAY + (hour * 60 - 360) % MINUTES_A_DAY


# ---------------------------------------------------------------------------- the terms


@term("note", {"props": "known_props"})
def _note(env: Env, cond: dict[str, Any]) -> bool:
    held = {entry["prop"] for entry in env.state["player"]["notebook"]}
    return any(prop in held for prop in cond["props"])


@term("note_first_hand", {"props": "known_props", "by": "person"})
def _note_first_hand(env: Env, cond: dict[str, Any]) -> bool:
    for entry in env.state["player"]["notebook"]:
        if entry["prop"] not in cond["props"]:
            continue
        belief = notebook.belief_of(entry)
        if (
            belief.source == "heard"
            and belief.teller == cond["by"]
            and belief.claimed_source == SELF_SEEN
        ):
            return True
    return False


def _event_records(cond: dict[str, Any]) -> dict[str, set[str]]:
    return {cond["event"]: set(cond.get("where", {}))}


@term("event", {"event": "event", "where?": "where"}, _event_records)
def _event(env: Env, cond: dict[str, Any]) -> bool:
    where = cond.get("where", {})
    for kind, _, fields in env.state["agenda"]["seen"]:
        if kind == cond["event"] and all(fields.get(k) == v for k, v in where.items()):
            return True
    return False


def _refused_records(cond: dict[str, Any]) -> dict[str, set[str]]:
    return {ENTRUSTED: {"npc", "result", "reason"}}


@term("refused", {"npc": "person", "reason?": "word"}, _refused_records)
def _refused(env: Env, cond: dict[str, Any]) -> bool:
    for kind, _, fields in env.state["agenda"]["seen"]:
        if (
            kind == ENTRUSTED
            and fields.get("npc") == cond["npc"]
            and fields.get("result") in REFUSALS
            and ("reason" not in cond or fields.get("reason") == cond["reason"])
        ):
            return True
    return False


@term("window", {"day": "day", "from": "hour", "to": "hour"})
def _window(env: Env, cond: dict[str, Any]) -> bool:
    day = cond["day"]
    return minute_at(day, cond["from"]) <= minute_of(env.now) < minute_at(day, cond["to"])


@term("after", {"day": "day", "hour": "hour"})
def _after(env: Env, cond: dict[str, Any]) -> bool:
    return minute_of(env.now) >= minute_at(cond["day"], cond["hour"])


@term("at_place", {"place": "place"})
def _at_place(env: Env, cond: dict[str, Any]) -> bool:
    return evidence.within_reach(env.world, env.state["player"], cond["place"])


@term("flag", {"flag": "flag"})
def _flag(env: Env, cond: dict[str, Any]) -> bool:
    if "flags" not in env.state.get("goals", {}):  # a world whose section is not the festival's
        return False
    return goals.flag_up(env.state, cond["flag"])


# the terms that the judgments, the clarification and the commitments read: each of those modules
# replaces its placeholder with ``implement``, and until it does the term holds nothing
later("judged", "judgments", {"relation?": "relation"})
later("clarified", "clarification", {"props?": "known_props"})
later(
    "commitment",
    "commitments",
    {"by": "person", "item": "item", "state": "commitment_state", "latest?": "yes"},
)


# ----------------------------------------------------------------------- the bridge, days 2 to 5
# What the helpers, the work and the sky say, for the tasks of the bridge. Each reads what the
# player is shown: who has joined (the events ``joined``, and the family of anyone is public), the
# hours of work (the hud) and the sky (the frame).


@term("crew", {})
def _crew(env: Env, cond: dict[str, Any]) -> bool:
    return goals.keeps_the_goals(env.state) and goals_call.crew_ready(
        env.world, env.state["goals"]["call"]
    )


@term("helpers", {"at_least": "count", "family?": "family"})
def _helpers(env: Env, cond: dict[str, Any]) -> bool:
    if not goals.keeps_the_goals(env.state):
        return False
    total, per_family = goals_call.crew(env.world, env.state["goals"]["call"])
    found = per_family.get(cond["family"], 0) if "family" in cond else total
    return found >= cond["at_least"]


@term("work", {"percent": "percent"})
def _work(env: Env, cond: dict[str, Any]) -> bool:
    return (
        goals.keeps_the_goals(env.state)
        and goals.metric(env.state, "work_progress") >= cond["percent"]
    )


@term("work_short", {})
def _work_short(env: Env, cond: dict[str, Any]) -> bool:
    from lantern_core.world.bridge import agenda_facts, goals_work  # not at the top: cycle

    if not goals.keeps_the_goals(env.state):
        return False
    g = env.state["goals"]
    left = goals_work.BRIDGE_HOURS - agenda_facts.hours_done(env.state)
    if "g_labor" in g["done"] or g["ending"] or left <= 0:
        return False
    mornings = agenda_facts.mornings_left(env.world, env.state, env.now)
    return len(g["call"]["joined"]) * mornings < left


@term("weather", {"is": "sky"})
def _weather(env: Env, cond: dict[str, Any]) -> bool:
    return weather.today(env.state) == cond["is"]


# ------------------------------------------------------------- the truth and the peace, days 2 to 5
# The hour of the day, what the player has looked for and holds, the last statement in public, and
# the clan called to the hall.


@term("hours", {"from": "hour", "to": "hour"})
def _hours(env: Env, cond: dict[str, Any]) -> bool:
    return cond["from"] <= env.now.hour < cond["to"]


@term("passed_on", {"npc": "person", "props": "known_props"})
def _passed_on(env: Env, cond: dict[str, Any]) -> bool:
    """The manager has told ``npc`` a note of one of the props: the log of their tellings has it
    (``[claim, person, prop, how, lie, tick]``), and the telling is an event."""
    return any(
        row[1] == cond["npc"] and row[2] in cond["props"] for row in env.state["player"]["told"]
    )


@term("talked_today", {"npc": "person"})
def _talked_today(env: Env, cond: dict[str, Any]) -> bool:
    index = env.world.cast.index[cond["npc"]]
    return env.state["player"]["talked"][index] == env.now.day


@term("fresh_proof", {"venue": "place"})
def _fresh_proof(env: Env, cond: dict[str, Any]) -> bool:
    from lantern_core.world.bridge import assembly  # not at the top: assembly reads this module

    return assembly.worth_saying(env.state, cond["venue"], env.now.day)


@term("looked", {"items": "evidence_items"})
def _looked(env: Env, cond: dict[str, Any]) -> bool:
    looked = env.state["player"]["looked"]
    return any(item in looked for item in cond["items"])


@term("evidence", {"items": "evidence_items"})
def _evidence(env: Env, cond: dict[str, Any]) -> bool:
    held = env.state["player"]["evidence"]
    return any(item in held for item in cond["items"])


@term("told", {"missed?": "missed"})
def _told(env: Env, cond: dict[str, Any]) -> bool:
    from lantern_core.world.bridge import assembly  # not at the top: assembly reads this module

    if assembly.last_statement(env.state) is None:
        return False
    return "missed" not in cond or assembly.missed(env.state) == cond["missed"]


@term("meeting", {})
def _meeting(env: Env, cond: dict[str, Any]) -> bool:
    from lantern_core.world.bridge import assembly  # not at the top: assembly reads this module

    return assembly.meeting_open(env.state["player"], env.now.tick)


@term("grudge", {"below": "percent"})
def _grudge(env: Env, cond: dict[str, Any]) -> bool:
    if not goals.keeps_the_goals(env.state):
        return False
    metrics = env.state["goals"]["metrics"]
    return "grudge" in metrics and metrics["grudge"] < cond["below"]


# ---------------------------------------------------------------------- the statement card
# What the card of the statement holds, and whether one was made today. Each changes together with
# an action of the manager (an option chosen, a statement made) or with a note written to the
# notebook.


@term("card_filled", {})
def _card_filled(env: Env, cond: dict[str, Any]) -> bool:
    from lantern_core.world.bridge import statement  # not at the top: statement reads the clock

    return statement.filled(env.state["player"])


@term("card_fillable", {})
def _card_fillable(env: Env, cond: dict[str, Any]) -> bool:
    from lantern_core.world.bridge import statement  # not at the top: statement reads the clock

    return statement.fillable(env.state["player"])


@term("stated_today", {})
def _stated_today(env: Env, cond: dict[str, Any]) -> bool:
    from lantern_core.world.bridge import statement  # not at the top: statement reads the clock

    return statement.used_today(env.state, env.now)


# ---------------------------------------------------------------------- the manager's promises
# What the manager promised and whether it was kept, for the tasks that keep the promises.

PLEDGE_STATES = (pledges.OPEN, pledges.KEPT, pledges.BROKEN)
PLEDGE_DUE = ("today", "ahead")


@term("pledge", {"n": "slot", "state?": "pledge_state", "due?": "pledge_due"})
def _pledge(env: Env, cond: dict[str, Any]) -> bool:
    row = pledges.card_of(env.state["player"], cond["n"])
    if row is None or ("state" in cond and row["state"] != cond["state"]):
        return False
    if "due" not in cond:
        return True
    return env.now.day == row["due"] if cond["due"] == "today" else env.now.day < row["due"]


# --------------------------------------------------------- the peace by deeds, and the elder's call
# What was done for the peace, as the town saw it.


@term("eased", {"act": "deed"})
def _eased(env: Env, cond: dict[str, Any]) -> bool:
    from lantern_core.world.bridge import peace  # not at the top: peace reads the goals

    return goals.keeps_the_goals(env.state) and peace.done(env.state)[cond["act"]]


@term("called", {})
def _called(env: Env, cond: dict[str, Any]) -> bool:
    from lantern_core.world.bridge import assembly  # not at the top: assembly reads this module

    return assembly.clan_called(env.state["player"], env.now.tick)
