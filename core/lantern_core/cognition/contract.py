"""The contract of a model's reply for a townsperson, and the gate it passes before anyone sees it.

What a townsperson says to a listener is never a model's alone. A model is asked for one JSON
object, the *reply*. The core reads it (``parse``), judges every act in it with the same
``paths.authorize`` that judges the talk between neighbours, and then either writes the sentence
itself or checks the model's. ``gate`` does all of it and is a pure function of the reply text, the
speaker's state (``Speaker``) and the script (``Script``). It changes nothing and asks nothing.
What to do with its answer (ask once more, speak a template, write the claims down) is for the
world, see ``world.bridge.speech``.

The reply
---------
::

    {"acts": [act, ...],                      at most MAX_ACTS, possibly none
     "line": {"zh": str, "en": str},          needed when the model writes the sentence
     "mood": mood,                            a mood word, "plain" if left out
     "address": address}                      a form of address, "none" if left out

``mood`` and ``address`` are ids of the lexicon (``content/tables/speech.yaml``). No other key is
allowed. Every id in a reply is lower-case letters, digits and underscores, at most 64 of them.

An *act* is one thing said, by one of the four paths of ``paths``::

    {"path": "belief" | "speculation" | "mutation" | "lie",
     "prop": prop id | structured prop,       what is said (see below)
     "modality": "assert" | "speculate" | "deny" | "lie",
     "source": "self_seen" | "unknown" | person id,   the source the speaker names
     "rule": rule id,                         speculation, and an assimilate that changes the
                                              predicate
     "premises": [prop id, ...],              speculation: what the rule rests on, in order
     "op": "level" | "sharpen" | "assimilate" | "fill",       mutation
     "template": lie template id}             lie

and the basis of an act is what the path asks for: the belief it repeats (the prop itself for
``belief``, the parent for ``mutation``), the rule and its premises, the operator, or the lie
template. The ``source`` is one the path allows: what the belief gives (or ``unknown``, which
hides it), the speaker's own id for a guess, what the template names for a lie.

A *structured prop* is a prop that is not in the book yet, for a guess or a mutation::

    {"pred": id, "args": {slot: entity id}, "span": [start, end] | null, "neg": bool,
     "motive": id | null, "parent": prop id | null, "op": operator | null}

Its predicate, entities and motive must be in the tables, and a mutation is held to the rules of
its operator. The core gives it an id (``Speaker.settle``): the prop the book has with the same
content, or a new one. A feigned ignorance has no prop: ``{"path": "lie", "template": id}``, where
the template is the speaker's lie of that kind.

The gate
--------
Every act goes through ``paths.authorize`` (step 1), and an act on something the speaker guards
(``Speaker.guards``) is refused, since a person never says what they keep back as it stands. Then
the sentence is made one of two ways.

*The core writes it* when any act is sensitive: its prop is plot-critical (``Script.critical``),
causal (the path is a guess, or a mutation by a rule, or the prop has a motive or a predicate of
``Script.causal``), negative (a denial, or a feigned ignorance), modal (a guess), or it names a
source (anything but ``unknown``). That is where a splice such as "A went by the bridge, so the
rail fell" would hide a new claim in a connective, so the model's line is not used at all: each act
is said by the speaker's own voice (``Voice``) from its prop, its modality and its source, and the
model adds only its mood, as an interjection that opens the sentence, and its form of address, at
the end of it.

*The model writes it* when every act is plain (and when there is no act, in a chat that says
nothing about the town). Its line is held to three more steps, each in both languages:

2. Every name of a person, a place, a thing and every word that says an act or a motive must be
   one that an act (or the talk itself: the speaker, the listeners, the sources named) covers.
   The names a speaker has of their own for people (``Speaker.calls``) are names of those people
   for that speaker, and are covered in the same way.
3. Every word of the classes of ``lexicon`` (connective, negation, hedge, certain, hearsay, seen)
   needs an act that carries it. A connective is carried by a causal act, a negation by a
   negative one, a hedge by a modal one, hearsay by an act whose source is someone else's word,
   and seen by one whose source is ``self_seen``. Nothing carries ``certain``. The lists are
   closed (``content/tables/speech.yaml``), so the step stops the usual ways of putting it and
   not every way.
4. The words the speaker keeps back must not be in the line: the secrets written for them, and the
   names and words of the props they guard, except those the town knows or an act covers.

Errors
------
``gate`` returns every error it finds, each ``Error(type, where, code, detail)``, in the order of
``ERROR_TYPES``: ``format`` (the reply is not what the contract asks, so nothing else is
judged), ``path`` (step 1), ``entity`` (step 2), ``connective`` (step 3, whatever the class of
word) and ``private`` (step 4, and an act on something guarded). A word that is private is
reported as private and not again as an entity or a connective. The ``detail`` names ids and
short quoted words and is safe to hand back to the model.
"""

