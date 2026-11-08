"""The festival manager: where they stand, who they talk to and what their notebook holds.

The player is one more body on the grid of the town, and the actions below are the only way they
act on it. Each is a player input ``{"action_id", "type", ...}`` and draws an ``action_ack`` event,
``applied`` or ``rejected`` with a short reason (the reasons are listed with each action). A body
that is not well formed (a missing or mistyped field) is an ``InputError`` before anything is
applied; one that is well formed and cannot be carried out is a rejection.

State (``state["world"]["player"]``)::

    {"x", "y"                 the cell the player stands on,
     "goal": [x, y]           the cell they walk to (their own cell when they stand still),
     "dest": str              the place the walk was ordered to, or "" for a bare cell,
     "talk": {}               or {"npc", "start", "until", "hold": [x, y], "tier"} in a talk
                              (``until`` is the tick at which their routine takes the person away),
     "busy": {}               or the inspection in progress (see ``evidence``),
     "line": []               or [npc, until, kind, arg, lead], the words on show (below),
     "notebook": [entry]      what the player knows (see ``notebook``),
     "heard": [claim id]      the claims of the town the player overheard,
     "claims": {id: note}     what people told the player when asked (``p1``, ``p2``...),
     "twins": {id: id}        the answer a person gave after their own as the account somebody
                              else told them, by the id of their own (``notebook``; only once a
                              person has answered so),
     "evidence": [item id]    the evidence the player holds,
     "looked": [item id]      the evidence they have looked for, found or not,
     "seq", "cseq"            the numbers of the next entry and the next answer,
     "trust": [int] * 20      how far each person trusts the player, in cast order,
     "talked": [int] * 20     the game day of the last conversation that earned any,
     "told": [[claim id, listener, prop id, way, lie, tick]]   what the player told, and how,
     "lies": [[claim id, listener, prop id, way, tick]]        the lies among those (``lies``),
     "caught": [[prop id, person, tick]]      who caught the player in which lie,
     "wary": {prop id: [person]}              who has paid in trust for a fact told of them,
     "deeds": {key: [person, size, direction, tick]}   the ledger of favours (``pledges``),
     "pledges": [pledge], "pseq"              the player's promises, and the next number,
     "asked": {key: signature}                what was asked of whom, and judged (``entrust``),
     "pending": [row], "rseq"                 a yes won by a lie, waiting, and the next number,
     "nod": {thing: tick}, "won": [person],   what Granny Li has agreed to lend, who was won over,
     "asks": [[by, of, tick]]                 and who was asked by whom (``persuade``),
     "public": {"refuted", "speeches", "seen"}, "meeting": {}   speaking in public (``assembly``),
     "judgments", "hint"                      what was judged of the notebook (``judge``)}

The walk. The player steps one cell on the ticks where ``tick % period == 0``, with the period of
the townsfolk (``move_day`` by day and ``move_night`` by night), along the shortest route over
``BridgeWorld.walking_grid``. They arrive when the goal is reached, and ``arrived`` says so.

Actions
-------
``move``       ``{"place": id}`` or ``{"x": int, "y": int}``: walk to the door of a place, or to a
               cell. Rejected: ``talking``, ``busy``, ``unknown_place``, ``no_door`` (water),
               ``outside``, ``blocked``, ``unreachable``.
``talk``       ``{"npc": id}``: open a conversation with someone within ``TALK_RANGE`` cells.
               Rejected: ``talking``, ``busy`` (the player's), ``unknown_npc``, ``far``, and
               ``asleep`` or ``busy`` when the person declines, with a ``declined`` event and
               the person's words over their head.
``leave``      end the conversation. What the last act owes in time is still paid (``pace``).
               Rejected: ``not_talking``.
``ask``        ``{"topic": id}``, in a conversation: ask about a prop, about a subject (a
               person, a place, a thing) or about a notebook entry, which stands for the prop it
               says. The person answers from their own beliefs (see ``answers``), and what they
               say goes into the notebook as heard from them. The ``asked`` event says what came
               of it. Rejected: ``not_talking``, ``unknown_topic``.

               Every act the person answers takes the minutes the script gives it (``pace``).
               ``ask``, ``ask_source``, ``tell``, ``entrust`` and ``promise`` may also carry
               ``"version"``, the version of the state they were previewed on: an action that
               carries an old one is rejected as ``stale`` and does nothing (see ``preview``).
               They may also carry ``"words"``, a text of at most 200 characters of the manager's
               own (kept as plain text; a text that is longer or is not one is an ``InputError``).
               The rules never read it. A model reads it, as data inside quotation marks, and an
               ``entrust`` with words is held for a judge of them (``entrust``).
``ask_source`` ``{"entry": id}``, in a conversation: ask who told them what a notebook entry
               says. It is the same question, and when the person is the one the entry's trail
               ends at, their answer is the next hop of it. Rejected: ``not_talking``,
               ``no_entry``.
``listen``     outside a conversation: take in what two people just said within ``HEARING``
               cells (see ``overhear``). Rejected: ``talking``, ``busy``, ``nothing_to_hear``.
``look``       ``{"at": id}``: inspect a place or a thing for evidence (see ``evidence``).
               Rejected: ``talking``, ``busy``, ``unknown_target``, ``far``, ``nothing_here``,
               ``closed``, ``refused``, ``needs``.
``tell``       ``{"entry": id, "how": way}``, in a conversation: tell the person something from the
               notebook, as it is (``faithful``, the default), as if seen (``as_seen``), with more
               drama (``sharpen``) or without the source (``hide_source``); or, with ``"how":
               "fabricate"``, something made up from the table of predicates: ``{"pred": id,
               "subject": id, "object": id, "neg"?: bool, "source"?: "self_seen" | "unknown"}``.
               The listener takes it in by the rules of the town, the claim goes into its record
               as the manager's, and a lie may be caught (see ``speak`` and ``lies``). Events:
               ``told`` (the fields of the town's own, and ``how`` and ``outcome``: took, knew,
               doubted or caught) and ``lie_caught``. Rejected: ``not_talking``, ``no_entry``,
               ``no_sharpen``, ``bad_claim``, ``refused``.
``entrust``    ``{"kind": kind, "target"?: id, "cite"?: [entry ids]}``, in a conversation: ask the
               person for something. The kinds are ``material``, ``lane``, ``testify``, ``lend``,
               ``join``, ``persuade`` (``target`` is whom to talk round) and ``convene``. The
               person weighs it by the hard conditions of the script and a score (see
               ``entrust`` and ``persuade``) and answers over their head. Events: ``entrusted``
               (``npc``, ``request``, ``detail``, ``result``, ``total``, ``need``, ``way``,
               ``pending``), ``testified``, ``convened`` and, for a yes won by a lie,
               ``entrust_done`` and ``entrust_withdrawn``. Rejected: ``not_talking``,
               ``no_request``, ``no_entry``, ``cannot``, ``nothing_to_say``, ``said_already``,
               ``needs_nod``, ``too_late``, ``closed``, ``needs``, ``refused``, ``hard``.
``promise``    ``{"what": "stall" | "role" | "wage" | "slot", "item"?: str, "amount"?: int,
               "due"?: day}`` in a conversation: promise what the manager holds (see ``pledges``),
               or ``{"op": "keep", "id": "k1"}`` to keep a promise to the person it was made to.
               Events: ``pledged``, ``pledge_empty``, ``pledge_kept``, ``pledge_broken``.
               Rejected: ``not_talking``, ``empty`` (the person does not believe an empty promise),
               ``bad_due``, ``no_pledge``, ``wrong_person``, ``kept_already``, ``lapsed``.
``judge``      ``{"a": entry id, "b": entry id, "relation": "unsupported" | "contradicts" |
               "mismatch"}``: say how two notes stand to each other, the first being the evidence
               and the second the claim. The core checks the logic of the two and not what is true.
               Costs no time. Rejected: ``unknown_note``, ``not_shown`` (see ``judge``).
``hint``       light a pair of notes worth comparing, or say how they stand if it is the pair that
               was lit (see ``judge``). Costs no time.
``statement``  ``{"op": "choose", "part", "option"}`` or ``{"op": "clear", "part"}``: fill in
               the statement card (see ``statement``). Costs no time, in a talk or out of one.
               Rejected: ``unknown_part``, ``unknown_option``, ``not_shown``.
``speak``      (also ``speak_publicly``) ``{"kind"?: "evidence" | "meal" | "clarify" | "statement",
               "evidence"?: [ids], "entry"?: id}``, outside a conversation, at the teahouse in the
               evening or at the hall when the elder has called the clan: show evidence to
               everyone there, lay a table for the two families, or, with ``{"kind": "clarify",
               "claim": entry, "basis": [entries], "judgment"?: relation}``, show that a claim goes
               beyond what a witness saw (see ``assembly`` and ``clarify``). Events: ``spoke``,
               ``feast``, ``clarified``. Rejected: ``talking``, ``busy``, ``no_venue``,
               ``not_evening``, ``no_meeting``, ``empty_room``, ``no_evidence``, ``said_already``,
               ``heads_absent``, ``few_present``, for a clarification ``no_entry``,
               ``not_shown``, ``overclaim`` and ``no_witness``, and for the full statement of the
               card ``too_early``, ``stated_today`` and ``incomplete``.

A conversation. While one is open the world stands still (``pace``): the clock is held, the player
cannot walk, and the other person stays where they were. The time of an act is paid when the act
is done, and the world is held again when it is paid. It opens with the ``tier`` that answers for
the person for as long as it lasts (``tiers``: a fixed rule of the distance and of what the plot
turns on), which is the tier a model is asked on for their words (``replies``), and with ``until``,
the tick at which the routine of the person takes them away (``Person.leaves_at``). It ends with
``leave``, or in the tick that brings the clock to ``until``, which is to say while an act is paid
for: the person says they have to go (the phrase ``timeout``, the event ``talk_end`` with that
reason) and their routine goes on.
Someone who is asleep, in the middle of an errand or in the middle of telling someone else does not
talk, and says so. Each first conversation of a game day with a person earns a little of their
trust, up to ``RAPPORT_CEILING``: no one trusts a stranger, and chatting alone does not buy much.

What a person says to the player is kept as ``line`` while it is on show, as a code and not as
words, so that the state stays small and the words are made in the frame: ``kind`` is ``text``
(``arg`` is a code of ``phrases``) or ``claim`` (``arg`` is the id of the answer, ``lead`` a code
of ``phrases`` that opens it, or ""). The frame shows it as a bubble over the person, in the
words that person has for it (``voices``). The words of a model are the one thing that cannot be
made from a code: they are kept as they passed the gate, as the kind ``said`` (``arg`` is the
Chinese and ``lead`` the English).

Events: ``arrived`` (``x``, ``y``, ``place``), ``talk_start`` (``npc``, ``leaves_at``: ``{"hour",
"minute"}``), ``talk_end`` (``npc``, ``reason``: ``leave``, or ``timeout`` for the person whose
routine called them away), ``declined`` (``npc``, ``reason``), ``asked`` (``npc``,
``topic``, ``answer``: claim, ignorant or evasive, ``path``: belief, lie, ignorance or "", ``prop``,
``source``: who the person says told them, ``entry``, ``new``, and ``pointer``, the id of the
person they send the manager to, only in an answer that points the way: see ``pointers``),
``heard`` (``speaker``,
``listener``, ``claim``, ``prop``, ``source``, ``entry``, ``new``),
``look_start`` (``at``, ``until``), ``look_refused`` (``at``, ``npc``) and ``inspected`` (``at``,
``found``: the items, ``entries``: the ids of the entries written). The dealings with people add
``told``, ``lie_caught`` (``npc``, ``prop``, ``trust``), ``entrusted``, ``entrust_done``,
``entrust_withdrawn``, ``testified``, ``convened``, ``pledged``, ``pledge_empty``,
``pledge_kept``, ``pledge_broken``, ``spoke``, ``clarified`` and ``feast``, listed with their
actions above, ``objection_withdrawn`` (``npc``, ``what``: Granny Li no longer objects to lending
the bamboo, see ``objection``) and ``answered``, when the words a model wrote for a person landed
(see ``speech``).
When the person in the conversation has said the line that answers an action (an answer, a
refusal, an agreement), the signal ``replied`` (``npc``) comes with it, before those events and
before the ``action_ack`` (see ``converse``). The state does not count a signal. That line is the
answer of the rules, and it is acknowledged at once. A model is then asked for the same in the
person's own words (``replies``); while the request is out the frame says the person is thinking,
and when the words pass the gate they replace the line on show, with another ``replied`` and the
event ``answered`` (``speech``). If they do not come, or do not pass, the answer of the rules stays.

What the manager does with people is in modules of its own: ``speak`` (the five ways of telling),
``lies`` (getting caught), ``entrust`` and ``persuade`` (asking, the hard conditions and the score),
``pledges`` (promises and the ledger of favours), ``assembly`` (speaking in public, the elder's
call, the table for two families), ``repute`` (trust and the stars), ``offers`` (what the frame
puts forward) and ``reveal`` (the manager's part of the ending). ``converse`` has what they share.

Adding a verb. A verb is a pair of functions (validate the body, apply it) in ``ACTIONS``, and, if
the client should know when it is on, a line in ``verbs`` and an id in ``VERB_ORDER``. The notebook
is read and written through the functions of ``notebook``, and what a person says through
``answers``.

The frame
---------
``player``    ``{"x", "y", "activity", "talk", "costs", "look", "offers", "topics",
              "thinking"}``.
              ``thinking`` is the id of the person in the conversation while a request for their
              words is in flight, else null. ``activity`` is an
              id of the scene's activities: ``walk`` on the way, ``chat`` in a conversation,
              ``work`` while inspecting, ``rest`` otherwise. ``talk`` is ``{"npc", "costs",
              "leaves_at"}`` in a conversation and null otherwise: ``costs`` is the game minutes
              of each of ``ask``, ``ask_source``, ``tell``, ``entrust`` and ``promise`` (every
              one is a key), and ``leaves_at`` is ``{"hour", "minute"}``, when the routine of the
              person takes them away (they go when the world runs to it). ``player.costs`` is
              in every frame, in a conversation or not: the game minutes of all six acts, the
              five above and ``speak``, which is made outside a conversation and has no
              ``talk`` to show its cost in. ``look`` lists the
              things and places within reach that hold evidence the player has not looked for.
              ``offers`` is ``{verb: [offer]}``
              for ``tell``, ``entrust``, ``promise`` and ``speak``, each offer ``{"id", "label":
              {"zh", "en"}, "body": {...}}``: what to show and the fields of the action to send
              (see ``offers``). A verb has offers only where it can be used. ``topics`` is what
              ``ask`` takes now, ``[{"id", "kind", "label": {"zh", "en"}}]`` with ``kind`` one of
              ``entry`` (a line of the notebook), ``thing``, ``place`` (the bridge) and ``person``:
              the whole list in a conversation, and empty outside one. Every id in it is one that
              ``ask`` answers (a person the script does not name is not in it, and is refused
              as ``unknown_topic``).
``notebook``  the entries, in the order they were written (see ``notebook.wire``).
``judgments`` ``[{"a", "b", "relation", "made"}]``, what the manager judged right; ``hint`` the pair
              a hint lit, ``{"a", "b"}`` and ``"relation"`` once asked again, or null (``judge``).
``bubbles``   the words of the person who answered, ``{"npc", "until", "text": {"zh", "en"}}``.
              The person in a conversation shows as ``chat``. A line a model wrote is kept in
              the state as it passed the gate, a line of the kind ``said`` (see ``converse``).
              The tellings of the townsfolk are bubbles too, with their words only for a telling
              within hearing (``social``).
``hud.verbs`` ids of what the player can do now, in the order of ``VERB_ORDER``. ``track`` is there
              whenever there is a task the player could follow in place of the one they do
              (``agenda``), in a talk and at a look as well. ``move`` is there
              when the player is free to walk, ``talk`` when someone who would talk stands within
              reach, ``leave`` and ``ask`` in a conversation (and ``ask_source`` when the
              notebook holds something that was heard), ``listen`` when there is something to
              hear and ``look`` when there is something to look at. ``askSource`` is listed with
              ``ask_source`` because the client names that verb so. In a conversation ``tell``,
              ``entrust`` and ``promise`` are there too, and where the manager may speak in public
              (and is free) ``speak``, which is listed with ``speak_publicly`` for the same
              reason. ``judge`` and ``hint`` are there, as ``track`` is, once the notebook has two
              entries. What the list says never depends on which variant of the story is true.
``hud``       also has ``reputation`` (0 to 3 stars, the mean trust of the town in the manager
              against ``repute.STAR_LINES``), ``resources`` (what the manager still has to
              promise, see ``pledges.left``) and ``pledges`` (the promises still open, each
              ``{"id", "to": {"zh", "en", "id"}, "what", "item", "amount", "due"}``).

The scene gets ``player``: ``{"id", "zh", "en", "role", "token", "start", "things"}``. ``things``
names the things of the story that a question or a look can be about, as ``{"id", "zh", "en"}``:
the places and the people are in the scene already.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Any

from lantern_core.cognition.beliefs import UNKNOWN
from lantern_core.inputs import InputError, int_field
from lantern_core.world.bridge import (
    agenda,
    answers,
    assembly,
    bt,
    clock,
    converse,
    entrust,
    evidence,
    gossip,
    judge,
    lies,
    notebook,
    objection,
    offers,
    overhear,
    pace,
    peace,
    pledges,
    pointers,
    preview,
    replies,
    repute,
    roles,
    speak,
    statement,
    tiers,
)
from lantern_core.world.bridge.converse import ack, say
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.reveal import ending_reveal  # noqa: F401  (the hook of goals_ending)
from lantern_core.world.grid import UNREACHABLE

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "player"

PLAYER_ID = notebook.PLAYER_ID
START_PLACE = "p_bridge"
TALK_RANGE = 2  # cells, Chebyshev: within this the player can open a conversation
HEARING = overhear.HEARING  # cells: within this the player hears two people talk
LINE_TICKS = 60  # how long the words of a person who will not talk stay on show
STRANGER_TRUST = repute.STRANGER
RAPPORT_STEP = 3
RAPPORT_CEILING = 20
MAX_ID_CHARS = 64

VERB_ORDER = (
    "move",
    "talk",
    "leave",
    "ask",
    "ask_source",
    "askSource",
    "tell",
    "entrust",
    "promise",
    "rally",
    "speak",
    "speak_publicly",
    "listen",
    "look",
    "track",
    "judge",
    "hint",
)


# ---------------------------------------------------------------------------- the section


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    """The section at the start of a game: on the bridge, with an empty notebook."""
    x, y = world.town.places[START_PLACE].cells[0]
    people = len(world.cast.people)
    return {
        "x": x,
        "y": y,
        "goal": [x, y],
        "dest": "",
        "talk": {},
        "busy": {},
        "line": [],
        "notebook": [],
        "heard": [],
        "claims": {},
        "evidence": [],
        "looked": [],
        "seq": 1,
        "cseq": 1,
        "trust": [repute.STRANGER] * people,
        "talked": [0] * people,
        "told": [],
        "lies": [],
        "caught": [],
        "wary": {},
        "deeds": {},
        "pledges": [],
        "pseq": 1,
        "asked": {},
        "pending": [],
        "rseq": 0,
        "nod": {},
        "won": [],
        "asks": [],
        "public": {"refuted": [], "speeches": [], "seen": {}},
        "meeting": {},
        "judgments": [],
        "hint": [],
    }


def standing(section: dict[str, Any]) -> tuple[int, int]:
    return section["x"], section["y"]


def distance(section: dict[str, Any], npc: dict[str, Any]) -> int:
    """How many cells apart the player and a person are, as the king walks."""
    return max(abs(section["x"] - npc["x"]), abs(section["y"] - npc["y"]))


# ---------------------------------------------------------------------------- validating


def _id_field(value: Any, where: str, name: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= MAX_ID_CHARS:
        raise InputError(f"{where}: {name} must be a string of 1 to {MAX_ID_CHARS} characters")
    return value


def _plain(body: dict[str, Any], kind: str) -> dict[str, Any]:
    return {"action_id": body["action_id"], "type": kind}


def validate_move(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    where = "player action move"
    out = _plain(body, "move")
    if "place" in body:
        if "x" in body or "y" in body:
            raise InputError(f"{where}: give a place or a cell, not both")
        out["place"] = _id_field(body["place"], where, "place")
    else:
        out["x"] = int_field(body.get("x"), where, "x", 0, 10_000)
        out["y"] = int_field(body.get("y"), where, "y", 0, 10_000)
    return out


def validate_talk(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    out = _plain(body, "talk")
    out["npc"] = _id_field(body.get("npc"), "player action talk", "npc")
    return out


def validate_bare(kind: str) -> Callable[[BridgeWorld, dict[str, Any]], dict[str, Any]]:
    """The validator of an action that has no fields of its own."""

    def validate(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
        return _plain(body, kind)

    return validate


def validate_ask(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    where = "player action ask"
    out = _plain(body, "ask")
    out["topic"] = _id_field(body.get("topic"), where, "topic")
    return converse.with_words(out, body, where)


def validate_ask_source(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    where = "player action ask_source"
    out = _plain(body, "ask_source")
    out["entry"] = _id_field(body.get("entry"), where, "entry")
    return converse.with_words(out, body, where)


def validate_look(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    out = _plain(body, "look")
    out["at"] = _id_field(body.get("at"), "player action look", "at")
    return out


# ---------------------------------------------------------------------------- applying


def apply_move(sim: Sim, body: dict[str, Any]) -> None:
    section, world = sim.state["player"], sim.world
    if section["talk"]:
        return ack(sim, body, "talking")
    if section["busy"]:
        return ack(sim, body, "busy")
    grid = world.walking_grid(sim.state)
    dest = ""
    if "place" in body:
        place = world.town.places.get(body["place"])
        if place is None:
            return ack(sim, body, "unknown_place")
        if place.door is None:
            return ack(sim, body, "no_door")
        goal, dest = place.door, place.id
    else:
        goal = (body["x"], body["y"])
        if not grid.inside(*goal):
            return ack(sim, body, "outside")
    target = grid.index(*goal)
    if not grid.walkable(target):
        return ack(sim, body, "blocked")
    if grid.field(target)[grid.index(*standing(section))] >= UNREACHABLE:
        return ack(sim, body, "unreachable")
    section["goal"] = [goal[0], goal[1]]
    section["dest"] = dest
    ack(sim, body)
    if standing(section) == (goal[0], goal[1]):
        sim.emit("arrived", x=goal[0], y=goal[1], place=dest)
        section["dest"] = ""


def declines(world_state: dict[str, Any], tick: int, index: int, npc: dict[str, Any]) -> str | None:
    """Why the person at ``index`` will not talk at ``tick``: ``asleep`` or ``busy``, else None.

    Busy is in the middle of an errand or in the middle of telling somebody else.
    """
    if gossip.asleep(npc):
        return "asleep"
    busy = world_state["social"].get("busy")
    if npc["mode"] == bt.TASK or (busy is not None and busy[index] > tick):
        return "busy"
    return None


def apply_talk(sim: Sim, body: dict[str, Any]) -> None:
    section, world, now = sim.state["player"], sim.world, sim.ctx.tick
    if section["talk"]:
        return ack(sim, body, "talking")
    if section["busy"]:
        return ack(sim, body, "busy")
    index = world.cast.index.get(body["npc"])
    if index is None:
        return ack(sim, body, "unknown_npc")
    npc = sim.state["npcs"]["list"][index]
    if distance(section, npc) > TALK_RANGE:
        return ack(sim, body, "far")
    reason = declines(sim.state, now, index, npc)
    if reason is not None:
        say(section, npc["id"], now + LINE_TICKS, "text", reason)
        sim.emit("declined", npc=npc["id"], reason=reason)
        return ack(sim, body, reason)
    section["goal"] = [section["x"], section["y"]]
    section["dest"] = ""
    until = world.cast.people[index].leaves_at(now)
    section["talk"] = {
        "npc": npc["id"],
        "start": now,
        "until": until,
        "hold": [npc["x"], npc["y"]],
        "tier": tiers.of(npc["id"], distance(section, npc)),
    }
    section["line"] = []
    day, before = sim.now.day, section["talked"][index]
    if before != day:
        section["talked"][index] = day
        section["trust"][index] = max(
            section["trust"][index], min(RAPPORT_CEILING, section["trust"][index] + RAPPORT_STEP)
        )
    roles.greet(sim, npc["id"], before)  # the people who carry the days greet by the state of it
    sim.emit("talk_start", npc=npc["id"], leaves_at=_when(until))
    ack(sim, body)


def _when(tick: int) -> dict[str, int]:
    """The time of day at ``tick`` as the frame has it: ``{"hour", "minute"}``."""
    then = clock.at(tick)
    return {"hour": then.hour, "minute": then.minute}


def close_talk(sim: Sim, reason: str) -> None:
    """End the conversation: the world is not held any more and the person's routine goes on.

    A person who goes because the world ran to the start of their next entry (``timeout``) says so,
    and what the world still owed for the act that was being paid is let go, so that the words are
    on show at the normal pace. A ``leave`` of the manager lets nothing go.
    """
    section = sim.state["player"]
    npc_id = section["talk"]["npc"]
    replies.release(sim)
    section["talk"] = {}
    section["line"] = []
    if reason == "timeout":
        say(section, npc_id, sim.ctx.tick + LINE_TICKS, "text", "timeout")
        sim.state["clock"].pop("debt", None)
    else:  # the manager left: a person who has a last word for it says it (``roles``)
        roles.parting(sim, npc_id)
    sim.emit("talk_end", npc=npc_id, reason=reason)


def apply_leave(sim: Sim, body: dict[str, Any]) -> None:
    if not sim.state["player"]["talk"]:
        return ack(sim, body, "not_talking")
    close_talk(sim, "leave")
    ack(sim, body)


# ---------------------------------------------------------------------------- one tick


def _walk(sim: Sim, section: dict[str, Any]) -> None:
    goal = section["goal"]
    if section["x"] == goal[0] and section["y"] == goal[1]:
        return
    world = sim.world
    period = world.move_day if sim.now.phase == clock.DAY else world.move_night
    if sim.ctx.tick % period:
        return
    grid = world.walking_grid(sim.state)
    here, target = grid.index(section["x"], section["y"]), grid.index(goal[0], goal[1])
    step = here
    if grid.walkable(target):
        step = grid.best_step(here, grid.field(target))
    if step != here:
        section["x"], section["y"] = grid.xy(step)
    if section["x"] == goal[0] and section["y"] == goal[1]:
        sim.emit("arrived", x=goal[0], y=goal[1], place=section["dest"])
        section["dest"] = ""
    elif step == here:  # cut off from the goal: stay where they are
        section["goal"] = [section["x"], section["y"]]
        section["dest"] = ""


def tick(sim: Sim) -> None:
    """One tick: the conversation holds its partner until their routine calls them away, an
    inspection ends, or a walk."""
    section = sim.state["player"]
    talk, busy = section["talk"], section["busy"]
    if talk:
        npc = sim.state["npcs"]["list"][sim.world.cast.index[talk["npc"]]]
        npc["x"], npc["y"] = talk["hold"]
        if sim.ctx.tick + 1 >= talk["until"]:  # this tick brings the clock to the time they go
            close_talk(sim, "timeout")
    elif busy:
        if sim.ctx.tick >= busy["until"]:
            where, found, written = evidence.finish(sim.state, sim.ctx.tick)
            sim.emit("inspected", at=where, found=found, entries=written)
    else:
        _walk(sim, section)
    repute.watch(sim)
    lies.watch(sim)
    pledges.watch(sim)
    entrust.watch(sim)
    objection.watch(sim)
    peace.watch(sim)


def apply_look(sim: Sim, body: dict[str, Any]) -> None:
    section, world, now = sim.state["player"], sim.world, sim.ctx.tick
    if section["talk"]:
        return ack(sim, body, "talking")
    if section["busy"]:
        return ack(sim, body, "busy")
    if evidence.place_of(world, body["at"]) is None:
        return ack(sim, body, "unknown_target")
    if not evidence.within_reach(world, section, body["at"]):
        return ack(sim, body, "far")
    reason, keeper = evidence.begin(world, section, body["at"], sim.now, now)
    if reason is not None:
        if reason == "refused" and keeper is not None:
            say(section, keeper, now + LINE_TICKS, "text", "keeper_no")
            sim.emit("look_refused", at=body["at"], npc=keeper)
        return ack(sim, body, reason)
    sim.emit("look_start", at=body["at"], until=section["busy"]["until"])
    ack(sim, body)


def apply_listen(sim: Sim, body: dict[str, Any]) -> None:
    section, now = sim.state["player"], sim.ctx.tick
    if section["talk"]:
        return ack(sim, body, "talking")
    if section["busy"]:
        return ack(sim, body, "busy")
    heard = overhear.audible(sim.state, now)
    if not heard:
        return ack(sim, body, "nothing_to_hear")
    claim, entry, new = overhear.take_in(sim.state, heard[0])
    sim.emit(
        "heard",
        speaker=claim.speaker,
        listener=claim.listeners[0],
        claim=claim.id,
        prop=claim.prop,
        source=claim.claimed_source,
        entry=entry["id"],
        new=new,
    )
    ack(sim, body)


def _converse(
    sim: Sim, body: dict[str, Any], topic: str, purpose: str, entry: dict[str, Any] | None
) -> None:
    """The person in the conversation answers a question about ``topic``; the notebook learns it."""
    world_state, section, now = sim.state, sim.state["player"], sim.ctx.tick
    talk = section["talk"]
    partner = talk["npc"]
    said = answers.reply(world_state, now, partner, topic, purpose)
    written = None
    pointer = None
    if said.claim is None:
        pointer = (
            None
            if said.kind == answers.EVASIVE
            else pointers.direction(world_state, partner, topic)
        )
        if pointer is not None:  # they know nothing, and say whom to ask
            say(section, partner, talk["until"], "point", pointer.code, pointer.who)
        else:
            code = "evade" if said.kind == answers.EVASIVE else "unknown"
            say(section, partner, talk["until"], "text", code)
    else:
        claim_id, kept, new = notebook.take_answer(world_state, partner, said.claim)
        written = (kept, new)
        if said.rival is not None:  # and the account somebody else told them, after the belief
            other, _, _ = notebook.take_answer(world_state, partner, said.rival)
            notebook.pair_rival(section, claim_id, other)
        say(section, partner, talk["until"], "claim", claim_id, said.lead)
    converse.replied(sim, partner)
    if entry is not None and notebook.frontier(entry) == partner:
        claim = said.claim
        notebook.extend_trail(
            entry,
            partner,
            UNKNOWN if claim is None else claim.claimed_source,
            topic if claim is None else claim.prop,
        )
    extra = {} if pointer is None else {"pointer": pointer.who}  # only an answer that points
    sim.emit(
        "asked",
        npc=partner,
        topic=topic,
        answer=said.kind,
        path=said.path,
        prop=None if said.claim is None else said.claim.prop,
        source=None if said.claim is None else said.claim.claimed_source,
        entry=None if written is None else written[0]["id"],
        new=False if written is None else written[1],
        **extra,
    )
    ack(sim, body)
    replies.after_ask(sim, body, topic, purpose, said)


def apply_ask(sim: Sim, body: dict[str, Any]) -> None:
    section = sim.state["player"]
    if not section["talk"]:
        return ack(sim, body, "not_talking")
    topic = body["topic"]
    entry = notebook.find(section, topic)  # an entry of the notebook stands for what it says
    if entry is not None:
        topic = entry["prop"]
    elif not answers.topic_known(topic, notebook.view(sim.state["social"])):
        return ack(sim, body, "unknown_topic")
    _converse(sim, body, topic, answers.TOPIC, None)


def apply_ask_source(sim: Sim, body: dict[str, Any]) -> None:
    section = sim.state["player"]
    if not section["talk"]:
        return ack(sim, body, "not_talking")
    entry = notebook.find(section, body["entry"])
    if entry is None:
        return ack(sim, body, "no_entry")
    _converse(sim, body, entry["prop"], answers.SOURCE, entry)


ACTIONS = {
    "move": (validate_move, apply_move),
    "talk": (validate_talk, apply_talk),
    "leave": (validate_bare("leave"), apply_leave),
    "listen": (validate_bare("listen"), apply_listen),
    "ask": (preview.versioned(validate_ask), pace.timed("ask", apply_ask)),
    "ask_source": (
        preview.versioned(validate_ask_source),
        pace.timed("ask_source", apply_ask_source),
    ),
    "look": (validate_look, apply_look),
    "tell": (preview.versioned(speak.validate), replies.answered(pace.timed("tell", speak.apply))),
    "entrust": (
        preview.versioned(entrust.validate),
        replies.answered(pace.timed("entrust", entrust.apply)),
    ),
    "promise": (
        preview.versioned(pledges.validate),
        replies.answered(pace.timed("promise", pledges.apply)),
    ),
    "speak": (assembly.validate, pace.timed("speak", assembly.apply)),
    "speak_publicly": (assembly.validate, pace.timed("speak", assembly.apply)),
    **judge.ACTIONS,  # judge and hint take no time: they are not timed
    **statement.ACTIONS,  # nor does choosing an option of the statement card
}


# ---------------------------------------------------------------------------- scene and frame


def scene(world: BridgeWorld) -> dict[str, Any]:
    """The static part: who the player is, where they start, and the things of the story."""
    x, y = world.town.places[START_PLACE].cells[0]
    things = [
        {"id": e.id, "zh": e.label, "en": e.label_en or e.id}
        for e in lore().book.registry.of_type("thing")
    ]
    return {
        "player": {
            "id": PLAYER_ID,
            "zh": "总管",
            "en": "Festival Manager",
            "role": {"zh": "灯会总管", "en": "Manager of the lantern festival"},
            "token": {"zh": "总", "en": "M"},
            "start": [x, y],
            "things": things,
        }
    }


def activity(section: dict[str, Any]) -> str:
    if section["talk"]:
        return "chat"
    if section["busy"]:
        return "work"
    if section["x"] != section["goal"][0] or section["y"] != section["goal"][1]:
        return "walk"
    return "rest"


words = converse.words


def verbs(
    world_state: dict[str, Any], tick: int, looks: list[str], speaking: bool = False
) -> list[str]:
    """The ids of what the player can do at ``tick``, in the order of ``VERB_ORDER``.

    ``looks`` is what the player stands close enough to look at (``evidence.in_reach``), and
    ``speaking`` whether they stand where they may speak in public now (``assembly.open_here``).
    """
    section = world_state["player"]
    have: set[str] = set()
    if section["talk"]:
        have |= {"leave", "ask", "tell", "entrust", "promise"}
        if any(entry["trail"] for entry in section["notebook"]):
            have |= {"ask_source", "askSource"}
    elif not section["busy"]:
        have.add("move")
        for index, npc in enumerate(world_state["npcs"]["list"]):
            if distance(section, npc) <= TALK_RANGE and not declines(world_state, tick, index, npc):
                have.add("talk")
                break
        if overhear.audible(world_state, tick):
            have.add("listen")
        if looks:
            have.add("look")
        if speaking:
            have |= {"speak", "speak_publicly"}
    if agenda.can_track(world_state):  # it costs no time, so it is there in a talk and at a look
        have.add("track")
    if judge.available(world_state):  # as is judging two notes, and asking for a hint
        have |= {"judge", "hint"}
    return [verb for verb in VERB_ORDER if verb in have]


def frame(world: BridgeWorld, state: dict[str, Any], out: dict[str, Any]) -> None:
    world_state, now = state["world"], state["tick"]
    section = world_state["player"]
    talk = section["talk"]
    looks = evidence.in_reach(world, section, clock.at(now))
    here = clock.at(now)
    wired = notebook.wire(world, world_state)
    out["player"] = {
        "x": section["x"],
        "y": section["y"],
        "activity": activity(section),
        "talk": (
            {"npc": talk["npc"], "costs": pace.costs(), "leaves_at": _when(talk["until"])}
            if talk
            else None
        ),
        "costs": pace.table(),
        "look": looks,
        "offers": offers.build(world, world_state, here),
        "topics": offers.topics(world, wired) if talk else [],
    }
    out["notebook"] = wired
    out["judgments"] = judge.wire_judgments(section)
    statement.frame(world, state, out)
    out["hint"] = judge.wire_hint(section)
    speaking = assembly.open_here(world, world_state, here)
    out["hud"]["verbs"] = verbs(world_state, now, looks, speaking)
    out["hud"]["reputation"] = repute.stars(section)
    out["hud"]["resources"] = pledges.left(section)
    out["hud"]["pledges"] = pledges.wire(world, section)
    line = section["line"]
    if line and line[1] > now:
        text = words(world_state, line)
        out["bubbles"] = [b for b in out["bubbles"] if b["npc"] != line[0]]
        out["bubbles"].append({"npc": line[0], "until": line[1], "text": text})
    if talk:
        for entry in out["npcs"]:
            if entry["id"] == talk["npc"]:
                entry["activity"] = "chat"
