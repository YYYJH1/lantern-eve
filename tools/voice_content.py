"""Check the voices of the townsfolk and compile them.

Build time only, like ``sentence_content``: the core never imports pydantic or yaml. This module is
called by ``check_content.validate`` and adds two outputs to what that function makes:

- ``voices.json`` for ``content/lines/*.yaml``, one file for each person of the cast.
- ``core/lantern_core/world/bridge/voice_data.py``, the same document as Python data, because the
  core cannot read a file and the browser loads it as a wheel. The module is generated and checked
  for staleness like the JSON, and a test holds it equal to the JSON.

A voice is the way one person says the fixed words of the town (the codes of ``phrases.py``) and
the frames that wrap what they tell (``seen``, ``heard`` and the rest of ``sentences.yaml``), with
the words they hedge a guess in. Each has at least two variants in both languages, and the core
picks one by the person, the tick and the kind (``world.bridge.voices``).

What is checked, in short: every person of the cast has a file, and every file is a person of the
cast; every code of ``phrases.py`` and every frame has at least two variants, each in both
languages; the Chinese is Chinese and the English is not; a variant has no semicolon, no dash and
no chain of comma clauses; it ends a sentence the same way in both languages (a question stays a
question); a frame writes the slots it needs once and the same slots in both languages, and
never starts a sentence with a name that may begin with "the"; the hedges are at least two, and
each reads after "I"; no two people say the same code, or the same frame, in the same words; no
person says two codes in the same words, so that the words tell the line; and no variant repeats
the plain words of the core (``phrases.py``, the frames of ``sentences.yaml``).

A person may also have a table of the names they use for other people (``call``, after
``voice``): ``{cast id: {zh, en}}``, such as 老二 for the second son, said by the mother. The words
that name someone inside what a person says are made with that person's table
(``world.bridge.voices``), and anyone the table does not list goes by the name of the cast. A table
may also name a family of the cast: a family speaking of itself says 我们家 ("our family"). What
is checked: each key is a person of the cast other than the speaker (and not ``player``, whom
everyone calls the manager) or a family of the cast, each name is a few bare words in each
language (the Chinese is Chinese and the English is not, no slot, no punctuation of a sentence, no
pronoun for a person), no two keys share a name in a language, no name is the cast's own name for
someone else, and only a member of a family calls it 我们家. A person without a table has no
``call`` in the compiled document.

The ten people who carry the five days have three lists more in their files (see
``world.bridge.roles``): ``greet`` and ``chat`` (what they say as a talk opens and as the manager
leaves) and ``epilogue`` (what is said of them on the ending page). Each is a series of entries in
the order they are tried, with the conditions under which the entry is the one (``when``, checked
by ``check_content`` against the terms of ``ROLE_TERMS`` and the flags of the script) and its
words: ``lines``, one or more variants, for ``greet`` and ``chat``, and ``text`` for
``epilogue``. What is checked for them, in short: the ids are words and not repeated, the last
entry of a list has no condition (so that one always holds), each text is Chinese and English and
ends a sentence the same way in both, has no semicolon, no dash, no pronoun for a person, no slot,
and is short enough (a line of a bubble, an epilogue of two sentences), no person says one text
twice or says in a list the words of one of their fixed lines, and no two people say the same words
in the lists; a person who has one list has all three.
"""

from __future__ import annotations

import importlib.util
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

from pydantic import Field, ValidationError

import sentence_content as sc
import town_content
from lantern_core import canon
from lantern_core.cognition._fields import ShapeError
from lantern_core.cognition.lexicon import CLASSES, Lexicon, blank, normalise, scan

