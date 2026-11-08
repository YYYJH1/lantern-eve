"""The people who carry the five days: what they say by the state of the game, and the epilogue.

Ten people of the cast have, beside the fixed lines of the town (``voices``), three lists of their
own in ``content/lines`` (compiled into ``voice_data``): ``greet``, ``chat`` and ``epilogue``. A
list is a series of entries in the order the author wrote them, each with the conditions under
which it is the one to use (``when``) and its words. The first entry whose conditions all hold is
chosen, so the more particular a state is, the earlier it stands, and the last entry of a list has
no condition and always holds.

``greet``     what the person says as a talk with the manager opens, kept on show as the line of the
              talk until they answer something.
``chat``      what they say as the manager leaves, over their head for a while (``PARTING_TICKS``).
              A person whose routine calls them away says the fixed line ``timeout`` and no more.
``epilogue``  the one or two sentences about them on the ending page, chosen once, in the last
              night, by how the festival went and by their own part in it.

*What the conditions read.* The terms are those of ``agenda_terms`` that speak of the town in
public (a flag of the festival, the hour, the sky, the work at the bridge, a promise somebody made,
the deeds of the peace) and a few of the person's own, below. They read the state of the game and
never which story is true: the only trace of the story in the conditions is ``told_cause``, the
cause that was stated when the truth was told in public, which the town heard. A person who may be
the one the truth blames (``CULPRITS``: the boatman and the eldest Zhou son) reads nothing of what
they or anyone believe either, since whoever the truth blames takes no stand in public and so does
not hold what the rest of the room holds (``clarify``), and a line that followed that would tell who
it is. The checker of the content holds these lists to the terms below, and the tests change what
is hidden and see that the choice does not move.

==================  ===============================================  =========================
term                holds when                                       arguments
==================  ===============================================  =========================
``acquainted``      (``greet`` only) the manager had talked with     ``is``
                    this person never (``new``), earlier today
                    (``today``) or on an earlier day (``earlier``)
                    before this talk
``promised``        a promise of the manager's to this person is    ``state``
                    open, kept or broken
``knows``           this person holds one of these claims, which     ``props``, ``min``?
                    were made in public, with this confidence
``stopped``         this person, a head of a family, stopped
                    accusing in public (``peace``)
``cleared``         the rumour about Li Er was set straight in       (none)
                    public: a clarification that somebody took in,
                    evidence that refuted it, or the truth told
``told_cause``      the truth was told in public, and the cause      ``is``
                    it named was that one
==================  ===============================================  =========================

*How the words are kept.* The state holds no words. A line on show is ``[npc, until, "role", list,
entry]`` (see ``converse``) and the words are made in the frame, from the list and the entry, in
the person's voice: the entry may have several variants, and one is picked by the person, the entry
and a tick, in integers (``voices.choose``), so that a person says the same words all through a
talk. The epilogue is kept as ``goals.ending["epilogue"]``, ``[[person, entry], ...]``, and put into
words when the ending is made into its wire form (``epilogue_wire``).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any, NamedTuple

from lantern_core.world.bridge import agenda_terms, converse, notes, voices
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.voice_data import VOICES

if TYPE_CHECKING:
    from lantern_core.world.bridge.clock import Now
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

GREET, CHAT, EPILOGUE = "greet", "chat", "epilogue"
LISTS = (GREET, CHAT, EPILOGUE)
ROLE = "role"  # the kind of a line on show (``converse.words``)
PARTING_TICKS = 60  # how long the words of a person the manager leaves stay over their head
SILENCE = {"zh": "……", "en": "..."}  # the words of an entry that is not there any more
KNOWS_AT = 40  # a person who took a claim in knows it from this confidence (``clarify``)
CULPRITS = ("old_he", "zhou_dalang")  # the people some story of the script blames
MEETINGS = ("new", "today", "earlier")
CAUSES = ("boat", "flood", "drunk")  # the causes the card of the statement offers that can be true
TOLD_CAUSE = "told_cause"  # in ``public`` of the player's section: the cause stated when the
# truth was told in public


# ---------------------------------------------------------------------------- what is on the lists


def entries(person: str, kind: str) -> list[dict[str, Any]]:
    """The list ``kind`` of ``person`` in the order of the content, or an empty list."""
    voice = VOICES.get(person)
    return [] if voice is None else list(voice.get(kind, ()))


def people() -> tuple[str, ...]:
    """The people who have an epilogue, in the order of the cast: the ones who carry the days."""
    return tuple(p for p in lore().people if entries(p, EPILOGUE))


def entry_of(person: str, kind: str, entry_id: str) -> dict[str, Any] | None:
    """The entry ``entry_id`` of the list ``kind`` of ``person``, or None."""
    return next((e for e in entries(person, kind) if e["id"] == entry_id), None)


# ---------------------------------------------------------------------------- the terms


class Ctx(NamedTuple):
    """What a condition of the lists looks at: the world, its state and the time (as for a task),
    the person the list is of, and the day of the manager's last talk with them before this one
    (0: never; None: not a talk that is opening)."""

    env: agenda_terms.Env
    who: str
    before: int | None


Term = Callable[[Ctx, dict[str, Any]], bool]
TERMS: dict[str, Term] = {}


def term(name: str) -> Callable[[Term], Term]:
    def register(fn: Term) -> Term:
        TERMS[name] = fn
        return fn

    return register


@term("acquainted")
def _acquainted(ctx: Ctx, cond: dict[str, Any]) -> bool:
    if ctx.before is None:
        return False
    today, how = ctx.env.now.day, cond["is"]
    if how == "new":
        return ctx.before == 0
    if how == "today":
        return ctx.before == today
    return ctx.before not in (0, today)


@term("promised")
def _promised(ctx: Ctx, cond: dict[str, Any]) -> bool:
    return any(
        row["to"] == ctx.who and row["state"] == cond["state"]
        for row in ctx.env.state["player"]["pledges"]
    )


@term("knows")
def _knows(ctx: Ctx, cond: dict[str, Any]) -> bool:
    beliefs = ctx.env.state["social"].get("beliefs")
    if beliefs is None:  # a world without the talk between neighbours
        return False
    held, need = beliefs[ctx.who], cond.get("min", KNOWS_AT)
    return any(prop in held and notes.confidence_of(held[prop]) >= need for prop in cond["props"])


@term("stopped")
def _stopped(ctx: Ctx, cond: dict[str, Any]) -> bool:
    eased = ctx.env.state["player"]["public"].get("eased", {})
    return ctx.who in eased.get("stop", ())


@term("cleared")
def _cleared(ctx: Ctx, cond: dict[str, Any]) -> bool:
    from lantern_core.world.bridge import clarify, goals  # not at the top: they read the voices

    state = ctx.env.state
    public = state["player"]["public"]
    return bool(
        public.get("clarified")
        or clarify.clears_rumour(public["refuted"])
        or ("flags" in state.get("goals", {}) and goals.flag_up(state, goals.TRUTH_TOLD))
    )


@term(TOLD_CAUSE)
def _told_cause(ctx: Ctx, cond: dict[str, Any]) -> bool:
    return ctx.env.state["player"]["public"].get(TOLD_CAUSE) == cond["is"]


def holds(ctx: Ctx, cond: dict[str, Any]) -> bool:
    """Whether a condition holds: a term of this module, a term of ``agenda_terms``, or ``all``,
    ``any`` or ``not`` of conditions."""
    if "all" in cond:
        return all(holds(ctx, item) for item in cond["all"])
    if "any" in cond:
        return any(holds(ctx, item) for item in cond["any"])
    if "not" in cond:
        return not holds(ctx, cond["not"])
    own = TERMS.get(cond["kind"])
    if own is not None:
        return own(ctx, cond)
    return agenda_terms.TERMS[cond["kind"]].holds(ctx.env, cond)


def names() -> tuple[str, ...]:
    """The names of the terms of this module (``tools/check_content.py`` keeps the table of their
    arguments, and a test holds the two equal)."""
    return tuple(TERMS)


# ---------------------------------------------------------------------------- choosing


def pick(env: agenda_terms.Env, person: str, kind: str, before: int | None = None) -> str | None:
    """The id of the first entry of the list ``kind`` of ``person`` whose conditions all hold, or
    None if the person has no such list."""
    ctx = Ctx(env, person, before)
    for entry in entries(person, kind):
        if all(holds(ctx, cond) for cond in entry["when"]):
            return str(entry["id"])
    return None


def words(person: str, kind: str, entry_id: str, at: int, plain: bool = False) -> dict[str, str]:
    """The two texts of an entry of ``greet`` or ``chat`` as ``person`` says it for a line kept
    until the tick ``at``: the variant that ``voices.choose`` picks, or the first one with
    ``plain`` (the words that do not depend on a voice)."""
    entry = entry_of(person, kind, entry_id)
    if entry is None:  # a saved game whose line names an entry that the content no longer has
        return dict(SILENCE)
    lines = entry["lines"]
    chosen = 0 if plain else voices.choose(person, f"{ROLE}:{kind}:{entry_id}", at, len(lines))
    return dict(lines[chosen])


def _say(sim: Sim, person: str, kind: str, entry_id: str, until: int) -> None:
    converse.say(sim.state["player"], person, until, ROLE, kind, entry_id)


def greet(sim: Sim, person: str, before: int) -> None:
    """The person greets the manager as a talk opens (``before`` is the game day of the last talk
    they had, 0 for the first): the greeting stays on show as the line of the talk."""
    env = agenda_terms.Env(sim.world, sim.state, sim.now)
    entry = pick(env, person, GREET, before)
    if entry is not None:
        _say(sim, person, GREET, entry, sim.state["player"]["talk"]["until"])


def parting(sim: Sim, person: str) -> None:
    """The person says a last word as the manager leaves, over their head for a while."""
    env = agenda_terms.Env(sim.world, sim.state, sim.now)
    entry = pick(env, person, CHAT)
    if entry is not None:
        _say(sim, person, CHAT, entry, sim.ctx.tick + PARTING_TICKS)


# ---------------------------------------------------------------------------- the epilogue


def epilogue(world: BridgeWorld, world_state: dict[str, Any], now: Now) -> list[list[str]]:
    """The epilogue of the last night: ``[[person, entry], ...]``, for each person who has one, in
    the order of the cast."""
    env = agenda_terms.Env(world, world_state, now)
    rows = []
    for person in people():
        entry = pick(env, person, EPILOGUE)
        if entry is not None:
            rows.append([person, entry])
    return rows


def epilogue_wire(rows: list[list[str]]) -> list[dict[str, Any]]:
    """The epilogue as the ending carries it: ``[{"npc", "id", "text": {"zh", "en"}}, ...]``."""
    out = []
    for person, entry_id in rows:
        entry = entry_of(person, EPILOGUE, entry_id)
        if entry is not None:  # a saved ending whose entry the content no longer has is left out
            out.append({"npc": person, "id": entry_id, "text": dict(entry["text"])})
    return out