from __future__ import annotations

import json
import re
from collections import ChainMap
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

from lantern_core.cognition._fields import ShapeError
from lantern_core.cognition.beliefs import PATHS, UNKNOWN, BeliefStore, Claim
from lantern_core.cognition.lexicon import (
    CLASSES,
    EVENT,
    LANGUAGES,
    MOTIVE,
    NAME,
    Lexicon,
    TermSet,
    Vocabulary,
    blank,
    normalise,
    scan,
)
from lantern_core.cognition.lines import LinesError
from lantern_core.cognition.paths import RelationCheck, authorize, authorize_ignorance
from lantern_core.cognition.props import OPS, Prop, Registry, Tables, check_prop
from lantern_core.cognition.rules import LieTemplate, SpecRule
from lantern_core.text import jsonish

ERROR_TYPES = ("format", "path", "entity", "connective", "private")
MODALITIES = ("assert", "speculate", "deny", "lie")
MAX_ACTS = 3
MAX_PREMISES = 4
MAX_ARGS = 6
MAX_LINE = 240  # characters of a line, in each language
MAX_TEXT = 20_000  # characters of a reply
MAX_SPAN = 10**6
MAX_TRIES = 8  # braces tried as the start of the object
DRAFT = "_"  # the id of a structured prop before it is settled
ID = re.compile(r"[a-z0-9_]{1,64}")
CJK = re.compile("[㐀-鿿　-〿＀-￯]")
HAN = re.compile("[㐀-鿿]")
LATIN = re.compile("[A-Za-z]")
ACT_KEYS = ("path", "prop", "modality", "source", "rule", "premises", "op", "template")
REPLY_KEYS = ("acts", "line", "mood", "address")
PROP_KEYS = ("pred", "args", "span", "neg", "motive", "parent", "op")
END_PUNCTUATION = {"zh": "。！？", "en": ".!?"}
VOCATIVE = {"zh": "，", "en": ", "}


# ----------------------------------------------------------------------------- errors


@dataclass(frozen=True, slots=True)
class Error:
    """One thing wrong with a reply: a type of ``ERROR_TYPES``, where, a short code, a detail."""

    type: str
    where: str
    code: str
    detail: str

    def text(self) -> str:
        return f"{self.type} at {self.where} ({self.code}): {self.detail}"

    def to_canon(self) -> dict[str, str]:
        return {"type": self.type, "where": self.where, "code": self.code, "detail": self.detail}


class ContractError(ValueError):
    """A reply that is not what the contract asks, with every way it is not."""

    def __init__(self, errors: Sequence[Error]) -> None:
        super().__init__("; ".join(e.text() for e in errors))
        self.errors = tuple(errors)


def _quote(value: Any) -> str:
    """A short, safe rendering of something the model wrote, for an error."""
    text = value if isinstance(value, str) else type(value).__name__
    return json.dumps(text[:40], ensure_ascii=False)


def _fail(errors: list[Error], where: str, code: str, detail: str) -> None:
    errors.append(Error("format", where, code, detail))


# ----------------------------------------------------------------------------- the reply


@dataclass(frozen=True, slots=True)
class Act:
    """One act as written. ``prop`` is an id of the book, a draft to settle, or ``None`` for a
    feigned ignorance."""

    path: str
    prop: str | Prop | None
    modality: str | None
    source: str | None
    rule: str | None
    premises: tuple[str, ...]
    op: str | None
    template: str | None


@dataclass(frozen=True, slots=True)
class Reply:
    """A reply that has the shape the contract asks for. ``fixes`` are the repairs the forgiving
    reader of ``text.jsonish`` had to make to the JSON."""

    acts: tuple[Act, ...]
    line: Mapping[str, str] | None
    mood: str
    address: str
    fixes: tuple[str, ...]


