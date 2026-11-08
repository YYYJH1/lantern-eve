"""Check the words that a model's reply is held to, and compile them.

Build time only, like ``sentence_content``: the core never imports pydantic or yaml. This module is
called by ``check_content.validate`` and adds two outputs to what that function makes:

- ``speech.json`` for ``content/tables/speech.yaml``, the lexicon of the checker of replies.
- ``core/lantern_core/world/bridge/speech_data.py``, the same document as Python data, because the
  core cannot read a file and the browser loads it as a wheel. The module is generated and checked
  for staleness like the JSON, and a test holds it equal to the JSON.

What is checked, in short: the six classes of words are all there and each has words in both
languages; no word is in two classes, and no word is written twice; a Chinese word is Chinese and
an English one is not, in lower case with straight quotes; a mask holds a word of its class, or it
does nothing; every predicate of the table has the words that say its act and every motive the
words that give its reason; an alias names an entity, and no name (a label or an alias) belongs to
two entities; a secret belongs to a person of the cast; the moods and the forms of address have
their plain member and are sentences or names in the right language.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

import sentence_content as sc
import town_content
from lantern_core import canon

MODULE = "core/lantern_core/world/bridge/speech_data.py"
CLASSES = ("connective", "negation", "hedge", "certain", "hearsay", "seen")
PLAYER = "player"  # the festival manager, who is no entity of the script and may be named
PLAIN_MOOD, NO_ADDRESS = "plain", "none"
FORBIDDEN = set("{}[]|")
END = {"zh": "。！？", "en": ".!?"}


class Terms(sc.Strict):
    zh: list[str]
    en: list[str]


class WordClass(Terms):
    mask: Terms


class SpeechFile(sc.Strict):
    moods: dict[str, sc.Pair]
    addresses: dict[str, sc.Pair]
    words: dict[str, WordClass]
    events: dict[str, Terms]
    motives: dict[str, Terms]
    aliases: dict[str, Terms]
    secrets: dict[str, Terms]


def _term_problems(at: str, lang: str, terms: list[str], *, lower: bool) -> list[str]:
    """What is wrong with one list of words of one language."""
    out: list[str] = []
    seen: set[str] = set()
    for term in terms:
        where = f"{at} ({lang}) {term!r}"
        if not term or term != term.strip() or "  " in term:
            out.append(f"{where}: empty, or stray spaces")
        elif FORBIDDEN & set(term):
            out.append(f"{where}: holds one of {sorted(FORBIDDEN)}")
        elif lang == "zh" and (not sc.CJK.search(term) or term.isascii()):
            out.append(f"{where}: a Chinese word must be Chinese")
        elif lang == "en" and sc.CJK.search(term):
            out.append(f"{where}: an English word must not hold Chinese")
        elif lang == "en" and ("’" in term or "‘" in term):
            out.append(f"{where}: write the apostrophe as a plain one")
        elif lower and lang == "en" and term != term.lower():
            out.append(f"{where}: write it in lower case")
        key = term.lower() if lang == "en" else term
        if key in seen:
            out.append(f"{where}: listed twice")
        seen.add(key)
    return out


def _lists(at: str, terms: Terms, *, lower: bool, need: bool) -> list[str]:
    out = _term_problems(at, "zh", terms.zh, lower=lower) + _term_problems(
        at, "en", terms.en, lower=lower
    )
    if need and (not terms.zh or not terms.en):
        out.append(f"{at}: needs words in both languages")
    return out


def _word_problems(sf: SpeechFile) -> list[str]:
    where = "speech.yaml"
    out: list[str] = []
    for cls in sorted(set(CLASSES) - set(sf.words)):
        out.append(f"{where}: words.{cls} is missing")
    for cls in sorted(set(sf.words) - set(CLASSES)):
        out.append(f"{where}: words.{cls} is not a class of words (known: {list(CLASSES)})")
    owner: dict[tuple[str, str], str] = {}
    for cls in CLASSES:
        group = sf.words.get(cls)
        if group is None:
            continue
        at = f"{where}: words.{cls}"
        out += _lists(at, group, lower=True, need=True)
        out += _lists(f"{at}.mask", group.mask, lower=True, need=False)
        for lang in ("zh", "en"):
            words = getattr(group, lang)
            for word in words:
                other = owner.setdefault((lang, word), cls)
                if other != cls:
                    out.append(f"{at} ({lang}) {word!r}: also in the class {other}")
            for mask in getattr(group.mask, lang):
                if mask in words:
                    out.append(f"{at}.mask ({lang}) {mask!r}: is a word of the class itself")
                elif not any(word in mask for word in words):
                    out.append(f"{at}.mask ({lang}) {mask!r}: holds no word of the class")
    return out


def _sentence_problems(at: str, pair: sc.Pair) -> list[str]:
    out = sc._language_problems(at, pair)
    for lang in ("zh", "en"):
        text = getattr(pair, lang)
        if text and text[-1] not in END[lang]:
            out.append(f"{at} ({lang}): must end a sentence with one of {END[lang]!r}")
    return out


def _mood_problems(sf: SpeechFile) -> list[str]:
    out: list[str] = []
    for name, table, plain in (
        ("moods", sf.moods, PLAIN_MOOD),
        ("addresses", sf.addresses, NO_ADDRESS),
    ):
        if plain not in table:
            out.append(f"speech.yaml: {name} needs '{plain}', which says nothing")
        for key, pair in sorted(table.items()):
            at = f"speech.yaml: {name}.{key}"
            if town_content.bad_id(key):
                out.append(f"{at}: not a lower-case snake_case id")
            elif key == plain:
                if pair.zh or pair.en:
                    out.append(f"{at}: must be empty in both languages")
            elif name == "moods":
                out += _sentence_problems(at, pair)
            else:
                out += sc._language_problems(at, pair)
    return out


def _forms(ents: Any) -> dict[tuple[str, str], str]:
    """Every name of every entity, by language and lower-case form: the labels and the aliases."""
    found: dict[tuple[str, str], str] = {}
    for eid in sorted(ents.kind):
        found.setdefault(("zh", ents.label[eid]), eid)
        found.setdefault(("en", _bare(ents.label_en[eid])), eid)
    return found


def _bare(name: str) -> str:
    """An English name in lower case and without the article that the table of lines adds."""
    lower = name.lower()
    return lower[4:] if lower.startswith("the ") else lower


def _alias_problems(sf: SpeechFile, ents: Any) -> list[str]:
    out: list[str] = []
    known = {**ents.kind, PLAYER: "person"}
    names = _forms(ents)
    for eid, terms in sorted(sf.aliases.items()):
        at = f"speech.yaml: aliases.{eid}"
        if eid not in known:
            out.append(f"{at}: not an entity of entities.yaml")
            continue
        out += _lists(at, terms, lower=False, need=False)
        for term in terms.en:
            if term.lower().startswith("the "):
                out.append(f"{at} (en) {term!r}: write the name without 'the'")
        for lang, words in (("zh", terms.zh), ("en", [t.lower() for t in terms.en])):
            for word in words:
                other = names.setdefault((lang, word), eid)
                if other != eid:
                    out.append(f"{at} ({lang}) {word!r}: is also a name of {other}")
    return out


def check(
    raw: Any, tables: Any, ents: Any, people: list[str], errors: list[str]
) -> SpeechFile | None:
    """The lexicon as a model, or ``None`` after appending what is wrong to ``errors``."""
    start = len(errors)
    where = "speech.yaml"
    if not isinstance(raw, dict) or not raw:
        errors.append(f"{where}: missing or empty")
        return None
    try:
        sf = SpeechFile.model_validate(raw)
    except ValidationError as exc:
        errors += sc.model_errors(where, exc)
        return None
    errors += _mood_problems(sf)
    errors += _word_problems(sf)
    for label, table, keys in (
        ("events", sf.events, tables.preds),
        ("motives", sf.motives, tables.motives),
    ):
        for key in sorted(set(keys) - set(table)):
            errors.append(f"{where}: {label}.{key} is missing")
        for key in sorted(set(table) - set(keys)):
            errors.append(f"{where}: {label}.{key} is not in the table")
        for key, terms in sorted(table.items()):
            errors += _lists(f"{where}: {label}.{key}", terms, lower=True, need=True)
    errors += _alias_problems(sf, ents)
    for person, terms in sorted(sf.secrets.items()):
        at = f"{where}: secrets.{person}"
        if person not in people:
            errors.append(f"{at}: not a person of the cast")
        errors += _lists(at, terms, lower=False, need=False)
    return None if len(errors) > start else sf


def compile_speech(sf: SpeechFile) -> dict[str, Any]:
    """The lexicon as the core reads it: every table by key, every list in the order written."""
    return {
        "moods": {k: v.model_dump() for k, v in sorted(sf.moods.items())},
        "addresses": {k: v.model_dump() for k, v in sorted(sf.addresses.items())},
        "words": {k: v.model_dump() for k, v in sorted(sf.words.items())},
        "events": {k: v.model_dump() for k, v in sorted(sf.events.items())},
        "motives": {k: v.model_dump() for k, v in sorted(sf.motives.items())},
        "aliases": {k: v.model_dump() for k, v in sorted(sf.aliases.items())},
        "secrets": {k: v.model_dump() for k, v in sorted(sf.secrets.items())},
    }


def render_module(doc: dict[str, Any]) -> bytes:
    """The text of ``speech_data.py``: the document as JSON in a raw string, read by ``json``."""
    text = town_content.pretty(doc)
    assert '"""' not in text and not text.endswith("\\")
    head = (
        '"""The words that a model\'s reply is held to, as Python data.\n\n'
        "``SPEECH`` is the compiled document that ``cognition.contract.Lexicon`` reads: the six\n"
        "classes of words that need an act behind them, the words that say each predicate's act\n"
        "and each motive, other names for the entities, the secrets of a few people, and the\n"
        "moods and forms of address a reply may carry.\n\n"
        "Generated by tools/check_content.py from content/tables/speech.yaml. Do not edit it:\n"
        "change the YAML and run the tool. The core cannot read files, so the compiled content\n"
        "travels inside the package. A test holds it equal to content/compiled/speech.json.\n"
        '"""\n\n'
        "# ruff: noqa: E501\n\n"
        "import json\n\n"
    )
    return (head + f'_SPEECH = r"""\n{text}\n"""\n\nSPEECH = json.loads(_SPEECH)\n').encode("utf-8")


def build(
    raw: Any, tables: Any, ents: Any, people: list[str], errors: list[str]
) -> tuple[dict[str, bytes], dict[str, bytes], list[str]]:
    """Check the lexicon and compile it: (json outputs, generated modules, coverage lines)."""
    sf = check(raw, tables, ents, people, errors)
    if sf is None:
        return {}, {}, []
    doc = compile_speech(sf)
    counts = {cls: len(sf.words[cls].zh) + len(sf.words[cls].en) for cls in CLASSES}
    coverage = [
        "speech: "
        + ", ".join(f"{cls} {n}" for cls, n in counts.items())
        + f" words; {len(sf.events)} predicates and {len(sf.motives)} motives with words, "
        f"{len(sf.aliases)} entities with other names, {len(sf.secrets)} people with secrets, "
        f"{len(sf.moods)} moods, {len(sf.addresses)} forms of address"
    ]
    return {"speech.json": canon.dumps(doc)}, {MODULE: render_module(doc)}, coverage
