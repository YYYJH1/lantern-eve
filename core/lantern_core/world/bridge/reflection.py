"""What each named person thinks over at night, by rules, and the errand they choose for tomorrow.

Once a night, at 23:00 of every night but the last, the twenty named people each do three things in
the order of the cast, and nothing in them is asked of a model. The first two are bounded ints
(the constants below), the third is a closed list. The pass is a function of the state and
of the game's RNG, so a replay does it again the same way, in CPython and in Pyodide.

*Consolidate.* A belief the person heard (``heard``) gets a little firmer when the same fact (the
predicate, the arguments and the polarity of its prop) is also held from another first source: the
walk back of ``provenance`` ends at someone else, and what the person saw themselves is a source
too. Nobody is a second source because they repeated what a third person told them: a rumour that
goes round has one first source however many mouths it passed through, and so does not harden. A
belief heard once that something the person saw gainsays gets less firm. A first-hand belief
gainsays another if the two cannot both be true (``Lore.excludes``), or if an item of evidence of
the script that the first-hand belief supports refutes the other one or the story it belongs to
(the lineage of the prop). Each belief moves by one step at most in a night, up by ``FIRM_STEP`` to
``HEARD_CEILING`` at most, and down by ``DOUBT_STEP`` to ``DOUBT_FLOOR`` at least. Nothing is set
aside or taken up again by this: that is for a hearing to do (``telling.hold``).

*Speculate.* The rules of the script's ``speculation`` are applied to what the person now holds
and what the town knows, with the checks that ``paths.authorize`` makes of a guess: the person
must be suspicious enough for the rule, and have the standing it asks for (a grudge) toward
whoever it binds. On top of that a guess is only drawn from news: one of the premises must be a
belief the person came to hold since the last pass (a guess made only of what everyone knows would
be made by everyone every night). It is never about the person themselves, and never one that
repeats a fact they hold already or that a firmer belief of theirs excludes. At most one new guess a
night (``GUESSES_A_NIGHT``). It is held as a guess, inferred, at ``GUESS_AT``, which is under the
confidence from which a falsehood counts as believed (``goals_ending.BELIEVE_AT``,
``repute.BELIEVE_AT``) and over the one under which a thing is not passed on
(``gossip.MIN_CONFIDENCE``), so that it can be told but is not yet taken for the truth. A note of a
guess bears on nothing on the statement card (``statement.bearing``).

*The errand.* From a closed list, at most one for tomorrow, for a person who is up to it (a chance
of ``CHANCE_BASE`` and half the gossip trait in a hundred). The list, each with what makes it
possible:

========  ====================================================================================
``tell``  call on a person they trust (``TELL_TRUST``) and tell them what they hold most firmly
          (at least ``TELL_FIRM``) that the other has not heard. They meet where the other is by
          the routine, and the telling is the ordinary telling of the town (``telling.tell``), on
          the turn of the speaker and with no words of theirs still over their head, so the dot,
          the bubble and the street hear it as any other. It does not wait for the rest that
          follows idle talk.
``help``  go to the bridge and lend a hand there for a while, for a person who promised the manager
          something and is making it good: they joined the call for the bridge (``goals_call``), or
          their promise of goods was kept in the last two days.
``avoid`` stay at home instead of the place where a person they hold a grudge against (at least
          ``AVOID_AT``) is by the routine, during a free stretch of tomorrow.
``look``  go and look at the bridge for themselves, for a person who has heard how it broke, from
          someone, and holds that at ``LOOK_DOUBT`` or more, while the bridge is not mended.
========  ====================================================================================

Which one is drawn by ``KIND_WEIGHT`` from the ones that can be done. It is a detour of the
routine and never more: only in a stretch of the routine that is free (``FREE_ACTS``: resting,
praying, tea, chat, play, drink), never one that is work, a meal, a meeting or sleep; never from
``MEETING_FROM`` on at the teahouse or the hall, where the evenings of the festival are held, to
leave them or to go there (the people at a meeting are the ones the routine puts there); never on
a day of heavy rain; never for a person who has a task in hand or a promise to the manager still
open; it ends by ``HOME_BY`` and the walk back to the next entry of the routine is counted in; and
if anything of that stops holding (a task is posted, the time is up) it lapses. A detour
is the rule ``bt`` has between the errand and the routine, and the person can be talked to on the
way as anywhere.

State (``state["world"]["reflection"]``)::

    {"last": the day whose night the pass was last made for (0: none),
     "since": the tick of that pass (0: none), the news of a guess is what came after it,
     "plans": {person: plan},      the errand of each person who has one, for the day it is for
     "going": {person: [place, until, act, x, y]}   the detours in hand, which ``bt`` follows,
     "log": [[tick, kind, person, to]],   errands of the last two days that were done in public
     "counts": {...}}              the numbers of the passes and the errands, for the tools

A plan is ``{"kind", "day", "place", "act", "from", "until", "to", "prop", "cell", "stay",
"state", "at"}``: ``place`` and ``cell`` are where to go (the cell is that of the person told),
``from`` and ``until`` the ticks of the stretch, ``to`` the person told or kept away from, ``prop``
what is told, ``stay`` the ticks a visit lasts, ``state`` one of ``planned``, ``going``, ``done``
and ``lapsed``, and ``at`` the tick the person arrived. Events (all ``debug``, the player is shown
the errand and not the pass): ``reflected`` (``npc``, ``firmer``, ``weaker``, ``guess``,
``errand``, ``to``), once for each person in each pass, and ``errand`` (``npc``, ``errand``,
``state``, ``to``, ``place``, ``why``) when a plan is done or lapses.

What the player sees is the people walking about, the tellings (dots and bubbles) and a line of
street talk in the paper (``street_kinds``): that some people went to look at the bridge, called on
one another or lent a hand, the day before. Nothing of what anyone holds or why. A game made with
the config ``reflect`` set to 0 has no pass.
"""