def _ident(value: Any) -> bool:
    return isinstance(value, str) and ID.fullmatch(value) is not None


def _read(text: str) -> tuple[dict[str, Any], tuple[str, ...]] | None:
    """The first JSON object in ``text`` that can be read, with the repairs it needed."""
    start = 0
    for _ in range(MAX_TRIES):
        found = [i for i in (text.find("{", start), text.find("｛", start)) if i >= 0]
        if not found:
            return None
        at = min(found)
        try:
            obj, _, fixes = jsonish.read_object(text, at)
        except (ValueError, RecursionError):
            start = at + 1
            continue
        return obj, fixes
    return None


def first_object(text: str) -> dict[str, Any] | None:
    """The first JSON object in ``text`` that can be read, forgivingly as ``parse`` reads it, or
    ``None``. The judgement of a person's words is a small object of its own and is read with the
    same reader."""
    if not isinstance(text, str) or len(text) > MAX_TEXT:
        return None
    found = _read(text)
    return None if found is None else found[0]


def _unknown_keys(
    raw: Mapping[str, Any], allowed: Sequence[str], where: str, errors: list[Error]
) -> None:
    for key in sorted(set(raw) - set(allowed)):
        _fail(errors, where, "unknown_key", f"unknown key {_quote(key)}")


def _draft(raw: Any, where: str, errors: list[Error]) -> Prop | None:
    if not isinstance(raw, dict):
        _fail(errors, where, "bad_prop", "a prop is an id or an object")
        return None
    start = len(errors)
    _unknown_keys(raw, PROP_KEYS, where, errors)
    pred, args = raw.get("pred"), raw.get("args")
    if not _ident(pred):
        _fail(errors, f"{where}.pred", "bad_prop", "pred must be a predicate id")
    if not (isinstance(args, dict) and 0 < len(args) <= MAX_ARGS):
        _fail(errors, f"{where}.args", "bad_prop", f"args must be 1 to {MAX_ARGS} slots")
    elif not all(_ident(slot) and _ident(entity) for slot, entity in args.items()):
        _fail(errors, f"{where}.args", "bad_prop", "slots and entities must be ids")
    span = raw.get("span")
    if span is not None and not (
        isinstance(span, list)
        and len(span) == 2
        and all(type(v) is int and abs(v) <= MAX_SPAN for v in span)
        and span[0] <= span[1]
    ):
        _fail(errors, f"{where}.span", "bad_prop", "span must be null or [start, end] in ints")
    neg = raw.get("neg", False)
    if type(neg) is not bool:
        _fail(errors, f"{where}.neg", "bad_prop", "neg must be true or false")
    for key in ("motive", "parent"):
        if raw.get(key) is not None and not _ident(raw[key]):
            _fail(errors, f"{where}.{key}", "bad_prop", f"{key} must be an id or null")
    op = raw.get("op")
    if op is not None and op not in OPS:
        _fail(errors, f"{where}.op", "bad_prop", f"op must be one of {list(OPS)} or null")
    if len(errors) > start:
        return None
    try:
        return Prop.of(
            DRAFT,
            pred,
            args,
            None if span is None else (span[0], span[1]),
            neg,
            raw.get("motive"),
            raw.get("parent"),
            op,
        )
    except ShapeError as exc:
        _fail(errors, where, "bad_prop", str(exc)[:120])
        return None