MODULE = "core/lantern_core/world/bridge/voice_data.py"
PHRASES_FILE = "core/lantern_core/world/bridge/phrases.py"
MIN_VARIANTS = 2
MIN_HEDGES = 2
LINE_LIMIT = {"zh": 60, "en": 140}  # characters of a fixed line
# the fixed lines that name a person (the one they point to), the goods of a promise or the thing of
# a gift, and the slots each writes once (``phrases.NAMED``, ``phrases.GOODS`` and ``phrases.GIFT``
# say the same, a test holds them)
LINE_SLOTS = {
    "point_heard": {"name"},
    "point_hub": {"name"},
    "promise_open": {"amount", "item", "when"},
    "goods_enough": {"item"},
    "gift_like": {"item"},
    "gift_neutral": {"item"},
    "gift_dislike": {"item"},
}
FRAME_LIMIT = {"zh": 40, "en": 90}  # characters of a frame, apart from its slots
CALL_LIMIT = {"zh": 12, "en": 40}  # characters of a name one person uses for another
CALL_PLAYER = "player"  # whom everyone calls the manager, so that no table lists them
OWN_FAMILY = {"zh": "我们家", "en": "our family"}  # what a member of a family calls it
# what a name may hold: Chinese or English letters and, in English, digits, spaces, apostrophes
# and the hyphen of a compound. Nothing that ends or splits a sentence, and no slot or quotation.
CALL_BARE = {
    "zh": re.compile(r"[^\W\d_]+"),
    "en": re.compile(r"[A-Za-z][A-Za-z0-9' \-]*"),
}
# frame -> the slots it must write, once each. A guess writes its hedge in every variant, in
# both languages, so that the two languages say the same thing.
FRAME_NEEDS = {
    "seen": {"line"},
    "heard": {"line", "teller"},
    "unknown": {"line"},
    "own": {"line"},
    "guess_own": {"line", "hedge"},
    "guess_heard": {"line", "teller", "hedge"},
    "guess_unknown": {"line", "hedge"},
    "rival": {"line", "teller"},  # said after the belief a person holds: who told them else
    "known": {"line"},  # a thing seen that the whole town knows
}
FRAMES = tuple(FRAME_NEEDS)
assert set(FRAMES) == set(sc.FRAME_SLOTS)  # one table of frames, here and in sentence_content
END = {"zh": "。！？…）", "en": ".!?…)"}
# The lists of the people who carry the days (``world.bridge.roles``), and what they are held to.
ROLE_LISTS = ("greet", "chat", "epilogue")
EPILOGUE_LIMIT = {"zh": 90, "en": 230}  # characters of an epilogue: one or two sentences
EPILOGUE_SENTENCES = 2
PRONOUNS = {"zh": re.compile("[他她]"), "en": re.compile(r"\b(?:he|she|his|her|hers|him)\b", re.I)}
NAMES = ("Boatman He",)  # names that read as a pronoun in English
ID = re.compile(r"[a-z][a-z0-9_]*\Z")
# The terms of the people's own that a condition of a list may use, with their arguments (the
# core's ``roles.TERMS`` has the same names, and a test holds them equal).
ROLE_TERMS: dict[str, dict[str, str]] = {
    "acquainted": {"is": "meeting"},
    "promised": {"state": "pledge_state"},
    "knows": {"props": "claims", "min?": "int"},
    "stopped": {},
    "cleared": {},
    "told_cause": {"is": "cause"},
}
# The terms of the tasks that a list may use as well: they speak of the town in public. The terms
# that read what the manager holds (``note``, ``evidence``), the events the agenda keeps and the
# minutes of a window are not here.
ROLE_AGENDA_TERMS = (
    "flag", "after", "hours", "window", "weather", "grudge", "commitment", "eased", "called",
    "meeting", "work", "crew", "helpers",
)  # fmt: skip
MEETINGS = ("new", "today", "earlier")  # the values of ``acquainted``
CAUSES = ("boat", "flood", "drunk")  # the values of ``told_cause``
KNOWABLE = ("pr_set_straight",)  # the claims a list may ask whether a person knows
# The terms that read what a person believes or how far they trust: none of them for a person some
# story blames (``roles.CULPRITS``), since whoever the truth blames takes no stand in public.
BELIEF_TERMS = ("knows",)
BANNED = ("；", ";", "—", "–", "―", "－", "--", " - ")
SENTENCE = {"zh": re.compile(r"[。！？]"), "en": re.compile(r"[.!?]")}
COMMA = {"zh": "，", "en": ","}
COMMAS_PER_SENTENCE = {"zh": 1, "en": 2}
ASCII_PUNCTUATION = re.compile(r"[,.!?:;()]")
LETTERS = re.compile(r"[A-Za-z]")
SLOT = sc.SLOT
THE = re.compile(r"^\s*the\s+", re.I)
SENTENCE_END = re.compile(r"[.!?]\s*$")
NOT_LETTER = re.compile(r"[\W_]+")
HEDGE_EN = re.compile(r"I[ ']")  # "I guess", "I'd say": it reads after "and" and starts a sentence


class Mood(sc.Strict):
    """An entry of ``greet`` or ``chat``: the conditions, and the variants of what is said."""

    id: str
    when: list[dict[str, Any]] = Field(default_factory=list)
    lines: list[sc.Pair]


class After(sc.Strict):
    """An entry of ``epilogue``: the conditions, and the one or two sentences."""

    id: str
    when: list[dict[str, Any]] = Field(default_factory=list)
    text: sc.Pair