from __future__ import annotations

import functools
from typing import TYPE_CHECKING, Any, NamedTuple

from lantern_core.cognition.beliefs import Belief, Claim
from lantern_core.cognition.paths import authorize
from lantern_core.cognition.props import Prop, lineage
from lantern_core.cognition.provenance import walk_back
from lantern_core.world.bridge import (
    bonds,
    clock,
    commitments,
    goals,
    goals_call,
    goals_work,
    gossip,
    notes,
    opening,
    social,
    tasks,
    telling,
    weather,
)
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import BLAME_PREDS, CAUSE_PREDS, Lore, lore

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "reflection"

REFLECT_HOUR = 23  # the pass is made at the first tick of this hour of the night

# consolidate
FIRM_STEP = 6  # what a belief heard from two first sources gains in a night
DOUBT_STEP = 8  # what a belief heard once and gainsaid by a sight loses in a night
HEARD_CEILING = 88  # a heard belief does not get firmer than this (a sight is 90)
DOUBT_FLOOR = 12  # nor less firm than this

# speculate
GUESS_AT = 32  # how firmly a new guess is held
PREMISE_AT = 50  # a premise of a guess is a belief held at least this firmly
GUESSES_A_NIGHT = 1  # how many new guesses a person comes to in a night (0 for none)

# the errand
CHANCE_BASE = 20  # percent, and half the gossip trait on top
TELL_TRUST = 50  # trust from which a person is told
TELL_FIRM = 50  # the confidence from which a thing is worth a call
AVOID_AT = 50  # the grudge from which a person is kept away from
LOOK_DOUBT = (
    40  # the confidence of a heard belief of how the bridge broke, from which one goes to see
)
KIND_WEIGHT = {"tell": 5, "help": 4, "avoid": 4, "look": 3}  # in the order of KINDS
KINDS = tuple(KIND_WEIGHT)
PUBLIC_KINDS = ("tell", "help", "look")  # the ones the street sees (the other keeps no one's name)
ACTS = {"tell": "chat", "help": "work", "avoid": "rest", "look": "rest"}
FREE_ACTS = ("rest", "pray", "tea", "chat", "play", "drink")
MEETING_PLACES = ("p_teahouse", "p_clan_hall")
BRIDGE = goals_work.BRIDGE
PER_HOUR = clock.DAY_TICKS_PER_HOUR
START_FROM = PER_HOUR // 2  # no detour starts before 06:30
MEETING_FROM = (16 - clock.DAWN_HOUR) * PER_HOUR + PER_HOUR // 2  # 16:30, in ticks from 06:00
HOME_BY = (20 - clock.DAWN_HOUR) * PER_HOUR + PER_HOUR // 2  # 20:30
MIN_STRETCH = PER_HOUR // 2  # a free stretch of less than half an hour is no use
START_SLACK = (
    PER_HOUR // 4
)  # a detour starts this long after the stretch does, once the person is there
MEET_TICKS = PER_HOUR // 4  # the time to be allowed for a call
LOOK_TICKS = PER_HOUR * 3 // 4  # how long a visit to the bridge lasts
HELP_TICKS = PER_HOUR  # and a hand lent there
SETTLE_TICKS = PER_HOUR // 2  # the time the other has to be at their place for a call
KEPT_DAYS = 2  # days a promise kept is something to help with, and an errand done is news
STATES = ("planned", "going", "done", "lapsed")
ENDED = ("done", "lapsed")
WALK_CAP = 400  # steps counted on a way before it is given up as unreachable
LOG_LIMIT = 24

# the line of street talk for the kind of errand that was most often done in public (``talk`` of
# the paper in the script)
TALK_OF = {"look": "walk_look", "tell": "walk_call", "help": "walk_hand"}
COUNT_KEYS = (
    "passes",
    "firmer",
    "weaker",
    "guesses",
    *(f"{how}_{kind}" for how in ("planned", "done", "lapsed") for kind in KINDS),
)


# ---------------------------------------------------------------------------- the section


def reflects(world: BridgeWorld) -> bool:
    """Whether this game thinks over the day at night (the config ``reflect``)."""
    return bool(world.config.get("reflect", 0))