def _act(index: int, raw: Any, errors: list[Error]) -> Act | None:
    where = f"acts[{index}]"
    if not isinstance(raw, dict):
        _fail(errors, where, "bad_act", "an act is an object")
        return None
    start = len(errors)
    _unknown_keys(raw, ACT_KEYS, where, errors)
    path = raw.get("path")
    if path not in PATHS:
        _fail(errors, f"{where}.path", "bad_path", f"path must be one of {list(PATHS)}")
    prop = raw.get("prop")
    modality, source = raw.get("modality"), raw.get("source")
    if prop is None:  # a feigned ignorance
        if path != "lie" or not _ident(raw.get("template")):
            _fail(errors, where, "no_prop", "an act without a prop is a lie with a template")
    else:
        if isinstance(prop, dict):
            prop = _draft(prop, f"{where}.prop", errors)
        elif not _ident(prop):
            _fail(errors, f"{where}.prop", "bad_prop", "a prop is an id or an object")
        if modality not in MODALITIES:
            _fail(
                errors, f"{where}.modality", "bad_modality", f"modality: one of {list(MODALITIES)}"
            )
        if not _ident(source):
            _fail(errors, f"{where}.source", "bad_source", "source must be an id")
    for key in ("rule", "template"):
        if raw.get(key) is not None and not _ident(raw[key]):
            _fail(errors, f"{where}.{key}", f"bad_{key}", f"{key} must be an id")
    premises = raw.get("premises")
    if premises is None:
        premises = []
    if not (
        isinstance(premises, list)
        and len(premises) <= MAX_PREMISES
        and all(_ident(p) for p in premises)
    ):
        _fail(errors, f"{where}.premises", "bad_premises", f"up to {MAX_PREMISES} prop ids")
    op = raw.get("op")
    if op is not None and op not in OPS:
        _fail(errors, f"{where}.op", "bad_op", f"op must be one of {list(OPS)}")
    if len(errors) > start:
        return None
    return Act(
        path,
        prop,
        modality,
        source,
        raw.get("rule"),
        tuple(premises),
        op,
        raw.get("template"),
    )


def _line(raw: Any, errors: list[Error]) -> dict[str, str] | None:
    """The line as a pair of stripped texts, or ``None`` if there is none. The words themselves are
    judged only when the model's line is the one that is used (``line_errors``)."""
    if raw is None or raw == {}:
        return None
    if not isinstance(raw, dict) or set(raw) != set(LANGUAGES):
        _fail(errors, "line", "bad_line", 'line is {"zh": text, "en": text}')
        return None
    if not all(isinstance(raw[lang], str) for lang in LANGUAGES):
        _fail(errors, "line", "bad_line", "a line is a string in each language")
        return None
    if not any(raw[lang].strip() for lang in LANGUAGES):
        return None  # no line at all
    return {lang: raw[lang].strip() for lang in LANGUAGES}


def line_errors(line: Mapping[str, str]) -> list[Error]:
    """What is wrong with the words of a line apart from what it says: an empty or too long text, a
    control character, Chinese in the English or none in the Chinese."""
    errors: list[Error] = []
    for lang in LANGUAGES:
        text, where = line[lang], f"line.{lang}"
        if not text:
            _fail(errors, where, "bad_line", "the line is missing in this language")
        elif len(text) > MAX_LINE:
            _fail(errors, where, "bad_line", f"at most {MAX_LINE} characters")
        elif any(ord(c) < 32 or ord(c) == 127 for c in text):
            _fail(errors, where, "bad_line", "no control characters")
        elif lang == "zh" and not HAN.search(text):
            _fail(errors, where, "bad_line", "the Chinese line must be Chinese")
        elif lang == "en" and (CJK.search(text) or not LATIN.search(text)):
            _fail(errors, where, "bad_line", "the English line must be English, with no Chinese")
    return errors


def parse(text: str, lexicon: Lexicon) -> Reply:
    """The reply in ``text``, or ``ContractError`` with every way it is not what the contract asks.

    The first JSON object in the text is read forgivingly (``text.jsonish``), and what it holds is
    judged strictly: the keys, the types, the ids, the lengths and the closed lists. Whether an act
    is allowed is not judged here, only whether it is well formed.
    """
    if not isinstance(text, str) or len(text) > MAX_TEXT:
        raise ContractError(
            [
                Error(
                    "format", "$", "bad_text", f"a reply is a text of {MAX_TEXT} characters at most"
                )
            ]
        )
    found = _read(text)
    if found is None:
        raise ContractError([Error("format", "$", "no_object", "no JSON object found")])
    obj, fixes = found
    errors: list[Error] = []
    _unknown_keys(obj, REPLY_KEYS, "$", errors)
    raw_acts = obj.get("acts")
    acts: list[Act] = []
    if not isinstance(raw_acts, list):
        _fail(errors, "acts", "bad_acts", "acts is a list, which may be empty")
    elif len(raw_acts) > MAX_ACTS:
        _fail(errors, "acts", "too_many_acts", f"at most {MAX_ACTS} acts")
    else:
        for i, raw in enumerate(raw_acts):
            act = _act(i, raw, errors)
            if act is not None:
                acts.append(act)
    line = _line(obj.get("line"), errors)
    mood = obj.get("mood", "plain")
    if not isinstance(mood, str) or mood not in lexicon.moods:
        _fail(errors, "mood", "bad_mood", f"mood must be one of {sorted(lexicon.moods)}")
    address = obj.get("address", "none")
    if not isinstance(address, str) or address not in lexicon.addresses:
        _fail(errors, "address", "bad_address", f"address: one of {sorted(lexicon.addresses)}")
    if errors:
        raise ContractError(errors)
    return Reply(tuple(acts), line, mood, address, fixes)


