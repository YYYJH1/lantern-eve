"""Check the prompts that ask a model for the words of a townsperson, and compile them.

Build time only, like ``speech_content``: the core never imports pydantic or yaml. This module is
called by ``check_content.validate`` and adds two outputs to what that function makes:

- ``prompts.json`` for ``content/prompts/reply.yaml`` and the note on how each person speaks
  (``voice`` in ``content/lines/<person>.yaml``).
- ``core/lantern_core/world/bridge/prompt_data.py``, the same document as Python data, because the
  core cannot read a file and the browser loads it as a wheel. The module is generated and checked
  for staleness like the JSON, and a test holds it equal to the JSON.

What is checked, in short: every template is there and nothing else is; a template names only the
places it may fill, and every place it must fill (``{{like_this}}``), each in the right number; no
stray double brace is left; a prompt is plain ASCII, so that its length is known; the tables of
outcomes, of the ways of telling and of how a person stands with the manager have exactly the keys
the core asks for; every person of the cast has a note on how they speak, in both languages.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import ValidationError

import sentence_content as sc
import town_content
from lantern_core import canon

MODULE = "core/lantern_core/world/bridge/prompt_data.py"
PLACE = re.compile(r"\{\{(\w*)\}\}")

# template -> (the places it may fill, the places it must fill)
TEMPLATES: dict[str, tuple[set[str], set[str]]] = {
    "reply_system": (
        {"name", "role", "voice_en", "voice_zh", "bio_en", "bio_zh", "temper"}
        | {"moods", "addresses", "closed_lists"},
        {"name", "role", "voice_en", "voice_zh", "bio_en", "bio_zh", "temper"}
        | {"moods", "addresses", "closed_lists"},
    ),
    "reply_user": (
        {"when", "where", "standing", "lately", "facts", "situation", "words", "default"},
        {"when", "where", "standing", "lately", "facts", "situation", "words", "default"},
    ),
    "situation_ask": ({"topic", "outcome"}, {"topic", "outcome"}),
    "situation_ask_source": ({"topic", "outcome"}, {"topic", "outcome"}),
    "situation_tell": ({"topic", "how", "outcome"}, {"topic", "how", "outcome"}),
    "situation_entrust": ({"topic", "outcome"}, {"topic", "outcome"}),
    "situation_promise": ({"topic", "outcome"}, {"topic", "outcome"}),
    "words_quoted": ({"words"}, {"words"}),
    "words_none": (set(), set()),
    "judge_system": (
        {"name", "role", "voice_en", "voice_zh", "temper"},
        {"name", "role", "voice_en", "voice_zh", "temper"},
    ),
    "judge_user": ({"request", "words"}, {"request", "words"}),
}
# The codes the core says an outcome by (``world.bridge.prompts``), the ways of telling
# (``speak.HOWS``) and how a person stands (``prompts.standing``).
OUTCOMES = (
    "claim",
    "ignorant",
    "pretend",
    "evasive",
    "took",
    "knew",
    "doubted",
    "caught",
    "agreed",
    "pending",
    "refused",
    "hard",
    "said_already",
    "cannot",
    "nothing_to_say",
    "needs_nod",
    "too_late",
    "closed",
    "needs",
    "deal",
    "empty",
    "kept",
)
HOWS = ("faithful", "as_seen", "sharpen", "hide_source", "fabricate")
STANDING = ("stranger", "acquainted", "friendly", "close")
REQUESTS = ("testify", "join", "lane", "material", "persuade", "lend", "convene")  # persuade.KINDS
PROMISES = ("stall", "role", "wage", "slot")  # pledges.KINDS
# promise -> (the places its text must fill, the items it names)
PROMISE_TEXT: dict[str, tuple[set[str], tuple[str, ...]]] = {
    "stall": ({"item"}, ("front", "back")),
    "role": ({"item"}, ("t_honor_light", "lead_lanterns", "stage_words")),
    "wage": ({"amount"}, ()),
    "slot": ({"item"}, ()),
}


class Promise(sc.Strict):
    text: sc.Pair
    items: dict[str, sc.Pair] = {}


class PromptFile(sc.Strict):
    reply_system: str
    reply_user: str
    situation_ask: str
    situation_ask_source: str
    situation_tell: str
    situation_entrust: str
    situation_promise: str
    words_quoted: str
    words_none: str
    outcomes: dict[str, str]
    hows: dict[str, str]
    requests: dict[str, sc.Pair]
    promises: dict[str, Promise]
    standing: dict[str, str]
    judge_system: str
    judge_user: str


def _text_problems(at: str, text: str) -> list[str]:
    out: list[str] = []
    if not text.strip():
        out.append(f"{at}: empty")
        return out
    if text != text.strip():
        out.append(f"{at}: stray blank space at the ends")
    if not text.isascii():
        bad = sorted({c for c in text if not c.isascii()})
        out.append(f"{at}: plain ASCII only, found {bad[:5]}")
    if "\t" in text:
        out.append(f"{at}: a tab")
    if any(line != line.rstrip() for line in text.split("\n")):
        out.append(f"{at}: a line ends in blank space")
    return out


def _place_problems(at: str, text: str, allowed: set[str], required: set[str]) -> list[str]:
    out: list[str] = []
    rest = PLACE.sub("", text)
    if "{{" in rest or "}}" in rest:
        out.append(f"{at}: a stray double brace outside a place")
    found = PLACE.findall(text)
    for name in sorted(set(found) - allowed):
        out.append(f"{at}: {{{{{name}}}}} is not a place here (allowed: {sorted(allowed)})")
    for name in sorted(required - set(found)):
        out.append(f"{at}: the place {{{{{name}}}}} must be written")
    for name in sorted({n for n in found if found.count(n) > 1}):
        out.append(f"{at}: the place {{{{{name}}}}} is written more than once")
    return out


def _table_problems(name: str, table: dict[str, str], keys: tuple[str, ...]) -> list[str]:
    out: list[str] = []
    for key in sorted(set(keys) - set(table)):
        out.append(f"prompts: {name}.{key} is missing")
    for key in sorted(set(table) - set(keys)):
        out.append(f"prompts: {name}.{key} is not one the core asks for (known: {list(keys)})")
    for key, text in sorted(table.items()):
        at = f"prompts: {name}.{key}"
        out += _text_problems(at, text)
        if "{{" in text or "}}" in text:
            out.append(f"{at}: no place can be filled in a sentence of this table")
        if "\n" in text:
            out.append(f"{at}: one line, please")
    return out


def _pair_problems(at: str, pair: sc.Pair, allowed: set[str], required: set[str]) -> list[str]:
    """What is wrong with a sentence in both languages that fills the places ``allowed``."""
    out = sc._language_problems(at, pair)
    if not pair.en.isascii():
        out.append(f"{at} (en): plain ASCII only")
    for lang in ("zh", "en"):
        text = getattr(pair, lang)
        out += _place_problems(f"{at} ({lang})", text, allowed, required)
        if "\n" in text or text != text.strip():
            out.append(f"{at} ({lang}): one line, without blank space at the ends")
    return out


def _key_problems(name: str, found: Any, keys: tuple[str, ...]) -> list[str]:
    out = [f"prompts: {name}.{key} is missing" for key in sorted(set(keys) - set(found))]
    out += [
        f"prompts: {name}.{key} is not one the core asks for (known: {list(keys)})"
        for key in sorted(set(found) - set(keys))
    ]
    return out


def _voice_problems(files: dict[str, Any], people: list[str]) -> tuple[dict[str, Any], list[str]]:
    """The note on how each person speaks, and what is wrong with the notes."""
    out: list[str] = []
    notes: dict[str, Any] = {}
    for person in people:
        raw = files.get(person)
        voice = raw.get("voice") if isinstance(raw, dict) else None
        at = f"prompts: lines/{person}.yaml voice"
        if not (
            isinstance(voice, dict)
            and set(voice) == {"zh", "en"}
            and all(isinstance(v, str) and v.strip() for v in voice.values())
        ):
            out.append(f"{at}: needs a note in each language")
            continue
        notes[person] = {"zh": voice["zh"].strip(), "en": voice["en"].strip()}
    return notes, out


def check(
    raw: Any, voices: dict[str, Any], people: list[str], errors: list[str]
) -> tuple[PromptFile, dict[str, Any]] | None:
    """The prompts as a model with the notes on how people speak, or ``None`` after appending what
    is wrong to ``errors``."""
    start = len(errors)
    where = "prompts/reply.yaml"
    if not isinstance(raw, dict) or not raw:
        errors.append(f"{where}: missing or empty")
        return None
    try:
        pf = PromptFile.model_validate(raw)
    except ValidationError as exc:
        errors += sc.model_errors(where, exc)
        return None
    for name, (allowed, required) in TEMPLATES.items():
        at = f"{where}: {name}"
        text = getattr(pf, name)
        errors += _text_problems(at, text)
        errors += _place_problems(at, text, allowed, required)
    errors += _table_problems("outcomes", pf.outcomes, OUTCOMES)
    errors += _table_problems("hows", pf.hows, HOWS)
    errors += _table_problems("standing", pf.standing, STANDING)
    errors += _key_problems("requests", pf.requests, REQUESTS)
    for kind, pair in sorted(pf.requests.items()):
        errors += _pair_problems(f"prompts: requests.{kind}", pair, {"what"}, set())
    errors += _key_problems("promises", pf.promises, PROMISES)
    for what, promise in sorted(pf.promises.items()):
        if what not in PROMISE_TEXT:
            continue
        needs, items = PROMISE_TEXT[what]
        at = f"prompts: promises.{what}"
        errors += _pair_problems(f"{at}.text", promise.text, needs, needs)
        errors += _key_problems(f"{at[9:]}.items", promise.items, items)
        for item, pair in sorted(promise.items.items()):
            errors += _pair_problems(f"{at}.items.{item}", pair, set(), set())
    notes, problems = _voice_problems(voices, people)
    errors += problems
    return (pf, notes) if len(errors) == start else None


def compile_prompts(pf: PromptFile, notes: dict[str, Any]) -> dict[str, Any]:
    """The prompts as the core reads them: every table by key."""
    templates = {name: getattr(pf, name) for name in sorted(TEMPLATES)}
    return {
        "templates": templates,
        "outcomes": dict(sorted(pf.outcomes.items())),
        "hows": dict(sorted(pf.hows.items())),
        "standing": dict(sorted(pf.standing.items())),
        "requests": {k: v.model_dump() for k, v in sorted(pf.requests.items())},
        "promises": {k: v.model_dump() for k, v in sorted(pf.promises.items())},
        "voices": dict(sorted(notes.items())),
    }


def render_module(doc: dict[str, Any]) -> bytes:
    """The text of ``prompt_data.py``: the document as JSON in a raw string, read by ``json``."""
    text = town_content.pretty(doc)
    assert '"""' not in text and not text.endswith("\\")
    head = (
        '"""The prompts that ask a model for the words of a townsperson, as Python data.\n\n'
        "``PROMPTS`` is the compiled document that ``world.bridge.prompts`` reads: the templates\n"
        "of the messages of a request, the sentences for what the rules decided, and the note on\n"
        "how each person speaks.\n\n"
        "Generated by tools/check_content.py from content/prompts/reply.yaml and the notes on\n"
        "how people speak in content/lines. Do not edit it: change the YAML and run the tool. The\n"
        "core cannot read files, so the compiled content travels inside the package. A test holds\n"
        "it equal to content/compiled/prompts.json.\n"
        '"""\n\n'
        "# ruff: noqa: E501\n\n"
        "import json\n\n"
    )
    return (head + f'_PROMPTS = r"""\n{text}\n"""\n\nPROMPTS = json.loads(_PROMPTS)\n').encode(
        "utf-8"
    )


def build(
    raw: Any, voices: dict[str, Any], people: list[str], errors: list[str]
) -> tuple[dict[str, bytes], dict[str, bytes], list[str]]:
    """Check the prompts and compile them: (json outputs, generated modules, coverage lines)."""
    found = check(raw, voices, people, errors)
    if found is None:
        return {}, {}, []
    pf, notes = found
    doc = compile_prompts(pf, notes)
    size = sum(len(text) for text in doc["templates"].values())
    coverage = [
        f"prompts: {len(doc['templates'])} templates ({size} characters), {len(pf.outcomes)} "
        f"outcomes, {len(pf.hows)} ways of telling, {len(pf.requests)} requests, "
        f"{len(pf.promises)} promises, {len(notes)} people with a note on how they speak"
    ]
    return {"prompts.json": canon.dumps(doc)}, {MODULE: render_module(doc)}, coverage
