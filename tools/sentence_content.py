"""Check the bilingual lines of the townsfolk and compile them.

Build time only, like ``check_content``: the core never imports pydantic or yaml. This module is
called by ``check_content.validate`` and adds two outputs to what that function makes:

- ``sentences.json`` for ``content/tables/sentences.yaml``, the lines the townsfolk say.
- ``core/lantern_core/world/bridge/sentences.py``, the same document as Python data, because the
  core cannot read a file and the browser loads it as a wheel. The module is generated and
  checked for staleness like the JSON, and a test holds it equal to the JSON.

What is checked, in short: every predicate of the table has a line and a denial in both
languages and nothing else has; every motive has a phrase; a line names only the slots of its
predicate and the time of the span; every required slot is written in the open and every
optional one inside square brackets, so that leaving it out leaves no trace; a frame has the
places its words need; the Chinese is Chinese and the English is not; the people who take "the"
in English are people of ``entities.yaml``.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, ConfigDict, ValidationError

import town_content
from lantern_core import canon

MODULE = "core/lantern_core/world/bridge/sentences.py"
CJK = re.compile(r"[\u3000-\u303f\u3400-\u9fff\uff00-\uffef]")
SLOT = re.compile(r"\{(\w*)\}")
GROUP = re.compile(r"\[([^\[\]]*)\]")
WHEN = "when"  # the time of the span: a pseudo slot every line may use
# frame -> (the slots it may use, the slots it must use)
FRAME_SLOTS = {
    "seen": ({"line"}, {"line"}),
    "heard": ({"line", "teller"}, {"line", "teller"}),
    "unknown": ({"line"}, {"line"}),
    "own": ({"line"}, {"line"}),
    "guess_own": ({"line", "hedge"}, {"line", "hedge"}),
    "guess_heard": ({"line", "teller", "hedge"}, {"line", "teller"}),
    "guess_unknown": ({"line", "hedge"}, {"line"}),
    "rival": ({"line", "teller"}, {"line", "teller"}),
}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Pair(Strict):
    zh: str
    en: str


class HomeLine(Pair):
    neg: Pair


class Line(Pair):
    neg: Pair
    home: HomeLine | None = None  # said in place of the line when the place is the person's home


class Frames(Strict):
    seen: Pair
    heard: Pair
    unknown: Pair
    own: Pair
    guess_own: Pair
    guess_heard: Pair
    guess_unknown: Pair
    rival: Pair


class Whens(Strict):
    last_night: Pair
    lately: Pair
    this_morning: Pair


class Hedges(Strict):
    zh: list[str]
    en: list[str]


class SentenceFile(Strict):
    predicates: dict[str, Line]
    motives: dict[str, Pair]
    when: Whens
    frames: Frames
    hedges: Hedges
    the: list[str]


def model_errors(where: str, exc: ValidationError) -> list[str]:
    out = []
    for err in exc.errors():
        loc = ".".join(str(part) for part in err["loc"])
        out.append(f"{where}: {loc}: {err['msg']}")
    return out


def _template_problems(where: str, text: str, allowed: set[str], required: set[str]) -> list[str]:
    """What is wrong with one template: brackets, names, and where each slot is written."""
    out: list[str] = []
    inside = GROUP.findall(text)
    open_text = GROUP.sub("", text)
    if "[" in open_text or "]" in open_text:
        return [f"{where}: unbalanced or nested square brackets in {text!r}"]
    if "{" in SLOT.sub("", text) or "}" in SLOT.sub("", text):
        return [f"{where}: a stray brace in {text!r}"]
    for group in inside:
        if not SLOT.search(group):
            out.append(f"{where}: the optional part [{group}] holds no slot")
    in_open = set(SLOT.findall(open_text))
    in_groups = {name for group in inside for name in SLOT.findall(group)}
    for name in sorted((in_open | in_groups) - allowed):
        out.append(f"{where}: {{{name}}} is not a slot here (allowed: {sorted(allowed)})")
    for name in sorted(required - in_open):
        out.append(f"{where}: the required slot {{{name}}} must be written outside the brackets")
    for name in sorted(in_groups & in_open):
        out.append(f"{where}: {{{name}}} is written both inside and outside brackets")
    return out


def _language_problems(where: str, pair: Pair) -> list[str]:
    out: list[str] = []
    if not pair.zh.strip() or not CJK.search(SLOT.sub("", pair.zh)):
        out.append(f"{where}: the Chinese must be Chinese text, got {pair.zh!r}")
    if not pair.en.strip() or CJK.search(pair.en):
        out.append(f"{where}: the English must be English text, got {pair.en!r}")
    return out


def check(raw: Any, tables: Any, ents: Any, errors: list[str]) -> SentenceFile | None:
    """The lines as a model, or ``None`` after appending what is wrong to ``errors``."""
    start = len(errors)
    where = "sentences.yaml"
    if not isinstance(raw, dict) or not raw:
        errors.append(f"{where}: missing or empty")
        return None
    try:
        sf = SentenceFile.model_validate(raw)
    except ValidationError as exc:
        errors += model_errors(where, exc)
        return None
    for pred_id in sorted(set(tables.preds) - set(sf.predicates)):
        errors.append(f"{where}: predicate '{pred_id}' has no line")
    for pred_id in sorted(set(sf.predicates) - set(tables.preds)):
        errors.append(f"{where}: '{pred_id}' is not a predicate of the table")
    for motive_id in sorted(set(tables.motives) - set(sf.motives)):
        errors.append(f"{where}: motive '{motive_id}' has no phrase")
    for motive_id in sorted(set(sf.motives) - set(tables.motives)):
        errors.append(f"{where}: '{motive_id}' is not a motive of the table")
    for pred_id, line in sf.predicates.items():
        pred = tables.preds.get(pred_id)
        if pred is None:
            continue
        slots = {s.name for s in pred.slots}
        required = {s.name for s in pred.slots if s.required}
        pairs = [("line", line, slots, required), ("denial", line.neg, slots, required)]
        if line.home is not None:
            # the place is not written in a line about the home: only the person and the time are
            if not {"who", "where"} <= slots:
                errors.append(f"{where}: {pred_id} has a line at home but no who and where")
            home_slots = {"who"}
            pairs += [
                ("home line", line.home, home_slots, home_slots),
                ("home denial", line.home.neg, home_slots, home_slots),
            ]
        for label, pair, allowed, needed in pairs:
            at = f"{where}: {pred_id} {label}"
            errors += _language_problems(at, pair)
            if pair.en[:1].isupper():
                errors.append(f"{at}: the English starts in lower case, got {pair.en!r}")
            for lang in ("zh", "en"):
                text = getattr(pair, lang)
                errors += _template_problems(f"{at} ({lang})", text, allowed | {WHEN}, needed)
                open_text = GROUP.sub("", text)
                for name in sorted((allowed - needed) & set(SLOT.findall(open_text))):
                    errors.append(f"{at} ({lang}): the optional slot {{{name}}} needs brackets")
    for motive_id, pair in sf.motives.items():
        errors += _language_problems(f"{where}: motive {motive_id}", pair)
    for key, pair in sf.when:
        errors += _language_problems(f"{where}: when {key}", pair)
    for key, pair in sf.frames:
        at = f"{where}: frame {key}"
        errors += _language_problems(at, pair)
        allowed, required = FRAME_SLOTS[key]
        for lang in ("zh", "en"):
            text = getattr(pair, lang)
            problems = _template_problems(f"{at} ({lang})", text, allowed, required)
            errors += problems
            if "[" in text or "]" in text:
                errors.append(f"{at} ({lang}): a frame has no optional parts")
    for lang in ("zh", "en"):
        hedges = getattr(sf.hedges, lang)
        if not hedges or any(not h.strip() for h in hedges):
            errors.append(f"{where}: hedges.{lang} needs one or more non-empty words")
        elif lang == "zh" and not all(CJK.search(h) for h in hedges):
            errors.append(f"{where}: hedges.zh must be Chinese words")
        elif lang == "en" and any(CJK.search(h) for h in hedges):
            errors.append(f"{where}: hedges.en must be English words")
    for person_id in sf.the:
        if ents.kind.get(person_id) != "person":
            errors.append(f"{where}: the: '{person_id}' is not a person of entities.yaml")
    if len(set(sf.the)) != len(sf.the):
        errors.append(f"{where}: the: lists a person twice")
    return None if len(errors) > start else sf


def compile_sentences(sf: SentenceFile) -> dict[str, Any]:
    return {
        "predicates": {
            k: v.model_dump(exclude_none=True) for k, v in sorted(sf.predicates.items())
        },
        "motives": {k: v.model_dump() for k, v in sorted(sf.motives.items())},
        "when": sf.when.model_dump(),
        "frames": sf.frames.model_dump(),
        "hedges": sf.hedges.model_dump(),
        "the": sorted(sf.the),
    }


def render_module(doc: dict[str, Any]) -> bytes:
    """The text of ``sentences.py``: the document as JSON in a raw string, read back by ``json``."""
    text = town_content.pretty(doc)
    assert '"""' not in text and not text.endswith("\\")
    head = (
        '"""The lines of the townsfolk as Python data.\n\n'
        "``SENTENCES`` is the compiled document that ``cognition.lines.Lines`` reads: a line\n"
        "and a denial in two languages for each predicate of the table, a phrase for each\n"
        "motive, the words for the time of a span, the frames that mark how a thing is known,\n"
        "the words that hedge a guess, and the people who take an article in English.\n\n"
        "Generated by tools/check_content.py from content/tables/sentences.yaml. Do not edit it:\n"
        "change the YAML and run the tool. The core cannot read files, so the compiled content\n"
        "travels inside the package. A test holds it equal to content/compiled/sentences.json.\n"
        '"""\n\n'
        "# ruff: noqa: E501\n\n"
        "import json\n\n"
    )
    return (
        head + f'_SENTENCES = r"""\n{text}\n"""\n\nSENTENCES = json.loads(_SENTENCES)\n'
    ).encode("utf-8")


def build(
    raw: Any, tables: Any, ents: Any, errors: list[str]
) -> tuple[dict[str, bytes], dict[str, bytes], list[str]]:
    """Check the lines and compile them: (json outputs, generated modules, coverage lines)."""
    sf = check(raw, tables, ents, errors)
    if sf is None:
        return {}, {}, []
    doc = compile_sentences(sf)
    coverage = [
        f"sentences: {len(sf.predicates)} predicates and {len(sf.motives)} motives in two "
        f"languages, {len(sf.the)} people with an article"
    ]
    return {"sentences.json": canon.dumps(doc)}, {MODULE: render_module(doc)}, coverage