# ----------------------------------------------------------------------------- the script


class Voice(Protocol):
    """How one speaker says things, in both languages. The world supplies it, in the person's
    own words."""

    def claim(self, prop: Prop, modality: str, source: str) -> Mapping[str, str]:
        """The sentence for saying ``prop`` in ``modality``, naming ``source``."""

    def unknown(self) -> Mapping[str, str]:
        """The sentence for not knowing, which a feigned ignorance and a real one share."""


class Script:
    """What the gate needs of a script, which is the same for every speaker.

    ``names`` is ``{entity id: {"zh", "en"}}`` as ``Lines.names`` makes it. ``critical`` says
    whether a prop is one the story turns on, ``causal`` lists the predicates whose act is a cause
    (damaging, stealing), and ``public`` the props the whole town knows.
    """

    __slots__ = (
        "causal",
        "critical",
        "lexicon",
        "public",
        "registry",
        "rules",
        "tables",
        "templates",
        "vocabulary",
    )

    def __init__(
        self,
        *,
        tables: Tables,
        registry: Registry,
        rules: Mapping[str, SpecRule],
        templates: Mapping[str, LieTemplate],
        public: Sequence[str],
        names: Mapping[str, Mapping[str, str]],
        lexicon: Lexicon,
        critical: Callable[[Prop], bool],
        causal: Sequence[str] = (),
    ) -> None:
        self.tables = tables
        self.registry = registry
        self.rules = rules
        self.templates = templates
        self.public = tuple(public)
        self.lexicon = lexicon
        self.vocabulary = Vocabulary(lexicon, names)
        self.critical = critical
        self.causal = frozenset(causal)


@dataclass(frozen=True, slots=True)
class Speaker:
    """The speaker as the gate sees them at the moment they speak.

    ``store`` is what they believe and ``book`` every prop of the game, the script's and those made
    on the way. ``relation`` answers whether they stand in a relation (a grudge) toward a person.
    ``guards`` says whether they keep a prop back. ``settle`` gives a structured prop (a draft with
    the id ``DRAFT``) the id of the prop of the book that says the same, or a new one. ``voice``
    words what they say. ``calls`` are the names they use for other people, ``{entity id: {"zh",
    "en"}}``: in a line of the model's, such a name is a name of that person, as the labels and the
    aliases are, and needs an act that covers them.
    """

    id: str
    listeners: tuple[str, ...]
    tick: int
    store: BeliefStore
    book: Mapping[str, Prop]
    suspicion: int
    relation: RelationCheck | None
    guards: Callable[[Prop], bool]
    settle: Callable[[Prop], Prop]
    voice: Voice
    calls: Mapping[str, Mapping[str, str]] = field(default_factory=dict)


# ----------------------------------------------------------------------------- what an act is


@dataclass(frozen=True, slots=True)
class Features:
    """What an act is made of, as far as the gate cares. ``source`` is ``None`` for a feigned
    ignorance."""

    critical: bool
    causal: bool
    negative: bool
    modal: bool
    source: str | None

    @property
    def sensitive(self) -> bool:
        """Whether the core writes the sentence of an act like this."""
        named = self.source != UNKNOWN
        return self.critical or self.causal or self.negative or self.modal or named


def features(claim: Claim, prop: Prop, script: Script) -> Features:
    caused = claim.path == "speculation" or (claim.path == "mutation" and claim.rule_id is not None)
    return Features(
        critical=script.critical(prop),
        causal=caused or prop.motive is not None or prop.pred in script.causal,
        negative=prop.neg or claim.modality == "deny",
        modal=claim.modality == "speculate",
        source=claim.claimed_source,
    )


