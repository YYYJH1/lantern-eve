"""The words a reply is held to: the closed lists, and how a line is searched for them.

A model's free line is checked by looking for words (``contract``). The words are data, written in
``content/tables/speech.yaml`` and compiled to ``world.bridge.speech_data``. ``Lexicon`` reads that
document, and ``Vocabulary`` adds the names of the entities of one script, which come from its
table of lines. Nothing here reads a model, and nothing depends on the order of a set.

The six classes of words that need an act behind them:

- ``connective``: links of cause, consequence, purpose and sequence between two things said
  (because, therefore, led to, then), and the agent of "it was he who did it".
- ``negation``: saying that something is not so or did not happen.
- ``hedge``: saying that it may be so, or is thought to be (maybe, I guess, 怕是).
- ``certain``: saying that it is surely so. No act can stand behind it in a free line.
- ``hearsay``: saying that it was heard, or is going round.
- ``seen``: saying that the speaker saw or heard it themselves.

A line is searched in a normal form: full-width letters and signs as ordinary ones, curly quotes
as straight ones, lower case, one space for any run of white space. A Chinese word is found as a
substring and an English word as whole words. The line is read from left to right, and at each
place the longest word that fits wins and is read once, so a word inside a longer one (栏杆 inside
石桥栏杆) is not read again, and 弄坏 in 弄坏了 is not read as 坏了. Each class
lists *masks*, harmless compounds that hold one of its words (不错 holds 不): they are blanked
before the class is searched.

Besides the six classes there are the *names* (the label of each entity in both languages and its
other names), the words that say the act of each predicate, and the words that give each motive.
A line that holds one of them says that thing, and it needs an act that does.

A speaker may have names of their own for people (a mother calls her younger son "老二"): those
are names of that person for that speaker and for no one else, and they win over any other name
the town gives the same words. ``Vocabulary.calling`` makes the vocabulary of such a speaker.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping, Sequence
from typing import Any

from lantern_core.cognition._fields import ShapeError, as_dict, as_list, as_str

LANGUAGES = ("zh", "en")
CLASSES = ("connective", "negation", "hedge", "certain", "hearsay", "seen")
NAME, EVENT, MOTIVE = "name", "event", "motive"
PLAYER = "player"

Term = tuple[str, Any, bool]
"""``(form, payload, whole_words)``: what to look for, what it stands for, and whether it must be
whole words (the English ones)."""
Hit = tuple[int, str, Any]
"""``(start, form, payload)``: where a term was found, in the normal form of the text."""


# ----------------------------------------------------------------------------- the normal form


def normalise(text: str) -> str:
    """``text`` in the form it is searched in (see the module docstring)."""
    out = []
    for char in text:
        code = ord(char)
        if char == "　":
            char = " "
        elif 0xFF01 <= code <= 0xFF5E:
            char = chr(code - 0xFEE0)
        elif char in "‘’ʼ":
            char = "'"
        elif char in "“”":
            char = '"'
        out.append(char)
    return " ".join("".join(out).lower().split())


def _word_char(char: str) -> bool:
    return char.isascii() and char.isalnum()


def _whole(text: str, start: int, end: int) -> bool:
    before = start == 0 or not _word_char(text[start - 1])
    after = end == len(text) or not _word_char(text[end])
    return before and after


def ordered(terms: Sequence[Term]) -> tuple[Term, ...]:
    """``terms`` longest first, and in the same order on every run."""
    return tuple(sorted(terms, key=lambda t: (-len(t[0]), t[0], not t[2], repr(t[1]))))


class TermSet:
    """Terms ready to be searched for: kept by their first character, longest first."""

    __slots__ = ("by_first", "terms")

    def __init__(self, terms: Sequence[Term]) -> None:
        self.terms = ordered(terms)
        by_first: dict[str, list[Term]] = {}
        for term in self.terms:
            if term[0]:
                by_first.setdefault(term[0][0], []).append(term)
        self.by_first = by_first

    def __iter__(self) -> Iterator[Term]:
        return iter(self.terms)

    def __len__(self) -> int:
        return len(self.terms)


def scan(text: str, terms: TermSet) -> list[Hit]:
    """Where ``terms`` are found in ``text``, by position.

    The text is read from left to right. At each place the longest term that fits is the hit, and
    the reading goes on after it.
    """
    found: list[Hit] = []
    at, size = 0, len(text)
    while at < size:
        for form, payload, whole in terms.by_first.get(text[at], ()):
            end = at + len(form)
            if text.startswith(form, at) and (not whole or _whole(text, at, end)):
                found.append((at, form, payload))
                at = end
                break
        else:
            at += 1
    return found


def blank(text: str, hits: Sequence[Hit]) -> str:
    """``text`` with the places of ``hits`` turned into spaces."""
    chars = list(text)
    for start, form, _ in hits:
        for i in range(start, start + len(form)):
            chars[i] = " "
    return "".join(chars)


# ----------------------------------------------------------------------------- the document


def _terms(value: Any, where: str, optional: Sequence[str] = ()) -> dict[str, list[str]]:
    d = as_dict(value, where, LANGUAGES, optional)
    return {
        lang: [as_str(w, f"{where}.{lang}") for w in as_list(d[lang], f"{where}.{lang}")]
        for lang in LANGUAGES
    }


def _make(words: Mapping[str, Sequence[str]], payload: Any) -> list[Term]:
    return [(normalise(w), payload, lang == "en") for lang in LANGUAGES for w in words[lang]]


class Lexicon:
    """``content/tables/speech.yaml`` as the checker reads it.

    ``moods`` and ``addresses`` map an id to its two texts. ``classes`` maps a class to its
    terms (``ordered``) and ``masks`` to the compounds that are blanked before that class is
    searched. ``events`` and ``motives`` map an id to the words in both languages, ``aliases`` an
    entity to its other names, and ``secrets`` a person to the words they keep to themselves.
    """

    __slots__ = (
        "addresses",
        "aliases",
        "classes",
        "events",
        "masks",
        "moods",
        "motives",
        "secrets",
    )

    def __init__(self, doc: Any) -> None:
        d = as_dict(
            doc,
            "speech",
            ("moods", "addresses", "words", "events", "motives", "aliases", "secrets"),
        )
        self.moods = _pairs(d["moods"], "moods")
        self.addresses = _pairs(d["addresses"], "addresses")
        words = as_dict(d["words"], "words", CLASSES)
        self.classes: dict[str, TermSet] = {}
        self.masks: dict[str, TermSet] = {}
        for cls in CLASSES:
            group = as_dict(words[cls], f"words.{cls}", (*LANGUAGES, "mask"))
            self.classes[cls] = TermSet(_make(_terms(group, f"words.{cls}", ("mask",)), cls))
            self.masks[cls] = TermSet(_make(_terms(group["mask"], f"words.{cls}.mask"), cls))
        self.events = _keyed(d["events"], "events")
        self.motives = _keyed(d["motives"], "motives")
        self.aliases = _keyed(d["aliases"], "aliases")
        self.secrets = _keyed(d["secrets"], "secrets")


def _table(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ShapeError(f"{where}: expected an object, got {type(value).__name__}")
    return value


def _pairs(value: Any, where: str) -> dict[str, dict[str, str]]:
    """``{id: {"zh": text, "en": text}}``, where a text may be empty."""
    out: dict[str, dict[str, str]] = {}
    table = _table(value, where)
    for key in sorted(table):
        pair = as_dict(table[key], f"{where}.{key}", LANGUAGES)
        for lang in LANGUAGES:
            if not isinstance(pair[lang], str):
                raise ShapeError(f"{where}.{key}.{lang}: expected a string")
        out[key] = {lang: pair[lang] for lang in LANGUAGES}
    return out


def _keyed(value: Any, where: str) -> dict[str, dict[str, list[str]]]:
    table = _table(value, where)
    return {key: _terms(table[key], f"{where}.{key}") for key in sorted(table)}


# ----------------------------------------------------------------------------- the vocabulary


def _bare(name: str) -> str:
    """An English name without the article that the table of lines adds to it."""
    return name[4:] if name.startswith("the ") else name


class Vocabulary:
    """The names of one script and the words that say its acts, ready to be searched for.

    ``names`` is ``{entity id: {"zh": label, "en": label}}`` as ``Lines.names`` makes it. An entity
    is known by its two labels and by the aliases of the lexicon. ``terms`` lists every name, every
    event word and every motive word, each with what it stands for: ``("name", entity)``,
    ``("event", predicates)`` or ``("motive", motives)``. A word that says several predicates or
    motives stands for all of them.
    """

    __slots__ = ("_derived", "_said", "forms", "labels", "motive_words", "pred_words", "terms")

    def __init__(self, lexicon: Lexicon, names: Mapping[str, Mapping[str, str]]) -> None:
        forms: dict[str, dict[str, list[str]]] = {}
        labels: dict[str, str] = {}
        for eid in sorted(names):
            labels[eid] = names[eid]["zh"]
            forms[eid] = {
                "zh": [normalise(names[eid]["zh"])],
                "en": [_bare(normalise(names[eid]["en"]))],
            }
        for eid in sorted(lexicon.aliases):
            mine = forms.setdefault(eid, {"zh": [], "en": []})
            labels.setdefault(eid, eid)
            for lang in LANGUAGES:
                for word in lexicon.aliases[eid][lang]:
                    form = _bare(normalise(word)) if lang == "en" else normalise(word)
                    if form not in mine[lang]:
                        mine[lang].append(form)
        self.forms = forms
        self.labels = labels
        self.pred_words = _merged(lexicon.events)
        self.motive_words = _merged(lexicon.motives)
        self._derived: dict[tuple[tuple[str, str, str], ...], Vocabulary] = {}
        self._index()

    def _index(self) -> None:
        """Make ``terms`` and the words each thing is said by from ``forms`` and the event and
        motive words."""
        terms: list[Term] = []
        claimed: set[tuple[str, bool]] = set()
        for eid in sorted(self.forms):
            for lang in LANGUAGES:
                for form in self.forms[eid][lang]:
                    key = (form, lang == "en")
                    if form and key not in claimed:
                        claimed.add(key)
                        terms.append((form, (NAME, eid), lang == "en"))
        for kind, table in ((EVENT, self.pred_words), (MOTIVE, self.motive_words)):
            for (form, whole), ids in sorted(table.items()):
                terms.append((form, (kind, ids), whole))
        self.terms = TermSet(terms)
        said: dict[tuple[str, str], list[tuple[str, bool]]] = {}
        for eid in sorted(self.forms):
            said[(NAME, eid)] = [(f, False) for f in self.forms[eid]["zh"]] + [
                (f, True) for f in self.forms[eid]["en"]
            ]
        for kind, table in ((EVENT, self.pred_words), (MOTIVE, self.motive_words)):
            for key, ids in sorted(table.items()):
                for ident in ids:
                    said.setdefault((kind, ident), []).append(key)
        self._said = said

    def calling(self, calls: Mapping[str, Mapping[str, str]]) -> Vocabulary:
        """The vocabulary of a speaker who has names of their own for people.

        ``calls`` is ``{entity id: {"zh": name, "en": name}}``. Each name is a name of that entity,
        on top of the ones it has. A word that is another entity's name for everyone else is the
        entity's for this speaker alone, since a speaker means by it who they have said they mean.
        A speaker with no names of their own has this vocabulary itself. The result is made once
        for each table and kept.
        """
        if not calls:
            return self
        key = tuple((eid, calls[eid]["zh"], calls[eid]["en"]) for eid in sorted(calls))
        found = self._derived.get(key)
        if found is None:
            found = self._derived[key] = self._called(calls)
        return found

    def _called(self, calls: Mapping[str, Mapping[str, str]]) -> Vocabulary:
        forms = {
            eid: {lang: list(words) for lang, words in pair.items()}
            for eid, pair in self.forms.items()
        }
        labels = dict(self.labels)
        for eid in sorted(calls):
            labels.setdefault(eid, eid)
            mine = forms.setdefault(eid, {"zh": [], "en": []})
            for lang in LANGUAGES:
                form = normalise(calls[eid][lang])
                form = _bare(form) if lang == "en" else form
                if not form:
                    continue
                for other_id, theirs in forms.items():
                    if other_id != eid and form in theirs[lang]:
                        theirs[lang].remove(form)
                if form not in mine[lang]:
                    mine[lang].append(form)
        derived = object.__new__(Vocabulary)
        derived.forms, derived.labels = forms, labels
        derived.pred_words, derived.motive_words = self.pred_words, self.motive_words
        derived._derived = {}
        derived._index()
        return derived

    def words_of(self, kind: str, ident: str) -> list[tuple[str, bool]]:
        """Every form that says the entity (``name``), predicate (``event``) or motive, each as
        ``(form, whole_words)``."""
        return list(self._said.get((kind, ident), ()))


def _merged(
    table: Mapping[str, Mapping[str, Sequence[str]]],
) -> dict[tuple[str, bool], tuple[str, ...]]:
    """``{(word, whole_words): ids that the word says}`` from ``{id: {lang: [words]}}``."""
    found: dict[tuple[str, bool], list[str]] = {}
    for ident in sorted(table):
        for lang in LANGUAGES:
            for word in table[ident][lang]:
                ids = found.setdefault((normalise(word), lang == "en"), [])
                if ident not in ids:
                    ids.append(ident)
    return {key: tuple(ids) for key, ids in found.items()}
