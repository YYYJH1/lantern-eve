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

- ``self_seen``: "I saw it myself". A guess cannot be seen, so it is a guess of the speaker's.
- ``unknown``: "I heard that", the source hidden or never known.
- the speaker's own id: "If you ask me", a conclusion of the speaker's.
- another person: "so-and-so told me that", with that person's name.

A guess takes the hedge in place of the plain statement ("I guess", "我猜"), one of the words
the table lists for each language, picked by the caller's number so that speakers vary and a
speaker does not. A frame of its own, ``rival``, is for what a speaker says after the belief they
hold: an account somebody told them and they did not take in (``Lines.rival``).

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
LAST_NIGHT, LATELY, THIS_MORNING = "last_night", "lately", "this_morning"
SHORT_SPAN = 480  # minutes: a span longer than this, before the game, is "the past few days"
GAME_STARTS = 360  # minute 360 is 06:00 of day 1, tick 0

_SLOT = re.compile(r"\{(\w+)\}")
_GROUP = re.compile(r"\[([^\[\]]*)\]")


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


def capitalise(text: str) -> str:
    return text[:1].upper() + text[1:]


def frame_key(modality: str, claimed_source: str, speaker: str) -> str:
    """Which frame wraps what ``speaker`` says in ``modality``, naming ``claimed_source``."""
    guess = modality == "speculate"
    if claimed_source == UNKNOWN:
        return "guess_unknown" if guess else "unknown"
    if claimed_source == SELF_SEEN and not guess:
        return "seen"
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

    def _at_home(self, prop: Prop) -> bool:
        """Whether the prop puts a person in their own home."""
        args = dict(prop.args)
        return "who" in args and "where" in args and self.homes.get(args["who"]) == args["where"]

    # -- sentences -------------------------------------------------------------------------

    def statement(
        self, prop: Prop, names: Mapping[str, Mapping[str, str]], speaker: str | None = None
    ) -> dict[str, str]:
        """The prop alone in both languages, in lower case and without a full stop.

        A denial uses the denial of its predicate. A motive follows the statement, after a comma.
        A ``speaker`` who is named in the prop says "I" and "me" (我) for themselves.
        """
        entry = self._data["predicates"].get(prop.pred)
        if entry is None:
            raise LinesError(f"no line for the predicate {prop.pred!r}")
        key = when_key(prop.span)
        out: dict[str, str] = {}
        for lang in LANGUAGES:
            values = {slot: names[entity][lang] for slot, entity in prop.args if entity in names}
            values["when"] = "" if key is None else self._data["when"][key][lang]
            line = entry["home"] if "home" in entry and self._at_home(prop) else entry
            template = (line["neg"] if prop.neg else line)[lang]
            for slot, entity in prop.args:
                if entity == speaker:
                    values[slot] = _myself(lang, template.startswith("{" + slot + "}"))
            text = fill(template, values)
            if prop.motive is not None and not prop.neg:
                phrase = self._data["motives"].get(prop.motive)
                if phrase is None:
                    raise LinesError(f"no phrase for the motive {prop.motive!r}")
                text += ("，" if lang == "zh" else ", ") + phrase[lang]
            out[lang] = text
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
        the English capitalised. ``pick`` chooses the hedge of a guess among the words listed.
        ``frame`` is the speaker's own wording of the frame ``frame_key`` names, and ``hedges``
        their own hedge words in each language. Without them the table's are used.
        """
        template = frame or self._data["frames"][frame_key(modality, claimed_source, speaker)]
        words = self._data["hedges"] if hedges is None else hedges
        statement = self.statement(prop, names, speaker)
        out: dict[str, str] = {}
        for lang in LANGUAGES:
            hedge_words = words[lang]
            teller = names.get(claimed_source, {}).get(lang, claimed_source)
            values = {
                "line": statement[lang],
                "teller": teller,
                "hedge": hedge_words[pick % len(hedge_words)],
            }
            text = fill(template[lang], values)
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
        statement = self.statement(prop, names, speaker)
        out: dict[str, str] = {}
        for lang in LANGUAGES:
            who = names.get(teller, {}).get(lang, teller)
            text = fill(template[lang], {"line": statement[lang], "teller": who})
            out[lang] = capitalise(text) if lang == "en" else text
        return out