def has_the_talk(world_state: dict[str, Any]) -> bool:
    """Whether the world has the talk between neighbours, whose beliefs this section thinks over (a
    test world may stand something else in its place)."""
    section = world_state.get("social")
    return isinstance(section, dict) and "beliefs" in section and "bonds" in section


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    return {
        "last": 0,
        "since": 0,
        "plans": {},
        "going": {},
        "log": [],
        "counts": {key: 0 for key in COUNT_KEYS},
    }


def _bump(section: dict[str, Any], key: str, by: int = 1) -> None:
    section["counts"][key] = section["counts"].get(key, 0) + by


# ---------------------------------------------------------------------------- facts about props


def fact_key(prop: Prop) -> tuple[str, tuple[tuple[str, str], ...], bool]:
    """What a prop says apart from when and why: its predicate, arguments and polarity. Two props
    with the same key are the same fact told with more or less of the story."""
    return prop.pred, prop.args, prop.neg


@functools.cache
def _refutations() -> tuple[tuple[frozenset[str], frozenset[str]], ...]:
    """For each item of evidence of the script, the props it supports and the props it refutes."""
    return tuple(
        (frozenset(item["supports"]), frozenset(item["refutes"]))
        for item in SCRIPT["evidence"]
        if item["refutes"]
    )


def gainsays(lore_: Lore, view: notes.PropView, seen: Prop, held: Prop) -> bool:
    """Whether a first-hand ``seen`` speaks against ``held``: they cannot both be true, or an item
    of evidence that ``seen`` supports refutes ``held`` or a prop of the story ``held`` was made
    from (its lineage)."""
    if lore_.excludes(seen, held):
        return True
    story = set(lineage(held.id, view))
    return any(seen.id in supports and story & refutes for supports, refutes in _refutations())


# ---------------------------------------------------------------------------- consolidate


def consolidate(sim: Sim, person: str) -> tuple[int, int]:
    """The night's thinking over of what ``person`` was told: how many beliefs got firmer and how
    many got less firm (see the module). The beliefs are weighed as they stand at the start, so
    that the order in which they are walked does not matter."""
    state = sim.state["social"]
    lore_ = lore()
    view = notes.PropView(notes.made_props(state), lore_.book.props)
    stores, claims = notes.stores(state), notes.claims(state)
    store = stores[person]
    held = [b for b in store if b.prop in view]
    live = [b for b in held if b.confidence > 0]
    sights = [b for b in held if b.source == "saw"]
    origins: dict[str, str | None] = {}

    def origin(belief: Belief) -> str | None:
        if belief.prop not in origins:
            origins[belief.prop] = (
                person
                if belief.source == "saw"
                else walk_back(person, belief.prop, stores, claims, view).origin
            )
        return origins[belief.prop]

    firmer = weaker = 0
    for belief in live:
        if belief.source != "heard":
            continue
        key = fact_key(view[belief.prop])
        mine = origin(belief)
        corroborated = any(
            other.prop != belief.prop
            and other.source in ("heard", "saw")
            and fact_key(view[other.prop]) == key
            and origin(other) != mine
            for other in live
        )
        new = belief.confidence
        if corroborated:
            new = max(belief.confidence, min(HEARD_CEILING, belief.confidence + FIRM_STEP))
        elif any(gainsays(lore_, view, view[s.prop], view[belief.prop]) for s in sights):
            new = min(belief.confidence, max(DOUBT_FLOOR, belief.confidence - DOUBT_STEP))
        if new != belief.confidence:
            note = state["beliefs"][person][belief.prop]
            state["beliefs"][person][belief.prop] = notes.with_confidence(note, new)
            if new > belief.confidence:
                firmer += 1
            else:
                weaker += 1
    return firmer, weaker


# ---------------------------------------------------------------------------- speculate


def _bindings(
    rule: Any, pools: list[list[Prop]], registry: Any
) -> list[tuple[dict[str, str], list[Prop]]]:
    """Every way the premises of ``rule`` are met from ``pools`` (one list of props for each
    premise, in the order of the premises): the variables and the props used, in order."""
    found: list[tuple[dict[str, str], list[Prop]]] = []

    def extend(at: int, env: dict[str, str], used: list[Prop]) -> None:
        if at == len(pools):
            found.append((env, used))
            return
        for prop in pools[at]:
            nxt = rule.bind(at, prop, env, registry)
            if nxt is not None:
                extend(at + 1, nxt, [*used, prop])

    extend(0, {}, [])
    return found


def _plainest(lore_: Lore, rule: Any, env: dict[str, str]) -> Prop | None:
    """The prop of the script that the rule concludes under ``env``, the one with the least added
    to it (no motive first), or None if the script has none."""
    registry = lore_.book.registry
    found = [
        prop
        for prop in lore_.book.props.values()
        if not prop.neg and rule.concludes(prop, env, registry)
    ]
    found.sort(key=lambda prop: (prop.motive is not None, prop.span is not None, prop.id))
    return found[0] if found else None


