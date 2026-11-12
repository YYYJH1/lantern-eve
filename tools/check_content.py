"""Check the game content and compile it to canonical JSON.

Build time only: the core never imports pydantic or yaml, it reads the files this tool writes.

    uv run python tools/check_content.py            validate, write content/compiled/, report
    uv run python tools/check_content.py --check    validate, fail if a compiled file is stale

Sources are content/tables/*.yaml, content/entities.yaml and content/scripts/*.yaml, and the
town and cast of a scenario, content/maps/*.yaml and content/cast/*.yaml (see ``town_content``).
A person of entities.yaml may have a ``bio``, what the town says of them in both languages, and
every person of a cast needs one: it goes into the compiled cast and not into entities.json.
The lines the townsfolk say are content/tables/sentences.yaml (see ``sentence_content``), and
the way each of them says the fixed words of the town, and what each calls the others, is
content/lines/<person>.yaml (see ``voice_content``). The words that a model's reply is held to are
content/tables/speech.yaml (see ``speech_content``), and the prompts that ask a model for them are
content/prompts/reply.yaml (see ``prompt_content``).
Outputs are content/compiled/tables.json, entities.json, sentences.json, speech.json,
voices.json, prompts.json and one <script>.json per script, and map_<id>.json and cast_<id>.json
for each map and cast, written with ``lantern_core.canon.dumps`` (sorted keys, compact, UTF-8,
integers only, no trailing newline). The content of a scenario also goes into a generated Python
module of the core, ``core/lantern_core/world/<scenario>/data.py``, and the lines into
``sentences.py``, ``voice_data.py``, ``speech_data.py`` and ``prompt_data.py`` beside it, because
the core cannot read files.

The checks are listed in ``validate_script``. In short: every name resolves, every argument has
the type its slot asks for, every mutated proposition is a legal step of its operator, the
exclusive groups hold in every truth variant, every truth variant can be told apart from the
others by at least one declared evidence set, and every lie template stays inside the envelope
of what its character may claim.

Whether a mutation is a legal step, and whether a speculation rule fits a prop, are decided by
the core itself (``mutation_problem`` and ``SpecRule``), so that the content is held to the same
rules the game will hold it to. The compiled tables carry ``level_to`` and ``heavier`` and the
slot types the core reads (a slot's ``type`` is one type, or a list of them).
"""

from __future__ import annotations

import argparse
import itertools
import re
import string
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_serializer,
)

import prompt_content
import sentence_content
import speech_content
import town_content
import voice_content
from lantern_core import canon
from lantern_core.cognition._fields import ShapeError
from lantern_core.cognition.props import Prop as CoreProp
from lantern_core.cognition.props import PropBook as CoreBook
from lantern_core.cognition.props import Registry as CoreRegistry
from lantern_core.cognition.props import Tables as CoreTables
from lantern_core.cognition.props import mutation_problem
from lantern_core.cognition.rules import SpecRule as CoreRule

ROOT = Path(__file__).resolve().parents[1]
DAY = 1440
MAX_SETS_PER_VARIANT = 6
MAX_ITEMS_PER_SET = 4
MIN_INDEPENDENT_ROUTES = 2
MIN_SPAN_START = -7 * DAY
DAY_START, DAY_END = 6 * 60, 21 * 60  # 06:00 and 21:00 of the first day, on the script clock
STATIC_PREDS = ("located", "owns")  # as in world.bridge.lore: nobody sees these for themselves
EntityType = Literal["person", "family", "thing", "place"]
Op = Literal["level", "sharpen", "assimilate", "fill"]
SourceKind = Literal["witnessed", "heard", "guessed", "gossip", "gazette"]
ENTITY_TYPES = ("person", "family", "thing", "place")
BIO_LIMIT = {"zh": 70, "en": 320}  # characters of what the town says of a person
REQUIRED_MOTIVES = ("accident", "on_purpose")  # the motives the operators know by name
PLEDGE_CARDS = 20  # the promises of the manager that have a task each (``pledges.CARDS``)
MAX_GIFTS = 8  # the small things the market gives away in a day


# --------------------------------------------------------------------------------------
# Models of the YAML. Anything the models cannot say is checked in validate_*.
# --------------------------------------------------------------------------------------


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Slot(Strict):
    name: str
    type: EntityType | list[EntityType]  # one type, or the several a slot takes
    required: bool = True

    @property
    def types(self) -> list[str]:
        return [self.type] if isinstance(self.type, str) else list(self.type)


class Predicate(Strict):
    id: str
    label: str
    slots: list[Slot] = Field(min_length=1)
    level_to: str | None = None  # the more general predicate a level step may move to
    heavier: str | None = None  # the next rung up, for a sharpen step


class Motive(Strict):
    id: str
    label: str


class PredicateFile(Strict):
    predicates: list[Predicate]


class MotiveFile(Strict):
    motives: list[Motive]


class Named(Strict):
    id: str
    label: str
    label_en: str | None = None  # the English name; the checker asks for it on every entity


class Bio(sentence_content.Pair):
    """What the town says of a person, in both languages: two sentences of public things."""


class Person(Named):
    family: str | None = None
    # What the town says of the person. Every person of a cast needs one (``town_content`` asks),
    # and a bio is checked wherever one is given.
    bio: Bio | None = None


class EntityFile(Strict):
    families: list[Named]
    people: list[Person]
    things: list[Named]
    places: list[Named]


class Variant(Strict):
    id: str
    label: str
    holds: list[str] = Field(default_factory=list)  # YAML 1.1 reads a bare `true:` as a boolean


class PropIn(Strict):
    id: str
    pred: str
    args: dict[str, str]
    span: list[int] | None = None
    neg: bool = False
    motive: str | None = None
    parent: str | None = None
    op: Op | None = None


class Exclusive(Strict):
    id: str
    props: list[str]


class Observation(Strict):
    id: str
    kind: Literal["cover_story", "misleading"]
    label: str
    holder: str | None = None
    shows: list[str]
    toward: list[str]
    in_: Literal["all"] | list[str] = Field(alias="in")


class Hop(Strict):
    prop: str
    speaker: str | None = None
    listener: str | None = None
    via: str | None = None


class Chain(Strict):
    id: str
    label: str
    hops: list[Hop] = Field(min_length=2)


class OpenHop(Strict):
    speaker: str
    listener: str
    prop: str
    confidence: int = Field(ge=1, le=100)  # how far the listener takes it in
    via: str | None = None  # the speculation rule behind an assimilate that changes the predicate
    own: int | None = Field(default=None, ge=1, le=100)  # how far the speaker believes it


class Opening(Strict):
    id: str
    label: str
    quiet_until: int | None = Field(default=None, ge=DAY_START, le=DAY_END)
    hops: list[OpenHop] = Field(min_length=1)


class Acquire(Strict):
    from_: str = Field(alias="from")
    gatekeeper: str | None = None
    min_trust: int | None = Field(default=None, ge=0, le=100)
    daily: list[int] | None = None
    until: int | None = None
    # the minute (counted from 00:00 of day 1, as `until` is) before which the item cannot be had
    # at all; left out of the compiled script where a script does not say it
    since: int | None = None
    minutes: int = Field(ge=0, le=DAY)
    needs: list[str] = Field(default_factory=list)

    @model_serializer(mode="wrap")
    def leave_out_since_if_unset(self, handler: Any) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        if data.get("since") is None:
            data.pop("since", None)
        return data


class Evidence(Strict):
    id: str
    label: str
    label_en: str
    supports: list[str] = Field(min_length=1)
    refutes: list[str] = Field(default_factory=list)
    acquire: Acquire


class EvidenceSet(Strict):
    id: str
    tells: str
    items: list[str] = Field(min_length=1)


class LieSource(Strict):
    kind: SourceKind
    from_: str | None = Field(default=None, alias="from")


class LieTemplate(Strict):
    id: str
    kind: Literal["claim", "feign_ignorance"]
    prop: str | None = None
    source: LieSource | None = None
    about: str | None = None
    source_only: bool = False


class LieHolder(Strict):
    holder: str
    motive: str
    preds: list[str]
    ignorance: list[str] = Field(default_factory=list)
    objects: list[str]
    sources: list[SourceKind]
    templates: list[LieTemplate] = Field(min_length=1)


class Pattern(Strict):
    pred: str
    args: dict[str, str]


class Relation(Strict):
    kind: Literal["grudge"]
    holder: Literal["speaker"]
    target: str


class SpecRule(Strict):
    id: str
    label: str
    vars: dict[str, EntityType]
    premises: list[Pattern] = Field(min_length=1)
    relation: Relation | None = None
    conclusion: Pattern
    hedge: list[str] = Field(min_length=1)
    min_suspicion: int = Field(ge=0, le=100)


class Flag(Strict):
    id: str
    label: str


class Metric(Strict):
    id: str
    label: str
    min: int
    max: int


class Goal(Strict):
    id: str
    label: str
    done_when: dict[str, Any]
    where: list[str] = Field(default_factory=list)
    deadline: int | None = None
    sets: str | None = None


class EndingRow(Strict):
    id: str
    label: str
    when: Any


class HiddenEnding(Strict):
    id: str
    label: str
    when: dict[str, Any]


class Invariant(Strict):
    if_false: str
    never: str


class Endings(Strict):
    inputs: list[str]
    derived: dict[str, Any]
    rows: list[EndingRow]
    hidden: list[HiddenEnding] = Field(default_factory=list)
    invariants: list[Invariant] = Field(default_factory=list)


class Alternative(Strict):
    id: str
    label: str
    all: list[dict[str, Any]] = Field(min_length=1)


class Refusal(Strict):
    when: list[dict[str, Any]] = Field(min_length=1)
    line: str  # the code of the fixed line (``phrases.py``) said when all of ``when`` hold


class HardCondition(Strict):
    id: str
    holder: str
    label: str
    any: list[Alternative] = Field(min_length=2)
    refusals: list[Refusal] = Field(default_factory=list)


def as_options(value: Any) -> list[Any]:
    """One option or a list of options as a list: the way a task writes its words and its action."""
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


class Words(Strict):
    zh: str = Field(min_length=1)
    en: str = Field(min_length=1)


class WordsIf(Words):
    when: list[dict[str, Any]] = Field(default_factory=list)  # all of them hold, or none is asked


class ActionIf(Strict):
    verb: Literal[
        "talk", "move", "look", "listen", "rally", "ask", "ask_source", "tell", "entrust",
        "promise", "speak", "judge", "state",
    ]  # fmt: skip
    npc: str | None = None
    place: str | None = None
    item: str | None = None
    # for `entrust`, its kind (with only `item` it is the goods: REQUEST_KINDS); for `speak`, its
    # kind (SPEAK_KINDS); for `promise`, its kind (PROMISE_KINDS: `keep`, with the number of the
    # promise as the item); and for `entrust` of the kind `persuade`, the person to be talked
    # round. Left out of the compiled script when a task does not say them.
    request: str | None = None
    kind: str | None = None
    target: str | None = None
    follow: list[str] = Field(default_factory=list)  # for npc `$frontier`: the props whose trail
    when: list[dict[str, Any]] = Field(default_factory=list)

    @model_serializer(mode="wrap")
    def leave_out_what_is_not_said(self, handler: Any) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        for key in ACTION_EXTRAS:
            if data.get(key) is None:
                data.pop(key, None)
        return data


class BlockedBy(Strict):
    when: list[dict[str, Any]] = Field(min_length=1)
    blocker: Words
    why: list[WordsIf] = Field(default_factory=list)
    next: list[WordsIf] = Field(default_factory=list)
    action: list[ActionIf] = Field(default_factory=list)

    @field_validator("why", "next", "action", mode="before")
    @classmethod
    def options(cls, value: Any) -> list[Any]:
        return as_options(value)


