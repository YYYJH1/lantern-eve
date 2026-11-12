"""Words for what is said: a prop and how it is said, as a sentence in Chinese and in English.

The townsfolk say nothing that is not a prop, so their words are made from one. The table of
lines (``content/tables/sentences.yaml``, compiled and carried by ``world.bridge.sentences``)
has a template for each predicate and for its denial, a phrase for each motive, the words for
the time of a span and the frames that wrap a sentence by how the speaker knows it. Nothing
here reads a model: the same prop said the same way gives the same words in every host.

A template has slots in braces (``{who}``, ``{what}``, ``{where}``, ``{whom}``) and ``{when}``,
the time of the span, if it has a word. Text in square brackets is dropped whole when a slot
inside it has no value, so an optional slot or a missing time leaves no gap. The frames are
chosen like this, by what the claim names as its source:

- ``self_seen``: "I saw it myself". A guess cannot be seen, so it is a guess of the speaker's. What
  the whole town knows (a predicate the table lists under ``known``: whose a thing is, where it
  stands) is said as that, "everyone knows" (the frame ``known``), not as a thing seen.
- ``unknown``: "I heard that", the source hidden or never known.
- the speaker's own id: "If you ask me", a conclusion of the speaker's.
- another person: "so-and-so told me that", with that person's name.

A guess takes the hedge in place of the plain statement ("I guess", "我猜"), one of the words
the table lists for each language, picked by the caller's number so that speakers vary and a
speaker does not. A frame of its own, ``rival``, is for what a speaker says after the belief they
hold: an account somebody told them and they did not take in (``Lines.rival``).

A motive is said after the statement in a sentence of its own, inside the frame, as the speaker
knows it: told ("They say it was out of envy"), seen or worked out ("That was out of envy") or
guessed. A guess the speaker hedges says the motive with the speaker's other hedge ("八成是李二
昨晚把栏杆弄坏了。我猜是眼红人家出风头"), so that one hedge is not said twice. The narration
(``statement``) joins the motive with a comma.

A place or a thing is said in a sentence by the form the table gives it (``forms``): the bridge
is 桥边 in "在桥边", where the label of the map is 石桥, and the railing "the bridge railing"; a
predicate may say one otherwise (``predicate_forms``: where a thing stands, 栏杆在桥上). A
person a frame names as the one who told (``teller``) and whom the told sentence is about is 自己
in it ("大郎跟我讲，说自己昨晚在家"), and "they" in English. And where the told sentence has its
own 是 (渡船是老何的), the 是 that ends a frame's 说是 or a hedge (八成是) is left out, so that one
sentence does not say 是 twice; a hedge of two characters (怕是) takes the form the table gives it
for that (``bare_hedges``, 恐怕).

The table's frames and hedges are the plain voice. A caller who has the speaker's own wording of
the frame that applies (``frame_key``) and of the hedges passes them to ``say``, which then uses
them in place of the table's. Choosing among a speaker's variants is the caller's business, so
that the words stay a function of what the caller hands in.

Names come from the entities (``Lines.names``): the Chinese label, and the English one with the
article an English sentence wants ("the Stone Bridge", "the Night Watchman", and none for
"Old He's Boat" or "Boatman He").
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from lantern_core.cognition.beliefs import SELF_SEEN, UNKNOWN
from lantern_core.cognition.props import Prop, Registry

LANGUAGES = ("zh", "en")
TOLD_FRAMES = frozenset({"heard", "unknown", "guess_heard", "guess_unknown", "rival"})
LAST_NIGHT, LATELY, THIS_MORNING = "last_night", "lately", "this_morning"
SHORT_SPAN = 480  # minutes: a span longer than this, before the game, is "the past few days"
GAME_STARTS = 360  # minute 360 is 06:00 of day 1, tick 0

_SLOT = re.compile(r"\{(\w+)\}")
_GROUP = re.compile(r"\[([^\[\]]*)\]")
# said once in a sentence: a frame's 说是 or a hedge's 是 goes where the line has its own
COPULA = "是"
SAID_IS = "说是{line}"
HEDGED = "{hedge}"
# what a person a frame names as the one who told is in the sentence they told, in each language;
# the English subject takes a plural verb ("they were"), which ``_agree`` puts right
TELLER_SELF = {"zh": "自己", "en": ("they", "them")}
_AGREE = (("they was ", "they were "), ("they keeps ", "they keep "), ("they is ", "they are "))


class LinesError(ValueError):
    """A prop that the table of lines has no words for."""


def fill(template: str, values: Mapping[str, str]) -> str:
    """``template`` with its slots filled; a bracketed part is dropped if a slot in it is empty."""

    def optional(match: re.Match[str]) -> str:
        inner = match.group(1)
        if any(not values.get(name) for name in _SLOT.findall(inner)):
            return ""
        return _SLOT.sub(lambda m: values[m.group(1)], inner)

    kept = _GROUP.sub(optional, template)
    return _SLOT.sub(lambda m: values.get(m.group(1)) or "", kept)


def when_key(span: tuple[int, int] | None) -> str | None:
    """Which words a span has: it ended before the game (a night, or longer), or just before the
    morning of the first day. A span that runs on into the game has none."""
    if span is None:
        return None
    start, end = span
    if end <= 0:
        return LAST_NIGHT if end - start <= SHORT_SPAN else LATELY
    if end <= GAME_STARTS:
        return THIS_MORNING
    return None


def _myself(lang: str, subject: bool) -> str:
    """How the speaker names themselves: 我, and in English I as the subject, else me."""
    if lang == "zh":
        return "我"
    return "I" if subject else "me"


def _themself(lang: str, subject: bool) -> str:
    """How a told sentence names the one who told it: 自己, and in English they or them."""
    if lang == "zh":
        return TELLER_SELF["zh"]
    subject_form, object_form = TELLER_SELF["en"]
    return subject_form if subject else object_form


def _agree(text: str) -> str:
    """The English verb after a "they" that stands for one person, which wants the plural."""
    for single, plural in _AGREE:
        if text.startswith(single):
            return plural + text[len(single) :]
    return text


def _one_copula(
    template: str, hedge: str, line: str, bare: Mapping[str, str] | None = None
) -> tuple[str, str]:
    """``template`` and ``hedge`` without the 是 that ends 说是 or the hedge, where ``line`` (the
    Chinese of the told sentence, without its motive) has a 是 of its own. A hedge of two characters
    would be left with one (怕是), so it takes its form of ``bare`` (恐怕) instead."""
    if COPULA not in line:
        return template, hedge
    template = template.replace(SAID_IS, SAID_IS.replace(COPULA, "", 1))
    if bare and hedge in bare:
        hedge = bare[hedge]
    elif hedge.endswith(COPULA) and len(hedge) > len(COPULA) + 1:
        hedge = hedge[: -len(COPULA)]
    return template, hedge


def capitalise(text: str) -> str:
    return text[:1].upper() + text[1:]


def frame_key(modality: str, claimed_source: str, speaker: str, known: bool = False) -> str:
    """Which frame wraps what ``speaker`` says in ``modality``, naming ``claimed_source``. A thing
    seen that the whole town knows (``known``) has the frame ``known``."""
    guess = modality == "speculate"
    if claimed_source == UNKNOWN:
        return "guess_unknown" if guess else "unknown"
    if claimed_source == SELF_SEEN and not guess:
        return "known" if known else "seen"
    if claimed_source in (SELF_SEEN, speaker):
        return "guess_own" if guess else "own"
    return "guess_heard" if guess else "heard"


class Lines:
    """The table of lines, and the sentences it makes."""

    __slots__ = ("_data", "_the", "homes")

    def __init__(self, data: Mapping[str, Any]) -> None:
        self._data = data
        self._the = frozenset(data["the"])
        # person -> the place that is their home. A line of a predicate that has a ``home`` form
        # (``at``) says "at home" where the place is the home of the person it is about.
        self.homes: Mapping[str, str] = {}

    # -- names -----------------------------------------------------------------------------

    def names(self, registry: Registry) -> dict[str, dict[str, str]]:
        """``{entity id: {"zh": label, "en": label with its article}}`` for every entity."""
        out: dict[str, dict[str, str]] = {}
        for entity in registry:
            label = entity.label_en or entity.id
            if label.startswith("The "):
                label = "the " + label[4:]
            elif self._takes_the(entity.type, entity.id, label):
                label = "the " + label
            out[entity.id] = {"zh": entity.label, "en": label}
        return out

    def _takes_the(self, kind: str, entity_id: str, label: str) -> bool:
        """Whether the English name wants "the": families, the people the table lists, and things
        and places unless the name is a possessive ("Old He's Boat")."""
        if kind == "person":
            return entity_id in self._the
        return kind == "family" or "'s" not in label

    def is_known(self, prop: Prop) -> bool:
        """Whether the prop is of a kind the whole town knows (``known`` of the table)."""
        return prop.pred in self._data.get("known", ())

    def _at_home(self, prop: Prop) -> bool:
        """Whether the prop puts a person in their own home."""
        args = dict(prop.args)
        return "who" in args and "where" in args and self.homes.get(args["who"]) == args["where"]

    # -- sentences -------------------------------------------------------------------------

    def statement(
        self,
        prop: Prop,
        names: Mapping[str, Mapping[str, str]],
        speaker: str | None = None,
        *,
        motive: bool = True,
        teller: str | None = None,
    ) -> dict[str, str]:
        """The prop alone in both languages, in lower case and without a full stop.

        A denial uses the denial of its predicate. A motive follows the statement, after a comma,
        unless ``motive`` is false: what a person says has it as a sentence of its own
        (``say``). A place or a thing is said by its form (``forms``) where the table has one, or by
        the form the predicate gives it (``predicate_forms``).
        A ``speaker`` who is named in the prop says "I" and "me" (我) for themselves, and the
        ``teller`` whose words the sentence passes on is 自己 in it ("they" in English).
        """
        entry = self._data["predicates"].get(prop.pred)
        if entry is None:
            raise LinesError(f"no line for the predicate {prop.pred!r}")
        key = when_key(prop.span)
        forms = self._data.get("forms", {})
        own = self._data.get("predicate_forms", {}).get(prop.pred)
        if own:
            forms = {**forms, **own}
        out: dict[str, str] = {}
        for lang in LANGUAGES:
            values = {slot: names[entity][lang] for slot, entity in prop.args if entity in names}
            for slot, entity in prop.args:
                if entity in forms:
                    values[slot] = forms[entity][lang]
            values["when"] = "" if key is None else self._data["when"][key][lang]
            line = entry["home"] if "home" in entry and self._at_home(prop) else entry
            template = (line["neg"] if prop.neg else line)[lang]
            for slot, entity in prop.args:
                subject = template.startswith("{" + slot + "}")
                if entity == speaker:
                    values[slot] = _myself(lang, subject)
                elif teller is not None and entity == teller:
                    values[slot] = _themself(lang, subject)
            text = fill(template, values)
            if lang == "en":
                text = _agree(text)
            phrase = self._motive(prop) if motive else None
            if phrase is not None:
                text += ("，" if lang == "zh" else ", ") + phrase[lang]
            out[lang] = text
        return out

    def _motive(self, prop: Prop) -> Mapping[str, str] | None:
        """The words for the motive of ``prop``, or None for a prop with none or a denial."""
        if prop.motive is None or prop.neg:
            return None
        phrase = self._data["motives"].get(prop.motive)
        if phrase is None:
            raise LinesError(f"no phrase for the motive {prop.motive!r}")
        return phrase

    def _apart(
        self,
        prop: Prop,
        way: str,
        statement: Mapping[str, str],
        hedge: Mapping[str, str] | None = None,
    ) -> dict[str, str]:
        """``statement`` (made without its motive) followed by the motive of ``prop`` as a sentence
        of its own, which the frame closes with its full stop. ``way`` says how the speaker knows
        it: ``told`` by somebody, ``own`` (seen or worked out), or ``guess``, said with ``hedge``,
        the speaker's other hedge (a hedge that ends in 是 does not say it twice)."""
        phrase = self._motive(prop)
        if phrase is None:
            return dict(statement)
        said = self._data["motive_said"][way]
        out = {}
        for lang in LANGUAGES:
            values = {"motive": phrase[lang], "hedge": "" if hedge is None else hedge[lang]}
            sentence = fill(said[lang], values)
            if lang == "zh":
                sentence = sentence.replace(COPULA * 2, COPULA)
            out[lang] = statement[lang] + ("。" if lang == "zh" else ". ") + capitalise(sentence)
        return out

    def say(
        self,
        prop: Prop,
        names: Mapping[str, Mapping[str, str]],
        *,
        modality: str,
        claimed_source: str,
        speaker: str,
        pick: int = 0,
        frame: Mapping[str, str] | None = None,
        hedges: Mapping[str, Sequence[str]] | None = None,
    ) -> dict[str, str]:
        """What ``speaker`` says in saying ``prop`` in ``modality``, naming ``claimed_source``.

        The sentence is complete: framed by how the speaker knows it, with its full stop, and
        the English capitalised. The motive, if the prop has one, is a sentence of its own after
        the statement and inside the frame. ``pick`` chooses the hedge of a guess among the words
        listed. ``frame`` is the speaker's own wording of the frame ``frame_key`` names, and
        ``hedges`` their own hedge words in each language. Without them the table's are used.
        """
        key = frame_key(modality, claimed_source, speaker, self.is_known(prop))
        template = frame or self._data["frames"][key]
        words = self._data["hedges"] if hedges is None else hedges
        # a guess the speaker hedges says its motive with the speaker's other hedge
        hedged = any(HEDGED in template[lang] for lang in LANGUAGES)
        way = "guess" if hedged else ("told" if key in TOLD_FRAMES else "own")
        other = {lang: words[lang][(pick + 1) % len(words[lang])] for lang in LANGUAGES}
        # the one who told it is 自己 in what they told, where the frame passes on their words (a
        # guess the speaker hedges is the speaker's own sentence, and names them)
        reported = key == "heard" or (key == "guess_heard" and not hedged)
        teller_id = claimed_source if reported else None
        bare = self.statement(prop, names, speaker, motive=False, teller=teller_id)
        statement = self._apart(prop, way, bare, other if hedged else None)
        out: dict[str, str] = {}
        for lang in LANGUAGES:
            hedge_words = words[lang]
            teller = names.get(claimed_source, {}).get(lang, claimed_source)
            text_frame, hedge = template[lang], hedge_words[pick % len(hedge_words)]
            if lang == "zh":
                text_frame, hedge = _one_copula(
                    text_frame, hedge, bare[lang], self._data.get("bare_hedges")
                )
            values = {"line": statement[lang], "teller": teller, "hedge": hedge}
            text = fill(text_frame, values)
            out[lang] = capitalise(text) if lang == "en" else text
        return out

    def rival(
        self,
        prop: Prop,
        names: Mapping[str, Mapping[str, str]],
        *,
        teller: str,
        speaker: str,
        frame: Mapping[str, str] | None = None,
    ) -> dict[str, str]:
        """What ``speaker`` adds, after the belief they hold, of the account ``prop`` that
        ``teller`` told them and they did not take in. ``frame`` is the speaker's own wording of
        the frame ``rival``; without it the table's is used. The sentence is complete."""
        template = frame or self._data["frames"]["rival"]
        bare = self.statement(prop, names, speaker, motive=False, teller=teller)
        statement = self._apart(prop, "told", bare)
        out: dict[str, str] = {}
        for lang in LANGUAGES:
            who = names.get(teller, {}).get(lang, teller)
            text_frame = template[lang]
            if lang == "zh":
                text_frame, _ = _one_copula(text_frame, "", bare[lang])
            text = fill(text_frame, {"line": statement[lang], "teller": who})
            out[lang] = capitalise(text) if lang == "en" else text
        return out