def speculate(sim: Sim, person: str, since: int) -> str:
    """The guess ``person`` comes to in the night, or ``""``: the id of the prop written (see the
    module). ``since`` is the tick of the last pass, after which a belief is news."""
    if GUESSES_A_NIGHT < 1:
        return ""
    state = sim.state["social"]
    lore_ = lore()
    view = notes.PropView(notes.made_props(state), lore_.book.props)
    store = notes.store(state, person)
    suspicion = lore_.traits[person]["suspicion"]
    relation = bonds.grudge_check(state, lore_)
    standing = {b.prop: b for b in store if b.confidence >= PREMISE_AT and b.modality == "assert"}
    pool = [view[pid] for pid in sorted({*standing, *lore_.public}) if pid in view]
    facts = {fact_key(view[b.prop]) for b in store if b.confidence > 0 and b.prop in view}
    rules = lore_.book.rules
    registry = lore_.book.registry
    for rule_id in sorted(rules):
        rule = rules[rule_id]
        if suspicion < rule.min_suspicion:
            continue
        pools = [[p for p in pool if p.pred == premise.pred] for premise in rule.premises]
        for env, used in _bindings(rule, pools, registry):
            if not any(p.id in standing and standing[p.id].tick > since for p in used):
                continue
            if rule.relation is not None and not relation(
                rule.relation.kind, person, env[rule.relation.target[1:]]
            ):
                continue
            guess = _plainest(lore_, rule, env)
            if guess is None or guess.arg("who") == person or fact_key(guess) in facts:
                continue
            if any(
                b.confidence >= GUESS_AT and b.prop in view and lore_.excludes(guess, view[b.prop])
                for b in store
            ):
                continue
            if not _authorized(sim, lore_, view, store, person, rule.id, guess, used, suspicion):
                continue
            belief = Belief(
                person, guess.id, "speculate", GUESS_AT, "inferred", None, None, 0, sim.ctx.tick
            )
            if telling.hold(sim, state, lore_, view, guess, belief, None):
                return guess.id
    return ""


def _authorized(
    sim: Sim,
    lore_: Lore,
    view: notes.PropView,
    store: Any,
    person: str,
    rule_id: str,
    guess: Prop,
    used: list[Prop],
    suspicion: int,
) -> bool:
    """Whether the checker of the talk (``paths.authorize``) lets ``person`` say this guess from
    these premises: the same check every hop of the town passes. The guess is said to no one, so
    the claim names another person as its listener, which the checker does not read. The checker is
    named here and not looked up as ``paths.authorize``, so that whoever watches the judgements of
    the talk (a test that counts them against the claims) is not shown one for a guess that nobody
    said."""
    other = next(pid for pid in lore_.people if pid != person)
    claim = Claim(
        "guess",
        person,
        (other,),
        guess.id,
        "speculate",
        person,
        sim.ctx.tick,
        "speculation",
        rule_id=rule_id,
        premises=tuple(p.id for p in used),
    )
    verdict, _ = authorize(
        claim,
        store,
        view,
        tables=lore_.tables,
        registry=lore_.book.registry,
        rules=lore_.book.rules,
        suspicion=suspicion,
        relation=bonds.grudge_check(sim.state["social"], lore_),
        public=lore_.public,
    )
    return verdict


# ---------------------------------------------------------------------------- the routine of a day


class Stretch(NamedTuple):
    """A stretch of the routine on one day: from tick ``start`` to ``end`` the person is at
    ``place`` doing ``act``."""

    start: int
    end: int
    act: str
    place: str


def stretches(person: Any, day: int) -> list[Stretch]:
    """The entries of the routine of ``person`` on ``day`` that fall in daylight, as ticks of the
    game: each lasts until the next one starts or the night comes."""
    base = (day - 1) * clock.CYCLE_TICKS
    rows = sorted(entry for entry in person.routine if entry[0] < clock.DAY_TICKS)
    out = []
    for at, (start, act, place) in enumerate(rows):
        end = rows[at + 1][0] if at + 1 < len(rows) else clock.DAY_TICKS
        out.append(Stretch(base + start, base + min(end, clock.DAY_TICKS), act, place))
    return out


@functools.cache
def _held_to_their_place() -> dict[str, tuple[tuple[int, int, int, int], ...]]:
    """For each person an item of evidence is had from, the daily windows in which the table of
    opportunities of the script expects them where their routine puts them: ``(from, to, since,
    until)`` in minutes of the day, and the minute of the game from which the item can be had and
    until which (``-1``: no end). A detour is not sent out of these. (The gatekeeper of an item is
    asked for their trust, not found at their place.)"""
    found: dict[str, list[tuple[int, int, int, int]]] = {}
    for item in SCRIPT["evidence"]:
        acquire = item["acquire"]
        until = acquire.get("until")
        window = (*acquire["daily"], acquire.get("since", 0), -1 if until is None else until)
        who = acquire["from"]
        if who in lore().index:
            found.setdefault(who, []).append(window)
    return {who: tuple(rows) for who, rows in found.items()}