class VoiceFile(sc.Strict):
    person: str
    voice: sc.Pair
    call: dict[str, sc.Pair] = Field(default_factory=dict)
    lines: dict[str, list[sc.Pair]]
    frames: dict[str, list[sc.Pair]]
    hedges: list[sc.Pair]
    greet: list[Mood] = Field(default_factory=list)
    chat: list[Mood] = Field(default_factory=list)
    epilogue: list[After] = Field(default_factory=list)


# --------------------------------------------------------------------------------------
# Loading what the checker compares the voices with
# --------------------------------------------------------------------------------------


def load_phrases(root: Path) -> dict[str, dict[str, str]]:
    """The ``PHRASES`` of the core, read from the file so that the tool needs no generated module.

    ``phrases.py`` imports nothing but ``__future__``, so it can be loaded by itself.
    """
    path = root / PHRASES_FILE
    if not path.exists():
        return {}
    spec = importlib.util.spec_from_file_location("lantern_phrases_file", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return dict(module.PHRASES)


def cast_people(casts: dict[str, Any]) -> list[str]:
    """The ids of the people of the bridge cast, in the order of the file."""
    cast = casts.get(town_content.SCENARIOS["bridge"][1])
    people = cast.get("people") if isinstance(cast, dict) else None
    if not isinstance(people, list):
        return []
    return [p["id"] for p in people if isinstance(p, dict) and isinstance(p.get("id"), str)]


def cast_names(casts: dict[str, Any]) -> dict[str, dict[str, str]]:
    """The name of each person of the bridge cast in both languages, as the cast gives it."""
    cast = casts.get(town_content.SCENARIOS["bridge"][1])
    people = cast.get("people") if isinstance(cast, dict) else None
    if not isinstance(people, list):
        return {}
    return {
        p["id"]: {"zh": p["zh"], "en": p["en"]}
        for p in people
        if isinstance(p, dict) and all(isinstance(p.get(k), str) for k in ("id", "zh", "en"))
    }


def load_lexicon(speech: Any) -> Lexicon | None:
    """The words that the check of a reply looks for, read from the raw ``speech.yaml``, or None
    where it is missing or malformed (``speech_content`` says what is wrong with it)."""
    if not isinstance(speech, dict) or not speech:
        return None
    try:
        return Lexicon(speech)
    except (ShapeError, KeyError, TypeError, AttributeError):
        return None


def cast_families(casts: dict[str, Any]) -> dict[str, str | None]:
    """The family of each person of the bridge cast (None for a person of no family)."""
    cast = casts.get(town_content.SCENARIOS["bridge"][1])
    people = cast.get("people") if isinstance(cast, dict) else None
    if not isinstance(people, list):
        return {}
    return {
        p["id"]: p.get("family") if isinstance(p.get("family"), str) else None
        for p in people
        if isinstance(p, dict) and isinstance(p.get("id"), str)
    }


def cast_script(casts: dict[str, Any]) -> str | None:
    """The id of the script that the bridge cast names, whose flags the lists are written in."""
    cast = casts.get(town_content.SCENARIOS["bridge"][1])
    script = cast.get("script") if isinstance(cast, dict) else None
    return script if isinstance(script, str) else None


# --------------------------------------------------------------------------------------
# One variant
# --------------------------------------------------------------------------------------


def _text_problems(at: str, lang: str, text: str) -> list[str]:
    """What is wrong with the words of one language of a variant, apart from its slots."""
    out: list[str] = []
    bare = SLOT.sub("", text)
    if text != text.strip() or "  " in text:
        out.append(f"{at} ({lang}): stray spaces in {text!r}")
    if not text.strip() or text.rstrip()[-1] not in END[lang]:
        out.append(f"{at} ({lang}): must end a sentence with one of {END[lang]!r}, got {text!r}")
    for banned in BANNED:
        if banned in text:
            out.append(f"{at} ({lang}): {banned.strip()!r} is not allowed, got {text!r}")
    if lang == "zh":
        if ASCII_PUNCTUATION.search(bare) or LETTERS.search(bare):
            out.append(f"{at} (zh): write Chinese punctuation and no Latin letters, got {text!r}")
    elif "…" in text:
        out.append(f"{at} (en): write an ellipsis as three full stops, got {text!r}")
    commas = max((s.count(COMMA[lang]) for s in SENTENCE[lang].split(bare)), default=0)
    if commas > COMMAS_PER_SENTENCE[lang]:
        out.append(f"{at} ({lang}): a chain of comma clauses, split it into sentences: {text!r}")
    return out


def _pair_problems(at: str, pair: sc.Pair) -> list[str]:
    """The checks that every variant meets, whatever it is for."""
    out = sc._language_problems(at, pair)
    for lang in ("zh", "en"):
        out += _text_problems(at, lang, getattr(pair, lang))
    if ("？" in pair.zh) != ("?" in pair.en):
        out.append(f"{at}: a question in one language must be a question in the other")
    if ("！" in pair.zh) != ("!" in pair.en):
        out.append(f"{at}: an exclamation in one language must be one in the other")
    return out


def _line_problems(at: str, pair: sc.Pair, slots: frozenset[str] = frozenset()) -> list[str]:
    """A fixed line has no slot, except that the lines which name a person write ``slots`` once
    each, and it is short enough for a bubble. A name does not start an English sentence."""
    out = _pair_problems(at, pair)
    for lang in ("zh", "en"):
        text = getattr(pair, lang)
        if slots:
            out += sc._template_problems(f"{at} ({lang})", text, set(slots), set(slots))
            for slot in slots:
                if text.count("{" + slot + "}") != 1:
                    out.append(f"{at} ({lang}): {{{slot}}} must be written once in {text!r}")
        elif re.search(r"[{}\[\]]", text):
            out.append(f"{at} ({lang}): a fixed line has no slots, got {text!r}")
        if len(text) > LINE_LIMIT[lang]:
            out.append(f"{at} ({lang}): longer than {LINE_LIMIT[lang]} characters: {text!r}")
    for match in SLOT.finditer(pair.en):
        if match.start() == 0 or SENTENCE_END.search(pair.en[: match.start()]):
            out.append(f"{at} (en): {{{match.group(1)}}} starts a sentence, put it after a word")
    return out


def _frame_problems(at: str, frame: str, pair: sc.Pair) -> list[str]:
    """A frame writes each slot it needs once, the same slots in both languages, and starts no
    English sentence with a name that may begin with "the" (the core capitalises only the first)."""
    out = _pair_problems(at, pair)
    allowed, _ = sc.FRAME_SLOTS[frame]
    needs = FRAME_NEEDS[frame]
    for lang in ("zh", "en"):
        text = getattr(pair, lang)
        out += sc._template_problems(f"{at} ({lang})", text, allowed, needs)
        if "[" in text or "]" in text:
            out.append(f"{at} ({lang}): a frame has no optional parts")
        for slot in needs:
            if text.count("{" + slot + "}") != 1:
                out.append(f"{at} ({lang}): {{{slot}}} must be written once in {text!r}")
        if len(SLOT.sub("", text)) > FRAME_LIMIT[lang]:
            out.append(f"{at} ({lang}): longer than {FRAME_LIMIT[lang]} characters: {text!r}")
    if set(SLOT.findall(pair.zh)) != set(SLOT.findall(pair.en)):
        out.append(f"{at}: the two languages write different slots")
    for match in SLOT.finditer(pair.en):
        if match.group(1) != "hedge" and SENTENCE_END.search(pair.en[: match.start()]):
            out.append(f"{at} (en): {{{match.group(1)}}} starts a sentence, put it after a word")
    return out


def _variants(
    at: str, variants: list[sc.Pair], check_one: Callable[[str, sc.Pair], list[str]]
) -> list[str]:
    """The checks of a list of variants: enough of them, each good, and no two alike."""
    out: list[str] = []
    if len(variants) < MIN_VARIANTS:
        out.append(f"{at}: needs at least {MIN_VARIANTS} variants, has {len(variants)}")
    for i, pair in enumerate(variants):
        out += check_one(f"{at} #{i + 1}", pair)
    for lang in ("zh", "en"):
        texts = [_normal(getattr(p, lang)) for p in variants]
        if len(set(texts)) != len(texts):
            out.append(f"{at} ({lang}): two variants are the same")
    return out


def _normal(text: str) -> str:
    """The words of a variant without punctuation, spaces or case, to tell if two are alike."""
    return NOT_LETTER.sub("", text).lower()


# --------------------------------------------------------------------------------------
# One person, and everyone
# --------------------------------------------------------------------------------------


def _hedge_problems(at: str, hedges: list[sc.Pair]) -> list[str]:
    out: list[str] = []
    if len(hedges) < MIN_HEDGES:
        out.append(f"{at}: needs at least {MIN_HEDGES} hedges, has {len(hedges)}")
    for i, pair in enumerate(hedges):
        here = f"{at} #{i + 1}"
        out += sc._language_problems(here, pair)
        for lang in ("zh", "en"):
            text = getattr(pair, lang)
            if text != text.strip() or re.search(r"[{}\[\].!?,，。！？]", text):
                out.append(f"{here} ({lang}): a hedge is bare words, got {text!r}")
        if not HEDGE_EN.match(pair.en):
            out.append(f"{here} (en): a hedge is a clause that starts with I, got {pair.en!r}")
    for lang in ("zh", "en"):
        texts = [getattr(p, lang) for p in hedges]
        if len(set(texts)) != len(texts):
            out.append(f"{at} ({lang}): two hedges are the same")
    return out


def _bare(lang: str, text: str) -> str:
    """A name without punctuation, spaces or case, and in English without a leading "the"."""
    return _normal(THE.sub("", text) if lang == "en" else text)


def _class_word_problems(at: str, lang: str, text: str, lexicon: Lexicon) -> list[str]:
    """The words of the six classes that a name holds. The check of a reply looks for them in a
    line wherever they stand, so a name that holds one would be refused each time it is used."""
    found = normalise(text)
    out = []
    for word_class in CLASSES:
        masked = blank(found, scan(found, lexicon.masks[word_class]))
        for _, form, _ in scan(masked, lexicon.classes[word_class]):
            out.append(
                f"{at} ({lang}): the name holds {form!r}, a {word_class} word that the check of "
                f"a reply looks for"
            )
    return out


def _call_problems(
    person: str,
    vf: VoiceFile,
    people: list[str],
    names: dict[str, dict[str, str]],
    lexicon: Lexicon | None,
    families: dict[str, str | None] | None = None,
) -> list[str]:
    """The names a person uses for others: whom they name, and what a name may be. A name is the
    words the person says for someone, so it is a few bare words in each language. A family is
    我们家 to its own members and to nobody else."""
    out: list[str] = []
    families = families or {}
    family_ids = {f for f in families.values() if f is not None}
    own = families.get(person)
    for other, pair in sorted(vf.call.items()):
        at = f"lines/{person}.yaml: call {other}"
        if other == CALL_PLAYER:
            out.append(f"{at}: everyone calls the manager the same, so no table names {other}")
        elif other == person:
            out.append(f"{at}: a person does not name themself")
        elif other not in people and other not in family_ids:
            out.append(f"{at}: {other} is not a person or a family of the cast")
        for lang in ("zh", "en"):
            if getattr(pair, lang) == OWN_FAMILY[lang] and other != own:
                out.append(f"{at} ({lang}): only a member of {other} calls it {OWN_FAMILY[lang]!r}")
        out += sc._language_problems(at, pair)
        for lang in ("zh", "en"):
            text = getattr(pair, lang)
            if text != text.strip() or "  " in text:
                out.append(f"{at} ({lang}): stray spaces in {text!r}")
            elif not CALL_BARE[lang].fullmatch(text) or (lang == "zh" and LETTERS.search(text)):
                out.append(f"{at} ({lang}): a name is bare words, got {text!r}")
            if any(banned in text for banned in BANNED):
                out.append(f"{at} ({lang}): no dash in a name, got {text!r}")
            if len(text) > CALL_LIMIT[lang]:
                out.append(f"{at} ({lang}): longer than {CALL_LIMIT[lang]} characters: {text!r}")
            if has_pronoun(lang, text):
                out.append(f"{at} ({lang}): a person is never he or she, got {text!r}")
            if lexicon is not None:
                out += _class_word_problems(at, lang, text, lexicon)
            for named, name in sorted(names.items()):
                if named != other and _bare(lang, text) == _bare(lang, name[lang]):
                    out.append(f"{at} ({lang}): {text!r} is the name of {named}, not of {other}")
    for lang in ("zh", "en"):
        seen: dict[str, str] = {}
        for other, pair in sorted(vf.call.items()):
            key = _bare(lang, getattr(pair, lang))
            first = seen.setdefault(key, other)
            if first != other:
                out.append(
                    f"lines/{person}.yaml: call {first} and {other} are the same name ({lang}): "
                    f"{getattr(pair, lang)!r}"
                )
    return out


def _voice_problems(
    person: str,
    vf: VoiceFile,
    codes: dict[str, Any],
    plain_frames: dict[str, Any],
    people: list[str],
    names: dict[str, dict[str, str]],
    lexicon: Lexicon | None,
    families: dict[str, str | None] | None = None,
) -> list[str]:
    where = f"lines/{person}.yaml"
    out = sc._language_problems(f"{where}: voice", vf.voice)
    out += _call_problems(person, vf, people, names, lexicon, families)
    for code in sorted(set(codes) - set(vf.lines)):
        out.append(f"{where}: no lines for '{code}'")
    for code in sorted(set(vf.lines) - set(codes)):
        out.append(f"{where}: '{code}' is not a phrase of the core")
    for frame in sorted(set(FRAMES) - set(vf.frames)):
        out.append(f"{where}: no frame '{frame}'")
    for frame in sorted(set(vf.frames) - set(FRAMES)):
        out.append(f"{where}: '{frame}' is not a frame of the town")
    for code in sorted(set(codes) & set(vf.lines)):
        slots = frozenset(LINE_SLOTS.get(code, ()))

        def check_line(at: str, pair: sc.Pair, slots: frozenset[str] = slots) -> list[str]:
            return _line_problems(at, pair, slots)

        out += _variants(f"{where}: {code}", vf.lines[code], check_line)
        out += _plain_problems(f"{where}: {code}", vf.lines[code], codes[code])
    for frame in sorted(set(FRAMES) & set(vf.frames)):

        def check_frame(at: str, pair: sc.Pair, frame: str = frame) -> list[str]:
            return _frame_problems(at, frame, pair)

        out += _variants(f"{where}: frame {frame}", vf.frames[frame], check_frame)
        plain = plain_frames.get(frame)
        if isinstance(plain, dict) and all(isinstance(plain.get(k), str) for k in ("zh", "en")):
            out += _plain_problems(f"{where}: frame {frame}", vf.frames[frame], plain)
    out += _hedge_problems(f"{where}: hedges", vf.hedges)
    out += _kinds_apart_problems(where, vf)
    out += _role_problems(person, vf)
    return out


def _plain_problems(at: str, variants: list[sc.Pair], plain: dict[str, str]) -> list[str]:
    """A voice never repeats the plain words of the core, so that every line is the person's own."""
    return [
        f"{at} ({lang}): the same words as the plain voice: {plain[lang]!r}"
        for pair in variants
        for lang in ("zh", "en")
        if _normal(getattr(pair, lang)) == _normal(plain[lang])
    ]


def _kinds_apart_problems(where: str, vf: VoiceFile) -> list[str]:
    """A person never says two different fixed lines in the same words, so that the words tell
    the line."""
    out: list[str] = []
    for lang in ("zh", "en"):
        seen: dict[str, str] = {}
        for code in sorted(vf.lines):
            for pair in vf.lines[code]:
                key = _normal(getattr(pair, lang))
                other = seen.setdefault(key, code)
                if other != code:
                    out.append(f"{where}: '{other}' and '{code}' are the same words ({lang})")
    return out


def has_pronoun(lang: str, text: str) -> bool:
    """Whether a text calls a person he or she (a name that reads as a pronoun does not)."""
    for name in NAMES:
        text = text.replace(name, "")
    return PRONOUNS[lang].search(text) is not None


def _role_text_problems(at: str, pair: sc.Pair, kind: str) -> list[str]:
    """What a text of a list of the people who carry the days must meet: what any variant meets, no
    slot, no pronoun for a person, short enough, and for an epilogue at most two sentences."""
    out = _pair_problems(at, pair)
    for lang in ("zh", "en"):
        text = getattr(pair, lang)
        if re.search(r"[{}\[\]]", text):
            out.append(f"{at} ({lang}): there are no slots in these lists, got {text!r}")
        if has_pronoun(lang, text):
            out.append(f"{at} ({lang}): a person is never he or she, got {text!r}")
        limit = EPILOGUE_LIMIT[lang] if kind == "epilogue" else LINE_LIMIT[lang]
        if len(text) > limit:
            out.append(f"{at} ({lang}): longer than {limit} characters: {text!r}")
        if kind == "epilogue" and len(SENTENCE[lang].findall(text)) > EPILOGUE_SENTENCES:
            out.append(f"{at} ({lang}): an epilogue is at most {EPILOGUE_SENTENCES} sentences")
    return out


def _role_texts(vf: VoiceFile) -> list[tuple[str, str, sc.Pair]]:
    """Every text of the lists of a person: ``(kind, where it is, the pair)``."""
    found: list[tuple[str, str, sc.Pair]] = []
    for kind in ("greet", "chat"):
        for entry in getattr(vf, kind):
            for number, pair in enumerate(entry.lines, 1):
                found.append((kind, f"{kind} {entry.id} #{number}", pair))
    for entry in vf.epilogue:
        found.append(("epilogue", f"epilogue {entry.id}", entry.text))
    return found


def _role_problems(person: str, vf: VoiceFile) -> list[str]:
    """The lists of one person: all three or none, well formed, and no text said twice."""
    where = f"lines/{person}.yaml"
    out: list[str] = []
    present = [kind for kind in ROLE_LISTS if getattr(vf, kind)]
    if present and len(present) != len(ROLE_LISTS):
        missing = ", ".join(sorted(set(ROLE_LISTS) - set(present)))
        out.append(f"{where}: a person who carries the days has all three lists, missing {missing}")
    for kind in present:
        entries = getattr(vf, kind)
        ids = [entry.id for entry in entries]
        for entry_id in sorted({i for i in ids if ids.count(i) > 1}):
            out.append(f"{where}: {kind} has the id '{entry_id}' twice")
        for entry in entries:
            if not ID.match(entry.id):
                out.append(f"{where}: {kind} id '{entry.id}' is not a lower-case snake_case word")
        if entries[-1].when:
            out.append(f"{where}: the last entry of {kind} has no condition, so that one holds")
        for entry in entries[:-1]:
            if not entry.when:
                out.append(f"{where}: {kind} '{entry.id}' has no condition and is not the last")
    for kind, at, pair in _role_texts(vf):
        out += _role_text_problems(f"{where}: {at}", pair, kind)
    fixed = [pair for variants in vf.lines.values() for pair in variants]
    for lang in ("zh", "en"):
        seen: dict[str, str] = {_normal(getattr(pair, lang)): "a fixed line" for pair in fixed}
        for _, at, pair in _role_texts(vf):
            key = _normal(getattr(pair, lang))
            other = seen.setdefault(key, at)
            if other != at:
                out.append(f"{where}: {at} and {other} are the same words ({lang})")
    return out


def _role_distinct_problems(voices: dict[str, VoiceFile]) -> list[str]:
    """No two people say the same words in the lists: the voices must tell apart."""
    out: list[str] = []
    for lang in ("zh", "en"):
        seen: dict[str, str] = {}
        for person in sorted(voices):
            for _, at, pair in _role_texts(voices[person]):
                key = _normal(getattr(pair, lang))
                other = seen.setdefault(key, f"{person} {at}")
                if other != f"{person} {at}" and not other.startswith(f"{person} "):
                    out.append(f"lines: {other} and {person} {at} are the same words ({lang})")
    return out


def _distinct_problems(voices: dict[str, VoiceFile]) -> list[str]:
    """No two people say a code, or a frame, in the same words: the voices must tell apart."""
    out: list[str] = []
    for table in ("lines", "frames"):
        kinds = sorted({k for vf in voices.values() for k in getattr(vf, table)})
        for kind in kinds:
            for lang in ("zh", "en"):
                seen: dict[str, str] = {}
                for person in sorted(voices):
                    for pair in getattr(voices[person], table).get(kind, []):
                        key = _normal(getattr(pair, lang))
                        other = seen.setdefault(key, person)
                        if other != person:
                            out.append(
                                f"lines: {other} and {person} say {kind} the same way "
                                f"({lang}): {getattr(pair, lang)!r}"
                            )
    return out


def check(
    files: dict[str, Any],
    people: list[str],
    codes: dict[str, Any],
    plain_frames: dict[str, Any],
    errors: list[str],
    names: dict[str, dict[str, str]] | None = None,
    lexicon: Lexicon | None = None,
    families: dict[str, str | None] | None = None,
) -> dict[str, VoiceFile] | None:
    """The voices as models, or ``None`` after appending what is wrong to ``errors``. ``names`` are
    the names of the cast, which no name in a ``call`` table may be for someone else,
    ``lexicon`` the words of the check of a reply, which no such name may hold, and ``families``
    the family of each person of the cast, which their table names."""
    start = len(errors)
    if not files:
        errors.append("lines: no file in content/lines")
        return None
    voices: dict[str, VoiceFile] = {}
    for stem, raw in sorted(files.items()):
        where = f"lines/{stem}.yaml"
        try:
            vf = VoiceFile.model_validate(raw)
        except ValidationError as exc:
            errors += sc.model_errors(where, exc)
            continue
        if vf.person != stem:
            errors.append(f"{where}: the person '{vf.person}' must match the file name")
            continue
        voices[stem] = vf
    for person in sorted(set(people) - set(files)):
        errors.append(f"lines: {person} of the cast has no file")
    for person in sorted(set(voices) - set(people)):
        errors.append(f"lines/{person}.yaml: {person} is not a person of the cast")
    for person, vf in sorted(voices.items()):
        errors += _voice_problems(
            person, vf, codes, plain_frames, people, names or {}, lexicon, families
        )
    errors += _distinct_problems(voices)
    errors += _role_distinct_problems(voices)
    return None if len(errors) > start else voices


# --------------------------------------------------------------------------------------
# Compiling
# --------------------------------------------------------------------------------------


def compile_voices(voices: dict[str, VoiceFile]) -> dict[str, Any]:
    """``{person: {"lines": {code: [pair]}, "frames": {frame: [pair]}, "hedges": {lang: [text]}}}``.

    The note on how a person talks (``voice``) is for whoever edits the files and stays out.
    """
    return {person: _compile_one(vf) for person, vf in sorted(voices.items())}


def _compile_one(vf: VoiceFile) -> dict[str, Any]:
    """One person's compiled voice. The lists of the people who carry the days are there for them
    alone: another person's document has only the three keys of the lists of lines, and ``call``
    only where the person has names of their own for others."""
    doc: dict[str, Any] = {
        "lines": {k: [p.model_dump() for p in v] for k, v in sorted(vf.lines.items())},
        "frames": {k: [p.model_dump() for p in v] for k, v in sorted(vf.frames.items())},
        "hedges": {"en": [h.en for h in vf.hedges], "zh": [h.zh for h in vf.hedges]},
    }
    if vf.call:
        doc["call"] = {other: pair.model_dump() for other, pair in sorted(vf.call.items())}
    for kind in ("greet", "chat"):
        if getattr(vf, kind):
            doc[kind] = [
                {"id": e.id, "when": e.when, "lines": [p.model_dump() for p in e.lines]}
                for e in getattr(vf, kind)
            ]
    if vf.epilogue:
        doc["epilogue"] = [
            {"id": e.id, "when": e.when, "text": e.text.model_dump()} for e in vf.epilogue
        ]
    return doc


def render_module(doc: dict[str, Any]) -> bytes:
    """The text of ``voice_data.py``: the document as JSON in a raw string, read by ``json``."""
    text = town_content.pretty(doc)
    assert '"""' not in text and not text.endswith("\\")
    head = (
        '"""The voices of the townsfolk as Python data.\n\n'
        "``VOICES`` is the compiled document that ``world.bridge.voices`` reads: for each person\n"
        "of the cast, at least two variants in both languages of every fixed line of the town\n"
        "(``lines``) and of every frame that wraps what they tell (``frames``), the words\n"
        "they hedge a guess in (``hedges``), and where they have them the names they use for\n"
        "other people (``call``).\n\n"
        "Generated by tools/check_content.py from content/lines/*.yaml. Do not edit it: change\n"
        "the YAML and run the tool. The core cannot read files, so the compiled content travels\n"
        "inside the package. A test holds it equal to content/compiled/voices.json.\n"
        '"""\n\n'
        "# ruff: noqa: E501\n\n"
        "import json\n\n"
    )
    return (head + f'_VOICES = r"""\n{text}\n"""\n\nVOICES = json.loads(_VOICES)\n').encode("utf-8")


def build(
    files: dict[str, Any],
    casts: dict[str, Any],
    codes: dict[str, Any],
    sentences: dict[str, Any],
    errors: list[str],
    speech: Any = None,
) -> tuple[dict[str, bytes], dict[str, bytes], list[str]]:
    """Check the voices and compile them: (json outputs, generated modules, coverage lines).

    ``codes`` are the fixed lines of the core and ``sentences`` the raw ``sentences.yaml``, whose
    frames are the plain voice that a voice must not repeat. ``speech`` is the raw ``speech.yaml``,
    whose words a name in a ``call`` table must not hold.
    """
    frames = sentences.get("frames") if isinstance(sentences, dict) else None
    voices = check(
        files,
        cast_people(casts),
        codes,
        frames if isinstance(frames, dict) else {},
        errors,
        cast_names(casts),
        load_lexicon(speech),
        cast_families(casts),
    )
    if voices is None:
        return {}, {}, []
    doc = compile_voices(voices)
    pairs = sum(
        len(v) for vf in voices.values() for table in (vf.lines, vf.frames) for v in table.values()
    )
    carrying = [vf for vf in voices.values() if vf.epilogue]
    coverage = [
        f"voices: {len(voices)} people, {len(codes)} fixed lines and {len(FRAMES)} frames each, "
        f"{pairs} variants in two languages",
        f"roles: {len(carrying)} people carry the days, "
        f"{sum(len(vf.greet) for vf in carrying)} greetings, "
        f"{sum(len(vf.chat) for vf in carrying)} last words, "
        f"{sum(len(vf.epilogue) for vf in carrying)} epilogues",
    ]
    callers = [vf for vf in voices.values() if vf.call]
    if callers:
        coverage.append(
            f"calls: {len(callers)} people have names of their own for others, "
            f"{sum(len(vf.call) for vf in callers)} names"
        )
    return {"voices.json": canon.dumps(doc)}, {MODULE: render_module(doc)}, coverage