FEIGNED = Features(critical=False, causal=False, negative=True, modal=False, source=None)


def carried(word_class: str, acts: Sequence[Features], speaker: str) -> bool:
    """Whether some act carries the words of the class (see the module docstring)."""
    if word_class == "connective":
        return any(f.causal for f in acts)
    if word_class == "negation":
        return any(f.negative for f in acts)
    if word_class == "hedge":
        return any(f.modal for f in acts)
    if word_class == "hearsay":
        return any(f.source is not None and f.source not in ("self_seen", speaker) for f in acts)
    if word_class == "seen":
        return any(f.source == "self_seen" for f in acts)
    return False  # certain: nothing in a free line can stand behind it


# ----------------------------------------------------------------------------- the result


@dataclass(frozen=True, slots=True)
class Gated:
    """What the gate makes of a reply.

    ``ok`` says it passed. Then ``by`` is ``core`` when the core wrote the sentence and ``model``
    when the model's was kept; ``line`` is the sentence in both languages, ``claims`` the acts as
    claims the world may write down (the id of each is ``"_"``), ``props`` the props they made
    that the book did not have, and ``feigned`` the templates of a feigned ignorance. When it
    did not pass, ``errors`` lists every way. ``fixes`` are the repairs made to the JSON, and
    ``paths`` the path each act claimed, in order, which an error at ``acts[i]`` refers to.
    """

    ok: bool
    errors: tuple[Error, ...] = ()
    by: str = ""
    line: Mapping[str, str] | None = None
    mood: str = "plain"
    address: str = "none"
    claims: tuple[Claim, ...] = ()
    props: tuple[Prop, ...] = ()
    feigned: tuple[str, ...] = ()
    fixes: tuple[str, ...] = ()
    paths: tuple[str, ...] = ()

    @property
    def types(self) -> tuple[str, ...]:
        """The types of the errors, once each, in the order of ``ERROR_TYPES``."""
        return tuple(t for t in ERROR_TYPES if any(e.type == t for e in self.errors))


@dataclass(frozen=True, slots=True)
class _Resolved:
    act: Act
    prop: Prop | None
    claim: Claim | None
    features: Features | None


# ----------------------------------------------------------------------------- step 1: the acts


def _refusal(reason: str) -> tuple[str, str]:
    code, _, rest = reason.partition(":")
    return code, rest.strip() or reason


def _resolve(
    index: int,
    act: Act,
    speaker: Speaker,
    script: Script,
    made: dict[str, Prop],
    errors: list[Error],
) -> _Resolved:
    where = f"acts[{index}]"
    if act.prop is None:
        assert act.template is not None
        ok, reason = authorize_ignorance(speaker.id, act.template, script.templates)
        if not ok:
            code, detail = _refusal(reason)
            errors.append(Error("path", where, code, detail))
            return _Resolved(act, None, None, None)
        return _Resolved(act, None, None, FEIGNED)
    prop: Prop | None
    if isinstance(act.prop, Prop):
        problems = check_prop(act.prop, script.tables, script.registry, speaker.book)
        if problems:
            detail = "; ".join(problems[:2])[:160]
            errors.append(Error("path", where, "bad_prop", detail))
            return _Resolved(act, None, None, None)
        prop = speaker.settle(act.prop)
        prop_id = prop.id
        if prop_id not in speaker.book:
            made[prop_id] = prop
    else:
        prop_id = act.prop
        prop = speaker.book.get(prop_id)
    assert act.modality is not None and act.source is not None
    try:
        claim = Claim(
            "_",
            speaker.id,
            speaker.listeners,
            prop_id,
            act.modality,
            act.source,
            speaker.tick,
            act.path,
            act.rule,
            act.premises,
            act.op,
            act.template,
        )
    except ShapeError as exc:
        errors.append(Error("format", where, "claim", str(exc)[:120]))
        return _Resolved(act, prop, None, None)
    ok, reason = authorize(
        claim,
        speaker.store,
        ChainMap(made, speaker.book),
        tables=script.tables,
        registry=script.registry,
        rules=script.rules,
        templates=script.templates,
        suspicion=speaker.suspicion,
        relation=speaker.relation,
        public=script.public,
    )
    if not ok:
        code, detail = _refusal(reason)
        errors.append(Error("path", where, code, detail))
    if prop is None:
        return _Resolved(act, None, claim, None)
    if speaker.guards(prop):
        errors.append(
            Error(
                "private",
                where,
                "guarded",
                f"{speaker.id} keeps {prop.id} back and does not say it",
            )
        )
    return _Resolved(act, prop, claim, features(claim, prop, script))