def _held_ticks(person: str, day: int) -> list[tuple[int, int]]:
    """The stretches of ``day``, in ticks of the game, in which ``person`` is expected at their
    place for the evidence (``_held_to_their_place``)."""
    base, out = (day - 1) * clock.CYCLE_TICKS, []
    for low, high, since, until in _held_to_their_place().get(person, ()):
        began = (day - 1) * 1440
        if began + high <= since or (until >= 0 and began + low >= until):
            continue  # not yet, or no longer
        per_minute = clock.DAY_TICKS_PER_HOUR // 60
        out.append(
            (
                base + (low - clock.DAWN_HOUR * 60) * per_minute,
                base + (high - clock.DAWN_HOUR * 60) * per_minute,
            )
        )
    return out


def free_stretches(person: Any, day: int) -> list[Stretch]:
    """The stretches of ``day`` in which ``person`` may go on a detour: free by the routine, after
    the morning has begun, not at the teahouse or the hall from the hour of the meeting, not when
    the table of the evidence expects them at their place, and over in time to be home by the
    evening. The end of a stretch is also the end of what they may do in it, so the way back to the
    next one is counted by the caller."""
    base = (day - 1) * clock.CYCLE_TICKS
    held = _held_ticks(person.id, day)
    out = []
    for stretch in stretches(person, day):
        if stretch.act not in FREE_ACTS:
            continue
        end = min(stretch.end, base + HOME_BY)
        if stretch.place in MEETING_PLACES:
            end = min(end, base + MEETING_FROM)
        start = max(stretch.start, base + START_FROM)
        pieces = [(start, end)]
        for low, high in held:  # what is left of the stretch outside each window
            pieces = [
                piece
                for a, b in pieces
                for piece in ((a, min(b, low)), (max(a, high), b))
                if piece[1] - piece[0] > 0
            ]
        for a, b in pieces:
            if b - a >= MIN_STRETCH:
                out.append(Stretch(a, b, stretch.act, stretch.place))
    return out


def walk_ticks(
    world: BridgeWorld, state: dict[str, Any], a: tuple[int, int], b: tuple[int, int]
) -> int:
    """About how many ticks a walk from cell ``a`` to cell ``b`` takes, or -1 if there is no way."""
    grid = world.walking_grid(state)
    goal = grid.index(*b)
    field = grid.field(goal)
    here = grid.index(*a)
    steps = 0
    while here != goal:
        nxt = grid.best_step(here, field)
        steps += 1
        if nxt == here or steps > WALK_CAP:
            return -1
        here = nxt
    period = world.move_day
    return steps * period


class Day:
    """What the planning of one night reads: the world as it stands, and tomorrow."""

    def __init__(self, sim: Sim) -> None:
        self.sim = sim
        self.world = sim.world
        self.state = sim.state
        self.lore = lore()
        self.social = sim.state["social"]
        self.day = sim.now.day + 1
        self.base = (self.day - 1) * clock.CYCLE_TICKS
        self.view = notes.PropView(notes.made_props(self.social), self.lore.book.props)
        self.cast = sim.world.cast
        self.town = sim.world.town
        self._free: dict[str, list[Stretch]] = {}
        self._all: dict[str, list[Stretch]] = {}
        self._walks: dict[tuple[tuple[int, int], tuple[int, int]], int] = {}

    def free(self, person: str) -> list[Stretch]:
        if person not in self._free:
            self._free[person] = free_stretches(self.cast.people[self.cast.index[person]], self.day)
        return self._free[person]

    def routine(self, person: str) -> list[Stretch]:
        if person not in self._all:
            self._all[person] = stretches(self.cast.people[self.cast.index[person]], self.day)
        return self._all[person]

    def cell(self, person: str, place: str) -> tuple[int, int]:
        return self.town.stand(place, self.cast.index[person])

    def next_place(self, person: str, until: int) -> str | None:
        """Where the routine has the person at tick ``until``: the stretch they are due back for."""
        for s in self.routine(person):
            if s.start <= until < s.end:
                return s.place
        return None

    def raining(self) -> bool:
        return weather.on_day(self.state, self.day) == weather.HEAVY_RAIN

    def way(self, person: str, a: str, b: str) -> int:
        """Ticks to walk from the place ``a`` to the place ``b`` for ``person``, or -1."""
        found = (self.cell(person, a), self.cell(person, b))
        if found not in self._walks:
            self._walks[found] = walk_ticks(self.world, self.state, *found)
        return self._walks[found]


def _promises(state: dict[str, Any]) -> list[dict[str, Any]]:
    """The promises people made the manager, in the order they made them."""
    return list(state.get(commitments.SECTION, {}).get("list", []))


def _mended(state: dict[str, Any]) -> bool:
    return goals.keeps_the_goals(state) and goals.flag_up(state, "bridge_fixed")


def _tied_up(state: dict[str, Any], person: str) -> bool:
    """Whether ``person`` has a task in hand or a promise to the manager still open: a detour never
    stands in the way of either."""
    if tasks.open_tasks(state, person):
        return True
    return any(
        row["by"] == person and row["state"] == commitments.PROMISED for row in _promises(state)
    )


# ---------------------------------------------------------------------------- the errands