class TaskWindow(Strict):
    day: int | None = Field(default=None, ge=1)  # none: the same hours every day, the next of them
    from_: int = Field(alias="from", ge=DAY_START // 60, le=DAY_END // 60 + 3)
    to: int = Field(ge=DAY_START // 60, le=DAY_END // 60 + 3)
    place: str
    # The days a window of every day is on, `[first, last]`, for a task whose act cannot be done
    # before the first of them (the statement in public) or after the last. Left out of the
    # compiled script where a window does not say it.
    days: list[int] | None = Field(default=None, min_length=2, max_length=2)
    # Conditions that, all holding today, spend today's time: the window is then that of the next
    # day (a window of every day) or none (a window of one day). Left out where a window has none.
    unless: list[dict[str, Any]] = Field(default_factory=list)

    @model_serializer(mode="wrap")
    def leave_out_what_is_not_said(self, handler: Any) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        if data.get("days") is None:
            data.pop("days", None)
        if not data.get("unless"):
            data.pop("unless", None)
        return data


class TaskExpected(Strict):
    from_: int = Field(alias="from", ge=DAY_START, le=DAY_END)
    to: int = Field(ge=DAY_START, le=DAY_END)


class Task(Strict):
    id: str
    kind: Literal["obstacle", "lead", "need", "promise", "venue"]
    job: Literal["bridge", "truth", "peace"] | None = None
    priority: int = Field(ge=1, le=99)  # the smaller, the more urgent
    text: Words
    why: list[WordsIf] = Field(default_factory=list)
    next: list[WordsIf] = Field(default_factory=list)
    action: list[ActionIf] = Field(default_factory=list)
    window: TaskWindow | None = None
    expected: TaskExpected | None = None
    appears: list[dict[str, Any]] = Field(default_factory=list)
    blocked: list[BlockedBy] = Field(default_factory=list)
    done: list[dict[str, Any]] = Field(default_factory=list)
    stale: list[dict[str, Any]] = Field(default_factory=list)
    again: bool = False  # opens again, as a new round, when `appears` holds once more
    # A task of the manager's promises is written once, with `per: pledge`, and made into one task
    # for each of the first PLEDGE_CARDS promises (`expand_pledge_tasks`): `t_keep` is `t_keep_1`
    # to `t_keep_20`, each with `pledge` the number of its promise. `lapse` is what the bar says
    # when the promise was not kept (and what it cost).
    per: Literal["pledge"] | None = None
    pledge: int | None = Field(default=None, ge=1, le=PLEDGE_CARDS)
    lapse: Words | None = None

    @field_validator("why", "next", "action", mode="before")
    @classmethod
    def options(cls, value: Any) -> list[Any]:
        return as_options(value)

    @model_serializer(mode="wrap")
    def leave_out_what_is_not_said(self, handler: Any) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        if not data.get("again"):
            data.pop("again", None)
        for key in ("per", "pledge", "lapse"):  # only the tasks of the promises say them
            if data.get(key) is None:
                data.pop(key, None)
        return data


class Want(Strict):
    id: str
    person: str
    text: Words
    learned: list[dict[str, Any]] = Field(default_factory=list)  # none: known from the start


class ActMinutes(Strict):
    """How long the acts of the manager take, in game minutes: the five acts of a conversation and
    speaking in public. After an act the world runs this long (the clock of the world, at the hour
    it happens), and in a conversation it then holds again. A script that says nothing has these."""

    ask: int = Field(default=10, ge=1, le=240)
    ask_source: int = Field(default=10, ge=1, le=240)
    tell: int = Field(default=15, ge=1, le=240)
    entrust: int = Field(default=20, ge=1, le=240)
    promise: int = Field(default=20, ge=1, le=240)
    speak: int = Field(default=30, ge=1, le=240)


class DueRules(Strict):
    cutoff: int = Field(ge=6, le=21)  # a promise made from this hour on falls due the next day
    soon: int = Field(ge=1, le=12)  # one made before it, this many hours later the same day
    late: int = Field(ge=6, le=21)  # the hour of the next day it falls due then


class CommitmentReasons(Strict):
    rain: Words
    failed: Words
    late: Words
    taken_back: Words


class CommitmentRecap(Strict):
    delivery: Words
    withdrawn: Words
    withdrawn_plain: Words
    clarified: Words
    promise: Words


class CommitmentRules(Strict):
    """What people promise the manager to bring, and by when (``commitments`` in the core)."""

    batches: dict[str, int] = Field(default_factory=dict)  # item -> amount of a first promise
    due: DueRules
    start: int = Field(ge=6, le=21)  # the hour of the due day at which the person sets out
    grace: int = Field(ge=0, le=12)  # hours after the due hour at which the promise is broken
    recap_hour: int = Field(ge=6, le=21)
    what: Words
    reasons: CommitmentReasons
    recap: CommitmentRecap


class PaperWhen(Strict):
    morning: Words
    night: Words


class PaperStreet(Strict):
    """When the street talks of the festival and of the two families (``paper`` in the core)."""

    warm: int = Field(ge=1, le=200)  # keen townsfolk from which the street is warm for the festival
    cool: int = Field(ge=0, le=200)  # and below which it is cool
    swing: int = Field(ge=1, le=200)  # a change of this many keen since the last morning is news
    camp: int = Field(ge=1, le=100)  # points from the middle of the lean at which one is on a side
    side: int = Field(ge=1, le=200)  # the larger camp is the street's side when this much larger
    split: int = Field(ge=1, le=200)  # two camps this large and no side: the street is split
    lean_swing: int = Field(ge=1, le=400)  # a change of this many in the camps' difference is news
    fresh: int = Field(ge=1, le=30)  # days a thing seen in public is what the street talks of


class PaperNews(Strict):
    bridge_mended: Words
    truth_told: Words
    reconciled: Words
    statement: Words
    statement_refused: Words
    evidence: Words
    evidence_refused: Words
    meal: Words
    stopped: Words
    side_by_side: Words
    helpers: Words
    work_stopped: Words
    work: Words
    rain_heavy: Words
    rain_light: Words
    quiet: Words
    two_accounts: Words


class PaperTalk(Strict):
    festival_up: Words
    festival_down: Words
    festival_warm: Words
    festival_mixed: Words
    festival_cool: Words
    peace: Words
    talked_out: Words
    li_more: Words
    zhou_more: Words
    li_side: Words
    zhou_side: Words
    split: Words
    walk_look: Words
    walk_call: Words
    walk_hand: Words


class PaperProgress(Strict):
    """How far the work at the bridge has got, in words, by the share of the hours done."""

    start: Words  # under a third
    under_half: Words
    half: Words
    over_half: Words


class PaperRules(Strict):
    """The words and the thresholds of the paper of the morning and the summary of the night."""

    when: PaperWhen
    manager: PaperWhen  # the manager as the paper of the morning and the summary of the night say
    progress: PaperProgress
    street: PaperStreet
    news: PaperNews
    talk: PaperTalk


class TutorialRelation(Strict):
    """A relation between two kinds of note that the notebook shows from the start: the tutorial's
    demonstration. It holds between any note of ``a`` (the evidence) and any note of ``b`` (the
    claim) that the manager has, and is shown on the claim (on both for ``contradicts``)."""

    a: list[str] = Field(min_length=1)
    b: list[str] = Field(min_length=1)
    relation: Literal["unsupported", "contradicts", "mismatch"]


class StatementOption(Strict):
    """One option of a part of the statement card: what it says, the variants in which it is the
    right one, the props it states, and the props whose notes bear for it and against it."""

    id: str
    text: Words
    right: list[str] = Field(default_factory=list)
    claims: list[str] = Field(default_factory=list)  # the cause states who or what broke the rail
    supports: list[str] = Field(default_factory=list)
    against: list[str] = Field(default_factory=list)


class StatementPart(Strict):
    id: Literal["cause", "course", "rumour"]
    title: Words
    options: list[StatementOption] = Field(min_length=2)


class StatementOpens(Strict):
    day: int = Field(ge=1)
    hour: int = Field(ge=DAY_START // 60, le=DAY_END // 60 + 3)


class Statement(Strict):
    """The statement card (``world/bridge/statement.py``): three parts, each a closed list of
    options, and when the full statement may first be made."""

    opens: StatementOpens
    parts: list[StatementPart] = Field(min_length=3, max_length=3)


class Gift(Strict):
    """A small thing the market gives away each day, which the manager can give a person. ``gain``
    is the trust a person who likes it takes in (one who is neither way takes in half, one who
    dislikes it none, see ``world/bridge/gifts.py``)."""

    id: str
    zh: str
    en: str
    gain: int = Field(ge=1, le=30)


class Script(Strict):
    id: str
    label: str
    days: int = Field(ge=1)
    truth_fixed_at: int = Field(ge=0)  # the minute at which the variant is drawn
    summary: str
    cast: list[str]
    variants: list[Variant] = Field(min_length=2)
    shared: list[str] = Field(default_factory=list)
    props: list[PropIn]
    exclusive: list[Exclusive] = Field(default_factory=list)
    observations: list[Observation] = Field(default_factory=list)
    chains: list[Chain] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)
    evidence: list[Evidence]
    evidence_sets: list[EvidenceSet]
    lies: list[LieHolder] = Field(default_factory=list)
    speculation: list[SpecRule] = Field(default_factory=list)
    flags: list[Flag] = Field(default_factory=list)
    metrics: list[Metric] = Field(default_factory=list)
    goals: list[Goal] = Field(default_factory=list)
    endings: Endings | None = None
    hard_conditions: list[HardCondition] = Field(default_factory=list)
    tasks: list[Task] = Field(default_factory=list)
    wants: list[Want] = Field(default_factory=list)
    act_minutes: ActMinutes = Field(default_factory=ActMinutes)
    commitments: CommitmentRules | None = None
    tutorial_relations: list[TutorialRelation] = Field(default_factory=list)
    hubs: list[str] = Field(default_factory=list)  # whom a person who knows nothing points to
    statement: Statement | None = None  # the statement card
    paper: PaperRules | None = None  # the morning gazette and the night summary
    gifts: list[Gift] = Field(default_factory=list)  # the small things of the day
    # the days between which every story can first be told apart, as the evidence opens (`since`
    # of the items): [earliest, latest]. A script that says nothing is not held to it. It is a
    # check of the build and is not compiled.
    tell_days: list[int] | None = Field(default=None, exclude=True)

    @field_validator("tasks", mode="before")
    @classmethod
    def promises_made_into_tasks(cls, value: Any) -> Any:
        return expand_pledge_tasks(value)

    @model_serializer(mode="wrap")
    def leave_out_what_is_not_said(self, handler: Any) -> dict[str, Any]:
        data: dict[str, Any] = handler(self)
        for key in ("statement", "paper"):  # the other scripts compile as they did
            if data.get(key) is None:
                data.pop(key, None)
        if not data.get("gifts"):
            data.pop("gifts", None)
        return data


# Condition kinds of a hard condition: kind -> {argument: entity type or "int" or "props"}. This is
# the closed vocabulary that persuasion hard conditions are written in.
CONDITION_KINDS: dict[str, dict[str, str]] = {
    "refuted_publicly": {"props": "props"},
    "honor_given": {"to": "family|person", "thing": "thing"},
    "trust_min": {"holder": "person", "min": "int"},
    "persuaded": {"who": "person"},
    "asked_by": {"who": "person", "of": "person"},
    "believes": {"holder": "person", "props": "props", "min": "int"},
    "unspoken": {},
    # the holder holds one of the claims with at least this confidence: a claim made in public, such
    # as the clarification (``clarify``), which is no rumour to refute, so it takes any prop
    "knows": {"holder": "person", "props": "claims", "min": "int"},
}

# The terms that the conditions of a task, and of a want, are written in: term -> {argument: kind of
# value}, with a question mark after the name of an argument that may be left out. It is the
# vocabulary of ``world/bridge/agenda_terms.py``, which a test holds equal to this one. The terms in
# ``TASK_TERMS_LATER`` are those of subsystems that have not said what they read: content may use
# them, and they hold nothing until the subsystem that owns them says. Every subsystem has said so
# (the judgments by ``judge``, the commitments by ``commitments``, the clarification by
# ``clarify``), so none is left.
TASK_TERMS: dict[str, dict[str, str]] = {
    "note": {"props": "known_props"},
    "note_first_hand": {"props": "known_props", "by": "person"},
    "event": {"event": "event", "where?": "where"},
    "refused": {"npc": "person", "reason?": "word"},
    "window": {"day": "day", "from": "hour", "to": "hour"},
    "after": {"day": "day", "hour": "hour"},
    "at_place": {"place": "place"},
    "flag": {"flag": "flag"},
    "judged": {"relation?": "relation"},
    "clarified": {"props?": "known_props"},
    "commitment": {"by": "person", "item": "item", "state": "commitment_state", "latest?": "yes"},
    "turned_down": {"npc": "person", "request?": "request"},
    "can_promise": {"npc": "person"},
    "helper_waits": {},
    "crew": {},
    "helpers": {"at_least": "count", "family?": "family"},
    "work": {"percent": "percent"},
    "work_short": {},
    "weather": {"is": "sky"},
    "hours": {"from": "hour", "to": "hour"},
    "passed_on": {"npc": "person", "props": "known_props"},
    "talked_today": {"npc": "person"},
    "fresh_proof": {"venue": "place"},
    "looked": {"items": "evidence_items"},
    "evidence": {"items": "evidence_items"},
    "told": {"missed?": "missed"},
    "meeting": {},
    "grudge": {"below": "percent"},
    # the statement card
    "card_filled": {},
    "card_fillable": {},
    "stated_today": {},
    # the manager's promises
    "pledge": {"n": "slot", "state?": "pledge_state", "due?": "pledge_due"},
    # the peace by deeds (``world/bridge/peace.py``)
    "eased": {"act": "deed"},
    "called": {},
}
TASK_TERMS_LATER: dict[str, str] = {}
# The terms that the conditions of the lists of the people who carry the days are written in
# (``content/lines``, ``world/bridge/roles.py``): the terms of the tasks that speak of the town in
# public, and a few of the person's own. A test holds the names equal to the core's.
ROLE_VOCABULARY: dict[str, dict[str, str]] = {
    **{name: TASK_TERMS[name] for name in voice_content.ROLE_AGENDA_TERMS},
    **voice_content.ROLE_TERMS,
}
SKIES = ("clear", "light_rain", "heavy_rain")
REQUESTS = ("material", "lane", "testify", "look", "convene")  # what a task can find turned down
DEEDS = ("stop_blaming", "work_together", "witnessed_meal")  # the deeds of ``peace.ACTS``
# The names the words of a task may write in braces (``world/bridge/agenda_facts.py`` fills them).
AGENDA_FACTS = (
    "bamboo_site", "bamboo_need", "bamboo_lack", "bamboo_open", "bamboo_next",
    "timber_site", "timber_need", "timber_lack", "timber_open", "timber_next",
    "helpers", "crew", "li_helpers", "zhou_helpers", "needy", "hours", "hours_need", "work_from",
    "work_to", "deadline", "helper", "hours_left", "morning", "work_mornings",
    *(f"pledge{n}_{part}" for n in range(1, PLEDGE_CARDS + 1) for part in ("to", "what", "due")),
    "grudge",
)  # fmt: skip
RELATIONS = ("unsupported", "contradicts", "mismatch")
# What the last statement in public may have fallen short of (``assembly.MISSED``).
MISSED_CODES = ("parts", "proof", "named", "accepted", "elder_absent", "elder_refused")
COMMITMENT_STATES = ("promised", "delivered", "broken", "withdrawn")
# The kinds of event the core emits, and those it will emit once the terms read later are read.
EVENT_KINDS = (
    "action_ack", "agreed", "answered", "arrived", "asked", "budget_stage", "clarified",
    "commitment", "conflict", "convened", "dawn", "declined", "delivered", "downgrade", "dusk",
    "eased", "ending", "entrust_done", "entrust_withdrawn", "entrusted", "feast", "flag", "goal",
    "heard",
    "inspected", "joined", "judged", "lie_caught", "look_refused", "look_start",
    "objection_withdrawn", "pledge_broken", "pledge_empty", "pledge_kept", "pledged", "promised",
    "rally", "recap", "refused", "spoke", "stated", "street", "talk_end", "talk_start",
    "task_changed", "task_done", "task_fail", "task_start", "taken", "testified", "told", "void",
    "weather",
)  # fmt: skip
EVENT_PEOPLE = ("npc", "by", "speaker", "listener")  # the fields of an event that name a person
# The placeholders each template of ``commitments`` may use (``world/bridge/commitments.py`` fills
# them in both languages).
COMMITMENT_WORDS: dict[str, set[str]] = {
    "what": {"amount", "item", "place"},
    "recap.delivery": {"who", "amount", "item", "place"},
    "recap.withdrawn": {"who", "what"},
    "recap.withdrawn_plain": {"who"},
    "recap.clarified": {"names", "manager"},
    "recap.promise": {"who", "amount", "item"},
}
# The placeholders each template of ``paper`` may use (``world/bridge/gazette.py`` fills them in
# both languages). Every line of ``talk`` takes none.
PAPER_WORDS: dict[str, set[str]] = {
    "news.statement": {"place", "named", "accepted", "manager"},
    "news.statement_refused": {"place", "named", "manager"},
    "news.evidence": {"place", "named", "accepted", "manager"},
    "news.evidence_refused": {"place", "named", "manager"},
    "news.stopped": {"who", "other"},
    "news.helpers": {"n"},
    "news.work_stopped": {"why"},
    "news.work": {"hours", "left", "progress"},
    "news.rain_heavy": {"when"},
    "news.rain_light": {"when"},
    "news.quiet": {"when"},
    "news.two_accounts": {"first", "second"},
}
# The words of the game never say a person is he or she: the cast does not fix their sex.
PRONOUNS = {"zh": re.compile("[他她]"), "en": re.compile(r"\b(?:he|she|his|her|hers|him)\b", re.I)}
FRONTIER = "$frontier"
HELPER = "$helper"
PLEDGE = "$pledge"  # a promise of the manager: the person it was made to (a task of a promise)
TOPIC_KINDS = ("person", "thing", "place")  # what a question of the manager can be about
NEEDS_NPC = ("talk", "ask", "ask_source", "tell", "entrust", "promise")
SLOT_NAME = re.compile(r"\{(\w+)\}")
PLEDGE_NAME = re.compile(r"pledge(\d+)_\w+")  # the words of the N-th promise, in a task about it
# What an action of a task may name besides the person, the place and the item (the core's
# ``entrust.KINDS`` and ``assembly.KINDS``, which a test holds equal to these).
REQUEST_KINDS = ("material", "lane", "testify", "lend", "join", "persuade", "convene")
SPEAK_KINDS = ("evidence", "meal", "clarify", "statement")
STATEMENT_PARTS = ("cause", "course", "rumour")  # the parts of the statement card, in order
PROMISE_KINDS = ("keep",)  # the kinds of a promise: keeping one that was made
PLEDGE_STATES = ("open", "kept", "broken")
PLEDGE_DUE = ("today", "ahead")
ACTION_EXTRAS = ("request", "kind", "target")  # the fields of an action that are left out if unset


def number_a_promise(value: Any, number: int) -> Any:
    """A part of the template of a task of the promises, for the ``number``-th promise: ``$n``
    becomes the number, ``$pledge`` the person of that promise (``$pledge3``), and a ``{pledge_to}``
    in words ``{pledge3_to}``."""
    if isinstance(value, str):
        if value == "$n":
            return number
        if value == PLEDGE:
            return f"{PLEDGE}{number}"
        return re.sub(r"\{pledge_(\w+)\}", lambda found: f"{{pledge{number}_{found[1]}}}", value)
    if isinstance(value, list):
        return [number_a_promise(item, number) for item in value]
    if isinstance(value, dict):
        return {key: number_a_promise(item, number) for key, item in value.items()}
    return value


def expand_pledge_tasks(tasks: Any) -> Any:
    """The tasks as the script writes them, each template of a promise (``per: pledge``) made into
    one task for each of the first PLEDGE_CARDS promises: ``t_keep`` into ``t_keep_1`` to
    ``t_keep_20``, in its place in the list, each with the number of its promise as ``pledge`` and
    the priority of the template for the first, one less urgent for each of the next."""
    if not isinstance(tasks, list):
        return tasks
    out: list[Any] = []
    for task in tasks:
        if not (isinstance(task, dict) and task.get("per") == "pledge"):
            out.append(task)
            continue
        for number in range(1, PLEDGE_CARDS + 1):
            made = number_a_promise({k: v for k, v in task.items() if k != "per"}, number)
            made["id"] = f"{task['id']}_{number}"
            made["pledge"] = number
            made["priority"] = task["priority"] + number - 1  # no two tasks as urgent as each other
            out.append(made)
    return out


# --------------------------------------------------------------------------------------
# Loading
# --------------------------------------------------------------------------------------


@dataclass
class Sources:
    """The raw YAML documents, before any model sees them."""

    predicates: dict[str, Any]
    motives: dict[str, Any]
    entities: dict[str, Any]
    scripts: dict[str, dict[str, Any]]
    maps: dict[str, dict[str, Any]] = field(default_factory=dict)
    casts: dict[str, dict[str, Any]] = field(default_factory=dict)
    sentences: dict[str, Any] = field(default_factory=dict)
    speech: dict[str, Any] = field(default_factory=dict)  # content/tables/speech.yaml
    voices: dict[str, Any] = field(default_factory=dict)  # content/lines/<person>.yaml by person
    phrases: dict[str, Any] = field(default_factory=dict)  # the fixed lines of the core, by code
    prompts: dict[str, Any] = field(default_factory=dict)  # content/prompts/reply.yaml


def load_sources(root: Path = ROOT) -> Sources:
    content = root / "content"

    def read(path: Path) -> Any:
        with path.open(encoding="utf-8") as fh:
            return yaml.safe_load(fh)

    scripts = {p.stem: read(p) for p in sorted((content / "scripts").glob("*.yaml"))}
    maps = {p.stem: read(p) for p in sorted((content / "maps").glob("*.yaml"))}
    casts = {p.stem: read(p) for p in sorted((content / "cast").glob("*.yaml"))}
    lines = content / "tables" / "sentences.yaml"
    speech = content / "tables" / "speech.yaml"
    voices = {p.stem: read(p) for p in sorted((content / "lines").glob("*.yaml"))}
    prompts = content / "prompts" / "reply.yaml"
    return Sources(
        predicates=read(content / "tables" / "predicates.yaml"),
        motives=read(content / "tables" / "motives.yaml"),
        entities=read(content / "entities.yaml"),
        scripts=scripts,
        maps=maps,
        casts=casts,
        sentences=read(lines) if lines.exists() else {},
        speech=read(speech) if speech.exists() else {},
        voices=voices,
        phrases=voice_content.load_phrases(root),
        prompts=read(prompts) if prompts.exists() else {},
    )


def model_errors(where: str, exc: ValidationError) -> list[str]:
    out = []
    for err in exc.errors():
        loc = ".".join(str(part) for part in err["loc"])
        out.append(f"{where}: {loc}: {err['msg']}")
    return out


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    outputs: dict[str, bytes] = field(default_factory=dict)  # path relative to content/compiled
    generated: dict[str, bytes] = field(default_factory=dict)  # path relative to the repository
    coverage: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------------------
# Tables and entities
# --------------------------------------------------------------------------------------

ID_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789_")


def bad_id(text: str) -> bool:
    return not text or text[0].isdigit() or any(ch not in ID_CHARS for ch in text)


@dataclass
class Tables:
    preds: dict[str, Predicate]
    motives: dict[str, Motive]


@dataclass
class Entities:
    kind: dict[str, str]  # id -> type
    family: dict[str, str | None]  # person id -> family id
    label: dict[str, str]
    label_en: dict[str, str]
    compiled: list[dict[str, Any]]
    bio: dict[str, dict[str, str]] = field(default_factory=dict)  # person id -> {zh, en}


def check_tables(src: Sources, rep: Report) -> Tables | None:
    start = len(rep.errors)
    try:
        pf = PredicateFile.model_validate(src.predicates)
    except ValidationError as exc:
        rep.errors += model_errors("predicates.yaml", exc)
        return None
    try:
        mf = MotiveFile.model_validate(src.motives)
    except ValidationError as exc:
        rep.errors += model_errors("motives.yaml", exc)
        return None
    preds: dict[str, Predicate] = {}
    for p in pf.predicates:
        if bad_id(p.id):
            rep.errors.append(f"predicates.yaml: '{p.id}' is not a lower-case snake_case id")
        if p.id in preds:
            rep.errors.append(f"predicates.yaml: duplicate predicate '{p.id}'")
        preds[p.id] = p
        names = [sl.name for sl in p.slots]
        if len(set(names)) != len(names):
            rep.errors.append(f"predicates.yaml: predicate '{p.id}' repeats a slot name")
        if not any(sl.required for sl in p.slots):
            rep.errors.append(f"predicates.yaml: predicate '{p.id}' has no required slot")
        for sl in p.slots:
            if not sl.types or len(set(sl.types)) != len(sl.types):
                rep.errors.append(
                    f"predicates.yaml: slot '{p.id}.{sl.name}' needs one or more different types"
                )
    at = preds.get("at")
    if at is None:
        rep.errors.append("predicates.yaml: the table must define 'at' (person, place)")
    elif [(s.name, s.types, s.required) for s in at.slots[:2]] != [
        ("who", ["person"], True),
        ("where", ["place"], True),
    ]:
        rep.errors.append(
            "predicates.yaml: 'at' must start with required slots who:person, where:place"
        )
    motives: dict[str, Motive] = {}
    for m in mf.motives:
        if bad_id(m.id):
            rep.errors.append(f"motives.yaml: '{m.id}' is not a lower-case snake_case id")
        if m.id in motives:
            rep.errors.append(f"motives.yaml: duplicate motive '{m.id}'")
        motives[m.id] = m
    for needed in REQUIRED_MOTIVES:
        if needed not in motives:
            rep.errors.append(f"motives.yaml: the operators need the motive '{needed}'")
    if len(rep.errors) > start:
        return None
    tables = Tables(preds, motives)
    try:
        # the core reads the compiled table, and it refuses a level_to or heavier that dangles
        CoreTables.from_canon(compile_tables(tables))
    except ShapeError as exc:
        rep.errors.append(f"predicates.yaml: {exc}")
        return None
    return tables


def bio_problems(at: str, bio: Bio) -> list[str]:
    """What is wrong with the bio of a person: both languages are text of their own language, on one
    line, short, and written without a semicolon or a dash (``；``, ``;`` and ``——`` in the Chinese,
    as in the lines the townsfolk say)."""
    out = sentence_content._language_problems(at, bio)
    for lang in ("zh", "en"):
        text = getattr(bio, lang)
        if text != text.strip() or "\n" in text:
            out.append(f"{at} ({lang}): one line, without blank space at the ends")
        if len(text) > BIO_LIMIT[lang]:
            out.append(f"{at} ({lang}): {len(text)} characters, at most {BIO_LIMIT[lang]}")
        out += [
            f"{at} ({lang}): {banned.strip()!r} is not allowed, write another sentence"
            for banned in voice_content.BANNED
            if banned in text
        ]
    return out


def check_entities(src: Sources, rep: Report) -> Entities | None:
    start = len(rep.errors)
    try:
        ef = EntityFile.model_validate(src.entities)
    except ValidationError as exc:
        rep.errors += model_errors("entities.yaml", exc)
        return None
    kind: dict[str, str] = {}
    label: dict[str, str] = {}
    label_en: dict[str, str] = {}
    family: dict[str, str | None] = {}
    bio: dict[str, dict[str, str]] = {}
    compiled: list[dict[str, Any]] = []

    def add(item: Named, typ: str) -> None:
        if bad_id(item.id):
            rep.errors.append(f"entities.yaml: '{item.id}' is not a lower-case snake_case id")
        if item.id in kind:
            rep.errors.append(f"entities.yaml: duplicate entity id '{item.id}'")
        if not item.label.strip():
            rep.errors.append(f"entities.yaml: entity '{item.id}' has an empty label")
        if item.label_en is None or not item.label_en.strip():
            rep.errors.append(f"entities.yaml: entity '{item.id}' has no English label (label_en)")
        kind[item.id] = typ
        label[item.id] = item.label
        label_en[item.id] = item.label_en or ""
        entry: dict[str, Any] = {
            "id": item.id,
            "type": typ,
            "label": item.label,
            "label_en": item.label_en,
        }
        if isinstance(item, Person):
            entry["family"] = item.family
            family[item.id] = item.family
            if item.bio is not None:
                rep.errors += bio_problems(f"entities.yaml: {item.id} bio", item.bio)
                bio[item.id] = {"zh": item.bio.zh, "en": item.bio.en}
        compiled.append(entry)  # the bio is not part of an entity: it goes to the cast

    for f in ef.families:
        add(f, "family")
    for p in ef.people:
        add(p, "person")
    for t in ef.things:
        add(t, "thing")
    for pl in ef.places:
        add(pl, "place")
    for p in ef.people:
        if p.family is not None and kind.get(p.family) != "family":
            rep.errors.append(f"entities.yaml: person '{p.id}' has unknown family '{p.family}'")
    if len(rep.errors) > start:
        return None
    return Entities(kind, family, label, label_en, compiled, bio)


# --------------------------------------------------------------------------------------
# One script
# --------------------------------------------------------------------------------------

COMPARE_OPS = (">=", ">", "<=", "<", "==")
MAX_ENDING_INPUTS = 10


@dataclass
class Binding:
    """One way the premises of a rule are met: the entity each variable stands for."""

    env: dict[str, str]


def twin_key(p: PropIn) -> tuple[Any, ...]:
    return (p.pred, tuple(sorted(p.args.items())), tuple(p.span) if p.span else None)


def is_var(text: str) -> bool:
    return text.startswith("$")


class ScriptChecker:
    """Validate one script against the tables and entities and collect what the report needs."""

    def __init__(
        self,
        name: str,
        script: Script,
        tables: Tables,
        ents: Entities,
        rep: Report,
        phrases: dict[str, Any] | None = None,
        items: set[str] | None = None,
        voices: dict[str, Any] | None = None,
    ):
        self.name = name
        self.s = script
        self.t = tables
        self.e = ents
        self.rep = rep
        self.phrases = phrases or {}
        self.items = items or set()  # the items of the cast that goes with the script
        self.voices = voices or {}  # content/lines by person, for the script that the cast names
        self.refs: dict[str, str] = {}
        self.props: dict[str, PropIn] = {}
        self.positive: dict[tuple[Any, ...], PropIn] = {}
        self.truth: dict[str, set[str]] = {}
        self.real_in: dict[str, set[str]] = {}
        self.rules: dict[str, SpecRule] = {}
        self.via_of: dict[str, str] = {}
        self.valid_sets: dict[str, list[EvidenceSet]] = {}
        self.routes: dict[str, int] = {}
        self.min_minutes: dict[str, int] = {}
        self.first_day: dict[str, int] = {}
        self.binding_counts: dict[str, int] = {}
        self.rules_ok = False
        self.core: tuple[CoreRegistry, CoreBook, dict[str, CoreRule]] | None | bool = None
        self.horizon = script.days * DAY

    # -- plumbing ----------------------------------------------------------------------

    def err(self, msg: str) -> None:
        self.rep.errors.append(f"{self.name}: {msg}")

    def warn(self, msg: str) -> None:
        self.rep.warnings.append(f"{self.name}: {msg}")

    def use(self, ent: str, where: str) -> bool:
        """Record that ``ent`` is used, and say whether it exists."""
        if ent not in self.e.kind:
            self.err(f"{where}: unknown entity '{ent}'")
            return False
        self.refs.setdefault(ent, where)
        return True

    def use_typed(self, ent: str, want: str | list[str], where: str) -> bool:
        wants = [want] if isinstance(want, str) else want
        if not self.use(ent, where):
            return False
        if self.e.kind[ent] not in wants:
            self.err(f"{where}: '{ent}' is a {self.e.kind[ent]}, expected a {' or '.join(wants)}")
            return False
        return True

    def prop_ok(self, pid: str, where: str) -> bool:
        if pid not in self.props:
            self.err(f"{where}: unknown prop '{pid}'")
            return False
        return True

    def run(self) -> None:
        phases = [
            self.check_cast,
            self.check_props,
            self.check_variants,
            self.compute_truth,
            self.check_exclusive,
            self.check_rules,
            self.check_chains,
            self.check_ops,
            self.check_observations,
            self.check_evidence,
            self.check_sets,
            self.check_lies,
            self.check_openings,
            self.check_state,
            self.check_tasks,
            self.check_statement,
            self.check_wants,
            self.check_roles,
            self.check_commitments,
            self.check_paper,
            self.check_gifts,
            self.check_information,
            self.check_cast_covers_refs,
        ]
        for phase in phases:
            before = len(self.rep.errors)
            phase()
            # later phases rely on the earlier ones, so stop at the first phase that failed
            if len(self.rep.errors) > before and phase in (
                self.check_cast,
                self.check_props,
                self.check_variants,
                self.compute_truth,
            ):
                return

    # -- cast, props, variants -------------------------------------------------------------

    def check_cast(self) -> None:
        if self.s.truth_fixed_at > self.horizon:
            self.err(f"truth_fixed_at {self.s.truth_fixed_at} is after the end of the game")
        seen: set[str] = set()
        for ent in self.s.cast:
            if ent in seen:
                self.err(f"cast lists '{ent}' twice")
            seen.add(ent)
            if ent not in self.e.kind:
                self.err(f"cast: unknown entity '{ent}'")
            elif self.e.kind[ent] == "person":
                fam = self.e.family.get(ent)
                if fam is not None and fam not in self.s.cast:
                    self.err(f"cast: '{ent}' belongs to '{fam}', which must be in the cast too")

    def check_props(self) -> None:
        for p in self.s.props:
            where = f"prop {p.id}"
            if bad_id(p.id):
                self.err(f"{where}: not a lower-case snake_case id")
            if p.id in self.props:
                self.err(f"{where}: duplicate prop id")
                continue
            self.props[p.id] = p
            pred = self.t.preds.get(p.pred)
            if pred is None:
                known = ", ".join(sorted(self.t.preds))
                self.err(f"{where}: unknown predicate '{p.pred}' (the table has: {known})")
                continue
            slots = {sl.name: sl for sl in pred.slots}
            for key, ent in p.args.items():
                slot = slots.get(key)
                if slot is None:
                    self.err(
                        f"{where}: predicate '{p.pred}' has no slot '{key}' "
                        f"(slots: {', '.join(slots)})"
                    )
                    continue
                if self.use(ent, f"{where} slot {key}") and self.e.kind[ent] not in slot.types:
                    self.err(
                        f"{where}: slot '{key}' of '{p.pred}' expects a "
                        f"{' or '.join(slot.types)}, got '{ent}' which is a {self.e.kind[ent]}"
                    )
            for sl in pred.slots:
                if sl.required and sl.name not in p.args:
                    self.err(f"{where}: predicate '{p.pred}' needs slot '{sl.name}'")
            if p.span is not None:
                if len(p.span) != 2 or p.span[0] > p.span[1]:
                    self.err(f"{where}: span must be [start, end] with start <= end, got {p.span}")
                elif p.span[0] < MIN_SPAN_START or p.span[1] > self.horizon:
                    self.err(
                        f"{where}: span {p.span} leaves the game "
                        f"[{MIN_SPAN_START}, {self.horizon}] minutes"
                    )
            if p.motive is not None and p.motive not in self.t.motives:
                known = ", ".join(sorted(self.t.motives))
                self.err(f"{where}: unknown motive '{p.motive}' (the table has: {known})")
            if (p.parent is None) != (p.op is None):
                self.err(
                    f"{where}: a mutated prop needs both parent and op, and a base prop neither"
                )
            if not p.neg and not bad_id(p.id):
                self.positive.setdefault(twin_key(p), p)
        for p in self.props.values():
            if p.parent is not None:
                if p.parent not in self.props:
                    self.err(f"prop {p.id}: parent '{p.parent}' does not exist")
                    continue
                seen, cur = {p.id}, p.parent
                while cur is not None:
                    if cur in seen:
                        self.err(f"prop {p.id}: parent chain loops through '{cur}'")
                        break
                    seen.add(cur)
                    cur = self.props[cur].parent if cur in self.props else None

    def twin_of(self, p: PropIn) -> PropIn | None:
        return self.positive.get(twin_key(p)) if p.neg else None

    def check_variants(self) -> None:
        ids: set[str] = set()
        for v in self.s.variants:
            if bad_id(v.id):
                self.err(f"variant {v.id}: not a lower-case snake_case id")
            if v.id in ids:
                self.err(f"duplicate variant '{v.id}'")
            ids.add(v.id)
        lists = [("shared", self.s.shared)] + [
            (f"variant {v.id}", v.holds) for v in self.s.variants
        ]
        for where, items in lists:
            if len(set(items)) != len(items):
                self.err(f"{where}: lists a prop twice")
            for pid in items:
                if not self.prop_ok(pid, where):
                    continue
                if self.twin_of(self.props[pid]) is not None:
                    self.err(
                        f"{where}: '{pid}' is the negation of a stated prop, so its truth is "
                        "derived; remove it from the list"
                    )
        for v in self.s.variants:
            both = set(v.holds) & set(self.s.shared)
            if both:
                self.err(f"variant {v.id}: {sorted(both)} are already in shared")

    def compute_truth(self) -> None:
        for v in self.s.variants:
            base = set(self.s.shared) | set(v.holds)
            # a level step only forgets, so the child is true wherever its parent is
            changed = True
            while changed:
                changed = False
                for p in self.props.values():
                    if p.op == "level" and p.parent in base and p.id not in base and not p.neg:
                        base.add(p.id)
                        changed = True
            derived = set()
            for p in self.props.values():
                twin = self.twin_of(p)
                if twin is not None and twin.id not in base:
                    derived.add(p.id)
            self.truth[v.id] = base | derived
        names = [v.id for v in self.s.variants]
        for a, b in itertools.combinations(names, 2):
            if self.truth[a] == self.truth[b]:
                self.err(f"variants {a} and {b} have the same truth, nothing can tell them apart")

    def true_in_all(self, pid: str) -> bool:
        return all(pid in t for t in self.truth.values())

    def false_in_all(self, pid: str) -> bool:
        return all(pid not in t for t in self.truth.values())

    def check_exclusive(self) -> None:
        seen: set[str] = set()
        for g in self.s.exclusive:
            where = f"exclusive group {g.id}"
            if g.id in seen:
                self.err(f"{where}: duplicate group id")
            seen.add(g.id)
            if len(g.props) < 2 or len(set(g.props)) != len(g.props):
                self.err(f"{where}: needs at least two different props")
            if not all(self.prop_ok(pid, where) for pid in g.props):
                continue
            for v in self.s.variants:
                holding = [pid for pid in g.props if pid in self.truth[v.id]]
                if len(holding) > 1:
                    self.err(f"{where}: variant {v.id} makes {holding} true together")

    # -- speculation rules ---------------------------------------------------------------

    def check_pattern(
        self, pat: Pattern, vars_: dict[str, str], where: str, *, full: bool
    ) -> set[str]:
        """Check one premise or conclusion pattern and return the variables it uses."""
        used: set[str] = set()
        pred = self.t.preds.get(pat.pred)
        if pred is None:
            self.err(f"{where}: unknown predicate '{pat.pred}'")
            return used
        slots = {sl.name: sl for sl in pred.slots}
        for key, val in pat.args.items():
            slot = slots.get(key)
            if slot is None:
                self.err(f"{where}: predicate '{pat.pred}' has no slot '{key}'")
                continue
            if is_var(val):
                name = val[1:]
                if name not in vars_:
                    self.err(f"{where}: variable {val} is not declared in vars")
                elif vars_[name] not in slot.types:
                    self.err(
                        f"{where}: variable {val} is a {vars_[name]} but slot '{key}' "
                        f"of '{pat.pred}' wants a {' or '.join(slot.types)}"
                    )
                else:
                    used.add(name)
            else:
                self.use_typed(val, slot.types, f"{where} slot {key}")
        if full:
            for sl in pred.slots:
                if sl.required and sl.name not in pat.args:
                    self.err(f"{where}: predicate '{pat.pred}' needs slot '{sl.name}'")
        return used

    def check_rules(self) -> None:
        start = len(self.rep.errors)
        for rule in self.s.speculation:
            where = f"speculation rule {rule.id}"
            if rule.id in self.rules:
                self.err(f"{where}: duplicate rule id")
                continue
            self.rules[rule.id] = rule
            premise_vars: set[str] = set()
            for i, pat in enumerate(rule.premises):
                premise_vars |= self.check_pattern(
                    pat, rule.vars, f"{where} premise {i + 1}", full=False
                )
            concl_vars = self.check_pattern(
                rule.conclusion, rule.vars, f"{where} conclusion", full=True
            )
            for name in sorted(concl_vars - premise_vars):
                self.err(f"{where}: conclusion uses ${name}, which no premise binds")
            for name in sorted(set(rule.vars) - premise_vars):
                self.err(f"{where}: variable ${name} is declared but no premise uses it")
            if rule.relation is not None:
                target = rule.relation.target
                if not is_var(target) or rule.vars.get(target[1:]) != "person":
                    self.err(f"{where}: relation target must be a person variable, got '{target}'")
            if any(not h.strip() for h in rule.hedge):
                self.err(f"{where}: empty hedge word")
        self.rules_ok = len(self.rep.errors) == start and len(self.rules) == len(self.s.speculation)
        if not self.rules_ok:
            return  # the closure check needs rules that are well formed
        for rule in self.s.speculation:
            self.check_rule_closure(rule)

    def core_view(self) -> tuple[CoreRegistry, CoreBook, dict[str, CoreRule]] | None:
        """The entities, the props and the speculation rules as the core reads them.

        The core decides whether a rule fits a prop and whether a mutation is a legal step, so
        the content is held to the rules the game will use. It is built once, after the props
        and the rules have passed their own checks, and ``None`` if the core refuses any of it
        (which is then reported).
        """
        if self.core is not None:
            return self.core or None
        self.core = False
        try:
            registry = CoreRegistry.from_canon(self.e.compiled)
            book = CoreBook(CoreProp.from_canon(compile_prop(p)) for p in self.props.values())
            rules = {}
            for rule in self.rules.values() if self.rules_ok else ():
                rules[rule.id] = CoreRule.from_canon(dump(rule))
        except (ShapeError, ValueError) as exc:
            self.err(f"the core refuses the content: {exc}")
            return None
        self.core = (registry, book, rules)
        return self.core

    def bindings(self, rule: SpecRule) -> list[Binding]:
        view = self.core_view()
        core_rule = None if view is None else view[2].get(rule.id)
        if view is None or core_rule is None:
            return []
        registry, book, _ = view
        props = [book[p.id] for p in self.props.values() if not p.neg]
        out: list[Binding] = []

        def rec(i: int, env: dict[str, str]) -> None:
            if i == len(core_rule.premises):
                out.append(Binding(dict(env)))
                return
            for prop in props:
                nxt = core_rule.bind(i, prop, env, registry)
                if nxt is not None:
                    rec(i + 1, nxt)

        rec(0, {})
        if rule.relation is not None:
            who = rule.relation.target[1:]
            out = [b for b in out if self.e.family.get(b.env[who]) is not None]
        return out

    def conclusion_args(self, rule: SpecRule, b: Binding) -> dict[str, str]:
        return {k: (b.env[v[1:]] if is_var(v) else v) for k, v in rule.conclusion.args.items()}

    def lands_on_a_prop(self, rule: SpecRule, b: Binding) -> bool:
        """Whether some authored, non-negated prop is what the rule concludes under ``b``."""
        view = self.core_view()
        core_rule = None if view is None else view[2].get(rule.id)
        if view is None or core_rule is None:
            return True  # the core's refusal is reported already
        registry, book, _ = view
        return any(
            core_rule.concludes(book[p.id], b.env, registry)
            for p in self.props.values()
            if not p.neg
        )

    def check_rule_closure(self, rule: SpecRule) -> None:
        found = self.bindings(rule)
        self.binding_counts[rule.id] = len(found)
        if not found:
            self.err(f"speculation rule {rule.id}: no prop of the script satisfies the premises")
            return
        for b in found:
            if not self.lands_on_a_prop(rule, b):
                args = self.conclusion_args(rule, b)
                self.err(
                    f"speculation rule {rule.id}: with {b.env} it concludes "
                    f"{rule.conclusion.pred}({args}), which no prop of the script states"
                )

    # -- chains and operators ------------------------------------------------------------

    def check_chains(self) -> None:
        seen: set[str] = set()
        for ch in self.s.chains:
            where = f"chain {ch.id}"
            if ch.id in seen:
                self.err(f"{where}: duplicate chain id")
            seen.add(ch.id)
            prev: str | None = None
            for i, hop in enumerate(ch.hops):
                hw = f"{where} hop {i + 1}"
                if not self.prop_ok(hop.prop, hw):
                    prev = None
                    continue
                prop = self.props[hop.prop]
                if i == 0:
                    if hop.speaker or hop.listener or hop.via:
                        self.err(f"{hw}: the root of a chain has no speaker, listener or rule")
                else:
                    if hop.speaker is None or hop.listener is None:
                        self.err(f"{hw}: a hop needs a speaker and a listener")
                    for role, ent in (("speaker", hop.speaker), ("listener", hop.listener)):
                        if ent is not None:
                            self.use_typed(ent, "person", f"{hw} {role}")
                    if prop.parent != prev:
                        self.err(
                            f"{hw}: prop '{prop.id}' has parent '{prop.parent}', "
                            f"the chain expects '{prev}'"
                        )
                    if hop.via is not None:
                        if hop.via not in self.rules:
                            self.err(f"{hw}: unknown speculation rule '{hop.via}'")
                        elif prop.op != "assimilate":
                            self.err(
                                f"{hw}: only an assimilate step can name a rule, "
                                f"this one is {prop.op}"
                            )
                        else:
                            self.via_of[prop.id] = hop.via
                prev = hop.prop

    def check_ops(self) -> None:
        """Every mutated prop must be what its operator makes of its parent, as the core judges.

        A step that changes the predicate by ``assimilate`` is judged with the rule that a chain
        hop names for it (``via``).
        """
        view = self.core_view()
        if view is None:
            return
        registry, book, rules = view
        tables = CoreTables.from_canon(compile_tables(self.t))
        for p in self.props.values():
            if p.parent is None or p.op is None:
                continue
            rule = rules.get(self.via_of.get(p.id, ""))
            why = mutation_problem(
                book[p.parent], book[p.id], p.op, tables, registry, rule, book=book
            )
            if why is None:
                why = self.family_swap_problem(self.props[p.parent], p)
            if why is not None:
                self.err(f"prop {p.id}: {p.op} step from '{p.parent}' is illegal: {why}")

    def family_swap_problem(self, parent: PropIn, child: PropIn) -> str | None:
        """Content lint, stricter than the core: a person swapped for a family needs their own."""
        if child.op != "assimilate" or child.pred != parent.pred:
            return None
        for key, ent in child.args.items():
            old = parent.args.get(key)
            if old is None or old == ent:
                continue
            swapped_for_a_family = (
                self.e.kind.get(old) == "person" and self.e.kind.get(ent) == "family"
            )
            if swapped_for_a_family and self.e.family.get(old) != ent:
                return f"'{ent}' is not the family of '{old}'"
        return None

    # -- observations, evidence, evidence sets -----------------------------------------------

    def variant_ids(self) -> list[str]:
        return [v.id for v in self.s.variants]

    def check_observations(self) -> None:
        seen: set[str] = set()
        for ob in self.s.observations:
            where = f"observation {ob.id}"
            if ob.id in seen:
                self.err(f"{where}: duplicate observation id")
            seen.add(ob.id)
            if ob.holder is not None:
                self.use(ob.holder, f"{where} holder")
            scope = self.variant_ids() if ob.in_ == "all" else list(ob.in_)
            unknown = [v for v in scope if v not in self.truth]
            if unknown:
                self.err(f"{where}: unknown variants {unknown}")
                continue
            if not scope:
                self.err(f"{where}: 'in' lists no variant")
            for pid in ob.shows:
                if self.prop_ok(pid, f"{where} shows"):
                    for v in scope:
                        if pid not in self.truth[v]:
                            self.err(f"{where}: shows '{pid}', which is not true in {v}")
            for pid in ob.toward:
                if self.prop_ok(pid, f"{where} toward") and all(
                    pid in self.truth[v] for v in scope
                ):
                    self.err(f"{where}: tempts toward '{pid}', which is true wherever it is seen")

    def check_evidence(self) -> None:
        seen: set[str] = set()
        for ev in self.s.evidence:
            where = f"evidence {ev.id}"
            if ev.id in seen:
                self.err(f"{where}: duplicate evidence id")
            seen.add(ev.id)
            ok = True
            for kind, items in (("supports", ev.supports), ("refutes", ev.refutes)):
                for pid in items:
                    ok = self.prop_ok(pid, f"{where} {kind}") and ok
            if set(ev.supports) & set(ev.refutes):
                self.err(
                    f"{where}: supports and refutes share "
                    f"{sorted(set(ev.supports) & set(ev.refutes))}"
                )
                ok = False
            ac = ev.acquire
            self.use(ac.from_, f"{where} acquire.from")
            if ac.gatekeeper is not None:
                self.use_typed(ac.gatekeeper, "person", f"{where} gatekeeper")
            if ac.daily is not None and not (
                len(ac.daily) == 2 and 0 <= ac.daily[0] < ac.daily[1] <= DAY
            ):
                self.err(f"{where}: daily window must be [from, to] inside one day, got {ac.daily}")
            if ac.until is not None and not 0 <= ac.until <= self.horizon:
                self.err(f"{where}: 'until' {ac.until} is outside the game")
            if ac.since is not None and not 0 <= ac.since < self.horizon:
                self.err(f"{where}: 'since' {ac.since} is outside the game")
            if ac.since is not None and ac.until is not None and ac.since >= ac.until:
                self.err(f"{where}: 'since' {ac.since} is not before 'until' {ac.until}")
            if ok:
                self.real_in[ev.id] = {
                    v
                    for v, truth in self.truth.items()
                    if set(ev.supports) <= truth and not set(ev.refutes) & truth
                }
                if not self.real_in[ev.id]:
                    self.err(
                        f"{where}: cannot exist in any variant (it needs everything it supports "
                        "to be true and nothing it refutes)"
                    )
        ids = {ev.id for ev in self.s.evidence}
        needs = {ev.id: ev.acquire.needs for ev in self.s.evidence}
        for ev in self.s.evidence:
            for need in ev.acquire.needs:
                if need not in ids or need == ev.id:
                    self.err(
                        f"evidence {ev.id}: acquire.needs names '{need}', "
                        "which is not another evidence item"
                    )
                elif ev.id in self.real_in and need in self.real_in:
                    missing = sorted(self.real_in[ev.id] - self.real_in[need])
                    if missing:
                        self.err(
                            f"evidence {ev.id}: needs '{need}' first, but '{need}' cannot "
                            f"exist in {missing}, so {ev.id} is unreachable there"
                        )
        for start in needs:
            seen: set[str] = set()
            stack = [start]
            while stack:
                cur = stack.pop()
                for nxt in needs.get(cur, []):
                    if nxt == start:
                        self.err(f"evidence {start}: acquire.needs loops back to itself")
                        stack.clear()
                        break
                    if nxt not in seen:
                        seen.add(nxt)
                        stack.append(nxt)

    def bottleneck(self, ev_id: str) -> str:
        ac = next(e.acquire for e in self.s.evidence if e.id == ev_id)
        return ac.gatekeeper or ac.from_

    def check_sets(self) -> None:
        by_id = {ev.id: ev for ev in self.s.evidence}
        ids: set[str] = set()
        per_variant: dict[str, list[EvidenceSet]] = {v: [] for v in self.truth}
        for es in self.s.evidence_sets:
            where = f"evidence set {es.id}"
            if es.id in ids:
                self.err(f"{where}: duplicate set id")
            ids.add(es.id)
            if es.tells not in self.truth:
                self.err(f"{where}: tells unknown variant '{es.tells}'")
                continue
            if len(es.items) > MAX_ITEMS_PER_SET or len(set(es.items)) != len(es.items):
                self.err(f"{where}: at most {MAX_ITEMS_PER_SET} different items per set")
            if any(i not in by_id for i in es.items):
                self.err(f"{where}: unknown evidence {[i for i in es.items if i not in by_id]}")
                continue
            if any(i not in self.real_in for i in es.items):
                continue
            good = True
            for item in es.items:
                for need in by_id[item].acquire.needs:
                    if need not in es.items:
                        self.err(
                            f"{where}: item '{item}' needs '{need}' first, "
                            "so the set must include it"
                        )
                        good = False
                if es.tells not in self.real_in[item]:
                    self.err(
                        f"{where}: item '{item}' cannot exist in {es.tells}, "
                        "so the set is no route to it"
                    )
                    good = False
            for other in self.truth:
                if other == es.tells:
                    continue
                if all(other in self.real_in[i] for i in es.items):
                    self.err(
                        f"{where}: tells {es.tells} but does not rule out {other} "
                        "(every item could also exist there)"
                    )
                    good = False
            per_variant[es.tells].append(es)
            if good:
                self.valid_sets.setdefault(es.tells, []).append(es)
        for v, sets in per_variant.items():
            if len(sets) > MAX_SETS_PER_VARIANT:
                self.err(f"variant {v}: {len(sets)} evidence sets, at most {MAX_SETS_PER_VARIANT}")
            if not self.valid_sets.get(v):
                self.err(
                    f"variant {v} has no evidence set that tells it apart from every other variant"
                )
                continue
            keyed = [{self.bottleneck(i) for i in es.items} for es in self.valid_sets[v]]
            best = 1
            for r in range(2, len(keyed) + 1):
                for combo in itertools.combinations(keyed, r):
                    if sum(len(k) for k in combo) == len(set().union(*combo)):
                        best = max(best, r)
            self.routes[v] = best
            if best < MIN_INDEPENDENT_ROUTES:
                self.warn(
                    f"variant {v}: only {best} evidence route without a shared gatekeeper or holder"
                )
            self.min_minutes[v] = min(
                sum(by_id[i].acquire.minutes for i in es.items) for es in self.valid_sets[v]
            )
            self.first_day[v] = min(
                max((by_id[i].acquire.since or 0) // DAY + 1 for i in es.items)
                for es in self.valid_sets[v]
            )
        self.check_tell_days()

    def check_tell_days(self) -> None:
        """Every story can be told apart no sooner and no later than the script says: the day on
        which the last item of its quickest set opens (an item that is not timed is there from the
        first day)."""
        days = self.s.tell_days
        if days is None:
            return
        if len(days) != 2 or not 1 <= days[0] <= days[1] <= self.s.days:
            self.err(f"tell_days must be [earliest, latest] days of the game, got {days}")
            return
        for v, day in self.first_day.items():
            if not days[0] <= day <= days[1]:
                self.err(
                    f"variant {v}: the quickest evidence set is complete on day {day}, "
                    f"outside tell_days {days}"
                )

    # -- lies -------------------------------------------------------------------------------

    def check_lies(self) -> None:
        holders: set[str] = set()
        template_ids: set[str] = set()
        for lh in self.s.lies:
            where = f"lies of {lh.holder}"
            self.use_typed(lh.holder, "person", where)
            if lh.holder in holders:
                self.err(f"{where}: the holder appears twice")
            holders.add(lh.holder)
            if lh.motive not in self.t.motives:
                self.err(f"{where}: unknown motive '{lh.motive}'")
            for pred in [*lh.preds, *lh.ignorance]:
                if pred not in self.t.preds:
                    self.err(f"{where}: unknown predicate '{pred}' in the envelope")
            for ent in lh.objects:
                self.use(ent, f"{where} objects")
            for tpl in lh.templates:
                tw = f"lie template {tpl.id}"
                if tpl.id in template_ids:
                    self.err(f"{tw}: duplicate template id")
                template_ids.add(tpl.id)
                if tpl.kind == "feign_ignorance":
                    if tpl.about is None or tpl.prop is not None or tpl.source is not None:
                        self.err(f"{tw}: feigned ignorance has 'about' and nothing else")
                    elif tpl.about not in lh.ignorance:
                        self.err(
                            f"{tw}: {lh.holder} may not feign ignorance about '{tpl.about}' "
                            f"(allowed: {lh.ignorance})"
                        )
                    continue
                if tpl.prop is None or tpl.source is None or tpl.about is not None:
                    self.err(f"{tw}: a claim has 'prop' and 'source' and no 'about'")
                    continue
                if not self.prop_ok(tpl.prop, tw):
                    continue
                prop = self.props[tpl.prop]
                if prop.pred not in lh.preds:
                    self.err(
                        f"{tw}: {lh.holder} may not claim '{prop.pred}' "
                        f"(allowed predicates: {lh.preds})"
                    )
                for slot, ent in prop.args.items():
                    if ent not in lh.objects:
                        self.err(
                            f"{tw}: {lh.holder} may not name '{ent}' in slot '{slot}' "
                            f"(allowed objects: {lh.objects})"
                        )
                if tpl.source.kind not in lh.sources:
                    self.err(
                        f"{tw}: {lh.holder} may not claim the source '{tpl.source.kind}' "
                        f"(allowed: {lh.sources})"
                    )
                if tpl.source.kind == "heard":
                    if tpl.source.from_ is None:
                        self.err(f"{tw}: a 'heard' source names the person it was heard from")
                    else:
                        self.use_typed(tpl.source.from_, "person", f"{tw} source")
                elif tpl.source.from_ is not None:
                    self.err(f"{tw}: only a 'heard' source has 'from'")
                if tpl.source_only:
                    if tpl.source.kind not in ("witnessed", "heard"):
                        self.err(f"{tw}: a source-only lie claims a seen or heard source")
                    if self.false_in_all(tpl.prop):
                        self.err(f"{tw}: source_only, but '{tpl.prop}' is false in every variant")
                elif self.true_in_all(tpl.prop):
                    self.err(
                        f"{tw}: '{tpl.prop}' is true in every variant, so claiming it is no lie "
                        "(mark the template source_only if only its source is false)"
                    )

    # -- openings ---------------------------------------------------------------------------

    def first_hand(self, pid: str) -> set[str]:
        """The people who saw ``pid`` for themselves before the game began, whichever variant is
        true. It reads the script as ``Lore`` does for a game (an observation of a holder, an act of
        the person, the person who testifies to it, the first of a chain to pass it on), but only
        counts a sighting that every variant has, since an opening does not know the variant."""
        variants = set(self.truth)
        prop = self.props[pid]
        found: set[str] = set()
        for ob in self.s.observations:
            scope = variants if ob.in_ == "all" else set(ob.in_)
            if ob.holder is not None and pid in ob.shows and scope == variants:
                found.add(ob.holder)
        who = prop.args.get("who")
        if (
            who is not None
            and not prop.neg
            and prop.pred not in STATIC_PREDS
            and self.true_in_all(pid)
        ):
            found.add(who)
        for ev in self.s.evidence:
            if pid in ev.supports and self.real_in.get(ev.id) == variants:
                found.add(ev.acquire.from_)
        for ch in self.s.chains:
            if ch.hops[0].prop == pid and len(ch.hops) > 1 and self.true_in_all(pid):
                found.add(ch.hops[1].speaker or "")
        return {p for p in found if self.e.kind.get(p) == "person"}

    def check_openings(self) -> None:
        """Every hop of an opening is a telling that could have happened: the speaker held what
        they told, or the version before it, the version is a legal step of its operator (with the
        rule the step needs), and nobody is told what they already held."""
        view = self.core_view()
        tables = CoreTables.from_canon(compile_tables(self.t))
        ids: set[str] = set()
        for op in self.s.openings:
            where = f"opening {op.id}"
            if bad_id(op.id):
                self.err(f"{where}: not a lower-case snake_case id")
            if op.id in ids:
                self.err(f"{where}: duplicate opening id")
            ids.add(op.id)
            if not op.label.strip():
                self.err(f"{where}: empty label")
            held: set[tuple[str, str]] = set()  # (person, prop) once a hop has put it there

            def holds(person: str, pid: str, held: set[tuple[str, str]] = held) -> bool:
                return (person, pid) in held or person in self.first_hand(pid)

            for number, hop in enumerate(op.hops, 1):
                hw = f"{where} hop {number}"
                people = [
                    self.use_typed(hop.speaker, "person", f"{hw} speaker"),
                    self.use_typed(hop.listener, "person", f"{hw} listener"),
                ]
                if not all(people) or not self.prop_ok(hop.prop, hw):
                    continue
                if hop.speaker == hop.listener:
                    self.err(f"{hw}: {hop.speaker} cannot tell themselves")
                if holds(hop.listener, hop.prop):
                    self.err(f"{hw}: {hop.listener} holds {hop.prop} already")
                prop = self.props[hop.prop]
                parent = self.props.get(prop.parent) if prop.parent else None
                changed = False
                if holds(hop.speaker, hop.prop):
                    if hop.via is not None or hop.own is not None:
                        self.err(f"{hw}: only a changed version has 'via' or 'own'")
                elif parent is not None and holds(hop.speaker, parent.id):
                    changed = True
                else:
                    self.err(
                        f"{hw}: {hop.speaker} holds neither {hop.prop} nor what it was made from"
                    )
                    continue
                if changed and view is not None:
                    assert parent is not None and prop.op is not None
                    registry, book, rules = view
                    needs_rule = prop.op == "assimilate" and parent.pred != prop.pred
                    if needs_rule != (hop.via is not None):
                        self.err(
                            f"{hw}: {'needs' if needs_rule else 'has no use for'} 'via', the rule"
                            " behind an assimilate that changes the predicate"
                        )
                    elif hop.via is not None and hop.via not in self.rules:
                        self.err(f"{hw}: unknown speculation rule '{hop.via}'")
                    else:
                        why = mutation_problem(
                            book[parent.id],
                            book[prop.id],
                            prop.op,
                            tables,
                            registry,
                            rules.get(hop.via or ""),
                            book=book,
                        )
                        if why is not None:
                            self.err(f"{hw}: {prop.op} step from '{parent.id}' is illegal: {why}")
                held.add((hop.listener, hop.prop))
                if hop.own is not None:
                    held.add((hop.speaker, hop.prop))

    # -- goals, endings, hard conditions -----------------------------------------------------

    def check_cond(self, cond: Any, where: str, names: set[str] | None = None) -> None:
        """Check a condition tree. ``names`` switches on plain-name atoms (the endings table)."""
        if isinstance(cond, str):
            if names is None or cond not in names:
                self.err(f"{where}: unknown name '{cond}'")
            return
        if not isinstance(cond, dict):
            self.err(f"{where}: a condition is a name or a mapping, got {cond!r}")
            return
        keys = set(cond)
        flags = {f.id for f in self.s.flags}
        metrics = {m.id: m for m in self.s.metrics}
        goals = {g.id for g in self.s.goals}
        if keys in ({"all"}, {"any"}):
            items = cond[next(iter(keys))]
            if not isinstance(items, list) or not items:
                self.err(f"{where}: '{next(iter(keys))}' needs a non-empty list")
                return
            for item in items:
                self.check_cond(item, where, names)
        elif keys == {"not"}:
            self.check_cond(cond["not"], where, names)
        elif keys == {"flag"}:
            if not isinstance(cond["flag"], str) or cond["flag"] not in flags:
                self.err(f"{where}: unknown flag {cond['flag']!r}")
        elif keys == {"goal"}:
            if not isinstance(cond["goal"], str) or cond["goal"] not in goals:
                self.err(f"{where}: unknown goal {cond['goal']!r}")
        elif keys == {"metric", "op", "value"}:
            m = metrics.get(cond["metric"]) if isinstance(cond["metric"], str) else None
            if m is None:
                self.err(f"{where}: unknown metric {cond['metric']!r}")
            elif not isinstance(cond["op"], str) or cond["op"] not in COMPARE_OPS:
                self.err(f"{where}: unknown comparison {cond['op']!r}")
            elif not isinstance(cond["value"], int) or not m.min <= cond["value"] <= m.max:
                self.err(
                    f"{where}: {cond['value']!r} is outside the range of {m.id} [{m.min}, {m.max}]"
                )
        else:
            self.err(f"{where}: unknown condition shape {sorted(keys)}")

    def eval_expr(self, expr: Any, env: dict[str, bool]) -> bool:
        if isinstance(expr, str):
            return env[expr]
        if "all" in expr:
            return all(self.eval_expr(x, env) for x in expr["all"])
        if "any" in expr:
            return any(self.eval_expr(x, env) for x in expr["any"])
        return not self.eval_expr(expr["not"], env)

    def check_state(self) -> None:
        for kind, items in (
            ("flag", self.s.flags),
            ("metric", self.s.metrics),
            ("goal", self.s.goals),
        ):
            ids = [i.id for i in items]
            for dup in sorted({i for i in ids if ids.count(i) > 1}):
                self.err(f"duplicate {kind} id '{dup}'")
        for m in self.s.metrics:
            if m.min >= m.max:
                self.err(f"metric {m.id}: min must be below max")
        flags = {f.id for f in self.s.flags}
        for g in self.s.goals:
            where = f"goal {g.id}"
            self.check_cond(g.done_when, where)
            for place in g.where:
                self.use_typed(place, "place", f"{where} where")
            if g.sets is not None and g.sets not in flags:
                self.err(f"{where}: sets unknown flag '{g.sets}'")
            if g.deadline is not None and not 0 <= g.deadline <= self.horizon:
                self.err(f"{where}: deadline {g.deadline} is outside the game")
        self.check_goal_cycles()
        if self.s.endings is not None:
            self.check_endings(self.s.endings, flags)
        for hc in self.s.hard_conditions:
            self.check_hard(hc)

    def check_goal_cycles(self) -> None:
        def deps(cond: Any) -> set[str]:
            if isinstance(cond, dict):
                found = {cond["goal"]} if isinstance(cond.get("goal"), str) else set()
                for val in cond.values():
                    for item in val if isinstance(val, list) else [val]:
                        if isinstance(item, dict):
                            found |= deps(item)
                return found
            return set()

        graph = {g.id: deps(g.done_when) for g in self.s.goals}
        state: dict[str, int] = {}

        def visit(node: str) -> bool:
            if state.get(node) == 1:
                return True
            if state.get(node) == 2 or node not in graph:
                return False
            state[node] = 1
            if any(visit(nxt) for nxt in graph[node]):
                return True
            state[node] = 2
            return False

        for node in graph:
            if visit(node):
                self.err(f"goal {node}: the goals depend on each other in a loop")
                return

    def check_endings(self, en: Endings, flags: set[str]) -> None:
        for name in en.inputs:
            if name not in flags:
                self.err(f"endings: input '{name}' is not a flag")
        names = set(en.inputs)
        for name, expr in en.derived.items():
            if name in names:
                self.err(f"endings: derived name '{name}' repeats another name")
            self.check_cond(expr, f"endings derived {name}", names)
            names.add(name)
        ids = [r.id for r in en.rows]
        for dup in sorted({i for i in ids if ids.count(i) > 1}):
            self.err(f"endings: duplicate row id '{dup}'")
        for row in en.rows:
            self.check_cond(row.when, f"endings row {row.id}", names)
        for hid in en.hidden:
            self.check_cond(hid.when, f"hidden ending {hid.id}")
        for inv in en.invariants:
            if inv.if_false not in en.inputs or inv.never not in ids:
                self.err(
                    f"endings: invariant {inv.if_false}/{inv.never} names an unknown input or row"
                )
        if len(self.rep.errors) and any(
            e.startswith(f"{self.name}: endings") for e in self.rep.errors
        ):
            return
        if len(en.inputs) > MAX_ENDING_INPUTS:
            self.err(f"endings: more than {MAX_ENDING_INPUTS} inputs, too many to enumerate")
            return
        for values in itertools.product([False, True], repeat=len(en.inputs)):
            env = dict(zip(en.inputs, values, strict=True))
            for name, expr in en.derived.items():
                env[name] = self.eval_expr(expr, env)
            hits = [r.id for r in en.rows if self.eval_expr(r.when, env)]
            shown = ", ".join(
                f"{k}={'T' if v else 'F'}" for k, v in zip(en.inputs, values, strict=True)
            )
            if not hits:
                self.err(f"endings: no row covers [{shown}]")
            elif len(hits) > 1:
                self.err(f"endings: rows {hits} overlap on [{shown}]")
            for inv in en.invariants:
                if not env[inv.if_false] and inv.never in hits:
                    self.err(
                        f"endings: [{shown}] gives {inv.never} although {inv.if_false} is false"
                    )

    def check_hard(self, hc: HardCondition) -> None:
        where = f"hard condition {hc.id}"
        self.use_typed(hc.holder, "person", where)
        seen: set[str] = set()
        for alt in hc.any:
            aw = f"{where} alternative {alt.id}"
            if alt.id in seen:
                self.err(f"{aw}: duplicate alternative id")
            seen.add(alt.id)
            self.check_conditions(alt.all, aw)
        for number, refusal in enumerate(hc.refusals, 1):
            rw = f"{where} refusal {number}"
            self.check_conditions(refusal.when, rw)
            if self.phrases and refusal.line not in self.phrases:
                self.err(f"{rw}: '{refusal.line}' is not a fixed line of the core (phrases.py)")

    def check_conditions(self, conds: list[dict[str, Any]], where: str) -> None:
        """Each condition is of the closed vocabulary, with exactly the arguments of its kind."""
        for cond in conds:
            kind = cond.get("kind")
            spec = CONDITION_KINDS.get(kind) if isinstance(kind, str) else None
            if spec is None:
                self.err(
                    f"{where}: unknown condition kind '{kind}' "
                    f"(known: {', '.join(CONDITION_KINDS)})"
                )
                continue
            if set(cond) - {"kind"} != set(spec):
                self.err(
                    f"{where}: kind '{kind}' takes exactly {sorted(spec)}, "
                    f"got {sorted(set(cond) - {'kind'})}"
                )
                continue
            for arg, want in spec.items():
                self.check_cond_arg(cond[arg], want, f"{where} {kind}.{arg}")

    def check_cond_arg(self, value: Any, want: str, where: str) -> None:
        if want == "int":
            if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 100:
                self.err(f"{where}: expected an integer 0..100, got {value!r}")
        elif want == "props":
            if not isinstance(value, list) or not value:
                self.err(f"{where}: expected a non-empty list of props")
                return
            for pid in value:
                if not self.prop_ok(pid, where):
                    continue
                if not self.false_in_all(pid):
                    self.err(
                        f"{where}: '{pid}' is true in some variant, so it is no rumour to refute"
                    )
                elif not self.refutable(pid):
                    self.err(f"{where}: no evidence item refutes '{pid}' or the prop it sharpens")
        elif want == "claims":
            if not isinstance(value, list) or not value:
                self.err(f"{where}: expected a non-empty list of props")
                return
            for pid in value:
                if not isinstance(pid, str):
                    self.err(f"{where}: expected a prop id, got {pid!r}")
                else:
                    self.prop_ok(pid, where)
        elif not isinstance(value, str):
            self.err(f"{where}: expected an entity id, got {value!r}")
        elif "|" in want:
            if self.use(value, where) and self.e.kind[value] not in want.split("|"):
                self.err(f"{where}: '{value}' is a {self.e.kind[value]}, expected {want}")
        else:
            self.use_typed(value, want, where)

    def refutable(self, pid: str) -> bool:
        """Some evidence refutes the prop, or the prop only sharpens or fills a refuted one."""
        if any(pid in ev.refutes for ev in self.s.evidence):
            return True
        p = self.props[pid]
        return p.op in ("sharpen", "fill") and p.parent is not None and self.refutable(p.parent)

    # -- tasks and wants ---------------------------------------------------------------------

    def check_terms(
        self,
        conds: list[dict[str, Any]],
        where: str,
        vocabulary: dict[str, dict[str, str]] | None = None,
    ) -> None:
        """Every condition of a list is a term, or ``all``, ``any`` or ``not`` of them. The terms
        are those of the tasks unless a ``vocabulary`` is given."""
        for cond in conds:
            self.check_term(cond, where, vocabulary)

    def check_term(
        self, cond: Any, where: str, vocabulary: dict[str, dict[str, str]] | None = None
    ) -> None:
        terms = TASK_TERMS if vocabulary is None else vocabulary
        if not isinstance(cond, dict) or not cond:
            self.err(f"{where}: a condition is a mapping with a kind, got {cond!r}")
            return
        keys = set(cond)
        if keys in ({"all"}, {"any"}):
            items = cond[next(iter(keys))]
            if not isinstance(items, list) or not items:
                self.err(f"{where}: '{next(iter(keys))}' needs a non-empty list")
                return
            self.check_terms(items, where, vocabulary)
            return
        if keys == {"not"}:
            self.check_term(cond["not"], where, vocabulary)
            return
        kind = cond.get("kind")
        spec = terms.get(kind) if isinstance(kind, str) else None
        if spec is None:
            self.err(f"{where}: unknown term '{kind}' (known: {', '.join(terms)})")
            return
        needed = {arg for arg in spec if not arg.endswith("?")}
        allowed = {arg.rstrip("?") for arg in spec}
        given = keys - {"kind"}
        if not needed <= given or not given <= allowed:
            self.err(
                f"{where}: term '{kind}' takes {sorted(needed)} and perhaps "
                f"{sorted(allowed - needed)}, got {sorted(given)}"
            )
            return
        for arg in sorted(given):
            want = spec[arg] if arg in spec else spec[f"{arg}?"]
            self.check_term_arg(cond[arg], want, f"{where} {kind}.{arg}")

    def check_term_arg(self, value: Any, want: str, where: str) -> None:
        if want == "known_props":
            if not isinstance(value, list) or not value:
                self.err(f"{where}: expected a non-empty list of props")
                return
            for pid in value:
                if not isinstance(pid, str):
                    self.err(f"{where}: expected a prop id, got {pid!r}")
                else:
                    self.prop_ok(pid, where)
        elif want in ("person", "place"):
            if isinstance(value, str):
                self.use_typed(value, want, where)
            else:
                self.err(f"{where}: expected a {want}, got {value!r}")
        elif want == "flag":
            if not isinstance(value, str) or value not in {f.id for f in self.s.flags}:
                self.err(f"{where}: unknown flag {value!r}")
        elif want == "day":
            if type(value) is not int or not 1 <= value <= self.s.days:
                self.err(f"{where}: expected a day from 1 to {self.s.days}, got {value!r}")
        elif want == "hour":
            if type(value) is not int or not DAY_START // 60 <= value <= DAY_END // 60 + 3:
                self.err(f"{where}: expected an hour from 6 to 24, got {value!r}")
        elif want == "word":
            if not isinstance(value, str) or bad_id(value):
                self.err(f"{where}: expected a lower-case snake_case word, got {value!r}")
        elif want == "event":
            if value not in EVENT_KINDS:
                self.err(f"{where}: unknown event {value!r}")
        elif want == "where":
            self.check_where(value, where)
        elif want == "relation":
            if value not in RELATIONS:
                self.err(f"{where}: expected one of {', '.join(RELATIONS)}, got {value!r}")
        elif want == "commitment_state":
            if value not in COMMITMENT_STATES:
                self.err(f"{where}: expected one of {', '.join(COMMITMENT_STATES)}, got {value!r}")
        elif want == "item":
            if not isinstance(value, str) or not (
                value in self.items or self.e.kind.get(value) == "thing"
            ):
                self.err(f"{where}: {value!r} is neither an item of the cast nor a thing")
        elif want == "yes":
            if value is not True:
                self.err(f"{where}: expected true (leave the argument out for no), got {value!r}")
        elif want == "count":
            if type(value) is not int or not 1 <= value <= len(self.s.cast):
                self.err(f"{where}: expected a number of people from 1 up, got {value!r}")
        elif want == "percent":
            if type(value) is not int or not 1 <= value <= 100:
                self.err(f"{where}: expected a per cent from 1 to 100, got {value!r}")
        elif want == "sky":
            if value not in SKIES:
                self.err(f"{where}: expected one of {', '.join(SKIES)}, got {value!r}")
        elif want == "request":
            if value not in REQUESTS:
                self.err(f"{where}: expected one of {', '.join(REQUESTS)}, got {value!r}")
        elif want == "family":
            if isinstance(value, str):
                self.use_typed(value, "family", where)
            else:
                self.err(f"{where}: expected a family, got {value!r}")
        elif want == "evidence_items":
            known = {item.id for item in self.s.evidence}
            if not isinstance(value, list) or not value:
                self.err(f"{where}: expected a non-empty list of items of evidence")
            else:
                for item in value:
                    if not isinstance(item, str) or item not in known:
                        self.err(f"{where}: unknown item of evidence {item!r}")
        elif want == "missed":
            if value not in MISSED_CODES:
                self.err(f"{where}: expected one of {', '.join(MISSED_CODES)}, got {value!r}")
        elif want == "slot":
            if type(value) is not int or not 1 <= value <= PLEDGE_CARDS:
                self.err(f"{where}: expected a promise from 1 to {PLEDGE_CARDS}, got {value!r}")
        elif want == "pledge_state":
            if value not in PLEDGE_STATES:
                self.err(f"{where}: expected one of {', '.join(PLEDGE_STATES)}, got {value!r}")
        elif want == "pledge_due":
            if value not in PLEDGE_DUE:
                self.err(f"{where}: expected one of {', '.join(PLEDGE_DUE)}, got {value!r}")
        elif want == "deed":
            if value not in DEEDS:
                self.err(f"{where}: expected one of {', '.join(DEEDS)}, got {value!r}")
        elif want == "claims":
            if not isinstance(value, list) or not value:
                self.err(f"{where}: expected a non-empty list of props")
            else:
                for pid in value:
                    if not isinstance(pid, str):
                        self.err(f"{where}: expected a prop id, got {pid!r}")
                    else:
                        self.prop_ok(pid, where)
        elif want == "int":
            if type(value) is not int or not 0 <= value <= 100:
                self.err(f"{where}: expected an integer 0..100, got {value!r}")
        elif want == "meeting":
            if value not in voice_content.MEETINGS:
                self.err(
                    f"{where}: expected one of {', '.join(voice_content.MEETINGS)}, got {value!r}"
                )
        elif want == "cause":
            if value not in voice_content.CAUSES:
                self.err(
                    f"{where}: expected one of {', '.join(voice_content.CAUSES)}, got {value!r}"
                )
        else:
            raise AssertionError(f"{where}: no check for argument kind {want!r}")

    def check_where(self, value: Any, where: str) -> None:
        """The fields an event must have: names of fields and what they hold, a word, a number or
        a flag. A field that names a person holds a person of the cast."""
        if not isinstance(value, dict) or not value:
            self.err(f"{where}: expected a non-empty mapping of fields, got {value!r}")
            return
        for name, held in value.items():
            if not isinstance(name, str) or bad_id(name):
                self.err(f"{where}: {name!r} is not the name of a field")
            elif type(held) not in (str, int, bool):
                self.err(f"{where}: field {name} must hold a word, a number or a flag")
            elif name in EVENT_PEOPLE:
                if isinstance(held, str):
                    self.use_typed(held, "person", f"{where} {name}")
                else:
                    self.err(f"{where}: field {name} must hold a person")

    def check_words(self, options: list[WordsIf], where: str) -> None:
        for number, option in enumerate(options, 1):
            self.check_terms(option.when, f"{where} option {number}")
            self.check_slots(option, f"{where} option {number}")

    def check_action(self, options: list[ActionIf], where: str) -> None:
        for number, action in enumerate(options, 1):
            aw = f"{where} action {number}"
            self.check_terms(action.when, aw)
            if action.npc == FRONTIER:
                if action.verb != "ask_source" or not action.follow:
                    self.err(f"{aw}: {FRONTIER} is for ask_source, and needs the props to follow")
            elif action.npc == HELPER:
                if not (
                    action.verb == "promise" or (action.verb, action.request) == ("entrust", "join")
                ):
                    self.err(f"{aw}: {HELPER} is for an entrust of the kind join, or a promise")
            elif action.npc is not None and re.fullmatch(re.escape(PLEDGE) + r"\d+", action.npc):
                if (action.verb, action.kind) != ("promise", "keep"):
                    self.err(f"{aw}: {PLEDGE} is for a promise of the kind keep")
            elif action.npc is not None:
                self.use_typed(action.npc, "person", f"{aw} npc")
            elif action.verb in NEEDS_NPC:
                self.err(f"{aw}: the verb {action.verb} needs a person")
            self.check_action_extras(action, aw)
            if action.follow and action.npc != FRONTIER:
                self.err(f"{aw}: follow is for {FRONTIER}")
            for pid in action.follow:
                self.prop_ok(pid, f"{aw} follow")
            if action.place is not None:
                self.use_typed(action.place, "place", f"{aw} place")
            elif action.verb == "move":
                self.err(f"{aw}: the verb move needs a place")
            if action.verb == "ask":  # the topic of a question: a person, a thing or a place
                if action.item is not None and self.e.kind.get(action.item) not in TOPIC_KINDS:
                    self.err(f"{aw}: {action.item!r} is no topic (a person, a thing or a place)")
            elif action.verb == "tell":  # the note to tell, named by its prop
                if action.item is not None:
                    self.prop_ok(action.item, f"{aw} item")
            elif action.item is not None and not (
                action.item in self.items or self.e.kind.get(action.item) == "thing"
            ):
                self.err(f"{aw}: {action.item!r} is neither an item of the cast nor a thing")
            if action.verb == "look" and action.item is None and action.place is None:
                self.err(f"{aw}: the verb look needs a thing or a place")

    def check_action_extras(self, action: ActionIf, aw: str) -> None:
        """The fields ``request``, ``kind`` and ``target`` go with the verbs they belong to."""
        if action.verb == "entrust" and action.request is None and action.item is None:
            self.err(f"{aw}: the verb entrust needs a request, or an item (the goods)")
        if action.request is not None:
            if action.verb != "entrust":
                self.err(f"{aw}: a request is for the verb entrust, not {action.verb}")
            if action.request not in REQUEST_KINDS:
                self.err(f"{aw}: request {action.request!r} is not one of {REQUEST_KINDS}")
            if action.request == "material" and action.item is None:
                self.err(f"{aw}: a request for the goods names the item")
            if action.request != "material" and action.item is not None:
                self.err(f"{aw}: only a request for the goods names an item")
            if action.request == "persuade" and action.target is None:
                self.err(f"{aw}: a request to persuade names the person to talk round")
        if action.kind is not None:
            if action.verb not in ("speak", "promise"):
                self.err(f"{aw}: a kind is for the verb speak or promise, not {action.verb}")
            elif action.verb == "speak" and action.kind not in SPEAK_KINDS:
                self.err(f"{aw}: kind {action.kind!r} is not one of {SPEAK_KINDS}")
            elif action.verb == "promise" and action.kind not in PROMISE_KINDS:
                self.err(f"{aw}: kind {action.kind!r} is not one of {PROMISE_KINDS}")
        if action.target is not None:
            if action.request != "persuade":
                self.err(f"{aw}: a target is for a request to persuade")
            else:
                self.use_typed(action.target, "person", f"{aw} target")

    def check_slots(self, words: Words, where: str) -> None:
        """The names a task writes in braces are numbers of the game the frame can put in, and the
        same in both languages."""
        names = {lang: set(SLOT_NAME.findall(getattr(words, lang))) for lang in ("zh", "en")}
        if names["zh"] != names["en"]:
            self.err(f"{where}: the two languages write different slots")
        for name in sorted(names["zh"] | names["en"]):
            if name not in AGENDA_FACTS:
                self.err(f"{where}: {{{name}}} is not a number the words can carry")
        for lang in ("zh", "en"):
            if "{" in SLOT_NAME.sub("", getattr(words, lang)) or "}" in SLOT_NAME.sub(
                "", getattr(words, lang)
            ):
                self.err(f"{where} ({lang}): a stray brace")

    def slots_of(self, task: Task) -> set[str]:
        """Every name a task writes in braces: the title, the lapse and the words of each option."""
        found: set[str] = set()
        words: list[Words] = [task.text, *task.why, *task.next]
        words += [rule.blocker for rule in task.blocked]
        for rule in task.blocked:
            words += [*rule.why, *rule.next]
        if task.lapse is not None:
            words.append(task.lapse)
        for said in words:
            found |= set(SLOT_NAME.findall(said.zh)) | set(SLOT_NAME.findall(said.en))
        return found

    def check_tasks(self) -> None:
        ids: set[str] = set()
        for task in self.s.tasks:
            where = f"task {task.id}"
            if bad_id(task.id):
                self.err(f"{where}: not a lower-case snake_case id")
            if task.id in ids:
                self.err(f"{where}: duplicate task id")
            ids.add(task.id)
            if task.window is not None:
                self.use_typed(task.window.place, "place", f"{where} window")
                if task.window.day is not None and task.window.day > self.s.days:
                    self.err(f"{where}: the window is on day {task.window.day}, after the game")
                if task.window.from_ >= task.window.to:
                    self.err(f"{where}: the window must end after it starts")
                if task.window.days is not None:
                    first, last = task.window.days
                    if task.window.day is not None:
                        self.err(f"{where}: a window is on a day or on days, not both")
                    if not 1 <= first <= last <= self.s.days:
                        self.err(
                            f"{where}: the days of the window are [first, last] inside the "
                            f"game's {self.s.days} days, got {task.window.days}"
                        )
                self.check_terms(task.window.unless, f"{where} window unless")
            if task.expected is not None:
                if task.window is None:
                    self.err(f"{where}: 'expected' is the people at the place of the window")
                if task.expected.from_ >= task.expected.to:
                    self.err(f"{where}: 'expected' must end after it starts")
            for name in ("appears", "done", "stale"):
                self.check_terms(getattr(task, name), f"{where} {name}")
            for name in ("why", "next"):
                self.check_words(getattr(task, name), f"{where} {name}")
            if task.pledge is not None:  # the title of a promise names the person, and is filled in
                self.check_slots(task.text, f"{where} title")
                if task.lapse is not None:
                    self.check_slots(task.lapse, f"{where} lapse")
                for name in sorted(self.slots_of(task)):
                    found = PLEDGE_NAME.fullmatch(name)
                    if found is not None and int(found[1]) != task.pledge:
                        self.err(f"{where}: {{{name}}} is the words of another promise")
            elif "{" in task.text.zh + task.text.en:
                self.err(f"{where}: the title has no slots (it is quoted when the task changes)")
            if task.lapse is not None and task.pledge is None:
                self.err(f"{where}: lapse is for the task of a promise (per: pledge)")
            self.check_action(task.action, where)
            for number, rule in enumerate(task.blocked, 1):
                bw = f"{where} blocked {number}"
                self.check_terms(rule.when, bw)
                self.check_words(rule.why, f"{bw} why")
                self.check_words(rule.next, f"{bw} next")
                self.check_slots(rule.blocker, f"{bw} blocker")
                self.check_action(rule.action, bw)

    def check_statement(self) -> None:
        """The statement card: the parts in order, every prop real, and in each variant exactly one
        right option in each part, whose claims hold in that variant and whose ``against`` props
        nothing real in that variant can be (so that what the manager finds for real never bears
        against the right option)."""
        card = self.s.statement
        if card is None:
            return
        if card.opens.day > self.s.days:
            self.err(f"statement: opens on day {card.opens.day}, after the game")
        if [part.id for part in card.parts] != list(STATEMENT_PARTS):
            self.err(f"statement: the parts must be {', '.join(STATEMENT_PARTS)}, in that order")
        for part in card.parts:
            where = f"statement {part.id}"
            if "{" in part.title.zh + part.title.en:
                self.err(f"{where}: the title has no slots")
            ids: set[str] = set()
            for option in part.options:
                ow = f"{where} option {option.id}"
                if bad_id(option.id) or option.id in ids:
                    self.err(f"{ow}: not a lower-case snake_case id, or a duplicate")
                ids.add(option.id)
                if "{" in option.text.zh + option.text.en:
                    self.err(f"{ow}: the text has no slots")
                if part.id == "cause" and not option.claims:
                    self.err(f"{ow}: a cause states who or what broke the rail")
                for name in ("claims", "supports", "against"):
                    props = getattr(option, name)
                    if len(set(props)) != len(props):
                        self.err(f"{ow}: {name} lists a prop twice")
                    for pid in props:
                        self.prop_ok(pid, f"{ow} {name}")
                if set(option.supports) & set(option.against):
                    self.err(f"{ow}: a prop is both for and against")
                if not option.supports and not option.against:
                    self.err(f"{ow}: no note could ever bear on it")
                for variant in option.right:
                    if variant not in self.truth:
                        self.err(f"{ow}: {variant!r} is not a variant")
            for variant, truth in sorted(self.truth.items()):
                right = [o for o in part.options if variant in o.right]
                if len(right) != 1:
                    self.err(f"{where}: {len(right)} right options in {variant}, expected one")
                    continue
                for option in part.options:
                    held = all(pid in truth for pid in option.claims)
                    if part.id != "rumour" and held != (option in right):
                        self.err(
                            f"{where} option {option.id}: its claims "
                            f"{'hold' if held else 'do not hold'} in {variant}, "
                            f"and it is {'' if option in right else 'not '}the right one"
                        )
                (one,) = right
                for pid in one.against:
                    if pid in truth:
                        self.err(
                            f"{where} option {one.id}: {pid} is against it and true in {variant}"
                        )

    def check_wants(self) -> None:
        ids: set[str] = set()
        for want in self.s.wants:
            where = f"want {want.id}"
            if bad_id(want.id):
                self.err(f"{where}: not a lower-case snake_case id")
            if want.id in ids:
                self.err(f"{where}: duplicate want id")
            ids.add(want.id)
            self.use_typed(want.person, "person", f"{where} person")
            self.check_terms(want.learned, f"{where} learned")
            for lang in ("zh", "en"):
                if voice_content.has_pronoun(lang, getattr(want.text, lang)):
                    self.err(f"{where} {lang}: a person is never he or she")

    def culprits(self) -> set[str]:
        """The people some story of the script blames: whoever a true ``damaged`` prop of a variant
        names (``roles.CULPRITS``)."""
        found: set[str] = set()
        for true in self.truth.values():
            for pid in true:
                prop = self.props.get(pid)
                if prop is not None and prop.pred == "damaged" and not prop.neg:
                    who = prop.args.get("who")
                    if who is not None and self.e.kind.get(who) == "person":
                        found.add(who)
        return found

    def check_roles(self) -> None:
        """The conditions of the lists of the people who carry the days (``content/lines``): terms
        of ``ROLE_VOCABULARY`` with arguments of this script. A person some story blames reads
        nothing of what anyone believes, and only a claim that was made in public may be asked
        after (``voice_content.KNOWABLE``): the lists tell nothing of which story is true."""
        culprits = self.culprits()
        for person, raw in sorted(self.voices.items()):
            if not isinstance(raw, dict):
                continue
            for kind in voice_content.ROLE_LISTS:
                for entry in raw.get(kind) or []:
                    if not isinstance(entry, dict):
                        continue
                    where = f"lines/{person}.yaml {kind} {entry.get('id')}"
                    conds = entry.get("when") or []
                    if not isinstance(conds, list):
                        continue  # the shape is the model's to refuse
                    self.check_terms(conds, where, ROLE_VOCABULARY)
                    for leaf in condition_leaves(conds):
                        name = leaf.get("kind")
                        if name == "acquainted" and kind != "greet":
                            self.err(f"{where}: only a greeting knows if the talk is a first one")
                        if name in voice_content.BELIEF_TERMS and person in culprits:
                            self.err(
                                f"{where}: {person} may be the one the truth blames, so the "
                                f"term '{name}' is not for their lists"
                            )
                        props = leaf.get("props") if name == "knows" else None
                        for pid in props if isinstance(props, list) else ():
                            if pid not in voice_content.KNOWABLE:
                                self.err(
                                    f"{where}: '{pid}' was not made in public, so a list cannot "
                                    f"ask if a person knows it (known: "
                                    f"{', '.join(voice_content.KNOWABLE)})"
                                )

    def check_commitments(self) -> None:
        rules = self.s.commitments
        if rules is None:
            return
        for item, amount in sorted(rules.batches.items()):
            if item not in self.items:
                self.err(f"commitments batches: {item!r} is not an item of the cast")
            if amount < 1:
                self.err(f"commitments batches: {item} must be at least 1, got {amount}")
        if rules.due.cutoff + rules.due.soon > DAY_END // 60:
            self.err(
                "commitments due: a promise made just before the cutoff falls due after the day"
            )
        if rules.start > rules.due.late:
            self.err(
                "commitments: the person must set out (start) before the next-day due hour (late)"
            )
        for path, allowed in COMMITMENT_WORDS.items():
            words = rules
            for part in path.split("."):
                words = getattr(words, part)
            for lang in ("zh", "en"):
                text = getattr(words, lang)
                try:
                    used = {name for _, name, _, _ in string.Formatter().parse(text) if name}
                except ValueError as exc:
                    self.err(f"commitments {path} {lang}: {exc}")
                    continue
                if not used <= allowed:
                    self.err(
                        f"commitments {path} {lang}: unknown placeholder "
                        f"{sorted(used - allowed)}, it takes {sorted(allowed)}"
                    )

    def check_paper(self) -> None:
        rules = self.s.paper
        if rules is None:
            return
        street = rules.street
        if street.cool >= street.warm:
            self.err(f"paper street: cool ({street.cool}) must be below warm ({street.warm})")
        if street.split <= street.side:
            self.err(f"paper street: split ({street.split}) must be above side ({street.side})")
        groups = {
            "when": rules.when,
            "manager": rules.manager,
            "progress": rules.progress,
            "news": rules.news,
            "talk": rules.talk,
        }
        for group, words_of in groups.items():
            for name in type(words_of).model_fields:
                path = f"{group}.{name}"
                words = getattr(words_of, name)
                allowed = PAPER_WORDS.get(path, set())
                for lang in ("zh", "en"):
                    text = getattr(words, lang)
                    if PRONOUNS[lang].search(text):
                        self.err(f"paper {path} {lang}: a person is never he or she")
                    try:
                        used = {n for _, n, _, _ in string.Formatter().parse(text) if n}
                    except ValueError as exc:
                        self.err(f"paper {path} {lang}: {exc}")
                        continue
                    if not used <= allowed:
                        self.err(
                            f"paper {path} {lang}: unknown placeholder "
                            f"{sorted(used - allowed)}, it takes {sorted(allowed)}"
                        )

    def check_gifts(self) -> None:
        """The small things of the day: distinct lower-case ids, a name in each language, and no
        pronoun, semicolon or dash in a name."""
        seen: set[str] = set()
        for gift in self.s.gifts:
            where = f"gifts '{gift.id}'"
            if bad_id(gift.id):
                self.err(f"{where}: the id must be lower-case snake_case")
            if gift.id in seen:
                self.err(f"{where}: listed twice")
            seen.add(gift.id)
            for lang in ("zh", "en"):
                text = getattr(gift, lang)
                if not text.strip() or text != text.strip() or "\n" in text:
                    self.err(f"{where} ({lang}): a name on one line, without blank space")
                if any(mark in text for mark in voice_content.BANNED):
                    self.err(f"{where} ({lang}): no semicolon or dash")
            if not any("\u4e00" <= ch <= "\u9fff" for ch in gift.zh) or any(
                "\u4e00" <= ch <= "\u9fff" for ch in gift.en
            ):
                self.err(f"{where}: the Chinese is Chinese text and the English is English text")
        if len(self.s.gifts) > MAX_GIFTS:
            self.err(f"gifts: at most {MAX_GIFTS} small things a day")

    def check_information(self) -> None:
        """The relations of the tutorial name props of the script, and the hubs are people."""
        for number, rule in enumerate(self.s.tutorial_relations, 1):
            where = f"tutorial relation {number}"
            for side in (rule.a, rule.b):
                for pid in side:
                    self.prop_ok(pid, where)
            if set(rule.a) & set(rule.b):
                self.err(f"{where}: a prop is on both sides")
        seen: set[str] = set()
        for hub in self.s.hubs:
            if hub in seen:
                self.err(f"hubs lists '{hub}' twice")
            seen.add(hub)
            self.use_typed(hub, "person", "hubs")

    def check_cast_covers_refs(self) -> None:
        cast = set(self.s.cast)
        for ent, where in self.refs.items():
            if ent not in cast:
                self.err(f"{where}: '{ent}' is used but not listed in cast")


# --------------------------------------------------------------------------------------
# Compiling
# --------------------------------------------------------------------------------------


def dump(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(by_alias=True, mode="json")


def compile_slot(s: Slot) -> dict[str, Any]:
    types = s.types
    return {
        "name": s.name,
        "type": types[0] if len(types) == 1 else types,
        "required": s.required,
    }


def compile_tables(t: Tables) -> dict[str, Any]:
    return {
        "predicates": [
            {
                "id": p.id,
                "label": p.label,
                "slots": [compile_slot(s) for s in p.slots],
                "level_to": p.level_to,
                "heavier": p.heavier,
            }
            for p in t.preds.values()
        ],
        "motives": [{"id": m.id, "label": m.label} for m in t.motives.values()],
    }


def compile_prop(p: PropIn) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": p.id,
        "pred": p.pred,
        "args": dict(p.args),
        "span": list(p.span) if p.span is not None else None,
        "neg": p.neg,
        "motive": p.motive,
    }
    if p.parent is not None:
        out["parent"] = p.parent
        out["op"] = p.op
    return out


def compile_script(ck: ScriptChecker) -> dict[str, Any]:
    s = ck.s
    cast = set(s.cast)
    data = dump(s)
    del data["cast"]
    data["entities"] = [e for e in ck.e.compiled if e["id"] in cast]
    data["props"] = [compile_prop(p) for p in s.props]
    data["variants"] = [
        {
            "id": v.id,
            "label": v.label,
            # what happened, which the core turns into events
            "true_props": sorted(p for p in ck.truth[v.id] if not ck.props[p].neg),
            # negations that hold, derived from the closed world; not events
            "true_negations": sorted(p for p in ck.truth[v.id] if ck.props[p].neg),
        }
        for v in s.variants
    ]
    for ev in data["evidence"]:
        ev["real_in"] = sorted(ck.real_in[ev["id"]])
    return data


def render(data: Any) -> bytes:
    return canon.dumps(data)


# --------------------------------------------------------------------------------------
# Coverage
# --------------------------------------------------------------------------------------


def fmt_counter(counter: Counter[str], total: int, what: str) -> str:
    items = ", ".join(
        f"{k} {n}" for k, n in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    )
    return f"{what} {len(counter)} of {total} used: {items}"


def script_coverage(ck: ScriptChecker) -> list[str]:
    s = ck.s
    n_all = len(s.variants)
    in_all = [p for p in ck.props if sum(p in t for t in ck.truth.values()) == n_all]
    in_none = [p for p in ck.props if not any(p in t for t in ck.truth.values())]
    in_some = len(ck.props) - len(in_all) - len(in_none)
    mutated = sum(1 for p in s.props if p.parent is not None)
    negated = sum(1 for p in s.props if p.neg)
    preds = Counter(p.pred for p in s.props)
    motives = Counter(p.motive for p in s.props if p.motive)
    rule_preds = Counter(pat.pred for r in s.speculation for pat in [*r.premises, r.conclusion])
    unused_cast = sorted(set(s.cast) - set(ck.refs))
    lines = [
        f"{s.id}: {len(s.props)} props ({mutated} mutated, {negated} negated): "
        f"{len(in_all)} true in every variant, {in_some} true in some, {len(in_none)} false in all",
        "  "
        + fmt_counter(preds, len(ck.t.preds), "predicates")
        + "; in rules only: "
        + (", ".join(sorted(set(rule_preds) - set(preds))) or "none"),
        "  " + fmt_counter(motives, len(ck.t.motives), "motives"),
        f"  cast {len(s.cast)} entities; never referenced: {', '.join(unused_cast) or 'none'}",
        f"  variants {n_all}; evidence {len(s.evidence)} items in {len(s.evidence_sets)} sets; "
        "independent routes "
        + ", ".join(f"{v} {ck.routes.get(v, 0)}" for v in ck.truth)
        + "; fastest set (minutes) "
        + ", ".join(f"{v} {ck.min_minutes.get(v, 0)}" for v in ck.truth)
        + (
            "; first day told apart " + ", ".join(f"{v} {ck.first_day.get(v, 0)}" for v in ck.truth)
            if s.tell_days is not None
            else ""
        ),
        f"  observations {len(s.observations)}; chains {len(s.chains)} "
        f"({sum(len(c.hops) - 1 for c in s.chains)} hops); openings {len(s.openings)} "
        f"({sum(len(o.hops) for o in s.openings)} hops); lie templates "
        f"{sum(len(lh.templates) for lh in s.lies)} for {len(s.lies)} characters; speculation "
        f"{len(s.speculation)} rules with {sum(ck.binding_counts.values())} bindings",
    ]
    if s.goals or s.endings or s.hard_conditions:
        lines.append(
            f"  state: {len(s.flags)} flags, {len(s.metrics)} metrics, {len(s.goals)} goals, "
            f"{len(s.endings.rows) if s.endings else 0} ending rows, "
            f"{sum(len(h.any) for h in s.hard_conditions)} hard-condition alternatives"
        )
    if s.tasks or s.wants:
        kinds = Counter(t.kind for t in s.tasks)
        later = []
        for t in s.tasks:
            used = sorted(TASK_TERMS_LATER[k] for k in terms_of(t) if k in TASK_TERMS_LATER)
            if used:
                later.append(f"{t.id} ({', '.join(used)})")
        lines.append(
            f"  tasks {len(s.tasks)} ({', '.join(f'{k} {n}' for k, n in sorted(kinds.items()))}); "
            f"wants {len(s.wants)}; terms nothing reads yet: {', '.join(later) or 'none'}"
        )
    return lines


def terms_of(value: Any) -> set[str]:
    """The kinds of term used anywhere in a task, as a model or as the plain values it dumps to."""
    found: set[str] = set()
    if isinstance(value, BaseModel):
        value = value.model_dump(by_alias=True)
    if isinstance(value, dict):
        kind = value.get("kind")
        if isinstance(kind, str) and kind in TASK_TERMS:
            found.add(kind)
        for item in value.values():
            found |= terms_of(item)
    elif isinstance(value, list):
        for item in value:
            found |= terms_of(item)
    return found


def condition_leaves(conds: Any) -> list[dict[str, Any]]:
    """The terms of a list of conditions, whatever they are nested in."""
    found: list[dict[str, Any]] = []
    for cond in conds if isinstance(conds, list) else [conds]:
        if not isinstance(cond, dict):
            continue
        for key in ("all", "any"):
            if isinstance(cond.get(key), list):
                found += condition_leaves(cond[key])
        if "not" in cond:
            found += condition_leaves([cond["not"]])
        if "kind" in cond:
            found.append(cond)
    return found


def table_coverage(checkers: list[ScriptChecker], tables: Tables, ents: Entities) -> list[str]:
    used_preds: set[str] = set()
    used_motives: set[str] = set()
    used_ents: set[str] = set()
    for ck in checkers:
        used_preds |= {p.pred for p in ck.s.props}
        used_preds |= {pat.pred for r in ck.s.speculation for pat in [*r.premises, r.conclusion]}
        used_motives |= {p.motive for p in ck.s.props if p.motive}
        used_motives |= {lh.motive for lh in ck.s.lies}
        used_ents |= set(ck.refs) | set(ck.s.cast)
    return [
        "tables: predicates nobody uses: "
        + (", ".join(sorted(set(tables.preds) - used_preds)) or "none"),
        "tables: motives nobody uses: "
        + (", ".join(sorted(set(tables.motives) - used_motives)) or "none"),
        "entities: in no script: " + (", ".join(sorted(set(ents.kind) - used_ents)) or "none"),
    ]


# --------------------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------------------


def validate(src: Sources) -> Report:
    """Validate raw sources. On success ``outputs`` holds every compiled file."""
    rep = Report()
    tables = check_tables(src, rep)
    ents = check_entities(src, rep)
    if tables is None or ents is None:
        return rep
    if not src.scripts:
        rep.errors.append("no scripts found in content/scripts")
    checkers: list[ScriptChecker] = []
    for name, raw in src.scripts.items():
        try:
            script = Script.model_validate(raw)
        except ValidationError as exc:
            rep.errors += model_errors(name, exc)
            continue
        if script.id != name:
            rep.errors.append(f"{name}: the id '{script.id}' must match the file name")
            continue
        items = {
            item["id"]
            for cast in src.casts.values()
            if isinstance(cast, dict)
            for item in cast.get("items", [])
        }
        voiced_by = src.voices if name == voice_content.cast_script(src.casts) else None
        ck = ScriptChecker(name, script, tables, ents, rep, src.phrases, items, voiced_by)
        ck.run()
        checkers.append(ck)
    if rep.errors:
        return rep
    script_casts = {ck.name: list(ck.s.cast) for ck in checkers}
    tables_doc = compile_tables(tables)
    script_docs = {ck.name: compile_script(ck) for ck in checkers}
    outputs, generated, lines = town_content.build(
        src.maps, src.casts, ents, script_casts, {"tables": tables_doc, **script_docs}, rep.errors
    )
    said, said_modules, said_lines = sentence_content.build(src.sentences, tables, ents, rep.errors)
    voiced, voiced_modules, voiced_lines = voice_content.build(
        src.voices, src.casts, src.phrases, src.sentences, rep.errors, src.speech
    )
    worded, worded_modules, worded_lines = speech_content.build(
        src.speech, tables, ents, voice_content.cast_people(src.casts), rep.errors
    )
    asked, asked_modules, asked_lines = prompt_content.build(
        src.prompts, src.voices, voice_content.cast_people(src.casts), rep.errors
    )
    if rep.errors:
        return rep
    rep.outputs.update(outputs)
    rep.outputs.update(said)
    rep.outputs.update(voiced)
    rep.outputs.update(worded)
    rep.outputs.update(asked)
    rep.generated.update(generated)
    rep.generated.update(said_modules)
    rep.generated.update(voiced_modules)
    rep.generated.update(worded_modules)
    rep.generated.update(asked_modules)
    rep.coverage += lines + said_lines + voiced_lines + worded_lines + asked_lines
    rep.outputs["tables.json"] = render(tables_doc)
    rep.outputs["entities.json"] = render({"entities": ents.compiled})
    for ck in checkers:
        rep.outputs[f"{ck.name}.json"] = render(script_docs[ck.name])
        rep.coverage += script_coverage(ck)
    rep.coverage += table_coverage(checkers, tables, ents)
    return rep


def stale_files(root: Path, outputs: dict[str, bytes]) -> list[str]:
    out_dir = root / "content" / "compiled"
    stale = []
    for name, data in sorted(outputs.items()):
        path = out_dir / name
        if not path.exists():
            stale.append(f"{name}: missing")
        elif path.read_bytes() != data:
            stale.append(f"{name}: out of date")
    if out_dir.exists():
        for path in sorted(out_dir.glob("*.json")):
            if path.name not in outputs:
                stale.append(f"{path.name}: no longer produced")
    return stale


def stale_generated(root: Path, generated: dict[str, bytes]) -> list[str]:
    stale = []
    for rel, data in sorted(generated.items()):
        path = root / rel
        if not path.exists():
            stale.append(f"{rel}: missing")
        elif path.read_bytes() != data:
            stale.append(f"{rel}: out of date")
    return stale


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true", help="fail if a compiled file is stale")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root")
    parser.add_argument("--quiet", action="store_true", help="skip the coverage report")
    args = parser.parse_args(argv)
    rep = validate(load_sources(args.root))
    for line in rep.warnings:
        print(f"warning: {line}", file=sys.stderr)
    if rep.errors:
        for line in rep.errors:
            print(f"error: {line}", file=sys.stderr)
        print(f"{len(rep.errors)} error(s); nothing written", file=sys.stderr)
        return 1
    if not args.quiet:
        print("\n".join(rep.coverage))
    if args.check:
        stale = stale_files(args.root, rep.outputs) + stale_generated(args.root, rep.generated)
        if stale:
            for line in stale:
                print(f"stale: {line}", file=sys.stderr)
            print("run: uv run python tools/check_content.py", file=sys.stderr)
            return 1
        count = len(rep.outputs) + len(rep.generated)
        print(f"content ok, {count} compiled files up to date")
        return 0
    out_dir = args.root / "content" / "compiled"
    out_dir.mkdir(parents=True, exist_ok=True)
    for stale_path in out_dir.glob("*.json"):
        if stale_path.name not in rep.outputs:
            stale_path.unlink()
    for name, data in rep.outputs.items():
        (out_dir / name).write_bytes(data)
    for rel, data in rep.generated.items():
        target = args.root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(f"wrote {len(rep.outputs)} files to {out_dir} and {len(rep.generated)} modules")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