# ----------------------------------------------------------------------------- the line


@dataclass(frozen=True, slots=True)
class _Cover:
    """What the acts and the talk itself cover: entities, predicates, motives, and their words."""

    entities: frozenset[str]
    preds: frozenset[str]
    motives: frozenset[str]
    words: frozenset[tuple[str, bool]]


def _vocabulary(speaker: Speaker, script: Script) -> Vocabulary:
    """The names and words of the script as ``speaker`` has them (with their own names)."""
    return script.vocabulary.calling(speaker.calls)


def _cover(resolved: Sequence[_Resolved], speaker: Speaker, script: Script) -> _Cover:
    entities = {speaker.id, *speaker.listeners}
    preds: set[str] = set()
    motives: set[str] = set()
    for r in resolved:
        if r.claim is not None and r.claim.claimed_source not in ("self_seen", UNKNOWN):
            entities.add(r.claim.claimed_source)
        if r.prop is not None:
            entities.update(entity for _, entity in r.prop.args)
            preds.add(r.prop.pred)
            if r.prop.motive is not None:
                motives.add(r.prop.motive)
    vocab = _vocabulary(speaker, script)
    words: set[tuple[str, bool]] = set()
    for kind, idents in ((NAME, entities), (EVENT, preds), (MOTIVE, motives)):
        for ident in sorted(idents):
            words.update(vocab.words_of(kind, ident))
    return _Cover(frozenset(entities), frozenset(preds), frozenset(motives), frozenset(words))


def _prop_words(prop: Prop, vocab: Vocabulary) -> set[tuple[str, bool]]:
    words: set[tuple[str, bool]] = set()
    for _, entity in prop.args:
        words.update(vocab.words_of(NAME, entity))
    words.update(vocab.words_of(EVENT, prop.pred))
    if prop.motive is not None:
        words.update(vocab.words_of(MOTIVE, prop.motive))
    return words


def _private_terms(speaker: Speaker, script: Script, cover: _Cover) -> TermSet:
    """The words the speaker keeps back: their secrets, and the words of what they guard."""
    terms: dict[tuple[str, bool], str] = {}
    secrets = script.lexicon.secrets.get(speaker.id, {})
    for lang in LANGUAGES:
        for word in secrets.get(lang, []):
            terms[(normalise(word), lang == "en")] = "secret"
    known = set(cover.words)
    vocab = _vocabulary(speaker, script)
    for pid in script.public:
        if pid in speaker.book:
            known |= _prop_words(speaker.book[pid], vocab)
    for pid in sorted(speaker.book):
        prop = speaker.book[pid]
        if speaker.guards(prop):
            for form in sorted(_prop_words(prop, vocab) - known):
                terms.setdefault(form, "guarded")
    return TermSet([(form, code, whole) for (form, whole), code in sorted(terms.items())])


def _scan_line(
    lang: str,
    line: str,
    private: TermSet,
    cover: _Cover,
    acts: Sequence[Features],
    speaker: Speaker,
    script: Script,
) -> list[Error]:
    where = f"line.{lang}"
    errors: list[Error] = []
    text = normalise(line)
    hits = scan(text, private)
    for _, form, code in hits:
        errors.append(
            Error("private", where, code, f"{_quote(form)} is something {speaker.id} keeps back")
        )
    text = blank(text, hits)
    vocab, lexicon = _vocabulary(speaker, script), script.lexicon
    seen: set[tuple[str, str]] = set()
    for _, form, (kind, ident) in scan(text, vocab.terms):
        if kind == NAME:
            licensed, label = ident in cover.entities, vocab.labels.get(ident, ident)
            said = f"names {label} ({ident})"
        elif kind == EVENT:
            licensed = any(p in cover.preds for p in ident)
            said = f"says the act {'/'.join(ident)}"
        else:
            licensed = any(m in cover.motives for m in ident)
            said = f"gives the motive {'/'.join(ident)}"
        if not licensed and (kind, form) not in seen:
            seen.add((kind, form))
            errors.append(
                Error("entity", where, kind, f"{_quote(form)} {said}, which no act covers")
            )
    for word_class in CLASSES:
        masked = blank(text, scan(text, lexicon.masks[word_class]))
        for _, form, _ in scan(masked, lexicon.classes[word_class]):
            if not carried(word_class, acts, speaker.id):
                errors.append(
                    Error(
                        "connective",
                        where,
                        word_class,
                        f"{_quote(form)} is a {word_class} word, which no act carries",
                    )
                )
    return errors