def _plan(
    kind: str,
    day: Day,
    place: str,
    start: int,
    until: int,
    *,
    to: str = "",
    prop: str = "",
    cell: tuple[int, int] | None = None,
    stay: int = 0,
) -> dict[str, Any]:
    return {
        "kind": kind,
        "day": day.day,
        "place": place,
        "act": ACTS[kind],
        "from": start,
        "until": until,
        "to": to,
        "prop": prop,
        "cell": [] if cell is None else [cell[0], cell[1]],
        "stay": stay,
        "state": "planned",
        "at": 0,
    }


def what_to_tell(day: Day, person: str, other: str) -> str:
    """The prop ``person`` holds most firmly that ``other`` has not heard, and is theirs to tell:
    at least ``TELL_FIRM``, not one they keep to themselves (``Lore.guards``), not one they had from
    ``other``, and not one that the opening keeps quiet yet. Ties go to the prop that comes first.
    ``""`` if there is none."""
    lore_, view = day.lore, day.view
    held = day.social["beliefs"][other]
    quiet = opening.quiet_roots(day.world, lore_, day.sim.ctx.tick)
    best: tuple[int, str] | None = None
    for belief in notes.store(day.social, person):
        pid = belief.prop
        if belief.confidence < max(TELL_FIRM, gossip.MIN_CONFIDENCE) or pid in held:
            continue
        if pid not in view or pid in lore_.public or belief.teller == other:
            continue
        if lore_.guards(person, view[pid]) or (quiet and lineage(pid, view)[-1] in quiet):
            continue
        if best is None or belief.confidence > best[0]:
            best = (belief.confidence, pid)
    return "" if best is None else best[1]


def tell_plan(day: Day, person: str) -> dict[str, Any] | None:
    """A call on a trusted person tomorrow: the one they trust most who lacks something they hold
    firmly, and the first stretch of tomorrow in which the two can meet where the other is."""
    lore_ = day.lore
    free = day.free(person)
    if not free:
        return None
    trusted = [
        (-bonds.value(day.social, lore_, person, other, bonds.TRUST), lore_.index[other], other)
        for other in lore_.people
        if other != person
        and bonds.value(day.social, lore_, person, other, bonds.TRUST) >= TELL_TRUST
    ]
    for _, _, other in sorted(trusted):
        prop = what_to_tell(day, person, other)
        if not prop:
            continue
        for mine in free:
            for theirs in day.routine(other):
                if theirs.act in ("sleep", "council"):
                    continue
                start = max(mine.start + START_SLACK, theirs.start + SETTLE_TICKS)
                end = min(mine.end, theirs.end)
                if theirs.place in MEETING_PLACES:  # nor are the evenings of the meeting joined
                    end = min(end, day.base + MEETING_FROM)
                if end - start < MEET_TICKS:
                    continue
                back_to = day.next_place(person, mine.end) or mine.place
                way = day.way(person, mine.place, theirs.place)
                back = day.way(person, theirs.place, back_to)
                if way < 0 or back < 0 or start + way + MEET_TICKS + back > end:
                    continue
                return _plan(
                    "tell",
                    day,
                    theirs.place,
                    start,
                    end - back,
                    to=other,
                    prop=prop,
                    cell=day.cell(other, theirs.place),
                )
    return None


def visit_plan(day: Day, person: str, kind: str) -> dict[str, Any] | None:
    """A visit to the bridge in the first stretch of tomorrow that is long enough for the way
    there, the stay and the way back."""
    stay = LOOK_TICKS if kind == "look" else HELP_TICKS
    for mine in day.free(person):
        start = mine.start + START_SLACK
        back_to = day.next_place(person, mine.end) or mine.place
        way = day.way(person, mine.place, BRIDGE)
        back = day.way(person, BRIDGE, back_to)
        if way < 0 or back < 0 or start + way + stay + back > mine.end:
            continue
        return _plan(
            kind,
            day,
            BRIDGE,
            start,
            mine.end - back,
            cell=day.cell(person, BRIDGE),
            stay=stay,
        )
    return None


def avoid_plan(day: Day, person: str) -> dict[str, Any] | None:
    """Staying at home through a free stretch of tomorrow in which the routine puts the person
    where someone they hold a grudge against is too."""
    lore_ = day.lore
    home = lore_.home[person]
    foes = sorted(
        (
            -bonds.value(day.social, lore_, person, other, bonds.GRUDGE),
            lore_.index[other],
            other,
        )
        for other in lore_.people
        if other != person
        and bonds.value(day.social, lore_, person, other, bonds.GRUDGE) >= AVOID_AT
    )
    for mine in day.free(person):
        if mine.place == home:
            continue
        for _, _, other in foes:
            for theirs in day.routine(other):
                shared = min(mine.end, theirs.end) - max(mine.start, theirs.start)
                if theirs.place == mine.place and shared >= MIN_STRETCH:
                    return _plan(
                        "avoid",
                        day,
                        home,
                        mine.start,
                        mine.end,
                        to=other,
                        cell=day.cell(person, home),
                    )
    return None


def can_help(day: Day, person: str) -> bool:
    """Whether ``person`` made the manager a promise they are making good, and the bridge still
    stands to be mended: they joined the call for the helpers, or a promise of goods of theirs was
    kept lately."""
    if _mended(day.state):
        return False
    if goals.keeps_the_goals(day.state) and goals_call.has_joined(
        day.state["goals"]["call"], person
    ):
        return True
    horizon = day.sim.ctx.tick - KEPT_DAYS * clock.CYCLE_TICKS
    return any(
        row["by"] == person and row["state"] == commitments.DELIVERED and row["ended"] >= horizon
        for row in _promises(day.state)
    )


def can_look(day: Day, person: str) -> bool:
    """Whether ``person`` has heard how the bridge broke, from someone, and holds it firmly enough
    to go and see for themselves while it is not mended."""
    if _mended(day.state):
        return False
    return any(
        belief.source == "heard"
        and belief.confidence >= LOOK_DOUBT
        and belief.prop in day.view
        and (
            (not day.view[belief.prop].neg and day.view[belief.prop].pred in BLAME_PREDS)
            or day.view[belief.prop].pred in CAUSE_PREDS
        )
        for belief in notes.store(day.social, person)
    )


def feasible(day: Day, person: str) -> dict[str, dict[str, Any]]:
    """The errands ``person`` could be sent on tomorrow, by kind, each as the plan it would be.
    Nothing for a person who has a task or a promise open, or on a day of heavy rain."""
    if day.raining() or _tied_up(day.state, person):
        return {}
    found: dict[str, dict[str, Any]] = {}
    for kind in KINDS:
        if kind == "help" and not can_help(day, person):
            continue
        if kind == "look" and not can_look(day, person):
            continue
        plan = {
            "tell": tell_plan,
            "avoid": avoid_plan,
        }.get(kind)
        made = plan(day, person) if plan else visit_plan(day, person, kind)
        if made is not None:
            found[kind] = made
    return found


def chance_of(lore_: Lore, person: str) -> int:
    """The chance, in a hundred, that ``person`` goes on an errand tomorrow if they can."""
    return CHANCE_BASE + lore_.traits[person]["gossip"] // 2


def choose(day: Day, person: str, roll: int, drawn: int | None = None) -> dict[str, Any] | None:
    """The errand ``person`` is sent on, or None. ``roll`` is a number from 0 to 99 that must be
    under the chance of the person, and ``drawn`` the number to pick among the kinds that can be
    done (from the RNG of the game when left out)."""
    if roll >= chance_of(day.lore, person):
        return None
    found = feasible(day, person)
    if not found:
        return None
    kinds = [kind for kind in KINDS if kind in found]
    if drawn is None:
        drawn = day.sim.ctx.rng.weighted([KIND_WEIGHT[kind] for kind in kinds])
    return found[kinds[drawn]]


# ---------------------------------------------------------------------------- the pass


def due(sim: Sim) -> bool:
    """Whether the pass of this night is to be made now: at the first tick of ``REFLECT_HOUR``, once
    a night, not on the last night and not after the ending."""
    now = sim.now
    return (
        reflects(sim.world)
        and now.phase == clock.NIGHT
        and now.hour == REFLECT_HOUR
        and now.phase_tick % clock.NIGHT_TICKS_PER_HOUR == 0
        and sim.state[SECTION]["last"] < now.day < sim.world.config["days"]
        and not sim.state["goals"].get("ending")
    )


def night_pass(sim: Sim) -> None:
    """Every named person, in the order of the cast: consolidate, speculate, and choose the errand
    of tomorrow."""
    section = sim.state[SECTION]
    lore_ = lore()
    since = section["since"]
    day = Day(sim)
    section["plans"] = {}
    section["going"] = {}
    horizon = sim.ctx.tick - KEPT_DAYS * clock.CYCLE_TICKS
    section["log"] = [row for row in section["log"] if row[0] > horizon][-LOG_LIMIT:]
    for person in lore_.people:
        firmer, weaker = consolidate(sim, person)
        guess = speculate(sim, person, since)
        roll = sim.ctx.rng.below(100)
        plan = choose(day, person, roll)
        if plan is not None:
            section["plans"][person] = plan
            _bump(section, f"planned_{plan['kind']}")
        _bump(section, "firmer", firmer)
        _bump(section, "weaker", weaker)
        _bump(section, "guesses", 1 if guess else 0)
        sim.emit(
            "reflected",
            npc=person,
            firmer=firmer,
            weaker=weaker,
            guess=guess,
            errand="" if plan is None else plan["kind"],
            to="" if plan is None else plan["to"],
        )
    _bump(section, "passes")
    section["last"] = sim.now.day
    section["since"] = sim.ctx.tick


# ---------------------------------------------------------------------------- the day's errands


def _finish(sim: Sim, person: str, plan: dict[str, Any], state: str, why: str = "") -> None:
    section = sim.state[SECTION]
    section["going"].pop(person, None)
    plan["state"] = state
    _bump(section, f"{'done' if state == 'done' else 'lapsed'}_{plan['kind']}")
    if state == "done" and plan["kind"] in PUBLIC_KINDS:
        section["log"].append([sim.ctx.tick, plan["kind"], person, plan["to"]])
    sim.emit(
        "errand",
        npc=person,
        errand=plan["kind"],
        state=state,
        to=plan["to"],
        place=plan["place"],
        why=why,
    )