# ----------------------------------------------------------------------------- the sentence


def _vocative(text: str, who: str, lang: str) -> str:
    """``text`` with the form of address before its last stop, or at its end if it has none."""
    if not who:
        return text
    if text and text[-1] in END_PUNCTUATION[lang] and not text.endswith(("..", "?!", "!?")):
        return text[:-1] + VOCATIVE[lang] + who + text[-1]
    return text + VOCATIVE[lang] + who


def _write(
    resolved: Sequence[_Resolved], speaker: Speaker, reply: Reply, lexicon: Lexicon
) -> dict[str, str]:
    """The sentence the core writes: each act in the speaker's voice, then the mood and address."""
    said: list[Mapping[str, str]] = []
    for r in resolved:
        if r.prop is None:
            said.append(speaker.voice.unknown())
        else:
            assert r.claim is not None
            said.append(speaker.voice.claim(r.prop, r.claim.modality, r.claim.claimed_source))
    out: dict[str, str] = {}
    for lang in LANGUAGES:
        text = ("" if lang == "zh" else " ").join(s[lang] for s in said)
        text = _vocative(text, lexicon.addresses[reply.address][lang], lang)
        opener = lexicon.moods[reply.mood][lang]
        out[lang] = f"{opener}{text}" if lang == "zh" or not opener else f"{opener} {text}"
    return out


# ----------------------------------------------------------------------------- the gate


def gate(text: str, speaker: Speaker, script: Script) -> Gated:
    """Judge the reply in ``text`` for ``speaker`` against ``script`` (see the module docstring).

    The result is the same every time for the same arguments, and nothing is changed.
    """
    try:
        reply = parse(text, script.lexicon)
    except ContractError as exc:
        return Gated(False, exc.errors)
    errors: list[Error] = []
    made: dict[str, Prop] = {}
    resolved = [_resolve(i, act, speaker, script, made, errors) for i, act in enumerate(reply.acts)]
    acts = [r.features for r in resolved if r.features is not None]
    core = any(f.sensitive for f in acts)
    # an act that could not be read says nothing of who writes the sentence
    undecided = len(acts) < len(resolved)
    if not core and not undecided:
        line = reply.line
        if line is None:
            _fail(
                errors,
                "line",
                "no_line",
                "a reply with only plain acts needs its line, in both languages",
            )
        elif problems := line_errors(line):
            errors += problems
        else:
            cover = _cover(resolved, speaker, script)
            private = _private_terms(speaker, script, cover)
            for lang in LANGUAGES:
                errors += _scan_line(lang, line[lang], private, cover, acts, speaker, script)
    errors.sort(key=lambda e: (ERROR_TYPES.index(e.type), e.where, e.code, e.detail))
    paths = tuple(act.path for act in reply.acts)
    if errors:
        return Gated(False, tuple(errors), fixes=reply.fixes, paths=paths)
    if core:
        try:
            said = _write(resolved, speaker, reply, script.lexicon)
        except (LinesError, KeyError) as exc:
            error = Error("path", "acts", "unsayable", f"the core has no words for it: {exc}"[:160])
            return Gated(False, (error,), fixes=reply.fixes, paths=paths)
        by = "core"
    else:
        assert reply.line is not None
        said, by = dict(reply.line), "model"
    return Gated(
        True,
        (),
        by,
        said,
        reply.mood,
        reply.address,
        tuple(r.claim for r in resolved if r.claim is not None),
        tuple(made[pid] for pid in sorted(made)),
        tuple(r.act.template for r in resolved if r.prop is None and r.act.template is not None),
        reply.fixes,
        paths,
    )