def _start(sim: Sim, person: str, plan: dict[str, Any]) -> bool:
    """Set the person off, if nothing stands in the way: False while a task of theirs is in hand,
    and a lapse (True) on a day of heavy rain."""
    section = sim.state[SECTION]
    if weather.today(sim.state) == weather.HEAVY_RAIN:
        _finish(sim, person, plan, "lapsed", "rain")
        return True
    if tasks.open_tasks(sim.state, person):
        return False
    cell = plan["cell"] or [-1, -1]
    section["going"][person] = [plan["place"], plan["until"], plan["act"], cell[0], cell[1]]
    plan["state"] = "going"
    return True


def _close(sim: Sim, i: int, j: int) -> bool:
    """Whether person ``i`` may tell person ``j`` now, by the laws of the talk of the town: it is
    the turn of ``i`` (one tick in ``gossip.STRIDE``), both are awake and not in the middle of a
    telling, the words of ``i`` over their head are not still on show from the last, and they
    stand where they can talk (``gossip``: next to one another, or both at the same indoor
    place). The rest that follows a telling is the pace of the idle talk and not of a call that a
    person went out of their way to make, so it is not waited for."""
    social_state, npcs, now = sim.state["social"], sim.state["npcs"]["list"], sim.ctx.tick
    if (now + i) % gossip.STRIDE:
        return False
    if gossip.asleep(npcs[i]) or gossip.asleep(npcs[j]):
        return False
    busy = social_state["busy"]
    if busy[i] > now or busy[j] > now:
        return False
    speaker = sim.world.cast.people[i].id
    if any(who == speaker and until > now for who, until, _ in social_state["bubbles"]):
        return False
    return j in gossip.neighbours(sim.world.town, npcs, i)


def _call(sim: Sim, person: str, plan: dict[str, Any]) -> str:
    """The call: ``done`` when the telling was made, ``lapsed`` when it cannot be (the other has
    heard it from someone else since, or the checker would not have it), and ``going`` while the
    two are not yet together."""
    state, lore_ = sim.state["social"], lore()
    i, j = lore_.index[person], lore_.index[plan["to"]]
    if plan["prop"] in state["beliefs"][plan["to"]] or plan["prop"] not in state["beliefs"][person]:
        return "lapsed"
    if not _close(sim, i, j):
        return "going"
    told = telling.tell(sim, state, lore_, person, plan["to"], plan["prop"])
    if told is None:
        return "lapsed"
    social._after(sim, state, lore_, told, i, j)
    return "done"


def _at_goal(sim: Sim, person: str) -> bool:
    npc = sim.state["npcs"]["list"][sim.world.cast.index[person]]
    return max(abs(npc["x"] - npc["goal"][0]), abs(npc["y"] - npc["goal"][1])) <= tasks.NEAR


def run_errands(sim: Sim) -> None:
    """One tick of the day: the people whose stretch has come set off, those who are where they
    were going stay or call, and a stretch that is over ends the errand."""
    section = sim.state[SECTION]
    plans = section["plans"]
    if not plans:
        return
    tick = sim.ctx.tick
    for person in sorted(plans):
        plan = plans[person]
        if plan["state"] in ENDED or tick < plan["from"]:
            continue
        if tick >= plan["until"]:
            seen = plan["state"] == "going" and (plan["kind"] == "avoid" or plan["at"] > 0)
            _finish(sim, person, plan, "done" if seen else "lapsed", "" if seen else "time")
            continue
        if plan["state"] == "planned" and not _start(sim, person, plan):
            continue
        if plan["state"] != "going" or tasks.open_tasks(sim.state, person):
            continue  # a task in hand comes first, as it does in ``bt``
        if plan["kind"] == "tell":
            outcome = _call(sim, person, plan)
            if outcome != "going":
                _finish(sim, person, plan, outcome, "" if outcome == "done" else "moot")
        elif plan["kind"] != "avoid":
            if plan["at"] == 0:
                if _at_goal(sim, person):
                    plan["at"] = tick
            elif tick - plan["at"] >= plan["stay"]:
                _finish(sim, person, plan, "done")


def tick(sim: Sim) -> None:
    if not reflects(sim.world) or not has_the_talk(sim.state):
        return
    if sim.now.phase == clock.NIGHT:
        if due(sim):
            night_pass(sim)
        return
    run_errands(sim)


# ---------------------------------------------------------------------------- the paper


def street_kinds(world_state: dict[str, Any], since: int, until: int) -> list[str]:
    """The line of street talk for the errands done in public after tick ``since`` up to ``until``:
    the kind done most often (ties go to the order of ``TALK_OF``), as a list of one, or none when
    there were none. It says that people went about, and nothing of what anyone holds or why."""
    section = world_state.get(SECTION)
    if not section:
        return []
    counts = {kind: 0 for kind in TALK_OF}
    for row in section["log"]:
        if since < row[0] <= until and row[1] in counts:
            counts[row[1]] += 1
    top = max(counts.values(), default=0)
    if top == 0:
        return []
    return [TALK_OF[kind] for kind in TALK_OF if counts[kind] == top][:1]
